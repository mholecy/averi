import { BOUNDS_PATTERN, parseBounds } from './android-bounds.js';
import { rectIntersection, type FocusedWindow, type KeyboardWitness, type Rect, type SoftKeyboard } from './types.js';

/**
 * The window manager's and the input method's dumps (`dumpsys window …`, `dumpsys input_method`) as the adapter reads
 * them: each read's shell line and its parser, with no device call here (android.ts sends the lines).
 */

/**
 * `mInputShown=<bool>` as a whole `key=value` word: it follows whitespace (it
 * is the LAST word of a line of such words) and its value ends at whitespace
 * or the line's end, so neither `…mInputShown=` as the tail of a longer name
 * (`mPrevmInputShown=`) nor
 * `mInputShown=trueish` reads as an answer.
 */
const INPUT_SHOWN_RE = /(?:^|\s)mInputShown=(true|false)(?=\s|$)/g;

/**
 * A `rawShell` line (the adapter's named exception to quoted argv, adb-shell.ts):
 * ONE argument for `adb shell`, run by the device's sh as written, so the
 * pipe runs on the device. Every word in it is a constant that needs no
 * quoting. Exported for the live golden's IME capture (AndroidLab.ime in
 * scripts/truth/lab-device.ts), which asks it word for word.
 */
export const INPUT_SHOWN_COMMAND = 'dumpsys input_method | grep -m1 -w mInputShown';

/**
 * The input method manager's own "is the keyboard shown" out of (a grep of)
 * `dumpsys input_method`. One value, or several that agree; anything else —
 * no such word, an unreadable value, two that disagree — is `unknown`. (The
 * device-side `grep -m1` returns one line, so "two that disagree" only
 * guards multi-line input: fixtures, or a future unfiltered read.)
 */
export function parseInputShown(out: string): KeyboardWitness {
  const values = new Set([...out.matchAll(INPUT_SHOWN_RE)].map((m) => m[1]));
  if (values.size !== 1) return 'unknown';
  return values.has('true') ? 'shown' : 'hidden';
}

/**
 * keyboardTouchable's one `rawShell` line: the witness's own filtered read,
 * then every `touchable region=` line of the IME window's dump (no `-m1`:
 * two that disagree must be seen, parseTouchableRegion reads them as none),
 * then `true`, so a grep that matched nothing does not fail the call. Every
 * word a constant. Exported for the live golden's kf launch read
 * (AndroidLab.imeTouchable in scripts/truth/lab-device.ts), which asks it word for word.
 */
export const TOUCHABLE_COMMAND = `${INPUT_SHOWN_COMMAND}; dumpsys window InputMethod | grep -F 'touchable region='; true`;

/**
 * The window manager's word on the focused window, in one shell line: the focus and the display's size out of `dumpsys
 * window displays` (API 33 prints `mCurrentFocus` there, not in `windows`; one line each per display, the first
 * display's first), then `dumpsys window windows` — each window's hash, type (`mAttrs … ty=`), frame (`Frames: …
 * frame=`) and `isVisible=`. Every word a constant; the line's status is the last command's.
 */
export const FOCUSED_WINDOW_COMMAND = "dumpsys window displays | grep -E 'mCurrentFocus=|DisplayFrames w='; dumpsys window windows";

/** The focused window's hash: `mCurrentFocus=Window{c6f91da u0 dev.averi.lab/…}` (`mCurrentFocus=null` in a transition). */
const CURRENT_FOCUS_RE = /mCurrentFocus=Window\{([0-9a-f]+) /;
/** One window's block of `dumpsys window windows`: its header, `  Window #9 Window{c6f91da u0 …}:`. */
const WINDOW_HEADER_RE = /^ {2}Window #\d+ Window\{([0-9a-f]+) [^\n]*:$/gm;
/** A window's type, the first `ty=` of its block — `mAttrs`'s (its `paramsForRotation` follow): a name, or a number for a type with none. */
const WINDOW_TYPE_RE = /\bty=([A-Z_]+|\d+)/;
/** A window's frame on the display: `Frames: parent=… display=… frame=[0,66][1080,2153] last=…`. */
const WINDOW_FRAME_RE = /^ +Frames: .*? frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/m;
/** A window shown on the display: WindowState.isVisible's own line. */
const WINDOW_VISIBLE_RE = /^ {4}isVisible=true$/m;

/**
 * The window types of an app (`WindowManager.LayoutParams`): application windows 1–99 and sub-windows 1000–1999, by
 * the names the dump prints for them. A type the dump prints as a number (`ty=2040`) is read as that number.
 */
const APP_WINDOW_TYPES: Readonly<Record<string, number>> = {
  BASE_APPLICATION: 1,
  APPLICATION: 2,
  APPLICATION_STARTING: 3,
  DRAWN_APPLICATION: 4,
  APPLICATION_PANEL: 1000,
  APPLICATION_MEDIA: 1001,
  APPLICATION_SUB_PANEL: 1002,
  APPLICATION_ATTACHED_DIALOG: 1003,
  APPLICATION_MEDIA_OVERLAY: 1004,
  APPLICATION_ABOVE_SUB_PANEL: 1005,
};
const TYPE_BASE_APPLICATION = 1;
const TYPE_APPLICATION_STARTING = 3;
const isAppWindow = (type: number): boolean => (type >= 1 && type <= 99) || (type >= 1000 && type <= 1999);

/** One window of the dump as parseFocusedWindow reads it. */
interface WmWindow {
  hash: string;
  type: number | undefined;
  frame: Rect | undefined;
  visible: boolean;
}

/**
 * The focused window out of FOCUSED_WINDOW_COMMAND's answer (types.ts#FocusedWindow):
 * - `stacked` — the focus is an app's window that is not the activity's own (TYPE_BASE_APPLICATION) nor a starting
 *   window: a Dialog's (TYPE_APPLICATION), a panel; with its frame and the display's size;
 * - `screenAlone` — the focus is the activity's own window and no OTHER window of an app is visible (a translucent
 *   activity over another, a non-focusable popup, a starting window all fail this); with its frame;
 * - `unknown` — anything else: no focus (a transition), a focus the windows dump does not list, no display size, a
 *   system window focused (the notification shade), a dump cut short or not this one.
 * The frame is clipped to the display, as the dump clips its root: the window manager may lay a window past the
 * screen's edge (dialog-fullscreen's `Requested w=1081` of a 1080 screen; API 33's `Frames: … frame=` prints it
 * clipped, `mAttrs` does not). A frame wholly off the display is none: `unknown`. Which window of the dump the
 * uiautomator root is, is not decided here: ui-tree/window-mark.ts matches the frame.
 */
export function parseFocusedWindow(dump: string): FocusedWindow {
  const focus = CURRENT_FOCUS_RE.exec(dump)?.[1];
  const [, w, h] = /DisplayFrames w=(\d+) h=(\d+)/.exec(dump) ?? [];
  if (focus === undefined || w === undefined) return { of: 'unknown' };
  const screen = { width: Number(w), height: Number(h) };
  const windows = wmWindows(dump);
  const focused = windows.find((x) => x.hash === focus);
  if (focused?.type === undefined || focused.frame === undefined || !isAppWindow(focused.type)) return { of: 'unknown' };
  const frame = rectIntersection(focused.frame, { x: 0, y: 0, ...screen });
  if (frame === undefined) return { of: 'unknown' };
  if (focused.type === TYPE_BASE_APPLICATION) {
    const beside = windows.some((x) => x !== focused && x.visible && (x.type === undefined || isAppWindow(x.type)));
    return beside ? { of: 'unknown' } : { of: 'screenAlone', frame };
  }
  if (focused.type === TYPE_APPLICATION_STARTING) return { of: 'unknown' };
  return { of: 'stacked', frame, screen };
}

/** Each window block of `dumpsys window windows`, in the dump's order. */
function wmWindows(dump: string): WmWindow[] {
  const headers = [...dump.matchAll(WINDOW_HEADER_RE)];
  return headers.map((m, i) => {
    const block = dump.slice(m.index, headers[i + 1]?.index ?? dump.length);
    const ty = WINDOW_TYPE_RE.exec(block)?.[1];
    const f = WINDOW_FRAME_RE.exec(block);
    const [l, t, r, b] = f === null ? [] : f.slice(1, 5).map(Number);
    return {
      hash: m[1],
      type: ty === undefined ? undefined : /^\d+$/.test(ty) ? Number(ty) : APP_WINDOW_TYPES[ty] ?? 0,
      frame: f === null ? undefined : { x: l, y: t, width: r - l, height: b - t },
      visible: WINDOW_VISIBLE_RE.test(block),
    };
  });
}

/** `touchable region=SkRegion(<rects>)` — the whole line's value, the rects read by TOUCHABLE_RECT_RE. */
const TOUCHABLE_REGION_RE = /(?:^|\s)touchable region=SkRegion\(((?:\s*\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\))*)\s*\)/;
/** One `(l,t,r,b)` of an SkRegion. */
const TOUCHABLE_RECT_RE = /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;

/**
 * The IME window's touchable region out of (a grep of) `dumpsys window
 * InputMethod`. The shape, measured on API 33:
 *   touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))   floating Gboard
 *   touchable region=SkRegion((0,1398,1080,2220))                       docked
 * — Skia's region as `(left,top,right,bottom)` per rect, any number of them,
 * in screen pixels (uiautomator's units). Read as rects `{x, y, width,
 * height}`; whitespace between the numbers and groups is tolerated. Never
 * guessed: no such line, a line whose region is not wholly `(l,t,r,b)`
 * groups (a different notation, a truncated dump), a rect with right < left
 * or bottom < top, or several lines that do not all say the same thing →
 * `undefined`, and the caller reads no panel (the band alone, as before the
 * question existed). `SkRegion()` — an empty region — is `[]`.
 */
export function parseTouchableRegion(out: string): readonly Rect[] | undefined {
  const lines = out.split('\n').filter((line) => line.includes('touchable region='));
  if (lines.length === 0) return undefined;
  const bodies = new Set<string>();
  for (const line of lines) {
    const body = line.match(TOUCHABLE_REGION_RE)?.[1];
    if (body === undefined) return undefined;
    bodies.add(body.replace(/\s+/g, ''));
  }
  if (bodies.size !== 1) return undefined;
  const [body] = bodies;
  const rects: Rect[] = [];
  for (const [, l, t, r, b] of body.matchAll(TOUCHABLE_RECT_RE)) {
    const [left, top, right, bottom] = [l, t, r, b].map(Number);
    if (right < left || bottom < top) return undefined;
    rects.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return rects;
}

/** One `InsetsSource …` entry of a display's InsetsState, as `dumpsys window displays` lists it. */
const INSETS_SOURCE_LINE_RE = /^[ \t]*InsetsSource (.*)$/gm;
/** The IME's insets type: `ITYPE_IME` up to Android 13, `ime` (WindowInsets.Type.toString) from 14. */
const IME_INSETS_TYPES = new Set(['ITYPE_IME', 'ime']);
/** The status bar's insets type: `ITYPE_STATUS_BAR` up to Android 13, `statusBars` from 14 (both in the real dumps, tests/fixtures). */
const STATUS_BAR_INSETS_TYPES = new Set(['ITYPE_STATUS_BAR', 'statusBars']);
/** The navigation bar's insets type: `ITYPE_NAVIGATION_BAR` up to Android 13 (in the real dumps, tests/fixtures), `navigationBars` from 14. */
const NAVIGATION_BAR_INSETS_TYPES = new Set(['ITYPE_NAVIGATION_BAR', 'navigationBars']);
/** A display's size and rotation as `dumpsys window displays` lists it, one line a display: `DisplayFrames w=1080 h=2220 r=0` (API 33 and 36 alike, tests/fixtures). */
const DISPLAY_FRAMES_RE = /^[ \t]*DisplayFrames w=(\d+) h=(\d+) r=(\d+)[ \t]*$/gm;
/**
 * The three tokens of an InsetsSource entry parseImeInsets reads. Each is anchored on BOTH sides — a token starts the entry or
 * follows whitespace, and its value ends at whitespace or the line's end —
 * because the entry is a run of `key=value` words and an unanchored match
 * reads a neighbour: `frame=` is the tail of `visibleFrame=` (API ≤ 33
 * prints both, and the hidden keyboard's visibleFrame is NOT empty),
 * `visible=` the tail of any `…visible=`, `type=` of any `…type=`; and
 * `visible=trueish` must not read as true. All pinned.
 */
const INSETS_TYPE_RE = /(?:^|\s)type=(\S+)/;
const INSETS_FRAME_RE = new RegExp(String.raw`(?:^|\s)frame=(${BOUNDS_PATTERN})(?=\s|$)`);
const INSETS_VISIBLE_RE = /(?:^|\s)visible=(true|false)(?=\s|$)/;
/**
 * DisplayPolicy's own line in the same dump — the second witness
 * parseImeInsets asks. A whole line, nothing else on it: the same text
 * mid-line (inside some other object's toString) is not that field.
 */
const IME_SHOWING_LINE_RE = /^[ \t]*mIsImeShowing=(true|false)[ \t]*$/gm;

/**
 * Read the soft keyboard's state out of `dumpsys window displays`.
 *
 * The line it reads is the display's InsetsState entry for the IME — the
 * insets the window manager hands to apps, i.e. the screen area the keyboard
 * takes from them, in screen pixels (uiautomator's units):
 *
 *   API 33, shown   (measured on the emulator, Settings search):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false
 *   API 33, hidden  (same device):
 *     InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 33, ~0.4 s after `back` hid it (the hide animation still running):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 36, a booted device that has not shown a keyboard yet (measured):
 *   NO ime entry — the list holds only
 *     InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null
 *   API 34+, shown: `InsetsSource id=… type=ime frame=[l,t][r,b] visible=true …`
 *   — FROM AOSP's InsetsSource.dump, NOT captured on a device (the one API 36
 *   AVD available was PIN-locked, so no keyboard could be raised on it); the
 *   line's layout is verified on that device for the other types.
 *
 * What the measurements force:
 * - `visible=` decides, never the frame alone: a hidden keyboard keeps a
 *   non-empty `visibleFrame` (the nav-bar strip) and, while it animates out,
 *   its full `frame`. `visibleFrame` is not read at all (absent from 14 on).
 * - Only the `InsetsSource …` lines that START a line are read — the state
 *   list. The same text recurs as `mSource=InsetsSource …` under each
 *   provider, and `InsetsSourceControl …` is a different object.
 *
 * The second witness: DisplayPolicy's `mIsImeShowing=<bool>` line,
 * printed in the same dump. Measured:
 * `mIsImeShowing=true` (with `mImeHeight=756`) beside the shown line on API
 * 33, `mIsImeShowing=false` beside the hidden one, and `mIsImeShowing=false`
 * on the API 36 device with no ime entry. Its value DURING the show/hide
 * animations was not captured. On API 30–32 the line may not be printed at
 * all — UNVERIFIED, no such device was at hand — which is why its absence is
 * tolerated where the InsetsSource entry speaks for itself.
 *
 * Never guess (the answer gates a `back` key press, which NAVIGATES when no
 * keyboard is up — so the worst outcome is a false `shown`, the second worst
 * a silent `hidden`; `unknown` costs nothing, the callers behave as before):
 * - no InsetsSource entry that reads fully (type, frame, visible) → unknown:
 *   the format is not one this parser knows;
 * - an IME entry that does not read fully, or a visible one with an empty
 *   frame → unknown;
 * - several IME entries, or several `mIsImeShowing` lines, that do not all
 *   say the same thing (state, and frame when visible) → unknown. That is
 *   the multi-display case: display 0 hidden and display 1 shown must not
 *   read as `shown` with display 1's frame. Chosen over scoping to the
 *   default display because all three real dumps are single-display — where
 *   one display's section ends is not something they can verify. The
 *   consequence, by design and not a bug: a device with a second display
 *   reads `unknown` whenever a keyboard is shown (the displays' witnesses
 *   disagree), i.e. it behaves as before the guard existed;
 * - `shown` = a visible IME entry with a frame, and `mIsImeShowing` not
 *   saying false (true, or absent);
 * - `hidden` = an IME entry with visible=false, and `mIsImeShowing` not
 *   saying true (false, or absent);
 * - NO IME entry: `hidden` only when `mIsImeShowing=false` says so (the API
 *   36 measurement). Otherwise unknown — a dump truncated before the entry,
 *   or an Android that renamed the type, must not silently switch the guard
 *   off or stop `dismissKeyboard` pressing back.
 */
export function parseImeInsets(dump: string): SoftKeyboard {
  const unknown: SoftKeyboard = { state: 'unknown' };
  let recognised = 0;
  /** What each IME entry says: 'hidden', or the frame text of a visible one. */
  const entries = new Set<string>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const reads = type !== undefined && frame !== undefined && visible !== undefined;
    if (reads) recognised++;
    if (type === undefined || !IME_INSETS_TYPES.has(type)) continue;
    if (!reads) return unknown;
    entries.add(visible === 'true' ? frame : 'hidden');
  }
  const flags = new Set([...dump.matchAll(IME_SHOWING_LINE_RE)].map((m) => m[1]));
  if (recognised === 0 || entries.size > 1 || flags.size > 1) return unknown;
  const [entry] = entries;
  const [showing] = flags; // 'true' | 'false' | undefined (line absent)
  if (entry === undefined) return showing === 'false' ? { state: 'hidden' } : unknown;
  if (entry === 'hidden') return showing === 'true' ? unknown : { state: 'hidden' };
  const rect = parseBounds(entry);
  if (rect.width <= 0 || rect.height <= 0 || showing === 'false') return unknown;
  return { state: 'shown', frame: rect };
}

/**
 * The VISIBLE system status bar's height, in screen pixels, out of `dumpsys
 * window displays` — the band at the top of the screen a tap
 * goes to the bar in (types.ts#DeviceScreen.statusBand). The line it reads
 * is the display's InsetsState entry for the status bar, the same list
 * parseImeInsets reads (and with the same anchored tokens):
 *
 *   API 33 (tests/fixtures/dumpsys-window-displays-api33-*.txt, emulator
 *   Pixel_3a, 1080x2220; a device check read the same line under Google
 *   Contacts):
 *     InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false
 *   API 36 (…-api36-no-ime-source.txt, Pixel_4 AVD, 1080x2280):
 *     InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null
 *
 * The band is the frame's BOTTOM, of a frame that starts at the screen's
 * top and is not empty. Not measured: a hidden bar (an immersive app) —
 * read by `visible=false`, as a hidden keyboard is, so no band; a
 * landscape screen, whose bar is still at the top (no band is cut in
 * landscape — a residual of ui-tree/standing.ts#Scene).
 *
 * Never guesses — no band (the judgements fail open) on: no status-bar entry; one that does not read fully (type, frame,
 * visible); a hidden one; an empty frame or one below the top; several
 * entries (one per display) that do not all say the same band — the
 * multi-display case parseImeInsets refuses alike.
 */
export function parseStatusBand(dump: string): number | undefined {
  /** What each status-bar entry says: its band, or 'none' (hidden, unread, empty, not at the top). */
  const entries = new Set<number | 'none'>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    if (type === undefined || !STATUS_BAR_INSETS_TYPES.has(type)) continue;
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const rect = frame === undefined ? undefined : parseBounds(frame);
    entries.add(rect === undefined || visible !== 'true' || rect.y !== 0 || rect.width <= 0 || rect.height <= 0 ? 'none' : rect.height);
  }
  const [band] = entries;
  return entries.size === 1 && band !== 'none' ? band : undefined;
}

/**
 * The VISIBLE navigation bar's TOP, in screen pixels, out of `dumpsys window
 * displays` (types.ts#DeviceScreen.navigationBand) — the band at the bottom
 * of the screen held upright that is the system's, not the app's. The line
 * it reads is the display's InsetsState entry for the navigation bar,
 * beside the status bar's (parseStatusBand: the same anchored tokens, the
 * same refusals):
 *
 *   API 33 (tests/fixtures/dumpsys-window-displays-api33-*.txt, emulator
 *   Pixel_3a, 1080x2220, gesture navigation):
 *     DisplayFrames w=1080 h=2220 r=0
 *     InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true insetsRoundedCornerFrame=false
 *   API 34+: `type=navigationBars` (WindowInsets.Type.toString), unmeasured —
 *   the API 36 fixture lists no navigation-bar entry at all.
 *
 * The bottom is the display's own, read from the same dump: its
 * `DisplayFrames w=… h=… r=…` line, the size the insets frames are laid out
 * in. The band is the frame's TOP, of a frame that spans the display's
 * width from x 0, starts below the top, is wider than it is tall and ENDS
 * AT THE BOTTOM (`h`) — a bar at the left or right side, or one the width
 * of half the display, is no bottom band. Only on a display in its natural
 * rotation (`r=0`) that is itself portrait (`w <= h`): a turned display
 * (landscape, where 3-button navigation moves the bar to a side) has no
 * band, and neither has a display whose natural rotation is landscape (a
 * tablet, `w=2560 h=1600 r=0`) — its band, kept with the status band until
 * a launch or a fresh read, would be applied to the turned portrait box
 * after a rotation: `scroll_until`'s stop would refuse every centre from
 * 1504 down (the tap's refusal reads the bands again first). So a band, when
 * there is one, is always the portrait screen's own: the only portrait box
 * of that device. Portrait phones only, a residual. Never
 * guesses — no band on: no entry; one that does not read fully (type,
 * frame, visible); a hidden one (an immersive app); a frame of any other
 * shape; no DisplayFrames line, or several that do not all say the same
 * size; several entries that do not all say the same band.
 */
export function parseNavigationBand(dump: string): number | undefined {
  const frames = [...dump.matchAll(DISPLAY_FRAMES_RE)];
  if (new Set(frames.map(([line]) => line.trim())).size !== 1) return undefined; // none, or displays of different sizes
  const [, w, h, r] = frames[0].map(Number);
  if (r !== 0 || w > h) return undefined;
  /** What each navigation-bar entry says: its top, or 'none' (hidden, unread, or not a bar across the display's bottom). */
  const entries = new Set<number | 'none'>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    if (type === undefined || !NAVIGATION_BAR_INSETS_TYPES.has(type)) continue;
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const rect = frame === undefined ? undefined : parseBounds(frame);
    const acrossTheBottom = rect !== undefined && rect.x === 0 && rect.width === w && rect.y > 0 && rect.y + rect.height === h && rect.height > 0 && rect.height < rect.width;
    entries.add(rect === undefined || visible !== 'true' || !acrossTheBottom ? 'none' : rect.y);
  }
  const [band] = entries;
  return entries.size === 1 && band !== 'none' ? band : undefined;
}

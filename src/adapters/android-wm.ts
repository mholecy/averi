import { BOUNDS_PATTERN, parseBounds } from './android-bounds.js';
import { rectIntersection, type FocusedWindow, type KeyboardWitness, type Rect, type SoftKeyboard } from './types.js';

/**
 * The window manager's and the input method's dumps (`dumpsys window …`, `dumpsys input_method`) as the adapter reads
 * them: each read's shell line and its parser, with no device call here (android.ts sends the lines).
 *
 * Every read answers for ONE display, the default one (A35): onDefaultDisplay below is the rule, and each parser reads
 * what it hands back.
 */

/** What opens each display's block in `dumpsys window displays`, its id after it: `Display: mDisplayId=0 (organized)`. */
const DISPLAY_HEADER = 'Display: mDisplayId=';

/**
 * The default display (`Display.DEFAULT_DISPLAY`): where `am start` with no `--display` starts the app and the link,
 * and what `input tap`/`swipe` and `screencap` with no `-d` act on — the display averi verifies.
 */
const DEFAULT_DISPLAY = 0;

/** A window block's display: the `mDisplayId=<n> rootTaskId=…` line its header opens on (API 33, tests/fixtures). */
const WINDOW_DISPLAY_RE = /^ {4}mDisplayId=(\d+) /m;

/**
 * THE DISPLAY RULE (A35): the default display's part of a window manager dump, so every read answers for that display
 * and another display's lines are never read. Where the dump says which display a line is, that decides:
 * - a dump with display headers (`dumpsys window displays`, whole or grepped: the insets reads, the chooser's): display
 *   0's block, from its header to the next. No block is display 0's: nothing (an empty part, which every read
 *   answers as unread);
 * - FOCUSED_WINDOW_COMMAND's answer, whose grep prints no headers: each display's `mCurrentFocus` line comes before
 *   its own `DisplayFrames` line (A35's capture), and each window block of `dumpsys window windows` names its display
 *   (`mDisplayId=<n>`). Display 0's part is its focus line with the lines up to the next focus line (its size), then
 *   its own window blocks. Display 0's focus line is the one whose window's block is display 0's: a `null` focus
 *   (only the top-focused display has a window focus), or one whose window the dump does not list, is no display's
 *   that can be told, and two that both name a window of display 0's are no one focus — no focus line then;
 * - a dump that names no display (no header, no window block naming one) is one display's, whole: every captured
 *   one-display dump is display 0's, so it reads as before A35.
 * Before A35 the reads answered a second display three ways (every display must agree, the first found, display 0's
 * block); ADR 0041's A35 amendment says why this one.
 */
function onDefaultDisplay(dump: string): string {
  const [, ...displays] = dump.split(DISPLAY_HEADER);
  if (displays.length > 0) return displays.find((block) => Number.parseInt(block, 10) === DEFAULT_DISPLAY) ?? '';
  const windows = windowBlocks(dump);
  if (windows.length === 0) return dump;
  const ours = windows.filter((w) => w.display === DEFAULT_DISPLAY);
  const lines = dump.slice(0, windows[0].at);
  const starts = [...lines.matchAll(CURRENT_FOCUS_LINE_RE)].map((m) => m.index);
  const parts = starts.map((at, i) => lines.slice(at, starts[i + 1]));
  const focus = parts.filter((part) => {
    const hash = focusLines(part)[0]?.hash;
    return ours.some((w) => w.hash === hash);
  });
  return (focus.length === 1 ? focus[0] : '') + ours.map((w) => w.text).join('');
}

/** One window block of `dumpsys window windows`: where it starts, its hash, its display, its text to the next block. */
interface WindowBlock {
  at: number;
  hash: string;
  display: number;
  text: string;
}

/**
 * Each window block of `dumpsys window windows`, in the dump's order. A block that names no display is the default
 * display's (a dump that names none is one display's).
 */
function windowBlocks(dump: string): WindowBlock[] {
  const headers = [...dump.matchAll(WINDOW_HEADER_RE)];
  return headers.map((m, i) => {
    const text = dump.slice(m.index, headers[i + 1]?.index ?? dump.length);
    const display = WINDOW_DISPLAY_RE.exec(text)?.[1];
    return { at: m.index, hash: m[1], display: display === undefined ? DEFAULT_DISPLAY : Number(display), text };
  });
}

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
 * window displays` (API 33 prints `mCurrentFocus` there, not in `windows`; one pair each per display, the focus line
 * first, the top-focused display last, no display header), then `dumpsys window windows` — each window's hash, display
 * (`mDisplayId=`), type (`mAttrs … ty=`), frame (`Frames: … frame=`) and `isVisible=`; onDefaultDisplay tells display
 * 0's lines from them. Every word a constant; the line's status is the last command's.
 */
export const FOCUSED_WINDOW_COMMAND = "dumpsys window displays | grep -E 'mCurrentFocus=|DisplayFrames w='; dumpsys window windows";

/**
 * The focused window, one line a display: `mCurrentFocus=Window{c6f91da u0 dev.averi.lab/…}` (`mCurrentFocus=null` in
 * a transition) — its hash, and its component when the record names one (`u<user> <pkg>/<class>}`, ended by the
 * record's `}`; a window named by a title, `Window{… u0 NotificationShade}`, has none). ONE reader for both readers of
 * the line (A27): parseFocusedWindow asks the hash, defaultDisplayFocus the component. The hash is read of any
 * `Window{<hash> ` record, the component of the user-token shape only, as the two regexes before A27 read them (every
 * captured line has the token: tests/adapters/android-wm.test.ts).
 */
const CURRENT_FOCUS_RE = /mCurrentFocus=Window\{([0-9a-f]+) (?:u\d+ ([^\s/}]+\/[^\s}]+)\})?/g;

/** A focus line, `null` or not: each display prints one (onDefaultDisplay cuts the focus read at each). */
const CURRENT_FOCUS_LINE_RE = /mCurrentFocus=/g;

/** Each focus line of `dump`, in its order: the window's hash, and its component when the record names one. */
const focusLines = (dump: string): { hash: string; component: string | undefined }[] =>
  [...dump.matchAll(CURRENT_FOCUS_RE)].map(([, hash, component]) => ({ hash, component }));
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
export function parseFocusedWindow(whole: string): FocusedWindow {
  const dump = onDefaultDisplay(whole);
  const focus = focusLines(dump)[0]?.hash;
  const [, w, h] = /DisplayFrames w=(\d+) h=(\d+)/.exec(dump) ?? [];
  if (focus === undefined || w === undefined) return { of: 'unknown' };
  const screen = { width: Number(w), height: Number(h) };
  const windows = windowBlocks(dump).map(wmWindow);
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

/** One window block as parseFocusedWindow reads it. */
function wmWindow({ hash, text: block }: WindowBlock): WmWindow {
  const ty = WINDOW_TYPE_RE.exec(block)?.[1];
  const f = WINDOW_FRAME_RE.exec(block);
  const [l, t, r, b] = f === null ? [] : f.slice(1, 5).map(Number);
  return {
    hash,
    type: ty === undefined ? undefined : /^\d+$/.test(ty) ? Number(ty) : APP_WINDOW_TYPES[ty] ?? 0,
    frame: f === null ? undefined : { x: l, y: t, width: r - l, height: b - t },
    visible: WINDOW_VISIBLE_RE.test(block),
  };
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
 *   say the same thing (state, and frame when visible) → unknown: one
 *   display prints one of each, so this is a dump not of the known shape.
 *   A second display's entry and witness are not read at all
 *   (onDefaultDisplay: display 0's block; A35's capture shows each display
 *   its own IME entry and `mIsImeShowing`) — before A35 they had to agree,
 *   so a keyboard shown beside a second display read `unknown`;
 * - `shown` = a visible IME entry with a frame, and `mIsImeShowing` not
 *   saying false (true, or absent);
 * - `hidden` = an IME entry with visible=false, and `mIsImeShowing` not
 *   saying true (false, or absent);
 * - NO IME entry: `hidden` only when `mIsImeShowing=false` says so (the API
 *   36 measurement). Otherwise unknown — a dump truncated before the entry,
 *   or an Android that renamed the type, must not silently switch the guard
 *   off or stop `dismissKeyboard` pressing back.
 */
export function parseImeInsets(whole: string): SoftKeyboard {
  const dump = onDefaultDisplay(whole);
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
 * entries that do not all say the same band (a dump not of the known shape:
 * one display prints one). Display 0's entry alone is read (onDefaultDisplay).
 */
export function parseStatusBand(whole: string): number | undefined {
  const dump = onDefaultDisplay(whole);
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
 * size; several entries that do not all say the same band. Display 0's
 * lines alone are read (onDefaultDisplay): before A35 a second display of
 * another size (A35's overlay, 720x1280) took the band away.
 */
export function parseNavigationBand(whole: string): number | undefined {
  const dump = onDefaultDisplay(whole);
  const frames = [...dump.matchAll(DISPLAY_FRAMES_RE)];
  if (new Set(frames.map(([line]) => line.trim())).size !== 1) return undefined; // none, or several that differ
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

/**
 * Each display's focus lines, in one shell line, under its header (`Display: mDisplayId=0 …`): `mCurrentFocus` (the
 * focused window, `Window{<hash> u0 <component>}`, or `null` in a transition) and `mFocusedApp` (the focused
 * activity: `ActivityRecord{<hash> u0 <component>} t<task>}` on API 33, `… u0 <component> t<task>}` on API 36; API 29
 * wraps it in its window token). `dumpsys window displays` prints one pair per display, on API 29 and later
 * (measured on 33; the API 36 fixture holds them too). When nothing prints, grep exits 1 and the call fails: no
 * chooser. Every word a constant. The chooser's read (android-chooser.ts#chooserInFocus), read by defaultDisplayFocus.
 */
export const CHOOSER_FOCUS_COMMAND = "dumpsys window displays | grep -E 'Display: mDisplayId=|mCurrentFocus=|mFocusedApp='";

// The component capture is written twice, here and in CURRENT_FOCUS_RE, on purpose: Stryker mutates only regex
// literals (code review, D55).
/**
 * The focused activity's component: an ActivityRecord anywhere on the `mFocusedApp` line — the line itself on API 30
 * and later, inside `AppWindowToken{… token=Token{… ActivityRecord{…}}}` on API 29 (AOSP 10's dump, not captured).
 * Only a space or `}` ends the component: `}` on API 33 (`…ResolverActivity} t2641}`: batch-9's and batch-10's every
 * read), the space before the task on API 36 (`…NexusLauncherActivity t2}`). A line cut right after the component,
 * at a newline or the end, names nothing. Why API 33's brace was missed until D55r: ADR 0041's D55r amendment.
 */
const FOCUSED_APP_RE = /mFocusedApp=[^\n]*?ActivityRecord\{[0-9a-f]+ u\d+ ([^\s/}]+\/[^\s}]+)[ }]/;

/** The default display's focus as CHOOSER_FOCUS_COMMAND prints it: the focused activity's and window's components. */
export interface DisplayFocus {
  /** `mFocusedApp`'s component, when its line names one. */
  app?: string;
  /** `mCurrentFocus`'s component: the first focus line's of the block that names one. */
  window?: string;
}

/**
 * The focused activity and window of the default display (onDefaultDisplay), so both are one display's pair: another
 * display's focus is not a link's started on display 0. android-chooser.ts#chooserInFocus decides which of the two
 * counts.
 */
export function defaultDisplayFocus(dump: string): DisplayFocus {
  const block = onDefaultDisplay(dump);
  const app = FOCUSED_APP_RE.exec(block)?.[1];
  const window = focusLines(block).find((line) => line.component !== undefined)?.component;
  return { ...(app !== undefined && { app }), ...(window !== undefined && { window }) };
}

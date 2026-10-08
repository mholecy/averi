import { everyNode, KEYBOARD_ROLE, rectArea, sameRect, type DeviceAdapter, type KeyboardOracle, type KeyboardTouchable, type KeyboardWitness, type Rect, type SoftKeyboard, type UiNode } from '../adapters/types.js';
import { rectText } from './geometry.js';

/**
 * What the TREE says about the soft keyboard (2026-10-07): the in-tree half
 * of the reading that `KeyboardOracle` (adapters/types.ts) gives for the
 * window model. On a platform whose keyboard is part of the accessibility
 * tree (iOS), the tree source marks the node whose rect is the covered band
 * with `KEYBOARD_ROLE` and the roots of the keyboard's own UI with
 * `ofKeyboard` (adapters/wda-source.ts#keyboardMarks has the rules and the
 * measurements), and this module is the one place that reads the marks —
 * the tap guard (interact/keyboard.ts) and the pixel poll (verify/
 * pixel-poll.ts) both ask `readSoftKeyboard` of the tree they already hold,
 * so neither pays a device read for the answer (a WDA `/source` is
 * 0.6–0.98 s, measured that day). Since stage B (the same day) it also
 * answers "which of the keyboard's own controls hides it" —
 * `accessoryDismissButton`, the app's input-accessory toolbar's trailing
 * button — for the in-tree model's configured dismissals (interact/
 * keyboard-in-tree.ts).
 * Like `read-tree.ts#pollTree`, this module takes the adapter and calls
 * its interface, never a platform command.
 */

/**
 * The band: a `SoftKeyboard`, the oracle's own type, so the callers feed it
 * to the same geometry (`keyboardOver`, `rectsOverlap`) as the Android
 * reading. Two of its three states can occur:
 * - `shown` with the band as `frame`: the first `KEYBOARD_ROLE` node in
 *   pre-order with a positive-area rect (a copy — nodes are mutated
 *   downstream and the frame is quoted in messages after the fact). A
 *   second such node (an iPad split or floating keyboard, not measured) is
 *   not read; recorded as a residual on keyboardMarks.
 * - `unknown` when there is none. Not `hidden`: an idb tree never carries
 *   the mark whatever the screen shows, a WDA tree without it has no
 *   keyboard on screen, and the tree cannot say which source produced it.
 *   Both callers fail open on `unknown` and on `hidden` alike, so the
 *   distinction costs nothing there. Since stage B (2026-10-07) the
 *   in-tree `dismissKeyboard` reads it too, and acts only on `shown`: on
 *   `unknown` it does nothing — an idb tree reads `unknown` whatever the
 *   screen shows, and a blind key there was measured to submit (K5d), so
 *   "cannot see a keyboard" means "press nothing", the opposite of the
 *   oracle's `unknown → back` row (interact/keyboard-window.ts#dismissal and
 *   keyboard-in-tree.ts's `dismiss` have the two reasons).
 */
export function keyboardInTree(tree: UiNode): SoftKeyboard {
  for (const n of everyNode(tree)) {
    if (n.role === KEYBOARD_ROLE && rectArea(n.rect) > 0) return { state: 'shown', frame: { ...n.rect } };
  }
  return { state: 'unknown' };
}

/**
 * Every node of the tree in pre-order with the two marks its ancestry gives
 * it: whether it lies under (or is) an `ofKeyboard` root — the keyboard's
 * own UI, keys and accessory toolbar alike — and whether it lies under (or
 * is) the `KEYBOARD_ROLE` band node. The one walk `partOfKeyboard` and
 * `accessoryDismissButton` share: until 2026-10-07 (review of the stage B
 * branch) each carried the flags through a recursion of its own.
 */
function* markedNodes(
  tree: UiNode,
  ofKeyboard = false,
  underBand = false,
): Generator<{ node: UiNode; ofKeyboard: boolean; underBand: boolean }> {
  const here = ofKeyboard || tree.ofKeyboard === true;
  const banded = underBand || tree.role === KEYBOARD_ROLE;
  yield { node: tree, ofKeyboard: here, underBand: banded };
  for (const child of tree.children) yield* markedNodes(child, here, banded);
}

/**
 * Is `node` the keyboard's own UI — a key, the AutoFill bar, the accessory
 * toolbar's Done (review 2026-10-07)? True when it, or an ancestor of it in
 * `tree`, carries `ofKeyboard`. By identity: the node must be one of the
 * tree's own objects (a resolution hands back the node of the tree it
 * resolved from). A node the tree does not hold is not part of its
 * keyboard. Such a node lies INSIDE the band and is never "under" it: a
 * tap on it is the thing the user does, not the thing the guard prevents.
 */

export function partOfKeyboard(tree: UiNode, node: UiNode): boolean {
  for (const marked of markedNodes(tree)) if (marked.node === node) return marked.ofKeyboard;
  return false;
}

/**
 * Every node of `tree` that is the keyboard's own UI — `partOfKeyboard`'s
 * answer for all of them at once, from one walk (2026-10-08: `scroll_until`
 * asks it of every match each round). Empty for a tree with no mark (every
 * Android tree).
 */
export function keyboardSideNodes(tree: UiNode): ReadonlySet<UiNode> {
  const out = new Set<UiNode>();
  for (const marked of markedNodes(tree)) if (marked.ofKeyboard) out.add(marked.node);
  return out;
}

/**
 * The input-accessory toolbar's trailing button — the app's own "Done" above
 * a number pad — when the keyboard's UI on screen has one (stage B,
 * 2026-10-07). Measured on the 2FA screen (docs/bugs/2026-10-05-ios-tap-
 * lands-on-soft-keyboard.md, K4 and the device check): a tap on that
 * Button {317,523,64,38} hid the pad without submitting, both by hand and
 * through the `tap` tool; it is the one GENERIC non-submitting dismissal
 * seen, the keyboard's own return key having submitted (K5d) and WDA's
 * keyboard/dismiss having failed (K5a).
 *
 * The rule, over the normalized tree: a node of role `toolbar` (the WDA
 * source's `Toolbar` type, adapters/wda-source.ts) that lies under an
 * `ofKeyboard` root — the input-host Window, where UIKit puts an
 * `inputAccessoryView` beside its `inputView` placeholder — with positive
 * area, and NOT under the `KEYBOARD_ROLE` band node: the band holds the
 * keys, the Passwords bar and the `done` RETURN key (a Button inside the
 * `Keyboard` element, y 752 in the login fixtures), none of which is an
 * accessory and one of which submits. In the 2FA fixture the Toolbar sits
 * in a different Window than the band, so the exclusion costs nothing
 * there and protects against a layout that nests one. Of the toolbar's
 * buttons the LAST in pre-order: a UIToolbar lays its items leading to
 * trailing, and the dismiss item is the trailing one by convention (the
 * measured toolbar has a flexible space then "Done"). The button must have
 * area too, or its centre is no tap point. Nothing in the login fixtures
 * (no Toolbar at all) and nothing in the parked 2FA fixture: its Toolbar
 * Window holds no `inputView` and is not marked `ofKeyboard` (the stage A
 * residual on keyboardMarks) — with no band on screen there is nothing to
 * dismiss there either, so the two residuals agree.
 */
export function accessoryDismissButton(tree: UiNode): UiNode | undefined {
  for (const { node, ofKeyboard, underBand } of markedNodes(tree)) {
    if (node.role !== 'toolbar' || !ofKeyboard || underBand || !(rectArea(node.rect) > 0)) continue;
    let last: UiNode | undefined;
    for (const d of everyNode(node)) if (d.role === 'button' && rectArea(d.rect) > 0) last = d;
    if (last !== undefined) return last;
  }
  return undefined;
}

/**
 * What the adapter has to hide a keyboard WITH — a capability, fixed per
 * adapter, not a decision: `back` on the oracle's window model (a `back`
 * hides it, witness-vetoed, interact/keyboard-window.ts), `none` on the in-tree
 * model, where no key does and the configured dismissals are tried instead.
 * The pixel poll words its remedy by it. What one call then DOES —
 * interact/keyboard-window.ts#dismissal's `'back' | 'nothing' | 'unlocated'` — is a different
 * question with its own literals, kept apart on purpose: with `back` in
 * hand the decision is still `nothing` when the state is hidden or the
 * witness denies the keyboard.
 */
export type DismissalMeans = 'back' | 'none';

/** What the adapter can do about a covering keyboard, for the sentence that says so (the pixel poll's miss, the guard's refusal). */
export interface KeyboardRemedy {
  dismissal: DismissalMeans;
  /** With `none`: the adapter's own sentence on why, and what works instead (`DeviceAdapter.keyboardAdvice`), when it has one. */
  advice?: string;
}

/**
 * The generic half of the in-tree model's sentence, written once for the
 * guard's refusal (interact/keyboard-in-tree.ts, KeyboardWithoutDismissal) and the
 * pixel poll's covered miss (verify/pixel-poll.ts) — here, the lowest layer
 * both import, as the review of 2026-10-07 asked, so "one phrase" holds by
 * construction and not by two matching literals. "On its own", because the
 * `advice` that follows it is what DOES work.
 */
export const CANNOT_HIDE = 'this adapter cannot hide it on its own';

/** `CANNOT_HIDE`, then the adapter's `advice` in parentheses when it has one — the one composition both sentences use. */
export function cannotHide(advice: string | undefined): string {
  return advice === undefined ? CANNOT_HIDE : `${CANNOT_HIDE} (${advice})`;
}

/**
 * Why `panelsBeyond` refused a region, or part of one — a closed set, one
 * case per rule it applies (code review of round 2, 2026-10-08: until then a
 * free string, so a test or a caller could only match its wording):
 * - `unreadable`: the input method answered (the call ran) and the region
 *   line was missing or could not be read whole;
 * - `witness-not-shown`: the region held rects beside the band, but the
 *   input method said `hidden` or `unknown` in the same call;
 * - `no-band-rect`: no rect of the region is the band, byte for byte;
 * - `rects-dropped`: `dropped` of its rects lie outside the screen the band
 *   spans or have no area (the rest are admitted).
 * Rendered in one place, `regionRefusalText`.
 */
export type RegionRefusal =
  | { kind: 'unreadable' }
  | { kind: 'witness-not-shown'; witness: Exclude<KeyboardWitness, 'shown'> }
  | { kind: 'no-band-rect' }
  | { kind: 'rects-dropped'; dropped: number };

/** The clause `oracleKeyboard`'s notice says for a refusal — the one rendering of `RegionRefusal`. */
export function regionRefusalText(refusal: RegionRefusal): string {
  switch (refusal.kind) {
    case 'unreadable':
      return 'the region could not be read';
    case 'witness-not-shown':
      return `the input method said ${refusal.witness} in the same call`;
    case 'no-band-rect':
      return 'no rect of it is the band';
    case 'rects-dropped':
      return `${refusal.dropped} of its rects lie outside the screen the band spans, or have no area`;
  }
}

/**
 * What `panelsBeyond` made of one region: the rects admitted beside the
 * band, and — when the region held something it did NOT admit, or could not
 * be read although the input method answered — why (`RegionRefusal`), for
 * the one-line notice `oracleKeyboard` writes (review 2026-10-08: a device
 * check must be able to tell "no panel" from "a panel refused, and for
 * which reason"). `refused` is absent for a region that is just the band
 * (docked) and for a call that failed whole (nothing was learned).
 */
export interface RegionVerdict {
  panels: readonly Rect[];
  refused?: RegionRefusal;
}

/**
 * Which rects of the keyboard window's touchable region count as covered
 * BESIDE the inset band (2026-10-08, the floating-Gboard device check:
 * docs/bugs/2026-10-05-android-floating-gboard-keyboard.md). Measured on
 * API 33 (emulator-5554, 1080x2220): a floating Gboard's band was its
 * 132-px collapse strip `[0,2088][1080,2220]` and its region
 * `SkRegion((359,1269,1040,1912)(0,2088,1080,2220))` — the panel is the
 * second rect; a docked one's region was exactly its band; a HIDDEN one's
 * region was not empty, and after a landscape keyboard it was stale, in
 * landscape coordinates, in portrait. So the region is never evidence on
 * its own, and the rules are:
 * - only beside a `shown` band — the caller (`oracleKeyboard`) asks the
 *   region only then;
 * - only when the input method, in the same call, says SHOWN — `hidden` and
 *   `unknown` alike admit nothing: this is a precondition for new evidence,
 *   not the veto over a band the window state already reported
 *   (interact/keyboard-window.ts#witnessDenies), so a witness that cannot be
 *   asked leaves the band alone, as before this date;
 * - only a region that holds the band itself, byte for byte — every shown
 *   region measured did; one that does not is not of this moment (the
 *   stale-rotation case) or not of a shape that was measured, and is
 *   ignored whole;
 * - of the rest, every rect with positive area that lies inside the screen
 *   the band spans — from 0,0 to the band's right and bottom edges, the
 *   current orientation by construction (a docked or collapsed band runs
 *   the screen's width to its bottom) — and is not the band.
 * Fail open everywhere, as the rest of the reader: an unreadable region
 * (`undefined`) is none. Docked: nothing beyond the band — behaviour
 * unchanged.
 *
 * THE BRITTLE PART (review 2026-10-08): the exact-band test. A floating
 * keyboard whose region strip is not equal to its inset frame — another
 * navigation mode, a strip that leaves out the nav bar, an IME whose
 * touchable insets differ from its content insets, a band that is not full
 * width (a side nav bar, landscape, a split keyboard), where Skia's region
 * would merge a panel sharing its rows into other rects — has its whole
 * region dropped, and the panel goes back to being invisible: the `d`-key
 * tap of the device check, no worse than before this date. None of these is
 * measured; each refusal is SAID once (`refused`, `oracleKeyboard`), so a
 * device check can tell them apart.
 */
export function panelsBeyond(band: Rect, touchable: KeyboardTouchable): RegionVerdict {
  const { witness, region } = touchable;
  if (region === undefined) {
    // Said only when the input method answered: then the call ran, and the region line was missing or unreadable.
    return witness === 'shown' ? { panels: [], refused: { kind: 'unreadable' } } : { panels: [] };
  }
  const beyond = region.filter((r) => !sameRect(r, band));
  if (beyond.length === 0) return { panels: [] }; // the band alone (docked), or an empty region
  if (witness !== 'shown') return { panels: [], refused: { kind: 'witness-not-shown', witness } };
  if (!region.some((r) => sameRect(r, band))) return { panels: [], refused: { kind: 'no-band-rect' } };
  const right = band.x + band.width;
  const bottom = band.y + band.height;
  const panels = beyond.filter((r) => rectArea(r) > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= right && r.y + r.height <= bottom);
  const dropped = beyond.length - panels.length;
  return dropped === 0 ? { panels } : { panels, refused: { kind: 'rects-dropped', dropped } };
}

/** The notices `oracleKeyboard` has written in this process — each distinct one once. */
const noticed = new Set<string>();

/**
 * The ORACLE's reading of the keyboard, whole (review 2026-10-08): `state()`,
 * and — when it reads shown — `touchable()` with `panelsBeyond` over it, so
 * the reading carries the floating panel as `panels`. THE one place an
 * oracle reading is composed: `readSoftKeyboard` (every look of the guard,
 * the pixel poll's round, `scroll_until`'s round) and the guard's re-check
 * loop after a witness veto (interact/keyboard-window.ts) both read through
 * here. Until the review that loop read `state()` alone: a point the first
 * look found under the PANEL read clear on the strip once the witness had
 * said hidden, and the tap went to Gboard's `d` key with a note about a
 * wait.
 *
 * Cost: one `state()` query; with the band up, one `touchable()` query more
 * (AndroidAdapter's keyboardState and keyboardTouchable have the figures).
 *
 * A region `panelsBeyond` refused is said ONCE per distinct case, as a
 * one-line `averi:` notice on stderr — the channel the adapters already use
 * for a non-fatal note (adapters/wda.ts, adapters/ios.ts); stdout is the MCP
 * protocol's. It reaches ONLY the server's stderr — not an MCP tool result,
 * not a flow trace — so a device check that wants to know why a panel was
 * not judged reads the server's log. Nothing else changes: the band alone,
 * as before 2026-10-08.
 */
export async function oracleKeyboard(oracle: KeyboardOracle): Promise<SoftKeyboard> {
  const keyboard = await oracle.state();
  if (keyboard.state !== 'shown') return keyboard;
  const touchable = await oracle.touchable();
  const { panels, refused } = panelsBeyond(keyboard.frame, touchable);
  if (refused !== undefined) {
    const region = touchable.region === undefined ? 'region' : `region ${touchable.region.map(rectText).join(' + ') || '(empty)'}`;
    const line =
      `averi: the soft keyboard window's touchable ${region} beside its band ${rectText(keyboard.frame)} — ` +
      `${regionRefusalText(refused)}, so ${panels.length === 0 ? 'no panel of it is' : 'only part of it is'} judged as covered ` +
      '(docs/bugs/2026-10-05-android-floating-gboard-keyboard.md)';
    if (!noticed.has(line)) {
      noticed.add(line);
      console.error(line);
    }
  }
  return panels.length === 0 ? keyboard : { ...keyboard, panels };
}

/**
 * Every rect a `shown` keyboard covers — the band, then its panels
 * (`panelsBeyond`) — the one list the readers test a point or a rect
 * against: the tap guard (interact/keyboard-model.ts#keyboardOver), the
 * pixel poll (verify/pixel-poll.ts) and `scroll_until`'s cover
 * (interact/scroll.ts#coverOf, through `highestCover`).
 */
export const keyboardRects = (keyboard: Extract<SoftKeyboard, { state: 'shown' }>): readonly Rect[] => [keyboard.frame, ...(keyboard.panels ?? [])];

/**
 * The first rect the keyboard covers (`keyboardRects`: the band, then its
 * panels) that `hits` — the one search behind the two readers that test a
 * keyboard against something of their own: the tap guard against a point
 * (interact/keyboard-model.ts#keyboardOver, `containsPoint`) and the pixel
 * poll against an element's rect (verify/pixel-poll.ts#keyboardOverElement,
 * `rectsOverlap`). Code review of round 2 (2026-10-08): both spelled the
 * search out, in two functions both named `keyboardOver`. Undefined when
 * no rect hits, or the keyboard is not `shown` — the caller words that.
 */
export function coveringRect(keyboard: SoftKeyboard, hits: (covered: Rect) => boolean): Rect | undefined {
  return keyboard.state === 'shown' ? keyboardRects(keyboard).find(hits) : undefined;
}

/**
 * The covered rect whose TOP edge is highest — the band, or a floating
 * panel above it — for a reader that keeps the screen above the keyboard
 * (`scroll_until`): above that edge, nothing of the keyboard lies. Ties keep
 * the band.
 */
export const highestCover = (keyboard: Extract<SoftKeyboard, { state: 'shown' }>): Rect =>
  keyboardRects(keyboard).reduce((top, r) => (r.y < top.y ? r : top));

/** One reading of the soft keyboard for one subject node, and what the adapter can do about a covering one. */
export interface SoftKeyboardReading extends KeyboardRemedy {
  /** The keyboard's state and frame; `unknown` when the subject is part of the keyboard's own UI, whatever is on screen. */
  keyboard: SoftKeyboard;
}

/**
 * THE one switch between the two models for READING the keyboard for a
 * SUBJECT — the guard's every look and the pixel poll's round (review
 * 2026-10-07): the adapter's oracle when it has one — one `state()` query,
 * the Android cost pinned on `AndroidAdapter.keyboardState` — else the tree
 * the caller already holds. Never both: an adapter with the oracle is not
 * read from the tree (the Android tree carries no marks, and two readings
 * of one keyboard would need a rule for their disagreement), and an adapter
 * without one asks no device. Before this helper the switch was written in
 * interact/keyboard.ts and verify/pixel-poll.ts separately. The ACTING
 * half — what to do about a covering keyboard — has its own one switch over
 * the same fact, `interact/keyboard.ts#keyboardModel`, in the layer that
 * acts; the two cannot be one, because the pixel poll (verify/) reads the
 * keyboard too and may not import interact/ (ARCHITECTURE.md §2). Every look
 * the guard takes reads through here, so the guard and the poll see one
 * keyboard by construction. The dismissal after a fill does not: it has no
 * subject, and each model's `dismiss` reads its own source — the oracle's
 * `state()`, `keyboardInTree` on the tree it read.
 *
 * `subject` is the node the caller is about to act on or measure: when it
 * is the keyboard's own UI (`partOfKeyboard`) the reading is `unknown` —
 * nothing covers a key but the finger — and the oracle is not asked either,
 * which on Android changes nothing (no tree there is ever marked). Absent
 * since 2026-10-08 for the one reader with no single subject:
 * `scroll_until` (interact/scroll.ts) judges every match against one
 * reading per round and exempts the keyboard's own nodes itself, with
 * `partOfKeyboard`, so one round still reads the oracle once (its cost
 * below).
 *
 * Since 2026-10-08 the oracle is read through `oracleKeyboard`: a `shown`
 * reading costs a SECOND query, `touchable()`, the keyboard window's region
 * beside the input method's word, read into `panels` (`panelsBeyond` — a
 * floating Gboard's panel, which the band does not cover); a hidden or
 * unknown one costs one, as before. Every reader tests the band and the
 * panels alike (`keyboardRects`). What a caller pays in all, on Android
 * (each adb call's figures are on AndroidAdapter's keyboardState,
 * keyboardTouchable and keyboardWitness):
 * - a tap, the keyboard hidden or unknown: 1; up but clear of the point: 2;
 *   covering it: 2, the witness, `back`, then the look after it — 1 more
 *   when the keyboard went, 2 when it still reads shown; a witness veto
 *   adds, per re-check round, 3 while it still reads shown (state,
 *   touchable, witness) or 1 once it does not;
 * - a pixel-poll round: 1, or 2 with the keyboard up (no witness);
 * - a `scroll_until` round: 1, or 2 with the keyboard up, or 3 when the band
 *   changes the round (its `keyboardCorroborated` witness), plus the
 *   `unlocated` row's witness on a failed or `fully: true` stop. A
 *   confirming read (scroll.ts#SETTLE_CONFIRM_READS, up to 3 after a
 *   stroke) is a round like any other and pays the same — with the
 *   keyboard up 2 or 3 queries each, not 1. Rounds: at most
 *   1 + (1 + SETTLE_CONFIRM_READS) × `maxSwipes` — 25 at the defaults,
 *   pinned in tests/interact/scroll.test.ts with a target that leaves the
 *   frame on every fourth read — and cut short by the deadline, which the
 *   confirming reads count against.
 *
 * FOLLOW-UP, not done (2026-10-08, review round 1, restated by the code
 * review of round 2): the touchable call's own `mInputShown`, read a moment
 * before, could serve `scroll_until`'s veto and save the third call of a
 * round — the reading would carry the witness beside `panels`, and
 * `witnessDenies` would stay the one decider over it. Not done because
 * TOUCHABLE_COMMAND is UNMEASURED as one command on a device
 * (adapters/android.ts#keyboardTouchable): the veto is the guard against a
 * stale band driving strokes through the next screen, and moving its input
 * onto an unmeasured command is a change to check on a device first, in a
 * round that allows one. The round loop it would thread through has landed
 * (Motion, scroll.ts), so that is no longer the reason.
 */
export async function readSoftKeyboard(
  adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>,
  tree: UiNode,
  subject?: UiNode,
): Promise<SoftKeyboardReading> {
  const dismissal = adapter.keyboard === undefined ? 'none' : 'back';
  const advice = dismissal === 'none' ? adapter.keyboardAdvice : undefined;
  if (subject !== undefined && partOfKeyboard(tree, subject)) return { keyboard: { state: 'unknown' }, dismissal, advice };
  const keyboard = adapter.keyboard === undefined ? keyboardInTree(tree) : await oracleKeyboard(adapter.keyboard);
  return { keyboard, dismissal, advice };
}

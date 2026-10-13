import { rectArea, sameRect, type DeviceAdapter, type KeyboardOracle, type KeyboardTouchable, type KeyboardWitness, type Point, type Rect, type SoftKeyboard, type UiNode } from '../adapters/types.js';
import type { DrawOrder } from './draw-order.js';
import { containsPoint, rectsOverlap, rectText } from './geometry.js';
import { keyboardInTree, keyboardSideNodes, type KeyboardRemedy } from './soft-keyboard.js';

/**
 * ONE reading of the soft keyboard: every reader of the keyboard — the tap guard's every look
 * and its re-check rounds (interact/keyboard.ts, keyboard-model.ts,
 * keyboard-window.ts), the in-tree model's picker and dismissal
 * (keyboard-in-tree.ts), the window model's post-fill dismissal, the pixel
 * poll's round (verify/pixel-poll.ts) and `scroll_until`'s round
 * (interact/scroll.ts) — asks its question of a `KeyboardReading` built by
 * `readKeyboard` off the tree it already holds, and none of them composes
 * oracle calls, tests rects or applies the veto itself. Here, in ui-tree/,
 * because the pixel poll (verify/) reads the keyboard too and may not
 * import interact/ (ARCHITECTURE.md §2); the ACTING half — what to do about
 * a covering keyboard — stays interact/keyboard.ts#keyboardModel's, the
 * one switch per layer.
 *
 * THE switch between the two models for READING: the adapter's oracle when it has one
 * (`DeviceAdapter.keyboard`, the window model — Android), else the tree the
 * caller holds (the band `KEYBOARD_ROLE` marks, `soft-keyboard.ts#
 * keyboardInTree` — the in-tree model, iOS under WDA; no device is asked).
 * Never both: an adapter with the oracle is not read from the tree (the
 * Android tree carries no marks, and two readings of one keyboard would need
 * a rule for their disagreement), and an adapter without one asks no device.
 * The tree is still read with an oracle for one thing — which nodes are the
 * keyboard's own UI (`ofKeyboard`), which on Android is none.
 *
 * EVERY KEYBOARD SOURCE, and who reads it:
 * - the Android window model (the oracle: the inset band, a floating
 *   Gboard's panels, the input method's word) — a reading;
 * - WDA's in-tree band (`KEYBOARD_ROLE`, `ofKeyboard` marks,
 *   soft-keyboard.ts#keyboardInTree) — a reading;
 * - idb's band, read by its shape (soft-keyboard.ts#flatListKeyboardBand,
 *   draw-order.ts#DrawOrder.keyboardBandTop) — a POSITION and nothing more,
 *   never a reading: an idb reading stays `unknown`, so the guard and the
 *   in-tree dismissal press nothing there (K5d).
 * State — shown, hidden, covering a point — is asked of a reading only.
 * Position — the line nothing may be aimed, stroked or measured under — is
 * `keyboardEdge`'s (below): a corroborated reading's line (`readingLine`)
 * and idb's band merged in one place, read by the tap
 * (interact/resolve.ts#refuseOffScreen for its first ask, #aimClearOfChrome
 * for the lazy one), `scroll_until`'s read (interact/scroll-read.ts
 * #judgeRead, its judgement and its strokes) and the pixel poll
 * (verify/pixel-poll.ts#overElement); which nodes are the
 * keyboard's own, under no line, is `keyboardSide`'s.
 *
 * WHAT A READING ASKS, AND WHEN — stated once, here. Three oracle calls, each at most
 * ONCE per reading, each memoised on first need, in this order:
 * 1. `state()` — the window state, the band. Asked by every question
 *    (`ofKeyboard` aside), first.
 * 2. `touchable()` — the keyboard window's region beside the input method's
 *    word, for a floating panel (the rules on `panelsBeyond` below). Asked
 *    only when `state()` read SHOWN and only by a question about geometry
 *    (`over`, `frameOver`, `overlapping`, `cover`) — never by `anywhere`,
 *    `corroborated` or `unlocated`, which need no area.
 * 3. `witness()` — the input method's word, the veto's input
 *    (`witnessDenies`). Asked only when `over` found the point covered, when
 *    `corroborated` is asked of a shown reading, or `unlocated` of a hidden
 *    one; never by `frameOver`, `overlapping` or `cover`.
 * The in-tree model asks nothing of any device on any question.
 *
 * What that costs a caller on Android, in adb calls (each one's figures are
 * on AndroidAdapter's keyboardState, keyboardTouchable and keyboardWitness):
 * - `anywhere`: 1; `+ corroborated` (shown) or `+ unlocated` (hidden): 2 —
 *   the post-fill dismissal;
 * - `cover`, `overlapping`, `frameOver`: 1, or 2 with the keyboard shown —
 *   the pixel poll's round, the guard's look after its side effect;
 * - `over`: 1 hidden or unknown, 2 shown but clear of the point, 3 covered
 *   or denied — the guard's first look, a re-check round;
 * - `scroll_until`'s round: `cover` (1 or 2), `+ corroborated` when the band
 *   changes the round (3), and on a failed or `fully: true` stop
 *   `+ unlocated` when the window read hidden (2).
 * What a whole operation costs, counted from these: a tap with the keyboard
 * hidden or unknown 1; up but clear of the point 2; covering it 3 (the
 * first look's `over`), `back`, then the look after it — 1 more when the
 * keyboard went, 2 when it still reads shown; a witness veto adds, per
 * re-check round (`over` on a fresh reading), 3 while the point stays
 * covered, 2 once the keyboard reads shown but elsewhere (state, touchable;
 * no witness), or 1 once it reads hidden or unknown, at most six rounds
 * (keyboard-window.ts#KEYBOARD_DISAGREEMENT_BUDGET_MS) — 18 at worst. A
 * `scroll_until` confirming read (scroll-rounds.ts#SETTLE_CONFIRM_READS, up
 * to 3 after a stroke) is a round like any other and pays the same; how
 * many rounds there are is scroll.ts's (its bound, 25 at the defaults, and
 * the deadline). The per-round counts are pinned at the driver, through a
 * fake oracle, in tests/interact/scroll.test.ts, and as asks in
 * scroll-rounds.test.ts.
 *
 * A reading is of ONE moment: build one per look, per round, per tree, and
 * never hold one across them — it remembers what the oracle answered, and a
 * witness kept past its round is a hazard (a stale window on one round can
 * be followed by a real keyboard; a confirmed one can be hidden by the
 * scroll itself). The rule is
 * this doc's, not the type's. Building one is synchronous and asks nothing;
 * no question throws: the oracle's calls never throw (`KeyboardOracle`'s
 * contract), so a failed call is `unknown` — fail open — and so is a reading
 * with neither an oracle nor a tree.
 */

/** Where a point stands against the keyboard on the FRAME alone — no witness asked. */
export type FrameVerdict =
  /** Nothing over the point: the keyboard hidden, or shown elsewhere. */
  | { kind: 'clear' }
  /** The state could not be read (or there is no band in the tree, or the subject is the keyboard's own UI): fail open, but say so — a note must not claim what was not seen. */
  | { kind: 'unknown' }
  /** A rect the keyboard covers holds the point: the band, or a floating panel beside it — the one a message quotes. */
  | { kind: 'covered'; frame: Rect };

/** A verdict that lets the caller act: nothing over the point, or a state that could not be read (fail open — the guard's one rule, stated in interact/keyboard.ts). */
export type Uncovered = Extract<FrameVerdict, { kind: 'clear' | 'unknown' }>;

/**
 * Where a point stands against the keyboard, the input method consulted when
 * the frame covers it (`over`):
 * - `covered`: covered, and the input method did not deny it — `confirmed`
 *   when it said shown, not when it could not be asked (only the wording
 *   differs: the window state alone then stands, as before the veto
 *   existed);
 * - `denied`: the window state covers the point but the input method says
 *   no keyboard is shown — stale, measured for seconds after a navigating
 *   tap; act on neither guess (the window guard's re-check starts here).
 *   Decided by `witnessDenies` and nowhere else.
 */
export type KeyboardVerdict = Uncovered | { kind: 'covered'; frame: Rect; confirmed: boolean } | { kind: 'denied'; frame: Rect };

/** A verdict with a frame over the point — what reaches a keyboard model's guard. */
export type Covering = Extract<KeyboardVerdict, { frame: Rect }>;

/** Everything a SHOWN keyboard covers, for a reader with many subjects (`scroll_until`). */
export interface KeyboardCover {
  /** Every covered rect: the band first, then its panels. */
  rects: readonly Rect[];
  /** The covered rect whose TOP edge is highest — the band, or a floating panel above it; ties keep the band. Above that edge nothing of the keyboard lies. */
  top: Rect;
  /** The inset band (`SoftKeyboard.frame`). */
  band: Rect;
  remedy: KeyboardRemedy;
}

/**
 * The `unlocated` row's sentence (`KeyboardReading.unlocated`) — the one
 * wording, for the window model's post-fill dismissal warning
 * (interact/keyboard-window.ts) and for `scroll_until`'s report
 * (interact/scroll-text.ts), which asks the same question at its stop.
 * Here, beside the question: the reading owns the row.
 * The cause is said as a question, not "a floating keyboard?": measured on
 * API 33, a floating Gboard does NOT read this way (a 132-px band plus its panel, read as `panels` —
 * `panelsBeyond` below), and the one window-hidden read seen beside an IME
 * on screen was the panel still coming up, right after the focus tap
 * (whether `mInputShown` was already true then was not captured).
 */
export const UNLOCATED_KEYBOARD =
  'the input method reports a soft keyboard shown, but the window state gives it no area on screen ' +
  '(one still coming up? not measured), so where it lies is unknown';

/** One reading of the soft keyboard off one tree — the questions every reader asks (the module doc has what each one costs). */
export interface KeyboardReading {
  /**
   * THE default question: is `point` covered, and may the caller act? The
   * frame first (`frameOver`); when it covers the point, the input method's
   * word — the veto (`witnessDenies`) — turns it into `covered` or `denied`.
   * `subject` is the node about to be acted on: when it is the keyboard's
   * own UI the verdict is `unknown` and nothing is asked — nothing covers a
   * key but the finger. The in-tree model's `covered` is `confirmed`: its
   * band is read off the very tree being judged.
   */
  over(point: Point, subject?: UiNode): Promise<KeyboardVerdict>;
  /**
   * `over` without the input method: the frame decides. For a look taken
   * AFTER the one side effect (the window model's `back` is already
   * pressed; the in-tree model has no witness) and the in-tree picker.
   */
  frameOver(point: Point, subject?: UiNode): Promise<FrameVerdict>;
  /**
   * The covered rect that overlaps `rect` by positive area (`rectsOverlap`:
   * an edge-touching one does not), else undefined — for a reader that
   * MEASURES, never acts, and must fail closed on the window alone (the
   * pixel poll). Never asks the witness: it exists to veto a key, and
   * nothing is pressed here.
   */
  overlapping(rect: Rect, subject?: UiNode): Promise<Rect | undefined>;
  /** Everything a `shown` keyboard covers; undefined when hidden or unknown. No witness. */
  cover(): Promise<KeyboardCover | undefined>;
  /**
   * Does the input method stand by a `shown` reading — not deny it
   * (`witnessDenies`)? False for a reading that is not shown, asking
   * nothing; true without a query on the in-tree model, whose band is read
   * off the tree being judged. For a caller that lets a band change what it
   * reports or does without having a point (`scroll_until`'s round, the
   * post-fill dismissal).
   */
  corroborated(): Promise<boolean>;
  /**
   * The `unlocated` row: the window state reads HIDDEN while
   * the input method says a keyboard IS shown — one it gives no area
   * (`UNLOCATED_KEYBOARD` above has the sentence and what was measured).
   * Asks the witness only for a hidden reading — a `shown` one has its frame
   * and an `unknown` one has nothing to contradict; false without a query
   * on the in-tree model, which has no second source.
   */
  unlocated(): Promise<boolean>;
  /** Shown anywhere, hidden, or unknown — the state only, no region: for the one reader with no point (the post-fill dismissal). */
  anywhere(): Promise<SoftKeyboard['state']>;
  /**
   * Is `node` the keyboard's own UI — a key, the AutoFill bar, the
   * accessory toolbar's Done (soft-keyboard.ts#keyboardSideNodes' rule)? By
   * identity, against the tree this reading was built off: one walk, built
   * on the first call and kept for the reading (`scroll_until` asks it of
   * every match each round). Always false on an Android tree,
   * which carries no mark, and with no tree.
   */
  ofKeyboard(node: UiNode): boolean;
  /** What the adapter can do about a covering keyboard (`back` with the oracle; `none`, with its advice, without), for the sentences that say so. */
  readonly remedy: KeyboardRemedy;
}

/**
 * THE veto, named so its readers share one owner: an input method that says no keyboard is shown
 * DENIES a window state that reports one — that state was measured stale
 * for seconds after a navigating tap (AndroidAdapter's keyboardWitness has
 * the measurement). `unknown` denies nothing: a witness that cannot be asked
 * leaves the window state standing. Read by `over` (the guard's first look
 * and its re-check rounds) and `corroborated` (the post-fill dismissal's
 * `covering` row, `scroll_until` before a band may change its judgement or
 * its stroke) — no reader applies it itself.
 */
const witnessDenies = (witness: KeyboardWitness): boolean => witness === 'hidden';

/**
 * Why `panelsBeyond` refused a region, or part of one — a closed set, one
 * case per rule it applies (not a free string, so a test or a caller need
 * not match its wording):
 * - `unreadable`: the input method answered (the call ran) and the region
 *   line was missing or could not be read whole;
 * - `witness-not-shown`: the region held rects beside the band, but the
 *   input method said `hidden` or `unknown` in the same call;
 * - `no-band-rect`: no rect of the region is the band, byte for byte;
 * - `rects-dropped`: `dropped` of its rects lie outside the screen the band
 *   spans or have no area (the rest are admitted).
 * Rendered in one place, `refusalText`.
 */
type RegionRefusal =
  | { kind: 'unreadable' }
  | { kind: 'witness-not-shown'; witness: Exclude<KeyboardWitness, 'shown'> }
  | { kind: 'no-band-rect' }
  | { kind: 'rects-dropped'; dropped: number };

/** The clause the refusal notice says for a refusal — the one rendering of `RegionRefusal`. */
function refusalText(refusal: RegionRefusal): string {
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
 * Which rects of the keyboard window's touchable region count as covered
 * BESIDE the inset band (the floating-Gboard device check, the bug note
 * below), and — when the region held something it did NOT admit, or could
 * not be read although the input method answered — why (`refused`, for the
 * one-line notice `withPanels` writes: a device check must be able to tell
 * "no panel" from "a panel refused, and for which reason"). `refused`
 * is absent for a region that is just the band (docked) and for a call that
 * failed whole (nothing was learned). Measured on API 33 (emulator-5554,
 * 1080x2220): a floating Gboard's band was its 132-px collapse strip
 * `[0,2088][1080,2220]` and its region
 * `SkRegion((359,1269,1040,1912)(0,2088,1080,2220))` — the panel is the
 * second rect; a docked one's region was exactly its band; a HIDDEN one's
 * region was not empty, and after a landscape keyboard it was stale, in
 * landscape coordinates, in portrait. So the region is never evidence on
 * its own, and the rules are:
 * - only beside a `shown` band — the reading asks the region only then;
 * - only when the input method, in the same call, says SHOWN (its
 *   `mInputShown`) — `hidden` and `unknown` alike admit nothing: this is a
 *   precondition for new evidence, not the veto over a band the window
 *   state already reported (`witnessDenies`), so a witness that cannot be
 *   asked leaves the band alone;
 * - only a region that holds the band itself, byte for byte — every shown
 *   region measured did; one that does not is not of this moment (the
 *   stale-rotation case) or not of a shape that was measured, and is
 *   ignored whole;
 * - of the rest, every rect with positive area that lies inside the screen
 *   the band spans — from 0,0 to the band's right and bottom edges, the
 *   current orientation by construction (a docked or collapsed band runs
 *   the screen's width to its bottom) — and is not the band.
 * Fail open everywhere, as the rest of the reader: an unreadable region
 * (`undefined`) is none. Docked: nothing beyond the band.
 * docs/bugs/2026-10-05-android-floating-gboard-keyboard.md
 *
 * THE BRITTLE PART: the exact-band test. A floating
 * keyboard whose region strip is not equal to its inset frame — another
 * navigation mode, a strip that leaves out the nav bar, an IME whose
 * touchable insets differ from its content insets, a band that is not full
 * width (a side nav bar, landscape, a split keyboard), where Skia's region
 * would merge a panel sharing its rows into other rects — has its whole
 * region dropped, and the panel goes back to being invisible: the `d`-key
 * tap of the device check, no worse than with no panel read. None of these is
 * measured; each refusal is SAID once (`refused`), so a device check can
 * tell them apart.
 */
function panelsBeyond(band: Rect, touchable: KeyboardTouchable): { panels: readonly Rect[]; refused?: RegionRefusal } {
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

/**
 * The notices `withPanels` has written, per oracle — each distinct one once
 * for each. Per oracle, not per process: the registry keeps one
 * adapter, so one oracle, for a whole server session, so in production this
 * is still "once per process"; a test that builds its own oracle starts with
 * nothing said, and does not depend on which test ran first. Weak, so an oracle that is gone takes its notices with
 * it.
 */
const noticed = new WeakMap<KeyboardOracle, Set<string>>();

/**
 * A shown oracle reading made whole: `touchable()`, and
 * `panelsBeyond` over it, so the reading carries the floating panel as
 * `panels`. With `state()` alone, a point the first look found under the
 * PANEL read clear on the strip once the witness had said hidden, and the
 * tap went to Gboard's `d` key with a note about a wait (measured).
 *
 * A region `panelsBeyond` refused is said ONCE per distinct case and oracle, as a
 * one-line `averi:` notice on stderr — the channel the adapters already use
 * for a non-fatal note (adapters/wda.ts, adapters/ios.ts); stdout is the MCP
 * protocol's. It reaches ONLY the server's stderr — not an MCP tool result,
 * not a flow trace — so a device check that wants to know why a panel was
 * not judged reads the server's log. Nothing else changes: the band alone.
 *
 * FOLLOW-UP, not done: `touchable` carries
 * the input method's own `mInputShown`, read a moment after `state()`. It
 * could seed the reading's witness memo (`readKeyboard`'s `witness`), so
 * that `corroborated` — `scroll_until`'s veto — and `over` on a covered
 * point save their third call; `witnessDenies` would stay the one decider
 * over it, and no caller would change. Not done because TOUCHABLE_COMMAND is
 * UNMEASURED as one command on a device (adapters/android.ts#keyboardTouchable):
 * the veto is the guard against a stale band driving
 * strokes through the next screen and taps through the next screen's keys,
 * and moving its input onto an unmeasured command is a change to check on a
 * device first. The seam for it is here: return the witness beside the
 * keyboard and let `readKeyboard` memoise it.
 */
async function withPanels(oracle: KeyboardOracle, keyboard: Extract<SoftKeyboard, { state: 'shown' }>): Promise<SoftKeyboard> {
  const touchable = await oracle.touchable();
  const { panels, refused } = panelsBeyond(keyboard.frame, touchable);
  if (refused !== undefined) {
    const region = touchable.region === undefined ? 'region' : `region ${touchable.region.map(rectText).join(' + ') || '(empty)'}`;
    const line =
      `averi: the soft keyboard window's touchable ${region} beside its band ${rectText(keyboard.frame)} — ` +
      `${refusalText(refused)}, so ${panels.length === 0 ? 'no panel of it is' : 'only part of it is'} judged as covered ` +
      '(docs/bugs/2026-10-05-android-floating-gboard-keyboard.md)';
    const said = noticed.get(oracle) ?? new Set<string>();
    noticed.set(oracle, said);
    if (!said.has(line)) {
      said.add(line);
      console.error(line);
    }
  }
  return panels.length === 0 ? keyboard : { ...keyboard, panels };
}

/** Every rect a `shown` keyboard covers: the band, then its panels — the one list every geometric question tests. */
const keyboardRects = (keyboard: Extract<SoftKeyboard, { state: 'shown' }>): readonly Rect[] => [keyboard.frame, ...(keyboard.panels ?? [])];

/** Memoise one async call: asked on the first need, never again for this reading. */
function once<T>(ask: () => Promise<T>): () => Promise<T> {
  let asked: Promise<T> | undefined;
  return () => (asked ??= ask());
}

/**
 * A reading of the soft keyboard off `tree` — the tree the caller already
 * holds (a resolution's, a round's). Optional for the two readers on the
 * window model that hold none and judge no subject: the guard's re-check
 * round (keyboard-window.ts) and the post-fill dismissal; without the oracle
 * and without a tree, every question reads `unknown` and nothing is asked.
 * Synchronous, asks nothing until a question is put (the module doc).
 */
export function readKeyboard(adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>, tree?: UiNode): KeyboardReading {
  const oracle = adapter.keyboard;
  const remedy: KeyboardRemedy = oracle === undefined ? { dismissal: 'none', advice: adapter.keyboardAdvice } : { dismissal: 'back', advice: undefined };
  const inTree: SoftKeyboard = { state: 'unknown' };
  // The three oracle calls, each once (the module doc's order); on the
  // in-tree model the band, read off the tree on first need.
  const state = once(async (): Promise<SoftKeyboard> => (oracle === undefined ? (tree === undefined ? inTree : keyboardInTree(tree)) : oracle.state()));
  const whole = once(async (): Promise<SoftKeyboard> => {
    const keyboard = await state();
    return oracle === undefined || keyboard.state !== 'shown' ? keyboard : withPanels(oracle, keyboard);
  });
  const witness = once(async (): Promise<KeyboardWitness> => (oracle === undefined ? 'unknown' : oracle.witness()));
  let sideNodes: ReadonlySet<UiNode> | undefined;
  const ofKeyboard = (node: UiNode): boolean => tree !== undefined && (sideNodes ??= keyboardSideNodes(tree)).has(node);

  /** The first covered rect that `hits`, for a subject that is not the keyboard's own UI; `unknown` when the state could not be read. */
  const covering = async (hits: (covered: Rect) => boolean, subject: UiNode | undefined): Promise<Rect | 'clear' | 'unknown'> => {
    if (subject !== undefined && ofKeyboard(subject)) return 'unknown';
    const keyboard = await whole();
    if (keyboard.state === 'unknown') return 'unknown';
    return (keyboard.state === 'shown' ? keyboardRects(keyboard).find(hits) : undefined) ?? 'clear';
  };

  const frameOver = async (point: Point, subject?: UiNode): Promise<FrameVerdict> => {
    const hit = await covering((r) => containsPoint(r, point), subject);
    return typeof hit === 'string' ? { kind: hit } : { kind: 'covered', frame: hit };
  };

  return {
    frameOver,
    async over(point, subject) {
      const seen = await frameOver(point, subject);
      if (seen.kind !== 'covered') return seen;
      if (oracle === undefined) return { ...seen, confirmed: true };
      const said = await witness();
      return witnessDenies(said) ? { kind: 'denied', frame: seen.frame } : { ...seen, confirmed: said === 'shown' };
    },
    async overlapping(rect, subject) {
      const hit = await covering((r) => rectsOverlap(rect, r), subject);
      return typeof hit === 'string' ? undefined : hit;
    },
    async cover() {
      const keyboard = await whole();
      if (keyboard.state !== 'shown') return undefined;
      const rects = keyboardRects(keyboard);
      return { rects, top: rects.reduce((top, r) => (r.y < top.y ? r : top)), band: keyboard.frame, remedy };
    },
    async corroborated() {
      if ((await state()).state !== 'shown') return false;
      return oracle === undefined || !witnessDenies(await witness());
    },
    async unlocated() {
      if (oracle === undefined || (await state()).state !== 'hidden') return false;
      return (await witness()) === 'shown';
    },
    async anywhere() {
      return (await state()).state;
    },
    ofKeyboard,
    remedy,
  };
}

// ─── The keyboard edge ───────────────────────────────────────────────────────

/**
 * A soft keyboard's top edge as a LINE nothing may be aimed or stroked
 * under, with where it came from:
 * - `window` — the Android window model's cover (the inset band, or a
 *   floating panel above it), the input method standing by it;
 * - `wda` — the band WDA marks in the tree (`KEYBOARD_ROLE`), read off the
 *   very tree being judged;
 * - `idb-band` — idb's band, read by its shape (draw-order.ts
 *   #DrawOrder.keyboardBandTop), a position and nothing more: no reading
 *   says the keyboard is shown (`keyboardInTree` stays `unknown`, K5d).
 * `witnessed`: a reading stands by it, so the tap's guard acts on a point
 * under it (interact/keyboard.ts) — true for `window` and `wda`, false for
 * `idb-band`, which no guard acts on: a centre under it is the judgement's
 * to refuse (ui-tree/standing.ts#Scene).
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */
export type KeyboardLine =
  | { readonly y: number; readonly source: 'window' | 'wda'; readonly witnessed: true }
  | { readonly y: number; readonly source: 'idb-band'; readonly witnessed: false };

/**
 * The line a shown cover stands for, once its witness has stood by it: the
 * top of everything it covers (`KeyboardCover.top`, a floating panel above
 * the band included), `window` on the oracle's model and `wda` on the
 * in-tree one — its remedy says which, the one mapping from a remedy to a
 * line's source. Synchronous and asks nothing: whether the witness stands
 * by the cover is the caller's question, put before this one —
 * `readingLine` asks it of the reading, `scroll_until`'s round through its
 * protocol (interact/scroll-read.ts#coverOf).
 */
export function coverLine(cover: KeyboardCover): KeyboardLine {
  return { y: cover.top.y, source: cover.remedy.dismissal === 'back' ? 'window' : 'wda', witnessed: true };
}

/**
 * The line a reading stands by: its cover's line (`coverLine`) when the
 * reading is `corroborated` — else none. Costs what `cover` and
 * `corroborated` cost (the module doc); asked by the tap only when its
 * centre is covered (interact/resolve.ts#aimClearOfChrome). `scroll_until`
 * asks the same two through its round's protocol instead
 * (interact/scroll-read.ts#Cover).
 */
export async function readingLine(reading: KeyboardReading): Promise<KeyboardLine | undefined> {
  const cover = await reading.cover();
  if (cover === undefined || !(await reading.corroborated())) return undefined;
  return coverLine(cover);
}

/** The higher of two lines (the smaller y), either of which may be absent; a tie keeps `a`. */
const higher = (a: KeyboardLine | undefined, b: KeyboardLine | undefined): KeyboardLine | undefined => (a === undefined ? b : b === undefined || a.y <= b.y ? a : b);

/**
 * THE keyboard edge — the one merge of every keyboard source into the line
 * the tap, `scroll_until` and the pixel assert judge and stroke against: a
 * reading's line (`readingLine`, or the cover `scroll_until`'s round
 * applied) and idb's band line (`order.keyboardBandTop`, its one reader),
 * the higher of the two. Never both today — idb's reading is always
 * `unknown`, and only idb's flat list has a band — kept for a source that
 * one day gives both. `subject`, when given: a node of idb's band itself
 * (`order.ofKeyboardBand` — a key, the band's background) is under no band
 * line, as a node of WDA's keyboard (`KeyboardReading.ofKeyboard`) is under
 * no reading's: a tap on a key is the thing the user does.
 */
export function keyboardEdge(reading: KeyboardLine | undefined, order: Pick<DrawOrder, 'keyboardBandTop' | 'ofKeyboardBand'>, subject?: UiNode): KeyboardLine | undefined {
  const top = order.keyboardBandTop;
  const band: KeyboardLine | undefined = top === undefined || (subject !== undefined && order.ofKeyboardBand(subject)) ? undefined : { y: top, source: 'idb-band', witnessed: false };
  return higher(reading, band);
}

/**
 * Which nodes are the keyboard's OWN UI, under no keyboard line: the
 * reading's (`KeyboardReading.ofKeyboard`, WDA's marks) and idb's band's
 * (draw-order.ts#DrawOrder.ofKeyboardBand: its background, the keys that
 * share a row, what is listed after the background) — for a reader judging
 * many nodes under one line (`scroll_until`'s round).
 */
export function keyboardSide(ofKeyboard: (node: UiNode) => boolean, order: Pick<DrawOrder, 'ofKeyboardBand'>): (node: UiNode) => boolean {
  return (node) => ofKeyboard(node) || order.ofKeyboardBand(node);
}

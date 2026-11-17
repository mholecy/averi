import {
  type DeviceAdapter,
  type DeviceScreen,
  type Rect,
  type UiNode,
} from '../adapters/types.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { readTreeOrMiss, type TreeRead } from '../ui-tree/read-tree.js';
import { inferScreenSize, type ScreenSize } from '../ui-tree/geometry.js';
import type { RawImage, RgbaImage } from './png.js';
import { captureShot, type Shot } from './shot.js';
import { pngScale, windowWidth, type PngScale, type WindowWidth } from './scale.js';

/**
 * One settled frame, one scale, one crop — the module every pixel reading in
 * this package goes through.
 *
 * Spread over its consumers, "capture something trustworthy to measure"
 * drifts apart: a stability wait re-declared with its own constants, a BARE
 * screenshot feeding the color and text parity tables — the one frame the
 * color assert's own doc says must never be the verdict, a mid-animation
 * one — a png scale derived per call site with a failure policy each, and a
 * rect→png crop written once with an inset and once without.
 *
 * This module is the one owner of three facts about a capture:
 * - the png is STABLE: two identical consecutive captures, bounded attempts;
 * - the scale (tree points → png pixels) is computed ONCE per frame, from
 *   the device screen when it will say and the tree when it will not, and
 *   carried as a value — success or a single, quotable failure — so every
 *   consumer reads the same number and the same sentence (verify/scale.ts
 *   owns the derivation and its wording; this module owns that it runs once);
 * - a rect lands in the png the same way everywhere (`pngRegion`), with the
 *   clipped fraction computed beside it; the inset is the caller's option,
 *   applied after the clip (`clipThenInset`, which the pixel assert's judge
 *   reads the colour sample's region with too).
 *
 * What stays with the consumers is their FALLBACK POLICY: the color table
 * fails closed on a bad scale, the text table drops to tree evidence with a
 * note, the asserts fail the one assert. Those are different answers to the
 * same fact, and the fact is produced here.
 *
 * Deliberately NOT here: the polling asserts' tree read (the tree poll owns
 * the miss-not-failure rule; the pixel poll, verify/pixel-poll.ts, hands
 * that round's tree in), and rect parity, which scales from the tree on
 * purpose (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md —
 * its denominator is the app's canvas, not the device screen). What IS here
 * is that denominator's trust: each tree-bearing frame carries `window`
 * (verify/scale.ts#windowWidth — still the tree's window, the device screen
 * only witnessing it), derived once beside the scale and before the png is
 * decoded, so the rect table reads it from the frame instead of measuring
 * the tree itself.
 *
 * "Every pixel reading" includes the screenshot baseline assert, which takes
 * the png-only arm of `captureFrame`: on a bare `adapter.screenshot()` the
 * frame it diffs and the baseline it writes could both be mid-animation.
 * The pure tail (tree + png + screen → measured frame) is exported as
 * `measuredFrameFor`, and the comparator tests build their fixtures with it
 * rather than re-deriving the scale themselves; it runs the same
 * `scaleFor` / `windowFor` pair over one tree walk that `captureFrame` runs,
 * which adds only the one fresh screen re-read (`ScreenWitness`) — that
 * needs an adapter.
 *
 * The budget has ONE owner and the frame SAYS whether it settled:
 * - The stability delay is this module's constant and nothing else's. A
 *   delay option "so tests stay fast" would let a caller forward its poll
 *   interval as the delay, and the color, ocr and baseline asserts inside a
 *   FLOW (FlowEngine's pollMs defaults to 500) would wait 500 ms between
 *   captures while the same asserts from the MCP `assert` tool wait 300. The
 *   tests that need speed mock util/sleep.
 * - `Frame.stability` reports what the wait concluded (settled / moving /
 *   unjudged) and `Frame.captures` how many were taken. Without them a screen
 *   that never settles (spinner, caret, live content) would yield its LAST
 *   frame as if it were settled, and the consumers could not tell: the color
 *   and ocr asserts would call its measurement a verdict, the baseline assert
 *   would store it as the ground truth for every later run. The polling
 *   asserts treat an unsettled frame as a miss (the deadline, not a moving
 *   frame, decides), and the baseline assert refuses to create or diff
 *   against one. The `verify` legs and the `screenshot` / `ensure_state`
 *   tools return the best frame — a tool hands the picture to the agent,
 *   whose own eyes judge it — and read `settled` only if they choose to say
 *   so.
 * - `CaptureOptions.deadline` lets a caller with a budget of its own bound
 *   the wait: a re-capture that would end after the deadline is not taken,
 *   and the frame comes back `moving` (or `unjudged`, with one capture). The
 *   pixel poll passes its deadline in (verify/pixel-poll.ts); the figures are
 *   kept ONCE, on `Verifier.treePoll` in assert.ts.
 *
 * Stability can be judged over the ELEMENT'S REGION. Judged on the whole
 * screenshot only, a clock in the status bar or a blinking caret elsewhere
 * on the screen would keep a frame "moving" while the element a color or
 * ocr assert measures holds perfectly still, and the assert would fail "the
 * screen did not settle" about pixels it never reads. `CaptureOptions.region`
 * (a rect in tree points, accepted only beside a SUPPLIED tree — the pixel
 * poll passes the first match's) adds a second question to the wait when two
 * captures differ: decode both, scale the rect the way the measured frame
 * will (`measuredFrameFor`), land it with `pngRegion` (no inset — the compare
 * must see every pixel the ocr crop will), and call the pair settled when
 * the bytes inside match, handing back the LATER capture. Anything that
 * makes that question unanswerable — a decode that throws, two pngs of
 * different sizes, a scale that carries an error, a rect that lands nowhere
 * on the png — falls back to the whole-screen answer, which has already
 * said "different": the pair is not settled. Never the other way: a frame
 * the region check cannot check is never called settled. Two identical
 * buffers stay the fast path (no decode, no device read), and the budget is
 * untouched. Deliberately whole-screen still: the baseline assert (a
 * baseline is a picture of the screen, and a region nobody named must not
 * decide what is stored or diffed), the `verify` legs (their parity tables
 * measure many anchors from one frame) and the `screenshot`/`ensure_state`
 * tools (a picture handed to the agent is judged as a picture) — none of
 * them can pass a region, by the types.
 *
 * Region stability alone WIDENS the supplied tree's staleness window
 * (`captureFrame`'s doc: the tree predates the wait by one round's read),
 * it does not narrow it: the crop sits at the rect that read reported, so
 * an element sliding in or pushed aside — its old area showing a static
 * background — leaves a region pair that matches while the element is
 * elsewhere, a frame whole-screen stability would have called moving (a
 * white button sliding onto a white card would sample white and pass). So
 * the frame SAYS how it settled — `settledOver: 'screen' | 'region'`,
 * decided here, once — and the pixel poll measures a region-only frame
 * only when two consecutive tree reads put the element at the same rect
 * (verify/pixel-poll.ts). The cost is one extra round, about one tree read
 * (~1.5 s for an Android dump), paid only when the whole screen is NOT
 * still. Two agreeing reads confirm the TREE, not the pixels, and two
 * false-pass windows remain, recorded here:
 * - the tree reports where the element WILL be: iOS AX frames come from the
 *   model layer, so both reads give a UIKit animation's final rect, and
 *   Android keeps alpha-0 and not-yet-drawn views in the tree. A staggered
 *   or delayed entrance, or an alpha-0 fade-in, at its final rect while
 *   other content animates (so the whole screen is moving) leaves that rect
 *   showing static background for two rounds — and passes when the expected
 *   colour or text equals the background;
 * - the element moves after the confirming SNAPSHOT, which is earlier than
 *   the read's return: a uiautomator dump snapshots partway through a
 *   ~1.5 s read, and the captures start only after it returns.
 * Neither is closed by anything in this package; the device checks are in
 * docs/plans/2026-10-05-device-verification-handoff.md.
 *
 * A known blind spot of "two identical captures", measured 2026-10-06 and
 * closed for BASELINE CREATION only (`captureBaselineFrame`): the pair is
 * STABILITY_DELAY_MS plus one capture time apart, ≈0.95 s on the Android
 * emulator and ≈0.8 s on the iOS simulator when measured, so a ≈1 s caret
 * blink usually lands in phase and the pair compares equal. The lab
 * emulator's capture measures faster (averi_lab API 33, 2026-10-31):
 * `adb exec-out screencap` 312–352 ms per call in D3's live baseline,
 * 347–365 ms in D13's (docs/plans/2026-10-30-performance-backlog.md, D13),
 * a pair ≈0.61–0.67 s apart; the blind spot is the pair's whatever its
 * spacing, and the baseline's window below was chosen over a grid of
 * capture times that spans both. Every other consumer keeps the pair as its
 * rule — a tool's `⚠ frame:` note therefore stays silent on a caret screen
 * on those devices (its absence does not prove a still screen), and a
 * polling assert still judges per round, its region and deadline unchanged.
 * A baseline is the one frame stored and read for every later run, so it
 * alone pays the confirmation window
 * (docs/bugs/2026-10-06-whole-screen-stability-aliases-a-blinking-caret.md).
 */

/**
 * The stability budget: up to 5 re-captures 300 ms apart, i.e. a frame that
 * does not settle costs 6 captures and 1.5 s before the LAST one is returned
 * as the best available — marked `stability: moving`. The same budget for every
 * consumer — a `verify` leg, the `screenshot` tool, an assert inside a flow —
 * which a caller's `CaptureOptions.deadline` may cut short (the pixel poll's
 * does); the header says why the delay is not a caller's option.
 *
 * What that costs a leg over one bare screenshot: a floor of
 * one 300 ms sleep and one extra capture when the screen is already still,
 * up to 1.5 s and five extra captures when it is not. And 2 to 6
 * `screenshot()` calls per leg instead of 1 is that many more chances for
 * a transient screencap failure to reject the leg — the one failure this
 * module cannot carry as a value, because without bytes there is no frame.
 * The png is decoded whenever a tree is in play, even for a contract with
 * only rect anchors, which never read a pixel; that decode is paid once and
 * is cheap next to the wait, so it is not gated.
 *
 * Not options: a smaller budget "for tests" is how a 300-vs-500 split
 * creeps in. Tests mock util/sleep and pin the DELAY SEQUENCE instead.
 */
const STABILITY_ATTEMPTS = 5;
/** Exported for the tests, which pin the delay SEQUENCE against it. */
export const STABILITY_DELAY_MS = 300;

/**
 * The tree-read budget: `uiTree()` is attempted up to 5 times in all (4
 * retries), 300 ms apart. The same numbers as the stability budget, but a
 * DIFFERENT budget — one re-asks a device that answered "no window yet", the
 * other re-captures a screen that is still moving — so each is named for
 * what it governs and either can move without the other.
 */
const TREE_READ_ATTEMPTS = 5;
const TREE_READ_DELAY_MS = 300;

/** Defined in adapters/types.ts (an adapter's capture is one, D19), re-exported by verify/png.ts and here for the pixel readers that import their frame types from capture. */
export type { RgbaImage } from './png.js';

/**
 * A frame that decoded and has a tree beside it: what the pixel comparators
 * measure against. `scale` is the ONE derivation for this frame — consumers
 * read `.error` and apply their own policy, never re-derive. `window` is the
 * same for the rect denominator (`windowFor`).
 */
export interface MeasuredFrame {
  tree: UiNode;
  image: RgbaImage;
  scale: PngScale;
  window: WindowWidth;
  error?: undefined;
}

/**
 * The tree is here, the pixels are not: the png did not decode. Rect parity
 * can still use the tree — and its `window`, which is why that is derived
 * without the png: the rect table must not lose its witness, or its
 * refusal, to a decode failure.
 */
export interface Undecoded {
  tree: UiNode;
  image?: undefined;
  scale?: undefined;
  window: WindowWidth;
  error: string;
}

/** No tree at all: the read failed after retry. `error` is the one sentence a consumer quotes. */
interface Treeless {
  tree?: undefined;
  image?: undefined;
  scale?: undefined;
  error: string;
}

/**
 * What a frame that had a tree in play can say about itself: the measured
 * frame, or one of the two reasons there is none. Narrow on `error`, then on
 * `tree`. Named for the measurement, not its outcome — `MeasuredFrame` is
 * the success arm.
 */
type FrameMeasurement = MeasuredFrame | Undecoded | Treeless;

/** What every frame says about itself, whatever the wait concluded and whatever tree was in play. */
interface FrameFacts {
  /**
   * The screenshot bytes. Settled over the whole screen: the first capture
   * that repeated. Settled over the caller's region only: the later capture
   * of the pair whose region matched. Not settled: the LAST one taken, as the
   * best available. What a tool returns to the caller either way — as a PNG
   * (`shot.png()`), encoded on the host when the capture was raw pixels (D19,
   * verify/shot.ts).
   */
  shot: Shot;
  /** Captures taken: 2 for a still screen, up to STABILITY_ATTEMPTS + 1 for one that never settles; 1 when the deadline cut the wait before a second. A `BaselineFrame` adds the confirmations it took. */
  captures: number;
}

/**
 * What the stability wait concluded — decided by
 * `stableScreenshot`, once, so no consumer re-derives it
 * from the capture count. `stability`:
 * - `settled`: two consecutive captures matched — over the whole png, or
 *   over the caller's `region` when one was given —
 *   within the budget (and the caller's `deadline`, when one was given);
 * - `moving`: two or more captures were taken and every one differed from
 *   the last — the screen was still changing when the wait stopped. The
 *   polling asserts treat that as a miss, the baseline assert refuses to
 *   create from it, a tool returns the picture with a note;
 * - `unjudged`: only one capture fit before the deadline, so nothing can be
 *   said about stability either way. The polling asserts say "found, no
 *   time left"; nothing else words it.
 *
 * `settledOver` is HOW a `settled` frame settled. It is a union arm rather
 * than an optional field so that a settled frame always says it and any
 * other frame never does: a consumer comparing it against one value has no
 * missing case to pick a default for.
 * - `screen`: two whole captures were byte-identical — the fast path, and
 *   the only answer a caller without a `region` can get;
 * - `region`: the whole captures differed and only the caller's region
 *   matched. The crop is still only as fresh as the rect the caller
 *   supplied: a region pair can match at a rect the element has already
 *   left (the header), so a consumer measuring at that rect must confirm
 *   it first — the pixel poll does, with a second tree read.
 */
export type Stability =
  | { stability: 'settled'; settledOver: 'screen' | 'region' }
  | { stability: 'moving' | 'unjudged'; settledOver?: undefined };

/** What `stableScreenshot` returns: the frame before any tree is in play. */
type Wait = FrameFacts & Stability;

/**
 * A frame as `captureFrame` returns it to a caller that may not have asked for
 * a tree. A type alias over the `Stability` union, not an interface: an
 * interface cannot extend a union, and `Omit`/`Pick` over it would drop the
 * pairing of `stability` with `settledOver`.
 *
 * `measured` is present whenever a tree was read or supplied; absent for a
 * png-only frame (the `screenshot` and `ensure_state` tools), which asked for
 * nothing more and so has nothing to report — not even a reason.
 */
export type Frame = Wait & { measured?: FrameMeasurement };

/**
 * The one sentence for a frame that did not settle, worded here because the
 * fact is produced here; each consumer frames it in its own policy (the
 * asserts through `failClosed`, the baseline assert in its refusal).
 */
export const unsettledReason = (frame: Pick<Frame, 'captures'>): string =>
  `the screen did not settle: ${frame.captures} captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run`;

/** A frame the stability wait saw moving — the one state a consumer words; `unjudged` says nothing about the screen. */
export const isMoving = (frame: Pick<Frame, 'stability'>): boolean => frame.stability === 'moving';

/**
 * The one line a consumer that RETURNS an unsettled frame anyway (the
 * `verify` legs, the `screenshot` and `ensure_state` tools) adds beside it,
 * so the agent reading the picture knows it may be mid-animation. Nothing is
 * added for a settled frame, and none for an `unjudged` one (a deadline that
 * left no time for a second capture): only the polling asserts pass a
 * deadline, and they word that case themselves.
 */
export const unsettledNote = (frame: Pick<Frame, 'stability' | 'captures'>): string | undefined =>
  isMoving(frame) ? `⚠ frame: ${unsettledReason(frame)} — the last capture is returned as the best available` : undefined;

/**
 * The confirmation window a frame must hold still across before it may
 * become a BASELINE (docs/bugs/2026-10-06-whole-screen-stability-
 * aliases-a-blinking-caret.md): after the settled pair, one wait of this
 * many ms before each further capture, every one of which must be
 * byte-identical to the settled shot. A zero is no wait at all — the next
 * capture starts as soon as the last returns — and no `sleep(0)` is called.
 *
 * Why a window at all. "Settled" is two identical captures STABILITY_DELAY_MS
 * apart, and the real spacing is that delay PLUS the device's capture time c:
 * ≈0.95 s on the Android emulator (c ≈ 0.65 s), ≈0.8 s on the iOS simulator,
 * as measured 2026-10-06 — the figures the schedule below was chosen on.
 * The lab emulator's c measures faster (the module header's blind-spot
 * paragraph has the figure); the simulation's grid below spans it.
 * A text caret blinks with a ≈1 s period at ≈50% duty, so the pair usually
 * lands one period apart, in the same phase, and compares equal — measured
 * 2026-10-06 on both devices: no `⚠ frame:` on a caret screen, and a
 * baseline CREATED from it, holding one phase of the blink, so every later
 * diff passed or failed by the caret's phase. Two samples cannot tell a still
 * screen from one whose period divides their spacing; more samples, at
 * spacings that are not one cadence, can.
 *
 * Why these four. Chosen by simulation (tests/verify/baseline-confirmation
 * .test.ts drives `captureBaselineFrame` through it): a square-wave blink of
 * period 0.4–2.0 s, 20 phase offsets, capture times c ∈ {0.15, 0.4, 0.65,
 * 0.8} s. The criterion: creation refused for ≥99% of that grid at 50% duty
 * and for EVERY point with period 0.9–1.1 s at the two measured c (0.65,
 * 0.15). Measured: the pair alone refuses 14.3% (24% of the 1 s band);
 * this schedule 99.8% (100% of the band); 30%/70% duty 86.9%, recorded, not
 * the criterion. Those are the IDEALISED model's figures — a fixed c, exact
 * sleeps, a capture that samples the instant it starts — and "100% of the
 * band" holds there only. The review's model (2026-10-06), whole grid / band:
 * every capture and sleep jittered ±10% 99.0 / 100, ±25% 98.8 / 99.5 (the
 * simulation test pins its own seeded ±25% run, 98.1 / 99.5); a screencap
 * that samples a random instant within its capture 97.4 / 95.0; the window's
 * captures 1.25× slower than the pair's 96.8 / 95.0, 1.5× slower 94.4 / 77.0.
 * So the schedule is the cheapest that clears the criterion in the model,
 * not a guarantee on a device: the device check in
 * docs/plans/2026-10-05-device-verification-handoff.md §5 is the proof.
 * The capture spacings it produces are 0.3+c (the pair), 0.3+c, then c, c,
 * c — two incommensurate cadences, so no one period lines up with all of
 * them — and the samples span 0.6+5c from the pair's first
 * to the last confirmation, 1.35 s at c=0.15 and more at every slower c:
 * longer than the longest phase (1 s) of a 50%-duty blink up to a 2 s
 * period (at the fast end the waits carry the window; at device speeds the
 * captures themselves fill it).
 *
 * What fails the criterion: within a ≈2.1 s budget at c=0.65, no
 * three-capture schedule reaches it (best 94% overall, never 100% of the
 * 1 s band), nor do three captures at fixed offsets from the pair's start
 * (best 97%). Outside that budget, [300, 0, 0] — this schedule minus its
 * last capture — reaches 100% of the band and 98.6% overall, ≈2.25 s at
 * c=0.65: the cheaper alternative, excluded by the 99% line and not by the
 * band. Four captures is the cheapest that clears both, so on a still
 * screen the cost is 0.3 s + 4 captures, ≈2.9 s at c=0.65, ≈0.9 s at
 * c=0.15 — paid by baseline CREATION only, once per baseline. A diff
 * against an existing baseline, and every other consumer, takes the plain
 * `captureFrame` budget. The 0.3 s matches STABILITY_DELAY_MS by
 * result of the search, not by reference: neither constant may move with
 * the other.
 *
 * Not options, as the stability budget is not (the 300-vs-500 split). The
 * tests pin the sequence: [STABILITY_DELAY_MS, 300] for a still screen.
 */
export const BASELINE_CONFIRMATION_DELAYS_MS: readonly number[] = [300, 0, 0, 0];

/**
 * A frame offered as a baseline: the plain frame, plus what the
 * confirmation window concluded — present only when the pair settled (a
 * moving frame is refused on its own wording, before any confirmation):
 * - `true`: every confirming capture matched the settled shot;
 * - `false`: one did not — the window saw a change the pair was in phase
 *   with. The wait stops at that capture; `captures` counts it and
 *   everything before, and `shot` is still the settled pair's (the frame
 *   that WOULD have been stored), never the differing one.
 * `stability` keeps describing the pair alone; a consumer creating a
 * baseline reads `confirmed`, and creates ONLY on `true`: a check of
 * `=== false` would store an `unjudged` frame — `confirmed` absent — if a
 * deadline ever reached this path. The
 * type says it: `confirmed` is a boolean exactly when the pair settled, and
 * absent otherwise, so a consumer narrowing on `stability` gets the field
 * it can read.
 */
export type BaselineFrame =
  | (Frame & { stability: 'settled'; confirmed: boolean })
  | (Frame & { stability: 'moving' | 'unjudged'; confirmed?: undefined });

/**
 * The one sentence for a settled pair the confirmation window then saw
 * change, worded here because the fact is produced here; the baseline assert
 * frames it in its refusal. Truthful about what was seen: two captures DID
 * match, so it does not say "each different from the last" (unsettledReason
 * does, for the frame that never settled).
 */
export const unconfirmedReason = (frame: Pick<Frame, 'captures'>): string =>
  `the screen did not settle: ${frame.captures} captures — two consecutive ones matched, then a later confirming capture differed from them — a periodic change such as a blinking caret or a ticking clock, which a matching pair can land in phase with; hide or stop it (unfocus the field, freeze the clock) and re-run`;

/**
 * A frame whose tree was READ here (`readTree: true`): its measured half is
 * always there, though it may say the read failed (`Treeless`).
 */
export type TreeRequestedFrame = Wait & { measured: FrameMeasurement };

/**
 * A frame that HAS a tree: what `captureFrame` returns to a caller that
 * supplied one (`tree`). That arm never reads a tree, so it has no read to
 * fail and its `measured` has no treeless arm; an `error` on it is a png that
 * did not decode (`Undecoded`). Built from `Wait`, as `Frame` is, so a field
 * added to the frame reaches every consumer without an edit here.
 */
export type TreeFrame = Wait & { measured: MeasuredFrame | Undecoded };

/**
 * Where the tree comes from, as three states a caller cannot mix: read it
 * here (`readTree`, bounded retry; a final failure is carried on the frame —
 * a leg must not lose a minutes-long device run over the optional extra
 * read), take the caller's own (`tree` — the polling asserts, whose poll owns
 * the read), or none. A supplied tree with `readTree` beside it is a type
 * error rather than a documented precedence: a tree the caller already has
 * is never re-read, and the types say so.
 */
type CaptureOptions = {
  /**
   * Absolute time (ms since epoch) the caller must be done by — a polling
   * assert's own deadline. A re-capture that would end after it is not taken
   * and the frame comes back `moving` (or `unjudged`, with one capture); the first capture is always
   * taken, so even an expired deadline gets one honest look. No deadline:
   * the full stability budget.
   */
  deadline?: number;
} & (
  | { readTree: true; tree?: never; region?: never }
  | {
      tree: UiNode;
      readTree?: never;
      /**
       * The element's rect in TREE points, from the supplied tree:
       * when two captures differ, the wait also asks whether they match INSIDE
       * this rect, so live content elsewhere (a status-bar clock, a caret) does
       * not keep the frame moving. Allowed only beside a supplied tree — the
       * rect must come from the tree the scale is derived from, and the
       * `readTree` arm has no tree until after the wait; the png-only arm has
       * none at all. A type error on either, like `tree` with `readTree`.
       */
      region?: Rect;
    }
  | { readTree?: false; tree?: never; region?: never }
);

/**
 * Capture a settled frame. Nothing past the screenshot itself throws: a tree
 * read that fails after retry, a png that does not decode, a device that
 * will not say its screen size, and a scale walk that throws on a malformed
 * tree all land on the frame as a reason, so every consumer's own fail-closed
 * policy applies instead of a lost leg. (The screenshot must throw — without
 * bytes there is no frame to carry a reason on.)
 *
 * Order, when the tree is READ here (`readTree`): the png first — its
 * stability is the evidence the screen stopped moving — then the tree, so
 * the tree read describes the screen the wait found settled rather than one
 * it found still moving. uiautomator reports LIVE bounds during an
 * animation, so a tree read before the wait could carry mid-animation rects
 * against a settled png.
 *
 * When the tree is SUPPLIED (`tree`, the color and ocr asserts), the caller
 * owns its freshness and it predates the wait by one poll round's read. That
 * is acceptable where it happens because the poll retries: a crop that lands
 * wrong on a frame that settled after the read fails this round and the next
 * round reads a tree of the settled screen. Its `region`, when given, is
 * the rect the wait judges stability over (the header).
 *
 * The residual race of png-then-tree: the screen can change BETWEEN the
 * stable pair and the tree read — a toast, a late async render — and on
 * Android that window is a whole uiautomator dump, seconds long. It is
 * rarer than the reverse order's race, which needs only an animation
 * already in flight; this one needs a NEW change to begin after two
 * identical captures. The cheap mitigation — one confirming capture after
 * the tree read, a note on the frame when it differs — is not taken here
 * because it is a tree-read/poll concern (which capture confirms what) and
 * the step that owns those primitives should decide it, not this one.
 *
 * The scale is derived once both halves are in hand; the device screen is
 * asked for only then, and a failed read degrades to the tree (correct for
 * every root-bearing capture) rather than failing the frame.
 */
export function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions & { tree: UiNode },
): Promise<TreeFrame>;
export function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions & { readTree: true },
): Promise<TreeRequestedFrame>;
export function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'uiTree' | 'viewport'>,
  opts?: CaptureOptions,
): Promise<Frame>;
export async function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions = {},
): Promise<Frame> {
  const region = opts.tree !== undefined && opts.region !== undefined ? { rect: opts.region, tree: opts.tree } : undefined;
  // `wait` is everything the frame says about itself (shot, stability, how it
  // settled, captures); only the measured half is added below.
  // The supplied tree is walked ONCE for the whole capture — the region
  // check's scale on every differing pair, the frame's scale and its window
  // all read this one size.
  const suppliedSize = opts.tree === undefined ? undefined : treeSizeOf(opts.tree);
  const wait = await stableScreenshot(
    adapter,
    opts.deadline,
    region && suppliedSize && { ...region, size: suppliedSize },
  );
  const { shot } = wait;
  let tree: UiNode;
  if (opts.tree !== undefined) {
    tree = opts.tree;
  } else if (opts.readTree) {
    try {
      tree = await readTreeWithRetry(adapter, { attempts: TREE_READ_ATTEMPTS, delayMs: TREE_READ_DELAY_MS });
    } catch (e) {
      return { ...wait, measured: { error: errorMessage(e) } };
    }
  } else {
    return wait;
  }
  // Memoized inside the adapter (adapters/types.ts), so this is a device read
  // once per adapter, not once per frame — and once more, fresh, only when
  // the window reads wider than the memoized screen (ScreenWitness). Judged
  // BEFORE the decode: the rect table runs on a frame whose png did not
  // decode, and the device screen is what witnesses its window width
  // (scale.ts#windowWidth).
  const size = suppliedSize ?? treeSizeOf(tree);
  const witness = await ScreenWitness.read(adapter);
  const window = await witness.judge(tree, size);
  const { screen } = witness;
  let image: RawImage;
  try {
    // A shot the region check already decoded (settled or moving) is not decoded twice (Shot memoizes);
    // a raw capture (D19) is its pixels already.
    image = shot.decode();
  } catch (e) {
    return {
      ...wait,
      measured: {
        tree,
        window,
        error:
          // No platform command here: the adapter refuses bytes
          // that are not a PNG at all, naming its own command
          // (adapters/screenshot-bytes.ts), so what reaches this decode
          // started like one and broke after its signature.
          `screenshot PNG decode failed: ${errorMessage(e)} — re-run; if it repeats, the device is returning ` +
          'a damaged PNG (it starts like one but does not decode) — capture one by hand on the device and open it',
      },
    };
  }
  return { ...wait, measured: { tree, image, scale: scaleFor(tree, image, screen, size), window } };
}

/**
 * A frame fit to become a BASELINE: `captureFrame`'s png-only arm — the one
 * stability budget, unchanged — and then, only when that pair settled, the
 * confirmation window (`BASELINE_CONFIRMATION_DELAYS_MS`, whose doc carries
 * the why, the simulation and the cost). It is for creating a baseline when
 * no baseline file exists yet; a DIFF against an existing one takes plain
 * `captureFrame` and its budget. A dedicated export rather than an arm of
 * `captureFrame`, so no other consumer — a tool, `ensure_state`, a `verify`
 * leg, a pixel assert — can opt into a ≈3 s wait by a flag, and the arm
 * types above stay as they are.
 *
 * Deadline: none, as baseline creation has none — the window is
 * bounded by its own four captures. If a deadline ever reaches this path,
 * the confirmations must count against it as the re-captures do, and a
 * window the deadline cuts short is UNconfirmed, never confirmed: a
 * baseline is stored once and read for every later run, so the cost of a
 * false "still" is paid forever, and of a false refusal once.
 *
 * Bytes only, no region: a baseline is a picture of the whole screen (the
 * header). A periodic change anywhere on it refuses creation; the remedy
 * the refusal names is to hide or stop it. The settled pair's own fast path
 * is untouched, and the window stops at the first differing capture.
 */
export async function captureBaselineFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'uiTree' | 'viewport'>,
): Promise<BaselineFrame> {
  const frame = await captureFrame(adapter);
  if (frame.stability !== 'settled') return { ...frame, stability: frame.stability };
  const stability = frame.stability;
  let captures = frame.captures;
  for (const delayMs of BASELINE_CONFIRMATION_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const shot = await captureShot(adapter);
    captures += 1;
    if (!shot.equals(frame.shot)) return { ...frame, stability, captures, confirmed: false };
  }
  return { ...frame, stability, captures, confirmed: true };
}

/**
 * The device screen as a WITNESS: the adapter's memoized `viewport()`, or
 * `undefined` when it cannot be read — a failed read degrades every answer
 * that would have been checked against it (the png scale, the window width)
 * to the tree's alone, each saying so in its own note; it never fails the
 * frame or the assert. One owner for that degradation, so no reader spells
 * the catch its own way. Not for `absent`, whose viewport is the reference
 * frame itself and whose failed read is an error.
 */
export const witnessScreen = (adapter: Pick<DeviceAdapter, 'viewport'>): Promise<DeviceScreen | undefined> =>
  adapter.viewport().catch(() => undefined);

/**
 * The device screen as the WINDOW's witness, for one frame (`captureFrame`)
 * or one `rect` assert's rounds (Verifier.planRect): the memoized screen,
 * re-read FRESH at most once — when a window reads wider than the side it
 * faces (`WindowWidth.widerThanScreen`), the one refusal a stale screen can
 * cause — and the window judged again against what the device says now.
 * Without the re-read, with the screen memoized, a `wm size` or an unfold
 * after the first read would keep refusing until the MCP server restarted
 * (the device check, row 18c).
 *
 * The refusal that survives says which: the screen was read again and
 * still says so (the tree, not a stale size), or the re-read failed (a
 * changed screen cannot be ruled out). A screen read fresh is kept for the
 * later rounds, and the adapter's memo is replaced by it too.
 */
export class ScreenWitness {
  #screen: DeviceScreen | undefined;
  /** undefined: not re-read yet; otherwise what the one re-read added to a refusal. */
  #reread: string | undefined;

  private constructor(
    private readonly adapter: Pick<DeviceAdapter, 'viewport'>,
    screen: DeviceScreen | undefined,
  ) {
    this.#screen = screen;
  }

  static async read(adapter: Pick<DeviceAdapter, 'viewport'>): Promise<ScreenWitness> {
    return new ScreenWitness(adapter, await witnessScreen(adapter));
  }

  /** The screen the last judgement used — the memoized one, or the fresh one once re-read. */
  get screen(): DeviceScreen | undefined {
    return this.#screen;
  }

  /** `windowWidth` for this tree, with the one fresh re-read before a wider-than-screen refusal. */
  async judge(tree: UiNode, size: TreeSize = treeSizeOf(tree)): Promise<WindowWidth> {
    let window = windowFor(tree, this.#screen, size);
    if (window.widerThanScreen !== true) return window;
    if (this.#reread === undefined) {
      try {
        this.#screen = await this.adapter.viewport({ fresh: true });
        this.#reread =
          'the device screen was read again just before this refusal, so the size above is the one it reports now, ' +
          'not a stale read';
      } catch (e) {
        this.#reread =
          `a fresh read of the device screen failed (${errorMessage(e)}), so a screen changed since the first ` +
          'read (a fold or unfold, `wm size`) cannot be ruled out; re-run';
      }
      window = windowFor(tree, this.#screen, size);
      if (window.widerThanScreen !== true) return window;
    }
    return { ...window, error: `${window.error} — ${this.#reread}` };
  }
}

/**
 * The pure tail of `captureFrame`: a tree, a decoded png and (when the
 * device would say) its screen become the ONE measured frame — the scale
 * derived once, a throwing geometry walk carried as the scale's failure
 * reason. `screen` undefined → the scale comes from the tree, with the
 * scale's own note saying so (verify/scale.ts). Exported so the comparator
 * tests build their fixtures through the same derivation production uses: a
 * test that re-spelled this line as
 * `{ tree, png, scale: pngScale(tree, png.width, png.height, screen) }`
 * would stay green after a change to what the capture feeds the scale (the
 * oriented screen, a caught throw) — the shape of the 2026-08-26
 * ocr-crop-scale bug, which was a dropped field at the call site, not a
 * wrong unit. The two failure arms (`Undecoded`, `Treeless`) are decided
 * before this tail; `Undecoded` shares only its window derivation
 * (`windowFor`), the one fact it carries that does not need pixels.
 */
export function measuredFrameFor(tree: UiNode, image: RgbaImage, screen?: DeviceScreen): MeasuredFrame {
  const size = treeSizeOf(tree);
  return { tree, image, scale: scaleFor(tree, image, screen, size), window: windowFor(tree, screen, size) };
}

/**
 * The tree's `inferScreenSize`, walked ONCE per frame and handed to both the
 * png scale and the window width — or the
 * walk's throw, carried, so each answer still fails with its own words.
 */
type TreeSize = { size: ScreenSize; thrown?: undefined } | { size?: undefined; thrown: unknown };

function treeSizeOf(tree: UiNode): TreeSize {
  try {
    return { size: inferScreenSize(tree) };
  } catch (e) {
    return { thrown: e };
  }
}

/** The frame's png scale from an already-walked tree size, with the walk's containment. */
function scaleFor(tree: UiNode, image: RgbaImage, screen: DeviceScreen | undefined, size: TreeSize): PngScale {
  // The geometry walk assumes a well-formed tree. A node without children
  // or a pathological depth must fail THIS frame's scale, not the leg.
  if (size.thrown !== undefined) return { error: malformedTree('the png scale', size.thrown) };
  try {
    return pngScale(tree, image.width, image.height, screen, size.size);
  } catch (e) {
    return { error: malformedTree('the png scale', e) };
  }
}

/** The one sentence for a geometry walk that threw on this tree, naming what it was deriving. */
const malformedTree = (what: string, e: unknown): string =>
  `${what} could not be derived from this tree: ${errorMessage(e)} — the tree is not well-formed; ` +
  'dump it with ui_snapshot and re-run, and keep the dump if it repeats';

/**
 * The frame's window width — `scale.ts#windowWidth`, derived once per frame
 * beside the scale, with the same containment: a tree the geometry walk
 * cannot traverse fails THIS answer as a carried reason, never the leg.
 * Shared by both tree-bearing arms (`MeasuredFrame`, `Undecoded`), so a png
 * that did not decode still reaches the rect table with its window judged.
 */
function windowFor(tree: UiNode, screen: DeviceScreen | undefined, size: TreeSize): WindowWidth {
  if (size.thrown !== undefined) return { error: malformedTree('the window width', size.thrown) };
  try {
    return windowWidth(tree, screen, size.size);
  } catch (e) {
    return { error: malformedTree('the window width', e) };
  }
}

/**
 * Two identical consecutive captures, bounded by the stability budget and by
 * the caller's deadline. Each call costs 2 to STABILITY_ATTEMPTS+1 device
 * captures, and the color and ocr asserts pay that PER POLL ROUND — which is
 * why they hand their deadline in: a round must not spend 1.5 s on captures
 * the poll's own clock has already run out on.
 *
 * The deadline test is "would the NEXT re-capture end after it", with the
 * cost of a re-capture (one delay plus one screencap, plus the region check
 * when there is one — its decode, ~40 ms for a phone-sized png, is time the
 * next re-capture will spend too) taken from the PREVIOUS one as measured on
 * the clock — a slow screencap (300 ms on a
 * loaded emulator) is accounted for rather than assumed free, and a
 * mocked-out sleep (the tests) is not assumed to take 300 ms it does not
 * take. The first re-capture has no measurement to go on and is taken
 * unless the deadline has already passed; the first capture is always taken
 * — one honest look.
 *
 * With a `region` (the supplied-tree arm only), a pair whose
 * whole buffers differ gets a second question — do they match inside the
 * element's rect? — answered by `regionSettled` below; the header says what
 * it falls back to and why. Identical captures never reach it, so a still
 * screen costs no decode and no device read, region or not. Each capture is
 * decoded at most once across the wait AND the frame: a Shot memoizes its
 * decode (verify/shot.ts), the later shot of one pair is the earlier of the
 * next, and `captureFrame` measures the returned shot. An Android capture is
 * raw pixels (D19): compared as they are, never decoded, and encoded to a
 * PNG only where one leaves the process (`Shot.png`).
 */
async function stableScreenshot(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'capture' | 'viewport'>,
  deadline?: number,
  region?: SizedRegion,
): Promise<Wait> {
  let previous = await captureShot(adapter);
  let captures = 1;
  let recaptureMs = 0; // measured cost of the last re-capture (delay + screencap); 0 until one has run
  for (let i = 0; i < STABILITY_ATTEMPTS; i++) {
    if (deadline !== undefined && Date.now() + recaptureMs >= deadline) break;
    const started = Date.now();
    await sleep(STABILITY_DELAY_MS);
    const current = await captureShot(adapter);
    captures += 1;
    if (current.equals(previous)) return { shot: current, stability: 'settled', settledOver: 'screen', captures };
    if (region !== undefined) {
      if (await regionSettled(adapter, region, previous.tryDecode(), current.tryDecode())) {
        return { shot: current, stability: 'settled', settledOver: 'region', captures };
      }
    }
    // Taken AFTER the region check: its decode is part of
    // what the next re-capture will cost. The fast path above returns first,
    // so a still screen's count and sleeps are untouched.
    recaptureMs = Date.now() - started;
    previous = current;
  }
  // The ONE place "one capture is no verdict" is decided: a
  // consumer reads `stability`, never the count.
  return { shot: previous, stability: captures < 2 ? 'unjudged' : 'moving', captures };
}


/**
 * Why a capture threw, in one line: the first line of the error — the
 * adapter's own sentence naming its device and command
 * (adapters/screenshot-bytes.ts). `captureFrame` throws for nothing else (its
 * doc), so a caller that catches it quotes this — as a fail-closed reason,
 * or as a run's `⚠ screenshot:` line.
 */
export const captureRefusal = (e: unknown): string => errorMessage(e).split('\n')[0];

/** The caller's element for a region-judged wait: its rect, and the tree that rect (and, when the device will not say, the scale) comes from. */
interface StabilityRegion {
  rect: Rect;
  tree: UiNode;
}

/** A region with its tree already walked — the size every pair's scale reads. */
interface SizedRegion extends StabilityRegion {
  size: TreeSize;
}

/**
 * Do two differing captures match inside the element's region? The later
 * png when they do; `undefined` — the whole-screen answer, "different" —
 * whenever the question cannot be answered: a png that did not decode, two
 * pngs of different sizes, a scale that carries an error, a rect that lands
 * nowhere on the png. The scale is the one the measured frame will carry
 * (`scaleFor`, on the region tree's size walked once per capture: the
 * device screen when the adapter will say it — a memoized read, so once per
 * adapter — the tree otherwise), and the rect is
 * landed with `pngRegion` and no inset, so the compare covers every pixel
 * the ocr crop reads and more than the colour sampler's inset one.
 */
async function regionSettled(
  adapter: Pick<DeviceAdapter, 'viewport'>,
  region: SizedRegion,
  earlier: RawImage | undefined,
  later: RawImage | undefined,
): Promise<RawImage | undefined> {
  if (earlier === undefined || later === undefined) return undefined;
  if (earlier.width !== later.width || earlier.height !== later.height) return undefined;
  const screen = await witnessScreen(adapter);
  // The scale only — the window is not this check's question.
  const scale = scaleFor(region.tree, later, screen, region.size);
  if (scale.error !== undefined) return undefined;
  const bounds = pngRegion(region.rect, scale.scale, later);
  if (bounds === undefined) return undefined;
  // Row by row: the region's bytes are contiguous within a row, not across rows.
  const stride = later.width * 4;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    const from = y * stride + bounds.x0 * 4;
    const to = y * stride + bounds.x1 * 4;
    if (Buffer.compare(earlier.data.subarray(from, to), later.data.subarray(from, to)) !== 0) return undefined;
  }
  return later;
}

/**
 * Bounded-retry tree read for the tree half of a captured frame: right after
 * a flow settles, a device can transiently fail to produce a tree
 * (uiautomator "null root node") — the same transient the polling asserts
 * absorb via readTreeOrMiss. Throws after the last attempt with the
 * underlying error in the message; `captureFrame` carries that on the frame.
 * A failure no wait cures ends it after its own attempt, its message whole
 * (see ui-tree/read-tree.ts#readTreeOrMiss).
 */
async function readTreeWithRetry(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  budget: { attempts: number; delayMs: number },
): Promise<UiNode> {
  let last: string | undefined;
  for (let i = 0; i < budget.attempts; i++) {
    if (i > 0) await sleep(budget.delayMs);
    let read: TreeRead;
    try {
      read = await readTreeOrMiss(adapter);
    } catch (e) {
      // Only a failure no wait cures can reach here (the seam's contract): not retried, its message the frame's reason.
      throw new Error(`UI tree read failed: ${errorMessage(e)}`, { cause: e });
    }
    if (read.tree !== undefined) return read.tree;
    last = read.error.message;
  }
  throw new Error(`UI tree read failed after ${budget.attempts} attempts: ${last ?? 'unknown error'}`);
}

/** A rect by its edges, half-open: png pixels (a region landed in the png) or tree units (`clipThenInset`'s `units`). */
export interface EdgeBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rect landed in the png: its bounds, plus how much of it fell outside. */
export interface PngRegion extends EdgeBounds {
  /** Share of the rect's scaled area that lay off-png before clamping (0 = fully on-png). */
  clipped: number;
}

/**
 * The one rect → png mapping: scale, clamp to the png, optionally inset each
 * edge by a fraction of the clamped size. Undefined when nothing of the rect
 * is on the png — off-screen in this capture, which the caller must report.
 *
 * Clamping is not cosmetic. iOS keeps off-viewport nodes in the tree with
 * negative or oversized rects; handed one of those unclamped, `CGImage`
 * silently intersects the crop, and ink measured inside that clipped crop
 * would be normalized as if it were the whole anchor — a phantom type-size
 * delta built out of a partly off-screen element. The clipped FRACTION is
 * computed here, once, so the color sampler can say when a remaining sliver
 * may be a neighbour's fill.
 *
 * The inset is an option because the two consumers disagree for good reason:
 * color sampling insets 12% per edge to stay off anti-aliased borders; OCR
 * must NOT inset, since a cropped glyph reads as a different string. The
 * inset never empties a region (it stops at the half-size).
 *
 * Known deviation from the Python port: Math.round rounds half UP where
 * Python's round() is banker's (half to even), so a bound whose scaled
 * product lands exactly on .5 can shift 1px. Accepted deliberately: the
 * color inset swallows any single-pixel edge, and the fixture tests pin
 * THIS behavior — do not "fix" it to banker's without re-pinning them.
 */
export function pngRegion(
  rect: Rect,
  scale: number,
  png: { width: number; height: number },
  inset = 0,
): PngRegion | undefined {
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.width) * scale);
  const y1 = Math.round((rect.y + rect.height) * scale);
  const on = clipTo({ x0, y0, x1, y1 }, { x0: 0, y0: 0, x1: png.width, y1: png.height });
  if (on === undefined) return undefined;
  const full = (x1 - x0) * (y1 - y0);
  const clipped = full > 0 ? 1.0 - (on.x1 - on.x0) * (on.y1 - on.y0) / full : 0.0;
  return { ...insetBy(on, inset, 'pixels'), clipped };
}

/**
 * THE region a reader of an element reads: `rect` CLIPPED to `frame` first, then inset `inset` of the clipped size on
 * each side — the pixel assert's judge of what lies over what the colour assert reads
 * (verify/color-parity.ts#colorSampleRect, `unit: 'units'`, the screen judged as the frame). The colour sampler
 * (`pngRegion`, the png as the frame) asks the same two steps apart — `clipTo`, then `insetBy` with `unit: 'pixels'` —
 * since it also needs the clip alone for its clipped fraction; the judge and the sampler share `clipTo` and `insetBy`,
 * so the two read ONE region — of one `rect`, the element's part its scroll views draw
 * (ui-tree/standing.ts#Scene.pixelRegion). Undefined when nothing of `rect` lies in `frame` (no width or no height
 * left).
 *
 * Clip, THEN inset, in that order, both of them: a rect running past the screen's edge is sampled on the part that
 * shows. Measured: the SWIFT form's `payee_street_input 24,869 354x52` beneath the Fees sheet's dim, on a 402x874
 * screen — the sampler clipped it to the 5-pt sliver above the bottom edge and read the sheet's grey there, while the
 * judge inset the UNCLIPPED rect (y 875–915, wholly below the screen) and found nothing over it: a colour assert
 * expecting the sheet's grey passed on the sheet.
 * docs/bugs/2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md
 *
 * `pixels`: whole pixels — the inset floored, and never more than leaves one pixel (it stops short of the half-size);
 * `units`: tree units, the inset exact. The two differ by the png mapping's rounding only, a fraction of a unit.
 * `insetBy` takes the unit, not two functions: the inset's fraction is what the judge and the sampler share, and only
 * whole pixels need the flooring.
 */
export function clipThenInset(rect: EdgeBounds, frame: EdgeBounds, inset: number, unit: 'pixels' | 'units'): EdgeBounds | undefined {
  const on = clipTo(rect, frame);
  return on === undefined ? undefined : insetBy(on, inset, unit);
}

/** `rect`'s part inside `frame`; undefined when none is (no width or no height left). */
function clipTo(rect: EdgeBounds, frame: EdgeBounds): EdgeBounds | undefined {
  const x0 = Math.max(rect.x0, frame.x0);
  const y0 = Math.max(rect.y0, frame.y0);
  const x1 = Math.min(rect.x1, frame.x1);
  const y1 = Math.min(rect.y1, frame.y1);
  return x1 <= x0 || y1 <= y0 ? undefined : { x0, y0, x1, y1 };
}

/** `bounds` inset `inset` of its size on each side, in `unit` (`clipThenInset` says how the two differ). */
export function insetBy(bounds: EdgeBounds, inset: number, unit: 'pixels' | 'units'): EdgeBounds {
  const by = (size: number): number => (unit === 'pixels' ? Math.min(Math.floor(size * inset), Math.floor((size - 1) / 2)) : size * inset);
  const ix = by(bounds.x1 - bounds.x0);
  const iy = by(bounds.y1 - bounds.y0);
  return { x0: bounds.x0 + ix, y0: bounds.y0 + iy, x1: bounds.x1 - ix, y1: bounds.y1 - iy };
}

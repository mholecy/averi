import { PNG } from 'pngjs';
import type { DeviceAdapter, DeviceScreen, Rect, UiNode } from '../adapters/types.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { pngScale, type PngScale } from './scale.js';

/**
 * One settled frame, one scale, one crop — the module every pixel reading in
 * this package goes through.
 *
 * Before 2026-10-02 the pieces of "capture something trustworthy to measure"
 * had four owners. The stability wait lived in assert.ts and was re-declared
 * (with its own constants) by the `screenshot` tool, while the `verify` legs
 * and `ensure_state` took a BARE screenshot — so the frame that fed the color
 * and text parity tables was the one frame the color assert's own doc says
 * must never be the verdict: a mid-animation one. The png scale was derived
 * at four call sites with four failure policies, and the rect→png crop was
 * written twice (color-parity.ts with an inset, text-parity.ts without).
 *
 * This module is the one owner of three facts about a capture:
 * - the png is STABLE: two identical consecutive captures, bounded attempts;
 * - the scale (tree points → png pixels) is computed ONCE per frame, from
 *   the device screen when it will say and the tree when it will not, and
 *   carried as a value — success or a single, quotable failure — so every
 *   consumer reads the same number and the same sentence (verify/scale.ts
 *   owns the derivation and its wording; this module owns that it runs once);
 * - a rect lands in the png the same way everywhere (`pngRegion`), with the
 *   clipped fraction computed beside it; the inset is the caller's option.
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
 * its denominator is the app's canvas, not the device screen).
 *
 * "Every pixel reading" holds since 2026-10-04: until then the screenshot
 * baseline assert took a bare `adapter.screenshot()` — the one reader the
 * 2026-10-02 change missed, so the frame it diffed and the baseline it wrote
 * could both be mid-animation. It now takes the png-only arm of
 * `captureFrame`. The pure tail (tree + png + screen → measured frame) is
 * exported as `measuredFrameFor`, and the comparator tests build their
 * fixtures with it rather than re-deriving the scale themselves.
 *
 * Since 2026-10-05 the budget has ONE owner and the frame SAYS whether it
 * settled:
 * - The stability delay is this module's constant and nothing else's. Until
 *   then `CaptureOptions.delayMs` existed "so tests stay fast", and the
 *   Verifier forwarded its poll interval as that delay at three sites — so
 *   the color, ocr and baseline asserts inside a FLOW (FlowEngine's pollMs
 *   defaults to 500) waited 500 ms between captures while the same asserts
 *   from the MCP `assert` tool waited 300, and the sentence "the same budget
 *   for every consumer" below was false in production. `pollMs` now means
 *   the poll interval only; the tests that need speed mock util/sleep, as
 *   the engine tests always did.
 * - `Frame.stability` reports what the wait concluded (settled / moving /
 *   unjudged) and `Frame.captures` how many were taken. Until then a screen
 *   that never settled (spinner, caret, live content) silently yielded its
 *   LAST frame as if it were settled, and the consumers could not tell: the
 *   color and ocr asserts measured it and called the measurement a verdict;
 *   the baseline assert stored it as the ground truth for every later run.
 *   Now the polling asserts treat an unsettled frame as a miss (the deadline,
 *   not a moving frame, decides), and the baseline assert refuses to create
 *   or diff against one. The `verify` legs and the `screenshot` /
 *   `ensure_state` tools still return the best frame — a tool hands the
 *   picture to the agent, whose own eyes judge it — and read `settled` only
 *   if they choose to say so.
 * - `CaptureOptions.deadline` lets a caller with a budget of its own bound
 *   the wait: a re-capture that would end after the deadline is not taken,
 *   and the frame comes back `moving` (or `unjudged`, with one capture). The
 *   before/after figures (2026-10-05) are kept ONCE, on `Verifier.poll` in
 *   assert.ts; passing the deadline in is the pixel poll's since 2026-10-06
 *   (verify/pixel-poll.ts).
 *
 * Done 2026-10-06 (recorded until then as "not done"): stability can be
 * judged over the ELEMENT'S REGION. Until that date it was judged on the
 * whole screenshot only, so a clock in the status bar or a blinking caret
 * elsewhere on the screen kept a frame "moving" while the element a color
 * or ocr assert measured held perfectly still, and the assert failed "the
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
 * false-pass windows remain, recorded here (review 2026-10-06):
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
 */

/**
 * The stability budget: up to 5 re-captures 300 ms apart, i.e. a frame that
 * does not settle costs 6 captures and 1.5 s before the LAST one is returned
 * as the best available — marked `stability: moving`. The same budget for every
 * consumer: a `verify` leg, the `screenshot` tool, and an assert inside a
 * flow all wait exactly the same (since 2026-10-05; see the header for the
 * 300-vs-500 split this closed).
 *
 * What that costs a leg that used to take one bare screenshot: a floor of
 * one 300 ms sleep and one extra capture when the screen is already still,
 * up to 1.5 s and five extra captures when it is not. And 2 to 6
 * `screenshot()` calls per leg instead of 1 is that many more chances for
 * a transient screencap failure to reject the leg — the one failure this
 * module cannot carry as a value, because without bytes there is no frame.
 * The png is decoded whenever a tree is in play, even for a contract with
 * only rect anchors, which never read a pixel; that decode is paid once and
 * is cheap next to the wait, so it is not gated.
 *
 * Not options: a smaller budget "for tests" was how the 300-vs-500 split
 * crept in. Tests mock util/sleep and pin the DELAY SEQUENCE instead.
 */
const STABILITY_ATTEMPTS = 5;
/** Exported for the tests, which pin the delay SEQUENCE against it; no production importer. */
export const STABILITY_DELAY_MS = 300;

/**
 * The tree-read budget: a failed `uiTree()` is retried up to 5 times, 300 ms
 * apart. The same numbers as the stability budget, but a DIFFERENT budget —
 * one re-asks a device that answered "no window yet", the other re-captures
 * a screen that is still moving — so each is named for what it governs and
 * either can move without the other.
 */
const TREE_READ_ATTEMPTS = 5;
const TREE_READ_DELAY_MS = 300;

/** Decoded RGBA screenshot — pngjs's `PNG` satisfies this structurally. */
export interface RgbaImage {
  width: number;
  height: number;
  /** 8-bit RGBA, row-major (pngjs normalizes every PNG variant to this). */
  data: Buffer | Uint8Array;
}

/**
 * A frame that decoded and has a tree beside it: what the pixel comparators
 * measure against. `scale` is the ONE derivation for this frame — consumers
 * read `.error` and apply their own policy, never re-derive.
 */
export interface MeasuredFrame {
  tree: UiNode;
  png: RgbaImage;
  scale: PngScale;
  error?: undefined;
}

/** The tree is here, the pixels are not: the png did not decode. Rect parity can still use the tree. */
export interface Undecoded {
  tree: UiNode;
  png?: undefined;
  scale?: undefined;
  error: string;
}

/** No tree at all: the read failed after retry. `error` is the one sentence a consumer quotes. */
interface Treeless {
  tree?: undefined;
  png?: undefined;
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

export interface Frame {
  /**
   * The screenshot bytes. Settled over the whole screen: the first capture
   * that repeated. Settled over the caller's region only: the later capture
   * of the pair whose region matched. Not settled: the LAST one taken, as the
   * best available. What a tool returns to the caller either way.
   */
  shot: Buffer;
  /**
   * What the stability wait concluded — decided HERE, once, so no consumer
   * re-derives it from the capture count:
   * - `settled`: two consecutive captures matched — over the whole png, or
   *   over the caller's `region` when one was given (since 2026-10-06) —
   *   within the budget (and the caller's `deadline`, when one was given);
   * - `moving`: two or more captures were taken and every one differed from
   *   the last — the screen was still changing when the wait stopped. The
   *   polling asserts treat that as a miss, the baseline assert refuses to
   *   create from it, a tool returns the picture with a note;
   * - `unjudged`: only one capture fit before the deadline, so nothing can be
   *   said about stability either way. The polling asserts say "found, no
   *   time left"; nothing else words it.
   */
  stability: 'settled' | 'moving' | 'unjudged';
  /**
   * HOW a `settled` frame settled (2026-10-06), present only when it did —
   * decided here, once, no consumer re-derives it:
   * - `screen`: two whole captures were byte-identical — the fast path, and
   *   the only answer a caller without a `region` can get;
   * - `region`: the whole captures differed and only the caller's region
   *   matched. The crop is still only as fresh as the rect the caller
   *   supplied: a region pair can match at a rect the element has already
   *   left (the header), so a consumer measuring at that rect must confirm
   *   it first — the pixel poll does, with a second tree read.
   */
  settledOver?: 'screen' | 'region';
  /** Captures taken: 2 for a still screen, up to STABILITY_ATTEMPTS + 1 for one that never settles; 1 when the deadline cut the wait before a second. */
  captures: number;
  /**
   * Present whenever a tree was read or supplied; absent for a png-only frame
   * (the `screenshot` and `ensure_state` tools), which asked for nothing more
   * and so has nothing to report — not even a reason.
   */
  measured?: FrameMeasurement;
}

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
 * A frame for which a tree was ASKED — read here or supplied — so its
 * measured half is always there, though it may say the read failed
 * (`Treeless`). What `captureFrame` returns to such a caller.
 */
interface TreeRequestedFrame extends Frame {
  measured: FrameMeasurement;
}

/**
 * A frame that HAS a tree (2026-10-05): the captured bytes, the tree (with or
 * without decoded pixels) beside them, and whatever else the frame says
 * about itself (`stability`, `captures`). Derived from `Frame` rather than
 * spelled as `{ shot, measured }`, so a field added to the frame reaches
 * every consumer without an edit here; the one narrowing is `measured`,
 * which has lost its treeless arm — the difference from `TreeRequestedFrame`
 * above, which only promises the question was asked. Until this date the
 * shape was `TextLegFrame` in text-parity.ts: a text-named type one consumer
 * handed to all three parity tables, and a freestanding copy that would have
 * silently dropped `stability`.
 */
export interface TreeFrame extends Omit<Frame, 'measured'> {
  measured: MeasuredFrame | Undecoded;
}

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
       * The element's rect in TREE points, from the supplied tree (2026-10-06):
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
 * it found still moving. Until 2026-10-02 the `verify` leg did the reverse,
 * and uiautomator reports LIVE bounds during an animation, so a tree read
 * before the wait could carry mid-animation rects against a settled png.
 *
 * When the tree is SUPPLIED (`tree`, the color and ocr asserts), the caller
 * owns its freshness and it predates the wait by one poll round's read. That
 * is acceptable where it happens because the poll retries: a crop that lands
 * wrong on a frame that settled after the read fails this round and the next
 * round reads a tree of the settled screen. Its `region`, when given, is
 * the rect the wait judges stability over (header, 2026-10-06).
 *
 * The residual race of png-then-tree, recorded 2026-10-02: the screen can
 * change BETWEEN the stable pair and the tree read — a toast, a late async
 * render — and on Android that window is a whole uiautomator dump, seconds
 * long. It is rarer than the old order's race, which needed only an
 * animation already in flight; this one needs a NEW change to begin after
 * two identical captures. The cheap mitigation — one confirming capture
 * after the tree read, a note on the frame when it differs — was rejected
 * here because it is a tree-read/poll concern (which capture confirms what)
 * and the step that owns those primitives should decide it, not this one.
 *
 * The scale is derived once both halves are in hand; the device screen is
 * asked for only then, and a failed read degrades to the tree (the pre-0.6
 * derivation, still correct for every root-bearing capture) rather than
 * failing the frame.
 */
export function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions & ({ readTree: true } | { tree: UiNode }),
): Promise<TreeRequestedFrame>;
export function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  opts?: CaptureOptions,
): Promise<Frame>;
export async function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions = {},
): Promise<Frame> {
  const region = opts.tree !== undefined && opts.region !== undefined ? { rect: opts.region, tree: opts.tree } : undefined;
  // `wait` is everything the frame says about itself (shot, stability, how it
  // settled, captures); only the measured half is added below.
  const { png: waitPng, ...wait } = await stableScreenshot(adapter, opts.deadline, region);
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
  let png: PNG;
  try {
    // A shot the region check already decoded (settled or moving) is not decoded twice.
    png = waitPng ?? PNG.sync.read(shot);
  } catch (e) {
    return {
      ...wait,
      measured: {
        tree,
        error:
          `screenshot PNG decode failed: ${errorMessage(e)} — re-run; if it repeats, the device is returning ` +
          'something other than a PNG (check `adb exec-out screencap -p` / `xcrun simctl io <udid> screenshot` by hand)',
      },
    };
  }
  // Memoized inside the adapter (adapters/types.ts), so this is a device read
  // once per adapter, not once per frame.
  const screen = await adapter.viewport().catch(() => undefined);
  return { ...wait, measured: measuredFrameFor(tree, png, screen) };
}

/**
 * The pure tail of `captureFrame`: a tree, a decoded png and (when the
 * device would say) its screen become the ONE measured frame — the scale
 * derived once, a throwing geometry walk carried as the scale's failure
 * reason. `screen` undefined → the scale comes from the tree, with the
 * scale's own note saying so (verify/scale.ts). Exported since 2026-10-04
 * so the comparator tests build their fixtures through the same derivation
 * production uses: until then
 * color-parity.test.ts and text-parity.test.ts each re-spelled this line as
 * `{ tree, png, scale: pngScale(tree, png.width, png.height, screen) }`, so
 * a change to what the capture feeds the scale (the oriented screen, a
 * caught throw) would have left the comparator tests green against fixtures
 * built the old way — the shape of the 2026-08-26 ocr-crop-scale bug, which
 * was a dropped field at the call site, not a wrong unit. The two failure
 * arms (`Undecoded`, `Treeless`) are decided before this tail and need
 * nothing from it.
 */
export function measuredFrameFor(tree: UiNode, png: RgbaImage, screen?: DeviceScreen): MeasuredFrame {
  let scale: PngScale;
  try {
    scale = pngScale(tree, png.width, png.height, screen);
  } catch (e) {
    // The geometry walk assumes a well-formed tree. A node without children
    // or a pathological depth must fail THIS frame's scale, not the leg: the
    // walk used to run inside the parity tables' containment, and moving it
    // here must not widen what a bad tree can take down.
    scale = {
      error:
        `the png scale could not be derived from this tree: ${errorMessage(e)} — the tree is not well-formed; ` +
        'dump it with ui_snapshot and re-run, and keep the dump if it repeats',
    };
  }
  return { tree, png, scale };
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
 * With a `region` (2026-10-06, the supplied-tree arm only), a pair whose
 * whole buffers differ gets a second question — do they match inside the
 * element's rect? — answered by `regionSettled` below; the header says what
 * it falls back to and why. Identical buffers never reach it, so a still
 * screen costs no decode and no device read, region or not. Each capture is
 * decoded at most once across the wait AND the frame: the later png of one
 * pair is the earlier of the next, and the returned shot's png — the settled
 * pair's later one, or a moving frame's last — is handed back so
 * `captureFrame` measures it without decoding the same bytes again.
 */
async function stableScreenshot(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'viewport'>,
  deadline?: number,
  region?: StabilityRegion,
): Promise<Pick<Frame, 'shot' | 'stability' | 'settledOver' | 'captures'> & { png?: PNG }> {
  const memo = lastDecodeMemo();
  let previous = await adapter.screenshot();
  let captures = 1;
  let recaptureMs = 0; // measured cost of the last re-capture (delay + screencap); 0 until one has run
  for (let i = 0; i < STABILITY_ATTEMPTS; i++) {
    if (deadline !== undefined && Date.now() + recaptureMs >= deadline) break;
    const started = Date.now();
    await sleep(STABILITY_DELAY_MS);
    const current = await adapter.screenshot();
    captures += 1;
    if (current.equals(previous)) return { shot: current, stability: 'settled', settledOver: 'screen', captures };
    if (region !== undefined) {
      const png = await regionSettled(adapter, region, memo.decode(previous), memo.decode(current));
      if (png !== undefined) return { shot: current, stability: 'settled', settledOver: 'region', captures, png };
    }
    // Taken AFTER the region check (review 2026-10-06): its decode is part of
    // what the next re-capture will cost. The fast path above returns first,
    // so a still screen's count and sleeps are untouched.
    recaptureMs = Date.now() - started;
    previous = current;
  }
  // The ONE place "one capture is no verdict" is decided (2026-10-05): a
  // consumer reads `stability`, never the count.
  return { shot: previous, stability: captures < 2 ? 'unjudged' : 'moving', captures, png: memo.decoded(previous) };
}

/** The caller's element for a region-judged wait: its rect, and the tree that rect (and, when the device will not say, the scale) comes from. */
interface StabilityRegion {
  rect: Rect;
  tree: UiNode;
}

/**
 * Do two differing captures match inside the element's region? The later
 * png when they do; `undefined` — the whole-screen answer, "different" —
 * whenever the question cannot be answered: a png that did not decode, two
 * pngs of different sizes, a scale that carries an error, a rect that lands
 * nowhere on the png. The scale is the one the measured frame will carry
 * (`measuredFrameFor`: the device screen when the adapter will say it — a
 * memoized read, so once per adapter — the tree otherwise), and the rect is
 * landed with `pngRegion` and no inset, so the compare covers every pixel
 * the ocr crop reads and more than the colour sampler's inset one.
 */
async function regionSettled(
  adapter: Pick<DeviceAdapter, 'viewport'>,
  region: StabilityRegion,
  earlier: PNG | undefined,
  later: PNG | undefined,
): Promise<PNG | undefined> {
  if (earlier === undefined || later === undefined) return undefined;
  if (earlier.width !== later.width || earlier.height !== later.height) return undefined;
  const screen = await adapter.viewport().catch(() => undefined);
  const { scale } = measuredFrameFor(region.tree, later, screen);
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
 * A decoder that remembers its last answer: in the stability wait the later
 * capture of one pair is the earlier of the next, so each capture is decoded
 * once. `decode` never throws — a png that does not decode is `undefined`,
 * the region check's fallback; the capture's own decode words that failure.
 * `decoded` only looks: the png of a shot already decoded, else `undefined`
 * (never decoded, or did not decode), and the frame decodes it itself.
 */
function lastDecodeMemo(): { decode: (shot: Buffer) => PNG | undefined; decoded: (shot: Buffer) => PNG | undefined } {
  let last: { shot: Buffer; png: PNG | undefined } | undefined;
  return {
    decode: (shot) => {
      if (last?.shot !== shot) {
        let png: PNG | undefined;
        try {
          png = PNG.sync.read(shot);
        } catch {
          png = undefined;
        }
        last = { shot, png };
      }
      return last.png;
    },
    decoded: (shot) => (last?.shot === shot ? last.png : undefined),
  };
}

/**
 * Bounded-retry tree read for the tree half of a captured frame: right after
 * a flow settles, a device can transiently fail to produce a tree
 * (uiautomator "null root node") — the same transient the polling asserts
 * absorb via readTreeOrError. Throws after the last attempt with the
 * underlying error in the message; `captureFrame` carries that on the frame.
 */
async function readTreeWithRetry(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  budget: { attempts: number; delayMs: number },
): Promise<UiNode> {
  let last: string | undefined;
  for (let i = 0; i < budget.attempts; i++) {
    if (i > 0) await sleep(budget.delayMs);
    try {
      return await adapter.uiTree();
    } catch (e) {
      last = errorMessage(e);
    }
  }
  throw new Error(`UI tree read failed after ${budget.attempts} attempts: ${last ?? 'unknown error'}`);
}

/** Pixel bounds in the png, half-open. */
export interface PngBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rect landed in the png: its bounds, plus how much of it fell outside. */
export interface PngRegion extends PngBounds {
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
  const cx0 = Math.max(x0, 0);
  const cy0 = Math.max(y0, 0);
  const cx1 = Math.min(x1, png.width);
  const cy1 = Math.min(y1, png.height);
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return undefined;
  const full = (x1 - x0) * (y1 - y0);
  const clipped = full > 0 ? 1.0 - ((cx1 - cx0) * (cy1 - cy0)) / full : 0.0;
  const iw = cx1 - cx0;
  const ih = cy1 - cy0;
  const ix = Math.min(Math.floor(iw * inset), Math.floor((iw - 1) / 2));
  const iy = Math.min(Math.floor(ih * inset), Math.floor((ih - 1) / 2));
  return { x0: cx0 + ix, y0: cy0 + iy, x1: cx1 - ix, y1: cy1 - iy, clipped };
}

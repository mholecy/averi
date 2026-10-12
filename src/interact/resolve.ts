import { rectArea, type DeviceAdapter, type Point, type Rect, type Selector, type UiNode } from '../adapters/types.js';
import { drawOrder } from '../ui-tree/draw-order.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { containsPoint, cutSliver, drawnOverText, higherTop, insideScroller, rectText, scrollersOf, visibleFractionInViewport, type Cut, type Edge } from '../ui-tree/geometry.js';
import { pollTimeoutMessage, pollTree, readTreeOrError } from '../ui-tree/read-tree.js';
import { findAll, findBySpec, preferInteractive, tapPoint } from '../ui-tree/selectors.js';
import { belowStatusBand, inStatusBand, judgingScreen, REVEALS, type JudgingScreen } from './swipe.js';

/**
 * The interaction module (interact/): what it takes to ACT on an element —
 * resolve, tap, fill, scroll, swipe — written once for both callers, the flow
 * engine's steps and the MCP tools.
 *
 * Before 2026-10-03 this logic lived in flow/engine.ts (as private methods
 * and exported free functions) and in ui-tree/tap-element.ts, and the two
 * callers had two resolution policies for the same user operation: a flow
 * `tap:` waited for a zero-area-filtered, rect-stable node and preferred the
 * interactive match, while the MCP `tap` tool read the tree once, kept
 * zero-area nodes and threw on ambiguity. The engine re-stated the zero-area
 * filter three times. The deletion test on the old shape: delete the
 * engine's settledNode and the MCP tools' resolveOne and the policy reappears
 * in every caller — which is what makes it a module, not a helper.
 *
 * Layering: interact sits between flow and verify (ARCHITECTURE.md §2). It
 * imports ui-tree, adapters and util only; it knows no averi.yaml type (the
 * engine converts its YAML spec — `timeout: 2s` — before calling), and no
 * MCP schema. Options are plain milliseconds with the defaults the callers
 * had.
 */

/**
 * What a caller points at: a selector string (the MCP tools' vocabulary,
 * `'id:login_button'`) or an ElementSpec (the flow descriptors'). Resolution
 * is the same either way; only the lookup differs.
 */
export type Target = Selector | ElementSpec;

export const describeTarget = (target: Target): string =>
  typeof target === 'string' ? target : describeElementSpec(target);

/** Every match, unfiltered — resolveNow is the policy over them, and `scroll_until` judges them through `matchesToJudge`. */
export const findTarget = (tree: UiNode, target: Target): UiNode[] =>
  typeof target === 'string' ? findAll(tree, target) : findBySpec(tree, target);

/**
 * THE preference among a target's matches, before the caller's Ambiguity:
 * zero-area nodes are never targets, and among several survivors a sole
 * interactive one wins (preferInteractive, with its note). `chosen` when
 * that leaves one node — the node a tap acts on whatever its Ambiguity —
 * else the `survivors`: none, or several for the Ambiguity to decide.
 * One owner since code review P2 (2026-10-09): `resolveNow` and
 * `scroll_until`'s judgement (`matchesToJudge`) both read it.
 */
export function preferred(found: readonly UiNode[]): { chosen: UiNode; note?: string } | { survivors: UiNode[] } {
  const survivors = found.filter((n) => n.rect.width > 0 && n.rect.height > 0);
  if (survivors.length === 1) return { chosen: survivors[0] };
  const pick = survivors.length > 1 ? preferInteractive(survivors) : undefined;
  return pick === undefined ? { survivors } : { chosen: pick.node, note: pick.note };
}

/**
 * The matches `scroll_until` judges (interact/scroll.ts, code review P2,
 * 2026-10-09): the one a tap would act on when the preference picks one
 * (`preferred`) — so the stop and the next tap judge the SAME node by
 * construction — else every match, as found. Until then the scroll judged
 * every match and stopped on the one more of which showed: an id on a
 * container and on its button stopped on the container ("PARTLY UNDER …,
 * its centre clear"), and the tap that followed acted on the button and
 * was refused under the bar. With several matches and no preference the
 * scroll still judges them all (the MCP tap refuses such a selector; the
 * flow's `ambiguous: 'first'` tap takes the first — a stop on another is
 * the residual, stated).
 */
export function matchesToJudge(tree: UiNode, target: Target): UiNode[] {
  const found = findTarget(tree, target);
  const pick = preferred(found);
  return 'chosen' in pick ? [pick.chosen] : found;
}

/** A node the caller may act on, plus how it was chosen when the choice was not forced. */
export interface Resolved {
  node: UiNode;
  /** Set when several nodes matched: which one was picked and why. */
  note?: string;
}

/**
 * The default budget for "appear and hold still": the flow engine's tap
 * budget (config.ts documents it as 5 s on a `tap:` step), and since
 * 2026-10-03 the MCP tap/type_text tools' too. Named once, here, because the
 * wait is this module's.
 */
export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/** Cadence for the settle poll and the fill's value poll when the caller has none of its own. */
export const DEFAULT_POLL_MS = 500;

/**
 * What to do when the policy's tie-breakers are spent and several nodes
 * still match. No default, on purpose: the choice is the caller's contract
 * with its user and must be stated where it can be read.
 *
 * - `'first'`: pick the first survivor and say so in the note. The flow
 *   engine's documented policy — a descriptor's selectors are written
 *   against a known app, and a flow that must not guess can say `role:`.
 * - `'refuse'`: throw, naming the candidates. The MCP tools' policy: an
 *   agent typing a password into `role:textfield` on a two-field login must
 *   be stopped, not told "Filled" with the choice buried in parentheses
 *   (review 2026-10-03). The wording is the pre-interact `resolveOne` one
 *   plus a recovery line saying how to narrow the selector.
 */
export type Ambiguity = 'first' | 'refuse';

/**
 * The `'refuse'` mode's error, as a class of its own (2026-10-03) so a caller
 * that adds context to a failed resolution can tell a refusal — whose FIRST
 * line is the finding and must stay the headline — from a timeout, without
 * reading the message. Same message, same `Error` to everyone else.
 */
export class AmbiguityRefusal extends Error {}

/**
 * The target was never there (2026-10-08): no round of the wait that threw
 * it resolved the target at all — every tree that was read lacked an
 * actionable match. The one fact about an element that only this module
 * knows, as a class of its own so a caller that must tell "absent" from
 * "found, then something went wrong" reads it instead of guessing.
 *
 * Its one reader is the flow engine's `optional:` block, the only place
 * where absence is not a failure. Until this class it deduced absence from
 * missing evidence — its own presence poll for a tap, and for every other
 * step "any error but the one class known to have found the element" — so a
 * fill whose field was found and tapped, but whose text never landed, was
 * logged "skipped step (not present)", and every new failure-after-finding
 * needed one more `instanceof` there. Now an optional step is "(not
 * present)" exactly when this is what it threw, and anything else is
 * skipped with its own headline — save an error carrying the
 * RefusedOnPresentElement marker (`isRefusedOnPresentElement`, since
 * 2026-10-09), which fails the flow.
 *
 * Deliberately narrow:
 * - A wait whose LAST read failed does not throw it — neither one that read
 *   no tree at all nor one that read a few and then lost the device: the
 *   last read's error is the fresher fact (the rule pollTimeoutMessage
 *   applies to its hint, ui-tree/read-tree.ts), and "not present" would be
 *   a claim about a screen nobody could see at the end. That timeout stays
 *   a plain Error with the read error beneath its headline, so a dead
 *   device never reads "(not present)" in an optional skip.
 * - "Found, but never held still" is not this either — the element was
 *   there; resolveSettled words that case on its own.
 * - An AmbiguityRefusal is thrown at once, by resolveNow, and is a selector
 *   problem, never absence.
 * - Only the error a caller receives counts. A KeyboardGuardError that
 *   wraps one as its `cause` (the target not coming back after the guard
 *   pressed `back` or tapped a dismissal) is not absence: something was
 *   sent by then, and its own headline says what.
 *
 * Same message shape as every poll timeout (pollTimeoutMessage); same
 * `Error` to every caller that does not ask — the MCP tools print the
 * message as before.
 */
export class ElementNotFoundError extends Error {}

export interface ResolveOptions {
  ambiguous: Ambiguity;
}

export interface SettleOptions extends ResolveOptions {
  /** How long the element may take to appear AND hold still (for resolvePresent: to appear). Default DEFAULT_SETTLE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Pause between tree reads. Default DEFAULT_POLL_MS. */
  pollMs?: number;
}

/**
 * The one resolution policy, applied to one tree: zero-area nodes are never
 * targets (a collapsed or not-yet-laid-out view carries the id but no
 * surface to tap), and among several survivors a sole interactive one wins —
 * on iOS a field's title and error labels share the field's identifier — with
 * the note preferInteractive produces. What happens when that still leaves
 * several is the caller's `ambiguous` mode (see Ambiguity); a refusal throws
 * at once, since ambiguity is a selector problem, never a screen settling.
 * `undefined` means nothing actionable is in this tree yet.
 *
 * One-shot and pure: the fill's value poller re-reads the field through this
 * between keystrokes and must not wait for anything.
 */
export function resolveNow(tree: UiNode, target: Target, opts: ResolveOptions): Resolved | undefined {
  const pick = preferred(findTarget(tree, target));
  if ('chosen' in pick) return { node: pick.chosen, ...(pick.note !== undefined && { note: pick.note }) };
  const candidates = pick.survivors;
  if (candidates.length === 0) return undefined;
  const summary = (sep: string) =>
    candidates
      .slice(0, 5)
      .map((n) => `${n.role} id=${n.identifier} label=${JSON.stringify(n.label)}`)
      .join(sep);
  if (opts.ambiguous === 'refuse') {
    throw new AmbiguityRefusal(
      `Selector matches ${candidates.length} elements: ${describeTarget(target)}\n  ${summary('\n  ')}` +
        `\nNarrow it (add role:, id: or an exact text:) so exactly one element matches`,
    );
  }
  return {
    node: candidates[0],
    note: `${candidates.length} matches, none uniquely interactive; picked the first (${summary('; ')})`,
  };
}

/**
 * A settled resolution, with the tree it came from (2026-10-07): the second
 * of the two reads that agreed on the rect, the whole of it. The keyboard
 * guard (keyboard.ts) reads the soft keyboard off it on a platform whose
 * keyboard is in the tree — the one reading that costs no device read,
 * because this read already happened. Only resolveSettled hands it out:
 * resolveNow is the one-shot policy over a tree the caller already holds.
 */
export interface ResolvedSettled extends Resolved {
  tree: UiNode;
}

/**
 * Wait for the target to resolve to a node whose rect is identical in two
 * consecutive tree reads — screens animate on launch and transition, and a
 * tap mid-animation lands on whatever moved into that spot — then return it,
 * with the tree of that second read.
 * The rect comparison restarts whenever a round finds nothing: a node that
 * vanishes and returns has to prove it holds still again.
 *
 * Throws the shared poll-timeout wording, in one of two sentences since
 * 2026-10-08 — until then both read "(visible and settled)", so an element
 * that was never on screen looked like one that would not stop moving:
 * - no round resolved the target: ElementNotFoundError, "…waiting for element
 *   X to appear" (when the last read succeeded; see ElementNotFoundError for why
 *   a wait whose last read failed is a plain Error with the same wording);
 * - some round did, but no two consecutive ones agreed on its rect (it kept
 *   moving, or kept vanishing): a plain Error, "…waiting for element X to
 *   hold still (found, but never at the same position in two consecutive
 *   reads)".
 * - the last tree read resolved it after a read that did not (or as the
 *   first read): a run of ONE sighting, with no second read within the
 *   budget to compare it with (2026-10-09, docs/bugs/2026-10-09-hold-still-
 *   timeout-after-one-read-blames-a-moving-element.md: WDA's start-up,
 *   ≈4–5 s, spent the 5 s budget inside the first read of a static title;
 *   code review of round 7: a target seen, gone, then seen again on a slow
 *   last read is the same shape). One more read is taken past the deadline
 *   — the slack pollTree's last round already has: the same rect settles
 *   it, a different one is the movement above, worded as such ("never at
 *   the same position in two consecutive reads": the late read and the one
 *   before it disagreed — reviewed and kept, code review of round 7 D2).
 *   Otherwise a plain Error that
 *   says what happened, never that two reads disagreed: "…to hold still
 *   (found once, but no second read came within the budget to confirm its
 *   position)" when the late read failed, "…(found once; the one read after
 *   the budget did not find it again)" when it read a tree without it —
 *   "found on the last read" in place of "found once" when an earlier run
 *   had seen it too.
 * The read error, when the last round could not read a tree, rides beneath
 * either so a dead device never looks like a slow screen.
 */
export async function resolveSettled(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  target: Target,
  opts: SettleOptions,
): Promise<ResolvedSettled> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  let lastRect: string | undefined;
  let sighted = false;
  let sightings = 0;
  let run = 0; // consecutive rounds that resolved it, up to the last tree read
  let zeroHint: string | undefined;
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
      zeroHint = resolved === undefined ? zeroAreaHint(tree, target) : undefined;
      if (resolved === undefined) {
        lastRect = undefined;
        run = 0;
        return undefined;
      }
      sighted = true;
      sightings++;
      run++;
      const rect = JSON.stringify(resolved.node.rect);
      if (rect === lastRect) return { ...resolved, tree };
      lastRect = rect;
      return undefined;
    },
    { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS },
  );
  if (!outcome.timedOut) return outcome.value;
  let { readError } = outcome;
  // A run of one: the last tree read saw it, the one before it did not.
  if (run === 1) {
    const late = await readTreeOrError(adapter);
    readError = late.error; // the late read is now the last one
    const resolved = late.tree === undefined ? undefined : resolveNow(late.tree, target, opts);
    if (late.tree !== undefined && resolved !== undefined && JSON.stringify(resolved.node.rect) === lastRect) return { ...resolved, tree: late.tree };
    if (resolved === undefined) {
      const found = sightings === 1 ? 'found once' : 'found on the last read';
      const after =
        late.tree === undefined
          ? `${found}, but no second read came within the budget to confirm its position`
          : `${found}; the one read after the budget did not find it again`;
      throw new Error(pollTimeoutMessage(`element ${describeTarget(target)} to hold still (${after})`, timeoutMs, readError));
    }
  }
  if (sighted) {
    throw new Error(
      pollTimeoutMessage(
        `element ${describeTarget(target)} to hold still (found, but never at the same position in two consecutive reads)`,
        timeoutMs,
        readError,
      ),
    );
  }
  throw notFound(target, timeoutMs, outcome, zeroHint);
}

/** What a wait that gave up saw of its target — the evidence absenceError judges. */
export interface WaitEvidence {
  /** Some round matched the target (resolveSettled: resolved it; scroll_until: any match, any swipe). */
  sighted: boolean;
  /** How many rounds read a tree at all. */
  treesRead: number;
  /** The LAST read's error, when the last read failed. */
  readError?: Error;
}

/**
 * THE rule for when a wait that gave up is absence (2026-10-08, one owner
 * for resolveSettled, resolvePresent and scroll.ts's scroll_until):
 * ElementNotFoundError when no round matched the target, at least one tree
 * was read and the last read succeeded; a plain Error with the same
 * message otherwise — the element was seen, or nobody could see the screen
 * at the end (see ElementNotFoundError). The caller words the message.
 */
export function absenceError(message: string, seen: WaitEvidence): Error {
  return !seen.sighted && seen.treesRead > 0 && seen.readError === undefined ? new ElementNotFoundError(message) : new Error(message);
}

/**
 * A wait that never resolved its target, worded for what it waited for —
 * nothing about settling. `zeroHint`: the last tree read matched the
 * target, but only with zero-area nodes (2026-10-08,
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md: idb reports a
 * node scrolled above the top of a scroll view as 0×0, and the wait read
 * "to appear" for a node the snapshot showed). The hint says so beneath the
 * headline (pollTimeoutMessage drops it when the last read failed). Still
 * absence for ElementNotFoundError's purpose — nothing was ever ACTIONABLE,
 * and a collapsed view, the case the zero-area rule was written for, carries
 * its id at 0×0 too, which is why the hint names both (`zeroAreaHint`
 * words it, and names the side when Android dumped them clipped out).
 */
function notFound(target: Target, timeoutMs: number, outcome: { readError?: Error; treesRead: number }, zeroHint?: string): Error {
  return absenceError(pollTimeoutMessage(`element ${describeTarget(target)} to appear`, timeoutMs, outcome.readError, zeroHint), {
    sighted: false,
    ...outcome,
  });
}

/** The hint beneath a never-resolved wait whose last tree matched the target only at 0×0. */
export const ZERO_AREA_HINT = 'it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first';

/** Where a node clipped out past each side of its container lies; the scroll_until direction that brings it back is swipe.ts#REVEALS'. */
const CLIPPED_OUT_WHERE: Readonly<Record<Edge, string>> = { top: 'above', bottom: 'below', left: 'left of', right: 'right of' };

/** The same sides as `CLIPPED_OUT_WHERE`, standing alone: `if it lies above` (`untriedSideText`). */
const LIES_WHERE: Readonly<Record<Edge, string>> = { top: 'above', bottom: 'below', left: 'to the left', right: 'to the right' };

/**
 * Where a node read wholly past `side` lies — `clipped out above its scroll
 * container` when Android dumped it so (UiNode.clippedOut), `above the
 * viewport` when its rect lies there — the one wording of it, for this
 * wait's hint and `scroll_until`'s failure (scroll-text.ts, 2026-10-12,
 * round 8's B1 gap).
 */
export function pastSideText(side: Edge, clippedOut: boolean): string {
  return clippedOut ? `clipped out ${CLIPPED_OUT_WHERE[side]} its scroll container` : `${CLIPPED_OUT_WHERE[side]} the viewport`;
}

/** The scroll that brings back a node lying past `side`: `scroll_until it with direction: "up"` (swipe.ts#REVEALS). */
export const revealText = (side: Edge): string => `scroll_until it with direction: "${REVEALS[side]}"`;

/** The direction to try for a target that may lie past `side` and was never read there: `if it lies above, try direction: "up"`. */
export function untriedSideText(side: Edge): string {
  return `if it lies ${LIES_WHERE[side]}, try direction: "${REVEALS[side]}"`;
}

/**
 * The hint for a target this tree matched, but only with zero-area nodes —
 * resolveNow's filter, the reason it answered `undefined` — or undefined
 * when it matched nothing (or something resolveNow took). When every such
 * match was dumped clipped out of its scroll container (Android's inverted
 * bounds, adapters/types.ts#UiNode.clippedOut, 2026-10-09: Settings' `Apps`
 * under the collapsing app bar read "0×0" for a `126x-239` node), it says
 * where, and the direction that scrolls it back when they agree; else
 * ZERO_AREA_HINT.
 */
function zeroAreaHint(tree: UiNode, target: Target): string | undefined {
  const matched = findTarget(tree, target);
  if (matched.length === 0) return undefined;
  const sides = new Set(matched.map((n) => n.clippedOut));
  if (sides.has(undefined)) return ZERO_AREA_HINT;
  const [only, ...more] = [...sides] as Edge[];
  if (more.length > 0) return `it matched only nodes clipped out ${[only, ...more].map((side) => CLIPPED_OUT_WHERE[side]).join(' or ')} its scroll container — scroll_until it first`;
  return `it matched only nodes ${pastSideText(only, true)} (scrolled past it) — ${revealText(only)} first`;
}

/**
 * Wait only for the target to APPEAR — one round that resolves it under the
 * same policy as resolveSettled (resolveNow: zero-area nodes are never
 * targets, so a ghost node cannot pass), no settling — and return that
 * sighting. Throws ElementNotFoundError (or, when the last read failed, a plain
 * Error) in resolveSettled's never-found wording.
 *
 * The flow engine's optional tap is its caller (2026-10-08, moved here from
 * the engine's own presence poll so the "found" fact has one owner): its
 * budget bounds the presence check only, because a settle needs two reads
 * and one Android dump alone can outlast the optional budget (2026-08-19).
 * pollTree always completes one read before its deadline is checked, so a
 * budget shorter than one read still gets one honest look.
 */
export async function resolvePresent(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  target: Target,
  opts: SettleOptions,
): Promise<Resolved> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  let zeroHint: string | undefined;
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
      zeroHint = resolved === undefined ? zeroAreaHint(tree, target) : undefined;
      return resolved;
    },
    { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS },
  );
  if (!outcome.timedOut) return outcome.value;
  throw notFound(target, timeoutMs, outcome, zeroHint);
}

// ─── On screen ───────────────────────────────────────────────────────────────

/**
 * The typed marker for "the target was FOUND, and this module refused to tap
 * it" (2026-10-09): the element resolved — it is in the tree, on the screen
 * the author meant — on every look the refusal rests on, and a rule of this
 * module, not its absence, is why nothing was tapped. Carried by:
 * - PresentElementRefusal's subclasses, the tap rules on a resolved node:
 *   OffScreenRefusal, CoveredRefusal and ClippedRefusal (behind `tapElement` and
 *   `fillField`'s focus tap). These may follow the keyboard guard's own
 *   `back` or dismissal tap — the target was resolved again after it, and
 *   it is still there.
 * - The keyboard guard's refusals that sent NOTHING with the target resolved
 *   on both looks: KeyboardStateDisagreement (keyboard-window.ts) and
 *   KeyboardWithoutDismissal (keyboard-in-tree.ts) — but not the latter when
 *   its second look did not resolve the target again (its flag is false).
 *
 * Its one reader is the flow engine's `optional:` block
 * (docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md,
 * item 3): an optional step is skipped only when its element is absent, and
 * one refused on a present element FAILS the flow — the interstitial is
 * there, and skipping it ran the flow on into the ladder's destructive rung
 * (on iOS the same with the keyboard up over LOGIN and no dismissal).
 *
 * Deliberately NOT carried by:
 * - AmbiguityRefusal: a selector finding, and a flow resolves with `'first'`
 *   (flow/engine.ts, FLOW_AMBIGUITY), so a flow never sees it.
 * - AfterKeyboardDismissal and AfterDismissalTap: thrown after a `back` or a
 *   dismissal tap whose effect is unknown (back may have navigated, the
 *   target may not have come back) — whether the element is still there is
 *   not known. An `optional:` skips them with their headline.
 * - ElementNotFoundError, of course, and a zero-area-only match, which is
 *   one (nothing ACTIONABLE was ever there).
 */
export interface RefusedOnPresentElement {
  readonly refusedOnPresentElement: boolean;
}

/** Does `e` carry the marker (RefusedOnPresentElement) — a tap refused on an element that was there? */
export const isRefusedOnPresentElement = (e: unknown): e is Error & RefusedOnPresentElement =>
  e instanceof Error && (e as Partial<RefusedOnPresentElement>).refusedOnPresentElement === true;

/** The base of the tap rules' refusals on a resolved node — each carries the marker (RefusedOnPresentElement). */
export class PresentElementRefusal extends Error implements RefusedOnPresentElement {
  readonly refusedOnPresentElement = true;
}

/**
 * The target resolved and settled, but the point a tap on it would press —
 * its centre, `tapPoint` — lies outside the screen (2026-10-08,
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md). Measured on
 * iOS 27 (idb, 402×874 pt): the tree lists a scroll view's content below the
 * fold with its real rects (y 885, y 1157), the tap went to (94,895), landed
 * nowhere, and the reply said "Tapped" — the next `type_text` typed into the
 * field that still had focus. The target itself is never tapped.
 *
 * A class of its own, like AmbiguityRefusal, because it is neither of the
 * wait's failures: the element WAS found (never ElementNotFoundError — an
 * `optional:` tap of it is not skipped since 2026-10-09: it fails the flow,
 * see PresentElementRefusal), and nothing is moving. The remedy is in the
 * message: scroll it in first. When the keyboard guard had already sent
 * something (a `back`, a dismissal tap), the HEADLINE says what — the one
 * line the step's ✗ quotes.
 */
export class OffScreenRefusal extends PresentElementRefusal {}

/** The screen a tap point is judged against: `swipe.ts#judgingScreen` — the box a reply quotes and the boxes that count. */
export type TapScreen = JudgingScreen;

/**
 * The screen for the on-screen rule: `swipe.ts#judgingScreen`, the one
 * owner of "the device's screen as the tree's coordinates see it" for a
 * judgement — the device's `viewport()` (memoized by the adapter; in the
 * tree's units, px on Android, pt on iOS), turned when `tree`'s window says
 * the screen is held sideways, the tree's window when the device size
 * cannot be read, and the boxes a point may lie in (`ScreenBox.boxes`: the
 * box, or the box either way up when a turn is suggested but not
 * witnessed). `scroll_until`'s stop reads the same, so the two agree.
 *
 * `undefined` — no box at all — leaves the judgement to the tree's root rect
 * (`onScreen`), and with no root rect either the tap goes ahead as it did
 * before the rule existed: the keyboard guard's fail-open rule
 * (keyboard.ts). The rule exists to stop a false "Tapped", and must never
 * be why a tap on a device that could not report its size did not happen.
 */
export const tapScreen = (adapter: Pick<DeviceAdapter, 'viewport'>, tree: UiNode): Promise<TapScreen | undefined> => judgingScreen(adapter, { tree });

/**
 * THE on-screen rule for a point about to be tapped (2026-10-08) — the
 * target's centre (`refuseOffScreen`) and a configured keyboard dismissal's
 * (keyboard-in-tree.ts#pickDismissal: WDA keeps off-screen nodes, a title
 * scrolled above the top is still in the tree). One owner since the review
 * of the off-screen refusal: the picker had judged by the root's rect alone.
 *
 * - Inside any of the screen's `boxes` (swipe.ts#ScreenBox.boxes has the
 *   rule): the box alone when a window witnessed the orientation; the box
 *   EITHER way up when a window's own sides, or a walked-width turn,
 *   suggest a turn no window witnessed; the panel as built otherwise (review 2026-10-08, B1: refusing on a guessed turn
 *   refused every tap past x 402 in an idb landscape tree whose window a
 *   straddling card made unreliable, an iPad strip, a walked-width turn).
 *   A portrait carousel page at x 450 of 402 is refused even when its
 *   straddling neighbour makes the window unreliable (the review's item 1:
 *   until then every unwitnessed box was judged either way up). What is
 *   still given up: on a screen whose turn is suggested but not witnessed,
 *   a point inside the other orientation only. The measured case — below
 *   the fold, (94,895) on 402×874 — lies outside both and is refused.
 * - No screen at all: inside the tree's root rect when it has one; with
 *   none, on screen (fail open).
 *
 * - On iOS, never in the status band at the top of a portrait box
 *   (adapters/ios-status-band.ts, reported with the device's screen, 2026-10-09: a tap at (201,6) went to the
 *   status bar, which scrolled the form to its top): that band is off the
 *   screen for a tap (swipe.ts#inStatusBand words the refusal).
 *
 * The point is the one SENT — `tapPoint` rounds — so a centre at x 401.5 on
 * a 402-wide screen is judged at 402, off it: that is where the tap would go.
 */
export function onScreen(point: Point, tree: UiNode, screen: TapScreen | undefined): boolean {
  if (screen === undefined) return rectArea(tree.rect) === 0 || containsPoint(tree.rect, point);
  return screen.boxes.some((box) => containsPoint(belowStatusBand(box, screen), point));
}

/**
 * iOS's status band as one clause — `under iOS's status bar at (201,6), in
 * the top 62 pt of the screen, where a tap goes to the status bar` — the
 * words for a point there, read by the tap's refusal (`refuseOffScreen`) and
 * by `scroll_until`'s failures (scroll-text.ts), so the two say the one fact
 * alike (code review of round 6, S5).
 */
export const underStatusBar = (at: Point, band: number): string =>
  `under iOS's status bar at (${at.x},${at.y}), in the top ${band} pt of the screen, where a tap goes to the status bar`;

/** The diagnosis of a target no scroll moves out from under iOS's status bar, in the tap's refusal (`statusBarRemedy`) and in `scroll_until`'s failure (scroll-text.ts) alike. */
export const PINNED_UNDER_STATUS_BAR = 'it is pinned under the status bar (a layout that ignores the safe area?)';

/**
 * What to do about a target whose centre lies under iOS's status bar, said
 * as far as the tree knows it (code review of round 6, P1: the refusal had
 * said `scroll_until it first` of a button pinned at the top, which no
 * scroll moves). In a scroll view (`scrolls`, ui-tree/geometry.ts
 * #insideScroller), `scroll_until` moves it out from under the bar; in none,
 * it is pinned there — a layout that ignores the safe area — and no step
 * reaches it; where the tree cannot say (idb's flat list), both. The
 * refusal stays a refusal either way — the safe direction, and terminal in
 * an `optional:` step (flow/engine.ts).
 */
export function statusBarRemedy(scrolls: boolean | undefined): string {
  const pinned = `no scroll moves it out: ${PINNED_UNDER_STATUS_BAR} — fix the layout, or tap something else`;
  if (scrolls === true) return 'it lies in a scroll view — scroll_until it first, to move it out from under the bar';
  if (scrolls === false) return `it lies in no scroll view, so ${pinned}`;
  return `if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, ${pinned}`;
}

/**
 * Refuse a tap whose point lies off the screen (OffScreenRefusal), or return
 * the screen it was judged against. The rule every tap on a resolved node
 * shares, applied by keyboard.ts#resolveClearOfKeyboard — behind
 * `tapElement` (the flow `tap:` step, the MCP `tap` tool) and `fillField`'s
 * focus tap — to the node it hands back.
 *
 * Judged on the tap POINT, not the rect: a node whose centre is on screen
 * is tapped as before, however much of it is clipped — by THIS rule: one
 * cut to a sliver by its scroll container is the cut-sliver rule's, judged
 * later (`refuseCutSliver`, 2026-10-10). A node partly on
 * screen with its centre off is REFUSED, not tapped at the centre of its
 * visible part: the smallest change that makes the reply true. Moving the
 * point would change what the keyboard guard judged (it tests the centre),
 * and the visible part of such a node is a sliver at a screen edge — on iOS
 * the bottom one is the home indicator's gesture zone, the top the status
 * bar — where a tap is least likely to reach the element. Its remedy is
 * `scroll_until … fully: true` (review 2026-10-08, M1: a plain
 * `scroll_until` then stopped on any intersection and handed back the same
 * clipped node); since code review P3 (2026-10-09) a plain one also goes on
 * until the centre is on the screen (scroll-rounds.ts#stops), so either
 * agrees with this rule.
 *
 * Before refusing, the device's screen is read AGAIN (`viewport({ fresh:
 * true })`, once, on this path only — the clear path costs nothing new):
 * the adapter memoizes the size for the session, and a fold, an unfold or a
 * `wm size` change would otherwise refuse taps for the server's life (review
 * 2026-10-08, M3; the same re-read verify/capture.ts makes before refusing a
 * window as wider than the screen). The refusal names the size read again
 * when it differs from the first. A fresh read that FAILS is dropped by the
 * memo (adapters/viewport-memo.ts), so `tapScreen` then asks the device once
 * more — one extra read on a refusal path, accepted.
 *
 * A point on the screen but inside iOS's status band (`onScreen`'s iOS
 * clause, 2026-10-09) is refused in its own words (`underStatusBar`, and
 * `statusBarRemedy`: scroll it out only where it can be) — since "off
 * screen" would contradict
 * a rect the reader sees on it.
 *
 * `sent`, when the keyboard guard acted before this look — `back was
 * pressed …`, `id:"login_title" was tapped …` (`Hiding.sent`) — fronts the
 * headline: the target was not tapped, but something was.
 */
export async function refuseOffScreen(
  adapter: Pick<DeviceAdapter, 'viewport'>,
  target: Target,
  node: UiNode,
  tree: UiNode,
  screen: TapScreen | undefined,
  sent?: string,
): Promise<TapScreen | undefined> {
  const at = tapPoint(node);
  if (onScreen(at, tree, screen)) return screen;
  try {
    await adapter.viewport({ fresh: true });
  } catch {
    // An unreadable size is screenBox's to handle (the tree's window stands in).
  }
  const again = await tapScreen(adapter, tree);
  if (onScreen(at, tree, again)) return again;
  const judged: TapScreen = again ?? screen ?? { box: tree.rect, boxes: [tree.rect] };
  const what = describeTarget(target);
  if (inStatusBand(at, judged)) {
    const band = `${underStatusBar(at, judged.statusBand ?? 0)} (rect ${rectText(node.rect)}) — ${statusBarRemedy(insideScroller(tree, node))}`;
    throw new OffScreenRefusal(sent === undefined ? `${what} is ${band}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${band}`);
  }
  const visible = Math.max(...judged.boxes.map((b) => visibleFractionInViewport(node.rect, b)));
  const size = `${judged.box.width}x${judged.box.height}`;
  const reread =
    again !== undefined && screen !== undefined && (again.box.width !== screen.box.width || again.box.height !== screen.box.height)
      ? ` (read again before refusing; it was ${screen.box.width}x${screen.box.height})`
      : '';
  const where = `at (${at.x},${at.y}) on a ${size} screen${judged.boxes.length > 1 ? ' either way up' : ''}${reread}`;
  const part =
    visible > 0
      ? ` — only ${Math.round(visible * 100)}% of it (rect ${rectText(node.rect)}) is on screen, and a tap goes to its centre — scroll_until it with fully: true first`
      : ` (rect ${rectText(node.rect)}) — scroll_until it first`;
  throw new OffScreenRefusal(
    sent === undefined ? `${what} is off screen ${where}${part}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is off screen ${where}${part}`,
  );
}

// ─── Clear of the app's chrome ───────────────────────────────────────────────

/**
 * The target resolved, settled, lies on screen and clear of the soft
 * keyboard, but the point a tap on it would press — its centre — lies under
 * a node drawn over it, and no piece of it large enough to aim at shows
 * (2026-10-09, docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-
 * chrome.md). Measured on mp-native's SWIFT form, both iOS tree sources:
 * `priority_select` at `24,771 354x52`, its centre (201,797) on the pinned
 * CONTINUE bar `24,780 354x44`; "Tapped" pressed the (disabled) bar, and an
 * enabled one would have submitted the payment form. Nothing is tapped.
 *
 * A class of its own, like OffScreenRefusal and for its reasons: the element
 * WAS found (an `optional:` tap of it fails the flow, never skipped — see
 * PresentElementRefusal), nothing is moving, and the remedy is in the message —
 * `scroll_until` it, which since the same date keeps scrolling until the
 * centre is clear (interact/scroll-rounds.ts#stops). When the keyboard guard
 * had already sent something, the HEADLINE says what.
 */
export class CoveredRefusal extends PresentElementRefusal {}

/**
 * The target resolved, settled, lies on screen, but it is CUT to a sliver by
 * its scroll container's edge (2026-10-10, docs/bugs/2026-10-09-android-tap-
 * on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md,
 * owner decision: refuse). Measured on mp-native's SWIFT form (Android): the
 * "Payment details" toggle, 132 px tall, read `66,1924 948x55` at the form's
 * bottom edge (1978); the tap went to (540,1952), "Tapped" was reported, and
 * the section did not expand — nor for hand taps on the strip. Nothing is
 * tapped. The covered sliver's sibling (CoveredRefusal): what shows is cut
 * by a clip, not by a node drawn over it, and refused by the same minimum.
 */
export class ClippedRefusal extends PresentElementRefusal {}

/**
 * THE cut-sliver rule for a node about to be tapped (2026-10-10, the bug
 * note above ClippedRefusal): refuse when the node is EVIDENTLY cut at a
 * clipping ancestor's edge (ui-tree/geometry.ts#cutSliver over
 * #evidentCut — flush with it within a pixel, its own content running on
 * past it; the shallowest such edge) and what shows of it across that edge
 * is under `minPiece` (draw-order.ts#MIN_TAP_PIECE_FRACTION,
 * `Exposure.minPiece`: the minimum that already refuses a sliver left by a
 * cover, 65 px on the Pixel_3a). A node that merely touches the edge with
 * nothing of it shown cut — a whole button at a form's end — is tapped as
 * before; so is a node deep enough across the edge, at its centre.
 *
 * Judged BEFORE the cover check, so a sliver also covered is refused for
 * its cut, whose remedy is a scroll toward the edge. The remedy is a plain
 * `scroll_until` toward that edge (`cutRemedy`): its plain stop does not
 * stop on such a sliver either (scroll-rounds.ts#stops, code review of
 * fix/r7-sliver, item 1), and its default direction is down, so a cut at the
 * bottom needs no direction and the others name theirs — and, for the
 * node that only READS cut (geometry.ts#evidentCut's residual: whole, its
 * own content running to the edge), the way past it: a child, or a
 * coordinate tap (code review round 3). Only nodes under a
 * clipping ancestor (UiNode.clipsDescendants, Android's) are asked: an iOS
 * tree has none, so this never refuses there. Applied inside the chrome
 * check rather than beside the on-screen rule (keyboard.ts) because the
 * minimum is the draw order's and the node judged must be the one the
 * guard hands back — the chrome check already has both. Cost: one walk of
 * the tree for the ancestor chain, and the node's subtree per flush edge.
 */
function refuseCutSliver(target: Target, node: UiNode, tree: UiNode, minPiece: number, sent?: string): void {
  const cut = cutSliver(node, scrollersOf(tree)(node), minPiece);
  if (cut === undefined) return;
  const finding =
    `${cutSliverText(cut, node.rect, minPiece)} — ${cutRemedy(cut.edge)} ` +
    `(if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it, or tap by coordinates)`;
  const what = describeTarget(target);
  throw new ClippedRefusal(sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`);
}

/**
 * THE sentence for a node cut to a sliver (`cutSliver`'s answer, `cut`, of a
 * node whose rect is `shown`): `cut at its scroll container's bottom edge
 * (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across
 * that edge, under the 65 a tap needs`. Said by the tap's refusal
 * (`refuseCutSliver`) and by `scroll_until`'s sliver failures
 * (scroll-text.ts) — one wording since the code review of round 7 (S8),
 * where the two had drifted apart ("to a 948x55 part, 55 deep across it").
 */
export function cutSliverText(cut: Cut, shown: Rect, minPiece: number): string {
  return (
    `cut at its scroll container's ${cut.edge} edge (container ${rectText(cut.container)}); only a ${shown.width}x${shown.height} part of it shows, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/** The remedy for a target cut at `edge`: a scroll toward where the rest of it lies (swipe.ts#REVEALS) — down, `scroll_until`'s default (scroll.ts), needs no word. Quoted by `scroll_until`'s sliver failures too (scroll-text.ts). */
export function cutRemedy(edge: Edge): string {
  const direction = REVEALS[edge];
  return direction === 'down' ? 'scroll_until it first' : `scroll_until it with direction: ${direction} first`;
}

/** Where a tap on a resolved node goes: its centre, or — `moved`, the sentence saying why — the centre of an uncovered piece of it. */
export interface Aim {
  point: Point;
  /** `at (201,767) — its centre (201,780) is under button "Continue to summary" (24,780 354x44), drawn over it; tapped the uncovered part 354x26`. */
  moved?: string;
}

/**
 * The flow trace's line for a tap that `Aim.moved`: `<what> tapped at
 * (201,767) — its centre …` — beside the clause it completes, so the clause
 * and its subject are worded in one place (code review S6; the fill's
 * focus tap says it as `focus tap …`, interact/fill-text.ts#focusTapNote,
 * and the MCP reply as `Tapped <selector> …`, mcp/tool-text.ts#tapText).
 */
export const movedTapText = (what: string, moved: string): string => `${what} tapped ${moved}`;

/**
 * THE chrome check for a point about to be tapped on a resolved node
 * (2026-10-09; the bug note's owner decision 1) — after, since 2026-10-10,
 * the cut-sliver rule (`refuseCutSliver`: a ClippedRefusal for a target its
 * scroll container cuts to a strip under the minimum below): the target's centre, unless
 * a node of the tree is drawn over it there — then the centre of the
 * largest piece of it nothing is drawn over, when both its sides reach the
 * minimum (ui-tree/draw-order.ts#exposure, its rows and MIN_TAP_PIECE_FRACTION),
 * said in `moved`; else a CoveredRefusal naming the cover. Applied by
 * keyboard.ts#resolveClearOfKeyboard LAST, to the node and tree it hands
 * back — after the on-screen rule and the keyboard guard, so neither of
 * their judgements changes: both are of the centre, and the centre is what
 * is tapped unless something is drawn over it.
 *
 * Judged in the screen box that holds the centre (`screen`, the on-screen
 * rule's; the tree's root rect, or the node's own, when there is none — fail
 * open, as there). The soft keyboard is no cover node — Android lists none,
 * and a band is believed only with its input method's word
 * (ui-tree/keyboard-cover.ts) — so it is asked for ONLY when the centre is
 * covered (`keyboardTop`: the top of a band the input method stands by, or
 * undefined), and the box cut above it before a piece is chosen: a piece
 * under the keyboard is never aimed at. Its cost is the reading's, on that
 * path only (on Android the touchable region and the witness, with the
 * keyboard shown; nothing more with it hidden — the guard's first reading
 * is reused). Under idb, whose reading is always `unknown`, the cut is at
 * the top of idb's keyboard band in the tree instead
 * (ui-tree/draw-order.ts#DrawOrder.keyboardBandTop, read off the draw
 * order the check already holds; round 7, 2026-10-10 — the
 * higher of the two when both read): M-1.4's refusal said "only a 354x7
 * part of it shows" of `value_date_select`'s strip 589–596, under the
 * band, between the lifted CONTINUE's reach and the keys. A line only: the
 * guard still reads no keyboard on idb, and a centre clear of every node
 * (the band's background is none, draw-order's `structural` row) is tapped
 * as before.
 *
 * The box is cut below iOS's status band (swipe.ts#belowStatusBand,
 * 2026-10-09) before a piece is chosen, as above a keyboard: a moved tap
 * never lands on the status bar. Its centre is never there — the on-screen
 * rule refused that first.
 *
 * Only nodes of the tree cover (decision 4): a top bar the tree lists
 * before the form — WDA's, idb's (only its button and title) — is not
 * inferred, so a row scrolled up under it is tapped at its centre as
 * before the check existed (iOS's status bar is off the screen, above).
 * The other way round — a row scrolled under the bar read as drawn over
 * BackButton and the title, under idb, whose list is flat — is judged by
 * chrome before content (ui-tree/draw-order.ts's `flatListChrome` row,
 * device check C3-3: in idb's list the bar's items come before the form's
 * rows, and a row listed after them is no cover of them).
 */
export async function aimClearOfChrome(
  target: Target,
  node: UiNode,
  tree: UiNode,
  screen: TapScreen | undefined,
  keyboardTop: () => Promise<number | undefined>,
  sent?: string,
): Promise<Aim> {
  const centre = tapPoint(node);
  // Below iOS's status band (swipe.ts#belowStatusBand): a moved tap is never aimed into it.
  const box = belowStatusBand(screen?.boxes.find((b) => containsPoint(b, centre)) ?? screen?.box ?? (rectArea(tree.rect) > 0 ? tree.rect : node.rect), screen);
  const order = drawOrder(tree);
  const exposed = order.exposure(node, box);
  // A sliver cut by a clip is refused first, by the minimum a cover's sliver is (refuseCutSliver).
  refuseCutSliver(target, node, tree, exposed.minPiece, sent);
  const cover = exposed.centreCover;
  if (cover === undefined) return { point: centre };
  // The higher of the two — never both today: idb's reading is always `unknown`, and a band only idb's flat list has.
  const top = higherTop(await keyboardTop(), order.keyboardBandTop);
  const within = top === undefined || top >= box.y + box.height ? box : { ...box, height: Math.max(0, top - box.y) };
  const above = within === box ? '' : ' above the soft keyboard';
  const seen = order.exposure(node, within);
  if (seen.tapAt !== undefined) {
    const { point } = seen.tapAt;
    if (!seen.tapAt.moved) return { point };
    const { width, height } = seen.tapAt.piece;
    return { point, moved: `at (${point.x},${point.y}) — its centre (${centre.x},${centre.y}) is ${drawnOverText(cover)}; tapped the uncovered part ${width}x${height}${above}` };
  }
  const shows =
    seen.largest === undefined
      ? `nothing of it shows${above}`
      : `only a ${seen.largest.width}x${seen.largest.height} part of it shows${above}, under the ${seen.minPiece}x${seen.minPiece} a tap may be moved to`;
  const finding = `${drawnOverText(cover, centre)}; ${shows} — scroll_until it first`;
  const what = describeTarget(target);
  throw new CoveredRefusal(sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`);
}

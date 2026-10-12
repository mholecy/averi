import { rectArea, type DeviceAdapter, type Point, type Rect, type Selector, type UiNode } from '../adapters/types.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { drawnOverText, rectText, type Cut, type Edge } from '../ui-tree/geometry.js';
import { keyboardEdge, type KeyboardLine } from '../ui-tree/keyboard-cover.js';
import { pollTimeoutMessage, pollTree, readTreeOrError } from '../ui-tree/read-tree.js';
import { findAll, findBySpec, preferInteractive, tapPoint } from '../ui-tree/selectors.js';
import { sceneOf, type Scene, type Standing, type SystemBar } from '../ui-tree/standing.js';
import { usableScreen, type UsableScreen } from '../ui-tree/usable-screen.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { SIDES } from './swipe.js';

/**
 * The interaction module (interact/): what it takes to ACT on an element —
 * resolve, tap, fill, scroll, swipe — written once for both callers, the flow
 * engine's steps and the MCP tools.
 *
 * One resolution policy for the same user operation, whichever caller asks:
 * a flow `tap:` and the MCP `tap` tool both wait for a zero-area-filtered,
 * rect-stable node and prefer the interactive match. The deletion test:
 * delete this module and the policy reappears in every caller — which is
 * what makes it a module, not a helper.
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
 * One owner: `resolveNow` and
 * `scroll_until`'s judgement (`matchesToJudge`) both read it.
 */
export function preferred(found: readonly UiNode[]): { chosen: UiNode; note?: string } | { survivors: UiNode[] } {
  const survivors = found.filter((n) => n.rect.width > 0 && n.rect.height > 0);
  if (survivors.length === 1) return { chosen: survivors[0] };
  const pick = survivors.length > 1 ? preferInteractive(survivors) : undefined;
  return pick === undefined ? { survivors } : { chosen: pick.node, note: pick.note };
}

/**
 * The matches `scroll_until` judges (interact/scroll.ts): the one a tap
 * would act on when the preference picks one (`preferred`) — so the stop and
 * the next tap judge the SAME node by construction — else every match, as
 * found. Judging every match and stopping on the one more of which shows
 * stopped on a container whose id its button shares ("PARTLY UNDER …, its
 * centre clear"), and the tap that followed acted on the button and was
 * refused under the bar. With several matches and no preference the
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
 * budget (config.ts documents it as 5 s on a `tap:` step), and the MCP
 * tap/type_text tools' too. Named once, here, because the
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
 *   be stopped, not told "Filled" with the choice buried in parentheses.
 *   The wording names the candidates, plus a recovery line saying how to
 *   narrow the selector.
 */
export type Ambiguity = 'first' | 'refuse';

/**
 * The `'refuse'` mode's error, as a class of its own so a caller
 * that adds context to a failed resolution can tell a refusal — whose FIRST
 * line is the finding and must stay the headline — from a timeout, without
 * reading the message. Same message, same `Error` to everyone else.
 */
export class AmbiguityRefusal extends Error {}

/**
 * The target was never there: no round of the wait that threw
 * it resolved the target at all — every tree that was read lacked an
 * actionable match. The one fact about an element that only this module
 * knows, as a class of its own so a caller that must tell "absent" from
 * "found, then something went wrong" reads it instead of guessing.
 *
 * Its one reader is the flow engine's `optional:` block, the only place
 * where absence is not a failure. Absence deduced from missing evidence
 * would log a fill whose field was found and tapped, but whose text never
 * landed, as "skipped step (not present)". An optional step is "(not
 * present)" exactly when this is what it threw, and anything else is
 * skipped with its own headline — save an error carrying the
 * RefusedOnPresentElement marker (`isRefusedOnPresentElement`), which fails
 * the flow.
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
 * message unchanged.
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
 * A settled resolution, with the tree it came from: the second
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
 * Throws the shared poll-timeout wording, in one of two sentences, so an
 * element that was never on screen does not look like one that would not
 * stop moving:
 * - no round resolved the target: ElementNotFoundError, "…waiting for element
 *   X to appear" (when the last read succeeded; see ElementNotFoundError for why
 *   a wait whose last read failed is a plain Error with the same wording);
 * - some round did, but no two consecutive ones agreed on its rect (it kept
 *   moving, or kept vanishing): a plain Error, "…waiting for element X to
 *   hold still (found, but never at the same position in two consecutive
 *   reads)".
 * - the last tree read resolved it after a read that did not (or as the
 *   first read): a run of ONE sighting, with no second read within the
 *   budget to compare it with (WDA's start-up, ≈4–5 s, spent the 5 s budget
 *   inside the first read of a static title; a target seen, gone, then seen
 *   again on a slow last read is the same shape). One more read is taken past the deadline
 *   — the slack pollTree's last round already has: the same rect settles
 *   it, a different one is the movement above, worded as such ("never at
 *   the same position in two consecutive reads": the late read and the one
 *   before it disagreed — kept so on purpose).
 *   Otherwise a plain Error that
 *   says what happened, never that two reads disagreed: "…to hold still
 *   (found once, but no second read came within the budget to confirm its
 *   position)" when the late read failed, "…(found once; the one read after
 *   the budget did not find it again)" when it read a tree without it —
 *   "found on the last read" in place of "found once" when an earlier run
 *   had seen it too.
 * The read error, when the last round could not read a tree, rides beneath
 * either so a dead device never looks like a slow screen.
 * docs/bugs/2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md
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
 * THE rule for when a wait that gave up is absence (one owner
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
 * target, but only with zero-area nodes (idb reports a node scrolled above the top of a scroll view as 0×0, and the wait read
 * "to appear" for a node the snapshot showed). The hint says so beneath the
 * headline (pollTimeoutMessage drops it when the last read failed). Still
 * absence for ElementNotFoundError's purpose — nothing was ever ACTIONABLE,
 * and a collapsed view, the case the zero-area rule was written for, carries
 * its id at 0×0 too, which is why the hint names both (`zeroAreaHint`
 * words it, and names the side when Android dumped them clipped out).
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 */
function notFound(target: Target, timeoutMs: number, outcome: { readError?: Error; treesRead: number }, zeroHint?: string): Error {
  return absenceError(pollTimeoutMessage(`element ${describeTarget(target)} to appear`, timeoutMs, outcome.readError, zeroHint), {
    sighted: false,
    ...outcome,
  });
}

/** The hint beneath a never-resolved wait whose last tree matched the target only at 0×0. */
export const ZERO_AREA_HINT = 'it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first';

/**
 * Where a node read wholly past `side` lies — `clipped out above its scroll
 * container` when Android dumped it so (UiNode.clippedOut), `above the
 * viewport` when its rect lies there — the one wording of it, for this
 * wait's hint and `scroll_until`'s failure (scroll-text.ts).
 */
export function pastSideText(side: Edge, clippedOut: boolean): string {
  return clippedOut ? `clipped out ${SIDES[side].past} its scroll container` : `${SIDES[side].past} the viewport`;
}

/** The scroll that brings back a node lying past `side`: `scroll_until it with direction: "up"` (swipe.ts#SIDES). */
export const revealText = (side: Edge): string => `scroll_until it with direction: "${SIDES[side].reveals}"`;

/** The direction to try for a target that may lie past `side` and was never read there: `if it lies above, try direction: "up"`. */
export function untriedSideText(side: Edge): string {
  return `if it lies ${SIDES[side].lies}, try direction: "${SIDES[side].reveals}"`;
}

/**
 * The hint for a target this tree matched, but only with zero-area nodes —
 * resolveNow's filter, the reason it answered `undefined` — or undefined
 * when it matched nothing (or something resolveNow took). When every such
 * match was dumped clipped out of its scroll container (Android's inverted
 * bounds, adapters/types.ts#UiNode.clippedOut: Settings' `Apps`
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
  if (more.length > 0) return `it matched only nodes clipped out ${[only, ...more].map((side) => SIDES[side].past).join(' or ')} its scroll container — scroll_until it first`;
  return `it matched only nodes ${pastSideText(only, true)} (scrolled past it) — ${revealText(only)} first`;
}

/**
 * Wait only for the target to APPEAR — one round that resolves it under the
 * same policy as resolveSettled (resolveNow: zero-area nodes are never
 * targets, so a ghost node cannot pass), no settling — and return that
 * sighting. Throws ElementNotFoundError (or, when the last read failed, a plain
 * Error) in resolveSettled's never-found wording.
 *
 * The flow engine's optional tap is its caller (here, so the "found" fact
 * has one owner): its budget bounds the presence check only, because a
 * settle needs two reads and one Android dump alone can outlast the
 * optional budget.
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
 * it": the element resolved — it is in the tree, on the screen
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
 * Its one reader is the flow engine's `optional:` block (the bug note's
 * item 3, below): an optional step is skipped only when its element is absent, and
 * one refused on a present element FAILS the flow — the interstitial is
 * there, and skipping it ran the flow on into the ladder's destructive rung
 * (on iOS the same with the keyboard up over LOGIN and no dismissal).
 * docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md
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
 * its centre, `tapPoint` — lies outside the screen. Measured on
 * iOS 27 (idb, 402×874 pt): the tree lists a scroll view's content below the
 * fold with its real rects (y 885, y 1157), the tap went to (94,895), landed
 * nowhere, and the reply said "Tapped" — the next `type_text` typed into the
 * field that still had focus. The target itself is never tapped.
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 *
 * A class of its own, like AmbiguityRefusal, because it is neither of the
 * wait's failures: the element WAS found (never ElementNotFoundError — an
 * `optional:` tap of it is not skipped: it fails the flow,
 * see PresentElementRefusal), and nothing is moving. The remedy is in the
 * message: scroll it in first. When the keyboard guard had already sent
 * something (a `back`, a dismissal tap), the HEADLINE says what — the one
 * line the step's ✗ quotes.
 */
export class OffScreenRefusal extends PresentElementRefusal {}

/**
 * THE words for each system bar (ui-tree/standing.ts#SystemBar), by edge: its
 * name, and the diagnosis of a target pinned under it — a layout drawn under
 * the bar without keeping clear of it (iOS's safe area, Android's window
 * insets; at the bottom, an edge-to-edge layout that keeps no clearance).
 * The tap's refusal (`systemBarRemedy`), `scroll_until`'s failures
 * (scroll-text.ts) and the pixel assert's (verify/pixel-poll.ts) read them,
 * so the three say one fact alike.
 */
const SYSTEM_BAR_WORDS: Readonly<Record<SystemBar['edge'], { readonly name: string; readonly pinned: string }>> = {
  top: { name: 'status bar', pinned: 'it is pinned under the status bar (a layout that does not keep clear of it?)' },
  bottom: { name: 'navigation bar', pinned: 'it is pinned under the navigation bar (a layout that does not keep clear of it?)' },
};

/** The bar a system band is: `status bar` at the top, `navigation bar` at the bottom. */
export const systemBarName = (edge: SystemBar['edge']): string => SYSTEM_BAR_WORDS[edge].name;

/** The diagnosis for a target pinned under the bar at `edge`. */
export const pinnedUnder = (edge: SystemBar['edge']): string => SYSTEM_BAR_WORDS[edge].pinned;

/** Where the bar's band lies, in the tree's units: `in the top 62 of the screen`, `from y 2154 to the bottom of the screen`. */
const bandText = (bar: SystemBar): string => (bar.edge === 'top' ? `in the top ${bar.bottom} of the screen` : `from y ${bar.top} to the bottom of the screen`);

/**
 * A point under a system bar as one clause — `under the status bar at
 * (201,6), in the top 62 of the screen (tree units), where a tap goes to the
 * status bar`, `under the navigation bar at (540,2186), from y 2154 to the
 * bottom of the screen (tree units), …` — read by the tap's refusal
 * (`refuseOffScreen`) and by `scroll_until`'s failures (scroll-text.ts). No
 * platform named, and the band in the tree's units — pt on iOS, px on
 * Android, the units every rect in the same reply is in.
 */
export const underSystemBar = (at: Point, bar: SystemBar): string => {
  const name = systemBarName(bar.edge);
  return `under the ${name} at (${at.x},${at.y}), ${bandText(bar)} (tree units), where a tap goes to the ${name}`;
};

/**
 * A rect reaching into a system bar's band, its centre clear, as one clause
 * — `partly under the navigation bar, from y 2154 to the bottom of the
 * screen (tree units)` — `scroll_until`'s words for a `fully: true` stop the
 * band's region refuses (ui-tree/standing.ts#Standing's `band`).
 */
export const partlyUnderSystemBar = (bar: SystemBar): string => `partly under the ${systemBarName(bar.edge)}, ${bandText(bar)} (tree units)`;

/**
 * What to do about a target whose centre lies under a system bar (the bar
 * at `edge`), said as far as the tree knows it: the refusal had said
 * `scroll_until it first` of a button pinned at the top, which no scroll
 * moves. In a scroll view (`scrolls`, ui-tree/geometry.ts#Clips.inScroller),
 * `scroll_until` moves it out from under the bar; in none, it is pinned
 * there — a layout that does not keep clear of the bar — and no step
 * reaches it; where the tree cannot say (idb's flat list), both. The
 * refusal stays a refusal either way — the safe direction, and terminal in
 * an `optional:` step (flow/engine.ts). Cost, on the refusal path only:
 * `Clips.inScroller`'s one walk of the tree (ui-tree/geometry.ts#clipsOf's
 * own walk is every tap's: its standing asks the cut first).
 */
export function systemBarRemedy(edge: SystemBar['edge'], scrolls: boolean | undefined): string {
  const pinned = `no scroll moves it out: ${pinnedUnder(edge)} — fix the layout, or tap something else`;
  if (scrolls === true) return 'it lies in a scroll view — scroll_until it first, to move it out from under the bar';
  if (scrolls === false) return `it lies in no scroll view, so ${pinned}`;
  return `if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, ${pinned}`;
}

/**
 * A tap's judgement of a resolved node: the usable screen it was judged on
 * (the first look's, or the one read again before a refusal), the scene of
 * the tree the node is in, and where the node stands for a tap there
 * (ui-tree/standing.ts#Scene.standing) — judged with the keyboard line the
 * tree alone gives (`keyboard`: idb's band, ui-tree/keyboard-cover.ts
 * #keyboardEdge with no reading — free, no device asked), never yet with a
 * reading's (`aimClearOfChrome` asks that lazily).
 */
export interface TapJudgement {
  readonly screen: UsableScreen | undefined;
  readonly scene: Scene;
  readonly standing: Standing;
  readonly keyboard: KeyboardLine | undefined;
}

/** A standing the on-screen rule lets through: anything but a centre off the screen or under a system bar. */
const onTheScreen = (s: Standing): boolean => s.kind !== 'offScreen' && s.kind !== 'systemBar';

/**
 * Refuse a tap whose point lies off the screen or under a system bar
 * (OffScreenRefusal), or return the judgement it passed. The rule every tap
 * on a resolved node shares, applied by keyboard.ts#resolveClearOfKeyboard
 * — behind `tapElement` (the flow `tap:` step, the MCP `tap` tool) and
 * `fillField`'s focus tap — to the node it hands back; where the node
 * stands is the scene's (ui-tree/standing.ts#Scene.standing).
 *
 * Judged on the tap POINT, not the rect: a node whose centre is on screen
 * passes, however much of it is clipped — by THIS rule: one cut to a sliver
 * by its scroll container is refused later (`aimClearOfChrome`). A node
 * partly on screen with its centre off is REFUSED, not tapped at the centre
 * of its visible part: the smallest change that makes the reply true.
 * Moving the point would change what the keyboard guard judged (it tests
 * the centre), and the visible part of such a node is a sliver at a screen
 * edge — on iOS the bottom one is the home indicator's gesture zone, the top
 * the status bar — where a tap is least likely to reach the element. Its
 * remedy is `scroll_until … fully: true`; a plain `scroll_until` stops only
 * with the centre on the screen too (the standing's one rule), so either
 * agrees with this rule.
 *
 * Before refusing, the device's screen is read AGAIN (`usableScreen`'s
 * `fresh`, once, on this path only — the clear path costs nothing new):
 * the adapter memoizes the size for the session, and a fold, an unfold or a
 * `wm size` change would otherwise refuse taps for the server's life (the
 * same re-read verify/capture.ts makes before refusing a window as wider
 * than the screen). The refusal names the size read again when it differs
 * from the first.
 *
 * A point on the screen but inside a system band is refused in that bar's
 * own words (`underSystemBar`, and `systemBarRemedy`: scroll it out only
 * where it can be) — "off screen" would contradict a rect the reader sees
 * on it.
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
  screen: UsableScreen | undefined,
  sent?: string,
): Promise<TapJudgement> {
  const scene = sceneOf(tree);
  // The first ask: the tree's own keyboard line (idb's band) and no reading's.
  const keyboard = keyboardEdge(undefined, scene.order, node);
  const tap = { of: 'tap', ...(keyboard !== undefined && { keyboardTop: keyboard }) } as const;
  const first = scene.standing(node, screen, tap);
  if (onTheScreen(first)) return { screen, scene, standing: first, keyboard };
  const again = await usableScreen(adapter, { tree }, { fresh: true });
  const second = scene.standing(node, again, tap);
  if (onTheScreen(second)) return { screen: again, scene, standing: second, keyboard };
  // Refused on the screen read again; on the first look's when none could be read again.
  const [judged, standing] = again === undefined && screen !== undefined ? [screen, first] : [again ?? { box: tree.rect, boxes: [tree.rect] }, second];
  const what = describeTarget(target);
  const refuse = (finding: string): never => {
    throw new OffScreenRefusal(sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`);
  };
  if (standing.kind === 'systemBar') {
    return refuse(`${underSystemBar(standing.at, standing.bar)} (rect ${rectText(node.rect)}) — ${systemBarRemedy(standing.bar.edge, scene.clips.inScroller(node))}`);
  }
  if (standing.kind !== 'offScreen') throw new Error(`tap: a standing ${standing.kind} refused as off the screen`);
  const { at, visible } = standing;
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
  return refuse(`off screen ${where}${part}`);
}

// ─── Clear of the app's chrome ───────────────────────────────────────────────

/**
 * The target resolved, settled, lies on screen and clear of the soft
 * keyboard, but the point a tap on it would press — its centre — lies under
 * a node drawn over it, and no piece of it large enough to aim at shows.
 * Measured on mp-native's SWIFT form, both iOS tree sources:
 * `priority_select` at `24,771 354x52`, its centre (201,797) on the pinned
 * CONTINUE bar `24,780 354x44`; "Tapped" pressed the (disabled) bar, and an
 * enabled one would have submitted the payment form. Nothing is tapped.
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 *
 * A class of its own, like OffScreenRefusal and for its reasons: the element
 * WAS found (an `optional:` tap of it fails the flow, never skipped — see
 * PresentElementRefusal), nothing is moving, and the remedy is in the message —
 * `scroll_until` it, which keeps scrolling until the centre is clear
 * (ui-tree/standing.ts#Scene.standing). When the keyboard guard
 * had already sent something, the HEADLINE says what.
 */
export class CoveredRefusal extends PresentElementRefusal {}

/**
 * The target resolved, settled, lies on screen, but it is CUT to a sliver by
 * its scroll container's edge: refused (ADR 0013). Measured on
 * mp-native's SWIFT form (Android): the "Payment details" toggle, 132 px
 * tall, read `66,1924 948x55` at the form's bottom edge (1978); the tap went to (540,1952), "Tapped" was reported, and
 * the section did not expand — nor for hand taps on the strip. Nothing is
 * tapped. The covered sliver's sibling (CoveredRefusal): what shows is cut
 * by a clip, not by a node drawn over it, and refused by the same minimum.
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md
 */
export class ClippedRefusal extends PresentElementRefusal {}

/**
 * The tap's refusal of a node cut to a sliver (ui-tree/standing.ts
 * #Scene.standing's `cut`; geometry.ts#Clips.cutSliver owns what counts as
 * cut, and draw-order.ts#MIN_TAP_PIECE_FRACTION the minimum). A sliver also
 * covered is refused for its cut, whose remedy names the edge.
 * docs/adr/0005-cut-before-cover.md
 *
 * The remedy is a plain `scroll_until` toward that edge (`cutRemedy`): its
 * plain stop does not stop on such a sliver either, and its default
 * direction is down, so a cut at the bottom needs no direction and the
 * others name theirs — and, for the node that only READS cut
 * (geometry.ts#evidentCut's residual: whole, its own content running to the
 * edge), the way past it: a child, or a coordinate tap — a child that lies
 * CLEAR of that edge: one flush with it inside a sliver cut there is refused
 * too (geometry.ts#Clips.cutSliver's inherited cut, `Cut.within`; measured:
 * the toggle's leaf label "Payment details", tapped as a child, did
 * nothing) — whose own way past names what it lies in:
 * something in THAT clear of the edge. Only nodes under a clipping ancestor
 * (UiNode.clipsDescendants, Android's) are cut: an iOS tree has none, so
 * this never refuses there.
 */
/** The way past a cut the node's own content evidences, should it only READ cut (geometry.ts#evidentCut's residual). */
const OWN_CUT_WAY_PAST = 'if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates';
/** The way past a cut inherited from what the node lies in (`Cut.within`): the evidence is that ancestor's, so its "whole" case is that ancestor's. */
const INHERITED_CUT_WAY_PAST =
  'if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates';

/** The tap's finding for a node cut to a sliver (`cut`, of a node whose rect is `shown`, under `minPiece`), its remedy and its way past. */
const cutFinding = (cut: Cut, shown: Rect, minPiece: number): string =>
  `${cutSliverText(cut, shown, minPiece)} — ${cutRemedy(cut.edge)} (${cut.within === undefined ? OWN_CUT_WAY_PAST : INHERITED_CUT_WAY_PAST})`;

/**
 * THE sentence for a node cut to a sliver (`Clips.cutSliver`'s answer, `cut`, of a
 * node whose rect is `shown`): `cut at its scroll container's bottom edge
 * (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across
 * that edge, under the 65 a tap needs`; a cut inherited from what the node
 * lies in (`Cut.within`) says so after the container — `…(container
 * 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42
 * part…`. Said by the tap's refusal
 * (`aimClearOfChrome`) and by `scroll_until`'s sliver failures
 * (scroll-text.ts) — one wording.
 */
export function cutSliverText(cut: Cut, shown: Rect, minPiece: number): string {
  const within = cut.within === undefined ? '' : `, as is the ${rectText(cut.within)} it lies in`;
  return (
    `cut at its scroll container's ${cut.edge} edge (container ${rectText(cut.container)})${within}; only a ${shown.width}x${shown.height} part of it shows, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/** The remedy for a target cut at `edge`: a scroll toward where the rest of it lies (swipe.ts#SIDES) — down, `scroll_until`'s default (scroll.ts), needs no word. Quoted by `scroll_until`'s sliver failures too (scroll-text.ts). */
export function cutRemedy(edge: Edge): string {
  const direction = SIDES[edge].reveals;
  return direction === 'down' ? 'scroll_until it first' : `scroll_until it with direction: ${direction} first`;
}

/**
 * How to hide a keyboard a tap refused a centre under: only a line no guard
 * acts on is refused (`underKeyboard`), idb's band, whose adapter has no
 * key that hides it (`KeyboardRemedy.dismissal` is `none`) — so the way is a
 * tap the author adds, and the adapter's `advice`.
 */
const hideIt = ({ advice }: KeyboardRemedy): string => `hide the keyboard (tap a neutral element such as the screen title — a tap: step in a flow); ${cannotHide(advice)}`;

/** Where a tap on a resolved node goes: its centre, or — `moved`, the sentence saying why — the centre of an uncovered piece of it. */
export interface Aim {
  point: Point;
  /** `at (201,767) — its centre (201,780) is under button "Continue to summary" (24,780 354x44), drawn over it; tapped the uncovered part 354x26`. */
  moved?: string;
}

/**
 * The flow trace's line for a tap that `Aim.moved`: `<what> tapped at
 * (201,767) — its centre …` — beside the clause it completes, so the clause
 * and its subject are worded in one place (the fill's
 * focus tap says it as `focus tap …`, interact/fill-text.ts#focusTapNote,
 * and the MCP reply as `Tapped <selector> …`, mcp/tool-text.ts#tapText).
 */
export const movedTapText = (what: string, moved: string): string => `${what} tapped ${moved}`;

/**
 * THE chrome check for a point about to be tapped on a resolved node, after the on-screen rule (`refuseOffScreen`,
 * whose `judged` it reads): where the node stands for a tap
 * (ui-tree/standing.ts#Scene.standing, `{ of: 'tap' }`) — a ClippedRefusal
 * for a target its scroll container cuts to a sliver (`cutFinding`); its
 * centre, unless a node of the tree is drawn over it there — then the centre
 * of the largest piece of it nothing is drawn over, when both its sides
 * reach the minimum (ui-tree/draw-order.ts#exposure, its rows and
 * MIN_TAP_PIECE_FRACTION), said in `moved`; else a CoveredRefusal naming the
 * cover. Applied by keyboard.ts#resolveClearOfKeyboard LAST, to the node and
 * tree it hands back — after the on-screen rule and the keyboard guard, so
 * neither of their judgements changes: both are of the centre, and the
 * centre is what is tapped unless something is drawn over it.
 *
 * Judged in the screen box that holds the centre, less the system bands, so
 * a moved tap never lands on the status bar or the navigation bar (the
 * tree's root rect, or the node's own, when there is no screen — fail open,
 * as there). The keyboard line comes in two parts
 * (ui-tree/keyboard-cover.ts#keyboardEdge, which merges them):
 * - the tree's own — idb's band — free, so `judged` was already asked with
 *   it (`refuseOffScreen`); a centre under it is `underKeyboard`, refused
 *   here with the keyboard's remedy (`keyboard.remedy`, the reading's) —
 *   docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 * - a reading's (`keyboard.line`: the top of a cover the input method stands
 *   by, or WDA's band) — the soft keyboard is no cover node (Android lists
 *   none, and a band is believed only with its input method's word), so it
 *   is asked for ONLY when the centre is covered, and the standing asked
 *   again with the merged line: a piece under the keyboard is never aimed
 *   at. Its cost is the reading's, on that path only (on Android the
 *   touchable region and the witness, with the keyboard shown; nothing more
 *   with it hidden — the guard's first reading is reused).
 * A key of idb's band is the keyboard's own UI and under no band line, as
 * a WDA key is under no reading's.
 * docs/adr/0007-idb-keyboard-key-row-tiling.md
 *
 * Only nodes of the tree cover: a top bar the tree lists before the form —
 * WDA's, idb's (only its button and title) — is not inferred, so a row
 * scrolled up under it is tapped at its centre (the status bar is off the
 * screen, above). The other way round — BackButton and the title under
 * idb's flat list — is chrome before content (ui-tree/draw-order.ts's
 * `flatListChrome` row).
 * docs/adr/0004-flat-list-chrome-before-content.md
 */
export async function aimClearOfChrome(
  target: Target,
  node: UiNode,
  judged: TapJudgement,
  keyboard: { readonly line: () => Promise<KeyboardLine | undefined>; readonly remedy: KeyboardRemedy },
  sent?: string,
): Promise<Aim> {
  const what = describeTarget(target);
  const refusal = (finding: string): string => (sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`);
  let standing = judged.standing;
  if (standing.kind === 'cut') throw new ClippedRefusal(refusal(cutFinding(standing.cut, node.rect, standing.minPiece)));
  if (standing.facts.centreCover !== undefined) {
    const line = keyboardEdge(await keyboard.line(), judged.scene.order, node);
    if (line !== undefined && (line.y !== judged.keyboard?.y || line.source !== judged.keyboard.source)) {
      standing = judged.scene.standing(node, judged.screen, { of: 'tap', keyboardTop: line });
    }
  }
  const { centre } = standing.facts;
  switch (standing.kind) {
    case 'reachable': {
      if (standing.moved === undefined) return { point: standing.at };
      const { at: point, moved } = standing;
      const above = moved.aboveKeyboard ? ' above the soft keyboard' : '';
      return {
        point,
        moved: `at (${point.x},${point.y}) — its centre (${centre.x},${centre.y}) is ${drawnOverText(moved.cover)}; tapped the uncovered part ${moved.piece.width}x${moved.piece.height}${above}`,
      };
    }
    case 'covered': {
      const above = standing.aboveKeyboard ? ' above the soft keyboard' : '';
      const minPiece = standing.facts.minPiece;
      const shows =
        standing.largest === undefined
          ? `nothing of it shows${above}`
          : `only a ${standing.largest.width}x${standing.largest.height} part of it shows${above}, under the ${minPiece}x${minPiece} a tap may be moved to`;
      throw new CoveredRefusal(refusal(`${drawnOverText(standing.cover, centre)}; ${shows} — scroll_until it first`));
    }
    case 'underKeyboard':
      throw new CoveredRefusal(
        refusal(
          `under the soft keyboard: its centre (${centre.x},${centre.y}) lies below the keyboard's top edge at y ${standing.line.y}, where a tap presses the keyboard — ` +
            `scroll_until it first, or ${hideIt(keyboard.remedy)}`,
        ),
      );
    default:
      throw new Error(`tap: a standing ${standing.kind} after the on-screen rule passed`);
  }
}

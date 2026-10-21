import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { describeElementSpec } from '../ui-tree/element-spec.js';
import { MissedError, missNote, missOf, presentedAloneHeadline, type Miss } from '../ui-tree/miss.js';
import { pollTimeoutMessage, pollTree, readTreeOrError } from '../ui-tree/read-tree.js';
import { findTarget, hasArea, preferInteractive, type Target } from '../ui-tree/selectors.js';

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
 * This file FINDS AND SETTLES a target — the resolution policy, the settle
 * wait, presence — and holds the absence rule (`absenceError`,
 * ElementNotFoundError) the waits and `scroll_until` share, with its
 * found-but-refused counterpart (RefusedOnPresentElement). What a tap does
 * with the node it found is tap-judgement.ts's; the cut and side phrases
 * several verbs quote are target-text.ts's.
 *
 * Layering: interact sits between flow and verify (ARCHITECTURE.md §2). It
 * imports ui-tree, adapters and util only; it knows no averi.yaml type (the
 * engine converts its YAML spec — `timeout: 2s` — before calling), and no
 * MCP schema. Options are plain milliseconds with the defaults the callers
 * had.
 */

// What a caller points at, and every match of it: ui-tree/selectors.ts's (a miss asks of the target too, ui-tree/miss.ts);
// interact's verbs import them from here.
export { findTarget, type Target } from '../ui-tree/selectors.js';

export const describeTarget = (target: Target): string =>
  typeof target === 'string' ? target : describeElementSpec(target);

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
  const survivors = found.filter(hasArea);
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
 * message unchanged. `miss` is what the wait's last read saw
 * (ui-tree/miss.ts#Miss), whose note its message carries: for the engine's
 * one-line skip, "(not present)", which says it after the words
 * (`absenceError` sets it from the wait's evidence).
 */
export class ElementNotFoundError extends MissedError {}

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
  // The first SHOWN candidates, then how many were left out — a list that
  // stopped at five without saying so read as the whole match.
  const SHOWN = 5;
  const more = candidates.length - SHOWN;
  const summary = (sep: string) =>
    [
      ...candidates.slice(0, SHOWN).map((n) => `${n.role} id=${n.identifier} label=${JSON.stringify(n.label)}`),
      ...(more > 0 ? [`…and ${more} more`] : []),
    ].join(sep);
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
 *   a wait whose last read failed is a plain Error with the same wording) —
 *   unless that last read listed a presented window ALONE (ui-tree/miss.ts's
 *   `presented`, Android's dialog or sheet): then a plain Error, "…: element X is not in
 *   the tree, which lists only the window presented on top … — close it first"
 *   (`notFound`), since nobody saw the screen beneath;
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
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
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
  throw notFound(target, timeoutMs, outcome);
}

/** What a wait that gave up saw of its target — the evidence absenceError judges. */
export interface WaitEvidence {
  /** Some round matched the target (resolveSettled: resolved it; scroll_until: any match, any swipe). */
  sighted: boolean;
  /** How many rounds read a tree at all. */
  treesRead: number;
  /** The LAST read's error, when the last read failed. */
  readError?: Error;
  /** What the last read saw of a target no round matched (ui-tree/miss.ts#missOf) — the absence carries it. */
  miss?: Miss;
}

/**
 * THE rule for when a wait that gave up is absence (one owner
 * for resolveSettled, resolvePresent and scroll.ts's scroll_until):
 * ElementNotFoundError when no round matched the target, at least one tree
 * was read and the last read succeeded; a plain Error with the same
 * message otherwise — the element was seen, or nobody could see the screen
 * at the end (see ElementNotFoundError). The caller words the message (with
 * `seen.miss`'s note in it, ui-tree/miss.ts), and the absence carries that
 * miss for a one-line reader.
 */
export function absenceError(message: string, seen: WaitEvidence): Error {
  return !seen.sighted && seen.treesRead > 0 && seen.readError === undefined ? new ElementNotFoundError(message, seen.miss ?? { of: 'none' }) : new Error(message);
}

/**
 * A wait that never resolved its target, worded for what it waited for —
 * nothing about settling — and for why its last read did not hold it
 * (ui-tree/miss.ts#missOf, the one decision, asked with the target: a match
 * only at 0×0 is the fact this wait's filter makes — still absence for
 * ElementNotFoundError's purpose, nothing was ever ACTIONABLE).
 * The miss's note goes beneath the headline (pollTimeoutMessage drops it when the
 * last read failed: `unread`). A `presented` miss says itself in place of the
 * headline, as a plain Error: beneath a presented window listed alone the target is
 * not known absent — nobody saw the screen beneath (an optional step is skipped with
 * this headline, never "(not present)", as scroll_until's stop there).
 */
function notFound(target: Target, timeoutMs: number, outcome: { readError?: Error; treesRead: number; lastTree?: UiNode }): Error {
  const miss = unsaidByTheTap(missOf({ tree: outcome.lastTree, readError: outcome.readError, target }));
  if (miss.of === 'presented') return new Error(`Timed out after ${timeoutMs}ms: ${presentedAloneHeadline(`element ${describeTarget(target)}`, miss)}`);
  return absenceError(pollTimeoutMessage(`element ${describeTarget(target)} to appear`, timeoutMs, outcome.readError, missNote(miss)), { sighted: false, ...outcome, miss });
}

/**
 * The tap's and fill's wait does not say idb's container-id fact (`containerId`) — not in its message, not in the
 * miss its absence carries to an optional step's skip line: it said nothing of it before the miss knew the target
 * (round 15, a refactor that changed no tap reply), and what idb's dialect should say to a tap is NI1's decision
 * (docs/truth/open-bugs.md): it reads as `none`. A flow's `wait:` and `scroll_until` say it.
 */
const unsaidByTheTap = (miss: Miss): Miss => (miss.of === 'containerId' ? { of: 'none' } : miss);

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
  const outcome = await pollTree(adapter, (tree) => resolveNow(tree, target, opts), { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS });
  if (!outcome.timedOut) return outcome.value;
  throw notFound(target, timeoutMs, outcome);
}

// ─── Refused on a present element ────────────────────────────────────────────

/**
 * The typed marker for "the target was FOUND, and interact/ refused to tap
 * it": the element resolved — it is in the tree, on the screen
 * the author meant — on every look the refusal rests on, and a rule of
 * interact/, not its absence, is why nothing was tapped. Here, beside
 * ElementNotFoundError, as the found/absent contract the flow engine reads.
 * Carried by:
 * - the tap rules' refusals on a resolved node (tap-judgement.ts, one base
 *   class): OffScreenRefusal, CoveredRefusal and ClippedRefusal (behind `tapElement` and
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

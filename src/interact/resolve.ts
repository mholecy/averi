import { rectArea, type DeviceAdapter, type Point, type Rect, type Selector, type UiNode } from '../adapters/types.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { containsPoint, rectText, visibleFractionInViewport } from '../ui-tree/geometry.js';
import { pollTimeoutMessage, pollTree } from '../ui-tree/read-tree.js';
import { findAll, findBySpec, preferInteractive, tapPoint } from '../ui-tree/selectors.js';
import { screenBox } from './swipe.js';

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

/** Every match, unfiltered — the scroll loop judges all of them; resolveNow is the policy over them. */
export const findTarget = (tree: UiNode, target: Target): UiNode[] =>
  typeof target === 'string' ? findAll(tree, target) : findBySpec(tree, target);

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
 * skipped with its own headline.
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
  const candidates = findTarget(tree, target).filter((n) => n.rect.width > 0 && n.rect.height > 0);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return { node: candidates[0] };
  const preferred = preferInteractive(candidates);
  if (preferred !== undefined) return preferred;
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
  let zeroOnly = false;
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
      zeroOnly = resolved === undefined && matchedOnlyZeroArea(tree, target);
      if (resolved === undefined) {
        lastRect = undefined;
        return undefined;
      }
      sighted = true;
      const rect = JSON.stringify(resolved.node.rect);
      if (rect === lastRect) return { ...resolved, tree };
      lastRect = rect;
      return undefined;
    },
    { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS },
  );
  if (!outcome.timedOut) return outcome.value;
  if (sighted) {
    throw new Error(
      pollTimeoutMessage(
        `element ${describeTarget(target)} to hold still (found, but never at the same position in two consecutive reads)`,
        timeoutMs,
        outcome.readError,
      ),
    );
  }
  throw notFound(target, timeoutMs, outcome, zeroOnly);
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
 * nothing about settling. `zeroOnly`: the last tree read matched the target,
 * but only with zero-area nodes (2026-10-08,
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md: idb reports a
 * node scrolled above the top of a scroll view as 0×0, and the wait read
 * "to appear" for a node the snapshot showed). The hint says so beneath the
 * headline (pollTimeoutMessage drops it when the last read failed). Still
 * absence for ElementNotFoundError's purpose — nothing was ever ACTIONABLE,
 * and a collapsed view, the case the zero-area rule was written for, carries
 * its id at 0×0 too, which is why the hint names both.
 */
function notFound(target: Target, timeoutMs: number, outcome: { readError?: Error; treesRead: number }, zeroOnly = false): Error {
  return absenceError(
    pollTimeoutMessage(`element ${describeTarget(target)} to appear`, timeoutMs, outcome.readError, zeroOnly ? ZERO_AREA_HINT : undefined),
    { sighted: false, ...outcome },
  );
}

/** The hint beneath a never-resolved wait whose last tree matched the target only at 0×0. */
export const ZERO_AREA_HINT = 'it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first';

/** Did the target match in this tree, but only with zero-area nodes — resolveNow's filter, the reason it answered `undefined`? */
const matchedOnlyZeroArea = (tree: UiNode, target: Target): boolean => findTarget(tree, target).length > 0;

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
  let zeroOnly = false;
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
      zeroOnly = resolved === undefined && matchedOnlyZeroArea(tree, target);
      return resolved;
    },
    { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS },
  );
  if (!outcome.timedOut) return outcome.value;
  throw notFound(target, timeoutMs, outcome, zeroOnly);
}

// ─── On screen ───────────────────────────────────────────────────────────────

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
 * `optional:` tap of it is skipped with this headline, not "(not present)"),
 * and nothing is moving. The remedy is in the message: scroll it in first.
 * When the keyboard guard had already sent something (a `back`, a dismissal
 * tap), the HEADLINE says what — the one line an `optional:` skip quotes.
 */
export class OffScreenRefusal extends Error {}

/** The screen a tap point is judged against: `swipe.ts#ScreenBox`'s box, and whether a window witnessed which way up it is. */
export interface TapScreen {
  box: Rect;
  witnessed: boolean;
}

/**
 * The screen for the on-screen rule: `swipe.ts#screenBox`, the one owner of
 * "the device's screen as the tree's coordinates see it" — the device's
 * `viewport()` (memoized by the adapter; in the tree's units, px on Android,
 * pt on iOS), turned when `tree`'s window says the screen is held sideways,
 * the tree's window when the device size cannot be read — with its
 * `witnessed` flag (onScreen says what it changes).
 *
 * `undefined` — no box at all — leaves the judgement to the tree's root rect
 * (`onScreen`), and with no root rect either the tap goes ahead as it did
 * before the rule existed: the keyboard guard's fail-open rule
 * (keyboard.ts). The rule exists to stop a false "Tapped", and must never
 * be why a tap on a device that could not report its size did not happen.
 */
export async function tapScreen(adapter: Pick<DeviceAdapter, 'viewport'>, tree: UiNode): Promise<TapScreen | undefined> {
  try {
    const { box, witnessed } = await screenBox(adapter, { tree });
    return { box, witnessed };
  } catch {
    return undefined;
  }
}

const turned = (b: Rect): Rect => ({ x: b.x, y: b.y, width: b.height, height: b.width });

/** The boxes a point may lie in to count as on screen: the box, and — when no window witnessed which way up it is — the box turned. */
const screenBoxes = (screen: TapScreen): Rect[] => (screen.witnessed ? [screen.box] : [screen.box, turned(screen.box)]);

/**
 * THE on-screen rule for a point about to be tapped (2026-10-08) — the
 * target's centre (`refuseOffScreen`) and a configured keyboard dismissal's
 * (keyboard-in-tree.ts#pickDismissal: WDA keeps off-screen nodes, a title
 * scrolled above the top is still in the tree). One owner since the review
 * of the off-screen refusal: the picker had judged by the root's rect alone.
 *
 * - A screen whose orientation a window witnessed (`TapScreen.witnessed`):
 *   inside its box.
 * - One no window witnessed: inside the box EITHER way up. Review
 *   2026-10-08 (B1): the turn is a swipe's question first, where a wrong
 *   box costs an off-centre stroke; refusing on it would refuse every tap
 *   past x 402 in an idb landscape tree whose window a straddling carousel
 *   card made unreliable, an iPad strip, a walked-width turn, a split pane.
 *   What this gives up: a point off a portrait screen's right edge but
 *   within its height turned (a carousel page at x 450, y 300 on 402×874)
 *   is not refused on an unwitnessed screen. The measured case — below the
 *   fold, (94,895) on 402×874 — lies outside both and is refused either way.
 * - No screen at all: inside the tree's root rect when it has one; with
 *   none, on screen (fail open).
 *
 * The point is the one SENT — `tapPoint` rounds — so a centre at x 401.5 on
 * a 402-wide screen is judged at 402, off it: that is where the tap would go.
 */
export function onScreen(point: Point, tree: UiNode, screen: TapScreen | undefined): boolean {
  if (screen === undefined) return rectArea(tree.rect) === 0 || containsPoint(tree.rect, point);
  return screenBoxes(screen).some((box) => containsPoint(box, point));
}

/**
 * Refuse a tap whose point lies off the screen (OffScreenRefusal), or return
 * the screen it was judged against. The rule every tap on a resolved node
 * shares, applied by keyboard.ts#resolveClearOfKeyboard — behind
 * `tapElement` (the flow `tap:` step, the MCP `tap` tool) and `fillField`'s
 * focus tap — to the node it hands back.
 *
 * Judged on the tap POINT, not the rect: a node whose centre is on screen
 * is tapped as before, however much of it is clipped. A node partly on
 * screen with its centre off is REFUSED, not tapped at the centre of its
 * visible part: the smallest change that makes the reply true. Moving the
 * point would change what the keyboard guard judged (it tests the centre),
 * and the visible part of such a node is a sliver at a screen edge — on iOS
 * the bottom one is the home indicator's gesture zone, the top the status
 * bar — where a tap is least likely to reach the element. Its remedy is
 * `scroll_until … fully: true`: a plain `scroll_until` stops on any
 * intersection and would hand back the same clipped node (review
 * 2026-10-08, M1).
 *
 * Before refusing, the device's screen is read AGAIN (`viewport({ fresh:
 * true })`, once, on this path only — the clear path costs nothing new):
 * the adapter memoizes the size for the session, and a fold, an unfold or a
 * `wm size` change would otherwise refuse taps for the server's life (review
 * 2026-10-08, M3; the same re-read verify/capture.ts makes before refusing a
 * window as wider than the screen). The refusal names the size read again
 * when it differs from the first.
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
  const judged: TapScreen = again ?? screen ?? { box: tree.rect, witnessed: true };
  const boxes = screenBoxes(judged);
  const visible = Math.max(...boxes.map((b) => visibleFractionInViewport(node.rect, b)));
  const size = `${judged.box.width}x${judged.box.height}`;
  const reread =
    again !== undefined && screen !== undefined && (again.box.width !== screen.box.width || again.box.height !== screen.box.height)
      ? ` (read again before refusing; it was ${screen.box.width}x${screen.box.height})`
      : '';
  const where = `at (${at.x},${at.y}) on a ${size} screen${judged.witnessed ? '' : ' either way up'}${reread}`;
  const part =
    visible > 0
      ? ` — only ${Math.round(visible * 100)}% of it (rect ${rectText(node.rect)}) is on screen, and a tap goes to its centre — scroll_until it with fully: true first`
      : ` (rect ${rectText(node.rect)}) — scroll_until it first`;
  const what = describeTarget(target);
  throw new OffScreenRefusal(
    sent === undefined ? `${what} is off screen ${where}${part}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is off screen ${where}${part}`,
  );
}

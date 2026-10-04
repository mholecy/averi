import type { DeviceAdapter, Selector, UiNode } from '../adapters/types.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { pollTimeoutMessage, pollTree } from '../ui-tree/read-tree.js';
import { findAll, findBySpec, preferInteractive } from '../ui-tree/selectors.js';

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
 *   (review 2026-10-03). The wording is the pre-interact `resolveOne` one.
 */
export type Ambiguity = 'first' | 'refuse';

export interface ResolveOptions {
  ambiguous: Ambiguity;
}

export interface SettleOptions extends ResolveOptions {
  /** How long the element may take to appear AND hold still. Default DEFAULT_SETTLE_TIMEOUT_MS. */
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
    throw new Error(
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
 * Wait for the target to resolve to a node whose rect is identical in two
 * consecutive tree reads — screens animate on launch and transition, and a
 * tap mid-animation lands on whatever moved into that spot — then return it.
 * The rect comparison restarts whenever a round finds nothing: a node that
 * vanishes and returns has to prove it holds still again.
 *
 * Throws the shared poll-timeout wording. The read error, when the last
 * round could not read a tree, rides beneath it so a dead device never looks
 * like a slow screen.
 */
export async function resolveSettled(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  target: Target,
  opts: SettleOptions,
): Promise<Resolved> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  let lastRect: string | undefined;
  const outcome = await pollTree(
    adapter,
    (tree) => {
      const resolved = resolveNow(tree, target, opts);
      if (resolved === undefined) {
        lastRect = undefined;
        return undefined;
      }
      const rect = JSON.stringify(resolved.node.rect);
      if (rect === lastRect) return resolved;
      lastRect = rect;
      return undefined;
    },
    { timeoutMs, pollMs: opts.pollMs ?? DEFAULT_POLL_MS },
  );
  if (!outcome.timedOut) return outcome.value;
  throw new Error(
    pollTimeoutMessage(`element ${describeTarget(target)} (visible and settled)`, timeoutMs, outcome.readError),
  );
}

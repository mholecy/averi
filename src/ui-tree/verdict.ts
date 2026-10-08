import type { UiNode } from '../adapters/types.js';
import { isBareTree, treeShape } from './bare-tree.js';
import { absentFromViewport } from './geometry.js';

/**
 * What one tree says about one element question, in three values
 * (2026-10-08, flow-engine review candidate 2): `yes`, `no`, or `unknown` —
 * the tree is BARE (bare-tree.ts: only wrappers and unlabeled decoration, a
 * cold launch's Android decor for ~9 s, WDA's 7-node splash) and the answer
 * it would give is the one a bare tree gives for ANY selector, so it says
 * nothing about the screen.
 *
 * Until then the question was a boolean in two places — the flow engine's
 * `matches` and the verifier's absent assert — and `absent` was
 * `absentFromViewport` alone: nothing in a bare tree matches, so on the decor
 * an `absent: true` detect said "already active", a `branch:` arm on it was
 * taken, a `wait:` on a state detected by it passed at once, and the absent
 * assert PASSED, all before the app had drawn a pixel. The flow engine's
 * detect probe already refused to call a MISS on a bare tree knowledge
 * (2026-10-07); a HIT on absence is the same miss read the other way round,
 * and is now refused the same way.
 *
 * The rule, per leaf:
 * - present: a match is `yes` whatever else the tree holds (a selector that
 *   finds the thing has learned it is there); no match is `no` on a rendered
 *   tree and `unknown` on a bare one.
 * - absent: a match visible in the viewport is `no` whatever the tree holds
 *   (the thing is there — the decor's own `content` is, for one); otherwise
 *   `yes` on a rendered tree and `unknown` on a bare one. "Gone or off
 *   viewport" is absentFromViewport's meaning, unchanged.
 * So a bare tree is asked only when the selector's answer is the one a bare
 * tree would give anyway — and a rendered tree never yields `unknown`: on
 * every screen an app has drawn, both questions answer exactly as before.
 *
 * Here, in ui-tree/, rather than in flow/condition.ts beside the rest of
 * Condition's evaluation, because the verifier asks the absent half too and
 * `verify/` may not import `flow/` (ARCHITECTURE.md §2) — the same reason
 * absentFromViewport is in geometry.ts. The combinators (`any:`/`all:`,
 * `{ state }`) are averi.yaml vocabulary and stay in flow/condition.ts.
 */
export type Verdict = 'yes' | 'no' | 'unknown';

/**
 * isBareTree, asked once per tree object. It walks the whole tree, and a
 * condition with several leaves asks it of one tree several times — and
 * the detect probe asks again of a round that was not `yes` (flow/engine.ts
 * `detects`), so this is exported for it. Trees are fresh per read (both
 * adapters parse a fresh graph, the fakes clone), so an entry never outlives
 * the tree it describes; a tree is immutable once asked — nothing edits a
 * tree a poll has handed to a predicate.
 */
const bareMemo = new WeakMap<UiNode, boolean>();
export const isBareTreeMemo = (tree: UiNode): boolean => {
  let known = bareMemo.get(tree);
  if (known === undefined) bareMemo.set(tree, (known = isBareTree(tree)));
  return known;
};

/** Is the element there? `found` is what the selector matched in `tree`. */
export const presenceVerdict = (found: readonly UiNode[], tree: UiNode): Verdict =>
  found.length > 0 ? 'yes'
  : isBareTreeMemo(tree) ? 'unknown'
  : 'no';

/** Is the element gone or off the viewport? `found` is what the selector matched in `tree`. */
export const absenceVerdict = (
  found: readonly UiNode[],
  viewport: { width: number; height: number },
  tree: UiNode,
): Verdict =>
  !absentFromViewport(found, viewport) ? 'no'
  : isBareTreeMemo(tree) ? 'unknown'
  : 'yes';

/**
 * `the last UI tree read was bare, 7 nodes (roles: container ×6, image ×1)
 * of only wrappers and unlabeled decoration, so it could not decide this —
 * the screen had not rendered by the deadline; compare with screenshot, and
 * a longer timeout may be all it needs` — the whole note a poll that timed
 * out on an `unknown` puts beneath its headline, its advice included: the
 * flow engine's `wait:` and `branch:` (a hint line under pollTimeoutMessage)
 * and the absent assert's "could not verify" detail. One spelling for both
 * layers, here beside the verdict it explains; `timeout` is the field's name
 * in an averi.yaml step and in an assert spec alike. The ladder's "every UI
 * tree read was bare, the last one …" (flow/engine.ts describeUnreadCause)
 * is a different fact — a whole probe, not the last round — and keeps its
 * own sentence around the same shape.
 */
export const bareTimeoutNote = (tree: UiNode): string =>
  `the last UI tree read was bare, ${treeShape(tree)} of only wrappers and unlabeled decoration, ` +
  'so it could not decide this — the screen had not rendered by the deadline; ' +
  'compare with screenshot, and a longer timeout may be all it needs';

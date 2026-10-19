import type { Rect, UiNode } from '../adapters/types.js';
import type { Edge } from './geometry.js';
import type { FlushNeighbour, Scene } from './standing.js';
import type { UsableScreen } from './usable-screen.js';

/**
 * THE EYES CONFIRM A FULLY CLAIM: the question a `fully visible` stop asks of the screenshot before it is claimed, and
 * the answer — the interface of the concept, here below interact/ (which asks) and verify/ (which looks: the one
 * production adapter, verify/eyes.ts#eyesOn, wired at the composition root — mcp/tools.ts, flow/engine.ts — as
 * adapters/types.ts#DrawnOverStrip is; the test adapters answer it from a captured png or a table).
 *
 * Why: the tree cannot see a surface that has no node. On the lab's `form-keyboard` (Android) the bar riding on the
 * IME draws 28 px of padding above its `Continue` and dumps no node for it; after one stroke `phone` lay flush with
 * `Continue` and `scroll_until` answered "fully visible after 1 swipe" while the bar's padding covered 18 px of the
 * field (live case k7; ADR 0013's residual, the owner's decision of 2026-10-18 point 5:
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md). Pixels can see it.
 *
 * WHEN — the trigger, narrow on purpose (one screenshot, never on every round): only where a `fully visible` claim is
 * about to be made (a clean, settled stop: nothing clipped, nothing listed over it — interact/scroll-rounds.ts#round),
 * and only when the target has a FLUSH NEIGHBOUR (ui-tree/standing.ts#Scene.flushNeighbour): a node drawn after it,
 * outside its scroll view, laid flush against one of its edges, on a tree whose source cuts bounds at a later node
 * (Android's) — the one shape where a node-less surface around that node may lie over the target unseen. An ordinary
 * stop asks nothing and costs nothing.
 *
 * WHAT is asked (`EyesQuestion`): whether the target's frame, from that edge inward, shows the colour of the surface
 * AROUND the neighbour rather than its own — judged by verify/eyes.ts, over THE region a pixel measurement reads
 * (ui-tree/standing.ts#Scene.pixelRegion).
 */

/** What the eyes are asked: the target, its region a pixel measurement reads, and the flush neighbour at `edge`. */
export interface EyesQuestion {
  /** The tree the stop was judged on — the png's scale is derived against it (verify/capture.ts#measuredFrameFor). */
  readonly tree: UiNode;
  readonly node: UiNode;
  /** THE region of the node a pixel measurement reads (ui-tree/standing.ts#Scene.pixelRegion). */
  readonly region: Rect;
  readonly edge: Edge;
  /** The node laid flush against `edge` (ui-tree/standing.ts#FlushNeighbour.by). */
  readonly neighbour: UiNode;
}

/**
 * What the eyes saw:
 * - `own`: the target's own colour runs to the edge (no band of the surface past the pixel slack) — the claim stands;
 * - `surface`: its `depth` tree units from the edge inward show `surface`, the colour beside the neighbour, not `own`,
 *   its own — a surface the tree does not list lies over them;
 * - `unjudged`: the screenshot could not tell (`why`: no screenshot, no plain surface beside the neighbour, the two
 *   colours too close to tell apart…) — the reply says the tree's claim and that it could not be checked.
 */
export type EyesAnswer =
  | { readonly sees: 'own' }
  | { readonly sees: 'surface'; readonly depth: number; readonly surface: string; readonly own: string }
  | { readonly sees: 'unjudged'; readonly why: string };

/** The eyes: a question to an answer — one screenshot (verify/eyes.ts#eyesOn). */
export type Eyes = (question: EyesQuestion) => Promise<EyesAnswer>;

/** The question a `fully visible` claim on `node` asks, or undefined when the trigger does not apply (no flush neighbour). */
export function eyesQuestion(scene: Scene, tree: UiNode, node: UiNode, screen: UsableScreen | undefined): EyesQuestion | undefined {
  const flush: FlushNeighbour | undefined = scene.flushNeighbour(node);
  if (flush === undefined) return undefined;
  return { tree, node, region: scene.pixelRegion(node, screen), edge: flush.edge, neighbour: flush.by };
}

/** The eyes' finding a reply or a failure quotes: the question's edge and neighbour, and what was seen there. */
export interface EyesFinding {
  readonly edge: Edge;
  readonly neighbour: UiNode;
  readonly answer: Exclude<EyesAnswer, { readonly sees: 'own' }>;
}

/** A finding of a band of the surface (`surface`): what keeps a `fully: true` stop from being claimed. */
export type SurfaceFinding = EyesFinding & { readonly answer: Extract<EyesAnswer, { readonly sees: 'surface' }> };

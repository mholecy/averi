import type { Point, Rect, UiNode } from '../adapters/types.js';
import { axisOfEdge, sameRectWithinPixel, type Edge } from './geometry.js';
import type { FlushNeighbour, Scene } from './standing.js';
import { treeScreen, type UsableScreen } from './usable-screen.js';

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
 * and only when the target has a FLUSH NEIGHBOUR (ui-tree/standing.ts#Scene.flushNeighbours): a node drawn after it,
 * outside its scroll view, laid flush against one of its edges, on a tree whose source cuts bounds at a later node
 * (Android's) — the one shape where a node-less surface around that node may lie over the target unseen — and only
 * of a neighbour NARROWER than the screen along its edge (`spansScreen`): a Scaffold's top app bar or bottom bar laid
 * full width beside a row leaves no screen beside it to read its surface's colour from, so the eyes could only answer
 * "could not tell"; there the tree's claim stands unasked, as before the eyes (ADR 0013's residual). An ordinary stop
 * asks nothing and costs nothing.
 *
 * WHAT is asked (`EyesQuestion`): whether the target's frame, from each flush edge inward, shows the colour of the
 * surface AROUND that neighbour rather than its own — every edge on ONE screenshot, judged by verify/eyes.ts over THE
 * region a pixel measurement reads (ui-tree/standing.ts#Scene.pixelRegion). One capture, unsettled by design: the stop
 * it checks was settled by its tree reads, and a settled pair would double the cost (ADR 0013, "Refined 2026-10-19",
 * states the residual: a bar or an IME still animating could be misread).
 */

/** What the eyes are asked: the target, its region a pixel measurement reads, and its flush neighbours — every edge judged, one screenshot. */
export interface EyesQuestion {
  /** The tree the stop was judged on — the png's scale is derived against it (verify/capture.ts#measuredFrameFor). */
  readonly tree: UiNode;
  readonly node: UiNode;
  /** THE region of the node a pixel measurement reads (ui-tree/standing.ts#Scene.pixelRegion). */
  readonly region: Rect;
  /** Its flush neighbours narrower than the screen (ui-tree/standing.ts#Scene.flushNeighbours less `spansScreen`), at least one. */
  readonly flush: readonly FlushNeighbour[];
}

/**
 * What the eyes saw — over every flush edge of the question, one screenshot:
 * - `own`: the target's own colour runs to every edge (no band of a surface past the pixel slack) — the claim stands;
 * - `surface`: at `edge`, its `depth` tree units inward show `surface`, the colour beside `neighbour`, not `own`, its
 *   own — a surface the tree does not list lies over them (the deepest such band, when several edges show one);
 * - `unjudged`: at `edge` (the first edge that could not be told, when no edge showed a band), the screenshot could not
 *   tell (`why`: no screenshot, no plain surface beside the neighbour, the two colours too close to tell apart, the
 *   screen beside the target that surface's colour too…) — the reply says the tree's claim and that it was not checked.
 */
export type EyesAnswer =
  | { readonly sees: 'own' }
  | { readonly sees: 'surface'; readonly edge: Edge; readonly neighbour: UiNode; readonly depth: number; readonly surface: string; readonly own: string }
  | { readonly sees: 'unjudged'; readonly edge: Edge; readonly neighbour: UiNode; readonly why: string };

/** The eyes: a question to an answer — one screenshot (verify/eyes.ts#eyesOn). */
export type Eyes = (question: EyesQuestion) => Promise<EyesAnswer>;

/** The question a `fully visible` claim on `node` asks, or undefined when the trigger does not apply (no flush neighbour narrower than the screen). */
export function eyesQuestion(scene: Scene, tree: UiNode, node: UiNode, screen: UsableScreen | undefined): EyesQuestion | undefined {
  const box = (screen ?? treeScreen(tree)).oriented;
  const flush = scene.flushNeighbours(node).filter((f) => !spansScreen(f, box));
  if (flush.length === 0) return undefined;
  return { tree, node, region: scene.pixelRegion(node, screen), flush };
}

/** The neighbour reaches both ends of the screen along its edge (across it for a top or bottom edge, down it for a side edge): nothing of the screen beside it. */
function spansScreen({ edge, by }: FlushNeighbour, box: Rect): boolean {
  const r = by.rect;
  return axisOfEdge(edge) === 'vertical' ? r.x <= box.x && r.x + r.width >= box.x + box.width : r.y <= box.y && r.y + r.height >= box.y + box.height;
}

/** The eyes' finding a reply or a failure quotes: what they saw that was not the target's own colour. */
export type EyesFinding = Exclude<EyesAnswer, { readonly sees: 'own' }>;

/** A finding of a band of a surface: what keeps a `fully: true` stop from being claimed, or a plain stop whose centre it reaches. */
export type SurfaceFinding = Extract<EyesAnswer, { readonly sees: 'surface' }>;

/** A question as asked, in rects (`askedOf`): its region and each flush neighbour's rect, in order — what a later question is compared with. */
export interface EyesAsked {
  readonly region: Rect;
  readonly neighbours: readonly Rect[];
}

/** `question` as asked (`EyesAsked`), its rects copied. */
export const askedOf = (question: EyesQuestion): EyesAsked => ({ region: { ...question.region }, neighbours: question.flush.map((f) => ({ ...f.by.rect })) });

/**
 * `question` is the SAME QUESTION as `asked`: its region and its neighbours' rects, as many, each within a pixel — nothing
 * moved, so the pixels did not, and the eyes would answer as before (interact/scroll-rounds.ts#round's refused again).
 */
export const sameQuestion = (asked: EyesAsked, question: EyesQuestion): boolean =>
  sameRectWithinPixel(asked.region, question.region) &&
  asked.neighbours.length === question.flush.length &&
  question.flush.every((f, i) => sameRectWithinPixel(asked.neighbours[i]!, f.by.rect));

/**
 * The band the eyes saw REACHES `point` along its edge's axis — measured from the edge of `region` (the question's)
 * inward by its depth. The round asks it of the centre the next tap presses (selectors.ts#tapPoint): the bar's padding
 * over a 42-px label 23 px deep from its bottom (1971–1993 of 1952–1993) reaches its centre at 1973.
 */
export function reachesPoint({ edge, depth }: SurfaceFinding, region: Rect, point: Point): boolean {
  switch (edge) {
    case 'bottom':
      return region.y + region.height - depth <= point.y;
    case 'top':
      return region.y + depth > point.y;
    case 'right':
      return region.x + region.width - depth <= point.x;
    case 'left':
      return region.x + depth > point.x;
  }
}

import { rectIntersection, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { axisOfEdge, sameRectWithinPixel, type Edge } from './geometry.js';
import type { OrderSeen } from './seen-order.js';
import type { FlushNeighbour, PixelStanding, Scene, Standing } from './standing.js';
import { treeScreen, type UsableScreen } from './usable-screen.js';

/**
 * THE EYES — two questions a screenshot answers where the tree cannot, one capture each: does a surface the tree does
 * not list lie over a `fully visible` claim's edge (`Eyes.fully`, below), and which of two controls the tree lists in
 * reading order is drawn on top (`Eyes.order`, `orderQuestion`: ADR 0024, after the first question's section).
 *
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
 *
 * WHAT A REFUSAL KEEPS, and what a finding reaches — the module's too, so the round (interact/scroll-rounds.ts#round)
 * spells none of it: `EyesAsked` (`askedOf`), a question as asked, in rects; `sameQuestion`, a later question of the
 * same region and neighbours within a pixel — refused again with no second screenshot, nothing having moved; and
 * `reachesPoint`, whether a band the eyes saw reaches the point the next tap presses.
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

/**
 * The eyes: two questions, each answered from one screenshot (verify/eyes.ts#eyesOn) — `fully`, a `fully visible`
 * claim's flush edges; `order`, which of two controls listed in reading order is drawn on top (`orderQuestion`), one
 * answer per pair, never throwing (a failed screenshot is every pair `untold`, said why).
 */
export interface Eyes {
  readonly fully: (question: EyesQuestion) => Promise<EyesAnswer>;
  readonly order: (question: OrderQuestion) => Promise<readonly OrderSeen[]>;
}

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

/**
 * THE EYES TELL THE ORDER OF TWO CONTROLS LISTED IN READING ORDER (ADR 0024): the second question.
 *
 * Why: SwiftUI lists a container's elements in reading order, by their tops, not in draw order, so of two controls of
 * such a run that overlap the tree cannot say which is drawn on top (draw-order.ts#Exposure.unordered, ADR 0015
 * amended): the lab's menu row W (`51,448 300x64`, drawn on top) and the row C (`51,470`) beneath were BOTH refused, the
 * order not told. The screenshot tells it: W's teal fills the overlap and W's own band above it; C's band below it is
 * the blurred green (ΔE00 17.69 from the overlap, 0.00 between the overlap and W's band).
 * docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 *
 * WHEN — narrow, as the first question's trigger: only for a standing `covered` with remedy `unordered` (a cover the
 * listing does not order — ui-tree/standing.ts#Remedy), once per look, by the verbs that may act on the answer (the tap,
 * `scroll_until`'s stop, the pixel assert, which reuses the frame it captures anyway); a tree-only caller (the dismissal
 * picker, `ui_snapshot`) asks nothing and keeps the untold order. One capture, unsettled for the tap and the stop: a
 * frame mid-animation reads a blend, which the judge cannot tell — the safe side.
 *
 * WHAT is asked (`OrderQuestion`): per `unordered` cover of the target (a `peer`), where the two overlap and where each
 * shows ALONE next to that overlap — its clear bands, along the overlap's edges — and the screen beside the two on the
 * overlap's rows. The judge (verify/eyes.ts#judgeOrder) compares colours of the screenshot's own parts only — never a
 * declared colour — and every one of its rules can only answer `untold` (ui-tree/seen-order.ts#PairSeen), which keeps
 * the refusal. The answer re-enters the pure draw order as an input (ui-tree/seen-order.ts#seenOrderOf,
 * draw-order.ts#drawOrder's `orderSeen`, through ui-tree/look.ts#lookAt's `seen`).
 */

/** One pair the eyes are asked to order: the target against `peer`, in tree units. */
export interface OrderPair {
  /** The `unordered` cover of the target (draw-order.ts#Exposure.unordered). */
  readonly peer: UiNode;
  /** Where the two overlap, in the frame the standing was judged in. */
  readonly overlap: Rect;
  /** The target's clear bands: the strips of it beside the overlap, outside the peer, along each edge of the overlap it reaches past (each at most the overlap's own depth on that axis), none meeting another cover of it. Empty: none. */
  readonly nodeBands: readonly Rect[];
  /** The peer's clear bands, likewise: the strips of it beside the overlap, outside the target. */
  readonly peerBands: readonly Rect[];
  /** The screen beside the two on the overlap's rows — left of both, right of both: what a band showing the screen's own colour is told by (a control that may draw nothing there). */
  readonly beside: readonly Rect[];
}

/** The order question of one target: its tree (the png's scale is derived against it, verify/capture.ts#measuredFrameFor), the target and its pairs. */
export interface OrderQuestion {
  readonly tree: UiNode;
  readonly node: UiNode;
  readonly pairs: readonly OrderPair[];
}

/**
 * The question `standing` of `node` asks the eyes — when it is `covered` with remedy `unordered` (a cover the listing
 * does not order, ui-tree/standing.ts#Remedy) and not yet looked at (no `untold`) — or undefined: every other standing
 * asks nothing. Its pairs are the standing's `unordered` covers, judged in its frame (`facts.screen`).
 */
export function orderQuestion(tree: UiNode, node: UiNode, standing: Standing | PixelStanding): OrderQuestion | undefined {
  if (standing.kind !== 'covered' || standing.remedy.of !== 'unordered' || standing.remedy.untold !== undefined) return undefined;
  const { facts } = standing;
  const frame = facts.screen;
  const pairs = (facts.unordered ?? []).flatMap((peer): OrderPair[] => {
    const overlap = rectIntersection(rectIntersection(node.rect, peer.rect) ?? EMPTY, frame);
    if (overlap === undefined) return [];
    // A band another cover of the target meets shows that cover, not the control it is a band of.
    const others = facts.covers.filter((c) => c !== peer);
    const clear = (bands: readonly Rect[]): Rect[] =>
      bands.flatMap((b) => {
        const on = rectIntersection(b, frame);
        return on === undefined || others.some((c) => rectIntersection(c.rect, on) !== undefined) ? [] : [on];
      });
    const left = Math.min(node.rect.x, peer.rect.x);
    const right = Math.max(node.rect.x + node.rect.width, peer.rect.x + peer.rect.width);
    const beside = [
      { x: frame.x, y: overlap.y, width: left - frame.x, height: overlap.height },
      { x: right, y: overlap.y, width: frame.x + frame.width - right, height: overlap.height },
    ].filter((r) => r.width > 0 && r.height > 0);
    return [{ peer, overlap, nodeBands: clear(bandsBeside(node.rect, overlap)), peerBands: clear(bandsBeside(peer.rect, overlap)), beside }];
  });
  return pairs.length === 0 ? undefined : { tree, node, pairs };
}

const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The strips of `r` beside `overlap` (a part of it): above, below, left and right of the overlap, on its columns or
 * rows, where `r` reaches past it — each no deeper than the overlap on that axis, so the band read is the one next to it.
 * Outside the other control by construction: the overlap is the two's intersection, so where `r` reaches past an edge of
 * it, the other does not.
 */
function bandsBeside(r: Rect, overlap: Rect): Rect[] {
  const bottom = overlap.y + overlap.height;
  const right = overlap.x + overlap.width;
  const top = Math.max(r.y, overlap.y - overlap.height);
  const below = Math.min(r.y + r.height, bottom + overlap.height);
  const leftmost = Math.max(r.x, overlap.x - overlap.width);
  const rightmost = Math.min(r.x + r.width, right + overlap.width);
  return [
    { x: overlap.x, y: top, width: overlap.width, height: overlap.y - top },
    { x: overlap.x, y: bottom, width: overlap.width, height: below - bottom },
    { x: leftmost, y: overlap.y, width: overlap.x - leftmost, height: overlap.height },
    { x: right, y: overlap.y, width: rightmost - right, height: overlap.height },
  ].filter((b) => b.width > 0 && b.height > 0);
}

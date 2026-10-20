import { rectIntersection, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { axisOfEdge, sameRectWithinPixel, type Edge } from './geometry.js';
import { lookTold, type Look, type LookReading } from './look.js';
import { seenOrderOf, type OrderSeen, type SeenOrder } from './seen-order.js';
import type { FlushNeighbour } from './later-edges.js';
import type { PixelStanding, Scene, Standing } from './standing.js';
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
 * such a run that overlap the tree cannot say which is drawn on top (cover.ts#CoverOrder's `untold`, ADR 0015
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
 * declared colour — and each of its rules answers `untold` (ui-tree/seen-order.ts#PairSeen) wherever its evidence is
 * missing, which keeps the refusal (what one frame cannot tell apart at all: ADR 0024's residuals). The answer re-enters
 * the pure draw order as an input (ui-tree/seen-order.ts#seenOrderOf, draw-order.ts#drawOrder's `orderSeen`, through
 * ui-tree/look.ts#lookTold).
 *
 * ASKED BY ONE CYCLE (`judgedWithOrder`): judge the look, ask the question its standing asks (if any) once, judge again
 * on the look told the answer — the verbs supply only their purpose (the tap's standings, the pixel assert's region).
 * `scroll_until`'s pure reducer cannot await, so it asks by a step and its driver answers with `orderSeenBy`, the read
 * judged again on `lookTold` (interact/scroll-read.ts#factsOf) — the same conversion and the same told look.
 */

/** The eyes as a verb is handed them for the order question (verify/eyes.ts#eyesOn at the composition root; a table in tests). */
export type OrderEyes = Pick<Eyes, 'order'>;

/** What `eyes` saw of `question`, as a look is told it (ui-tree/seen-order.ts#seenOrderOf of the question's node); no eyes wired, nothing seen — the listing's untold order. */
export async function orderSeenBy(eyes: OrderEyes | undefined, question: OrderQuestion): Promise<SeenOrder> {
  return seenOrderOf(question.node, eyes === undefined ? [] : await eyes.order(question));
}

/**
 * THE ORDER QUESTION'S CYCLE: `judge` (the verb's purpose) on `look`; when that standing of `node` asks the order
 * question (`orderQuestion`) and eyes are wired, they are asked ONCE and `judge` runs again on the look told what they
 * saw (ui-tree/look.ts#lookTold) — that standing is the answer. Otherwise the first standing, nothing asked.
 */
export async function judgedWithOrder<R extends LookReading, S extends Standing | PixelStanding>(
  look: Look<R>,
  node: UiNode,
  eyes: OrderEyes | undefined,
  judge: (look: Look<R>) => S | Promise<S>,
): Promise<S> {
  const first = await judge(look);
  const question = eyes === undefined ? undefined : orderQuestion(look.tree, node, first);
  return question === undefined ? first : judge(lookTold(look, await orderSeenBy(eyes, question)));
}

/** One pair the eyes are asked to order: the target against `peer`, in tree units. */
export interface OrderPair {
  /** The `untold` cover of the target (cover.ts#CoverOrder): its order against the target the listing does not give. */
  readonly peer: UiNode;
  /** Where the two overlap, in the frame the standing was judged in. */
  readonly overlap: Rect;
  /** The target's clear bands: the strips of it beside the overlap, outside the peer, along each edge of the overlap it reaches past (each at most the overlap's own depth on that axis), none meeting another cover of it. Empty: none. */
  readonly nodeBands: readonly Rect[];
  /** The peer's clear bands, likewise: the strips of it beside the overlap, outside the target. */
  readonly peerBands: readonly Rect[];
  /**
   * What lies AROUND the target beside each of its clear bands: the strips of the screen just outside its rect — past
   * the edge the band faces, and on the band's rows (columns) past its two side edges — each as deep as the band
   * (`bandsBeside`): where a control that draws nothing there shows the same surface as in its band (a text-only
   * button over a card: the card runs on past its edge, ahead or sideways). Empty: none on the screen.
   */
  readonly nodeAround: readonly AroundStrip[];
  /** What lies around the peer beside each of its clear bands, likewise. */
  readonly peerAround: readonly AroundStrip[];
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
 * does not order, ui-tree/standing.ts#Remedy) and not yet looked at (no `why`) — or undefined: every other standing
 * asks nothing. Its pairs are the standing's `untold` covers, judged in its frame (`facts.screen`).
 */
export function orderQuestion(tree: UiNode, node: UiNode, standing: Standing | PixelStanding): OrderQuestion | undefined {
  if (standing.kind !== 'covered' || standing.remedy.of !== 'unordered' || standing.remedy.why !== undefined) return undefined;
  const { facts } = standing;
  const frame = facts.screen;
  const pairs = facts.covers.filter((c) => c.order.kind === 'untold').flatMap(({ node: peer }): OrderPair[] => {
    const both = rectIntersection(node.rect, peer.rect);
    const overlap = both === undefined ? undefined : rectIntersection(both, frame);
    if (overlap === undefined) return [];
    // A band another cover of the target meets shows that cover, not the control it is a band of.
    const others = facts.covers.filter((c) => c.node !== peer);
    const clear = (bands: readonly BandBeside[]): BandBeside[] =>
      bands.flatMap(({ band, around }) => {
        const on = rectIntersection(band, frame);
        return on === undefined || others.some((c) => rectIntersection(c.node.rect, on) !== undefined) ? [] : [{ band: on, around }];
      });
    const aroundOf = (bands: readonly BandBeside[]): AroundStrip[] =>
      bands.flatMap(({ around }) => around.flatMap(({ rect, against }) => {
        const on = rectIntersection(rect, frame);
        return on === undefined ? [] : [{ rect: on, against }];
      }));
    const nodeBands = clear(bandsBeside(node.rect, overlap));
    const peerBands = clear(bandsBeside(peer.rect, overlap));
    const left = Math.min(node.rect.x, peer.rect.x);
    const right = Math.max(node.rect.x + node.rect.width, peer.rect.x + peer.rect.width);
    const beside = [
      { x: frame.x, y: overlap.y, width: left - frame.x, height: overlap.height },
      { x: right, y: overlap.y, width: frame.x + frame.width - right, height: overlap.height },
    ].filter((r) => r.width > 0 && r.height > 0);
    return [{ peer, overlap, nodeBands: nodeBands.map((b) => b.band), peerBands: peerBands.map((b) => b.band), nodeAround: aroundOf(nodeBands), peerAround: aroundOf(peerBands), beside }];
  });
  return pairs.length === 0 ? undefined : { tree, node, pairs };
}

/**
 * A strip of the screen around a control (`OrderPair.nodeAround`, `peerAround`): its rect, and which of its edges lies
 * against the control — the judge reads the whole strip and its thin slice against the control (verify/eyes.ts
 * #judgeOrder), so a surface that runs on only two png pixels past the control's edge is seen too.
 */
export interface AroundStrip {
  readonly rect: Rect;
  readonly against: Edge;
}

/**
 * A strip of a control beside the overlap (`band`), and the strips of the screen just outside the control around it
 * (`around`): past the edge the band faces, and on the band's own rows (columns) past the control's two side edges —
 * where a surface showing through a control that draws nothing there runs on, ahead or sideways.
 */
interface BandBeside {
  readonly band: Rect;
  readonly around: readonly AroundStrip[];
}

/**
 * The strips of `r` beside `overlap` (a part of it): above, below, left and right of the overlap, on its columns or
 * rows, where `r` reaches past it — each no deeper than the overlap on that axis, so the band read is the one next to it.
 * Outside the other control by construction: the overlap is the two's intersection, so where `r` reaches past an edge of
 * it, the other does not. Each with what lies AROUND `r` (`BandBeside.around`): the strip just outside `r` past the
 * edge the band faces, across the band, and the two strips on the band's rows (columns) just past `r`'s side edges —
 * each as deep as the band.
 */
function bandsBeside(r: Rect, overlap: Rect): BandBeside[] {
  const bottom = overlap.y + overlap.height;
  const right = overlap.x + overlap.width;
  const top = Math.max(r.y, overlap.y - overlap.height);
  const below = Math.min(r.y + r.height, bottom + overlap.height);
  const leftmost = Math.max(r.x, overlap.x - overlap.width);
  const rightmost = Math.min(r.x + r.width, right + overlap.width);
  const above = overlap.y - top;
  const under = below - bottom;
  const before = overlap.x - leftmost;
  const after = rightmost - right;
  // A band above or below the overlap: ahead of it past `r`'s top or bottom edge, sideways past its left and right edges
  // on the band's rows; a band left or right of it, ahead past `r`'s side edge, sideways past its top and bottom edges
  // on the band's columns — every strip as deep as the band.
  const rows = (band: Rect, ahead: AroundStrip, d: number): BandBeside => ({
    band,
    around: [ahead, { rect: { x: r.x - d, y: band.y, width: d, height: band.height }, against: 'right' }, { rect: { x: r.x + r.width, y: band.y, width: d, height: band.height }, against: 'left' }],
  });
  const columns = (band: Rect, ahead: AroundStrip, d: number): BandBeside => ({
    band,
    around: [ahead, { rect: { x: band.x, y: r.y - d, width: band.width, height: d }, against: 'bottom' }, { rect: { x: band.x, y: r.y + r.height, width: band.width, height: d }, against: 'top' }],
  });
  return [
    rows({ x: overlap.x, y: top, width: overlap.width, height: above }, { rect: { x: overlap.x, y: r.y - above, width: overlap.width, height: above }, against: 'bottom' }, above),
    rows({ x: overlap.x, y: bottom, width: overlap.width, height: under }, { rect: { x: overlap.x, y: r.y + r.height, width: overlap.width, height: under }, against: 'top' }, under),
    columns({ x: leftmost, y: overlap.y, width: before, height: overlap.height }, { rect: { x: r.x - before, y: overlap.y, width: before, height: overlap.height }, against: 'right' }, before),
    columns({ x: right, y: overlap.y, width: after, height: overlap.height }, { rect: { x: r.x + r.width, y: overlap.y, width: after, height: overlap.height }, against: 'left' }, after),
  ].filter(({ band }) => band.width > 0 && band.height > 0);
}

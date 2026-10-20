import { rectArea, sameRect, type Rect, type UiNode } from '../adapters/types.js';
import { listsAncestry, listsUnclippedFrames, type DrawOrder } from './draw-order.js';
import { across, rectWithin, type Clips, type Edge } from './geometry.js';

/**
 * THE EDGE EVIDENCE OF COMPOSE'S CUT AT A LATER NODE: on a tree whose source cuts a node's bounds at a node drawn after
 * it (`cutsAtLater`: a nested tree of clipped frames, Android's — Compose leaves out of a node's bounds what a later
 * node covers, so a node partly under a pinned bar is dumped ending exactly at that bar's node), the one fact the tree
 * keeps of such a cut is a node drawn after the target laid FLUSH against one of its edges (`laterAcross`). That fact
 * cannot say by itself whether the target runs on under it; what it means depends on where the two lie. This module
 * finds it once per edge and CLASSIFIES it (`LaterEdge`), and every reader asks the class instead of re-deriving it:
 *
 * - `overlay` — the node in NO scroll view, the later node across its top or bottom edge reaching past it at BOTH ends:
 *   an overlay laid over content with margins of its own (`OverlaidEdge`); its own node is the cover.
 * - `outsideScrollView` — the node in a clipping scroll view, the later node outside it (a bar pinned over the content
 *   or riding on the IME): a flush neighbour (`FlushNeighbour`) whose SURFACE past its node only the eyes can judge.
 * - `beside` — any other flush later node: a layout neighbour laid beside it in no scroll view (a list's next row, a
 *   field under its title, a touch target exactly as wide, any side edge), or a node in the target's own scroll view
 *   (the list's next row, or a sticky header in it).
 * - `none` — no later node lies flush there (and every edge, on a tree of another dialect or a node of no area).
 *
 * `overlay` and `outsideScrollView` are COMPLEMENTS — the same evidence, read for a node in no scroll view and one in
 * a scroll view — so one classifier makes both: a node in a scroll view is never an overlay's, because at rest a
 * list's first row lies whole and flush under a bar pinned at its edge, dumped exactly as a row the bar cuts (the lab's
 * `scroll-sticky-cut`); only motion can tell (scroll_until's flush probe, the eyes).
 *
 * Readers (ui-tree/standing.ts): the sliver cut by a later node (`cutByLater`: a control thinner than the tap minimum
 * across an edge of any class but `none`; a role-less strip only on an `overlay`), the `fully` stop's and the pixel
 * assert's overlaid cover (`LaterEdges.overlaid`, cover.ts#overlaidCover), and `Scene.flushNeighbours` (the eyes'
 * trigger, ui-tree/eyes.ts, which leaves out a neighbour spanning the screen — a question about the screen, not the
 * edge). Edges are asked top, bottom, left, right; the overlay top and bottom only (every measured Compose cut is
 * vertical; sideways a row's padded overflow icon reaches past its neighbour's ends).
 *
 * The next class is VA1's (docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md): a row
 * Compose cut at a sticky header IN its own list is today `beside` — the header flush across its top edge, in the
 * same scroll view — read whole; telling it from the next row needs a flush probe toward the header, so that class
 * splits from `beside` here and its reader is the probe.
 *
 * Not a reader: adapters/android.ts#widenUnderCovers. It is different evidence — the strip a node GAINS when the
 * parser widens it to its descendants' extent (a node whose own content still carries the cut extent), asked through
 * the `DrawnOverStrip` port (adapters/types.ts) while the dump is parsed, before any scene exists, in the adapter
 * layer. This module's evidence is the leaf's case: nothing of the node is left to widen it by.
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md (refined 2026-10-20)
 */

/** One edge of a node and the later node laid flush against it, classified (the module doc), with `depth`, the node's extent across that edge — its height at the top or bottom, its width at a side. */
export type LaterEdge =
  | { readonly kind: 'none'; readonly edge: Edge; readonly depth: number }
  | { readonly kind: 'overlay'; readonly edge: 'top' | 'bottom'; readonly by: UiNode; readonly depth: number }
  | { readonly kind: 'outsideScrollView' | 'beside'; readonly edge: Edge; readonly by: UiNode; readonly depth: number };

/**
 * AN OVERLAID EDGE: a top or bottom edge of a node's bounds that the tree's source cut at a node DRAWN OVER IT — so an
 * unknown run of the node lies under `by` (`LaterEdge`'s `overlay`). `by` is the node laid flush against that edge along
 * the node's whole width, drawn after it outside its subtree, that also REACHES PAST THE NODE AT BOTH ENDS of the edge:
 * an overlay laid over content with margins of its own (the lab's pinned `Continue` 66..1014 over its row 127..952),
 * where a sibling laid beside it in a column shares an alignment line with it at one end at least (a list's next row, a
 * field under its title, a touch target exactly as wide). Never for a node in a scroll view (the module doc): a row cut
 * at a bar at its list's edge stays read whole (open: VA1). Decided from the tree alone — no screenshot sees under an
 * opaque node.
 *
 * Unlike `FlushNeighbour` (its complement), here the neighbour's own node is the cover. Asked where nothing else
 * covers: the `fully` stop and the pixel assert name it as their cover (cover.ts#overlaidCover, appended to
 * standing.ts#StandingFacts.covers), and a node with no control role but not a text, cut by it to a strip under the
 * tap minimum, is a sliver (standing.ts#cutByLater). The tap and the plain stop judge the centre, which the cut leaves
 * clear unless it is a sliver.
 * docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 */
export interface OverlaidEdge {
  readonly edge: 'top' | 'bottom';
  readonly by: UiNode;
}

/**
 * A FLUSH NEIGHBOUR: a node drawn after a node, OUTSIDE the scroll view the node lies in, laid flush against its `edge`
 * along its whole extent there (`LaterEdge`'s `outsideScrollView`). What the tree cannot say is whether that node's
 * SURFACE ends where its node does: the lab's `form-keyboard` bar riding on the IME draws 28 px of padding above its
 * `Continue` (`55,1238 970x132`, the bar `0,1210 1080x188` by the app's frames) and dumps no node for it, so after one
 * stroke `phone` dumped `55,1113 970x125`, flush with `Continue`, read "fully visible" while the bar covered 18 px of
 * its field (live case k7; docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md, the eyes). The
 * neighbour is the first such node in draw order (the outermost: the submit bar's node, not its button), whatever the
 * node's depth across that edge, and one per edge (a row between a pinned header and a bar riding on the IME has two).
 */
export interface FlushNeighbour {
  readonly edge: Edge;
  readonly by: UiNode;
}

/** A node's four edges, classified (`LaterEdge`) — each asked on first use and kept. */
export interface LaterEdges {
  /** The edge's flush later node, classified. */
  at(edge: Edge): LaterEdge;
  /** The node's overlaid edge (`overlay`), top before bottom, or undefined — never asked of a node in a scroll view. */
  overlaid(): OverlaidEdge | undefined;
  /** Its flush neighbours (`outsideScrollView`), top, bottom, left, right — empty for a node in no scroll view. */
  flushNeighbours(): readonly FlushNeighbour[];
}

/** What the classification asks of the scene: the draw order's covers and the clip facts' scroll views. */
export interface LaterScene {
  readonly order: Pick<DrawOrder, 'coversOf'>;
  readonly clips: Pick<Clips, 'scrollersOf'>;
}

/** The edges in the order every reader asks them. */
export const EDGES = ['top', 'bottom', 'left', 'right'] as const;

/**
 * The classifier of `tree`'s nodes' edges over `scene` (the module doc): the dialect asked once (`cutsAtLater`); on a
 * tree of another dialect — WDA reports frames unclipped, idb's flat list has no subtree to judge "after" by — and for
 * a node of no area, every edge is `none`.
 */
export function laterEdgesIn(tree: UiNode, scene: LaterScene): (node: UiNode) => LaterEdges {
  const cutsAtLater = listsAncestry(tree) && !listsUnclippedFrames(tree);
  return (node) => (cutsAtLater && rectArea(node.rect) !== 0 ? classified(scene, node) : uncut(node));
}

/** Every edge `none`. */
function uncut(node: UiNode): LaterEdges {
  return { at: (edge) => ({ kind: 'none', edge, depth: across(node.rect, edge) }), overlaid: () => undefined, flushNeighbours: () => [] };
}

/** `node`'s edges classified over `scene`, on a tree that cuts at later nodes. */
function classified(scene: LaterScene, node: UiNode): LaterEdges {
  const r = node.rect;
  let scrollers: readonly Rect[] | undefined;
  const ownScrollers = (): readonly Rect[] => (scrollers ??= scene.clips.scrollersOf(node));
  const kept = new Map<Edge, LaterEdge>();
  const classify = (edge: Edge): LaterEdge => {
    const depth = across(r, edge);
    const by = laterAcross(scene.order, node, edge);
    if (by === undefined) return { kind: 'none', edge, depth };
    const own = ownScrollers()[0];
    if (own !== undefined) return { kind: scene.clips.scrollersOf(by).some((s) => sameRect(s, own)) ? 'beside' : 'outsideScrollView', edge, by, depth };
    const c = by.rect;
    // An overlay's own margins: past the node at both ends, not on an alignment line it shares with it.
    if ((edge === 'top' || edge === 'bottom') && c.x < r.x && c.x + c.width > r.x + r.width) return { kind: 'overlay', edge, by, depth };
    return { kind: 'beside', edge, by, depth };
  };
  const at = (edge: Edge): LaterEdge => {
    const known = kept.get(edge);
    if (known !== undefined) return known;
    const edged = classify(edge);
    kept.set(edge, edged);
    return edged;
  };
  return {
    at,
    // The scroll view asked first: a node in one has no overlay, and its edges' covers are not asked for it.
    overlaid: () => (ownScrollers().length > 0 ? undefined : (['top', 'bottom'] as const).map(at).find((e) => e.kind === 'overlay')),
    flushNeighbours: () => (ownScrollers().length === 0 ? [] : EDGES.map(at).flatMap((e) => (e.kind === 'outsideScrollView' ? [{ edge: e.edge, by: e.by }] : []))),
  };
}

/**
 * The first node in draw order (the outermost) drawn after `node`, outside its subtree, that draws over it as a target
 * (draw-order.ts#DrawOrder.coversOf) and holds the pixel row (column) just past `edge` along the node's whole extent
 * there without holding the node itself — a node laid FLUSH against that edge: the evidence every class reads.
 */
function laterAcross(order: Pick<DrawOrder, 'coversOf'>, node: UiNode, edge: Edge): UiNode | undefined {
  const r = node.rect;
  const strip: Rect = {
    top: { x: r.x, y: r.y - 1, width: r.width, height: 1 },
    bottom: { x: r.x, y: r.y + r.height, width: r.width, height: 1 },
    left: { x: r.x - 1, y: r.y, width: 1, height: r.height },
    right: { x: r.x + r.width, y: r.y, width: 1, height: r.height },
  }[edge];
  return order.coversOf(node, strip).find((c) => rectWithin(strip, c.rect) && !rectWithin(r, c.rect));
}

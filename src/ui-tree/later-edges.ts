import { rectArea, sameRect, type Rect, type UiNode } from '../adapters/types.js';
import { listsAncestry, listsUnclippedFrames, type DrawOrder } from './draw-order.js';
import { across, EDGES, flushEdges, rectWithin, type Clips, type Edge } from './geometry.js';

/**
 * THE EDGE EVIDENCE OF COMPOSE'S CUT AT A LATER NODE: on a tree whose source cuts a node's bounds at a node drawn after
 * it (`cutsAtLater`: a nested tree of clipped frames, Android's — Compose leaves out of a node's bounds what a later
 * node covers, so a node partly under a pinned bar is dumped ending exactly at that bar's node), the one fact the tree
 * keeps of such a cut is a node drawn after the target laid FLUSH against one of its edges (`laterAcross`). That fact
 * cannot say by itself whether the target runs on under it; what it means depends on where the two lie. This module
 * finds it once per edge and CLASSIFIES it (`LaterEdge`), and every reader asks the class instead of re-deriving it:
 *
 * - `overlaid` — the node in NO scroll view, the later node across its top or bottom edge reaching past it at BOTH ends:
 *   an overlay laid over content with margins of its own (`OverlaidEdge`); its own node is the cover.
 * - `outsideScrollView` — the node in a clipping scroll view, the later node outside it (a bar pinned over the content
 *   or riding on the IME): a flush neighbour (`FlushNeighbour`) whose SURFACE past its node only the eyes can judge.
 * - `aligned` — the node in no scroll view, the later node a layout neighbour sharing an alignment line with it at one
 *   end at least (a list's next row, a field under its title, a touch target exactly as wide), or across any side edge.
 * - `pinnedInScrollView` — the node in a clipping scroll view, the later node in that same scroll view PINNED at its
 *   edge on that side (its outer edge within a pixel of the scroll view's) and laid flush against the node, not over
 *   it (its inner edge within a pixel of the node's), at the content's START — the top or left edge, where a sticky
 *   header pins: a sticky header holding its list's top (`PinnedEdge`). The node runs on under it or it does not — a
 *   row Compose cut at its merged sticky header (the lab's `scroll-sticky-cut`, VA1) and a first row at rest whole
 *   under it are the same tree; only motion tells them, so its one reader is the `fully` stop's flush probe, pointed at
 *   the pinned node's inner edge as at a clipping container's edge. Not at the far edges (bottom, right): there the
 *   node flush with the row and with the scroll view's edge is the list's NEXT row cut at the fold, listed after the
 *   row as a pinned footer would be — every `fully` stop on the row above it would be probed, the probe carrying it
 *   on while the row after it lies cut at the fold. At the start the row before it is listed BEFORE it, so no later
 *   node is. Residual, stated: a reversed list (`reverseLayout`) pins its sticky header at the bottom, read as the
 *   next row (a row cut there still reads whole), and lists the rows above a row after it (a row cut at the top
 *   reads pinned: one needless probe); a right-to-left horizontal list lists the card to a card's left after it (the
 *   card next to the leftmost one shown reads pinned: one needless probe on a sideways `fully` stop).
 * - `sameScrollView` — the node in a clipping scroll view, the later node in that same scroll view and not pinned so
 *   (the list's next row, a field under its title): the list's own content, which its scroll moves.
 * - `none` — no later node lies flush there (and every edge, on a tree of another dialect or a node of no area).
 *
 * `overlaid` and `outsideScrollView` are COMPLEMENTS — the same evidence, read for a node in no scroll view and one in
 * a scroll view — so one classifier makes both (as `aligned` and `sameScrollView` are each one's other side): a node in
 * a scroll view is never an overlay's, because at rest a list's first row lies whole and flush under a bar pinned at
 * its edge, dumped exactly as a row the bar cuts (the lab's `scroll-sticky-cut`), and an edge-to-edge top bar over a
 * padded list reaches past its rows at both ends as an overlay does; only motion can tell (scroll_until's flush probe —
 * `pinnedInScrollView` in the list, a clipping container's edge or a flush neighbour outside it — and the eyes). And a
 * node in no scroll view has no flush neighbour: no scroll moves it, so no stop waits on its surface.
 *
 * Readers (ui-tree/standing.ts): the sliver cut by a later node (`cutByLater`: a control thinner than the tap minimum
 * across an edge of any class but `none`; a role-less strip only on an `overlaid` edge), the `fully` stop's and the pixel
 * assert's overlaid cover (`LaterEdges.overlaid`, cover.ts#overlaidCover), `Scene.flushNeighbours` (the eyes'
 * trigger, ui-tree/eyes.ts, which leaves out a neighbour spanning the screen — a question about the screen, not the
 * edge), and `Scene.pinnedEdges` (the `fully` stop's flush probe, interact/scroll-rounds.ts#PROBE_REACH). Edges are
 * asked top, bottom, left, right; the overlay top and bottom only (every measured Compose cut is vertical; sideways a
 * row's padded overflow icon reaches past its neighbour's ends).
 *
 * Not for the pixel assert: `pinnedInScrollView` refuses nothing there — it has no motion to ask, and failing closed
 * would fail every first row at rest under a sticky header (stated residual: the colour of a row cut at a merged
 * sticky header is sampled on what the tree lists of it, which is all drawn; its rest lies under the opaque header,
 * where no screenshot sees; `scroll_until fully: true` first brings it whole).
 * docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md
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
  | OverlaidEdge
  | { readonly kind: 'outsideScrollView'; readonly edge: Edge; readonly by: UiNode; readonly depth: number }
  | PinnedEdge
  | { readonly kind: 'sameScrollView' | 'aligned'; readonly edge: Edge; readonly by: UiNode; readonly depth: number };

/**
 * A PINNED EDGE: an edge of a node in a clipping scroll view (its nearest) laid flush against `by`, a node drawn
 * after it IN that scroll view and pinned at the scroll view's edge on that side (`LaterEdge`'s
 * `pinnedInScrollView`) — so the scroll view shows nothing of its content past `by`'s inner edge, and that edge is
 * where the node may be cut, as at a clipping container's own edge. The lab's merged sticky header `0,303 1080x154`
 * held at its list's top `0,303 1080x1238`, R dumped `128,457 825x110` under it (66 px cut, VA1) — and at rest `128,457
 * 825x176` whole: the tree is the same, so this says only where to probe, never that the node is cut.
 */
export interface PinnedEdge {
  readonly kind: 'pinnedInScrollView';
  /** At the content's start only (the module doc). */
  readonly edge: 'top' | 'left';
  readonly by: UiNode;
  readonly depth: number;
}

/**
 * AN OVERLAID EDGE: a top or bottom edge of a node's bounds that the tree's source cut at a node DRAWN OVER IT — so an
 * unknown run of the node lies under `by` (`LaterEdge`'s `overlaid`). `by` is the node laid flush against that edge
 * along the node's whole width, drawn after it outside its subtree, that also REACHES PAST THE NODE AT BOTH ENDS of the
 * edge: an overlay laid over content with margins of its own (the lab's pinned `Continue` 66..1014 over its row
 * 127..952), where a sibling laid beside it in a column shares an alignment line with it at one end at least (a list's
 * next row, a field under its title, a touch target exactly as wide). Never for a node in a scroll view (the module
 * doc): a row cut at a sticky header pinned in its list is `pinnedInScrollView`'s, the flush probe's (VA1). Decided
 * from the tree alone — no screenshot sees under an opaque node.
 *
 * Unlike `FlushNeighbour` (its complement), here the neighbour's own node is the cover. Asked where nothing else
 * covers: the `fully` stop and the pixel assert name it as their cover (cover.ts#overlaidCover, appended to
 * standing.ts#StandingFacts.covers), and a node with no control role but not a text, cut by it to a strip under the
 * tap minimum, is a sliver (standing.ts#cutByLater). The tap and the plain stop judge the centre, which the cut leaves
 * clear unless it is a sliver.
 * docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 */
export interface OverlaidEdge {
  readonly kind: 'overlaid';
  readonly edge: 'top' | 'bottom';
  readonly by: UiNode;
  readonly depth: number;
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
 * So it keeps the edge and its node of the `outsideScrollView` class, not its `depth`: the eyes judge the neighbour's
 * surface past its node, which the node's own extent across that edge says nothing of.
 */
export type FlushNeighbour = Pick<Extract<LaterEdge, { kind: 'outsideScrollView' }>, 'edge' | 'by'>;

/** A node's four edges, classified (`LaterEdge`) — each asked on first use and kept. */
export interface LaterEdges {
  /** The edge's flush later node, classified. */
  at(edge: Edge): LaterEdge;
  /** The node's overlaid edge (`overlaid`), top before bottom, or undefined — never asked of a node in a scroll view. */
  overlaid(): OverlaidEdge | undefined;
  /** Its flush neighbours (`outsideScrollView`), top, bottom, left, right — empty for a node in no scroll view. */
  flushNeighbours(): readonly FlushNeighbour[];
  /**
   * Its edges laid flush under a node pinned in its own scroll view (`pinnedInScrollView`), top before left (the only
   * edges it pins at) — empty for a node in no scroll view.
   */
  pinned(): readonly PinnedEdge[];
}

/** What the classification asks of the scene: the draw order's covers and the clip facts' scroll views. */
export interface LaterScene {
  readonly order: Pick<DrawOrder, 'coversOf'>;
  readonly clips: Pick<Clips, 'scrollersOf'>;
}

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
  return { at: (edge) => ({ kind: 'none', edge, depth: across(node.rect, edge) }), overlaid: () => undefined, flushNeighbours: () => [], pinned: () => [] };
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
    if (own !== undefined) {
      if (!scene.clips.scrollersOf(by).some((s) => sameRect(s, own))) return { kind: 'outsideScrollView', edge, by, depth };
      // Pinned only at the content's start (the module doc): at the far edges the next row cut at the fold looks alike.
      if ((edge === 'top' || edge === 'left') && pinnedAt(own, r, by.rect, edge)) return { kind: 'pinnedInScrollView', edge, by, depth };
      return { kind: 'sameScrollView', edge, by, depth };
    }
    const c = by.rect;
    // An overlay's own margins: past the node at both ends, not on an alignment line it shares with it.
    if ((edge === 'top' || edge === 'bottom') && c.x < r.x && c.x + c.width > r.x + r.width) return { kind: 'overlaid', edge, by, depth };
    return { kind: 'aligned', edge, by, depth };
  };
  const at = (edge: Edge): LaterEdge => {
    const known = kept.get(edge);
    if (known !== undefined) return known;
    const edged = classify(edge);
    kept.set(edge, edged);
    return edged;
  };
  // The scroll view asked first: a node in one has no overlay, and its edges' covers are not asked for it; the bottom
  // edge asked only when the top is no overlay.
  const overlaid = (): OverlaidEdge | undefined => {
    if (ownScrollers().length > 0) return undefined;
    for (const edge of ['top', 'bottom'] as const) {
      const edged = at(edge);
      if (edged.kind === 'overlaid') return edged;
    }
    return undefined;
  };
  return {
    at,
    overlaid,
    flushNeighbours: () => (ownScrollers().length === 0 ? [] : EDGES.map(at).flatMap((e) => (e.kind === 'outsideScrollView' ? [{ edge: e.edge, by: e.by }] : []))),
    pinned: () => (ownScrollers().length === 0 ? [] : EDGES.map(at).filter((e): e is PinnedEdge => e.kind === 'pinnedInScrollView')),
  };
}

/**
 * `by` (laid across `node`'s `edge` at the content's start, in its scroll view `scrollView`) is pinned there: its outer
 * edge on that side lies on the scroll view's (geometry.ts#flushEdges, within a pixel), and its inner edge (its bottom,
 * at the top; its right, at the left) on the node's, within a pixel — flush, not drawn over it (a header overlapping
 * the row is a cover, the draw order's).
 */
function pinnedAt(scrollView: Rect, node: Rect, by: Rect, edge: 'top' | 'left'): boolean {
  const [inner, own] = edge === 'top' ? [by.y + by.height, node.y] : [by.x + by.width, node.x];
  return flushEdges(by, scrollView).includes(edge) && Math.abs(inner - own) <= 1;
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

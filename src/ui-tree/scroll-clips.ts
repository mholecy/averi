import { clips, isScrollViewOf, scrollAxis, scrolls } from './scroll-containers.js';
import { across, axisOfEdge, distanceInside, EDGES, flushEdges, screenOf, type Edge } from './geometry.js';
import { everyNode, INPUT_ROLE, rectArea, rectIntersection, sameRect, type Rect, type ScrollAxis, type UiNode } from '../adapters/types.js';

/**
 * Where a node is drawn under its scrolling ancestors: a tree's `Clips` (`clipsOf`), the frame each node's scroll views
 * draw it in (`Drawn`), the evidenced cuts at a clipping ancestor's edge (`Cut`) and the screen's largest scroller.
 * Which nodes clip and scroll is scroll-containers.ts's; the rect and edge arithmetic read here is geometry.ts's.
 */

/** A scroll view as `Clips.scrollViewsOn` lists it: the node, and the one axis the tree tells it scrolls on (undefined: not told). */
interface ListedScrollView {
  readonly node: UiNode;
  readonly axis: ScrollAxis | undefined;
}

/**
 * What a tree's CLIPPING says of its nodes (`clipsOf`), from one walk: each
 * node's clipping chain (`scrollersOf`) and its sliver cut (`cutSliver`).
 * Asked of nodes of THIS tree (a node of another read has no clipping
 * ancestor here: an empty chain, no cut).
 */
export interface Clips {
  /**
   * The node's ancestors that CLIP it — every node marked
   * `clipsDescendants` above it (adapters/types.ts#UiNode.clipsDescendants:
   * Android's `scrollable="true"`, to which uiautomator cuts its
   * descendants' bounds — most of them: `drawnIn` cuts the rest),
   * NEAREST FIRST, as their rects; empty for a node with none, which is
   * every node of an iOS tree. `scroll_until`'s
   * round asks it of each match (interact/scroll-read.ts#TreeFacts), to
   * tell a `fully: true` stop whose edge sits exactly on a clipping
   * ancestor's — possibly cut there — from one inside them all
   * (interact/flush-check.ts), and to pick the box its strokes
   * are drawn in. The whole chain, not the nearest alone: a card that fills a horizontal carousel's
   * height is flush with BOTH of the carousel's edges — one probe cannot
   * tell — while the carousel itself is cut by the vertical list around it,
   * and the card's rect with it; the cut is on the outer edge, and the outer
   * list is the one to stroke. The array is shared along a branch.
   */
  scrollersOf(node: UiNode): readonly Rect[];
  /**
   * `evidentCut` when what shows of the node across that edge is under
   * `minPiece` (draw-order.ts#MIN_TAP_PIECE_FRACTION, `Exposure.minPiece`)
   * — a sliver a tap is refused on and `scroll_until`'s plain stop does
   * not stop on; undefined otherwise. The rule's other evidence — a cut by
   * a node drawn after it (standing.ts#cutByLater, `Cut.by`) — is asked
   * after it, not here: it needs the draw order.
   *
   * Or INHERITED (the owner's decision, the bug note below): a node flush within a pixel with an
   * edge whose ancestor — below the container of that edge — is itself a
   * sliver cut at that edge of that container, nearest such ancestor first
   * (past a nearer sliver cut at another edge), and the node's own depth
   * across it under the minimum too (`Cut.within`, the ancestor's rect).
   * Measured: the toggle `66,1924 948x55` is refused at the form's bottom,
   * and its leaf label "Payment details" `66,1936 948x42`, which has no
   * content of its own to evidence the cut (`evidentCut`'s "Unknowable"),
   * was tapped at (540,1957) and nothing expanded — the toggle's refusal had
   * pointed at it ("tap a child of it"). A child that lies clear of the edge
   * is not refused: it shows whole inside the strip. Nor is a node flush
   * with the edge of an ancestor cut there DEEPER than the minimum (Create
   * contact's IME-cut field `132,1307 816x91`, its label "Company" `176,1373
   * 190x25` on the cut: tapped, and it focused the field) or one that is not
   * evidently cut at all (a whole button at a form's end, its background
   * flush with it).
   *
   * Cost: each node's answer is kept, per minimum, for the life of the
   * `Clips` — derived once a round for every match (the round's scene,
   * interact/scroll-read.ts#factsOf), once a tap — so an ancestor shared by the matches is judged
   * once. An ancestor is judged at all only when the node is flush with an
   * edge it is shallower than the minimum across: a wrapper filling its
   * scroller (flush with all four edges, its subtree the whole list) is
   * deeper than any sliver, and never walked for it; its own `evidentCut`
   * walks its subtree per flush edge.
   * docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md
   */
  cutSliver(node: UiNode, minPiece: number): Cut | undefined;
  /**
   * Whether the node lies inside something that scrolls — an ancestor that
   * scroll-containers.ts#scrolls — or undefined when the tree cannot say:
   * a listing without ancestry (`ancestry` false: idb's flat list), and a
   * node of another tree. Whether `scroll_until` can move the target out
   * from under a system bar (interact/tap-judgement.ts#systemBarRemedy, the
   * pixel assert's remedy). Cost: one walk of the tree, on the first ask.
   */
  inScroller(node: UiNode): boolean | undefined;
  /**
   * Where the node can be DRAWN as far as what scrolls above it says (`Drawn`): the frames of every ancestor that
   * scroll-containers.ts#scrolls, intersected — on every tree that lists ancestry (`clipsOf`'s `ancestry`), whatever
   * its source says of its frames. An ancestor of no area cuts nothing (it fails open, as a root of no area does). A
   * scroll view draws none of its content outside its own frame, on either platform (UIKit's `UIScrollView` clips to
   * its bounds, so do a table, a collection view and SwiftUI's `ScrollView`; so do Android's scroll containers), while
   * a source may list that content past it:
   * - WDA always (dialect.ts#TreeDialect.framesUnclipped): the at-rest SWIFT form lists `payee_name_input` at
   *   `24,801 354x52`, below its `ScrollView 0,0 402x780`; the capture shows the bare background from CONTINUE's
   *   bottom (824) down, and a tap at its centre was reported done on it.
   * - uiautomator sometimes: it cuts most rects to their scroll container (a no-op here), but Compose's
   *   `verticalScroll` in an edge-to-edge window is cut, if at all, at a line the status bar's height past it — the
   *   lab app's `scroll-bounded` lists `S` at `[128,1519][953,1607]` under its `lower` ending at 1541, 22 px of it drawn;
   *   its `carousel-in-list` lists the card `C` as `[1014,380][1080,614]`, cut to the screen's edge, not to its carousel
   *   ending at 1014: nothing of it drawn. Both were tapped on the background.
   *   docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md
   * An edge the node runs past by a unit at most (a px on Android, a pt on WDA) is no cut: there the node is flush with
   * it (`overhangAsFlush`).
   * Undefined for a node under nothing that scrolls and, on a tree that lists ancestry, a node of another tree: nothing
   * cuts it. UNTOLD (`DrawnUntold`) for every node asked of a tree that lists no ancestry — idb's flat list, which lists no scroll view, so nothing in it says
   * whether a scroll view cuts a node, nor where: not "nothing cuts it". Measured: the lab app's `scroll-bounded` (iOS
   * 27) lists `O` flat at `51,620 300x64`, wholly below `lower` (`0,380 402x180`, which WDA's twin lists and idb does
   * not); a tap at its centre was reported done on the background, and its colour passed on it. The standing judges an
   * untold node on the screen alone (the tap, the stops: ADR 0010's residual 5); the eyes ask what the
   * screenshot shows of it where a claim rests on it — the colour assert's region (verify/eyes.ts#apartOfFrame) and a
   * `fully: true` claim's edges (ui-tree/eyes.ts#eyesQuestion's clip lines).
   * docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
   * Rects stay as listed
   * (`scroll_until`'s far edge, interact/course.ts#beyondFarEdge, reads a row's rect past the frame); the
   * standing cuts what it judges by this frame (ui-tree/standing.ts#Scene). Cost: one walk of the tree, on the first
   * ask, its ancestors' frames shared along a branch; each ask then meets them with the node's own rect
   * (`overhangAsFlush`), a constant.
   */
  drawnIn(node: UiNode): Drawn | undefined;
  /**
   * The axis facts of the scroll view of rect `container` — the first node in tree order that scrolls with exactly
   * that rect, as `DrawOrder.drawnOver` finds its container — for `scroll_until`'s stroke plan
   * (interact/stroke-plan.ts#strokeRoom): the axis it scrolls on, and every scroll view nested in it (its descendants
   * that scroll, at any depth; one of its own rect left out; a text input left out — a Compose text field dumps as a
   * scrolling (Horizontal)ScrollView, role `textfield` (`INPUT_ROLE`), adapters/android-tree-dialect.ts — so a stroke
   * the plan sends inside a nested scroll view never lands in a field; Android's case: WDA marks no node
   * clipping, and a scrolling WDA text view is a scroll view of its own role) with theirs, each as
   * scroll-containers.ts#scrollAxis says on this tree's dialect (`unclipped`), undefined where it cannot tell.
   * Undefined when the tree holds no scroll view of that rect (the list moved). Found as draw order finds its container
   * (scroll-containers.ts#isScrollViewOf). Cost: a walk of the tree to find it on each ask; its facts kept for the life
   * of the `Clips`.
   */
  axesOf(container: Rect): ScrollAxes | undefined;
  /**
   * Every scroll view of the tree that the tree TELLS scrolls on `axis` (scroll-containers.ts#scrollAxis on this tree's
   * dialect), at any depth, in tree order, that meets `screen` (the caller's usable screen: one wholly off it, or under
   * a band the caller cut out, is no list a swipe can reach) and is none of the keyboard's own (`ofKeyboard`, the
   * caller's reading: WDA's suggestion strip) — text inputs left out, as `axesOf`'s `nested` leaves them; none on a
   * tree that lists no ancestry (idb's flat list lists no scroll view). For the exhausted stop's sentence when the strokes
   * went across their scroll view (interact/stroke-plan.ts#strokedAcross): one the tree shows that scrolls the
   * stroke's way is named, wherever it lies. One walk of the tree a call.
   */
  toldOn(axis: ScrollAxis, screen: Rect, ofKeyboard: (node: UiNode) => boolean): readonly UiNode[];
  /**
   * Every scroll view of the tree, as `toldOn` counts one (text inputs left out, meeting `screen`, none of the
   * keyboard's own), in tree order, each with the one axis the tree tells it scrolls on — undefined where it cannot tell
   * (a Compose lazy list, a RecyclerView); none on a tree that lists no ancestry. `toldOn` is those told on its axis.
   * For `scroll_until`'s `within` refused on a stale rect (interact/within.ts): every scroll view a `within` rect
   * could name for the stroke, the unknown ones too. One walk of the tree a call.
   */
  scrollViewsOn(screen: Rect, ofKeyboard: (node: UiNode) => boolean): readonly ListedScrollView[];
  /**
   * What this tree lists of the content of the scroll view of rect `scroller` toward its `edge` (`ListedContent`) —
   * the scroll view found as `axesOf` finds its scroll view (scroll-containers.ts#isScrollViewOf, that exact rect — the
   * one the stroke plan remembered and drew over, whose cut and axes the same read finds by it exactly; one moved by a
   * pixel is found by none of them, and undefined, no answer, is the safe one; so too on a tree that lists no
   * ancestry, whose nesting is no scroll view's content).
   *
   * `blank`: nothing under it of some area has an edge along `edge`'s axis more than a pixel off both of the frame's
   * own edges on that axis (`showsMotion`) — so this read could not show the content moving: an empty viewport, or a
   * node cut at both ends (an undescribed image spanning it) — but not rows that each span it lying apart across it
   * (`stackedAcross`: a sideways stroke over a vertical list of full-width rows reads them as listed). uiautomator cuts
   * a node to its scroll view, so the edge that moves with the content lies INSIDE the frame; WDA's unclipped frames put
   * it past, so there only a truly empty scroll view is blank — and blank comes before the end proof below: an empty
   * WDA scroll view (an empty state, or a lazy stack's unrealised stretch) is `blank`, never `ends`, and a stroke over
   * it runs to the bound. A rule of the frame alone, before the dialect's guards. Measured
   * (docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md): the lab
   * app's `tabbar-floating` `list` 0,550 1080x1670 (a Compose verticalScroll, which dumps no content container) lists
   * T and R and nothing else; two strokes past R it lists nothing, and two more strokes read the same empty list while
   * each moved it ~860 px — "did not change the screen" was the dump's, not the list's. Not of a scroll view the tree
   * says scrolls on the OTHER axis (scroll-containers.ts#scrollAxis) and holds no scroll view that may scroll on this
   * one: its content moves none that way — a carousel's cards fill its height, and a vertical stroke over it moves
   * nothing of it — so its read is `listed`, evidence as it was. A ViewPager (horizontal by its class) over a vertical
   * list of its own rect is not such a view: the list under it is what a vertical stroke moves. What `blank` cannot
   * tell: a node inside the scroll view that does not move with its content (a sticky header child) shows an edge
   * inside and reads `listed`, so a blank stretch under it still reads unchanged.
   *
   * `ends`: the tree shows its CONTENT ENDING at its `edge`: no node under it of some area lies past that edge by more
   * than a pixel — so nothing of its content lies that way, and no stroke can bring any in. On a tree of UNCLIPPED
   * frames only (`unclipped`, WDA's): there a scroll view's content keeps its laid-out rect wherever it lies, so content
   * above a list's top is listed above it (the lab app's `scroll-bounded`: `lower` 0,380 402x180 at rest lists its
   * content container at 0,380 402x1300 — nothing above its top, 1120 pt below its bottom). `listed`, not `ends`, when
   * it does not end there, and on every other tree: uiautomator cuts most rects to their scroll container, so content
   * past an edge reads flush with it (or is not listed at all) — that it does not cut some (`drawnIn`'s lab note)
   * proves no end where it does — and idb's flat list lists no scroll view. What a node past the edge may be — a row,
   * a parked cell's content (ADR 0019), a pinned header — is not asked: any of them says "not provably the end", the
   * safe answer. And only for a scroll view that scrolls ALONG that edge's axis (scroll-containers.ts#scrollAxis: its
   * content listed running on past its frame on that axis —
   * `lower`'s, 1120 pt below its bottom): a horizontal carousel lists nothing below its bottom because nothing of it
   * ever lies there, which says nothing of whether a vertical stroke over it could move anything (else Account
   * Detail's carousel under its list "proves" the end after one stroke, and the failure loses the list drawn over the
   * touch-down it had named). An axis the tree cannot tell proves nothing. Residual,
   * stated as it is: a lazy list (a table) lists only the rows it has laid out, so one resting EXACTLY on a row
   * boundary with its earlier rows dropped (a sticky section header pinned at its top reads the same) lists nothing
   * past its top and reads as ending there. Nothing in the reads rules that out: interact/scroll-rounds.ts asks this
   * only of a read a stroke left unmoved, but a stroke not taken leaves it unmoved too — so a stroke not taken over a
   * lazy list resting on a boundary is a false proof (one stroke, then a turn or a failure that calls the content
   * exhausted). What makes it rare, not impossible: a list at rest lies on a boundary by chance (a flung list stops
   * anywhere along a row), and the stroke must also go untaken, with nothing drawn over its touch-down (that withholds
   * the proof). Cost, per ask (asked at most once a round, after a stroke): one walk of the tree to find the scroll
   * view, and one of its subtree.
   */
  contentToward(scroller: Rect, edge: Edge): ListedContent | undefined;
}

/**
 * What a read lists of a scroll view's content toward one of its edges (`Clips.contentToward`): its content ENDING
 * there (`ends`, the scroll view quoted); none of it where its motion would show (`blank`, the scroll view quoted:
 * whether a stroke moved it, this read cannot say); or content that shows its motion and runs on (`listed`).
 */
export type ListedContent = { readonly kind: 'ends'; readonly view: UiNode } | { readonly kind: 'listed' } | { readonly kind: 'blank'; readonly view: UiNode };

/** A scroll view's axis and those of the scroll views nested in it (`Clips.axesOf`). */
export interface ScrollAxes {
  readonly axis: ScrollAxis | undefined;
  readonly nested: readonly NestedScrollView[];
}

/** A scroll view nested in another, as `Clips.axesOf` gives it: its rect and its axis, undefined where the tree cannot tell. */
interface NestedScrollView {
  readonly rect: Rect;
  readonly axis: ScrollAxis | undefined;
}

/**
 * What of `rect` the drawn frame `drawn` holds (`Clips.drawnIn`): `rect` itself when nothing cuts it, or when the tree
 * cannot tell (`DrawnUntold`: the screen alone judges it); undefined when nothing of it can be drawn.
 */
export function drawnPart(rect: Rect, drawn: Drawn | undefined): Rect | undefined {
  if (drawn === undefined || !drawn.told) return rect;
  return drawn.frame === undefined ? undefined : rectIntersection(rect, drawn.frame);
}

/** The tree cannot tell where the node is drawn (`DrawnUntold`) — not `toldFrame`'s undefined, which nothing scrolling above it says too. */
export const isUntold = (drawn: Drawn | undefined): drawn is DrawnUntold => drawn?.told === false;

/** The drawn frame where the tree tells one (`DrawnFrame`), else undefined: nothing scrolls above the node, or the tree cannot tell (`DrawnUntold`). */
export const toldFrame = (drawn: Drawn | undefined): DrawnFrame | undefined => (drawn?.told === true ? drawn : undefined);

/**
 * Where a node can be drawn as what scrolls above it says (`Clips.drawnIn`): the frame its scrolling ancestors cut it
 * to (`DrawnFrame`), or UNTOLD (`DrawnUntold`) on a tree that lists no scroll view at all.
 */
export type Drawn = DrawnFrame | DrawnUntold;

/**
 * The tree cannot tell where the node is drawn: it lists no ancestry (idb's flat list), so no scroll view above any
 * node — not "nothing cuts it", which `Clips.drawnIn`'s undefined says. A named answer, so that every reader decides
 * what an untold node means for it: the standing judges it on the screen alone (`drawnPart`), the eyes look where a
 * claim rests on it (ui-tree/eyes.ts#eyesQuestion, verify/eyes.ts#apartOfFrame).
 */
interface DrawnUntold {
  readonly told: false;
}

const UNTOLD: DrawnUntold = { told: false };

/** Where a node can be drawn, as its scrolling ancestors cut it (`Clips.drawnIn`). */
export interface DrawnFrame {
  readonly told: true;
  /** The ancestors' frames intersected; undefined when they share no area — nothing of the node can be drawn. */
  readonly frame: Rect | undefined;
  /** The ancestors that scroll, nearest first: the scroll view a sentence names is one of them. */
  readonly scrollers: readonly UiNode[];
  /**
   * Whether the tree's source lists the node WHERE IT LIES (`clipsOf`'s `unclipped`, dialect.ts#TreeDialect.framesUnclipped:
   * WDA's): then `frame` is the window the content moves through, and a row's motion as it comes in is the content's —
   * what `scroll_until`'s carry model measures (interact/course.ts#stillNeeds), through
   * ui-tree/standing.ts#StandingFacts.listedWhereItLies. Not on uiautomator's trees, which cut most rows to their
   * scroll container (a row coming in reads short).
   */
  readonly listedWhereItLies: boolean;
  /**
   * The sides along which the node runs on an UNKNOWN distance past its listed rect (`cutAtScreenEdges`): each lies on
   * the screen's edge while the frame's side lies inside the screen, on a tree whose source cuts a node's bounds at the
   * screen whatever scroll view it lies past (`clipsOf`'s `cutAtScreen`, dialect.ts#TreeDialect.cutsAtScreen:
   * uiautomator's). There the listed rect is the screen's cut, not the
   * node's: its visible fraction is an upper bound and its centre along that axis unknown
   * (ui-tree/standing.ts#StandingFacts.unknownPast). Absent when none.
   */
  readonly unknownPast?: readonly Edge[];
}

/**
 * How far a side may lie off the screen's edge and still be read as cut there, and how far inside the screen a frame's
 * side must lie for the cut to be the screen's and not the frame's (`cutAtScreenEdges`): a pixel, a rounding of the
 * source's bounds — as `MOTION_EDGE_SLACK` reads an edge flush with a frame's.
 */
const SCREEN_EDGE_SLACK = 1;

/**
 * The sides of `rect` the source cut at the edge of `screen` (`DrawnFrame.unknownPast`): each lies within
 * SCREEN_EDGE_SLACK of the screen's matching edge while `frame` — what its scroll views draw — ends more than that
 * inside the screen on that side. Measured (API 33): the carousel `[66,380][1014,614]`, its card C laid at
 * x 586 948 wide, dumped `[586,380][1080,614]` — right; at rest `[1014,380][1080,614]` — right, its left known. A
 * full-width row of a full-width list lies on the screen's edges with its frame: none. In the order of `EDGES`.
 */
export function cutAtScreenEdges(rect: Rect, frame: Rect, screen: Rect): Edge[] {
  return EDGES.filter((edge) => Math.abs(distanceInside(rect, screen, edge)) <= SCREEN_EDGE_SLACK && distanceInside(frame, screen, edge) > SCREEN_EDGE_SLACK);
}

const LISTED: ListedContent = { kind: 'listed' };

/**
 * How far off both of its scroll view's edges along an axis a node's edge must lie to show the content's motion
 * (`Clips.contentToward`'s `blank`): more than a pixel, as `flushEdges` reads "past", and the end proof (`ends`) by
 * this constant — an edge within a pixel of the frame's is the cut's, a rounding of the source's bounds.
 */
const MOTION_EDGE_SLACK = 1;

/**
 * `rect`, a node under the scroll view of rect `frame`, has an edge along `axis` that would move with the content:
 * one more than `MOTION_EDGE_SLACK` off both of the frame's edges on that axis — inside the frame (uiautomator cuts a
 * node to its scroll view, so the edge that moves lies inside) or past it (WDA's unclipped frames).
 */
function showsMotion(rect: Rect, frame: Rect, axis: ScrollAxis): boolean {
  const [f0, f1] = axis === 'vertical' ? [frame.y, frame.y + frame.height] : [frame.x, frame.x + frame.width];
  const [r0, r1] = axis === 'vertical' ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
  const off = (e: number): boolean => Math.abs(e - f0) > MOTION_EDGE_SLACK && Math.abs(e - f1) > MOTION_EDGE_SLACK;
  return off(r0) || off(r1);
}

/**
 * Whether `nodes` (under a scroll view, none showing motion along `axis`: each spans its frame that way) hold two that
 * lie apart along the OTHER axis — content laid out across the stroke, not one thing cut at both ends: the full-width
 * rows of a vertical list a sideways stroke goes over (measured: the lab app's `form-picker`, a list whose axis its
 * class does not say, lists 14 rows each 0..1080 — none has an x edge inside, yet they are its content, shown). Its
 * read is evidence as any listing is; a blank viewport lists nothing, and an undescribed image spanning it one
 * node. Its price: two columns, or a full-height decor line beside a container, each cut at both ends, read as content
 * shown too, so a blank stretch under them still reads unchanged (ADR 0021's residuals).
 * Apart: one ends within `MOTION_EDGE_SLACK` of where the other begins, or before (a rounding of the bounds
 * overlaps rows that touch by a pixel). One node is apart from itself only when it is no wider across than
 * `MOTION_EDGE_SLACK` (a hairline spanning the viewport): it then reads as content shown, the conservative side.
 */
function stackedAcross(nodes: readonly UiNode[], axis: ScrollAxis): boolean {
  const span = (r: Rect): [number, number] => (axis === 'vertical' ? [r.x, r.x + r.width] : [r.y, r.y + r.height]);
  const firstEnd = Math.min(...nodes.map((n) => span(n.rect)[1]));
  const lastStart = Math.max(...nodes.map((n) => span(n.rect)[0]));
  return firstEnd <= lastStart + MOTION_EDGE_SLACK;
}

/**
 * A tree's `Clips`: one pre-order walk recording each node's parent and its
 * clipping chain (shared along a branch), for nodes under a clip only;
 * the sliver cuts are judged when asked, and kept. `ancestry`: whether the
 * tree's nesting is its nodes' ancestry (dialect.ts#TreeDialect.ancestry);
 * `unclipped`: whether its source reports frames unclipped
 * (dialect.ts#TreeDialect.framesUnclipped); `cutAtScreen`: whether its source
 * cuts a node's bounds at the screen's edge (dialect.ts#TreeDialect.cutsAtScreen)
 * — three fields of the tree's dialect, handed in by the caller.
 */
export function clipsOf(tree: UiNode, { ancestry, unclipped = false, cutAtScreen = false }: { readonly ancestry: boolean; readonly unclipped?: boolean; readonly cutAtScreen?: boolean }): Clips {
  const chains = new Map<UiNode, readonly Rect[]>();
  const parents = new Map<UiNode, UiNode>();
  const walk = (n: UiNode, chain: readonly Rect[]): void => {
    if (chain.length > 0) chains.set(n, chain);
    const below = clips(n) ? [n.rect, ...chain] : chain;
    for (const child of n.children) {
      if (below.length > 0) parents.set(child, n);
      walk(child, below);
    }
  };
  walk(tree, []);
  const scrollersOf = (node: UiNode): readonly Rect[] => chains.get(node) ?? [];
  const kept = new Map<number, Map<UiNode, Cut | undefined>>();
  const cutSliver = (node: UiNode, minPiece: number): Cut | undefined => {
    const byNode = kept.get(minPiece) ?? new Map<UiNode, Cut | undefined>();
    kept.set(minPiece, byNode);
    if (byNode.has(node)) return byNode.get(node);
    const cut = judged(node, minPiece);
    byNode.set(node, cut);
    return cut;
  };
  const judged = (node: UiNode, minPiece: number): Cut | undefined => {
    const chain = scrollersOf(node);
    const own = evidentCut(node, chain);
    if (own !== undefined && own.depth < minPiece) return own;
    // The edges the node lies flush with, of each container above it, where it is itself under the minimum across.
    const flush = chain.flatMap((container) => flushEdges(node.rect, container).map((edge) => ({ container, edge }))).filter(({ edge }) => across(node.rect, edge) < minPiece);
    if (flush.length === 0) return undefined;
    for (let a = parents.get(node); a !== undefined && scrollersOf(a).length > 0; a = parents.get(a)) {
      const ancestor = a;
      // Only an ancestor shallower than the minimum across one of those edges can be a sliver there.
      if (!flush.some(({ edge }) => across(ancestor.rect, edge) < minPiece)) continue;
      const cut = cutSliver(ancestor, minPiece);
      const on = cut === undefined ? undefined : flush.find(({ container, edge }) => edge === cut.edge && sameRect(container, cut.container));
      if (cut !== undefined && on !== undefined) return { edge: cut.edge, container: { ...cut.container }, depth: across(node.rect, cut.edge), within: { ...ancestor.rect } };
    }
    return undefined;
  };
  let scrolled: Map<UiNode, boolean> | undefined;
  const inScroller = (node: UiNode): boolean | undefined => {
    if (!ancestry) return undefined;
    if (scrolled === undefined) {
      const found = new Map<UiNode, boolean>();
      const mark = (n: UiNode, under: boolean): void => {
        if (!found.has(n)) found.set(n, under);
        const below = under || scrolls(n);
        for (const child of n.children) mark(child, below);
      };
      mark(tree, false);
      scrolled = found;
    }
    return scrolled.get(node);
  };
  /** A node's scrolling ancestors as one walk marks them: their frames intersected, the ancestors nearest first. */
  type Within = Pick<DrawnFrame, 'frame' | 'scrollers'>;
  let drawn: Map<UiNode, Within> | undefined;
  const drawnIn = (node: UiNode): Drawn | undefined => {
    if (!ancestry) return UNTOLD;
    if (drawn === undefined) {
      const found = new Map<UiNode, Within>();
      const mark = (n: UiNode, within: Within | undefined): void => {
        if (within !== undefined) found.set(n, within);
        // An ancestor of no area cuts nothing: it fails open, as a root of no area does.
        const below = !scrolls(n) || rectArea(n.rect) === 0
          ? within
          : within === undefined
            ? { frame: { ...n.rect }, scrollers: [n] }
            : { frame: within.frame === undefined ? undefined : rectIntersection(within.frame, n.rect), scrollers: [n, ...within.scrollers] };
        for (const child of n.children) mark(child, below);
      };
      mark(tree, undefined);
      drawn = found;
    }
    const within = drawn.get(node);
    if (within === undefined) return undefined;
    const frame = within.frame === undefined ? undefined : overhangAsFlush(node.rect, within.frame);
    const unknownPast = !cutAtScreen || frame === undefined ? [] : cutAtScreenEdges(node.rect, frame, screenOf(tree));
    return { told: true, frame, scrollers: within.scrollers, listedWhereItLies: unclipped, ...(unknownPast.length > 0 && { unknownPast }) };
  };
  const axes = new Map<UiNode, ScrollAxes>();
  /**
   * A scroll view as the stroke plan counts one, nested or anywhere in the tree (`axesOf`'s `nested`, `toldOn`): it
   * scrolls (scroll-containers.ts#scrolls) and is no text input (`INPUT_ROLE` — a Compose text field dumps as a
   * scrolling (Horizontal)ScrollView: an Android matter, WDA marking no node clipping), so no stroke lands in a field.
   */
  const scrollViewNode = (n: UiNode): boolean => scrolls(n) && n.role !== INPUT_ROLE;
  const axesOf = (container: Rect): ScrollAxes | undefined => {
    const found = [...everyNode(tree)].find((n) => isScrollViewOf(n, container));
    if (found === undefined) return undefined;
    const kept = axes.get(found);
    if (kept !== undefined) return kept;
    const facts: ScrollAxes = {
      axis: scrollAxis(found, unclipped),
      nested: [...everyNode(found)].filter((n) => n !== found && scrollViewNode(n) && !sameRect(n.rect, container)).map((n) => ({ rect: { ...n.rect }, axis: scrollAxis(n, unclipped) })),
    };
    axes.set(found, facts);
    return facts;
  };
  const contentToward = (scroller: Rect, edge: Edge): ListedContent | undefined => {
    if (!ancestry) return undefined;
    const view = [...everyNode(tree)].find((n) => isScrollViewOf(n, scroller));
    if (view === undefined) return undefined;
    const axis = axisOfEdge(edge);
    const scrollsOn = scrollAxis(view, unclipped);
    // A scroll view the tree says scrolls on the OTHER axis has no content that moves along this one — a carousel's
    // cards fill its height, and a vertical stroke over it moves none of it: its read unmoved is evidence as it is —
    // unless a scroll view under it may scroll on this one (a ViewPager's page, a RecyclerView of its very rect).
    const subtree = [...everyNode(view)].filter((n) => n !== view);
    if (scrollsOn !== undefined && scrollsOn !== axis && !subtree.some((n) => scrolls(n) && scrollAxis(n, unclipped) !== scrollsOn)) return LISTED;
    const under = subtree.filter((d) => rectArea(d.rect) > 0);
    // Before the dialect's guard: a rule of the frame alone, true on every tree that lists ancestry — unless what spans
    // it is laid out along the other axis (`stackedAcross`: rows of a list a stroke goes across).
    if (!under.some((d) => showsMotion(d.rect, view.rect, axis)) && !stackedAcross(under, axis)) return { kind: 'blank', view };
    // Only along the axis it scrolls on (an axis the tree cannot tell proves nothing), and on unclipped frames only.
    if (!unclipped || scrollsOn !== axis) return LISTED;
    const r = view.rect;
    const past: Record<Edge, (d: Rect) => boolean> = {
      top: (d) => d.y < r.y - MOTION_EDGE_SLACK,
      bottom: (d) => d.y + d.height > r.y + r.height + MOTION_EDGE_SLACK,
      left: (d) => d.x < r.x - MOTION_EDGE_SLACK,
      right: (d) => d.x + d.width > r.x + r.width + MOTION_EDGE_SLACK,
    };
    return under.some((d) => past[edge](d.rect)) ? LISTED : { kind: 'ends', view };
  };
  const scrollViewsOn = (screen: Rect, ofKeyboard: (node: UiNode) => boolean): readonly ListedScrollView[] =>
    ancestry
      ? [...everyNode(tree)].filter((n) => scrollViewNode(n) && rectIntersection(n.rect, screen) !== undefined && !ofKeyboard(n)).map((node) => ({ node, axis: scrollAxis(node, unclipped) }))
      : [];
  const toldOn = (axis: ScrollAxis, screen: Rect, ofKeyboard: (node: UiNode) => boolean): readonly UiNode[] =>
    scrollViewsOn(screen, ofKeyboard)
      .filter((v) => v.axis === axis)
      .map((v) => v.node);
  return { scrollersOf, cutSliver, inScroller, drawnIn, axesOf, toldOn, scrollViewsOn, contentToward };
}

/**
 * `frame` with every edge `rect` is flush with (`flushEdges`: within a unit, a px on Android, a pt on WDA) and runs past
 * moved out onto `rect`'s: there the rect is FLUSH with its scroll view's edge, not past it (`contentToward` reads past as more
 * than a unit too) — a rounding of the source's bounds, which the drawn frame must not read as a cut. Measured:
 * mp-native's SWIFT form on Android lists `details_toggle` at `66,1924 948x55`, ending at 1979, under its form
 * `[0,242][1080,1978]` — the CONTINUE bar starts at 1979, so the form's 1978 and the toggle's 1979 are the same line;
 * cut there by a pixel, the toggle read `clipped` where the `fully` stop's flush probe is the rule
 * (interact/flush-check.ts).
 */
function overhangAsFlush(rect: Rect, frame: Rect): Rect {
  const flush = new Set(flushEdges(rect, frame));
  const left = flush.has('left') ? Math.min(rect.x, frame.x) : frame.x;
  const top = flush.has('top') ? Math.min(rect.y, frame.y) : frame.y;
  const right = Math.max(frame.x + frame.width, flush.has('right') ? rect.x + rect.width : -Infinity);
  const bottom = Math.max(frame.y + frame.height, flush.has('bottom') ? rect.y + rect.height : -Infinity);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The least extent along y a descendant reaching the top or bottom edge from
 * inside the node needs to count as `evidentCut`'s inside evidence, in the
 * tree's units (px on Android, where alone the rule applies): 8 px — a 1-dp
 * divider or a 2-dp focus line is at most 7 px at density 3.5, while the
 * measured toggle's button showed 42 px. Content past the edge counts at any
 * thickness.
 */
const MIN_INSIDE_EVIDENCE = 8;

/** An evidenced cut of a node at a clipping ancestor's edge (`evidentCut`): the edge, that ancestor's rect, and how deep the node shows across the edge. */
export interface Cut {
  readonly edge: Edge;
  readonly container: Rect;
  /** The node's extent across `edge` — its height at the top or bottom, its width at a side: what of it shows that way. */
  readonly depth: number;
  /**
   * The rect of the nearest ancestor whose cut the node inherits
   * (`Clips.cutSliver`): the node lies flush with `edge` inside it, and
   * IT is a sliver cut there — `66,1924 948x55`, the toggle the label `66,1936 948x42`
   * lies in. Absent for a cut the node's own content evidences.
   */
  readonly within?: Rect;
  /**
   * The node DRAWN AFTER it whose edge the node's rect was cut at (ui-tree/standing.ts#cutByLater): Compose leaves out
   * of a node's bounds what a node drawn after it covers, and the rest of the node lies under THAT node, not past a
   * scroll container's edge — `container` is its rect. Absent for a cut at a clipping container's edge (`cutSliver`'s).
   * docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md
   */
  readonly by?: UiNode;
}

/**
 * Where `node` is EVIDENTLY cut by its clipping ancestors (`chain`,
 * `Clips.scrollersOf`'s): of every edge, over the WHOLE chain, that the node lies
 * flush with (`flushEdges`) while a descendant of it says the node runs on
 * past it, the shallowest (`Cut.depth`; the first of equals, nearest
 * ancestor first); undefined when none (the bug note is `Clips.cutSliver`'s).
 * The shallowest, not the first found: a card cut to 50 px at a carousel's right edge is
 * a 50-px sliver whatever its top says.
 *
 * What a descendant must show, along the edge's axis:
 * - At ANY edge: it lies more than a pixel PAST the edge. Compose's nodes
 *   are cut to the scroller while their children may not be (the
 *   snapshot `contactsCreateStaged`: a row `132,242 948x33` at the list's
 *   top, its First name field `132,115 816x160` running on above it).
 * - At ANY edge, with no area: it was dumped wholly past THIS edge
 *   (`UiNode.clippedOut` equal to it) and clamped onto it, within a pixel.
 *   The parser clamps every node uiautomator
 *   dumped inverted to zero size at the clip (adapters/android-tree-dialect.ts
 *   #nodeBounds), so the content past the edge reaches here with no rect to
 *   lie past it with: a classic-View Settings row cut to `0,297 1080x33` at
 *   its list's top, its icon cut with it to the row's own height, its title
 *   and summary dumped `[198,297][324,58]` and `[198,297][819,111]` — whole
 *   above the cut — would otherwise read whole and be tapped. Clamped onto
 *   another line (an inner clip's), or past another edge, it says nothing
 *   of this one; any other zero-area descendant says nothing at all.
 * - At the TOP or BOTTOM only: it reaches the edge (within a pixel) from
 *   more than a pixel inside the node's opposite side — content laid out
 *   across the edge and cut with it. uiautomator cuts a View's children
 *   with it, so on classic Views this is the only evidence there is: the
 *   measured toggle `66,1924 948x55` (132 px whole) on a form ending at
 *   1978, its button `66,1936 948x42` starting 12 px inside it and ending
 *   on the cut. A whole element's content keeps inside it (a label centred
 *   in a button) or fills it (a background of the same rect): neither runs
 *   into the edge from inside. Not at a side: every
 *   full-bleed row touches a vertical list's sides with content flush there,
 *   and a whole tile flush with a list's left edge has its icon flush left
 *   — the tree does not say which way a scroller scrolls, and screens are
 *   mostly vertical lists, so the inside evidence is believed along y only.
 *   Nor from a descendant thinner than MIN_INSIDE_EVIDENCE along y: a divider or a focus line at a whole last row's bottom
 *   reaches the edge from inside too, and on a tablet, where the minimum
 *   piece grows (≈ 96 px at 1600 px), a dense 40-dp row is under it.
 *
 * Why evidence, not flushness alone: a node whose edge lies on a scroller's
 * may be cut there or whole and touching it — a first row at rest, a last
 * one scrolled to the end — and the tree does not say which.
 *
 * Unknowable, stated: a cut node with no descendants (a leaf, or a Compose
 * node whose text is merged into it) shows no evidence and reads whole —
 * unless what it lies in is a sliver cut at the edge it is flush with
 * (`Clips.cutSliver`'s inherited cut); so
 * does a classic View cut at a horizontal scroller's side (its children cut
 * with it, never past — unless one lies wholly past it, dumped inverted:
 * then its `clippedOut` is the evidence), and so does a node whose
 * descendant was dumped inverted on BOTH axes and is cut at a side: the
 * parser names the vertical side (android-tree-dialect.ts#nodeBounds, `vertical ??
 * sideways`), so a card cut to 40 px at a carousel's left edge, its title
 * dumped `[0,450][-100,440]`, carries `clippedOut: 'top'` and its left cut
 * is missed. The other way, a whole node whose content runs to its top or
 * bottom edge without padding (a divider at a last row's bottom, an image
 * flush with a first row's top) reads cut; so does a WHOLE thin row at rest
 * flush with its list's top with a child laid out wholly above it — a
 * translated or hidden swipe-action view dumped `[40,297][400,250]` over a
 * row `0,297 1080x50` (a synthetic shape, no dump has it) — refused, its remedy naming a child or
 * a coordinate tap. Not tightened (to "a descendant WITH area is also cut
 * to that line"): a real cut row may show only its padding across the
 * edge, no child of it on the line, and then the cut would be missed — a
 * refusal that names its way past is the safer error. The tree carries no
 * natural size of a node to settle any of these. Cost: a walk of the node's subtree per flush
 * edge, for a node with a clipping ancestor only.
 */
function evidentCut(node: UiNode, chain: readonly Rect[]): Cut | undefined {
  const n = node.rect;
  // Along the edge's axis, as offsets INTO the container from that edge: where the descendant's near and far sides lie, and the node's far side.
  const runsOnPast = ({ rect: d, clippedOut }: UiNode, c: Rect, edge: Edge): boolean => {
    const [near, far, nodeFar] = {
      top: [d.y - c.y, d.y + d.height - c.y, n.y + n.height - c.y],
      bottom: [c.y + c.height - (d.y + d.height), c.y + c.height - d.y, c.y + c.height - n.y],
      left: [d.x - c.x, d.x + d.width - c.x, n.x + n.width - c.x],
      right: [c.x + c.width - (d.x + d.width), c.x + c.width - d.x, c.x + c.width - n.x],
    }[edge];
    // Dumped wholly past this edge and clamped onto it (UiNode.clippedOut): past-the-edge evidence with no area left to show it.
    if (rectArea(d) === 0) return clippedOut === edge && Math.abs(near) <= 1;
    const fromInside = axisOfEdge(edge) === 'vertical' && far - near >= MIN_INSIDE_EVIDENCE && near <= 1 && far < nodeFar - 1;
    return near < -1 || fromInside;
  };
  let shallowest: Cut | undefined;
  for (const container of chain) {
    for (const edge of flushEdges(n, container)) {
      const depth = across(n, edge);
      if (shallowest !== undefined && depth >= shallowest.depth) continue;
      for (const d of everyNode(node)) {
        if (d !== node && runsOnPast(d, container, edge)) {
          shallowest = { edge, container: { ...container }, depth };
          break;
        }
      }
    }
  }
  return shallowest;
}

/**
 * The largest node of the tree that clips its descendants
 * (scroll-containers.ts#clips, by area), as its rect — the screen's own scroll
 * view, which `scroll_until` strokes over while the target's own container
 * is not known yet (interact/scroll-read.ts#TreeFacts.mainScroller). Largest, not first: a carousel above a page's list is
 * the smaller of the two. Undefined when none (every iOS tree). One walk.
 */
export function largestScroller(tree: UiNode): Rect | undefined {
  let best: Rect | undefined;
  for (const n of everyNode(tree)) {
    if (clips(n) && rectArea(n.rect) > (best === undefined ? 0 : rectArea(best))) best = n.rect;
  }
  return best === undefined ? undefined : { ...best };
}

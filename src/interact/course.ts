import type { ClippedSide, Rect } from '../adapters/types.js';
import { axisOfEdge, rectIntersection, type Edge } from '../ui-tree/geometry.js';
import type { Judged } from './scroll-read.js';
import type { StillNeeds } from './stroke-plan.js';
import { axisOf, type Direction } from './swipe.js';

/**
 * THE COURSE: which way and how far the next stroke of one `scroll_until` run goes, relative to a direction — where the
 * content lies. This stage holds its geometry, pure: the FAR edge a scroll moves content out through and the NEAR one
 * it comes in by (`FAR_EDGE`), whether a target lies beyond the far edge (`beyondFarEdge`, `beyondFarEdgeIn`, of the
 * `FarFacts` a judged match gives, `farFacts`), whether a cover lies over its far side (`overFarSide`), and what it
 * still needs of a stroke to reach its window (`stillNeeds`). The round (interact/scroll-rounds.ts#round) reads them.
 *
 * Pure: no adapter, no clock, no I/O.
 */

/**
 * The FAR edge of a scroll toward `direction` — the edge of the frame its
 * strokes move content out through (for content below, `down`, the top) —
 * and the NEAR one content comes in through: what `beyondFarEdge` reads of
 * the target and `overFarSide` of a cover over it.
 */
export const FAR_EDGE: Readonly<Record<Direction, { readonly far: Edge; readonly near: Edge }>> = {
  down: { far: 'top', near: 'bottom' },
  up: { far: 'bottom', near: 'top' },
  right: { far: 'left', near: 'right' },
  left: { far: 'right', near: 'left' },
};

/**
 * The target lies BEYOND the edge of `frame` that a scroll toward
 * `direction` moves content out through — past that far edge, or across
 * it — and not across the near one: for content below (down) the content
 * moves up, so its top above the frame's top and its bottom inside the
 * frame or above it; for content above (up), mirrored at the frame's
 * bottom (the keyboard's top edge, when the frame is the screen above
 * one); likewise sideways. Content comes in through the near edge, so a
 * target that was ever read short of this and is now beyond it was carried
 * across the frame by a fling (`nextStroke`; measured under
 * WDA: 613 → -357 in one swipe; 681 → -48 for a 52-pt row whose last 4 pt
 * stay on screen behind the top bar) — and swiping the same way again only
 * pushes it further out. A target clipped at BOTH edges (taller than the
 * frame) is not beyond either: turning back could not help it.
 */
export function beyondFarEdge(rect: Rect, direction: Direction, frame: Rect): boolean {
  const past: Record<Edge, boolean> = {
    top: rect.y < frame.y,
    bottom: rect.y + rect.height > frame.y + frame.height,
    left: rect.x < frame.x,
    right: rect.x + rect.width > frame.x + frame.width,
  };
  const { far, near } = FAR_EDGE[direction];
  return past[far] && !past[near];
}

/**
 * `beyondFarEdge` in every frame judged — or the target was dumped CLIPPED
 * OUT past that edge of its scroll container (UiNode.clippedOut, the note
 * below): uiautomator inverts the bounds of a node scrolled
 * wholly past its container, the parser clamps it to zero size AT the
 * container's edge — inside the frame, past neither of its edges — and the
 * mark is all that says which way it went. Settings' `Apps` under the
 * collapsing app bar read `126x-132` and was neither beyond the far edge
 * nor in the frame. Beyond, a target a read saw short of the far edge
 * turns the next stroke (`carriedPast`), and one lost after it was there
 * is not `dropped`. Not a stroke turned on the FIRST read (the owner's
 * call, iOS parity — a target read wholly beyond the far edge
 * before any read saw it short is the caller's direction to honour, as
 * `nextStroke` says; a node clipped out has nothing in the frame, so
 * `atFarEdge`, which needs some, never fires for it), nor on any read
 * after until a stroke the caller's way proves the content exhausted
 * that way — the end turn (`EndTurn`, the owner's decision of 2026-10-17,
 * which refines this call).
 * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md
 *
 * Or CUT to a sliver at that edge of its scroll container (`FarFacts
 * .slicedAt`, the standing's `facts.sliver`): the rest of it lies past the far edge as surely as a
 * clipped-out node's does, while its rect, cut to the container, lies
 * inside the frame. A plain stop does not stop on it (scroll-read.ts#stops), so without
 * this a 132-px row showing its bottom 40 px at a form's top under a
 * default (down) scroll was pushed out and back until "turned round 3
 * times"; `atFarEdge` turns the next stroke at once. A sliver at the
 * NEAR edge is coming in, and the strokes go on.
 */
export function beyondFarEdgeIn(found: FarFacts, direction: Direction, frames: readonly Rect[]): boolean {
  const { far } = FAR_EDGE[direction];
  // Each frame cut to what the target's scroll views draw: their edge is the far edge as the screen's is.
  const cut = (f: Rect): Rect => (found.drawn === undefined ? f : (rectIntersection(f, found.drawn) ?? f));
  return found.clippedOut === far || found.slicedAt === far || frames.every((f) => beyondFarEdge(found.rect, direction, cut(f)));
}

/**
 * What `beyondFarEdgeIn` reads of a match: its rect, the side it was dumped clipped out past, the edge its scroll
 * container cuts it to a sliver at, and the frame its scroll views draw it in (ui-tree/standing.ts#StandingFacts.drawn,
 * on every tree that lists ancestry). And what `stillNeeds` reads: whether that frame is the WINDOW a row moves through
 * as the content does (`listedWhereItLies`, ui-tree/standing.ts#StandingFacts.listedWhereItLies: on a tree that lists
 * the match where it lies, WDA's) — the one dialect on which a stroke's carry can be measured. Not on Android's: its
 * rects are cut to the scroll container where uiautomator cuts them (most rows; lab note LE1's are the exception, not
 * the rule), so a row's motion as it comes in reads short, and its strokes drag at `dragSpeed`, no fling, with
 * nothing to carry.
 * docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md
 */
export interface FarFacts {
  readonly rect: Rect;
  readonly clippedOut?: ClippedSide;
  readonly slicedAt?: Edge;
  readonly drawn?: Rect;
  readonly listedWhereItLies?: true;
}

/** A judged match's `FarFacts`, its rect copied. */
export const farFacts = ({ node, standing: { facts } }: Judged): FarFacts => ({
  rect: { ...node.rect },
  ...(node.clippedOut !== undefined && { clippedOut: node.clippedOut }),
  // A container's cut only: the rest of a node cut by a node drawn after it lies under that node, not past the far edge (geometry.ts#Cut.by).
  ...(facts.sliver !== undefined && facts.sliver.by === undefined && { slicedAt: facts.sliver.edge }),
  ...(facts.drawn !== undefined && { drawn: { ...facts.drawn } }),
  ...(facts.listedWhereItLies === true && { listedWhereItLies: true as const }),
});

/**
 * `cover`, drawn over the target, lies over its FAR side for a scroll
 * toward `direction` — the side `beyondFarEdge` reads against the frame:
 * over its far edge and short of its near one (for content below, a bar
 * over its top and not its bottom), so the strokes push it further under;
 * a cover over both edges (a sheet over the whole row), or over neither (a
 * badge inside it), is no side's — turning back could not uncover it. And
 * only a cover in `frame`'s FAR HALF (its centre past the frame's middle
 * toward the far edge — above it, for content below): the edge test alone
 * does not say where the cover sits, and a row coming in from below whose
 * top is under a bottom bar (CONTINUE at 780, the row at 785; a snackbar;
 * a floating tab bar or a FAB) has the bar over its far edge too — it was
 * turned away from the bar it was about to clear, and bounced for five
 * strokes where one stopped it. A
 * pinned bar sits at the edge it is pinned to, so the half it lies in is
 * that edge's. A cover centred exactly on the middle lies in neither far
 * half: not turned for, either way. Or, in that half, a cover the target
 * shows past only on its far side (`showsOnlyPast`): a bar a
 * few points short of the row's far edge and over the rest of it.
 */
export function overFarSide(rect: Rect, direction: Direction, cover: Rect, frame: Rect): boolean {
  const over: Record<Edge, boolean> = {
    top: cover.y <= rect.y,
    bottom: cover.y + cover.height >= rect.y + rect.height,
    left: cover.x <= rect.x,
    right: cover.x + cover.width >= rect.x + rect.width,
  };
  // Twice the centre against twice the middle: whole numbers, no rounding at the boundary.
  const vertical = 2 * cover.y + cover.height - (2 * frame.y + frame.height);
  const sideways = 2 * cover.x + cover.width - (2 * frame.x + frame.width);
  const inHalfOf: Record<Edge, boolean> = { top: vertical < 0, bottom: vertical > 0, left: sideways < 0, right: sideways > 0 };
  const { far, near } = FAR_EDGE[direction];
  return inHalfOf[far] && ((over[far] && !over[near]) || showsOnlyPast(rect, far, cover, frame));
}

/**
 * Everything of the target that shows past `cover` lies between the
 * frame's `far` edge and the cover's — and some does: the target, cut to
 * the frame, sticks out past the cover's far edge, and the rest of it lies
 * under the cover, across the whole of its width (its height, sideways).
 * The second way `overFarSide` reads a cover over the far side (a device
 * check's residual): Contacts' New Contact under
 * idb, `add url` at `20,78 362x51` under the sheet's `Toolbar` `0,83
 * 402x48` — the bar starts 5 pt BELOW the row's top, so it is not over the
 * row's far edge, and it reaches past its near one; it was stroked the
 * wrong way once or twice before the turn. The strip that shows is at the
 * far edge's side of the bar: strokes push it further under, a stroke back
 * brings the row out below the bar. No pixel slack: a bar starting any
 * distance below the row's top counts, as long as nothing of the row shows
 * on the bar's other side or beside it — a badge inside a row, or a bar
 * narrower than it, leaves some showing there and is no side's.
 */
function showsOnlyPast(rect: Rect, far: Edge, cover: Rect, frame: Rect): boolean {
  const inFrame = rectIntersection(rect, frame);
  if (inFrame === undefined) return false;
  const vertical = axisOfEdge(far) === 'vertical';
  // Along the scroll: [lo, hi) of the target in the frame and of the cover; across it, the target's span must lie in the cover's.
  const [lo, hi] = vertical ? [inFrame.y, inFrame.y + inFrame.height] : [inFrame.x, inFrame.x + inFrame.width];
  const [from, to] = vertical ? [cover.y, cover.y + cover.height] : [cover.x, cover.x + cover.width];
  const across = vertical
    ? cover.x <= inFrame.x && cover.x + cover.width >= inFrame.x + inFrame.width
    : cover.y <= inFrame.y && cover.y + cover.height >= inFrame.y + inFrame.height;
  // Some of it past the cover's far edge, the rest under the cover through to its near end.
  return across && (far === 'top' || far === 'left' ? lo < from && hi > from && hi <= to : hi > to && lo < to && lo >= from);
}

/**
 * What the target STILL NEEDS of a stroke toward `toward` (lab note LV5; the carry model that turns it into a stroke is
 * interact/stroke-plan.ts#carried's): once it lies in the tree short of its window — past the window's near edge, the
 * side content comes in through — `needs`, the distance that brings it to the window's middle, and `slack`, how far
 * the window lets it travel while whole in it (the window's side less its own). The window is what the target's
 * scroll views draw met with every frame judged (`FarFacts.drawn`, when `listedWhereItLies`): known on WDA's trees
 * only, where an off-screen row is listed where it lies — not on Android's (its strokes drag at `dragSpeed`, no fling, and its rects are cut to the
 * scroll container, so a row's motion as it comes in reads short) nor on idb's flat list. Undefined otherwise.
 * docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
 */
export function stillNeeds(found: FarFacts & { frames: readonly Rect[] }, toward: Direction): StillNeeds | undefined {
  if (found.drawn === undefined || found.listedWhereItLies !== true) return undefined;
  const window = found.frames.reduce<Rect | undefined>((w, f) => (w === undefined ? undefined : rectIntersection(w, f)), found.drawn);
  if (window === undefined) return undefined;
  const { rect } = found;
  const vertical = axisOf(toward) === 'vertical';
  // Along the scroll: how far past the window's near edge the target's far end lies, and the room the window leaves it.
  const [lo, len, wLo, wLen] = vertical ? [rect.y, rect.height, window.y, window.height] : [rect.x, rect.width, window.x, window.width];
  const need = toward === 'down' || toward === 'right' ? lo + len - (wLo + wLen) : wLo - lo;
  const slack = Math.max(0, wLen - len);
  return need <= 0 ? undefined : { needs: need + slack / 2, slack };
}

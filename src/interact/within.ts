import { type Rect, type ScrollAxis } from '../adapters/types.js';
import { listsAncestry } from '../ui-tree/draw-order.js';
import { quoted, type QuotedNode } from '../ui-tree/geometry.js';
import { scrolls } from '../ui-tree/scroll-containers.js';
import { findTarget, type Target } from '../ui-tree/selectors.js';
import type { TreeFacts } from './scroll-read.js';
import { targetScrollers } from './stroke-plan.js';
import { axisOf, type Direction } from './swipe.js';

/**
 * `scroll_until`'s `within` (D78): the scroll view the caller names for the strokes to go over until the target is
 * first read — before that read the plan strokes the screen's largest scroller and the scroll views nested in it
 * (interact/stroke-plan.ts#candidatesOf), so a row of a SIBLING list (the lab's `scroll-bounded`: O and F, rows of
 * `lower`, beside the larger `upper`) was never reached; D76's exhausted reply named such lists and left the remedy
 * manual. Named here as the caller can name it (ADR 0010's D78 amendment):
 * - a SELECTOR (or a flow's element spec) of the scroll view itself — a node that scrolls
 *   (ui-tree/scroll-containers.ts#scrolls) — or of an element inside it, whose NEAREST scroll view is taken by the rule
 *   that takes a found target's (stroke-plan.ts#targetScrollers: Android's clipping chain, else the scrolling
 *   ancestors); exactly one match, as a tap's selector;
 * - a RECT, as ui_snapshot and a failure reply quote one: the listed scroll view of exactly that rect
 *   (ui-tree/geometry.ts#Clips.axesOf finds it by scroll-containers.ts#isScrollViewOf, the test every remembered scroll
 *   view is found again by), so a rect a pixel off is none.
 * And refused when its scroll view is told to scroll only ACROSS the stroke with no scroll view nested in it that may
 * scroll along it (told along, or of unknown axis — D59b's nested candidates): a swipe over it would move nothing. A
 * scroll view of unknown axis proceeds.
 *
 * Every refusal is `scroll_until`'s stop before any swipe (scroll-rounds.ts's `within` stop, its words
 * scroll-text.ts's): no silent fallback to the largest scroller — a caller who named a list and had another stroked
 * would read the exhausted reply as that list's. On a tree that lists no scroll view (idb's flat list,
 * draw-order.ts#listsAncestry) nothing can be named: refused whatever the form.
 *
 * Resolved ONCE, at the scroll's first read that reads (scroll-rounds.ts#round), before any swipe; the plan remembers
 * the rect (stroke-plan.ts#nameScrollView). Pure: no adapter, no clock. Cost: a walk of the tree for the selector, one
 * for `axesOf`, one more for `toldOn` on a stale rect only.
 */

/** What the caller names: a selector or element spec of the scroll view or of an element inside it, or the scroll view's rect. */
export type Within = Target | Rect;

/** Why a `within` names no scroll view to stroke — each with the facts its sentence quotes (scroll-text.ts#withinText). */
export type WithinRefusal =
  /** The selector matches several nodes, listed in tree order. */
  | { readonly of: 'ambiguous'; readonly matches: readonly QuotedNode[] }
  /** The selector matches nothing in the tree. */
  | { readonly of: 'absent' }
  /** The selector's one match neither scrolls nor lies in anything that scrolls. */
  | { readonly of: 'unscrolled'; readonly node: QuotedNode }
  /** No listed scroll view has exactly this rect: `told`, every scroll view the tree tells scrolls on `axis`, the stroke's (ui-tree/geometry.ts#Clips.toldOn), in tree order. */
  | { readonly of: 'stale'; readonly axis: ScrollAxis; readonly told: readonly QuotedNode[] }
  /** The named scroll view (`rect`) is told to scroll on `axis`, across a stroke `toward`, and holds none that may scroll along it. */
  | { readonly of: 'across'; readonly rect: Rect; readonly axis: ScrollAxis; readonly toward: Direction }
  /** The tree lists no scroll view (idb's flat list). */
  | { readonly of: 'untold' };

/** `within` read as a rect, not a target: a rect has a width; neither a selector nor an element spec does. */
export const isRect = (within: Within): within is Rect => typeof within === 'object' && 'width' in within;

/**
 * The scroll view `within` names on this read's tree, as a rect — or why none: `facts` the read's (its tree, scene and
 * the keyboard's own nodes), `direction` the caller's (where the content lies: the stroke's axis), `screen` the usable
 * screen clear of its system bands (the scroll views a stale rect's refusal names are those meeting it, as D76's are).
 */
export function resolveWithin(facts: Pick<TreeFacts, 'tree' | 'scene' | 'reading'>, within: Within, direction: Direction, screen: Rect): { rect: Rect } | { refused: WithinRefusal } {
  if (!listsAncestry(facts.tree)) return { refused: { of: 'untold' } };
  const { clips } = facts.scene;
  const way = axisOf(direction);
  let rect: Rect;
  if (isRect(within)) {
    if (clips.axesOf(within) === undefined) return { refused: { of: 'stale', axis: way, told: clips.toldOn(way, screen, facts.reading.ofKeyboard).map(quoted) } };
    rect = { x: within.x, y: within.y, width: within.width, height: within.height };
  } else {
    const found = findTarget(facts.tree, within);
    if (found.length === 0) return { refused: { of: 'absent' } };
    if (found.length > 1) return { refused: { of: 'ambiguous', matches: found.map(quoted) } };
    const [node] = found;
    const nearest = scrolls(node) ? node.rect : targetScrollers(facts, node)[0];
    if (nearest === undefined) return { refused: { of: 'unscrolled', node: quoted(node) } };
    rect = { ...nearest };
  }
  const axes = clips.axesOf(rect);
  const axis = axes?.axis;
  if (axis !== undefined && axis !== way && !(axes?.nested ?? []).some((n) => n.axis === undefined || n.axis === way)) return { refused: { of: 'across', rect, axis, toward: direction } };
  return { rect };
}

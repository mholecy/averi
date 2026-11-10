import type { Rect, ScrollAxis } from '../adapters/types.js';
import { listsAncestry } from '../ui-tree/draw-order.js';
import { quoted, type QuotedNode, type ScrollAxes } from '../ui-tree/geometry.js';
import { findAll, parseSelector } from '../ui-tree/selectors.js';
import type { TreeFacts } from './scroll-read.js';
import { targetScrollers } from './stroke-plan.js';
import { axisOf, type Direction } from './swipe.js';

/**
 * `scroll_until`'s `within` (D78): the scroll view the caller names for the strokes to go over until the target is
 * first read — before that read the plan strokes the screen's largest scroller and the scroll views nested in it
 * (interact/stroke-plan.ts#candidatesOf), so a row of a SIBLING list (the lab's `scroll-bounded`: O and F, rows of
 * `lower`, beside the larger `upper`) was never reached; D76's exhausted reply named such lists and left the remedy
 * manual. Named here as the caller can name it (ADR 0010's D78 amendment):
 * - a SELECTOR of exactly one node, by one rule: the scroll view of that node's very rect
 *   (ui-tree/scroll-containers.ts#isScrollViewOf, through `Clips.axesOf` — the node itself when it scrolls, the list
 *   a wrapper is laid exactly over, and so too the list an unrelated overlay of its rect lies over: the rect is that
 *   scroll view's), else the NEAREST scroll view of the node, by the rule that takes a found target's
 *   (stroke-plan.ts#targetScrollers: Android's clipping chain, else the scrolling ancestors); a node under none is
 *   refused;
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
 * for `axesOf`, one more for `scrollViewsOn` on a stale rect only. A flow's element spec is not taken: the flow's
 * `scroll_until` does not take `within` yet (ADR 0010's D78 amendment, (f)), and that follow-up adds what it needs.
 */

/** What the caller names: a selector of the scroll view or of an element inside it, or the scroll view's rect. */
export type Within = string | Rect;

/** A scroll view a stale rect's refusal offers in its place (`WithinRefusal`'s `stale`): `untold` when the tree does not tell its axis. */
export interface OfferedScrollView {
  readonly node: QuotedNode;
  readonly untold?: true;
}

/** Why a `within` names no scroll view to stroke — each with the facts its sentence quotes (scroll-text.ts#withinText). */
export type WithinRefusal =
  /** The selector matches several nodes, listed in tree order. */
  | { readonly of: 'ambiguous'; readonly matches: readonly QuotedNode[] }
  /** The selector matches nothing in the tree. */
  | { readonly of: 'absent' }
  /** The selector's one match neither scrolls nor lies in anything that scrolls. */
  | { readonly of: 'unscrolled'; readonly node: QuotedNode }
  /**
   * No listed scroll view has exactly this rect: `views`, every scroll view a rect could name for a stroke on `axis` —
   * told to scroll on it, or of an axis the tree does not tell (`untold`), as the rect path itself accepts them — in
   * tree order (ui-tree/geometry.ts#Clips.scrollViewsOn); `across`, how many more it lists, told to scroll across it.
   */
  | { readonly of: 'stale'; readonly axis: ScrollAxis; readonly views: readonly OfferedScrollView[]; readonly across: number }
  /** The named scroll view (`rect`) is told to scroll on `axis`, across a stroke `toward`, and holds none that may scroll along it. */
  | { readonly of: 'across'; readonly rect: Rect; readonly axis: ScrollAxis; readonly toward: Direction }
  /** The tree lists no scroll view (idb's flat list). */
  | { readonly of: 'untold' };

/**
 * A string `within` parsed as a selector, its regexes compiled, before the scroll reads anything (interact/scroll.ts):
 * a selector that does not parse throws `within <it>: <why>` — else it would throw from inside the round, at the first
 * read, without saying it was `within`'s. A rect has nothing to parse.
 */
export function checkWithin(within: Within): void {
  if (typeof within !== 'string') return;
  try {
    for (const c of parseSelector(within)) if (c.op === 're') new RegExp(c.value);
  } catch (e) {
    // parseSelector and the RegExp constructor throw Errors only.
    throw new Error(`within ${within}: ${(e as Error).message}`);
  }
}

/** `within` read as a rect, not a selector. */
export const isRect = (within: Within): within is Rect => typeof within !== 'string';

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
  let axes: ScrollAxes | undefined;
  if (isRect(within)) {
    rect = { x: within.x, y: within.y, width: within.width, height: within.height };
    axes = clips.axesOf(rect);
    if (axes === undefined) {
      const listed = clips.scrollViewsOn(screen, facts.reading.ofKeyboard);
      const views = listed.filter((v) => v.axis === undefined || v.axis === way).map((v): OfferedScrollView => ({ node: quoted(v.node), ...(v.axis === undefined && { untold: true as const }) }));
      return { refused: { of: 'stale', axis: way, views, across: listed.length - views.length } };
    }
  } else {
    const found = findAll(facts.tree, within);
    if (found.length === 0) return { refused: { of: 'absent' } };
    if (found.length > 1) return { refused: { of: 'ambiguous', matches: found.map(quoted) } };
    const [node] = found;
    // One rule: a scroll view of the match's very rect — the match itself, a wrapper laid exactly over its list, an
    // overlay of the list's rect — else its nearest scroll view; a match under none falls to its own rect, which no
    // scroll view has, and is refused.
    rect = { ...(clips.axesOf(node.rect) !== undefined ? node.rect : (targetScrollers(facts, node)[0] ?? node.rect)) };
    axes = clips.axesOf(rect);
    if (axes === undefined) return { refused: { of: 'unscrolled', node: quoted(node) } };
  }
  const { axis, nested } = axes;
  if (axis !== undefined && axis !== way && !nested.some((n) => n.axis === undefined || n.axis === way)) return { refused: { of: 'across', rect, axis, toward: direction } };
  return { rect };
}

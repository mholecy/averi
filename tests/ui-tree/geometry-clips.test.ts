import { describe, expect, it } from 'vitest';
import type { Rect, ScrollAxis, UiNode } from '../../src/adapters/types.js';
import { clipsOf, toldFrame } from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';

/**
 * geometry.ts#clipsOf asked directly (backlog D45): what a read lists of a scroll view's content toward an edge
 * (`Clips.contentToward`, ADR 0021's `blank` and the end proof), a scroll view's axes (`Clips.axesOf`), and the corners
 * of `drawnIn` and `cutSliver` no caller's suite reached. The shapes are the lab app's measured ones where one exists
 * (`scroll-bounded`'s `lower`, `tabbar-floating`'s `list`, `carousel-in-list`'s carousel); the parsed captures are
 * tests/ui-tree/listed-content.test.ts's and scroll-containers.test.ts's.
 */

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const box = (rect: Rect, ...children: UiNode[]): UiNode => node({ rect, children });
/** A scroll view (role `scrollable`, scroll-containers.ts#scrolls), its axis as the tree says it when given. */
const scroller = (rect: Rect, axis: ScrollAxis | undefined, ...children: UiNode[]): UiNode =>
  node({ role: 'scrollable', rect, children, ...(axis !== undefined && { scrollAxis: axis }) });
const screen = (...children: UiNode[]): UiNode => node({ role: 'container', rect: r(0, 0, 402, 874), children });
const android = (...children: UiNode[]): UiNode => node({ role: 'container', rect: r(0, 0, 1080, 2220), children });

/** WDA's dialect: nested, frames unclipped (draw-order.ts#listsUnclippedFrames). */
const WDA = { ancestry: true, unclipped: true } as const;
/** uiautomator's: nested, rects cut to their scroll view. */
const UIAUTOMATOR = { ancestry: true } as const;
/** idb's flat list: no ancestry. */
const FLAT = { ancestry: false, unclipped: true } as const;

/** The lab's `scroll-bounded` (iOS 27, WDA): `lower` 0,380 402x180 at rest, its content 0,380 402x1300 — nothing above its top, 1120 pt below its bottom. */
const LOWER = r(0, 380, 402, 180);
const scrollBounded = ({ content = r(0, 380, 402, 1300), axis = 'vertical', rows = [r(51, 400, 300, 64), r(51, 620, 300, 64)] }: { content?: Rect; axis?: ScrollAxis | 'untold'; rows?: Rect[] } = {}) => {
  const view = scroller(LOWER, axis === 'untold' ? undefined : axis, box(content, ...rows.map((row) => box(row))));
  return { tree: screen(view), view };
};

describe('Clips.contentToward — the end proof (`ends`): on unclipped frames, along the axis the view scrolls on, nothing listed past the edge', () => {
  it("scroll-bounded's `lower` at rest: its content ends at its top (nothing above it) — ends, the scroll view quoted; it runs on below — listed", () => {
    const { tree, view } = scrollBounded();
    const clips = clipsOf(tree, WDA);
    expect(clips.contentToward(LOWER, 'top')).toEqual({ kind: 'ends', view });
    expect(clips.contentToward(LOWER, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('past by more than a pixel is past: content a pixel above the top still ends there, two pixels above does not', () => {
    expect(clipsOf(scrollBounded({ content: r(0, 379, 402, 1301) }).tree, WDA).contentToward(LOWER, 'top')).toMatchObject({ kind: 'ends' });
    expect(clipsOf(scrollBounded({ content: r(0, 378, 402, 1302) }).tree, WDA).contentToward(LOWER, 'top')).toEqual({ kind: 'listed' });
  });

  it('…and at the bottom: content scrolled to its end a pixel past the bottom ends there; two pixels past does not', () => {
    const atEnd = (height: number) => scrollBounded({ content: r(0, 0, 402, height), rows: [r(51, 400, 300, 64), r(51, 490, 300, 64)] }).tree;
    expect(clipsOf(atEnd(561), WDA).contentToward(LOWER, 'bottom')).toMatchObject({ kind: 'ends' });
    expect(clipsOf(atEnd(562), WDA).contentToward(LOWER, 'bottom')).toEqual({ kind: 'listed' });
    // Its top lies far above: the content runs on that way.
    expect(clipsOf(atEnd(561), WDA).contentToward(LOWER, 'top')).toEqual({ kind: 'listed' });
  });

  it('a horizontal carousel (WDA) at each side: cards past the edge by more than a pixel run on; flush within a pixel, it ends', () => {
    const CAROUSEL = r(24, 138, 354, 85);
    const carousel = (...cards: Rect[]) => {
      const view = scroller(CAROUSEL, 'horizontal', ...cards.map((c) => box(c)));
      return { clips: clipsOf(screen(view), WDA), view };
    };
    const first = r(24, 138, 170, 85);
    const { clips, view } = carousel(first, r(202, 138, 177, 85));
    expect(clips.contentToward(CAROUSEL, 'right')).toEqual({ kind: 'ends', view });
    expect(clips.contentToward(CAROUSEL, 'left')).toEqual({ kind: 'ends', view });
    expect(carousel(first, r(202, 138, 178, 85)).clips.contentToward(CAROUSEL, 'right')).toEqual({ kind: 'listed' });
    expect(carousel(r(23, 138, 171, 85)).clips.contentToward(CAROUSEL, 'left')).toMatchObject({ kind: 'ends' });
    expect(carousel(r(22, 138, 172, 85)).clips.contentToward(CAROUSEL, 'left')).toEqual({ kind: 'listed' });
  });

  it('the axis read from the content when the tree does not say it (unclipped: scroll-containers.ts#scrollAxis): `lower` runs on below, so it scrolls vertically — its top ends', () => {
    const { tree, view } = scrollBounded({ axis: 'untold' });
    expect(clipsOf(tree, WDA).contentToward(LOWER, 'top')).toEqual({ kind: 'ends', view });
  });

  it('no end proof on rects cut to their scroll view (uiautomator: content past an edge reads flush with it), nor on an axis the tree cannot tell, nor along the other axis', () => {
    const { tree } = scrollBounded();
    expect(clipsOf(tree, UIAUTOMATOR).contentToward(LOWER, 'top')).toEqual({ kind: 'listed' });
    // A scroll view whose content shows motion, but runs past no edge: no axis to read — and so no proof.
    const form = scroller(r(0, 0, 402, 780), undefined, box(r(24, 120, 354, 52)), box(r(24, 300, 354, 52)));
    expect(clipsOf(screen(form), WDA).contentToward(form.rect, 'bottom')).toEqual({ kind: 'listed' });
    // A vertical list asked sideways: its rows show motion along y, but the proof is only along the axis it scrolls on.
    const list = scroller(r(0, 0, 402, 780), 'vertical', box(r(24, 120, 300, 52)), box(r(24, 300, 300, 52)));
    expect(clipsOf(screen(list), WDA).contentToward(list.rect, 'right')).toEqual({ kind: 'listed' });
  });
});

describe('Clips.contentToward — `blank`: nothing under the scroll view of some area has an edge where the content\'s motion would show', () => {
  /** The lab's `tabbar-floating` `list` 0,550 1080x1670, a Compose verticalScroll (uiautomator). */
  const LIST = r(0, 550, 1080, 1670);
  const tabbar = (...rows: Rect[]) => {
    const view = scroller(LIST, undefined, ...rows.map((row) => box(row)));
    return { clips: clipsOf(android(view), UIAUTOMATOR), view };
  };

  it('scrolled past its rows, the list lists nothing: blank, the scroll view quoted — before the dialect\'s guards, so on WDA\'s frames too (an empty state is never `ends`)', () => {
    const { clips, view } = tabbar();
    expect(clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'blank', view });
    expect(clips.contentToward(LIST, 'left')).toEqual({ kind: 'blank', view });
    const empty = scroller(LOWER, 'vertical');
    expect(clipsOf(screen(empty), WDA).contentToward(LOWER, 'top')).toEqual({ kind: 'blank', view: empty });
  });

  it('rows T and R inside it show motion: listed', () => {
    expect(tabbar(r(66, 825, 948, 200), r(66, 1799, 948, 200)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('a node cut at both ends (an undescribed image spanning it), or within a pixel of both, is blank; an edge two pixels in shows motion', () => {
    expect(tabbar(LIST).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
    expect(tabbar(r(66, 551, 948, 1668)).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
    expect(tabbar(r(66, 549, 948, 1672)).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
    expect(tabbar(r(66, 550, 948, 1668)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
    expect(tabbar(r(66, 552, 948, 1668)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('a node of no area says nothing, wherever it lies', () => {
    expect(tabbar(r(500, 1000, 0, 0), r(66, 1000, 0, 200)).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
  });

  it('rows that each span the stroke\'s axis but lie apart across it are content shown (`stackedAcross`, form-picker\'s rows asked sideways)', () => {
    const rows = [r(0, 600, 1080, 150), r(0, 760, 1080, 150), r(0, 920, 1080, 150)];
    expect(tabbar(...rows).clips.contentToward(LIST, 'left')).toEqual({ kind: 'listed' });
    expect(tabbar(...rows).clips.contentToward(LIST, 'right')).toEqual({ kind: 'listed' });
    // One full-width, full-height node asked sideways: no x edge inside, nothing beside it — blank.
    expect(tabbar(LIST).clips.contentToward(LIST, 'right')).toMatchObject({ kind: 'blank' });
  });

  it('apart: one ends within a pixel of where the other begins, or before; two columns overlapping by two pixels are one thing', () => {
    expect(tabbar(r(0, 550, 540, 1670), r(540, 550, 540, 1670)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
    expect(tabbar(r(0, 550, 541, 1670), r(540, 550, 540, 1670)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
    expect(tabbar(r(0, 550, 542, 1670), r(540, 550, 540, 1670)).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
    // The order they are listed in does not matter.
    expect(tabbar(r(540, 550, 540, 1670), r(0, 550, 540, 1670)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('a hairline spanning the viewport, no wider across than a pixel, reads as content shown (the conservative side)', () => {
    expect(tabbar(r(539, 550, 1, 1670)).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
    expect(tabbar(r(539, 550, 2, 1670)).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
  });
});

describe('Clips.contentToward — a scroll view the tree says scrolls on the OTHER axis', () => {
  /** carousel-in-list's carousel 66,380 948x234 (a HorizontalScrollView). */
  const CAROUSEL = r(66, 380, 948, 234);

  it('moves none of its content along this one: listed, never blank — empty, or its cards filling its height', () => {
    expect(clipsOf(android(scroller(CAROUSEL, 'horizontal')), UIAUTOMATOR).contentToward(CAROUSEL, 'bottom')).toEqual({ kind: 'listed' });
    expect(clipsOf(android(scroller(CAROUSEL, 'horizontal', box(r(66, 380, 400, 234)))), WDA).contentToward(CAROUSEL, 'top')).toEqual({ kind: 'listed' });
    // A scroll view under it that scrolls its way too changes nothing.
    const inner = scroller(r(66, 380, 600, 234), 'horizontal');
    expect(clipsOf(android(scroller(CAROUSEL, 'horizontal', inner)), UIAUTOMATOR).contentToward(CAROUSEL, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('unless a scroll view under it may scroll on this one — a ViewPager over a list of its very rect: the list is what a vertical stroke moves', () => {
    const PAGE = r(0, 200, 1080, 1800);
    const pager = (list: UiNode) => {
      const view = scroller(PAGE, 'horizontal', list);
      return { clips: clipsOf(android(view), UIAUTOMATOR), view };
    };
    const empty = pager(scroller(PAGE, undefined));
    expect(empty.clips.contentToward(PAGE, 'bottom')).toEqual({ kind: 'blank', view: empty.view });
    expect(pager(scroller(PAGE, 'vertical')).clips.contentToward(PAGE, 'bottom')).toMatchObject({ kind: 'blank' });
    expect(pager(scroller(PAGE, 'vertical', box(r(0, 900, 1080, 200)))).clips.contentToward(PAGE, 'bottom')).toEqual({ kind: 'listed' });
    // A plain (non-scrolling) container of the same rect is no such view: the pager's read stays `listed`.
    expect(pager(box(PAGE)).clips.contentToward(PAGE, 'bottom')).toEqual({ kind: 'listed' });
  });
});

describe('Clips.contentToward — no answer where the read has none to give', () => {
  it('undefined on a tree that lists no ancestry (idb), for a rect no scroll view of the tree has (the list moved by a pixel), and for a plain container of that rect', () => {
    const { tree } = scrollBounded();
    expect(clipsOf(tree, FLAT).contentToward(LOWER, 'top')).toBeUndefined();
    expect(clipsOf(tree, WDA).contentToward(r(0, 381, 402, 180), 'top')).toBeUndefined();
    expect(clipsOf(screen(box(LOWER, box(r(0, 380, 402, 1300)))), WDA).contentToward(LOWER, 'top')).toBeUndefined();
  });

  it('the scroll view of that rect FIRST in tree order is the one read: a plain wrapper of its rect before it is passed over', () => {
    const inner = scroller(LOWER, 'vertical', box(r(0, 380, 402, 1300)));
    expect(clipsOf(screen(box(LOWER, inner)), WDA).contentToward(LOWER, 'top')).toEqual({ kind: 'ends', view: inner });
  });
});

describe('Clips.axesOf — a scroll view\'s axis and those of the scroll views nested in it', () => {
  const PAGE = r(0, 0, 402, 874);
  const CAROUSEL = r(24, 138, 354, 85);

  it("the page's axis, and each scroll view under it at any depth with its own — one of the page's own rect left out, a plain container not counted", () => {
    const deep = scroller(r(30, 140, 100, 80), undefined);
    const page = scroller(PAGE, 'vertical', scroller(PAGE, 'vertical'), box(r(0, 100, 402, 200), scroller(CAROUSEL, 'horizontal', deep)), box(r(0, 400, 402, 200)));
    expect(clipsOf(screen(page), UIAUTOMATOR).axesOf(PAGE)).toEqual({
      axis: 'vertical',
      nested: [
        { rect: CAROUSEL, axis: 'horizontal' },
        { rect: r(30, 140, 100, 80), axis: undefined },
      ],
    });
  });

  it('the first node in tree order that scrolls with exactly that rect — a plain container of it is not one; undefined for a rect off by a pixel', () => {
    const list = scroller(PAGE, 'vertical', scroller(CAROUSEL, 'horizontal'));
    const clips = clipsOf(node({ role: 'container', rect: PAGE, children: [list] }), UIAUTOMATOR);
    expect(clips.axesOf(PAGE)).toEqual({ axis: 'vertical', nested: [{ rect: CAROUSEL, axis: 'horizontal' }] });
    expect(clips.axesOf(CAROUSEL)).toEqual({ axis: 'horizontal', nested: [] });
    expect(clips.axesOf(r(24, 139, 354, 85))).toBeUndefined();
    expect(clipsOf(screen(box(LOWER)), UIAUTOMATOR).axesOf(LOWER)).toBeUndefined();
  });

  it("each axis as the tree's dialect reads it: inferred from content on unclipped frames, unknown on cut ones", () => {
    const { tree } = scrollBounded({ axis: 'untold' });
    expect(clipsOf(tree, WDA).axesOf(LOWER)).toEqual({ axis: 'vertical', nested: [] });
    expect(clipsOf(tree, UIAUTOMATOR).axesOf(LOWER)).toEqual({ axis: undefined, nested: [] });
  });
});

describe('Clips.drawnIn — scrollers that share no area leave no frame, however many lie under them', () => {
  it('a third scroller under two disjoint ones: still no frame, all three named; on a tree cut at the screen, no side is unknown', () => {
    const row = box(r(0, 950, 402, 50));
    const inner = scroller(r(0, 900, 402, 150), undefined, row);
    const lower = scroller(r(0, 880, 402, 200), undefined, inner);
    const list = scroller(r(0, 0, 402, 780), undefined, lower);
    const tree = screen(list);
    expect(clipsOf(tree, WDA).drawnIn(row)).toEqual({ told: true, frame: undefined, scrollers: [inner, lower, list], listedWhereItLies: true });
    expect(toldFrame(clipsOf(tree, { ancestry: true, cutAtScreen: true }).drawnIn(row))).toEqual({ told: true, frame: undefined, scrollers: [inner, lower, list], listedWhereItLies: false });
  });
});

describe('Clips.cutSliver — an inherited cut is the edge the node lies flush with, not another', () => {
  /** A short list 0,0 1080x40 (uiautomator): a row filling it, cut at its TOP (a child dumped running on above it). */
  it('a leaf flush with the list\'s bottom inside a row cut to a sliver at the TOP inherits nothing; flush with the top, it inherits the top', () => {
    const LIST = r(0, 500, 1080, 40);
    const atBottom = box(r(0, 520, 1080, 20));
    const atTop = box(r(0, 500, 1080, 20));
    const row = box(LIST, box(r(0, 480, 100, 30)), atBottom, atTop);
    const clips = clipsOf(android(node({ rect: LIST, children: [row], clipsDescendants: true })), UIAUTOMATOR);
    expect(clips.cutSliver(row, 50)).toEqual({ edge: 'top', container: LIST, depth: 40 });
    expect(clips.cutSliver(atBottom, 50)).toBeUndefined();
    expect(clips.cutSliver(atTop, 50)).toEqual({ edge: 'top', container: LIST, depth: 20, within: LIST });
  });
});

describe('Clips.cutSliver — the evidence at the edges tests/ui-tree/geometry.test.ts does not measure: the top from inside, the sides of a carousel off the origin', () => {
  /** The cut `n`'s own content evidences inside clipping containers of `chain`'s rects, nearest first, at any depth. */
  const cutOf = (n: UiNode, ...chain: Rect[]) => {
    let inner = n;
    for (const rect of chain) inner = node({ rect, children: [inner], clipsDescendants: true });
    return clipsOf(android(inner), UIAUTOMATOR).cutSliver(n, Number.MAX_SAFE_INTEGER);
  };
  const FORM = r(0, 242, 1080, 1736);

  it("at the TOP from inside: a row flush with the form's top, its button running up into the cut from 12 px inside — cut there, 55 deep; content filling it, or thinner than 8 px, is none", () => {
    const row = (top: number, bottom: number) => box(r(66, 242, 948, 55), box(r(66, top, 948, bottom - top)));
    expect(cutOf(row(242, 285), FORM)).toEqual({ edge: 'top', container: FORM, depth: 55 });
    expect(cutOf(row(243, 285), FORM)).toEqual({ edge: 'top', container: FORM, depth: 55 });
    expect(cutOf(row(244, 285), FORM)).toBeUndefined();
    expect(cutOf(row(242, 296), FORM)).toBeUndefined();
    expect(cutOf(row(242, 249), FORM)).toBeUndefined();
    expect(cutOf(row(242, 250), FORM)).toEqual({ edge: 'top', container: FORM, depth: 55 });
  });

  it('a 7-px line a pixel short of the bottom edge is no inside evidence either: its thickness, not its reach, rules it out', () => {
    const toggle = (top: number, bottom: number) => box(r(66, 1924, 948, 55), box(r(66, top, 948, bottom - top)));
    expect(cutOf(toggle(1970, 1977), FORM)).toBeUndefined();
    expect(cutOf(toggle(1969, 1977), FORM)).toEqual({ edge: 'bottom', container: FORM, depth: 55 });
  });

  it("at a side of carousel-in-list's carousel (66,380 948x234): a card flush with it, its content running more than a pixel past — cut there", () => {
    const CAROUSEL = r(66, 380, 948, 234);
    expect(cutOf(box(r(66, 380, 300, 234), box(r(20, 400, 200, 100))), CAROUSEL)).toEqual({ edge: 'left', container: CAROUSEL, depth: 300 });
    expect(cutOf(box(r(66, 380, 300, 234), box(r(65, 400, 200, 100))), CAROUSEL)).toBeUndefined();
    expect(cutOf(box(r(714, 380, 300, 234), box(r(860, 400, 200, 100))), CAROUSEL)).toEqual({ edge: 'right', container: CAROUSEL, depth: 300 });
    expect(cutOf(box(r(714, 380, 300, 234), box(r(814, 400, 201, 100))), CAROUSEL)).toBeUndefined();
  });

  it('a descendant dumped wholly past the edge and clamped onto it counts within a pixel of the edge; two pixels off it is another line', () => {
    const LIST = r(0, 297, 1080, 1857);
    const clamped = (y: number) => box(r(0, 297, 1080, 33), node({ rect: r(198, y, 0, 0), clippedOut: 'top' }));
    expect(cutOf(clamped(298), LIST)).toEqual({ edge: 'top', container: LIST, depth: 33 });
    expect(cutOf(clamped(299), LIST)).toBeUndefined();
  });
});

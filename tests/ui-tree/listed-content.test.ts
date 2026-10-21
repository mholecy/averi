import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { largestScroller } from '../../src/ui-tree/geometry.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * What a read lists of a scroll view's content toward an edge (ui-tree/geometry.ts#Clips.contentToward,
 * `ListedContent`) on uiautomator's trees, whose rects are cut to their scroll view: `blank` when nothing under it has
 * an edge along that axis where the content's motion would show — lab note LV1,
 * docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md. The real
 * capture of the lab app's `tabbar-floating`: `list` 0,550 1080x1670 (a Compose verticalScroll) lists T at 66,825 and
 * R at 66,1799, and nothing else; scrolled on, it lists nothing at all (the live strokes 3 and 4).
 */

const LAB = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
const TABBAR = parseDump(readFileSync(new URL('tabbar-floating.xml', LAB), 'utf8'));
const LIST: Rect = { x: 0, y: 550, width: 1080, height: 1670 };

/** `tree` with every node `edit` maps — `undefined` drops the node and its subtree. */
function edited(tree: UiNode, edit: (n: UiNode) => UiNode | undefined): UiNode {
  const walk = (n: UiNode): UiNode | undefined => {
    const e = edit(n);
    return e === undefined ? undefined : { ...e, children: e.children.flatMap((c) => walk(c) ?? []) };
  };
  return walk(tree) ?? tree;
}

const isRow = (n: UiNode, id: 'T' | 'R'): boolean => n.identifier === `lab.tabbar-floating.${id}`;
const without = (...ids: ('T' | 'R')[]) => (n: UiNode): UiNode | undefined => (ids.some((id) => isRow(n, id)) ? undefined : n);

describe('Clips.contentToward — blank: the scroll view lists none of its content where motion would show (uiautomator)', () => {
  it('tabbar-floating at rest lists T and R inside `list`: listed, down and up', () => {
    const { clips } = sceneOf(TABBAR);
    expect(clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
    expect(clips.contentToward(LIST, 'top')).toEqual({ kind: 'listed' });
  });

  it('scrolled past T and R (the live strokes 3 and 4): `list` lists nothing — blank, the scroll view quoted', () => {
    const blank = sceneOf(edited(TABBAR, without('T', 'R'))).clips.contentToward(LIST, 'bottom');
    expect(blank).toMatchObject({ kind: 'blank', view: { rect: LIST } });
  });

  it('a node cut at both ends (an undescribed image spanning the viewport) shows no motion: blank', () => {
    const spanning = edited(TABBAR, (n) => (isRow(n, 'R') ? undefined : isRow(n, 'T') ? { ...n, rect: { ...LIST }, children: [] } : n));
    expect(sceneOf(spanning).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
    // Within a pixel of the frame's edges counts as on them: a rounding of the cut, not an edge inside.
    const rounded = edited(TABBAR, (n) => (isRow(n, 'R') ? undefined : isRow(n, 'T') ? { ...n, rect: { x: 66, y: 551, width: 948, height: 1668 }, children: [] } : n));
    expect(sceneOf(rounded).clips.contentToward(LIST, 'bottom')).toMatchObject({ kind: 'blank' });
  });

  it('a node flush with the top, its bottom inside (2 px clear of the frame\'s bottom), shows motion: listed', () => {
    const flush = edited(TABBAR, (n) => (isRow(n, 'R') ? undefined : isRow(n, 'T') ? { ...n, rect: { x: 66, y: 550, width: 948, height: 1668 }, children: [] } : n));
    expect(sceneOf(flush).clips.contentToward(LIST, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('along the axis asked: carousel-in-list\'s carousel 66,380 948x234 (a HorizontalScrollView) lists C running on past its right edge — listed sideways; with C gone, blank sideways', () => {
    const tree = parseDump(readFileSync(new URL('carousel-in-list.xml', LAB), 'utf8'));
    const carousel: Rect = { x: 66, y: 380, width: 948, height: 234 };
    expect(sceneOf(tree).clips.contentToward(carousel, 'right')).toEqual({ kind: 'listed' });
    const noCard = edited(tree, (n) => (n.identifier === 'lab.carousel-in-list.C' ? undefined : n));
    expect(sceneOf(noCard).clips.contentToward(carousel, 'right')).toMatchObject({ kind: 'blank', view: { rect: carousel } });
  });

  it('a scroll view that scrolls on the OTHER axis moves no content along this one: its cards fill its height, yet a vertical stroke\'s read of it is evidence — listed, never blank', () => {
    const tree = parseDump(readFileSync(new URL('carousel-in-list.xml', LAB), 'utf8'));
    const carousel: Rect = { x: 66, y: 380, width: 948, height: 234 };
    const noCard = edited(tree, (n) => (n.identifier === 'lab.carousel-in-list.C' ? undefined : n));
    expect(sceneOf(tree).clips.contentToward(carousel, 'bottom')).toEqual({ kind: 'listed' });
    expect(sceneOf(noCard).clips.contentToward(carousel, 'top')).toEqual({ kind: 'listed' });
  });

  it('every committed Android capture\'s largest scroller (where a stroke for a target not in the tree goes) lists content that shows motion, along either axis — the fix changes no replayed reply, and a sideways stroke over a list still ends on its two unchanged reads', () => {
    const dirs = ['../fixtures/truth/android-averi_lab-api33/', '../fixtures/truth/android-rn-averi_lab-api33/', '../fixtures/'].map((d) => new URL(d, import.meta.url));
    const read: string[] = [];
    const blank: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
        const tree = parseDump(readFileSync(new URL(f, dir), 'utf8'));
        const main = largestScroller(tree);
        if (main === undefined) continue;
        read.push(f);
        const { clips } = sceneOf(tree);
        for (const edge of ['top', 'bottom', 'left', 'right'] as const) if (clips.contentToward(main, edge)?.kind !== 'listed') blank.push(`${f} ${edge}`);
      }
    }
    expect(read.length).toBeGreaterThan(20);
    expect(blank).toEqual([]);
  });
});

describe('Clips.contentToward — a scroll view of the other axis holding one that may scroll on the stroke\'s (uiautomator)', () => {
  /**
   * A classic tab screen: a ViewPager (horizontal by its class, adapters/android.ts#AXIS_BY_CLASS) at 0,200 1080x1800
   * holding a RecyclerView of its very rect, the vertical list a down stroke moves. The pager is the scroll view of
   * that rect the tree lists first, so the stroke's `within` names it: its read must still answer `blank` when the
   * list under it lists none of its content (lab note LV1's shape under a pager), and `listed` when it does. A
   * HorizontalScrollView holding only plain rows still answers `listed` down, as the carousel above does.
   */
  const RECT: Rect = { x: 0, y: 200, width: 1080, height: 1800 };
  const attrs = (cls: string, b: string, scrollable: boolean) =>
    `index="0" text="" resource-id="" class="${cls}" package="x" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="${scrollable}" long-clickable="false" password="false" selected="false" bounds="${b}"`;
  const row = (y0: number, y1: number, label: string) => `<node ${attrs('android.widget.TextView', `[0,${y0}][1080,${y1}]`, false).replace('text=""', `text="${label}"`)} />`;
  const dump = (outer: string, inner: string | undefined, rows: string) =>
    parseDump(
      `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node ${attrs('android.widget.FrameLayout', '[0,0][1080,2220]', false)}>` +
        `<node ${attrs(outer, '[0,200][1080,2000]', true)}>` +
        (inner === undefined ? rows : `<node ${attrs(inner, '[0,200][1080,2000]', true)}>${rows}</node>`) +
        `</node></node></hierarchy>`,
    );
  const PAGER = 'androidx.viewpager.widget.ViewPager';
  const RECYCLER = 'androidx.recyclerview.widget.RecyclerView';

  it('a ViewPager over a RecyclerView of its rect: blank when the list lists nothing or only a row cut at both ends, listed when a row shows motion', () => {
    expect(sceneOf(dump(PAGER, RECYCLER, '')).clips.contentToward(RECT, 'bottom')).toMatchObject({ kind: 'blank', view: { rect: RECT } });
    expect(sceneOf(dump(PAGER, RECYCLER, row(200, 2000, 'image'))).clips.contentToward(RECT, 'bottom')).toMatchObject({ kind: 'blank' });
    expect(sceneOf(dump(PAGER, RECYCLER, row(900, 1100, 'B'))).clips.contentToward(RECT, 'bottom')).toEqual({ kind: 'listed' });
  });

  it('a HorizontalScrollView holding plain rows only (nothing under it scrolls on y): listed down, blank or not', () => {
    expect(sceneOf(dump('android.widget.HorizontalScrollView', undefined, '')).clips.contentToward(RECT, 'bottom')).toEqual({ kind: 'listed' });
    expect(sceneOf(dump('android.widget.HorizontalScrollView', undefined, row(200, 2000, 'card'))).clips.contentToward(RECT, 'top')).toEqual({ kind: 'listed' });
  });
});

describe('Clips.contentToward — rows each spanning the stroke\'s axis, lying apart across it, are content shown (uiautomator)', () => {
  /**
   * The lab app's `form-picker` (tests/fixtures/truth/android-averi_lab-api33/form-picker.xml): its list 0,221
   * 1080x1933, a scroll view whose axis its class does not say, lists 14 rows each 0..1080 wide. A sideways stroke
   * over it: no row has an x edge inside the frame, yet they are its content, laid out down it — `listed`, so two
   * unchanged reads end that stroke's call as they did. One node spanning it (LV1's undescribed image) stays `blank`.
   */
  const tree = parseDump(readFileSync(new URL('form-picker.xml', LAB), 'utf8'));
  const list = largestScroller(tree)!;

  it('form-picker\'s list, asked left and right: listed', () => {
    expect(list).toEqual({ x: 0, y: 221, width: 1080, height: 1933 });
    const { clips } = sceneOf(tree);
    expect(clips.contentToward(list, 'right')).toEqual({ kind: 'listed' });
    expect(clips.contentToward(list, 'left')).toEqual({ kind: 'listed' });
  });

  it('two rows whose rounded bounds overlap by a pixel still lie apart: listed sideways', () => {
    const two = edited(tree, (n) =>
      sameAs(n.rect, list) && n.children.length > 1 ? { ...n, children: [n.children[0], { ...n.children[1], rect: { ...n.children[1].rect, y: n.children[1].rect.y - 1 } }] } : n,
    );
    expect(sceneOf(two).clips.contentToward(list, 'right')).toEqual({ kind: 'listed' });
  });

  it('the same list holding one full-width row of its 14: nothing lies apart across it — blank sideways', () => {
    const one = edited(tree, (n) => (sameAs(n.rect, list) && n.children.length > 1 ? { ...n, children: n.children.slice(0, 1) } : n));
    expect(sceneOf(one).clips.contentToward(list, 'right')).toMatchObject({ kind: 'blank', view: { rect: list } });
    expect(sceneOf(one).clips.contentToward(list, 'bottom')).toEqual({ kind: 'listed' });
  });
});

const sameAs = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

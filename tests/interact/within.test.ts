import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { checkWithin, isRect, resolveWithin } from '../../src/interact/within.js';
import { lookAt } from '../../src/ui-tree/look.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * `scroll_until`'s `within` (D78) resolved to the one scroll view its strokes go over until the target is read
 * (interact/within.ts#resolveWithin) — or refused before any swipe — over the lab app's real `scroll-bounded` trees:
 * Android's uiautomator dump (API 33: `upper` [0,303][1080,908], `lower` [0,1046][1080,1541], both ScrollViews, so
 * vertical by class), WDA's capture (iOS 27: `upper` 0,110 402x220, `lower` 0,380 402x180, vertical by their content's
 * extent) and idb's flat list of the same screen (no scroll view listed).
 */

const ANDROID = parseDump(readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/scroll-bounded.xml', import.meta.url), 'utf8'));
const WDA = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
const IDB = parseIdbDescribeAll(readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/scroll-bounded.idb.json', import.meta.url), 'utf8'));

const UPPER: Rect = { x: 0, y: 303, width: 1080, height: 605 };
const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
const WDA_UPPER: Rect = { x: 0, y: 110, width: 402, height: 220 };
const WDA_LOWER: Rect = { x: 0, y: 380, width: 402, height: 180 };
const ANDROID_SCREEN: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };

/** A tree's facts as the round derives them (scroll-read.ts#TreeFacts): its look, no keyboard. */
const factsOf = (tree: UiNode) => lookAt(tree, { ofKeyboard: () => false });
const list = (rect: Rect) => ({ role: 'scrollable', label: null, identifier: null, rect });

describe('resolveWithin — a selector: the matched scroll view, or the nearest scroll view of the element it matches', () => {
  it('Android: a row of `lower` (S) names `lower`; a selector of the scroll view itself names it', () => {
    expect(resolveWithin(factsOf(ANDROID), 'id:lab.scroll-bounded.S', 'down', ANDROID_SCREEN)).toEqual({ rect: LOWER });
    // A scroll view with no id or label: matched by its role and an exact rect is not a selector — the rect form is.
    expect(resolveWithin(factsOf(ANDROID), LOWER, 'down', ANDROID_SCREEN)).toEqual({ rect: LOWER });
  });

  it('WDA (no node clips: the scrolling ancestors): a row of `lower` names `lower`, one of `upper` names `upper`', () => {
    expect(resolveWithin(factsOf(WDA), 'id:lab.scroll-bounded.S', 'down', PHONE)).toEqual({ rect: WDA_LOWER });
    expect(resolveWithin(factsOf(WDA), 'id:lab.scroll-bounded.W', 'down', PHONE)).toEqual({ rect: WDA_UPPER });
  });

  it('several matches: refused, every match listed — the tap\'s ambiguous refusal', () => {
    expect(resolveWithin(factsOf(ANDROID), 'role:scrollable', 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'ambiguous', matches: [list(UPPER), list(LOWER)] } });
  });

  it('no match: refused', () => {
    expect(resolveWithin(factsOf(ANDROID), 'id:nope', 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'absent' } });
  });

  it('a match in no scroll view (android:id/content holds both lists): refused, naming it', () => {
    expect(resolveWithin(factsOf(ANDROID), 'id:content', 'down', ANDROID_SCREEN)).toEqual({
      refused: { of: 'unscrolled', node: { role: 'container', label: null, identifier: 'content', rect: ANDROID_SCREEN } },
    });
  });
});

describe('resolveWithin — an element spec (a flow\'s `within`, D81): resolved as the selector of the same fields is', () => {
  it('a row of `lower` names `lower` (Android and WDA); a spec of `upper`\'s row names `upper`', () => {
    expect(resolveWithin(factsOf(ANDROID), { id: 'lab.scroll-bounded.S' }, 'down', ANDROID_SCREEN)).toEqual({ rect: LOWER });
    expect(resolveWithin(factsOf(WDA), { id: 'lab.scroll-bounded.S' }, 'down', PHONE)).toEqual({ rect: WDA_LOWER });
    expect(resolveWithin(factsOf(WDA), { id: 'lab.scroll-bounded.W' }, 'down', PHONE)).toEqual({ rect: WDA_UPPER });
  });

  it('the same refusals: several matches, none, one in no scroll view, across the stroke, idb', () => {
    expect(resolveWithin(factsOf(ANDROID), { role: 'scrollable' }, 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'ambiguous', matches: [list(UPPER), list(LOWER)] } });
    expect(resolveWithin(factsOf(ANDROID), { id: 'nope' }, 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'absent' } });
    expect(resolveWithin(factsOf(ANDROID), { id: 'content' }, 'down', ANDROID_SCREEN)).toEqual({
      refused: { of: 'unscrolled', node: { role: 'container', label: null, identifier: 'content', rect: ANDROID_SCREEN } },
    });
    expect(resolveWithin(factsOf(WDA), { id: 'lab.scroll-bounded.O' }, 'right', PHONE)).toEqual({ refused: { of: 'across', rect: WDA_LOWER, axis: 'vertical', toward: 'right' } });
    expect(resolveWithin(factsOf(IDB), { id: 'lab.scroll-bounded.S' }, 'down', PHONE)).toEqual({ refused: { of: 'untold' } });
  });

  it('every field exact, as the spec matches a step\'s element: a spec\'s `text` is no regex', () => {
    expect(resolveWithin(factsOf(ANDROID), { id: 'lab.scroll-bounded.S', text: '.*' }, 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'absent' } });
  });

  it('a spec is no rect; a rect is', () => {
    expect(isRect({ id: 'x' })).toBe(false);
    expect(isRect('id:x')).toBe(false);
    expect(isRect(LOWER)).toBe(true);
  });
});

describe('resolveWithin — one rule for a match that does not scroll: a scroll view of its very rect, else its nearest scroll view', () => {
  const L: Rect = { x: 0, y: 400, width: 1080, height: 800 };
  const PAGE: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
  const list = (): UiNode => ({ role: 'scrollable', label: null, identifier: 'L', value: null, clipsDescendants: true, scrollAxis: 'vertical', rect: { ...L }, children: [] });
  const wrapper = (): UiNode => ({ role: 'container', label: null, identifier: 'wrap', value: null, rect: { ...L }, children: [list()] });
  const root = (children: UiNode[]): UiNode => ({ role: 'container', label: null, identifier: null, value: null, rect: { ...PAGE }, children });
  const page = (children: UiNode[]): UiNode => ({ role: 'scrollable', label: null, identifier: 'page', value: null, clipsDescendants: true, scrollAxis: 'vertical', rect: { ...PAGE }, children });

  it('a wrapper laid exactly over its list, at the root: the list', () => {
    expect(resolveWithin(factsOf(root([wrapper()])), 'id:wrap', 'down', PAGE)).toEqual({ rect: L });
  });

  it('the same wrapper inside a vertical page: the list, not the page', () => {
    expect(resolveWithin(factsOf(root([page([wrapper()])])), 'id:wrap', 'down', PAGE)).toEqual({ rect: L });
  });

  it('a node in no scroll view, of no scroll view\'s rect: refused', () => {
    const banner: UiNode = { role: 'text', label: 'Banner', identifier: 'banner', value: null, rect: { x: 0, y: 100, width: 1080, height: 200 }, children: [] };
    expect(resolveWithin(factsOf(root([banner, list()])), 'id:banner', 'down', PAGE)).toEqual({ refused: { of: 'unscrolled', node: { role: 'text', label: 'Banner', identifier: 'banner', rect: banner.rect } } });
  });
});

describe('resolveWithin — a rect: the listed scroll view of exactly that rect', () => {
  it('a rect a pixel off every listed scroll view: refused, naming the scroll views the tree tells along the stroke', () => {
    expect(resolveWithin(factsOf(ANDROID), { ...LOWER, height: 496 }, 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'stale', axis: 'vertical', views: [{ node: list(UPPER) }, { node: list(LOWER) }], across: 0 } });
    expect(resolveWithin(factsOf(WDA), { ...WDA_LOWER, y: 381 }, 'up', PHONE)).toEqual({ refused: { of: 'stale', axis: 'vertical', views: [{ node: list(WDA_UPPER) }, { node: list(WDA_LOWER) }], across: 0 } });
  });

  it('none that may scroll along the stroke: refused, counting those across it; a tree of none: none counted', () => {
    expect(resolveWithin(factsOf(ANDROID), { ...LOWER, height: 496 }, 'left', ANDROID_SCREEN)).toEqual({ refused: { of: 'stale', axis: 'horizontal', views: [], across: 2 } });
    const bare: UiNode = { role: 'container', label: null, identifier: null, value: null, rect: ANDROID_SCREEN, children: [] };
    expect(resolveWithin(factsOf(bare), LOWER, 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'stale', axis: 'vertical', views: [], across: 0 } });
  });

  it('a scroll view whose axis the tree does not tell (a RecyclerView, a Compose lazy list) is listed too, marked so — the rect path accepts it', () => {
    const RV: Rect = { x: 0, y: 1600, width: 1080, height: 500 };
    const recycler: UiNode = { role: 'container', label: null, identifier: 'feed', value: null, clipsDescendants: true, rect: { ...RV }, children: [] };
    const tree: UiNode = { ...ANDROID, children: [...ANDROID.children, recycler] };
    const refused = resolveWithin(factsOf(tree), { ...RV, y: 1601 }, 'left', ANDROID_SCREEN);
    expect(refused).toEqual({ refused: { of: 'stale', axis: 'horizontal', views: [{ node: { role: 'container', label: null, identifier: 'feed', rect: RV }, untold: true }], across: 2 } });
    expect(resolveWithin(factsOf(tree), RV, 'left', ANDROID_SCREEN)).toEqual({ rect: RV });
  });

  it('a rect of a node that does not scroll is no scroll view', () => {
    expect(resolveWithin(factsOf(ANDROID), ANDROID_SCREEN, 'down', ANDROID_SCREEN)).toMatchObject({ refused: { of: 'stale' } });
  });
});

describe('resolveWithin — the axis: a scroll view told to scroll only across the stroke is refused before any swipe', () => {
  it('`lower` (vertical) for a stroke sideways: refused, its axis named', () => {
    expect(resolveWithin(factsOf(ANDROID), LOWER, 'left', ANDROID_SCREEN)).toEqual({ refused: { of: 'across', rect: LOWER, axis: 'vertical', toward: 'left' } });
    expect(resolveWithin(factsOf(WDA), 'id:lab.scroll-bounded.O', 'right', PHONE)).toEqual({ refused: { of: 'across', rect: WDA_LOWER, axis: 'vertical', toward: 'right' } });
  });

  it('not refused when a scroll view nested in it may scroll along the stroke (its axis told along, or unknown): those stay candidates', () => {
    const horizontal = (children: UiNode[]): UiNode => ({ role: 'scrollable', label: null, identifier: 'page', value: null, clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 0, width: 1080, height: 1000 }, children });
    const nested = (extra: Partial<UiNode>): UiNode => ({ role: 'scrollable', label: null, identifier: 'nested', value: null, clipsDescendants: true, rect: { x: 0, y: 100, width: 1080, height: 400 }, children: [], ...extra });
    const screen = (page: UiNode): UiNode => ({ role: 'container', label: null, identifier: null, value: null, rect: ANDROID_SCREEN, children: [page] });
    expect(resolveWithin(factsOf(screen(horizontal([nested({ scrollAxis: 'vertical' })]))), 'id:page', 'down', ANDROID_SCREEN)).toEqual({ rect: { x: 0, y: 0, width: 1080, height: 1000 } });
    expect(resolveWithin(factsOf(screen(horizontal([nested({})]))), 'id:page', 'down', ANDROID_SCREEN)).toEqual({ rect: { x: 0, y: 0, width: 1080, height: 1000 } });
    expect(resolveWithin(factsOf(screen(horizontal([nested({ scrollAxis: 'horizontal' })]))), 'id:page', 'down', ANDROID_SCREEN)).toEqual({ refused: { of: 'across', rect: { x: 0, y: 0, width: 1080, height: 1000 }, axis: 'horizontal', toward: 'down' } });
  });

  it('a scroll view of unknown axis proceeds', () => {
    const unknown: UiNode = { role: 'container', label: null, identifier: 'lazy', value: null, clipsDescendants: true, rect: { x: 0, y: 200, width: 1080, height: 900 }, children: [] };
    const tree: UiNode = { role: 'container', label: null, identifier: null, value: null, rect: ANDROID_SCREEN, children: [unknown] };
    expect(resolveWithin(factsOf(tree), 'id:lazy', 'left', ANDROID_SCREEN)).toEqual({ rect: unknown.rect });
  });
});

describe('resolveWithin — idb\'s flat list lists no scroll view: refused whatever the form', () => {
  it('a selector of a row and a rect alike', () => {
    expect(resolveWithin(factsOf(IDB), 'id:lab.scroll-bounded.S', 'down', PHONE)).toEqual({ refused: { of: 'untold' } });
    expect(resolveWithin(factsOf(IDB), WDA_LOWER, 'down', PHONE)).toEqual({ refused: { of: 'untold' } });
  });
});

describe('checkWithin — a string `within` parsed before anything is read, its errors naming `within`', () => {
  it('a selector of no field:value form, and a regex that does not compile, throw naming it', () => {
    expect(() => checkWithin('garbage')).toThrow(/^within garbage: Invalid selector at "garbage"/);
    expect(() => checkWithin('text~"("')).toThrow(/^within text~"\(": Invalid regular expression/);
  });

  it('an exact value is no regex, and a rect has nothing to parse', () => {
    expect(() => checkWithin('text:"("')).not.toThrow();
    expect(() => checkWithin('id:lab.scroll-bounded.S label~"Target.*"')).not.toThrow();
    expect(() => checkWithin({ x: 0, y: 0, width: 1, height: 1 })).not.toThrow();
    // An element spec (a flow's, D81): its fields are exact values, nothing to parse.
    expect(() => checkWithin({ text: '(' })).not.toThrow();
  });
});

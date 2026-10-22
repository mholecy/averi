import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { sceneOf, type PixelStanding, type Standing } from '../../src/ui-tree/standing.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';

// AN IN-WINDOW BACKDROP (adapters/wda-source.ts#inWindowBackdrops; ADR 0018 residual 9): a SwiftUI menu card laid in
// the screen's own container over a dimmed backdrop. WDA lists the backdrop as a childless `Other` the screen's size,
// after the container of the screen beneath it at the same origin — WDA lists siblings by their top, ties in the order
// they are drawn (measured on the lab's blur-menu-grouped, blur-menu-stacked, tap-catcher-beneath and
// tap-catcher-stacked: two declaration orders, one listing). The parser marks the backdrop a presented `backdrop` (judged as a `screen` layer, its remedy worded apart), so
// what is listed before it lies under it (ui-tree/presentation.ts#byMarks).

const TRUTH = fileURLToPath(new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url));
const lab = async (cell: string): Promise<UiNode> => parseWdaSource(await readFile(join(TRUTH, `${cell}.wda.json`), 'utf8'));

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
const IPHONE: UsableScreen = { box: box(402, 874), boxes: [box(402, 874)], statusBand: 62, oriented: box(402, 874), from: 'device' };
const TAP = { of: 'tap' } as const;

/** The nodes the parser marks presented, each `<role> <x>,<y> <w>x<h> <kind>`. */
const marks = (tree: UiNode): string[] =>
  [...everyNode(tree)].filter((n) => n.presentation !== undefined).map((n) => `${n.role} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height} ${n.presentation} children=${n.children.length}`);

const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;

describe('inWindowBackdrops — the lab\'s captures (iPhone 17, iOS 27.0, WDA)', () => {
  it('blur-menu-grouped: the hidden backdrop listed after the screen beneath at its origin is the one presented node', async () => {
    expect(marks(await lab('blur-menu-grouped'))).toEqual(['container 0,0 402x874 backdrop children=0']);
  });

  it('blur-menu-stacked (declared in the order drawn, no zIndex): listed as blur-menu-grouped is — the same one mark', async () => {
    expect(marks(await lab('blur-menu-stacked'))).toEqual(['container 0,0 402x874 backdrop children=0']);
  });

  it('blur-menu-unhidden (the backdrop an accessibility element): shown over a screen beneath WDA reads wholly invisible — the same one mark', async () => {
    expect(marks(await lab('blur-menu-unhidden'))).toEqual(['container 0,0 402x874 backdrop children=0']);
  });

  it('the ungrouped blur-menu: the backdrop listed first of seven siblings by top, nothing before it — no mark (its order untold)', async () => {
    expect(marks(await lab('blur-menu'))).toEqual([]);
  });

  it('tap-catcher-beneath and tap-catcher-stacked: a hidden screen-wide tap-catcher drawn BENEATH the content is listed before it — no mark', async () => {
    expect(marks(await lab('tap-catcher-beneath'))).toEqual([]);
    expect(marks(await lab('tap-catcher-stacked'))).toEqual([]);
  });
});

// Synthetic payloads, one condition of the rule broken at a time: the lab's grouped shape, reduced.
const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const el = (type: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ type, rawIdentifier: null, label: null, rect: SCREEN, isVisible: '1', isAccessible: '0', children: [], ...over });
const button = (tag: string, y: number, over: Record<string, unknown> = {}) => el('Button', { rawIdentifier: tag, label: tag, rect: rect(51, y, 300, 64), isAccessible: '1', ...over });
/** The screen beneath: a container at the origin holding two rows. */
const beneath = (over: Record<string, unknown> = {}) => el('Other', { children: [button('A', 110), button('B', 290)], ...over });
/** The hidden backdrop: a childless `Other` the screen's size, `0/0`. */
const hiddenBackdrop = (over: Record<string, unknown> = {}) => el('Other', { isVisible: '0', ...over });
/** The screen beneath as WDA reads it under a presented screen: it and every row `isVisible="0"`. */
const wholly0Beneath = () => beneath({ isVisible: '0', children: [button('A', 110, { isVisible: '0' }), button('B', 290, { isVisible: '0' })] });
const card = () => el('Other', { rect: rect(51, 380, 300, 64), children: [button('K', 380)] });
/** A payload: the app's Window holding one layer that holds `kids` (flags on the root). */
const payload = (...kids: Record<string, unknown>[]) => el('Application', { children: [el('Window', { children: [el('Other', { isVisible: '0', children: kids })] })] });
const parsed = (p: Record<string, unknown>) => marks(parseWdaSourceValue(p));
const ONE = ['container 0,0 402x874 backdrop children=0'];

describe('inWindowBackdrops — each condition of the rule', () => {
  it('the reduced grouped shape is marked; listed BEFORE the screen beneath (drawn beneath it) it is not', () => {
    expect(parsed(payload(beneath(), hiddenBackdrop(), card()))).toEqual(ONE);
    expect(parsed(payload(hiddenBackdrop(), beneath(), card()))).toEqual([]);
  });

  it('the sibling before it must start at its origin: one of a smaller top is listed first whatever is drawn on top', () => {
    expect(parsed(payload(beneath({ rect: rect(0, -20, 402, 894) }), hiddenBackdrop(), card()))).toEqual([]);
    expect(parsed(payload(beneath({ rect: rect(51, 110, 300, 244) }), hiddenBackdrop(), card()))).toEqual([]);
  });

  it('the sibling before it must be the screen\'s size: a header strip at the origin holding a text is no screen beneath', () => {
    const strip = el('Other', { rect: rect(0, 0, 402, 100), children: [el('StaticText', { label: 'Title', rect: rect(16, 62, 200, 30) })] });
    expect(parsed(payload(strip, hiddenBackdrop(), card()))).toEqual([]);
  });

  it('the sibling before it must hold content: a bare frame at the origin is no screen beneath', () => {
    expect(parsed(payload(el('Other', { children: [el('Other', { rect: rect(0, 0, 402, 100) })] }), hiddenBackdrop(), card()))).toEqual([]);
    const bare0 = el('Other', { isVisible: '0', children: [el('Other', { isVisible: '0', rect: rect(0, 0, 402, 100) })] });
    expect(parsed(payload(bare0, hiddenBackdrop({ isVisible: '1', isAccessible: '1' }), card()))).toEqual([]);
  });

  it('the backdrop is a childless leaf of a structural role, screen-sized', () => {
    expect(parsed(payload(beneath(), hiddenBackdrop({ children: [el('Other', { isVisible: '0', rect: rect(0, 0, 10, 10) })] }), card()))).toEqual([]);
    expect(parsed(payload(beneath(), hiddenBackdrop({ type: 'Image' }), card()))).toEqual([]);
    expect(parsed(payload(beneath(), hiddenBackdrop({ rect: rect(0, 0, 402, 700) }), card()))).toEqual([]);
  });

  it('hidden: the backdrop `0/0` over a sibling showing content — an accessible `0` one, or a sibling wholly `0`, is not', () => {
    expect(parsed(payload(beneath(), hiddenBackdrop({ isAccessible: '1' }), card()))).toEqual([]);
    const wholly0 = wholly0Beneath();
    expect(parsed(payload(wholly0, hiddenBackdrop(), card()))).toEqual([]);
  });

  it('shown: the backdrop `isVisible="1"` over a sibling WDA reads wholly `0` — not over one with a row still visible', () => {
    const wholly0 = wholly0Beneath();
    expect(parsed(payload(wholly0, hiddenBackdrop({ isVisible: '1', isAccessible: '1' }), card()))).toEqual(ONE);
    const partly = beneath({ isVisible: '0', children: [button('A', 110, { isVisible: '0' }), button('B', 290)] });
    expect(parsed(payload(partly, hiddenBackdrop({ isVisible: '1', isAccessible: '1' }), card()))).toEqual([]);
    expect(parsed(payload(beneath(), hiddenBackdrop({ isVisible: '1', isAccessible: '1' }), card()))).toEqual([]);
  });

  it('a backdrop WDA gives no visibility flag is neither variant: not marked, even over a screen beneath wholly `0`', () => {
    const wholly0 = wholly0Beneath();
    const { isVisible: _v, ...unflagged } = hiddenBackdrop({ isAccessible: '1' });
    expect(parsed(payload(wholly0, unflagged, card()))).toEqual([]);
  });

  it('inside one of the Window\'s layers, never a layer itself: the same siblings laid as the Window\'s layers are presentedScreen\'s (a bare shown leaf after a hidden layer presents nothing)', () => {
    const wholly0 = wholly0Beneath();
    const asLayers = (...layers: Record<string, unknown>[]) => el('Application', { children: [el('Window', { children: layers })] });
    expect(parsed(asLayers(wholly0, hiddenBackdrop({ isVisible: '1', isAccessible: '1' })))).toEqual([]);
    expect(parsed(asLayers(beneath(), hiddenBackdrop(), card()))).toEqual([]);
  });

  it('only in the app\'s Window (the first), only in a payload that carries the flags', () => {
    const app = payload(beneath(), hiddenBackdrop(), card());
    const [window] = app.children as Record<string, unknown>[];
    expect(parsed({ ...app, children: [el('Window', { children: [el('Other', { children: [button('Z', 10)] })] }), window] })).toEqual([]);
    const flagless = (e: Record<string, unknown>): Record<string, unknown> => {
      const { isVisible: _v, isAccessible: _a, children, ...rest } = e;
      return { ...rest, children: ((children as Record<string, unknown>[]) ?? []).map(flagless) };
    };
    expect(parsed(flagless(app))).toEqual([]);
  });

  it('only when nothing else of its Window is marked: a backdrop inside a presented sheet\'s layer adds no second mark', () => {
    const hidden = (e: Record<string, unknown>): Record<string, unknown> => ({ ...e, isVisible: '0', children: ((e.children as Record<string, unknown>[]) ?? []).map(hidden) });
    const sheet = el('Other', { children: [beneath(), hiddenBackdrop(), card()] });
    const app = el('Application', { children: [el('Window', { children: [hidden(el('Other', { children: [button('L', 200)] })), sheet] })] });
    expect(parsed(app)).toEqual(['container 0,0 402x874 screen children=3']);
  });
});

describe('inWindowBackdrops — two backdrops in one Window', () => {
  it('each is marked (no "one per Window"), and the marks adapter takes the topmost — the one listed last — for a touch-down', () => {
    const second = () => el('Other', { children: [beneath(), hiddenBackdrop({ rawIdentifier: 'second' }), card()] });
    const tree = parseWdaSourceValue(payload(beneath(), hiddenBackdrop({ rawIdentifier: 'first' }), second()));
    expect(marks(tree)).toEqual([...ONE, ...ONE]);
    expect(presentationOf(tree).topmostAt({ x: 201, y: 800 })?.cover.node.identifier).toBe('second');
  });
});

describe('inWindowBackdrops — the sweep', () => {
  it('over every raw WDA /source payload in tests/fixtures, a backdrop (a childless node marked presented) is marked in the three grouped blur menus only', async () => {
    const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
    const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.json')).sort();
    const marked: string[] = [];
    let payloads = 0;
    for (const file of files) {
      const json: unknown = JSON.parse(await readFile(join(root, file), 'utf8'));
      const value = (json as { value?: { type?: unknown } } | null)?.value;
      if (typeof value !== 'object' || value === null || typeof value.type !== 'string') continue;
      payloads++;
      if ([...everyNode(parseWdaSourceValue(json))].some((n) => n.presentation !== undefined && n.children.length === 0)) marked.push(file);
    }
    expect(payloads).toBeGreaterThan(50);
    expect(marked).toEqual(['truth/ios-iphone17-ios27/blur-menu-grouped.wda.json', 'truth/ios-iphone17-ios27/blur-menu-stacked.wda.json', 'truth/ios-iphone17-ios27/blur-menu-unhidden.wda.json']);
  });
});

describe('the standing over blur-menu-grouped: what is listed before the backdrop lies under a presented screen', () => {
  const remedyOf = (s: Standing | PixelStanding) => (s.kind === 'reachable' ? undefined : s.remedy);
  it('A, B, C, D (the screen beneath) are covered, the presented remedy theirs; K and W (the card, listed after it) are not', async () => {
    const tree = await lab('blur-menu-grouped');
    const scene = sceneOf(tree);
    for (const tag of ['A', 'B', 'C', 'D']) {
      const standing = scene.standing(byId(tree, `lab.blur-menu-grouped.${tag}`), IPHONE, TAP);
      const remedy = remedyOf(standing);
      expect([tag, standing.kind, remedy?.of, remedy?.of === 'presented' ? remedy.layer?.kind : undefined]).toEqual([tag, 'covered', 'presented', 'backdrop']);
    }
    for (const tag of ['K', 'W']) expect([tag, scene.standing(byId(tree, `lab.blur-menu-grouped.${tag}`), IPHONE, TAP).kind]).toEqual([tag, 'reachable']);
  });
});

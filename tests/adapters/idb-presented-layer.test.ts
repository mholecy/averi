import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { walkOf } from '../../src/ui-tree/placed.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import { missNote, missOf } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/remedy-text.js';
import { ElementNotFoundError, resolveSettled } from '../../src/interact/resolve.js';
import { failureOf, play, resultOf, type Row } from '../helpers/rounds.js';

// IDB'S PRESENTED LAYER (iOS point 4, docs/truth/live-ios-2026-10-18-visibility.md; ADR 0018 residual 6): idb's
// describe-all lists only what a presentation leaves to accessibility, so beneath the lab's medium sheet the host's
// targets are not in the tree. When the list holds UIKit's dismiss region over the whole screen, the idb parser marks
// its root presented (adapters/ios-tree-source.ts#listsPresentedLayer) — and the verbs read it as Android's presented
// window: scroll_until sends no stroke (one at (201,175) on the dim DISMISSED the sheet live and claimed "fully visible
// after 1 swipe"), the tap's wait says close it first. Over the lab's committed idb captures, unchanged.

const TRUTH = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
/** A lab idb capture's raw element list. */
const raw = (cell: string): string => readFileSync(new URL(`${cell}.idb.json`, TRUTH), 'utf8');
const capture = (cell: string): UiNode => parseIdbDescribeAll(raw(cell));

const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const RULES = { direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE } as const;

/**
 * Every raw idb element list committed (an array of elements at any depth of their JSON): the lab's captures, the
 * device dumps under tests/fixtures, and the describe-all records under docs/truth/live-records.
 */
function everyIdbList(): { file: string; elements: unknown[] }[] {
  const lists: { file: string; elements: unknown[] }[] = [];
  const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.every((e) => typeof e === 'object' && e !== null && 'type' in e && 'frame' in e);
  const walk = (file: string, v: unknown): void => {
    if (isList(v)) lists.push({ file, elements: v });
    else if (Array.isArray(v)) v.forEach((e) => walk(file, e));
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach((e) => walk(file, e));
  };
  for (const f of readdirSync(TRUTH).filter((f) => f.endsWith('.idb.json'))) walk(f, JSON.parse(readFileSync(new URL(f, TRUTH), 'utf8')));
  const fixtures = new URL('../fixtures/', import.meta.url);
  for (const f of readdirSync(fixtures).filter((f) => f.startsWith('idb-') && f.endsWith('.json'))) walk(f, JSON.parse(readFileSync(new URL(f, fixtures), 'utf8')));
  const records = new URL('../../docs/truth/live-records/', import.meta.url);
  for (const f of readdirSync(records).filter((f) => f.startsWith('ios-idb-') && f.includes('describe-all') && f.endsWith('.json'))) {
    walk(f, JSON.parse(readFileSync(new URL(f, records), 'utf8')));
  }
  return lists;
}

describe('the idb parser marks its root presented when the list holds UIKit\'s dismiss region over the whole screen', () => {
  it('measured: the medium sheet (sheet-medium) and the medium sheet over the scrolled host (sheet-medium-edges) — `screen`', () => {
    expect(capture('sheet-medium').presentation).toBe('screen');
    expect(capture('sheet-medium-edges').presentation).toBe('screen');
  });

  it('specific: no other committed idb list is marked — the lab\'s other captures and the device dumps under tests/fixtures', () => {
    const lists = everyIdbList();
    expect(lists.length).toBeGreaterThan(30);
    const marked = lists.filter(({ elements }) => parseIdbDescribeAll(JSON.stringify(elements)).presentation !== undefined).map(({ file }) => file);
    expect(marked.sort()).toEqual(['sheet-medium-edges.idb.json', 'sheet-medium.idb.json']);
  });

  it('not a region that leaves part of the screen uncovered, nor a list with no Application frame to judge it by', () => {
    const elements = JSON.parse(raw('sheet-medium')) as { AXUniqueId?: string; type?: string; frame: { x: number; y: number; width: number; height: number } }[];
    const shrunk = elements.map((el) => (el.AXUniqueId === 'PopoverDismissRegion' ? { ...el, frame: { x: 0, y: 100, width: 402, height: 774 } } : el));
    expect(parseIdbDescribeAll(JSON.stringify(shrunk)).presentation).toBeUndefined();
    expect(parseIdbDescribeAll(JSON.stringify(elements.filter((el) => el.type !== 'Application'))).presentation).toBeUndefined();
  });

  it('the large sheet (sheet-background), the alert (alert-dim) and the transparent cover (dim-cover) carry no sign of their layer: unmarked', () => {
    for (const cell of ['sheet-background', 'alert-dim', 'dim-cover']) expect(capture(cell).presentation).toBeUndefined();
  });
});

describe('the presentation module: idb\'s presented layer is listed alone', () => {
  it('`alone` names the medium sheet as a presented screen; nothing on an unmarked list', () => {
    expect(presentationOf(capture('sheet-medium')).alone).toEqual({ kind: 'screen' });
    expect(presentationOf(capture('open')).alone).toBeUndefined();
    expect(presentationOf(capture('sheet-background')).alone).toBeUndefined();
  });

  it('for no target, a touch-down on the dim lands on the layer: the rectless root of the list reaches the screen', () => {
    const tree = capture('sheet-medium');
    expect(presentationOf(tree).topmostAt({ x: 201, y: 175 })?.cover.node).toBe(tree);
  });

  it('the sheet\'s own button is not beneath it: nothing presented over S', () => {
    const tree = capture('sheet-medium');
    const s = [...everyNode(tree)].find((n) => n.identifier === 'lab.sheet-medium.S')!;
    const order = walkOf(tree);
    const over = presentationOf(tree, order).over(s);
    expect(order.filter((p) => over.wholeScreen(p) || over.surface(p) === 'fact' || !over.drawn(p))).toEqual([]);
  });

  it('a miss says the layer, as the tree lists it: only that layer', () => {
    const miss = missOf({ tree: capture('sheet-medium') });
    expect(miss).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'layer' });
    expect(missNote(miss)).toBe('a sheet or modal is presented over it, and the tree lists only that layer — close it first');
    expect(missOf({ tree: capture('sheet-background') })).toEqual({ of: 'none' });
  });
});

describe('scroll_until for a target beneath idb\'s presented layer: stops before any swipe', () => {
  it('sheet-medium A, either way: the swipe would land on the dim — none is sent', () => {
    const row: Row = { tree: capture('sheet-medium'), found: [] };
    for (const direction of ['down', 'up'] as const) {
      const played = play({ ...RULES, direction }, [row, row]);
      expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
      const failure = failureOf(played, 'id:"lab.sheet-medium.A"');
      expect(failure).not.toBeInstanceOf(ElementNotFoundError);
      expect(failure.message).toMatch(/^scroll_until id:"lab\.sheet-medium\.A" stopped before any swipe — element is not in the tree, and the next swipe would touch down at \(201,\d+\) on /);
      expect(failure.message).toContain(`${presentedStop({ kind: 'screen' })}, so none was sent.`);
    }
  });

  it('sheet-medium-edges: the regions alone, the same stop', () => {
    const row: Row = { tree: capture('sheet-medium-edges'), found: [] };
    const played = play(RULES, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
  });

  it('the sheet\'s own S is still found where it lies: fully visible after 0 swipes', () => {
    const tree = capture('sheet-medium');
    const s = [...everyNode(tree)].find((n) => n.identifier === 'lab.sheet-medium.S')!;
    expect(resultOf(play(RULES, [{ tree, found: [s] }])).visible).toBe(1);
  });
});

describe('tap: the wait for a target beneath idb\'s presented layer names the layer', () => {
  const FAST = { ambiguous: 'first' as const, timeoutMs: 30, pollMs: 2 };
  const waitFails = (tree: UiNode, selector: string): Promise<Error> =>
    resolveSettled({ uiTree: async () => tree }, selector, FAST).then(
      () => {
        throw new Error('resolved');
      },
      (e: unknown) => e as Error,
    );

  it('sheet-medium: close it first, not "to appear" — a plain failure, not absence', async () => {
    const error = await waitFails(capture('sheet-medium'), 'id:"lab.sheet-medium.A"');
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toBe(
      'Timed out after 30ms: element id:"lab.sheet-medium.A" is not in the tree, which lists only the layer presented on top (the tree source lists nothing ' +
        `beneath a presented layer) — ${presentedRemedy('touch', { kind: 'screen' })}`,
    );
  });

  it('an unmarked list (sheet-background) still waits "to appear", idb\'s unlisted-id note beneath', async () => {
    const error = await waitFails(capture('sheet-background'), 'id:"lab.sheet-background.A"');
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toBe(`Timed out after 30ms waiting for element id:"lab.sheet-background.A" to appear\n  (${missNote({ of: 'idUnlisted', id: 'lab.sheet-background.A' })})`);
  });
});

// IDB'S BACKDROP (A38a; ADR 0018, the amendment "idb's backdrop"): on the lab's blur-menu-unhidden idb lists `K, W,
// GenericElement 0,0 402x874 (no label, no id), A, B, C, D` — the menu's card, its backdrop, the screen beneath. The
// parser marks the backdrop (adapters/ios-tree-source.ts#backdropOf), and on a flat list a marked layer covers what is
// listed AFTER it (ui-tree/presentation.ts#byMarks), never what is listed before it.
describe('the idb parser marks an unlabelled, id-less element over the whole screen a `backdrop`', () => {
  type El = { AXLabel?: string | null; AXUniqueId?: string | null; AXValue?: string | null; type?: string; frame: { x: number; y: number; width: number; height: number } };
  const elements = (): El[] => JSON.parse(raw('blur-menu-unhidden')) as El[];
  const backdrops = (list: readonly unknown[]): string[] =>
    [...everyNode(parseIdbDescribeAll(JSON.stringify(list)))].filter((n) => n.presentation === 'backdrop').map((n) => `${n.role} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`);
  const atBackdrop = (change: (el: El) => El): El[] => elements().map((el, i) => (i === 3 ? change(el) : el));

  it('measured: blur-menu-unhidden\'s GenericElement, listed between the card and the screen beneath — one mark, on it, not on the root', () => {
    const tree = capture('blur-menu-unhidden');
    expect(backdrops(elements())).toEqual(['other 0,0 402x874']);
    expect(tree.children[3]!.presentation).toBe('backdrop');
    expect(tree.presentation).toBeUndefined();
  });

  it('specific: no other committed idb list holds one — the lab\'s other captures and the device dumps under tests/fixtures', () => {
    const lists = everyIdbList();
    expect(lists.length).toBe(53);
    expect(lists.filter(({ elements: list }) => backdrops(list).length > 0).map(({ file }) => file)).toEqual(['blur-menu-unhidden.idb.json']);
  });

  it('not one that is labelled, has an id, leaves part of the screen uncovered, or is listed first; none without an Application frame', () => {
    expect(backdrops(atBackdrop((el) => ({ ...el, AXLabel: 'Dim' })))).toEqual([]);
    expect(backdrops(atBackdrop((el) => ({ ...el, AXUniqueId: 'dim' })))).toEqual([]);
    expect(backdrops(atBackdrop((el) => ({ ...el, frame: { x: 0, y: 1, width: 402, height: 873 } })))).toEqual([]);
    expect(backdrops(atBackdrop((el) => ({ ...el, frame: { x: -402, y: -874, width: 1206, height: 2622 } })))).toEqual(['other -402,-874 1206x2622']);
    const list = elements();
    expect(backdrops([list[3], ...list.slice(0, 3), ...list.slice(4)])).toEqual([]);
    expect(backdrops(list.filter((el) => el.type !== 'Application'))).toEqual([]);
    expect(backdrops(list.map((el) => (el.type === 'Application' ? { ...el, frame: { x: 0, y: 0, width: 0, height: 0 } } : el)))).toEqual([]);
  });

  it('only the measured type: an unlabelled full-screen element of another type (a web or map view) is no backdrop', () => {
    expect(backdrops(atBackdrop((el) => ({ ...el, type: 'WebView' })))).toEqual([]);
  });

  it('only with no value: an unlabelled full-screen GenericElement carrying a value is no backdrop', () => {
    expect(backdrops(atBackdrop((el) => ({ ...el, AXValue: 'map' })))).toEqual([]);
  });

  it('only the first such element is marked', () => {
    const list = elements();
    expect(backdrops([...list, { ...list[3]!, frame: { x: 0, y: 0, width: 402, height: 874 } }])).toEqual(['other 0,0 402x874']);
  });
});

describe('the presentation module: a flat list\'s backdrop covers what is listed after it', () => {
  const tree = capture('blur-menu-unhidden');
  const order = walkOf(tree);
  const byTag = (tag: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === `lab.blur-menu-unhidden.${tag}`)!;
  const backdrop = order[4]!;

  it('over A–D (listed after it): its cover reaches the whole screen, a presented surface, counted among what covers them', () => {
    const presentation = presentationOf(tree, order);
    for (const tag of ['A', 'B', 'C', 'D']) {
      const over = presentation.over(byTag(tag));
      expect(over.coversAhead).toEqual([backdrop]);
      expect(over.wholeScreen(backdrop)).toBe(true);
      expect(over.surface(backdrop)).toBe('fact');
    }
  });

  it('over K and W (the card, listed before it): nothing', () => {
    const presentation = presentationOf(tree, order);
    for (const tag of ['K', 'W']) {
      const over = presentation.over(byTag(tag));
      expect(over.coversAhead).toEqual([]);
      expect(order.filter((p) => over.wholeScreen(p) || over.surface(p) !== undefined || !over.drawn(p))).toEqual([]);
    }
  });

  it('named by its kind and where it is listed; never the list alone; for no target, the touch-down lands on it', () => {
    const presentation = presentationOf(tree, order);
    expect(presentation.press(backdrop.node)).toEqual({ surface: backdrop.node, reach: { x: 0, y: 0, width: 402, height: 874 }, layer: { kind: 'backdrop', listedAhead: true } });
    expect(presentation.alone).toBeUndefined();
    expect(presentation.topmostAt({ x: 201, y: 142 })?.cover).toBe(backdrop);
  });

  it('the same mark on a nested tree (not a flat list) covers what is listed BEFORE it, as WDA\'s does, and names no listing', () => {
    const nested = { ...tree, flatList: undefined, readingOrder: undefined };
    const placed = walkOf(nested);
    const presentation = presentationOf(nested, placed);
    expect(presentation.over(byTag('K')).wholeScreen(placed[4]!)).toBe(true);
    expect(presentation.over(byTag('A')).wholeScreen(placed[4]!)).toBe(false);
    expect(presentation.over(byTag('A')).coversAhead).toEqual([]);
    expect(presentation.press(placed[4]!.node).layer).toEqual({ kind: 'backdrop' });
  });
});

describe('scroll_until for a target not in the tree on blur-menu-unhidden (idb): stops on the backdrop before any swipe', () => {
  it('no stroke is sent — the touch-down would land on the backdrop — and the stop names it', () => {
    const row: Row = { tree: capture('blur-menu-unhidden'), found: [] };
    const played = play(RULES, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    const failure = failureOf(played, 'id:"lab.blur-menu-unhidden.Z"');
    expect(failure).not.toBeInstanceOf(ElementNotFoundError);
    expect(failure.message).toContain(`${presentedStop({ kind: 'backdrop', listedAhead: true })}, so none was sent.`);
  });
});

describe('the words: idb\'s backdrop names idb\'s evidence, WDA\'s keeps its own', () => {
  const IDB = { kind: 'backdrop', listedAhead: true } as const;
  it('the tap, the pixel assert and scroll_until\'s stop', () => {
    expect(presentedRemedy('touch', IDB)).toBe(
      "a menu's backdrop is presented over it (an empty element idb lists over the whole screen, before the screen's content) — close it first " +
        '(if a screenshot shows no menu up, the backdrop is an overlay that lets touches through: tap the target by its coordinates (its centre from ui_snapshot)); no scroll moves it out from under that backdrop',
    );
    expect(presentedRemedy('pixel', IDB)).toContain("over the element (an empty element idb lists over the whole screen, before the screen's content) — close it first (");
    expect(presentedStop(IDB)).toContain("(an empty element idb lists over the whole screen, before the screen's content) — close it first (");
    expect(presentedStop(IDB)).toMatch(/swipe, then tap the target, by coordinates\); no scroll moves it out from under that backdrop, and a swipe on it may close the menu$/);
    expect(presentedRemedy('touch', { kind: 'backdrop' })).toContain("(an empty element WDA lists over the whole screen, after the screen's content)");
    expect(presentedStop({ kind: 'backdrop' })).toContain("(an empty element WDA lists over the whole screen, after the screen's content)");
  });
});

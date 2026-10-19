import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { walkOf } from '../../src/ui-tree/placed.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import { missNote, missOf } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
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

/** Every raw idb element list a committed fixture holds: the lab's captures, and the device dumps under tests/fixtures (an array of elements at any depth of their JSON). */
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
        `beneath a presented layer) — ${presentedRemedy('it', { kind: 'screen' })}`,
    );
  });

  it('an unmarked list (sheet-background) still waits "to appear"', async () => {
    const error = await waitFails(capture('sheet-background'), 'id:"lab.sheet-background.A"');
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toMatch(/to appear$/);
  });
});

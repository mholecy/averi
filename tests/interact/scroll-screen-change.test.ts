import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseDump } from '../helpers/android-dumps.js';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { failureOf, play, resultOf } from '../helpers/rounds.js';

// THE SCREEN CHANGED UNDER THE STROKE (interact/scroll-rounds.ts#ScreenChange; iOS point 4 of
// docs/truth/live-ios-2026-10-18-visibility.md): beneath the lab's large sheet idb lists the sheet's button alone, no
// sign of the sheet, so scroll_until for the host's A strokes — and live the stroke from (201,175) DISMISSED the sheet
// and the next read found A: "fully visible after 1 swipe". The read after a stroke that touched down on nothing the
// read before listed, and that lists none of its ids, is another screen: the scroll stops and says so, never visible.

const TRUTH = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const raw = (cell: string): { type?: string; AXUniqueId?: string | null }[] => JSON.parse(readFileSync(new URL(`${cell}.idb.json`, TRUTH), 'utf8'));
const parse = (elements: unknown[]): UiNode => parseIdbDescribeAll(JSON.stringify(elements));

/** The sheet as idb lists it (sheet-background.idb.json: the Application and the sheet's S). */
const sheet = (): UiNode => parse(raw('sheet-background'));
/**
 * The host beneath it once the sheet is gone: the lab's plain host (open.idb.json, A–D at the very frames
 * sheet-background's state gives its host's A–D) under the sheet-background cell's ids — synthetic, no capture of the
 * host after the dismissal is committed.
 */
const host = (): UiNode => parse(raw('open').map((el) => (el.AXUniqueId ? { ...el, AXUniqueId: el.AXUniqueId.replace('lab.open.', 'lab.sheet-background.') } : el)));
const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;

const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
/** As the live harness asks A, which lies above the sheet's S: content above, the finger dragged down from (201,175). */
const UP = { direction: 'up', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE } as const;
const A = 'id:"lab.sheet-background.A"';

describe('scroll_until: a stroke that changed the screen stops the scroll, the target never claimed visible', () => {
  it('the sheet, then the host with A on it: stopped after 1 swipe, the swipe CHANGED THE SCREEN — a plain failure', () => {
    const after = host();
    const played = play(UP, [{ tree: sheet(), found: [] }, { tree: after, found: [byId(after, 'lab.sheet-background.A')] }]);
    expect(played.steps.filter((s) => s.do === 'stroke')).toHaveLength(1);
    expect(played.outcome).toMatchObject({ kind: 'changed', swipes: 1, found: true, change: { gone: ['lab.sheet-background.S'] } });
    const failure = failureOf(played, A);
    expect(failure).not.toBeInstanceOf(ElementNotFoundError);
    expect(failure.message).toBe(
      'scroll_until id:"lab.sheet-background.A" stopped after 1 swipe — the swipe CHANGED THE SCREEN: the one element the read before it listed by id ' +
        '(id:"lab.sheet-background.S") is not in the tree after it, and it touched down at (201,175) on nothing that read listed — it most likely dismissed a ' +
        'sheet or a modal presented over the screen, or the app left the screen. The element is in the tree only after that ' +
        'change, on the new screen: not judged, not claimed visible, and no further swipe was sent. If a sheet or a modal was open, it is gone: reopen it if ' +
        'the flow needs it — a target beneath one is reached by closing it first, never by scroll_until',
    );
  });

  it('…and with the target not on the new screen either: the same stop, no stroke onto the host', () => {
    const played = play(UP, [{ tree: sheet(), found: [] }, { tree: host(), found: [] }]);
    expect(played.outcome).toMatchObject({ kind: 'changed', found: false });
    expect(failureOf(played, 'id:"lab.sheet-background.Z"').message).toContain('The element is not in the tree after it either, and no further swipe was sent.');
  });

  it('a read that failed between keeps the read before the strokes: the first tree after them is compared with it', () => {
    const after = host();
    const played = play(UP, [{ tree: sheet(), found: [] }, { error: 'idb gone' }, { tree: after, found: [byId(after, 'lab.sheet-background.A')] }]);
    expect(played.outcome).toMatchObject({ kind: 'changed', found: true });
  });
});

describe('…and not a stroke that moved content', () => {
  it('an id the read before listed is still listed: the content moved, the stop is judged as before', () => {
    const before = host();
    const without = { ...before, children: before.children.filter((n) => n.identifier !== 'lab.sheet-background.A') };
    const after = host();
    const a = byId(after, 'lab.sheet-background.A');
    const played = play(UP, [{ tree: without, found: [] }, { tree: after, found: [a] }, { tree: after, found: [a] }]);
    expect(resultOf(played).visible).toBe(1);
  });

  it('a stroke that touched down on a row the read listed is a scroll, however far it flung: every id replaced, still judged', () => {
    // A list of rows with ids of their own, the touch-down (201,175) on one of them; after it, every row another.
    const rows = (from: number): unknown[] => [
      { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'Button', AXLabel: `Row ${from + i}`, AXUniqueId: `row_${from + i}`, frame: { x: 0, y: 62 + 64 * i, width: 402, height: 64 } })),
    ];
    const after = parse(rows(40));
    const target = byId(after, 'row_45');
    const played = play(UP, [{ tree: parse(rows(0)), found: [] }, { tree: after, found: [target] }, { tree: after, found: [target] }]);
    expect(played.outcome?.kind).toBe('visible');
  });

  // Rows of a STRUCTURAL role carry ids too: idb lists an RN row as `Other` (a `container`) and SwiftUI's grouped row as
  // `Group` (an `other`); every row recycled by one fling, the touch-down on one of them.
  for (const type of ['Other', 'Group']) {
    it(`idb rows of type ${type} with ids, every row recycled under a touch-down on one: a scroll, still judged`, () => {
      const rows = (from: number): unknown[] => [
        { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
        ...Array.from({ length: 12 }, (_, i) => ({ type, AXLabel: null, AXUniqueId: `row_${from + i}`, frame: { x: 0, y: 62 + 64 * i, width: 402, height: 64 } })),
      ];
      const after = parse(rows(40));
      const target = byId(after, 'row_45');
      const played = play(UP, [{ tree: parse(rows(0)), found: [] }, { tree: after, found: [target] }, { tree: after, found: [target] }]);
      expect(played.outcome?.kind).toBe('visible');
    });
  }

  it('a touch-down on a row that names itself by its label alone is a scroll too, when the ids the reads list (a header\'s) change', () => {
    const rows = (from: number): unknown[] => [
      { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
      { type: 'StaticText', AXLabel: `Section ${from}`, AXUniqueId: `section_${from}`, frame: { x: 0, y: 62, width: 402, height: 40 } },
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'Other', AXLabel: `Row ${from + i}`, AXUniqueId: null, frame: { x: 0, y: 102 + 64 * i, width: 402, height: 64 } })),
    ];
    const after = parse(rows(40));
    const target = byId(after, 'section_40');
    const played = play(UP, [{ tree: parse(rows(0)), found: [] }, { tree: after, found: [target] }, { tree: after, found: [target] }]);
    expect(played.outcome?.kind).toBe('visible');
  });

  it('residual: a read that lists no id says nothing — a label-only sheet dismissed is not told (UIKit rows under idb, NI1)', () => {
    const anonymous = (tree: UiNode): UiNode => ({ ...tree, children: tree.children.map((n) => ({ ...n, identifier: null })) });
    const after = host();
    const a = byId(after, 'lab.sheet-background.A');
    const played = play(UP, [{ tree: anonymous(sheet()), found: [] }, { tree: after, found: [a] }, { tree: after, found: [a] }]);
    expect(played.outcome?.kind).toBe('visible');
  });
});

describe('…nor a screen replaced between two reads with no stroke between', () => {
  it('the confirming read after a stop finds another screen (the app moved by itself): not the stroke\'s change — judged as any read', () => {
    const before = host();
    const without = { ...before, children: before.children.filter((n) => n.identifier !== 'lab.sheet-background.A') };
    const after = host();
    const played = play(UP, [{ tree: without, found: [] }, { tree: after, found: [byId(after, 'lab.sheet-background.A')] }, { tree: sheet(), found: [] }]);
    expect(played.steps[1]).toEqual({ do: 'confirm' });
    expect(played.outcome?.kind).not.toBe('changed');
  });
});

// Android's lists, as uiautomator dumps them: one window (the root), a `scrollable="true"` list, rows.
const PHONE: DeviceScreen = { width: 1080, height: 2220, statusBand: 66 };
const DOWN_PHONE = { direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: PHONE } as const;
const attrs = (id: string, cls: string, bounds: string, more = ''): string =>
  `index="0" text="" resource-id="${id}" class="${cls}" package="p" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" long-clickable="false" password="false" selected="false" bounds="${bounds}"${more}`;
/** A dump of a list from y 200 of the 1080x2220 screen: rows `from`…`from + 9`, each `row(i, top)`; `listId` the list's own testTag. */
const listDump = (from: number, row: (i: number, top: number) => string, listId = ''): UiNode =>
  parseDump(
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node ${attrs('', 'android.widget.FrameLayout', '[0,0][1080,2220]', ' scrollable="false"')}>` +
      `<node ${attrs(listId, 'android.view.View', '[0,200][1080,2220]', ' scrollable="true"')}>${Array.from({ length: 10 }, (_, i) => row(from + i, 200 + 200 * i)).join('')}</node></node></hierarchy>`,
  );
const text = (label: string, top: number): string => `<node ${attrs('', 'android.widget.TextView', `[40,${top + 70}][300,${top + 130}]`, ' scrollable="false"').replace('text=""', `text="${label}"`)} />`;

describe('…on Android\'s lists, every row recycled by one fling', () => {
  it('a Compose LazyColumn whose rows carry testTags (`View` rows with children: `container`): the touch-down on a row and in the list — a scroll', () => {
    const rowWithId = (i: number, top: number): string => `<node ${attrs(`row_${i}`, 'android.view.View', `[0,${top}][1080,${top + 200}]`, ' scrollable="false"')}>${text(`Row ${i}`, top)}</node>`;
    const after = listDump(40, rowWithId);
    const target = byId(after, 'row_45');
    const played = play(DOWN_PHONE, [{ tree: listDump(0, rowWithId), found: [] }, { tree: after, found: [target] }, { tree: after, found: [target] }]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke' });
    expect(played.outcome?.kind).not.toBe('changed');
  });

  it('a Compose list with a testTag of its own, its rows unnamed frames over a text: the list, 91 % of the screen, scrolls under the touch-down — a scroll', () => {
    const bare = (i: number, top: number): string => `<node ${attrs('', 'android.view.View', `[0,${top}][1080,${top + 200}]`, ' scrollable="false"')}>${text(`Row ${i}`, top)}</node>`;
    const withIds = (i: number, top: number): string => `<node ${attrs(`row_${i}`, 'android.view.View', `[0,${top}][1080,${top + 200}]`, ' scrollable="false"')}>${text(`Row ${i}`, top)}</node>`;
    // Ids on the rows of the read after only: the read before lists the list's testTag, which the read after keeps — so
    // the check is the touch-down's: drop the list's tag from the read after, and only the scrolling list stands between.
    const before = listDump(0, bare, 'lab.list');
    const after = listDump(40, withIds);
    const target = byId(after, 'row_45');
    const played = play(DOWN_PHONE, [{ tree: before, found: [] }, { tree: after, found: [target] }]);
    expect(played.outcome?.kind).not.toBe('changed');
  });
});

describe('the changed stop\'s words for several ids', () => {
  it('none of the N elements, the first three quoted as selectors, then an ellipsis', () => {
    const many: unknown[] = [
      { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
      ...['a', 'b', 'c', 'd'].map((id, i) => ({ type: 'Button', AXLabel: null, AXUniqueId: `sheet.${id}`, frame: { x: 51, y: 500 + 70 * i, width: 300, height: 64 } })),
    ];
    const played = play(UP, [{ tree: parse(many), found: [] }, { tree: host(), found: [] }]);
    expect(failureOf(played, A).message).toContain(
      'the swipe CHANGED THE SCREEN: none of the 4 elements the read before it listed by id (id:"sheet.a", id:"sheet.b", id:"sheet.c", …) is in the tree after it,',
    );
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { EDGES } from '../../src/ui-tree/geometry.js';
import { laterEdgesIn, type LaterEdge, type LaterScene } from '../../src/ui-tree/later-edges.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * THE EDGE EVIDENCE OF COMPOSE'S CUT AT A LATER NODE (ui-tree/later-edges.ts): each edge of a node, the later node laid
 * flush against it classified once — `overlaid`, `outsideScrollView`, `pinnedInScrollView`, `sameScrollView`,
 * `aligned`, `none` — over the lab's real captures (tests/fixtures/truth/android-averi_lab-api33), Compose's own
 * snapshots and the shapes the overlay must not make.
 * What each class means to a judgement is tested end to end in overlaid-edge.test.ts, eyes.test.ts and the golden rows.
 */

const lab = async (cell: string): Promise<UiNode> =>
  parseDump(await readFile(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.xml`, import.meta.url), 'utf8'));
const compose = async (name: string): Promise<UiNode> => ({
  ...(JSON.parse(await readFile(new URL('../fixtures/android-ui-snapshot-compose.json', import.meta.url), 'utf8')).screens[name] as UiNode),
  paddedTouchTargets: true as const,
});
const find = (tree: UiNode, test: (n: UiNode) => boolean, what: string): UiNode => {
  const found = [...everyNode(tree)].find(test);
  if (found === undefined) throw new Error(`no ${what}`);
  return found;
};
const byId = (tree: UiNode, id: string): UiNode => find(tree, (n) => n.identifier === id, id);
const at = (tree: UiNode, r: Rect): UiNode => find(tree, (n) => n.rect.x === r.x && n.rect.y === r.y && n.rect.width === r.width && n.rect.height === r.height, JSON.stringify(r));
const named = (n: UiNode): string => n.identifier ?? n.label ?? n.role;
/** One edge as one plain value: `none`, or its class, the later node and the node's depth across the edge. */
const said = (e: LaterEdge): string => (e.kind === 'none' ? 'none' : `${e.kind} ${named(e.by)} ${e.depth}`);
/** The node's four edges, classified, as one value. */
const edgesOf = (tree: UiNode, node: UiNode): Record<string, string> => {
  const later = laterEdgesIn(tree, sceneOf(tree))(node);
  return Object.fromEntries(EDGES.map((edge) => [edge, said(later.at(edge))]));
};
const only = (edge: (typeof EDGES)[number], what: string): Record<string, string> => ({ top: 'none', bottom: 'none', left: 'none', right: 'none', [edge]: what });

/** A list 0,300 1080x1200 holding an inset row 128,454 825x176, flush below a full-bleed header with its title — in the list (a sticky header), laid outside it (a pinned top bar), or with no list at all. */
const headerOver = (header: 'in the list' | 'outside it' | 'no list'): UiNode => {
  const head = '<node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node>';
  const row = '<node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" />';
  const body =
    header === 'no list' ? `${row}${head}` : `<node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]">${row}${header === 'in the list' ? head : ''}</node>${header === 'outside it' ? head : ''}`;
  return parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">${body}</node></hierarchy>`);
};

describe('LaterEdge — each edge of a node classified, over the lab\'s captures', () => {
  it.each([
    // An overlay: the pinned `Continue` 66..1014 reaching past the row 127..952 at both ends, in no scroll view.
    ['pinned-bar', 'lab.pinned-bar.P', only('bottom', 'overlaid lab.pinned-bar.continue 110')],
    ['pinned-bar', 'lab.pinned-bar.W', only('top', 'none')],
    ['text-under-bar', 'lab.text-under-bar.P', only('bottom', 'overlaid lab.text-under-bar.continue 22')],
    // The bar riding on the IME, outside the form's scroll view: `phone` cut to 42 px under it, its title to 14 above it.
    ['form-keyboard', 'lab.form-keyboard.phone', only('top', 'outsideScrollView lab.form-keyboard.submit 42')],
    ['form-keyboard', 'lab.form-keyboard.phone.title', only('bottom', 'outsideScrollView lab.form-keyboard.submit 14')],
    // A field's title flush above its field, in the same scroll view: its list's own content.
    ['form-keyboard', 'lab.form-keyboard.street.title', only('bottom', 'sameScrollView lab.form-keyboard.street 56')],
    // After `back` the bar sits lower: `note` cut to 14 px, `phone` whole under its title.
    ['form-keyboard.after-back', 'lab.form-keyboard.note', only('top', 'outsideScrollView lab.form-keyboard.submit 14')],
    ['form-keyboard.after-back', 'lab.form-keyboard.phone', only('top', 'none')],
    // VA1's shape: R cut at the merged sticky header IN its own list, the header pinned at the list's top —
    // `pinnedInScrollView`, its content `Target R` cut alike (a first row at rest lies whole under it, the same tree:
    // the flush probe's to tell).
    ['scroll-sticky-cut', 'lab.scroll-sticky-cut.R', only('top', 'pinnedInScrollView lab.scroll-sticky-cut.header 110')],
    // Layout neighbours laid flush, sharing an alignment line in no scroll view: Q above N's 48-dp touch target.
    ['bands', 'lab.bands.Q', only('bottom', 'aligned lab.bands.N 132')],
    ['bands-three-button', 'lab.bands-three-button.Q', only('bottom', 'aligned lab.bands-three-button.N 165')],
    // A picker row above the next, in their list.
    ['form-picker', 'lab.form-picker.country.AL', only('bottom', 'sameScrollView lab.form-picker.country.AX 143')],
  ])('%s %s', async (cell, id, edges) => {
    const t = await lab(cell);
    expect(edgesOf(t, byId(t, id))).toEqual(edges);
  });

  it('Compose\'s snapshots: Contacts\' "Save" beside the 132-px overflow target reaching past it at both ends — a SIDE edge, never an overlay; accountDetail "+493" cut at the floating tab bar, outside its list', async () => {
    const contacts = await compose('contactsCreate');
    expect(edgesOf(contacts, at(contacts, { x: 719, y: 99, width: 218, height: 110 }))).toEqual(only('right', 'aligned container 218'));
    const account = await compose('accountDetail');
    expect(edgesOf(account, at(account, { x: 736, y: 1831, width: 92, height: 9 }))).toEqual(only('bottom', 'outsideScrollView container 9'));
  });

  it('a full-bleed header flush over an inset row: an overlay with no list; outside the row\'s list a flush neighbour; in it (a sticky header) the list\'s own', () => {
    const row = (t: UiNode) => edgesOf(t, byId(t, 'row'));
    expect(row(headerOver('no list'))).toEqual(only('top', 'overlaid header 176'));
    expect(row(headerOver('outside it'))).toEqual(only('top', 'outsideScrollView header 176'));
    expect(row(headerOver('in the list'))).toEqual(only('top', 'pinnedInScrollView header 176'));
  });

  it('a later node in the row\'s own list is `pinnedInScrollView` only while pinned at the list\'s same edge, flush with the row — else `sameScrollView`', () => {
    const tree = (headerBounds: string): UiNode =>
      parseDump(
        `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]"><node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" /><node class="android.view.View" resource-id="header" bounds="${headerBounds}"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node></node></node></hierarchy>`,
      );
    const row = (t: UiNode) => edgesOf(t, byId(t, 'row'));
    // Pinned within a pixel of the list's top.
    expect(row(tree('[0,301][1080,454]'))).toEqual(only('top', 'pinnedInScrollView header 176'));
    // A row above it in the list, not at its edge: the list's next row.
    expect(row(tree('[0,330][1080,454]'))).toEqual(only('top', 'sameScrollView header 176'));
    // Its inner edge within a pixel of the row's (a pixel over it, as a dump's rounding lays it): pinned still; two
    // pixels over it, a header drawn over the row, not laid flush against it.
    expect(row(tree('[0,300][1080,455]'))).toEqual(only('top', 'pinnedInScrollView header 176'));
    expect(row(tree('[0,300][1080,456]'))).toEqual(only('top', 'sameScrollView header 176'));
  });

  it('sideways alike: a card flush right of a node pinned at its strip\'s left edge is `pinnedInScrollView` (its inner edge the node\'s right); one off that edge is `sameScrollView`', () => {
    const strip = (headerBounds: string): UiNode =>
      parseDump(
        `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="strip" bounds="[0,300][1080,600]"><node class="android.view.View" clickable="true" resource-id="card" bounds="[240,300][540,600]" /><node class="android.view.View" resource-id="header" bounds="${headerBounds}"><node class="android.widget.TextView" text="A" bounds="[40,400][160,460]" /></node></node></node></hierarchy>`,
      );
    const card = (t: UiNode) => edgesOf(t, byId(t, 'card'));
    expect(card(strip('[0,300][240,600]'))).toEqual(only('left', 'pinnedInScrollView header 300'));
    expect(card(strip('[30,300][240,600]'))).toEqual(only('left', 'sameScrollView header 300'));
  });

  it('only in the NEAREST scroll view: a header pinned at an outer list\'s top over a card of a carousel nested in it is `outsideScrollView` — the card\'s own scroll view is the carousel', () => {
    const t = parseDump(
      '<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]"><node class="android.view.View" scrollable="true" resource-id="carousel" bounds="[0,454][1080,754]"><node class="android.view.View" clickable="true" resource-id="card" bounds="[100,454][500,754]" /></node><node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node></node></node></hierarchy>',
    );
    expect(edgesOf(t, byId(t, 'card'))).toEqual(only('top', 'outsideScrollView header 300'));
    expect(laterEdgesIn(t, sceneOf(t))(byId(t, 'card')).pinned()).toEqual([]);
  });

  it('Compose\'s own snapshots (mp-native, tests/fixtures/android-ui-snapshot-compose.json): only the sticky date header under the one pinned at the transactions list\'s top', async () => {
    const found: string[] = [];
    const { screens } = JSON.parse(await readFile(new URL('../fixtures/android-ui-snapshot-compose.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> };
    for (const name of Object.keys(screens)) {
      const tree = await compose(name);
      const later = laterEdgesIn(tree, sceneOf(tree));
      for (const n of everyNode(tree)) for (const e of later(n).pinned()) found.push(`${name} ${named(n)} ${e.edge} ${named(e.by)}`);
    }
    expect(found).toEqual(['accountDetailFully transactions.list.date_header_22 top transactions.list.date_header_21']);
  });

  it('only at the content\'s start (top, left), where a sticky header pins: at the far edge a node flush with the row and with the list\'s edge is the next row cut at the fold — listed after the row, as a footer would be — and stays `sameScrollView`', () => {
    const fold = parseDump(
      '<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]"><node class="android.widget.TextView" text="Row" resource-id="row" bounds="[128,1200][953,1376]" /><node class="android.widget.TextView" text="Next" resource-id="next" bounds="[128,1376][953,1500]" /></node></node></hierarchy>',
    );
    expect(edgesOf(fold, byId(fold, 'row'))).toEqual(only('bottom', 'sameScrollView next 176'));
    const across = parseDump(
      '<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="strip" bounds="[0,300][1080,600]"><node class="android.widget.TextView" text="Card" resource-id="card" bounds="[700,300][900,600]" /><node class="android.widget.TextView" text="Next" resource-id="next" bounds="[900,300][1080,600]" /></node></node></hierarchy>',
    );
    expect(edgesOf(across, byId(across, 'card'))).toEqual(only('right', 'sameScrollView next 200'));
  });

  it('in no scroll view, a later node sharing an end with the row is aligned with it, at either end; one between two overlays has both', () => {
    const tree = (nodes: string): UiNode => parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">${nodes}</node></hierarchy>`);
    const row = '<node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" />';
    const later = (id: string, bounds: string) => `<node class="android.view.View" resource-id="${id}" bounds="${bounds}"><node class="android.widget.TextView" text="${id}" bounds="[400,344][681,410]" /></node>`;
    const sharesLeft = tree(`${row}${later('bar', '[128,630][1080,800]')}`);
    expect(edgesOf(sharesLeft, byId(sharesLeft, 'row'))).toEqual(only('bottom', 'aligned bar 176'));
    const sharesRight = tree(`${row}${later('bar', '[0,630][953,800]')}`);
    expect(edgesOf(sharesRight, byId(sharesRight, 'row'))).toEqual(only('bottom', 'aligned bar 176'));
    const between = tree(`${row}${later('header', '[0,300][1080,454]')}${later('bar', '[0,630][1080,800]')}`);
    expect(edgesOf(between, byId(between, 'row'))).toEqual({ ...only('top', 'overlaid header 176'), bottom: 'overlaid bar 176' });
    expect(laterEdgesIn(between, sceneOf(between))(byId(between, 'row')).overlaid()).toMatchObject({ edge: 'top', by: byId(between, 'header') });
  });

  it('every edge `none` on a tree of another dialect (WDA\'s unclipped frames, idb\'s flat list) and for a node of no area', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    const none = only('top', 'none');
    expect(edgesOf({ ...t, unclippedFrames: true }, p)).toEqual(none);
    expect(edgesOf({ ...t, flatList: true }, p)).toEqual(none);
    // A row of no height laid flush under a full-bleed header, in no scroll view: no overlay of a node with nothing to cover.
    const empty = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,454]" /><node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node>
</node></hierarchy>`);
    expect(edgesOf(empty, byId(empty, 'row'))).toEqual(only('top', 'none'));
  });
});

describe('LaterEdges — the two complements its readers ask', () => {
  it('`overlaid`: the overlay\'s edge and node, top before bottom; `flushNeighbours` empty in no scroll view', async () => {
    const t = await lab('pinned-bar');
    const later = laterEdgesIn(t, sceneOf(t))(byId(t, 'lab.pinned-bar.P'));
    expect(later.overlaid()).toMatchObject({ edge: 'bottom', by: byId(t, 'lab.pinned-bar.continue') });
    expect(later.flushNeighbours()).toEqual([]);
  });
  it('`flushNeighbours`: each outside-scroll-view edge as `{ edge, by }`, in edge order; no `overlaid` in a scroll view', async () => {
    const t = await lab('form-keyboard');
    const later = laterEdgesIn(t, sceneOf(t))(byId(t, 'lab.form-keyboard.phone'));
    expect(later.flushNeighbours()).toEqual([{ edge: 'top', by: byId(t, 'lab.form-keyboard.submit') }]);
    expect(later.overlaid()).toBeUndefined();
    const sticky = headerOver('in the list');
    expect(laterEdgesIn(sticky, sceneOf(sticky))(byId(sticky, 'row')).flushNeighbours()).toEqual([]);
    // A row between a pinned header and a bar riding on the IME, both outside its list: two, top first.
    const both = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]"><node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" /></node><node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node><node class="android.view.View" resource-id="bar" bounds="[0,630][1080,800]"><node class="android.widget.Button" text="Continue" bounds="[400,650][681,780]" /></node>
</node></hierarchy>`);
    expect(laterEdgesIn(both, sceneOf(both))(byId(both, 'row')).flushNeighbours()).toEqual([
      { edge: 'top', by: byId(both, 'header') },
      { edge: 'bottom', by: byId(both, 'bar') },
    ]);
  });
  it('each edge asked once and kept; a node in a scroll view asks no edge for `overlaid`, one in none none for `flushNeighbours`', async () => {
    const t = await lab('pinned-bar');
    const scene = sceneOf(t);
    const asked: Rect[] = [];
    const counting: LaterScene = { order: { coversOf: (node, strip) => (asked.push(strip), scene.order.coversOf(node, strip)) }, clips: scene.clips };
    const later = laterEdgesIn(t, counting)(byId(t, 'lab.pinned-bar.P'));
    later.flushNeighbours();
    expect(asked).toHaveLength(0);
    later.overlaid();
    later.at('bottom');
    expect(asked).toHaveLength(2);
    const k = await lab('form-keyboard');
    const kScene = sceneOf(k);
    asked.length = 0;
    laterEdgesIn(k, { order: { coversOf: (node, strip) => (asked.push(strip), kScene.order.coversOf(node, strip)) }, clips: kScene.clips })(byId(k, 'lab.form-keyboard.phone')).overlaid();
    expect(asked).toHaveLength(0);
    // An overlay at the top: the bottom edge is not asked.
    const top = headerOver('no list');
    const topScene = sceneOf(top);
    asked.length = 0;
    expect(laterEdgesIn(top, { order: { coversOf: (node, strip) => (asked.push(strip), topScene.order.coversOf(node, strip)) }, clips: topScene.clips })(byId(top, 'row')).overlaid()).toMatchObject({ edge: 'top' });
    expect(asked).toHaveLength(1);
  });
});

describe('LaterEdges.pinned — a node flush under a node pinned in its own scroll view (VA1: docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md)', () => {
  const pinnedOf = (tree: UiNode, node: UiNode) => laterEdgesIn(tree, sceneOf(tree))(node).pinned().map((e) => ({ edge: e.edge, by: named(e.by), depth: e.depth }));
  const labText = (cell: string) => readFile(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.xml`, import.meta.url), 'utf8');

  it('scroll-sticky-cut: R and its content `Target R`, cut at the merged header pinned at the list\'s top, each its top edge pinned by the header', async () => {
    const t = await lab('scroll-sticky-cut');
    const header = { edge: 'top', by: 'lab.scroll-sticky-cut.header', depth: 110 };
    expect(pinnedOf(t, byId(t, 'lab.scroll-sticky-cut.R'))).toEqual([header]);
    expect(pinnedOf(t, find(t, (n) => n.label === 'Target R', 'Target R'))).toEqual([header]);
  });

  it('the same dump at rest (offset 0: R whole, 128,457 825x176, flush under the header) reads the same — only motion tells the two', async () => {
    const t = parseDump((await labText('scroll-sticky-cut')).replaceAll('bounds="[128,457][953,567]"', 'bounds="[128,457][953,633]"'));
    expect(pinnedOf(t, byId(t, 'lab.scroll-sticky-cut.R'))).toEqual([{ edge: 'top', by: 'lab.scroll-sticky-cut.header', depth: 176 }]);
  });

  it('none where R overlaps the header (scroll-sticky, scroll-sticky-view: R listed from 391, a cover) nor for a list\'s next row', async () => {
    for (const cell of ['scroll-sticky', 'scroll-sticky-view']) {
      const t = await lab(cell);
      expect(pinnedOf(t, byId(t, `lab.${cell}.R`))).toEqual([]);
    }
    const picker = await lab('form-picker');
    expect(pinnedOf(picker, byId(picker, 'lab.form-picker.country.AL'))).toEqual([]);
  });

  it('over every Android dump in the fixtures, exactly scroll-sticky-cut\'s R and `Target R` have a pinned edge', async () => {
    const root = new URL('../fixtures/', import.meta.url);
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.xml'));
    expect(files.length).toBeGreaterThan(40);
    const found: string[] = [];
    for (const f of files) {
      const tree = parseDump(await readFile(new URL(f, root), 'utf8'));
      const later = laterEdgesIn(tree, sceneOf(tree));
      for (const n of everyNode(tree)) for (const e of later(n).pinned()) found.push(`${f.split('/').pop()} ${named(n)} ${e.edge}`);
    }
    expect(found.sort()).toEqual(['scroll-sticky-cut.xml Target R top', 'scroll-sticky-cut.xml lab.scroll-sticky-cut.R top']);
  });
});

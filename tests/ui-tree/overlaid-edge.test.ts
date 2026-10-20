import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { Cover } from '../../src/ui-tree/cover.js';
import { sceneOf, type PixelPurpose, type PixelStanding, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * AN OVERLAID EDGE (ui-tree/standing.ts#OverlaidEdge): Compose leaves out of a node's bounds what a node drawn after it
 * covers, so a node partly under a pinned button is dumped ending exactly at that node. Read only where that node is an
 * OVERLAY — reaching past a node in no scroll view at both ends of a top or bottom edge — the
 * `fully` stop and the pixel assert treat it as the cover (ui-tree/cover.ts#CoverOrder's `overlaid`), and a role-less node cut to a strip by it is a sliver. Over
 * the lab's real captures (tests/fixtures/truth/android-averi_lab-api33).
 * docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
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

/** The lab AVD (Pixel 3a, 1080x2220), its status band 66 and gesture navigation band from 2154. */
const box = { x: 0, y: 0, width: 1080, height: 2220 };
const AVD: UsableScreen = { box, boxes: [box], statusBand: 66, navigationBand: 2154, oriented: box, from: 'device' };
const FULLY = { of: 'fully' } as const;
const PLAIN = { of: 'stop' } as const;
const TAP = { of: 'tap' } as const;
const COLOUR: PixelPurpose = { of: 'pixel', reads: colorSampleRect, glyphs: false };
const OCR: PixelPurpose = { of: 'pixel', reads: (rect) => rect, glyphs: true };

/** A standing as one plain value: its kind, the node it names, and its remedy. */
const said = (s: Standing | PixelStanding): unknown => {
  const named = (n: UiNode): string => n.identifier ?? n.label ?? `${n.role} ${JSON.stringify(n.rect)}`;
  const remedy = s.kind === 'reachable' ? {} : { remedy: s.remedy.of };
  switch (s.kind) {
    case 'reachable':
      return { kind: s.kind, at: s.at };
    case 'covered':
      return { kind: s.kind, cover: named(s.cover.node), ...remedy };
    case 'cut':
      return 'cut' in s ? { kind: s.kind, edge: s.cut.edge, depth: s.cut.depth, by: s.cut.by === undefined ? undefined : named(s.cut.by), ...remedy } : { kind: s.kind, ...remedy };
    default:
      return { kind: s.kind, ...remedy };
  }
};
const standing = (tree: UiNode, node: UiNode, purpose: Purpose) => sceneOf(tree).standing(node, AVD, purpose);
/** The overlaid cover among a standing's covers (ui-tree/cover.ts#CoverOrder's `overlaid`), or undefined. */
const overlaidOf = (s: Standing | PixelStanding): Cover | undefined => s.facts.covers.find((c) => c.order.kind === 'overlaid');

describe('OverlaidEdge — pinned-bar P: dumped 127,1846 825x110, ending where Continue 66,1956 948x154 begins; its frame runs 66 px on under it', () => {
  it('`fully`: covered by Continue, the overlaid edge its fact — no "fully visible" on a row under a pinned button', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    const s = standing(t, p, FULLY);
    expect(said(s)).toEqual({ kind: 'covered', cover: 'lab.pinned-bar.continue', remedy: 'scroll' });
    // The exposure found no cover: the tree shows the button only by the cut — its one cover, the overlaid edge's, which
    // the standing names.
    const button = byId(t, 'lab.pinned-bar.continue');
    expect(s.facts.covers).toEqual([{ node: button, reach: button.rect, order: { kind: 'overlaid', edge: 'bottom' }, presented: false }]);
    expect(s.kind === 'covered' && s.cover).toBe(s.facts.covers[0]);
  });
  it('the colour assert and the ocr assert: covered by Continue, its rect the reach — in no scroll view, `pinned`', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    const cover = { reach: { x: 66, y: 1956, width: 948, height: 154 }, order: { kind: 'overlaid', edge: 'bottom' } };
    for (const purpose of [COLOUR, OCR]) {
      const s = standing(t, p, purpose);
      expect(said(s)).toEqual({ kind: 'covered', cover: 'lab.pinned-bar.continue', remedy: 'pinned' });
      expect(s).toMatchObject({ cover });
      expect(overlaidOf(s)).toBe(s.kind === 'covered' && s.cover);
    }
  });
  it('the tap and the plain stop are unchanged: its dumped centre (540,1901) is clear, and the probe there fired P', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    expect(said(standing(t, p, TAP))).toEqual({ kind: 'reachable', at: { x: 540, y: 1901 } });
    expect(said(standing(t, p, PLAIN))).toEqual({ kind: 'reachable', at: { x: 540, y: 1901 } });
    expect(overlaidOf(standing(t, p, PLAIN))).toBeUndefined();
  });
  it('W, far above the button, has no overlaid edge: reachable for `fully`', async () => {
    const t = await lab('pinned-bar');
    expect(said(standing(t, byId(t, 'lab.pinned-bar.W'), FULLY))).toEqual({ kind: 'reachable', at: { x: 540, y: 780 } });
  });
});

describe('OverlaidEdge — text-under-bar P: a role-less clickable dumped as the 22-px strip 127,1934 825x22 above Continue', () => {
  it('the plain stop and the tap: cut to a sliver by Continue — the role-less node under an OVERLAY is read as the sliver it is', async () => {
    const t = await lab('text-under-bar');
    const p = byId(t, 'lab.text-under-bar.P');
    expect(said(standing(t, p, PLAIN))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
    expect(said(standing(t, p, TAP))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
    expect(said(standing(t, p, FULLY))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
  });
  it('the colour assert: covered by Continue', async () => {
    const t = await lab('text-under-bar');
    const s = standing(t, byId(t, 'lab.text-under-bar.P'), COLOUR);
    expect(said(s)).toEqual({ kind: 'covered', cover: 'lab.text-under-bar.continue', remedy: 'pinned' });
    expect(s).toMatchObject({ cover: { reach: { x: 66, y: 1956, width: 948, height: 154 }, order: { kind: 'overlaid', edge: 'bottom' } } });
  });
});

describe('OverlaidEdge — never for a node in a scroll view: scroll-sticky-cut R, left open', () => {
  it('R dumped from 457, where the merged sticky header ends: not read as an overlay — at rest a first row lies whole and flush under its header, the same tree', async () => {
    const t = await lab('scroll-sticky-cut');
    const r = byId(t, 'lab.scroll-sticky-cut.R');
    expect(said(standing(t, r, FULLY))).toEqual({ kind: 'reachable', at: { x: 541, y: 512 } });
    expect(overlaidOf(standing(t, r, FULLY))).toBeUndefined();
    expect(standing(t, r, COLOUR).kind).toBe('reachable');
  });
});

describe('OverlaidEdge — layout neighbours laid flush are no overlay (the measured false covers it must not make)', () => {
  it('bands Q above N\'s 48-dp touch target, exactly as wide: no end reaches past — the colour assert and `fully` measure', async () => {
    for (const cell of ['bands', 'bands-three-button']) {
      const t = await lab(cell);
      const q = byId(t, `lab.${cell}.Q`);
      expect(standing(t, q, COLOUR).kind, cell).toBe('reachable');
      expect(overlaidOf(standing(t, q, FULLY)), cell).toBeUndefined();
    }
  });
  it('a picker row above the next row, as wide: reachable for `fully` and the colour assert', async () => {
    const t = await lab('form-picker');
    const al = byId(t, 'lab.form-picker.country.AL');
    expect(standing(t, al, FULLY).kind).toBe('reachable');
    expect(standing(t, al, COLOUR).kind).toBe('reachable');
  });
  it('Contacts\' "Save" 719,99 218x110 beside the 132-px overflow target that reaches past it at both ends: a SIDE edge, never read', async () => {
    const t = await compose('contactsCreate');
    const save = at(t, { x: 719, y: 99, width: 218, height: 110 });
    expect(standing(t, save, COLOUR).kind).toBe('reachable');
    expect(overlaidOf(standing(t, save, COLOUR))).toBeUndefined();
  });
  it('a node in no scroll view with a later node flush at its RIGHT edge, reaching past it at its top and bottom: a side edge, never read', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" clickable="true" resource-id="node" bounds="[100,1000][500,1100]" /><node class="android.view.View" clickable="true" resource-id="beside" bounds="[500,950][900,1150]"><node class="android.widget.TextView" text="Beside" bounds="[600,1020][800,1080]" /></node>
</node></hierarchy>`);
    const n = byId(t, 'node');
    expect(overlaidOf(standing(t, n, FULLY))).toBeUndefined();
    expect(standing(t, n, COLOUR).kind).toBe('reachable');
  });
  it('accountDetail "+493" 736,1831 92x9, cut at the floating tab bar\'s top, in its list: no overlay in a scroll view — tap, plain stop and colour as before', async () => {
    const t = await compose('accountDetail');
    const amount = at(t, { x: 736, y: 1831, width: 92, height: 9 });
    expect(standing(t, amount, TAP).kind).toBe('reachable');
    expect(standing(t, amount, PLAIN).kind).toBe('reachable');
    expect(standing(t, amount, COLOUR).kind).toBe('reachable');
    expect(overlaidOf(standing(t, amount, COLOUR))).toBeUndefined();
  });
});

describe('OverlaidEdge — a full-bleed node flush over an inset row in a list: no overlay, in the list or outside it (at rest a first row lies whole and flush under a pinned top bar, the same tree)', () => {
  /** A list 0,300 1080x1200 holding an inset row 128,454 825x176, flush below a full-bleed header with its title — in the list (a sticky header) or laid outside it (a pinned top bar). */
  const list = (header: 'in the list' | 'outside it') => {
    const head = '<node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node>';
    const row = '<node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" />';
    return parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]">${row}${header === 'in the list' ? head : ''}</node>${header === 'outside it' ? head : ''}
</node></hierarchy>`);
  };
  it('outside it (a pinned top bar over the list): no overlay — `fully` stops, the colour assert measures', () => {
    const t = list('outside it');
    expect(said(standing(t, byId(t, 'row'), FULLY))).toEqual({ kind: 'reachable', at: { x: 541, y: 542 } });
    expect(standing(t, byId(t, 'row'), COLOUR).kind).toBe('reachable');
  });
  it('the same row and bar with no list: an overlay — `fully` is covered by it', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" clickable="true" resource-id="row" bounds="[128,454][953,630]" /><node class="android.view.View" resource-id="header" bounds="[0,300][1080,454]"><node class="android.widget.TextView" text="Section" bounds="[400,344][681,410]" /></node>
</node></hierarchy>`);
    expect(said(standing(t, byId(t, 'row'), FULLY))).toEqual({ kind: 'covered', cover: 'header', remedy: 'scroll' });
  });
  it('in the list (a sticky header): no overlay — `fully` stops', () => {
    const t = list('in the list');
    expect(said(standing(t, byId(t, 'row'), FULLY))).toEqual({ kind: 'reachable', at: { x: 541, y: 542 } });
  });
});

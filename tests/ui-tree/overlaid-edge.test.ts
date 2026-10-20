import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import type { Cover } from '../../src/ui-tree/cover.js';
import { sceneOf, type PixelPurpose, type PixelStanding, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * AN OVERLAID EDGE (ui-tree/later-edges.ts#OverlaidEdge), end to end: Compose leaves out of a node's bounds what a node
 * drawn after it covers, so a node partly under a pinned button is dumped ending exactly at that node. Where that node
 * is an OVERLAY (the edge's class, tests/ui-tree/later-edges.test.ts — which also pins the layout neighbours and the
 * rows in a scroll view that are none), the `fully` stop and the pixel assert treat it as the cover
 * (ui-tree/cover.ts#CoverOrder's `overlaid`), and a role-less node cut to a strip by it is a sliver. Over the lab's real
 * captures (tests/fixtures/truth/android-averi_lab-api33).
 * docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 */

const lab = async (cell: string): Promise<UiNode> =>
  parseDump(await readFile(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.xml`, import.meta.url), 'utf8'));
const find = (tree: UiNode, test: (n: UiNode) => boolean, what: string): UiNode => {
  const found = [...everyNode(tree)].find(test);
  if (found === undefined) throw new Error(`no ${what}`);
  return found;
};
const byId = (tree: UiNode, id: string): UiNode => find(tree, (n) => n.identifier === id, id);

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

describe('OverlaidEdge — found first, else overlaid: the cover a judgement found wins over the cut (standing.ts#fullyStanding, #pixelStanding)', () => {
  /** A row 100,1000 400x100 in no scroll view, and a later button 50..1030 wide reaching past it at both ends, overlapping its bottom by `overlap` px. */
  const barOver = (overlap: number) => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" clickable="true" resource-id="node" bounds="[100,1000][500,1100]"><node class="android.widget.TextView" text="Row" bounds="[120,1020][480,1080]" /></node><node class="android.widget.Button" clickable="true" resource-id="bar" bounds="[50,${1100 - overlap}][1030,1300]"><node class="android.widget.TextView" text="Continue" bounds="[400,1150][680,1250]" /></node>
</node></hierarchy>`);
    return { t, row: byId(t, 'node'), bar: byId(t, 'bar') };
  };
  const orderOf = (s: Standing | PixelStanding) => (s.kind === 'covered' ? s.cover.order.kind : s.kind);
  it('flush (no overlap): the overlaid cover, for `fully` and both pixel asserts', () => {
    const { t, row } = barOver(0);
    for (const purpose of [FULLY, COLOUR, OCR]) expect(orderOf(standing(t, row, purpose))).toBe('overlaid');
  });
  it('3 px over: `fully` and the ocr assert name the cover the draw order found, not the overlaid edge — and no overlaid cover is made', () => {
    const { t, row, bar } = barOver(3);
    for (const purpose of [FULLY, OCR]) {
      const s = standing(t, row, purpose);
      expect(s.kind === 'covered' && s.cover.node).toBe(bar);
      expect(orderOf(s)).toBe('drawn');
      expect(overlaidOf(s)).toBeUndefined();
    }
  });
  it('1 px over: `fully` names the found cover; the ocr assert, where it paints no pixel it reads, the overlaid one — the same node then both among the found covers and overlaid', () => {
    const { t, row, bar } = barOver(1);
    expect(orderOf(standing(t, row, FULLY))).toBe('drawn');
    const s = standing(t, row, OCR);
    expect(orderOf(s)).toBe('overlaid');
    expect(s.facts.covers.map((c) => [c.node === bar, c.order.kind])).toEqual([[true, 'drawn'], [true, 'overlaid']]);
  });
});

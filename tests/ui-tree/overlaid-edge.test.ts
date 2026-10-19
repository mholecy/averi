import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { sceneOf, type PixelPurpose, type PixelStanding, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * AN OVERLAID EDGE (ui-tree/standing.ts#OverlaidEdge): Compose leaves out of a node's bounds what a node drawn after it
 * covers, so a node partly under a pinned button or a sticky header is dumped ending exactly at that node. Read only
 * where that node is an OVERLAY — reaching past the node at both ends of a top or bottom edge, and, in the node's own
 * scroll view, pinned at its far edge — the `fully` stop and the pixel assert treat it as the cover, and a role-less
 * node cut to a strip by it is a sliver. Over the lab's real captures (tests/fixtures/truth/android-averi_lab-api33).
 * docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 * docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md
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
      return { kind: s.kind, cover: named(s.cover), ...('reach' in s && { reach: s.reach }), ...remedy };
    case 'cut':
      return 'cut' in s ? { kind: s.kind, edge: s.cut.edge, depth: s.cut.depth, by: s.cut.by === undefined ? undefined : named(s.cut.by), ...remedy } : { kind: s.kind, ...remedy };
    default:
      return { kind: s.kind, ...remedy };
  }
};
const standing = (tree: UiNode, node: UiNode, purpose: Purpose) => sceneOf(tree).standing(node, AVD, purpose);

describe('OverlaidEdge — pinned-bar P (B4-L1): dumped 127,1846 825x110, ending where Continue 66,1956 948x154 begins; its frame runs 66 px on under it', () => {
  it('`fully`: covered by Continue, the overlaid edge its fact — no "fully visible" on a row under a pinned button', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    const s = standing(t, p, FULLY);
    expect(said(s)).toEqual({ kind: 'covered', cover: 'lab.pinned-bar.continue', remedy: 'scroll' });
    expect(s.facts.overlaid).toEqual({ edge: 'bottom', by: byId(t, 'lab.pinned-bar.continue') });
    // The exposure found no cover: the tree shows the button only by the cut.
    expect(s.facts.covers).toEqual([]);
  });
  it('the colour assert and the ocr assert: covered by Continue, its rect the reach — in no scroll view, `pinned`', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    const reach = { x: 66, y: 1956, width: 948, height: 154 };
    expect(said(standing(t, p, COLOUR))).toEqual({ kind: 'covered', cover: 'lab.pinned-bar.continue', reach, remedy: 'pinned' });
    expect(said(standing(t, p, OCR))).toEqual({ kind: 'covered', cover: 'lab.pinned-bar.continue', reach, remedy: 'pinned' });
    expect(standing(t, p, COLOUR).facts.overlaid?.edge).toBe('bottom');
  });
  it('the tap and the plain stop are unchanged: its dumped centre (540,1901) is clear, and the probe there fired P', async () => {
    const t = await lab('pinned-bar');
    const p = byId(t, 'lab.pinned-bar.P');
    expect(said(standing(t, p, TAP))).toEqual({ kind: 'reachable', at: { x: 540, y: 1901 } });
    expect(said(standing(t, p, PLAIN))).toEqual({ kind: 'reachable', at: { x: 540, y: 1901 } });
    expect(standing(t, p, PLAIN).facts.overlaid).toBeUndefined();
  });
  it('W, far above the button, has no overlaid edge: reachable for `fully`', async () => {
    const t = await lab('pinned-bar');
    expect(said(standing(t, byId(t, 'lab.pinned-bar.W'), FULLY))).toEqual({ kind: 'reachable', at: { x: 540, y: 780 } });
  });
});

describe('OverlaidEdge — text-under-bar P (B4-L1): a role-less clickable dumped as the 22-px strip 127,1934 825x22 above Continue', () => {
  it('the plain stop and the tap: cut to a sliver by Continue — the role-less node under an OVERLAY is read as the sliver it is', async () => {
    const t = await lab('text-under-bar');
    const p = byId(t, 'lab.text-under-bar.P');
    expect(said(standing(t, p, PLAIN))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
    expect(said(standing(t, p, TAP))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
    expect(said(standing(t, p, FULLY))).toEqual({ kind: 'cut', edge: 'bottom', depth: 22, by: 'lab.text-under-bar.continue', remedy: 'scroll' });
  });
  it('the colour assert: covered by Continue', async () => {
    const t = await lab('text-under-bar');
    expect(said(standing(t, byId(t, 'lab.text-under-bar.P'), COLOUR))).toEqual({ kind: 'covered', cover: 'lab.text-under-bar.continue', reach: { x: 66, y: 1956, width: 948, height: 154 }, remedy: 'pinned' });
  });
});

describe('OverlaidEdge — scroll-sticky-cut R (VA1): the row and its content dumped from 457, where the merged sticky header 0,303 1080x154 ends', () => {
  it('`fully` and the colour assert: covered by the header, pinned at its list\'s top — a scroll moves the row out from under it', async () => {
    const t = await lab('scroll-sticky-cut');
    const r = byId(t, 'lab.scroll-sticky-cut.R');
    const s = standing(t, r, FULLY);
    expect(said(s)).toEqual({ kind: 'covered', cover: 'lab.scroll-sticky-cut.header', remedy: 'scroll' });
    expect(s.facts.overlaid?.edge).toBe('top');
    expect(said(standing(t, r, COLOUR))).toEqual({ kind: 'covered', cover: 'lab.scroll-sticky-cut.header', reach: { x: 0, y: 303, width: 1080, height: 154 }, remedy: 'scroll' });
  });
  it('the tap and the plain stop are unchanged: its centre is clear', async () => {
    const t = await lab('scroll-sticky-cut');
    const r = byId(t, 'lab.scroll-sticky-cut.R');
    expect(said(standing(t, r, TAP))).toEqual({ kind: 'reachable', at: { x: 541, y: 512 } });
    expect(said(standing(t, r, PLAIN))).toEqual({ kind: 'reachable', at: { x: 541, y: 512 } });
  });
});

describe('OverlaidEdge — layout neighbours laid flush are no overlay (the measured false covers it must not make)', () => {
  it('bands Q above N\'s 48-dp touch target, exactly as wide: no end reaches past — the colour assert and `fully` measure', async () => {
    for (const cell of ['bands', 'bands-three-button']) {
      const t = await lab(cell);
      const q = byId(t, `lab.${cell}.Q`);
      expect(standing(t, q, COLOUR).kind, cell).toBe('reachable');
      expect(standing(t, q, FULLY).facts.overlaid, cell).toBeUndefined();
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
    expect(standing(t, save, COLOUR).facts.overlaid).toBeUndefined();
  });
  it('accountDetail "+493" 736,1831 92x9, cut at the tab bar\'s top: a text keeps its tap and plain stop (ADR 0013); its colour is covered by the tab bar, a true cut', async () => {
    const t = await compose('accountDetail');
    const amount = at(t, { x: 736, y: 1831, width: 92, height: 9 });
    expect(standing(t, amount, TAP).kind).toBe('reachable');
    expect(standing(t, amount, PLAIN).kind).toBe('reachable');
    expect(said(standing(t, amount, COLOUR))).toMatchObject({ kind: 'covered', cover: `container ${JSON.stringify({ x: 66, y: 1840, width: 948, height: 248 })}` });
  });
});

describe('OverlaidEdge — a neighbour in the node\'s own scroll view counts only pinned at that scroll view\'s far edge', () => {
  /** A list 0,300 1080x1200; an inset row flush against a full-bleed section header with its title, listed after it — at the list's top (pinned, a sticky header, scroll-sticky-cut's shape) or mid-list (scrolling with it). */
  const list = (header: 'pinned' | 'mid-list') => {
    const [row, head, title] = header === 'pinned' ? ['[128,454][953,630]', '[0,300][1080,454]', '[400,344][681,410]'] : ['[128,800][953,976]', '[0,976][1080,1130]', '[400,1020][681,1086]'];
    return parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,300][1080,1500]">
    <node class="android.view.View" clickable="true" resource-id="row" bounds="${row}" />
    <node class="android.view.View" resource-id="header" bounds="${head}"><node class="android.widget.TextView" text="Section" bounds="${title}" /></node>
  </node>
</node></hierarchy>`);
  };
  it('pinned at the list\'s top (a sticky header): an overlay — `fully` is covered by it', () => {
    const t = list('pinned');
    expect(said(standing(t, byId(t, 'row'), FULLY))).toEqual({ kind: 'covered', cover: 'header', remedy: 'scroll' });
  });
  it('mid-list, the next section\'s header: scrolls with the row, no overlay — `fully` stops', () => {
    const t = list('mid-list');
    expect(said(standing(t, byId(t, 'row'), FULLY))).toEqual({ kind: 'reachable', at: { x: 541, y: 888 } });
  });
});

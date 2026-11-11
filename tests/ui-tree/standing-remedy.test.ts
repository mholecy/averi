import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { KeyboardLine } from '../../src/ui-tree/keyboard-position.js';
import { sceneOf, type PixelPurpose, type PixelStanding, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { node } from '../helpers/fake.js';
import { IPHONE_17, usableOf } from '../helpers/pixels.js';

/**
 * THE REMEDY (ui-tree/standing.ts#Remedy, its PRECEDENCE, decided once by `remedied`) per kind and purpose, on the
 * smallest trees that make each case: the kind a standing names and the remedy it carries, which the tap, the pixel
 * assert and `scroll_until` each word. What the measured trees say of the same cases end to end:
 * tests/interact/remedy-agreement.test.ts, tests/ui-tree/overlaid-edge.test.ts; the presented case first:
 * tests/ui-tree/standing.test.ts ("the presented remedy's cover").
 */

const box = (width: number, height: number, y = 0): Rect => ({ x: 0, y, width, height });
/** A 400x800 screen with no system band read, and one with a status band to 40 and a navigation band from 760. */
const PLAIN_SCREEN = usableOf(box(400, 800));
const BANDS: UsableScreen = { ...PLAIN_SCREEN, statusBand: 40, navigationBand: 760 };
const idb = (y: number): KeyboardLine => ({ y, witnessed: false });
const TAP = { of: 'tap' } as const;
const PLAIN = { of: 'stop' } as const;
const FULLY = { of: 'fully' } as const;
// `_n` unused: it keeps standing.test.ts's OCR signature.
const OCR = (_n?: UiNode, keyboardTop?: KeyboardLine): PixelPurpose => ({ of: 'pixel', reads: (r) => r, glyphs: true, ...(keyboardTop !== undefined && { keyboardTop }) });
const COLOUR: PixelPurpose = { of: 'pixel', reads: colorSampleRect, glyphs: false };

/** A nested tree (draw-order.ts#listsAncestry): `inScroller` is told for every node. */
const root = (...children: UiNode[]): UiNode => node({ role: 'container', rect: box(400, 800), children });
/** A scroll view (geometry.ts#Clips.inScroller: it clips its descendants). */
const list = (rect: Rect, ...children: UiNode[]): UiNode => node({ role: 'container', identifier: 'list', clipsDescendants: true, rect, children });
const el = (identifier: string, rect: Rect, role = 'button'): UiNode => node({ role, identifier, rect });

/** A standing's kind and its remedy, as one plain value. */
const kindAndRemedy = (s: Standing | PixelStanding): unknown => (s.kind === 'reachable' ? { kind: s.kind } : { kind: s.kind, remedy: s.remedy });
const standing = (tree: UiNode, target: UiNode, at: UsableScreen, purpose: Purpose) => kindAndRemedy(sceneOf(tree).standing(target, at, purpose));

describe('THE REMEDY, per kind — the touch purposes (the tap, the plain stop, the `fully` stop)', () => {
  it('under a keyboard line no guard acts on (idb\'s band): hide the keyboard — the tap, the plain stop and the pixel assert alike', () => {
    const a = el('a', { x: 50, y: 650, width: 100, height: 40 });
    const t = root(a);
    for (const purpose of [{ of: 'tap', keyboardTop: idb(600) }, { of: 'stop', keyboardTop: idb(600) }, OCR(undefined, idb(600))] as const) {
      expect(standing(t, a, PLAIN_SCREEN, purpose)).toEqual({ kind: 'underKeyboard', remedy: { of: 'keyboard' } });
    }
  });

  it('a system bar over a node in a scroll view: a scroll moves it out; in none, `pinned` — no scroll does', () => {
    const inList = el('a', { x: 50, y: 0, width: 100, height: 30 });
    expect(standing(root(list(box(400, 800), inList)), inList, BANDS, PLAIN)).toEqual({ kind: 'systemBar', remedy: { of: 'scroll' } });
    const alone = el('a', { x: 50, y: 0, width: 100, height: 30 });
    expect(standing(root(alone), alone, BANDS, PLAIN)).toEqual({ kind: 'systemBar', remedy: { of: 'pinned' } });
    expect(standing(root(alone), alone, BANDS, TAP)).toEqual({ kind: 'systemBar', remedy: { of: 'pinned' } });
  });

  it('clipped (a `fully` stop): a scroll, whatever lies around it — in no scroll view too, clipped at the screen\'s edge', () => {
    const a = el('a', { x: 50, y: 750, width: 100, height: 100 });
    expect(standing(root(a), a, PLAIN_SCREEN, FULLY)).toEqual({ kind: 'clipped', remedy: { of: 'scroll' } });
    const b = el('b', { x: 50, y: 450, width: 100, height: 100 });
    expect(standing(root(list({ x: 20, y: 100, width: 360, height: 400 }, b)), b, PLAIN_SCREEN, FULLY)).toEqual({ kind: 'clipped', remedy: { of: 'scroll' } });
  });
});

describe('THE REMEDY, per kind — the pixel assert, which judges a region', () => {
  it('under a system bar in a scroll view: `stuck` when laid from the box\'s top edge under the status bar (a pinned header\'s place), else a scroll', () => {
    const inList = (rect: Rect, at: UsableScreen) => {
      const a = el('a', rect);
      return standing(root(list(box(400, 800), a)), a, at, OCR());
    };
    expect(inList({ x: 50, y: 0, width: 100, height: 30 }, BANDS)).toEqual({ kind: 'systemBar', remedy: { of: 'stuck' } });
    expect(inList({ x: 50, y: 10, width: 100, height: 30 }, BANDS)).toEqual({ kind: 'systemBar', remedy: { of: 'scroll' } });
    // Under the navigation bar alone, laid from the box's top edge: the status bar's rule only — a scroll.
    expect(inList({ x: 50, y: 0, width: 100, height: 800 }, { ...PLAIN_SCREEN, navigationBand: 760 })).toEqual({ kind: 'systemBar', remedy: { of: 'scroll' } });
  });

  it('under a system bar in no scroll view: `pinned`, or `fixed` for content no scroll lifts out of a band — the screen itself, a full-bleed header, a full-bleed footer', () => {
    const pixel = (rect: Rect, at = BANDS) => {
      const a = el('a', rect, 'container');
      return standing(root(a), a, at, OCR());
    };
    expect(pixel({ x: 50, y: 0, width: 100, height: 30 })).toEqual({ kind: 'systemBar', remedy: { of: 'pinned' } });
    expect(pixel({ x: 0, y: 0, width: 400, height: 800 })).toEqual({ kind: 'systemBar', remedy: { of: 'fixed', what: 'screen' } });
    expect(pixel({ x: 0, y: 0, width: 400, height: 100 })).toEqual({ kind: 'systemBar', remedy: { of: 'fixed', what: 'header' } });
    expect(pixel({ x: 0, y: 700, width: 400, height: 100 })).toEqual({ kind: 'systemBar', remedy: { of: 'fixed', what: 'footer' } });
    // Full-bleed means both sides: inset at the left or short of the right, at the top or the bottom, it is pinned.
    for (const rect of [{ x: 10, y: 0, width: 390, height: 100 }, { x: 0, y: 0, width: 300, height: 100 }, { x: 10, y: 700, width: 390, height: 100 }, { x: 0, y: 700, width: 300, height: 100 }]) {
      expect([rect, pixel(rect)]).toEqual([rect, { kind: 'systemBar', remedy: { of: 'pinned' } }]);
    }
  });

  it('under a system bar in a scroll view, the screen itself is `fixed` only when taller than the room between the bands (720 here)', () => {
    const tall = (height: number) => {
      const a = el('a', { x: 0, y: 30, width: 400, height }, 'container');
      return standing(root(list(box(400, 800), a)), a, BANDS, OCR());
    };
    expect(tall(721)).toEqual({ kind: 'systemBar', remedy: { of: 'fixed', what: 'screen' } });
    expect(tall(720)).toEqual({ kind: 'systemBar', remedy: { of: 'scroll' } });
  });

  it('covered: `fixed` for the screen itself (at least 90 % of the box) and a full-bleed header; else, neither in a scroll view, `bothPinned`', () => {
    const covered = (rect: Rect) => {
      const a = el('a', rect, 'container');
      const over = el('over', { x: 100, y: rect.y + 20, width: 100, height: 40 });
      return standing(root(a, over), a, PLAIN_SCREEN, OCR());
    };
    expect(covered({ x: 0, y: 0, width: 400, height: 800 })).toEqual({ kind: 'covered', remedy: { of: 'fixed', what: 'screen' } });
    // Exactly 90 % of the box, not at its top: the screen still.
    expect(covered({ x: 0, y: 80, width: 400, height: 720 })).toEqual({ kind: 'covered', remedy: { of: 'fixed', what: 'screen' } });
    expect(covered({ x: 0, y: 0, width: 400, height: 100 })).toEqual({ kind: 'covered', remedy: { of: 'fixed', what: 'header' } });
    // A26: the no-scroll remedy carries what the element is pinned under — here its cover's node.
    expect(covered({ x: 50, y: 0, width: 100, height: 100 })).toEqual({ kind: 'covered', remedy: { of: 'bothPinned', under: expect.objectContaining({ identifier: 'over' }) } });
  });

  it('covered: idb\'s flat-list root under the content listed on it is `fixed` as the root', async () => {
    const t = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
    const rootNode = [...everyNode(t)].find((n) => n.label === 'Skeleton Internal')!;
    expect(kindAndRemedy(sceneOf(t).standing(rootNode, IPHONE_17, COLOUR))).toEqual({ kind: 'covered', remedy: { of: 'fixed', what: 'root' } });
  });
});

describe('THE REMEDY — none on a reachable standing', () => {
  it('a reachable node carries no remedy, for every purpose — a node beneath a presented screen too, laid clear of it (an undimmed partial sheet)', () => {
    const full = (children: UiNode[]): UiNode => node({ role: 'container', rect: box(402, 874), children });
    const row = el('row', { x: 24, y: 200, width: 354, height: 52 });
    const sheet = node({ role: 'scrollable', rect: { x: 0, y: 500, width: 402, height: 374 }, children: [el('opt', { x: 20, y: 520, width: 362, height: 50 })] });
    const t = full([full([full([node({ role: 'scrollable', rect: box(402, 874), children: [row] })]), full([sheet])])]);
    const scene = sceneOf(t);
    // The draw order judges a presented screen over it, of the node itself.
    expect(scene.order.presentedOver(row)).toBeDefined();
    for (const purpose of [TAP, PLAIN, FULLY, OCR()]) {
      const s = scene.standing(row, IPHONE_17, purpose);
      expect([purpose.of, s.kind, 'remedy' in s]).toEqual([purpose.of, 'reachable', false]);
    }
  });
});

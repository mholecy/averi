import { readdir, readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { measuredFrameFor } from '../../src/verify/capture.js';
import { apartOfFrame } from '../../src/verify/eyes.js';
import { Verifier } from '../../src/verify/assert.js';
import { FakeAdapter } from '../helpers/fake.js';

/**
 * THE EYES' THIRD QUESTION (verify/eyes.ts#apartOfFrame): does the colour assert's region read as the screen beside it?
 * Asked only of an element whose tree cannot tell where it is drawn (ui-tree/geometry.ts#DrawnUntold: idb's flat list,
 * which lists no scroll view), on the frame the assert captures anyway. Over the lab's real iOS 27 captures (402x874 pt,
 * the png 1206x2622): `scroll-bounded`'s O lies wholly below its scroll view `lower` (`0,380 402x180`), the white
 * background drawn where idb lists it; `carousel-in-list`'s C lies right of its carousel, the page's #EEEEEE there.
 * docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
 */

const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const idbTree = async (cell: string): Promise<UiNode> => parseIdbDescribeAll(await readFile(new URL(`${cell}.idb.json`, IOS), 'utf8'));
const pngOf = async (cell: string) => PNG.sync.read(await readFile(new URL(`${cell}.png`, IOS)));
/** The simulator's screen, as the capture witnesses it (verify/capture.ts#witnessScreen): idb's tree surfaces no window rect. */
const SCREEN = { width: 402, height: 874 };
const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;
/** The question as the colour assert asks it: THE region its sampler reads (ui-tree/standing.ts#Scene.pixelRegion), on the capture. */
const seenOf = async (cell: string, target: string) => {
  const tree = await idbTree(cell);
  const node = byId(tree, `lab.${cell}.${target}`);
  return apartOfFrame(measuredFrameFor(tree, await pngOf(cell), SCREEN), sceneOf(tree).pixelRegion(node, undefined));
};

describe('apartOfFrame — the region against the screen beside it, on one frame', () => {
  it('scroll-bounded O, below its scroll view: its region all #FFFFFF, as the screen around it — blends', async () => {
    expect(await seenOf('scroll-bounded', 'O')).toEqual({ seen: 'blends', colour: '#FFFFFF' });
  });

  it("carousel-in-list C, right of its carousel: the strip of it on the screen #EEEEEE, the page's colour above and below it — blends", async () => {
    expect(await seenOf('carousel-in-list', 'C')).toEqual({ seen: 'blends', colour: '#EEEEEE' });
  });

  it("scroll-bounded W, drawn in `upper`: its own red against the scroll view's grey — apart", async () => {
    expect(await seenOf('scroll-bounded', 'W')).toEqual({ seen: 'apart' });
  });

  it("a frame whose scale the tree refuses — carousel-in-list's idb tree with no screen witnessed, its widest rect a content width: untold, said why", async () => {
    const tree = await idbTree('carousel-in-list');
    const seen = apartOfFrame(measuredFrameFor(tree, await pngOf('carousel-in-list')), byId(tree, 'lab.carousel-in-list.C').rect);
    expect(seen).toMatchObject({ seen: 'untold', why: expect.stringContaining('could not be scaled to the tree: screen width 402 is a CONTENT width') });
  });

  it('a no-op where the element is drawn: over every lab capture, every node idb lists reads apart from the screen beside it (its label, placeholder or border its own) — but the two lying outside their scroll views, nothing of them drawn', async () => {
    const cells = (await readdir(IOS)).filter((f) => f.endsWith('.idb.json')).map((f) => f.replace('.idb.json', '')).sort();
    expect(cells.length).toBeGreaterThanOrEqual(32);
    const blends: string[] = [];
    for (const cell of cells) {
      const tree = await idbTree(cell);
      const frame = measuredFrameFor(tree, await pngOf(cell), SCREEN);
      const scene = sceneOf(tree);
      for (const n of everyNode(tree)) {
        if (n === tree) continue;
        if (apartOfFrame(frame, scene.pixelRegion(n, undefined)).seen === 'blends') blends.push(n.identifier ?? `${cell}: ${n.label ?? n.role}`);
      }
    }
    expect(blends).toEqual(['lab.carousel-in-list.C', 'lab.scroll-bounded.O']);
  });
});

/**
 * Nothing of its own is a COUNT of pixels, not a share of the region (verify/eyes.ts#OWN_PIXELS_MAX): a wide row with a
 * short label holds a small share of label, yet hundreds of pixels of it. A white screen 1206x2622 (scale 3) with one
 * dark mark drawn into a white element on it.
 */
describe('apartOfFrame — a small mark of its own on a large element is its own', () => {
  const tree = async () => idbTree('sheet-long-list');
  const white = (): PNG => {
    const png = new PNG({ width: 1206, height: 2622 });
    png.data.fill(255);
    return png;
  };
  const mark = (png: PNG, x0: number, y0: number, w: number, h: number): PNG => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) png.data.fill(0, (y * png.width + x) * 4, (y * png.width + x) * 4 + 3);
    return png;
  };
  const seen = async (png: PNG, rect: { x: number; y: number; width: number; height: number }) => apartOfFrame(measuredFrameFor(await tree(), png, SCREEN), rect);

  it('a full-width 402x100 row, a "Row 7"-sized label (51x33 px): apart', async () => {
    expect(await seen(mark(white(), 60, 960, 51, 33), { x: 0, y: 300, width: 402, height: 100 })).toEqual({ seen: 'apart' });
  });

  it('a 300x120 card, a chevron (15x20 px, 300 px): apart', async () => {
    expect(await seen(mark(white(), 950, 1000, 15, 20), { x: 51, y: 300, width: 300, height: 120 })).toEqual({ seen: 'apart' });
  });

  it('the same card with nothing but one point of stray pixels (3x3 px): blends — nothing of its own', async () => {
    expect(await seen(mark(white(), 950, 1000, 3, 3), { x: 51, y: 300, width: 300, height: 120 })).toEqual({ seen: 'blends', colour: '#FFFFFF' });
  });
});

// The colour assert asks it of the frame it measures (verify/pixel-poll.ts#pollPixels): no capture added.
describe('the colour assert under idb — a region that reads as the screen beside it fails closed', () => {
  const assertOn = async (cell: string, target: string, expected: string, timeoutMs = 600) => {
    const tree = await idbTree(cell);
    const fake = new FakeAdapter({ screen: tree }, 'screen');
    fake.viewportSize = { width: 402, height: 874 };
    fake.nextScreenshot = await readFile(new URL(`${cell}.png`, IOS));
    let reads = 0;
    fake.uiTree = async () => {
      reads++;
      return structuredClone(tree);
    };
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs }).assert({ element: { id: `lab.${cell}.${target}` }, color: { expected } });
    return { result, captures: fake.screenshots.length, reads };
  };

  it('scroll-bounded O asked #FFFFFF: fails closed, naming what it read and the remedy — two captures a round, as any measured round', async () => {
    const o = await assertOn('scroll-bounded', 'O', '#FFFFFF');
    expect(o.result.pass).toBe(false);
    expect(o.result.detail).toContain(
      "its region reads as the screen beside it (#FFFFFF): idb lists no scroll view to say it is drawn there — it may lie outside one; measure it under treeSource: wda; failing closed, color unchecked",
    );
    expect(o.captures).toBe(2 * o.reads);
  });

  it('carousel-in-list C asked #EEEEEE: fails closed', async () => {
    const c = await assertOn('carousel-in-list', 'C', '#EEEEEE');
    expect(c.result).toMatchObject({ pass: false, detail: expect.stringContaining('its region reads as the screen beside it (#EEEEEE)') });
  });

  it('scroll-bounded O asked under ocr: not asked — a region of one colour holds no glyphs, and the ocr assert fails on what it reads', async () => {
    const tree = await idbTree('scroll-bounded');
    const fake = new FakeAdapter({ screen: tree }, 'screen');
    fake.viewportSize = { width: 402, height: 874 };
    fake.nextScreenshot = await readFile(new URL('scroll-bounded.png', IOS));
    const engine = { recognize: async (_png: Buffer, regions: { id: string }[]) => regions.map((r) => ({ id: r.id, lines: [] })) };
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs: 300, ocr: { engine } }).assert({ element: { id: 'lab.scroll-bounded.O' }, ocr: { text: 'Target O' } });
    expect(result.pass).toBe(false);
    expect(result.detail).not.toContain('reads as the screen beside it');
  });

  it('scroll-bounded O on frames settled over its region only (the screen elsewhere changing): asked too — fails closed, as on a still screen, not measured on the background', async () => {
    const tree = await idbTree('scroll-bounded');
    const fake = new FakeAdapter({ screen: tree }, 'screen');
    fake.viewportSize = { width: 402, height: 874 };
    const still = PNG.sync.read(await readFile(new URL('scroll-bounded.png', IOS)));
    let shots = 0;
    fake.screenshot = async () => {
      // A pixel of the status band, far from O, differs on every capture: only O's region holds still.
      still.data[0] = shots++ % 2 === 0 ? 0 : 255;
      return PNG.sync.write(still);
    };
    // Two rounds at least (a region-settled frame measures only at a rect two reads agree on), each encoding pngs.
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs: 3000 }).assert({ element: { id: 'lab.scroll-bounded.O' }, color: { expected: '#FFFFFF' } });
    expect(result).toMatchObject({ pass: false, detail: expect.stringContaining('its region reads as the screen beside it (#FFFFFF)') });
  }, 20_000);

  it('scroll-bounded W asked its own red: passes in one round, the settled pair', async () => {
    const w = await assertOn('scroll-bounded', 'W', '#E53935');
    expect(w.result).toMatchObject({ pass: true, detail: expect.stringContaining('sampled #E53935') });
    expect(w.captures).toBe(2);
  });
});

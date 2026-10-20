import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { screenOf } from '../../src/ui-tree/geometry.js';
import { sceneOf, type PixelPurpose, type Standing, type PixelStanding } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { coverNodes, tagged } from '../helpers/covers.js';
import { node } from '../helpers/fake.js';

/**
 * A HEADING LISTED BEFORE: in a listing given in reading order (`UiNode.readingOrder`), a sibling the source marks an
 * accessibility heading (`UiNode.heading`: the Header trait), listed before a target it overlaps past the slack, is
 * drawn over it — SwiftUI's pinned section header, listed before the rows it is pinned over (the lab's scroll-sticky:
 * header `0,110 402x56`, R `51,142 300x64` scrolled 24 pt under it, 62.5 % of R drawn).
 * docs/bugs/2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md
 * docs/adr/0015-flat-list-reading-order-break.md ("a heading listed before")
 */
const box = { x: 0, y: 0, width: 402, height: 874 };
const IPHONE: UsableScreen = { box, boxes: [box], statusBand: 62, oriented: box, from: 'device' };
const truth = async (name: string) => readFile(new URL(`../fixtures/truth/ios-iphone17-ios27/${name}`, import.meta.url), 'utf8');
const idb = async (name: string) => parseIdbDescribeAll(await truth(name));
const wda = async (name: string) => parseWdaSource(await truth(name));
const COLOUR: PixelPurpose = { of: 'pixel', reads: colorSampleRect, glyphs: false };
const remedyOf = (s: Standing | PixelStanding): string | undefined => (s.kind === 'reachable' ? undefined : s.remedy.of);
const byId = (tree: UiNode, id: string) => [...everyNode(tree)].find((n) => n.identifier === id)!;
const STICKY = [
  ['idb', () => idb('scroll-sticky.idb.json')],
  ['WDA', () => wda('scroll-sticky.wda.json')],
] as const;

describe('the parsers keep the Header trait as UiNode.heading', () => {
  it.each(STICKY)('%s: the pinned section header is a heading, R is not', async (_n, tree) => {
    const t = await tree();
    expect(byId(t, 'lab.scroll-sticky.header').heading).toBe(true);
    expect(byId(t, 'lab.scroll-sticky.R').heading).toBeUndefined();
  });

  it("idb: the TRAIT, not idb's type — mp-native's trimmed value-date picker, typed Heading with no traits, is no heading", async () => {
    const modal = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')) as { screens: Record<string, unknown[]> };
    const t = parseIdbDescribeAll(JSON.stringify(modal.screens.valueDatePicker));
    expect(byId(t, 'swift_payment.form.value_date_picker').heading).toBeUndefined();
  });
});

describe('a heading listed before a target it overlaps, in a reading-order listing, is drawn over it', () => {
  it.each(STICKY)("%s: R's top 24 pt lie under the header — a cover drawn over it, 62.5 % shows, the tap still on its clear centre", async (_n, tree) => {
    const t = await tree();
    const header = byId(t, 'lab.scroll-sticky.header');
    const seen = drawOrder(t).exposure(byId(t, 'lab.scroll-sticky.R'), box);
    expect(tagged(seen.covers)).toEqual([{ node: header, order: 'drawn', presented: false }]);
    expect(seen.shows).toBeCloseTo(0.625, 3);
    expect(seen.tapAt).toEqual({ point: { x: 201, y: 174 }, moved: false });
  });

  it.each(STICKY)('%s: it hides pixels of R — the colour assert reads it as drawn over the element', async (_n, tree) => {
    const t = await tree();
    expect(coverNodes(drawOrder(t).paintsOver(byId(t, 'lab.scroll-sticky.R'), box))).toEqual([byId(t, 'lab.scroll-sticky.header')]);
    const s = sceneOf(t).standing(byId(t, 'lab.scroll-sticky.R'), IPHONE, COLOUR);
    expect(s.kind).toBe('covered');
    expect(s.kind === 'covered' && s.cover.node).toBe(byId(t, 'lab.scroll-sticky.header'));
  });

  it.each(STICKY)('%s: `fully: true` does not stop on R where it is: covered by the header', async (_n, tree) => {
    const t = await tree();
    const s = sceneOf(t).standing(byId(t, 'lab.scroll-sticky.R'), IPHONE, { of: 'fully' });
    expect(s.kind).toBe('covered');
    expect(s.kind === 'covered' && s.cover.node).toBe(byId(t, 'lab.scroll-sticky.header'));
    expect(remedyOf(s)).toBe('scroll');
  });

  const run = (children: UiNode[]): UiNode => node({ role: 'other', rect: { ...box }, children: [node({ role: 'other', rect: { ...box }, readingOrder: true, children })] });
  const heading = (y: number, height = 56): UiNode => node({ role: 'text', label: 'Section', heading: true, rect: { x: 0, y, width: 402, height } });
  const row = (y: number): UiNode => node({ role: 'button', label: 'Row', rect: { x: 51, y, width: 300, height: 64 } });

  it('a heading holding the target whole is no cover of it: its own content (a button inside a section title band)', () => {
    const h = heading(100, 120);
    const r = row(120);
    expect(drawOrder(run([h, r])).exposure(r, box).covers).toEqual([]);
  });

  it('a heading listed AFTER the target is judged as before: by the draw order', () => {
    const r = row(142);
    const h = heading(110);
    expect(tagged(drawOrder(run([r, h])).exposure(r, box).covers)).toEqual([{ node: h, order: 'drawn', presented: false }]);
    expect(drawOrder(run([r, h])).exposure(h, box).covers).toEqual([]);
  });

  it('an interactive heading holding a control target\'s centre is judged as a heading, not as a control peer: one cover, drawn', () => {
    const h = node({ role: 'button', label: 'Section', heading: true, rect: { x: 0, y: 110, width: 402, height: 70 } }); // down to 180: over R's centre (174)
    const r = row(142);
    const seen = drawOrder(run([h, r])).exposure(r, box);
    expect(tagged(seen.covers)).toEqual([{ node: h, order: 'drawn', presented: false }]);
    expect(seen.aimedClearOf).toEqual([]);
  });

  it('a target pinned at the screen\'s bottom keeps its place on top of a heading listed before it', () => {
    const h = heading(780, 60);
    const bar = node({ role: 'button', label: 'Continue', rect: { x: 0, y: 800, width: 402, height: 74 } });
    expect(drawOrder(run([h, bar])).exposure(bar, box).covers).toEqual([]);
  });

  it('a listing NOT given in reading order keeps its order as draw order: a heading listed before is beneath', () => {
    const h = heading(110);
    const r = row(142);
    const t = node({ role: 'other', rect: { ...box }, children: [node({ role: 'other', rect: { ...box }, children: [h, r] })] });
    expect(drawOrder(t).exposure(r, box).covers).toEqual([]);
  });
});

describe('the rule over every iOS tree of tests/fixtures: only the scroll-sticky R gains a heading as its cover', () => {
  /** Every iOS tree a fixture holds, as its parser reads it — the idb lists (one array, an `elements` one, or a `screens` or `positions` map of them) and the WDA sources; an idb fixture of no known shape fails the test, not skipped. */
  const iosTrees = async (): Promise<[string, UiNode][]> => {
    const trees: [string, UiNode][] = [];
    const dirs = [new URL('../fixtures/', import.meta.url), new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url), new URL('../fixtures/truth/ios-rn-iphone17-ios27/', import.meta.url)];
    for (const dir of dirs) {
      // `*-ui-snapshot-*`: averi's own snapshot (UiNode), no source's tree — nothing of it to parse
      for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('-ui-snapshot-'))) {
        const text = await readFile(new URL(file, dir), 'utf8');
        if (file.startsWith('idb-') || file.endsWith('.idb.json')) {
          const json = JSON.parse(text) as unknown;
          const shaped = json as { screens?: Record<string, unknown[]>; positions?: Record<string, unknown[]>; elements?: unknown[] };
          const lists = Array.isArray(json) ? [json] : [...Object.values(shaped.screens ?? shaped.positions ?? {}), ...(shaped.elements ? [shaped.elements] : [])];
          if (lists.length === 0) throw new Error(`${file}: an idb fixture of no known shape`);
          lists.forEach((list, i) => trees.push([`${file}#${i}`, parseIdbDescribeAll(JSON.stringify(list))]));
        } else if (file.startsWith('wda-') || file.endsWith('.wda.json')) {
          trees.push([file, parseWdaSource(text)]);
        }
      }
    }
    return trees;
  };
  const withoutHeadings = (n: UiNode): UiNode => {
    const { heading: _h, children, ...rest } = n;
    return { ...rest, children: children.map(withoutHeadings) };
  };

  it('every target whose covers change with the headings marked is R, under the header', async () => {
    const gained: string[] = [];
    let judged = 0;
    for (const [file, tree] of await iosTrees()) {
      const bare = withoutHeadings(tree);
      const marked = drawOrder(tree);
      const unmarked = drawOrder(bare);
      const bareNodes = [...everyNode(bare)];
      // idb's root is rectless: the screen is its elements' extent.
      const screen = screenOf(tree);
      [...everyNode(tree)].forEach((n, i) => {
        judged++;
        const a = coverNodes(marked.exposure(n, screen).covers).map((c) => c.identifier ?? c.label);
        const b = coverNodes(unmarked.exposure(bareNodes[i], screen).covers).map((c) => c.identifier ?? c.label);
        if (JSON.stringify(a) !== JSON.stringify(b)) gained.push(`${file}: ${n.identifier ?? n.label} under ${a.join(', ')}`);
      });
    }
    expect(judged).toBeGreaterThan(1000);
    expect(gained).toEqual(['scroll-sticky.idb.json#0: lab.scroll-sticky.R under lab.scroll-sticky.header', 'scroll-sticky.wda.json: lab.scroll-sticky.R under lab.scroll-sticky.header']);
  });
});

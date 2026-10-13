import { describe, expect, it } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import type { ScreenSize } from '../../src/ui-tree/geometry.js';
import { treeScreen, usableScreen, usableScreenOf } from '../../src/ui-tree/usable-screen.js';
import { el, FakeAdapter, node, screen } from '../helpers/fake.js';

/** A fake whose tree is `root` and whose device reports `viewport` (or throws it, as a failed `wm size` would). */
function device(root: UiNode, viewport: DeviceScreen | Error): FakeAdapter {
  const fake = new FakeAdapter({ s: root }, 's');
  if (viewport instanceof Error) {
    fake.viewport = async () => {
      throw viewport;
    };
  } else {
    fake.viewportSize = viewport;
  }
  return fake;
}

/** The usable screen of `fake`'s tree as it reads now. */
const usableOf = async (fake: FakeAdapter) => usableScreen(fake, { tree: await fake.uiTree() });

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });

/** The one derivation, pure: the device as built or turned, a window the tree vouches for, or nothing. */
describe('usableScreenOf — the device, turned as the window says; else a window the tree vouches for; else nothing', () => {
  const size = (width: number, height: number, reliable: boolean, trustworthyHeight: boolean): ScreenSize => ({ width, height, reliable, trustworthyHeight });
  const PORTRAIT = { width: 1080, height: 2220 };
  it.each([
    ['device usable, the window portrait: as built', PORTRAIT, size(1080, 2220, true, true), { from: 'device', oriented: box(1080, 2220) }],
    ['device usable, the window landscape: turned', PORTRAIT, size(2220, 1080, true, true), { from: 'device', oriented: box(2220, 1080) }],
    ['device usable, no tree: as built', PORTRAIT, undefined, { from: 'device', oriented: box(1080, 2220) }],
    ['device unusable (0x0), a window vouched for: the window', { width: 0, height: 0 }, size(402, 874, true, true), { from: 'window', oriented: box(402, 874) }],
    ['no device, a window vouched for: the window', undefined, size(402, 874, true, true), { from: 'window', oriented: box(402, 874) }],
    ['no device, a walked height (not a window\'s): nothing', undefined, size(402, 1300, true, false), undefined],
    ['no device, an unreliable window: nothing', undefined, size(402, 874, false, true), undefined],
    ['no device, no geometry: nothing', undefined, size(0, 0, true, true), undefined],
    ['neither device nor tree: nothing', undefined, undefined, undefined],
  ] as const)('%s', (_name, dev, tree, expected) => {
    const got = usableScreenOf(dev, tree);
    if (expected === undefined) return expect(got).toBeUndefined();
    expect(got).toMatchObject(expected);
  });
});

describe('usableScreen — the oriented box: the device screen, turned only when a window says so', () => {
  it('the DEVICE size, not the tree root, when the two differ (an Android window short of the nav bar) — judged on the panel as built', async () => {
    const got = await usableOf(device(node({ rect: box(1080, 2274) }), { width: 1080, height: 2400 }));
    expect(got).toEqual({ box: box(1080, 2400), boxes: [box(1080, 2400)], oriented: box(1080, 2400), from: 'device' });
  });

  it('turned when the window fits the screen only sideways (landscape on a panel reported as built) — and witnessed, one box', async () => {
    const got = await usableOf(device(node({ rect: box(2400, 1080) }), { width: 1080, height: 2400 }));
    expect(got).toEqual({ box: box(2400, 1080), boxes: [box(2400, 1080)], oriented: box(2400, 1080), from: 'device' });
  });

  it('not turned for a landscape-SHAPED window that fits the screen unturned (a top split-screen pane)', async () => {
    expect((await usableOf(device(node({ rect: box(1080, 1000) }), { width: 1080, height: 2400 })))?.oriented).toEqual(box(1080, 2400));
  });

  it('a tree that cannot be read: the device as built, from the device', async () => {
    const got = await usableScreen(device(screen(), { width: 1000, height: 2000 }), { error: new Error('uiautomator dump returned no XML') });
    expect(got).toMatchObject({ oriented: box(1000, 2000), boxes: [box(1000, 2000)], from: 'device' });
  });

  it('an Android landscape window beside a LEFT nav bar or cutout turns it — with and without a status bar above it', async () => {
    for (const rect of [
      { x: 126, y: 0, width: 2274, height: 1080 },
      { x: 126, y: 63, width: 2274, height: 1017 },
    ]) {
      expect((await usableOf(device(node({ rect }), { width: 1080, height: 2400, windowsBesideSystemBars: true })))?.oriented).toEqual(box(2400, 1080));
    }
  });

  it('an inset window whose REACH runs past the turned panel witnesses nothing — its left edge counts', async () => {
    const fake = device(node({ rect: { x: 300, y: 0, width: 2274, height: 1080 } }), { width: 1080, height: 2400, windowsBesideSystemBars: true });
    expect((await usableOf(fake))?.oriented).toEqual(box(1080, 2400));
  });

  it('an inset rect in an iOS tree is content, never a window: it turns nothing', async () => {
    expect((await usableOf(device(node({ rect: { x: 126, y: 0, width: 2274, height: 1080 } }), { width: 1080, height: 2400 })))?.oriented).toEqual(box(1080, 2400));
  });

  it('a WALKED height never votes: a landscape tree whose rows run to y=3000 still turns the panel, by its width — both ways up judged', async () => {
    const rows = node({ rect: box(0, 0), children: [node({ rect: { x: 0, y: 100, width: 852, height: 44 } }), node({ rect: { x: 0, y: 2956, width: 852, height: 44 } })] });
    const got = await usableOf(device(rows, { width: 393, height: 852 }));
    expect(got).toMatchObject({ oriented: box(852, 393), box: box(852, 393), boxes: [box(852, 393), box(393, 852)] });
  });

  it('a walked width that fits the panel as built does not turn it (the split-pane guard, by width), nor one that fits it neither way', async () => {
    const rows = node({ rect: box(0, 0), children: [node({ rect: { x: 0, y: 100, width: 393, height: 44 } }), node({ rect: { x: 0, y: 2956, width: 393, height: 44 } })] });
    expect((await usableOf(device(rows, { width: 393, height: 852 })))?.oriented).toEqual(box(393, 852));
    const wide = node({ rect: box(0, 0), children: [node({ rect: { x: 0, y: 100, width: 1800, height: 44 } })] });
    expect((await usableOf(device(wide, { width: 393, height: 852 })))?.oriented).toEqual(box(393, 852));
  });

  it('rounding slack: a landscape window 1% past the turned panel still turns it', async () => {
    expect((await usableOf(device(node({ rect: box(2424, 1091) }), { width: 1080, height: 2400 })))?.oriented).toEqual(box(2400, 1080));
  });

  it('a window too TALL for the turned panel does not turn it (1200x1200 on 1080x2400 fits neither way)', async () => {
    expect((await usableOf(device(node({ rect: box(1200, 1200) }), { width: 1080, height: 2400 })))?.oriented).toEqual(box(1080, 2400));
  });

  it('an unreliable tree is no orientation witness: a CONTENT extent that would fit the panel sideways does not turn it', async () => {
    const inset = node({ rect: box(0, 0), children: [node({ rect: { x: 50, y: 0, width: 2350, height: 1000 } })] });
    expect((await usableOf(device(inset, { width: 1080, height: 2400 })))?.oriented).toEqual(box(1080, 2400));
  });

  it('a banner at the origin crowned as an idb window turns the oriented box, but is no evidence for a judgement: judged on the panel as built', async () => {
    const tree = node({
      role: 'container',
      rect: box(0, 0),
      children: [node({ role: 'image', rect: box(500, 300) }), node({ role: 'button', rect: { x: 425, y: 400, width: 50, height: 40 } })],
    });
    expect(await usableOf(device(tree, { width: 402, height: 874 }))).toEqual({ box: box(402, 874), boxes: [box(402, 874)], oriented: box(874, 402), from: 'device' });
  });
});

describe('usableScreen — the boxes a point is judged in, by the window\'s own sides (moved from the tap\'s off-screen tests)', () => {
  /** idb's rectless root over `children`. */
  const idbRoot = (...children: UiNode[]) => node({ role: 'container', rect: box(0, 0), children });
  const PORTRAIT = { width: 402, height: 874 };
  const IPAD = { width: 820, height: 1180 };
  /** An idb landscape window `w` with a button at 700,100 and, `card`, a card straddling its right edge (the window then unreliable). */
  const landscape = (w: { width: number; height: number }, card = true) =>
    idbRoot(node({ role: 'other', rect: { x: 0, y: 0, ...w }, children: [node({ role: 'button', rect: { x: 700, y: 100, width: 100, height: 40 } }), ...(card ? [node({ role: 'other', rect: { x: 820, y: 50, width: 300, height: 200 } })] : [])] }));
  /** Rows walked to y 2950, `width` wide (no window: a walked width, not a window's). */
  const walked = (width: number) => idbRoot(...[0, 400, 800, 1200, 1600, 2000, 2400, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width, height: 50 } })));
  /** An iPad landscape window with a 2400-wide strip in it. */
  const ipad = (height: number) => idbRoot(node({ role: 'other', rect: { x: 0, y: 0, width: 1180, height }, children: [node({ role: 'other', rect: { x: 0, y: 600, width: 2400, height: 100 } })] }));
  it.each([
    // A turn suggested but witnessed by no window: the box either way up — the tap refuses only a point outside both.
    ['an idb landscape window a straddling card makes unreliable: either way up', landscape({ width: 874, height: 402 }), PORTRAIT, [box(402, 874), box(874, 402)]],
    ['an iPad landscape window 1180x820 with a 2400-wide strip: either way up', ipad(820), IPAD, [box(820, 1180), box(1180, 820)]],
    ['…20 pt short of the panel (1180x800): either way up', ipad(800), IPAD, [box(820, 1180), box(1180, 820)]],
    ['a walked width (852 on a 393x852 panel): turned, either way up', walked(852), { width: 393, height: 852 }, [box(852, 393), box(393, 852)]],
    // A landscape idb window a few percent short of the panel still says turned (TURNED_WIDTH_SLACK_PCT, 5 %).
    ['874x380, unreliable', landscape({ width: 874, height: 380 }), PORTRAIT, [box(402, 874), box(874, 402)]],
    ['874x380, reliable', landscape({ width: 874, height: 380 }, false), PORTRAIT, [box(874, 402), box(402, 874)]],
    ['874x390, unreliable', landscape({ width: 874, height: 390 }), PORTRAIT, [box(402, 874), box(874, 402)]],
    ['852x402 (2.5 % short), unreliable', landscape({ width: 852, height: 402 }), PORTRAIT, [box(402, 874), box(874, 402)]],
    // No turn suggested: the panel as built alone.
    ['a witnessed portrait window: the panel alone', node({ role: 'container', rect: box(402, 874), children: [node({ role: 'button', rect: { x: 450, y: 280, width: 100, height: 40 } })] }), PORTRAIT, [box(402, 874)]],
    ['a portrait idb window a straddling card makes unreliable: no turn', idbRoot(node({ role: 'other', rect: box(402, 874), children: [node({ role: 'other', rect: { x: 300, y: 80, width: 300, height: 200 } })] })), PORTRAIT, [box(402, 874)]],
    ['a window as wide as the turned panel but TALLER than its short side (874x874): nothing', idbRoot(node({ role: 'other', rect: box(874, 874) })), PORTRAIT, [box(402, 874)]],
    ['no window, a carousel walked to x 1500: the walk suggests nothing', idbRoot(...[0, 300, 600, 900, 1200].map((x) => node({ role: 'cell', rect: { x, y: 80, width: 300, height: 40 } })), ...[200, 400, 600, 800].map((y) => node({ role: 'text', rect: { x: 0, y, width: 402, height: 40 } }))), PORTRAIT, [box(402, 874)]],
    ['no window, a walk that happens to measure the panel turned (874x402): still nothing', idbRoot(node({ role: 'cell', rect: { x: 574, y: 80, width: 300, height: 40 } }), node({ role: 'text', rect: { x: 0, y: 362, width: 402, height: 40 } })), PORTRAIT, [box(402, 874)]],
    ['the stated LOSS: a landscape idb tree with no window and a straddling card — nothing says turned', idbRoot(...[0, 400, 800, 1600, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width: 874, height: 50 } })), node({ role: 'other', rect: { x: 820, y: 50, width: 300, height: 200 } })), PORTRAIT, [box(402, 874)]],
    ['an Android top split-screen pane (1080x1000 on 1080x2400): unturned', node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 1000 } }), { width: 1080, height: 2400 }, [box(1080, 2400)]],
    // A witnessed landscape window: the turned box alone.
    ['a WDA root 874x402 on a 402x874 panel: turned, witnessed', node({ role: 'container', rect: box(874, 402) }), PORTRAIT, [box(874, 402)]],
  ] as const)('%s', async (_name, tree, dev, boxes) => {
    expect((await usableOf(device(tree, dev)))?.boxes).toEqual(boxes);
  });
});

describe('usableScreen — the fallback window, and nothing', () => {
  it('an unreadable device size: a reliable tree window, from the window', async () => {
    const got = await usableOf(device(screen(el({ identifier: 'anything' })), new Error('Cannot parse wm size output: garbage')));
    expect(got).toEqual({ box: box(1000, 2000), boxes: [box(1000, 2000)], oriented: box(1000, 2000), from: 'window' });
  });

  it('a 0×0 device size: the WDA sheet\'s screen-shaped child window, not the off-layout scrim', async () => {
    const root = node({ rect: box(0, 0), children: [node({ rect: box(402, 874) }), node({ rect: { x: -402, y: -874, width: 1206, height: 2622 } })] });
    expect((await usableOf(device(root, { width: 0, height: 0 })))?.oriented).toEqual(box(402, 874));
  });

  it.each([
    ['a tree with no geometry and a 0x0 device', node({ rect: box(0, 0) }), { width: 0, height: 0 }],
    [
      "a walked tree (its height the lowest content edge) and no device",
      node({ rect: box(0, 0), children: [node({ rect: { x: 0, y: 100, width: 300, height: 50 } }), node({ rect: { x: 0, y: 750, width: 300, height: 50 } })] }),
      new Error('idb describe returned no screen_dimensions'),
    ],
    ['an unreliable tree (content starting inset) and a 0x0 device', node({ rect: box(0, 0), children: [node({ rect: { x: 50, y: 0, width: 300, height: 600 } })] }), { width: 0, height: 0 }],
  ] as const)('no usable screen: %s', async (_name, tree, dev) => {
    expect(await usableOf(device(tree, dev))).toBeUndefined();
  });

  it('no usable screen, failing open, when sizing the tree throws (a malformed tree): the judgements behave as with no box', async () => {
    const malformed = { ...node({ rect: box(0, 0) }), children: undefined } as unknown as UiNode;
    expect(await usableScreen(device(screen(), { width: 402, height: 874 }), { tree: malformed })).toBeUndefined();
  });

  it('no usable screen: neither the device nor the tree read', async () => {
    expect(await usableScreen(device(screen(), new Error('device offline')), { error: new Error('null root node') })).toBeUndefined();
  });
});

describe('usableScreen — the system bands, the device\'s only', () => {
  it('carries the device\'s status band and navigation band', async () => {
    const got = await usableScreen(device(screen(), { width: 1080, height: 2220, statusBand: 66, navigationBand: 2154 }), { tree: undefined });
    expect(got).toMatchObject({ statusBand: 66, navigationBand: 2154 });
  });

  it('none when the size could not be read and the tree\'s window stands in', async () => {
    const window = node({ role: 'container', rect: box(402, 874), children: [node({ role: 'other', rect: box(402, 874) })] });
    const got = await usableScreen(device(window, new Error('idb describe returned no screen_dimensions')), { tree: window });
    expect(got).toEqual({ box: box(402, 874), boxes: [box(402, 874)], oriented: box(402, 874), from: 'window' });
  });

  it('a landscape tree keeps the band as data — the cut is portrait only (geometry.ts#belowStatusBand)', async () => {
    const got = await usableOf(device(node({ rect: box(874, 402) }), { width: 402, height: 874, statusBand: 62 }));
    expect(got).toEqual({ box: box(874, 402), boxes: [box(874, 402)], oriented: box(874, 402), from: 'device', statusBand: 62 });
  });
});

describe('usableScreen — `fresh`: the device read again first (the tap\'s re-read before a refusal)', () => {
  /** A device whose size reads `sizes` in turn, a fresh read included, recording what each read asked. */
  const reads = (...sizes: (DeviceScreen | Error)[]) => {
    const asked: unknown[] = [];
    return {
      asked,
      viewport: async (opts?: { fresh?: boolean }) => {
        asked.push(opts);
        const next = sizes.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    };
  };
  it('fresh: a fresh read, then the plain one the usable screen is built from — the size the device says now', async () => {
    const device = reads({ width: 1080, height: 2220 }, { width: 1840, height: 2208 });
    expect((await usableScreen(device, { tree: undefined }, { fresh: true }))?.box).toEqual(box(1840, 2208));
    expect(device.asked).toEqual([{ fresh: true }, undefined]);
  });
  it('a fresh read that fails is passed over: the plain read is asked as ever', async () => {
    const device = reads(new Error('wm size timed out'), { width: 1080, height: 2220 });
    expect((await usableScreen(device, { tree: undefined }, { fresh: true }))?.box).toEqual(box(1080, 2220));
    expect(device.asked).toEqual([{ fresh: true }, undefined]);
  });
  it('without it: one plain read', async () => {
    const device = reads({ width: 1080, height: 2220 });
    await usableScreen(device, { tree: undefined });
    expect(device.asked).toEqual([undefined]);
  });
});

describe('treeScreen — THE "no device screen": the tree\'s own screen, no band, and whether a touch fails open', () => {
  it('a root with a rect is that rect; a touch judges in it', () => {
    expect(treeScreen(node({ rect: box(402, 874) }))).toEqual({ box: box(402, 874), boxes: [box(402, 874)], oriented: box(402, 874), from: 'tree', failsOpen: false });
  });
  it('a root of no area (idb\'s synthetic 0x0 root): the largest node is the box, and a touch fails open', () => {
    const tree = node({ rect: box(0, 0), children: [node({ rect: { x: 0, y: 100, width: 300, height: 50 } }), node({ rect: box(402, 874) })] });
    expect(treeScreen(tree)).toEqual({ box: box(402, 874), boxes: [box(402, 874)], oriented: box(402, 874), from: 'tree', failsOpen: true });
  });
});

import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { ScreenSize } from '../../src/ui-tree/geometry.js';
import { onScreen, sceneOf, treeScreen, usableScreen, usableScreenOf, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';
import { el, FakeAdapter, node, screen } from '../helpers/fake.js';
import { CLASSIC_VIEWS, SETTINGS_ROW_SLIVER } from '../helpers/synthetic-android-trees.js';

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

describe('treeScreen — the pixel assert\'s last resort: the tree\'s own screen, no band', () => {
  it('a root with a rect is that rect', () => {
    expect(treeScreen(node({ rect: box(402, 874) }))).toEqual({ box: box(402, 874), boxes: [box(402, 874)], oriented: box(402, 874), from: 'tree' });
  });
});

/** The first node of `tree`, in pre-order, with this identifier (or label). */
const byId = (tree: UiNode, id: string): UiNode => {
  const found = [...everyNode(tree)].find((n) => n.identifier === id || n.label === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

/** mp-native's SWIFT form under idb at rest: priority_select `24,771 354x52` under the pinned CONTINUE `24,780 354x44`. */
const swiftIdb = async (): Promise<UiNode> => parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));

/** The same form with priority_select moved to `y` — the rest of the tree as dumped. */
const swiftIdbAt = async (y: number): Promise<UiNode> => {
  const tree = await swiftIdb();
  const row = byId(tree, 'swift_payment.form.priority_select');
  (row as { rect: Rect }).rect = { ...row.rect, y };
  return tree;
};

/**
 * mp-native's SWIFT form on the Pixel_3a, as uiautomator dumps it: the form's
 * scroller `0,242 1080x1736`, the "Payment details" toggle cut to `66,1924
 * 948x55` at its bottom, the toggle's leaf label `66,1936 948x42` running
 * into the cut, CONTINUE below the form.
 */
const swiftAndroid = (depth = 55, covered = false) => `<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.widget.ScrollView" scrollable="true" resource-id="swift_payment.form" bounds="[0,242][1080,1978]">
    <node class="android.view.View" resource-id="swift_payment.form.details_toggle" bounds="[66,${1979 - depth}][1014,1979]">
      <node class="android.widget.TextView" text="Payment details" bounds="[66,${1991 - depth}][1014,1978]" />
    </node>
  </node>
  <node class="android.widget.Button" text="CONTINUE" resource-id="swift_payment.form.continue_button" bounds="[66,1979][1014,2111]" />${
    covered ? '\n  <node class="android.widget.Button" text="Help" resource-id="help" bounds="[400,1900][700,1978]" />' : ''
  }
</node>
</hierarchy>`;
const SWIFT_ANDROID = swiftAndroid();

/** A fixture of tests/fixtures, as its parser reads it. */
const fixture = async (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
/** An idb fixture whose elements sit at `path` in the file's JSON. */
const idbAt = async (name: string, ...path: string[]): Promise<UiNode> =>
  parseIdbDescribeAll(JSON.stringify(path.reduce<any>((j, k) => j[k], JSON.parse(await fixture(name)))));

const IPHONE = { box: box(402, 874), boxes: [box(402, 874)], statusBand: 62 };
const PIXEL = { box: box(1080, 2220), boxes: [box(1080, 2220)], statusBand: 66 };
const PLAIN = { of: 'stop', fully: false } as const;
const FULLY = { of: 'stop', fully: true } as const;

/** A standing's kind with the fact its sentence quotes, as one plain value. */
const said = (s: Standing): unknown => {
  switch (s.kind) {
    case 'reachable':
      return { kind: s.kind, at: s.at, ...(s.moved !== undefined && { moved: { piece: s.moved.piece, cover: s.moved.cover.identifier ?? s.moved.cover.label, aboveKeyboard: s.moved.aboveKeyboard } }) };
    case 'offScreen':
      return { kind: s.kind, at: s.at, visible: s.visible };
    case 'systemBar':
      return { kind: s.kind, at: s.at, bar: s.bar };
    case 'clipped':
      return { kind: s.kind, edges: s.edges };
    case 'cut':
      return { kind: s.kind, edge: s.cut.edge, depth: s.cut.depth, ...(s.cut.within !== undefined && { within: s.cut.within }) };
    case 'covered':
      return { kind: s.kind, cover: s.cover.identifier ?? s.cover.label, ...(s.largest !== undefined && { largest: s.largest }) };
    case 'underKeyboard':
      return { kind: s.kind, top: s.top };
  }
};

describe('Scene.standing for scroll_until\'s stop — measured cases, fixture × purpose → kind', () => {
  it.each([
    // The pinned-chrome bug note: the row at rest under CONTINUE — its centre (201,797) under the bar.
    ['idb SWIFT form, priority_select at rest under CONTINUE, plain', () => swiftIdb(), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    ['…fully: true', () => swiftIdb(), 'swift_payment.form.priority_select', IPHONE, FULLY, { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    // The centre decides a plain stop: clear of the bar at 740 (its bottom still under it) it stops; fully: true does not.
    ['…at 740, the centre clear of the bar, plain', () => swiftIdbAt(740), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 766 } }],
    ['…at 740, fully: true', () => swiftIdbAt(740), 'swift_payment.form.priority_select', IPHONE, FULLY, { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    // One stroke flung the row to 24,-20: its centre (201,6) in the 62-pt status band, where the tap pressed the status bar.
    ['…flung to -20, plain: the status band', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'systemBar', at: { x: 201, y: 6 }, bar: { edge: 'top', bottom: 62 } }],
    ['…flung to -20, fully: true: a cut edge leads', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, FULLY, { kind: 'clipped', edges: ['top'] }],
    // Its centre off the screen's bottom: no stop, whatever shows.
    ['…at 860, its centre below the screen, plain', () => swiftIdbAt(860), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'offScreen', at: { x: 201, y: 886 }, visible: 14 / 52 }],
    // The sliver bug note: the toggle cut to 55 px at the form's bottom, under the 65 a tap needs.
    ['Android SWIFT form, the toggle cut to 66,1924 948x55, plain: cut at the bottom', async () => parseDump(SWIFT_ANDROID), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 55 }],
    ['…fully: true: the flush probe is the stop\'s rule, not the cut', async () => parseDump(SWIFT_ANDROID), 'swift_payment.form.details_toggle', PIXEL, FULLY, { kind: 'reachable', at: { x: 540, y: 1952 } }],
    // The minimum piece is 65 on a 1080-wide screen: 64 deep is a sliver, 65 is not.
    ['…the toggle 64 deep: a sliver', async () => parseDump(swiftAndroid(64)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 64 }],
    ['…the toggle 65 deep: no sliver, a stop', async () => parseDump(swiftAndroid(65)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'reachable', at: { x: 540, y: 1947 } }],
    // Cut before cover (one precedence with the tap): a sliver with a button over its centre is cut at a named edge.
    ['…the toggle cut and a button over its centre, plain: cut, not covered', async () => parseDump(swiftAndroid(55, true)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 55 }],
    ['…its leaf label 66,1936 948x42: the toggle\'s cut, inherited', async () => parseDump(SWIFT_ANDROID), 'Payment details', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 42, within: { x: 66, y: 1924, width: 948, height: 55 } }],
    // A classic Settings row cut to 33 px at its list's top, its texts dumped inverted above the cut; the row below is whole.
    ['Settings row cut at its list\'s top, plain', async () => parseDump(SETTINGS_ROW_SLIVER), 'apps_row', PIXEL, PLAIN, { kind: 'cut', edge: 'top', depth: 33 }],
    ['…the whole row below it, plain', async () => parseDump(SETTINGS_ROW_SLIVER), 'next_row', PIXEL, PLAIN, { kind: 'reachable', at: { x: 540, y: 440 } }],
    // The number pad up, CONTINUE lifted onto it: value_date_select's centre (201,571) under the bar.
    ['idb number pad: value_date_select under the lifted CONTINUE, plain', () => idbAt('idb-swift-form-number-pad.json', 'elements'), 'swift_payment.form.value_date_select', IPHONE, PLAIN, { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    // Device check C3-3: rows scrolled under the top bar are no cover of Back; the pinned CONTINUE still covers the row under it.
    ['idb scrolled under the top bar, position 2: Back, plain', () => idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', 'pos2'), 'BackButton', IPHONE, PLAIN, { kind: 'reachable', at: { x: 44, y: 84 } }],
    ['…position 6: payee_country_select under CONTINUE, plain', () => idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', 'pos6'), 'swift_payment.form.payee_country_select', IPHONE, PLAIN, { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    // A modal listed before the content it is drawn over: its rows and the picker stand clear.
    ['idb modal listed before content: the chooser\'s SWIFT row, plain', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'chooser'), 'accounts.detail.payment_type_sheet.row_swift', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 479 } }],
    ['…the value-date picker, plain', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'valueDatePicker'), 'swift_payment.form.value_date_picker', IPHONE, PLAIN, { kind: 'reachable', at: { x: 205, y: 479 } }],
    // A Compose button's text under its own control is no cover of it.
    ['Android Compose snapshot, logged out: LOGIN, plain', async () => ({ ...(JSON.parse(await fixture('android-ui-snapshot-compose.json')).screens.loggedOut as UiNode), paddedTouchTargets: true as const }), 'LOGIN', PIXEL, PLAIN, { kind: 'reachable', at: { x: 540, y: 1463 } }],
    // WDA lists the RN screen's texts as siblings of placeholder_screen: no cover of it (scroll_until stuck on it once).
    ['WDA RN screen: placeholder_screen, plain', async () => parseWdaSource(await fixture('wda-source-rn-myport.json')), 'placeholder_screen', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 495 } }],
  ] as const)('%s', async (_name, tree, id, screen, purpose, expected) => {
    const t = await tree();
    expect(said(sceneOf(t).standing(byId(t, id), screen, purpose))).toEqual(expected);
  });
});

const TAP = { of: 'tap' } as const;
/** The Pixel_3a as the adapter reads it with its navigation bar: the band from 2154 (dumpsys-window-displays-api33-*.txt). */
const PIXEL_NAV = { ...PIXEL, navigationBand: 2154 };
/** A screen of `fixture`'s Compose snapshot, as the parser hands it on. */
const compose = async (name: string): Promise<UiNode> => ({ ...(JSON.parse(await fixture('android-ui-snapshot-compose.json')).screens[name] as UiNode), paddedTouchTargets: true as const });
/** The Settings shape of the navigation-band triage: the list 0,596 1080x1558 (clipping), its last row's title 198,2105 428x49 flush with 2154. */
const SETTINGS_FLUSH = `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="list" bounds="[0,596][1080,2154]">
    <node class="android.widget.LinearLayout" clickable="true" resource-id="row" bounds="[0,2072][1080,2154]"><node class="android.widget.TextView" resource-id="title" text="Sound &amp; vibration" bounds="[198,2105][626,2154]" /></node>
  </node></node></hierarchy>`;

describe('Scene.standing for the tap — measured cases, fixture × purpose → kind (one order with the stop: bands, off screen, cut, covered)', () => {
  it.each([
    // The pinned-chrome bug note: priority_select's centre (201,797) under CONTINUE, 354x9 uncovered above it — under the 24 a tap may move to.
    ['idb SWIFT form, priority_select at rest under CONTINUE: covered, the strip above it too small', () => swiftIdb(), 'swift_payment.form.priority_select', IPHONE, { kind: 'covered', cover: 'swift_payment.form.continue_button', largest: { x: 24, y: 771, width: 354, height: 9 } }],
    ['…at 740, its centre clear: reachable at the centre', () => swiftIdbAt(740), 'swift_payment.form.priority_select', IPHONE, { kind: 'reachable', at: { x: 201, y: 766 } }],
    ['…flung to -20: under the status bar at (201,6)', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, { kind: 'systemBar', at: { x: 201, y: 6 }, bar: { edge: 'top', bottom: 62 } }],
    ['…at 860: off the screen, 14 of its 52 on it', () => swiftIdbAt(860), 'swift_payment.form.priority_select', IPHONE, { kind: 'offScreen', at: { x: 201, y: 886 }, visible: 14 / 52 }],
    ['Android SWIFT form, the toggle cut to 66,1924 948x55: cut at the bottom', async () => parseDump(SWIFT_ANDROID), 'swift_payment.form.details_toggle', PIXEL, { kind: 'cut', edge: 'bottom', depth: 55 }],
    ['…the toggle cut and a button over its centre: cut, as for the stop', async () => parseDump(swiftAndroid(55, true)), 'swift_payment.form.details_toggle', PIXEL, { kind: 'cut', edge: 'bottom', depth: 55 }],
    ['…its leaf label: the toggle\'s cut, inherited', async () => parseDump(SWIFT_ANDROID), 'Payment details', PIXEL, { kind: 'cut', edge: 'bottom', depth: 42, within: { x: 66, y: 1924, width: 948, height: 55 } }],
    ['…the toggle 65 deep: reachable at its centre', async () => parseDump(swiftAndroid(65)), 'swift_payment.form.details_toggle', PIXEL, { kind: 'reachable', at: { x: 540, y: 1947 } }],
    ['idb scrolled under the top bar, position 2: Back, reachable', () => idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', 'pos2'), 'BackButton', IPHONE, { kind: 'reachable', at: { x: 44, y: 84 } }],
    ['Android Compose snapshot, logged out: LOGIN, reachable', () => compose('loggedOut'), 'LOGIN', PIXEL, { kind: 'reachable', at: { x: 540, y: 1463 } }],
  ] as const)('%s', async (_name, tree, id, screen, expected) => {
    const t = await tree();
    expect(said(sceneOf(t).standing(byId(t, id), screen, TAP))).toEqual(expected);
  });

  describe('the move to an uncovered piece, above a keyboard line', () => {
    // A row 0,400 402x100 under a bar at 440–460 over its centre: uncovered 400–440 (402x40) and 460–500 (402x40); the first of equals.
    const row = () => {
      const r = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 400, width: 402, height: 100 } });
      const t = node({ role: 'container', rect: box(402, 874), children: [r, node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 440, width: 402, height: 20 } })] });
      return { t, r };
    };
    it('no keyboard: moved to the largest uncovered piece', () => {
      const { t, r } = row();
      expect(said(sceneOf(t).standing(r, IPHONE, TAP))).toEqual({ kind: 'reachable', at: { x: 201, y: 420 }, moved: { piece: { x: 0, y: 400, width: 402, height: 40 }, cover: 'bar', aboveKeyboard: false } });
    });
    it('a keyboard line at 430: the piece above it, 402x30', () => {
      const { t, r } = row();
      expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: 430 }))).toEqual({ kind: 'reachable', at: { x: 201, y: 415 }, moved: { piece: { x: 0, y: 400, width: 402, height: 30 }, cover: 'bar', aboveKeyboard: true } });
    });
    it('a keyboard line at 420: what shows above it is under the minimum — covered, above the keyboard', () => {
      const { t, r } = row();
      const s = sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: 420 });
      expect(said(s)).toEqual({ kind: 'covered', cover: 'bar', largest: { x: 0, y: 400, width: 402, height: 20 } });
      expect(s.kind === 'covered' && s.aboveKeyboard).toBe(true);
    });
    it('a line at or below the box\'s bottom cuts nothing', () => {
      const { t, r } = row();
      expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: 874 }))).toEqual(said(sceneOf(t).standing(r, IPHONE, TAP)));
    });
  });

  describe('the boxes judged in, and no screen at all', () => {
    const at = (x: number, y: number, root = box(402, 874)) => {
      const r = node({ role: 'button', identifier: 'row', rect: { x: x - 10, y: y - 10, width: 20, height: 20 } });
      return { t: node({ role: 'container', rect: root, children: [r] }), r };
    };
    const EITHER_WAY = { box: box(402, 874), boxes: [box(402, 874), box(874, 402)], statusBand: 62 };
    it('the tap judges in ANY of the boxes — a point inside the turned box only is reachable; the stop judges the first box alone', () => {
      const { t, r } = at(600, 200);
      expect(said(sceneOf(t).standing(r, EITHER_WAY, TAP))).toEqual({ kind: 'reachable', at: { x: 600, y: 200 } });
      expect(said(sceneOf(t).standing(r, EITHER_WAY, PLAIN))).toMatchObject({ kind: 'offScreen' });
    });
    it('off both: off the screen, with the most of it inside either box', () => {
      const { t, r } = at(900, 900);
      expect(said(sceneOf(t).standing(r, EITHER_WAY, TAP))).toEqual({ kind: 'offScreen', at: { x: 900, y: 900 }, visible: 0 });
    });
    it('no screen: judged in the tree\'s root rect — and a root of no area leaves every point on the screen (fail open)', () => {
      const off = at(201, 1000);
      expect(said(sceneOf(off.t).standing(off.r, undefined, TAP))).toEqual({ kind: 'offScreen', at: { x: 201, y: 1000 }, visible: 0 });
      const open = at(201, 1000, box(0, 0));
      expect(said(sceneOf(open.t).standing(open.r, undefined, TAP))).toEqual({ kind: 'reachable', at: { x: 201, y: 1000 } });
    });
  });
});

describe('Scene.standing — the Android navigation band (D7): a centre in it is under the navigation bar, for the tap and both stops', () => {
  it.each([
    // mp-native's Account Detail at its top, drawn edge to edge: row_4 66,2152 948x68 lies under the bar; the tap went to (540,2186).
    ['accountDetailTop row_4, tap', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL_NAV, TAP, { kind: 'systemBar', at: { x: 540, y: 2186 }, bar: { edge: 'bottom', top: 2154 } }],
    ['…plain stop', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL_NAV, PLAIN, { kind: 'systemBar', at: { x: 540, y: 2186 }, bar: { edge: 'bottom', top: 2154 } }],
    ['…fully: true', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 2186 }, bar: { edge: 'bottom', top: 2154 } }],
    ['…with no navigation band read (an immersive app, a dump that does not say): tapped as before', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL, TAP, { kind: 'reachable', at: { x: 540, y: 2186 } }],
    // Contacts' Create contact: "Add fields" 198,2106 180x48 ends flush with the band (its flush case is the pixel assert's); its centre (288,2130) clears it.
    ['contactsCreateStaged "Add fields", tap: reachable', () => compose('contactsCreateStaged'), 'Add fields', PIXEL_NAV, TAP, { kind: 'reachable', at: { x: 288, y: 2130 } }],
    ['…plain stop: reachable', () => compose('contactsCreateStaged'), 'Add fields', PIXEL_NAV, PLAIN, { kind: 'reachable', at: { x: 288, y: 2130 } }],
    // Settings' title 198,2105 428x49 flush with the band: its centre (412,2130) clears it.
    ['Settings title flush with the band, tap: reachable', async () => parseDump(SETTINGS_FLUSH), 'title', PIXEL_NAV, TAP, { kind: 'reachable', at: { x: 412, y: 2130 } }],
  ] as const)('%s', async (_name, tree, id, screen, purpose, expected) => {
    const t = await tree();
    expect(said(sceneOf(t).standing(byId(t, id), screen, purpose))).toEqual(expected);
  });

  const tree = (y: number, root = box(1080, 2220)) => {
    const r = node({ role: 'button', identifier: 'row', rect: { x: 0, y: y - 10, width: root.width, height: 20 } });
    return { t: node({ role: 'container', rect: root, children: [r] }), r };
  };
  it('its edge: a centre at y 2153 is reachable, at 2154 under the bar — whatever the band\'s height (a three-button bar from 2088 too)', () => {
    const above = tree(2153);
    expect(said(sceneOf(above.t).standing(above.r, PIXEL_NAV, TAP))).toMatchObject({ kind: 'reachable' });
    const on = tree(2154);
    expect(said(sceneOf(on.t).standing(on.r, PIXEL_NAV, TAP))).toEqual({ kind: 'systemBar', at: { x: 540, y: 2154 }, bar: { edge: 'bottom', top: 2154 } });
    const buttons = tree(2100);
    expect(said(sceneOf(buttons.t).standing(buttons.r, { ...PIXEL, navigationBand: 2088 }, TAP))).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom', top: 2088 } });
  });
  it('the status bar before the navigation bar when a centre lies in both (a screen shorter than its two bands)', () => {
    const both = tree(100, box(100, 200));
    const tiny = { box: box(100, 200), boxes: [box(100, 200)], statusBand: 120, navigationBand: 80 };
    expect(said(sceneOf(both.t).standing(both.r, tiny, TAP))).toMatchObject({ kind: 'systemBar', bar: { edge: 'top', bottom: 120 } });
  });
  it('a band at or above the box\'s top is no band (as a status band of 0 or less is none): nothing refused, nothing cut', () => {
    const row = tree(1000);
    for (const top of [0, -5]) expect(said(sceneOf(row.t).standing(row.r, { ...PIXEL, navigationBand: top }, TAP))).toEqual({ kind: 'reachable', at: { x: 540, y: 1000 } });
  });
  it('portrait only: on a landscape box a band read upright is not judged', () => {
    const turned = tree(1050, box(2220, 1080));
    const landscape = { box: box(2220, 1080), boxes: [box(2220, 1080)], statusBand: 66, navigationBand: 1014 };
    expect(said(sceneOf(turned.t).standing(turned.r, landscape, TAP))).toMatchObject({ kind: 'reachable' });
  });
  it('a moved tap is never aimed into the band: the piece is chosen above it', () => {
    // A row 1900–2220 (centre 2060) under a bar at 1980–2130: uncovered 1900–1980 (80) and 2130–2220 (90, of which 24 lie above the band).
    const r = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 1900, width: 1080, height: 320 } });
    const t = node({ role: 'container', rect: box(1080, 2220), children: [r, node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 1980, width: 1080, height: 150 } })] });
    expect(said(sceneOf(t).standing(r, PIXEL, TAP))).toMatchObject({ kind: 'reachable', at: { x: 540, y: 2175 }, moved: { piece: { x: 0, y: 2130, width: 1080, height: 90 } } });
    expect(said(sceneOf(t).standing(r, PIXEL_NAV, TAP))).toMatchObject({ kind: 'reachable', at: { x: 540, y: 1940 }, moved: { piece: { x: 0, y: 1900, width: 1080, height: 80 } } });
  });
});

/** Every fixture tree the suite parses, with its platform: the WDA sources, the idb dumps, the Compose snapshots and the synthetic uiautomator trees. */
const everyFixture = async (): Promise<[string, UiNode, 'ios' | 'android'][]> => {
  const trees: [string, UiNode, 'ios' | 'android'][] = [];
  for (const f of (await readdir(new URL('../fixtures/', import.meta.url))).filter((f) => f.startsWith('wda-source')).sort()) trees.push([f, parseWdaSource(await fixture(f)), 'ios']);
  trees.push(['idb continue', await swiftIdb(), 'ios'], ['idb number pad', await idbAt('idb-swift-form-number-pad.json', 'elements'), 'ios']);
  for (const k of Object.keys(JSON.parse(await fixture('idb-modal-listed-before-content.json')).screens)) trees.push([`idb modal ${k}`, await idbAt('idb-modal-listed-before-content.json', 'screens', k), 'ios']);
  for (const k of Object.keys(JSON.parse(await fixture('idb-swift-form-scrolled-under-top-bar.json')).positions)) trees.push([`idb top bar ${k}`, await idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', k), 'ios']);
  for (const k of Object.keys(JSON.parse(await fixture('android-ui-snapshot-compose.json')).screens)) trees.push([`compose ${k}`, await compose(k), 'android']);
  for (const [k, xml] of Object.entries({ ...COMPOSE, ...CLASSIC_VIEWS, SETTINGS_ROW_SLIVER, SWIFT_ANDROID, SETTINGS_FLUSH, SWIFT_ANDROID_COVERED: swiftAndroid(55, true) })) trees.push([`uiautomator ${k}`, parseDump(xml), 'android']);
  return trees;
};

describe('parity — `scroll_until X` then `tap X`: a plain stop that is reachable is a tap at the same centre, unmoved', () => {
  it('every node of every fixture, on the screen with no band, the status band, and the status band with a navigation band (2154 gesture, 2088 three buttons)', async () => {
    let judged = 0;
    let reachable = 0;
    const broken: string[] = [];
    for (const [name, tree, os] of await everyFixture()) {
      const box: Rect = os === 'ios' ? { x: 0, y: 0, width: 402, height: 874 } : { x: 0, y: 0, width: 1080, height: 2220 };
      const status = os === 'ios' ? 62 : 66;
      const bands = [{}, { statusBand: status }, ...(os === 'android' ? [{ statusBand: status, navigationBand: 2154 }, { statusBand: status, navigationBand: 2088 }] : [])];
      const scene = sceneOf(tree);
      for (const band of bands) {
        const screen = { box, boxes: [box], ...band };
        for (const n of everyNode(tree)) {
          if (n === tree) continue;
          judged++;
          const stop = scene.standing(n, screen, PLAIN);
          if (stop.kind !== 'reachable') continue;
          reachable++;
          const tap = scene.standing(n, screen, TAP);
          if (tap.kind !== 'reachable' || tap.moved !== undefined || tap.at.x !== stop.at.x || tap.at.y !== stop.at.y) {
            broken.push(`${name} ${JSON.stringify(band)} ${n.role} ${JSON.stringify(n.rect)}: tap ${tap.kind}${tap.kind === 'reachable' && tap.moved !== undefined ? ' moved' : ''}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
    // Not vacuous: thousands of nodes judged, and most of them reachable.
    expect(judged).toBeGreaterThan(4000);
    expect(reachable).toBeGreaterThan(judged / 2);
  });
});

describe('Scene.standing for the tap — a keyboard line and a system band together: the moved piece stays out of the band', () => {
  const covered = (screen: Rect, row: Rect, bar: Rect) => {
    const r = node({ role: 'button', identifier: 'row', rect: row });
    return { t: node({ role: 'container', rect: screen, children: [r, node({ role: 'button', identifier: 'bar', rect: bar })] }), r };
  };
  it('the status band: a row 30–200 under a bar at 90–140, the keyboard from 170 — the piece 140–170 below the bar, not 30–90 reaching into the band', () => {
    const { t, r } = covered(box(402, 874), { x: 0, y: 30, width: 402, height: 170 }, { x: 0, y: 90, width: 402, height: 50 });
    expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: 170 }))).toEqual({
      kind: 'reachable',
      at: { x: 201, y: 155 },
      moved: { piece: { x: 0, y: 140, width: 402, height: 30 }, cover: 'bar', aboveKeyboard: true },
    });
  });
  it('the navigation band: a row 1900–2220 under a bar at 1950–2130, the keyboard from 2210 — what shows above the band is under the minimum: covered, never moved to 2130–2210', () => {
    const { t, r } = covered(box(1080, 2220), { x: 0, y: 1900, width: 1080, height: 320 }, { x: 0, y: 1950, width: 1080, height: 180 });
    expect(said(sceneOf(t).standing(r, PIXEL_NAV, { ...TAP, keyboardTop: 2210 }))).toEqual({ kind: 'covered', cover: 'bar', largest: { x: 0, y: 1900, width: 1080, height: 50 } });
  });
});

describe('onScreen — the on-screen point rule the tap and the dismissal picker share', () => {
  const t = node({ role: 'container', rect: box(1080, 2220) });
  it('inside a box less both system bands; with no screen inside the root rect, or anywhere for a root of no area', () => {
    expect([onScreen({ x: 540, y: 100 }, t, PIXEL_NAV), onScreen({ x: 540, y: 30 }, t, PIXEL_NAV), onScreen({ x: 540, y: 2190 }, t, PIXEL_NAV), onScreen({ x: 540, y: 2300 }, t, PIXEL_NAV)]).toEqual([true, false, false, false]);
    expect([onScreen({ x: 540, y: 2300 }, t, undefined), onScreen({ x: 540, y: 2300 }, node({ role: 'container', rect: box(0, 0) }), undefined)]).toEqual([false, true]);
  });
});

describe('Scene.standing for the stop — which cover a covered row names', () => {
  const bar = (id: string, y: number) => node({ role: 'button', label: id, identifier: id, rect: { x: 0, y, width: 402, height: 20 } });
  const judged = (purpose: Purpose, ...bars: UiNode[]) => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 400, width: 402, height: 100 } });
    const t = node({ role: 'container', rect: box(402, 874), children: [row, ...bars] });
    return said(sceneOf(t).standing(row, IPHONE, purpose));
  };
  it('the one over its centre, when one is — not the last drawn', () => {
    expect(judged(PLAIN, bar('over_centre', 440), bar('over_bottom', 490))).toEqual({ kind: 'covered', cover: 'over_centre' });
  });
  it('fully: true with its centre clear: the last drawn of its covers', () => {
    expect(judged(FULLY, bar('over_top', 390), bar('over_bottom', 490))).toEqual({ kind: 'covered', cover: 'over_bottom' });
  });
});

describe('Scene.standing for the stop — under a keyboard line (the WDA band\'s measured top, 589 of 874)', () => {
  const tree = (y: number) => node({ role: 'container', rect: box(402, 874), children: [node({ role: 'button', identifier: 'row', rect: { x: 66, y, width: 336, height: 52 } })] });
  const judged = (y: number, purpose: Purpose, keyboardTop: number) => {
    const t = tree(y);
    return sceneOf(t).standing(t.children[0], IPHONE, { ...purpose, keyboardTop });
  };
  it('the measured row at 545, partly under the band: a plain stop on its centre, clear above; fully: true clipped at the keyboard\'s edge', () => {
    expect(said(judged(545, PLAIN, 589))).toEqual({ kind: 'reachable', at: { x: 234, y: 571 } });
    expect(said(judged(545, FULLY, 589))).toEqual({ kind: 'clipped', edges: ['bottom'] });
    expect(judged(545, FULLY, 589).facts.screen).toEqual(box(402, 589));
  });
  it('wholly under the band: under the keyboard, nothing of it in the frame', () => {
    const s = judged(700, PLAIN, 589);
    expect(said(s)).toEqual({ kind: 'underKeyboard', top: 589 });
    expect(s.facts.visible).toBe(0);
  });
  it('a line at the top edge leaves nothing to judge: under the keyboard, nothing shows', () => {
    const s = judged(300, PLAIN, 0);
    expect(said(s)).toEqual({ kind: 'underKeyboard', top: 0 });
    expect(s.facts).toMatchObject({ visible: 0, shows: 0, clipped: [], covers: [] });
  });
  it('a box that does not start at the origin: the frame runs from its top to the line, and a line at its top leaves nothing', () => {
    const t = tree(545);
    const shifted = { box: { x: 0, y: 20, width: 402, height: 854 }, boxes: [{ x: 0, y: 20, width: 402, height: 854 }], statusBand: 62 };
    expect(sceneOf(t).standing(t.children[0], shifted, { ...FULLY, keyboardTop: 589 }).facts.screen).toEqual({ x: 0, y: 20, width: 402, height: 569 });
    const nothing = sceneOf(t).standing(t.children[0], shifted, { ...PLAIN, keyboardTop: 20 });
    expect(said(nothing)).toEqual({ kind: 'underKeyboard', top: 20 });
    // Nothing to judge: no exposure asked, so no minimum piece.
    expect(nothing.facts).toMatchObject({ screen: { x: 0, y: 20, width: 402, height: 0 }, visible: 0 });
    expect(nothing.facts.minPiece).toBeUndefined();
  });
  it('off the screen with a keyboard up is off the screen, not under the keyboard', () => {
    expect(said(judged(900, PLAIN, 589))).toEqual({ kind: 'offScreen', at: { x: 234, y: 926 }, visible: 0 });
  });
});

describe('Scene.standing for the stop — a box that does not start at the origin', () => {
  it('a centre in the status band quotes the band\'s line, not its height inside the box', () => {
    const t = node({ role: 'container', rect: box(402, 874), children: [node({ role: 'button', identifier: 'row', rect: { x: 24, y: 10, width: 354, height: 52 } })] });
    const shifted = { x: 0, y: 20, width: 402, height: 854 };
    expect(said(sceneOf(t).standing(t.children[0], { box: shifted, boxes: [shifted], statusBand: 62 }, PLAIN))).toEqual({ kind: 'systemBar', at: { x: 201, y: 36 }, bar: { edge: 'top', bottom: 62 } });
  });
});

describe('sceneOf — derived once', () => {
  it('its draw order and its clip facts are each derived once, whoever asks', async () => {
    const scene = sceneOf(await swiftIdb());
    expect(scene.order).toBe(scene.order);
    expect(scene.clips).toBe(scene.clips);
  });
});

describe('sceneOf(tree).clips.inScroller over every fixture — known on every nested tree, unknown on every idb flat list', () => {
  it('every node of every nested fixture is known; every node of every idb fixture is not', async () => {
    const nested: [string, UiNode][] = [];
    for (const f of (await readdir(new URL('../fixtures/', import.meta.url))).filter((f) => f.startsWith('wda-source')).sort()) nested.push([f, parseWdaSource(await fixture(f))]);
    for (const [k, v] of Object.entries(JSON.parse(await fixture('android-ui-snapshot-compose.json')).screens)) nested.push([`android ${k}`, v as UiNode]);
    for (const [k, xml] of Object.entries({ ...COMPOSE, ...CLASSIC_VIEWS, SETTINGS_ROW_SLIVER, SWIFT_ANDROID })) nested.push([`uiautomator ${k}`, parseDump(xml)]);
    const flat: [string, UiNode][] = [
      ['continue', await swiftIdb()],
      ['number pad', await idbAt('idb-swift-form-number-pad.json', 'elements')],
      ...(await Promise.all(Object.keys(JSON.parse(await fixture('idb-modal-listed-before-content.json')).screens).map(async (k) => [`modal ${k}`, await idbAt('idb-modal-listed-before-content.json', 'screens', k)] as [string, UiNode]))),
      ...(await Promise.all(Object.keys(JSON.parse(await fixture('idb-swift-form-scrolled-under-top-bar.json')).positions).map(async (k) => [`top bar ${k}`, await idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', k)] as [string, UiNode]))),
    ];
    const unknown = nested.flatMap(([name, t]) => [...everyNode(t)].filter((n) => sceneOf(t).clips.inScroller(n) === undefined).map((n) => `${name} ${n.role}`));
    const known = flat.flatMap(([name, t]) => [...everyNode(t)].filter((n) => sceneOf(t).clips.inScroller(n) !== undefined).map((n) => `${name} ${n.role}`));
    expect({ unknown, known }).toEqual({ unknown: [], known: [] });
    // Not vacuous: the sweep holds nodes inside a scroller and nodes outside one.
    const answers = nested.flatMap(([, t]) => [...everyNode(t)].map((n) => sceneOf(t).clips.inScroller(n)));
    expect([answers.includes(true), answers.includes(false), flat.length]).toEqual([true, true, 10]);
  });
});

describe('sceneOf(tree).clips.inScroller — the dialect asked of draw order (draw-order.ts#listsAncestry)', () => {
  it("idb's flat list cannot say; a nested tree can", async () => {
    const flat = await swiftIdb();
    expect(sceneOf(flat).clips.inScroller(byId(flat, 'swift_payment.form.priority_select'))).toBeUndefined();
    const android = parseDump(SWIFT_ANDROID);
    expect(sceneOf(android).clips.inScroller(byId(android, 'Payment details'))).toBe(true);
    expect(sceneOf(android).clips.inScroller(byId(android, 'swift_payment.form.continue_button'))).toBe(false);
  });
});

import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { ScreenSize } from '../../src/ui-tree/geometry.js';
import { sceneOf, treeScreen, usableScreen, usableScreenOf, type Purpose, type Standing } from '../../src/ui-tree/standing.js';
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

const IPHONE = { box: box(402, 874), statusBand: 62 };
const PIXEL = { box: box(1080, 2220), statusBand: 66 };
const PLAIN = { of: 'stop', fully: false } as const;
const FULLY = { of: 'stop', fully: true } as const;

/** A standing's kind with the fact its sentence quotes, as one plain value. */
const said = (s: Standing): unknown => {
  switch (s.kind) {
    case 'reachable':
      return { kind: s.kind, at: s.at };
    case 'offScreen':
      return { kind: s.kind, at: s.at, visible: s.visible };
    case 'statusBand':
      return { kind: s.kind, at: s.at, band: s.band };
    case 'clipped':
      return { kind: s.kind, edges: s.edges };
    case 'cut':
      return { kind: s.kind, edge: s.cut.edge, depth: s.cut.depth, ...(s.cut.within !== undefined && { within: s.cut.within }) };
    case 'covered':
      return { kind: s.kind, cover: s.cover.identifier ?? s.cover.label };
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
    ['…flung to -20, plain: the status band', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'statusBand', at: { x: 201, y: 6 }, band: 62 }],
    ['…flung to -20, fully: true: a cut edge leads', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, FULLY, { kind: 'clipped', edges: ['top'] }],
    // Its centre off the screen's bottom: no stop, whatever shows.
    ['…at 860, its centre below the screen, plain', () => swiftIdbAt(860), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'offScreen', at: { x: 201, y: 886 }, visible: 14 / 52 }],
    // The sliver bug note: the toggle cut to 55 px at the form's bottom, under the 65 a tap needs.
    ['Android SWIFT form, the toggle cut to 66,1924 948x55, plain: cut at the bottom', async () => parseDump(SWIFT_ANDROID), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 55 }],
    ['…fully: true: the flush probe is the stop\'s rule, not the cut', async () => parseDump(SWIFT_ANDROID), 'swift_payment.form.details_toggle', PIXEL, FULLY, { kind: 'reachable', at: { x: 540, y: 1952 } }],
    // The minimum piece is 65 on a 1080-wide screen: 64 deep is a sliver, 65 is not.
    ['…the toggle 64 deep: a sliver', async () => parseDump(swiftAndroid(64)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'cut', edge: 'bottom', depth: 64 }],
    ['…the toggle 65 deep: no sliver, a stop', async () => parseDump(swiftAndroid(65)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'reachable', at: { x: 540, y: 1947 } }],
    // The stop judges the cover before the cut — what one precedence with the tap (cut first) changes.
    ['…the toggle cut and a button over its centre, plain: covered', async () => parseDump(swiftAndroid(55, true)), 'swift_payment.form.details_toggle', PIXEL, PLAIN, { kind: 'covered', cover: 'help' }],
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
    return sceneOf(t).standing(t.children[0], { ...IPHONE, keyboardTop }, purpose);
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
    const shifted = { box: { x: 0, y: 20, width: 402, height: 854 }, statusBand: 62 };
    expect(sceneOf(t).standing(t.children[0], { ...shifted, keyboardTop: 589 }, FULLY).facts.screen).toEqual({ x: 0, y: 20, width: 402, height: 569 });
    const nothing = sceneOf(t).standing(t.children[0], { ...shifted, keyboardTop: 20 }, PLAIN);
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
    expect(said(sceneOf(t).standing(t.children[0], { box: { x: 0, y: 20, width: 402, height: 854 }, statusBand: 62 }, PLAIN))).toEqual({ kind: 'statusBand', at: { x: 201, y: 36 }, band: 62 });
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

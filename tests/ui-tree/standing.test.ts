import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { farEdgeFrames, pinnedSurface, sceneOf, type PixelPurpose, type PixelStanding, type Purpose, type Standing, type StandingScreen, type TapStanding, type TouchPurpose } from '../../src/ui-tree/standing.js';
import { keyboardEdge, type KeyboardLine } from '../../src/ui-tree/keyboard-cover.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';
import { node } from '../helpers/fake.js';
import { CLASSIC_VIEWS, SETTINGS_ROW_SLIVER } from '../helpers/synthetic-android-trees.js';

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
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

/** A usable screen (ui-tree/usable-screen.ts#UsableScreen) of the device's size, `oriented` its box: what every purpose is handed — the pixel assert judges `oriented`, the touches `box`/`boxes`. */
const usable = (screen: StandingScreen): UsableScreen => ({ ...screen, oriented: screen.box, from: 'device' });
const IPHONE = usable({ box: box(402, 874), boxes: [box(402, 874)], statusBand: 62 });
const PIXEL = usable({ box: box(1080, 2220), boxes: [box(1080, 2220)], statusBand: 66 });
const PLAIN = { of: 'stop' } as const;
/** A keyboard line (ui-tree/keyboard-cover.ts#KeyboardLine): WDA's band by default, witnessed; idb's band, which no reading stands by. */
const wda = (y: number): KeyboardLine => ({ y, source: 'wda', witnessed: true });
const idb = (y: number): KeyboardLine => ({ y, source: 'idb-band', witnessed: false });
const FULLY = { of: 'fully' } as const;

/** A standing's kind with the fact its sentence quotes, as one plain value. */
const said = (s: Standing | PixelStanding): unknown => {
  switch (s.kind) {
    case 'reachable':
      return { kind: s.kind, at: s.at, ...('moved' in s && s.moved !== undefined && { moved: { piece: s.moved.piece, cover: s.moved.cover.identifier ?? s.moved.cover.label, aboveKeyboard: s.moved.aboveKeyboard } }) };
    case 'offScreen':
      return { kind: s.kind, at: s.at, visible: s.visible };
    case 'systemBar':
      return { kind: s.kind, at: s.at, bar: s.bar, ...('band' in s && { band: s.band }) };
    case 'clipped':
      return { kind: s.kind, edges: s.edges };
    case 'cut':
      // The pixel's own cut: at a bar, in the scroller flush with it.
      if (!('cut' in s)) return { kind: s.kind, bar: s.bar, container: s.container };
      return { kind: s.kind, edge: s.cut.edge, depth: s.cut.depth, ...(s.cut.within !== undefined && { within: s.cut.within }) };
    case 'covered':
      return {
        kind: s.kind,
        cover: s.cover.identifier ?? s.cover.label,
        ...('largest' in s && s.largest !== undefined && { largest: s.largest }),
        ...('reach' in s && { reach: s.reach }),
        ...('overRoot' in s && s.overRoot === true && { overRoot: true }),
      };
    case 'underKeyboard':
      return { kind: s.kind, top: s.line.y, source: s.line.source, ...('band' in s && { band: s.band }) };
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

describe('Scene.standing for the tap — measured cases, fixture × purpose → kind (one order with the stop: off screen, bands, cut, covered)', () => {
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
      expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: wda(430) }))).toEqual({ kind: 'reachable', at: { x: 201, y: 415 }, moved: { piece: { x: 0, y: 400, width: 402, height: 30 }, cover: 'bar', aboveKeyboard: true } });
    });
    it('a keyboard line at 420: what shows above it is under the minimum — covered, above the keyboard', () => {
      const { t, r } = row();
      const s = sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: wda(420) });
      expect(said(s)).toEqual({ kind: 'covered', cover: 'bar', largest: { x: 0, y: 400, width: 402, height: 20 } });
      expect(s.kind === 'covered' && s.aboveKeyboard).toBe(true);
    });
    it('a line at or below the box\'s bottom cuts nothing', () => {
      const { t, r } = row();
      expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: wda(874) }))).toEqual(said(sceneOf(t).standing(r, IPHONE, TAP)));
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
    it('the stop, its centre in the status band of the first box, inside the turned one: under the status bar — the bands judged on the stop\'s box alone', () => {
      const { t, r } = at(201, 6);
      expect(said(sceneOf(t).standing(r, EITHER_WAY, PLAIN))).toEqual({ kind: 'systemBar', at: { x: 201, y: 6 }, bar: { edge: 'top', bottom: 62 } });
      expect(said(sceneOf(t).standing(r, EITHER_WAY, FULLY))).toEqual({ kind: 'clipped', edges: ['top'] });
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

describe('Scene.standing — the Android navigation band (D7): a centre in it is under the navigation bar, for the tap and both stops; for `fully: true`, any of it past the slack', () => {
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
    // `fully` judges the bands as a REGION (ADR 0009): accountDetail's row_30 66,2088 948x99 — its
    // centre (540,2138) clear of the band, its bottom 33 px into it. The pixel assert fails it closed under the bar and
    // advised `fully: true`, which stopped at once; now `fully` strokes on, the plain stop and the tap keep the centre rule.
    ['accountDetail row_30 reaching 33 px into the band, fully: true: under the navigation bar, as a region', () => compose('accountDetail'), 'transactions.list.row_30', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 2138 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['…plain stop: reachable (its centre clear)', () => compose('accountDetail'), 'transactions.list.row_30', PIXEL_NAV, PLAIN, { kind: 'reachable', at: { x: 540, y: 2138 } }],
    ['…tap: reachable', () => compose('accountDetail'), 'transactions.list.row_30', PIXEL_NAV, TAP, { kind: 'reachable', at: { x: 540, y: 2138 } }],
    // No scroll lifts a full-bleed header in no scroll view out of the band (ADR 0009): contactsSyncPromo's "Close sheet" scrim 0,0 1080x1087, laid from the top edge at full width, stops `fully` as before.
    ['contactsSyncPromo "Close sheet" 0,0 1080x1087 (full-bleed), fully: true: reachable', () => compose('contactsSyncPromo'), 'Close sheet', PIXEL, FULLY, { kind: 'reachable', at: { x: 540, y: 544 } }],
    ['…plain stop: reachable', () => compose('contactsSyncPromo'), 'Close sheet', PIXEL, PLAIN, { kind: 'reachable', at: { x: 540, y: 544 } }],
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
  it('a reading that leaves nothing above it is no band (fails open): at or above the box\'s top, or above the status band\'s bottom — nothing refused, nothing cut', () => {
    const row = tree(1000);
    for (const top of [0, -5]) expect(said(sceneOf(row.t).standing(row.r, { ...PIXEL, navigationBand: top }, TAP))).toEqual({ kind: 'reachable', at: { x: 540, y: 1000 } });
    expect(said(sceneOf(row.t).standing(row.r, { ...PIXEL, navigationBand: 50 }, TAP))).toEqual({ kind: 'reachable', at: { x: 540, y: 1000 } });
  });
  it('`fully: true` and the 2-unit slack (geometry.ts#PIXEL_OVERLAP_SLACK, the pixel assert\'s): a row 2 px into either band stops, 3 px does not — its centre clear either way', () => {
    const row = (y: number, height: number) => {
      const r = node({ role: 'button', identifier: 'row', rect: { x: 0, y, width: 1080, height } });
      return said(sceneOf(node({ role: 'container', rect: box(1080, 2220), children: [r] })).standing(r, PIXEL_NAV, FULLY));
    };
    expect(row(2056, 100)).toMatchObject({ kind: 'reachable' });
    expect(row(2057, 100)).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } });
    expect(row(64, 100)).toMatchObject({ kind: 'reachable' });
    expect(row(63, 100)).toMatchObject({ kind: 'systemBar', bar: { edge: 'top', bottom: 66 }, band: { x: 0, y: 0, width: 1080, height: 66 } });
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

/** The pixel assert's purposes over `n`: the ocr crop (the whole rect, read as glyphs) and the colour sample (inset 12 % a side, verify/color-parity.ts#colorSampleRect). */
const OCR = (n: UiNode, keyboardTop?: KeyboardLine): PixelPurpose => ({ of: 'pixel', reads: n.rect, glyphs: true, ...(keyboardTop !== undefined && { keyboardTop }) });
const COLOUR = (n: UiNode, keyboardTop?: KeyboardLine): PixelPurpose => {
  const { x, y, width, height } = n.rect;
  return { of: 'pixel', reads: { x: x + width * 0.12, y: y + height * 0.12, width: width * 0.76, height: height * 0.76 }, glyphs: false, ...(keyboardTop !== undefined && { keyboardTop }) };
};
/** A non-edge-to-edge app's screen on the Pixel_3a: its window ends at the navigation bar (2154), a list clipping above a pinned bottom bar that ends there too. */
const PINNED_BOTTOM_BAR = `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2154]">
  <node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="list" bounds="[0,66][1080,2000]"><node class="android.widget.TextView" resource-id="row" text="Row" bounds="[0,1900][1080,2000]" /></node>
  <node class="android.widget.LinearLayout" resource-id="bottom_bar" bounds="[0,2000][1080,2154]"><node class="android.widget.TextView" resource-id="bar_title" text="Pay" bounds="[400,2100][680,2154]" /></node>
</node></hierarchy>`;

describe('Scene.standing for the pixel assert — measured cases, fixture × reader → kind (its region, not its centre)', () => {
  it.each([
    // Round 8: a label under CONTINUE sampled CONTINUE's colour — the pinned bar named, with its reach to the screen's bottom.
    ['idb SWIFT form, priority_select at rest under CONTINUE, colour', () => swiftIdb(), 'swift_payment.form.priority_select', IPHONE, COLOUR, { kind: 'covered', cover: 'swift_payment.form.continue_button', reach: { x: 24, y: 780, width: 354, height: 94 } }],
    ['…at 700, its sample (706–746) clear of the bar from 780: colour measures', () => swiftIdbAt(700), 'swift_payment.form.priority_select', IPHONE, COLOUR, { kind: 'reachable', at: { x: 201, y: 726 } }],
    // Round 8: `value_date_select` at 24,30 under the 62-pt band passed on the status bar's colour.
    ['…flung to -20: the status band over what it reads, the band\'s rect quoted', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE, OCR, { kind: 'systemBar', at: { x: 201, y: 6 }, bar: { edge: 'top', bottom: 62 }, band: { x: 0, y: 0, width: 402, height: 62 } }],
    // idb's flat list: its Application node, screen-sized, under the content listed over it — the root's own remedy.
    ['idb number pad: the Application root, colour: content on its background', () => idbAt('idb-swift-form-number-pad.json', 'elements'), 'Skeleton Internal', IPHONE, COLOUR, { kind: 'covered', cover: 'TextFieldWithComponentStyle', reach: { x: 42, y: 425, width: 318, height: 20 }, overRoot: true }],
    // D2: idb's band over the element — under the keyboard, the band's rect on the screen, whatever key lies over it.
    ['idb number pad: value_date_select at rest (545), its bottom 8 pt into the band: under the keyboard', () => idbAt('idb-swift-form-number-pad.json', 'elements'), 'swift_payment.form.value_date_select', IPHONE, (n: UiNode) => OCR(n, idb(589)), { kind: 'underKeyboard', top: 589, source: 'idb-band', band: { x: 0, y: 589, width: 402, height: 285 } }],
    // D7 (N-b): mp-native's Account Detail at its top, drawn edge to edge — row_4 and its texts lie in 2154–2220.
    ['accountDetailTop row_4 66,2152 948x68, ocr: under the navigation bar', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL_NAV, OCR, { kind: 'systemBar', at: { x: 540, y: 2186 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['…colour too: its sample 2160–2212 lies in the band', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL_NAV, COLOUR, { kind: 'systemBar', at: { x: 540, y: 2186 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['…its text "Loan repayment" 254,2199 298x21 wholly in the band', () => compose('accountDetailTop'), 'Loan repayment@2199', PIXEL_NAV, OCR, { kind: 'systemBar', at: { x: 403, y: 2210 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['…with no navigation band read (an immersive app): measured', () => compose('accountDetailTop'), 'transactions.list.row_4', PIXEL, OCR, { kind: 'reachable', at: { x: 540, y: 2186 } }],
    // D7 (N-b, owner: ocr only): the Settings title 198,2105 428x49 ends on the band's top, its list too — the crop may read it cut.
    ['Settings title flush with the band in a list flush with it, ocr: cut at the navigation bar', async () => parseDump(SETTINGS_FLUSH), 'title', PIXEL_NAV, OCR, { kind: 'cut', bar: { edge: 'bottom', top: 2154 }, container: { x: 0, y: 596, width: 1080, height: 1558 } }],
    ['…colour: measured on what shows (D5)', async () => parseDump(SETTINGS_FLUSH), 'title', PIXEL_NAV, COLOUR, { kind: 'reachable', at: { x: 412, y: 2130 } }],
    ['…no navigation band (an immersive app): measured', async () => parseDump(SETTINGS_FLUSH), 'title', PIXEL, OCR, { kind: 'reachable', at: { x: 412, y: 2130 } }],
    // Contacts' Create contact: "Add fields" 198,2106 180x48 flush with the form's scroller 0,242 1080x1912, which ends at 2154.
    ['contactsCreateStaged "Add fields", ocr: cut at the navigation bar', () => compose('contactsCreateStaged'), 'Add fields', PIXEL_NAV, OCR, { kind: 'cut', bar: { edge: 'bottom', top: 2154 }, container: { x: 0, y: 242, width: 1080, height: 1912 } }],
    // A non-edge-to-edge app's pinned bottom bar ends at 2154 too, in no scroller: measured.
    ['a pinned bottom bar ending at the band, in no scroller, ocr: measured', async () => parseDump(PINNED_BOTTOM_BAR), 'bottom_bar', PIXEL_NAV, OCR, { kind: 'reachable', at: { x: 540, y: 2077 } }],
    ['…its title flush with it too: measured', async () => parseDump(PINNED_BOTTOM_BAR), 'bar_title', PIXEL_NAV, OCR, { kind: 'reachable', at: { x: 540, y: 2127 } }],
  ] as const)('%s', async (_name, tree, id, screen, purpose, expected) => {
    const t = await tree();
    // `label@y`: the node with that label at that y, where the label repeats.
    const [label, y] = id.split('@');
    const n = y === undefined ? byId(t, id) : [...everyNode(t)].find((m) => m.label === label && m.rect.y === Number(y))!;
    expect(said(sceneOf(t).standing(n, screen, purpose(n)))).toEqual(expected);
  });

  it('the 2-unit edge (geometry.ts#PIXEL_OVERLAP_SLACK) for the navigation band too: 2 px into it measured, 3 px under the bar', () => {
    const at = (bottom: number) => {
      const r = node({ role: 'text', identifier: 'r', rect: { x: 100, y: bottom - 50, width: 400, height: 50 } });
      return { t: node({ role: 'container', rect: box(1080, 2220), children: [r] }), r };
    };
    const two = at(2156);
    expect(said(sceneOf(two.t).standing(two.r, PIXEL_NAV, OCR(two.r)))).toMatchObject({ kind: 'reachable' });
    const three = at(2157);
    expect(said(sceneOf(three.t).standing(three.r, PIXEL_NAV, OCR(three.r)))).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom', top: 2154 } });
  });

  it('a navigation band reading that leaves nothing above it (its top above the status band\'s bottom) is no band, as for the tap: fails open', () => {
    const r = node({ role: 'text', identifier: 'r', rect: { x: 100, y: 1000, width: 400, height: 50 } });
    const t = node({ role: 'container', rect: box(1080, 2220), children: [r] });
    expect(said(sceneOf(t).standing(r, { ...PIXEL, navigationBand: 50 }, OCR(r)))).toMatchObject({ kind: 'reachable' });
  });

  it('idb\'s band meets the element at ANY overlap, no 2-unit edge (the keyboard\'s own rule): value_date_select 2 pt into it is under the keyboard; flush, measured', async () => {
    const t = await idbAt('idb-swift-form-number-pad.json', 'elements');
    const row = byId(t, 'swift_payment.form.value_date_select');
    (row as { rect: Rect }).rect = { ...row.rect, y: 539 };
    expect(said(sceneOf(t).standing(row, IPHONE, OCR(row, idb(589))))).toMatchObject({ kind: 'underKeyboard' });
    (row as { rect: Rect }).rect = { ...row.rect, y: 537 };
    expect(sceneOf(t).standing(row, IPHONE, OCR(row, idb(589))).kind).not.toBe('underKeyboard');
  });

  it('a colour assert whose RECT meets idb\'s band while its sample does not still fails closed under the keyboard: value_date_select at 539, its sample ending at 585', async () => {
    const t = await idbAt('idb-swift-form-number-pad.json', 'elements');
    const row = byId(t, 'swift_payment.form.value_date_select');
    (row as { rect: Rect }).rect = { ...row.rect, y: 539 };
    const purpose = COLOUR(row, idb(589));
    expect(purpose.of === 'pixel' && purpose.reads.y + purpose.reads.height).toBeLessThan(589);
    expect(said(sceneOf(t).standing(row, IPHONE, purpose))).toEqual({ kind: 'underKeyboard', top: 589, source: 'idb-band', band: { x: 0, y: 589, width: 402, height: 285 } });
  });

  it('portrait only (N-c): the Settings shape on a landscape box is measured', async () => {
    const t = parseDump(SETTINGS_FLUSH);
    const landscape = usable({ box: box(2220, 1080), boxes: [box(2220, 1080)], statusBand: 66, navigationBand: 2154 });
    expect(said(sceneOf(t).standing(byId(t, 'title'), landscape, OCR(byId(t, 'title'))))).toMatchObject({ kind: 'reachable' });
  });

  it('flush within a unit either way: the title ending at 2153 or 2155 is cut; at 2152, in a list ending at 2152, it is not (the list ends off the band)', () => {
    const shape = (titleBottom: number, listBottom: number) => {
      const title = node({ role: 'text', identifier: 'title', rect: { x: 198, y: titleBottom - 49, width: 428, height: 49 } });
      const list = node({ role: 'container', identifier: 'list', clipsDescendants: true, rect: { x: 0, y: 596, width: 1080, height: listBottom - 596 }, children: [title] });
      return { t: node({ role: 'container', rect: box(1080, 2220), children: [list] }), title };
    };
    for (const [titleBottom, listBottom, kind] of [[2153, 2154, 'cut'], [2155, 2154, 'cut'], [2154, 2155, 'cut'], [2152, 2154, 'reachable'], [2152, 2152, 'reachable']] as const) {
      const { t, title } = shape(titleBottom, listBottom);
      expect([titleBottom, listBottom, sceneOf(t).standing(title, PIXEL_NAV, OCR(title)).kind]).toEqual([titleBottom, listBottom, kind]);
    }
  });

  it('the order: idb\'s band before the status band (its remedy, hiding it, is no scroll), the status band before the navigation band, before any cover', async () => {
    const t = await idbAt('idb-swift-form-number-pad.json', 'elements');
    const root = byId(t, 'Skeleton Internal');
    expect(said(sceneOf(t).standing(root, IPHONE, OCR(root, idb(589))))).toMatchObject({ kind: 'underKeyboard' });
    expect(said(sceneOf(t).standing(root, IPHONE, OCR(root)))).toMatchObject({ kind: 'systemBar', bar: { edge: 'top' } });
    const tall = node({ role: 'container', identifier: 'tall', rect: { x: 0, y: 0, width: 1080, height: 2220 } });
    const over = node({ role: 'button', identifier: 'over', rect: { x: 0, y: 1000, width: 1080, height: 200 } });
    const android = node({ role: 'container', rect: box(1080, 2220), children: [tall, over] });
    expect(said(sceneOf(android).standing(tall, { ...PIXEL_NAV }, OCR(tall)))).toMatchObject({ kind: 'systemBar', bar: { edge: 'top' } });
    expect(said(sceneOf(android).standing(tall, usable({ box: box(1080, 2220), boxes: [box(1080, 2220)], navigationBand: 2154 }), OCR(tall)))).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom' } });
    expect(said(sceneOf(android).standing(tall, usable({ box: box(1080, 2220), boxes: [box(1080, 2220)] }), OCR(tall)))).toMatchObject({ kind: 'covered', cover: 'over' });
  });

  it('`covered.aboveKeyboard` is filled: false — the pixel judges no cover above a line, an element the band meets being under the keyboard first', async () => {
    const t = await swiftIdb();
    const s = sceneOf(t).standing(byId(t, 'swift_payment.form.priority_select'), IPHONE, COLOUR(byId(t, 'swift_payment.form.priority_select')));
    expect(s.kind === 'covered' && s.aboveKeyboard).toBe(false);
  });
});

/** D3: scroll_until's exposure box is cut below the status band, as the tap's and the pixel assert's are. */
describe('Scene.standing for the stop — its covers judged below the status band (D3)', () => {
  const tree = () => {
    // The row reaches 2 pt into the band — within the slack, so `fully` judges no band (its region rule).
    const row = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 60, width: 402, height: 100 } });
    // A node of the app lying only in the band, over the row's top: what the status bar hides anyway.
    const inBand = node({ role: 'image', identifier: 'in_band', rect: { x: 0, y: 0, width: 402, height: 62 } });
    return { t: node({ role: 'container', rect: box(402, 874), children: [row, inBand] }), row };
  };
  it('a node lying only in the band no longer blocks a `fully: true` stop, nor lowers what shows', () => {
    const { t, row } = tree();
    const s = sceneOf(t).standing(row, IPHONE, FULLY);
    expect(said(s)).toEqual({ kind: 'reachable', at: { x: 201, y: 110 } });
    // All of it shows: its own part in the band (60–62) counts, the node over it there does not.
    expect([s.facts.covers, s.facts.shows]).toEqual([[], 1]);
  });
  it('a cover reaching into the band and below it is not dropped: what shows is exactly what it was — its part in the band still hidden', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 60, width: 402, height: 100 } });
    const over = node({ role: 'image', identifier: 'over', rect: { x: 0, y: 30, width: 402, height: 50 } });
    const t = node({ role: 'container', rect: box(402, 874), children: [row, over] });
    const s = sceneOf(t).standing(row, IPHONE, FULLY);
    expect([said(s), s.facts.shows]).toEqual([{ kind: 'covered', cover: 'over' }, sceneOf(t).standing(row, { box: box(402, 874), boxes: [box(402, 874)] }, FULLY).facts.shows]);
    expect(s.facts.shows).toBeCloseTo(0.8);
  });
  it('under a keyboard line high enough that the frame above it is landscape-shaped (402x300), the band is still cut — judged on the box\'s shape', () => {
    const { t, row } = tree();
    const s = sceneOf(t).standing(row, IPHONE, { ...FULLY, keyboardTop: wda(300) });
    expect(s.facts.screen).toEqual({ x: 0, y: 0, width: 402, height: 300 });
    expect(said(s)).toEqual({ kind: 'reachable', at: { x: 201, y: 110 } });
  });
  it('with no band read, it covers as before', () => {
    const { t, row } = tree();
    const s = sceneOf(t).standing(row, { box: box(402, 874), boxes: [box(402, 874)] }, FULLY);
    expect(said(s)).toEqual({ kind: 'covered', cover: 'in_band' });
    expect(s.facts.shows).toBeCloseTo(0.98);
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
  it('every node of every fixture, on the screen with no band, the status band, and the status band with a navigation band (2154 gesture, 2088 three buttons) — one box, and either way up (a turn suggested, not witnessed)', async () => {
    let judged = 0;
    let reachable = 0;
    const broken: string[] = [];
    for (const [name, tree, os] of await everyFixture()) {
      const box: Rect = os === 'ios' ? { x: 0, y: 0, width: 402, height: 874 } : { x: 0, y: 0, width: 1080, height: 2220 };
      const status = os === 'ios' ? 62 : 66;
      const bands = [{}, { statusBand: status }, ...(os === 'android' ? [{ statusBand: status, navigationBand: 2154 }, { statusBand: status, navigationBand: 2088 }] : [])];
      const scene = sceneOf(tree);
      const turned: Rect = { x: 0, y: 0, width: box.height, height: box.width };
      for (const band of bands) for (const boxes of [[box], [box, turned]]) {
        const screen = { box, boxes, ...band };
        for (const n of everyNode(tree)) {
          if (n === tree) continue;
          judged++;
          const stop = scene.standing(n, screen, PLAIN);
          if (stop.kind !== 'reachable') continue;
          reachable++;
          const tap = scene.standing(n, screen, TAP);
          if (tap.kind !== 'reachable' || tap.moved !== undefined || tap.at.x !== stop.at.x || tap.at.y !== stop.at.y) {
            broken.push(`${name} ${JSON.stringify(band)} ${boxes.length} box(es) ${n.role} ${JSON.stringify(n.rect)}: tap ${tap.kind}${tap.kind === 'reachable' && tap.moved !== undefined ? ' moved' : ''}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
    // Not vacuous: thousands of nodes judged, and most of them reachable.
    expect(judged).toBeGreaterThan(8000);
    expect(reachable).toBeGreaterThan(judged / 2);
  });
});

describe('parity — `scroll_until X fully: true` then a pixel assert on X: a `fully` stop that is reachable leaves nothing of the app, and no system band, over what the assert reads', () => {
  it('every node of every fixture, every screen of the first half, one box (the pixel assert judges one): never covered; never under a system bar but for content no scroll lifts out of it — a full-bleed header or footer, or a screen-sized node, in no scroll view: the stated exemption (one way: the pixel assert is stricter)', async () => {
    let judged = 0;
    let reachable = 0;
    let exempt = 0;
    const broken: string[] = [];
    for (const [name, tree, os] of await everyFixture()) {
      const box: Rect = os === 'ios' ? { x: 0, y: 0, width: 402, height: 874 } : { x: 0, y: 0, width: 1080, height: 2220 };
      const status = os === 'ios' ? 62 : 66;
      const bands = [{}, { statusBand: status }, ...(os === 'android' ? [{ statusBand: status, navigationBand: 2154 }, { statusBand: status, navigationBand: 2088 }] : [])];
      const scene = sceneOf(tree);
      for (const band of bands) {
        const screen = usable({ box, boxes: [box], ...band });
        for (const n of everyNode(tree)) {
          if (n === tree) continue;
          judged++;
          const stop = scene.standing(n, screen, FULLY);
          if (stop.kind !== 'reachable') continue;
          reachable++;
          for (const purpose of [OCR(n), COLOUR(n)]) {
            const pixel = scene.standing(n, screen, purpose);
            if (pixel.kind === 'systemBar' && pinnedSurface(n, box, screen, scene.clips) !== undefined) {
              exempt++;
              continue;
            }
            if (pixel.kind === 'systemBar' || pixel.kind === 'covered') broken.push(`${name} ${JSON.stringify(band)} ${n.role} ${JSON.stringify(n.rect)}: pixel ${pixel.kind}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
    // Not vacuous: thousands judged, most of them reachable, and the exemption met (full-bleed roots and app bars).
    expect(judged).toBeGreaterThan(4000);
    expect(reachable).toBeGreaterThan(judged / 2);
    expect(exempt).toBeGreaterThan(0);
  });
});

describe('Scene.standing for the tap — a keyboard line and a system band together: the moved piece stays out of the band', () => {
  const covered = (screen: Rect, row: Rect, bar: Rect) => {
    const r = node({ role: 'button', identifier: 'row', rect: row });
    return { t: node({ role: 'container', rect: screen, children: [r, node({ role: 'button', identifier: 'bar', rect: bar })] }), r };
  };
  it('the status band: a row 30–200 under a bar at 90–140, the keyboard from 170 — the piece 140–170 below the bar, not 30–90 reaching into the band', () => {
    const { t, r } = covered(box(402, 874), { x: 0, y: 30, width: 402, height: 170 }, { x: 0, y: 90, width: 402, height: 50 });
    expect(said(sceneOf(t).standing(r, IPHONE, { ...TAP, keyboardTop: wda(170) }))).toEqual({
      kind: 'reachable',
      at: { x: 201, y: 155 },
      moved: { piece: { x: 0, y: 140, width: 402, height: 30 }, cover: 'bar', aboveKeyboard: true },
    });
  });
  it('the navigation band cuts the piece box (the keyboard line at 2210 lies below it, inert): a row 1900–2220 under a bar at 1950–2130 — what shows above the band is under the minimum: covered, never moved to 2130–2210', () => {
    const { t, r } = covered(box(1080, 2220), { x: 0, y: 1900, width: 1080, height: 320 }, { x: 0, y: 1950, width: 1080, height: 180 });
    expect(said(sceneOf(t).standing(r, PIXEL_NAV, { ...TAP, keyboardTop: wda(2210) }))).toEqual({ kind: 'covered', cover: 'bar', largest: { x: 0, y: 1900, width: 1080, height: 50 } });
  });
});

describe('Scene.standing for the tap — the on-screen point rule (the in-tree keyboard dismissal picker asks the same standing)', () => {
  /** The tap's standing of a 2x2 node centred on (x,y) in a root of `rect`. */
  const tapAt = (x: number, y: number, screen: StandingScreen | undefined, rect = box(1080, 2220)): Standing['kind'] => {
    const n = node({ role: 'text', rect: { x: x - 1, y: y - 1, width: 2, height: 2 } });
    return sceneOf(node({ role: 'container', rect, children: [n] })).standing(n, screen, TAP).kind;
  };
  it('inside a box less both system bands; with no screen inside the root rect, or anywhere for a root of no area', () => {
    expect([tapAt(540, 100, PIXEL_NAV), tapAt(540, 30, PIXEL_NAV), tapAt(540, 2190, PIXEL_NAV), tapAt(540, 2300, PIXEL_NAV)]).toEqual(['reachable', 'systemBar', 'systemBar', 'offScreen']);
    expect([tapAt(540, 2300, undefined), tapAt(540, 2300, undefined, box(0, 0))]).toEqual(['offScreen', 'reachable']);
  });
});

/**
 * With no device screen, every purpose reads one definition (ui-tree/usable-screen.ts#treeScreen): a rooted tree is
 * judged in its root rect; on a root of no area a touch fails open (every point on the screen, judged in the node's
 * own rect — the stops adopt the tap's fallback, unreachable from `scroll_until`, whose round always holds a frame),
 * and the pixel assert judges on the largest node.
 */
describe('Scene.standing with no screen — one "no device screen" for the tap, both stops and the pixel assert', () => {
  /** A 100x100 node at (x,y) in a root of `rect`, with a 402x874 node beside it when the root has no area (idb's flat list's Application). */
  const judgedAt = (x: number, y: number, rect: Rect, purpose: (n: UiNode) => Purpose): Standing | PixelStanding => {
    const n = node({ role: 'button', identifier: 'n', rect: { x, y, width: 100, height: 100 } });
    const t = node({ role: 'container', rect, children: rect.width * rect.height > 0 ? [n] : [node({ role: 'other', rect: box(402, 874) }), n] });
    return sceneOf(t).standing(n, undefined, purpose(n));
  };
  it('a rooted tree: the tap and both stops judge in the root rect — a node past it is off the screen', () => {
    for (const purpose of [TAP, PLAIN, FULLY]) {
      expect(said(judgedAt(150, 1000, box(402, 874), () => purpose))).toMatchObject({ kind: 'offScreen', at: { x: 200, y: 1050 } });
      expect(said(judgedAt(150, 300, box(402, 874), () => purpose))).toEqual({ kind: 'reachable', at: { x: 200, y: 350 } });
    }
  });
  it('a root of no area: the tap and both stops fail open, judged in the node\'s own rect — reachable wherever it lies', () => {
    for (const purpose of [TAP, PLAIN, FULLY]) {
      const s = judgedAt(150, 1000, box(0, 0), () => purpose);
      expect([said(s), s.facts.screen]).toEqual([{ kind: 'reachable', at: { x: 200, y: 1050 } }, { x: 150, y: 1000, width: 100, height: 100 }]);
    }
  });
  it('a root of no area: the pixel assert judges on the largest node (402x874), never failing open', () => {
    const s = judgedAt(150, 300, box(0, 0), (n) => OCR(n));
    expect([said(s), s.facts.screen]).toEqual([{ kind: 'reachable', at: { x: 200, y: 350 } }, box(402, 874)]);
  });
});

describe('Scene.standing for the pixel assert — it takes the usable screen and judges its single `oriented` box (D6)', () => {
  it('a crowned child turning `oriented` but not `boxes` (402x874 as built, 874x402 oriented): judged on the turned box, not `box`', () => {
    const n = node({ role: 'text', identifier: 'n', rect: { x: 500, y: 100, width: 200, height: 50 } });
    const t = node({ role: 'container', rect: box(874, 402), children: [n] });
    const usable: UsableScreen = { box: box(402, 874), boxes: [box(402, 874)], oriented: box(874, 402), from: 'device', statusBand: 62 };
    const s = sceneOf(t).standing(n, usable, OCR(n));
    // On `box` the frame would be 0,62 402x812, the node outside it; on `oriented` (landscape: no status band cut) it lies wholly inside.
    expect([said(s), s.facts.screen, s.facts.visible]).toEqual([{ kind: 'reachable', at: { x: 600, y: 125 } }, box(874, 402), 1]);
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
  const judged = (y: number, purpose: Purpose, top: number) => {
    const t = tree(y);
    return sceneOf(t).standing(t.children[0], IPHONE, { ...purpose, keyboardTop: wda(top) });
  };
  it('the measured row at 545, partly under the band: a plain stop on its centre, clear above; fully: true clipped at the keyboard\'s edge', () => {
    expect(said(judged(545, PLAIN, 589))).toEqual({ kind: 'reachable', at: { x: 234, y: 571 } });
    expect(said(judged(545, FULLY, 589))).toEqual({ kind: 'clipped', edges: ['bottom'] });
    expect(judged(545, FULLY, 589).facts.screen).toEqual(box(402, 589));
  });
  it('wholly under the band: under the keyboard, nothing of it in the frame', () => {
    const s = judged(700, PLAIN, 589);
    expect(said(s)).toEqual({ kind: 'underKeyboard', top: 589, source: 'wda' });
    expect(s.facts.visible).toBe(0);
  });
  it('a line at the top edge leaves nothing to judge: under the keyboard, nothing shows', () => {
    const s = judged(300, PLAIN, 0);
    expect(said(s)).toEqual({ kind: 'underKeyboard', top: 0, source: 'wda' });
    expect(s.facts).toMatchObject({ visible: 0, shows: 0, clipped: [], covers: [] });
  });
  it('a box that does not start at the origin: the frame runs from its top to the line, and a line at its top leaves nothing', () => {
    const t = tree(545);
    const shifted = { box: { x: 0, y: 20, width: 402, height: 854 }, boxes: [{ x: 0, y: 20, width: 402, height: 854 }], statusBand: 62 };
    expect(sceneOf(t).standing(t.children[0], shifted, { ...FULLY, keyboardTop: wda(589) }).facts.screen).toEqual({ x: 0, y: 20, width: 402, height: 569 });
    const nothing = sceneOf(t).standing(t.children[0], shifted, { ...PLAIN, keyboardTop: wda(20) });
    expect(said(nothing)).toEqual({ kind: 'underKeyboard', top: 20, source: 'wda' });
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

// ─── Rows moved from the verbs' tests (tests/interact/resolve.test.ts, scroll.test.ts, scroll-rounds.test.ts) ──────
// The geometric enumeration of the tap's and scroll_until's judgement, one row per case: the verbs keep one integration
// case per refusal class and the sentences; the kind and the point are pinned here, where they are decided.

/** A 402x874 iPhone screen with no status band read (the fakes the moved tap cases ran on). */
const IPHONE_BARE = { box: box(402, 874), boxes: [box(402, 874)] };
/** The Pixel_3a as built, no band read. */
const PIXEL_BARE = { box: box(1080, 2220), boxes: [box(1080, 2220)] };
/** The tap as interact/resolve.ts#refuseOffScreen asks it: with the tree's own keyboard line (idb's band, ui-tree/keyboard-cover.ts#keyboardEdge) for `n`. */
const tapOf = (t: UiNode, n: UiNode): TouchPurpose => {
  const line = keyboardEdge(undefined, sceneOf(t).order, n);
  return { of: 'tap', ...(line !== undefined && { keyboardTop: line }) };
};
/** An idb tree from `frame`-style elements (the idb parser's input). */
const idbEl = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number, AXUniqueId: string | null = null) => ({ type, AXLabel, AXUniqueId, frame: { x, y, width, height } });
const idbTree = (...elements: ReturnType<typeof idbEl>[]): UiNode => parseIdbDescribeAll(JSON.stringify(elements));
const QWERTY = (y: number) => ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((k, i) => idbEl('Button', k, 2 + 40 * i, y, 38, 46));
/** The idb number-pad fixture, `edit` applied to its nodes. */
const numberPad = async (edit: (t: UiNode) => void = () => {}): Promise<UiNode> => {
  const t = await idbAt('idb-swift-form-number-pad.json', 'elements');
  edit(t);
  return t;
};
/** mp-native's SWIFT form on the Pixel_3a as a synthetic tree: the form's clipping scroller `0,242 1080x1736`, `inside` in it, CONTINUE below. */
const swiftClipped = (...inside: UiNode[]): UiNode =>
  node({
    role: 'container',
    rect: box(1080, 2220),
    children: [
      node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 242, width: 1080, height: 1736 }, children: inside }),
      node({ role: 'button', label: 'CONTINUE', identifier: 'swift_payment.form.continue_button', rect: { x: 66, y: 1979, width: 948, height: 132 } }),
    ],
  });
/** The "Payment details" toggle (132 px whole) at `y`, `height` of it showing, its button 12 px below its top, cut with it. */
const toggleAt = (y: number, height: number) =>
  node({ role: 'container', identifier: 'swift_payment.form.details_toggle', rect: { x: 66, y, width: 948, height }, children: [node({ role: 'button', rect: { x: 66, y: y + 12, width: 948, height: Math.min(108, 1978 - (y + 12)) } })] });
/** The toggle as dumped on the device: its leaf label, a chevron, its button. */
const dumpedToggleAt = (y: number, height: number) => {
  const cut = (top: number, h: number) => ({ x: 66, y: top, width: 948, height: Math.min(h, 1978 - top) });
  return node({
    role: 'container',
    identifier: 'swift_payment.form.details_toggle',
    rect: { x: 66, y, width: 948, height },
    children: [node({ role: 'other', label: 'Payment details', rect: cut(y + 12, 108) }), node({ role: 'other', identifier: 'chevron', rect: { x: 926, y: y + 31, width: 88, height: Math.min(66, 1978 - (y + 31)) } }), node({ role: 'button', rect: cut(y + 12, 108) })],
  });
};
/** A tree of `children` on a `root` box. */
const on = (root: Rect, ...children: UiNode[]) => node({ role: 'container', rect: root, children });
/** idb's flat list: the Application, a row `hero` 402x150 at `y`, and a button below it. */
const idbRow = (y: number) =>
  parseIdbDescribeAll(JSON.stringify([
    { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
    { type: 'Other', AXLabel: 'Hero', AXUniqueId: 'hero', frame: { x: 0, y, width: 402, height: 150 } },
    { type: 'Button', AXLabel: 'Go', AXUniqueId: null, frame: { x: 20, y: 600, width: 362, height: 50 } },
  ]));
/** A node `hero` at `rect` inside a scroll view filling `root` (uiautomator's `scrollable="true"`: it clips). */
const inList = (root: Rect, rect: Rect) => on(root, node({ role: 'container', rect: root, clipsDescendants: true, children: [node({ role: 'container', identifier: 'hero', rect })] }));
/** The idb SWIFT form at rest with priority_select at `y` and `height`, and `extra` listed last. */
const swiftIdbWith = async (y: number, height: number, ...extra: UiNode[]): Promise<UiNode> => {
  const t = await swiftIdbAt(y);
  (byId(t, 'swift_payment.form.priority_select') as { rect: Rect }).rect = { ...byId(t, 'swift_payment.form.priority_select').rect, height };
  t.children.push(...extra);
  return t;
};

describe('Scene.standing for the tap — the screen\'s edges, the status band and the keyboard line (moved from the tap\'s tests)', () => {
  it.each([
    // Off the screen at every edge (the SWIFT form's street label moved): above the top, a carousel page right of it, one left of it.
    ['above the top: off the screen', () => on(box(402, 874), node({ identifier: 'n', rect: { x: 42, y: -40, width: 103, height: 20 } })), 'n', IPHONE_BARE, { kind: 'offScreen', at: { x: 94, y: -30 }, visible: 0 }],
    ['past the right edge', () => on(box(402, 874), node({ identifier: 'n', rect: { x: 450, y: 400, width: 100, height: 20 } })), 'n', IPHONE_BARE, { kind: 'offScreen', at: { x: 500, y: 410 }, visible: 0 }],
    ['past the left edge', () => on(box(402, 874), node({ identifier: 'n', rect: { x: -200, y: 400, width: 100, height: 20 } })), 'n', IPHONE_BARE, { kind: 'offScreen', at: { x: -150, y: 410 }, visible: 0 }],
    // The edges: right and bottom exclusive, judged at the point SENT (tapPoint rounds).
    ['the last column (401,101): on the screen', () => on(box(402, 874), node({ identifier: 'n', rect: { x: 400, y: 100, width: 2, height: 2 } })), 'n', IPHONE_BARE, { kind: 'reachable', at: { x: 401, y: 101 } }],
    ['the width (402,101): off it', () => on(box(402, 874), node({ identifier: 'n', rect: { x: 401, y: 100, width: 2, height: 2 } })), 'n', IPHONE_BARE, { kind: 'offScreen', at: { x: 402, y: 101 }, visible: 0.5 }],
    ['the height (101,874): off it', () => on(box(402, 874), node({ identifier: 'n', rect: { x: 100, y: 872, width: 2, height: 4 } })), 'n', IPHONE_BARE, { kind: 'offScreen', at: { x: 101, y: 874 }, visible: 0.5 }],
    // iOS's status band's edge: a centre at y 61 is under the bar, at y 62 tapped.
    ['priority_select at 35, its centre (201,61): under the status bar', () => swiftIdbAt(35), 'swift_payment.form.priority_select', IPHONE, { kind: 'systemBar', at: { x: 201, y: 61 }, bar: { edge: 'top', bottom: 62 } }],
    ['…at 36, its centre (201,62): reachable', () => swiftIdbAt(36), 'swift_payment.form.priority_select', IPHONE, { kind: 'reachable', at: { x: 201, y: 62 } }],
    // No band read (an Android adapter's status bar outside the app's window): the same centre (201,6) is tapped.
    ['…flung to -20 with no band read: reachable at (201,6)', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE_BARE, { kind: 'reachable', at: { x: 201, y: 6 } }],
    // A moved tap never lands in the band: the only uncovered piece (30–62) lies in it — covered, nothing of it shows.
    ['a row 30–100 under a banner at 62–102: covered, its uncovered piece all band', () => swiftIdbWith(30, 70, node({ role: 'button', label: 'Banner', identifier: 'banner', rect: { x: 0, y: 62, width: 402, height: 40 } })), 'swift_payment.form.priority_select', IPHONE, { kind: 'covered', cover: 'banner' }],
    // …and the band is cut before the largest piece is chosen: 120–160 below the bar, not the larger 30–90 reaching into it.
    ['a row 30–160 under a banner at 90–120: moved to the piece below the bar', () => swiftIdbWith(30, 130, node({ role: 'button', label: 'Banner', identifier: 'banner', rect: { x: 0, y: 90, width: 402, height: 30 } })), 'swift_payment.form.priority_select', IPHONE, { kind: 'reachable', at: { x: 201, y: 140 }, moved: { piece: { x: 24, y: 120, width: 354, height: 40 }, cover: 'banner', aboveKeyboard: false } }],
    // A landscape box is not cut (an iPhone hides its status bar there): a centre at y 30 is tapped.
    ['a landscape box with the band read: (400,30) reachable', () => on(box(874, 402), node({ identifier: 'n', rect: { x: 300, y: 10, width: 200, height: 40 } })), 'n', { box: box(874, 402), boxes: [box(874, 402)], statusBand: 62 }, { kind: 'reachable', at: { x: 400, y: 30 } }],
  ] as const)('%s', async (_name, tree, id, screen, expected) => {
    const t = await tree();
    expect(said(sceneOf(t).standing(byId(t, id), screen, TAP))).toEqual(expected);
  });
});

describe('Scene.standing for the tap — idb\'s chrome and its keyboard band, as the tap asks (its tree\'s own line) (moved from the tap\'s tests)', () => {
  it.each([
    // The pinned CONTINUE itself, and the row clear of it (the manual swipe put it at 452): tapped at their centres.
    ['idb SWIFT form: CONTINUE itself, reachable', () => swiftIdb(), 'swift_payment.form.continue_button', { kind: 'reachable', at: { x: 201, y: 802 } }],
    ['…priority_select at 452, clear of the bar: reachable', () => swiftIdbAt(452), 'swift_payment.form.priority_select', { kind: 'reachable', at: { x: 201, y: 478 } }],
    // A label 3 pt below CONTINUE (pressed CONTINUE on the device): CONTINUE reaches the screen's bottom.
    [
      'scrolled form pos1, the bank-street label at 42,817 under CONTINUE\'s reach',
      async () => {
        const t = await idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', 'pos1');
        (byId(t, 'Payee’s bank street & no.*') as { rect: Rect }).rect = { x: 42, y: 817, width: 186, height: 20 };
        return t;
      },
      'Payee’s bank street & no.*',
      { kind: 'covered', cover: 'swift_payment.form.continue_button' },
    ],
    // A modal listed before the content it is drawn over: the chooser's rows and the picker stand clear; CONTINUE, listed last, still covers.
    ['idb modal: the chooser\'s own-transfer row, reachable', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'chooser'), 'accounts.detail.payment_type_sheet.row_own', { kind: 'reachable', at: { x: 201, y: 423 } }],
    ['…its SWIFT row, reachable', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'chooser'), 'accounts.detail.payment_type_sheet.row_swift', { kind: 'reachable', at: { x: 201, y: 479 } }],
    ['…the value-date picker, reachable', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'valueDatePicker'), 'swift_payment.form.value_date_picker', { kind: 'reachable', at: { x: 205, y: 479 } }],
    ['…behind the picker, Payee’s name under CONTINUE', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'valueDatePicker'), 'Payee’s name', { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    // The number pad up, CONTINUE lifted onto it: value_date_select under it, nothing of it shows above the keyboard; a row under the keys is under the keyboard.
    ['idb number pad: value_date_select under the lifted CONTINUE, nothing above the keyboard', () => numberPad(), 'swift_payment.form.value_date_select', { kind: 'covered', cover: 'swift_payment.form.continue_button' }],
    [
      '…a Fees row 570–630 under the keys: under the keyboard',
      () => numberPad((t) => t.children.splice(t.children.findIndex((n) => n.identifier === 'swift_payment.form.continue_button'), 0, node({ role: 'button', identifier: 'fees', label: 'Fees', rect: { x: 24, y: 570, width: 354, height: 60 } }))),
      'fees',
      { kind: 'underKeyboard', top: 589, source: 'idb-band' },
    ],
    // The owner's decision under D2: a row 520–680 with 362x70 above the band (590), its centre under key K — under the keyboard, never moved.
    ['a row 520–680, its centre under key K: under the keyboard', async () => idbTree(idbEl('Application', 'App', 0, 0, 402, 874), idbEl('Button', 'Row', 20, 520, 362, 160, 'tall'), idbEl('Button', 'K', 180, 594, 44, 40), ...QWERTY(640), idbEl('Other', null, 0, 590, 402, 284)), 'tall', { kind: 'underKeyboard', top: 590, source: 'idb-band' }],
    // An app row listed right before the keys, wholly in the band: no key — under the keyboard; a key sharing its row is the keyboard's own.
    ['a login\'s Sign in at 20,700 362x50 before the keys: under the keyboard', async () => idbTree(idbEl('Application', 'App', 0, 0, 402, 874), idbEl('TextField', 'User', 20, 200, 362, 44, 'user'), idbEl('Button', 'Sign in', 20, 700, 362, 50, 'signin'), ...QWERTY(780).slice(0, 4), idbEl('Other', null, 0, 590, 402, 284)), 'signin', { kind: 'underKeyboard', top: 590, source: 'idb-band' }],
    ['…its key Q: reachable, the keyboard\'s own', async () => idbTree(idbEl('Application', 'App', 0, 0, 402, 874), idbEl('TextField', 'User', 20, 200, 362, 44, 'user'), idbEl('Button', 'Sign in', 20, 700, 362, 50, 'signin'), ...QWERTY(780).slice(0, 4), idbEl('Other', null, 0, 590, 402, 284)), 'Q', { kind: 'reachable', at: { x: 21, y: 803 } }],
    // A field and its placeholder label behind the keyboard (one top and height, overlapping): no keys — under the keyboard.
    ['a field and its placeholder behind the keyboard: under the keyboard', async () => idbTree(idbEl('Application', 'App', 0, 0, 402, 874), idbEl('TextField', null, 42, 700, 318, 20, 'field'), idbEl('StaticText', 'Placeholder', 42, 700, 60, 20), ...QWERTY(780).slice(0, 4), idbEl('Other', null, 0, 590, 402, 284)), 'field', { kind: 'underKeyboard', top: 590, source: 'idb-band' }],
    // A bottom sheet's unlabelled background with NO keyboard: no band — the row under Done is moved to its uncovered part.
    [
      'a bottom sheet\'s background, no keyboard: moved to the uncovered part',
      async () => idbTree(idbEl('Application', 'App', 0, 0, 402, 874), idbEl('Other', null, 0, 400, 402, 474), idbEl('Button', 'Row', 24, 420, 354, 80, 'row'), idbEl('Button', 'Done', 24, 440, 354, 30)),
      'row',
      { kind: 'reachable', at: { x: 201, y: 485 }, moved: { piece: { x: 24, y: 470, width: 354, height: 30 }, cover: 'Done', aboveKeyboard: false } },
    ],
  ] as const)('%s', async (_name, tree, id, expected) => {
    const t = await tree();
    const n = byId(t, id);
    expect(said(sceneOf(t).standing(n, IPHONE_BARE, tapOf(t, n)))).toEqual(expected);
  });

  it.each([
    ['idb SWIFT form through the parser: priority_select at rest', () => swiftIdb(), 'swift_payment.form.priority_select', { x: 201, y: 797 }],
    ['idb number pad: value_date_select under the lifted CONTINUE', () => numberPad(), 'swift_payment.form.value_date_select', { x: 201, y: 571 }],
    ['idb modal: Payee\u2019s name behind the picker', () => idbAt('idb-modal-listed-before-content.json', 'screens', 'valueDatePicker'), 'Payee\u2019s name', { x: 94, y: 827 }],
    [
      'scrolled form pos1: the bank-street label 3 pt under CONTINUE',
      async () => {
        const t = await idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', 'pos1');
        (byId(t, 'Payee\u2019s bank street & no.*') as { rect: Rect }).rect = { x: 42, y: 817, width: 186, height: 20 };
        return t;
      },
      'Payee\u2019s bank street & no.*',
      { x: 135, y: 827 },
    ],
  ] as const)('%s: covered by CONTINUE at the centre its refusal quotes', async (_name, tree, id, centre) => {
    const t = await tree();
    const n = byId(t, id);
    const s = sceneOf(t).standing(n, IPHONE_BARE, tapOf(t, n));
    expect([s.kind, s.facts.centre, s.facts.centreCover?.identifier]).toEqual(['covered', centre, 'swift_payment.form.continue_button']);
  });

  it('the number pad\'s covered row is judged above the keyboard (its 589–596 strip lies under the band): `aboveKeyboard`, nothing of it shows', async () => {
    const t = await numberPad();
    const n = byId(t, 'swift_payment.form.value_date_select');
    const s = sceneOf(t).standing(n, IPHONE_BARE, tapOf(t, n));
    expect(s.kind === 'covered' && { aboveKeyboard: s.aboveKeyboard, largest: s.largest }).toEqual({ aboveKeyboard: true, largest: undefined });
  });

  it.each(['pos1', 'pos2', 'pos3', 'pos4', 'pos5', 'pos6'])('idb, rows scrolled under the top bar, %s: Back and the title stand clear for the tap and the plain stop', async (pos) => {
    const t = await idbAt('idb-swift-form-scrolled-under-top-bar.json', 'positions', pos);
    for (const [id, at] of [['BackButton', { x: 44, y: 84 }], ['swift_payment.form.title', { x: 201, y: 84 }]] as const) {
      expect([said(sceneOf(t).standing(byId(t, id), IPHONE_BARE, TAP)), said(sceneOf(t).standing(byId(t, id), IPHONE_BARE, PLAIN))]).toEqual([
        { kind: 'reachable', at },
        { kind: 'reachable', at },
      ]);
    }
  });
});

describe('Scene.standing for the tap — the cut sliver\'s edges (synthetic SWIFT form, moved from the tap\'s tests)', () => {
  it.each([
    ['the toggle wholly on screen (66,1793 948x132): reachable at its centre', () => swiftClipped(toggleAt(1793, 132)), 'swift_payment.form.details_toggle', { kind: 'reachable', at: { x: 540, y: 1859 } }],
    ['…its leaf label, the toggle whole: reachable', () => swiftClipped(dumpedToggleAt(1793, 132)), 'Payment details', { kind: 'reachable', at: { x: 540, y: 1859 } }],
    ['…the cut toggle\'s chevron: the toggle\'s cut, inherited', () => swiftClipped(dumpedToggleAt(1924, 55)), 'chevron', { kind: 'cut', edge: 'bottom', depth: 23, within: { x: 66, y: 1924, width: 948, height: 55 } }],
    ['a whole button under the minimum touching the edge, its label inside: nothing cut', () => swiftClipped(node({ role: 'button', identifier: 'save', rect: { x: 66, y: 1930, width: 948, height: 48 }, children: [node({ role: 'text', label: 'Save', rect: { x: 480, y: 1942, width: 120, height: 24 } })] })), 'save', { kind: 'reachable', at: { x: 540, y: 1954 } }],
    [
      'a whole dense 40-px last row, its 2-px divider flush with its bottom: a divider is no evidence',
      () => swiftClipped(node({ role: 'button', identifier: 'last_row', rect: { x: 66, y: 1938, width: 948, height: 40 }, children: [node({ role: 'text', label: 'Row', rect: { x: 100, y: 1946, width: 200, height: 24 } }), node({ role: 'other', rect: { x: 66, y: 1976, width: 948, height: 2 } })] })),
      'last_row',
      { kind: 'reachable', at: { x: 540, y: 1958 } },
    ],
    ['a whole button whose background fills it, at the edge: no evidence of a cut', () => swiftClipped(node({ role: 'button', identifier: 'filled', rect: { x: 66, y: 1923, width: 400, height: 55 }, children: [node({ role: 'other', rect: { x: 66, y: 1923, width: 400, height: 55 } })] })), 'filled', { kind: 'reachable', at: { x: 266, y: 1951 } }],
    ['a leaf at the edge (the stated residual: a cut leaf reads the same)', () => swiftClipped(node({ role: 'button', identifier: 'leaf', rect: { x: 614, y: 1923, width: 400, height: 55 } })), 'leaf', { kind: 'reachable', at: { x: 814, y: 1951 } }],
    ['Compose\'s shape: a row cut to 948x33 at the list\'s TOP, its field running on above it', () => swiftClipped(node({ role: 'container', identifier: 'first_name_row', rect: { x: 132, y: 242, width: 948, height: 33 }, children: [node({ role: 'textfield', label: 'First name', rect: { x: 132, y: 115, width: 816, height: 160 } })] })), 'first_name_row', { kind: 'cut', edge: 'top', depth: 33 }],
    [
      'Create contact\'s "Company" 176,1373 190x25 flush with the IME-cut form\'s bottom, its field cut there 91 deep: not a sliver',
      () => {
        const field = node({ role: 'textfield', rect: { x: 132, y: 1307, width: 816, height: 91 }, children: [node({ role: 'other', rect: { x: 132, y: 1329, width: 816, height: 69 } }), node({ role: 'text', label: 'Company', identifier: 'company', rect: { x: 176, y: 1373, width: 190, height: 25 } }), node({ role: 'other', rect: { x: 176, y: 1340, width: 728, height: 58 } })] });
        const form = node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 242, width: 1080, height: 1156 }, children: [node({ role: 'container', rect: { x: 132, y: 1307, width: 948, height: 91 }, children: [field, node({ role: 'other', rect: { x: 948, y: 1346, width: 132, height: 52 } })] })] });
        return on(box(1080, 2220), form);
      },
      'company',
      { kind: 'reachable', at: { x: 271, y: 1386 } },
    ],
  ] as const)('%s', (_name, tree, id, expected) => {
    const t = tree();
    expect(said(sceneOf(t).standing(byId(t, id), PIXEL_BARE, TAP))).toEqual(expected);
  });

  it('a cut leaf shows no evidence (the stated residual): the plain stop stops on it', () => {
    const leaf = node({ role: 'container', identifier: 'details_toggle', rect: { x: 66, y: 1924, width: 948, height: 55 } });
    const t = swiftClipped(leaf);
    expect(said(sceneOf(t).standing(leaf, PIXEL_BARE, PLAIN))).toEqual({ kind: 'reachable', at: { x: 540, y: 1952 } });
  });
});

describe('Scene.standing — Compose labels under their own control, the bug note\'s snapshots (moved from the tap\'s tests)', () => {
  it.each([
    ['login dump', () => parseDump(COMPOSE.login), 'LOGIN', { x: 540, y: 1463 }],
    ['signIn dump', () => parseDump(COMPOSE.signIn), 'SIGN IN', { x: 541, y: 1869 }],
    ['discard dump', () => parseDump(COMPOSE.discard), 'DISCARD', { x: 776, y: 1253 }],
    ['noThanks dump', () => parseDump(COMPOSE.noThanks), 'No thanks', { x: 541, y: 2023 }],
    ['accountDetailTop', () => compose('accountDetailTop'), 'PAY', { x: 541, y: 716 }],
    ['accountDetailTop', () => compose('accountDetailTop'), 'PAY ME', { x: 224, y: 716 }],
    ['accountDetailTop', () => compose('accountDetailTop'), 'SCAN QR', { x: 857, y: 716 }],
    ['accountDetail', () => compose('accountDetail'), 'PAY', { x: 541, y: 292 }],
    ['accountDetail, the row cut at the tab bar\'s top', () => compose('accountDetail'), '+493', { x: 782, y: 1836 }],
    ['contactsSyncPromo', () => compose('contactsSyncPromo'), 'No thanks', { x: 541, y: 2023 }],
    ['contactsSyncPromo', () => compose('contactsSyncPromo'), 'Sync device and SIM contacts', { x: 540, y: 1891 }],
    ['contactsCreateStaged', () => compose('contactsCreateStaged'), 'Save', { x: 828, y: 155 }],
    ['contactsCreateStaged', () => compose('contactsCreateStaged'), 'Add phone', { x: 236, y: 968 }],
    ['contactsCreateStaged', () => compose('contactsCreateStaged'), 'Add fields', { x: 288, y: 2130 }],
    ['contactsCreate', () => compose('contactsCreate'), 'Add phone', { x: 236, y: 2114 }],
    // The ICON buttons: the label node under a control padded on all four sides.
    ['contactsCreateStaged, icon', () => compose('contactsCreateStaged'), 'Cancel', { x: 77, y: 154 }],
    ['contactsCreateStaged, icon', () => compose('contactsCreateStaged'), 'More options', { x: 1003, y: 154 }],
    ['contactsCreateStaged, icon', () => compose('contactsCreateStaged'), 'Delete', { x: 1014, y: 830 }],
    ['contactsCreate, icon', () => compose('contactsCreate'), 'Cancel', { x: 77, y: 154 }],
    ['contactsCreate, icon', () => compose('contactsCreate'), 'Delete', { x: 1014, y: 1976 }],
  ] as const)('%s — "%s": reachable at its centre for the tap and the plain stop', async (_name, tree, label, at) => {
    const t = await tree();
    const n = byId(t, label);
    expect([said(sceneOf(t).standing(n, PIXEL_BARE, TAP)), said(sceneOf(t).standing(n, PIXEL_BARE, PLAIN))]).toEqual([
      { kind: 'reachable', at },
      { kind: 'reachable', at },
    ]);
  });

  it('accountDetail: a row\'s label node clear of the tab bar is reachable for `fully: true`', async () => {
    const t = await compose('accountDetail');
    expect(said(sceneOf(t).standing(byId(t, 'Loan repayment, 04.01.2026, +91.00 EUR'), PIXEL_BARE, FULLY))).toMatchObject({ kind: 'reachable' });
  });
});

describe('Scene.standing for the stop — the status band and a keyboard line (moved from scroll_until\'s tests)', () => {
  it.each([
    // A row reaching into the band with its centre below it (36–88, centre (201,62)): the plain stop judges the centre and
    // stops; `fully` judges the band as a region (ADR 0009), and 26 pt of it lie under the bar.
    ['priority_select at 36, plain', () => swiftIdbAt(36), 'swift_payment.form.priority_select', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 62 } }],
    ['…fully: true: under the status bar, as a region', () => swiftIdbAt(36), 'swift_payment.form.priority_select', IPHONE, FULLY, { kind: 'systemBar', at: { x: 201, y: 62 }, bar: { edge: 'top', bottom: 62 }, band: box(402, 62) }],
    // No band read (an Android adapter): the row at -20 stops, its centre (201,6) on the screen.
    ['…at -20 with no band read, plain', () => swiftIdbAt(-20), 'swift_payment.form.priority_select', IPHONE_BARE, PLAIN, { kind: 'reachable', at: { x: 201, y: 6 } }],
    // Full-bleed content at the top: the plain stop's ROUNDED centre decides — 0,0 402x123 (61.5 sent as 62) stops,
    // 402x122 (61) does not; `fully` likewise — the region rule exempts content no scroll lifts out of the band.
    ['a hero 0,0 402x300, plain', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 300) })), 'hero', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 150 } }],
    ['a hero 0,0 402x123, plain', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 123) })), 'hero', IPHONE, PLAIN, { kind: 'reachable', at: { x: 201, y: 62 } }],
    ['a hero 0,0 402x122, plain: under the status bar', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 122) })), 'hero', IPHONE, PLAIN, { kind: 'systemBar', at: { x: 201, y: 61 }, bar: { edge: 'top', bottom: 62 } }],
    ['a hero 0,0 402x300, fully: true: reachable — a full-bleed header in no scroll view, which no scroll lifts out of the band', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 300) })), 'hero', IPHONE, FULLY, { kind: 'reachable', at: { x: 201, y: 150 } }],
    ['a hero 0,0 402x123, fully: true: likewise', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 123) })), 'hero', IPHONE, FULLY, { kind: 'reachable', at: { x: 201, y: 62 } }],
    // Not full-bleed (inset 10 a side): the region rule holds.
    ['a card 10,0 382x300, fully: true: under the status bar, as a region', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: { x: 10, y: 0, width: 382, height: 300 } })), 'hero', IPHONE, FULLY, { kind: 'systemBar', at: { x: 201, y: 150 }, bar: { edge: 'top', bottom: 62 }, band: box(402, 62) }],
    // Android 15+'s edge-to-edge app bar under the 66-px band, and a screen-sized root: `fully` stops on each as before.
    ['an edge-to-edge app bar 0,0 1080x210, fully: true: reachable', () => on(box(1080, 2220), node({ role: 'container', identifier: 'hero', rect: box(1080, 210) })), 'hero', PIXEL_NAV, FULLY, { kind: 'reachable', at: { x: 540, y: 105 } }],
    // Screen-sized but not laid from the top edge (0,40 1080x2180, into both bands): stops as before too.
    ['a screen-sized node 0,40 1080x2180 into both bands, fully: true: reachable', () => on(box(1080, 2220), node({ role: 'container', identifier: 'hero', rect: { x: 0, y: 40, width: 1080, height: 2180 } })), 'hero', PIXEL_NAV, FULLY, { kind: 'reachable', at: { x: 540, y: 1130 } }],
    // In a scroll view the same shapes are content a scroll lifts out of the band: `fully` strokes on.
    ['a list row 0,0 1080x150 in a scroll view, fully: true: under the status bar, as a region', () => inList(box(1080, 2220), { x: 0, y: 0, width: 1080, height: 150 }), 'hero', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 75 }, bar: { edge: 'top', bottom: 66 }, band: box(1080, 66) }],
    ['a screen-sized 0,160 1080x2000 in a scroll view (it fits between the bands), fully: true: under the navigation bar, as a region', () => inList(box(1080, 2220), { x: 0, y: 160, width: 1080, height: 2000 }), 'hero', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 1160 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    // …unless it is taller than the room between the bands (2220 − 66 − 66 = 2088): no scroll lifts all of it out, and it stops as before.
    ['a screen-sized 0,0 1080x2100 in a scroll view, taller than the room between the bands, fully: true: reachable', () => inList(box(1080, 2220), { x: 0, y: 0, width: 1080, height: 2100 }), 'hero', PIXEL_NAV, FULLY, { kind: 'reachable', at: { x: 540, y: 1050 } }],
    // idb's flat list cannot say whether a node lies in a scroll view (`inScroller` undefined): it counts as none.
    ['idb: a row 0,0 402x150 laid from the top edge at full width, fully: true: reachable (exempt)', () => idbRow(0), 'hero', IPHONE, FULLY, { kind: 'reachable', at: { x: 201, y: 75 } }],
    ['idb: the same row at 0,20, no full-bleed header, fully: true: under the status bar, as a region', () => idbRow(20), 'hero', IPHONE, FULLY, { kind: 'systemBar', at: { x: 201, y: 95 }, bar: { edge: 'top', bottom: 62 }, band: box(402, 62) }],
    // The bottom edge alike: a full-width surface reaching the screen's bottom in no scroll view (a bottom sheet) stops at once; in one, it is lifted.
    ['a bottom sheet 0,1100 1080x1120 in no scroll view, fully: true: reachable', () => on(box(1080, 2220), node({ role: 'container', identifier: 'hero', rect: { x: 0, y: 1100, width: 1080, height: 1120 } })), 'hero', PIXEL_NAV, FULLY, { kind: 'reachable', at: { x: 540, y: 1660 } }],
    ['…the same surface in a scroll view: under the navigation bar, as a region', () => inList(box(1080, 2220), { x: 0, y: 1100, width: 1080, height: 1120 }), 'hero', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 1660 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['…a full-width surface short of the bottom edge (0,1100 1080x1100) in no scroll view: under the navigation bar, as a region', () => on(box(1080, 2220), node({ role: 'container', identifier: 'hero', rect: { x: 0, y: 1100, width: 1080, height: 1100 } })), 'hero', PIXEL_NAV, FULLY, { kind: 'systemBar', at: { x: 540, y: 1650 }, bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } }],
    ['a hero 0,0 402x122, fully: true: its centre under the status bar (the centre\'s rule, no region)', () => on(box(402, 874), node({ role: 'image', identifier: 'hero', rect: box(402, 122) })), 'hero', IPHONE, FULLY, { kind: 'systemBar', at: { x: 201, y: 61 }, bar: { edge: 'top', bottom: 62 } }],
  ] as const)('%s', async (_name, tree, id, screen, purpose, expected) => {
    const t = await tree();
    expect(said(sceneOf(t).standing(byId(t, id), screen, purpose))).toEqual(expected);
  });

  const BAR = (y: number, height: number) => node({ role: 'button', label: 'Bar', identifier: 'bar', rect: { x: 0, y, width: 402, height } });
  const ROW = (y: number, height: number) => node({ role: 'button', identifier: 'row', rect: { x: 24, y, width: 354, height } });
  it.each([
    // A centre under WDA's band (572) stops a plain scroll — the tap's guard hides the keyboard — and a bar there is no cover of it.
    ['a row 550–610, its centre under the band, a bar at 560–640: plain, reachable', () => on(box(402, 874), ROW(550, 60), BAR(560, 80)), PLAIN, { kind: 'reachable', at: { x: 201, y: 580 } }],
    ['a row 560–620 under the band, no bar: plain, reachable', () => on(box(402, 874), ROW(560, 60)), PLAIN, { kind: 'reachable', at: { x: 201, y: 590 } }],
    // A bar under the keyboard is no cover: the frame is the screen above the band.
    ['a row 400–452, CONTINUE at 780 under the band: fully: true, reachable', () => on(box(402, 874), ROW(400, 52), BAR(780, 44)), FULLY, { kind: 'reachable', at: { x: 201, y: 426 } }],
  ] as const)('under a witnessed keyboard line at 572: %s', (_name, tree, purpose, expected) => {
    const t = tree();
    expect(said(sceneOf(t).standing(byId(t, 'row'), IPHONE, { ...purpose, keyboardTop: wda(572) }))).toEqual(expected);
  });
});

describe('Scene.standing — the purpose names the answer\'s union', () => {
  it('the pixel purpose answers a PixelStanding (its band, bar and reach always there, its own cut at a bar); both stops a Standing; the tap a Standing never `clipped`', () => {
    const root = node({ rect: box(402, 874) });
    const scene = sceneOf(root);
    expectTypeOf(scene.standing(root, undefined, { of: 'pixel', reads: root.rect, glyphs: true })).toEqualTypeOf<PixelStanding>();
    expectTypeOf(scene.standing(root, undefined, PLAIN)).toEqualTypeOf<Standing>();
    expectTypeOf(scene.standing(root, undefined, FULLY)).toEqualTypeOf<Standing>();
    expectTypeOf(scene.standing(root, undefined, { of: 'tap' })).toEqualTypeOf<TapStanding>();
    // The pixel purpose takes the usable screen: a bare standing screen (no `oriented`) is refused.
    // @ts-expect-error
    void (() => scene.standing(root, { box: root.rect, boxes: [root.rect] }, { of: 'pixel', reads: root.rect, glyphs: true }));
    expectTypeOf<TapStanding['kind']>().toEqualTypeOf<'reachable' | 'offScreen' | 'systemBar' | 'cut' | 'covered' | 'underKeyboard'>();
    expectTypeOf<Extract<TapStanding, { kind: 'reachable' }>>().toEqualTypeOf<Extract<Standing, { kind: 'reachable' }>>();
    expectTypeOf<Extract<PixelStanding, { kind: 'cut' }>['bar']>().toEqualTypeOf<{ readonly edge: 'bottom'; readonly top: number }>();
    expectTypeOf<Extract<PixelStanding, { kind: 'covered' }>['reach']>().toEqualTypeOf<Rect>();
    expectTypeOf<Extract<PixelStanding, { kind: 'systemBar' }>['band']>().toEqualTypeOf<Rect>();
    expectTypeOf<Extract<PixelStanding, { kind: 'underKeyboard' }>['band']>().toEqualTypeOf<Rect>();
    expectTypeOf<PixelStanding['kind']>().toEqualTypeOf<'reachable' | 'systemBar' | 'cut' | 'covered' | 'underKeyboard'>();
  });
});

/**
 * The frames `scroll_until`'s far edge is judged in (`farEdgeFrames`): each box below the status band on its own
 * shape, the screen above an applied cover instead when it leaves something, and above the navigation band only for a
 * `fully` stop the band's REGION refused at the bottom — cut on the first box's shape (the shapes kept).
 */
describe('farEdgeFrames — the far edge\'s frames, cut by standing\'s own band cut', () => {
  const UPRIGHT = box(1080, 2220);
  const TURNED = box(2220, 1080);
  const ANDROID: StandingScreen = { box: UPRIGHT, boxes: [UPRIGHT], statusBand: 66, navigationBand: 2154 };
  /** A full-width row on the 1080x2220 phone at `y`, `height` high, judged for `purpose` on `screen`. */
  const rowAt = (y: number, height: number, purpose: TouchPurpose, screen: StandingScreen = ANDROID): Standing => {
    const r = node({ role: 'button', identifier: 'row', rect: { x: 0, y, width: 1080, height } });
    return sceneOf(node({ role: 'container', rect: UPRIGHT, children: [r] })).standing(r, screen, purpose);
  };
  const BELOW_STATUS = { x: 0, y: 66, width: 1080, height: 2154 };

  it('no bands, no cover, no best: every box as it is', () => {
    expect(farEdgeFrames({ box: UPRIGHT, boxes: [UPRIGHT, TURNED] }, undefined)).toEqual({ frames: [UPRIGHT, TURNED], uncutFrames: [UPRIGHT, TURNED] });
  });
  it('each box below the status band on its own shape: the upright box cut, the turned one (landscape) not', () => {
    const screen: StandingScreen = { box: UPRIGHT, boxes: [UPRIGHT, TURNED], statusBand: 66 };
    expect(farEdgeFrames(screen, undefined)).toEqual({ frames: [BELOW_STATUS, TURNED], uncutFrames: [BELOW_STATUS, TURNED] });
  });
  it('above an applied cover: the first box\'s x, y and width, the cover\'s top y as the HEIGHT (not the top less the box\'s y), below the status band', () => {
    const lowered = { x: 0, y: 100, width: 402, height: 874 };
    expect(farEdgeFrames({ box: lowered, boxes: [lowered] }, undefined, { width: 402, height: 500 }).frames).toEqual([{ x: 0, y: 100, width: 402, height: 500 }]);
    expect(farEdgeFrames(IPHONE, undefined, { width: 402, height: 500 }).frames).toEqual([{ x: 0, y: 62, width: 402, height: 438 }]);
  });
  it('a cover leaving nothing above it (no `above`): every box, uncut by the keyboard', () => {
    const screen: StandingScreen = { box: UPRIGHT, boxes: [UPRIGHT, TURNED], statusBand: 66 };
    expect(farEdgeFrames(screen, undefined, undefined).frames).toEqual([BELOW_STATUS, TURNED]);
  });
  it('a `fully` stop the navigation band\'s REGION refused (a row across its top, its centre clear): the frames cut above the band too, the short-of frames not', () => {
    const best = rowAt(2100, 100, FULLY);
    expect(said(best)).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom', top: 2154 }, band: { x: 0, y: 2154, width: 1080, height: 66 } });
    expect(farEdgeFrames(ANDROID, best)).toEqual({ frames: [{ x: 0, y: 66, width: 1080, height: 2088 }], uncutFrames: [BELOW_STATUS] });
  });
  it('no navigation cut for any other standing: the same row\'s plain stop (reachable), a centre in the band (no region), a `fully` region at the TOP', () => {
    const uncut = { frames: [BELOW_STATUS], uncutFrames: [BELOW_STATUS] };
    expect(farEdgeFrames(ANDROID, rowAt(2100, 100, PLAIN))).toEqual(uncut);
    const centreIn = rowAt(2160, 50, FULLY);
    expect(said(centreIn)).toMatchObject({ kind: 'systemBar', bar: { edge: 'bottom' } });
    expect(farEdgeFrames(ANDROID, centreIn)).toEqual(uncut);
    const top = rowAt(40, 200, FULLY);
    expect(said(top)).toMatchObject({ kind: 'systemBar', bar: { edge: 'top' }, band: { x: 0, y: 0, width: 1080, height: 66 } });
    expect(farEdgeFrames(ANDROID, top)).toEqual(uncut);
  });
  it('two boxes: the navigation band cut on the FIRST box\'s shape — a landscape first box cuts neither, the upright second box included', () => {
    const wide = box(1000, 600);
    const tall = box(600, 1000);
    const screen: StandingScreen = { box: wide, boxes: [wide, tall], navigationBand: 900 };
    const best = rowAt(2100, 100, FULLY);
    expect(farEdgeFrames(screen, best)).toEqual({ frames: [wide, tall], uncutFrames: [wide, tall] });
    // Cut on its own shape, the upright box would lose its bottom 100: the first box's shape decides, as the round always did.
    expect(farEdgeFrames({ box: tall, boxes: [tall], navigationBand: 900 }, best).frames).toEqual([{ x: 0, y: 0, width: 600, height: 900 }]);
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

/**
 * D2: idb's band is a keyboard line no reading stands by (`witnessed: false`), so no guard acts on a point under it —
 * a centre under it is UNDER THE KEYBOARD for the tap and for both stops; under a witnessed line (WDA's band, the
 * window's) the plain stop stays on its centre and the tap's guard hides the keyboard.
 */
describe('Scene.standing — a centre under idb\'s band line is under the keyboard (D2)', () => {
  /** run2-ios #250, the SWIFT form with the number pad (band 0,589 402x285; keys from 596), value_date_select moved to `y`. */
  const pad = async (y: number) => {
    const t = parseIdbDescribeAll(JSON.stringify(JSON.parse(await fixture('idb-swift-form-number-pad.json')).elements));
    const row = byId(t, 'swift_payment.form.value_date_select');
    (row as { rect: Rect }).rect = { ...row.rect, y };
    return { t, row };
  };
  it('the 589–596 strip between the band\'s top and the keys: centre (201,591), under no key — the tap and the plain stop: under the keyboard; with no line, reachable (the residual D2 closes)', async () => {
    const { t, row } = await pad(565);
    expect(said(sceneOf(t).standing(row, IPHONE, TAP))).toEqual({ kind: 'reachable', at: { x: 201, y: 591 } });
    expect(said(sceneOf(t).standing(row, IPHONE, { ...TAP, keyboardTop: idb(589) }))).toEqual({ kind: 'underKeyboard', top: 589, source: 'idb-band' });
    expect(said(sceneOf(t).standing(row, IPHONE, { ...PLAIN, keyboardTop: idb(589) }))).toEqual({ kind: 'underKeyboard', top: 589, source: 'idb-band' });
    expect(said(sceneOf(t).standing(row, IPHONE, { ...FULLY, keyboardTop: idb(589) }))).toEqual({ kind: 'clipped', edges: ['bottom'] });
  });
  it('a centre under a key (`5`): under the keyboard, the key named by no kind — no tap moved above it either', async () => {
    const { t, row } = await pad(640);
    expect(said(sceneOf(t).standing(row, IPHONE, TAP))).toMatchObject({ kind: 'covered', cover: '5' });
    const tap = sceneOf(t).standing(row, IPHONE, { ...TAP, keyboardTop: idb(589) });
    expect(said(tap)).toEqual({ kind: 'underKeyboard', top: 589, source: 'idb-band' });
    expect(tap.facts.covers).toEqual([]);
    expect(tap.facts.screen).toEqual({ x: 0, y: 62, width: 402, height: 527 });
    expect(said(sceneOf(t).standing(row, IPHONE, { ...PLAIN, keyboardTop: idb(589) }))).toEqual({ kind: 'underKeyboard', top: 589, source: 'idb-band' });
  });
  it('the same centre under a WITNESSED line: the plain stop stays on it (the guard hides the keyboard); the tap is judged as before', async () => {
    const { t, row } = await pad(565);
    expect(said(sceneOf(t).standing(row, IPHONE, { ...PLAIN, keyboardTop: wda(589) }))).toEqual({ kind: 'reachable', at: { x: 201, y: 591 } });
    expect(said(sceneOf(t).standing(row, IPHONE, { ...TAP, keyboardTop: wda(589) }))).toEqual(said(sceneOf(t).standing(row, IPHONE, TAP)));
  });
  it('a centre above the line, covered by the lifted CONTINUE (M-1.4): covered, nothing above the keyboard shows — as when the line came only with the cover', async () => {
    const { t, row } = await pad(545);
    const s = sceneOf(t).standing(row, IPHONE, { ...TAP, keyboardTop: idb(589) });
    expect(said(s)).toEqual({ kind: 'covered', cover: 'swift_payment.form.continue_button' });
    expect(s.kind === 'covered' && s.aboveKeyboard).toBe(true);
    expect(said(sceneOf(t).standing(row, IPHONE, { ...PLAIN, keyboardTop: idb(589) }))).toEqual({ kind: 'covered', cover: 'swift_payment.form.continue_button' });
  });
  it('the owner\'s decision: a centre under the band is refused even with a large piece above it — a row 520–680 (centre (201,600) under key `K`), 362x70 of it above the band: moved without the line, under the keyboard with it', () => {
    const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number, AXUniqueId: string | null = null) => ({ type, AXLabel, AXUniqueId, frame: { x, y, width, height } });
    const t = parseIdbDescribeAll(
      JSON.stringify([
        el('Application', 'App', 0, 0, 402, 874),
        el('Button', 'Row', 20, 520, 362, 160, 'tall'),
        el('Button', 'K', 180, 594, 44, 40),
        ...['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((k, i) => el('Button', k, 2 + 40 * i, 640, 38, 46)),
        el('Other', null, 0, 590, 402, 284),
      ]),
    );
    const row = byId(t, 'tall');
    const without = sceneOf(t).standing(row, IPHONE, TAP);
    expect(without.kind === 'reachable' && without.moved !== undefined).toBe(true);
    const s = sceneOf(t).standing(row, IPHONE, { ...TAP, keyboardTop: idb(590) });
    expect(said(s)).toEqual({ kind: 'underKeyboard', top: 590, source: 'idb-band' });
    expect(s.facts.screen).toEqual({ x: 0, y: 62, width: 402, height: 528 });
  });
  it('a centre above the line and clear: reachable at it, whatever lies under the line', async () => {
    const { t } = await pad(545);
    const iban = byId(t, 'IBAN*');
    expect(said(sceneOf(t).standing(iban, IPHONE, { ...TAP, keyboardTop: idb(589) }))).toEqual(said(sceneOf(t).standing(iban, IPHONE, TAP)));
  });
});

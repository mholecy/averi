import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { FLAT_LIST_TOP_BAR_FRACTION } from '../../src/ui-tree/draw-order.js';
import { accessoryDismissButton, flatListKeyboardBand, KEYBOARD_BAND_BAR_FRACTION, keyboardBandTop, keyboardInTree } from '../../src/ui-tree/soft-keyboard.js';
import { CLASSIC_VIEWS } from '../helpers/synthetic-android-trees.js';
import { node, screen } from '../helpers/fake.js';

// The tree's own marks (ui-tree/soft-keyboard.ts). The reading built over
// them — the switch between the oracle and the tree, the floating panel,
// the veto, which nodes are the keyboard's own — is pinned through its
// interface in tests/ui-tree/keyboard-cover.test.ts (2026-10-09).

describe('keyboardInTree — what the tree says about the soft keyboard (2026-10-07)', () => {
  const BAND = { x: 0, y: 539, width: 402, height: 335 };

  it('a keyboard node with area → shown, with a COPY of its rect as the frame', () => {
    const band = node({ role: KEYBOARD_ROLE, rect: { ...BAND } });
    const reading = keyboardInTree(screen(node({ role: 'button', identifier: 'x' }), band));
    expect(reading).toEqual({ state: 'shown', frame: BAND });
    if (reading.state !== 'shown') throw new Error('unreachable');
    expect(reading.frame).not.toBe(band.rect); // nodes are mutated downstream; the frame is quoted after the fact
  });

  it('no keyboard node → unknown, not hidden: an idb tree never marks one (iOS 27 lists the keys, unmarked) and the tree cannot say which source it came from', () => {
    expect(keyboardInTree(screen(node({ role: 'button', identifier: 'x' })))).toEqual({ state: 'unknown' });
  });

  it('a zero-area keyboard node is not a keyboard on screen', () => {
    expect(keyboardInTree(screen(node({ role: KEYBOARD_ROLE, rect: { x: 0, y: 874, width: 402, height: 0 } })))).toEqual({ state: 'unknown' });
  });

  it('the first keyboard node in pre-order is the one read (a second — iPad split, unmeasured — is a residual)', () => {
    const second = { x: 0, y: 700, width: 402, height: 174 };
    const tree = screen(node({ role: 'container', children: [node({ role: KEYBOARD_ROLE, rect: { ...BAND } })] }), node({ role: KEYBOARD_ROLE, rect: second }));
    expect(keyboardInTree(tree)).toEqual({ state: 'shown', frame: BAND });
  });

  it('the role is the one string the adapter writes: a container with the band\'s rect is not a keyboard', () => {
    expect(KEYBOARD_ROLE).toBe('keyboard');
    expect(keyboardInTree(screen(node({ role: 'container', rect: { ...BAND } })))).toEqual({ state: 'unknown' });
  });
});

/**
 * The rule on synthetic shapes (the real dumps are pinned in
 * tests/adapters/wda-source-keyboard.test.ts): the measured 2FA layout —
 * the app's Window, the input-host Window (ofKeyboard) with the Toolbar,
 * the keyboard's Window (ofKeyboard) with the band — in the fake's node
 * vocabulary.
 */
describe('accessoryDismissButton — the input-accessory toolbar\'s trailing button (stage B, 2026-10-07)', () => {
  const button = (label: string, rect = { x: 317, y: 523, width: 64, height: 38 }) => node({ role: 'button', label, rect });
  const toolbar = (...buttons: UiNode[]) =>
    node({ role: 'toolbar', identifier: 'Toolbar', rect: { x: 0, y: 518, width: 402, height: 48 }, children: [node({ role: 'container', rect: { x: 16, y: 518, width: 370, height: 48 }, children: buttons })] });
  const host = (...children: UiNode[]) => node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children });
  const band = (...children: UiNode[]) => node({ role: KEYBOARD_ROLE, rect: { x: 0, y: 518, width: 402, height: 356 }, children });
  const keyboardWindow = (...children: UiNode[]) => host(band(...children));
  const app = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', identifier: 'submit', rect: { x: 225, y: 451, width: 141, height: 48 } })] });

  it('the toolbar under an ofKeyboard root: its last button in pre-order (a UIToolbar lays items leading to trailing; the measured one is a flexible space then Done)', () => {
    const cancel = button('Cancel', { x: 20, y: 523, width: 64, height: 38 });
    const done = button('Done');
    const tree = screen(app, host(toolbar(cancel, done)), keyboardWindow());
    expect(accessoryDismissButton(tree)).toBe(done);
  });

  it('a toolbar outside every ofKeyboard root (an app toolbar) is not an accessory', () => {
    const done = button('Done');
    const tree = screen(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [toolbar(done)] }), keyboardWindow());
    expect(accessoryDismissButton(tree)).toBeUndefined();
  });

  it('a toolbar INSIDE the band node is the keyboard\'s own, never the accessory — whatever its buttons say', () => {
    const tree = screen(app, keyboardWindow(toolbar(button('Done'))));
    expect(accessoryDismissButton(tree)).toBeUndefined();
  });

  it('a toolbar without area, or whose buttons have none, gives no tap point — nothing', () => {
    const flat = node({ role: 'toolbar', rect: { x: 0, y: 518, width: 402, height: 0 }, children: [button('Done')] });
    expect(accessoryDismissButton(screen(app, host(flat), keyboardWindow()))).toBeUndefined();
    expect(accessoryDismissButton(screen(app, host(toolbar(button('Done', { x: 317, y: 523, width: 0, height: 0 }))), keyboardWindow()))).toBeUndefined();
  });

  it('a toolbar with no button at all is skipped and a later one may answer; no toolbar → nothing', () => {
    const done = button('Done');
    const empty = node({ role: 'toolbar', rect: { x: 0, y: 500, width: 402, height: 18 } });
    expect(accessoryDismissButton(screen(app, host(empty, toolbar(done)), keyboardWindow()))).toBe(done);
    expect(accessoryDismissButton(screen(app, host(), keyboardWindow()))).toBeUndefined();
  });
});

/**
 * idb's keyboard band, by its shape (round 7, 2026-10-10: moved from ui-tree/draw-order.ts's private `keyboardOf`, whose
 * own pins stay in tests/ui-tree/draw-order.test.ts). Known outside draw-order as a TOP EDGE only — for the stroke box
 * and the tap's chrome cut — never as "the keyboard is shown": the in-tree reading stays `unknown` on idb (K5d).
 */
describe('keyboardBandTop — the top edge of idb\'s keyboard band, and nothing more (round 7)', () => {
  /** run2-ios #250: the SWIFT form with the number pad up, as idb lists it (`Keyboard 0,589 402x285` last, after `1`…`Delete`). */
  const pad = async () => parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  /** idb's flat list: a 0×0 root marked `flatList`, the Application first. */
  const flat = (...children: UiNode[]): UiNode => node({ role: 'container', rect: r(0, 0, 0, 0), flatList: true, children: [node({ role: 'other', label: 'Contacts', rect: r(0, 0, 402, 874) }), ...children] });
  /** Contacts' New Contact with QWERTY up (docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md): `add url` below the fold, keys, the band `other 0,590 402x284`, then Dictate. */
  const contacts = () =>
    flat(
      node({ role: 'textfield', label: 'First name', rect: r(20, 200, 362, 44) }),
      node({ role: 'button', label: 'add url', rect: r(20, 902, 362, 51) }),
      ...['Z', 'X', 'C', 'V'].map((label, i) => node({ role: 'button', label, rect: r(48 + 40 * i, 714, 36, 46) })),
      node({ role: 'other', rect: r(0, 590, 402, 284) }),
      node({ role: 'button', label: 'Dictate', rect: r(325, 805, 68, 69) }),
    );

  it('the measured number pad (run2-ios #250): 589, the background\'s top — the keys `1`…`Delete` and the background are the run', async () => {
    const tree = await pad();
    expect(keyboardBandTop(tree)).toBe(589);
    const nodes = [tree, ...tree.children];
    const band = flatListKeyboardBand(nodes, r(0, 0, 402, 874), 874 * FLAT_LIST_TOP_BAR_FRACTION)!;
    expect(nodes.slice(band.from, band.to).map((n) => n.label ?? n.role)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'Delete', 'other']);
  });

  it('Contacts\' QWERTY (run3-ios #45/#51, run8-ios #233 shape): 590, Dictate listed after the background inside the run', () => {
    expect(keyboardBandTop(contacts())).toBe(590);
  });

  it('an app\'s own PIN pad with no background (run5-ios #81): no band — the pad is content', () => {
    const keys = [1, 2, 3].map((d, i) => node({ role: 'button', label: String(d), rect: r(40 + 110 * i, 600, 100, 80) }));
    expect(keyboardBandTop(flat(node({ role: 'text', label: 'Enter PIN', rect: r(120, 300, 160, 30) }), ...keys))).toBeUndefined();
  });

  it('a tree that is not idb\'s flat list never has one — WDA marks its band itself, Android\'s keyboard is never in the tree: the same nodes nested, the measured WDA keyboard, an Android dump with the keyboard up', async () => {
    const nested = contacts();
    delete nested.flatList;
    nested.rect = r(0, 0, 402, 874);
    expect(keyboardBandTop(nested)).toBeUndefined();
    expect(keyboardBandTop(parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-login-keyboard.json', import.meta.url), 'utf8')))).toBeUndefined();
    expect(keyboardBandTop(parseUiautomatorXml(CLASSIC_VIEWS.loginImeUp))).toBeUndefined();
  });

  it('a band top is not a keyboard reading: keyboardInTree still says `unknown` of both idb keyboards — the in-tree dismissal presses nothing there (K5d)', async () => {
    expect(keyboardInTree(await pad())).toEqual({ state: 'unknown' });
    expect(keyboardInTree(contacts())).toEqual({ state: 'unknown' });
  });

  it('its top-bar line is draw-order\'s: the two fractions agree (soft-keyboard.ts cannot import draw-order.ts, which imports it)', () => {
    expect(KEYBOARD_BAND_BAR_FRACTION).toBe(FLAT_LIST_TOP_BAR_FRACTION);
  });
});

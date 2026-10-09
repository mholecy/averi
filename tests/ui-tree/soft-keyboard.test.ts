import { describe, expect, it } from 'vitest';
import { KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
import { accessoryDismissButton, keyboardInTree } from '../../src/ui-tree/soft-keyboard.js';
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

  it('no keyboard node → unknown, not hidden: an idb tree never carries one and the tree cannot say which source it came from', () => {
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

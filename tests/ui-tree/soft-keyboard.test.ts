import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYBOARD_ROLE, type KeyboardTouchable, type UiNode } from '../../src/adapters/types.js';
import { accessoryDismissButton, highestCover, keyboardInTree, keyboardRects, oracleKeyboard, panelsBeyond, partOfKeyboard, readSoftKeyboard, regionRefusalText } from '../../src/ui-tree/soft-keyboard.js';
import { parseTouchableRegion } from '../../src/adapters/android.js';
import { GBOARD, GBOARD_PANEL, GBOARD_STRIP } from '../helpers/android-dumps.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

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

describe('partOfKeyboard — is the node the keyboard\'s own UI (review 2026-10-07)', () => {
  const key = node({ role: 'other', label: 'q', rect: { x: 4, y: 590, width: 40, height: 54 } });
  const done = node({ role: 'button', label: 'Done', rect: { x: 317, y: 523, width: 64, height: 38 } });
  const submit = node({ role: 'button', identifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } });
  const keyboardWindow = node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'container', children: [key] })] });
  const hostWindow = node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [done] });
  const appWindow = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [submit] });
  const tree = screen(appWindow, hostWindow, keyboardWindow);

  it('a descendant of a marked root, at any depth, is part of the keyboard; the mark itself too', () => {
    expect(partOfKeyboard(tree, key)).toBe(true);
    expect(partOfKeyboard(tree, done)).toBe(true);
    expect(partOfKeyboard(tree, keyboardWindow)).toBe(true);
  });

  it('a node under an unmarked root is not — even inside the band\'s rect', () => {
    expect(partOfKeyboard(tree, submit)).toBe(false);
    expect(partOfKeyboard(tree, appWindow)).toBe(false);
  });

  it('by identity: an equal node the tree does not hold is not part of its keyboard', () => {
    expect(partOfKeyboard(tree, { ...key })).toBe(false);
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

describe('readSoftKeyboard — the one switch between the oracle and the tree (review 2026-10-07)', () => {
  const BAND = { x: 0, y: 539, width: 402, height: 335 };
  const submit = node({ role: 'button', identifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } });
  const key = node({ role: 'other', label: 'q', rect: { x: 4, y: 590, width: 40, height: 54 } });
  const tree = screen(submit, node({ role: 'container', ofKeyboard: true, children: [node({ role: KEYBOARD_ROLE, rect: { ...BAND } }), key] }));
  const noOracle = () => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.keyboard = undefined;
    fake.keyboardAdvice = 'why not, and what to do';
    return fake;
  };

  it('no oracle: the tree\'s band, dismissal none, the adapter\'s advice', async () => {
    expect(await readSoftKeyboard(noOracle(), tree, submit)).toEqual({ keyboard: { state: 'shown', frame: BAND }, dismissal: 'none', advice: 'why not, and what to do' });
  });

  it('no oracle, no advice on the adapter: advice undefined, the reading unchanged', async () => {
    const fake = noOracle();
    fake.keyboardAdvice = undefined;
    expect(await readSoftKeyboard(fake, tree, submit)).toEqual({ keyboard: { state: 'shown', frame: BAND }, dismissal: 'none', advice: undefined });
  });

  it('a subject that is the keyboard\'s own UI reads unknown, whatever the tree shows', async () => {
    expect((await readSoftKeyboard(noOracle(), tree, key)).keyboard).toEqual({ state: 'unknown' });
  });

  it('with the oracle: its one state() query, dismissal back, no advice, and the tree is never read — nor the oracle asked for a keyboard-side subject', async () => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.attachKeyboard({ state: 'hidden' });
    fake.keyboardAdvice = 'ignored with an oracle';
    expect(await readSoftKeyboard(fake, tree, submit)).toEqual({ keyboard: { state: 'hidden' }, dismissal: 'back', advice: undefined });
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
    expect((await readSoftKeyboard(fake, tree, key)).keyboard).toEqual({ state: 'unknown' });
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
    expect(fake.attachedKeyboard.touchableAnswers.queries).toBe(0); // hidden: the region is never asked
  });
});

/** What the adapter's touchable() returns for a measured fixture: its own parsers over the real text. */
const touchableOf = (out: string, witness: KeyboardTouchable['witness']): KeyboardTouchable => ({ witness, region: parseTouchableRegion(out) });

describe('panelsBeyond — which rects of the keyboard window count beside the band (the floating-Gboard device check, 2026-10-08)', () => {
  const DOCKED_BAND = { x: 0, y: 1398, width: 1080, height: 822 };

  it('floating, the input method saying shown: the panel — the strip, being the band, is not repeated; nothing refused', () => {
    expect(panelsBeyond(GBOARD_STRIP, touchableOf(GBOARD.floating.touchable, 'shown'))).toStrictEqual({ panels: [GBOARD_PANEL] });
  });

  it('docked: the region IS the band — nothing beyond it and nothing to say, the reading as before this date', () => {
    expect(panelsBeyond(DOCKED_BAND, touchableOf(GBOARD.docked.touchable, 'shown'))).toStrictEqual({ panels: [] });
    // Even with the input method not saying shown: there was nothing beyond the band to refuse.
    expect(panelsBeyond(DOCKED_BAND, touchableOf(GBOARD.docked.touchable, 'unknown'))).toStrictEqual({ panels: [] });
  });

  it.each([
    ['the input method says hidden', 'hidden' as const],
    ['the input method could not be asked (unknown — no veto, but no evidence either)', 'unknown' as const],
  ])('nothing unless the input method says SHOWN in the same call: %s — and the refusal says so', (_name, witness) => {
    expect(panelsBeyond(GBOARD_STRIP, touchableOf(GBOARD.floating.touchable, witness))).toEqual({ panels: [], refused: { kind: 'witness-not-shown', witness } });
  });

  it('nothing from a region that does not hold the band exactly — the stale landscape one, the hidden strip beside a docked band', () => {
    const noBand = { panels: [], refused: { kind: 'no-band-rect' } };
    expect(panelsBeyond(DOCKED_BAND, touchableOf(GBOARD.staleLandscape.touchable, 'shown'))).toEqual(noBand);
    expect(panelsBeyond(DOCKED_BAND, touchableOf(GBOARD.hidden.touchable, 'shown'))).toEqual(noBand);
    // A strip one pixel off the inset frame (another nav mode, unmeasured): the whole region is dropped, said.
    expect(panelsBeyond({ ...GBOARD_STRIP, y: 2089, height: 131 }, touchableOf(GBOARD.floating.touchable, 'shown'))).toEqual(noBand);
    // The stale rect beside a band it does hold: it does not fit the screen the band spans (2220 > 1080 wide).
    expect(panelsBeyond(GBOARD_STRIP, { witness: 'shown', region: [GBOARD_PANEL, { x: 0, y: 948, width: 2220, height: 132 }, GBOARD_STRIP] })).toEqual({
      panels: [GBOARD_PANEL],
      refused: { kind: 'rects-dropped', dropped: 1 },
    });
  });

  it('an unreadable region is none — said only when the input method answered (the call ran); a zero-area or off-screen rect is dropped', () => {
    expect(panelsBeyond(GBOARD_STRIP, { witness: 'shown', region: undefined })).toEqual({ panels: [], refused: { kind: 'unreadable' } });
    expect(panelsBeyond(GBOARD_STRIP, { witness: 'unknown', region: undefined })).toStrictEqual({ panels: [] });
    const flat = { x: 359, y: 1269, width: 681, height: 0 };
    const negative = { x: -10, y: 1269, width: 100, height: 100 };
    const below = { x: 0, y: 2200, width: 100, height: 100 };
    expect(panelsBeyond(GBOARD_STRIP, { witness: 'shown', region: [flat, negative, below, GBOARD_PANEL, GBOARD_STRIP] }).panels).toEqual([GBOARD_PANEL]);
  });

  it('each refusal is rendered in one place, regionRefusalText — the notice\'s clause per case', () => {
    expect(regionRefusalText({ kind: 'unreadable' })).toBe('the region could not be read');
    expect(regionRefusalText({ kind: 'witness-not-shown', witness: 'hidden' })).toBe('the input method said hidden in the same call');
    expect(regionRefusalText({ kind: 'witness-not-shown', witness: 'unknown' })).toBe('the input method said unknown in the same call');
    expect(regionRefusalText({ kind: 'no-band-rect' })).toBe('no rect of it is the band');
    expect(regionRefusalText({ kind: 'rects-dropped', dropped: 2 })).toBe('2 of its rects lie outside the screen the band spans, or have no area');
  });

  it('keyboardRects is the band, then the panels; highestCover the one whose top is highest (ties keep the band)', () => {
    const floating = { state: 'shown' as const, frame: GBOARD_STRIP, panels: [GBOARD_PANEL] };
    expect(keyboardRects(floating)).toEqual([GBOARD_STRIP, GBOARD_PANEL]);
    expect(highestCover(floating)).toEqual(GBOARD_PANEL);
    expect(highestCover({ state: 'shown', frame: DOCKED_BAND })).toBe(DOCKED_BAND);
    expect(highestCover({ state: 'shown', frame: DOCKED_BAND, panels: [{ ...DOCKED_BAND, x: 1 }] })).toBe(DOCKED_BAND);
  });
});

describe('oracleKeyboard — a refused region is said once on stderr, nothing else changes (review 2026-10-08)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('one `averi:` line per distinct case, naming the region, the band and the reason; an admitted panel or a docked band says nothing', async () => {
    // A band and region no other test in this file uses: the notices are kept once per PROCESS (a module-level
    // set), so a line another test had already printed would not be printed here, whatever the order.
    const band = { x: 0, y: 2101, width: 1080, height: 119 };
    const panel = { x: 17, y: 1203, width: 611, height: 577 };
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = new FakeAdapter({ s: screen() }, 's');
    const oracle = fake.attachKeyboard({ state: 'shown', frame: band });
    oracle.touchableAnswers.current = { witness: 'hidden', region: [panel, band] };
    expect(await oracleKeyboard(oracle)).toStrictEqual({ state: 'shown', frame: band });
    expect(await oracleKeyboard(oracle)).toStrictEqual({ state: 'shown', frame: band });
    expect(said.mock.calls).toEqual([
      [
        "averi: the soft keyboard window's touchable region 17,1203 611x577 + 0,2101 1080x119 beside its band 0,2101 1080x119 — " +
          'the input method said hidden in the same call, so no panel of it is judged as covered (docs/bugs/2026-10-05-android-floating-gboard-keyboard.md)',
      ],
    ]);
    oracle.touchableAnswers.current = { witness: 'shown', region: [panel, band] };
    expect(await oracleKeyboard(oracle)).toEqual({ state: 'shown', frame: band, panels: [panel] });
    expect(said).toHaveBeenCalledTimes(1);
  });
});

describe('readSoftKeyboard — the band\'s window region, read only once the band is up (2026-10-08)', () => {
  const field = node({ role: 'textfield', identifier: 'message_for_payee_input', rect: { x: 0, y: 1515, width: 1080, height: 143 } });
  const tree = screen(field);

  it('floating: the band, and the panel beside it — two oracle queries, state() then touchable()', async () => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.attachKeyboard({ state: 'shown', frame: GBOARD_STRIP });
    fake.attachedKeyboard.touchableAnswers.current = touchableOf(GBOARD.floating.touchable, 'shown');
    expect((await readSoftKeyboard(fake, tree, field)).keyboard).toEqual({ state: 'shown', frame: GBOARD_STRIP, panels: [GBOARD_PANEL] });
    expect([fake.attachedKeyboard.windowAnswers.queries, fake.attachedKeyboard.touchableAnswers.queries]).toEqual([1, 1]);
  });

  it('docked: the reading is the band alone, no `panels` key — what every reader saw before this date', async () => {
    const band = { x: 0, y: 1398, width: 1080, height: 822 };
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.attachKeyboard({ state: 'shown', frame: band });
    fake.attachedKeyboard.touchableAnswers.current = touchableOf(GBOARD.docked.touchable, 'shown');
    expect((await readSoftKeyboard(fake, tree, field)).keyboard).toStrictEqual({ state: 'shown', frame: band });
  });

  it('unknown: one query, the region never asked', async () => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.attachKeyboard({ state: 'unknown' });
    expect((await readSoftKeyboard(fake, tree, field)).keyboard).toEqual({ state: 'unknown' });
    expect(fake.attachedKeyboard.touchableAnswers.queries).toBe(0);
  });
});

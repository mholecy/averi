import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInputShown, parseTouchableRegion } from '../../src/adapters/android.js';
import { KEYBOARD_ROLE, type KeyboardTouchable, type KeyboardWitness, type Rect, type SoftKeyboard, type UiNode } from '../../src/adapters/types.js';
import { readKeyboard } from '../../src/ui-tree/keyboard-cover.js';
import { GBOARD, GBOARD_PANEL, GBOARD_STRIP } from '../helpers/android-dumps.js';
import { FakeAdapter, node, recorded, screen, type FakeKeyboard } from '../helpers/fake.js';

// The keyboard reading (ui-tree/keyboard-cover.ts), through its interface:
// `readKeyboard` over a FakeAdapter, with the oracle's calls counted on the
// fake (`ScriptedAnswer.queries`) and the floating-Gboard rules over the
// measured dumps (tests/helpers/android-dumps.ts). Since 2026-10-09 this file
// holds what tests/ui-tree/soft-keyboard.test.ts held for `readSoftKeyboard`,
// `oracleKeyboard`, `panelsBeyond`, `keyboardRects`/`highestCover` and
// `partOfKeyboard`, and tests/interact/keyboard-window.test.ts for
// `keyboardOver` — the helpers the reading replaced.

/** An adapter with the oracle (the window model), its window state and witness scripted; the tree is never read. */
function withOracle(window: SoftKeyboard, witness: KeyboardWitness = 'unknown', tree: UiNode = screen()): { fake: FakeAdapter; oracle: FakeKeyboard; tree: UiNode } {
  const fake = new FakeAdapter({ s: tree }, 's');
  const oracle = fake.attachKeyboard(window, witness);
  return { fake, oracle, tree };
}

/** The three oracle calls a reading made: state(), touchable(), witness(). */
const calls = (oracle: FakeKeyboard): [number, number, number] => [oracle.windowAnswers.queries, oracle.touchableAnswers.queries, oracle.witnessAnswers.queries];

/** What the adapter's touchable() returns for a measured fixture — its own parsers over the real text, the input method's word overridable. */
const touchableOf = (out: string, witness: KeyboardWitness = parseInputShown(out)): KeyboardTouchable => ({ witness, region: parseTouchableRegion(out) });

describe('readKeyboard — the one switch between the oracle and the tree (review 2026-10-07)', () => {
  const BAND = { x: 0, y: 539, width: 402, height: 335 };
  const submit = node({ role: 'button', identifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } });
  const key = node({ role: 'other', label: 'q', rect: { x: 4, y: 590, width: 40, height: 54 } });
  const tree = screen(submit, node({ role: 'container', ofKeyboard: true, children: [node({ role: KEYBOARD_ROLE, rect: { ...BAND } }), key] }));
  const noOracle = () => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.keyboardAdvice = 'why not, and what to do';
    return fake;
  };

  it('no oracle: the tree\'s band, dismissal none, the adapter\'s advice', async () => {
    const reading = readKeyboard(noOracle(), tree);
    expect(reading.remedy).toEqual({ dismissal: 'none', advice: 'why not, and what to do' });
    expect(await reading.anywhere()).toBe('shown');
    expect(await reading.over({ x: 106, y: 571 }, submit)).toEqual({ kind: 'covered', frame: BAND, confirmed: true });
    expect((await reading.cover())?.band).toEqual(BAND);
  });

  it('no oracle, no advice on the adapter: advice undefined, the reading unchanged', async () => {
    const fake = noOracle();
    fake.keyboardAdvice = undefined;
    const reading = readKeyboard(fake, tree);
    expect(reading.remedy).toEqual({ dismissal: 'none', advice: undefined });
    expect(await reading.anywhere()).toBe('shown');
  });

  it('the band is a COPY of the node\'s rect (nodes are mutated downstream; the frame is quoted after the fact)', async () => {
    const band = node({ role: KEYBOARD_ROLE, rect: { ...BAND } });
    const cover = await readKeyboard(noOracle(), screen(band)).cover();
    expect(cover?.band).toEqual(BAND);
    expect(cover?.band).not.toBe(band.rect);
  });

  it('a subject that is the keyboard\'s own UI reads unknown, whatever the tree shows', async () => {
    const reading = readKeyboard(noOracle(), tree);
    expect(await reading.over({ x: 24, y: 617 }, key)).toEqual({ kind: 'unknown' });
    expect(await reading.frameOver({ x: 24, y: 617 }, key)).toEqual({ kind: 'unknown' });
    expect(await reading.overlapping(key.rect, key)).toBeUndefined();
  });

  it('no band in the tree (an idb tree, or none on screen): unknown — not hidden — and nothing is ever asked of a device', async () => {
    const fake = noOracle();
    const events = recorded(fake);
    const reading = readKeyboard(fake, screen(submit));
    expect(await reading.anywhere()).toBe('unknown');
    expect(await reading.over({ x: 106, y: 571 }, submit)).toEqual({ kind: 'unknown' });
    expect(await reading.cover()).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('no oracle and no tree: unknown on every question, nothing asked', async () => {
    const reading = readKeyboard(noOracle());
    expect(await reading.anywhere()).toBe('unknown');
    expect(await reading.over({ x: 1, y: 1 })).toEqual({ kind: 'unknown' });
    expect(await reading.corroborated()).toBe(false);
    expect(await reading.unlocated()).toBe(false);
  });

  it('the in-tree model has no second source: a shown band is corroborated by construction, never unlocated', async () => {
    const reading = readKeyboard(noOracle(), tree);
    expect(await reading.corroborated()).toBe(true);
    expect(await reading.unlocated()).toBe(false);
  });

  it('with the oracle: its one state() query, dismissal back, no advice, and the tree is never read — nor the oracle asked for a keyboard-side subject', async () => {
    const { fake, oracle } = withOracle({ state: 'hidden' }, 'unknown', tree);
    fake.keyboardAdvice = 'ignored with an oracle';
    const events = recorded(fake);
    const reading = readKeyboard(fake, tree);
    expect(reading.remedy).toEqual({ dismissal: 'back', advice: undefined });
    expect(await reading.over({ x: 106, y: 571 }, submit)).toEqual({ kind: 'clear' });
    expect(calls(oracle)).toEqual([1, 0, 0]); // hidden: the region is never asked, nor the witness over a clear point
    expect(await readKeyboard(fake, tree).over({ x: 24, y: 617 }, key)).toEqual({ kind: 'unknown' });
    expect(calls(oracle)).toEqual([1, 0, 0]);
    expect(events).not.toContain('read');
  });
});

describe('ofKeyboard — is the node the keyboard\'s own UI (review 2026-10-07; one walk a reading since 2026-10-08)', () => {
  const key = node({ role: 'other', label: 'q', rect: { x: 4, y: 590, width: 40, height: 54 } });
  const done = node({ role: 'button', label: 'Done', rect: { x: 317, y: 523, width: 64, height: 38 } });
  const submit = node({ role: 'button', identifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } });
  const keyboardWindow = node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'container', children: [key] })] });
  const hostWindow = node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [done] });
  const appWindow = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [submit] });
  const tree = screen(appWindow, hostWindow, keyboardWindow);
  const reading = readKeyboard({}, tree);

  it('a descendant of a marked root, at any depth, is part of the keyboard; the mark itself too', () => {
    expect(reading.ofKeyboard(key)).toBe(true);
    expect(reading.ofKeyboard(done)).toBe(true);
    expect(reading.ofKeyboard(keyboardWindow)).toBe(true);
  });

  it('a node under an unmarked root is not — even inside the band\'s rect', () => {
    expect(reading.ofKeyboard(submit)).toBe(false);
    expect(reading.ofKeyboard(appWindow)).toBe(false);
  });

  it('by identity: an equal node the tree does not hold is not part of its keyboard; with no tree, nothing is', () => {
    expect(reading.ofKeyboard({ ...key })).toBe(false);
    expect(readKeyboard({}).ofKeyboard(key)).toBe(false);
  });
});

describe('over / frameOver / overlapping — geometry, with the frame when it covers', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };

  it.each([
    ['shown, point inside the frame', { state: 'shown', frame: FRAME }, { x: 249, y: 1466 }, { kind: 'covered', frame: FRAME }],
    ['shown, point outside the frame (beside it)', { state: 'shown', frame: FRAME }, { x: 249, y: 1000 }, { kind: 'clear' }],
    ['hidden', { state: 'hidden' }, { x: 249, y: 1466 }, { kind: 'clear' }],
    ['unknown: kept apart, not folded into clear', { state: 'unknown' }, { x: 249, y: 1466 }, { kind: 'unknown' }],
  ] as const)('frameOver — %s → %s, the witness never asked', async (_name, window, point, expected) => {
    const { fake, oracle } = withOracle(window, 'hidden');
    expect(await readKeyboard(fake, screen()).frameOver(point)).toEqual(expected);
    expect(oracle.witnessAnswers.queries).toBe(0);
  });

  it('the band and every panel are tested, and the rect that holds the point is named — the panel, when the panel is what covers', async () => {
    const floating = () => {
      const { fake } = withOracle({ state: 'shown', frame: GBOARD_STRIP });
      fake.attachedKeyboard.touchableAnswers.current = touchableOf(GBOARD.floating.touchable);
      return readKeyboard(fake, screen());
    };
    expect(await floating().frameOver({ x: 540, y: 1586 })).toEqual({ kind: 'covered', frame: GBOARD_PANEL });
    expect(await floating().frameOver({ x: 540, y: 2100 })).toEqual({ kind: 'covered', frame: GBOARD_STRIP });
    expect(await floating().frameOver({ x: 200, y: 1586 })).toEqual({ kind: 'clear' }); // beside the panel, above the strip
    const { fake } = withOracle({ state: 'shown', frame: GBOARD_STRIP }); // the region not read whole: the strip alone
    expect(await readKeyboard(fake, screen()).frameOver({ x: 540, y: 1586 })).toEqual({ kind: 'clear' });
  });

  it('overlapping: any positive-area overlap, the band first — an edge-touching rect is not covered; hidden or unknown is never covered', async () => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: FRAME }, 'hidden');
    const reading = readKeyboard(fake, screen());
    expect(await reading.overlapping({ x: 0, y: 1200, width: 100, height: 100 })).toEqual(FRAME);
    // The pixel poll's question never asks the witness, even over a covered rect and a witness that would deny it.
    expect(calls(oracle)).toEqual([1, 1, 0]);
    expect(await reading.overlapping({ x: 0, y: 1185, width: 100, height: 100 })).toBeUndefined(); // its bottom edge on the frame's top
    expect(await readKeyboard(withOracle({ state: 'hidden' }).fake, screen()).overlapping({ x: 0, y: 1200, width: 100, height: 100 })).toBeUndefined();
    expect(await readKeyboard(withOracle({ state: 'unknown' }).fake, screen()).overlapping({ x: 0, y: 1200, width: 100, height: 100 })).toBeUndefined();
  });
});

describe('over — the input method\'s word over a covered point: the veto (witnessDenies) inside the reading', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };
  const AT = { x: 249, y: 1466 };

  it.each([
    ['witness shown: covered, confirmed', 'shown', { kind: 'covered', frame: FRAME, confirmed: true }],
    ['witness unknown: covered, not confirmed — the window state alone stands, as before the veto existed', 'unknown', { kind: 'covered', frame: FRAME, confirmed: false }],
    ['witness hidden: denied — the stale window state, act on neither guess', 'hidden', { kind: 'denied', frame: FRAME }],
  ] as const)('%s', async (_name, witness, expected) => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: FRAME }, witness);
    expect(await readKeyboard(fake, screen()).over(AT)).toEqual(expected);
    expect(calls(oracle)).toEqual([1, 1, 1]);
  });

  it('a clear point asks no witness: one call hidden or unknown, two shown — and the witness is never asked twice of one reading', async () => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: FRAME }, 'shown');
    const reading = readKeyboard(fake, screen());
    expect(await reading.over({ x: 249, y: 1000 })).toEqual({ kind: 'clear' });
    expect(calls(oracle)).toEqual([1, 1, 0]);
    await reading.over(AT);
    await reading.over({ x: 500, y: 2000 });
    expect(await reading.corroborated()).toBe(true);
    expect(calls(oracle)).toEqual([1, 1, 1]); // memoised: one of each, whatever is asked after
    expect(calls(withOracle({ state: 'unknown' }).oracle)).toEqual([0, 0, 0]);
    const unknown = withOracle({ state: 'unknown' }, 'shown');
    await readKeyboard(unknown.fake, screen()).over(AT);
    expect(calls(unknown.oracle)).toEqual([1, 0, 0]);
  });

  it('a fresh reading asks again — a reading is of one moment, never kept across rounds', async () => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: FRAME }, 'hidden');
    oracle.witnessAnswers.queue = ['hidden', 'shown'];
    expect((await readKeyboard(fake).over(AT)).kind).toBe('denied');
    expect((await readKeyboard(fake).over(AT)).kind).toBe('covered');
    expect(calls(oracle)).toEqual([2, 2, 2]);
  });
});

describe('anywhere / corroborated / unlocated — the questions with no point: the state, and the witness only where it can change the answer', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };

  it.each([
    ['shown · witness shown', { state: 'shown', frame: FRAME }, 'shown', true, false, [1, 0, 1]],
    ['shown · witness unknown: no veto', { state: 'shown', frame: FRAME }, 'unknown', true, false, [1, 0, 1]],
    ['shown · witness hidden: the veto', { state: 'shown', frame: FRAME }, 'hidden', false, false, [1, 0, 1]],
    ['hidden · witness shown: the `unlocated` row (2026-10-08)', { state: 'hidden' }, 'shown', false, true, [1, 0, 1]],
    ['hidden · witness hidden', { state: 'hidden' }, 'hidden', false, false, [1, 0, 1]],
    ['hidden · witness unknown', { state: 'hidden' }, 'unknown', false, false, [1, 0, 1]],
    ['unknown: nothing to stand by and nothing to contradict — the witness not asked', { state: 'unknown' }, 'shown', false, false, [1, 0, 0]],
  ] as const)('%s → corroborated %s, unlocated %s', async (_name, window, witness, corroborated, unlocated, cost) => {
    const { fake, oracle } = withOracle(window, witness);
    const reading = readKeyboard(fake);
    expect(await reading.anywhere()).toBe(window.state);
    expect(await reading.corroborated()).toBe(corroborated);
    expect(await reading.unlocated()).toBe(unlocated);
    expect(calls(oracle)).toEqual(cost); // never the region: no point, no panel
  });
});

describe('the keyboard window\'s region, read only once the band is up — the floating-Gboard device check (2026-10-08)', () => {
  const DOCKED_BAND = { x: 0, y: 1398, width: 1080, height: 822 };
  afterEach(() => vi.restoreAllMocks());

  /** A reading of a shown band beside a scripted region, the stderr notice captured. */
  const shownBeside = (band: Rect, touchable: KeyboardTouchable) => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: band });
    oracle.touchableAnswers.current = touchable;
    return { reading: readKeyboard(fake, screen()), oracle };
  };
  const notices = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  const line = (region: string, band: string, clause: string, judged = 'no panel of it is') =>
    `averi: the soft keyboard window's touchable ${region} beside its band ${band} — ${clause}, so ${judged} judged as covered ` +
    '(docs/bugs/2026-10-05-android-floating-gboard-keyboard.md)';

  it('floating, the input method saying shown in the same call: the band, then the panel — state() then touchable(), nothing said; the highest cover is the panel', async () => {
    const said = notices();
    const { reading, oracle } = shownBeside(GBOARD_STRIP, touchableOf(GBOARD.floating.touchable));
    const cover = await reading.cover();
    expect(cover).toEqual({ rects: [GBOARD_STRIP, GBOARD_PANEL], top: GBOARD_PANEL, band: GBOARD_STRIP, remedy: { dismissal: 'back', advice: undefined } });
    expect(calls(oracle)).toEqual([1, 1, 0]);
    expect(said).not.toHaveBeenCalled();
  });

  it('docked: the region IS the band — the band alone, nothing to say, even with the input method not saying shown', async () => {
    const said = notices();
    for (const witness of ['shown', 'unknown'] as const) {
      const { reading } = shownBeside(DOCKED_BAND, touchableOf(GBOARD.docked.touchable, witness));
      expect((await reading.cover())?.rects).toStrictEqual([DOCKED_BAND]);
    }
    expect(said).not.toHaveBeenCalled();
  });

  it('the highest cover: ties keep the band', async () => {
    const { reading } = shownBeside(DOCKED_BAND, { witness: 'shown', region: [{ ...DOCKED_BAND, x: 1, width: 1079 }, DOCKED_BAND] });
    expect((await reading.cover())?.top).toBe((await reading.cover())?.band);
  });

  it.each([
    ['the input method says hidden', 'hidden' as const],
    ['the input method could not be asked (unknown — no veto, but no evidence either)', 'unknown' as const],
  ])('nothing unless the input method says SHOWN in the same call: %s — the band alone, and the notice says so', async (_name, witness) => {
    const said = notices();
    const { reading } = shownBeside(GBOARD_STRIP, touchableOf(GBOARD.floating.touchable, witness));
    expect((await reading.cover())?.rects).toStrictEqual([GBOARD_STRIP]);
    expect(await reading.frameOver({ x: 540, y: 1586 })).toEqual({ kind: 'clear' });
    expect(said.mock.calls).toEqual([
      [line('region 359,1269 681x643 + 0,2088 1080x132', '0,2088 1080x132', `the input method said ${witness} in the same call`)],
    ]);
  });

  it('nothing from a region that does not hold the band exactly — the stale landscape one, the hidden strip beside a docked band, a strip one pixel off', async () => {
    const said = notices();
    const cases: [Rect, KeyboardTouchable, string, string][] = [
      [DOCKED_BAND, touchableOf(GBOARD.staleLandscape.touchable, 'shown'), 'region 0,948 2220x132', '0,1398 1080x822'],
      [DOCKED_BAND, touchableOf(GBOARD.hidden.touchable, 'shown'), 'region 0,2088 1080x132', '0,1398 1080x822'],
      [{ ...GBOARD_STRIP, y: 2089, height: 131 }, touchableOf(GBOARD.floating.touchable), 'region 359,1269 681x643 + 0,2088 1080x132', '0,2089 1080x131'],
    ];
    for (const [band, touchable] of cases) {
      const { reading } = shownBeside(band, touchable);
      expect((await reading.cover())?.rects).toStrictEqual([band]);
    }
    expect(said.mock.calls).toEqual(cases.map(([, , region, band]) => [line(region, band, 'no rect of it is the band')]));
  });

  it('a rect beside a band it does hold that does not fit the screen the band spans (2220 > 1080 wide) is dropped, the rest admitted — "only part of it"', async () => {
    const said = notices();
    const stale = { x: 0, y: 948, width: 2220, height: 132 };
    const { reading } = shownBeside(GBOARD_STRIP, { witness: 'shown', region: [GBOARD_PANEL, stale, GBOARD_STRIP] });
    expect((await reading.cover())?.rects).toEqual([GBOARD_STRIP, GBOARD_PANEL]);
    expect(said.mock.calls).toEqual([
      [
        line(
          'region 359,1269 681x643 + 0,948 2220x132 + 0,2088 1080x132',
          '0,2088 1080x132',
          '1 of its rects lie outside the screen the band spans, or have no area',
          'only part of it is',
        ),
      ],
    ]);
  });

  it('a zero-area, negative or below-the-band rect is dropped; the panel kept', async () => {
    notices();
    const flat = { x: 359, y: 1269, width: 681, height: 0 };
    const negative = { x: -10, y: 1269, width: 100, height: 100 };
    const below = { x: 0, y: 2200, width: 100, height: 100 };
    const { reading } = shownBeside(GBOARD_STRIP, { witness: 'shown', region: [flat, negative, below, GBOARD_PANEL, GBOARD_STRIP] });
    expect((await reading.cover())?.rects).toEqual([GBOARD_STRIP, GBOARD_PANEL]);
  });

  it('an unreadable region is none — said only when the input method answered (the call ran); a call that failed whole says nothing', async () => {
    const said = notices();
    expect((await shownBeside(GBOARD_STRIP, { witness: 'shown', region: undefined }).reading.cover())?.rects).toStrictEqual([GBOARD_STRIP]);
    expect((await shownBeside(GBOARD_STRIP, { witness: 'unknown', region: undefined }).reading.cover())?.rects).toStrictEqual([GBOARD_STRIP]);
    expect(said.mock.calls).toEqual([[line('region', '0,2088 1080x132', 'the region could not be read')]]);
  });

  it('an empty region: nothing beyond the band to refuse, nothing said', async () => {
    const said = notices();
    await shownBeside(GBOARD_STRIP, { witness: 'shown', region: [] }).reading.cover();
    expect(said).not.toHaveBeenCalled();
  });

  it('each distinct notice once per ORACLE: the same oracle read again says nothing new, a second oracle says it again — and an admitted panel says nothing', async () => {
    const said = notices();
    const { fake, oracle } = withOracle({ state: 'shown', frame: GBOARD_STRIP });
    oracle.touchableAnswers.current = { witness: 'hidden', region: [GBOARD_PANEL, GBOARD_STRIP] };
    await readKeyboard(fake).cover();
    await readKeyboard(fake).cover();
    expect(said).toHaveBeenCalledTimes(1);
    oracle.touchableAnswers.current = { witness: 'shown', region: [GBOARD_PANEL, GBOARD_STRIP] };
    expect((await readKeyboard(fake).cover())?.rects).toEqual([GBOARD_STRIP, GBOARD_PANEL]);
    expect(said).toHaveBeenCalledTimes(1);
    const other = withOracle({ state: 'shown', frame: GBOARD_STRIP });
    other.oracle.touchableAnswers.current = { witness: 'hidden', region: [GBOARD_PANEL, GBOARD_STRIP] };
    await readKeyboard(other.fake).cover();
    expect(said).toHaveBeenCalledTimes(2);
    expect(said.mock.calls[1]).toEqual(said.mock.calls[0]);
  });

  it('cover never asks the witness, even over a shown band it would deny', async () => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: GBOARD_STRIP }, 'hidden');
    expect((await readKeyboard(fake).cover())?.band).toEqual(GBOARD_STRIP);
    expect(calls(oracle)).toEqual([1, 1, 0]);
  });

  it('hidden or unknown: one query, the region never asked', async () => {
    for (const state of ['hidden', 'unknown'] as const) {
      const { fake, oracle } = withOracle({ state });
      expect(await readKeyboard(fake).cover()).toBeUndefined();
      expect(calls(oracle)).toEqual([1, 0, 0]);
    }
  });
});

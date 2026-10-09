import { describe, expect, it } from 'vitest';
import type { Rect, Stroke, UiNode } from '../../src/adapters/types.js';
import { ElementNotFoundError, describeTarget } from '../../src/interact/resolve.js';
import { round, SETTLE_CONFIRM_READS, startRounds, type RoundRules } from '../../src/interact/scroll-rounds.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { node } from '../helpers/fake.js';
import { containsPoint } from '../../src/ui-tree/geometry.js';
import { coverOver, drawnFor, failureOf, match, NO_BACK, play, resultOf, strokeCovers, strokesToward, treeOf, type Row } from '../helpers/rounds.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';

/**
 * `scroll_until`'s round as observation tables (2026-10-09, the
 * scroll-rounds deepening): each test is the reads a scroll saw and what
 * the rounds did with them — through tests/helpers/rounds.ts#play, the
 * reducer's test adapter, with no device, no clock and no timers. Until
 * that date each was a scripted FakeAdapter whose physics produced these
 * reads; the reads are written out here, one row each, with the fake they
 * came from named in the comment. What only the driver can show — stroke
 * points, adb query counts, a read failure quoted end to end, the error
 * classes, the deadline passing during a stroke — stays in
 * tests/interact/scroll.test.ts.
 */

type Rules = RoundRules & { screen: { width: number; height: number } };
/** scroll.test.ts's FAST (maxSwipes 4, 2 s) on scrollingFake's 1000x2000 screen. */
const SCROLLING: Rules = { direction: 'down', fully: false, maxSwipes: 4, timeoutMs: 2_000, screen: { width: 1000, height: 2000 } };
/** The same bounds on the measured Android screen (Pixel_3a, 1080x2220). */
const ANDROID: Rules = { ...SCROLLING, screen: { width: 1080, height: 2220 } };
/** The same bounds on the iPhone 17 under WDA (402x874 pt). */
const IPHONE: Rules = { ...SCROLLING, screen: { width: 402, height: 874 } };

/** The measured Android IME: `InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220]`. */
const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
/** The measured iOS 27 pad's band (`other None None None 0 589 402 285`). */
const IOS_BAND: Rect = { x: 0, y: 589, width: 402, height: 285 };
/** The measured WDA pad on the iPhone 17: `role:keyboard 0 572 402 302`. */
const WDA_BAND: Rect = { x: 0, y: 572, width: 402, height: 302 };
const UP_IME = coverOver(IME);
/** The gesture boxes `play` hands the rounds by default (`Row.screen`): the screens as built. */
const SCREEN_1080: Rect = { x: 0, y: 0, ...ANDROID.screen };
const IPHONE_BOX: Rect = { x: 0, y: 0, ...IPHONE.screen };
/** Any stroke, for the protocol's hand-back. */
const STROKE: Stroke = { from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } };

/** scrollingFake's target: 100 wide, `height` tall, at y. */
const button = (y: number, height = 40) => match({ x: 0, y, width: 100, height }, 'submit_button');
/** The Android form's row (scroll.test.ts#formFake): x 66, 948x73. */
const formRow = (y: number) => match({ x: 66, y, width: 948, height: 73 });
/** The WDA form's row (scroll.test.ts#wdaForm): x 24, 354 wide; every read with the pad up, the in-tree model (corroborated by construction). */
const wdaRow = (y: number, height = 52): Row => ({ found: [match({ x: 24, y, width: 354, height }, 'row')], cover: coverOver(WDA_BAND, NO_BACK) });
/** A WDA read the target is not in (a lazy list dropped it), the pad still up. */
const wdaGone: Row = { found: [], cover: coverOver(WDA_BAND, NO_BACK) };
/** Rows reading `ys` in turn, each one match built by `at`, with `extra` on every row. */
const reads = (ys: readonly number[], at: (y: number) => UiNode, extra: Row = {}): Row[] => ys.map((y) => ({ ...extra, found: [at(y)] }));

/** A `RoundRead` by hand, for the protocol's own calls: `found` in their tree (rounds.ts#treeOf), no keyboard node. */
const readOf = (found: UiNode[], extra: { cover?: KeyboardCover } = {}) => ({ tree: treeOf({ found }, ANDROID.screen), found, ofKeyboard: () => false, ...extra });

describe('round — the protocol', () => {
  it('an ask leaves the state as it came in, and the same seen with the answer goes on', () => {
    const state = startRounds({ ...ANDROID, fully: true }, ANDROID.screen);
    const seen = { read: readOf([formRow(1906)], { cover: UP_IME }), elapsedMs: 0 };
    const asked = round(state, seen);
    expect(asked).toEqual({ state, step: { do: 'ask', what: 'witness' } });
    expect(round(state, { ...seen, corroborated: true }).step).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398 });
  });

  it('a stroke owes its drawn stroke to the next round; a round given one unasked, or none when owed, or any round after the stop, throws', () => {
    const state = startRounds(ANDROID, ANDROID.screen);
    const off = { read: readOf([formRow(2900)]), elapsedMs: 0 };
    expect(() => round(state, { ...off, drawn: STROKE })).toThrow('none asked for');
    const stroked = round(state, off).state;
    expect(() => round(stroked, off)).toThrow('without the stroke drawn');
    const stopped = round(stroked, { read: readOf([formRow(500)]), elapsedMs: 0, drawn: STROKE });
    expect(stopped.step.do).toBe('confirm');
    const done = round(stopped.state, { read: readOf([formRow(500)]), elapsedMs: 0 });
    expect(done.step.do).toBe('stop');
    expect(() => round(done.state, off)).toThrow('after the scroll stopped');
  });
});

describe('round — the judgement and the stop', () => {
  it('judges the MOST revealed match when an id sits on a container and its child', () => {
    const child = match({ x: 0, y: 1900, width: 100, height: 40 }, 'row');
    const container = node({ role: 'container', identifier: 'row', rect: { x: 0, y: 1900, width: 100, height: 400 }, children: [child] });
    expect(resultOf(play(SCROLLING, [{ found: [container, child] }]))).toEqual({ swipes: 0, visible: 1, clipped: [] }); // the child, not the 25%-visible container
  });

  it('fully: true keeps swiping past a clipped stop, and names the layout defect when swiping no longer moves it', () => {
    // scrollingFake(2580): 600 a stroke; 1980–2020 is clipped at the bottom, where the default would have stopped at 1.
    const played = play({ ...SCROLLING, fully: true }, reads([2580, 1980, 1380, 1380], (y) => button(y)));
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'confirm', 'stop']);
    expect(resultOf(played).swipes).toBe(2);
    // scrollingFake(1980, 0): nothing moves it — two identical strokes, then the defect.
    const stuck = play({ ...SCROLLING, fully: true }, reads([1980, 1980, 1980], (y) => button(y)));
    expect(failureOf(stuck, 'id:submit_button').message).toMatch(/content is exhausted[\s\S]*cannot be fully revealed — that is a layout defect/);
  });

  it('fully: true, clipped: ONE stroke that does not move it is a transient, not the layout defect — the next one scrolls (review round 2)', () => {
    // 1980–2020 clipped; the first stroke is not taken, the second moves it to 1380.
    expect(resultOf(play({ ...SCROLLING, fully: true }, reads([1980, 1980, 1380, 1380], (y) => button(y))))).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('names the stop bound that ended it: maxSwipes, or the timeout in ms', () => {
    // scrollingFake(50_000, 10): 10 px a stroke, never near the frame.
    const bound = play(SCROLLING, reads([50_000, 49_990, 49_980, 49_970, 49_960], (y) => button(y)));
    expect(failureOf(bound, 'id:submit_button').message).toMatch(
      /scroll_until id:submit_button failed after 4 swipes \(maxSwipes\) — element in tree but never intersected the 1000x2000 viewport/,
    );
    const timedOut = play({ ...SCROLLING, maxSwipes: 50, timeoutMs: 1 }, [{ found: [button(50_000)], elapsedMs: 1 }]);
    expect(failureOf(timedOut, describeTarget({ id: 'submit_button' })).message).toMatch(/scroll_until id:"submit_button" failed after 1ms \(timeout\)/);
  });

  it('a stop at 0 swipes was not stroked: reported on its one read, no confirming read', () => {
    const played = play(IPHONE, [wdaRow(300)]);
    expect(played.steps).toHaveLength(1);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });
});

describe('round — the soft keyboard', () => {
  it('Android, symptom 1: a row WHOLLY under the IME is not "fully visible after 0 swipes" — it is scrolled out from under it first', () => {
    const played = play({ ...ANDROID, fully: true }, reads([1906, 1306, 1306], formRow, { cover: UP_IME })); // the measured rect: y 1906–1979, inside the IME
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398, box: SCREEN_1080 }); // no clipping container: the screen box
    // The witness on the round the band changes; none on the moot stop. `unlocated` is put to a SHOWN reading, which asks nothing.
    expect(played.rounds.map((r) => r.asks)).toEqual([['witness'], [], ['unlocated']]);
    // Clear of the band at the stop: the band changes nothing there, so it is not reported (review 2026-10-08).
    const result = resultOf(played);
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(describeScrollResult(result)).toBe('fully visible after 1 swipe');
  });

  it('Android, partly under the IME: CLIPPED at the keyboard\'s edge, never "fully visible"', () => {
    const result = resultOf(play(ANDROID, [{ found: [formRow(1360)], cover: UP_IME }])); // 1360–1433 straddles 1398
    expect(result.clipped).toEqual(['bottom']);
    expect(describeScrollResult(result)).toBe(
      'visible after 0 swipes — CLIPPED at bottom, 52% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. ' +
        'A rect assert or screenshot on this element will measure the CLIPPED box',
    );
  });

  it('Android, fully: true at the end of the content with the row still under the IME: the keyboard is named, with how to hide it — not a layout defect', () => {
    const played = play({ ...ANDROID, fully: true }, reads([1360, 1360, 1360], formRow, { cover: UP_IME }));
    // After TWO identical swipes that did not move it (review round 2: one can be a transient), not one.
    expect(failureOf(played, 'id:priority_select').message).toBe(
      'scroll_until id:priority_select failed after 2 swipes — element is in the viewport but CLIPPED at bottom, 52% of it is in ' +
        'the viewport above the soft keyboard over [0,1398][1080,2220], and the content is exhausted: swiping down no longer moves ' +
        'it. The soft keyboard covers the rest — to reach it with the keyboard down, hide it first (press_key back from the MCP ' +
        'tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again; only if it stays clipped with ' +
        'the keyboard down is it a layout defect. Last rect {"x":66,"y":1360,"width":948,"height":73} in a 1080x2220 viewport',
    );
  });

  it('Android, a stop bound with the IME up names the keyboard — the 15 s "never appeared" no longer reads as a wrong selector — and stays ElementNotFoundError', () => {
    const error = failureOf(play({ ...ANDROID, maxSwipes: 2 }, ['a', 'b', 'c'].map((rest): Row => ({ cover: UP_IME, rest }))), 'id:payee_street_input'); // the form scrolls
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toBe(
      'scroll_until id:payee_street_input failed after 2 swipes (maxSwipes) — element never appeared in the tree. The soft ' +
        'keyboard was up over [0,1398][1080,2220] in 3 of the 3 rounds read: in those, visibility was judged, and the swipe drawn, in ' +
        'the screen above it — to ' +
        'reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the ' +
        'fill before this step in a flow) and scroll again',
    );
  });

  it('Android, two matches — one under the IME, one above it: the band changes WHICH is judged, so the clean stop says it was judged above the keyboard (review round 3)', () => {
    const result = resultOf(play(ANDROID, [{ found: [formRow(1906), formRow(500)], cover: UP_IME }]));
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [], keyboard: { state: 'shown', frame: IME } });
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes, judged above the soft keyboard over [0,1398][1080,2220]');
  });

  it('Android, a band that changes nothing (the target clear above it, a clean stop) is not asked about and not reported', () => {
    const played = play(ANDROID, [{ found: [formRow(500)], cover: UP_IME }]);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(played.asks).toEqual([]);
  });

  it('Android, a STALE window state (review 2026-10-08: frame shown, input method says hidden — measured for seconds after a navigating tap) is vetoed: the on-screen target is not scored 0, no stroke is sent, no keyboard reported', () => {
    const played = play({ ...ANDROID, fully: true }, [{ found: [formRow(1906)], cover: UP_IME, corroborated: false }]);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(played.asks.filter((a) => a === 'witness')).toHaveLength(1);
  });

  it('Android, a vetoed band is not claimed at a failed stop either', () => {
    const denied: Row = { cover: UP_IME, corroborated: false };
    expect(failureOf(play({ ...ANDROID, maxSwipes: 1 }, [denied, denied]), 'id:nope').message).toBe(
      'scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree',
    );
  });

  it('Android, a vetoed band leaves the stroke whole-screen too — and a denial is not kept: the witness is asked again on every round the band matters', () => {
    const played = play(ANDROID, reads([2900, 2300, 1700, 1700], formRow, { cover: UP_IME, corroborated: false }));
    expect(strokeCovers(played)).toEqual([undefined, undefined]); // the whole screen's stroke
    // y 2900 and 2300 stroke (the band matters), y 1700 is under the band (the judgements differ), and so is the read
    // confirming that stop: four rounds, four denials.
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(played.asks.filter((a) => a === 'witness')).toHaveLength(4);
  });

  it('Android, a denial followed by a real keyboard (review round 1: a stale window on round 0, then a new screen auto-focuses a field) — asked again, so the row under the IME is not "fully visible after 1 swipe"', () => {
    const played = play({ ...ANDROID, fully: true }, [
      { found: [formRow(2506)], cover: UP_IME, corroborated: false }, // denied once…
      { found: [formRow(1906)], cover: UP_IME }, // …then confirmed: inside the IME, the band applied, one more swipe
      { found: [formRow(1306)], cover: UP_IME },
      { found: [formRow(1306)], cover: UP_IME },
    ]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(strokeCovers(played)[1]).toBe(1398); // drawn above the IME
    expect(played.asks.filter((a) => a === 'witness')).toHaveLength(2);
  });

  it('Android, a keyboard the scroll itself HIDES (a list that dismisses it on drag) with the window left stale-shown: asked again, denied, and the later rounds judged and stroked whole-screen — no keyboard claimed', () => {
    const played = play({ ...ANDROID, fully: true }, [
      { found: [formRow(2900)], cover: UP_IME }, // confirmed on round 0…
      { found: [formRow(2300)], cover: UP_IME, corroborated: false }, // …gone after the first swipe, the window still reporting it
      { found: [formRow(1700)], cover: UP_IME, corroborated: false },
      { found: [formRow(1700)], cover: UP_IME, corroborated: false },
    ]);
    expect(strokeCovers(played)).toEqual([1398, undefined]); // round 0 above the band, round 1 the whole screen
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] }); // y 1700–1773: judged whole-screen, not "under" a phantom band
    expect(played.asks.filter((a) => a === 'witness')).toHaveLength(4); // the confirming read of the stop asks again, denied again
  });

  it('a round whose tree did not read strokes in the box of the last round that DID read — whole-screen when that round applied no band', () => {
    // 100 px a stroke; the window reads shown on round 0, hidden after; the third read fails.
    const played = play({ ...ANDROID, maxSwipes: 3 }, [
      { found: [formRow(2900)], cover: UP_IME },
      { found: [formRow(2800)] },
      { error: 'uiautomator dump returned no XML' },
      { found: [formRow(2600)] },
    ]);
    expect(strokeCovers(played)).toEqual([1398, undefined, undefined]); // round 2, unread: round 1's whole screen, not round 0's band
  });

  it('a round whose tree did not read keeps the last frame — the device as built its screen box gives then is its gesture box only: a later round with no screen box of its own still judges in the turned frame', () => {
    const TURNED: Rect = { x: 0, y: 0, width: 2220, height: 1080 };
    const off: Row = { found: [match({ x: 66, y: 5000, width: 948, height: 73 })] };
    const played = play({ ...ANDROID, maxSwipes: 2 }, [
      { ...off, screen: { box: TURNED, boxes: [TURNED] } }, // read held sideways
      { error: 'uiautomator dump returned no XML', screen: { box: SCREEN_1080, boxes: [SCREEN_1080] } }, // unread: the device as built
      { ...off, screen: null }, // read, but no screen box this round: the frame stays
    ]);
    expect(failureOf(played, 'id:t').message).toMatch(/never intersected the 2220x1080 viewport/);
  });

  it('a round whose tree did not read strokes in the box the last read round\'s band left, not through the keyboard', () => {
    const played = play(ANDROID, [
      { found: [formRow(2900)], cover: UP_IME },
      { error: 'uiautomator dump returned no XML' },
      { found: [formRow(1700)], cover: UP_IME },
      { found: [formRow(1100)], cover: UP_IME },
      { found: [formRow(1100)], cover: UP_IME },
    ]);
    expect(strokeCovers(played).length).toBeGreaterThanOrEqual(2);
    for (const coverTop of strokeCovers(played)) expect(coverTop).toBe(IME.y);
  });

  it('iOS (WDA band): once a band was applied, a later moot stop on the keyboard\'s OWN node does not call the key "above the soft keyboard"', () => {
    const key = (y: number): Row => {
      const node = match({ x: 300, y, width: 80, height: 40 }, 'kb_done');
      return { found: [node], cover: coverOver(IOS_BAND, NO_BACK), ofKeyboard: (n) => n === node };
    };
    // Round 0: the key below the screen, the round strokes — the band applied (in-tree: corroborated by construction).
    const played = play(IPHONE, [key(900), key(800), key(800)]);
    expect(strokeCovers(played)).toEqual([IOS_BAND.y]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('iOS (WDA band): the keyboard\'s OWN UI as the target is judged against the whole screen, as a reading reads it for a subject', () => {
    const key = match({ x: 300, y: 800, width: 80, height: 40 }, 'kb_done');
    expect(resultOf(play(IPHONE, [{ found: [key], cover: coverOver(IOS_BAND, NO_BACK), ofKeyboard: (n) => n === key }]))).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });

  it('a band from the top edge (y 0, a full-screen extract-mode IME — unmeasured) covers everything: no bare "fully visible", no stroke, a failure naming it', () => {
    const played = play(ANDROID, [{ found: [formRow(500)], cover: coverOver({ x: 0, y: 0, width: 1080, height: 2220 }) }]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']); // no stroke
    const error = failureOf(played, 'id:priority_select');
    expect(error).not.toBeInstanceOf(ElementNotFoundError); // it was in the tree
    expect(error.message).toBe(
      'scroll_until id:priority_select failed after 0 swipes — the element is in the tree but under the soft keyboard; the soft ' +
        'keyboard over [0,0][1080,2220] covers the whole screen, so nothing under it can be judged and no swipe was sent — to reach it with the keyboard down, hide it first (press_key ' +
        'back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again',
    );
  });

  it('a band from the top edge with the target NOT in the tree: still absence — ElementNotFoundError, so an optional step is skipped — with the keyboard named', () => {
    const played = play(ANDROID, [{ found: [], cover: coverOver({ x: 0, y: 0, width: 1080, height: 2220 }) }]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    const error = failureOf(played, 'id:nope');
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toMatch(/^scroll_until id:nope failed after 0 swipes — element never appeared in the tree; the soft keyboard over \[0,0\]\[1080,2220\] covers the whole screen/);
  });

  it('keyboard up, element stuck clipped at a NON-keyboard edge (right): the layout-defect wording, not the keyboard\'s', () => {
    const wide = (): Row => ({ found: [match({ x: 900, y: 500, width: 300, height: 73 }, 'wide')], cover: UP_IME });
    expect(failureOf(play({ ...ANDROID, fully: true }, [wide(), wide(), wide()]), 'id:wide').message).toMatch(
      /CLIPPED at right, 60% of it is in the viewport above the soft keyboard over \[0,1398\]\[1080,2220\], and the content is exhausted[\s\S]*cannot be fully revealed — that is a layout defect/,
    );
  });

  it('a stop bound with the element still partly under the band reports the clip at the KEYBOARD\'s edge', () => {
    // 5 px a stroke: it moves, never clears 1398, is never stuck.
    const played = play({ ...ANDROID, fully: true, maxSwipes: 2 }, reads([1380, 1375, 1370], formRow, { cover: UP_IME }));
    expect(failureOf(played, 'id:priority_select').message).toMatch(
      /^scroll_until id:priority_select failed after 2 swipes \(maxSwipes\) — element reached the viewport but stayed CLIPPED at bottom, 38% of it is in the viewport above the soft keyboard over \[0,1398\]\[1080,2220\] \(last rect /,
    );
  });

  it('in tree but entirely under the band at the stop: "never intersected" names the frame actually judged', () => {
    const played = play({ ...ANDROID, maxSwipes: 1 }, reads([1906, 1906], formRow, { cover: UP_IME }));
    expect(failureOf(played, 'id:priority_select').message).toMatch(
      /element in tree but never intersected the 1080x1398 screen above the soft keyboard over \[0,1398\]\[1080,2220\] \(last rect/,
    );
  });

  it('the `unlocated` row on a DEFAULT clean stop: not asked (review 2026-10-08 — a witness query on every clean stop buys a sentence nobody acts on)', () => {
    const played = play(ANDROID, [{ found: [formRow(500)], unlocated: true }]);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(played.asks).toEqual([]);
  });

  it('the `unlocated` row at a failed stop: named, with the swipes it may have eaten', () => {
    const played = play({ ...ANDROID, maxSwipes: 1 }, [{ found: [] }, { found: [], unlocated: true }]);
    expect(played.asks).toEqual(['unlocated']); // asked of the stop round's reading
    expect(failureOf(played, 'id:nope').message).toBe(
      'scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree; the input method reports a ' +
        'soft keyboard shown, but the window state gives it no area on screen (one still coming up? not measured), so ' +
        'where it lies is unknown — the swipes may have landed on it; hide or dock it and scroll again',
    );
  });

  it('iOS (WDA band): the measured partly-covered row (y 545, h 52, band from 589) is not "fully visible after 0 swipes"; fully: true scrolls it above the band', () => {
    const iosRow = (y: number): Row => ({ found: [match({ x: 66, y, width: 336, height: 52 }, 'priority_select')], cover: coverOver(IOS_BAND, NO_BACK) });
    const played = play({ ...IPHONE, fully: true }, [iosRow(545), iosRow(345), iosRow(345)]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    // The stroke started above the band (the old one: y ≈ 699, on a key).
    expect(strokeCovers(played)).toEqual([IOS_BAND.y]);
  });

  it('iOS (WDA band): a stop bound names the keyboard with the in-tree remedy — no back, the adapter\'s advice', () => {
    const band: Row = { found: [], cover: coverOver(IOS_BAND, NO_BACK) };
    expect(failureOf(play({ ...IPHONE, maxSwipes: 1 }, [band, band]), 'id:nope').message).toBe(
      'scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree. The soft keyboard was up over ' +
        '[0,589][402,874] in 2 of the 2 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — ' +
        'to reach it with the keyboard ' +
        'down, hide it first (tap a neutral element such as the screen title — a tap: step in a flow) and scroll again; this ' +
        'adapter cannot hide it on its own (ADVICE)',
    );
  });
});

/**
 * 2026-10-08, the two "Device check" sections of
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md and
 * review round 1: the settled stop, the turn after a fling past the target,
 * and a target off the frame that the strokes no longer move — the reads of
 * scroll.test.ts#wdaForm (the SwiftUI form under WDA, the pad up) and of
 * the Android forms, written out.
 */
describe('round — after the device check', () => {
  const FULLY = { ...IPHONE, fully: true };

  it('iOS (WDA): a stop the settle read caught MID-FLING is not reported — the confirming read finds the row past the top, and the next stroke brings it back', () => {
    // The measured priority_select: y 681 under the pad; the settle read sees it at 300, it comes to rest at -48 (4 pt left on screen).
    const played = play(FULLY, [wdaRow(681), wdaRow(300), wdaRow(-48), wdaRow(94), wdaRow(94)]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] }); // not "fully visible after 1 swipe"
    // Turned round: content up, its reach halved on the turn.
    expect(played.steps).toEqual([
      { do: 'stroke', toward: 'down', reach: 1, coverTop: 572, box: IPHONE_BOX },
      { do: 'confirm' },
      { do: 'stroke', toward: 'up', reach: 0.5, coverTop: 572, box: IPHONE_BOX },
      { do: 'confirm' },
      expect.objectContaining({ do: 'stop' }),
    ]); // five reads: round 0; 300 (stop) and its confirmation -48; 94 (stop) and its confirmation 94
  });

  it('iOS (WDA), the worse case: a fling that carries the row across the whole viewport between two reads (613 → -357) turns the next stroke round instead of swiping on DOWN into exhausted content', () => {
    const played = play({ ...FULLY, maxSwipes: 6 }, [613, -357, -215, -73, 69, 69].map((y) => wdaRow(y)));
    expect(resultOf(played)).toEqual({ swipes: 4, visible: 1, clipped: [] }); // the turned strokes halved
    expect(strokesToward(played)).toEqual(['down', 'up', 'up', 'up']); // down, then back up three times — ONE turn
  });

  it('a read that fails after a turn strokes as the last read round decided — turned — as it keeps that round\'s stroke box', () => {
    const played = play(FULLY, [wdaRow(681), wdaRow(300), wdaRow(-48), { error: 'WDA /source timed out' }]); // the read after the turned stroke
    expect(strokesToward(played)).toEqual(['down', 'up', 'up']);
    expect(strokeCovers(played)).toEqual([572, 572, 572]);
  });

  it('a read that no longer finds the target after a turn: the turned stroke carried it out the other way (it was short of that edge), so the next goes back — the caller\'s direction — as a turn of its own', () => {
    // Until 2026-10-09 this read cleared the turn ("a lazy list dropped it:
    // nothing to turn for") and the stroke went the caller's way for that
    // reason; now it goes the caller's way because the drop is read as the
    // target leaving through the edge the up-stroke moved it toward — and
    // it is counted as a turn, halving the reach again.
    const played = play(FULLY, [wdaRow(681), wdaRow(300), wdaRow(-48), wdaGone]); // the turned stroke drops it from the tree
    expect(strokesToward(played)).toEqual(['down', 'up', 'down']);
    expect(played.steps.filter((st) => st.do === 'stroke').map((st) => st.reach)).toEqual([1, 0.5, 0.25]);
  });

  it('a target first seen short only at a stop the confirming read then lost (not on the round-0 read) still turns the next stroke — where it stands is recorded on every read', () => {
    // Not in the tree on round 0 (a lazy list); the first stroke brings it in, the settle read catches it at 300, it rests at -48.
    const played = play(FULLY, [wdaGone, wdaRow(300), wdaRow(-48), wdaRow(94), wdaRow(94)]);
    expect(strokesToward(played)[1]).toBe('up'); // turned round after -48
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('a target read beyond the far edge before any read saw it short of it is the caller\'s direction to honour — on every round it stays there, not only round 0', () => {
    // Above the screen from the start; each content-down stroke carries it further up.
    const played = play(FULLY, [-357, -701, -1045, -1389, -1733].map((y) => wdaRow(y)));
    expect(strokesToward(played)).toEqual(['down', 'down', 'down', 'down']);
  });

  it('the turn is judged in the frame the round judged in: with the pad up, a row a content-up fling carried WHOLLY under the pad is beyond the frame\'s far edge, though inside the screen', () => {
    // Short (above the frame), flung to 600–652 — inside the 874-pt screen, wholly under the pad.
    const played = play({ ...FULLY, direction: 'up' }, [wdaRow(-200), wdaRow(600), wdaRow(256), wdaRow(256)]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(strokesToward(played)[1]).toBe('down'); // turned round: content down
  });

  it.each([
    ['down', [300, -44, -388], ['down', 'down']], // 300–1000 → -44–656: clipped at the top AND under the pad
    ['up', [-400, -117, 166], ['up', 'up']], // -400–300 → -117–583: clipped at the top AND under the pad
  ] as const)('a row TALLER than the frame, clipped at both edges, is not beyond either: no turn (%s)', (direction, ys, toward) => {
    const played = play({ ...FULLY, direction, maxSwipes: 2 }, ys.map((y) => wdaRow(y, 700)));
    expect(strokesToward(played)).toEqual(toward);
  });

  it(`a target still moving inside the viewport is read again until it holds still; one that never does is reported after SETTLE_CONFIRM_READS (${SETTLE_CONFIRM_READS}) more reads with settled: false, and the reply says so`, () => {
    const slowing = play(FULLY, [681, 300, 250, 250].map((y) => wdaRow(y))); // round 0, 300, 250, 250
    expect(resultOf(slowing)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    const restless = play(FULLY, [681, 300, 301, 302, 303].map((y) => wdaRow(y))); // round 0, the stop at 300, then three confirming reads — reported at 303
    const result = resultOf(restless);
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    expect(restless.steps.filter((s) => s.do === 'stroke')).toHaveLength(1);
    expect(describeScrollResult(result)).toBe(
      'fully visible after 1 swipe; still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match',
    );
  });

  it('the confirming budget is per stroke: a stop after a turn gets its own SETTLE_CONFIRM_READS', () => {
    // Stroke 1 spends two confirming reads (300 → 290 → -48, beyond); the turned stroke's stop needs three (235 → 240 → 245 → 245).
    const played = play(FULLY, [681, 300, 290, -48, 235, 240, 245, 245].map((y) => wdaRow(y)));
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('a stop reached at the deadline is reported unconfirmed — no confirming read past it', () => {
    const played = play({ ...FULLY, timeoutMs: 30 }, [wdaRow(681), { ...wdaRow(300), elapsedMs: 60 }]); // the deadline passed during the stroke
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    // AT the deadline is past it: a confirming read is spent only while elapsed < timeoutMs.
    const atIt = play({ ...FULLY, timeoutMs: 30 }, [wdaRow(681), { ...wdaRow(300), elapsedMs: 30 }]);
    expect(resultOf(atIt)).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    const before = play({ ...FULLY, timeoutMs: 30 }, [wdaRow(681), { ...wdaRow(300), elapsedMs: 29 }, { ...wdaRow(300), elapsedMs: 29 }]);
    expect(before.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
  });

  it('a confirming read that fails is read again, not answered with a stroke away from the stop', () => {
    const played = play(FULLY, [wdaRow(681), wdaRow(300), { error: 'WDA /source timed out' }, wdaRow(300)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'confirm', 'stop']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('a target flung past and turned round, which the turned strokes no longer move: the failure names the turns and the direction last swiped', () => {
    const played = play(FULLY, [613, -357, -357, -357].map((y) => wdaRow(y))); // carried past, then nothing moves it
    expect(failureOf(played, 'id:row').message).toMatch(
      /^scroll_until id:row failed after 3 swipes \(the last 2, swiping up, did not move it: content exhausted, or the swipes were not taken\) — element in tree but never intersected the 402x572 screen above the soft keyboard over \[0,572\]\[402,874\] \(last rect \{"x":24,"y":-357,"width":354,"height":52\}\)\. It was turned round 1 time: a swipe carried it past the viewport \(a fling\), so the next was drawn the other way\. The soft keyboard was up/,
    );
  });

  it('in the viewport after a swipe and gone by the last read: the failure says it was there — not "never appeared" (a lazy list drops what a fling carries off)', () => {
    const played = play(FULLY, [wdaRow(681), wdaRow(300), ...['a', 'b', 'c', 'd'].map((rest) => ({ ...wdaGone, rest }))]); // the list scrolls on without it
    const error = failureOf(played, 'id:row');
    expect(error.message).toMatch(
      /failed after 4 swipes \(maxSwipes\) — element was in the viewport after swipe 1 but did not stay — it is no longer in the tree \(a fling carried it off\? a lazy list drops what scrolls away\)/,
    );
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('in the viewport after a swipe and off the frame at the last read: "was in the viewport after swipe 1 but did not stay", not "never intersected"', () => {
    const played = play(FULLY, [681, 300, 700, 700, 700].map((y) => wdaRow(y))); // bounces back under the pad, then stuck
    expect(failureOf(played, 'id:row').message).toMatch(
      /failed after 3 swipes \(the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken\) — element was in the viewport after swipe 1 but did not stay \(a fling\?\) — in tree, off the 402x572 screen above the soft keyboard over \[0,572\]\[402,874\] at the last read \(last rect/,
    );
  });

  /** The form's last field under an IME its container does not resize for: nothing moves it. */
  const lastField = (rect: Rect): Row => ({ found: [match(rect, 'my_note_input')], cover: UP_IME });

  it('Android: a row WHOLLY under the IME at the end of the content fails after the two identical swipes that did not move it — not at the 15 s timeout — in the stop bound\'s words, naming the keyboard', () => {
    const field = lastField({ x: 66, y: 1769, width: 948, height: 143 }); // the measured my_note_input
    const played = play({ ...ANDROID, fully: true, maxSwipes: 6, timeoutMs: 15_000 }, [field, field, field]);
    expect(played.steps.filter((s) => s.do === 'stroke')).toHaveLength(2);
    const error = failureOf(played, 'id:my_note_input');
    expect(error).not.toBeInstanceOf(ElementNotFoundError); // it was in the tree
    expect(error.message).toBe(
      'scroll_until id:my_note_input failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes ' +
        'were not taken) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] ' +
        '(last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 3 of the 3 rounds ' +
        'read: in those, visibility was judged, and the swipe drawn, in the screen above it — to reach it with the keyboard down, hide it ' +
        'first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again',
    );
  });

  it('a zero-area rect carries no position — it is not called exhausted, the scroll runs to its bound', () => {
    // An unchanged tree too (code review: without a fingerprint the whole-tree rule could not fire here, so it did not prove the match rule's).
    const field: Row = { ...lastField({ x: 66, y: 1769, width: 948, height: 0 }), rest: 'f' };
    expect(failureOf(play(ANDROID, [field, field, field, field, field]), 'id:my_note_input').message).toMatch(/failed after 4 swipes \(maxSwipes\)/);
  });

  it('one stroke that moves nothing is a transient (a snackbar dismissed by the first touch), not exhausted content: the next one scrolls', () => {
    expect(resultOf(play({ ...SCROLLING, maxSwipes: 6 }, reads([3100, 3100, 2500, 1900, 1900], (y) => button(y))))).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('several matches off the frame: exhausted only when NO match moved — a static duplicate first in tree order is not the target the strokes move (review round 1)', () => {
    const ghost = () => match({ x: 5000, y: 100, width: 100, height: 40 }, 'submit_button'); // another page
    const rows = [3700, 3100, 2500, 1900, 1900].map((y): Row => ({ found: [ghost(), button(y)] }));
    expect(resultOf(play(SCROLLING, rows))).toEqual({ swipes: 3, visible: 1, clipped: [] }); // 3700 → 1900
  });

  it('a match that LEAVES the tree is a change: the set the strokes compare is every match, counted — a static duplicate left behind starts the count afresh', () => {
    const ghost = () => match({ x: 5000, y: 100, width: 100, height: 40 }, 'submit_button');
    // Stroke 1: the set changed (two → one); strokes 2 and 3 leave the one where it was.
    const played = play({ ...SCROLLING, maxSwipes: 6 }, [{ found: [ghost(), button(3700)] }, { found: [ghost()] }, { found: [ghost()] }, { found: [ghost()] }]);
    expect(failureOf(played, 'id:submit_button').message).toMatch(/^scroll_until id:submit_button failed after 3 swipes \(the last 2/);
  });

  it('two unmoved strokes count only when they are the SAME stroke: a whole-screen stroke on an IME still coming up, then one drawn above it, is two attempts, not exhaustion', () => {
    // Round 0: the stale window denied, so a whole-screen stroke; the first two strokes are not taken.
    const played = play({ ...ANDROID, maxSwipes: 6 }, [
      { found: [formRow(2900)], cover: UP_IME, corroborated: false },
      { found: [formRow(2900)], cover: UP_IME },
      { found: [formRow(2900)], cover: UP_IME },
      { found: [formRow(2300)], cover: UP_IME },
      { found: [formRow(1700)], cover: UP_IME },
      { found: [formRow(1100)], cover: UP_IME },
      { found: [formRow(1100)], cover: UP_IME },
    ]);
    expect(strokeCovers(played).slice(0, 2)).toEqual([undefined, 1398]);
    expect(resultOf(played)).toEqual({ swipes: 5, visible: 1, clipped: [] }); // 2900 → 2300 → 1700 → 1100
  });

  it('fully: true, clipped: the two unmoved strokes must be the SAME stroke — one above the IME, then one whole-screen once the window reads hidden, are two attempts', () => {
    const wide = (row: Row): Row => ({ ...row, found: [match({ x: 900, y: 1360, width: 300, height: 73 }, 'row')] }); // clipped at the right edge whatever the keyboard
    const played = play({ ...ANDROID, fully: true }, [wide({ cover: UP_IME }), wide({}), wide({}), wide({})]); // no stroke is taken
    expect(strokeCovers(played)).toEqual([1398, undefined, undefined]);
    expect(failureOf(played, 'id:row').message).toMatch(/^scroll_until id:row failed after 3 swipes — element is in the viewport but CLIPPED at right/);
  });

  it('fully: true, clipped: a confirming read is not a stroke for the stuck test, even once two strokes left the row unmoved', () => {
    // 1360 straddles the IME: clipped (two strokes not taken); the window reads hidden — a clean stop; its confirmation
    // reads the IME again and clips it — not "content exhausted": the next stroke scrolls (760).
    const played = play({ ...ANDROID, fully: true }, [
      { found: [formRow(1360)], cover: UP_IME },
      { found: [formRow(1360)], cover: UP_IME },
      { found: [formRow(1360)] },
      { found: [formRow(1360)], cover: UP_IME },
      { found: [formRow(760)], cover: UP_IME },
      { found: [formRow(760)], cover: UP_IME },
    ]);
    expect(resultOf(played)).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('a confirming read is not a stroke for the exhausted count: the stop read without the band, its confirmation under it, then ONE stroke not taken — not "content exhausted"', () => {
    // Round 0 under the IME (stroke above it: 2506 → 1906); the stop at 1906 read with the window hidden; its confirmation with
    // it shown (off the frame); the next stroke is not taken; the one after scrolls (1306).
    const played = play(ANDROID, [
      { found: [formRow(2506)], cover: UP_IME },
      { found: [formRow(1906)] },
      { found: [formRow(1906)], cover: UP_IME },
      { found: [formRow(1906)], cover: UP_IME },
      { found: [formRow(1306)], cover: UP_IME },
      { found: [formRow(1306)], cover: UP_IME },
    ]);
    expect(resultOf(played)).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('a confirming read is not a stroke for the fully: true stuck test either: a stop it finds clipped at the band, unmoved, is swiped on — not "content exhausted"', () => {
    // 1960 under the IME → 1360; the stop read with the window hidden (fully visible); its confirmation clips it at 1398.
    const played = play({ ...ANDROID, fully: true }, [
      { found: [formRow(1960)], cover: UP_IME },
      { found: [formRow(1360)] },
      { found: [formRow(1360)], cover: UP_IME },
      { found: [formRow(760)], cover: UP_IME },
      { found: [formRow(760)], cover: UP_IME },
    ]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] }); // → 760
  });

  it('a confirming read sent no stroke: a target it finds unmoved but under a keyboard the stop round did not apply is not counted against the content', () => {
    // Denied on round 0 and on the stop at y 1906 (judged whole-screen); confirmed on the read confirming it.
    const played = play({ ...ANDROID, fully: true }, [
      { found: [formRow(2506)], cover: UP_IME, corroborated: false },
      { found: [formRow(1906)], cover: UP_IME, corroborated: false },
      { found: [formRow(1906)], cover: UP_IME },
      { found: [formRow(1306)], cover: UP_IME },
      { found: [formRow(1306)], cover: UP_IME },
    ]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] }); // 1906 under the IME → one stroke above it → 1306
    expect(strokeCovers(played)[1]).toBe(1398);
  });
});

describe('round — the round bound (code review of round 2, 2026-10-08)', () => {
  it(`at the defaults the rounds number at most 1 + (1 + SETTLE_CONFIRM_READS) × maxSwipes = 25: a target that leaves the frame every fourth read after a stroke`, () => {
    // Round 0 below the fold; after any stroke, three reads in the frame each at a new y (a stop that never confirms), then one off it.
    const ys = [3000, ...Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 3000 : 100 + i * 10))];
    const played = play({ direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: SCROLLING.screen }, ys.map((y) => ({ found: [button(y)] })));
    expect(played.steps).toHaveLength(1 + (1 + SETTLE_CONFIRM_READS) * 6);
    expect(played.steps.filter((s) => s.do === 'stroke')).toHaveLength(6);
    expect(failureOf(played, 'id:t').message).toContain('failed after 6 swipes (maxSwipes)');
  });
});

describe('round — a fully: true stop flush with its clipping scroll container (Android, docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md)', () => {
  /** The SWIFT form's scroll container, `[0,242][1080,1978]`: the top bar above 242, the pinned CONTINUE bar from 1979. */
  const FORM: Rect = { x: 0, y: 242, width: 1080, height: 1736 };
  const FULLY_ANDROID: Rules = { ...ANDROID, fully: true };
  /** A form row at `y`, `height` tall (143 uncut), x 66 948 wide, its container FORM. */
  const formRead = (y: number, height = 143, extra: Row = {}): Row => ({ found: [match({ x: 66, y, width: 948, height }, 'fees')], scroller: FORM, ...extra });
  const probeOf = (played: ReturnType<typeof play>) => played.steps.filter((s) => s.do === 'stroke' && s.probe === true);

  it('the measured Fees row, cut by the top bar to {y:242, height:92}, with the DEFAULT direction down: probed TOWARD the top edge (content up), inside the container — never stroked away', () => {
    // At rest the row starts 51 px above 242; the probe moves the content down 260 px: the row reads whole at 451.
    const played = play(FULLY_ANDROID, [formRead(242, 92), formRead(451), formRead(451)]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'up', reach: 0.25, box: FORM, probe: true, maxTravel: 177 });
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] }); // no flush left: the row is whole
  });

  it('the measured Priority row, cut by CONTINUE to {y:1846, height:132}: probed toward the bottom edge (content down)', () => {
    const played = play(FULLY_ANDROID, [formRead(1846, 132), formRead(1586), formRead(1586)]);
    expect(probeOf(played)).toEqual([{ do: 'stroke', toward: 'down', reach: 0.25, box: FORM, probe: true, maxTravel: 177 }]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('a row at the fold of a list with no chrome (Settings, list [0,737][1080,2154]): flush with the bottom, probed, revealed', () => {
    const LIST: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
    const row = (y: number, height = 198): Row => ({ found: [match({ x: 0, y, width: 1080, height }, 'modes')], scroller: LIST });
    const played = play(FULLY_ANDROID, [row(2053, 101), row(1800), row(1800)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(resultOf(played).clipped).toEqual([]);
  });

  it('edge-to-edge: a row half below the display in a full-screen scroller reads flush with 2220 — the display clips too — and is probed', () => {
    const SCREEN_SCROLLER: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
    const row = (y: number, height = 143): Row => ({ found: [match({ x: 66, y, width: 948, height })], scroller: SCREEN_SCROLLER });
    const played = play(FULLY_ANDROID, [row(2140, 80), row(1880), row(1880)]);
    expect(probeOf(played)).toHaveLength(1);
    expect(strokesToward(played)).toEqual(['down']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('the first row of a list at rest is flush with its container\'s top and NOT cut: the probe moves nothing and the stop is accepted — one extra stroke, the stated cost, said in the reply', () => {
    const played = play(FULLY_ANDROID, [formRead(242), formRead(242)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']); // no confirming read: it held still through the probe
    const result = resultOf(played);
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], flush: { edge: 'top', container: FORM, checked: true } });
    expect(describeScrollResult(result)).toBe(
      "fully visible after 1 swipe; its top edge lies on its scroll container's (0,242 1080x1736), and a probe swipe toward it moved nothing — nothing of it is cut there",
    );
  });

  it('one probe per candidate stop: a probe that moves the row to a NEW flush stop (cut by more than the probe reveals) probes again; the one after which it holds is accepted', () => {
    const played = play({ ...FULLY_ANDROID, maxSwipes: 6 }, [formRead(242, 20), formRead(242, 60), formRead(242, 60), formRead(242, 100), formRead(242, 100)]);
    // probe; moved (20 → 60): confirm; held: a new candidate, probe; moved: …
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stroke']);
    expect(probeOf(played)).toHaveLength(3);
  });

  it('no swipe left to probe with: reported fully visible with flush unchecked, and the reply says it may be cut', () => {
    const played = play({ ...FULLY_ANDROID, maxSwipes: 0 }, [formRead(242, 92)]);
    const result = resultOf(played);
    expect(result.flush).toEqual({ edge: 'top', container: FORM, checked: false, why: 'budget' });
    expect(describeScrollResult(result)).toBe(
      "fully visible after 0 swipes; but its top edge lies on its scroll container's (0,242 1080x1736), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there, a rect assert or screenshot may measure part of it",
    );
    const late = play({ ...FULLY_ANDROID, timeoutMs: 10 }, [{ ...formRead(242, 92), elapsedMs: 10 }]);
    expect(resultOf(late).flush?.checked).toBe(false);
  });

  it.each([
    ['no clipping container (every iOS node; an Android node with no scrollable ancestor)', { found: [match({ x: 66, y: 242, width: 948, height: 92 })] }],
    ['flush across the scroll only (a grid cell at the left edge of a vertical list)', { found: [match({ x: 0, y: 500, width: 300, height: 143 })], scroller: FORM }],
    ['inside the container by more than a pixel', formRead(244, 90)],
  ] as const)('no probe: %s', (_, row) => {
    const played = play(FULLY_ANDROID, [row as Row]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(resultOf(played).flush).toBeUndefined();
  });

  it('flush with BOTH edges along the scroll — a row taller than its list, cut at both ends, reads the list\'s rect: NOT probed (one probe cannot tell which side is cut), reported unchecked, `fills`, and the reply says so (code review of round 3)', () => {
    const played = play(FULLY_ANDROID, [formRead(242, 1736)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    const result = resultOf(played);
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [], flush: { edges: ['top', 'bottom'], container: FORM, checked: false, why: 'fills' } });
    expect(describeScrollResult(result)).toBe(
      "fully visible after 0 swipes; but it fills its scroll container (0,242 1080x1736) exactly — its top and bottom edges lie on the container's, " +
        "where Android cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — it may be cut there, " +
        'a rect assert or screenshot may measure part of it; usual for a card as tall as its carousel — check with a screenshot',
    );
    // Within a pixel, as a one-edge flush is; and along the scroll's axis: a sideways scroll's are left and right.
    expect(resultOf(play(FULLY_ANDROID, [formRead(243, 1734)])).flush).toMatchObject({ why: 'fills' });
    const PAGER: Rect = { x: 0, y: 500, width: 1080, height: 600 };
    const page: Row = { found: [match({ x: 0, y: 520, width: 1080, height: 500 }, 'page')], scroller: PAGER };
    expect(resultOf(play({ ...FULLY_ANDROID, direction: 'right' }, [page])).flush).toEqual({ edges: ['left', 'right'], container: PAGER, checked: false, why: 'fills' });
  });

  it('within a pixel counts as flush (a rounding in the tree source)', () => {
    expect(probeOf(play(FULLY_ANDROID, [formRead(243, 92), formRead(243, 92)]))).toHaveLength(1);
  });

  it('only on fully: true — the default stop is not the flush check\'s business (intersection is its bar)', () => {
    expect(play(ANDROID, [formRead(242, 92)]).steps.map((s) => s.do)).toEqual(['stop']);
  });

  it('a probe the other way from the caller\'s direction is not a turn: the stroke after it has the full reach, and no turn is counted', () => {
    // The probe toward the top; the row is gone after it (moved off), so the scroll strokes on the caller's way.
    const played = play({ ...FULLY_ANDROID, maxSwipes: 2 }, [formRead(242, 92), { found: [], scroller: FORM }, { found: [] }]);
    const strokes = played.steps.filter((s) => s.do === 'stroke');
    expect(strokes.map((s) => [s.toward, s.reach, s.probe === true])).toEqual([
      ['up', 0.25, true],
      ['down', 1, false],
    ]);
    expect(played.outcome).toMatchObject({ kind: 'bound', turns: 0 });
  });

  it('a read after the probe that fails is read again — not answered with a stroke the caller\'s way', () => {
    const played = play(FULLY_ANDROID, [formRead(242), { error: 'uiautomator dump returned no XML' }, formRead(242)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(resultOf(played).flush).toEqual({ edge: 'top', container: FORM, checked: true });
  });

  it('a keyboard band the moot rule never asked about is asked about before the probe, and the probe keeps clear of it', () => {
    // A container that resizes for the IME: [0,242][1080,1398]; the row flush with its bottom is clean whole-screen and above the band — moot.
    const RESIZED: Rect = { x: 0, y: 242, width: 1080, height: 1156 };
    const row: Row = { found: [match({ x: 66, y: 1300, width: 948, height: 98 })], scroller: RESIZED, cover: UP_IME };
    const played = play(FULLY_ANDROID, [row, { ...row, found: [match({ x: 66, y: 1100, width: 948, height: 143 })] }, { ...row, found: [match({ x: 66, y: 1100, width: 948, height: 143 })] }]);
    expect(played.rounds[0].asks).toEqual(['witness']);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, coverTop: 1398, box: RESIZED, probe: true, maxTravel: 177 });
    // Denied: the probe is drawn over the container whole.
    const denied = play(FULLY_ANDROID, [{ ...row, corroborated: false }, row]);
    expect(denied.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, box: RESIZED, probe: true, maxTravel: 177 });
  });
});

describe('round — a lazy list that drops the target, and a screen strokes no longer change (docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md)', () => {
  const FULLY_ANDROID: Rules = { ...ANDROID, fully: true, maxSwipes: 6, timeoutMs: 15_000 };
  /** Contacts' `Last name` row, x 132, 816x160, the docked IME up. */
  const lastName = (y: number): Row => ({ found: [match({ x: 132, y, width: 816, height: 160 }, 'last_name')], cover: UP_IME });
  const imeGone: Row = { found: [], cover: UP_IME };
  const reachOf = (played: ReturnType<typeof play>) => played.steps.flatMap((st) => (st.do === 'stroke' ? [st.reach] : []));

  it('measured: clipped by the IME at round 0, dropped by the first stroke — turned BACK (up), halved, and found, instead of four more strokes down into the end of the editor', () => {
    const played = play(FULLY_ANDROID, [lastName(1317), imeGone, lastName(900), lastName(900)]);
    expect(strokesToward(played)).toEqual(['down', 'up']);
    expect(reachOf(played)).toEqual([1, 0.5]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('measured: WHOLLY under the IME at round 0 (in the tree, visible 0), dropped by the first stroke — turned back too: it was short of the far edge', () => {
    const played = play({ ...FULLY_ANDROID, maxSwipes: 3 }, [lastName(1409), ...['a', 'b', 'c'].map((rest) => ({ ...imeGone, rest }))]); // the editor scrolls, never back to it
    expect(strokesToward(played)).toEqual(['down', 'up', 'up']); // back, and on back while it stays out — not ping-pong
    // The wording: it WAS in the tree — not "never appeared", and the class agrees (a plain Error, it was sighted).
    const error = failureOf(played, 'text:"Last name"');
    expect(error.message).toMatch(
      /^scroll_until text:"Last name" failed after 3 swipes \(maxSwipes\) — element was in the tree before the first swipe \(off the viewport, or under the soft keyboard\), never in the viewport, and is no longer in the tree — a swipe carried it out \(a fling\?\) and a lazy list drops what scrolls away\. It was turned round 1 time/,
    );
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('a failed read is not a drop: the round strokes the caller\'s way, as before; the read after it, without the target, is', () => {
    const played = play({ ...FULLY_ANDROID, maxSwipes: 2 }, [lastName(1317), { error: 'uiautomator dump returned no XML' }, imeGone]);
    expect(strokesToward(played)).toEqual(['down', 'down']);
    const after = play({ ...FULLY_ANDROID, maxSwipes: 3 }, [lastName(1317), { error: 'uiautomator dump returned no XML' }, imeGone, imeGone]);
    expect(strokesToward(after)).toEqual(['down', 'down', 'up']);
  });

  it('a target last read BEYOND the far edge, then dropped, is not turned for: it already lay where the caller\'s strokes push it (iOS, read above the frame from the start)', () => {
    const played = play({ ...IPHONE, fully: true, maxSwipes: 3 }, [wdaRow(-357), wdaGone, wdaGone, wdaGone]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'down']);
  });

  it('dropped on the confirming read after a stop (the fling went on after the settle read): turned back too', () => {
    const played = play(FULLY_ANDROID, [lastName(2400), lastName(700), imeGone, lastName(800), lastName(800)]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stop']);
    expect(strokesToward(played)).toEqual(['down', 'up']);
  });

  /** Settings' list, for the stroke box. */
  const LIST: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
  const OTHER: Rect = { x: 0, y: 300, width: 1080, height: 300 };

  it('the stroke is drawn over the screen\'s largest clipping container until a read places the target in one, then over the target\'s; a round whose tree did not read keeps the last; none on iOS', () => {
    const played = play({ ...ANDROID, maxSwipes: 4 }, [
      { found: [], mainScroller: LIST },
      { found: [match({ x: 0, y: 2400, width: 1080, height: 198 })], scroller: OTHER, mainScroller: LIST },
      { error: 'uiautomator dump returned no XML' },
      { found: [], mainScroller: LIST },
      { found: [] },
    ]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [st.box] : []))).toEqual([LIST, OTHER, OTHER, OTHER]);
    expect(play({ ...IPHONE, maxSwipes: 1 }, [{ found: [] }, { found: [] }]).steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: IPHONE_BOX });
  });

  /** A read without the target, the rest of the screen reading `rest`. */
  const tree = (rest: string, extra: Row = {}): Row => ({ found: [], rest, ...extra });

  it('measured: row_40 of a list that ends at row_36 — not in the tree, and two identical strokes after which the WHOLE tree is unchanged: content exhausted, at once — ElementNotFoundError, it was never seen', () => {
    const played = play(FULLY_ANDROID, [tree('a'), tree('b'), tree('b'), tree('b')]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'down']);
    const error = failureOf(played, 'id:transactions.list.row_40');
    expect(error.message).toBe(
      'scroll_until id:transactions.list.row_40 failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
    expect(error).toBeInstanceOf(ElementNotFoundError);
  });

  it('a tree that changes (a clock, an animation), or ONE unchanged stroke, or two DIFFERENT strokes, is not exhausted', () => {
    expect(play({ ...FULLY_ANDROID, maxSwipes: 4 }, ['a', 'b', 'c', 'd', 'e'].map((f) => tree(f))).outcome).toMatchObject({ by: { of: 'maxSwipes' } });
    expect(play({ ...FULLY_ANDROID, maxSwipes: 4 }, ['a', 'a', 'b', 'b', 'c'].map((f) => tree(f))).outcome).toMatchObject({ by: { of: 'maxSwipes' } });
    // A dropped target turns the stroke: the unchanged reads after it are counted from the new stroke.
    const turned = play({ ...FULLY_ANDROID, maxSwipes: 6 }, [{ ...lastName(1317), rest: 'a' }, { ...imeGone, rest: 'b' }, { ...imeGone, rest: 'b' }, { ...imeGone, rest: 'b' }]);
    expect(strokesToward(turned)).toEqual(['down', 'up', 'up']);
    expect(turned.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree', lastStroke: 'up' } });
    // Unchanged after the first stroke down AND after the turned one up: two strokes, but not the same stroke — the streak starts again.
    const twoKinds = play({ ...FULLY_ANDROID, maxSwipes: 6 }, [{ ...lastName(1317), rest: 'a' }, { ...imeGone, rest: 'a' }, { ...imeGone, rest: 'a' }, { ...imeGone, rest: 'a' }]);
    expect(twoKinds.outcome).toMatchObject({ swipes: 3, by: { of: 'exhausted', unchanged: 'tree' } });
    // Every read is a tree the round reads itself (deep/r3-scroll): rows that name nothing are one unchanged screen —
    // exhausted, as on a device. Until then a row without a fingerprint never was: the rule a driver could forget.
    expect(play({ ...FULLY_ANDROID, maxSwipes: 3 }, [{ found: [] }, { found: [] }, { found: [] }]).outcome).toMatchObject({ by: { of: 'exhausted', unchanged: 'tree' } });
  });

  it('a target IN the tree off the frame keeps the match rule\'s words ("did not move it"), whatever the tree', () => {
    const row = (rest: string): Row => ({ found: [formRow(2900)], rest });
    expect(failureOf(play(ANDROID, [row('a'), row('a'), row('a')]), 'id:t').message).toMatch(/the last 2, swiping down, did not move it/);
  });
});

describe('round — the flush check across nested clipping containers, and a probe that may have been a tap (code review of fix/r3-scroll, 2026-10-09)', () => {
  const FULLY_ANDROID: Rules = { ...ANDROID, fully: true };
  /** The vertical list, `[0,242][1080,1978]`. */
  const LIST: Rect = { x: 0, y: 242, width: 1080, height: 1736 };
  /** A horizontal carousel 400 px tall whose top is `strip` px above the list's bottom: read cut to the strip. */
  const carousel = (strip: number): Rect => ({ x: 0, y: 1978 - strip, width: 1080, height: strip });
  /** A card in it, x 40 600 wide, read from `top` to the strip's bottom. */
  const card = (top: number): UiNode => match({ x: 40, y: top, width: 600, height: 1978 - top }, 'card');

  it.each([30, 78])('a card cut with its carousel to a %i-px strip by the list\'s bottom: probed toward the bottom, over the LIST — the strip has no room for a stroke (it would be a tap on the card)', (strip) => {
    // The card shorter than the carousel: flush with the carousel's bottom only — the nearest ancestor flush on one edge.
    const row: Row = { found: [card(1978 - strip + 4)], scrollers: [carousel(strip), LIST] };
    const played = play(FULLY_ANDROID, [row, row]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, box: LIST, probe: true, maxTravel: 177 });
    expect(resultOf(played).flush).toEqual({ edge: 'bottom', container: carousel(strip), checked: true });
  });

  it('a card that FILLS its carousel\'s height (flush with both its edges), the carousel cut by the list to 78 of 400 px: probed against the list it is cut by — not "fully visible after 0 swipes"', () => {
    const row: Row = { found: [card(1900)], scrollers: [carousel(78), LIST] };
    const played = play(FULLY_ANDROID, [row, row]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke', toward: 'down', box: LIST, probe: true });
    expect(resultOf(played).flush).toEqual({ edge: 'bottom', container: LIST, checked: true });
  });

  it('the strokes toward the target too are drawn over its first clipping ancestor with room for one: the list, not the carousel strip it was read in', () => {
    // Read in the strip but not judged in the frame (no area left of it): the scroll strokes on.
    const row: Row = { found: [match({ x: 40, y: 1978, width: 600, height: 0 }, 'card')], scrollers: [carousel(30), LIST] };
    expect(play({ ...FULLY_ANDROID, maxSwipes: 1 }, [row, row]).steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: LIST });
  });

  it('not probed only when flush with BOTH edges of every clipping ancestor (it fills them all) — and then reported unchecked, `fills`, against the nearest', () => {
    const row: Row = { found: [card(1900)], scrollers: [carousel(78), carousel(78)] };
    const played = play(FULLY_ANDROID, [row]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    expect(resultOf(played).flush).toEqual({ edges: ['top', 'bottom'], container: carousel(78), checked: false, why: 'fills' });
  });

  it('a card that fills a carousel lying whole inside the list: `fills`, named against the carousel — the list around it is no edge of it', () => {
    const MIDDLE: Rect = { x: 0, y: 1000, width: 1080, height: 400 };
    const played = play(FULLY_ANDROID, [{ found: [match({ x: 40, y: 1000, width: 600, height: 400 }, 'card')], scrollers: [MIDDLE, LIST] }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    expect(resultOf(played).flush).toEqual({ edges: ['top', 'bottom'], container: MIDDLE, checked: false, why: 'fills' });
  });

  it('no clipping ancestor with room for a stroke (a lone 30- or 79-px scroller): NO probe — over the screen it would touch down off the container — and the stop is reported unchecked, saying why', () => {
    for (const strip of [30, 79]) {
      const played = play(FULLY_ANDROID, [{ found: [card(1978 - strip + 4)], scrollers: [carousel(strip)] }]);
      expect(played.steps.map((st) => st.do)).toEqual(['stop']);
      const result = resultOf(played);
      expect(result).toEqual({ swipes: 0, visible: 1, clipped: [], flush: { edge: 'bottom', container: carousel(strip), checked: false, why: 'room' } });
      expect(describeScrollResult(result)).toMatch(/no scroll container around it has room for a probe swipe to check it — it may be cut there/);
    }
  });

  // The stroke box judged twice (deep/r3-scroll, 2026-10-09): the round judged room over the screen, the driver over the
  // screen ABOVE the keyboard, and fell back to the whole screen when that had none — a probe touching down off the
  // container moves nothing, and that was reported "nothing of it is cut there".
  it('a probe whose container has room on the screen but not above the keyboard is not sent — `room`, never `checked` — and an outer ancestor with room above it is probed instead', () => {
    // A list running on under the IME from y 1340: 800 px on the screen, 58 above the keyboard's top (1398).
    const UNDER: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const row = (scrollers: readonly Rect[]): Row => ({ found: [match({ x: 66, y: 1340, width: 948, height: 50 }, 'row')], scrollers, cover: UP_IME });
    const lone = play(FULLY_ANDROID, [row([UNDER])]);
    expect(lone.steps.map((st) => st.do)).toEqual(['stop']);
    expect(resultOf(lone).flush).toEqual({ edge: 'top', container: UNDER, checked: false, why: 'room' });
    expect(lone.asks).toEqual(['witness', 'unlocated']); // the band asked about before the room above it is judged
    const nested = play(FULLY_ANDROID, [row([UNDER, LIST]), row([UNDER, LIST])]);
    expect(nested.steps[0]).toMatchObject({ do: 'stroke', toward: 'up', coverTop: 1398, box: LIST, probe: true });
    expect(resultOf(nested).flush).toEqual({ edge: 'top', container: UNDER, checked: true });
  });

  it('the strokes toward the target too: its container is chosen by its room ABOVE the keyboard — the list around it, not the one running on under the IME (until deep/r3-scroll: that one, and the driver then drew over the whole screen)', () => {
    const UNDER: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const row: Row = { found: [match({ x: 66, y: 1700, width: 948, height: 73 }, 'row')], scrollers: [UNDER, LIST], cover: UP_IME }; // wholly under the IME
    const played = play({ ...FULLY_ANDROID, maxSwipes: 1 }, [row, row]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398, box: LIST });
    // With the keyboard down the nearer one has room, and is the one.
    const down = play({ ...FULLY_ANDROID, maxSwipes: 1 }, [{ ...row, found: [match({ x: 66, y: 2300, width: 948, height: 73 }, 'row')], cover: undefined }, row]);
    expect(down.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: { x: 0, y: 1340, width: 1080, height: 800 } });
  });

  it('a stroke toward a target not read yet: the screen\'s largest scroller is met above the keyboard too — one running on under the IME from 58 px above it leaves no room, so the stroke goes over the screen box; a failed read\'s stroke, which keeps that scroller and that cover, likewise', () => {
    const UNDER: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const played = play({ ...ANDROID, maxSwipes: 2 }, [
      { found: [], mainScroller: UNDER, cover: UP_IME, rest: 'a' },
      { error: 'uiautomator dump returned no XML' },
      { found: [], mainScroller: UNDER, cover: UP_IME, rest: 'b' },
    ]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.coverTop, st.box]] : []))).toEqual([
      [1398, SCREEN_1080],
      [1398, SCREEN_1080],
    ]);
    // With the keyboard down it has room, and is the box.
    const down = play({ ...ANDROID, maxSwipes: 1 }, [{ found: [], mainScroller: UNDER, rest: 'a' }, { found: [], rest: 'b' }]);
    expect(down.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: UNDER });
  });

  it('a read that finds the target in no container with room drops the last read\'s container — stale, maybe another list — and strokes over the screen box (code review of deep/r3-scroll, P5)', () => {
    const OTHER: Rect = { x: 0, y: 300, width: 1080, height: 300 };
    const UNDER: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const played = play({ ...ANDROID, maxSwipes: 2 }, [
      { found: [match({ x: 66, y: 2500, width: 948, height: 73 }, 'row')], scroller: OTHER }, // placed in OTHER: stroked over it
      { found: [match({ x: 66, y: 1700, width: 948, height: 73 }, 'row')], scroller: UNDER, cover: UP_IME }, // now in a list with no room above the IME
      { found: [match({ x: 66, y: 1650, width: 948, height: 73 }, 'row')], scroller: UNDER, cover: UP_IME },
    ]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [st.box] : []))).toEqual([OTHER, SCREEN_1080]); // not OTHER again
  });

  it('…over the screen box, never the screen\'s largest scroller: with the target in none of them, a larger list WITH room is not its list (verification round of deep/r3-scroll)', () => {
    const UNDER: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const PAGE: Rect = { x: 0, y: 100, width: 1080, height: 1200 }; // a sibling, larger, wholly above the IME
    const row = (y: number, extra: Row = {}): Row => ({ found: [match({ x: 66, y, width: 948, height: 73 }, 'row')], scroller: UNDER, mainScroller: PAGE, ...extra });
    const played = play({ ...ANDROID, maxSwipes: 2 }, [row(2300), row(1700, { cover: UP_IME }), row(1650, { cover: UP_IME })]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.box, st.coverTop]] : []))).toEqual([
      [UNDER, undefined], // placed in UNDER, no keyboard
      [SCREEN_1080, 1398], // UNDER has no room above the IME: the screen box — not PAGE
    ]);
  });

  it('a lone strip under a band the moot rule left unasked: no room even over the whole screen — `room` at once, the witness NOT asked (room is judged first without the band, so the ask order is as before deep/r3-scroll)', () => {
    const LOW_BAND = coverOver({ x: 0, y: 2000, width: 1080, height: 220 }); // the card ends at 1978, above it: moot
    const played = play(FULLY_ANDROID, [{ found: [card(1978 - 30 + 4)], scrollers: [carousel(30)], cover: LOW_BAND }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    expect(resultOf(played).flush).toEqual({ edge: 'bottom', container: carousel(30), checked: false, why: 'room' });
    expect(played.asks).toEqual(['unlocated']);
  });

  it('room is judged over the GESTURE box the stroke would be drawn in, not the judged frame: a landscape window crowned as a child turns the gesture box but not the frame — a container below the turned box\'s bottom has no room there, so no probe', () => {
    const PORTRAIT: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
    const screen = { box: { x: 0, y: 0, width: 2220, height: 1080 }, boxes: [PORTRAIT] }; // swipe.ts#judgedBoxes: turned gesture, panel as built judged
    const LOW: Rect = { x: 0, y: 1100, width: 1080, height: 600 };
    const played = play(FULLY_ANDROID, [{ found: [match({ x: 66, y: 1100, width: 948, height: 143 }, 'row')], scroller: LOW, screen }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    expect(resultOf(played).flush).toEqual({ edge: 'top', container: LOW, checked: false, why: 'room' });
  });

  it('a probe drawn shorter than twice TOUCH_SLOP (a tap?) that moved nothing is reported NOT checked — never "nothing of it is cut there"', () => {
    const LIST_TOP = formLikeRow(242);
    const tap = { from: { x: 540, y: 1972 }, to: { x: 540, y: 1954 } }; // 18 px — the review's reproduction
    const played = play(FULLY_ANDROID, [LIST_TOP, { ...LIST_TOP, drawn: tap }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'stop']);
    const result = resultOf(played);
    expect(result.flush).toEqual({ edge: 'top', container: LIST, checked: false, why: 'tap' });
    expect(describeScrollResult(result)).toMatch(/the probe swipe was too short to tell from a tap — it may be cut there/);
  });

  /** A row at `y` in LIST. */
  function formLikeRow(y: number): Row {
    return { found: [match({ x: 66, y, width: 948, height: 143 }, 'row')], scroller: LIST };
  }

  it('the probe\'s travel is capped at 0.08 of the screen\'s long side (pull-to-refresh: PROBE_MAX_TRAVEL_FRACTION) — 204 on a 1600x2560 tablet', () => {
    const TABLET: Rules = { ...FULLY_ANDROID, screen: { width: 1600, height: 2560 } };
    expect(play(TABLET, [formLikeRow(242), formLikeRow(242)]).steps[0]).toMatchObject({ probe: true, maxTravel: 204 });
  });

  it('a probe toward the top that drops the target from the tree: the next stroke goes back DOWN — the way the probe moved the content is what it left by — though the caller\'s direction is up', () => {
    const played = play({ ...FULLY_ANDROID, direction: 'up', maxSwipes: 2 }, [formLikeRow(242), { found: [], scroller: LIST }, { found: [] }]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.toward, st.probe === true]] : []))).toEqual([
      ['up', true],
      ['down', false],
    ]);
  });

  it('a list still loading its next page — a spinner, the tree otherwise unchanged — is not called exhausted; the sentence names loading among the causes when no spinner shows', () => {
    const spinning: Row = { found: [], rest: 'same', loading: true };
    expect(play({ ...FULLY_ANDROID, maxSwipes: 4 }, [spinning, spinning, spinning, spinning, spinning]).outcome).toMatchObject({ by: { of: 'maxSwipes' } });
    const still: Row = { found: [], rest: 'same' };
    expect(failureOf(play({ ...FULLY_ANDROID, maxSwipes: 4 }, [still, still, still]), 'id:row').message).toMatch(/did not change the screen: content exhausted, still loading, or the swipes were not taken/);
  });
});

describe('round — a node drawn over the stroke\'s container (docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md)', () => {
  const FULLY_ANDROID: Rules = { ...ANDROID, fully: true };
  /** Measured, mp-native Account Detail: the transaction list, CLIP, running under the bar to the screen's bottom. */
  const LIST: Rect = { x: 0, y: 825, width: 1080, height: 1395 };
  /** The tab `name`, `i`-th of the bar's four (`nav.tab_*`, 1876–2052). */
  const tab = (name: string, i: number): UiNode =>
    node({ role: 'container', identifier: `nav.tab_${name}`, rect: { x: 66 + 237 * i, y: 1876, width: 237, height: 176 }, children: [node({ role: 'text', label: name, rect: { x: 66 + 237 * i + 40, y: 1990, width: 157, height: 40 } })] });
  /** The bar's host — an unlabelled container, 66,1840 948x248, drawn after the list — and its tabs. */
  const BAR = node({ role: 'container', rect: { x: 66, y: 1840, width: 948, height: 248 }, children: ['home', 'accounts', 'cards', 'more'].map(tab) });
  const strokes = (played: ReturnType<typeof play>) => played.steps.flatMap((st) => (st.do === 'stroke' ? [drawnFor(st)] : []));

  it('measured: row_36 not read yet, the list under a floating tab bar — the stroke over the list is cut above the bar\'s host and touches down at y 1638, not on the bar at 1942', () => {
    const played = play({ ...FULLY_ANDROID, maxSwipes: 2 }, [
      { found: [], mainScroller: LIST, over: [BAR], rest: 'a' },
      { found: [], mainScroller: LIST, over: [BAR], rest: 'b' },
      { found: [], mainScroller: LIST, over: [BAR], rest: 'c' },
    ]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1840, box: LIST });
    expect(strokes(played)).toEqual([
      { from: { x: 540, y: 1638 }, to: { x: 540, y: 1028 } },
      { from: { x: 540, y: 1638 }, to: { x: 540, y: 1028 } },
    ]);
    // The second measured shape: the page scrolled, the list 0,401 1080x1753, the bar still shown.
    const scrolled = play({ ...FULLY_ANDROID, maxSwipes: 1 }, [
      { found: [], mainScroller: { x: 0, y: 401, width: 1080, height: 1753 }, over: [BAR], rest: 'a' },
      { found: [], rest: 'b' },
    ]);
    expect(strokes(scrolled)[0].from).toEqual({ x: 540, y: 1553 }); // the shim's 1857 was on the bar
  });

  it('the measured shape both ways (code review of fix/r4, P1): the uncut stroke touches down at 1942 on the bar\'s rect; the cut one at 1638, above 1840, and an exhausted run then names no bar', () => {
    const row = (rest: string): Row => ({ found: [], mainScroller: LIST, over: [BAR], rest });
    const played = play(ANDROID, [row('a'), row('a'), row('a')]);
    const [first] = played.steps.filter((st) => st.do === 'stroke');
    expect(first).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1840, box: LIST });
    // Without the overlay's cut — the stroke as it was drawn on the device — it touches down on the bar's host, on a tab.
    const uncut = drawnFor({ do: 'stroke', toward: 'down', reach: 1, box: LIST });
    expect(uncut.from).toEqual({ x: 540, y: 1942 });
    expect(containsPoint(BAR.rect, uncut.from)).toBe(true);
    // With it: above the host, on the list — and so the exhausted fail has no node drawn over the list to name.
    for (const stroke of strokes(played)) {
      expect(stroke.from.y).toBeLessThan(1840);
      expect(containsPoint(BAR.rect, stroke.from)).toBe(false);
    }
    expect(failureOf(played, 'id:t').message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
  });

  it('the target\'s own container too — and a round whose tree did not read keeps the cut, as it keeps the keyboard\'s', () => {
    const row = (y: number): Row => ({ found: [match({ x: 66, y, width: 948, height: 73 }, 'row')], scroller: LIST, over: [BAR] });
    const played = play({ ...ANDROID, maxSwipes: 2 }, [row(2400), { error: 'uiautomator dump returned no XML' }, row(2300)]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.box, st.coverTop]] : []))).toEqual([
      [LIST, 1840],
      [LIST, 1840],
    ]);
  });

  it('the list\'s own rows are not drawn over it: a row in its lower half cuts nothing', () => {
    const inside = play({ ...FULLY_ANDROID, maxSwipes: 1 }, [{ found: [match({ x: 66, y: 2150, width: 948, height: 73 }, 'row')], scroller: LIST }, { found: [] }]);
    expect(inside.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: LIST });
  });

  it('the target\'s container is chosen by its room clear of what is drawn over it: a 150-px strip whose lower half a bar covers has none, so the list around it is stroked — never the screen box', () => {
    const STRIP: Rect = { x: 0, y: 1750, width: 1080, height: 150 };
    const LOW_BAR = node({ role: 'other', label: 'bar', rect: { x: 0, y: 1826, width: 1080, height: 200 } }); // leaves 76 px of the strip, under MIN_STROKE_BOX
    const row: Row = { found: [match({ x: 66, y: 2400, width: 948, height: 73 }, 'row')], scrollers: [STRIP, LIST], over: [LOW_BAR] }; // a nested list's row, below the fold
    const played = play({ ...ANDROID, maxSwipes: 1 }, [row, { ...row, found: [] }]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke', box: LIST });
  });

  it('a short list whose upper half the bar\'s host starts in, the host still over the touch-down at 0.8: cut above the host (D3, 2026-10-09) — 1782, not 2086 on it', () => {
    const SHORT: Rect = { x: 0, y: 1550, width: 1080, height: 670 };
    const played = play({ ...ANDROID, maxSwipes: 1 }, [{ found: [], mainScroller: SHORT, over: [BAR], rest: 'a' }, { found: [], rest: 'b' }]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1840, box: SHORT });
    expect(strokes(played)[0].from).toEqual({ x: 540, y: 1782 });
    expect(containsPoint(BAR.rect, strokes(played)[0].from)).toBe(false);
  });

  it('the container is judged for the stroke actually drawn (D1, 2026-10-09): a turn back up strokes the strip that has room going up, not the screen box off it', () => {
    const STRIP: Rect = { x: 0, y: 1750, width: 1080, height: 150 };
    const LOW_BAR = node({ role: 'other', label: 'bar', rect: { x: 0, y: 1826, width: 1080, height: 200 } }); // leaves 76 px for a content-down stroke, the whole 150 for a content-up one
    const r = (y: number, rest: string): Row => ({ found: [match({ x: 66, y, width: 948, height: 40 }, 'row')], scrollers: [STRIP], over: [LOW_BAR], rest });
    // Below the frame (short of the far edge), then above it: carried past — the stroke turns up.
    const played = play({ ...ANDROID, maxSwipes: 2 }, [r(2300, 'a'), r(-100, 'b'), r(-100, 'c')]);
    const steps = played.steps.filter((st) => st.do === 'stroke');
    expect(steps[0]).toMatchObject({ toward: 'down', box: SCREEN_1080 }); // no room going down: the screen box (P5)
    expect(steps[1]).toMatchObject({ toward: 'up', box: STRIP });
    expect(containsPoint(STRIP, strokes(played)[1].from)).toBe(true); // until then 540,444 — the screen's 0.2, off the strip
  });

  it('…and a turn down from a strip chosen going up takes the list around it, which has room going down — never the screen box (D1)', () => {
    const STRIP: Rect = { x: 0, y: 1750, width: 1080, height: 150 };
    const LOW_BAR = node({ role: 'other', label: 'bar', rect: { x: 0, y: 1826, width: 1080, height: 200 } });
    const r = (y: number, rest: string): Row => ({ found: [match({ x: 66, y, width: 948, height: 40 }, 'row')], scrollers: [STRIP, LIST], over: [LOW_BAR], rest });
    const played = play({ ...ANDROID, direction: 'up', maxSwipes: 2 }, [r(-100, 'a'), r(2300, 'b'), r(2300, 'c')]);
    const steps = played.steps.filter((st) => st.do === 'stroke');
    expect(steps[0]).toMatchObject({ toward: 'up', box: STRIP });
    expect(steps[1]).toMatchObject({ toward: 'down', box: LIST, coverTop: 1826 });
  });

  it('with the IME up, the higher of the two tops cuts — the keyboard\'s', () => {
    const played = play({ ...ANDROID, maxSwipes: 1 }, [{ found: [], mainScroller: LIST, over: [BAR], cover: UP_IME, rest: 'a' }, { found: [], rest: 'b' }]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398, box: LIST });
  });

  it('a bar sitting on the keyboard is cut for — the lower half judged on the list above the keyboard, not the whole list (code review of fix/r4, P3)', () => {
    const ON_KEYBOARD = node({ role: 'other', label: 'bar', rect: { x: 0, y: 1150, width: 1080, height: 150 } });
    const KEYBOARD = coverOver({ x: 0, y: 1300, width: 1080, height: 920 });
    const played = play({ ...ANDROID, maxSwipes: 1 }, [{ found: [], mainScroller: LIST, over: [ON_KEYBOARD], cover: KEYBOARD, rest: 'a' }, { found: [], rest: 'b' }]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1150, box: LIST });
    expect(strokes(played)[0].from.y).toBeLessThan(1150); // until then 1206, on the bar
  });

  it('the fully: true probe toward the bottom edge keeps clear of the bar too — its room judged by the same rule', () => {
    const played = play(FULLY_ANDROID, [{ found: [match({ x: 66, y: 2120, width: 948, height: 100 }, 'row')], scroller: LIST, over: [BAR] }, { found: [match({ x: 66, y: 2120, width: 948, height: 100 }, 'row')], scroller: LIST, over: [BAR] }]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke', toward: 'down', coverTop: 1840, box: LIST, probe: true });
    expect(strokes(played)[0].from.y).toBeLessThan(1840);
  });

  it('a wrapper drawn over the WHOLE list (its rect holds the list\'s) is no evidence of a cover at the touch-down: not named — the exhausted words as before (review round 1)', () => {
    const WRAPPER = node({ role: 'container', rect: { ...LIST }, children: [node({ role: 'text', label: 'Empty state', rect: { x: 0, y: 300, width: 1080, height: 80 } })] });
    const row = (rest: string): Row => ({ found: [], mainScroller: LIST, over: [WRAPPER], rest });
    expect(failureOf(play(ANDROID, [row('a'), row('a'), row('a')]), 'id:t').message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
  });

  it('a container remembered from the read that found the target keeps its cut when a later read no longer holds a list of that rect (the page moved it, 0,825 → 0,401 — review round 1)', () => {
    const row = (y: number): Row => ({ found: [match({ x: 66, y, width: 948, height: 73 }, 'row')], scroller: LIST, over: [BAR] });
    const moved: Row = { found: [], mainScroller: { x: 0, y: 401, width: 1080, height: 1753 }, over: [BAR], rest: 'moved' };
    // Read above the frame (beyond the far edge of a scroll down), so losing it turns nothing: the strokes stay content-down.
    const played = play({ ...ANDROID, maxSwipes: 2 }, [row(-300), moved, { ...moved, rest: 'again' }]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.box, st.coverTop]] : []))).toEqual([
      [LIST, 1840],
      [LIST, 1840],
    ]);
  });

  it('…and the cut it keeps is the LATEST read that held the list, not the oldest (review round 2 of fix/r4-stroke)', () => {
    const row = (y: number): Row => ({ found: [match({ x: 66, y, width: 948, height: 73 }, 'row')], scroller: LIST, over: [BAR] });
    const HIGHER = node({ role: 'other', label: 'banner', rect: { x: 0, y: 1700, width: 1080, height: 100 } });
    const moved: Row = { found: [], mainScroller: { x: 0, y: 401, width: 1080, height: 1753 }, over: [BAR], rest: 'moved' };
    const played = play({ ...ANDROID, maxSwipes: 3 }, [row(-300), { found: [], mainScroller: LIST, over: [HIGHER], rest: 'banner' }, moved, { ...moved, rest: 'again' }]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.box, st.coverTop]] : []))).toEqual([
      [LIST, 1840],
      [LIST, 1700],
      [LIST, 1700],
    ]);
  });

  it('a content-UP stroke is not cut: it touches down at 0.2 of the list, above the bar, and only lifts off over it — the full reach is kept (review round 1)', () => {
    const played = play({ ...ANDROID, direction: 'up', maxSwipes: 1 }, [{ found: [], mainScroller: LIST, over: [BAR], rest: 'a' }, { found: [], rest: 'b' }]);
    expect(played.steps[0]).toEqual({ do: 'stroke', toward: 'up', reach: 1, box: LIST });
    expect(strokes(played)[0]).toEqual({ from: { x: 540, y: 1104 }, to: { x: 540, y: 1942 } });
  });

  it('a stroke that still touched down on a node drawn over its list (a floating header, which the cut does not model) fails naming it first — "content exhausted" after it, as the other cause (the tree cannot say the node takes touches)', () => {
    // The header's host, and on it — drawn on top, so the one named — its title, under the touch-down.
    const TITLE = node({ role: 'text', label: 'Account', identifier: 'account.title', rect: { x: 0, y: 1050, width: 1080, height: 100 } });
    const HEADER = node({ role: 'container', rect: { x: 0, y: 825, width: 1080, height: 400 }, children: [TITLE] });
    const row = (rest: string): Row => ({ found: [], mainScroller: LIST, over: [HEADER], rest });
    const played = play({ ...ANDROID, direction: 'up' }, [row('a'), row('a'), row('a')]);
    expect(strokes(played)[0].from).toEqual({ x: 540, y: 1104 }); // inside the header
    const error = failureOf(played, 'id:t');
    expect(error.message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping up, did not change the screen: they touched down at 540,1104 on text "Account" (id account.title) at 0,1050 1080x100, drawn over the list 0,825 1080x1395, which may have taken them (else: content exhausted, still loading)) — element never appeared in the tree',
    );
    expect(error).toBeInstanceOf(ElementNotFoundError);
  });

  it('…and so does the match rule ("did not move it"), with the target in the tree off the frame', () => {
    const HEADER = node({ role: 'container', label: 'Account', rect: { x: 0, y: 825, width: 1080, height: 400 } });
    const row: Row = { found: [match({ x: 66, y: -300, width: 948, height: 73 }, 'row')], scroller: LIST, over: [HEADER] };
    // Read above the frame in the list: the strokes go over the list, content up, touching down in the header.
    const error = failureOf(play({ ...ANDROID, direction: 'up' }, [row, row, row]), 'id:t');
    expect(error.message).toMatch(/did not move it: they touched down at 540,1104 on container "Account" at 0,825 1080x400, drawn over the list 0,825 1080x1395, which may have taken them \(else: content exhausted\)\)/);
  });
});

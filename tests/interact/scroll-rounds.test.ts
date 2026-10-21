import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type Stroke, type UiNode } from '../../src/adapters/types.js';
import { ElementNotFoundError, describeTarget } from '../../src/interact/resolve.js';
import { round, SETTLE_CONFIRM_READS, startRounds, type RoundRead, type RoundRules } from '../../src/interact/scroll-rounds.js';
import { describeScrollResult, scrollFailure } from '../../src/interact/scroll-text.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseDump } from '../helpers/android-dumps.js';
import { node } from '../helpers/fake.js';
import { stackedLayers } from '../helpers/stacked-layers.js';
import { containsPoint } from '../../src/ui-tree/geometry.js';
import { coverOver, decided, drawnFor, failureOf, match, NO_BACK, play, resultOf, strokeCovers, strokesToward, treeOf, type Played, type Row } from '../helpers/rounds.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
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

/** A `RoundRead` by hand — the protocol's read, imported from the protocol's module — for its own calls: `found` in their tree (rounds.ts#treeOf), no keyboard node. */
const readOf = (found: UiNode[], extra: { cover?: KeyboardCover } = {}): RoundRead => ({ tree: treeOf({ found }, ANDROID.screen), found, ofKeyboard: () => false, remedy: { dismissal: 'back' as const }, ...extra });

describe('round — the protocol', () => {
  it('an ask leaves the state as it came in, and the same seen with the answer goes on', () => {
    const state = startRounds({ ...ANDROID, fully: true }, ANDROID.screen);
    const seen = { read: readOf([formRow(1906)], { cover: UP_IME }), elapsedMs: 0, readMs: 0 };
    const asked = round(state, seen);
    expect(asked).toEqual({ state, step: { do: 'ask', what: 'witness' } });
    expect(decided(round(state, { ...seen, corroborated: true }).step)).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398 });
  });

  it('a stroke owes its drawn stroke to the next round; a round given one unasked, or none when owed, or any round after the stop, throws', () => {
    const state = startRounds(ANDROID, ANDROID.screen);
    const off = { read: readOf([formRow(2900)]), elapsedMs: 0, readMs: 0 };
    expect(() => round(state, { ...off, drawn: STROKE })).toThrow('none asked for');
    const stroked = round(state, off).state;
    expect(() => round(stroked, off)).toThrow('without the stroke drawn');
    const stopped = round(stroked, { read: readOf([formRow(500)]), elapsedMs: 0, readMs: 0, drawn: STROKE });
    expect(stopped.step.do).toBe('confirm');
    const done = round(stopped.state, { read: readOf([formRow(500)]), elapsedMs: 0, readMs: 0 });
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
    // scrollingFake(1980, 0): nothing moves it — two identical strokes, one back (the stuck turn), then the defect.
    const stuck = play({ ...SCROLLING, fully: true }, reads([1980, 1980, 1980, 1980], (y) => button(y)));
    expect(strokesToward(stuck)).toEqual(['down', 'down', 'up']);
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
    expect(failureOf(timedOut, describeTarget({ id: 'submit_button' })).message).toMatch(/scroll_until id:"submit_button" failed after 1ms \(timeout 1ms; no swipe was sent; 1 tree read took 0ms\)/);
  });

  it('a timeout says how many swipes it sent and how long the tree reads took, so a budget the reads spent does not read as the content\'s fault', () => {
    // The Safari case: the one read outlasted the budget (a tree source restarting under it) — no swipe was ever sent, and the time
    // spent is said beside the budget it ran past.
    const slow = play(SCROLLING, [{ found: [button(50_000)], elapsedMs: 38_204, readMs: 38_204 }]);
    expect(failureOf(slow, 'id:submit_button').message).toMatch(/^scroll_until id:submit_button failed after 38204ms \(timeout 2000ms; no swipe was sent; 1 tree read took 38204ms\) — element in tree but never intersected/);
    // A read that failed took its time too: it is counted with the rest.
    const failing = play(SCROLLING, [{ error: 'WDA /source timed out', readMs: 1_000 }, { found: [button(49_990)], elapsedMs: 2_500, readMs: 1_500 }]);
    expect(failureOf(failing, 'id:submit_button').message).toContain('failed after 2500ms (timeout 2000ms; 1 swipe sent; 2 tree reads took 2500ms, the last 1500ms)');
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
    expect(decided(played.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398, box: SCREEN_1080 }); // no clipping container: the screen box
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
    const played = play({ ...ANDROID, fully: true }, reads([1360, 1360, 1360, 1360], formRow, { cover: UP_IME }));
    // After TWO identical swipes that did not move it (review round 2: one can be a transient), not one — and one back.
    expect(failureOf(played, 'id:priority_select').message).toBe(
      'scroll_until id:priority_select failed after 3 swipes — element is in the viewport but CLIPPED at bottom, 52% of it is in ' +
        'the viewport above the soft keyboard over [0,1398][1080,2220], and the content is exhausted: swiping down no longer moves ' +
        'it, nor does swiping up. The soft keyboard covers the rest — to reach it with the keyboard down, hide it first (press_key back from the MCP ' +
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
      { ...off, screen: { box: TURNED, boxes: [TURNED], oriented: TURNED, from: 'device' } }, // read held sideways
      { error: 'uiautomator dump returned no XML', screen: { box: SCREEN_1080, boxes: [SCREEN_1080], oriented: SCREEN_1080, from: 'device' } }, // unread: the device as built
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
    expect(failureOf(play({ ...ANDROID, fully: true }, [wide(), wide(), wide(), wide()]), 'id:wide').message).toMatch(
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
    expect(played.steps.map(decided)).toEqual([
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
    // Moving as much at every read — an animation, not a fling slowing — and more than a tree source's rounding (a unit).
    const restless = play(FULLY, [681, 300, 302, 304, 306].map((y) => wdaRow(y))); // round 0, the stop at 300, then three confirming reads — reported at 306
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
      /^scroll_until id:row failed after 3 swipes \(the last 2, swiping up, did not move it: content exhausted, or the swipes were not taken\) — element in tree but never intersected the 402x572 screen above the soft keyboard over \[0,572\]\[402,874\] \(last rect \{"x":24,"y":-357,"width":354,"height":52\}\)\. It was turned round 1 time: a swipe carried it past the viewport \(a fling\), or it lay at the edge the swipes push it out through, so the next was drawn the other way\. The soft keyboard was up/,
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
    const played = play({ ...ANDROID, fully: true }, [wide({ cover: UP_IME }), wide({}), wide({}), wide({}), wide({})]); // no stroke is taken
    expect(strokeCovers(played)).toEqual([1398, undefined, undefined, undefined]); // the last, the stuck turn's stroke back
    expect(failureOf(played, 'id:row').message).toMatch(/^scroll_until id:row failed after 4 swipes — element is in the viewport but CLIPPED at right/);
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
    expect(decided(played.steps[0])).toEqual({ do: 'stroke', toward: 'up', reach: 0.25, box: FORM, probe: true, maxTravel: 177 });
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] }); // no flush left: the row is whole
  });

  it('the measured Priority row, cut by CONTINUE to {y:1846, height:132}: probed toward the bottom edge (content down)', () => {
    const played = play(FULLY_ANDROID, [formRead(1846, 132), formRead(1586), formRead(1586)]);
    expect(probeOf(played).map(decided)).toEqual([{ do: 'stroke', toward: 'down', reach: 0.25, box: FORM, probe: true, maxTravel: 177 }]);
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
    expect(decided(played.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, coverTop: 1398, box: RESIZED, probe: true, maxTravel: 177 });
    // Denied: the probe is drawn over the container whole.
    const denied = play(FULLY_ANDROID, [{ ...row, corroborated: false }, row]);
    expect(decided(denied.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, box: RESIZED, probe: true, maxTravel: 177 });
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
    expect(decided(play({ ...IPHONE, maxSwipes: 1 }, [{ found: [] }, { found: [] }]).steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: IPHONE_BOX });
  });

  /** A read without the target, the rest of the screen reading `rest`. */
  const tree = (rest: string, extra: Row = {}): Row => ({ found: [], rest, ...extra });

  it('measured: row_40 of a list that ends at row_36 — not in the tree, and two identical strokes after which the WHOLE tree is unchanged: content exhausted, at once — ElementNotFoundError, it was never seen', () => {
    const played = play(FULLY_ANDROID, [tree('a'), tree('b'), tree('b'), tree('b')]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'down']);
    const error = failureOf(played, 'id:transactions.list.row_40');
    expect(error.message).toBe(
      'scroll_until id:transactions.list.row_40 failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"',
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
    expect(decided(played.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 0.25, box: LIST, probe: true, maxTravel: 177 });
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
    expect(decided(play({ ...FULLY_ANDROID, maxSwipes: 1 }, [row, row]).steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: LIST });
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

  it('flush with the bottom of a carousel that scrolls only sideways (a HorizontalScrollView), no list around it: NO probe — none along the edge can move it — and the stop is unchecked for that reason, `axis`, not for want of room', () => {
    const CAROUSEL: Rect = { x: 0, y: 1000, width: 1080, height: 400 };
    const cardNode = match({ x: 40, y: 1100, width: 600, height: 300 }, 'card');
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...CAROUSEL }, children: [cardNode] })] });
    const played = play(FULLY_ANDROID, [{ tree, found: [cardNode] }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    const result = resultOf(played);
    expect(result.flush).toEqual({ edge: 'bottom', container: CAROUSEL, checked: false, why: 'axis' });
    expect(describeScrollResult(result)).toMatch(/every scroll container around it from that one outward scrolls only sideways, so no probe swipe can move its bottom edge into view to check it — it may be cut there/);
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
    expect(decided(played.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, coverTop: 1398, box: LIST });
    // With the keyboard down the nearer one has room, and is the one.
    const down = play({ ...FULLY_ANDROID, maxSwipes: 1 }, [{ ...row, found: [match({ x: 66, y: 2300, width: 948, height: 73 }, 'row')], cover: undefined }, row]);
    expect(decided(down.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: { x: 0, y: 1340, width: 1080, height: 800 } });
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
    expect(decided(down.steps[0])).toEqual({ do: 'stroke', toward: 'down', reach: 1, box: UNDER });
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
    const screen: UsableScreen = { box: PORTRAIT, boxes: [PORTRAIT], oriented: { x: 0, y: 0, width: 2220, height: 1080 }, from: 'device' }; // ui-tree/usable-screen.ts#UsableScreen: turned gesture, panel as built judged
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
    // No stroke of the scroll's course went up: the stroke back is no turn, and keeps the full reach.
    expect(played.steps.flatMap((st) => (st.do === 'stroke' && st.probe !== true ? [st.reach] : []))).toEqual([1]);
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

  it('the measured shape both ways (code review of fix/r4, P1): the uncut stroke touches down at 1942 on the bar\'s rect; the cut one at 1638, above 1840, and an exhausted run then names no bar', () => {
    const row = (rest: string): Row => ({ found: [], mainScroller: LIST, over: [BAR], rest });
    const played = play(ANDROID, [row('a'), row('a'), row('a')]);
    // The uncut stroke — as it was drawn on the device — touched down at 1942 on the bar's host (tests/interact/stroke-plan.test.ts). With the cut: above the host, on the list — and so the exhausted fail has no node drawn over the list to name.
    for (const stroke of strokes(played)) {
      expect(stroke.from.y).toBeLessThan(1840);
      expect(containsPoint(BAR.rect, stroke.from)).toBe(false);
    }
    expect(failureOf(played, 'id:t').message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
  });

  it('the target\'s container is chosen by its room clear of what is drawn over it: a 150-px strip whose lower half a bar covers has none, so the list around it is stroked — never the screen box', () => {
    const STRIP: Rect = { x: 0, y: 1750, width: 1080, height: 150 };
    const LOW_BAR = node({ role: 'other', label: 'bar', rect: { x: 0, y: 1826, width: 1080, height: 200 } }); // leaves 76 px of the strip, under MIN_STROKE_BOX
    const row: Row = { found: [match({ x: 66, y: 2400, width: 948, height: 73 }, 'row')], scrollers: [STRIP, LIST], over: [LOW_BAR] }; // a nested list's row, below the fold
    const played = play({ ...ANDROID, maxSwipes: 1 }, [row, { ...row, found: [] }]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke', box: LIST });
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

  it('…judged every round, with that round\'s cover: the IME gone, the strip the target lies in has room again and is stroked — its nearest container, no longer the list around it (D1, code review of fix/r5-stroke)', () => {
    const STRIP: Rect = { x: 0, y: 1350, width: 1080, height: 200 }; // 48 px above the IME at 1398
    // Read above the frame (beyond the far edge of a scroll down), so losing it turns nothing: both strokes content-down.
    const played = play({ ...ANDROID, maxSwipes: 2 }, [
      { found: [match({ x: 66, y: -300, width: 948, height: 40 }, 'row')], scrollers: [STRIP, LIST], cover: UP_IME, rest: 'a' },
      { found: [], rest: 'b' },
      { found: [], rest: 'c' },
    ]);
    expect(played.steps.flatMap((st) => (st.do === 'stroke' ? [[st.box, st.coverTop]] : []))).toEqual([
      [LIST, 1398],
      [STRIP, undefined],
    ]);
  });

  it('a wrapper drawn over the WHOLE list (its rect holds the list\'s) is no evidence of a cover at the touch-down: not named — the exhausted words as before (review round 1)', () => {
    const WRAPPER = node({ role: 'container', rect: { ...LIST }, children: [node({ role: 'text', label: 'Empty state', rect: { x: 0, y: 300, width: 1080, height: 80 } })] });
    const row = (rest: string): Row => ({ found: [], mainScroller: LIST, over: [WRAPPER], rest });
    expect(failureOf(play(ANDROID, [row('a'), row('a'), row('a')]), 'id:t').message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
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
    // A first stroke that changed the screen, then the same touch-down: the header may have taken them — the end of the content is not read, so no side is named (round 8's B1 gap).
    const moved = failureOf(play({ ...ANDROID, direction: 'up' }, [row('a'), row('b'), row('b'), row('b')]), 'id:t');
    expect(moved.message).toMatch(/which may have taken them \(else: content exhausted, still loading\)\) — element never appeared in the tree$/);
  });

  it('…and so does the match rule ("did not move it"), with the target in the tree off the frame', () => {
    const HEADER = node({ role: 'container', label: 'Account', rect: { x: 0, y: 825, width: 1080, height: 400 } });
    const row: Row = { found: [match({ x: 66, y: -300, width: 948, height: 73 }, 'row')], scroller: LIST, over: [HEADER] };
    // Read above the frame in the list: the strokes go over the list, content up, touching down in the header.
    const error = failureOf(play({ ...ANDROID, direction: 'up' }, [row, row, row]), 'id:t');
    expect(error.message).toMatch(/did not move it: they touched down at 540,1104 on container "Account" at 0,825 1080x400, drawn over the list 0,825 1080x1395, which may have taken them \(else: content exhausted\)\)/);
  });
});

/**
 * A target under the app's own chrome (2026-10-09, docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md):
 * a node drawn over it in the tree (ui-tree/draw-order.ts#exposure) is not visible. Measured on mp-native's SWIFT form
 * (iPhone 17, both tree sources): `priority_select` at `24,771 354x52`, its centre on the CONTINUE bar `24,780 354x44`, was
 * "fully visible after 0 swipes". Owner decisions: `fully: true` — a target partly under chrome is not fully visible, keep
 * scrolling, and fail naming the cover when that cannot help; without `fully` — keep scrolling until its centre is
 * clear, so the next tap agrees.
 */
describe('round — a target under the app\'s chrome (2026-10-09)', () => {
  const CONTINUE_RECT: Rect = { x: 24, y: 780, width: 354, height: 44 };
  const CONTINUE = node({ role: 'button', label: 'Continue to summary', identifier: 'swift_payment.form.continue_button', rect: CONTINUE_RECT });
  /** A read of the form with `priority_select` at y, the bar drawn over the rest of the screen. */
  const form = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'priority')], over: [CONTINUE] });
  const COVER = 'button "Continue to summary" (24,780 354x44)';

  it('fully: true — the measured rest position is not fully visible: the scroll goes on, and stops once nothing is drawn over the row', () => {
    const played = play({ ...IPHONE, fully: true }, [form(771), form(500), form(500)]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('without fully — the centre decides: on the bar (771, 754), the scroll goes on; clear of it (740, its bottom still under the bar), it stops', () => {
    const played = play(IPHONE, [form(771), form(754), form(740), form(740)]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'stroke', 'confirm', 'stop']);
    const result = resultOf(played);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [], covered: { by: { role: 'button', label: 'Continue to summary', identifier: 'swift_payment.form.continue_button', rect: CONTINUE_RECT }, shows: 40 / 52 } });
    // Never "fully visible": the reply says what is over it, as it says a clip.
    expect(describeScrollResult(result)).toBe(
      `visible after 2 swipes — PARTLY UNDER ${COVER}, drawn over it — 77% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too`,
    );
    // At rest with its centre clear, no swipe at all — as before.
    expect(play(IPHONE, [form(740)]).steps.map((st) => st.do)).toEqual(['stop']);
  });

  it('a row no swipe moves from under the bar (the end of the content): stuck, naming the bar — fully or not', () => {
    for (const fully of [true, false]) {
      const played = play({ ...IPHONE, fully }, [form(771), form(771), form(771), form(771)]);
      expect(played.outcome?.kind).toBe('stuck');
      expect(strokesToward(played)).toEqual(['down', 'down', 'up']); // one stroke back before the defect is declared
      expect(failureOf(played, 'id:priority').message).toBe(
        `scroll_until id:priority failed after 3 swipes — element is in the viewport but under ${COVER} at its centre (201,797), drawn over it — 17% of it shows — ` +
          'and the content is exhausted: swiping down no longer moves it, nor does swiping up. The app draws that over it at the end of the content — a layout defect ' +
          '(no clearance for a pinned bar?), not a scroll that needs more swipes. Last rect {"x":24,"y":771,"width":354,"height":52} in a 402x874 viewport',
      );
    }
  });

  it('fully: true, the centre clear and only an edge under the bar: stuck names the bar without a centre', () => {
    const played = play({ ...IPHONE, fully: true }, [form(740), form(740), form(740), form(740)]);
    expect(failureOf(played, 'id:priority').message).toContain(`element is in the viewport but under ${COVER}, drawn over it — 77% of it shows — and the content is exhausted`);
  });

  it('the bound (maxSwipes, timeout) with the row under the bar names the bar as what it was short of', () => {
    const moving = [form(769), form(771), form(773)];
    expect(failureOf(play({ ...IPHONE, maxSwipes: 2 }, moving), 'id:priority').message).toBe(
      `scroll_until id:priority failed after 2 swipes (maxSwipes) — element reached the viewport but stayed under ${COVER} at its centre (201,799), drawn over it — 15% of it shows (last rect {"x":24,"y":773,"width":354,"height":52})`,
    );
    const late = play({ ...IPHONE, fully: true }, [{ ...form(770), readMs: 400 }, { ...form(772), elapsedMs: 2_000, readMs: 1_500 }]);
    expect(failureOf(late, 'id:priority').message).toBe(
      `scroll_until id:priority failed after 2000ms (timeout 2000ms; 1 swipe sent; 2 tree reads took 1900ms, the last 1500ms) — element reached the viewport but stayed under ${COVER} at its centre (201,798), drawn over it — 15% of it shows (last rect {"x":24,"y":772,"width":354,"height":52})`,
    );
  });

  it('of two matches, the one more of which shows is judged: a duplicate under the bar does not hold a stop the other makes', () => {
    const played = play({ ...IPHONE, fully: true }, [{ found: [match({ x: 24, y: 771, width: 354, height: 52 }, 'priority'), match({ x: 24, y: 300, width: 354, height: 52 }, 'priority')], over: [CONTINUE] }]);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });

  it('of two matches, one that stops the round wins over one more of which shows but whose centre is under the bar (review round 1)', () => {
    const big = match({ x: 24, y: 720, width: 200, height: 120 }, 'priority'); // 76 of 120 pt show (63 %), centre (124,780) on the bar
    const small = match({ x: 230, y: 755, width: 148, height: 40 }, 'priority'); // beside it: 25 of 40 show (62.5 %), centre (304,775) clear
    const played = play(IPHONE, [{ found: [big, small], over: [CONTINUE] }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
  });

  it('without fully, the centre must lie on the SCREEN — the frame the next tap\'s on-screen rule judges (code review P3, repro B): a row whose centre is off the bottom edge is scrolled on, and stops once it is on', () => {
    const row = (y: number): Row => ({ found: [match({ x: 0, y, width: 402, height: 60 }, 'r')] });
    const played = play(IPHONE, [row(850), row(600), row(600)]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'stop']);
    // The centre (201,873) still on the 874-pt screen, the row clipped: a stop, as before — the tap presses the centre.
    expect(describeScrollResult(resultOf(play(IPHONE, [row(843)])))).toBe(
      'visible after 0 swipes — CLIPPED at bottom, 52% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box',
    );
    // No swipe moves it: the bound says what it was short of — the clip, not a cover.
    expect(failureOf(play({ ...IPHONE, maxSwipes: 1 }, [row(850), row(851)]), 'id:r').message).toBe(
      'scroll_until id:r failed after 1 swipe (maxSwipes) — element reached the viewport but stayed CLIPPED at bottom, 38% of it is in the viewport (last rect {"x":0,"y":851,"width":402,"height":60})',
    );
  });

  it('…but the keyboard\'s band is NOT that frame: a centre under the band, on the screen, still stops a plain scroll (the tap\'s keyboard guard hides the keyboard) — and a centre off the screen under a band does not', () => {
    const row = (y: number): Row => ({ found: [match({ x: 0, y, width: 402, height: 60 }, 'r')], cover: coverOver(WDA_BAND, NO_BACK) });
    expect(play(IPHONE, [row(560)]).steps.map((st) => st.do)).toEqual(['stop']); // centre (201,590), under the band from 572
    expect(play(IPHONE, [row(850), row(500), row(500)]).steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'stop']);
  });

  it('stuck without fully, the row clipped AND its centre under a bar: the bar leads, as at the bound — not "cannot be fully revealed" (code review S1)', () => {
    const bar = node({ role: 'button', label: 'Bar', rect: { x: 0, y: 800, width: 402, height: 74 } });
    const row: Row = { found: [match({ x: 0, y: 840, width: 402, height: 60 }, 'r')], over: [bar] };
    const played = play(IPHONE, [row, row, row, row]);
    expect(played.outcome?.kind).toBe('stuck');
    expect(failureOf(played, 'id:r').message).toBe(
      'scroll_until id:r failed after 3 swipes — element is in the viewport but under button "Bar" (0,800 402x74) at its centre (201,870), drawn over it — 0% of it shows — ' +
        'and the content is exhausted: swiping down no longer moves it, nor does swiping up. The app draws that over it at the end of the content — a layout defect ' +
        '(no clearance for a pinned bar?), not a scroll that needs more swipes. Last rect {"x":0,"y":840,"width":402,"height":60} in a 402x874 viewport',
    );
  });

  it('a plain stop both clipped and partly under a bar says both, the clip first', () => {
    const by = { role: 'button', label: 'Continue to summary', identifier: null, rect: CONTINUE_RECT };
    expect(describeScrollResult({ swipes: 1, visible: 0.5, clipped: ['bottom'], covered: { by, shows: 0.3 } })).toBe(
      `visible after 1 swipe — CLIPPED at bottom, 50% of it is in the viewport; PARTLY UNDER ${COVER}, drawn over it — 30% of it shows, its centre clear. ` +
        'A rect assert or screenshot on this element will measure the CLIPPED box',
    );
  });

});

describe('round — a target resting in the frame at the edge the strokes push it out through (docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md)', () => {
  /** The iPhone 17 as the iOS adapter reports it: the 62-pt status band (adapters/ios-status-band.ts). */
  const BANDED: UsableScreen = { box: IPHONE_BOX, boxes: [IPHONE_BOX], oriented: IPHONE_BOX, from: 'device', statusBand: 62 };
  const CONTINUE = node({ role: 'button', label: 'Continue to summary', identifier: 'swift_payment.form.continue_button', rect: { x: 24, y: 780, width: 354, height: 44 } });
  /** A read of the SWIFT form with `priority_select` (354x52) at y, on the banded screen, CONTINUE drawn over the rest. */
  const form = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'priority')], over: [CONTINUE], screen: BANDED });
  const MEASURED = { ...IPHONE, maxSwipes: 6 };
  const reaches = (played: Played): number[] => played.steps.flatMap((st) => (st.do === 'stroke' ? [st.reach] : []));

  it('measured (a): plain, the row resting at y 20 — its centre in the band — with the default direction down: the first stroke turns back (content up) at half the reach, and stops — not six strokes down to maxSwipes', () => {
    const played = play(MEASURED, [form(20), form(563), form(563)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(reaches(played)).toEqual([0.5]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    // fully: true likewise.
    expect(strokesToward(play({ ...MEASURED, fully: true }, [form(20), form(563), form(563)]))).toEqual(['up']);
  });

  it('measured (b): fully: true, the row at y -20 straddling the top edge: turned back at once, half the reach — not "content exhausted … a layout defect" after two strokes down', () => {
    const played = play({ ...MEASURED, fully: true }, [form(-20), form(300), form(300)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(reaches(played)).toEqual([0.5]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('measured (c): direction up from -20 — the stroke flings the row to 771 under CONTINUE, the edge content-up strokes push it out through: the next turns (content down), half the reach', () => {
    const played = play({ ...MEASURED, direction: 'up', fully: true }, [form(-20), form(771), form(400), form(400)]);
    expect(strokesToward(played)).toEqual(['up', 'down']);
    expect(reaches(played)).toEqual([1, 0.5]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('(c) when no stroke moves it from under CONTINUE either way: both directions tried, then stuck naming the bar — a layout defect', () => {
    const played = play({ ...MEASURED, direction: 'up', fully: true }, [form(-20), form(771), form(771), form(771)]);
    expect(strokesToward(played)).toEqual(['up', 'down', 'down']);
    expect(played.outcome?.kind).toBe('stuck');
    expect(failureOf(played, 'id:priority').message).toContain('swiping down no longer moves it. The app draws that over it at the end of the content — a layout defect');
  });

  it('a cover over the far side at the TOP (a bar over the row\'s top, the default direction down): turned at once — not stroked on under it (code review P7\'s accepted cost)', () => {
    const bar = node({ role: 'other', label: 'Header', rect: { x: 0, y: 62, width: 402, height: 60 } });
    const row = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'priority')], over: [bar] });
    const played = play({ ...IPHONE, fully: true }, [row(100), row(300), row(300)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(reaches(played)).toEqual([0.5]);
  });

  it('a row pinned in the band (a screen that does not scroll): turned up at once, and when that does not move it either, stuck naming the status bar as pinned — no "try direction" the scroll already tried', () => {
    const played = play(MEASURED, [form(10), form(10), form(10), form(10)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'down']); // turned at once; stuck up; one stroke down, the way never stroked
    expect(played.outcome?.kind).toBe('stuck');
    const message = failureOf(played, 'id:priority').message;
    expect(message).toContain('swiping up no longer moves it out from under the status bar, nor does swiping down — it is pinned under the status bar');
    expect(message).toContain('it is pinned under the status bar');
    expect(message).not.toContain('try direction');
  });

  it('Android, no band: fully: true, a row clipped at its scroll container\'s top edge (the screen\'s): turned back at once, half the reach', () => {
    const scroller: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
    const played = play({ ...ANDROID, maxSwipes: 6, fully: true }, reads([-20, 400, 400], formRow, { scroller }));
    expect(strokesToward(played)).toEqual(['up']);
    expect(reaches(played)).toEqual([0.5]);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('a cover is judged over what of the row lies in the frame: scrolling up, a row running off the top under a top bar is covered whole there — the near side, no turn', () => {
    const bar = node({ role: 'other', label: 'Header', rect: { x: 0, y: 0, width: 402, height: 100 } });
    const row = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 80 }, 'priority')], over: [bar] });
    const played = play({ ...IPHONE, direction: 'up', fully: true }, [row(-30), row(300), row(300)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(reaches(played)).toEqual([1]);
  });

  // Review of the first cut (2026-10-09): the edge test alone turned a row coming in from below whose top a bottom bar
  // covers — the bar is over its far edge, but it sits in the near half of the frame. Only a cover in the far half counts.
  it('a snackbar low on the screen (0,1700 1000x80) over the top of a row coming in from below (1720): stroked on down, as before — not turned away', () => {
    const snack = node({ role: 'button', identifier: 'snack', label: 'Undo', rect: { x: 0, y: 1700, width: 1000, height: 80 } });
    const row = (y: number): Row => ({ found: [match({ x: 0, y, width: 1000, height: 100 })], over: [snack] });
    const played = play(SCROLLING, [row(1720), row(1120), row(1120)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(reaches(played)).toEqual([1]);
  });

  it.each([
    // content to the right: the strokes move it left, out through the left edge — a rail on the left over the card's left part
    ['right', { x: 0, y: 300, width: 100, height: 200 }, 'left'],
    // content to the left: mirrored, a rail on the right
    ['left', { x: 302, y: 300, width: 100, height: 200 }, 'right'],
  ] as const)('sideways (%s): a rail over the far side of a card in a carousel turns the strokes at once, half the reach', (direction, rail, back) => {
    const over = [node({ role: 'other', label: 'Rail', rect: rail })];
    const card = (x: number): Row => ({ found: [match({ x, y: 350, width: 200, height: 100 }, 'card')], over });
    const [start, clear] = direction === 'right' ? [50, 110] : [152, 50];
    const played = play({ ...IPHONE, direction, fully: true }, [card(start), card(clear), card(clear)]);
    expect(strokesToward(played)).toEqual([back]);
    expect(reaches(played)).toEqual([0.5]);
  });

  it.each([
    ['down', { x: 0, y: 62, width: 402, height: 300 }, 200],
    ['up', { x: 0, y: 500, width: 402, height: 300 }, 600],
  ] as const)('a sheet over the WHOLE row in the far half (%s) is no side\'s: turning back could not uncover it — stroked on the caller\'s way', (direction, rect, y) => {
    const over = [node({ role: 'other', label: 'Sheet', rect })];
    const row = (at: number): Row => ({ found: [match({ x: 24, y: at, width: 354, height: 52 }, 'priority')], over });
    const played = play({ ...IPHONE, direction, fully: true, maxSwipes: 1 }, [row(y), row(y + 1)]);
    expect(strokesToward(played)).toEqual([direction]);
  });

  it.each([
    // content to the right (far edge: left) — a cover over the card's left edge, but in the RIGHT half of the frame
    ['right', { x: 200, y: 300, width: 100, height: 200 }, 250],
    // content to the left (far edge: right) — a cover over the card's right edge, in the LEFT half
    ['left', { x: 102, y: 300, width: 100, height: 200 }, 52],
  ] as const)('sideways (%s): a cover over the far edge but in the near half of the frame is not turned for', (direction, rect, x) => {
    const over = [node({ role: 'other', label: 'Badge', rect })];
    const card = (at: number): Row => ({ found: [match({ x: at, y: 350, width: 100, height: 100 }, 'card')], over });
    const played = play({ ...IPHONE, direction, fully: true, maxSwipes: 1 }, [card(x), card(x + 1)]);
    expect(strokesToward(played)).toEqual([direction]);
    expect(reaches(played)).toEqual([1]);
  });

  it('a stroke back that MOVES the row but leaves it short (776 → 760, still under CONTINUE) is no "nor does swiping": the scroll goes on, and stops', () => {
    const played = play({ ...MEASURED, direction: 'up', fully: true }, [form(-20), form(776), form(776), form(776), form(760), form(514), form(514)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up', 'down', 'down']);
    expect(resultOf(played)).toEqual({ swipes: 5, visible: 1, clipped: [] });
  });

  it('stuck on the LAST swipe: no swipe left for the stroke back — the stuck sentence, not "maxSwipes", and it says the other way was never tried', () => {
    const played = play({ ...IPHONE, maxSwipes: 2 }, [form(771), form(771), form(771)]);
    expect(strokesToward(played)).toEqual(['down', 'down']);
    expect(played.outcome).toMatchObject({ kind: 'stuck', otherWay: 'untried' });
    expect(failureOf(played, 'id:priority').message).toContain(
      'swiping down no longer moves it, and swiping up was never tried (no swipe or time was left). The app draws that over it at the end of the content',
    );
    const clipped = play({ ...SCROLLING, fully: true, maxSwipes: 2 }, reads([1980, 1980, 1980], (y) => button(y)));
    expect(failureOf(clipped, 'id:submit_button').message).toContain('swiping down no longer moves it, and swiping up was never tried (no swipe or time was left). The element cannot be fully revealed');
  });

  it.each([
    // the frame 0–874, its middle 437: a cover 407–467 is centred ON it
    ['down', 420],
    ['up', 380],
  ] as const)('a cover centred exactly on the frame\'s middle is in neither far half (%s): not turned for', (direction, y) => {
    const over = [node({ role: 'other', label: 'Bar', rect: { x: 0, y: 407, width: 402, height: 60 } })];
    const row = (at: number): Row => ({ found: [match({ x: 24, y: at, width: 354, height: 52 }, 'priority')], over });
    const played = play({ ...IPHONE, direction, fully: true, maxSwipes: 1 }, [row(y), row(y + 1)]);
    expect(strokesToward(played)).toEqual([direction]);
    // a point toward the far edge, and it is the far half's: turned
    const nudged = [node({ role: 'other', label: 'Bar', rect: { x: 0, y: direction === 'down' ? 406 : 408, width: 402, height: 60 } })];
    const near = (at: number): Row => ({ ...row(at), over: nudged });
    expect(strokesToward(play({ ...IPHONE, direction, fully: true, maxSwipes: 1 }, [near(y), near(y + 1)]))).toEqual([direction === 'down' ? 'up' : 'down']);
  });

  it('a read that fails after the stuck turn\'s stroke back strokes back again — as the last read round decided — and the read after it answers the turn', () => {
    const played = play({ ...MEASURED, direction: 'up', fully: true }, [form(-20), form(776), form(776), form(776), { error: 'idb describe-all timed out' }, form(514), form(514)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up', 'down', 'down']);
    expect(resultOf(played)).toEqual({ swipes: 5, visible: 1, clipped: [] });
  });

  it('a cover is on the far side only in EVERY frame the round judged in, as `beyond` is: either way up, a bar in the upper half of the portrait box lies in the lower half of the landscape one — no turn', () => {
    const portrait = IPHONE_BOX;
    const landscape: Rect = { x: 0, y: 0, width: 874, height: 402 };
    const screen: UsableScreen = { box: portrait, boxes: [portrait, landscape], oriented: portrait, from: 'device' };
    const bar = node({ role: 'other', label: 'Bar', rect: { x: 0, y: 300, width: 402, height: 60 } });
    const row = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'priority')], over: [bar], screen });
    const played = play({ ...IPHONE, fully: true }, [row(320), row(100), row(100)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(reaches(played)).toEqual([1]);
    // …and with the portrait box alone, the same bar is the far half's: turned.
    const one = (y: number): Row => ({ ...row(y), screen: { box: portrait, boxes: [portrait], oriented: portrait, from: 'device' } });
    expect(strokesToward(play({ ...IPHONE, fully: true }, [one(320), one(100), one(100)]))).toEqual(['up']);
  });

  // A nested tree (WDA's): no pinned reach, so CONTINUE is its frame, over neither edge. idb's flat list: below (P1).
  it('measured shape, direction up, fully: true: flung to 776 — its top under CONTINUE, its bottom (828) below the bar\'s, so no side of it is the bar\'s — stuck up, then ONE stroke back before the defect: it reveals the row', () => {
    const played = play({ ...MEASURED, direction: 'up', fully: true }, [form(-20), form(776), form(776), form(776), form(514), form(514)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up', 'down']);
    expect(reaches(played)).toEqual([1, 1, 1, 0.5]);
    expect(resultOf(played)).toEqual({ swipes: 4, visible: 1, clipped: [] });
  });

  describe('under idb\'s flat list, the far side is where a cover PRESSES — CONTINUE pinned at the bottom reaches the screen\'s bottom (draw-order.ts#bottomPinned; code review of round 6b P1)', () => {
    /** The same read as idb gives it: a flat list, CONTINUE listed last and pinned. */
    const idb = (y: number): Row => ({ ...form(y), flatList: true });

    it('measured, direction up from -20: flung to 776–828 — CONTINUE\'s reach (780 down to 874) is over its far (bottom) side — turned at once, half the reach; not two unmoved strokes and the stuck turn', () => {
      const played = play({ ...MEASURED, direction: 'up', fully: true }, [idb(-20), idb(776), idb(514), idb(514)]);
      expect(strokesToward(played)).toEqual(['up', 'down']);
      expect(reaches(played)).toEqual([1, 0.5]);
      expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
    });

    it.each([776, 800, 850])('no false turn the other way: direction down, the row at %i under CONTINUE — the reach is over its near (bottom) edge too, or lies in the near half — stroked down, the caller\'s way', (y) => {
      const played = play({ ...MEASURED, fully: true, maxSwipes: 1 }, [idb(y), idb(y + 1)]);
      expect(strokesToward(played)).toEqual(['down']);
      expect(reaches(played)).toEqual([1]);
    });
  });

  describe('a floating tab bar reaches 0.2 × its items\' height above them (draw-order.ts#tabBarsOf; docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md)', () => {
    /** mp-native Account Detail's four tab items, `37,755 82x64` …, iPhone 17. */
    const TABS = [37, 119, 201, 283].map((x, i) => node({ role: 'button', identifier: `nav.tab_${i}`, rect: { x, y: 755, width: 82, height: 64 } }));
    /** `transactions.list.row_3` (354x52) at y, the tab items drawn over the rest — idb's flat list or WDA's nested tree. */
    const rowAt = (y: number, flatList: boolean): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'row_3')], over: TABS, screen: BANDED, ...(flatList && { flatList }) });

    it.each([true, false])('measured, row_3 at 721 (flat list: %s): its centre (201,747) is under the bar\'s reach — not "fully visible after 0 swipes"; the bar is over its near (bottom) side, so one stroke the caller\'s way, then a stop', (flat) => {
      const played = play(MEASURED, [rowAt(721, flat), rowAt(500, flat), rowAt(500, flat)]);
      expect(strokesToward(played)).toEqual(['down']);
      expect(reaches(played)).toEqual([1]);
      expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    });

    it('direction up, row_3 at 721: the reach is over its far (bottom) side — turned at once, half the reach, as under CONTINUE', () => {
      const played = play({ ...MEASURED, direction: 'up' }, [rowAt(721, true), rowAt(500, true), rowAt(500, true)]);
      expect(strokesToward(played)).toEqual(['down']);
      expect(reaches(played)).toEqual([0.5]);
      expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    });
  });

  it('the stuck turn is ONE stroke, once: a stroke back that moves it, and a second stuck, fail as before — no third direction change for the stuck test', () => {
    // The stroke back stops it at 300; the confirming read finds it flung back to 776 (a bounce), and up twice moves it no more.
    const played = play({ ...MEASURED, direction: 'up', fully: true, maxSwipes: 10 }, [form(-20), form(776), form(776), form(776), form(300), form(776), form(776), form(776)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up', 'down', 'up', 'up']);
    expect(played.outcome).toMatchObject({ kind: 'stuck', lastStroke: 'up', otherWay: 'stroked' });
  });

  it('no swipe left for the stuck turn: stuck at once, as before, and the status-bar sentence still advises the way not tried', () => {
    const played = play({ ...MEASURED, direction: 'up', maxSwipes: 2 }, [form(10), form(10), form(10)]);
    expect(strokesToward(played)).toEqual(['up', 'up']);
    expect(played.outcome).toMatchObject({ kind: 'stuck', otherWay: 'untried' });
    expect(failureOf(played, 'id:priority').message).toContain('swiping up no longer moves it out from under the status bar — try direction: "down"');
  });

  it('a row clipped at the NEAR edge (the bottom, scrolling down) is stroked on the caller\'s way, as before', () => {
    const played = play({ ...MEASURED, fully: true }, [form(850), form(400), form(400)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(reaches(played)).toEqual([1]);
  });
});

describe('round — the Android navigation band (Spec B, D7): a centre in it is no stop, and a row pinned there fails naming the bar', () => {
  const PIXEL_BOX: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
  /** The Pixel_3a as the adapter reads it with its navigation bar: the band from 2154. */
  const NAV: UsableScreen = { box: PIXEL_BOX, boxes: [PIXEL_BOX], oriented: PIXEL_BOX, from: 'device', statusBand: 66, navigationBand: 2154 };
  const row = (y: number, screen: UsableScreen = NAV): Row => ({ found: [match({ x: 66, y, width: 948, height: 68 }, 'row_4')], screen });

  it('mp-native\'s row_4 at 2152 (centre 2186): no stop at 0 swipes — stroked until its centre clears the band', () => {
    const played = play(ANDROID, [row(2152), row(1600), row(1600)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('…and with no band read: the stop at 0 swipes, as before the band was read', () => {
    const unread: UsableScreen = { box: PIXEL_BOX, boxes: [PIXEL_BOX], oriented: PIXEL_BOX, from: 'device', statusBand: 66 };
    const played = play(ANDROID, [row(2152, unread)]);
    expect(resultOf(played)).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });

  it('a row pinned in the band (no stroke moves it): stuck, naming the navigation bar and the row as pinned under it', () => {
    const played = play({ ...ANDROID, maxSwipes: 6 }, [row(2152), row(2152), row(2152), row(2152)]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'up']);
    expect(played.outcome?.kind).toBe('stuck');
    const message = failureOf(played, 'id:row_4').message;
    expect(message).toContain(
      'its centre stays under the navigation bar at (540,2186), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar, and the content is exhausted: ' +
        'swiping down no longer moves it out from under the navigation bar',
    );
    expect(message).toContain('it is pinned under the navigation bar (a layout that does not keep clear of it?), and no step taps it.');
  });

  it('at the bound: what it was short of is the navigation bar', () => {
    const played = play({ ...ANDROID, maxSwipes: 0 }, [row(2152)]);
    expect(failureOf(played, 'id:row_4').message).toContain(
      'failed after 0 swipes (maxSwipes) — element reached the viewport but its centre stays under the navigation bar at (540,2186), from y 2154 to the bottom of the screen (tree units)',
    );
  });

  /** accountDetail's row_30 66,2088 948x99: its centre (540,2138) clear of the band, its bottom 33 px into it. */
  const row30 = (y = 2088): Row => ({ found: [match({ x: 66, y, width: 948, height: 99 }, 'row_30')], screen: NAV });

  it('fully: true on row_30 reaching 33 px into the band: no stop at 0 swipes (the pixel assert\'s region rule) — stroked until it clears the band; the plain stop stops at once', () => {
    const fully = play({ ...ANDROID, fully: true }, [row30(), row30(1600), row30(1600)]);
    expect(strokesToward(fully)).toEqual(['down']);
    expect(resultOf(fully)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(resultOf(play(ANDROID, [row30()]))).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });

  it('fully: true on row_30 pinned there (no stroke moves it): stuck, naming the navigation bar it reaches into — not its centre, which a tap presses', () => {
    const played = play({ ...ANDROID, fully: true, maxSwipes: 6 }, [row30(), row30(), row30(), row30()]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'up']);
    expect(played.outcome?.kind).toBe('stuck');
    const message = failureOf(played, 'id:row_30').message;
    expect(message).toContain(
      'it stays partly under the navigation bar, from y 2154 to the bottom of the screen (tree units), and the content is exhausted: ' +
        'swiping down no longer moves it out from under the navigation bar',
    );
    expect(message).toContain('it is pinned under the navigation bar (a layout that does not keep clear of it?), and fully: true never stops on it (its centre is clear: a plain scroll_until stops on it, and a tap lands).');
    expect(message).not.toContain('its centre stays');
  });

  it('fully: true at the bound: short of the navigation bar it reaches into, with what the plain stop and the tap still do', () => {
    const played = play({ ...ANDROID, fully: true, maxSwipes: 0 }, [row30()]);
    expect(failureOf(played, 'id:row_30').message).toContain(
      'failed after 0 swipes (maxSwipes) — element reached the viewport but it stays partly under the navigation bar, from y 2154 to the bottom of the screen (tree units) — ' +
        'fully: true stops only with none of it under the bar (its centre is clear: a plain scroll_until stops on it, and a tap lands) (last rect',
    );
  });

  it('…its centre under something of the app: no promise of a stop or a tap, only that its centre is clear of the bar', () => {
    const help = node({ role: 'button', identifier: 'help', rect: { x: 400, y: 2110, width: 200, height: 60 } });
    const pinned = play({ ...ANDROID, fully: true, maxSwipes: 6 }, [1, 2, 3, 4].map(() => ({ ...row30(), over: [help] })));
    expect(pinned.outcome?.kind).toBe('stuck');
    const stuck = failureOf(pinned, 'id:row_30').message;
    expect(stuck).toContain('and fully: true never stops on it (its centre is clear of the bar).');
    expect(stuck).not.toContain('a tap lands');
    const bound = failureOf(play({ ...ANDROID, fully: true, maxSwipes: 0 }, [{ ...row30(), over: [help] }]), 'id:row_30').message;
    expect(bound).toContain('— fully: true stops only with none of it under the bar (its centre is clear of the bar) (last rect');
  });

  /**
   * A CLOSED LOOP over the Pixel_3a with its navigation band: the content moves with every stroke (`frac` of the screen's
   * height a full reach, clamped to `limits` — what the content can move each way), and the round reads it there next.
   * The strokes and the outcome's sentence, in order.
   */
  const glide = (rules: RoundRules, rect: Rect, frac: number, limits: [number, number]): string[] => {
    let state = startRounds(rules, { width: 1080, height: 2220, statusBand: 66, navigationBand: 2154 });
    let off = 0;
    let stroked: any;
    const log: string[] = [];
    for (let i = 0; i < 30; i++) {
      const found = [match({ ...rect, y: rect.y + off }, 't')];
      const seen: any = { read: { tree: treeOf({ found, rest: `at ${off}` }, ANDROID.screen), found, ofKeyboard: () => false, remedy: { dismissal: 'none' } }, elapsedMs: i * 400, readMs: 0, screen: NAV, ...(stroked && { drawn: drawnFor(stroked) }) };
      let next = round(state, seen);
      while (next.step.do === 'ask') {
        if (next.step.what === 'witness') seen.corroborated = true;
        else seen.unlocated = false;
        next = round(state, seen);
      }
      state = next.state;
      const step = next.step;
      if (step.do === 'stop') return [...log, step.outcome.kind === 'visible' ? `visible @${rect.y + off}` : scrollFailure(step.outcome, 'id:"t"').message];
      if (step.do === 'stroke') {
        const d = Math.round(step.reach * 2220 * frac);
        off = Math.max(limits[0], Math.min(limits[1], off + (step.toward === 'down' ? -d : d)));
        log.push(`${step.toward} @${rect.y + off}`);
      }
      stroked = step.do === 'stroke' ? step : undefined;
    }
    return log;
  };

  it('closed loop, the plain stop: a 14-px row at 2147 (its centre in the band) whose content only moves away — turned back toward the band as ever, never pushed off and lost', () => {
    const played = glide({ ...ANDROID, direction: 'up', maxSwipes: 8, timeoutMs: 60_000 }, { x: 66, y: 2147, width: 948, height: 14 }, 0.15, [0, 4000]);
    expect(played.at(-1)).toContain('its centre stays under the navigation bar');
    expect(played.at(-1)).not.toContain('did not stay');
  });

  it('the plain stop judges the far edge in frames NOT cut at the navigation band: row_4 in the band (2152, centre 2186) with `direction: up` is stroked the caller\'s way first', () => {
    const played = play({ ...ANDROID, direction: 'up', maxSwipes: 1 }, [row(2152), row(2152)]);
    expect(strokesToward(played)).toEqual(['up']);
  });

  it('…and so does a fully stop whose CENTRE is in the band (no region judged): row_4 with `direction: up` is stroked the caller\'s way first', () => {
    const played = play({ ...ANDROID, direction: 'up', fully: true, maxSwipes: 1 }, [row(2152), row(2152)]);
    expect(strokesToward(played)).toEqual(['up']);
  });

  it('closed loop, fully: true: a row reaching into the band (2108, 60 tall) the stuck probe pushes wholly into it is turned back, never pushed off and lost', () => {
    const played = glide({ ...ANDROID, direction: 'up', fully: true, maxSwipes: 8, timeoutMs: 60_000 }, { x: 66, y: 2108, width: 948, height: 60 }, 0.3, [0, 4000]);
    expect(played.at(-1)).not.toContain('did not stay');
    expect(played.at(-1)).toContain('navigation bar');
  });

  it('fully: true on row_30 with `direction: up` (content above): at the navigation band it is at the far edge — the first stroke turns and lifts it, no oscillation', () => {
    const played = play({ ...ANDROID, direction: 'up', fully: true }, [row30(), row30(1600), row30(1600)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('fully: true stops at 0 swipes on content in no scroll view that no scroll lifts out of a band: an edge-to-edge app bar 0,0 1080x210, a screen-sized node 0,40 1080x2180, a bottom sheet 0,1100 1080x1120 — no stroke over a modal sheet', () => {
    for (const rect of [{ x: 0, y: 0, width: 1080, height: 210 }, { x: 0, y: 40, width: 1080, height: 2180 }, { x: 0, y: 1100, width: 1080, height: 1120 }]) {
      expect(resultOf(play({ ...ANDROID, fully: true }, [{ found: [match(rect, 'hero')], screen: NAV }]))).toMatchObject({ swipes: 0, visible: 1 });
    }
  });

  it('…but a list row 0,0 1080x150 in a scroll view is a row a scroll lifts out of the status band: stroked until clear', () => {
    const list: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
    const row = (y: number): Row => ({ found: [match({ x: 0, y, width: 1080, height: 150 }, 'row')], scroller: list, screen: NAV });
    const played = play({ ...ANDROID, fully: true }, [row(0), row(400), row(400)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(resultOf(played)).toMatchObject({ swipes: 1, visible: 1 });
  });

  it('…and on an iOS hero 0,0 402x300 under the 62-pt status bar', () => {
    const box: Rect = { x: 0, y: 0, width: 402, height: 874 };
    const screen: UsableScreen = { box, boxes: [box], oriented: box, from: 'device', statusBand: 62 };
    expect(resultOf(play({ ...IPHONE, fully: true }, [{ found: [match({ x: 0, y: 0, width: 402, height: 300 }, 'hero')], screen }]))).toMatchObject({ swipes: 0, visible: 1 });
  });
});

describe('round — a target uiautomator dumped CLIPPED OUT of its scroll container (docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md)', () => {
  /** Settings' list under the collapsing app bar: `[0,297][1080,2220]`. */
  const scroller: Rect = { x: 0, y: 297, width: 1080, height: 1923 };
  /** `Apps` (126 wide at x 198), 60 tall at y. */
  const apps = (y: number): Row => ({ found: [match({ x: 198, y, width: 126, height: 60 }, 'apps')], scroller });
  /** `Apps` dumped inverted past `side`, as the parser normalizes it (adapters/android.ts#nodeBounds): zero size at the list's edge, the side kept. */
  const clippedOut = (side: 'top' | 'bottom'): Row => ({
    found: [{ ...match({ x: 198, y: side === 'top' ? 297 : 2220, width: 126, height: 0 }, 'apps'), clippedOut: side }],
    scroller,
  });
  const SETTINGS: Rules = { ...ANDROID, maxSwipes: 6, timeoutMs: 15_000 };
  const reaches = (played: Played): number[] => played.steps.flatMap((st) => (st.do === 'stroke' ? [st.reach] : []));

  it('seen short (its centre below the screen), then flung clipped out past the TOP — the far edge of a scroll down: the next stroke turns (content down), half the reach — not on down past it', () => {
    const played = play(SETTINGS, [apps(2200), clippedOut('top'), apps(800), apps(800)]);
    expect(strokesToward(played)).toEqual(['down', 'up']);
    expect(reaches(played)).toEqual([1, 0.5]);
    expect(resultOf(played)).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('clipped out past the far edge on the FIRST read: the caller\'s direction is honoured, as iOS honours a target read wholly beyond it (the owner\'s call) — the first stroke is not flipped', () => {
    const played = play({ ...SETTINGS, maxSwipes: 2 }, [clippedOut('top'), { ...clippedOut('top'), rest: 'a' }, { ...clippedOut('top'), rest: 'b' }]);
    expect(strokesToward(played)).toEqual(['down', 'down']);
    // direction: "up" — the one the wait's hint names — strokes the content down at once, full reach.
    const up = play({ ...SETTINGS, direction: 'up' }, [clippedOut('top'), apps(800), apps(800)]);
    expect(strokesToward(up)).toEqual(['up']);
    expect(reaches(up)).toEqual([1]);
  });

  it('last read clipped out past the far edge, then dropped by the lazy list: not `dropped` — it already lay where the caller\'s strokes push it', () => {
    const played = play({ ...SETTINGS, maxSwipes: 3 }, [clippedOut('top'), { found: [], scroller, rest: 'a' }, { found: [], scroller, rest: 'b' }, { found: [], scroller, rest: 'c' }]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'down']);
  });

  it('measured (round 8\'s B1 gap, re-run at 35d5997): plain from `Apps` clipped out past the top, four strokes down, dropped, the screen then unchanged — the failure says where it lay and the way back, not "off the viewport, or under the soft keyboard … (a fling?)"', () => {
    // The list still lists its other rows (`mainScroller`'s default row): a read of it shows the content's motion.
    const gone = (rest: string): Row => ({ found: [], mainScroller: scroller, rest });
    const played = play(SETTINGS, [clippedOut('top'), gone('a'), gone('b'), gone('b'), gone('b')]);
    expect(strokesToward(played)).toEqual(['down', 'down', 'down', 'down']); // the owner's default: no turn on the first read
    const error = failureOf(played, 'text:"Apps"');
    expect(error.message).toBe(
      'scroll_until text:"Apps" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — ' +
        'element was in the tree before the first swipe, clipped out above its scroll container, past the edge the swipes push it out through, never in the viewport, ' +
        'and is no longer in the tree (a lazy list drops what scrolls away) — scroll_until it with direction: "up"',
    );
    expect(error).not.toBeInstanceOf(ElementNotFoundError); // it was in the tree
  });

  it('kept in the tree, clipped out past the top, to maxSwipes: in the tree, off the frame — with where it lay and the way back', () => {
    const played = play({ ...SETTINGS, maxSwipes: 2 }, [clippedOut('top'), clippedOut('top'), clippedOut('top')]);
    expect(failureOf(played, 'text:"Apps"').message).toBe(
      'scroll_until text:"Apps" failed after 2 swipes (maxSwipes) — element in tree but never ' +
        'intersected the 1080x2220 viewport (last rect {"x":198,"y":297,"width":126,"height":0}) — it lay clipped out above its scroll container, past the edge the swipes ' +
        'push it out through: scroll_until it with direction: "up"',
    );
  });

  it('clipped out past the NEAR edge (the bottom, scrolling down) is coming in, and one last read short of the far edge is no evidence: the old words', () => {
    const gone = (rest: string): Row => ({ found: [], scroller, rest });
    const near = play({ ...SETTINGS, maxSwipes: 2 }, [clippedOut('bottom'), gone('a'), gone('b')]);
    expect(failureOf(near, 'text:"Apps"').message).toMatch(/— element was in the tree before the first swipe \(off the viewport, or under the soft keyboard\), never in the viewport/);
    // Seen clipped out past the top, then read in the frame and lost: last seen short of the edge, so `gone`, no side named.
    const back = play({ ...SETTINGS, maxSwipes: 3 }, [clippedOut('top'), { ...apps(2190), rest: 'x' }, gone('a'), gone('b')]);
    expect(failureOf(back, 'text:"Apps"').message).not.toContain('direction: "up"');
  });
});

describe('round — a target read wholly past the far edge on iOS, and one never found by strokes that ran to the end of the content (round 8\'s B1 gap)', () => {
  /** A 354x52 row at y under WDA, read where it is (iOS keeps a scrolled-past node, its rect off the screen). */
  const row = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'row')] });
  const tree = (rest: string): Row => ({ found: [], rest });

  it('above the screen at every read, the strokes (down) moving it no more: the side and the way back — the owner\'s default kept, no turn', () => {
    const played = play({ ...IPHONE, maxSwipes: 4 }, [row(-300), row(-300), row(-300)]);
    expect(strokesToward(played)).toEqual(['down', 'down']);
    expect(failureOf(played, 'id:row').message).toMatch(/— element in tree but never intersected the 402x874 viewport \(last rect [^)]*\) — it lay above the viewport, past the edge the swipes push it out through: scroll_until it with direction: "up"$/);
  });

  it('never in the tree, a stroke that changed the screen and then the caller\'s strokes no longer changing it: the end of the content that way was read, so the other side is named as a conditional — down and up', () => {
    const ranToEnd = [tree('a'), tree('b'), tree('b'), tree('b')];
    expect(failureOf(play(IPHONE, ranToEnd), 'id:t').message).toMatch(/failed after 3 swipes .* — element never appeared in the tree — if it lies above, try direction: "up"$/);
    expect(failureOf(play({ ...IPHONE, direction: 'up' }, ranToEnd), 'id:t').message).toMatch(/— element never appeared in the tree — if it lies below, try direction: "down"$/);
  });

  it('never in the tree, and NO stroke ever changed the screen (review round 1 of fix/r8-wording): nothing says the content ran to its end — the swipes may not have been taken — so no side is named', () => {
    expect(failureOf(play(IPHONE, [tree('a'), tree('a'), tree('a')]), 'id:t').message).toBe(
      'scroll_until id:t failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
  });

  it('never in the tree at maxSwipes, or at the deadline — more content may lie ahead — guesses nothing', () => {
    expect(failureOf(play({ ...IPHONE, maxSwipes: 2 }, [tree('a'), tree('b'), tree('c')]), 'id:t').message).toBe('scroll_until id:t failed after 2 swipes (maxSwipes) — element never appeared in the tree');
  });
});

describe('round — a cover the target shows past only on its far side (the round-6b device check\'s S-1 residual: Contacts\' toolbar 5 pt below the row\'s top)', () => {
  const BANDED: UsableScreen = { box: IPHONE_BOX, boxes: [IPHONE_BOX], oriented: IPHONE_BOX, from: 'device', statusBand: 62 };
  /** Contacts' New Contact sheet under idb: `Toolbar` `0,83 402x48`, listed last. */
  const TOOLBAR = node({ role: 'other', label: 'Toolbar', rect: { x: 0, y: 83, width: 402, height: 48 } });
  /** `add url` (362x51 at x 20) at y, the toolbar — or `bar` — drawn over the rest. */
  const url = (y: number, bar: UiNode = TOOLBAR): Row => ({ found: [match({ x: 20, y, width: 362, height: 51 }, 'url')], over: [bar], screen: BANDED });
  const FULLY_IPHONE: Rules = { ...IPHONE, fully: true, maxSwipes: 6, timeoutMs: 15_000 };
  const reaches = (played: Played): number[] => played.steps.flatMap((st) => (st.do === 'stroke' ? [st.reach] : []));

  it('measured: `add url` at 78 under the toolbar at 83, the default direction down — turned at once, half the reach, plain and fully: true (was one stroke the wrong way, then back)', () => {
    for (const fully of [false, true]) {
      const played = play({ ...FULLY_IPHONE, fully }, [url(78), url(400), url(400)]);
      expect(strokesToward(played)).toEqual(['up']);
      expect(reaches(played)).toEqual([0.5]);
      expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
    }
  });

  it('measured: from 69 — 14 pt showing above the bar, its bottom under it — turned at once too (was two strokes the wrong way)', () => {
    expect(strokesToward(play(FULLY_IPHONE, [url(69), url(400), url(400)]))).toEqual(['up']);
  });

  it('…mirrored: scrolling up, a row whose bottom 5 pt show below a bar in the lower half that covers the rest of it — turned at once', () => {
    const bottomBar = node({ role: 'other', label: 'Bar', rect: { x: 0, y: 760, width: 402, height: 60 } });
    const played = play({ ...FULLY_IPHONE, direction: 'up' }, [url(774, bottomBar), url(400, bottomBar), url(400, bottomBar)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(reaches(played)).toEqual([0.5]);
  });

  it('no turn when something of the row shows on the bar\'s other side or beside it: a bar narrower than the row, a bar ending above the row\'s bottom (a badge, a thin strip)', () => {
    const narrow = node({ role: 'other', label: 'Toolbar', rect: { x: 40, y: 83, width: 300, height: 48 } });
    expect(strokesToward(play({ ...FULLY_IPHONE, maxSwipes: 1 }, [url(78, narrow), url(78, narrow)]))).toEqual(['down']);
    const thin = node({ role: 'other', label: 'Toolbar', rect: { x: 0, y: 83, width: 402, height: 20 } });
    expect(strokesToward(play({ ...FULLY_IPHONE, maxSwipes: 1 }, [url(78, thin), url(78, thin)]))).toEqual(['down']);
  });

  it('…nor in the frame\'s near half: a row coming up from below with its top showing above a bottom bar is swiped on, not turned away (CONTINUE at 780, unchanged)', () => {
    const CONTINUE = node({ role: 'button', label: 'Continue to summary', rect: { x: 24, y: 780, width: 354, height: 44 } });
    const row = (y: number): Row => ({ found: [match({ x: 24, y, width: 354, height: 52 }, 'priority')], over: [CONTINUE], screen: BANDED });
    const played = play(FULLY_IPHONE, [row(775), row(304), row(304)]);
    expect(strokesToward(played)).toEqual(['down']);
    expect(reaches(played)).toEqual([1]);
  });
});

/**
 * A target under a screen PRESENTED over its own (ADR 0018: a modal's dimming leaf, a sheet's form — a later stacked
 * screen-sized layer in the app's Window): no scroll moves it out from under that screen, and a stroke on the screen
 * may dismiss it (a page sheet's pull-to-dismiss, a "Discard Changes?" prompt) — so the round confirms with one more
 * read, sends no stroke, and stops naming the presented screen. On the measured ui_snapshots
 * (tests/fixtures/wda-ui-snapshot-stacked-layers.json) and one raw /source capture
 * (tests/fixtures/wda-capture-contacts-discard-popover.json).
 */
describe('round — a target under a screen presented over it (docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { everyNode } = await import('../../src/adapters/types.js');
  const { parseWdaSource } = await import('../../src/adapters/wda-source.js');
  const screens: Record<string, UiNode> = {
    ...(await stackedLayers()),
    // Contacts' discard popover with the keyboard down: the raw /source capture, parsed as ui_snapshot parses it now.
    contactsDiscardPopoverKeyboardDown: parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-discard-popover.json', import.meta.url), 'utf8')),
  };
  const rowOf = (key: string, id: string): Row => {
    const tree = screens[key];
    return { tree, found: [[...everyNode(tree)].find((x) => x.identifier === id || x.label === id)!] };
  };
  const NONE_SENT = 'a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent.';

  it('the RN modal\'s dimming leaf over lang_sk: one confirming read, no stroke, then the stop naming the presented screen — fully or not, either direction', () => {
    for (const fully of [false, true])
      for (const direction of ['down', 'up'] as const) {
        const played = play({ ...IPHONE, fully, direction }, [rowOf('finportalForgot', 'lang_sk'), rowOf('finportalForgot', 'lang_sk')]);
        expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
        expect(played.outcome?.kind).toBe('presented');
        expect(failureOf(played, 'id:lang_sk').message).toBe(
          'scroll_until id:lang_sk stopped before any swipe — element is in the viewport but under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it — 0% of it shows — ' +
            `${NONE_SENT} Last rect {"x":268,"y":235,"width":43,"height":32} in a 402x874 viewport`,
        );
      }
  });

  it('the page sheet\'s form over a row\'s photo button (#146): no stroke on the sheet (a pull-to-dismiss), the stop names the form', () => {
    const played = play(IPHONE, [rowOf('contactsSheet', 'Contact photo for Kate Bell'), rowOf('contactsSheet', 'Contact photo for Kate Bell')]);
    expect(strokesToward(played)).toEqual([]);
    expect(failureOf(played, 'label:"Contact photo for Kate Bell"').message).toBe(
      'scroll_until label:"Contact photo for Kate Bell" stopped before any swipe — element is in the viewport but under scrollable (0,62 402x812) at its centre (41,290), drawn over it — 0% of it shows — ' +
        `${NONE_SENT} Last rect {"x":18,"y":267,"width":45,"height":45} in a 402x874 viewport`,
    );
  });

  it('the Fees sheet\'s LABELLED dim over the SWIFT form\'s From row: no stroke on the sheet (one would move it to another detent), the stop names the dim', () => {
    const played = play(IPHONE, [rowOf('swiftFeesSheet', 'swift_payment.form.debit_select'), rowOf('swiftFeesSheet', 'swift_payment.form.debit_select')]);
    expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
    expect(failureOf(played, 'id:swift_payment.form.debit_select').message).toBe(
      'scroll_until id:swift_payment.form.debit_select stopped before any swipe — element is in the viewport but under container "dismiss popup" (-402,-874 1206x2622) at its centre (201,195), drawn over it — 0% of it shows — ' +
        `${NONE_SENT} Last rect {"x":42,"y":150,"width":318,"height":89} in a 402x874 viewport`,
    );
  });

  it('a sheet that moved to another detent between the two reads of a stop that sent no swipe: the failure says the sheet moved, not that a swipe moved it', () => {
    const played = play(IPHONE, [rowOf('swiftFeesSheet', 'swift_payment.form.debit_select'), rowOf('swiftFeesSheetExpanded', 'swift_payment.form.debit_select')]);
    expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0 });
    expect(failureOf(played, 'id:swift_payment.form.debit_select').message).toMatch(/^scroll_until id:swift_payment\.form\.debit_select stopped before any swipe — .* so none was sent\. Last rect .* viewport; the sheet moved from its Half screen detent to Expanded$/);
  });

  it('Contacts\' discard popover over a row of the New Contact sheet: no stroke (one would close the popover), the stop is `presented`', () => {
    const played = play(IPHONE, [rowOf('contactsDiscardPopover', 'Insert add instant message'), rowOf('contactsDiscardPopover', 'Insert add instant message')]);
    expect(strokesToward(played)).toEqual([]);
    expect(played.outcome?.kind).toBe('presented');
  });

  it('the confirm is the presented screen\'s own: a target found clear after a stroke, then under a modal presented meanwhile, gets a confirming read of its own before the stop', () => {
    const login = rowOf('finportalLogin', 'lang_sk');
    const played = play(IPHONE, [{ tree: login.tree, found: [] }, login, rowOf('finportalForgot', 'lang_sk'), rowOf('finportalForgot', 'lang_sk')]);
    expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 1 });
    expect(failureOf(played, 'id:lang_sk').message).toMatch(/^scroll_until id:lang_sk stopped after 1 swipe, without swiping further — .*, and a swipe on it may dismiss it, so no further swipe was sent\. Last rect /);
  });

  it('no confirm left — the deadline reached on the first presented read: the stop comes at once, still with no stroke', () => {
    const played = play(IPHONE, [{ ...rowOf('finportalForgot', 'lang_sk'), elapsedMs: IPHONE.timeoutMs }]);
    expect(played.steps.map((st) => st.do)).toEqual(['stop']);
    expect(played.outcome?.kind).toBe('presented');
  });

  it('a confirm whose reads all fail never strokes blind: the reads that did not read are confirmed while the budget allows, then the scroll stops `presented` on the last read that read', () => {
    const failed: Row = { error: 'WDA /source returned 500' };
    const played = play(IPHONE, [rowOf('finportalForgot', 'lang_sk'), failed, failed, failed]);
    expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'confirm', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0 });
  });

  it('a modal closing between the two reads: the confirming read finds the target clear — the stop is visible, still with no stroke', () => {
    const played = play(IPHONE, [rowOf('finportalForgot', 'lang_sk'), rowOf('finportalLogin', 'lang_sk')]);
    expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
    expect(played.outcome?.kind).toBe('visible');
  });

  /**
   * A target NOT judged in the viewport — below the fold, under the soft keyboard — has no covers, so the stop above
   * never sees the presented screen; the stroke for it would touch down on that screen. Before every stroke the round
   * asks where the stroke would touch down (stroke-plan.ts#scrollStroke's `from`, the driver's own point) and, when a surface
   * of a screen presented over the target's lies there (ui-tree/draw-order.ts#DrawOrder.presentedAt), confirms with one
   * more read and stops `presented`, naming the reason it was not in the viewport and where the swipe would land.
   */
  describe('a target not judged in the viewport, whose stroke would touch down on the presented screen', () => {
    const cellOf = (key: string, label: string): Row => {
      const tree = screens[key];
      return { tree, found: [[...everyNode(tree)].find((x) => x.role === 'container' && x.label === label)!] };
    };
    const BELOW = cellOf('contactsDiscardPopoverKeyboardDown', 'add instant message');
    /** The same cell, read where no screen is presented over it (the popover closed): a tree of the cell alone. */
    const unpresented: Row = { found: [node({ role: 'container', label: 'add instant message', rect: { x: 20, y: 1306, width: 362, height: 52 } })] };

    it('Contacts\' discard popover, keyboard down: the sheet\'s cell "add instant message" at y 1306 — one confirming read, no stroke (the one measured closed the popover and read "fully visible after 1 swipe"), the stop names the action sheet WDA types in the popover\'s layer — reaching the whole screen — at the touch-down (201,712)', () => {
      const played = play(IPHONE, [BELOW, BELOW]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0, next: { touchDown: { x: 201, y: 712 } } });
      expect(failureOf(played, 'role:container label:"add instant message"').message).toBe(
        'scroll_until role:container label:"add instant message" stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,712) on ' +
          'other "Are you sure you want to discard this new contact?" (10,78 240x169, reaching 0,0 402x874) — an action sheet is presented over it ("Are you sure you want to discard this new contact?") — close it first, ' +
          'and a swipe would land on the action sheet, so none was sent. Last rect {"x":20,"y":1306,"width":362,"height":52} in a 402x874 viewport',
      );
    });

    it('Contacts\' discard popover, keyboard down, toward the TEXT "add instant message" — read at its cell, 20,1306, below the fold (not parked at the sheet\'s origin): one confirming read, no stroke, the stop names the action sheet at the touch-down (201,712)', () => {
      const tree = screens.contactsDiscardPopoverKeyboardDown;
      const text = [...everyNode(tree)].find((x) => x.role === 'text' && x.label === 'add instant message')!;
      expect(text.rect).toEqual({ x: 20, y: 1306, width: 362, height: 52 });
      const row: Row = { tree, found: [text] };
      const played = play(IPHONE, [row, row]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0, next: { touchDown: { x: 201, y: 712 } } });
      expect(failureOf(played, 'text:"add instant message"').message).toMatch(
        /^scroll_until text:"add instant message" stopped before any swipe — element lies below the viewport, and the next swipe would touch down at \(201,712\) on other "Are you sure you want to discard this new contact\?" \(10,78 240x169, reaching 0,0 402x874\) — an action sheet is presented over it /,
      );
    });

    it('the SWIFT form under the Fees half sheet: `payee_city_input` below the fold — no stroke (the one measured moved the sheet to another detent), the stop names the sheet\'s dim, on top at the touch-down of the stroke drawn in the form\'s own scroll view (0,0 402x780), cut above the sheet drawn over it', () => {
      const field = rowOf('swiftFeesSheet', 'swift_payment.form.payee_city_input');
      for (const fully of [false, true]) {
        const played = play({ ...IPHONE, fully }, [field, field]);
        expect(strokesToward(played)).toEqual([]);
        expect(failureOf(played, 'id:swift_payment.form.payee_city_input').message).toContain(
          '— element lies below the viewport, and the next swipe would touch down at (201,329) on container "dismiss popup" (-402,-874 1206x2622) — a screen is presented over it',
        );
      }
    });

    it('a zero-area node: the Fees half sheet\'s `TextFieldWithComponentStyle` text read at 0,0 0x0 under the form\'s fields — "outside the viewport", not "above": a rect with no area lies past no side, though its bottom edge 0 is the viewport\'s top', () => {
      const tree = screens.swiftFeesSheet;
      const zero = [...everyNode(tree)].find((x) => x.role === 'text' && x.identifier === 'TextFieldWithComponentStyle' && x.rect.width === 0)!;
      expect(zero.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      const row: Row = { tree, found: [zero] };
      const played = play(IPHONE, [row, row]);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0 });
      expect(failureOf(played, 'id:TextFieldWithComponentStyle').message).toMatch(
        /^scroll_until id:TextFieldWithComponentStyle stopped before any swipe — element lies outside the viewport, and the next swipe would touch down at \(201,329\) on /,
      );
    });

    it('under the soft keyboard (the popover over the sheet, keyboard up): the sheet\'s cell "add field" lies under the keyboard\'s band — the stroke, kept above it, would still touch down on the dim; the stop says the keyboard', () => {
      const field = { ...cellOf('contactsDiscardPopover', 'add field'), cover: coverOver({ x: 0, y: 573, width: 402, height: 301 }, NO_BACK), ofKeyboard: (n: UiNode) => n.ofKeyboard === true };
      const played = play(IPHONE, [field, field]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      // Asked where the stroke would touch down above the keyboard (stroke-plan.ts#strokeRoom's cut), not on its keys at (201,699).
      expect(played.outcome).toMatchObject({ kind: 'presented', next: { touchDown: { x: 201, y: 471 } } });
      expect(failureOf(played, 'role:container label:"add field"').message).toMatch(
        /^scroll_until role:container label:"add field" stopped before any swipe — element lies under the soft keyboard: its centre \(201,661\) lies below the keyboard's top edge at y 573, and the next swipe would touch down at \(201,471\) on container "dismiss popup" \(0,0 402x874\) — a screen is presented over it \(a modal or a sheet\) — close it first; /,
      );
    });

    it('on the screen but outside its own scroll view, nothing of it drawn: the SWIFT form\'s "Payee’s name" 42,816, listed below the form\'s 780 (under its CONTINUE bar), the expanded Fees sheet\'s form over the rest — the stroke would touch down on that form', () => {
      const name: Row = { tree: screens.swiftFeesSheetExpanded, found: [[...everyNode(screens.swiftFeesSheetExpanded)].find((x) => x.role === 'text' && x.label === 'Payee’s name')!] };
      const played = play({ ...IPHONE, fully: true }, [name, name]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      expect(failureOf(played, 'text:"Payee’s name"').message).toContain(
        '— element lies outside its scroll view scrollable (0,0 402x780): nothing of it is drawn, and the next swipe would touch down at (201,569) on scrollable (24,105 354x711) — a screen is presented over it',
      );
    });

    it('above its own scroll view, its centre under the status bar: the New Contact sheet\'s cell "add birthday" at y -24, above the sheet\'s form (from 62), under the discard popover — nothing of it drawn: the stroke the caller\'s way would touch down on the popover\'s dim, one up on its own scroll view', () => {
      const box = { x: 0, y: 0, width: 402, height: 874 };
      const cell: Row = { ...cellOf('contactsDiscardPopover', 'add birthday'), screen: { box, boxes: [box], oriented: box, from: 'device', statusBand: 62 } };
      const played = play(IPHONE, [cell, cell]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      expect(failureOf(played, 'role:container label:"add birthday"').message).toMatch(
        /— element lies outside its scroll view scrollable \(0,62 402x812\): nothing of it is drawn, and the next swipe would touch down at \(201,712\) on container "dismiss popup" \(0,0 402x874\) — a screen is presented over it /,
      );
      // Asked to scroll up, toward it: the stroke up would touch down on the popover's own scroll view, on top there.
      const up = play({ ...IPHONE, direction: 'up' }, [cell, cell]);
      expect(failureOf(up, 'role:container label:"add birthday"').message).toMatch(/and the next swipe would touch down at \(201,224\) on scrollable \(10,166 240x81\) — a screen is presented over it /);
    });

    it('platform-blind, a synthetic shape on ANDROID (no Android device tree has a presented screen): in the viewport but cut to a sliver by its scroll container (the SWIFT form\'s "Payment details" toggle 66,1924 948x55 at the form\'s bottom edge), a sheet\'s scroll view presented over the rest of the form — the stroke would touch down on that sheet, so the stop is `presented` there as on iOS', () => {
      const SCREEN = { x: 0, y: 0, width: 1080, height: 2220 };
      const toggle = node({ role: 'container', identifier: 'details_toggle', rect: { x: 66, y: 1924, width: 948, height: 55 }, children: [node({ role: 'other', label: 'Payment details', rect: { x: 66, y: 1936, width: 948, height: 42 } })] });
      const form = node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 242, width: 1080, height: 1736 }, children: [toggle] });
      const sheet = node({ role: 'scrollable', rect: { x: 0, y: 600, width: 1080, height: 1300 }, children: [node({ role: 'text', label: 'Fees', rect: { x: 66, y: 650, width: 300, height: 60 } })] });
      const screenBeneath = node({ role: 'container', rect: SCREEN, children: [form, node({ role: 'button', label: 'CONTINUE', rect: { x: 66, y: 1979, width: 948, height: 132 } })] });
      const tree = node({ role: 'container', rect: SCREEN, children: [node({ role: 'container', rect: SCREEN, children: [screenBeneath, node({ role: 'container', rect: SCREEN, children: [sheet] })] })] });
      const row: Row = { tree, found: [toggle] };
      const played = play(ANDROID, [row, row]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
      expect(failureOf(played, 'id:details_toggle').message).toContain(
        "— element is in the viewport but cut at its scroll container's bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across that edge, under the 65 a tap needs, and the next swipe would touch down at (540,1631) on scrollable (0,600 1080x1300) — a screen is presented over it",
      );
    });

    it('after strokes: a target stroked for while nothing was presented, then a popover presented over its screen — confirmed, then "stopped after 1 swipe, without swiping further"', () => {
      const played = play(IPHONE, [unpresented, BELOW, BELOW]);
      expect(played.steps.map((st) => st.do)).toEqual(['stroke', 'confirm', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 1 });
      expect(failureOf(played, 'role:container label:"add instant message"').message).toMatch(
        /^scroll_until role:container label:"add instant message" stopped after 1 swipe, without swiping further — element lies below the viewport, .*, and a swipe would land on the action sheet, so no further swipe was sent\. Last rect /,
      );
    });

    it('the popover closed between the two reads: the confirming read finds no presented screen at the touch-down — the stroke is sent', () => {
      const played = play(IPHONE, [BELOW, unpresented]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stroke']);
    });

    it('a hold that a read which reads lets go is gone: the popover closed on the confirming read (stroke sent), then a read fails — the failed read strokes on, it does not stop `presented` on the hold the closed popover released', () => {
      const failed: Row = { error: 'WDA /source returned 500' };
      const played = play(IPHONE, [BELOW, unpresented, failed]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stroke', 'stroke']);
    });

    it('the stuck turn\'s stroke back held for the confirming read is not taken as answered by it — on the Fees half sheet\'s tree, the target its first `dismiss popup` in tree order: a hidden twin `PopoverDismissRegion` of the sheet\'s dim, listed in the SWIFT form\'s own layer, judged either way up. The two strokes up touch down at (201,175) on the sheet\'s REAL dim, of the same frame, which the target column excuses as the target\'s own frame (`sameFrame`; a residual of ADR 0018), so they are sent; the turn down would touch down on the sheet\'s form, a presented surface, so it is held, confirmed and stopped — never "nor does swiping down"', () => {
      const tree = screens.swiftFeesSheet;
      const twin = [...everyNode(tree)].find((x) => x.label === 'dismiss popup')!; // the first in pre-order: the hidden twin in the form's layer
      const box = { x: 0, y: 0, width: 402, height: 874 };
      const eitherWayUp = { box, boxes: [box, { x: 0, y: 0, width: 874, height: 402 }], oriented: box, from: 'device' as const };
      const row: Row = { tree, found: [twin], screen: eitherWayUp };
      const played = play({ ...IPHONE, direction: 'up', maxSwipes: 5, timeoutMs: 30_000 }, [row, row, row, row]);
      expect(played.steps.map((st) => (st.do === 'stroke' ? st.toward : st.do))).toEqual(['up', 'up', 'confirm', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 2, next: { touchDown: { x: 201, y: 699 } } });
      expect(failureOf(played, 'label:"dismiss popup"').message).toMatch(
        /^scroll_until label:"dismiss popup" stopped after 2 swipes, without swiping further — element is in the viewport but CLIPPED at [a-z/]+, 10% of it is in the viewport, and the next swipe would touch down at \(201,699\) on scrollable \(31,456 340x355\) — a screen is presented over it /,
      );
    });

    it('a hold whose confirming reads all fail never strokes blind: the reads that did not read are confirmed while the budget allows, then the scroll stops `presented` on the last read that read — no swipe onto the dim', () => {
      const failed: Row = { error: 'WDA /source returned 500' };
      const played = play(IPHONE, [BELOW, failed, failed, failed]);
      expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'confirm', 'confirm', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'presented', swipes: 0, next: { touchDown: { x: 201, y: 712 } } });
    });

    it('sideways (synthetic: a carousel of the screen beneath, a presented dim over the screen): a card wholly right of the viewport, or left of it, is named on that side, and the next swipe would touch down on the dim', () => {
      const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
      for (const [direction, x, side] of [['right', 420, 'right of'], ['left', -300, 'left of']] as const) {
        const card = node({ role: 'button', label: 'Card', rect: { x, y: 320, width: 280, height: 160 } });
        const carousel = node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 300, width: 402, height: 200 }, children: [card] });
        const dim = node({ role: 'container', identifier: 'modal_dim', rect: SCREEN });
        const sheet = node({ role: 'text', label: 'Reset account', rect: { x: 16, y: 600, width: 370, height: 120 } });
        const tree = node({ role: 'container', label: 'App', rect: SCREEN, children: [node({ role: 'container', rect: SCREEN, children: [node({ role: 'container', rect: SCREEN, children: [carousel] }), node({ role: 'container', rect: SCREEN, children: [dim, sheet] })] })] });
        const row: Row = { tree, found: [card] };
        const played = play({ ...IPHONE, direction }, [row, row]);
        expect(played.steps.map((st) => st.do)).toEqual(['confirm', 'stop']);
        expect(failureOf(played, 'label:Card').message).toMatch(new RegExp(`^scroll_until label:Card stopped before any swipe — element lies ${side} the viewport, and the next swipe would touch down at \\(\\d+,\\d+\\) on container id:modal_dim \\(0,0 402x874\\) — a screen is presented over it `));
      }
    });

    it('at a bound, the swipe the bound held back would have touched down on a presented screen: the failure says so in one clause (strokes sent while none was presented, then the popover up when the strokes stopped moving the cell)', () => {
      const played = play(IPHONE, [unpresented, unpresented, BELOW]);
      expect(played.outcome?.kind).toBe('bound');
      expect(failureOf(played, 'role:container label:"add instant message"').message).toMatch(
        /\. The next swipe would have touched down at \(201,712\) on other "Are you sure you want to discard this new contact\?" \(10,78 240x169, reaching 0,0 402x874\) — an action sheet is presented over it \("Are you sure you want to discard this new contact\?"\) — close it first$/,
      );
    });

    it('…and a bound with NO target in the tree says nothing of where its held-back swipe would land, though it would land on the action sheet: the plan asks on behalf of none, the bound quotes only a target\'s', () => {
      const played = play({ ...IPHONE, maxSwipes: 0 }, [{ ...BELOW, found: [] }]);
      expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
      expect(played.outcome).not.toHaveProperty('presented');
    });

    it('a row of the presented sheet itself, below the sheet\'s fold, is stroked for: the touch-down lies on its own screen\'s form (the New Contact sheet\'s "add url" at y 901)', () => {
      const cell = cellOf('contactsSheet', 'add url');
      const played = play(IPHONE, [cell, cell]);
      expect(played.steps[0]).toMatchObject({ do: 'stroke', toward: 'down' });
    });
  });
});

/**
 * The drawn frame (ui-tree/standing.ts): on a WDA tree a scroll view's content keeps its laid-out rect past the scroll
 * view's frame, which draws none of it there. The far edge is judged at that frame's edge as at the screen's: a SwiftUI
 * form whose ScrollView starts under its navigation header (`0,116 402x664`), a row flung across that top edge.
 */
describe('round — the far edge at the edge of what the target\'s scroll view draws', () => {
  const formRow = (y: number): Row => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 24, y, width: 354, height: 60 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', rect: { x: 0, y: 116, width: 402, height: 664 }, children: [node({ role: 'button', identifier: 'top', rect: { x: 24, y: 400, width: 354, height: 52 } }), row] }), node({ role: 'other', label: 'Header', rect: { x: 0, y: 0, width: 402, height: 116 } })],
    });
    return { tree, found: [row] };
  };

  it('fully: true, a row across the form\'s top edge (90–150) and short of its stop: the strokes turn toward it, up — never down, pushing it further under the header', () => {
    const played = play({ ...IPHONE, fully: true }, [formRow(800), formRow(90), formRow(90), formRow(200), formRow(200)]);
    expect(strokesToward(played)).toEqual(['down', 'up', 'up']);
  });

  it('a row wholly above the form\'s top edge (40–100), nothing of it drawn: off the frame, as one wholly above the screen — the caller\'s direction on a first read', () => {
    const played = play({ ...IPHONE, maxSwipes: 1 }, [formRow(40), formRow(40)]);
    expect(strokesToward(played)).toEqual(['down']);
    // The failure says where it lay: above its scroll view, which is on the screen — not above the viewport.
    const message = failureOf(played, 'id:row').message;
    expect(message).toContain('it lay above its scroll view scrollable (0,116 402x664), past the edge the swipes push it out through: scroll_until it with direction: "up"');
    expect(message).not.toContain('the viewport, past');
  });
});

describe('round — a target the strokes never bring into what its scroll view draws', () => {
  it('the at-rest SWIFT form\'s payee_name_input listed below its form, content that no longer moves: the failure says it was never drawn inside that scroll view — not that it never met the viewport it lies on', () => {
    const name = node({ role: 'textfield', identifier: 'payee_name_input', rect: { x: 24, y: 801, width: 354, height: 52 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', identifier: 'form', rect: { x: 0, y: 0, width: 402, height: 780 }, children: [node({ role: 'button', identifier: 'top', rect: { x: 24, y: 300, width: 354, height: 52 } }), name] })],
    });
    const row: Row = { tree, found: [name] };
    const played = play({ ...IPHONE, maxSwipes: 5 }, [row, row, row]);
    expect(failureOf(played, 'id:payee_name_input').message).toContain('element in tree but never drawn: it lies outside its scroll view scrollable id:form (0,0 402x780) (last rect');
  });
});

/**
 * The stroke's container on a WDA tree (stroke-plan.ts#targetScrollers): WDA marks no node as clipping, so the
 * target's clipping chain is empty there and its scroll views are the ancestors that scroll (`Clips.drawnIn`). The
 * lab app's cells, as WDA lists them on the iPhone 17 (402x874).
 * docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md
 * docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md
 */
describe('round — a WDA target\'s strokes go over its own scroll view', () => {
  const strokes = (played: Played) => played.steps.flatMap((s) => (s.do === 'stroke' && s.box !== undefined ? [{ box: s.box, from: drawnFor(s).from }] : []));

  it('tabbar-floating: R flung past the screen\'s top under the 200-pt header — the turned stroke touches down inside the list (0,200 402x674), not in the header', () => {
    // Lab note LV3.
    const LIST: Rect = { x: 0, y: 200, width: 402, height: 674 };
    const listRow = (y: number): Row => {
      const r = node({ role: 'button', identifier: 'R', rect: { x: 24, y, width: 354, height: 52 } });
      const tree = node({
        role: 'container',
        unclippedFrames: true,
        rect: { x: 0, y: 0, width: 402, height: 874 },
        children: [node({ role: 'other', label: 'Header', rect: { x: 0, y: 0, width: 402, height: 200 } }), node({ role: 'scrollable', identifier: 'list', rect: LIST, children: [r] })],
      });
      return { tree, found: [r] };
    };
    // Read short of the far edge (inside the list), then carried past the top by the stroke: the strokes turn.
    const played = play({ ...IPHONE, maxSwipes: 2 }, [listRow(1200), listRow(-391), listRow(-391)]);
    expect(strokesToward(played)).toEqual(['down', 'up']);
    const sent = strokes(played);
    expect(sent.map((s) => s.box)).toEqual([LIST, LIST]);
    for (const { from } of sent) expect(containsPoint(LIST, from)).toBe(true);
  });

  // Its idb twin: idb's flat list lists no scroll view (the target's is untold), so before a read sees R move the stroke
  // goes over the screen; once two reads see it carried, with T, the turned stroke goes over where they were seen
  // moving (motion-shown.ts#MotionShown) — inside the list (0,200 402x640, state.json), not in the header at y 175.
  it('tabbar-floating under idb: the capture with T, R and F carried 1108 pt (as measured live) — the first stroke over the screen (699), the turned one touching down inside the list (391), where T and R were seen moving', () => {
    const LIST: Rect = { x: 0, y: 200, width: 402, height: 640 };
    const raw = readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/tabbar-floating.idb.json', import.meta.url), 'utf8');
    const ROWS = new Set(['lab.tabbar-floating.T', 'lab.tabbar-floating.R', 'lab.tabbar-floating.F']);
    const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, ...(ROWS.has(n.identifier ?? '') && { rect: { ...n.rect, y: n.rect.y - dy } }), children: n.children.map((c) => shifted(c, dy)) });
    const idbRow = (offset: number): Row => {
      const tree = shifted(parseIdbDescribeAll(raw), offset);
      return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === 'lab.tabbar-floating.R') };
    };
    const played = play({ ...IPHONE, maxSwipes: 2 }, [idbRow(0), idbRow(1108), idbRow(1108)]);
    expect(strokesToward(played)).toEqual(['down', 'up']);
    const [first, turned] = strokes(played);
    expect(first.from).toEqual({ x: 201, y: 699 });
    expect(turned.from).toEqual({ x: 201, y: 391 });
    expect(containsPoint(LIST, turned.from)).toBe(true);
  });

  // The stop the region holds back (motion-shown.ts#carriedUnder): measured live, the turned stroke carried R back to y
  // 114, under the header idb lists it beneath, and the plain stop claimed it there — the tap went to the header. Now no
  // stop short of the line a stroke over the region touches down on (391 of 24,300 354x455), on the side the content
  // was first seen moving toward (the top): the strokes go on over the region; R left there, the failure says so.
  describe('tabbar-floating under idb: R carried back under the header is no stop', () => {
    const raw = readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/tabbar-floating.idb.json', import.meta.url), 'utf8');
    const ROWS = new Set(['lab.tabbar-floating.T', 'lab.tabbar-floating.R', 'lab.tabbar-floating.F']);
    const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, ...(ROWS.has(n.identifier ?? '') && { rect: { ...n.rect, y: n.rect.y - dy } }), children: n.children.map((c) => shifted(c, dy)) });
    const idbRow = (offset: number): Row => {
      const tree = shifted(parseIdbDescribeAll(raw), offset);
      return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === 'lab.tabbar-floating.R') };
    };
    const BAND = 'lay above y 391, where a stroke over where its content was seen moving (24,300 354x455) touches down carrying content away from its top edge — in the band 24,300 354x91 or past it';

    it('R at y 114 (offset 607), then at 317 (404): no stop, either — two more strokes over the region (391); R at 380 (341), its centre past the line, stops after 4 swipes', () => {
      const played = play({ ...IPHONE, maxSwipes: 5 }, [idbRow(0), idbRow(1108), idbRow(607), idbRow(404), idbRow(341), idbRow(341)]);
      expect(strokesToward(played)).toEqual(['down', 'up', 'up', 'up']);
      expect(strokes(played).slice(1).map((s) => s.from)).toEqual([{ x: 201, y: 391 }, { x: 201, y: 391 }, { x: 201, y: 391 }]);
      expect(resultOf(played)).toMatchObject({ swipes: 4, visible: 1 });
    });

    it('a floating button beside the rows held still (330,480): no chrome — R carried to 380 stops after 2 swipes, as without it', () => {
      const beside = (row: Row): Row => ({ ...row, tree: { ...row.tree!, children: [...row.tree!.children, node({ role: 'button', label: 'Beside', rect: { x: 330, y: 480, width: 56, height: 56 } })] } });
      const played = play({ ...IPHONE, maxSwipes: 5 }, [idbRow(0), idbRow(1108), idbRow(341), idbRow(341)].map(beside));
      expect(resultOf(played)).toMatchObject({ swipes: 2, visible: 1 });
    });

    it('fully: true asks all of it — R left at 369, its top 22 pt short of the line (centre past it): no stop, and the failure says only part of it lay there', () => {
      const played = play({ ...IPHONE, fully: true, maxSwipes: 3 }, [idbRow(0), idbRow(1108), idbRow(352), idbRow(352)]);
      const { message } = failureOf(played, 'id:lab.tabbar-floating.R');
      expect(message).toContain(`part of it ${BAND}`);
    });

    it('only a match that would stop is held back: R left at y -39, a quarter of it on the screen, is short of a stop already — the failure says it is clipped at the top, not where it was carried', () => {
      const played = play({ ...IPHONE, maxSwipes: 3 }, [idbRow(0), idbRow(1108), idbRow(760), idbRow(760)]);
      const { message } = failureOf(played, 'id:lab.tabbar-floating.R');
      expect(message).toContain('CLIPPED at top');
      expect(message).not.toContain('where its content was seen moving');
    });

    it('R left at y 114 by strokes that no longer move it: the stuck failure says so too, no stop claimed', () => {
      const played = play({ ...IPHONE, maxSwipes: 8 }, [idbRow(0), idbRow(1108), ...Array.from({ length: 3 }, () => idbRow(607))]);
      const { message } = failureOf(played, 'id:lab.tabbar-floating.R');
      expect(message).toContain(`element is on the screen but it ${BAND} — the tree lists no scroll view and lists a row carried under a header or a bar where it would lie, so whether it is drawn there it cannot tell, and no stop was claimed on it`);
      expect(message).toContain('no longer moves it');
      expect(message).toContain('under treeSource: wda the tree lists the scroll view, and scroll_until judges the element in it.');
    });

    it('R left at y 114 to the bound: an honest failure — it lay short of the line a stroke over where its content was seen moving touches down on; no stop claimed', () => {
      const played = play({ ...IPHONE, maxSwipes: 3 }, [idbRow(0), idbRow(1108), idbRow(607), idbRow(607)]);
      const { message } = failureOf(played, 'id:lab.tabbar-floating.R');
      expect(message).toContain(`it ${BAND}`);
      expect(message).toContain('(last rect {"x":24,"y":114,"width":354,"height":52}); under treeSource: wda the tree lists the scroll view, and scroll_until judges the element in it.');
    });
  });

  // The lab's tabbar-dense (lab note LV3, its cell): tabbar-floating's header and tab bar over rows every 60 pt, R the
  // eighth (720). Rows carried back under the 200-pt header, which idb lists there, grow the region up to the header's
  // title (24,110 354x645); measured live, the turned stroke carried R back to 143 and 158, inside that region, and the
  // stop claimed it — the tap went to the header. The band (motion-shown.ts#HeldBand) holds it short of the line 239.
  describe('tabbar-dense under idb: the turned stroke over the region, the band short of its line', () => {
    const raw = readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/tabbar-dense.idb.json', import.meta.url), 'utf8');
    const carried = (n: UiNode): boolean => /^lab\.tabbar-dense\.(row\.\d+|R|L)$/.test(n.identifier ?? '');
    const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, ...(carried(n) && { rect: { ...n.rect, y: n.rect.y - dy } }), children: n.children.map((c) => shifted(c, dy)) });
    /** The capture with the rows carried `offset` pt toward the list's end, the target `of` (R, or the last row L); `tick`, a clock's label (a node whose text changes on every read). */
    const denseRow = (offset: number, tick?: string, of: 'R' | 'L' = 'R'): Row => {
      const at = shifted(parseIdbDescribeAll(raw), offset);
      const tree = tick === undefined ? at : { ...at, children: [...at.children, node({ role: 'text', identifier: 'clock', label: tick, rect: { x: 300, y: 70, width: 80, height: 16 } })] };
      return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === `lab.tabbar-dense.${of}`) };
    };
    /** R flung past the top by the first stroke (1100), carried back by the turned one to 150 — under the header — then to 400. */
    const R_REPLAY = [0, 1100, 570, 320, 320];

    it('R from the list\'s top: the first stroke over the screen (699), the turned ones over the region (239, inside the list, not 175 in the header); R carried back to 150 is held, at 400 it stops — after 3 swipes', () => {
      const played = play(IPHONE, R_REPLAY.map((o) => denseRow(o)));
      expect(strokesToward(played)).toEqual(['down', 'up', 'up']);
      expect(strokes(played).map((s) => s.from.y)).toEqual([699, 239, 239]);
      expect(resultOf(played)).toMatchObject({ swipes: 3, visible: 1 });
    });

    it('a ticking label (a clock whose text changes on every read) changes nothing: the same strokes, the same stop', () => {
      const ticking = play(IPHONE, R_REPLAY.map((o, i) => denseRow(o, `9:4${i}`)));
      const still = play(IPHONE, R_REPLAY.map((o) => denseRow(o)));
      expect(ticking.steps.map(decided)).toEqual(still.steps.map(decided));
      expect(strokes(ticking)).toEqual(strokes(still));
      expect(resultOf(ticking)).toEqual(resultOf(still));
    });

    it('R left at 150 to the bound: the LOUD names the band and the line, and the remedy', () => {
      const played = play({ ...IPHONE, maxSwipes: 3 }, [0, 1100, 570, 570].map((o) => denseRow(o)));
      const { message } = failureOf(played, 'id:R');
      expect(message).toContain(
        'scroll_until id:R failed after 3 swipes (maxSwipes) — element reached the screen but it lay above y 239, where a stroke over where its content was seen moving (24,110 354x645) touches down carrying content away from its top edge — in the band 24,110 354x129 or past it — ' +
          'the tree lists no scroll view and lists a row carried under a header or a bar where it would lie, so whether it is drawn there it cannot tell, and no stop was claimed on it (last rect {"x":24,"y":150,"width":354,"height":52}); under treeSource: wda the tree lists the scroll view, and scroll_until judges the element in it.',
      );
    });

    // The pushed side's band holds on every read until the next stroke, not only on the one right after it: a stop
    // after a stroke is claimed on a confirming read, and a fling carries the target on between the two. The turned
    // stroke (content carried down) reads R mid-fling at 474, short of the bottom band; the confirming read finds it at
    // 654, centre 680 — in the band (below the line 627) the content was pushed toward, over the tab bar's top: held.
    it('a fling carrying R on after the turned stroke: the read right after it finds R short of the bottom band (474), the confirming read in it (654) — held to the bound, the LOUD names the bottom band', () => {
      const played = play({ ...IPHONE, maxSwipes: 2 }, [0, 1100, 246, 66].map((o) => denseRow(o)));
      expect(strokes(played).map((s) => s.from.y)).toEqual([699, 239]);
      const { message } = failureOf(played, 'id:R');
      expect(message).toContain('it lay below y 627, where a stroke over where its content was seen moving (24,110 354x645) touches down carrying content away from its bottom edge — in the band 24,627 354x128 or past it');
      expect(message).toContain('(last rect {"x":24,"y":654,"width":354,"height":52})');
    });

    // The forward side stays base's (motion-shown.ts#goesOver): a stroke moving the content the way it was first seen
    // moving keeps the screen box, and only `way` and the last stroke's pushed side are banded — L, the last row, at
    // the list's end (680, centre 706: in the region's bottom band, which no stroke pushed content toward) is claimed.
    it('L at the list\'s end: every stroke forward over the screen box (699), the region formed or not; L at 680 is claimed after 4 swipes', () => {
      const played = play({ ...IPHONE, maxSwipes: 6 }, [0, 600, 1200, 1800, 1960, 1960].map((o) => denseRow(o, undefined, 'L')));
      expect(strokesToward(played)).toEqual(['down', 'down', 'down', 'down']);
      expect(strokes(played).map((s) => s.from.y)).toEqual([699, 699, 699, 699]);
      expect(resultOf(played)).toMatchObject({ swipes: 4, visible: 1 });
    });

    it('an `up` call, the content first seen carried down: R carried past the region\'s top toward the header\'s title, which held still, is no stop — the stuck LOUD names the title', () => {
      const played = play({ ...IPHONE, direction: 'up', maxSwipes: 3 }, [1100, 680, 680, 680].map((o) => denseRow(o)));
      const { message } = failureOf(played, 'id:R');
      expect(message).toContain('element is on the screen but it lay past the top edge of where its content was seen moving (24,110 354x645), toward text "Header" (173,90 56x20), which held still while it moved');
      expect(message).toContain('under treeSource: wda the tree lists the scroll view, and scroll_until judges the element in it.');
    });
  });

  // The motion is measured on what of the screen shows the app — below iOS's status band, where a touch goes to the
  // status bar: carousel-in-list's B flung by the first stroke from 1060 to -48 (the page's end, measured live) shows
  // only its top 16 pt, under the band, and a 24-pt sliver of the carousel's card — one node below the band, no
  // scroll view; the turned stroke goes over the screen box (175), as before the motion, not into the band (45).
  it('carousel-in-list under idb: B flung to the page\'s end, under the status band — the turned stroke over the screen box (175), never touching down in the band', () => {
    const raw = readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/carousel-in-list.idb.json', import.meta.url), 'utf8');
    const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, ...(/^lab\.carousel-in-list\./.test(n.identifier ?? '') && { rect: { ...n.rect, y: n.rect.y - dy } }), children: n.children.map((c) => shifted(c, dy)) });
    const box: Rect = { x: 0, y: 0, width: 402, height: 874 };
    const idbRow = (offset: number): Row => {
      const tree = shifted(parseIdbDescribeAll(raw), offset);
      return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === 'lab.carousel-in-list.B'), screen: { box, boxes: [box], oriented: box, from: 'device', statusBand: 62 } };
    };
    const played = play({ ...IPHONE, maxSwipes: 2 }, [idbRow(0), idbRow(1108), idbRow(1108)]);
    expect(strokesToward(played)).toEqual(['down', 'up']);
    expect(strokes(played).map((s) => s.from)).toEqual([{ x: 201, y: 699 }, { x: 201, y: 175 }]);
  });

  // LE4's note, its residual: Account Detail's card carousel (24,138 354x85, read horizontal from its cards past its
  // frame) under the transactions list (0,180 402x694, listed after it, no ancestor of the carousel): a card right of
  // the carousel, scrolled for `down`, has no scroll view that scrolls along the stroke, and the stroke plan falls back
  // to the nearest, the carousel — a vertical 52-pt stroke touching down where the list is drawn over it — as before
  // the axis rule (stroke-plan.ts#strokeRoom). A carousel nested IN the list gives way to the list
  // (tests/interact/stroke-plan.test.ts, "the axis").
  it('a card of a horizontal carousel no list holds, scrolled for `down`: no scroll view along the stroke, so the vertical stroke goes inside the carousel (the fallback), and the failure names the list drawn over its touch-down', () => {
    const CAROUSEL: Rect = { x: 24, y: 138, width: 354, height: 85 };
    const card = node({ role: 'other', label: 'My Account', rect: { x: 378, y: 138, width: 354, height: 85 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        node({ role: 'scrollable', rect: CAROUSEL, children: [node({ role: 'other', label: 'Card 1', rect: { ...CAROUSEL } }), card] }),
        node({ role: 'scrollable', identifier: 'transactions.list.container', rect: { x: 0, y: 180, width: 402, height: 694 }, children: [node({ role: 'cell', label: 'Row', rect: { x: 0, y: 300, width: 402, height: 60 } })] }),
      ],
    });
    const row: Row = { tree, found: [card] };
    const played = play({ ...IPHONE, maxSwipes: 2 }, [row, row, row]);
    const sent = strokes(played);
    expect(sent.map((s) => s.box)).toEqual([CAROUSEL, CAROUSEL]);
    expect(sent.map((s) => s.from)).toEqual([{ x: 201, y: 207 }, { x: 201, y: 207 }]); // as the differential replays the captured tree: 201 207 → 155
    expect(failureOf(played, 'label:"My Account"').message).toMatch(/they touched down at 201,207 on scrollable \(id transactions\.list\.container\) at 0,180 402x694, drawn over the list 24,138 354x85/);
  });

});

describe('round — fully: true on a row its scroll view cuts, the content exhausted', () => {
  // The country sheet's list ends at 811 inside the 402x874 screen: row_7 (779–822) is drawn 32 of its 43 pt.
  const listRow = (list: { y: number; height: number }, y: number, height = 43, x = 31, width = 340): Row => {
    const row = node({ role: 'button', identifier: 'row_7', rect: { x, y, width, height } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', identifier: 'country_list', rect: { x: 31, ...list, width: 340 }, children: [node({ role: 'button', identifier: 'row_1', rect: { x: 31, y: list.y + 10, width: 340, height: 43 } }), row] })],
    });
    return { tree, found: [row] };
  };
  const failure = (row: Row): string => failureOf(play({ ...IPHONE, fully: true }, [row, row, row, row]), 'id:row_7').message;
  const EITHER = 'either the swipes do not scroll that scroll view (swipe inside it), or ';
  // One sentence row per cause and per side the content stops short at; the rest of the classification
  // (scroll-read.ts#ClipCause, ui-tree/standing.ts#ScrollViewCut) is pinned in tests/interact/scroll-read.test.ts.

  it('cut at its scroll view\'s bottom edge (the country sheet\'s row_7, 74% drawn above the list\'s 811): the failure names that scroll view and both ways it can stay cut, with no verdict', () => {
    const message = failure(listRow({ y: 456, height: 355 }, 779));
    expect(message).toContain(
      'element is in the viewport but CLIPPED at bottom by its scroll view scrollable id:country_list (31,456 340x355): 74% of it is drawn, and the content is exhausted: ' +
        `swiping down no longer moves it, nor does swiping up. The rest lies past that scroll view's edge: ${EITHER}` +
        'its content ends before the element does (no room after it — a layout defect). Last rect',
    );
    expect(message).not.toContain('not a layout defect');
    expect(message).not.toContain('no clearance for an overlay');
  });

  it('cut at its scroll view\'s top edge (a row at 440 above the list\'s 456): its content begins after the element does — no room before it', () => {
    const message = failure(listRow({ y: 456, height: 355 }, 440));
    expect(message).toContain(
      'element is in the viewport but CLIPPED at top by its scroll view scrollable id:country_list (31,456 340x355): 63% of it is drawn, and the content is exhausted: ' +
        `swiping up no longer moves it, nor does swiping down. The rest lies past that scroll view's edge: ${EITHER}` +
        'its content begins after the element does (no room before it — a layout defect). Last rect',
    );
  });

  it('cut at two of its scroll view\'s edges on opposite kinds of side, top and right (a row above the list\'s 456 and past its 371): its content stops short of the element at those edges', () => {
    const message = failure(listRow({ y: 456, height: 355 }, 440, 43, 200, 200));
    expect(message).toContain(
      `CLIPPED at top/right by its scroll view scrollable id:country_list (31,456 340x355): 54% of it is drawn, and the content is exhausted: swiping up no longer moves it, nor does swiping down. The rest lies past that scroll view's edges: ${EITHER}` +
        'its content stops short of the element at those edges (no room past them — a layout defect). Last rect',
    );
  });

  it('taller than its scroll view (a 400-pt row in a 355-pt list), cut at both its edges: no scroll shows it whole', () => {
    const message = failure(listRow({ y: 456, height: 355 }, 440, 400));
    expect(message).toContain(
      'element is in the viewport but CLIPPED at top/bottom by its scroll view scrollable id:country_list (31,456 340x355): 89% of it is drawn, and the content is exhausted: ' +
        'swiping down no longer moves it, nor does swiping up. It is taller than what of its scroll view the screen shows: no scroll shows it whole. Last rect',
    );
    expect(message).not.toContain('layout defect');
  });

  it('cut at its top by its scroll view and at its bottom by the screen (a list from 456 to the screen\'s foot): each edge named with what cuts it, the part drawn quoted, no overlay diagnosed', () => {
    const message = failure(listRow({ y: 456, height: 418 }, 440, 500));
    expect(message).toContain(
      'element is in the viewport but CLIPPED at top by its scroll view scrollable id:country_list (31,456 340x418) and at bottom by the viewport: 84% of it is drawn, and the content is exhausted: ',
    );
    expect(message).toContain('It is taller than what of its scroll view the screen shows: no scroll shows it whole. Last rect');
    expect(message).not.toContain('no clearance for an overlay');
  });

  it('cut at its left by its scroll view and at its bottom by the screen (a row from x 20, the list from 31 running past the screen): the rest lies past those edges, its content beginning after it', () => {
    const message = failure(listRow({ y: 456, height: 600 }, 850, 43, 20, 340));
    expect(message).toContain('CLIPPED at left by its scroll view scrollable id:country_list (31,456 340x600) and at bottom by the viewport: ');
    expect(message).toContain(`The rest lies past those edges: ${EITHER}its content begins after the element does (no room before it — a layout defect). Last rect`);
  });

  it('cut at the screen\'s edge, its scroll view reaching it too: "CLIPPED at bottom, N% of it is in the viewport" and "cannot be fully revealed — that is a layout defect (no clearance for an overlay?)"', () => {
    const message = failure(listRow({ y: 456, height: 418 }, 850));
    expect(message).toContain('element is in the viewport but CLIPPED at bottom, 56% of it is in the viewport, and the content is exhausted');
    expect(message).toContain('The element cannot be fully revealed — that is a layout defect (no clearance for an overlay?)');
  });
});

describe('round — a sheet whose detent the swipes changed', () => {
  // A sheet's grabber says its detent in its value (`Sheet Grabber`, `Half screen` / `Expanded`): a stroke on a half
  // sheet's list at its top drags the sheet up before it scrolls the list.
  const sheet = (detent: string | undefined, y: number): Row => {
    const row = node({ role: 'button', identifier: 'row_7', rect: { x: 31, y, width: 340, height: 43 } });
    const grabber = detent === undefined ? [] : [node({ role: 'button', label: 'Sheet Grabber', value: detent, rect: { x: 152, y: 58, width: 98, height: 24 } })];
    return { tree: node({ role: 'container', rect: IPHONE_BOX, children: [...grabber, row] }), found: [row] };
  };
  const MOVED = '; the sheet moved from its Half screen detent to Expanded';

  it('a stop says the sheet moved from the detent the first read showed to the one the last read showed', () => {
    const reply = describeScrollResult(resultOf(play(IPHONE, [sheet('Half screen', 900), sheet('Expanded', 300), sheet('Expanded', 300)])));
    expect(reply).toBe(`fully visible after 1 swipe${MOVED}`);
  });

  it('a failure says it too, after the rest of its sentence — the verdict unchanged', () => {
    const message = failureOf(play(IPHONE, [sheet('Half screen', 5_000), sheet('Expanded', 4_990), sheet('Expanded', 4_980), sheet('Expanded', 4_970), sheet('Expanded', 4_960)]), 'id:row_7').message;
    expect(message).toMatch(/^scroll_until id:row_7 failed after 4 swipes \(maxSwipes\) — element in tree but never intersected the 402x874 viewport/);
    expect(message.endsWith(MOVED)).toBe(true);
  });

  it('a failure judged by absence keeps its class with the clause attached: a target no read held is ElementNotFoundError', () => {
    const empty = (detent: string): Row => ({ tree: node({ role: 'container', rect: IPHONE_BOX, children: [node({ role: 'button', label: 'Sheet Grabber', value: detent, rect: { x: 152, y: 58, width: 98, height: 24 } })] }), found: [] });
    const played = play(IPHONE, [empty('Half screen'), empty('Expanded'), empty('Expanded'), empty('Expanded')]);
    expect(played.outcome?.kind).toBe('bound');
    const error = failureOf(played, 'id:row_7');
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message.endsWith(MOVED)).toBe(true);
  });

  it('a detent the same at the first and last read is not mentioned, whatever it was between', () => {
    const reply = describeScrollResult(resultOf(play(IPHONE, [sheet('Half screen', 900), sheet('Expanded', 300), sheet('Half screen', 300)])));
    expect(reply).toBe('fully visible after 1 swipe');
  });

  it('two sheets stacked, the top one closed meanwhile: the lower sheet\'s grabber is last at the end — another sheet, not a detent change, so nothing is said', () => {
    const stacked = (detents: readonly string[], y: number): Row => {
      const row = node({ role: 'button', identifier: 'row_7', rect: { x: 31, y, width: 340, height: 43 } });
      const grabbers = detents.map((value) => node({ role: 'button', label: 'Sheet Grabber', value, rect: { x: 151, y: 58, width: 100, height: 24 } }));
      return { tree: node({ role: 'container', rect: IPHONE_BOX, children: [row, ...grabbers] }), found: [row] };
    };
    const played = play(IPHONE, [stacked(['Half screen', 'Expanded'], 900), stacked(['Half screen'], 300), stacked(['Half screen'], 300)]);
    expect(describeScrollResult(resultOf(played))).toBe('fully visible after 1 swipe');
  });

  it('a grabber only one of the two reads holds (a sheet presented or closed) says nothing of a detent', () => {
    expect(describeScrollResult(resultOf(play(IPHONE, [sheet('Half screen', 900), sheet(undefined, 300), sheet(undefined, 300)])))).toBe('fully visible after 1 swipe');
    expect(describeScrollResult(resultOf(play(IPHONE, [sheet(undefined, 900), sheet('Expanded', 300), sheet('Expanded', 300)])))).toBe('fully visible after 1 swipe');
  });
});

/**
 * VA1 (docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md): a row flush under a node
 * pinned in its own scroll view (ui-tree/later-edges.ts#PinnedEdge — the lab's merged sticky header) may be cut there,
 * as at a clipping container's edge, and a first row at rest whole under it dumps the same tree: the `fully: true` stop
 * answers it with the flush probe toward the header, and the probe's motion tells the two. Over the lab's real capture
 * (tests/fixtures/truth/android-averi_lab-api33/scroll-sticky-cut.xml: R `[128,457][953,567]`, 66 px under the header)
 * and the same dump with R whole, as the app lays it out at offset 0 (`[128,457][953,633]`: scroll-sticky-rest.xml).
 */
describe('round — a fully: true stop flush under a node pinned in its own scroll view (VA1)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { everyNode } = await import('../../src/adapters/types.js');
  const { parseDump } = await import('../helpers/android-dumps.js');
  const xml = await readFile(new URL('../fixtures/truth/android-averi_lab-api33/scroll-sticky-cut.xml', import.meta.url), 'utf8');
  const LIST: Rect = { x: 0, y: 303, width: 1080, height: 1238 };
  const HEADER = { role: 'container', identifier: 'lab.scroll-sticky-cut.header', rect: { x: 0, y: 303, width: 1080, height: 154 } };
  const FULLY_ANDROID: Rules = { ...ANDROID, fully: true };
  /** The read: the dump, R as dumped (`cut`) or whole at rest. */
  const read = (r: 'cut' | 'rest'): Row => {
    const tree = parseDump(r === 'cut' ? xml : xml.replaceAll('bounds="[128,457][953,567]"', 'bounds="[128,457][953,633]"'));
    return { tree, found: [[...everyNode(tree)].find((x) => x.identifier === 'lab.scroll-sticky-cut.R')!] };
  };
  const probes = (played: Played) => played.steps.filter((s) => s.do === 'stroke' && s.probe === true);

  it('VA1\'s capture: probed toward the header (content up, the finger down) from inside the list; R grows, flush again, probed again; the probe that moves nothing settles it — "fully visible after 2 swipes", naming the header', () => {
    const played = play(FULLY_ANDROID, [read('cut'), read('rest'), read('rest'), read('rest')]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stroke', 'stop']);
    for (const p of probes(played)) {
      expect(p).toMatchObject({ toward: 'up', probe: true });
      const box = (p as { box: Rect }).box;
      expect(box.y).toBeGreaterThanOrEqual(LIST.y);
      expect(box.y + box.height).toBeLessThanOrEqual(LIST.y + LIST.height);
    }
    expect(probes(played)).toHaveLength(2);
    const result = resultOf(played);
    expect(result.flush).toEqual({ edge: 'top', container: LIST, pinned: { ...HEADER, label: null }, checked: true });
    expect(describeScrollResult(result)).toBe(
      "fully visible after 2 swipes; its top edge lies on the edge of container id:lab.scroll-sticky-cut.header (0,303 1080x154), pinned at its scroll container's (0,303 1080x1238) top and drawn after it, " +
        'and a probe swipe toward it moved nothing — nothing of it is cut there',
    );
  });

  it('the first row at rest, whole under the header (the lab\'s scroll-sticky-rest as captured): one probe that moves nothing — "fully visible after 1 swipe" (the stated cost)', async () => {
    const tree = parseDump(await readFile(new URL('../fixtures/truth/android-averi_lab-api33/scroll-sticky-rest.xml', import.meta.url), 'utf8'));
    const rest: Row = { tree, found: [[...everyNode(tree)].find((x) => x.identifier === 'lab.scroll-sticky-rest.R')!] };
    const played = play(FULLY_ANDROID, [rest, rest]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(resultOf(played)).toMatchObject({ swipes: 1, flush: { edge: 'top', checked: true } });
  });

  it('no swipe left: unchecked for the budget, and the reply says Compose may have cut it at the pinned node', () => {
    const result = resultOf(play({ ...FULLY_ANDROID, maxSwipes: 0 }, [read('cut')]));
    expect(result.flush).toMatchObject({ edge: 'top', container: LIST, checked: false, why: 'budget' });
    expect(describeScrollResult(result)).toBe(
      "fully visible after 0 swipes; but its top edge lies on the edge of container id:lab.scroll-sticky-cut.header (0,303 1080x154), pinned at its scroll container's (0,303 1080x1238) top and drawn after it, " +
        "where Android cuts a node's bounds at a node drawn over it, and no swipe or time was left to check it — it may be cut there, a rect assert or screenshot may measure part of it",
    );
  });

  it('a row spanning from under the pinned header to the list\'s bottom edge — in the list itself or in one nested in an outer list — `fills` it: no probe, the reply naming both edges for what they lie on', () => {
    const header = '<node class="android.view.View" resource-id="header" bounds="[0,303][1080,457]"><node class="android.widget.TextView" text="Section" bounds="[400,347][681,413]" /></node>';
    const list = `<node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,303][1080,1541]"><node class="android.view.View" clickable="true" resource-id="row" bounds="[128,457][953,1541]" />${header}</node>`;
    const tall = (inner: string): Row => {
      const tree = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">${inner}</node></hierarchy>`);
      return { tree, found: [[...everyNode(tree)].find((x) => x.identifier === 'row')!] };
    };
    const nested = `<node class="android.view.View" scrollable="true" resource-id="outer" bounds="[0,0][1080,2220]">${list}</node>`;
    for (const shape of [list, nested]) {
      const played = play(FULLY_ANDROID, [tall(shape)]);
      expect(probes(played)).toEqual([]);
      const result = resultOf(played);
      expect(result.flush).toEqual({ edges: ['top', 'bottom'], container: LIST, pinned: { role: 'container', identifier: 'header', label: null, rect: { x: 0, y: 303, width: 1080, height: 154 } }, checked: false, why: 'fills' });
      expect(describeScrollResult(result)).toBe(
        'fully visible after 0 swipes; but it spans its scroll container (0,303 1080x1238) from the edge of container id:header (0,303 1080x154), pinned at the container\'s top and drawn after it, ' +
          "to the container's bottom edge — its top edge lies on that node's, its bottom edge on the container's, where Android cuts a node's bounds at a node drawn over it or to the container, " +
          'and no probe swipe can tell which side, if either, is cut — it may be cut there, a rect assert or screenshot may measure part of it; check with a screenshot',
      );
    }
  });

  /** A dump of `inner` on the lab AVD's screen, the node `id` found. */
  const shaped = (inner: string, id: string): Row => {
    const tree = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">${inner}</node></hierarchy>`);
    return { tree, found: [[...everyNode(tree)].find((x) => x.identifier === id)!] };
  };

  it('nested: a row flush under the header pinned in its own list, that list nested in an outer one, is probed toward the header in its own list — the nearest', () => {
    const row = shaped(
      `<node class="android.view.View" scrollable="true" resource-id="outer" bounds="[0,0][1080,2220]"><node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,303][1080,1541]"><node class="android.view.View" clickable="true" resource-id="row" bounds="[128,457][953,633]" /><node class="android.view.View" resource-id="header" bounds="[0,303][1080,457]"><node class="android.widget.TextView" text="Section" bounds="[400,347][681,413]" /></node></node></node>`,
      'row',
    );
    const played = play(FULLY_ANDROID, [row, row]);
    expect(probes(played)).toHaveLength(1);
    expect(probes(played)[0]).toMatchObject({ toward: 'up', probe: true });
    expect(resultOf(played).flush).toEqual({ edge: 'top', container: LIST, pinned: { role: 'container', identifier: 'header', label: null, rect: { x: 0, y: 303, width: 1080, height: 154 } }, checked: true });
  });

  it('nested the other way: a card of a carousel in the list, the header pinned in the LIST — not pinned (its scroll view is the carousel), but Compose cuts the carousel at the header alike, so the card fills its carousel: `fills`, no probe', () => {
    const card = shaped(
      `<node class="android.view.View" scrollable="true" resource-id="list" bounds="[0,303][1080,1541]"><node class="android.view.View" scrollable="true" resource-id="carousel" bounds="[0,457][1080,757]"><node class="android.view.View" clickable="true" resource-id="card" bounds="[100,457][500,757]" /></node><node class="android.view.View" resource-id="header" bounds="[0,303][1080,457]"><node class="android.widget.TextView" text="Section" bounds="[400,347][681,413]" /></node></node>`,
      'card',
    );
    const played = play(FULLY_ANDROID, [card]);
    expect(probes(played)).toEqual([]);
    expect(resultOf(played).flush).toEqual({ edges: ['top', 'bottom'], container: { x: 0, y: 457, width: 1080, height: 300 }, checked: false, why: 'fills' });
  });

  describe('sideways: a card flush right of a node pinned at its strip\'s left edge', () => {
    const STRIP: Rect = { x: 0, y: 300, width: 1080, height: 300 };
    const HEAD = { role: 'container', identifier: 'header', label: null, rect: { x: 0, y: 300, width: 240, height: 300 } };
    const card = (bounds: string): Row =>
      shaped(
        `<node class="android.view.View" scrollable="true" resource-id="strip" bounds="[0,300][1080,600]"><node class="android.view.View" clickable="true" resource-id="card" bounds="${bounds}" /><node class="android.view.View" resource-id="header" bounds="[0,300][240,600]"><node class="android.widget.TextView" text="A" bounds="[40,400][160,460]" /></node></node>`,
        'card',
      );

    it('is probed toward the node (content right, the finger right) from inside the strip; the probe that moves nothing settles it, naming the node', () => {
      const played = play({ ...FULLY_ANDROID, direction: 'right' }, [card('[240,300][540,600]'), card('[240,300][540,600]')]);
      expect(probes(played)).toHaveLength(1);
      const p = probes(played)[0] as { toward: string; box: Rect };
      expect(p.toward).toBe('left');
      expect(p.box.y).toBeGreaterThanOrEqual(STRIP.y);
      expect(p.box.y + p.box.height).toBeLessThanOrEqual(STRIP.y + STRIP.height);
      const result = resultOf(played);
      expect(result.flush).toEqual({ edge: 'left', container: STRIP, pinned: HEAD, checked: true });
      expect(describeScrollResult(result)).toContain(
        "its left edge lies on the edge of container id:header (0,300 240x300), pinned at its scroll container's (0,300 1080x300) left and drawn after it, and a probe swipe toward it moved nothing",
      );
    });

    it('spanning to the strip\'s right edge, it `fills` it: no probe, the reply naming the left edge on the node and the right on the strip', () => {
      const played = play({ ...FULLY_ANDROID, direction: 'right' }, [card('[240,300][1080,600]')]);
      expect(probes(played)).toEqual([]);
      const result = resultOf(played);
      expect(result.flush).toEqual({ edges: ['left', 'right'], container: STRIP, pinned: HEAD, checked: false, why: 'fills' });
      expect(describeScrollResult(result)).toContain(
        "but it spans its scroll container (0,300 1080x300) from the edge of container id:header (0,300 240x300), pinned at the container's left and drawn after it, " +
          "to the container's right edge — its left edge lies on that node's, its right edge on the container's",
      );
    });
  });

  it('only along the scroll: a sideways scroll asks no probe of a top edge pinned so', () => {
    expect(resultOf(play({ ...FULLY_ANDROID, direction: 'right' }, [read('cut')])).flush).toBeUndefined();
  });
});

describe('round — a read that lists none of the stroked scroll view\'s content (blank) is no evidence the stroke moved nothing (lab note LV1)', () => {
  /**
   * docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md, over the
   * real capture of the lab app's `tabbar-floating` at rest: `list` 0,550 1080x1670 lists T and R and nothing else;
   * F's content top is 5500 px, past a blank stretch. The live strokes moved the list 0→858→1714→2578→3437: after the
   * first T is gone and R is at 941, after the second R is gone too, and the third and fourth read the same empty list —
   * "failed after 4 swipes (the last 2 … did not change the screen)" while the list moved 860 px a stroke.
   */
  const CAPTURE = parseDump(readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/tabbar-floating.xml', import.meta.url), 'utf8'));
  const LAB_LIST: Rect = { x: 0, y: 550, width: 1080, height: 1670 };
  const F_ID = 'lab.tabbar-floating.F';
  const DEFAULTS: Rules = { direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: { width: 1080, height: 2220 } };
  const rowId = (n: UiNode): string | undefined => n.identifier?.replace('lab.tabbar-floating.', '');
  /** The capture with `list`'s children replaced by `content` (T and R at rest when undefined). */
  const listing = (content?: (rows: readonly UiNode[]) => UiNode[]): UiNode => {
    const walk = (n: UiNode): UiNode => (rowId(n) === 'list' && content !== undefined ? { ...n, children: content(n.children) } : { ...n, children: n.children.map(walk) });
    return walk(CAPTURE);
  };
  const read = (tree: UiNode): Row => ({ tree, found: [...everyNode(tree)].filter((n) => n.identifier === F_ID) });
  const AT_REST = read(listing());
  const R_ONLY = read(listing((rows) => rows.filter((r) => rowId(r) === 'R').map((r) => ({ ...r, rect: { ...r.rect, y: 941 } }))));
  const BLANK = read(listing(() => []));
  const F_IN = read(listing((rows) => rows.filter((r) => rowId(r) === 'R').map((r) => ({ ...r, identifier: F_ID, label: 'Target F', rect: { x: 66, y: 1760, width: 948, height: 143 } }))));
  const touchDowns = (played: Played) => played.steps.flatMap((s) => (s.do === 'stroke' ? [drawnFor(s).from] : []));
  const NEVER = 'element never appeared in the tree (the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first)';
  const UNSEEN = (n: number) =>
    `after the last ${n} swipes over the scroll container 0,550 1080x1670 the tree listed none of its content where a swipe's motion would show (blank space, content with no node, or a node cut at both of the container's edges), so how far they moved it is unknown — the element may lie further down: raise maxSwipes or timeoutMs`;

  it('the live sequence: two blank reads in a row do not end the scroll — F comes in on the fifth stroke, "visible after 5 swipes", every stroke inside the list clear of the tab bar', () => {
    const played = play(DEFAULTS, [AT_REST, R_ONLY, BLANK, BLANK, BLANK, F_IN, F_IN]);
    expect(played.outcome).toMatchObject({ kind: 'visible' });
    expect(describeScrollResult(resultOf(played))).toMatch(/visible after 5 swipes/);
    expect(touchDowns(played)).toEqual(Array(5).fill({ x: 540, y: 1598 }));
  });

  it('blank to the bound: maxSwipes, all 6 strokes sent, and the failure says the blank strokes may have moved it — never "did not change the screen"', () => {
    const played = play(DEFAULTS, [AT_REST, R_ONLY, BLANK, BLANK, BLANK, BLANK, BLANK]);
    expect(touchDowns(played)).toHaveLength(6);
    const error = failureOf(played, `id:"${F_ID}"`);
    expect(error.message).toBe(`scroll_until id:"${F_ID}" failed after 6 swipes (maxSwipes) — ${NEVER}; ${UNSEEN(5)}`);
  });

  it('blank at the deadline: the timeout\'s words, then the same clause', () => {
    const rows = [AT_REST, R_ONLY, BLANK, BLANK, { ...BLANK, elapsedMs: 15_400 }];
    const error = failureOf(play(DEFAULTS, rows), `id:"${F_ID}"`);
    expect(error.message).toMatch(/^scroll_until id:"lab\.tabbar-floating\.F" failed after 15400ms \(timeout 15000ms; 4 swipes sent; /);
    expect(error.message).toContain(`— ${NEVER}; ${UNSEEN(3)}`);
  });

  it('a blank read resets the streak: listed and unchanged once, then blank, then listed and unchanged once again — two unchanged reads, never two in a row: no exhaustion', () => {
    const played = play(DEFAULTS, [AT_REST, R_ONLY, R_ONLY, BLANK, R_ONLY, R_ONLY, BLANK]);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
  });

  it('a read that lists the content unchanged after a blank stretch still needs its own two strokes: blank, then R twice unchanged — exhausted after the second', () => {
    const played = play(DEFAULTS, [AT_REST, BLANK, BLANK, R_ONLY, R_ONLY, R_ONLY]);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree' } });
    expect(touchDowns(played)).toHaveLength(5);
  });

  it('pinned: content listed and unchanged still ends the scroll after 2 strokes (row_40\'s shape, on the real list) — "did not change the screen", no clause', () => {
    const error = failureOf(play(DEFAULTS, [AT_REST, R_ONLY, R_ONLY, R_ONLY]), `id:"${F_ID}"`);
    expect(error.message).toBe(
      `scroll_until id:"${F_ID}" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — ${NEVER} — if it lies above, try direction: "up"`,
    );
  });

  it('pinned: a blank list with a progress node shown runs to the bound as either would alone', () => {
    const row: Row = { found: [], mainScroller: LAB_LIST, mainContent: [], loading: true };
    expect(play(DEFAULTS, Array(7).fill(row)).outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
  });

  /** A uiautomator dump: `outer` (a scroll view at 0,200 1080x1800) holding `inner` of its very rect, if any, holding `rows`. */
  const tabDump = (outer: string, inner: string | undefined, rows: readonly [number, number, string][]): UiNode => {
    const attrs = (cls: string, b: string, scrollable: boolean, text = '', id = '') =>
      `index="0" text="${text}" resource-id="${id}" class="${cls}" package="x" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="${scrollable}" long-clickable="false" password="false" selected="false" bounds="${b}"`;
    const listed = rows.map(([y0, y1, label]) => `<node ${attrs('android.widget.TextView', `[0,${y0}][1080,${y1}]`, false, label, label === 'F' ? 'tgt' : '')} />`).join('');
    return parseDump(
      `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node ${attrs('android.widget.FrameLayout', '[0,0][1080,2220]', false)}>` +
        `<node ${attrs(outer, '[0,200][1080,2000]', true)}>` +
        (inner === undefined ? listed : `<node ${attrs(inner, '[0,200][1080,2000]', true)}>${listed}</node>`) +
        `</node></node></hierarchy>`,
    );
  };
  const tabRead = (tree: UiNode): Row => ({ tree, found: [...everyNode(tree)].filter((n) => n.identifier === 'tgt') });

  it('a ViewPager (horizontal by its class) over a vertical RecyclerView of its rect: the list\'s blank stretch is no evidence either — F comes in on the fifth stroke', () => {
    const pager = (rows: readonly [number, number, string][]) => tabRead(tabDump('androidx.viewpager.widget.ViewPager', 'androidx.recyclerview.widget.RecyclerView', rows));
    const played = play(DEFAULTS, [pager([[300, 500, 'A'], [900, 1100, 'B']]), pager([[250, 450, 'B']]), pager([]), pager([]), pager([]), pager([[1500, 1700, 'F']]), pager([[1500, 1700, 'F']])]);
    expect(played.outcome).toMatchObject({ kind: 'visible' });
    expect(describeScrollResult(resultOf(played))).toMatch(/visible after 5 swipes/);
  });

  it('a stroke across a vertical list of full-width rows (direction right): the rows show no sideways motion, yet the list scrolls on y alone — two unchanged reads end it, as before', () => {
    const list = tabRead(tabDump('android.widget.ScrollView', undefined, [[300, 500, 'A'], [900, 1100, 'B']]));
    const played = play({ ...DEFAULTS, direction: 'right' }, [list, list, list]);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree' } });
    expect(touchDowns(played)).toHaveLength(2);
  });

  it('the real form-picker list (14 full-width rows, its axis unnamed by its class), stroked sideways: the rows show no x motion, yet they are its content — two unchanged reads end it, as before', () => {
    const tree = parseDump(readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/form-picker.xml', import.meta.url), 'utf8'));
    for (const direction of ['right', 'left'] as const) {
      const played = play({ ...DEFAULTS, direction }, [read(tree), read(tree), read(tree)]);
      expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree' } });
      expect(touchDowns(played)).toHaveLength(2);
    }
  });

  it('the blank count is of strokes over ONE scroll view: both lists blank, the strokes go over the larger — when the other grows larger and takes them, the clause counts its strokes alone and names it', () => {
    const A: Rect = { x: 0, y: 200, width: 1080, height: 900 };
    const B = (height: number): Rect => ({ x: 0, y: 1150, width: 1080, height });
    const screen = (bHeight: number): Row => ({
      found: [],
      tree: node({
        role: 'container',
        rect: { x: 0, y: 0, width: 1080, height: 2220 },
        children: [node({ role: 'scrollable', rect: A, clipsDescendants: true }), node({ role: 'scrollable', rect: B(bHeight), clipsDescendants: true })],
      }),
    });
    const played = play(DEFAULTS, [screen(400), screen(400), screen(400), screen(400), screen(1000), screen(1000), screen(1000)]);
    expect(touchDowns(played).map((p) => (containsPoint(A, p) ? 'A' : 'B'))).toEqual(['A', 'A', 'A', 'A', 'B', 'B']);
    const error = failureOf(played, `id:"${F_ID}"`);
    expect(error.message).toContain('; after the last 2 swipes over the scroll container 0,1150 1080x1000 the tree listed none of its content');
  });

  it('pinned: idb\'s flat list lists no scroll view — nothing to call blank — so an unchanged tree still ends it after 2', () => {
    const flat = (rest: string): Row => ({ found: [], rest, flatList: true });
    const played = play({ ...DEFAULTS, screen: { width: 402, height: 874 } }, [flat('a'), flat('b'), flat('b'), flat('b')]);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree' } });
  });
});

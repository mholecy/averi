import { describe, expect, it, vi } from 'vitest';
import { type KeyboardWitness, type Point, type Rect, type SoftKeyboard, type UiNode } from '../../src/adapters/types.js';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { bandNode, el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';
import { flingCarry, LazyList } from '../helpers/lazy-list.js';

/** The driver's settle pause, observed (passed through to the real sleep): a test sets `onSleep` to see each pause in order with the device's calls. */
const pauses = vi.hoisted(() => ({ onSleep: undefined as ((ms: number) => void) | undefined }));
vi.mock('../../src/util/sleep.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/util/sleep.js')>();
  return {
    sleep: async (ms: number) => {
      pauses.onSleep?.(ms);
      return real.sleep(ms);
    },
  };
});

/**
 * `scroll_until` at the DRIVER (interact/scroll.ts#scrollUntilVisible), on a
 * FakeAdapter: what only a device can show — the stroke's points, the adb
 * queries a round costs, a read failure quoted end to end, the error
 * classes, the deadline passing during a stroke, the round bound counted in
 * tree reads. The round's rules — the judgement, the witness's ordering, the
 * confirming reads, the turn, stuck and exhausted, every failure's wording —
 * are observation tables in tests/interact/scroll-rounds.test.ts since
 * 2026-10-09 (the scroll-rounds deepening).
 */

const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };

/** Fake whose target starts below the fold and moves up per swipe (viewport 1000x2000). */
function scrollingFake(startY: number, perSwipe = 600, height = 40) {
  resetLayout();
  const target = node({ role: 'button', identifier: 'submit_button', rect: { x: 0, y: startY, width: 100, height } });
  const form = screen(el({ identifier: 'form_root' }), target);
  class ScrollingFake extends FakeAdapter {
    override async swipe(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
      await super.swipe(from, to);
      target.rect = { ...target.rect, y: target.rect.y - perSwipe };
    }
  }
  return new ScrollingFake({ form }, 'form');
}

describe('scrollUntilVisible — the result says what the scroll achieved', () => {
  it('the default budget is the 15 s the scroll_until tool documents, named once', () => {
    expect(DEFAULT_SCROLL_TIMEOUT_MS).toBe(15_000);
  });

  it('swipes until the element intersects the viewport; content below → finger moves up', async () => {
    const fake = scrollingFake(3100); // needs 2 swipes to get under y=2000
    const result = await scrollUntilVisible(fake, { id: 'submit_button' }, FAST);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(fake.swipes).toHaveLength(2);
    expect(fake.swipes[0].to.y).toBeLessThan(fake.swipes[0].from.y);
    expect(describeScrollResult(result)).toBe('fully visible after 2 swipes');
  });

  it('0 swipes when already visible, and the selector-string vocabulary resolves the same way', async () => {
    const result = await scrollUntilVisible(scrollingFake(500), 'id:submit_button', FAST);
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes');
  });

  it('a target under a pinned bar laid after it is not "fully visible": the driver swipes it out from under the bar (2026-10-09, the SWIFT form\'s CONTINUE)', async () => {
    // y 1960, 40 tall, under a bar at 1950–2000 drawn after the form: one swipe (600 up) clears it.
    const fake = scrollingFake(1960);
    fake.live().children.push(node({ role: 'button', label: 'Continue', identifier: 'continue', rect: { x: 0, y: 1950, width: 1000, height: 50 } }));
    const result = await scrollUntilVisible(fake, { id: 'submit_button' }, { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(fake.swipes).toHaveLength(1);
  });

  it('reports the CLIPPED fraction and edges instead of a bare "visible" (the 2026-08-27 finding)', async () => {
    // 40px tall, stopping at y=1970 → a quarter of it below the fold, its centre (1990) still on screen — a plain stop
    // needs that since code review P3 (at y=1980 the centre lies on the edge, off screen, and the scroll goes on).
    const result = await scrollUntilVisible(scrollingFake(2570), { id: 'submit_button' }, FAST);
    expect(result).toEqual({ swipes: 1, visible: 0.75, clipped: ['bottom'] });
    expect(describeScrollResult(result)).toBe(
      'visible after 1 swipe — CLIPPED at bottom, 75% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box',
    );
  });

  it('reports the read failure instead of "element never appeared" — and that is not ElementNotFoundError', async () => {
    const fake = scrollingFake(500);
    fake.uiTree = async () => {
      throw new Error('uiautomator dump returned no XML');
    };
    const error = await scrollUntilVisible(fake, 'id:below_fold', { maxSwipes: 2, timeoutMs: 100, settleMs: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/last UI tree read failed: uiautomator dump returned no XML/);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });
});

/**
 * 2026-10-08: the one stop that is absence is interact's ElementNotFoundError, so
 * an `optional:` scroll_until to an element not on this screen reads "(not
 * present)"; every stop where the element was seen stays a plain Error.
 */
describe('scrollUntilVisible — which stops are ElementNotFoundError', () => {
  it('no read at any swipe held a match: ElementNotFoundError, worded "element never appeared in the tree"', async () => {
    const error = await scrollUntilVisible(scrollingFake(500), 'id:nope', FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe('scroll_until id:nope failed after 4 swipes (maxSwipes) — element never appeared in the tree');
  });

  it('in the tree but never in the viewport: a plain Error — it was there', async () => {
    const error = await scrollUntilVisible(scrollingFake(50_000, 10), 'id:submit_button', FAST).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/element in tree but never intersected/);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('matched on an early read and gone by the last: a plain Error, never ElementNotFoundError', async () => {
    resetLayout();
    const offscreen = screen(node({ role: 'button', identifier: 'row', rect: { x: 0, y: 50_000, width: 100, height: 40 } }));
    const empty = screen();
    let reads = 0;
    class LeavingFake extends FakeAdapter {
      override async uiTree() {
        return structuredClone(reads++ === 0 ? offscreen : empty);
      }
    }
    const error = await scrollUntilVisible(new LeavingFake({ offscreen }, 'offscreen'), 'id:row', FAST).catch((e: unknown) => e);
    expect(reads).toBeGreaterThan(1);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });
});

/**
 * 2026-10-08 (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md):
 * the stop is judged, and the stroke drawn, in the screen ABOVE a shown soft
 * keyboard — read each round the way the tap guard and the pixel poll read it
 * (a reading, `readKeyboard`: the oracle on Android, the WDA band on iOS).
 */
describe('scrollUntilVisible — the soft keyboard', () => {
  /** The measured Android screen and IME (Pixel_3a, 1080x2220): `InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220]`. */
  const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };

  /**
   * A form whose content moves `perSwipe` up per content-down stroke — but
   * only a stroke that STARTS above `keyboardTop`: one that starts on a key
   * scrolls nothing, as measured (the content stayed at its offset, 15 s).
   */
  function formFake({ width, height, startY, rowHeight, perSwipe = 600, keyboardTop }: { width: number; height: number; startY: number; rowHeight: number; perSwipe?: number; keyboardTop?: number }) {
    resetLayout();
    const target = node({ role: 'button', identifier: 'priority_select', rect: { x: 66, y: startY, width: Math.min(948, width - 66), height: rowHeight } });
    const form = node({ role: 'container', rect: { x: 0, y: 0, width, height }, children: [target] });
    class FormFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        if (keyboardTop !== undefined && from.y >= keyboardTop) return; // the stroke began on the keyboard
        target.rect = { ...target.rect, y: target.rect.y - perSwipe };
      }
    }
    return { fake: new FormFake({ form }, 'form'), target };
  }

  const androidForm = (opts: { startY: number; perSwipe?: number; witness?: KeyboardWitness; window?: SoftKeyboard; keyboardTop?: number }) => {
    const made = formFake({ width: 1080, height: 2220, rowHeight: 73, keyboardTop: IME.y, ...opts });
    made.fake.attachKeyboard(opts.window ?? { state: 'shown', frame: IME }, opts.witness ?? 'shown');
    return made;
  };

  it('Android, symptom 2: with the IME up the content-down stroke starts ABOVE it, so it scrolls — the old stroke started at y 1776, on a key', async () => {
    const { fake } = androidForm({ startY: 2900 });
    const result = await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(result.swipes).toBe(3);
    for (const { from, to } of fake.swipes) {
      expect(from.y).toBeLessThan(IME.y);
      expect(to.y).toBeLessThan(from.y); // content below → finger up
    }
    // The same swipeVector over the box above the IME: centre 699, reach 0.3 × 1398 (swipeVectorAbove keeps a content-down stroke as is).
    expect(fake.swipes[0]).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } });
  });

  it('Android cost: ONE window query per round, the witness asked on each round the band matters — never remembered — and none on the moot stop; no key pressed', async () => {
    const { fake } = androidForm({ startY: 2900 });
    await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(5); // 3 swipes, 4 reads, and the read confirming the stop held still
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(3); // y 2900, 2300, 1700 matter; y 1100 (twice) is a moot clean stop
    expect(fake.keys).toEqual([]);
  });

  /**
   * The round's witness rules are observation tables in scroll-rounds.test.ts
   * (as `asks`); these are the same scenarios at the DRIVER, counted as the
   * fake oracle saw them — the queries a device would answer, which is what
   * the keyboard reading's cost table promises (ui-tree/keyboard-cover.ts).
   * They stood here as single assertions until the scroll-rounds deepening
   * (2026-10-09) moved them to the pure table; code review P2 put the
   * device-side count back beside it. `[window, touchable, witness]`.
   */
  it.each([
    ['a band that changes nothing (a clean stop clear above it): no witness', { startY: 500 }, [], {}, [1, 1, 0]],
    ['a STALE window vetoed on a fully: true stop: asked once, nothing stroked', { startY: 1906, witness: 'hidden' }, [], { fully: true }, [1, 1, 1]],
    ['a vetoed band every round: asked again on each round it matters, never kept', { startY: 2900, witness: 'hidden', keyboardTop: undefined }, [], {}, [4, 4, 4]],
    ['a denial, then a real keyboard: asked again, confirmed', { startY: 2506, keyboardTop: undefined }, ['hidden', 'shown'], { fully: true }, [4, 4, 2]],
    ['a keyboard the scroll hides, the window left stale-shown: asked again, denied, and again at the confirming read', { startY: 2900, keyboardTop: undefined }, ['shown', 'hidden'], { fully: true }, [4, 4, 4]],
    ['the `unlocated` row on a DEFAULT clean stop: not asked', { startY: 500, window: { state: 'hidden' } as SoftKeyboard, witness: 'shown' as const }, [], {}, [1, 0, 0]],
  ] as const)('Android device queries at the driver — %s', async (_name, form, witnessQueue, opts, counts) => {
    const { fake } = androidForm(form);
    if (witnessQueue.length > 0) fake.attachedKeyboard.witnessAnswers.queue = [...witnessQueue];
    await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, ...opts });
    const k = fake.attachedKeyboard;
    expect([k.windowAnswers.queries, k.touchableAnswers.queries, k.witnessAnswers.queries]).toEqual(counts);
  });

  it('a round whose tree did not read strokes in the box the last read round\'s band left: its touch-down above the IME, the band\'s stroke point for point', async () => {
    const { fake } = androidForm({ startY: 2900 });
    const real = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async () => {
      if (reads++ === 1) throw new Error('uiautomator dump returned no XML');
      return real();
    };
    await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.swipes[1]).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } }); // round 1, unread: round 0's band, not the whole screen's 1776
  });

  it('a witness that answers after the deadline counts against it: the clock is read again after the witness, so the stop it decides is reported unsettled, not confirmed past the deadline', async () => {
    const { fake } = androidForm({ startY: 1960 }); // under the IME → one stroke above it → 1360–1433, clipped at the band
    const keyboard = fake.attachedKeyboard;
    const witness = keyboard.witness.bind(keyboard);
    // The scroll's clock, stepped by hand: it stands still but for the stop round's witness, which takes 150 ms of a 100 ms budget.
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let asked = 0;
    keyboard.witness = async () => {
      if (asked++ === 1) now += 150;
      return witness();
    };
    let result;
    try {
      result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, timeoutMs: 100 });
    } finally {
      clock.mockRestore();
    }
    expect(result).toMatchObject({ swipes: 1, clipped: ['bottom'], keyboard: { state: 'shown', frame: IME }, settled: false });
    expect(keyboard.windowAnswers.queries).toBe(2); // the stroke's round and the stop's: no confirming read
  });

  it('a band whose top lies at the screen\'s bottom edge covers nothing on it: judged as no keyboard, not asked about', async () => {
    const offscreen = { state: 'shown', frame: { x: 0, y: 2220, width: 1080, height: 100 } } as const;
    const { fake } = androidForm({ startY: 2100, window: offscreen });
    expect(await scrollUntilVisible(fake, 'id:priority_select', FAST)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    // …and on a round that strokes too: whole-screen, still no witness query.
    const scrolled = androidForm({ startY: 2900, window: offscreen, keyboardTop: undefined }).fake;
    await scrollUntilVisible(scrolled, 'id:priority_select', FAST);
    expect(scrolled.swipes[0]).toEqual({ from: { x: 540, y: 1776 }, to: { x: 540, y: 444 } });
    expect(scrolled.attachedKeyboard.witnessAnswers.queries).toBe(0);
  });

  it.each([
    ['hidden, witness hidden', { state: 'hidden' } as SoftKeyboard, 'hidden' as const, 1],
    ['unknown (fail open, the witness not asked)', { state: 'unknown' } as SoftKeyboard, 'shown' as const, 0],
  ])('Android, window %s: judged and swiped over the whole screen, the result as before', async (_name, window, witness, witnessQueries) => {
    const { fake } = androidForm({ startY: 1906, window, witness });
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(witnessQueries);
  });

  it('window hidden, input method shown — the `unlocated` row: on a fully: true stop the result says the keyboard could not be placed, asked ONCE, and the line is not a clean "fully visible"', async () => {
    // Where an unlocated keyboard lies is unmeasured: here it eats no stroke.
    const { fake } = androidForm({ startY: 2900, window: { state: 'hidden' }, witness: 'shown', keyboardTop: undefined });
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [], keyboard: { state: 'unlocated' } }); // judged over the whole screen: there is no frame to exclude
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(1);
    expect(describeScrollResult(result)).toBe(
      'fully visible after 2 swipes; the input method reports a soft keyboard shown, but the window state gives it no area on ' +
        'screen (one still coming up? not measured), so where it lies is unknown — it was not judged and may cover the element',
    );
    expect(fake.keys).toEqual([]);
  });
});

/**
 * 2026-10-08, the two "Device check" sections of
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md and
 * review round 1, at the driver: the stroke over a keyboard, the turned and
 * shortened strokes' points, the convergence a fling's physics needs the
 * real stroke lengths for, and the deadline passing during a stroke (the
 * rules behind them: tests/interact/scroll-rounds.test.ts).
 */
describe('scrollUntilVisible — after the device check', () => {
  /** The measured WDA pad on the iPhone 17 (402x874 pt): `role:keyboard 0 572 402 302`. */
  const WDA_BAND: Rect = { x: 0, y: 572, width: 402, height: 302 };
  /** The app's top bar under WDA (status bar + nav bar, title at y 73–95, ending ≈ y 116): a stroke touching down in it is ignored. */
  const TOP_BAR_BOTTOM = 116;

  /**
   * The SwiftUI form under WDA with the pad up. A stroke that touches down
   * in the top bar or on the pad moves nothing; any other moves the content
   * by the finger's travel — or, when `fling` is given, the reads after it
   * see the y values it lists (one per read, the last one standing; `null`:
   * gone from the tree, as a lazy list drops a row): a fling the settle
   * read catches mid-way.
   */
  function wdaForm(startY: number, fling?: (rect: Rect, travel: number) => (number | null)[], height = 52) {
    resetLayout();
    const target = node({ role: 'button', identifier: 'row', rect: { x: 24, y: startY, width: 354, height } });
    const root = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [target, bandNode(WDA_BAND)] });
    let queued: (number | null)[] = [];
    class WdaFake extends FakeAdapter {
      reads = 0;
      /** Called inside each swipe — a test's clock. */
      onSwipe: () => Promise<void> = async () => {};
      override async uiTree() {
        this.reads++;
        const next = queued.shift();
        if (next === null) root.children = root.children.filter((c) => c !== target);
        else if (next !== undefined) target.rect = { ...target.rect, y: next };
        return super.uiTree();
      }
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        await this.onSwipe();
        if (from.y < TOP_BAR_BOTTOM || from.y >= WDA_BAND.y) return;
        const travel = to.y - from.y;
        if (fling === undefined) target.rect = { ...target.rect, y: target.rect.y + travel };
        else queued = fling({ ...target.rect }, travel);
      }
    }
    const fake = new WdaFake({ s: root }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.keyboardAdvice = 'ADVICE';
    return fake;
  }

  it('iOS (WDA): with the pad up a content-UP scroll touches down below the top bar (y 175) and moves the content — the stroke over the box above the pad touched down at y 114 and moved nothing', async () => {
    const fake = wdaForm(-586); // the measured debit_select, from a scrolled form
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, direction: 'up', fully: true });
    expect(result).toEqual({ swipes: 3, visible: 1, clipped: [] }); // -586 → -303 → -20 → 263
    expect(fake.swipes[0]).toEqual({ from: { x: 201, y: 175 }, to: { x: 201, y: 458 } });
  });

  /**
   * The measured content-down fling under WDA: the 344-pt stroke moved the form 729–970 pt. A content-up
   * fling with the pad up is unmeasured. Each stroke moves the content `perPoint` times its travel.
   */
  const flinging = (downPerPoint: number, upPerPoint: number) => (rect: Rect, travel: number) => [
    Math.round(rect.y + travel * (travel < 0 ? downPerPoint : upPerPoint)),
  ];

  it.each([
    // Symmetric: 729 pt each way for a full stroke (344 pt down, 283 pt up). Full strokes both ways ping-pong 681 ↔ -48 to maxSwipes.
    ['symmetric 729/729', 729 / 344, 729 / 283, 2],
    // The reviewer's 681 / −729 down, 650 up: full strokes reach it only on the 6th swipe.
    ['681/−729 down, 650 up', 729 / 344, 650 / 283, 2],
  ])('convergence (review round 2), %s: the turned stroke is halved, so the distance left shrinks whatever the app flings', async (_name, down, up, swipes) => {
    const fake = wdaForm(681, flinging(down, up));
    const result = await scrollUntilVisible(fake, 'id:row', { fully: true, settleMs: 1, maxSwipes: 6 });
    expect(result).toEqual({ swipes, visible: 1, clipped: [] });
  });

  it('every turn halves the reach again: a fling that overshoots back the other way too still converges', async () => {
    // Down 2.12× (681 → -48); up 4.5×: the half stroke (142 pt) throws it back under the pad (591); the next turn, a quarter
    // (86 pt), lands it at 409.
    const fake = wdaForm(681, flinging(729 / 344, 4.5));
    expect(await scrollUntilVisible(fake, 'id:row', { fully: true, settleMs: 1, maxSwipes: 6 })).toEqual({ swipes: 3, visible: 1, clipped: [] });
    expect(fake.swipes.map((s) => Math.abs(s.to.y - s.from.y))).toEqual([344, 142, 86]);
    expect(fake.swipes.map((s) => s.from.y)).toEqual([458, 175, 458]); // touch-downs where swipeVectorAbove put them
  });

  it.each([
    // Sideways: 648 full, then each direction change halves — 324, 162, 81, then 40.5 → the floor, 3 % of the WIDTH (32) under the slop's 48.
    ['right', 'x', [648, 324, 162, 81, 48]],
    // Up/down: 1332 full, 666, 333, 167, then 83 → 42 → the floor, 3 % of the HEIGHT 2220 (67) over the slop's 48.
    ['down', 'y', [1332, 666, 333, 167, 83, 67]],
  ] as const)('the stroke floor is a fraction of the box\'s side ALONG the stroke (1080x2220, content %s)', async (direction, axis, reaches) => {
    resetLayout();
    const far = axis === 'x' ? { x: -500, y: 500 } : { x: 100, y: -500 }; // beyond the far edge
    const near = axis === 'x' ? { x: 1500, y: 500 } : { x: 100, y: 3000 }; // short of it
    const target = node({ role: 'button', identifier: 'card', rect: { ...near, width: 300, height: 100 } });
    class PingPong extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        const at = target.rect[axis] === near[axis] ? far : near; // every stroke flings it past the frame
        target.rect = { ...target.rect, ...at };
      }
    }
    const fake = new PingPong({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [target] }) }, 's');
    await scrollUntilVisible(fake, 'id:card', { ...FAST, direction, maxSwipes: reaches.length }).catch(() => undefined);
    expect(fake.swipes.map((s) => Math.abs(s.to[axis] - s.from[axis]))).toEqual(reaches);
  });

  it('a stop reached at the deadline is reported unconfirmed — no confirming read past it', async () => {
    const fake = wdaForm(681, () => [300, 300]);
    fake.onSwipe = () => new Promise((r) => setTimeout(r, 60)); // the deadline passes during the stroke
    const result = await scrollUntilVisible(fake, 'id:row', { fully: true, settleMs: 1, timeoutMs: 30 });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    expect(fake.reads).toBe(2);
  });

  it('every stroke and every confirming read is followed by the settle pause before the next read', async () => {
    const fake = wdaForm(681, () => [300, 300]);
    const events: string[] = [];
    const read = fake.uiTree.bind(fake);
    const swipe = fake.swipe.bind(fake);
    fake.uiTree = async () => (events.push('read'), read());
    fake.swipe = async (from, to) => (events.push('swipe'), swipe(from, to));
    pauses.onSleep = (ms) => events.push(`sleep:${ms}`);
    try {
      expect(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true, settleMs: 7 })).toEqual({ swipes: 1, visible: 1, clipped: [] });
    } finally {
      pauses.onSleep = undefined;
    }
    expect(events).toEqual(['read', 'swipe', 'sleep:7', 'read', 'sleep:7', 'read']); // the stroke's round, the stop at 300, its confirmation
  });
});

describe('scrollUntilVisible — the round bound (code review of round 2, 2026-10-08)', () => {
  it('at the defaults the rounds number at most 1 + (1 + SETTLE_CONFIRM_READS) × maxSwipes = 25: a target that leaves the frame every fourth read after a stroke', async () => {
    resetLayout();
    const target = node({ role: 'button', identifier: 't', rect: { x: 0, y: 3000, width: 100, height: 40 } });
    const s = screen(el({ identifier: 'root' }), target);
    let reads = 0;
    let afterStroke = 0;
    class Restless extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        reads++;
        // Round 0 below the fold; after any stroke, three reads in the frame
        // each at a new y (a stop that never confirms), then one off it.
        if (this.swipes.length > 0) {
          const i = afterStroke++;
          target.rect = { ...target.rect, y: i % 4 === 3 ? 3000 : 100 + i * 10 };
        }
        return super.uiTree();
      }
    }
    const fake = new Restless({ s }, 's');
    const error = await scrollUntilVisible(fake, 'id:t', { settleMs: 0 }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('failed after 6 swipes (maxSwipes)');
    expect(fake.swipes).toHaveLength(6);
    expect(reads).toBe(25);
  });
});

describe('scrollUntilVisible — a fully: true stop flush with its clipping scroll container (Android, 2026-10-09)', () => {
  /** The SWIFT form: container [0,242][1080,1978] between the top bar and CONTINUE, 143-px rows; Fees third. */
  const FORM: Rect = { x: 0, y: 242, width: 1080, height: 1736 };
  const formLabels = ['Beneficiary', 'Amount', 'Fees', 'Priority', 'Reference', 'Note', 'IBAN', 'BIC', 'Bank', 'Address', 'City', 'Country', 'Purpose', 'Charges', 'Date'];
  /** Settings home: list [0,737][1080,2154], 198-px rows, a header above it. */
  const SETTINGS: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
  const settingsLabels = ['Network', 'Devices', 'Apps', 'Notifications', 'Battery', 'Storage', 'Sound', 'Modes', 'Display', 'Wallpaper', 'Accessibility', 'Security'];

  it('the measured Fees row cut by the top bar (read {y:242, height:92}) is not "fully visible after 0 swipes": a probe toward its top, drawn inside the form, reveals it whole', async () => {
    const fake = new LazyList(formLabels, 143, FORM, { offset: 2 * 143 + 51 }); // Fees 51 px under the bar
    const result = await scrollUntilVisible(fake, 'text:"Fees"', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    const [probe] = fake.swipes;
    expect(probe.to.y).toBeGreaterThan(probe.from.y); // the finger moves DOWN — content up, toward the cut — though the caller's direction is down
    expect(probe.from.y).toBeGreaterThanOrEqual(242); // touched down on the form, not the bar
    // A quarter of the form's 1042-px stroke, 261 px, capped at 0.08 of the 2220-px side (PROBE_MAX_TRAVEL_FRACTION): 177.
    expect(probe).toEqual({ from: { x: 540, y: 589 }, to: { x: 540, y: 766 } });
    expect(fake.rowRect('Fees')).toEqual({ x: 0, y: 368, width: 1080, height: 143 });
  });

  it('a row at the fold of Settings\' list (no chrome below it, read 31 px of 198): probed toward the bottom and revealed', async () => {
    const fake = new LazyList(settingsLabels, 198, SETTINGS); // Modes at 2123, cut at 2154
    const result = await scrollUntilVisible(fake, 'text:"Modes"', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(fake.swipes[0].to.y).toBeLessThan(fake.swipes[0].from.y);
  });

  it('a row cut by Settings\' header, at the top of the content: the probe touches down INSIDE the list (the screen box\'s would land on the header at y 444 and move nothing), reveals it, and the second probe — at the content\'s start — moves nothing and is accepted', async () => {
    const fake = new LazyList(settingsLabels, 198, SETTINGS, { offset: 100 }); // Network at 637, read 737–835
    const result = await scrollUntilVisible(fake, 'text:"Network"', { ...FAST, fully: true });
    expect(fake.swipes.map((s) => s.from.y)).toEqual([1021, 1021]);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [], flush: { edge: 'top', container: SETTINGS, checked: true } });
    expect(fake.rowRect('Network').height).toBe(198);
  });

  it('the first row at rest: one probe that moves nothing — the stated cost — then "fully visible after 1 swipe", saying why', async () => {
    const fake = new LazyList(formLabels, 143, FORM);
    const result = await scrollUntilVisible(fake, 'text:"Beneficiary"', { ...FAST, fully: true });
    expect(fake.swipes).toHaveLength(1);
    expect(describeScrollResult(result)).toBe(
      "fully visible after 1 swipe; its top edge lies on its scroll container's (0,242 1080x1736), and a probe swipe toward it moved nothing — nothing of it is cut there",
    );
  });

  it('the parser marks the container: a scrollable="true" Compose View (role container) clips — the SWIFT dump, end to end through parseUiautomatorXml', async () => {
    const { parseUiautomatorXml } = await import('../../src/adapters/android.js');
    const tree = parseUiautomatorXml(`<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" resource-id="swift_payment.form.top_bar" bounds="[0,0][1080,242]" />
  <node class="android.view.View" scrollable="true" bounds="[0,242][1080,1978]">
    <node class="android.view.View" resource-id="swift_payment.form.fees_select" bounds="[66,242][1014,334]" />
  </node>
  <node class="android.widget.Button" resource-id="swift_payment.form.continue_button" text="CONTINUE" bounds="[66,1979][1014,2111]" />
</node>
</hierarchy>`);
    const fake = new FakeAdapter({ s: tree }, 's');
    // The fake's tree never moves: the probe moves nothing, and the stop is accepted as checked — what matters is that it was probed at all.
    const result = await scrollUntilVisible(fake, 'id:swift_payment.form.fees_select', { ...FAST, fully: true });
    expect(fake.swipes).toHaveLength(1);
    expect(result.flush).toEqual({ edge: 'top', container: FORM, checked: true });
  });
});

describe('scrollUntilVisible — strokes that drag, not fling, over the scroll container (Android, docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md)', () => {
  const SETTINGS: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
  const settingsLabels = ['Network', 'Devices', 'Apps', 'Notifications', 'Battery', 'Storage', 'Sound', 'Modes', 'Display', 'Wallpaper', 'Accessibility', 'Security', 'Privacy', 'Location', 'Safety', 'Passwords', 'Digital', 'System', 'About'];

  it('measured: Settings\' Display, two rows below the fold — reached; every stroke drawn over the list at the drag speed (850 px in 851 ms) moves it about its own length, not 1.6×', async () => {
    const fake = new LazyList(settingsLabels, 198, SETTINGS, { carry: flingCarry, dragSpeed: 0.45 });
    const result = await scrollUntilVisible(fake, 'text:"Display"', { fully: true, maxSwipes: 6, timeoutMs: 5_000, settleMs: 1 });
    expect(result.clipped).toEqual([]);
    expect(fake.rowRect('Display').height).toBe(198);
    for (const stroke of fake.swipes) {
      expect(stroke.from.y).toBeGreaterThanOrEqual(737); // on the list, not the header
      expect(stroke.durationMs).toBe(Math.max(300, Math.ceil((Math.abs(stroke.to.y - stroke.from.y) / 999) * 1000)));
    }
    expect(fake.swipes[0]).toEqual({ from: { x: 540, y: 1871 }, to: { x: 540, y: 1021 }, durationMs: 851 });
    for (const [i, moved] of fake.moves.entries()) {
      const travel = Math.abs(fake.swipes[i].to.y - fake.swipes[i].from.y);
      expect(Math.abs(moved)).toBeLessThanOrEqual(travel * 1.15); // the 300-ms stroke moved this list 1413 for 850
    }
  });

  it('measured: row_40 of a list that ends at row_36 — fails after the two strokes that no longer change the screen, not at the timeout; ElementNotFoundError, it never appeared', async () => {
    const rows = Array.from({ length: 37 }, (_, i) => `row_${i}`);
    const fake = new LazyList(rows, 198, SETTINGS, { carry: flingCarry, dragSpeed: 0.45, offset: 5_500 });
    const error = await scrollUntilVisible(fake, 'text:"row_40"', { fully: true, maxSwipes: 6, timeoutMs: 15_000, settleMs: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe(
      'scroll_until text:"row_40" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree',
    );
  });

  it('an adapter with no drag speed (iOS) strokes at its own default duration, as before — none is passed', async () => {
    const fake = new LazyList(settingsLabels, 198, SETTINGS);
    await scrollUntilVisible(fake, 'text:"Display"', { maxSwipes: 6, timeoutMs: 5_000, settleMs: 1 });
    expect(fake.swipes.length).toBeGreaterThan(0);
    expect(fake.swipes.every((st) => st.durationMs === undefined)).toBe(true);
  });
});

describe('scrollUntilVisible — nested clipping containers and a loading list (code review of fix/r3-scroll, 2026-10-09)', () => {
  const LIST: Rect = { x: 0, y: 242, width: 1080, height: 1736 };
  /** A list holding a horizontal carousel cut by the list's bottom to `strip` px, a card in it flush with its bottom. */
  function carouselTree(strip: number): UiNode {
    const card = node({ role: 'button', identifier: 'card', rect: { x: 40, y: 1978 - strip + 4, width: 600, height: strip - 4 } });
    const carousel = node({ role: 'scrollable', identifier: 'carousel', rect: { x: 0, y: 1978 - strip, width: 1080, height: strip }, clipsDescendants: true, children: [card] });
    const list = node({ role: 'container', identifier: 'list', rect: { ...LIST }, clipsDescendants: true, children: [carousel] });
    return node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [list] });
  }

  it.each([30, 78])('a card in a carousel cut to a %i-px strip: the probe is drawn over the list, a real stroke (177 px), never an 18-px tap on the card', async (strip) => {
    const fake = new FakeAdapter({ s: carouselTree(strip) }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    const result = await scrollUntilVisible(fake, 'id:card', { ...FAST, fully: true });
    expect(fake.swipes).toEqual([{ from: { x: 540, y: 1631 }, to: { x: 540, y: 1454 } }]); // the list's lower touch-down, finger up 177
    expect(result.flush?.checked).toBe(true); // the static fake moves nothing: accepted, after a stroke that could have moved it
  });

  it('a probe whose container has room on the screen but not above the IME is not drawn over the whole screen: no swipe, reported unchecked (`room`) — not "nothing of it is cut there" after a stroke that touched down off the list', async () => {
    const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
    const row = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 1340, width: 948, height: 50 } });
    const under = node({ role: 'container', identifier: 'list', rect: { x: 0, y: 1340, width: 1080, height: 800 }, clipsDescendants: true, children: [row] });
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [under] }) }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true });
    expect(fake.swipes).toEqual([]);
    expect(result.flush).toEqual({ edge: 'top', container: under.rect, checked: false, why: 'room' });
  });

  it('no screen box at all (the device 0x0, a tree with no geometry): the round judges on, and the stroke it asks for throws screenBox\'s error — nothing swiped', async () => {
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: zero, children: [node({ role: 'button', identifier: 'row', rect: zero })] }) }, 's');
    fake.viewportSize = { width: 0, height: 0 };
    await expect(scrollUntilVisible(fake, 'id:row', FAST)).rejects.toThrow(/^No screen box to swipe in: the device reported 0x0, and the UI tree has no geometry/);
    expect(fake.swipes).toEqual([]);
  });

  it('a list still loading its next page (a spinner below the last row) is not called exhausted after two strokes — the scroll runs to its bound', async () => {
    const SETTINGS: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
    const rows = Array.from({ length: 20 }, (_, i) => `row_${i}`);
    const fake = new LazyList(rows, 198, SETTINGS, { offset: 10_000 });
    const read = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      const tree = await read();
      return { ...tree, children: [...tree.children, node({ role: 'progress', rect: { x: 500, y: 2100, width: 80, height: 80 } })] };
    };
    const error = await scrollUntilVisible(fake, 'text:"row_40"', { maxSwipes: 4, timeoutMs: 5_000, settleMs: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('failed after 4 swipes (maxSwipes)');
  });
});

/**
 * Code review P2 (2026-10-09): a selector matching two nodes — a container and its button sharing an id — was judged by
 * scroll_until on the match more of which showed (the container, its centre clear), while the next tap acted on the
 * button (resolveNow's preference for a sole interactive match) and refused it. The scroll judges the tap's match.
 */
describe('scrollUntilVisible — the match the next tap acts on (code review P2)', () => {
  const ios = (children: UiNode[]) => {
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children }) }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    return fake;
  };
  const APP = node({ role: 'other', label: 'app', rect: { x: 0, y: 0, width: 402, height: 874 } });
  const BAR = node({ role: 'button', label: 'Continue', identifier: 'cont', rect: { x: 24, y: 780, width: 354, height: 44 } });

  it('a container and its button sharing an id: the button is judged — its centre under the bar, no stop — as the tap would refuse it', async () => {
    const fake = ios([
      APP,
      node({ role: 'container', identifier: 'prio', rect: { x: 24, y: 700, width: 354, height: 130 } }),
      node({ role: 'button', identifier: 'prio', label: 'Priority', rect: { x: 24, y: 771, width: 354, height: 52 } }),
      BAR,
    ]);
    await expect(scrollUntilVisible(fake, 'id:prio', { maxSwipes: 0, settleMs: 0 })).rejects.toThrow(
      'scroll_until id:prio failed after 0 swipes (maxSwipes) — element reached the viewport but stayed under button "Continue" (24,780 354x44) at its centre (201,797), drawn over it — 17% of it shows (last rect {"x":24,"y":771,"width":354,"height":52})',
    );
  });

  it('…and with no one match the tap prefers (two non-interactive nodes), every match is judged as before: the one that stops wins', async () => {
    const fake = ios([
      APP,
      node({ role: 'text', identifier: 'prio', label: 'Priority', rect: { x: 24, y: 700, width: 354, height: 40 } }),
      node({ role: 'text', identifier: 'prio', label: 'Priority hint', rect: { x: 24, y: 771, width: 354, height: 52 } }),
      BAR,
    ]);
    expect(await scrollUntilVisible(fake, 'id:prio', { maxSwipes: 0, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });
});

/**
 * iOS's status band is off the screen for `scroll_until`'s stop too (2026-10-09, device check C3-1.3 of
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md): one 0.3-s stroke (`idb ui swipe 201 699 201
 * 175`) flung `priority_select` from 771 to `24,-20`, its centre (201,6) — on the screen and under no tree node — and
 * the plain stop stopped there; the tap that followed went to the status bar. interact/swipe.ts#iosStatusBand.
 */
describe('scroll_until and iOS\'s status band (2026-10-09)', () => {
  /** The SWIFT form as idb lists it, `priority_select` moved by each stroke to the next of `ys` (the last one standing). */
  async function flungForm(platform: 'ios' | 'android', ys: number[]) {
    const { readFile } = await import('node:fs/promises');
    const { parseIdbDescribeAll } = await import('../../src/adapters/ios-tree-source.js');
    const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    const row = tree.children.find((n) => n.identifier === 'swift_payment.form.priority_select')!;
    class Flung extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        row.rect = { ...row.rect, y: ys.length > 1 ? ys.shift()! : ys[0] };
      }
    }
    const fake = new Flung({ form: tree }, 'form');
    fake.platform = platform;
    fake.keyboard = undefined;
    // What each adapter's viewport reports: the iOS adapter adds the band (adapters/ios-status-band.ts), Android none.
    fake.viewportSize = platform === 'ios' ? { width: 402, height: 874, statusBand: 62 } : { width: 402, height: 874 };
    return fake;
  }

  it('the measured fling to y -20 is no stop: the scroll turns back and stops where the tap will open the row', async () => {
    const fake = await flungForm('ios', [-20, 550]);
    const result = await scrollUntilVisible(fake, 'id:swift_payment.form.priority_select', FAST);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(fake.swipes).toEqual([
      { from: { x: 201, y: 699 }, to: { x: 201, y: 175 } }, // the measured stroke
      { from: { x: 201, y: 175 }, to: { x: 201, y: 437 } }, // turned back, half its reach
    ]);
  });

  /** The turned stroke the measured run drew second: content up, from y 175, half the reach. */
  const TURNED = { from: { x: 201, y: 175 }, to: { x: 201, y: 437 } };

  it('a row lying wholly in the band (y 10–62): no plain stop and no fully: true one — and the next stroke is turned back at once, the band being past the far edge', async () => {
    for (const fully of [false, true]) {
      const fake = await flungForm('ios', [10, 550]);
      expect(await scrollUntilVisible(fake, 'id:swift_payment.form.priority_select', { ...FAST, fully })).toEqual({ swipes: 2, visible: 1, clipped: [] });
      expect(fake.swipes[1]).toEqual(TURNED);
    }
  });

  it('a row whose centre lies in the band with part of it below (34–86, centre (201,60)): no stop, turned back', async () => {
    const fake = await flungForm('ios', [34, 550]);
    expect(await scrollUntilVisible(fake, 'id:swift_payment.form.priority_select', FAST)).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(fake.swipes[1]).toEqual(TURNED);
  });

  it('only the centre: a row reaching into the band with its centre below it (36–88, centre (201,62)) stops plain AND fully — what lies in the band is judged against the screen', async () => {
    for (const fully of [false, true]) {
      const fake = await flungForm('ios', [36, 550]);
      expect(await scrollUntilVisible(fake, 'id:swift_payment.form.priority_select', { ...FAST, fully })).toEqual({ swipes: 1, visible: 1, clipped: [] });
    }
  });

  /** A screen that does not scroll, holding one image at `rect`. */
  const still = (rect: Rect) => {
    resetLayout();
    const root = screen(el({ identifier: 'root' }), node({ role: 'image', identifier: 'hero', rect }));
    root.rect = { x: 0, y: 0, width: 402, height: 874 };
    const fake = new FakeAdapter({ s: root }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874, statusBand: 62 };
    return fake;
  };

  it('full-bleed content at the top (a hero 0,0 402x300, review of fix/r6-ios-top MAJOR 2): fully visible after 0 swipes', async () => {
    const fake = still({ x: 0, y: 0, width: 402, height: 300 });
    expect(await scrollUntilVisible(fake, 'id:hero', { ...FAST, fully: true })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.swipes).toEqual([]);
  });

  it('a header whose centre stays in the band (0,0 402x106 on a screen that does not scroll): the failure names iOS\'s status bar — no clip, no layout defect', async () => {
    const error = (await scrollUntilVisible(still({ x: 0, y: 0, width: 402, height: 106 }), 'id:hero', FAST).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("its centre stays under iOS's status bar at (201,53), in the top 62 pt of the screen, where a tap goes to the status bar");
    expect(error.message).not.toMatch(/CLIPPED|layout defect|fully revealed/);
  });

  it('a list already at its bottom end, the target pushed up under the bar (24,10 354x52) by the default direction down: the failure says to try direction "up"', async () => {
    const error = (await scrollUntilVisible(still({ x: 24, y: 10, width: 354, height: 52 }), 'id:hero', FAST).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain(
      "its centre stays under iOS's status bar at (201,36), in the top 62 pt of the screen, where a tap goes to the status bar, and the content is exhausted: " +
        'swiping down no longer moves it out from under the status bar — try direction: "up".',
    );
    const up = (await scrollUntilVisible(still({ x: 24, y: 10, width: 354, height: 52 }), 'id:hero', { ...FAST, direction: 'up' }).catch((e: unknown) => e)) as Error;
    expect(up.message).toContain('swiping up no longer moves it out from under the status bar — try direction: "down".');
  });

  it('Android is unaffected: the same tree on an Android adapter stops at y -20, as before', async () => {
    const fake = await flungForm('android', [-20, 550]);
    expect(await scrollUntilVisible(fake, 'id:swift_payment.form.priority_select', FAST)).toEqual({ swipes: 1, visible: expect.closeTo(0.615, 3), clipped: ['top'] });
  });
});

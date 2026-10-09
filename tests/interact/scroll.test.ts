import { describe, expect, it, vi } from 'vitest';
import { type KeyboardWitness, type Point, type Rect, type SoftKeyboard, type UiNode } from '../../src/adapters/types.js';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { bandNode, el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

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

  it('reports the CLIPPED fraction and edges instead of a bare "visible" (the 2026-08-27 finding)', async () => {
    // 40px tall, stopping at y=1980 → half of it below the fold.
    const result = await scrollUntilVisible(scrollingFake(2580), { id: 'submit_button' }, FAST);
    expect(result).toEqual({ swipes: 1, visible: 0.5, clipped: ['bottom'] });
    expect(describeScrollResult(result)).toBe(
      'visible after 1 swipe — CLIPPED at bottom, 50% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box',
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
    let asked = 0;
    keyboard.witness = async () => {
      if (asked++ === 1) await new Promise((r) => setTimeout(r, 150)); // the stop round's witness outlives the 100 ms budget
      return witness();
    };
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, timeoutMs: 100 });
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

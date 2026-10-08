import { describe, expect, it } from 'vitest';
import { KEYBOARD_ROLE, type KeyboardWitness, type Point, type Rect, type SoftKeyboard } from '../../src/adapters/types.js';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { bandNode, el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

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

  it('judges the MOST revealed match when an id sits on a container and its child', async () => {
    resetLayout();
    const child = node({ role: 'text', identifier: 'row', rect: { x: 0, y: 1900, width: 100, height: 40 } });
    const container = node({ role: 'container', identifier: 'row', rect: { x: 0, y: 1900, width: 100, height: 400 }, children: [child] });
    const fake = new FakeAdapter({ s: screen(container) }, 's');
    const result = await scrollUntilVisible(fake, 'id:row', FAST);
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [] }); // the child, not the 25%-visible container
  });

  it('fully: true keeps swiping past a clipped stop, and names the layout defect when swiping no longer moves it', async () => {
    const result = await scrollUntilVisible(scrollingFake(2580), { id: 'submit_button' }, { ...FAST, fully: true });
    expect(result.swipes).toBe(2); // the default would have stopped at 1
    await expect(
      scrollUntilVisible(scrollingFake(1980, 0), { id: 'submit_button' }, { ...FAST, fully: true }),
    ).rejects.toThrow(/content is exhausted[\s\S]*cannot be fully revealed — that is a layout defect/);
  });

  it('names the stop bound that ended it: maxSwipes, or the timeout in ms', async () => {
    await expect(scrollUntilVisible(scrollingFake(50_000, 10), 'id:submit_button', FAST)).rejects.toThrow(
      /scroll_until id:submit_button failed after 4 swipes \(maxSwipes\) — element in tree but never intersected the 1000x2000 viewport/,
    );
    await expect(
      scrollUntilVisible(scrollingFake(50_000, 10), { id: 'submit_button' }, { maxSwipes: 50, timeoutMs: 1, settleMs: 2 }),
    ).rejects.toThrow(/scroll_until id:"submit_button" failed after 1ms \(timeout\)/);
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
 * (`readSoftKeyboard`: the oracle on Android, the WDA band on iOS).
 */
describe('scrollUntilVisible — the soft keyboard', () => {
  /** The measured Android screen and IME (Pixel_3a, 1080x2220): `InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220]`. */
  const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
  /** The measured iOS 27 pad's band, in points of a 402x874 screen (`other None None None 0 589 402 285`). */
  const IOS_BAND: Rect = { x: 0, y: 589, width: 402, height: 285 };

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

  it('Android, symptom 1: a row WHOLLY under the IME is not "fully visible after 0 swipes" — it is scrolled out from under it, and the line says what it was judged against', async () => {
    const { fake } = androidForm({ startY: 1906 }); // the measured rect: y 1906–1979, inside [0,1398][1080,2220]
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], keyboard: { state: 'shown', frame: IME } });
    expect(describeScrollResult(result)).toBe('fully visible after 1 swipe, above the soft keyboard over [0,1398][1080,2220]');
  });

  it('Android, symptom 2: with the IME up the content-down stroke starts ABOVE it, so it scrolls — the old stroke started at y 1776, on a key', async () => {
    const { fake } = androidForm({ startY: 2900 });
    const result = await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(result.swipes).toBe(3);
    for (const { from, to } of fake.swipes) {
      expect(from.y).toBeLessThan(IME.y);
      expect(to.y).toBeLessThan(from.y); // content below → finger up
    }
    // The same swipeVector over the box above the IME: centre 699, reach 0.3 × 1398.
    expect(fake.swipes[0]).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } });
  });

  it('Android, partly under the IME: CLIPPED at the keyboard\'s edge, never "fully visible"', async () => {
    const { fake } = androidForm({ startY: 1360 }); // 1360–1433 straddles 1398
    const result = await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(result.clipped).toEqual(['bottom']);
    expect(describeScrollResult(result)).toBe(
      'visible after 0 swipes — CLIPPED at bottom, 52% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. ' +
        'A rect assert or screenshot on this element will measure the CLIPPED box',
    );
  });

  it('Android, fully: true at the end of the content with the row still under the IME: the keyboard is named, with how to hide it — not a layout defect', async () => {
    const { fake } = androidForm({ startY: 1360, perSwipe: 0 });
    const error = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'scroll_until id:priority_select failed after 1 swipe — element is in the viewport but CLIPPED at bottom, 52% of it is in ' +
        'the viewport above the soft keyboard over [0,1398][1080,2220], and the content is exhausted: swiping down no longer moves ' +
        'it. The soft keyboard covers the rest — to reach it with the keyboard down, hide it first (press_key back from the MCP ' +
        'tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again; only if it stays clipped with ' +
        'the keyboard down is it a layout defect. Last rect {"x":66,"y":1360,"width":948,"height":73} in a 1080x2220 viewport',
    );
    expect(fake.keys).toEqual([]); // nothing pressed: the scroll never hides the keyboard itself
  });

  it('Android, a stop bound with the IME up names the keyboard — the 15 s "never appeared" no longer reads as a wrong selector — and stays ElementNotFoundError', async () => {
    const { fake } = androidForm({ startY: 0 });
    const error = await scrollUntilVisible(fake, 'id:payee_street_input', { ...FAST, maxSwipes: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe(
      'scroll_until id:payee_street_input failed after 2 swipes (maxSwipes) — element never appeared in the tree. The soft ' +
        'keyboard was up over [0,1398][1080,2220]: visibility was judged, and the swipes drawn, in the screen above it — to ' +
        'reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the ' +
        'fill before this step in a flow) and scroll again',
    );
  });

  it('Android cost: ONE window query per round, the witness never asked while a frame is shown, and no key pressed', async () => {
    const { fake } = androidForm({ startY: 2900 });
    await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(4); // 3 swipes, 4 reads
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0);
    expect(fake.keys).toEqual([]);
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

  it('Android floating keyboard (inferred): window hidden, input method shown — the stop says the keyboard could not be placed, asked ONCE, and the flow line is not a clean "fully visible"', async () => {
    // Where a floating keyboard lies is unmeasured: here it eats no stroke.
    const { fake } = androidForm({ startY: 2900, window: { state: 'hidden' }, witness: 'shown', keyboardTop: undefined });
    const result = await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [], keyboard: { state: 'unlocated' } }); // judged over the whole screen: there is no frame to exclude
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(1);
    expect(describeScrollResult(result)).toBe(
      'fully visible after 2 swipes; the input method reports a soft keyboard shown, but the window state gives it no area on ' +
        'screen (a floating keyboard? inferred, not measured), so where it lies is unknown — it was not judged and may cover the element',
    );
    expect(fake.keys).toEqual([]);
  });

  it('Android floating keyboard at a failed stop: named, with the swipes it may have eaten', async () => {
    const { fake } = androidForm({ startY: 0, window: { state: 'hidden' }, witness: 'shown' });
    const error = await scrollUntilVisible(fake, 'id:nope', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'scroll_until id:nope failed after 1 swipes (maxSwipes) — element never appeared in the tree; the input method reports a ' +
        'soft keyboard shown, but the window state gives it no area on screen (a floating keyboard? inferred, not measured), so ' +
        'where it lies is unknown — the swipes may have landed on it; hide or dock it and scroll again',
    );
  });

  /** As IosAdapter under treeSource: wda — no oracle; the band is the KEYBOARD_ROLE node the WDA source marks. */
  function iosForm(startY: number, rowHeight: number, perSwipe = 200) {
    const made = formFake({ width: 402, height: 874, startY, rowHeight, perSwipe, keyboardTop: IOS_BAND.y });
    made.fake.live().children.push(bandNode(IOS_BAND));
    made.fake.platform = 'ios';
    made.fake.keyboard = undefined;
    made.fake.keyboardAdvice = 'ADVICE';
    return made;
  }

  it('iOS (WDA band): the measured partly-covered row (y 545, h 52, band from 589) is not "fully visible after 0 swipes"; fully: true scrolls it above the band', async () => {
    const { fake } = iosForm(545, 52);
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], keyboard: { state: 'shown', frame: IOS_BAND } });
    // The stroke started above the band (the old one: y ≈ 699, on a key).
    expect(fake.swipes[0].from.y).toBeLessThan(IOS_BAND.y);
  });

  it('iOS (WDA band): a stop bound names the keyboard with the in-tree remedy — no back, the adapter\'s advice', async () => {
    const { fake } = iosForm(0, 52);
    const error = await scrollUntilVisible(fake, 'id:nope', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'scroll_until id:nope failed after 1 swipes (maxSwipes) — element never appeared in the tree. The soft keyboard was up over ' +
        '[0,589][402,874]: visibility was judged, and the swipes drawn, in the screen above it — to reach it with the keyboard ' +
        'down, hide it first (tap a neutral element such as the screen title — a tap: step in a flow) and scroll again; this ' +
        'adapter cannot hide it on its own (ADVICE)',
    );
  });

  it('iOS (WDA band): the keyboard\'s OWN UI as the target is judged against the whole screen, as readSoftKeyboard reads it for a subject', async () => {
    resetLayout();
    const key = node({ role: 'button', identifier: 'kb_done', rect: { x: 300, y: 800, width: 80, height: 40 } });
    const band = node({ role: KEYBOARD_ROLE, rect: { ...IOS_BAND }, children: [node({ role: 'container', ofKeyboard: true, rect: { ...IOS_BAND }, children: [key] })] });
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [band] }) }, 's');
    fake.keyboard = undefined;
    expect(await scrollUntilVisible(fake, 'id:kb_done', FAST)).toEqual({ swipes: 0, visible: 1, clipped: [] });
  });
});

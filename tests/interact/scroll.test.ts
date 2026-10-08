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

  it('fully: true, clipped: ONE stroke that does not move it is a transient, not the layout defect — the next one scrolls (review round 2)', async () => {
    const fake = scrollingFake(1980); // 1980–2020: clipped at the bottom of the 2000 viewport
    const swipe = fake.swipe.bind(fake);
    let strokes = 0;
    fake.swipe = async (from, to) => (strokes++ === 0 ? void fake.swipes.push({ from, to }) : swipe(from, to));
    expect(await scrollUntilVisible(fake, 'id:submit_button', { ...FAST, fully: true })).toEqual({ swipes: 2, visible: 1, clipped: [] }); // → 1380
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

  it('Android, symptom 1: a row WHOLLY under the IME is not "fully visible after 0 swipes" — it is scrolled out from under it first', async () => {
    const { fake } = androidForm({ startY: 1906 }); // the measured rect: y 1906–1979, inside [0,1398][1080,2220]
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    // Clear of the band at the stop: the band changes nothing there, so it is not reported (review 2026-10-08).
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(describeScrollResult(result)).toBe('fully visible after 1 swipe');
  });

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
    // After TWO identical swipes that did not move it (review round 2: one can be a transient), not one.
    expect((error as Error).message).toBe(
      'scroll_until id:priority_select failed after 2 swipes — element is in the viewport but CLIPPED at bottom, 52% of it is in ' +
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
        'keyboard was up over [0,1398][1080,2220] in 3 of the 3 rounds read: in those, visibility was judged, and the swipe drawn, in ' +
        'the screen above it — to ' +
        'reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the ' +
        'fill before this step in a flow) and scroll again',
    );
  });

  it('Android cost: ONE window query per round, the witness asked on each round the band matters — never remembered — and none on the moot stop; no key pressed', async () => {
    const { fake } = androidForm({ startY: 2900 });
    await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(5); // 3 swipes, 4 reads, and the read confirming the stop held still
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(3); // y 2900, 2300, 1700 matter; y 1100 (twice) is a moot clean stop
    expect(fake.keys).toEqual([]);
  });

  it('Android, two matches — one under the IME, one above it: the band changes WHICH is judged, so the clean stop says it was judged above the keyboard (review round 3)', async () => {
    resetLayout();
    const under = node({ role: 'button', identifier: 't', rect: { x: 66, y: 1906, width: 948, height: 73 } });
    const above = node({ role: 'button', identifier: 't', rect: { x: 66, y: 500, width: 948, height: 73 } });
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [under, above] }) }, 's');
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
    const result = await scrollUntilVisible(fake, 'id:t', FAST);
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [], keyboard: { state: 'shown', frame: IME } });
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes, judged above the soft keyboard over [0,1398][1080,2220]');
  });

  it('Android, a band that changes nothing (the target clear above it, a clean stop) is not asked about and not reported', async () => {
    const { fake } = androidForm({ startY: 500 });
    expect(await scrollUntilVisible(fake, 'id:priority_select', FAST)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0);
  });

  it('Android, a STALE window state (review 2026-10-08: frame shown, input method says hidden — measured for seconds after a navigating tap) is vetoed: the on-screen target is not scored 0, no stroke is sent, no keyboard reported', async () => {
    const { fake } = androidForm({ startY: 1906, witness: 'hidden' });
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.swipes).toEqual([]);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(1);
  });

  it('Android, a vetoed band is not claimed at a failed stop either', async () => {
    const { fake } = androidForm({ startY: 0, witness: 'hidden' });
    const error = await scrollUntilVisible(fake, 'id:nope', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe('scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree');
  });

  it('Android, a vetoed band leaves the stroke whole-screen too — and a denial is not kept: the witness is asked again on every round the band matters', async () => {
    const { fake } = androidForm({ startY: 2900, witness: 'hidden', keyboardTop: undefined });
    const result = await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.swipes[0]).toEqual({ from: { x: 540, y: 1776 }, to: { x: 540, y: 444 } }); // the whole 2220 screen's stroke
    // y 2900 and 2300 stroke (the band matters), y 1700 is under the band (the judgements differ), and so is the read
    // confirming that stop: four rounds, four denials.
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(4);
  });

  it('Android, a denial followed by a real keyboard (review round 1: a stale window on round 0, then a new screen auto-focuses a field) — asked again, so the row under the IME is not "fully visible after 1 swipe"', async () => {
    const { fake } = androidForm({ startY: 2506, keyboardTop: undefined });
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'shown']; // denied once, then confirmed (a queued answer becomes the standing one)
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    // Round 1 found the row at y 1906–1979, inside the IME: asked again, the band applied, one more swipe.
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(fake.swipes[1].from.y).toBe(1118); // drawn above the IME
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(2);
  });

  it('Android, a keyboard the scroll itself HIDES (a list that dismisses it on drag) with the window left stale-shown: asked again, denied, and the later rounds judged and stroked whole-screen — no keyboard claimed', async () => {
    const { fake } = androidForm({ startY: 2900, keyboardTop: undefined }); // the window keeps reporting the IME frame
    fake.attachedKeyboard.witnessAnswers.queue = ['shown', 'hidden']; // confirmed on round 0, gone after the first swipe
    const result = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true });
    expect(fake.swipes.map((s) => s.from.y)).toEqual([1118, 1776]); // round 0 above the band, round 1 the whole screen
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] }); // y 1700–1773: judged whole-screen, not "under" a phantom band
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(4); // the confirming read of the stop asks again, denied again
  });

  it('a round whose tree did not read strokes in the box of the last round that DID read — whole-screen when that round applied no band', async () => {
    const { fake } = androidForm({ startY: 2900, keyboardTop: undefined, perSwipe: 100 });
    fake.attachedKeyboard.windowAnswers.queue = [{ state: 'shown', frame: IME }, { state: 'hidden' }];
    const real = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async () => {
      if (reads++ === 2) throw new Error('uiautomator dump returned no XML');
      return real();
    };
    await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, maxSwipes: 3 }).catch(() => undefined);
    expect(fake.swipes[0].from.y).toBe(1118); // round 0: the band applied
    expect(fake.swipes[1].from.y).toBe(1776); // round 1: window hidden
    expect(fake.swipes[2].from.y).toBe(1776); // round 2, unread: round 1's whole screen, not round 0's band
  });

  it('iOS (WDA band): once a band was applied, a later moot stop on the keyboard\'s OWN node does not call the key "above the soft keyboard"', async () => {
    resetLayout();
    const key = node({ role: 'button', identifier: 'kb_done', rect: { x: 300, y: 900, width: 80, height: 40 } });
    const band = node({ role: KEYBOARD_ROLE, rect: { ...IOS_BAND }, children: [node({ role: 'container', ofKeyboard: true, rect: { ...IOS_BAND }, children: [key] })] });
    class KeyFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        key.rect = { ...key.rect, y: key.rect.y - 100 };
      }
    }
    const fake = new KeyFake({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [band] }) }, 's');
    fake.keyboard = undefined;
    // Round 0: the key below the screen, the round strokes — the band applied (in-tree: corroborated by construction).
    expect(await scrollUntilVisible(fake, 'id:kb_done', FAST)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });

  it('a band from the top edge (y 0, a full-screen extract-mode IME — unmeasured) covers everything: no bare "fully visible", no stroke, a failure naming it', async () => {
    const { fake } = androidForm({ startY: 500, window: { state: 'shown', frame: { x: 0, y: 0, width: 1080, height: 2220 } } });
    const error = await scrollUntilVisible(fake, 'id:priority_select', FAST).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ElementNotFoundError); // it was in the tree
    expect((error as Error).message).toBe(
      'scroll_until id:priority_select failed after 0 swipes — the element is in the tree but under the soft keyboard; the soft ' +
        'keyboard over [0,0][1080,2220] covers the whole screen, so nothing under it can be judged and no swipe was sent — to reach it with the keyboard down, hide it first (press_key ' +
        'back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again',
    );
    expect(fake.swipes).toEqual([]);
  });

  it('a band from the top edge with the target NOT in the tree: still absence — ElementNotFoundError, so an optional step is skipped — with the keyboard named', async () => {
    const { fake } = androidForm({ startY: 500, window: { state: 'shown', frame: { x: 0, y: 0, width: 1080, height: 2220 } } });
    const error = await scrollUntilVisible(fake, 'id:nope', FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toMatch(/^scroll_until id:nope failed after 0 swipes — element never appeared in the tree; the soft keyboard over \[0,0\]\[1080,2220\] covers the whole screen/);
    expect(fake.swipes).toEqual([]);
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

  it('a round whose tree did not read strokes in the box the last read round\'s band left, not through the keyboard', async () => {
    const { fake } = androidForm({ startY: 2900 });
    const real = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async () => {
      if (reads++ === 1) throw new Error('uiautomator dump returned no XML');
      return real();
    };
    await scrollUntilVisible(fake, 'id:priority_select', FAST);
    expect(fake.swipes.length).toBeGreaterThanOrEqual(2);
    for (const { from } of fake.swipes) expect(from.y).toBeLessThan(IME.y);
  });

  it('keyboard up, element stuck clipped at a NON-keyboard edge (right): the layout-defect wording, not the keyboard\'s', async () => {
    resetLayout();
    const row = node({ role: 'button', identifier: 'wide', rect: { x: 900, y: 500, width: 300, height: 73 } });
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [row] }) }, 's');
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
    await expect(scrollUntilVisible(fake, 'id:wide', { ...FAST, fully: true })).rejects.toThrow(
      /CLIPPED at right, 60% of it is in the viewport above the soft keyboard over \[0,1398\]\[1080,2220\], and the content is exhausted[\s\S]*cannot be fully revealed — that is a layout defect/,
    );
  });

  it('a stop bound with the element still partly under the band reports the clip at the KEYBOARD\'s edge', async () => {
    const { fake } = androidForm({ startY: 1380, perSwipe: 5 }); // moves, never clears 1398, never stuck
    const error = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, fully: true, maxSwipes: 2 }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(
      /^scroll_until id:priority_select failed after 2 swipes \(maxSwipes\) — element reached the viewport but stayed CLIPPED at bottom, 38% of it is in the viewport above the soft keyboard over \[0,1398\]\[1080,2220\] \(last rect /,
    );
  });

  it('in tree but entirely under the band at the stop: "never intersected" names the frame actually judged', async () => {
    const { fake } = androidForm({ startY: 1906, perSwipe: 0 });
    const error = await scrollUntilVisible(fake, 'id:priority_select', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/element in tree but never intersected the 1080x1398 screen above the soft keyboard over \[0,1398\]\[1080,2220\] \(last rect/);
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

  it('Android floating keyboard (inferred): window hidden, input method shown — on a fully: true stop the result says the keyboard could not be placed, asked ONCE, and the line is not a clean "fully visible"', async () => {
    // Where a floating keyboard lies is unmeasured: here it eats no stroke.
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

  it('Android floating keyboard on a DEFAULT clean stop: not asked (review 2026-10-08 — a witness query on every clean stop buys a sentence nobody acts on)', async () => {
    const { fake } = androidForm({ startY: 500, window: { state: 'hidden' }, witness: 'shown' });
    expect(await scrollUntilVisible(fake, 'id:priority_select', FAST)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0);
  });

  it('Android floating keyboard at a failed stop: named, with the swipes it may have eaten', async () => {
    const { fake } = androidForm({ startY: 0, window: { state: 'hidden' }, witness: 'shown' });
    const error = await scrollUntilVisible(fake, 'id:nope', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree; the input method reports a ' +
        'soft keyboard shown, but the window state gives it no area on screen (one still coming up? not measured), so ' +
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
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] });
    // The stroke started above the band (the old one: y ≈ 699, on a key).
    expect(fake.swipes[0].from.y).toBeLessThan(IOS_BAND.y);
  });

  it('iOS (WDA band): a stop bound names the keyboard with the in-tree remedy — no back, the adapter\'s advice', async () => {
    const { fake } = iosForm(0, 52);
    const error = await scrollUntilVisible(fake, 'id:nope', { ...FAST, maxSwipes: 1 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'scroll_until id:nope failed after 1 swipe (maxSwipes) — element never appeared in the tree. The soft keyboard was up over ' +
        '[0,589][402,874] in 2 of the 2 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — ' +
        'to reach it with the keyboard ' +
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

/**
 * 2026-10-08, the two "Device check" sections of
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md and
 * review round 1: the stroke over a keyboard, the settled stop, the turn
 * after a fling past the target, and a target off the frame that the
 * strokes no longer move.
 */
describe('scrollUntilVisible — after the device check', () => {
  /** The measured WDA pad on the iPhone 17 (402x874 pt): `role:keyboard 0 572 402 302`. */
  const WDA_BAND: Rect = { x: 0, y: 572, width: 402, height: 302 };
  /** The app's top bar under WDA (status bar + nav bar, title at y 73–95, ending ≈ y 116): a stroke touching down in it is ignored. */
  const TOP_BAR_BOTTOM = 116;
  const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };

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
  /** Content down = finger up. */
  const fingerUp = (s: { from: Point; to: Point }): boolean => s.to.y < s.from.y;

  it('iOS (WDA): with the pad up a content-UP scroll touches down below the top bar (y 175) and moves the content — the stroke over the box above the pad touched down at y 114 and moved nothing', async () => {
    const fake = wdaForm(-586); // the measured debit_select, from a scrolled form
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, direction: 'up', fully: true });
    expect(result).toEqual({ swipes: 3, visible: 1, clipped: [] }); // -586 → -303 → -20 → 263
    expect(fake.swipes[0]).toEqual({ from: { x: 201, y: 175 }, to: { x: 201, y: 458 } });
  });

  it('iOS (WDA): a stop the settle read caught MID-FLING is not reported — the confirming read finds the row past the top, and the next stroke brings it back', async () => {
    // The measured priority_select: y 681 under the pad; the settle read sees it at 300, it comes to rest at -48 (4 pt left on screen).
    const fake = wdaForm(681, (rect, travel) => (travel < 0 ? [300, -48] : [rect.y + travel]));
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] }); // not "fully visible after 1 swipe"
    // Turned round: content up, finger down from the keyboard-less 175 — its reach halved (283 → 142) on the turn.
    expect(fake.swipes[1]).toEqual({ from: { x: 201, y: 175 }, to: { x: 201, y: 317 } });
    expect(fake.reads).toBe(5); // round 0; 300 (stop) and its confirmation -48; 94 (stop) and its confirmation 94
  });

  it('iOS (WDA), the worse case: a fling that carries the row across the whole viewport between two reads (613 → -357) turns the next stroke round instead of swiping on DOWN into exhausted content', async () => {
    const fake = wdaForm(613, (rect, travel) => [travel < 0 ? -357 : rect.y + travel]); // up strokes move it by their travel
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true, maxSwipes: 6 });
    expect(result).toEqual({ swipes: 4, visible: 1, clipped: [] }); // -357 → -215 → -73 → 69, the turned strokes halved (142)
    expect(fake.swipes.map(fingerUp)).toEqual([true, false, false, false]); // down, then back up three times — ONE turn
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

  it('a read that fails after a turn strokes as the last read round decided — turned — as it keeps that round\'s stroke box', async () => {
    const fake = wdaForm(681, (rect, travel) => (travel < 0 ? [300, -48] : [rect.y])); // turned strokes do not move it
    const real = fake.uiTree.bind(fake);
    let calls = 0;
    fake.uiTree = async () => {
      if (calls++ === 3) throw new Error('WDA /source timed out'); // the read after the turned stroke
      return real();
    };
    await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch(() => undefined);
    expect(fake.swipes.slice(0, 3).map(fingerUp)).toEqual([true, false, false]);
  });

  it('a read that no longer finds the target after a turn clears it: nothing to turn for, the caller\'s direction again', async () => {
    const fake = wdaForm(681, (_rect, travel) => (travel < 0 ? [300, -48] : [null])); // the turned stroke drops it from the tree
    await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch(() => undefined);
    expect(fake.swipes.slice(0, 3).map(fingerUp)).toEqual([true, false, true]);
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

  it('a target first seen short only at a stop the confirming read then lost (not on the round-0 read) still turns the next stroke — where it stands is recorded on every read', async () => {
    // Not in the tree on round 0 (a lazy list); the first stroke brings it in, the settle read catches it at 300, it rests at -48.
    const fake = wdaForm(2000, (rect, travel) => (travel < 0 && rect.y === 2000 ? [300, -48] : [rect.y + travel]));
    const target = fake.live().children[0];
    fake.live().children.splice(0, 1);
    const swipe = fake.swipe.bind(fake);
    let first = true;
    fake.swipe = async (from, to) => {
      if (first) fake.live().children.unshift(target); // it enters the tree with the first stroke
      first = false;
      await swipe(from, to);
    };
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true });
    expect(fingerUp(fake.swipes[1])).toBe(false); // turned round after -48
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('a target read beyond the far edge before any read saw it short of it is the caller\'s direction to honour — on every round it stays there, not only round 0', async () => {
    const fake = wdaForm(-357); // above the screen from the start; each content-down stroke carries it further up
    await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch(() => undefined);
    expect(fake.swipes).toHaveLength(4);
    expect(fake.swipes.every(fingerUp)).toBe(true);
  });

  it('the turn is judged in the frame the round judged in: with the pad up, a row a content-up fling carried WHOLLY under the pad is beyond the frame\'s far edge, though inside the screen', async () => {
    const fake = wdaForm(-200, (rect, travel) => (travel > 0 ? [600] : [rect.y + travel])); // short (top clipped), flung to 600–652
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, direction: 'up', fully: true });
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] }); // 600 → 256
    expect(fingerUp(fake.swipes[1])).toBe(true); // turned round: content down
  });

  it.each([
    ['down', 300, [true, true]], // 300–1000 → -44–656: clipped at the top AND under the pad
    ['up', -400, [false, false]], // -400–300 → -117–583: clipped at the top AND under the pad
  ] as const)('a row TALLER than the frame, clipped at both edges, is not beyond either: no turn (%s)', async (direction, startY, strokes) => {
    const fake = wdaForm(startY, undefined, 700);
    await scrollUntilVisible(fake, 'id:row', { ...FAST, direction, fully: true, maxSwipes: 2 }).catch(() => undefined);
    expect(fake.swipes.map(fingerUp)).toEqual(strokes);
  });

  it('a target still moving inside the viewport is read again until it holds still; one that never does is reported after SETTLE_CONFIRM_READS (3) more reads with settled: false, and the reply says so', async () => {
    const slowing = wdaForm(681, () => [300, 250, 250]);
    expect(await scrollUntilVisible(slowing, 'id:row', { ...FAST, fully: true })).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(slowing.reads).toBe(4); // round 0, 300, 250, 250
    const restless = wdaForm(681, () => [300, 301, 302, 303, 304, 305, 306]);
    const result = await scrollUntilVisible(restless, 'id:row', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    expect(restless.reads).toBe(5); // round 0, the stop at 300, then three confirming reads — reported at 303
    expect(restless.swipes).toHaveLength(1);
    expect(describeScrollResult(result)).toBe(
      'fully visible after 1 swipe; still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match',
    );
  });

  it('the confirming budget is per stroke: a stop after a turn gets its own SETTLE_CONFIRM_READS', async () => {
    // Stroke 1 spends two confirming reads (300 → 290 → -48, beyond); the turned stroke's stop needs three (235 → 240 → 245 → 245).
    const fake = wdaForm(681, (_rect, travel) => (travel < 0 ? [300, 290, -48] : [235, 240, 245, 245]));
    expect(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true })).toEqual({ swipes: 2, visible: 1, clipped: [] });
  });

  it('a stop reached at the deadline is reported unconfirmed — no confirming read past it', async () => {
    const fake = wdaForm(681, () => [300, 300]);
    fake.onSwipe = () => new Promise((r) => setTimeout(r, 60)); // the deadline passes during the stroke
    const result = await scrollUntilVisible(fake, 'id:row', { fully: true, settleMs: 1, timeoutMs: 30 });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [], settled: false });
    expect(fake.reads).toBe(2);
  });

  it('a stop at 0 swipes was not stroked: reported on its one read, no confirming read', async () => {
    const fake = wdaForm(300);
    expect(await scrollUntilVisible(fake, 'id:row', FAST)).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.reads).toBe(1);
  });

  it('a confirming read that fails is read again, not answered with a stroke away from the stop', async () => {
    const fake = wdaForm(681, () => [300]);
    const real = fake.uiTree.bind(fake);
    let calls = 0;
    fake.uiTree = async () => {
      if (calls++ === 2) throw new Error('WDA /source timed out');
      return real();
    };
    expect(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true })).toEqual({ swipes: 1, visible: 1, clipped: [] });
    expect(fake.swipes).toHaveLength(1);
  });

  it('a target flung past and turned round, which the turned strokes no longer move: the failure names the turns and the direction last swiped', async () => {
    const fake = wdaForm(613, (rect, travel) => [travel < 0 ? -357 : rect.y]); // carried past, then nothing moves it
    const error = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(
      /^scroll_until id:row failed after 3 swipes \(the last 2, swiping up, did not move it: content exhausted, or the swipes were not taken\) — element in tree but never intersected the 402x572 screen above the soft keyboard over \[0,572\]\[402,874\] \(last rect \{"x":24,"y":-357,"width":354,"height":52\}\)\. It was turned round 1 time: a swipe carried it past the viewport \(a fling\), so the next was drawn the other way\. The soft keyboard was up/,
    );
  });

  it('in the viewport after a swipe and gone by the last read: the failure says it was there — not "never appeared" (a lazy list drops what a fling carries off)', async () => {
    const fake = wdaForm(681, () => [300, null]);
    const error = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(
      /failed after 4 swipes \(maxSwipes\) — element was in the viewport after swipe 1 but did not stay — it is no longer in the tree \(a fling carried it off\? a lazy list drops what scrolls away\)/,
    );
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('in the viewport after a swipe and off the frame at the last read: "was in the viewport after swipe 1 but did not stay", not "never intersected"', async () => {
    const fake = wdaForm(681, (rect, travel) => (travel < 0 && rect.y === 681 ? [300, 700] : [rect.y])); // bounces back under the pad, then stuck
    const error = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(
      /failed after 3 swipes \(the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken\) — element was in the viewport after swipe 1 but did not stay \(a fling\?\) — in tree, off the 402x572 screen above the soft keyboard over \[0,572\]\[402,874\] at the last read \(last rect/,
    );
  });

  /** The form's last field under an IME its container does not resize for: nothing moves it. */
  function lastFieldUnderIme(rect: Rect) {
    resetLayout();
    const target = node({ role: 'textfield', identifier: 'my_note_input', rect });
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [target] }) }, 's');
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
    return fake;
  }

  it('Android: a row WHOLLY under the IME at the end of the content fails after the two identical swipes that did not move it — not at the 15 s timeout — in the stop bound\'s words, naming the keyboard', async () => {
    const fake = lastFieldUnderIme({ x: 66, y: 1769, width: 948, height: 143 }); // the measured my_note_input
    const error = await scrollUntilVisible(fake, 'id:my_note_input', { fully: true, settleMs: 1 }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ElementNotFoundError); // it was in the tree
    expect((error as Error).message).toBe(
      'scroll_until id:my_note_input failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes ' +
        'were not taken) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] ' +
        '(last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 3 of the 3 rounds ' +
        'read: in those, visibility was judged, and the swipe drawn, in the screen above it — to reach it with the keyboard down, hide it ' +
        'first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again',
    );
    expect(fake.swipes).toHaveLength(2);
  });

  it('a zero-area rect carries no position — it is not called exhausted, the scroll runs to its bound', async () => {
    const fake = lastFieldUnderIme({ x: 66, y: 1769, width: 948, height: 0 });
    await expect(scrollUntilVisible(fake, 'id:my_note_input', FAST)).rejects.toThrow(/failed after 4 swipes \(maxSwipes\)/);
  });

  it('one stroke that moves nothing is a transient (a snackbar dismissed by the first touch), not exhausted content: the next one scrolls', async () => {
    const fake = scrollingFake(3100);
    const swipe = fake.swipe.bind(fake);
    let strokes = 0;
    fake.swipe = async (from, to) => (strokes++ === 0 ? void fake.swipes.push({ from, to }) : swipe(from, to));
    const result = await scrollUntilVisible(fake, 'id:submit_button', { ...FAST, maxSwipes: 6 });
    expect(result).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('several matches off the frame: exhausted only when NO match moved — a static duplicate first in tree order is not the target the strokes move (review round 1)', async () => {
    resetLayout();
    const ghost = node({ role: 'button', identifier: 'submit_button', rect: { x: 5000, y: 100, width: 100, height: 40 } }); // another page
    const real = node({ role: 'button', identifier: 'submit_button', rect: { x: 0, y: 3700, width: 100, height: 40 } });
    class TwoFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        real.rect = { ...real.rect, y: real.rect.y - 600 };
      }
    }
    const fake = new TwoFake({ s: screen(ghost, real) }, 's');
    expect(await scrollUntilVisible(fake, 'id:submit_button', FAST)).toEqual({ swipes: 3, visible: 1, clipped: [] }); // 3700 → 1900
  });

  it('a match that LEAVES the tree is a change: the set the strokes compare is every match, counted — a static duplicate left behind starts the count afresh', async () => {
    resetLayout();
    const ghost = node({ role: 'button', identifier: 'submit_button', rect: { x: 5000, y: 100, width: 100, height: 40 } });
    const real = node({ role: 'button', identifier: 'submit_button', rect: { x: 0, y: 3700, width: 100, height: 40 } });
    const root = screen(ghost, real);
    class DropFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        root.children = root.children.filter((c) => c !== real); // a lazy list drops the real one; the ghost stays
      }
    }
    const fake = new DropFake({ s: root }, 's');
    // Stroke 1: the set changed (two → one); strokes 2 and 3 leave the one where it was.
    await expect(scrollUntilVisible(fake, 'id:submit_button', { ...FAST, maxSwipes: 6 })).rejects.toThrow(/^scroll_until id:submit_button failed after 3 swipes \(the last 2/);
  });

  it('two unmoved strokes count only when they are the SAME stroke: a whole-screen stroke on an IME still coming up, then one drawn above it, is two attempts, not exhaustion', async () => {
    resetLayout();
    const target = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 2900, width: 948, height: 73 } });
    let strokes = 0;
    class FormFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        if (strokes++ < 2) return; // the first two are not taken
        target.rect = { ...target.rect, y: target.rect.y - 600 };
      }
    }
    const fake = new FormFake({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [target] }) }, 's');
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'shown']; // round 0: the stale window denied, so a whole-screen stroke
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, maxSwipes: 6 });
    expect(fake.swipes.slice(0, 2).map((s) => s.from.y)).toEqual([1776, 1118]);
    expect(result).toEqual({ swipes: 5, visible: 1, clipped: [] }); // 2900 → 2300 → 1700 → 1100
  });

  /** An Android form whose window state is scripted read by read; every stroke moves the content 600 px up except those listed. */
  function windowScripted(startY: number, windows: SoftKeyboard[], notTaken: number[] = []) {
    resetLayout();
    const target = node({ role: 'button', identifier: 'row', rect: { x: 66, y: startY, width: 948, height: 73 } });
    let strokes = 0;
    class FormFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        if (notTaken.includes(strokes++)) return;
        target.rect = { ...target.rect, y: target.rect.y - 600 };
      }
    }
    const fake = new FormFake({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [target] }) }, 's');
    fake.attachKeyboard(windows[0], 'shown');
    fake.attachedKeyboard.windowAnswers.queue = [...windows];
    return fake;
  }

  it('fully: true, clipped: the two unmoved strokes must be the SAME stroke — one above the IME, then one whole-screen once the window reads hidden, are two attempts', async () => {
    const shown: SoftKeyboard = { state: 'shown', frame: IME };
    const fake = windowScripted(1360, [shown, { state: 'hidden' }], [0, 1, 2, 3, 4, 5]); // no stroke is taken
    fake.live().children[0].rect = { x: 900, y: 1360, width: 300, height: 73 }; // clipped at the right edge whatever the keyboard
    const error = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect(fake.swipes.map((s) => s.from.y)).toEqual([1118, 1776, 1776]);
    expect((error as Error).message).toMatch(/^scroll_until id:row failed after 3 swipes — element is in the viewport but CLIPPED at right/);
  });

  it('fully: true, clipped: a confirming read is not a stroke for the stuck test, even once two strokes left the row unmoved', async () => {
    const shown: SoftKeyboard = { state: 'shown', frame: IME };
    // 1360 straddles the IME: clipped (two strokes not taken); the window reads hidden — a clean stop; its confirmation
    // reads the IME again and clips it — not "content exhausted": the next stroke scrolls (760).
    const fake = windowScripted(1360, [shown, shown, { state: 'hidden' }, shown], [0, 1]);
    expect(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true })).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('a confirming read is not a stroke for the exhausted count: the stop read without the band, its confirmation under it, then ONE stroke not taken — not "content exhausted"', async () => {
    const shown: SoftKeyboard = { state: 'shown', frame: IME };
    // Round 0 under the IME (stroke above it: 2506 → 1906); the stop at 1906 read with the window hidden; its confirmation with
    // it shown (off the frame); the next stroke is not taken; the one after scrolls (1306).
    const fake = windowScripted(2506, [shown, { state: 'hidden' }, shown], [1]);
    expect(await scrollUntilVisible(fake, 'id:row', FAST)).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('a confirming read is not a stroke for the fully: true stuck test either: a stop it finds clipped at the band, unmoved, is swiped on — not "content exhausted"', async () => {
    const shown: SoftKeyboard = { state: 'shown', frame: IME };
    // 1960 under the IME → 1360; the stop read with the window hidden (fully visible); its confirmation clips it at 1398.
    const fake = windowScripted(1960, [shown, { state: 'hidden' }, shown]);
    expect(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true })).toEqual({ swipes: 2, visible: 1, clipped: [] }); // → 760
  });

  it('a confirming read sent no stroke: a target it finds unmoved but under a keyboard the stop round did not apply is not counted against the content', async () => {
    resetLayout();
    const target = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 2506, width: 948, height: 73 } });
    class FormFake extends FakeAdapter {
      override async swipe(from: Point, to: Point): Promise<void> {
        await super.swipe(from, to);
        target.rect = { ...target.rect, y: target.rect.y - 600 };
      }
    }
    const fake = new FormFake({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [target] }) }, 's');
    fake.attachKeyboard({ state: 'shown', frame: IME }, 'hidden');
    // Denied on round 0 and on the stop at y 1906 (judged whole-screen); confirmed on the read confirming it.
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'hidden', 'shown'];
    const result = await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] }); // 1906 under the IME → one stroke above it → 1306
    expect(fake.swipes[1].from.y).toBe(1118);
  });
});

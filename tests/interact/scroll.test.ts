import { describe, expect, it } from 'vitest';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

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

import { describe, expect, it } from 'vitest';
import type { KeyboardTouchable, Point, Rect, SoftKeyboard } from '../../src/adapters/types.js';
import { parseTouchableRegion } from '../../src/adapters/android.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { GBOARD, GBOARD_PANEL, GBOARD_STRIP } from '../helpers/android-dumps.js';
import { FakeAdapter, node, resetLayout } from '../helpers/fake.js';

/**
 * `scroll_until` under a FLOATING Gboard (device check 2026-10-08,
 * emulator-5554, API 33, 1080x2220 — docs/bugs/2026-10-05-android-floating-
 * gboard-keyboard.md): the window state's band is the 132-px collapse strip
 * [0,2088][1080,2220], the panel [359,1269][1040,1912] is a second rect of
 * the IME window's touchable region, and `scroll_until { …
 * message_for_payee_input, fully: true }` answered "fully visible after 0
 * swipes" for the row (y 1515–1658) behind the panel. Its own file, beside
 * scroll.test.ts's keyboard block, so the two change apart; the fake is the
 * same shape as that block's `formFake`.
 */

const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
const DOCKED: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
const touchableOf = (out: string): KeyboardTouchable => ({ witness: 'shown', region: parseTouchableRegion(out) });

/** A 1080x2220 form with one row, moved up `perSwipe` by a stroke that starts on the content — a stroke that starts on any covered rect presses a key and moves nothing. */
function form({ startY, window, touchable, covered, perSwipe = 600 }: { startY: number; window: SoftKeyboard; touchable: KeyboardTouchable; covered: readonly Rect[]; perSwipe?: number }) {
  resetLayout();
  const row = node({ role: 'textfield', identifier: 'message_for_payee_input', rect: { x: 0, y: startY, width: 1080, height: 143 } });
  const root = node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [row] });
  const inside = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
  class FormFake extends FakeAdapter {
    override async swipe(from: Point, to: Point): Promise<void> {
      await super.swipe(from, to);
      if (covered.some((r) => inside(r, from))) return;
      row.rect = { ...row.rect, y: row.rect.y - perSwipe };
    }
  }
  const fake = new FormFake({ root }, 'root');
  fake.viewportSize = { width: 1080, height: 2220 };
  fake.attachKeyboard(window, 'shown');
  fake.attachedKeyboard.touchableAnswers.current = touchable;
  return { fake, row };
}

const floating = (startY: number, perSwipe?: number) =>
  form({ startY, perSwipe, window: { state: 'shown', frame: GBOARD_STRIP }, touchable: touchableOf(GBOARD.floating.touchable), covered: [GBOARD_PANEL, GBOARD_STRIP] });

describe('scrollUntilVisible — a floating keyboard\'s panel covers as the band does (2026-10-08)', () => {
  it('the measured row BEHIND the panel is not "fully visible after 0 swipes": it is scrolled out from above the panel first', async () => {
    const { fake } = floating(1515);
    const result = await scrollUntilVisible(fake, 'id:message_for_payee_input', { ...FAST, fully: true });
    expect(result).toEqual({ swipes: 1, visible: 1, clipped: [] }); // 915–1058, clear of the panel: not reported
    // The stroke over the screen ABOVE the panel's top (1269), not the strip's (2088): it starts on the content.
    expect(fake.swipes).toEqual([{ from: { x: 540, y: 1016 }, to: { x: 540, y: 254 } }]);
  });

  it('partly behind the panel: CLIPPED at the panel\'s edge, the panel quoted — never "fully visible"', async () => {
    const { fake } = floating(1200);
    const result = await scrollUntilVisible(fake, 'id:message_for_payee_input', FAST);
    expect(result.keyboard).toEqual({ state: 'shown', frame: GBOARD_PANEL });
    expect(describeScrollResult(result)).toBe(
      'visible after 0 swipes — CLIPPED at bottom, 48% of it is in the viewport above the soft keyboard over [359,1269][1040,1912]. ' +
        'A rect assert or screenshot on this element will measure the CLIPPED box',
    );
  });

  it('fully: true, the content exhausted with the row still behind the panel: the keyboard is named, the panel quoted', async () => {
    const { fake } = floating(1200, 0);
    const error = await scrollUntilVisible(fake, 'id:message_for_payee_input', { ...FAST, fully: true }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('above the soft keyboard over [359,1269][1040,1912], and the content is exhausted');
    expect((error as Error).message).toContain('The soft keyboard covers the rest');
  });

  it('the region asked once a round while the band is up — and not at all without it', async () => {
    const { fake } = floating(1515);
    await scrollUntilVisible(fake, 'id:message_for_payee_input', { ...FAST, fully: true });
    expect(fake.attachedKeyboard.touchableAnswers.queries).toBe(2); // two rounds read, the band up in both
    const hidden = form({ startY: 500, window: { state: 'hidden' }, touchable: touchableOf(GBOARD.hidden.touchable), covered: [] });
    await scrollUntilVisible(hidden.fake, 'id:message_for_payee_input', FAST);
    expect(hidden.fake.attachedKeyboard.touchableAnswers.queries).toBe(0);
  });

  it('a panel dragged to the top (y 0): no stroke, and the message says it leaves nothing above its top edge — not that it covers the whole screen', async () => {
    const top = { ...GBOARD_PANEL, y: 0 };
    const { fake } = form({ startY: 1515, window: { state: 'shown', frame: GBOARD_STRIP }, touchable: { witness: 'shown', region: [top, GBOARD_STRIP] }, covered: [top, GBOARD_STRIP] });
    const error = await scrollUntilVisible(fake, 'id:message_for_payee_input', FAST).catch((e: unknown) => e);
    expect((error as Error).message).toContain('the soft keyboard over [359,0][1040,643] leaves nothing of the screen above its top edge, so nothing under it can be judged');
    expect(fake.swipes).toEqual([]);
  });

  it('DOCKED: the region is the band — the stroke and the stop exactly as before this date', async () => {
    const { fake } = form({ startY: 2900, window: { state: 'shown', frame: DOCKED }, touchable: touchableOf(GBOARD.docked.touchable), covered: [DOCKED] });
    const result = await scrollUntilVisible(fake, 'id:message_for_payee_input', FAST);
    expect(result).toEqual({ swipes: 3, visible: 1, clipped: [] });
    // scroll.test.ts's docked stroke: the box above [0,1398][1080,2220].
    expect(fake.swipes[0]).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } });
  });
});

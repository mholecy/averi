import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTouchableRegion } from '../../src/adapters/android-wm.js';
import type { Rect } from '../../src/adapters/types.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';

/**
 * `scroll_until` on the strip between a FLOATING keyboard's panel and its band, over the lab's real capture
 * (form-keyboard-floating, uiautomator, emulator-5554, API 33, Gboard floating): the panel `[71,1092][1008,1884]`, the
 * band `[0,2088][1080,2220]`, the pinned submit `[55,1928][1025,2060]` wholly in the 204-px gap between them — drawn,
 * and tapped there by the capture's probe. The keyboard is served as the device gave it (the window state's band, the
 * IME window's real touchable region), so the cover comes from the reading, not from a hand-built one; every read
 * serves the same tree and no stroke moves anything (the bar is pinned).
 * docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md
 */

const CAPTURE = '../fixtures/truth/android-averi_lab-api33/form-keyboard-floating';
const XML = readFileSync(new URL(`${CAPTURE}.xml`, import.meta.url), 'utf8');
const IME = JSON.parse(readFileSync(new URL(`${CAPTURE}.ime.json`, import.meta.url), 'utf8')) as { shown: { touchable: string } };
const BAND: Rect = { x: 0, y: 2088, width: 1080, height: 132 };
const SUBMIT = 'id:"lab.form-keyboard-floating.submit"';
const SUBMIT_BOUNDS = 'bounds="[55,1928][1025,2060]"';
const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
/** The straddling submit's failure as worded with no gap rule (the base commit's reply, verbatim): the gap judgement is dropped, never worded. */
const STRADDLING =
  'scroll_until id:"lab.form-keyboard-floating.submit" failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken) — ' +
  'element in tree but never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,1884] (last rect {"x":55,"y":1860,"width":970,"height":132}). ' +
  'The soft keyboard was up over [71,1092][1008,1884] in 3 of the 3 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — ' +
  'to reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again';

/** The capture served unchanged, or with nodes edited (`submitAt` moves the submit, `moved` edits any other attribute text, each once) and the region replaced (`region`). */
function floating({ submitAt, moved = [], region = IME.shown.touchable }: { submitAt?: string; moved?: readonly [from: string, to: string][]; region?: string } = {}) {
  const edits = submitAt === undefined ? moved : [...moved, [SUBMIT_BOUNDS, `bounds="${submitAt}"`] as const];
  const xml = edits.reduce((x, [from, to]) => {
    if (!x.includes(from)) throw new Error(`no ${from} in the capture`);
    return x.replace(from, to);
  }, XML);
  const fake = new FakeAdapter({ s: parseDump(xml) }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  // The witness answers shown when asked: a test that pins it unasked counts its queries.
  const keyboard = fake.attachKeyboard({ state: 'shown', frame: BAND }, 'shown');
  keyboard.touchableAnswers.current = { witness: 'shown', region: parseTouchableRegion(region) };
  return { fake, keyboard };
}
const failure = async (fake: FakeAdapter, selector: string, options: Parameters<typeof scrollUntilVisible>[2] = FAST): Promise<string> => {
  const e = (await scrollUntilVisible(fake, selector, options).catch((err: unknown) => err)) as Error;
  expect(e).toBeInstanceOf(Error);
  return e.message;
};

describe('scroll_until on the gap between a floating keyboard\'s panel and its band', () => {
  it('the pinned submit wholly in the gap: fully visible after 0 swipes — no stroke, the witness not asked (the cover is moot)', async () => {
    const { fake, keyboard } = floating();
    const result = await scrollUntilVisible(fake, SUBMIT, FAST);
    expect(result).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes');
    expect(fake.swipes).toEqual([]);
    expect(keyboard.witnessAnswers.queries).toBe(0);
  });

  it('fully: true — the same stop, no stroke', async () => {
    const { fake } = floating();
    const result = await scrollUntilVisible(fake, SUBMIT, { ...FAST, fully: true });
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes');
    expect(fake.swipes).toEqual([]);
  });

  it('ks, its centre under the panel: never visible — the cut above the panel stands, the panel quoted', async () => {
    const message = await failure(floating().fake, 'id:"lab.form-keyboard-floating.ks"', { ...FAST, maxSwipes: 1 });
    expect(message).toContain('above the soft keyboard over [71,1092][1008,1884]');
  });

  it('the submit straddling the panel\'s bottom edge (y 1860): refused, worded as with no gap rule', async () => {
    const message = await failure(floating({ submitAt: '[55,1860][1025,1992]' }).fake, SUBMIT);
    expect(message).toBe(STRADDLING);
  });

  it('the submit on the band (y 2088..2220): refused, never visible', async () => {
    const message = await failure(floating({ submitAt: '[55,2088][1025,2220]' }).fake, SUBMIT);
    expect(message).toContain('never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,1884]');
  });

  it('a target beside the panel (x 0..60, in the panel\'s rows): refused — the gap lies below every panel', async () => {
    const message = await failure(floating({ submitAt: '[0,1200][60,1300]' }).fake, SUBMIT);
    expect(message).toContain('never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,1884]');
  });

  it('ss moved wholly into the gap but under the submit\'s bar, drawn over it: the gap judgement does not stop clean and is dropped — refused as above the panel, never worded as in the gap', async () => {
    const message = await failure(floating({ moved: [['bounds="[55,1826][1025,1928]"', 'bounds="[55,1930][1025,2050]"']] }).fake, 'id:"lab.form-keyboard-floating.ss"', { ...FAST, maxSwipes: 1 });
    expect(message).toContain('never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,1884]');
  });

  it('a region only partly admitted — a rect off the band\'s screen dropped, lying over the submit: no gap, the submit refused as with no gap rule', async () => {
    for (const dropped of ['(-10,1900,1008,2000)', '(500,1900,1100,2000)']) {
      const message = await failure(floating({ region: `    touchable region=SkRegion((71,1092,1008,1884)${dropped}(0,2088,1080,2220))\n` }).fake, SUBMIT);
      expect(message).toContain('never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,1884]');
    }
  });

  it('two matches, one beside the panel and one wholly in the gap: the gap stop is said with no keyboard — it lies under none of it', async () => {
    const anchor = '<node index="2" text="" resource-id="lab.form-keyboard-floating.submit"';
    const twin = '<node index="9" text="" resource-id="lab.form-keyboard-floating.submit" class="android.view.View" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1300][54,1400]"/>';
    const { fake } = floating({ moved: [[anchor, twin + anchor]] });
    const result = await scrollUntilVisible(fake, SUBMIT, FAST);
    expect(describeScrollResult(result)).toBe('fully visible after 0 swipes');
    expect(result).not.toHaveProperty('keyboard');
    expect(fake.swipes).toEqual([]);
  });

  it('a panel reaching into the band\'s rows (bottom 2100): no gap — the submit refused as with no gap rule', async () => {
    const message = await failure(floating({ region: '    touchable region=SkRegion((71,1092,1008,2100)(0,2088,1080,2220))\n' }).fake, SUBMIT);
    expect(message).toContain('never intersected the 1080x1092 screen above the soft keyboard over [71,1092][1008,2100]');
  });
});


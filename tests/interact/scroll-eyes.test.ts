import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import type { Eyes, EyesAnswer } from '../../src/ui-tree/eyes.js';
import { eyesOn } from '../../src/verify/eyes.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * THE EYES CONFIRM A FULLY CLAIM (ui-tree/eyes.ts), through scroll_until — the lab's real k7 stop (`form-keyboard`
 * after the one stroke averi drew, the IME up: `phone` `55,1113 970x125` flush with the submit bar's node, 28 px of the
 * bar's node-less padding over it) and its launch and after-back captures, served unchanged by every read with the
 * captured png. The screenshots the fake was asked for are counted: one per claim the trigger applies to, none else.
 */

const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
const PHONE = 'id:"lab.form-keyboard.phone"';
const fixture = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url);

const fakeOf = async (xml: string, { ime = true } = {}): Promise<FakeAdapter> => {
  const fake = new FakeAdapter({ s: parseDump(await readFile(fixture(xml), 'utf8')) }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  fake.nextScreenshot = await readFile(fixture('android-lab-form-keyboard-k7-stop.png'));
  if (ime) fake.attachKeyboard({ state: 'shown', frame: IME }, 'shown');
  return fake;
};
const k7 = (): Promise<FakeAdapter> => fakeOf('android-lab-form-keyboard-k7-stop.xml');

const SURFACE =
  'its bottom 28 px show #F2F2F7, the colour beside container id:lab.form-keyboard.submit (55,1238 970x132) drawn after it, not its own #FFFFFF (a screenshot)';

describe('scroll_until — the eyes confirm a fully claim', () => {
  it('k7, the plain stop: stops (its centre is clear) and says the 28 px of the bar\'s padding over it — not "fully visible"; one screenshot', async () => {
    const fake = await k7();
    const reply = describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, eyes: eyesOn(fake) }));
    expect(reply).toBe(
      `visible after 0 swipes — PARTLY UNDER a surface the tree does not list: ${SURFACE}, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too`,
    );
    expect(fake.screenshots).toHaveLength(1);
    expect(fake.swipes).toEqual([]);
  });

  it('k7, fully: true: no stop on it — the strokes go on, and moving nothing, the failure names the surface; one screenshot per claim', async () => {
    const fake = await k7();
    const failure = (await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(`element is in the viewport but ${SURFACE} — and the content is exhausted`);
    // Two strokes down that moved nothing, one back up that moved it neither (the stuck test, as for a cover).
    expect(fake.swipes).toHaveLength(3);
    // ONE screenshot: each read after a stroke finds phone and the bar where the eyes refused them — refused again, unlooked.
    expect(fake.screenshots).toHaveLength(1);
  });

  it('k7, fully: true at the bound (maxSwipes: 0): the bound names the surface', async () => {
    const fake = await k7();
    await expect(scrollUntilVisible(fake, PHONE, { ...FAST, maxSwipes: 0, fully: true, eyes: eyesOn(fake) })).rejects.toThrow(
      `failed after 0 swipes (maxSwipes) — element reached the viewport but stayed PARTLY UNDER a surface the tree does not list: ${SURFACE} (last rect {"x":55,"y":1113,"width":970,"height":125})`,
    );
    expect(fake.screenshots).toHaveLength(1);
  });

  it('k7, the eyes see its own colour to the edge: "fully visible", as before', async () => {
    const fake = await k7();
    const own: Eyes = async () => ({ sees: 'own' });
    expect(describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: own }))).toBe('fully visible after 0 swipes');
  });

  it('k7, the eyes cannot tell: the claim is the tree\'s, the edge and why said', async () => {
    const fake = await k7();
    const unjudged: Eyes = async (): Promise<EyesAnswer> => ({ sees: 'unjudged', why: 'the screenshot failed: offline' });
    expect(describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: unjudged }))).toBe(
      'fully visible by the tree after 0 swipes; its bottom edge lies flush with container id:lab.form-keyboard.submit (55,1238 970x132), drawn after it outside its scroll view, ' +
        'whose surface may draw past that node over it — the tree lists none there, and a screenshot could not tell (the screenshot failed: offline)',
    );
  });

  it('k7 with no eyes handed in: the tree\'s claim, unchecked, said so', async () => {
    const fake = await k7();
    const reply = describeScrollResult(await scrollUntilVisible(fake, PHONE, FAST));
    expect(reply).toMatch(/^fully visible by the tree after 0 swipes; its bottom edge lies flush with container id:lab\.form-keyboard\.submit .* \(no screenshot was taken\)$/);
    expect(fake.screenshots).toHaveLength(0);
  });
});

describe('scroll_until — no screenshot on an ordinary stop (the trigger is narrow)', () => {
  it('k7: the title of city, clear of the bar — "fully visible", no screenshot, plain or fully: true', async () => {
    for (const fully of [false, true]) {
      const fake = await k7();
      expect(describeScrollResult(await scrollUntilVisible(fake, 'id:"lab.form-keyboard.city.title"', { ...FAST, fully, eyes: eyesOn(fake) }))).toBe('fully visible after 0 swipes');
      expect(fake.screenshots).toHaveLength(0);
    }
  });

  it('after back, phone whole above the bar (no node flush with it): no screenshot', async () => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    expect(await scrollUntilVisible(fake, PHONE, { ...FAST, eyes: eyesOn(fake) })).toMatchObject({ swipes: 0, clipped: [] });
    expect(fake.screenshots).toHaveLength(0);
  });

  it('at launch, phone a strip cut by the bar (no stop, so no claim): strokes, never a screenshot', async () => {
    const fake = await fakeOf('android-lab-form-keyboard.xml');
    await scrollUntilVisible(fake, PHONE, { ...FAST, eyes: eyesOn(fake) }).catch(() => undefined);
    expect(fake.swipes.length).toBeGreaterThan(0);
    expect(fake.screenshots).toHaveLength(0);
  });

  it('a row flush with a pinned bar but partly under a badge: its reply already says so (no "fully" claim) — the eyes are not asked', async () => {
    const row = node({ role: 'textfield', identifier: 'row', rect: { x: 40, y: 1700, width: 1000, height: 132 } });
    const tree = node({
      role: 'container',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      children: [
        node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 0, width: 1080, height: 2000 }, children: [row] }),
        node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 1832, width: 1080, height: 168 } }),
        node({ role: 'button', identifier: 'badge', rect: { x: 900, y: 1710, width: 100, height: 40 } }),
      ],
    });
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    let asked = 0;
    const eyes: Eyes = async () => (asked++, { sees: 'own' });
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:row', { ...FAST, eyes }))).toMatch(/^visible after 0 swipes — PARTLY UNDER button id:badge/);
    expect(asked).toBe(0);
    // The same row with the badge gone: the claim is "fully", and the eyes are asked once.
    const bare = { ...tree, children: tree.children.slice(0, 2) };
    const clean = new FakeAdapter({ s: bare }, 's');
    clean.viewportSize = { width: 1080, height: 2220 };
    expect(describeScrollResult(await scrollUntilVisible(clean, 'id:row', { ...FAST, eyes }))).toBe('fully visible after 0 swipes');
    expect(asked).toBe(1);
  });
});

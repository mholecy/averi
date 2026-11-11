import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import type { Eyes, EyesAnswer } from '../../src/ui-tree/eyes.js';
import { eyesOn } from '../../src/verify/eyes.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter, node } from '../helpers/fake.js';
import { NO_EYES } from '../helpers/eyes.js';

/**
 * THE EYES CONFIRM A FULLY CLAIM (ui-tree/eyes.ts), through scroll_until — the lab's real k7 stop (`form-keyboard`
 * after the one stroke averi drew, the IME up: `phone` `55,1113 970x125` flush with the submit bar's node, 28 px of the
 * bar's node-less padding over it) and its launch and after-back captures, served unchanged by every read with the
 * captured png. The screenshots the fake was asked for are counted: one per claim the trigger applies to, none else.
 */

const IME: Rect = { x: 0, y: 1398, width: 1080, height: 822 };
const FAST = { eyes: NO_EYES, maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
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

/** A row in a clipping list (to 2000), flush with a full-width `bar` 0,1832 1080x168 laid outside it: the row's x and width as given. */
const barOver = ({ x, width }: { x: number; width: number }): FakeAdapter => {
  const row = node({ role: 'textfield', identifier: 'row', rect: { x, y: 1700, width, height: 132 } });
  const tree = node({
    role: 'container',
    rect: { x: 0, y: 0, width: 1080, height: 2220 },
    children: [
      node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 0, width: 1080, height: 2000 }, children: [row] }),
      node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 1832, width: 1080, height: 168 } }),
    ],
  });
  const fake = new FakeAdapter({ s: tree }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  return fake;
};

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
    // Two strokes down that moved nothing, and none back up: that would only push it further under the bar (live k7).
    expect(failure.message).toContain('swiping down no longer moves it, and swiping up would only push it further under that surface. That surface stays over it at the end of the content');
    expect(fake.swipes).toHaveLength(2);
    // The bar rides on the IME the window state reads (unwitnessed: the band was moot over phone): the remedy, as an "if".
    expect(failure.message).toContain(
      'if the soft keyboard is still up (the window state reads its top edge at y 1398, that node riding on it), dismiss it first (press_key back from the MCP tools; ',
    );
    // ONE screenshot: each read after a stroke finds phone and the bar where the eyes refused them — refused again, unlooked.
    expect(fake.screenshots).toHaveLength(1);
  });

  it('T17: an unlocated keyboard never meets a surface the eyes saw on a stop — under fully: true a surface is no stop (scroll-rounds.ts, the eyes\' gate), and `unlocated` is asked of fully: true stops only — so every stop with it carries the UNCOVERED lead', async () => {
    // k7's tree, the window state giving the keyboard no area while the input method says shown: the `unlocated` row.
    const surfaced = await fakeOf('android-lab-form-keyboard-k7-stop.xml', { ime: false });
    surfaced.attachKeyboard({ state: 'hidden' }, 'shown');
    await expect(scrollUntilVisible(surfaced, PHONE, { ...FAST, maxSwipes: 0, fully: true, eyes: eyesOn(surfaced) })).rejects.toThrow(/PARTLY UNDER a surface the tree does not list/);
    // The eyes unable to tell: a stop, the keyboard hedge its lead.
    const untold = await fakeOf('android-lab-form-keyboard-k7-stop.xml', { ime: false });
    untold.attachKeyboard({ state: 'hidden' }, 'shown');
    const unjudged: Eyes = { fully: async ({ edges }): Promise<EyesAnswer> => ({ sees: 'unjudged', edge: edges[0]!.edge, by: edges[0]!.by as UiNode, why: 'the screenshot failed: offline' }), order: async () => [] };
    const result = await scrollUntilVisible(untold, PHONE, { ...FAST, fully: true, eyes: unjudged });
    expect(result.keyboard).toEqual({ state: 'unlocated' });
    expect(describeScrollResult(result)).toMatch(/^visible by the tree after 0 swipes, NOT CONFIRMED UNCOVERED: the input method reports a soft keyboard shown/);
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
    const own: Eyes = { fully: async () => ({ sees: 'own' }), order: async () => [] };
    expect(describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: own }))).toBe('fully visible after 0 swipes');
  });

  it('k7, the eyes cannot tell: the claim is the tree\'s, the edge and why said', async () => {
    const fake = await k7();
    const unjudged: Eyes = { fully: async ({ edges }): Promise<EyesAnswer> => ({ sees: 'unjudged', edge: edges[0]!.edge, by: edges[0]!.by as UiNode, why: 'the screenshot failed: offline' }), order: async () => [] };
    expect(describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: unjudged }))).toBe(
      'fully visible by the tree after 0 swipes; its bottom edge lies flush with container id:lab.form-keyboard.submit (55,1238 970x132), drawn after it outside its scroll view, ' +
        'whose surface may draw past that node over it — the tree lists none there, and a screenshot could not tell (the screenshot failed: offline)',
    );
  });

  // Since A30 the eyes are required, so "no eyes" is no longer a path of scroll.ts: this pins how NO_EYES, the tests'
  // fake (tests/helpers/eyes.ts), words its answer — ui-tree/eyes.ts#unseen's, the tree's claim, unchecked.
  it('k7 under NO_EYES: unseen\'s wording — the tree\'s claim, unchecked, "no screenshot was taken"', async () => {
    const fake = await k7();
    const reply = describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, eyes: NO_EYES }));
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
        node({ role: 'button', identifier: 'bar', rect: { x: 20, y: 1832, width: 1040, height: 168 } }),
        node({ role: 'button', identifier: 'badge', rect: { x: 900, y: 1710, width: 100, height: 40 } }),
      ],
    });
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    let asked = 0;
    const eyes: Eyes = { fully: async () => (asked++, { sees: 'own' }), order: async () => [] };
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:row', { ...FAST, eyes }))).toMatch(/^visible after 0 swipes — PARTLY UNDER button id:badge/);
    expect(asked).toBe(0);
    // The same row with the badge gone: the claim is "fully", and the eyes are asked once.
    const bare = { ...tree, children: tree.children.slice(0, 2) };
    const clean = new FakeAdapter({ s: bare }, 's');
    clean.viewportSize = { width: 1080, height: 2220 };
    expect(describeScrollResult(await scrollUntilVisible(clean, 'id:row', { ...FAST, eyes }))).toBe('fully visible after 0 swipes');
    expect(asked).toBe(1);
  });

  it('a bar as wide as the screen flush with a row as wide: not asked, the tree\'s claim as before (no screen beside the bar to read its surface from, and no end of the bar past the row\'s)', async () => {
    const fake = barOver({ x: 0, width: 1080 });
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true, eyes: eyesOn(fake) }))).toBe('fully visible after 0 swipes');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('the same bar over an INSET row, reaching past it at both ends: not asked either — in a scroll view a flush bar is no overlay (ui-tree/later-edges.ts#OverlaidEdge: at rest the last row lies whole on it, the same tree), the tree\'s claim as before', async () => {
    const fake = barOver({ x: 40, width: 1000 });
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:row', { ...FAST, fully: true, eyes: eyesOn(fake) }))).toBe('fully visible after 0 swipes');
    expect(fake.screenshots).toHaveLength(0);
  });
});

/** A 1080x2220 png filled by `rects` in order (each x0, y0, x1, y1 and its colour) over white. */
function pngOf(rects: [number, number, number, number, number[]][]): Buffer {
  const png = new PNG({ width: 1080, height: 2220 });
  png.data.fill(255);
  for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) png.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 1080 + x) * 4);
  return PNG.sync.write(png);
}

describe('scroll_until — the eyes against what the tree already rules (the reviewer\'s shapes)', () => {
  const GREY = [0xf2, 0xf2, 0xf7];
  const PURPLE = [0x67, 0x50, 0xa4];
  const TITLE = 'id:"lab.form-keyboard.note.title"';

  it('after back, note\'s title (55,1952 219x42) flush with the bar, the bar\'s padding 23 px over it — past its centre (1973): no plain stop, as a cover over its centre is none', async () => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    fake.nextScreenshot = pngOf([
      [0, 1971, 1080, 2154, GREY],
      [55, 1994, 1025, 2126, PURPLE],
    ]);
    const failure = (await scrollUntilVisible(fake, TITLE, { ...FAST, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('its bottom 23 px show #F2F2F7, the colour beside container id:lab.form-keyboard.submit (55,1994 970x132) drawn after it, not its own #FFFFFF (a screenshot)');
    expect(fake.screenshots).toHaveLength(1);
  });

  it('…the padding 28 px over it, its glyphs past the band: a band of 28 (its own colour read past the band, not the half away from the edge)', async () => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    fake.nextScreenshot = pngOf([
      [55, 1955, 200, 1985, [30, 30, 30]],
      [0, 1966, 1080, 2154, GREY],
      [55, 1994, 1025, 2126, PURPLE],
    ]);
    const failure = (await scrollUntilVisible(fake, TITLE, { ...FAST, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure.message).toMatch(/its bottom 28 px show #F2F2F7, the colour beside container id:lab\.form-keyboard\.submit \(55,1994 970x132\) drawn after it, not its own #[0-9A-F]{6} \(a screenshot\)/);
  });

  it('…the padding 10 px over it, clear of its centre: the plain stop stops and says it', async () => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    fake.nextScreenshot = pngOf([
      [0, 1984, 1080, 2154, GREY],
      [55, 1994, 1025, 2126, PURPLE],
    ]);
    expect(describeScrollResult(await scrollUntilVisible(fake, TITLE, { ...FAST, eyes: eyesOn(fake) }))).toMatch(/^visible after 0 swipes — PARTLY UNDER a surface the tree does not list: its bottom 10 px show #F2F2F7/);
  });

  it('k7\'s tree on a grouped grey background with no bar padding: the node\'s own margin is not called a surface — fully: true says the tree\'s claim, unchecked, and why', async () => {
    const fake = await k7();
    fake.nextScreenshot = pngOf([
      [0, 0, 1080, 2220, GREY],
      [55, 1129, 1025, 1228, [255, 255, 255]],
      [55, 1238, 1025, 1370, PURPLE],
    ]);
    const reply = describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: eyesOn(fake) }));
    expect(reply).toMatch(/^fully visible by the tree after 0 swipes; .* \(the screen beside it shows that surface's colour #F2F2F7 too: the band may be its own margin over that background\)$/);
  });
});

/**
 * A TEXT IN A CONTROL'S TOUCH MARGIN (ui-tree/cover.ts#marginText, ADR 0026), through scroll_until: after `back`, phone's
 * dumped touch target `55,1280 970x132` reaches 6 px under the next field's title `vs.title` `55,1406 258x56`, though
 * what phone draws ends 11 px above it. The tree only suspects; one screenshot decides, once per call.
 * docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
 */
describe('scroll_until — fully: true on a field under a text in its touch margin', () => {
  const afterBack = async (png: Buffer): Promise<FakeAdapter> => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    fake.nextScreenshot = png;
    return fake;
  };

  it('the overlap white as phone\'s rows beside the title: fully visible, no stroke, one screenshot, the reply says what the eyes excused', async () => {
    const fake = await afterBack(pngOf([]));
    const reply = describeScrollResult(await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: eyesOn(fake) }));
    expect(reply).toBe(
      'fully visible after 0 swipes — text "Variable symbol" (55,1406 258x56), drawn after it, overlaps its bottom 6 px with nothing a screenshot shows (Android dumps a control\'s touch target, past what it draws)',
    );
    expect(fake.screenshots).toHaveLength(1);
    expect(fake.swipes).toEqual([]);
  });

  it('ink in the band: the cover stands — the failure says what the screenshot showed, and no read after a stroke looks again', async () => {
    const fake = await afterBack(pngOf([[60, 1406, 300, 1412, [30, 30, 30]]]));
    const failure = (await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('under text "Variable symbol" (55,1406 258x56), drawn over it — 99% of it shows — a screenshot shows it drawn over its bottom 6 px');
    // Nothing moved (the content exhausted at once): the strokes' own failure, never the carried text's.
    expect(failure.message).toContain('and the content is exhausted');
    expect(failure.message).not.toContain('moved with it');
    expect(fake.swipes.length).toBeGreaterThan(0);
    expect(fake.screenshots).toHaveLength(1);
  });

  it('the eyes cannot tell (no screenshot): the cover stands, said why', async () => {
    const fake = await afterBack(pngOf([]));
    const blind: Eyes = { fully: async () => ({ sees: 'own' }), order: async (q) => q.pairs.map(({ peer }) => ({ peer, seen: 'untold', why: 'the screenshot failed: offline' })) };
    const failure = (await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: blind }).catch((e: unknown) => e)) as Error;
    expect(failure.message).toContain('drawn over it — 99% of it shows — a screenshot could not tell whether it draws over it (the screenshot failed: offline)');
  });

  it('no eyes handed in: today\'s failure, word for word, and no screenshot', async () => {
    const fake = await afterBack(pngOf([]));
    const failure = (await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true }).catch((e: unknown) => e)) as Error;
    expect(failure.message).toContain('element is in the viewport but under text "Variable symbol" (55,1406 258x56), drawn over it — 99% of it shows — and the content is exhausted');
    expect(fake.screenshots).toHaveLength(0);
  });
});

/**
 * WHAT WAS SEEN OF A MARGIN TEXT, KEPT (interact/margin-memo.ts) across the reads of one call: the
 * after-back form served first 700 px lower (phone below the viewport: a stroke), then where it was captured — the clear
 * question asked there — then, for the read that confirms the stop, either there again or 10 px higher. A `clear` is an
 * answer of the frame it was read on: kept while the two lie where they were seen, asked again once they moved; the
 * answer given then replaces it. A text seen drawn over the field is kept while the two keep that relation — where
 * they were, or carried together in a scroll view that stayed put — and asked again once it changed.
 */
describe('scroll_until — what was seen of a margin text, kept across the reads of the call', () => {
  const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, rect: { ...n.rect, y: n.rect.y + dy }, children: n.children.map((c) => shifted(c, dy)) });
  /** `tree` with the content of its largest clipping container moved `dy` (the container itself where it is). */
  const scrolled = (tree: UiNode, dy: number): UiNode => {
    const clips = (n: UiNode): UiNode[] => [...(n.clipsDescendants ? [n] : []), ...n.children.flatMap(clips)];
    const list = clips(tree).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]!;
    const walk = (n: UiNode): UiNode => (n === list ? { ...n, children: n.children.map((c) => shifted(c, dy)) } : { ...n, children: n.children.map(walk) });
    return walk(tree);
  };
  /** `tree` with the node `id` moved `dy` more (a text pinned over the content, or moved by its own layout). */
  const nudged = (tree: UiNode, id: string, dy: number): UiNode => (tree.identifier === id ? shifted(tree, dy) : { ...tree, children: tree.children.map((c) => nudged(c, id, dy)) });
  const VS_TITLE = 'lab.form-keyboard.vs.title';
  /** The after-back form served as `readsOf(base)` gives it, read for read (the last again for every later read); the eyes answer each clear question as `answers` say, in turn. */
  const play = async (readsOf: (base: UiNode) => UiNode[], answers: readonly ('clear' | 'under' | 'untold')[]) => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    const reads = readsOf(await fake.uiTree());
    let n = 0;
    fake.uiTree = async () => structuredClone(reads[Math.min(n++, reads.length - 1)]!);
    const asked: number[] = [];
    const eyes: Eyes = {
      fully: async () => ({ sees: 'own' }),
      order: async (q) => {
        asked.push(n);
        const seen = answers[asked.length - 1] ?? 'clear';
        return q.pairs.map(({ peer }) =>
          seen === 'clear'
            ? { peer, seen, overlap: '#FFFFFF', beside: '#FFFFFF' }
            : seen === 'untold'
              ? { peer, seen, why: 'it is not one colour beside the text' }
              : { peer, seen, overlap: '#1E1E1E', own: '#FFFFFF', other: '#1E1E1E' },
        );
      },
    };
    const outcome = await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes }).then(describeScrollResult, (e: unknown) => (e as Error).message);
    return { outcome, asked, swipes: fake.swipes.length, screenshots: fake.screenshots.length };
  };
  const run = (confirmDy: number, answers: readonly ('clear' | 'under' | 'untold')[]) => play((base) => [scrolled(base, 700), base, scrolled(base, confirmDy)], answers);

  it('nothing moved between the read that saw it clear and the one confirming: the answer reused — one question, fully visible', async () => {
    const { outcome, asked } = await run(0, ['clear']);
    expect(outcome).toMatch(/^fully visible after 1 swipe — text "Variable symbol" .* with nothing a screenshot shows/);
    expect(asked).toHaveLength(1);
  });

  it('the two moved 10 px before the confirming read: asked again — seen drawn over it there, the cover stands, and no later read asks again', async () => {
    const { outcome, asked, swipes } = await run(-10, ['clear', 'under']);
    expect(asked).toHaveLength(2);
    expect(outcome).toContain('under text "Variable symbol"');
    expect(outcome).toContain('a screenshot shows it drawn over its bottom 6 px');
    expect(swipes).toBeGreaterThan(1);
  });

  it('untold where it was first asked (a blended frame), the two moved by the next stroke: asked again there — seen clear, fully visible', async () => {
    const { outcome, asked } = await run(-10, ['untold', 'clear']);
    expect(asked).toHaveLength(2);
    expect(outcome).toMatch(/^fully visible after \d+ swipes? — text "Variable symbol"/);
  });

  it('seen drawn over it, then carried with it by a stroke (both 300 px up): no stroke can clear it — the call fails at once, today\'s words, one question', async () => {
    const { outcome, asked, swipes } = await play((base) => [base, scrolled(base, -300)], ['under']);
    expect(outcome).toContain(
      'failed after 1 swipe (the text drawn over it moved with it, both by 0,-300 since a screenshot saw it there: it scrolls with the element, so no swipe brings the element out from under it) — ' +
        'element reached the viewport but stayed under text "Variable symbol" (55,1106 258x56), drawn over it — 99% of it shows — a screenshot shows it drawn over its bottom 6 px',
    );
    expect(swipes).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it('seen drawn over it, then a stroke moved the field and not the text the same way (pinned, 3 px apart): asked again — seen clear, fully visible', async () => {
    const { outcome, asked } = await play((base) => [base, nudged(scrolled(base, -300), VS_TITLE, -3)], ['under', 'clear']);
    expect(outcome).toMatch(/^fully visible after 1 swipe — text "Variable symbol" .* with nothing a screenshot shows/);
    expect(asked).toHaveLength(2);
  });

  it('seen drawn over it, then a stroke carried the field clear of the text (pinned where it was): fully visible, nothing asked again', async () => {
    const { outcome, asked } = await play((base) => [base, nudged(scrolled(base, -300), VS_TITLE, 300)], ['under']);
    expect(outcome).toBe('fully visible after 1 swipe');
    expect(asked).toHaveLength(1);
  });

  it('seen drawn over it, then the whole screen moved with the two (a sheet dragged, its scroll view with it): asked again, no fail at once — the next stroke leaves the pinned text behind, fully visible', async () => {
    const shiftedAll = (base: UiNode) => shifted(base, -300);
    const { outcome, asked, swipes } = await play((base) => [base, shiftedAll(base), nudged(scrolled(shiftedAll(base), -300), VS_TITLE, 300)], ['under', 'under']);
    expect(asked).toHaveLength(2);
    expect(swipes).toBe(2);
    expect(outcome).toBe('fully visible after 2 swipes');
  });

  it('the real eyes on ink in the band, then the form carried 300 px up: the call fails at once on the one screenshot', async () => {
    const fake = await fakeOf('android-lab-form-keyboard-after-back.xml', { ime: false });
    fake.nextScreenshot = pngOf([[60, 1406, 300, 1412, [30, 30, 30]]]);
    const base = await fake.uiTree();
    const reads = [base, scrolled(base, -300)];
    let n = 0;
    fake.uiTree = async () => structuredClone(reads[Math.min(n++, reads.length - 1)]!);
    const failure = (await scrollUntilVisible(fake, PHONE, { ...FAST, fully: true, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure.message).toContain('failed after 1 swipe (the text drawn over it moved with it, both by 0,-300 since a screenshot saw it there');
    expect(failure.message).toContain('a screenshot shows it drawn over its bottom 6 px');
    expect(fake.swipes).toHaveLength(1);
    expect(fake.screenshots).toHaveLength(1);
  });

  it('seen drawn over it, then carried with it in a tree that marks no scroll view: asked again, no fail at once — no content the tree marks to be carried in', async () => {
    const unmarked = ({ clipsDescendants: _, ...n }: UiNode): UiNode => ({ ...n, children: n.children.map(unmarked) });
    const { outcome, asked, swipes } = await play((base) => [unmarked(base), unmarked(scrolled(base, -300))], ['under', 'under']);
    expect(asked).toHaveLength(2);
    expect(outcome).not.toContain('moved with it');
    expect(outcome).toContain('failed after 4 swipes — element is in the viewport but under text "Variable symbol"');
    expect(swipes).toBe(4);
  });

  it('untold where it was asked, then carried with it: asked again (an answer of its frame), and the strokes go on — untold never fails at once', async () => {
    const { outcome, asked, swipes } = await play((base) => [base, scrolled(base, -300)], ['untold', 'untold']);
    expect(asked).toHaveLength(2);
    expect(outcome).toContain('a screenshot could not tell whether it draws over it');
    expect(outcome).not.toContain('moved with it');
    expect(swipes).toBeGreaterThan(1);
  });
});

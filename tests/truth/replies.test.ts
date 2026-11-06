import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type PresentationKind, type Rect } from '../../src/adapters/types.js';
import type { MarkedLayer } from '../../src/ui-tree/presentation.js';
import { ACTIVE_WINDOW_HINT, COVERED_FIRST, IDB_UNLISTS, missNote, withMissNote } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
import { boundText, describeScrollResult, flushText } from '../../src/interact/scroll-text.js';
import { CAROUSEL_REPLY_WORDS, carouselReply, MAX_SWIPES, flushProbedSide, idbReasonsSaid, inferredAxisSaid, noIdListedSaid, OCR_FAILED_CLOSED, presentedRemedySaid, windowHintSaid, heldCutHedged } from '../../scripts/truth/replies.js';
import { parseDump } from '../helpers/android-dumps.js';
import { failureOf, play, resultOf, type Row } from '../helpers/rounds.js';

// The two "close it first" the harness reads apart (scripts/truth/replies.ts): the presented remedy, driven here by
// src's own builders (ui-tree/standing.ts#presentedRemedy, #presentedStop) over every layer they word, and the
// active-window hint (#ACTIVE_WINDOW_HINT), which is no presented remedy.

/** Every presentation kind — the type check below fails when src adds one this list lacks. */
const KINDS = ['alert', 'actionSheet', 'popover', 'dialog', 'screen', 'backdrop'] as const satisfies readonly PresentationKind[];
const everyKind: Exclude<PresentationKind, (typeof KINDS)[number]> extends never ? true : false = true;

const LAYERS: readonly (MarkedLayer | undefined)[] = [undefined, ...KINDS.flatMap((kind) => [{ kind }, { kind, label: 'Delete account?' }])];

describe('presentedRemedySaid: the presented remedy in every wording src builds', () => {
  it.each(LAYERS.flatMap((layer) => (['it', 'the element'] as const).map((what) => [what, layer] as const)))('presentedRemedy(%s, %o)', (what, layer) => {
    expect(everyKind).toBe(true);
    const remedy = presentedRemedy(what, layer);
    expect(presentedRemedySaid(`ERROR id:"lab.x" is under … — ${remedy}; nothing was tapped`)).toBe(true);
    expect(windowHintSaid(remedy)).toBe(false);
  });

  it.each(LAYERS.map((layer) => [layer] as const))('presentedStop(%o)', (layer) => {
    expect(presentedRemedySaid(`ERROR scroll_until id:"lab.x" stopped before any swipe — … — ${presentedStop(layer)}, so none was sent`)).toBe(true);
  });

  it('not the active-window hint, nor a bare "close it first"', () => {
    const hinted = `ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear\n  (${ACTIVE_WINDOW_HINT})`;
    expect(presentedRemedySaid(hinted)).toBe(false);
    expect(windowHintSaid(hinted)).toBe(true);
    expect(presentedRemedySaid('ERROR … — close it first; nothing was tapped')).toBe(false);
  });
});

describe('idbReasonsSaid: idb\'s reasons, read off both of its dialect notes (src/ui-tree/miss.ts#missNote)', () => {
  it.each(['idUnlisted', 'noIdListed'] as const)('the %s note, as a not-found carries it', (of) => {
    const reply = `ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear\n  (${missNote({ of, id: 'lab.x' })})`;
    expect(idbReasonsSaid(reply)).toBe(true);
    expect(idbReasonsSaid(withMissNote('FAIL  element id:"lab.x" … — not found within 1 s', { of, id: 'lab.x' }))).toBe(true);
    expect(noIdListedSaid(reply)).toBe(of === 'noIdListed');
  });

  it('not a bare not-found, nor the other notes (the active-window hint, the presented remedy)', () => {
    expect(idbReasonsSaid('ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear')).toBe(false);
    expect(idbReasonsSaid(`… (${ACTIVE_WINDOW_HINT})`)).toBe(false);
    expect(idbReasonsSaid(`… (${presentedRemedy('it', { kind: 'alert' })})`)).toBe(false);
    // the reasons without the remedy, or the remedy alone, are not both
    expect(idbReasonsSaid(`… (${IDB_UNLISTS})`)).toBe(false);
    expect(idbReasonsSaid(`… (${COVERED_FIRST})`)).toBe(false);
  });
});

describe('flushProbedSide: the probed side in both forms src builds (src/interact/scroll-text.ts#flushText)', () => {
  const container = { x: 0, y: 303, width: 1080, height: 1238 };
  const pinned = { role: 'container', identifier: 'header', label: null, rect: { x: 0, y: 303, width: 1080, height: 154 } };

  it('on the scroll container\'s own edge and on the edge of a node pinned in it, each side', () => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      expect(flushProbedSide(`fully visible after 1 swipe${flushText({ edge, container, checked: true })}`)).toBe(edge);
      expect(flushProbedSide(`fully visible after 2 swipes${flushText({ edge, container, pinned, checked: true })}`)).toBe(edge);
    }
  });

  it('none where no probe moved nothing: unchecked, held on a proven cut, or spanning the container', () => {
    expect(flushProbedSide(`fully visible after 3 swipes${flushText({ edge: 'top', container, checked: false, why: 'held', revealed: 66 })}`)).toBeUndefined();
    expect(flushProbedSide(`fully visible after 0 swipes${flushText({ edge: 'top', container, pinned, checked: false, why: 'budget' })}`)).toBeUndefined();
    expect(flushProbedSide(`fully visible after 0 swipes${flushText({ edges: ['top', 'bottom'], container, pinned, checked: false, why: 'fills' })}`)).toBeUndefined();
  });
});

describe('OCR_FAILED_CLOSED — the OCR fail-closed lines, word for word', () => {
  // Each alternative is a plain string src/verify/ocr.ts writes (its messages and the Swift helper's per-region error):
  // a rewording there must be followed here, or the baseline would call a host that cannot read a failed assert.
  const source = readFileSync(new URL('../../src/verify/ocr.ts', import.meta.url), 'utf8');
  const alternatives = OCR_FAILED_CLOSED.source.split('|');

  it('has only plain alternatives, each one written in src/verify/ocr.ts', () => {
    expect(alternatives.length).toBe(4);
    for (const words of alternatives) {
      expect(words).not.toMatch(/[\\^$*+?()[\]{}]/);
      expect(source).toContain(words);
    }
  });

  it('does not match an OCR assert that read other text', () => {
    expect(OCR_FAILED_CLOSED.test('FAIL  element id:"lab.text-sample.A" renders text "Prihlásiť sa" — read "Prihlasit sa"')).toBe(false);
  });
});

describe("carouselReply: the five kinds of a carousel's `fully: true` reply (T7a), over real replies and src's own builders", () => {
  const record = JSON.parse(readFileSync(new URL('../fixtures/live-android-carousel-d68-d59-synthetic.json', import.meta.url), 'utf8')) as { results: { id: string; replies: string[] }[] };
  const replyOf = (id: string) => record.results.find((r) => r.id === id)!.replies[0];
  const b10 = JSON.parse(readFileSync(new URL('../fixtures/d68-b10-recycler-convergence.json', import.meta.url), 'utf8')) as { runs: { reply: string }[] };
  const b11 = JSON.parse(readFileSync(new URL('../fixtures/d59b-b11-strokes.json', import.meta.url), 'utf8')) as { records: { reply: string }[] };
  const CAROUSEL = { x: 66, y: 380, width: 948, height: 234 };
  const XML = readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/carousel-in-list.xml', import.meta.url), 'utf8');
  /** carousel-in-list's dump with C laid at `cx`, `width` wide, cut at the screen's edges (tests/interact/scroll-carousel-android.test.ts's cAt). */
  const cAt = (cx: number, width = 948): Row => {
    const tree = parseDump(XML);
    const c = [...everyNode(tree)].find((n) => n.identifier === 'lab.carousel-in-list.C')!;
    const from = Math.max(cx, 0);
    (c as { rect: Rect }).rect = { x: from, y: 380, width: Math.min(cx + width, 1080) - from, height: 234 };
    return { tree, found: [c] };
  };
  const RULES = { direction: 'left' as const, fully: true, maxSwipes: 6, timeoutMs: 15_000, readSettles: true, screen: { width: 1080, height: 2220 } };
  const replay = (xs: readonly number[], width = 948) => {
    for (let i = 1; i <= xs.length; i++) {
      const played = play(RULES, xs.slice(0, i).map((x) => cAt(x, width)));
      if (played.outcome !== undefined) return played;
    }
    throw new Error('replay: no stop');
  };

  it('unaimable: the D68 stop (live, from launch and after the pre-drag) — though it also says "drop fully: true"', () => {
    for (const id of ['lv-d62-control', 'lv-d68-launch', 'lv-d59b-recycler']) {
      expect(replyOf(id)).toMatch(/drop fully: true/);
      expect(carouselReply(replyOf(id))).toBe('unaimable');
    }
  });

  it('unfit: the D52 stop, src-built (E2 run 0) and live — the inferred-axis clause said only where the tree told no axis', () => {
    const built = `ERROR ${failureOf(replay([574, 231, -102, 45]), 'id:"lab.carousel-in-list.C"').message}`;
    for (const reply of [built, replyOf('d52-e2'), replyOf('lv-d59b-lazy')]) expect(carouselReply(reply)).toBe('unfit');
    expect(inferredAxisSaid(replyOf('lv-d59b-lazy'))).toBe(true);
    expect(inferredAxisSaid(replyOf('d52-e2'))).toBe(false);
    expect(inferredAxisSaid(built)).toBe(false);
  });

  it('maxSwipes-hedged: the bound with the flush cut a probe proved (batch-10, all ten; D59 live) — not the bound alone', () => {
    for (const { reply } of b10.runs) expect(carouselReply(reply)).toBe('maxSwipes-hedged');
    expect(carouselReply(replyOf('lv-d62-drop'))).toBe('maxSwipes-hedged');
    expect(carouselReply('ERROR scroll_until id:lab.carousel-lazy-free.C failed after 6 swipes (maxSwipes) — element reached the viewport but stayed CLIPPED at left, 98% of it is in the viewport (last rect {"x":45,"y":380,"width":948,"height":234})')).toBe('other');
  });

  it('fully-visible: the stop src words for a card that fits, and batch-9\'s false pass (D62) — not the unchecked flush, which says it may be cut', () => {
    const fits = `Element C ${describeScrollResult(resultOf(play(RULES, [cAt(90, 900)])))}`;
    expect(fits).toMatch(/^Element C fully visible after 0 swipes/);
    expect(carouselReply(fits)).toBe('fully-visible');
    const d62 = "Element id:lab.carousel-recycler-free.C fully visible after 2 swipes; its right edge lies on its scroll container's (66,380 948x234), and a probe swipe toward it moved nothing — nothing of it is cut there";
    expect(carouselReply(d62)).toBe('fully-visible');
    // The eyes could not tell (src's `fully visible by the tree after N`): still the claim.
    expect(carouselReply(fits.replace('fully visible after', 'fully visible by the tree after'))).toBe('fully-visible');
    const unchecked = `Element C fully visible after 0 swipes${flushText({ edge: 'right', container: CAROUSEL, checked: false, why: 'budget' })}`;
    expect(carouselReply(unchecked)).toBe('other');
    // T11: two held reveals on a proven cut are no claim either.
    const held = `Element C fully visible after 3 swipes${flushText({ edge: 'right', container: CAROUSEL, checked: false, why: 'held', revealed: 55 })}`;
    expect(carouselReply(held)).toBe('other');
    expect(heldCutHedged(held)).toBe(true);
    expect(heldCutHedged(unchecked)).toBe(false);
    expect(heldCutHedged(d62)).toBe(false);
  });

  it('other: the stuck reply (batch-11), a plain stop, a not-found, a timeout', () => {
    for (const { reply } of b11.records) expect(carouselReply(reply)).toBe('other');
    expect(carouselReply('Element C visible after 2 swipes — CLIPPED at right, 92% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box')).toBe('other');
    expect(carouselReply('ERROR (thrown) Request timed out')).toBe('other');
  });

  it('each phrase it keys on is written in src/interact/scroll-text.ts', () => {
    const source = readFileSync(new URL('../../src/interact/scroll-text.ts', import.meta.url), 'utf8');
    for (const words of CAROUSEL_REPLY_WORDS) expect(source).toContain(words);
    expect(MAX_SWIPES).toBe('(maxSwipes)');
    expect(boundText({ of: 'maxSwipes' }, 6).endsWith(MAX_SWIPES)).toBe(true);
    expect(source).toContain('`fully visible by the tree after ${n}`');
  });
});

import { readFileSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { everyNode, type PresentationKind, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { MarkedLayer } from '../../src/ui-tree/presentation.js';
import { ACTIVE_WINDOW_HINT, COVERED_FIRST, IDB_UNLISTS, KEYBOARD_UNLISTED, missNote, withMissNote } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
import { boundText, describeScrollResult, flushText, UNTRIED_END, UNTRIED_LEAD } from '../../src/interact/scroll-text.js';
import {
  CAROUSEL_REPLY_WORDS, carouselReply, fullyHedged, hedgedLead, hedgeWhy, replyKind, VISIBLE_STOP, MAX_SWIPES, flushProbedSide,
  flushProbesSaid, idbReasonsSaid, inferredAxisSaid, noIdListedSaid, OCR_FAILED_CLOSED, presentedRemedySaid,
  windowHintSaid, heldCutHedged, bandSaid, directionNamed, UNCHANGED_SAID, LIVE_REPLY_WORDS, refusedUnsentSaid,
  scrollVerdictSaid, underBarRemedySaid, untriedSideSaid, chooserSaid, launchedAs, linkHeldSaid, namesUntried,
  warnedSaid, allPassed, ASSERT_SUMMARY, ASSERTS_FAILED, bareEntry, callReply, claimsDone, claimsVisible,
  dismissalCover, failedClosedUnchecked, firstLine, focusTextNotReadSaid, hedgesCut, keyboardUnlistedSaid,
  missedTarget, movedTap, namesKeyboard, notInTree, ownWords, readingOf, readSomething, screenChangedSaid,
  screenUnchangedFor, scrollAdvice, snapshotNodes, swipesOf, turnsSaid, claimsTap, heldStill, refusedAfterDismissal,
} from '../../scripts/truth/replies.js';
import { refusalOf, type Typeable } from '../../src/adapters/typeable.js';
import { revealText } from '../../src/ui-tree/sides.js';
import { untriedSideText } from '../../src/interact/target-text.js';
import { EDGES } from '../../src/ui-tree/geometry.js';
import { parseDump } from '../helpers/android-dumps.js';
import { failureOf, play, resultOf, type Row } from '../helpers/rounds.js';
import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import { FOCUS_TEXT_NOT_READ } from '../../src/interact/fill-text.js';

/**
 * A src file's code without its comments, so a phrase that only a comment still says counts as no longer written. It
 * strips block comments (`/* … *\/`, JSDoc included, across lines) and whole-line `//` comments (a line whose first
 * non-blank characters are `//`); a `//` comment after code on the same line stays, as does anything that only looks
 * like a comment inside a string or a regex.
 */
const src = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

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

  it('flushProbesSaid: how many probes the checked clause claims — 1 for "a probe swipe", n for "n probe swipes", none elsewhere', () => {
    expect(flushProbesSaid(`fully visible after 2 swipes${flushText({ edge: 'top', container, checked: true })}`)).toBe(2);
    expect(flushProbesSaid("fully visible after 1 swipe; its bottom edge lies on its scroll container's (0,303 1080x605), and a probe swipe toward it moved nothing — nothing of it is cut there")).toBe(1);
    expect(flushProbesSaid(`fully visible after 1 swipe${flushText({ edge: 'top', container, checked: false, why: 'budget' })}`)).toBeUndefined();
  });

  it('the wording before T12 (one probe), as records kept from then say it', () => {
    expect(flushProbedSide("fully visible after 1 swipe; its bottom edge lies on its scroll container's (0,303 1080x605), and a probe swipe toward it moved nothing — nothing of it is cut there")).toBe('bottom');
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
    const unchecked = `Element C ${describeScrollResult({ swipes: 0, visible: 1, clipped: [], flush: { edge: 'right', container: CAROUSEL, checked: false, why: 'budget' } })}`;
    expect(carouselReply(unchecked)).toBe('other');
    // T11: two held reveals on a proven cut are no claim either.
    const held = `Element C ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], flush: { edge: 'right', container: CAROUSEL, checked: false, why: 'held', revealed: 55 } })}`;
    expect(carouselReply(held)).toBe('other');
    expect(heldCutHedged(held)).toBe(true);
    expect(heldCutHedged(unchecked)).toBe(false);
    expect(heldCutHedged(d62)).toBe(false);
    // Before T17 the hedge opened `fully visible …; but …` (the committed t11/t12 records): no claim either.
    const oldUnchecked = `Element C fully visible after 0 swipes; but ${flushText({ edge: 'right', container: CAROUSEL, checked: false, why: 'budget' })}`;
    expect(carouselReply(oldUnchecked)).toBe('other');
  });

  it('fullyHedged (T17): a `fully: true` stop whose lead claims nothing whole — src\'s NOT CONFIRMED lead, every hedge, and the pre-T17 `fully visible …; but …` of the committed records; never a claim', () => {
    const at = (r: Parameters<typeof describeScrollResult>[0]) => `Element id:"x" ${describeScrollResult(r)}`;
    const flushes = [
      { edge: 'right', container: CAROUSEL, checked: false, why: 'budget' },
      { edge: 'right', container: CAROUSEL, checked: false, why: 'room' },
      { edge: 'right', container: CAROUSEL, checked: false, why: 'axis' },
      { edge: 'right', container: CAROUSEL, checked: false, why: 'tap' },
      { edge: 'right', container: CAROUSEL, checked: false, why: 'held', revealed: 55 },
      { edges: ['left', 'right'], container: CAROUSEL, checked: false, why: 'fills' },
      { edges: ['left', 'right'], container: CAROUSEL, pinned: { role: 'container', label: null, identifier: 'header', rect: { x: 66, y: 380, width: 120, height: 234 } }, checked: false, why: 'fills' },
    ] as const;
    const bar: UiNode = { role: 'button', label: null, identifier: 'bar', value: null, children: [], rect: { x: 0, y: 614, width: 1080, height: 100 } };
    const unjudged = { sees: 'unjudged', edge: 'bottom', by: bar, why: 'a blended frame' } as const;
    for (const flush of flushes) {
      const reply = at({ swipes: 3, visible: 1, clipped: [], flush });
      expect(reply).toMatch(VISIBLE_STOP);
      expect(replyKind(reply)).toBe('visible');
      expect(fullyHedged(reply)).toBe(true);
      expect(hedgedLead(reply)).toEqual({ what: 'WHOLE', preT17: false });
      expect(carouselReply(reply)).toBe('other');
      // The eyes unjudged: `visible by the tree after …, NOT CONFIRMED WHOLE:` — still a stop, still hedged.
      const byTree = at({ swipes: 3, visible: 1, clipped: [], flush, eyes: unjudged });
      expect(byTree).toMatch(/^Element id:"x" visible by the tree after 3 swipes, NOT CONFIRMED WHOLE: /);
      expect(replyKind(byTree)).toBe('visible');
      expect(hedgedLead(byTree)).toEqual({ what: 'WHOLE', preT17: false });
      // With an unlocated keyboard too: `NOT CONFIRMED WHOLE OR UNCOVERED:`.
      const both = at({ swipes: 3, visible: 1, clipped: [], flush, keyboard: { state: 'unlocated' } });
      expect(both).toContain(', NOT CONFIRMED WHOLE OR UNCOVERED: ');
      expect(hedgedLead(both)).toEqual({ what: 'WHOLE OR UNCOVERED', preT17: false });
      expect(hedgedLead(at({ swipes: 3, visible: 1, clipped: [], flush, keyboard: { state: 'unlocated' }, eyes: unjudged }))).toEqual({ what: 'WHOLE OR UNCOVERED', preT17: false });
      // The pre-T17 form, as the committed records hold it.
      expect(hedgedLead(`Element id:"x" fully visible after 3 swipes; but ${flushText(flush)}`)).toEqual({ what: 'WHOLE', preT17: true });
      expect(fullyHedged(`Element id:"x" fully visible by the tree after 3 swipes, judged above the soft keyboard over [0,1400][1080,2200]; but ${flushText(flush)}`)).toBe(true);
    }
    expect(hedgedLead(at({ swipes: 1, visible: 1, clipped: [], keyboard: { state: 'unlocated' } }))).toEqual({ what: 'UNCOVERED', preT17: false });
    // M2: the unjudged claim is a stop too — `fully visible by the tree after` reads `visible`, not hedged.
    const claimByTree = at({ swipes: 1, visible: 1, clipped: [], eyes: unjudged });
    expect(claimByTree).toMatch(/^Element id:"x" fully visible by the tree after 1 swipe; /);
    expect(replyKind(claimByTree)).toBe('visible');
    expect(fullyHedged(claimByTree)).toBe(false);
    // A claim: clean, checked; and neither a plain stop nor a failure is a hedged one.
    expect(fullyHedged(at({ swipes: 1, visible: 1, clipped: [] }))).toBe(false);
    expect(fullyHedged(at({ swipes: 2, visible: 1, clipped: [], flush: { edge: 'right', container: CAROUSEL, checked: true } }))).toBe(false);
    expect(fullyHedged('Element C visible after 2 swipes — CLIPPED at right, 92% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box')).toBe(false);
    expect(fullyHedged('ERROR scroll_until C failed after 6 swipes (maxSwipes) — NOT CONFIRMED WHOLE: x')).toBe(false);
  });

  it('other: the stuck reply (batch-11), a plain stop, a not-found, a timeout', () => {
    for (const { reply } of b11.records) expect(carouselReply(reply)).toBe('other');
    expect(carouselReply('Element C visible after 2 swipes — CLIPPED at right, 92% of it is in the viewport. A rect assert or screenshot on this element will measure the CLIPPED box')).toBe('other');
    expect(carouselReply('ERROR (thrown) Request timed out')).toBe('other');
  });

  it('each phrase it keys on is written in src/interact/scroll-text.ts', () => {
    const source = src('src/interact/scroll-text.ts');
    for (const words of CAROUSEL_REPLY_WORDS) expect(source).toContain(words);
    expect(MAX_SWIPES).toBe('(maxSwipes)');
    expect(boundText({ of: 'maxSwipes' }, 6).endsWith(MAX_SWIPES)).toBe(true);
    expect(source).toContain('`visible by the tree after ${n}`');
  });
});

describe('hedgeWhy (T15): why a hedged stop is hedged, read off the clause src writes (scroll-text.ts#describeScrollResult)', () => {
  const box = { x: 0, y: 303, width: 1080, height: 1238 };
  const header = { role: 'container', label: null, identifier: 'header', rect: { x: 0, y: 303, width: 1080, height: 154 } };
  const at = (r: Partial<Parameters<typeof describeScrollResult>[0]>) => `Element id:"x" ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], ...r })}`;
  // Every unchecked flush of interact/flush-check.ts#Flush, as tests/interact/scroll-hedged-lead.test.ts's HEDGES: a
  // wording src changes fails here (and a `why` src adds fails tsc: replies.ts's HedgeWhysAreSrcs).
  const FLUSHES = [
    ['budget', { edge: 'top', container: box, checked: false, why: 'budget' }],
    ['room', { edge: 'bottom', container: box, checked: false, why: 'room' }],
    ['axis', { edge: 'bottom', container: box, checked: false, why: 'axis' }],
    ['axis', { edge: 'right', container: box, checked: false, why: 'axis' }],
    ['tap', { edge: 'top', container: box, checked: false, why: 'tap' }],
    ['held', { edge: 'right', container: box, checked: false, why: 'held', revealed: 64 }],
    ['held', { edge: 'top', container: box, pinned: header, checked: false, why: 'held', revealed: 66 }],
    ['fills', { edges: ['top', 'bottom'], container: box, checked: false, why: 'fills' }],
    ['fills', { edges: ['top', 'bottom'], container: box, pinned: header, checked: false, why: 'fills' }],
  ] as const;
  const bar: UiNode = { role: 'button', label: null, identifier: 'bar', value: null, children: [], rect: { x: 0, y: 1541, width: 1080, height: 100 } };
  const unjudged = { sees: 'unjudged', edge: 'bottom', by: bar, why: 'a blended frame' } as const;

  it.each(FLUSHES)('%s: the flush hedge, alone, the eyes unjudged, beside an unlocated keyboard (its flush reason first), before T17', (why, flush) => {
    expect(hedgeWhy(at({ flush }))).toBe(why);
    expect(hedgeWhy(at({ flush, eyes: unjudged }))).toBe(why);
    expect(hedgeWhy(at({ flush, keyboard: { state: 'unlocated' } }))).toBe(why);
    expect(hedgeWhy(at({ flush, keyboard: { state: 'shown', frame: { x: 0, y: 1400, width: 1080, height: 800 } } }))).toBe(why);
    expect(hedgeWhy(`Element id:"x" fully visible after 3 swipes; but ${flushText(flush)}`)).toBe(why);
  });

  it('keyboard: a soft keyboard nothing could place, alone or with a checked flush (whose probe clause is no reason)', () => {
    expect(hedgeWhy(at({ keyboard: { state: 'unlocated' } }))).toBe('keyboard');
    expect(hedgeWhy(at({ keyboard: { state: 'unlocated' }, flush: { edge: 'top', container: box, checked: true } }))).toBe('keyboard');
  });

  it('a pre-T17 reply of a committed record: held (t11 final-ab, scroll-sticky-cut.R.fully)', () => {
    const record = JSON.parse(readFileSync(new URL('../../docs/truth/live-records/t11-carousel-visible/final-ab/harm-visibility-fix-1.json', import.meta.url), 'utf8')) as { results: { id: string; replies: string[] }[] };
    const [reply] = record.results.find((r) => r.id === 'scroll:scroll-sticky-cut.R.fully')!.replies;
    expect(hedgedLead(reply)).toEqual({ what: 'WHOLE', preT17: true });
    expect(hedgeWhy(reply)).toBe('held');
  });

  it('no hedge, no reason: a clean stop, a checked one, a plain one, a failure that quotes the words, a tap', () => {
    expect(hedgeWhy(at({}))).toBeUndefined();
    expect(hedgeWhy(at({ flush: { edge: 'top', container: box, checked: true } }))).toBeUndefined();
    expect(hedgeWhy(at({ flush: { edge: 'top', container: box, checked: false, why: 'budget' }, clipped: ['bottom'], visible: 0.8 }))).toBeUndefined();
    expect(hedgeWhy('ERROR scroll_until x failed after 6 swipes (maxSwipes) — NOT CONFIRMED WHOLE: no swipe or time was left to check it')).toBeUndefined();
    expect(hedgeWhy('Tapped id:"x"')).toBeUndefined();
  });

  it('a hedged lead whose clause names no reason src writes: undefined, not a guess', () => {
    expect(hedgeWhy('Element id:"x" visible after 3 swipes, NOT CONFIRMED WHOLE: something src does not write')).toBeUndefined();
    expect(hedgeWhy('Element id:"x" visible after 3 swipes, NOT CONFIRMED WHOLE: its top edge lies somewhere else — it may be cut there')).toBeUndefined();
    // A reason's words after the flush clause, not in it, are not its reason: the clause ends ` — it may be cut there`.
    expect(hedgeWhy('Element id:"x" visible after 3 swipes, NOT CONFIRMED WHOLE: its top edge lies on its scroll container\'s (0,303 1080x1238), and no swipe or time was left to check it, said after it')).toBeUndefined();
    expect(hedgeWhy('Element id:"x" visible after 3 swipes, NOT CONFIRMED WHOLE: its top edge lies elsewhere — it may be cut there, and no swipe or time was left to check it — it may be cut there')).toBeUndefined();
    // Nor are the words of the selector the reply echoes, before its lead.
    const fills = flushText({ edges: ['top', 'bottom'], container: box, checked: false, why: 'fills' });
    expect(hedgeWhy(`Element text:", and no swipe or time was left to check it" fully visible after 3 swipes; but ${fills}`)).toBe('fills');
    expect(hedgeWhy(`Element text:", and no swipe or time was left to check it" visible after 3 swipes, NOT CONFIRMED WHOLE: ${fills}`)).toBe('fills');
    expect(hedgeWhy('Element id:"x" visible after 3 swipes, NOT CONFIRMED UNCOVERED: no swipe or time was left to check it — it may be cut there')).toBeUndefined();
  });
});

describe('untriedSideSaid: the hint for a side never read, as src builds it (src/interact/target-text.ts#untriedSideText)', () => {
  it('each side src words, in a scroll_until failure as it ends', () => {
    for (const edge of EDGES) {
      expect(untriedSideSaid(`ERROR scroll_until id:"lab.x" failed after 3 swipes — element never appeared in the tree — ${untriedSideText(edge)}`)).toBe(true);
    }
  });

  it('not a failure that names no side, nor the turn-back remedy alone', () => {
    expect(untriedSideSaid('ERROR scroll_until id:"lab.x" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree')).toBe(false);
    expect(untriedSideSaid('ERROR … swiping up no longer moves it out from under the status bar — try direction: "down"')).toBe(false);
  });
});

describe('LIVE_REPLY_WORDS: the words the live forms and turn judges key on, each pinned where src writes it', () => {
  /** Where each phrase is written: a word without its file fails the type check, a rewording there fails the test. */
  const WRITTEN_IN: Record<(typeof LIVE_REPLY_WORDS)[number], string> = {
    'Refused before anything was sent': 'src/adapters/typeable.ts',
    'did not change': 'src/interact/fill-text.ts',
    'scroll_until it out from under': 'src/interact/target-text.ts',
    'dismiss it first': 'src/interact/target-text.ts',
    'PARTLY UNDER a surface': 'src/interact/scroll-text.ts',
    'direction: "': 'src/ui-tree/sides.ts',
  };
  it('each phrase is written in its src file, in code', () => {
    expect(Object.keys(WRITTEN_IN)).toEqual([...LIVE_REPLY_WORDS]);
    for (const [words, file] of Object.entries(WRITTEN_IN)) expect(src(file)).toContain(words);
    // 'did not change' is in another fill sentence too (the deletes'): UNCHANGED_SAID is held to the `unchanged` caveat's own
    expect(src('src/interact/fill-text.ts')).toContain(`— the field ${UNCHANGED_SAID}: `);
    // scrollVerdictSaid's head: scroll_until's own failures and stops (src/interact/scroll-text.ts)
    expect(src('src/interact/scroll-text.ts')).toContain('`scroll_until ${describe} failed after ');
  });

  it('refusedUnsentSaid: the typeable refusal src builds, not another error', () => {
    const typeable = { refuses: /Š/u, says: 'it types ASCII only', otherPath: 'Type it another way.' } as Typeable;
    expect(refusedUnsentSaid(`ERROR ${refusalOf('Šx', typeable)}`)).toBe(true);
    expect(refusedUnsentSaid('ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear')).toBe(false);
  });

  it('underBarRemedySaid: either remedy for a field under the bar, and no other refusal', () => {
    expect(underBarRemedySaid('ERROR … cut at its top edge by container id:"lab.submit" …; scroll_until it out from under that container first (…)')).toBe(true);
    expect(underBarRemedySaid('ERROR … the soft keyboard is up (its top edge at y 1398): dismiss it first (press_key back …)')).toBe(true);
    expect(underBarRemedySaid('ERROR id:"lab.note" was not tapped: it lies below the viewport — scroll_until it with direction: "down"')).toBe(false);
  });

  it('bandSaid: the band sentence src wrote on the device (k7, android-k7-eyes-1), not a lookalike', () => {
    const record = JSON.parse(readFileSync(new URL('../../docs/truth/live-records/android-k7-eyes-1.json', import.meta.url), 'utf8')) as { results: { id: string; replies: string[] }[] };
    const k7 = record.results.find((r) => r.id === 'k7')!.replies[0];
    expect(k7).toMatch(/^Element id:"lab\.form-keyboard\.phone" visible after 1 swipe — PARTLY UNDER a surface the tree does not list: /);
    expect(bandSaid(k7)).toBe(true);
    for (const lookalike of ['PARTLY UNDER a surfaced', 'XPARTLY UNDER a surface', 'PARTLY UNDER  a surface', 'partly under a surface', 'PARTLY UNDER the surface']) {
      expect(bandSaid(k7.replace('PARTLY UNDER a surface', lookalike))).toBe(false);
    }
  });

  it('bandSaid: the eyes\' band as a word, not inside another', () => {
    expect(bandSaid('Element phone visible after 1 swipe — PARTLY UNDER a surface the tree does not list: …')).toBe(true);
    expect(bandSaid('Element phone fully visible after 1 swipe')).toBe(false);
    expect(bandSaid('… PARTLY UNDER a surfaces …')).toBe(false);
  });

  it('directionNamed: the direction a reply names, from src\'s reveal (src/ui-tree/sides.ts#revealText)', () => {
    expect(directionNamed(`ERROR scroll_until id:"lab.x" failed after 4 swipes — ${revealText('top')}`, 'up')).toBe(true);
    expect(directionNamed(`ERROR scroll_until id:"lab.x" failed after 4 swipes — ${revealText('top')}`, 'down')).toBe(false);
  });

  it('scrollVerdictSaid: scroll_until\'s own failure, not a failed tree read nor a tool error', () => {
    expect(scrollVerdictSaid('ERROR scroll_until id:"lab.ks" failed after 2 swipes — …')).toBe(true);
    expect(scrollVerdictSaid('ERROR scroll_until id:"lab.ks" failed after 0 swipes — last UI tree read failed: …')).toBe(false);
    expect(scrollVerdictSaid('ERROR scroll_until: maxSwipes must be a positive integer')).toBe(false);
    expect(scrollVerdictSaid('Element id:"lab.ks" visible after 1 swipe')).toBe(false);
  });
});

// T7b: the chooser group's reads (scripts/truth/live-chooser.ts), over src's own builders: launch_app's text
// (mcp/tool-text.ts#launchText over flow/launch.ts's Launched, its note interact/app-holder-text.ts#appHolderText's) and
// open_deep_link's (tool-text.ts#deepLinkText).
describe("launchedAs, chooserSaid, warnedSaid: launch_app's and open_deep_link's replies as src words them (T7b)", () => {
  const RESOLVER = 'android/com.android.internal.app.ResolverActivity';
  const chooser: AppHolder = { holder: 'chooser', chooser: { component: RESOLVER } };
  const sheet: AppHolder = {
    holder: 'chooser',
    chooser: { component: RESOLVER, sheet: { title: 'Open with', apps: [{ label: 'AveriLab', centre: { x: 540, y: 1727 } }], once: { label: 'Just once', centre: { x: 723, y: 2058 }, disabled: true }, always: { label: 'Always', centre: { x: 936, y: 2058 }, disabled: true } } },
  };
  const launched = (app: string, answer: AppHolder = { holder: 'none' }) => launchText('android', { app, note: appHolderText({ app: app.split('/')[0] }, answer) });

  it('launchedAs: the app the headline names, with its activity when one was named; nothing for any other reply', () => {
    expect(launchedAs(launched('dev.averi.lab'))).toBe('dev.averi.lab');
    expect(launchedAs(launched('dev.averi.lab/.Twin'))).toBe('dev.averi.lab/.Twin');
    expect(launchedAs(launched('dev.averi.lab', chooser))).toBe('dev.averi.lab');
    expect(launchedAs(launchText('android', { app: 'dev.averi.lab', wiped: 'x' }))).toBe('dev.averi.lab');
    expect(launchedAs('ERROR monkey started nothing in dev.averi.lab — …')).toBeUndefined();
    expect(launchedAs(deepLinkText('android', 'averilab://cell/x', { holder: 'none' }))).toBeUndefined();
    expect(launchedAs(`x\n${launched('dev.averi.lab')}`)).toBeUndefined();
  });

  it("chooserSaid: the component a launch's ⚠ line and a link's headline name, with the sheet or without", () => {
    expect(chooserSaid(launched('dev.averi.lab', chooser))).toBe(RESOLVER);
    expect(chooserSaid(launched('dev.averi.lab', sheet))).toBe(RESOLVER);
    expect(chooserSaid(deepLinkText('android', 'averilab://shared/open', chooser))).toBe(RESOLVER);
    expect(chooserSaid(deepLinkText('android', 'averilab://shared/open', sheet))).toBe(RESOLVER);
    expect(chooserSaid(launched('dev.averi.lab'))).toBeUndefined();
    expect(chooserSaid(`Launched dev.averi.lab on android\n⚠ its chooser (${RESOLVER}) was dismissed`)).toBeUndefined();
    expect(chooserSaid(deepLinkText('android', 'averilab://cell/x', { holder: 'none' }))).toBeUndefined();
  });

  it('linkHeldSaid: a link whose headline is the chooser, not "Opened"', () => {
    expect(linkHeldSaid(deepLinkText('android', 'averilab://shared/open', chooser))).toBe(true);
    expect(linkHeldSaid(deepLinkText('android', 'averilab://shared/open', { holder: 'none' }))).toBe(false);
    expect(linkHeldSaid(launched('dev.averi.lab', chooser))).toBe(false);
  });

  it('warnedSaid: any ⚠ line under the headline, none on a plain one', () => {
    expect(warnedSaid(launched('dev.averi.lab', chooser))).toBe(true);
    expect(warnedSaid(launchText('android', { app: 'dev.averi.lab', wiped: 'x' }))).toBe(true);
    expect(warnedSaid(launched('dev.averi.lab'))).toBe(false);
    expect(warnedSaid(launched('dev.averi.lab/.Twin'))).toBe(false);
    expect(warnedSaid('Launched dev.averi.lab on android ⚠ inline')).toBe(false);
  });
});

describe('namesUntried: a scroll view among those the swipes did not go over, as src words them (scroll-text.ts#besideText, D76)', () => {
  const UPPER: Rect = { x: 0, y: 303, width: 1080, height: 605 };
  const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
  const said = (others: { label: string | null; rect: Rect }[]) =>
    boundText({ of: 'exhausted', lastStroke: 'down', unchanged: 'tree', beside: { axis: 'vertical', within: UPPER, others: others.map((o) => ({ role: 'scrollable', identifier: null, ...o })) } }, 2);

  it('the list named untried, not the one swiped, nor one after the clause', () => {
    const reply = said([{ label: null, rect: LOWER }]);
    expect(namesUntried(reply, LOWER)).toBe(true);
    expect(namesUntried(reply, UPPER)).toBe(false);
    expect(namesUntried(`${reply} — element lies outside its scroll view scrollable (0,303 1080x605)`, UPPER)).toBe(false);
    expect(namesUntried(boundText({ of: 'maxSwipes' }, 2), LOWER)).toBe(false);
  });

  it('a label holding a dash does not end the clause; a clause cut before its remedy names nothing', () => {
    const reply = said([{ label: 'A — B', rect: { x: 0, y: 1600, width: 1080, height: 600 } }, { label: null, rect: LOWER }]);
    expect(namesUntried(reply, LOWER)).toBe(true);
    expect(namesUntried(`${reply.slice(0, reply.indexOf(' — if the element lies'))}; else: content exhausted`, LOWER)).toBe(false);
  });

  it('a rect quoted before the clause, or with no clause at all, is not named untried', () => {
    expect(namesUntried(`list scrollable (0,303 1080x605); ${said([{ label: null, rect: LOWER }])}`, UPPER)).toBe(false);
    expect(namesUntried(`${'x'.repeat(40)} scrollable (0,1046 1080x495) — if the element lies in it`, LOWER)).toBe(false);
  });
});

/**
 * T13: the reads the mutation run (scripts/mutation/scope.json) found no test holding — each pinned on the words its doc
 * quotes from src, and on a lookalike it must not take: an anchor, a count of more than one digit, a singular, a
 * selector it echoes.
 */
describe('the reads\' bounds (T13)', () => {
  /** A client whose one tool call answers `answer`, or throws it; the call it was asked is kept. */
  const clientOf = (answer: unknown) => {
    const asked: unknown[] = [];
    const client = {
      callTool: async (...args: unknown[]) => {
        asked.push(args);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    } as unknown as Client;
    return { client, asked };
  };

  it('callReply: the text blocks joined by lines, any other block by its type, ERROR before an error\'s, ERROR (thrown) for a throw', async () => {
    const plain = clientOf({ content: [{ type: 'text', text: 'Tapped a' }, { type: 'image' }, { type: 'text' }, { type: 'text', text: 'more' }] });
    expect(await callReply(plain.client, 'tap', { selector: 'id:a' }, 5000)).toBe('Tapped a\n[image]\n\nmore');
    expect(plain.asked).toEqual([[{ name: 'tap', arguments: { selector: 'id:a' } }, undefined, { timeout: 5000 }]]);
    expect(await callReply(clientOf({ content: [{ type: 'text', text: 'no element' }], isError: true }).client, 'tap', {})).toBe('ERROR no element');
    expect(await callReply(clientOf({ content: [{ type: 'text', text: 'ok' }], isError: false }).client, 'tap', {})).toBe('ok');
    const thrown = clientOf(new Error('Request timed out'));
    expect(await callReply(thrown.client, 'tap', {})).toBe('ERROR (thrown) Request timed out');
    expect(thrown.asked).toEqual([[{ name: 'tap', arguments: {} }, undefined, { timeout: 300_000 }]]);
  });

  it('an assert\'s summary: N/M or All N at the start, any number of digits; one passed only when it opens the reply', () => {
    expect(allPassed('All 1 asserts passed\n✓ visible id:"a"')).toBe(true);
    expect(allPassed('Tapped a — All 1 asserts passed')).toBe(false);
    for (const failed of ['1/1 asserts FAILED', '12/12 asserts FAILED', '1/12 asserts FAILED']) expect(ASSERTS_FAILED.test(failed)).toBe(true);
    expect(ASSERTS_FAILED.test('ERROR 1/1 asserts FAILED')).toBe(false);
    for (const summary of ['12/12 asserts passed', '1/12 asserts FAILED', 'All 12 asserts passed']) expect(ASSERT_SUMMARY.test(summary)).toBe(true);
    for (const other of ['x 1/2 asserts', 'a/1 asserts', '1/a asserts', 'All x asserts', 'Not All 1 asserts']) expect(ASSERT_SUMMARY.test(other)).toBe(false);
  });

  it('the stop\'s and the hedged stop\'s leads open the reply; the pre-T17 hedge reads any count of swipes, one included', () => {
    expect(claimsVisible('ERROR Element id:"a" visible after 2 swipes')).toBe(false);
    expect(hedgedLead('Element id:"a" fully visible after 12 swipes; but its top edge may be cut')).toEqual({ what: 'WHOLE', preT17: true });
    expect(hedgedLead('Element id:"a" fully visible after 1 swipe; but its top edge may be cut')).toEqual({ what: 'WHOLE', preT17: true });
    expect(hedgedLead('ERROR Element id:"a" fully visible after 2 swipes; but its top edge may be cut')).toBeUndefined();
    expect(hedgesCut(undefined)).toBe(false);
  });

  it('notInTree: a wait for the element to appear — not one whose hint, on any later line, says it matched only unusable nodes', () => {
    expect(notInTree('ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear')).toBe(true);
    expect(notInTree('ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear; none usable\n(it matched only 0×0 nodes)')).toBe(false);
    expect(replyKind('ERROR scroll_until id:"a" failed after 3 swipes: the element never appeared in the tree')).toBe('not found');
  });

  it('missedTarget: notInTree, or a flow\'s wait that timed out on it — at the reply\'s start, its milliseconds any number', () => {
    expect(missedTarget('ERROR Timed out after 5000ms waiting for element id:"lab.x"')).toBe(true);
    expect(missedTarget('ERROR assert failed: not found within 5 s')).toBe(true);
    expect(missedTarget('Filled id:"a"; ERROR Timed out after 5000ms waiting for element id:"lab.x"')).toBe(false);
    expect(missedTarget('ERROR Timed out after ms waiting for element id:"lab.x"')).toBe(false);
    expect(missedTarget('Tapped id:"lab.x"')).toBe(false);
  });

  it('bareEntry: the entry probe\'s bare line opens its line', () => {
    expect(bareEntry('environment x\n⚠ detect: c treated as not detected — every UI tree read was bare (3 reads)')).toBe(true);
    expect(bareEntry('note: ⚠ detect: c treated as not detected — every UI tree read was bare (3 reads)')).toBe(false);
  });

  it('claimsDone: Filled, Cleared or Tapped opening the reply, not NOT verified; focusTextNotReadSaid: its hedge on a ⚠ line of its own', () => {
    for (const done of ['Filled id:"a" with "x"', 'Cleared id:"a"', 'Tapped id:"a"']) expect(claimsDone(done)).toBe(true);
    for (const not of ['Filled id:"a" with "x" — NOT verified', 'Scrolled; Filled id:"a"', 'ERROR Filled nothing']) expect(claimsDone(not)).toBe(false);
    expect(focusTextNotReadSaid(`Filled id:"a" with "x"\n⚠ ${FOCUS_TEXT_NOT_READ}: it may not all come from the keys`)).toBe(true);
    expect(focusTextNotReadSaid(`Filled id:"a" with "x" ⚠ ${FOCUS_TEXT_NOT_READ}`)).toBe(false);
    expect(focusTextNotReadSaid('Filled id:"a" with "x"\n⚠ another caveat')).toBe(false);
    expect(focusTextNotReadSaid(`ERROR id:"a" was not filled\n⚠ ${FOCUS_TEXT_NOT_READ}`)).toBe(false);
  });

  it('firstLine: an assert\'s first verdict line under its summary, else the first line, at most 200 characters', () => {
    expect(firstLine('All 1 asserts passed\n✓ visible id:"a"')).toBe('✓ visible id:"a"');
    expect(firstLine('All 1 asserts passed')).toBe('All 1 asserts passed');
    expect(firstLine('Tapped id:"a"\nmore')).toBe('Tapped id:"a"');
    expect(firstLine('x'.repeat(300))).toBe('x'.repeat(200));
  });

  it('ownWords and the reads through it: a selector echoed is no word of the reply\'s', () => {
    expect(ownWords('tap id:"lab.form-keyboard.vs" now')).toBe('tap <selector> now');
    expect(scrollAdvice('ERROR id:"a" lies below the viewport — scroll_until it first')).toBe(true);
    expect(scrollAdvice('ERROR id:"scroll_until" was not tapped')).toBe(false);
    expect(namesKeyboard('ERROR id:"a" lies under the soft keyboard')).toBe(true);
    expect(keyboardUnlistedSaid(`waiting for id:"a": the soft keyboard is up and ${KEYBOARD_UNLISTED.idb}`)).toBe(true);
    expect(keyboardUnlistedSaid('waiting for id:"a": the soft keyboard is up')).toBe(false);
    expect(keyboardUnlistedSaid(`waiting for id:"a": ${KEYBOARD_UNLISTED.idb}`)).toBe(false);
    expect(screenChangedSaid('ERROR scroll_until id:"a" stopped after 12 swipes — the swipe CHANGED THE SCREEN: a new screen')).toBe(true);
  });

  it('movedTap: the tap moved off its centre, every coordinate any number of digits, a minus or a fraction', () => {
    expect(movedTap('Tapped id:"a" at (540,1200) — its centre (540,1300) is under id:"bar"; tapped the uncovered part 825x40')).toBe(true);
    expect(movedTap('Tapped id:"a" at (-12.5,7) — its centre (-3,-44.5) is under id:"bar"; tapped the uncovered part 9x9')).toBe(true);
    expect(movedTap('Tapped id:"a" at (a,1200) — its centre (540,1300) is under id:"bar"; tapped the uncovered part 825x40')).toBe(false);
    expect(movedTap('Tapped id:"a" at (540,1200) — its centre (540,b) is under id:"bar"; tapped the uncovered part 825x40')).toBe(false);
    expect(movedTap('Tapped id:"a" at (540,1200) — its centre (540,1300) is under id:"bar"; tapped the uncovered part ax40')).toBe(false);
    expect(movedTap('Tapped id:"a" at (540,1200) — its centre (540,1300) is under id:"bar"; tapped the uncovered part 825xb')).toBe(false);
  });

  it('the counts a reply says: probes, turns, swipes and unchanged strokes, of any number of digits, a swipe singular too', () => {
    expect(flushProbesSaid('its bottom edge lies on its scroll container\'s (0,1046 1080x495), and 12 probe swipes toward it moved nothing')).toBe(12);
    expect(turnsSaid('It was turned round 12 times')).toBe(12);
    expect(swipesOf('Element id:"a" visible after 12 swipes')).toBe(12);
    expect(swipesOf('Element id:"a" visible after 1 swipe')).toBe(1);
    expect(screenUnchangedFor('failed after 14 swipes: the last 12, swiping down, did not change the screen')).toBe(12);
  });

  it('dismissalCover: the role the guard\'s own clause names, in a parenthesis after a selector; none without the clause', () => {
    expect(dismissalCover('ERROR id:"a" was not tapped: none of the configured dismissals is usable on this screen (id:"done" covered by toolbar 0,0 1080x200)')).toBe('toolbar');
    expect(dismissalCover('ERROR id:"a" was not tapped: none of the configured dismissals is usable on this screen (id:"done" covered by scrollable 0,0 1080x200)')).toBe('scrollable');
    expect(dismissalCover('Tapped id:"a"')).toBeUndefined();
  });

  it('carouselReply and scrollVerdictSaid: their leads open the reply', () => {
    expect(carouselReply('note: Element id:"a" fully visible after 2 swipes')).toBe('other');
    expect(scrollVerdictSaid('Tapped; ERROR scroll_until id:"a" failed after 2 swipes')).toBe(false);
  });

  it('namesUntried: a clause at the reply\'s very start, read from its lead on', () => {
    const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
    expect(namesUntried(`${UNTRIED_LEAD}scrollable (0,1046 1080x495)${UNTRIED_END}it`, LOWER)).toBe(true);
    expect(namesUntried(`(0,1046 1080x495)${UNTRIED_LEAD}scrollable (0,303 1080x605)${UNTRIED_END}it`, LOWER)).toBe(false);
  });

  it('the ocr reads: the text read, escapes and all, none when it failed closed or read nothing', () => {
    expect(failedClosedUnchecked('ERROR ocr: failing closed, rendered text unchecked')).toBe(true);
    expect(readingOf('1/1 asserts FAILED\n✗ ocr id:"a": read "Total 12"')).toBe('Total 12');
    expect(readingOf('✗ ocr id:"a": read "say \\"hi\\""')).toBe('say "hi"');
    expect(readingOf('✗ ocr id:"a": read "x" — failing closed, rendered text unchecked')).toBeUndefined();
    expect(readingOf('✗ ocr id:"a": nothing read')).toBeUndefined();
    expect(readSomething('✗ ocr id:"a": read "x"')).toBe(true);
    expect(readSomething('✗ ocr id:"a": read "x" — failing closed, rendered text unchecked')).toBe(false);
    expect(readSomething('✗ ocr id:"a": nothing read')).toBe(false);
  });

  it('snapshotNodes: the first block only when it opens the reply as an array — an empty one with a note after it too', () => {
    expect(snapshotNodes('[]\nnote: nothing matched')).toEqual([]);
    expect(snapshotNodes(' [\n]')).toBeUndefined();
  });

  it('launchedAs: the headline opens the reply', () => {
    expect(launchedAs('note: Launched com.x on android')).toBeUndefined();
  });

  it('claimsTap and replyKind: each kind of the closed set, in its precedence', () => {
    expect(claimsTap('Tapped id:"a"')).toBe(true);
    expect(claimsTap('ERROR id:"a" was not Tapped')).toBe(false);
    expect(replyKind('Tapped id:"a"')).toBe('Tapped');
    expect(replyKind('Element id:"a" visible after 2 swipes')).toBe('visible');
    expect(replyKind('All 1 asserts passed\n✓ visible id:"a"')).toBe('PASS');
    expect(replyKind('1/1 asserts FAILED\n✗ visible id:"a"')).toBe('FAIL');
    expect(replyKind('ERROR id:"a" was not tapped: it lies below the viewport')).toBe('refused');
    expect(replyKind('Scrolled down')).toBe('other');
  });

  it('hedgesCut: a WHOLE hedge, alone or with UNCOVERED; not UNCOVERED alone', () => {
    expect(hedgesCut({ what: 'WHOLE', preT17: false })).toBe(true);
    expect(hedgesCut({ what: 'WHOLE OR UNCOVERED', preT17: false })).toBe(true);
    expect(hedgesCut({ what: 'UNCOVERED', preT17: false })).toBe(false);
  });

  it('heldStill: the held seconds, a fraction too, and the rung the engine\'s line names; none without the line', () => {
    expect(heldStill("ensure_state …\nsecond look: not detected, the screen held still 12.5 s — running dismiss-sheet before the 20 s window's end")).toEqual({ heldS: 12.5, flow: 'dismiss-sheet' });
    expect(heldStill('second look: not detected after 20 s')).toBeUndefined();
  });

  it('bareEntry: the condition the line names may be any text', () => {
    expect(bareEntry('⚠ detect: visible id:"lab.sheet" treated as not detected — every UI tree read was bare (3 reads)')).toBe(true);
  });

  it('refusedAfterDismissal: the dismissal and the keyboard named in the refusal\'s own words', () => {
    expect(refusedAfterDismissal('ERROR id:"lab.note" was not tapped: after id:"lab.done" was tapped (the configured dismissal) to hide the soft keyboard, it lies below the viewport')).toBe(true);
    expect(refusedAfterDismissal('ERROR id:"lab.note" was not tapped: the soft keyboard is up')).toBe(false);
  });

  it('the counts\' singulars and their absence: one turn, one swipe that changed the screen; the end turn alone, or with the fling\'s; none said', () => {
    expect(screenChangedSaid('ERROR scroll_until id:"a" stopped after 1 swipe — the swipe CHANGED THE SCREEN: a new screen')).toBe(true);
    expect(turnsSaid('It was turned round 1 time')).toBe(1);
    expect(turnsSaid('… so averi turned down')).toBe(1);
    expect(turnsSaid('It was turned round 2 times … so averi turned down')).toBe(3);
    expect(turnsSaid('Element id:"a" visible after 2 swipes')).toBe(0);
    expect(swipesOf('Tapped id:"a"')).toBeUndefined();
    expect(screenUnchangedFor('Element id:"a" visible after 2 swipes')).toBeUndefined();
  });

  it('snapshotNodes: a pretty-printed array read to its closing line', () => {
    const nodes = [{ role: 'button', identifier: 'a', rect: { x: 1, y: 2, width: 3, height: 4 } }];
    expect(snapshotNodes(`${JSON.stringify(nodes, null, 2)}\nnote: one more block`)).toEqual(nodes);
    expect(snapshotNodes('[]')).toEqual([]);
  });

  it('linkHeldSaid: the chooser headline opens the reply', () => {
    expect(linkHeldSaid('Android has not opened https://x.test yet: its chooser (android/com.android.internal.app.ResolverActivity) is in front')).toBe(true);
    expect(linkHeldSaid('note: Android has not opened https://x.test yet: its chooser (android/x) is in front')).toBe(false);
  });
});

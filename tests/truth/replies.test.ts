import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type PresentationKind, type Rect } from '../../src/adapters/types.js';
import type { MarkedLayer } from '../../src/ui-tree/presentation.js';
import { ACTIVE_WINDOW_HINT, COVERED_FIRST, IDB_UNLISTS, missNote, withMissNote } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
import { boundText, describeScrollResult, flushText } from '../../src/interact/scroll-text.js';
import { CAROUSEL_REPLY_WORDS, carouselReply, MAX_SWIPES, flushProbedSide, flushProbesSaid, idbReasonsSaid, inferredAxisSaid, noIdListedSaid, OCR_FAILED_CLOSED, presentedRemedySaid, windowHintSaid, heldCutHedged, bandSaid, directionNamed, UNCHANGED_SAID, LIVE_REPLY_WORDS, refusedUnsentSaid, scrollVerdictSaid, underBarRemedySaid, untriedSideSaid } from '../../scripts/truth/replies.js';
import { refusalOf, type Typeable } from '../../src/adapters/typeable.js';
import { revealText } from '../../src/ui-tree/sides.js';
import { untriedSideText } from '../../src/interact/target-text.js';
import { EDGES } from '../../src/ui-tree/geometry.js';
import { parseDump } from '../helpers/android-dumps.js';
import { failureOf, play, resultOf, type Row } from '../helpers/rounds.js';
import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import { chooserSaid, launchedAs, linkHeldSaid, warnedSaid } from '../../scripts/truth/replies.js';

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
    const source = src('src/interact/scroll-text.ts');
    for (const words of CAROUSEL_REPLY_WORDS) expect(source).toContain(words);
    expect(MAX_SWIPES).toBe('(maxSwipes)');
    expect(boundText({ of: 'maxSwipes' }, 6).endsWith(MAX_SWIPES)).toBe(true);
    expect(source).toContain('`fully visible by the tree after ${n}`');
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

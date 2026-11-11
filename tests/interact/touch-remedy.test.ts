import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import type { Cover } from '../../src/ui-tree/cover.js';
import type { Cut } from '../../src/ui-tree/geometry.js';
import { noScrollRemedyText, presentedRemedy } from '../../src/ui-tree/remedy-text.js';
import type { Remedy, StandingFacts, TouchRemedied } from '../../src/ui-tree/standing.js';
import { cutWayPast, stuckCutByText, stuckTapQuote, touchRemedyText } from '../../src/interact/touch-remedy.js';
import type { KeyboardUp } from '../../src/interact/target-text.js';
import { node } from '../helpers/fake.js';

// THE touch remedy's sentence (interact/touch-remedy.ts, A26): one function of a `cut` or `covered` standing and the
// soft keyboard, which the tap's refusal and scroll_until's `overlapped` stop and sliver failures all call. Each row is
// one (kind, remedy, cut.by, keyboard) case; the verbs' own sentences around it are pinned where they are said
// (tap.test.ts, scroll.test.ts, remedy-agreement.test.ts).

const FACTS = {} as StandingFacts;
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const CONTAINER = rect(0, 242, 1080, 1736);
const bar = (y: number, height = 132): UiNode => node({ role: 'button', identifier: 'bar', rect: rect(0, y, 1080, height) });
const cutAt = (extra: Partial<Cut> = {}): Cut => ({ edge: 'bottom', container: CONTAINER, depth: 55, ...extra });
const cut = (c: Cut, remedy: Extract<TouchRemedied, { kind: 'cut' }>['remedy']): Extract<TouchRemedied, { kind: 'cut' }> => ({ kind: 'cut', cut: c, minPiece: 65, remedy, facts: FACTS });
const coverOf = (n: UiNode): Cover => ({ node: n, reach: n.rect, order: { kind: 'drawn' }, presented: false }) as Cover;
const covered = (cover: UiNode, remedy: Extract<TouchRemedied, { kind: 'covered' }>['remedy']): TouchRemedied => ({ kind: 'covered', cover: coverOf(cover), aboveKeyboard: false, remedy, facts: FACTS });
/** The soft keyboard up, its top edge at 1398, hidden by `back` (Android's). */
const UP: KeyboardUp = { lineY: 1398, remedy: { dismissal: 'back' } };
const HIDE = '(press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow)';
const OWN = 'if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates';
const INHERITED = 'if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates';
const THIN = (role: string) => `only if a screenshot shows it whole — a control that thin laid flush against that ${role} — no scroll shows more: tap by coordinates`;
const PRESENTED: Remedy & { of: 'presented' } = { of: 'presented', layer: { kind: 'alert', label: 'Delete?' } } as Remedy & { of: 'presented' };

describe('touchRemedyText — one sentence per (kind, remedy, cut.by, keyboard)', () => {
  it('a cut at its container\'s edge: a scroll toward that edge, and the way past for a node that only reads cut — its own, or what it lies in', () => {
    expect(touchRemedyText(cut(cutAt(), { of: 'scroll' }))).toBe(`scroll_until it first (${OWN})`);
    expect(touchRemedyText(cut(cutAt({ edge: 'top' }), { of: 'scroll' }))).toBe(`scroll_until it with direction: up first (${OWN})`);
    expect(touchRemedyText(cut(cutAt({ within: rect(66, 1924, 948, 55) }), { of: 'scroll' }))).toBe(`scroll_until it first (${INHERITED})`);
    // The keyboard is named only for a cut by a node drawn after it.
    expect(touchRemedyText(cut(cutAt(), { of: 'scroll' }), UP)).toBe(`scroll_until it first (${OWN})`);
  });

  it('a cut by a node drawn after it, `scroll`: out from under that node — the riding keyboard first, else the scroll alone', () => {
    const by = bar(1238);
    const c = cutAt({ edge: 'top', by });
    expect(touchRemedyText(cut(c, { of: 'scroll' }))).toBe(`scroll_until it out from under that button first (${THIN('button')})`);
    // Riding: its bottom (1370) at or above the line (1398), within the 65 minimum.
    expect(touchRemedyText(cut(c, { of: 'scroll' }), UP)).toBe(
      `the soft keyboard is up (its top edge at y 1398): dismiss it first ${HIDE} — a bar riding on it goes down with it — or scroll_until it out from under that button first (${THIN('button')})`,
    );
    // A top bar far above the line: the keyboard is not named.
    expect(touchRemedyText(cut(cutAt({ edge: 'top', by: bar(0) }), { of: 'scroll' }), UP)).toBe(`scroll_until it out from under that button first (${THIN('button')})`);
  });

  it('a cut by a node drawn after it, `bothPinned`: no scroll, said of the node the remedy is pinned under — riding, stacked or neither', () => {
    const pinned = (by: UiNode) => cut(cutAt({ edge: 'top', by }), { of: 'bothPinned', under: by });
    const way = noScrollRemedyText({ of: 'bothPinned', under: bar(1238) }, 'touch', bar(1238));
    expect(touchRemedyText(pinned(bar(1238)))).toBe(way);
    expect(touchRemedyText(pinned(bar(1238)), UP)).toBe(`the soft keyboard is up (its top edge at y 1398): dismiss it first ${HIDE} — a bar riding on it goes down with it — else ${way}`);
    // 66 px above the line: not riding (over the 65 minimum), but within its own height — it may be stacked in a bar that rides.
    expect(touchRemedyText(pinned(bar(1200)), UP)).toBe(`the soft keyboard is up (its top edge at y 1398): hiding it may move that button ${HIDE} — else ${way}`);
    expect(touchRemedyText(pinned(bar(0)), UP)).toBe(way);
    // Stacked's bound: a bar ending exactly its own height (132) above the line may still be stacked; one px more is not.
    expect(touchRemedyText(pinned(bar(1398 - 132 - 132)), UP)).toContain('hiding it may move that button');
    expect(touchRemedyText(pinned(bar(1398 - 132 - 133)), UP)).toBe(way);
    // A bar reaching below the line (its bottom past 1398) neither rides nor is stacked on it.
    expect(touchRemedyText(pinned(bar(1300)), UP)).toBe(way);
    // The node named is the remedy's `under` (what it is pinned under), read from the remedy — not the cut's `by`: given
    // two different roles, the sentence names the remedy's.
    const toolbar = node({ role: 'toolbar', rect: rect(0, 0, 1080, 132) });
    const said = touchRemedyText(cut(cutAt({ edge: 'top', by: bar(0) }), { of: 'bothPinned', under: toolbar }));
    expect(said).toContain('laid flush against that toolbar');
    expect(said).not.toContain('that button');
  });

  it('covered, no scroll: the one clause every verb quotes (unordered, seenOver, bothPinned) — the keyboard never named', () => {
    const c = node({ role: 'button', identifier: 'c', rect: rect(51, 470, 300, 64) });
    for (const remedy of [{ of: 'unordered' }, { of: 'unordered', why: 'both blurred' }, { of: 'seenOver' }, { of: 'bothPinned', under: c }] as const) {
      expect({ remedy, said: touchRemedyText(covered(c, remedy), UP) }).toEqual({ remedy, said: noScrollRemedyText(remedy, 'touch') });
    }
    // A covered bothPinned keeps the cover's way out, never a cut's.
    expect(touchRemedyText(covered(c, { of: 'bothPinned', under: c }))).toContain('if a screenshot shows this element on top, tap it by coordinates');
  });

  it('covered, `scroll`: a scroll — or, under a wrapper that may only position its one small child, that child', () => {
    const plain = node({ role: 'button', rect: rect(0, 400, 400, 100) });
    expect(touchRemedyText(covered(plain, { of: 'scroll' }))).toBe('scroll_until it first');
    const fab = node({ role: 'button', label: 'Add', rect: rect(780, 1900, 264, 264) });
    const host = node({ role: 'container', rect: rect(0, 1850, 1080, 352), children: [fab] });
    expect(touchRemedyText(covered(host, { of: 'scroll' }))).toBe(
      'the wrapper may only position its one child, button "Add" (780,1900 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first',
    );
    // A child of exactly a quarter of the host is still small; a larger one, a non-control, or one of no area is not.
    const host1 = (child: UiNode) => covered(node({ role: 'container', rect: rect(0, 0, 400, 400), children: [child] }), { of: 'scroll' });
    expect(touchRemedyText(host1(node({ role: 'button', rect: rect(0, 0, 200, 200) })))).toMatch(/^the wrapper may only position its one child/);
    expect(touchRemedyText(host1(node({ role: 'button', rect: rect(0, 0, 200, 201) })))).toBe('scroll_until it first');
    expect(touchRemedyText(host1(node({ role: 'button', rect: rect(0, 0, 300, 300) })))).toBe('scroll_until it first');
    expect(touchRemedyText(host1(node({ role: 'image', rect: rect(0, 0, 100, 100) })))).toBe('scroll_until it first');
    expect(touchRemedyText(host1(node({ role: 'button', rect: rect(0, 0, 0, 100) })))).toBe('scroll_until it first');
    // A host that is no structural node (a button holding a button) positions nothing.
    expect(touchRemedyText(covered(node({ role: 'button', rect: rect(0, 0, 400, 400), children: [node({ role: 'button', rect: rect(0, 0, 100, 100) })] }), { of: 'scroll' }))).toBe(
      'scroll_until it first',
    );
    // Two children: a tab bar's host, not a positioner.
    expect(touchRemedyText(covered(node({ role: 'container', rect: host.rect, children: [fab, fab] }), { of: 'scroll' }))).toBe('scroll_until it first');
  });

  it('beneath a presented screen, every kind and case: that screen\'s remedy alone', () => {
    const said = presentedRemedy('it', PRESENTED.layer);
    expect(touchRemedyText(cut(cutAt(), PRESENTED))).toBe(said);
    expect(touchRemedyText(cut(cutAt({ by: bar(1238) }), PRESENTED), UP)).toBe(said);
    expect(touchRemedyText(covered(bar(0), PRESENTED))).toBe(said);
  });
});

describe('cutWayPast — the way past a cut, which scroll_until\'s stuck failure quotes of the tap', () => {
  it('its own content, what it lies in, or a node drawn after it', () => {
    expect(cutWayPast(cutAt())).toBe(OWN);
    expect(cutWayPast(cutAt({ within: rect(66, 1924, 948, 55) }))).toBe(INHERITED);
    expect(cutWayPast(cutAt({ by: bar(1238) }))).toBe(THIN('button'));
    // A cut by a later node inherits nothing: the node's own way past wins over `within`.
    expect(cutWayPast(cutAt({ by: bar(1238), within: rect(66, 1924, 948, 55) }))).toBe(THIN('button'));
  });
});

describe('the stuck failure\'s words of the tap (the content exhausted) — routed through the touch remedy', () => {
  it('stuckTapQuote: the way past — or, beneath a presented screen, that screen\'s remedy, as the tap says it', () => {
    expect(stuckTapQuote(cut(cutAt(), { of: 'scroll' }))).toBe(OWN);
    expect(stuckTapQuote(cut(cutAt({ by: bar(1238) }), { of: 'scroll' }))).toBe(THIN('button'));
    expect(stuckTapQuote(cut(cutAt({ by: bar(1238) }), PRESENTED))).toBe(presentedRemedy('it', PRESENTED.layer));
  });

  it('stuckCutByText: the tap\'s riding choice — dismiss it first and scroll again, else a layout defect', () => {
    expect(stuckCutByText(bar(1238), 65, UP)).toBe(`the soft keyboard is up (its top edge at y 1398): dismiss it first ${HIDE} — a bar riding on it goes down with it, and scroll again`);
    expect(stuckCutByText(bar(1238), 65)).toBe('a layout defect (no clearance for a pinned bar?)');
    expect(stuckCutByText(bar(0), 65, UP)).toBe('a layout defect (no clearance for a pinned bar?)');
  });
});

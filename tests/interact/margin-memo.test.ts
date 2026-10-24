import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { carriedCover, seeMargin, startMargin, type MarginKnown, type MarginMemo } from '../../src/interact/margin-memo.js';
import { judgeRead, type Judged, type TreeFacts } from '../../src/interact/scroll-read.js';
import type { ClearQuestion } from '../../src/ui-tree/eyes.js';
import type { OrderSeen, PairSeen } from '../../src/ui-tree/seen-order.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { node } from '../helpers/fake.js';

/**
 * THE MARGIN MEMO through its interface (interact/margin-memo.ts): ADR 0026 rules 6 and 8 on rects. Each read is the lab
 * form's phone field and the texts in its touch margin (the after-back capture's "Variable symbol" title, and a second
 * text beside it), in a list marked as Android marks a clipping container, judged as the round judges it
 * (interact/scroll-read.ts#judgeRead). `seeMargin` — the texts to ask the eyes, or what to tell the read, with the memo that
 * keeps this read's answers; `carriedCover` — the offset the cover seen drawn over the field was carried by with it.
 * How the round asks and what it replies is pinned in its plays (tests/interact/scroll-eyes.test.ts, "what was seen of a
 * margin text, kept").
 */

const SCREEN_BOX: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
const SCREEN: UsableScreen = { box: SCREEN_BOX, boxes: [SCREEN_BOX], oriented: SCREEN_BOX, from: 'device' };
const LIST: Rect = { x: 0, y: 200, width: 1080, height: 1800 };
const FIELD: Rect = { x: 55, y: 1280, width: 970, height: 132 };
const TITLE: Rect = { x: 55, y: 1406, width: 258, height: 56 };
const HINT: Rect = { x: 700, y: 1406, width: 300, height: 56 };
const by = (r: Rect, dx: number, dy: number, dh = 0): Rect => ({ ...r, x: r.x + dx, y: r.y + dy, height: r.height + dh });

/** Where one read finds the pair: the field moved `dy` (`dx` across), grown `grown` px at its bottom, the title by `peerDy` (`dy` unless pinned), the list by `listDy`; `marked` false: the tree marks no scroll view; `nested`: the list inside an outer clipping scroller that stays put. */
interface At {
  readonly dx?: number;
  readonly dy?: number;
  readonly peerDy?: number;
  readonly listDy?: number;
  readonly grown?: number;
  readonly marked?: boolean;
  readonly nested?: boolean;
}

/** One read: the field and its margin texts where `at` puts them — the clear question of its texts, the read's facts and its judged match. */
interface Read {
  readonly question: ClearQuestion;
  readonly facts: TreeFacts;
  readonly best: Judged;
  readonly title: UiNode;
  readonly hint: UiNode;
}

function readAt({ dx = 0, dy = 0, peerDy = dy, listDy = 0, grown = 0, marked = true, nested = false }: At = {}): Read {
  const field = node({ role: 'EditText', identifier: 'lab.form-keyboard.phone', rect: by(FIELD, dx, dy, grown) });
  const title = node({ role: 'TextView', identifier: 'lab.form-keyboard.vs.title', label: 'Variable symbol', rect: by(TITLE, dx, peerDy) });
  const hint = node({ role: 'TextView', identifier: 'lab.form-keyboard.vs.hint', label: 'Optional', rect: by(HINT, dx, peerDy) });
  const list = node({ role: 'scrollable', ...(marked && { clipsDescendants: true }), rect: by(LIST, 0, listDy), children: [field, hint, title] });
  const outer = node({ role: 'scrollable', clipsDescendants: true, rect: { x: 0, y: 100, width: 1080, height: 2000 }, children: [list] });
  const tree = node({ role: 'container', rect: SCREEN_BOX, children: [nested ? outer : list] });
  const judged = judgeRead({ tree, found: [field], ofKeyboard: () => false, remedy: { dismissal: 'none' } }, SCREEN, true);
  if ('ask' in judged || judged.best === undefined) throw new Error('no match judged');
  const pairOf = (peer: UiNode) => ({ peer, overlap: { x: peer.rect.x, y: peer.rect.y, width: peer.rect.width, height: 6 }, beside: [] });
  return { question: { asks: 'clear', tree, node: field, pairs: [pairOf(title), pairOf(hint)] }, facts: judged.facts, best: judged.best, title, hint };
}

const UNDER = { seen: 'under', overlap: '#202020', own: '#ffffff', other: '#202020' } as const;
const CLEAR = { seen: 'clear', overlap: '#ffffff', beside: '#ffffff' } as const;
const UNTOLD = { seen: 'untold', why: 'it is not one colour beside the text' } as const;
type Answer = typeof UNDER | typeof CLEAR | typeof UNTOLD;

/** The memo after the eyes answered `title` and `hint` as given on the read at `at` (from an empty memo). */
function seenAt(at: At, title: Answer, hint: Answer = CLEAR): MarginMemo {
  const r = readAt(at);
  const said = seeMargin(startMargin(), r.question, [{ peer: r.title, ...title } as OrderSeen, { peer: r.hint, ...hint } as OrderSeen], r.facts);
  if ('ask' in said) throw new Error('answered, yet asked');
  return said.memo;
}

/** What `seeMargin` says on the read at `at`, nothing answered yet: the texts asked by label, or what is told, by label. */
function on(memo: MarginMemo, at: At): { ask: (string | null | undefined)[] } | { told: Record<string, PairSeen['seen']> } {
  const r = readAt(at);
  const said: MarginKnown = seeMargin(memo, r.question, undefined, r.facts);
  if ('ask' in said) return { ask: said.ask.pairs.map(({ peer }) => peer.label) };
  return { told: Object.fromEntries(said.told.map(({ peer, seen }) => [peer.label ?? '', seen])) };
}

/** The `carriedCover` of the read at `at`: its match judged covered, the title (listed last, over its bottom 6 px) the standing's named cover. */
function carryAt(memo: MarginMemo, at: At): unknown {
  const r = readAt(at);
  expect(r.best.standing.kind === 'covered' && r.best.standing.cover.node.label).toBe('Variable symbol');
  return carriedCover(memo, r.best, r.facts);
}

describe('the margin memo — once per text where it lies (ADR 0026 rule 6)', () => {
  it('nothing seen yet: every text asked; answered, the read told the answers and the memo keeps them', () => {
    expect(on(startMargin(), {})).toEqual({ ask: ['Variable symbol', 'Optional'] });
    const memo = seenAt({}, CLEAR);
    expect(on(memo, {})).toEqual({ told: { 'Variable symbol': 'clear', Optional: 'clear' } });
  });

  it('a kept under suppresses asking the others: told what was kept, nothing asked', () => {
    const r = readAt();
    const titleUnder = seeMargin(startMargin(), { ...r.question, pairs: [r.question.pairs[0]!] }, [{ peer: r.title, ...UNDER }], r.facts);
    if ('ask' in titleUnder) throw new Error('answered, yet asked');
    expect(on(titleUnder.memo, {})).toEqual({ told: { 'Variable symbol': 'under' } });
  });

  it('a kept untold suppresses asking the others too; a kept clear does not — only the unseen text is asked', () => {
    const r = readAt();
    const only = (seen: Answer) => {
      const said = seeMargin(startMargin(), { ...r.question, pairs: [r.question.pairs[0]!] }, [{ peer: r.title, ...seen } as OrderSeen], r.facts);
      if ('ask' in said) throw new Error('answered, yet asked');
      return said.memo;
    };
    expect(on(only(UNTOLD), {})).toEqual({ told: { 'Variable symbol': 'untold' } });
    expect(on(only(CLEAR), {})).toEqual({ ask: ['Optional'] });
  });

  it('a clear or untold is kept where it was seen only: the two moved, asked again', () => {
    expect(on(seenAt({}, CLEAR), { dy: -10 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
    expect(on(seenAt({}, UNTOLD), { dy: -300 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
  });

  it('an under carried together with the field (300 px up, the list where it was): told, not asked again', () => {
    expect(on(seenAt({}, UNDER), { dy: -300 })).toEqual({ told: { 'Variable symbol': 'under' } });
  });

  it('a pinned text is asked again after the target moved past it (the field 300 up, the text where it was, or 3 px off the carry)', () => {
    expect(on(seenAt({}, UNDER), { dy: -300, peerDy: 0 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
    expect(on(seenAt({}, UNDER), { dy: -300, peerDy: -297 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
  });

  it('the scroll view moved, so ask again (a sheet dragged with the two); in no scroll view the tree marks, asked again too', () => {
    expect(on(seenAt({}, UNDER), { dy: -300, listDy: -300 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
    expect(on(seenAt({ marked: false }, UNDER), { dy: -300, marked: false })).toEqual({ ask: ['Variable symbol', 'Optional'] });
  });

  it('the scroll view is the nearest one: the inner list moved with the two inside an outer scroller that stayed put, asked again', () => {
    expect(on(seenAt({ nested: true }, UNDER), { nested: true, dy: -300 })).toEqual({ told: { 'Variable symbol': 'under' } });
    expect(on(seenAt({ nested: true }, UNDER), { nested: true, dy: -300, listDy: -300 })).toEqual({ ask: ['Variable symbol', 'Optional'] });
  });

  it('a text asked again replaces its entry: the new answer told', () => {
    const r = readAt({ dy: -300, peerDy: 0 });
    const again = seeMargin(seenAt({}, UNDER), r.question, [{ peer: r.title, ...CLEAR }, { peer: r.hint, ...CLEAR }], r.facts);
    if ('ask' in again) throw new Error('answered, yet asked');
    expect(on(again.memo, { dy: -300, peerDy: 0 })).toEqual({ told: { 'Variable symbol': 'clear', Optional: 'clear' } });
  });
});

describe('the margin memo — the cover carried with the target (ADR 0026 rule 8)', () => {
  const under = seenAt({}, UNDER);

  it('carried together, both 300 px up in a list that stayed where it was: that offset', () => {
    expect(carryAt(under, { dy: -300 })).toEqual({ dx: 0, dy: -300 });
  });

  it('carried across only: that offset', () => {
    expect(carryAt(under, { dx: -40 })).toEqual({ dx: -40, dy: 0 });
  });

  it('the text off the carry by a pixel: carried; by two: not', () => {
    expect(carryAt(under, { dy: -300, peerDy: -299 })).toEqual({ dx: 0, dy: -300 });
    expect(carryAt(under, { dy: -300, peerDy: -298 })).toBeUndefined();
  });

  it('moved a pixel or less (the content at its end): not carried — the strokes\' own failures name it', () => {
    expect(carryAt(under, {})).toBeUndefined();
    expect(carryAt(under, { dy: -1 })).toBeUndefined();
  });

  it('the field grown by 10 px (or cut, at an edge or by the IME line): not carried — it did not just move', () => {
    expect(carryAt(under, { dy: -300, grown: 10 })).toBeUndefined();
  });

  it('the scroll view moved with the two, by 300 (not by a pixel): not carried; in no scroll view the tree marks: not carried', () => {
    expect(carryAt(under, { dy: -300, listDy: -300 })).toBeUndefined();
    expect(carryAt(under, { dy: -300, listDy: -1 })).toEqual({ dx: 0, dy: -300 });
    expect(carryAt(seenAt({ marked: false }, UNDER), { dy: -300, marked: false })).toBeUndefined();
    expect(carryAt(under, { dy: -300, marked: false })).toBeUndefined();
  });

  it('the scroll view is the nearest one: the inner list moved with the two inside an outer scroller that stayed put, not carried', () => {
    const nested = seenAt({ nested: true }, UNDER);
    expect(carryAt(nested, { nested: true, dy: -300 })).toEqual({ dx: 0, dy: -300 });
    expect(carryAt(nested, { nested: true, dy: -300, listDy: -300 })).toBeUndefined();
  });

  it('a clear or untold is never carried; a match not covered has no carry', () => {
    expect(carryAt(seenAt({}, CLEAR), { dy: -300 })).toBeUndefined();
    expect(carryAt(seenAt({}, UNTOLD), { dy: -300 })).toBeUndefined();
    const clearOfIt = readAt({ dy: -300, peerDy: 300 });
    expect(clearOfIt.best.standing.kind).not.toBe('covered');
    expect(carriedCover(under, clearOfIt.best, clearOfIt.facts)).toBeUndefined();
  });
});

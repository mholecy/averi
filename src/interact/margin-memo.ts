import type { Rect, UiNode } from '../adapters/types.js';
import { quoted, sameRectWithinPixel, type QuotedNode } from '../ui-tree/geometry.js';
import type { ClearQuestion } from '../ui-tree/eyes.js';
import type { OrderSeen, PairSeen } from '../ui-tree/seen-order.js';
import type { Judged, TreeFacts } from './scroll-read.js';

/**
 * THE MARGIN MEMO: what the eyes saw this `scroll_until` call of the texts in the target's touch margin
 * (ui-tree/eyes.ts#ClearPair), and the two rules of docs/adr/0026-a-text-in-a-controls-touch-margin-is-judged-by-the-eyes.md
 * that read it — rule 6, once per text where it lies (`known`: which texts to ask, what to tell the read), and rule 8, the
 * cover carried with the target ends the call (`carriedCover`). One entry per text asked, so a later read tells its
 * judgement what was seen instead of looking again: one screenshot per text where it lies. The round
 * (interact/scroll-rounds.ts#State.marginKept) holds it.
 *
 * - Seen drawn over the target (`under`): kept while the two keep the relation they were seen in — where they were, or
 *   carried together by the same offset in the target's scroll view, which stayed where it was (`movedTogether`): a
 *   text in the target's own moving content paints over it wherever the two go, so a later screenshot would only cost
 *   the time again, and the carry ends the call (`carriedCover`, the round's BoundBy `movesWith`). A relation changed —
 *   a text pinned over the content, which a stroke moves the target past; the scroll view itself moved, a sheet dragged
 *   with what lies over it — is asked again.
 * - Seen clear or untold — answers of the frame they were read on (a displaced or blended capture reads either): kept
 *   while the target and the text lie where they were seen, each within a pixel; moved, they are asked again.
 * - A kept `under` or `untold` keeps the cover whatever the others are: nothing is asked while one holds.
 * - A text asked again replaces its entry.
 *
 * The target's scroll view is its nearest clipping ancestor in the read (ui-tree/geometry.ts#Clips.scrollersOf),
 * undefined when the tree marks none — then nothing is carried.
 *
 * The interface, which is also the test surface (tests/interact/margin-memo.test.ts): `known` (once a read that poses a
 * clear question), `carriedCover` (once a `fully: true` bound). Pure: no adapter, no clock, no I/O.
 */
export type MarginMemo = readonly MarginAnswer[];

/** A target and a text that lies over it, where one read found them, and the target's nearest scroll view there — undefined when it has none. */
interface PairAt {
  readonly target: Rect;
  readonly peer: Rect;
  readonly scrollView: Rect | undefined;
}

/** How far a node moved, in the source's frame units: across (`dx`) and down (`dy`). */
export interface Offset {
  readonly dx: number;
  readonly dy: number;
}

/** What the eyes saw of one text: the text by what a later read can find it by, where the eyes saw the pair, and the answer. */
interface MarginAnswer {
  readonly peer: QuotedNode;
  readonly where: PairAt;
  readonly seen: PairSeen;
}

/**
 * What the memo says of a read's clear question: the texts to ask the eyes (`ask`, the question with only those pairs),
 * or what to tell the read (`told`: the kept answers and this read's), with the memo that keeps this read's answers.
 */
export type MarginKnown = { readonly ask: ClearQuestion } | { readonly told: readonly OrderSeen[]; readonly memo: MarginMemo };

/**
 * What the round knows of `question` on this read, from what the eyes `answered` it on this read (if they were asked)
 * and what was seen this call: the texts not yet seen to ask — none asked when one kept as drawn over the target or
 * untold keeps the cover anyway — else what to tell the read, and the memo with this read's answers kept, each
 * replacing what was seen of that text before.
 */
export function known(memo: MarginMemo, question: ClearQuestion, answered: readonly OrderSeen[] | undefined, facts: TreeFacts): MarginKnown {
  const { node } = question;
  const scrollView = nearestScrollView(facts, node);
  const kept = question.pairs.flatMap(({ peer }): OrderSeen[] => {
    const seen = recall(memo, peer, { target: node.rect, peer: peer.rect, scrollView });
    return seen === undefined ? [] : [{ peer, ...seen }];
  });
  const unasked = question.pairs.filter(({ peer }) => !kept.some((k) => k.peer === peer));
  if (answered === undefined && unasked.length > 0 && !kept.some((k) => k.seen !== 'clear')) return { ask: { ...question, pairs: unasked } };
  const now = answered ?? [];
  return { told: [...kept, ...now], memo: remember(memo, now, node.rect, scrollView) };
}

/**
 * The offset `best`'s cover was carried by with it since a screenshot saw it drawn over `best` — `best` covered (its
 * standing's named cover), the cover's kept answer `under`, the two moved since by the same offset in a scroll view that
 * stayed where it was (`carriedSince`) — undefined otherwise. Moved, not merely still there: a pair unmoved since may
 * lie at the end of the content, which the strokes' own failures name.
 */
export function carriedCover(memo: MarginMemo, best: Judged, facts: TreeFacts): Offset | undefined {
  if (best.standing.kind !== 'covered') return undefined;
  const cover = best.standing.cover.node;
  const found = memo.find((kept) => about(kept, cover));
  return found === undefined ? undefined : carriedSince(found, { target: best.node.rect, peer: cover.rect, scrollView: nearestScrollView(facts, best.node) });
}

/** `node`'s nearest scroll view in this read — its nearest clipping ancestor (ui-tree/geometry.ts#Clips.scrollersOf) — undefined when the tree marks none. */
function nearestScrollView(facts: TreeFacts, node: UiNode): Rect | undefined {
  return facts.scene.clips.scrollersOf(node)[0];
}

/** `kept` is an answer about `peer` — the same text: its identifier and label, its size within a pixel (the memo's key). */
function about(kept: MarginAnswer, peer: UiNode): boolean {
  return kept.peer.identifier === peer.identifier && kept.peer.label === peer.label && sameSize(kept.peer.rect, peer.rect);
}

/** The same size within a pixel each way: a node that grew or shrank (cut at an edge, a header collapsing) did not just move. */
const sameSize = (a: Rect, b: Rect): boolean => Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

/**
 * The offset a kept `under` was carried by since its screenshot (`movedTogether`, from where the eyes saw the pair to
 * `now`) — the one reading of "the cover moves with it", for `recall` and `carriedCover` alike; undefined for `clear`
 * and `untold`, answers of their frame only.
 */
function carriedSince(found: MarginAnswer, now: PairAt): Offset | undefined {
  return found.seen.seen === 'under' ? movedTogether(found.where, now) : undefined;
}

/**
 * The offset the pair moved by from `seen` to `now`, when it moved as one in the target's scroll view: that scroll view
 * where it was (within a pixel), the target moved more than a pixel on some axis, the peer by the same offset within a
 * pixel each way, neither grown nor shrunk (`sameSize`) — undefined otherwise. A pair carried so lies in that
 * scroll view's moving content: no stroke separates them (scroll-rounds.ts#BoundBy's `movesWith`). A scroll view that
 * moved itself (a sheet dragged to another detent, an outer scroller carrying an inner one) carried what lies over it
 * too, a pinned text among them, which the next stroke of the list may leave behind; a target in no scroll view the
 * tree marks has no content to be carried in: neither is carried. A target cut at its container's edge, or by the soft
 * keyboard's line, changed size: not carried, though it moved. Measured from where the eyes saw the two, not from the
 * last read.
 */
function movedTogether(seen: PairAt, now: PairAt): Offset | undefined {
  if (seen.scrollView === undefined || now.scrollView === undefined || !sameRectWithinPixel(seen.scrollView, now.scrollView)) return undefined;
  const dx = now.target.x - seen.target.x;
  const dy = now.target.y - seen.target.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) return undefined;
  const peerAlong = Math.abs(now.peer.x - seen.peer.x - dx) <= 1 && Math.abs(now.peer.y - seen.peer.y - dy) <= 1;
  return peerAlong && sameSize(seen.target, now.target) && sameSize(seen.peer, now.peer) ? { dx, dy } : undefined;
}

/** The kept answer about `peer`, the pair as `now` finds it: both where they were seen, or, for `under`, carried together since (`carriedSince`). */
function recall(memo: MarginMemo, peer: UiNode, now: PairAt): PairSeen | undefined {
  const found = memo.find((kept) => about(kept, peer));
  if (found === undefined) return undefined;
  const where = sameRectWithinPixel(found.where.peer, now.peer) && sameRectWithinPixel(found.where.target, now.target);
  return where || carriedSince(found, now) !== undefined ? found.seen : undefined;
}

/** `memo` with what the eyes `answered` of `target`'s margin texts on this read kept, in `scrollView` (the target's nearest), each replacing what was seen of that text before. */
function remember(memo: MarginMemo, answered: readonly OrderSeen[], target: Rect, scrollView: Rect | undefined): MarginMemo {
  const now = answered.map(({ peer, ...seen }): MarginAnswer => ({ peer: quoted(peer), where: { target: { ...target }, peer: { ...peer.rect }, scrollView }, seen }));
  const before = memo.filter((kept) => !answered.some(({ peer }) => about(kept, peer)));
  return [...before, ...now];
}

import type { Rect, UiNode } from '../adapters/types.js';
import { quoted, sameRectWithinPixel, type QuotedNode } from '../ui-tree/geometry.js';
import type { OrderSeen, PairSeen } from '../ui-tree/seen-order.js';
import { movedTogether, type Offset, type PairAt } from './motion-ledger.js';

/**
 * THE MARGIN MEMO: what the eyes saw this `scroll_until` call of the texts in the target's touch margin
 * (ui-tree/eyes.ts#ClearPair, docs/adr/0026-a-text-in-a-controls-touch-margin-is-judged-by-the-eyes.md rules 6 and 8),
 * one entry per text asked — so a later read tells its judgement what was seen instead of looking again: one screenshot
 * per text where it lies. The round (interact/scroll-rounds.ts#State.marginKept) holds it; this module decides how long
 * an answer holds.
 *
 * - Seen drawn over the target (`under`): kept while the two keep the relation they were seen in — where they were, or
 *   carried together by the same offset in the target's scroll view, which stayed where it was
 *   (motion-ledger.ts#movedTogether): a text in the target's own moving content paints over it wherever the two go, so
 *   a later screenshot would only cost the time again, and the carry ends the call (`carriedCover`, the round's
 *   BoundBy `movesWith`). A relation changed — a text pinned over the content, which a stroke moves the target past; the
 *   scroll view itself moved, a sheet dragged with what lies over it — is asked again.
 * - Seen clear or untold — answers of the frame they were read on (a displaced or blended capture reads either): kept
 *   while the target and the text lie where they were seen, each within a pixel; moved, they are asked again.
 * - A text asked again replaces its entry (`remember`).
 *
 * The interface: `recall` (the kept answer a read is told), `carriedCover` (the carry the bound reads), `remember`
 * (this read's answers kept). Pure: no adapter, no clock, no I/O.
 */
export type MarginMemo = readonly MarginAnswer[];

/** What the eyes saw of one text: the text by what a later read can find it by, where the eyes saw the pair, and the answer. */
interface MarginAnswer {
  readonly peer: QuotedNode;
  readonly where: PairAt;
  readonly seen: PairSeen;
}

/** `kept` is an answer about `peer` — the same text: its identifier and label, its size within a pixel (the memo's key). */
function about(kept: MarginAnswer, peer: UiNode): boolean {
  const { rect } = kept.peer;
  return kept.peer.identifier === peer.identifier && kept.peer.label === peer.label && Math.abs(rect.width - peer.rect.width) <= 1 && Math.abs(rect.height - peer.rect.height) <= 1;
}

/**
 * The offset a kept `under` was carried by since its screenshot (motion-ledger.ts#movedTogether, from where the eyes saw
 * the pair to `now`) — the one reading of "the cover moves with it", for `recall` and `carriedCover` alike; undefined
 * for `clear` and `untold`, answers of their frame only.
 */
function carriedSince(found: MarginAnswer, now: PairAt): Offset | undefined {
  return found.seen.seen === 'under' ? movedTogether(found.where, now) : undefined;
}

/** The kept answer about `peer`, the pair as `now` finds it: both where they were seen, or, for `under`, carried together since (`carriedSince`). */
export function recall(memo: MarginMemo, peer: UiNode, now: PairAt): PairSeen | undefined {
  const found = memo.find((kept) => about(kept, peer));
  if (found === undefined) return undefined;
  const where = sameRectWithinPixel(found.where.peer, now.peer) && sameRectWithinPixel(found.where.target, now.target);
  return where || carriedSince(found, now) !== undefined ? found.seen : undefined;
}

/**
 * The offset `cover` — seen drawn over the target by a screenshot — was carried by with it since, in a scroll view that
 * stayed where it was (`carriedSince`), the pair as `now` finds it; undefined otherwise. Moved, not merely still there:
 * a pair unmoved since may lie at the end of the content, which the strokes' own failures name.
 */
export function carriedCover(memo: MarginMemo, cover: UiNode, now: PairAt): Offset | undefined {
  const found = memo.find((kept) => about(kept, cover));
  return found === undefined ? undefined : carriedSince(found, now);
}

/** `memo` with what the eyes `answered` of `target`'s margin texts on this read kept, in `scrollView` (the target's nearest), each replacing what was seen of that text before. */
export function remember(memo: MarginMemo, answered: readonly OrderSeen[], target: Rect, scrollView: Rect | undefined): MarginMemo {
  const now = answered.map(({ peer, ...seen }): MarginAnswer => ({ peer: quoted(peer), where: { target: { ...target }, peer: { ...peer.rect }, scrollView }, seen }));
  const before = memo.filter((kept) => !answered.some(({ peer }) => about(kept, peer)));
  return [...before, ...now];
}

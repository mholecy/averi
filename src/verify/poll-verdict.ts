import type { DeviceAdapter, Rect, UiNode } from '../adapters/types.js';
import { pollTree, Undecided, type FirstSample, type PollObserver, type PollRound } from '../ui-tree/read-tree.js';
import { markedForMiss } from '../ui-tree/window-mark.js';
import { missOf, withMissNote } from '../ui-tree/miss.js';
import type { Target } from '../ui-tree/selectors.js';
import { formatSeconds } from '../util/duration.js';
import type { MeasuredFrame } from './capture.js';
import type { Shot } from './shot.js';

/**
 * The verifier's poll and its vocabulary, shared by the tree-only asserts' poll and the
 * pixel poll (verify/pixel-poll.ts, the color and ocr asserts). Its own module
 * below assert.ts, importing no assert code, for the reason fail-closed.ts is
 * one: both need it and assert.ts imports the other. The tree poll
 * (ui-tree/read-tree.ts) does not learn any of this: it ends on a value and
 * remembers no miss; what a round missed is the verifier's to keep (`pollVerdicts`).
 */

/**
 * A verdict in sentences: an assert's result, and what a measurement concludes of one round. `pass: true` stops the
 * poll; `pass: false` carries a detail worth reporting IF the deadline is reached, without ending the poll (a round's
 * miss, `asRound`) — unless it is final.
 */
export type PollVerdict = { pass: boolean; detail?: string; final?: undefined } | FinalVerdict;

/**
 * A miss no later round can change: the poll ends at once with this verdict
 * instead of polling to the deadline, which would only repeat it and bury it
 * under the timeout wording — a check that cannot be made on this device at
 * all (an engine that will never read, a capture the adapter refuses), not a
 * screen that may still change. Every poll honours it (`pollVerdicts`). Its own
 * member of the union because a final verdict ENDS the assert and its detail
 * IS the failure sentence, so one that does not fail, or fails without its
 * sentence, does not type-check.
 */
export interface FinalVerdict {
  pass: false;
  detail: string;
  final: true;
}

/**
 * What a pixel assert's `measure` is handed (verify/pixel-poll.ts): the
 * element's rect and the frame captured against the same round's tree.
 * Named here, beside the verdict it returns, so the measurements that take
 * it (text-parity.ts#measureOcrAssert) do not respell it.
 */
export interface PixelMeasureInput {
  /**
   * The first `findBySpec` match's rect — the same duplicate-id rule as rect-parity — from the tree handed to the
   * capture, cut to what its scroll views draw (ui-tree/scroll-clips.ts#Clips.drawnIn: the drawn frame) — what
   * the capture shows of it.
   */
  rect: Rect;
  /** The settled screenshot (verify/shot.ts): its PNG for the OCR recognizer. */
  shot: Shot;
  /** The decoded frame — never undecoded, never treeless. Its `scale` may still carry an error: the measurement's policy. */
  measured: MeasuredFrame;
}

/**
 * What a round of the verifier's poll concludes, in the poll's own miss type `M`: a pass or a final miss, which end the
 * poll (`pollVerdicts`), or a miss, which the poll keeps (`LastFinding`) while polling goes on — mid-animation geometry
 * may legitimately be wrong for a frame, so only the state at the deadline is the verdict. `undefined` says nothing (the
 * element is not there yet) and erases nothing; `Undecided` is the tree poll's (ui-tree/read-tree.ts#Undecided).
 */
export type RoundVerdict<M> = Ending | Missed<M>;

/** A round verdict that ends the poll: a pass, with its detail, or a final miss. */
export type Ending = { pass: true; detail?: string } | FinalVerdict;

/** A miss of one round, kept for the timeout until a later round replaces or withdraws it (`LastFinding`). */
export interface Missed<M> {
  pass: false;
  miss: M;
  final?: undefined;
}

/**
 * A measurement's verdict as a round's (`RoundVerdict`), its detail the miss: a non-passing one with no detail has
 * nothing to say, so it continues the poll without erasing an earlier miss.
 */
export const asRound = (verdict: PollVerdict | undefined): RoundVerdict<string> | undefined => {
  if (verdict === undefined) return undefined;
  if (verdict.pass) return { pass: true, detail: verdict.detail };
  if (verdict.final) return verdict;
  return verdict.detail === undefined ? undefined : { pass: false, miss: verdict.detail };
};

/**
 * The verifier's memory of a poll's last finding: the miss the last round that missed reported, until a later one
 * replaces it, or a later round finds it no longer true and withdraws it — a miss that named a condition the later
 * round saw gone. A round with nothing to say leaves it standing.
 */
class LastFinding<M> implements Withdraw<M> {
  private miss: M | undefined;

  /** The miss that stands, if any. */
  get last(): M | undefined {
    return this.miss;
  }

  found(miss: M): void {
    this.miss = miss;
  }

  withdraw(which: (miss: M) => boolean): void {
    if (this.miss !== undefined && which(this.miss)) this.miss = undefined;
  }
}

/**
 * What a round is handed of its poll's `LastFinding`: the withdrawal alone. A round reports a miss by returning it, so
 * the poll decides what is kept — never a handed-on round's.
 */
export interface Withdraw<M> {
  /** Withdraw the standing miss when it is one `which` names; a miss it does not name stands. */
  withdraw(which: (miss: M) => boolean): void;
}

/** What a poll that timed out leaves for its wording: the miss that stands, the last read's error, and its trees. */
export interface TimedOut<M> {
  miss?: M;
  readError?: Error;
  undecidedTree?: UiNode;
  lastTree?: UiNode;
}

export interface VerdictPollOptions<M> {
  timeoutMs: number;
  pollMs: number;
  /** A handed-on read (ui-tree/read-tree.ts#PollOptions.first): only a pass ends the poll on it. */
  first?: FirstSample;
  observer?: PollObserver;
  /**
   * The target whose not-found the timeout words, given the miss that stands — what the window manager's word is asked
   * about at the deadline (ui-tree/window-mark.ts#markedForMiss). Absent, or undefined, for a timeout that words no
   * not-found.
   */
  missing?: (miss: M | undefined) => Target | undefined;
  /** The timeout wording, each assert's own. */
  timeoutDetail: (last: TimedOut<M>) => string;
}

/**
 * The verifier's poll, owned once for the tree-only asserts and the pixel poll: `round` on every tree the tree poll reads
 * (ui-tree/read-tree.ts#pollTree), until a pass or a final miss, which is the verdict; else, at the deadline, the one
 * timeout tail — the last tree marked by the window manager's word for a not-found (`missing`), then the assert's own
 * wording of the miss that stands. A round's miss goes to the poll's `LastFinding`, of which the round is handed only the
 * withdrawal (`Withdraw`). A handed-on tree's miss or final miss is discarded, nothing of it kept (ADR 0030: a handed read is
 * a positive verdict or a first sample), so a miss is only ever a fresh read's.
 */
export async function pollVerdicts<M>(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'focusedWindow'>,
  round: (
    tree: UiNode,
    poll: PollRound,
    finding: Withdraw<M>,
  ) => Promise<RoundVerdict<M> | typeof Undecided | undefined> | RoundVerdict<M> | typeof Undecided | undefined,
  { timeoutMs, pollMs, first, observer, missing, timeoutDetail }: VerdictPollOptions<M>,
): Promise<PollVerdict> {
  const finding = new LastFinding<M>();
  const outcome = await pollTree(
    adapter,
    async (tree, poll): Promise<Ending | typeof Undecided | undefined> => {
      const verdict = await round(tree, poll, finding);
      if (verdict === undefined || verdict === Undecided || verdict.pass) return verdict;
      if (poll.handedOn !== undefined) return undefined;
      if (verdict.final) return verdict;
      finding.found(verdict.miss);
      return undefined;
    },
    { timeoutMs, pollMs, ...(first !== undefined && { first }), ...(observer !== undefined && { observer }) },
  );
  if (!outcome.timedOut) return outcome.value.pass ? { pass: true, detail: outcome.value.detail } : { pass: false, detail: outcome.value.detail };
  const miss = finding.last;
  // The window manager's word on the last tree's window, asked now the poll has given up on a target it never found
  // (ui-tree/window-mark.ts): a standing miss is the finding, and no not-found is worded beside it.
  const lastTree = await markedForMiss(adapter, outcome, missing?.(miss));
  return {
    pass: false,
    detail: timeoutDetail({ ...(miss !== undefined && { miss }), readError: outcome.readError, undecidedTree: outcome.undecidedTree, lastTree }),
  };
}

/**
 * Every assert's "not found within N s" (formatSeconds), of the poll's last round: the last tree-read error when that
 * read failed; else what the last tree read saw of the assert's `target` (ui-tree/miss.ts#missOf — a window it lists
 * alone, presented over the screen beneath, a source that lists the active window only, idb's dialect for an id it
 * does not list), its note in the same place. The target is required, so no assert can ask without it.
 */
export const notFound = (timeoutMs: number, last: { readError?: Error; lastTree?: UiNode }, target: Target): string => {
  const headline = `not found within ${formatSeconds(timeoutMs)}`;
  return last.readError !== undefined ? `${headline} (last UI tree read failed: ${last.readError.message})` : withMissNote(headline, missOf({ tree: last.lastTree, target }));
};

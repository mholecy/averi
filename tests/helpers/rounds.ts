import type { DeviceScreen, Rect, Stroke, UiNode } from '../../src/adapters/types.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import type { KeyboardRemedy } from '../../src/ui-tree/soft-keyboard.js';
import { round, startRounds, type RoundRules, type RoundSeen, type RoundStep, type ScrollOutcome } from '../../src/interact/scroll-rounds.js';
import { scrollFailure, scrollResult, type ScrollUntilResult } from '../../src/interact/scroll-text.js';
import { scrollStroke, type JudgingScreen } from '../../src/interact/swipe.js';
import { node } from './fake.js';

/**
 * The TEST adapter of interact/scroll-rounds.ts#round (the production one is
 * interact/scroll.ts#scrollUntilVisible): `play` feeds a table of what each
 * read saw and returns what the rounds did — no fake device, no clock, no
 * timers. One row per read, in order; a row's keyboard answers are given up
 * front and handed to `round` only when it asks.
 *
 * What an `ask` is NOT: a device query. `asks` lists the questions the
 * round put to its keyboard reading; what each costs is the reading's
 * (ui-tree/keyboard-cover.ts) — `unlocated` of a reading that is not hidden
 * asks nothing, `witness` of the in-tree model nothing. The query counts on
 * Android stay pinned at the driver (tests/interact/scroll.test.ts).
 */
export interface Row {
  /** Every match this read held, in tree order. Ignored with `error`. */
  found?: readonly UiNode[];
  /** The read failed with this message. */
  error?: string;
  /** `judgingScreen`'s answer; absent, the round keeps the last frame (the device as built until one is given). */
  screen?: JudgingScreen;
  /** The reading's `cover()`: absent for a keyboard hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`; default: no node is the keyboard's. */
  ofKeyboard?: (node: UiNode) => boolean;
  /** Every match's nearest clipping scroll container — shorthand for `scrollers: [scroller]`. */
  scroller?: Rect;
  /** Every match's clipping ancestors, nearest first (geometry.ts#scrollersOf); default none — an iOS tree, or a match with no clipping ancestor. */
  scrollers?: readonly Rect[];
  /** The tree's largest clipping container (geometry.ts#largestScroller); default none. */
  mainScroller?: Rect;
  /** The whole tree's fingerprint (read-tree.ts#treeFingerprint); default none — the whole-tree exhaustion never fires. */
  fingerprint?: string;
  /** The tree shows a progress node (read-tree.ts#showsProgress); default false. */
  loading?: boolean;
  /** The answer to `ask witness` (the reading's `corroborated()`); default true. */
  corroborated?: boolean;
  /** The answer to `ask unlocated` (the reading's `unlocated()`); default false. */
  unlocated?: boolean;
  /** swipe.ts#screenBox's box this round (`RoundSeen.gesture`); default `screen`'s box, else the device as built — as the driver's is on a screen held as built. */
  gesture?: Rect;
  /** The stroke the previous step drew, when it was a stroke; default `drawnFor` that step — the driver's points for it. */
  drawn?: Stroke;
  /** ms since the scroll began; default 0. */
  elapsedMs?: number;
}

/**
 * The stroke a row hands back when it names none: the driver's own points
 * for the step (swipe.ts#scrollStroke) — the step carries every fact the
 * points are made of, its box decided by the round (deep/r3-scroll), so
 * nothing here re-derives geometry; until then a stand-in built from the
 * step's shape, which could not see the driver's own judgement of the box
 * (the probe drawn off its container under the IME passed through it). A
 * row that means another stroke — one shorter than twice TOUCH_SLOP —
 * hands it in `drawn`.
 */
export const drawnFor = (step: Extract<RoundStep, { do: 'stroke' }>): Stroke => {
  const { box } = step;
  if (box === undefined) throw new Error('drawnFor: a stroke step with no box (the round had no gesture box)');
  return scrollStroke({ ...step, box });
};

type Step = Exclude<RoundStep, { do: 'ask' }>;
export type Ask = 'witness' | 'unlocated';

export interface Played {
  /** Per row: the questions the round asked, then the step it took. */
  rounds: { asks: Ask[]; step: Step }[];
  steps: Step[];
  asks: Ask[];
  /** The stop, when a row ended the scroll (the last row must). */
  outcome: ScrollOutcome | undefined;
}

/** Play `rows` through `round` from `startRounds(rules, screen)`. Throws when a stop comes before the last row — a table with rows nobody reads is a wrong table. */
export function play(rules: RoundRules & { screen: DeviceScreen }, rows: readonly Row[]): Played {
  let state = startRounds(rules, rules.screen);
  const rounds: Played['rounds'] = [];
  let outcome: ScrollOutcome | undefined;
  let stroked: Extract<RoundStep, { do: 'stroke' }> | undefined;
  rows.forEach((row, i) => {
    if (outcome !== undefined) throw new Error(`play: row ${i} after the stop`);
    const seen: RoundSeen = {
      read:
        row.error !== undefined
          ? { error: new Error(row.error) }
          : { found: row.found ?? [], ofKeyboard: row.ofKeyboard ?? (() => false), scrollersOf: () => row.scrollers ?? (row.scroller !== undefined ? [row.scroller] : []), ...(row.mainScroller && { mainScroller: row.mainScroller }), ...(row.fingerprint !== undefined && { fingerprint: row.fingerprint }), ...(row.loading === true && { loading: true }), ...(row.screen && { screen: row.screen }), ...(row.cover && { cover: row.cover }) },
      elapsedMs: row.elapsedMs ?? 0,
      gesture: row.gesture ?? row.screen?.box ?? { x: 0, y: 0, ...rules.screen },
      ...(stroked !== undefined && { drawn: row.drawn ?? drawnFor(stroked) }),
    };
    const asks: Ask[] = [];
    let next = round(state, seen);
    while (next.step.do === 'ask') {
      asks.push(next.step.what);
      if (next.step.what === 'witness') seen.corroborated = row.corroborated ?? true;
      else seen.unlocated = row.unlocated ?? false;
      next = round(state, seen);
    }
    state = next.state;
    const step: Step = next.step;
    rounds.push({ asks, step });
    stroked = step.do === 'stroke' ? step : undefined;
    if (step.do === 'stop') outcome = step.outcome;
  });
  return { rounds, steps: rounds.map((r) => r.step), asks: rounds.flatMap((r) => r.asks), outcome };
}

/** The stop's result, rendered as the driver returns it; throws unless the scroll stopped `visible`. */
export function resultOf(played: Played): ScrollUntilResult {
  const { outcome } = played;
  if (outcome?.kind !== 'visible') throw new Error(`resultOf: the scroll ended ${outcome?.kind ?? 'without a stop'}`);
  return scrollResult(outcome);
}

/** The stop's failure, as the driver throws it for `describe`; throws unless the scroll failed. */
export function failureOf(played: Played, describe: string): Error {
  const { outcome } = played;
  if (outcome === undefined || outcome.kind === 'visible') throw new Error(`failureOf: the scroll ended ${outcome?.kind ?? 'without a stop'}`);
  return scrollFailure(outcome, describe);
}

/** The direction each stroke was drawn toward — where the content lay for it. */
export const strokesToward = (played: Played): string[] => played.steps.flatMap((s) => (s.do === 'stroke' ? [s.toward] : []));

/** Each stroke's cover cut (`coverTop`), undefined for a whole-screen stroke. */
export const strokeCovers = (played: Played): (number | undefined)[] => played.steps.flatMap((s) => (s.do === 'stroke' ? [s.coverTop] : []));

/** The window model's remedy (`back`), and the in-tree model's with the adapter's advice. */
export const BACK: KeyboardRemedy = { dismissal: 'back', advice: undefined };
export const NO_BACK: KeyboardRemedy = { dismissal: 'none', advice: 'ADVICE' };

/** A shown keyboard covering `band` alone, as the reading's `cover()` gives it. */
export const coverOver = (band: Rect, remedy: KeyboardRemedy = BACK): KeyboardCover => ({ rects: [band], top: band, band, remedy });

/** A match: identifier `id`, at `rect`. */
export const match = (rect: Rect, id = 't'): UiNode => node({ role: 'button', identifier: id, rect: { ...rect } });

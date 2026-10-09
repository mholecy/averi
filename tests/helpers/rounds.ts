import type { DeviceScreen, Rect, Stroke, UiNode } from '../../src/adapters/types.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import type { KeyboardRemedy } from '../../src/ui-tree/soft-keyboard.js';
import { round, startRounds, type RoundRules, type RoundSeen, type RoundStep, type ScrollOutcome } from '../../src/interact/scroll-rounds.js';
import { scrollFailure, scrollResult, type ScrollUntilResult } from '../../src/interact/scroll-text.js';
import { scrollStroke, type ScreenBox } from '../../src/interact/swipe.js';
import { node } from './fake.js';

/**
 * The TEST adapter of interact/scroll-rounds.ts#round (the production one is
 * interact/scroll.ts#scrollUntilVisible): `play` feeds a table of what each
 * read saw and returns what the rounds did — no fake device, no clock, no
 * timers. One row per read, in order; a row's keyboard answers are given up
 * front and handed to `round` only when it asks. A row says what was ON
 * the screen — the matches, their containers, a spinner — and `treeOf`
 * builds the tree the round derives its facts from, as from a device's;
 * the stroke a row hands back is the driver's own (`drawnFor`).
 *
 * What an `ask` is NOT: a device query. `asks` lists the questions the
 * round put to its keyboard reading; what each costs is the reading's
 * (ui-tree/keyboard-cover.ts) — `unlocated` of a reading that is not hidden
 * asks nothing, `witness` of the in-tree model nothing. The query counts on
 * Android stay pinned at the driver (tests/interact/scroll.test.ts).
 */
export interface Row {
  /** Every match this read held, in tree order — put into the row's tree (`treeOf`). Ignored with `error`. */
  found?: readonly UiNode[];
  /** The read failed with this message. */
  error?: string;
  /** swipe.ts#screenBox's answer this round (`RoundSeen.screen`: the gesture box, and the boxes judged in on a read that read); default the device as built, `{ box, boxes: [box] }`; `null`: screenBox threw — no box this round, the frame stays. */
  screen?: ScreenBox | null;
  /** The reading's `cover()`: absent for a keyboard hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`; default: no node is the keyboard's. */
  ofKeyboard?: (node: UiNode) => boolean;
  /** Every match's nearest clipping scroll container — shorthand for `scrollers: [scroller]`. */
  scroller?: Rect;
  /** Every match's clipping ancestors, nearest first — clipping nodes the matches are put inside; default none (an iOS tree, or a match with no clipping ancestor). */
  scrollers?: readonly Rect[];
  /** Another clipping container in the tree, beside the matches' (the screen's own list, for geometry.ts#largestScroller); default none. */
  mainScroller?: Rect;
  /**
   * The rest of the screen — a text node of this label (read-tree.ts
   * #treeFingerprint reads it): two rows with the same matches, containers
   * and `rest` are the same tree. Default none, so rows that differ in
   * nothing read as one unchanged screen, as on a device.
   */
  rest?: string;
  /** The tree shows a progress node (read-tree.ts#showsProgress); default false. */
  loading?: boolean;
  /** The answer to `ask witness` (the reading's `corroborated()`); default true. */
  corroborated?: boolean;
  /** The answer to `ask unlocated` (the reading's `unlocated()`); default false. */
  unlocated?: boolean;
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

/**
 * The tree a row read: the screen, the matches inside their clipping
 * containers (outermost first, each `clipsDescendants`), `mainScroller`
 * beside them, a progress node when `loading`, and `rest`. The round
 * derives every tree fact from it (scroll-rounds.ts#TreeFacts) as it does
 * from a device's — the row says what is ON the screen, never what the
 * round should conclude. A match nested in another match (an id on a
 * container and its child) stays where it is, under that one.
 */
export function treeOf(row: Row, screen: DeviceScreen): UiNode {
  const found = row.found ?? [];
  const nested = (n: UiNode): boolean => found.some((m) => m !== n && contains(m, n));
  const chain = row.scrollers ?? (row.scroller !== undefined ? [row.scroller] : []);
  const matches = found.filter((n) => !nested(n));
  const inScrollers = chain.reduce<UiNode[]>((inside, rect) => [node({ role: 'container', rect: { ...rect }, clipsDescendants: true, children: inside })], matches);
  return node({
    role: 'container',
    rect: { x: 0, y: 0, ...screen },
    children: [
      ...(row.mainScroller !== undefined ? [node({ role: 'container', identifier: 'main_scroller', rect: { ...row.mainScroller }, clipsDescendants: true })] : []),
      ...inScrollers,
      ...(row.loading === true ? [node({ role: 'progress', rect: { x: 500, y: 100, width: 80, height: 80 } })] : []),
      ...(row.rest !== undefined ? [node({ role: 'text', label: row.rest })] : []),
    ],
  });
}

const contains = (root: UiNode, n: UiNode): boolean => root.children.some((c) => c === n || contains(c, n));

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
  const box: Rect = { x: 0, y: 0, ...rules.screen };
  const asBuilt: ScreenBox = { box, boxes: [box] };
  const rounds: Played['rounds'] = [];
  let outcome: ScrollOutcome | undefined;
  let stroked: Extract<RoundStep, { do: 'stroke' }> | undefined;
  rows.forEach((row, i) => {
    if (outcome !== undefined) throw new Error(`play: row ${i} after the stop`);
    const seen: RoundSeen = {
      read:
        row.error !== undefined
          ? { error: new Error(row.error) }
          : { tree: treeOf(row, rules.screen), found: row.found ?? [], ofKeyboard: row.ofKeyboard ?? (() => false), ...(row.cover && { cover: row.cover }) },
      elapsedMs: row.elapsedMs ?? 0,
      ...(row.screen !== null && { screen: row.screen ?? asBuilt }),
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

import type { Call, Outcome } from '../differential.js';
import type { CellTruth, Rect } from '../../truth/schema.js';
import { bandsOf, pointText, within } from '../../truth/truth.js';

/**
 * The judges every family's rows share (golden-spec.ts, the façade, says what the table is): the verbs, an
 * expectation's shape, what a reply sent and said, and the one classification every row goes through (classed).
 */

/**
 * `fully` is scroll_until with `fully: true` (rows.ts#fullyRow): a verb of its own, so that a target asked both stops
 * (a sliver, an overlapped row: the plain stop and the `fully` one) keys two rows (`<file> <tag> scroll_until`,
 * `<file> <tag> fully`), not one. `ocr` is the `ocr` assert, judged against the real pixels (phase 4: the host's
 * recognizer reading the captured screenshot) — skipped, and said so, where the host has none (golden.ts#ocrAvailability).
 */
export type Verb = 'tap' | 'colour' | 'scroll_until' | 'fully' | 'error' | 'text' | 'ocr';

export interface Expectation {
  verb: Verb;
  /** What the verb must answer, in a few words — the report's "expected". */
  says: string;
  call: Call;
  /** undefined: the outcome is what the truth implies; else why it is not. Already classed (see classed). */
  judge(outcome: Outcome): string | undefined;
  /**
   * Why the truth allows the target to be missing from the tree; unset, a "not in the tree" reply the judge accepts is
   * a mismatch (vacuous).
   */
  absent?: string;
  /**
   * Why only the live golden (scripts/truth/live.ts, phase 5) can judge it — a dynamic a replayed tree cannot show (a
   * stroke's effect, a turn back). Set, the golden mode never asks the row (golden.ts); it is declared here so the
   * table is whole.
   */
  live?: string;
}

export const BUDGET_MS = 1_000;
export const failed = (o: Outcome) => !o.reply.startsWith('All 1 asserts passed');
/**
 * The device's taps and swipe touch-downs as the fake device logged them (fake-device.ts): `idb ui tap x y`, `idb ui
 * swipe x1 y1 x2 y2 …` on iOS; `adb shell input tap x y`, `adb shell input swipe x1 y1 x2 y2 …` on Android.
 */
export const taps = (o: Outcome) => o.device.filter((c) => /^(idb ui|adb shell input) tap /.test(c));
/** The swipes the device was sent, each from its touch-down to its lift-off (the truth's units). */
export const strokes = (o: Outcome): { from: Point; to: Point }[] =>
  o.device.flatMap((c) => {
    const m = /^(?:idb ui|adb shell input) swipe (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(c);
    return m === null ? [] : [{ from: { x: Number(m[1]), y: Number(m[2]) }, to: { x: Number(m[3]), y: Number(m[4]) } }];
  });
export const touchDowns = (o: Outcome) => strokes(o).map((s) => s.from);
export const passed = (o: Outcome) => o.reply.startsWith('All 1 asserts passed');
export const swipes = (o: Outcome) => touchDowns(o).length;
/** The reply's first line — an assert's first verdict line, under its `N/N asserts …` summary. */
export const first = (o: Outcome) => {
  const lines = o.reply.split('\n');
  return (/^\d+\/\d+ asserts|^All \d+ asserts/.test(lines[0]) && lines.length > 1 ? lines[1] : lines[0]).slice(0, 200);
};
/** The reply without the selectors it echoes: `id:"lab.form-keyboard.vs"` must not read as the word keyboard. */
export const ownWords = (o: Outcome) => o.reply.replace(/\b[a-z]+:"(?:[^"\\]|\\.)*"/gi, '<selector>');
export const said = (o: Outcome, what: string) => `${what}: ${first(o)}`;

// --- reply grammar: the wording of averi's replies a judge reads, each beside the src that writes it ---

/**
 * The reply says the element is not in the tree — no evidence of what covers it: the resolver's timeout (src/interact/
 * resolve.ts:358, "…waiting for element X to appear"), scroll_until's give-up (src/interact/scroll-text.ts:593,
 * "element never appeared in the tree"), the assert poll's (src/verify/poll-verdict.ts:78, "not found within N s").
 */
export const notInTree = (o: Outcome) => /waiting for element .* to appear|never appeared in the tree|not found within/.test(o.reply);
/** The reply's remedy for a target under a presented screen (src/ui-tree/standing.ts:425-426, "— close it first"). */
export const closeFirst = (o: Outcome) => /close it first/.test(o.reply);
/**
 * The reply names scroll_until as the remedy (the off-screen, outside-its-scroll-view and sliver refusals do: src/
 * interact/tap-judgement.ts:336, "scroll_until it first").
 */
export const scrollAdvice = (o: Outcome) => /scroll_until/.test(ownWords(o));
/**
 * averi's reply for a tap it moved off a node's centre to an uncovered piece (src/interact/tap-judgement.ts:325,
 * `Aim.moved`): `Tapped <selector> at (x,y) — its centre (x,y) is under …; tapped the uncovered part WxH`
 * (golden-spec/base.ts#atProbe).
 */
export const MOVED_TAP = / at \(-?[\d.]+,-?[\d.]+\) — its centre \(-?[\d.]+,-?[\d.]+\) is .*; tapped the uncovered part \d+x\d+/;
/**
 * The `fully` stop's own account of a flush edge it probed (src/interact/scroll-text.ts:226-227, the wording since
 * 9c7885e: "its <side> edge lies on its scroll container's (…), and a probe swipe toward it moved nothing"): the side
 * (golden-spec/rows.ts#flushProbe).
 */
export const FLUSH_PROBED = /its (top|bottom|left|right) edge lies on its scroll container's .*a probe swipe toward it moved nothing/;
/**
 * What a refused dismissal names as lying over it — `toolbar` (#7's first half: SwiftUI's screen-sized Toolbar host, #19's
 * bar), `scrollable` (#7's second half: a scroll view shorter than the screen, its frame over the title) — read from the
 * guard's own clause (src/interact/keyboard-in-tree.ts:361, `none of the configured dismissals is usable on this screen
 * (…)`, each skipped dismissal's `covered by <role> …` from :335-345), not from any "toolbar" in the reply: its advice
 * names the input-accessory toolbar whatever covered the dismissal (golden-spec/rows.ts#dismissRow).
 */
// Errs safe: a `)` inside an earlier part of the clause (a selector's text) ends the match before `covered by`, and
// the row then names no cover — the mismatch stays red, only its wording loses the role.
export const DISMISSAL_COVERED = /none of the configured dismissals is usable[^(]*\([^)]*covered by ([a-z]+)/;
const NOT_IN_TREE = 'not in the tree: ';
/**
 * The one classification every row's judge goes through: the row's judge first — a reply it rejects is a mismatch of
 * the judge's own reason, whatever else it says; a reply it accepts that says the target is not in the tree is vacuous,
 * a mismatch of that class, said first — unless the row's truth allows the target to be absent.
 */
export function classed<E extends Expectation>(e: E): E {
  const judge = e.judge;
  return {
    ...e,
    judge: (o: Outcome) => {
      const why = judge(o);
      return why !== undefined || e.absent !== undefined || !notInTree(o) ? why : `${NOT_IN_TREE}${first(o)}`;
    },
  };
}
/** The taps and swipes the device was sent — what a reply DID, recorded on every golden check. */
export const sent = (o: Outcome) => o.device.filter((c) => /^(idb ui|adb shell input) (tap|swipe) /.test(c));
/**
 * What kind of reply it is, from a closed set — recorded on every golden check, so a known mismatch whose reply turns
 * into another kind (a timeout into a refusal, a stop into `fully visible`) fails the ratchet though its class and its
 * device calls stay: `not found` (the target not in the tree: notInTree), `Tapped`, `visible` (scroll_until stopped on
 * it), `PASS` and `FAIL` (an assert's verdict), `refused` (any other ERROR), `other`.
 */
export type ReplyKind = 'not found' | 'Tapped' | 'visible' | 'PASS' | 'FAIL' | 'refused' | 'other';
export function replyKind(o: Outcome): ReplyKind {
  if (notInTree(o)) return 'not found';
  if (o.reply.startsWith('Tapped')) return 'Tapped';
  if (/^Element .* visible after /.test(o.reply)) return 'visible';
  if (passed(o)) return 'PASS';
  if (/^\d+\/\d+ asserts FAILED/.test(o.reply)) return 'FAIL';
  if (o.reply.startsWith('ERROR')) return 'refused';
  return 'other';
}
/** A tap that must not land: not `Tapped`, and no tap sent. */
export const notTapped = (o: Outcome) => (o.reply.startsWith('Tapped') ? `Tapped: ${first(o)}` : taps(o).length > 0 ? `refused, but sent ${taps(o).join('; ')}` : undefined);
/** A plain stop that must reach the target where it is: not an ERROR, and no swipe. */
export const reachedWithNoSwipe = (o: Outcome) => (o.reply.startsWith('ERROR') ? `stopped: ${first(o)}` : swipes(o) > 0 ? `swiped ${swipes(o)}×: ${first(o)}` : undefined);
/** An assert that must pass. */
export const passes = (o: Outcome) => (passed(o) ? undefined : `failed: ${first(o)}`);

// --- points and regions (phase 3's rows) ---

export type Point = { x: number; y: number };
/** truth.ts#within, the one point-in-rect test the truth and the judges share. */
export { within };
/** The points the device was sent taps at (taps): `idb ui tap x y`, `adb shell input tap x y` — the truth's units. */
export const tapPoints = (o: Outcome): Point[] =>
  taps(o).flatMap((c) => {
    const m = /tap (-?[\d.]+) (-?[\d.]+)/.exec(c);
    return m === null ? [] : [{ x: Number(m[1]), y: Number(m[2]) }];
  });
/** Points as a mismatch lists them: `(x,y) (x,y)` (truth.ts#pointText each). */
export const pointsText = (ps: readonly Point[]) => ps.map(pointText).join(' ');

/**
 * Where a stroke may touch down on a cell: on the screen, clear of the system bands (CellTruth.safeArea) and of every
 * piece of the app's chrome (CellTruth.chrome) — a touch-down there presses the bar or the chrome instead of moving the
 * content (calibration.json #11: an Android stroke touching down on the floating tab bar; #16: idb's on the keyboard).
 */
export function strokeable(cell: Pick<CellTruth, 'screen' | 'safeArea' | 'chrome'>): (p: Point) => boolean {
  const screen = { x: 0, y: 0, width: cell.screen.width, height: cell.screen.height };
  const bands = bandsOf(screen, cell.safeArea);
  const off = [bands.status, bands.nav, ...Object.values(cell.chrome ?? {})].filter((r): r is Rect => r !== undefined);
  return (p) => within(p, screen) && !off.some((r) => within(p, r));
}

/** R-stroke's judge: every touch-down strokeable; undefined when so. */
export function strokesOff(o: Outcome, cell: Pick<CellTruth, 'screen' | 'safeArea' | 'chrome'>): string | undefined {
  const ok = strokeable(cell);
  const off = touchDowns(o).filter((p) => !ok(p));
  return off.length === 0 ? undefined : `touched down off the strokeable region at ${pointsText(off)}: ${first(o)}`;
}

/**
 * R-land's judge: a `Tapped` reply landed — every tap sent lies in `where` (what of the target shows, or its piece
 * clear of chrome), and a probe there fired its action (`fired`). `mustTap`: the target is plainly reachable, so a
 * refusal is a mismatch too; else a refusal that sent nothing is as good (a cut target averi may refuse, ADR 0005).
 */
export function landed(o: Outcome, where: Rect | null | undefined, fired: boolean, mustTap: boolean): string | undefined {
  if (!o.reply.startsWith('Tapped')) return mustTap ? `not tapped: ${first(o)}` : notTapped(o);
  if (!fired || where === null || where === undefined) return `Tapped where no probe fired it: ${first(o)}`;
  return tappedInside(o, where, 'what shows of it');
}

/**
 * A `Tapped` reply's taps all lie in `rect` (`label` names it: `its piece`, `what shows of it`) and at least one was
 * sent — a Tapped with no tap is no evidence it landed. undefined when so.
 */
export function tappedInside(o: Outcome, rect: Rect, label: string): string | undefined {
  const points = tapPoints(o);
  if (points.length === 0) return said(o, 'Tapped with no tap sent');
  const out = points.filter((p) => !within(p, rect));
  return out.length > 0 ? said(o, `Tapped outside ${label} at ${pointsText(out)}`) : undefined;
}


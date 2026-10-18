import type { Call, Outcome } from '../differential.js';
import { allPassed, claimsTap, firstLine, isError, notInTree, presentedRemedySaid, windowHintSaid } from '../../truth/replies.js';
import type { CellTruth, Rect } from '../../truth/schema.js';
import { bandsOf, pointText, within } from '../../truth/truth.js';
import type { StopAsk, TapAsk } from '../../truth/target-contract.js';

/**
 * The judges every family's rows share (golden-spec.ts, the façade, says what the table is): the verbs, an
 * expectation's shape, what a call SENT (the taps and swipes the fake device logged), and the one classification every
 * row goes through (classed). What a reply SAYS is read by scripts/truth/replies.ts alone — the live judges' reader
 * too; the helpers here that take an Outcome hand it its reply.
 */

/**
 * `fully` is scroll_until with `fully: true` (rows.ts#fullyRow): a verb of its own, so that a target asked both stops
 * (a sliver, an overlapped row: the plain stop and the `fully` one) keys two rows (`<file> <tag> scroll_until`,
 * `<file> <tag> fully`), not one. `ocr` is the `ocr` assert, judged against the real pixels (phase 4: the host's
 * recognizer reading the captured screenshot) — skipped, and said so, where the host has none (golden.ts#ocrAvailability).
 * `snapshot` is ui_snapshot read for what it says of one field (golden-spec/forms.ts#snapshotRow: its `error` column).
 */
export const VERBS = ['tap', 'colour', 'scroll_until', 'fully', 'error', 'text', 'ocr', 'snapshot'] as const;
export type Verb = (typeof VERBS)[number];

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
  /**
   * The target contract's clause the row judges (scripts/truth/target-contract.ts: a tap's TapAsk, a stop's StopAsk) —
   * the live golden's case stamps the same clause (VisibilityCase.asks), and tests/truth/target-contract.test.ts holds
   * the two equal for every committed truth target both ask. Unset on a row no live case asks (colour, text, ocr, the
   * forms' rows).
   */
  asks?: TapAsk | StopAsk;
  /**
   * The row's target key where it is not the target's tag (golden.ts keys a row `<file> <target> <verb>`): a second row
   * of the same verb asked another way — `<tag>.id`, a text target asked by its identifier (rows.ts#byIdentifier).
   */
  target?: string;
  /**
   * What the row read of the reply, in one line, where the reply's first line says nothing of it (a `snapshot` row: the
   * matched textfield's error, not the `[` a pretty-printed array opens with) — golden's check carries it
   * (GoldenCheck.read) and the calibration report shows it for a green row.
   */
  read?(outcome: Outcome): string;
}

export const BUDGET_MS = 1_000;
export const failed = (o: Outcome) => !allPassed(o.reply);
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
export const passed = (o: Outcome) => allPassed(o.reply);
export const swipes = (o: Outcome) => touchDowns(o).length;
/** The reply's first line (replies.ts#firstLine) — an assert's first verdict line, under its `N/N asserts …` summary. */
export const first = (o: Outcome) => firstLine(o.reply);
export const said = (o: Outcome, what: string) => `${what}: ${first(o)}`;

/**
 * The class of a reply beneath a presented layer that gives only the active-window hint — not in the tree, the remedy
 * offered as a possibility (tests/differential/golden/known.ts files its KNOWN rows by this value).
 */
export const NOT_IN_TREE_HINTED = 'not in the tree (active-window hint)';
/**
 * A row beneath a presented layer asks for the presented remedy (replies.ts#presentedRemedySaid): undefined when the
 * reply says it; else why not, by what it says instead — only the active-window hint (uiautomator, a window it does not
 * mark: NOT_IN_TREE_HINTED), or neither (`missing`, the row's own words).
 */
export const presentedRemedyMissing = (o: Outcome, missing: string): string | undefined =>
  presentedRemedySaid(o.reply) ? undefined : windowHintSaid(o.reply) ? said(o, NOT_IN_TREE_HINTED) : said(o, missing);

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
      return why !== undefined || e.absent !== undefined || !notInTree(o.reply) ? why : `${NOT_IN_TREE}${first(o)}`;
    },
  };
}
/** The taps and swipes the device was sent — what a reply DID, recorded on every golden check. */
export const sent = (o: Outcome) => o.device.filter((c) => /^(idb ui|adb shell input) (tap|swipe) /.test(c));
/** A tap that must not land: not `Tapped`, and no tap sent. */
export const notTapped = (o: Outcome) => (claimsTap(o.reply) ? `Tapped: ${first(o)}` : taps(o).length > 0 ? `refused, but sent ${taps(o).join('; ')}` : undefined);
/** A plain stop that must reach the target where it is: not an ERROR, and no swipe. */
export const reachedWithNoSwipe = (o: Outcome) => (isError(o.reply) ? `stopped: ${first(o)}` : swipes(o) > 0 ? `swiped ${swipes(o)}×: ${first(o)}` : undefined);
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
  if (!claimsTap(o.reply)) return mustTap ? `not tapped: ${first(o)}` : notTapped(o);
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


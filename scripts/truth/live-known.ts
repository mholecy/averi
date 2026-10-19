import type { VerdictClass } from './live-visibility.js';
import type { ReplyKind } from './replies.js';

/**
 * The live golden's KNOWN (phase 5): the live cases not ok at HEAD that an existing note or residual explains, keyed
 * `<platform> <source> <case id>`, each with the rule it fails by (its verdict's class) and the kind of reply that
 * verdict rests on (LiveVerdict.kind, replies.ts#replyKind) — as tests/differential/golden/<family>.known.ts pins a
 * replayed row's class and kind (ADR 0020 §4): a known case failing by another rule, or by the same rule on another
 * kind of reply (a stop claimed turned into a timeout, a refusal into a tap), is not known. The notes are docs/bugs
 * file names (`bug:`) or a residual of a decision (`residual:`), the static KNOWN's own wording; tests/truth/
 * lab-notes.test.ts ties them to docs/bugs and calibration.json.
 *
 * Its contract is weaker than ADR 0020 §4's in two ways, on purpose. The strokes are not pinned: a device's timing
 * moves how many a scroll_until sends, run to run. And a case on the device can pass by chance of timing: so live.ts
 * (a run of this checkout, or a `--rejudge` of one) exits 1 on a MISMATCH not listed here, and on a listed case that
 * comes back ok unless its entry is `intermittent` — one whose runs of the same commit differ (LV2: the flush probe
 * reveals a deep cut in most runs, not all). A non-intermittent case ok is fixed and must be struck off, as the static
 * ratchet asks; an intermittent one ok is printed as such. A `--side` run (a calibration of an older commit) is held to
 * neither: this KNOWN is HEAD's.
 *
 * The kind is pinned since round 5 (it was not before: "a device's timing moves it" was assumed, not measured). The
 * committed records measured it (docs/truth/live-records, rejudged by tests/truth/live-rejudge.test.ts): every entry's
 * kind below is what its case's record reads; and the cases with
 * several records, LV2's two flush cases (android-vis.json at HEAD, cal12-*.json: three runs at 9c7885e, two at
 * d043e65), read `visible` in all six — ok in four, a stop-claim in two: the timing moves the outcome, not the kind;
 * LV5's case likewise (ios-vis-2725e76.json and ios-scroll-bounded-wda-2725e76-*.json, three runs at
 * b71cbbb's src): `refused` where it is not reached, ok in two.
 * A run that reads another kind for a known case fails as NOT known, naming both: refile it. (An entry could once list
 * other rules and kinds its runs read, `also`, each with its record — LV4's turn spending its budget, the only one; it
 * left with LV4's entry at round 7's A1, and the mechanism with it at round 7's integration 3.)
 */

const LE1 = 'bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md';
const LE2 = 'bug:2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md';
const LE3 = 'bug:2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md';
const VA1 = 'bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md';
const LV1 = 'bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md';
const LV2 = 'bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md';
const LV3 = 'bug:2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md';
const MENU = 'bug:2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md';
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)';
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
const NO_ID = 'bug:2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md';
const UNMARKED_WINDOW = 'residual:ADR 0018 residual 19 — Android\'s presented window: the shapes are measured on one AVD and Material 3 only';
/** calibration.json #24's status, verbatim: the decision is that note's. */
const FAB = 'residual:accepted (round 13: the FAB host layer is a cover)';

/**
 * A known case: its note, the rule it fails by (live-visibility.ts#VerdictClass), the kind of reply that verdict rests
 * on (LiveVerdict.kind), and whether it may pass by timing.
 */
export interface KnownLive {
  note: string;
  cls: VerdictClass;
  kind: ReplyKind;
  /** Runs of the same commit differ: an ok run of it is no fix (see the header). */
  intermittent?: true;
}

/** The entries `<prefix> <id>` of every id, each known by `note`, `cls` and `kind`, with KnownLive's optional facts as given. */
const each = (prefix: string, ids: readonly string[], note: string, cls: VerdictClass, kind: ReplyKind, more: Pick<KnownLive, 'intermittent'> = {}) =>
  ids.map((id) => [`${prefix} ${id}`, { note, cls, kind, ...more }] as const);

export const LIVE_KNOWN: Readonly<Record<string, KnownLive>> = Object.fromEntries([
  // Android
  ...each('android uiautomator', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully'], LE1, 'stop-claim', 'visible'),
  ...each('android uiautomator', ['tap:scroll-bounded.S'], LE1, 'tap-claim', 'Tapped'),
  // Round 6's device check (android-vis.json at e98b87e, and at b71cbbb: android-vis-b71cbbb.json): carousel-in-list's
  // C, cut to the screen's right edge and not to its carousel, is LE1 across — tapped on the page's background, a stop
  // with no stroke.
  ...each('android uiautomator', ['tap:carousel-in-list.C'], LE1, 'tap-claim', 'Tapped'),
  ...each('android uiautomator', ['scroll:carousel-in-list.C'], LE1, 'stop-claim', 'visible'),
  // (#10's turn:scroll-collapsing.A, filed here until 2026-10-18: ok since the owner decided no turn on uiautomator —
  // ADR 0021 — and its judge became live-visibility.ts#judgeAndroidTurn: a loud failure naming `up` after the
  // two-stroke stop, which the record reads.)
  ...each('android uiautomator', ['scroll:scroll-sticky-cut.R.fully'], VA1, 'stop-claim', 'visible'),
  ...each('android uiautomator', ['scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'scroll:tabbar-floating.F'], LV1, 'unchanged-claim', 'not found'),
  ...each('android uiautomator', ['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S.fully'], LV2, 'stop-claim', 'visible', { intermittent: true }),
  ...each('android uiautomator', ['tap:fab.L', 'tap:fab.K'], FAB, 'tap-refused', 'refused'),
  // Round 7 (T2): the presented windows the parser does not mark (android-vis-dialogs.json, -scroll-run2/3.json; the
  // same in all three runs). Beneath the full-screen Compose Dialog every target's two strokes land on the dialog
  // (nothing dismissed: it has no outside) — residual 19, accepted with the hint every reply carries. (LW1's four
  // scroll cases beneath the Views BottomSheetDialog — A's and B's stroke up on the touch_outside scrim dismissing the
  // sheet, C's and D's two strokes on it — struck off by round 7's A7, f924893e: the window marked presented by
  // Material's ids, scroll_until stops before any stroke, ok in three runs of three: android-vis-sheet-dialog-run1…3.json.)
  ...each('android uiautomator', ['A', 'B', 'C', 'D'].map((t) => `scroll:dialog-fullscreen.${t}`), UNMARKED_WINDOW, 'presented-stroke', 'not found'),
  // iOS, idb: no scroll view listed
  ...each('ios idb', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'scroll:scroll-bounded.O'], LE2, 'stop-claim', 'visible'),
  ...each('ios idb', ['tap:scroll-bounded.S', 'tap:scroll-bounded.O'], LE2, 'tap-claim', 'Tapped'),
  ...each('ios idb', ['scroll:scroll-bounded.F', 'turn:scroll-bounded.F'], LE2, 'R-direction', 'refused'),
  // LV3 under idb only (no scroll view listed: its turned stroke still touches down in the header); fixed under WDA.
  ...each('ios idb', ['scroll:tabbar-floating.R'], LV3, 'R-direction', 'refused'),
  // sheet-long-list's F and L: idb lists the table's labels without their identifiers (and no row below the fold), so
  // neither is ever in its tree — an honest not-reached, its strokes unjudged since round 7's recapture records them
  // unlisted (TargetTruth.listed); until then F read R-direction, filed as
  // docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md.
  ...each('ios idb', ['scroll:sheet-long-list.F', 'scroll:sheet-long-list.L'], NO_ID, 'not-reached', 'not found'),
  ...each('ios idb', ['tap:sheet-long-list.R', 'tap:sheet-long-list-short.R'], NO_ID, 'tap-refused', 'not found'),
  ...each('ios idb', ['scroll:sheet-long-list-short.F'], NO_ID, 'not-reached', 'not found'),
  // blur-menu-grouped's C under idb only: WDA lists the menu row W over C's centre and refuses the tap (ok live:
  // refused, nothing fired) — its WDA entry struck off once an ok came to read as fixed (round-4 review S8).
  ...each('ios idb', ['tap:blur-menu-grouped.C'], BLUR, 'tap-claim', 'Tapped'),
  // Round 6's iOS device check (ios-vis.json at 11683c3): the refusal case beneath a presented layer in no scroll view
  // (L1's, first run on iOS). idb lists the presented layer alone, the target not in it: a target not yet in the tree is
  // stroked for (residual 6) — two strokes on the layer, the backgrounded sheet dismissed by the first or not.
  // Round 7's A5 (a1261499; ios-idb-sheet-a5-1.json, -2.json, ios-idb-vis-a5.json): a list holding UIKit's dismiss
  // region marks the layer presented, so sheet-medium's A–D and sheet-medium-edges' H and G stop before any swipe —
  // their six entries struck off (ok in three runs of three). Beneath the large sheet idb's list shows no sign of it:
  // A's and B's stroke still dismisses it, but scroll_until's changed stop says so and claims nothing — LOUD
  // (`presented-changed`) on `refused`, no longer a stop claimed on `visible`: known still, the sheet's loss
  // residual 6's cost; C and D, never dismissed, two strokes as before.
  ...each('ios idb', ['scroll:sheet-background.A', 'scroll:sheet-background.B'], NOT_YET_IN_TREE, 'presented-changed', 'refused'),
  ...each('ios idb', ['scroll:sheet-background.C', 'scroll:sheet-background.D', ...['A', 'B', 'C', 'D'].flatMap((t) => [`scroll:alert-dim.${t}`, `scroll:dim-cover.${t}`])], NOT_YET_IN_TREE, 'presented-stroke', 'not found'),
  // idb lists no carousel (LE2 across, as edges.known.ts files C's replayed rows): strokes across the screen's middle,
  // none moving the carousel, the reply "content exhausted … a layout defect".
  ...each('ios idb', ['scroll:carousel-in-list.C'], LE2, 'R-direction', 'refused'),
  ...each('ios idb', ['scroll:blur-menu-grouped.C'], BLUR, 'presented-stop', 'visible'),
  // iOS, WDA
  // Round 5's device check (ios-vis-2725e76.json, src b71cbbb): LE4's and L3's entries (fixed in fecb0b3, 468dc1b: round 5's
  // 0a and 0b) and LV3's WDA one struck off, their cases ok — but LE4's two cases of F, whose strokes now go inside
  // `lower` and still do not reach it, refiled as what they measured:
  // Round 6's device check (11683c3, ADR 0021): averi now turns and says so — but not after one unmoved stroke: 2
  // strokes up moving nothing before the turn in three runs of four (F then reached, `visible`: ios-vis.json,
  // ios-wda-bounded-long-list-11683c3-2.json, -3.json), 4 in the other (the budget spent, `refused`: -1.json). Each a
  // second unmoved stroke not turned back: R-direction still. (Round 5's record, ios-vis-2725e76.json, and the
  // b71cbbb run read `refused` too: no turn at all there.) LV4's `ios wda turn:scroll-bounded.F` struck off by round 7's
  // A1 (480660a4: a read within a point is unmoved, so the turn comes after ONE unmoved stroke): ok in six runs of six
  // (ios-wda-stop-carousel-r23-1…4.json, ios-vis-r23-ios-stop-e687fe83.json, ios-wda-scroll-cells-659fdf00.json;
  // docs/truth/live-ios-2026-10-18-one-stroke-stop.md).
  // LV5's `ios wda scroll:scroll-bounded.F` struck off by round 6's iOS device check: ok in all four runs at 11683c3
  // (ios-vis.json, ios-wda-bounded-long-list-11683c3-1…3.json: `lower` at rest at 915–981, inside F's 884–1000
  // window), where round 5's src overshot to 1052 in one run of three and to 1006 (F cut, a plain stop) today.
  // The long-list carry case (live-visibility.ts#CARRY): round 6's Row 30, round 7's target L of the 56-row table. LV6's
  // two entries (its parked label read above the screen once the table had scrolled, three turns: ios-long-list-r7-lab-
  // 1.json, -2.json) struck off by round 7's A2 (a1b0b82: the parked frame of a scrolled table) — L's scroll case ok in
  // three runs of three (ios-wda-long-list-parked-1…3.json), two strokes down, no turn. What the carry case measures since
  // is ADR 0021 decision 4's final approach: L reached after 2 swipes in every run, at rest inside its window 1172–1920
  // in two (1917.3, 1903.3) and 14 pt past it in one (1933.7: -1.json), the reply honest — "CLIPPED at top, 78% of it is
  // in the viewport" — but the stroke carried it past its window: R-direction on `visible`, intermittent (ADR 0021
  // residual 1). Struck off by round 7's final device check (truth/round-7 836e04b1, A1's src in): L at rest
  // at 1635, 1869.3, 1853.3 and 1590 — 51–330 pt inside its window, fully visible after 2 swipes, in four runs of four
  // (ios-wda-vis-r7final.json, ios-wda-long-list-r7final-1…3.json).
  // carousel-in-list's C: one sideways stroke flings the carousel 447–532 pt, C's centre inside over 177–531 only; at
  // b71cbbb (ios-vis-b71cbbb.json) the stop was claimed on a read still moving, the tap then refused — ok at 11683c3.
  // Its intermittent entry struck off by round 7's A1 (f76be36a, e687fe83, 659fdf00: the unmeasured first stroke cut to
  // 126 pt, the stop judged on the read the fling rests in): C ok, settled, in six runs of six (the same records).
  // blur-menu-grouped's C: WDA lists the menu row W over it, so the stop is refused — after three strokes on the blur
  // (no node: residual 9), "content exhausted … a layout defect".
  ...each('ios wda', ['scroll:blur-menu-grouped.C'], BLUR, 'presented-stroke', 'refused'),
  // iOS, both sources
  ...['idb', 'wda'].flatMap((src) => [
    ...each(`ios ${src}`, ['scroll:scroll-sticky.R.fully'], LE3, 'stop-claim', 'visible'),
    ...each(`ios ${src}`, ['tap:blur-menu.A', 'tap:blur-menu.B', 'tap:blur-menu.C', 'tap:blur-menu.D', 'tap:blur-menu-grouped.A', 'tap:blur-menu-grouped.B', 'tap:blur-menu-grouped.D'], BLUR, 'tap-claim', 'Tapped'),
    ...each(`ios ${src}`, ['tap:blur-menu.W'], MENU, 'tap-refused', 'refused'),
    // The scroll case beneath the blur (round 6's iOS check, first run on iOS): the overlay with no node unseen, the stop
    // at once.
    ...each(`ios ${src}`, ['scroll:blur-menu.A', 'scroll:blur-menu.B', 'scroll:blur-menu.C', 'scroll:blur-menu.D', 'scroll:blur-menu-grouped.A', 'scroll:blur-menu-grouped.B', 'scroll:blur-menu-grouped.D'], BLUR, 'presented-stop', 'visible'),
  ]),
]);

/** The KNOWN entry of a live case, whatever it failed by. */
export const knownEntry = (platform: string, source: string, id: string): KnownLive | undefined => LIVE_KNOWN[`${platform} ${source} ${id}`];

/**
 * The note a live case's failure is known by — undefined unless it failed by the rule, on the kind of reply, its entry
 * pins.
 */
export const knownLive = (platform: string, source: string, id: string, cls: VerdictClass | undefined, kind: ReplyKind | undefined): string | undefined => {
  const e = knownEntry(platform, source, id);
  return e !== undefined && e.cls === cls && e.kind === kind ? e.note : undefined;
};

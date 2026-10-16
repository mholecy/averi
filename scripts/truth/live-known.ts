import type { VerdictClass } from './live-visibility.js';

/**
 * The live golden's KNOWN (phase 5): the live cases not ok at HEAD that an existing note or residual explains, keyed
 * `<platform> <source> <case id>`, each with the rule it fails by (its verdict's class) — as
 * tests/differential/golden/<family>.known.ts pins a replayed row's class (ADR 0020 §4): a known case failing by another
 * rule is not known. The notes are docs/bugs file names (`bug:`) or a residual of an ADR (`residual:`), the static
 * KNOWN's own wording.
 *
 * Its contract is weaker than ADR 0020 §4's, on purpose: an entry pins the verdict's class only — not the reply's kind,
 * not the strokes (a device's timing moves them run to run) — and a case on the device can pass by chance of timing.
 * So live.ts (a run of this checkout, or a `--rejudge` of one) exits 1 on a MISMATCH not listed here, and on a listed
 * case that comes back ok unless its entry is `intermittent` — one whose runs of the same commit differ (LV2: the
 * flush probe reveals a deep cut in most runs, not all). A non-intermittent case ok is fixed and must be struck off, as
 * the static ratchet asks; an intermittent one ok is printed as such. A `--side` run (a calibration of an older
 * commit) is held to neither: this KNOWN is HEAD's.
 */

const LE1 = 'bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md';
const LE2 = 'bug:2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md';
const LE3 = 'bug:2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md';
const LE4 = 'bug:2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md';
const VA1 = 'bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md';
const L3 = 'bug:2026-10-16-lab-ios-wda-scrolled-host-beneath-a-medium-sheet-loses-the-presented-remedy.md';
const LV1 = 'bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md';
const LV2 = 'bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md';
const LV3 = 'bug:2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md';
const FLING = 'bug:2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md';
const MENU = 'bug:2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md';
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)';
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
const NO_ID = 'bug:2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md';
const FAB = 'residual:accepted (round 13: the FAB host layer is a cover; calibration.json #24)';

/** A known case: its note, the rule it fails by (live-visibility.ts#VerdictClass), and whether it may pass by timing. */
export interface KnownLive {
  note: string;
  cls: VerdictClass;
  /** Runs of the same commit differ: an ok run of it is no fix (see the header). */
  intermittent?: true;
}

const each = (prefix: string, ids: readonly string[], note: string, cls: VerdictClass, intermittent?: 'intermittent') =>
  ids.map((id) => [`${prefix} ${id}`, { note, cls, ...(intermittent !== undefined && { intermittent: true as const }) }] as const);

export const LIVE_KNOWN: Readonly<Record<string, KnownLive>> = Object.fromEntries([
  // Android
  ...each('android uiautomator', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully'], LE1, 'stop-claim'),
  ...each('android uiautomator', ['tap:scroll-bounded.S'], LE1, 'tap-claim'),
  ...each('android uiautomator', ['scroll:scroll-sticky-cut.R.fully'], VA1, 'stop-claim'),
  ...each('android uiautomator', ['scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'scroll:tabbar-floating.F'], LV1, 'unchanged-claim'),
  ...each('android uiautomator', ['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S.fully'], LV2, 'stop-claim', 'intermittent'),
  ...each('android uiautomator', ['tap:fab.L', 'tap:fab.K'], FAB, 'tap-refused'),
  // iOS, idb: no scroll view listed
  ...each('ios idb', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'scroll:scroll-bounded.O'], LE2, 'stop-claim'),
  ...each('ios idb', ['tap:scroll-bounded.S', 'tap:scroll-bounded.O'], LE2, 'tap-claim'),
  ...each('ios idb', ['scroll:scroll-bounded.F', 'turn:scroll-bounded.F'], LE2, 'R-direction'),
  ...each('ios idb', ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G'], NOT_YET_IN_TREE, 'presented-stop'),
  ...each('ios idb', ['scroll:sheet-long-list.F'], FLING, 'R-direction'),
  ...each('ios idb', ['tap:sheet-long-list.R', 'tap:sheet-long-list-short.R'], NO_ID, 'tap-refused'),
  ...each('ios idb', ['scroll:sheet-long-list-short.F'], NO_ID, 'not-reached'),
  // blur-menu-grouped's C under idb only: WDA lists the menu row W over C's centre and refuses the tap (ok live:
  // refused, nothing fired) — its WDA entry struck off once an ok came to read as fixed (round-4 review S8).
  ...each('ios idb', ['tap:blur-menu-grouped.C'], BLUR, 'tap-claim'),
  // iOS, WDA
  ...each('ios wda', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'turn:scroll-bounded.F', 'scroll:sheet-long-list-short.F'], LE4, 'R-direction'),
  ...each('ios wda', ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G'], L3, 'presented-stop'),
  // iOS, both sources
  ...['idb', 'wda'].flatMap((src) => [
    ...each(`ios ${src}`, ['scroll:tabbar-floating.R'], LV3, 'R-direction'),
    ...each(`ios ${src}`, ['scroll:scroll-sticky.R.fully'], LE3, 'stop-claim'),
    ...each(`ios ${src}`, ['tap:blur-menu.A', 'tap:blur-menu.B', 'tap:blur-menu.C', 'tap:blur-menu.D', 'tap:blur-menu-grouped.A', 'tap:blur-menu-grouped.B', 'tap:blur-menu-grouped.D'], BLUR, 'tap-claim'),
    ...each(`ios ${src}`, ['tap:blur-menu.W'], MENU, 'tap-refused'),
  ]),
]);

/** The KNOWN entry of a live case, whatever it failed by. */
export const knownEntry = (platform: string, source: string, id: string): KnownLive | undefined => LIVE_KNOWN[`${platform} ${source} ${id}`];

/** The note a live case's failure is known by — undefined unless it failed by the rule its entry pins. */
export const knownLive = (platform: string, source: string, id: string, cls: VerdictClass | undefined): string | undefined => {
  const e = knownEntry(platform, source, id);
  return e !== undefined && e.cls === cls ? e.note : undefined;
};

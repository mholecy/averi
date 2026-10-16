/**
 * The live golden's KNOWN (phase 5): the live cases not ok at HEAD that an existing note or residual explains, keyed
 * `<platform> <source> <case id>`, each with the rule it fails by (its verdict's class) — as
 * tests/differential/golden/<family>.known.ts pins a replayed row's class (ADR 0020): a known case failing by another
 * rule is not known. live.ts
 * marks a known case with its note and exits 1 only on a MISMATCH not listed here; a listed case that comes back ok is
 * printed as no longer red (an intermittent one may: LV2). The notes are docs/bugs file names (`bug:`) or a residual of
 * an ADR (`residual:`), the static KNOWN's own wording.
 */

const LE1 = 'bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md';
const LE2 = 'bug:2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md';
const LE3 = 'bug:2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md';
const LE4 = 'bug:2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md';
const VA1 = 'bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md';
const L3 = 'bug:2026-10-16-lab-ios-wda-scrolled-host-beneath-a-medium-sheet-loses-the-presented-remedy.md';
const LV1 = 'bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md';
const LV2 = 'bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)';
const LV3 = 'bug:2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md';
const FLING = 'bug:2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md';
const MENU = 'bug:2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md';
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)';
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
const NO_ID = 'idb lists the UIKit table label without its identifier (presented.known.ts)';
const FAB = 'calibration.json #24: averi reads the FAB\'s transparent host as a cover (the accepted reading, round 13)';

import type { VerdictClass } from './live-visibility.js';

/** A known case: its note, and the rule it fails by (live-visibility.ts#VerdictClass). */
export interface KnownLive {
  note: string;
  cls: VerdictClass;
}

const each = (prefix: string, ids: readonly string[], note: string, cls: VerdictClass) => ids.map((id) => [`${prefix} ${id}`, { note, cls }] as const);

export const LIVE_KNOWN: Readonly<Record<string, KnownLive>> = Object.fromEntries([
  // Android
  ...each('android uiautomator', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully'], LE1, 'stop-claim'),
  ...each('android uiautomator', ['tap:scroll-bounded.S'], LE1, 'tap-claim'),
  ...each('android uiautomator', ['scroll:scroll-sticky-cut.R.fully'], VA1, 'stop-claim'),
  ...each('android uiautomator', ['scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'scroll:tabbar-floating.F'], LV1, 'unchanged-claim'),
  ...each('android uiautomator', ['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S.fully'], LV2, 'stop-claim'),
  ...each('android uiautomator', ['tap:fab.L', 'tap:fab.K'], FAB, 'tap-refused'),
  // iOS, idb: no scroll view listed
  ...each('ios idb', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'scroll:scroll-bounded.O'], LE2, 'stop-claim'),
  ...each('ios idb', ['tap:scroll-bounded.S', 'tap:scroll-bounded.O'], LE2, 'tap-claim'),
  ...each('ios idb', ['scroll:scroll-bounded.F', 'turn:scroll-bounded.F'], LE2, 'R-direction'),
  ...each('ios idb', ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G'], NOT_YET_IN_TREE, 'presented-stop'),
  ...each('ios idb', ['scroll:sheet-long-list.F'], FLING, 'R-direction'),
  ...each('ios idb', ['tap:sheet-long-list.R', 'tap:sheet-long-list-short.R'], NO_ID, 'tap-refused'),
  ...each('ios idb', ['scroll:sheet-long-list-short.F'], NO_ID, 'not-reached'),
  // iOS, WDA
  ...each('ios wda', ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'turn:scroll-bounded.F', 'scroll:sheet-long-list-short.F'], LE4, 'R-direction'),
  ...each('ios wda', ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G'], L3, 'presented-stop'),
  // iOS, both sources
  ...['idb', 'wda'].flatMap((src) => [
    ...each(`ios ${src}`, ['scroll:tabbar-floating.R'], LV3, 'R-direction'),
    ...each(`ios ${src}`, ['scroll:scroll-sticky.R.fully'], LE3, 'stop-claim'),
    ...each(`ios ${src}`, ['tap:blur-menu.A', 'tap:blur-menu.B', 'tap:blur-menu.C', 'tap:blur-menu.D', 'tap:blur-menu-grouped.A', 'tap:blur-menu-grouped.B', 'tap:blur-menu-grouped.C', 'tap:blur-menu-grouped.D'], BLUR, 'tap-claim'),
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

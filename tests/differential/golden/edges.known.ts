import { ANDROID, IDB_STROKE, IOS, keys, twice, type KnownFile } from './known.js';

// The edges family's ratchet (fixtures/apps/cells/edges.json): scroll-bounded, scroll-sticky, scroll-top-edge (and
// round 4's scroll-top-edge-end, its content ending at the screen's bottom: #17's turn-back, live), and round 3's
// Android variants scroll-bounded-flush (all green: #12, #13 calibrate on it) and scroll-sticky-cut, and round 4's
// scroll-sticky-view (all green: the row's content an Android View the header does not cut, #9 calibrates on it), and
// round 6's carousel-in-list (both platforms; iOS captured by round 6's iOS device check, 2026-10-18, once the host's
// Xcode 27.1 had run its first launch) and scroll-collapsing (Android only: a View
// list under a collapsing app bar, its row A dumped with inverted bounds — #10; all green) — its rows by geometry
// (scripts/differential/golden-spec/edges.ts, bars.ts for the band and the sticky header's overlap).
// scripts/truth/calibration.json owns only the link from each lab note to its rows (LE2–LE3; LE4 is calibrated since
// round 5's 0a, LE1 since round 14); this KNOWN owns the ratchet, as presented.known.ts does for L1.

const LE2 = 'bug:2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md';
const LE3 = 'bug:2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md';
const VA1 = 'bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md';
const BESIDE_LOWER = 'touched down outside its scroll view lower at (201,699) (201,699)';

export const edges: KnownFile = {
  family: 'edges',
  known: Object.fromEntries([
    // LAB FINDING LE1 — fixed on bugs/r14-le1 (round 14): uiautomator's bounds of a Compose verticalScroll's rows past
    // their container (scroll-bounded's P and S) and of a horizontalScroll's card past its carousel (carousel-in-list's
    // C) are judged by what their scroll views draw (ui-tree/geometry.ts#Clips.drawnIn, now on every tree that lists
    // ancestry): all seven rows green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING LE2 — idb lists no scroll view: P, S and O are judged on the screen alone. O (outside its scroll view)
    // Tapped on the background, its colour PASSES on the background, and the stop calls it visible; S Tapped and
    // reached; P and S "fully visible". WDA answers every one of these rows as the truth does.
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['P'], ['fully'], { cls: 'fully visible where it is partly-centre-in, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: idb lists no scroll view', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['S'], ['fully'], { cls: 'fully visible where it is sliver, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: idb lists no scroll view', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['S'], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: ['idb ui tap 201 584'], note: 'lab finding: idb lists no scroll view — Tapped beneath its clip', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['S'], ['scroll_until'], { cls: 'reached where it is sliver, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: idb lists no scroll view', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['O'], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: ['idb ui tap 201 652'], note: 'lab finding: idb lists no scroll view — Tapped on the background', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['O'], ['colour'], { cls: 'passed on #FFFFFF', kind: 'PASS', calls: [], note: 'lab finding: idb lists no scroll view — the colour measured the background (#29 under idb)', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['O'], ['scroll_until'], { cls: 'no swipe', kind: 'visible', calls: [], note: 'lab finding: idb lists no scroll view — visible after 0 swipes', as: LE2 }),
    ...keys(`${IOS}/scroll-bounded.idb.json`, ['F'], ['scroll_until'], { cls: BESIDE_LOWER, kind: 'refused', calls: twice(IDB_STROKE), note: 'lab finding: idb lists no scroll view — the screen\'s stroke, beside the scroll view holding F', as: LE2 }),
    // LE2 across, on carousel-in-list's C (the card right of the carousel's clip, 378,138 354x85 against its
    // scrollable 24,138 354x85): idb lists no carousel, so C is judged on the screen alone — its colour, sampled on the
    // 7 % of it on the screen, PASSES on the page's background; and scroll_until strokes sideways across the SCREEN's
    // middle (y 437, below the carousel), twice right, then once back, failing "content exhausted". WDA answers all
    // three rows as the truth does: its two strokes 307 181 → 95 181 lie inside the carousel, along its axis (round
    // 6's S4, the measurement this cell was built for).
    ...keys(`${IOS}/carousel-in-list.idb.json`, ['C'], ['colour'], { cls: 'passed on #EEEEEE', kind: 'PASS', calls: [], note: 'lab finding: idb lists no carousel — the colour measured the background on the card\'s 7 % on screen (#29 under idb)', as: LE2 }),
    ...keys(`${IOS}/carousel-in-list.idb.json`, ['C'], ['scroll_until'], { cls: 'touched down outside its scroll view carousel at (322,437) (322,437) (80,437)', kind: 'refused', calls: ['idb ui swipe 322 437 80 437 --duration 0.3', 'idb ui swipe 322 437 80 437 --duration 0.3', 'idb ui swipe 80 437 201 437 --duration 0.3'], note: 'lab finding: idb lists no carousel — the screen\'s sideways stroke, below the carousel holding C', as: LE2 }),
    // LAB FINDING LE4 — fixed on arch/r21-strokes (958bd27, round 5's 0a), merged with arch/round-21: WDA's O and F of
    // scroll-bounded, stroked over the screen beside `lower` until then, are stroked inside it (201 524 → 416) and green;
    // struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING LE3 — SwiftUI lists the pinned section header before the rows it lies over: no cover of R's top 24 pt.
    ...[`${IOS}/scroll-sticky.wda.json`, `${IOS}/scroll-sticky.idb.json`].flatMap((file) => [
      ...keys(file, ['R'], ['colour'], { cls: 'passed on #00897B', kind: 'PASS', calls: [], note: 'lab finding: the pinned header, listed first, is no cover of what the colour samples', as: LE3 }),
      ...keys(file, ['R'], ['fully'], { cls: 'fully visible where it is chrome-overlap:stickyHeader, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: the pinned header is no cover for fully: true', as: LE3 }),
    ]),
    // LAB FINDING VA1 — Compose cuts a row (and its content) at a sticky header that is one accessibility element: the
    // tree's row 128,457 825x110 begins at the header's bottom, its content cut alike, so nothing in it reaches under the
    // header — averi samples the cut rect (a PASS on R's own colour) and calls it fully visible.
    ...keys(`${ANDROID}/scroll-sticky-cut.xml`, ['R'], ['colour'], { cls: 'passed on #00897B', kind: 'PASS', calls: [], note: 'lab finding: the row cut at the header, its content too — the sample is the cut rect', as: VA1 }),
    ...keys(`${ANDROID}/scroll-sticky-cut.xml`, ['R'], ['fully'], { cls: 'fully visible where it is chrome-overlap:stickyHeader, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: the row cut at the header reads whole', as: VA1 }),
  ]),
  // scroll-top-edge(-end)'s T, in the status band and its scroll view, is asked R-fully too (7 rows, 6 before round 5):
  // the target contract asks `fully` of a band target in a scroll view (scripts/truth/target-contract.ts#fullyAsked),
  // as the live golden always did.
  counts: {
    [`${ANDROID}/scroll-bounded.xml`]: 14,
    [`${ANDROID}/scroll-sticky.xml`]: 4,
    [`${ANDROID}/scroll-bounded-flush.xml`]: 8,
    [`${ANDROID}/scroll-sticky-cut.xml`]: 4,
    [`${ANDROID}/scroll-sticky-view.xml`]: 4,
    [`${ANDROID}/scroll-top-edge.xml`]: 7,
    [`${ANDROID}/scroll-top-edge-end.xml`]: 7,
    [`${ANDROID}/carousel-in-list.xml`]: 9,
    [`${ANDROID}/scroll-collapsing.xml`]: 5,
    [`${IOS}/scroll-bounded.idb.json`]: 14,
    [`${IOS}/scroll-bounded.wda.json`]: 14,
    [`${IOS}/scroll-sticky.idb.json`]: 4,
    [`${IOS}/scroll-sticky.wda.json`]: 4,
    [`${IOS}/scroll-top-edge.idb.json`]: 7,
    [`${IOS}/scroll-top-edge.wda.json`]: 7,
    [`${IOS}/scroll-top-edge-end.idb.json`]: 7,
    [`${IOS}/scroll-top-edge-end.wda.json`]: 7,
    [`${IOS}/carousel-in-list.idb.json`]: 9,
    [`${IOS}/carousel-in-list.wda.json`]: 9,
  },
};

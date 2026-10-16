import { ANDROID, IDB_STROKE, IOS, keys, twice, type KnownFile } from './known.js';

// The edges family's ratchet (fixtures/apps/cells/edges.json): scroll-bounded, scroll-sticky, scroll-top-edge, and
// round 3's Android variants scroll-bounded-flush (all green: #12, #13 calibrate on it) and scroll-sticky-cut, and round
// 4's scroll-sticky-view (all green: the row's content an Android View the header does not cut, #9 calibrates on it) — its
// rows by geometry (scripts/differential/golden-spec/edges.ts, bars.ts for the band and the sticky header's overlap).
// scripts/truth/calibration.json owns only the link from each lab note to its rows (LE1–LE4); this KNOWN owns the
// ratchet, as presented.known.ts does for L1.

const LE1 = 'bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md';
const LE2 = 'bug:2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md';
const LE3 = 'bug:2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md';
const LE4 = 'bug:2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md';
const VA1 = 'bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md';
const BESIDE_LOWER = 'touched down outside its scroll view lower at (201,699) (201,699)';

export const edges: KnownFile = {
  family: 'edges',
  known: Object.fromEntries([
    // LAB FINDING LE1 — uiautomator's bounds of a Compose verticalScroll's rows are not cut to their container (P: not
    // at all; S: 66 px past its bottom), and averi judges an Android rect on the screen alone unless it is flush with
    // its container's edge: P (cut, 62 % drawn) "fully visible"; S (a 22-px sliver) Tapped at (541,1563), below its
    // container — where nothing of it is drawn — and called reached by both stops.
    ...keys(`${ANDROID}/scroll-bounded.xml`, ['P'], ['fully'], { cls: 'fully visible where it is partly-centre-in, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: a rect past its container read as whole', as: LE1 }),
    ...keys(`${ANDROID}/scroll-bounded.xml`, ['S'], ['fully'], { cls: 'fully visible where it is sliver, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: a sliver past its container read as whole', as: LE1 }),
    ...keys(`${ANDROID}/scroll-bounded.xml`, ['S'], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: ['adb shell input tap 541 1563'], note: 'lab finding: Tapped below its container, where nothing of it is drawn', as: LE1 }),
    ...keys(`${ANDROID}/scroll-bounded.xml`, ['S'], ['scroll_until'], { cls: 'reached where it is sliver, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: the plain stop on a sliver past its container', as: LE1 }),
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
    // LAB FINDING LE4 — WDA lists `lower` and O, F in it, yet scroll_until strokes the screen (201,699 → 175), below
    // `lower`: inferred from the replay and the committed frames (not measured on the device), the stroke moves
    // nothing, and the reply blames the content.
    ...keys(`${IOS}/scroll-bounded.wda.json`, ['O', 'F'], ['scroll_until'], { cls: BESIDE_LOWER, kind: 'refused', calls: twice(IDB_STROKE), note: 'lab finding: the stroke touches down beside the target\'s own scroll view', as: LE4 }),
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
  counts: {
    [`${ANDROID}/scroll-bounded.xml`]: 14,
    [`${ANDROID}/scroll-sticky.xml`]: 4,
    [`${ANDROID}/scroll-bounded-flush.xml`]: 8,
    [`${ANDROID}/scroll-sticky-cut.xml`]: 4,
    [`${ANDROID}/scroll-sticky-view.xml`]: 4,
    [`${ANDROID}/scroll-top-edge.xml`]: 6,
    [`${IOS}/scroll-bounded.idb.json`]: 14,
    [`${IOS}/scroll-bounded.wda.json`]: 14,
    [`${IOS}/scroll-sticky.idb.json`]: 4,
    [`${IOS}/scroll-sticky.wda.json`]: 4,
    [`${IOS}/scroll-top-edge.idb.json`]: 6,
    [`${IOS}/scroll-top-edge.wda.json`]: 6,
  },
};

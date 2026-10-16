import { ANDROID, IOS, keys, NOT_IN_TREE, type KnownFile } from './known.js';

// The bars family's ratchet (fixtures/apps/cells/bars.json): bands, pinned-bar, tabbar-floating, tabbar-hidden-push
// (iOS only) and fab, their rows chosen by each target's measured geometry (golden-spec/bars.ts, edges.ts, base.ts).

// The FAB host (calibration.json #24): averi's reading, accepted in round 13, is that the transparent full-width host
// holding only the FAB is a cover over everything in its band — a target beside the FAB is refused, its colour fails
// closed naming the host, and scroll_until strokes three times to clear it. Red by design until that decision changes.
const FAB_HOST = 'residual:accepted (round 13: the FAB host layer is a cover)';
const FAB_STROKES = ['adb shell input swipe 540 1406 540 352 1056', 'adb shell input swipe 540 1406 540 352 1056', 'adb shell input swipe 540 444 540 1110 667'];
const LAB_FULLY = 'bug:2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md';

export const bars: KnownFile = {
  family: 'bars',
  known: Object.fromEntries([
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: '#24: refused as under the FAB host, beside the FAB', as: FAB_HOST }),
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['colour'], { cls: 'failed', kind: 'FAIL', calls: [], note: '#24: fails closed naming the FAB host', as: FAB_HOST }),
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: FAB_STROKES, note: '#24: strokes to clear the FAB host, then fails', as: FAB_HOST }),
    // LAB FINDING: Compose's bounds leave out what the pinned Continue covers, so P's dumped rect ends at the button.
    [`${ANDROID}/pinned-bar.xml P scroll_until`, { cls: 'fully visible where it is chrome-overlap:pinned, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: fully: true stops on a row 66 px under the pinned button (Compose\'s uncovered bounds)', as: LAB_FULLY }],
    // The same rect: the colour sampled is the uncovered part, all P's — the row samples the app's frame, which the
    // button overlaps (the note's "The colour row beside it").
    [`${ANDROID}/pinned-bar.xml P colour`, { cls: 'passed on #E53935', kind: 'PASS', calls: [], note: 'lab finding: the colour sampled on P\'s uncovered part only (Compose\'s uncovered bounds)', as: LAB_FULLY }],
    // uiautomator dumps only what is visible to the user: F, far below the fold in a Compose scroll view, is in no
    // dump. The tap waits 5 s "to appear" (no scroll_until advice: averi cannot know the row exists); the colour assert
    // is vacuous. R-stroke (the strokes sent looking for it) is judged and green.
    [`${ANDROID}/tabbar-floating.xml F tap`, { cls: 'refused without scroll_until', kind: 'not found', calls: [], note: 'uiautomator lists no off-screen Compose row: the tap times out' }],
    [`${ANDROID}/tabbar-floating.xml F colour`, { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'uiautomator lists no off-screen Compose row' }],
  ]),
  counts: {
    [`${ANDROID}/bands.xml`]: 15,
    [`${ANDROID}/pinned-bar.xml`]: 7,
    [`${ANDROID}/tabbar-floating.xml`]: 9,
    [`${ANDROID}/fab.xml`]: 9,
    [`${IOS}/bands.idb.json`]: 15,
    [`${IOS}/bands.wda.json`]: 15,
    [`${IOS}/pinned-bar.idb.json`]: 7,
    [`${IOS}/pinned-bar.wda.json`]: 7,
    [`${IOS}/tabbar-floating.idb.json`]: 9,
    [`${IOS}/tabbar-floating.wda.json`]: 9,
    [`${IOS}/tabbar-hidden-push.idb.json`]: 9,
    [`${IOS}/tabbar-hidden-push.wda.json`]: 9,
    [`${IOS}/fab.idb.json`]: 9,
    [`${IOS}/fab.wda.json`]: 9,
  },
};

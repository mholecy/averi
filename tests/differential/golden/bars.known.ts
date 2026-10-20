import { ANDROID, IOS, keys, type KnownFile } from './known.js';

// The bars family's ratchet (fixtures/apps/cells/bars.json): bands, pinned-bar, tabbar-floating, tabbar-hidden-push
// (iOS only) and fab, their rows chosen by each target's measured geometry (golden-spec/bars.ts, edges.ts, base.ts).

// The FAB host (calibration.json #24): averi's reading, accepted in round 13, is that the transparent full-width host
// holding only the FAB is a cover over everything in its band — a target beside the FAB is refused, its colour fails
// closed naming the host, and scroll_until strokes three times to clear it. Red by design until that decision changes.
const FAB_HOST = 'residual:accepted (round 13: the FAB host layer is a cover)';
const FAB_STROKES = ['adb shell input swipe 540 1406 540 352 1056', 'adb shell input swipe 540 1406 540 352 1056', 'adb shell input swipe 540 444 540 1110 667'];

// tabbar-floating F on Android, far below the fold in a Compose scroll view, is in no uiautomator dump (only what is
// visible to the user is): its capture records it unlisted (TargetTruth.listed), so its tap timing out, its colour
// assert not finding it and R-stroke judged by the strokes sent for it are all green (target-contract.ts#unlistedBy).

export const bars: KnownFile = {
  family: 'bars',
  known: Object.fromEntries([
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: '#24: refused as under the FAB host, beside the FAB', as: FAB_HOST }),
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['colour'], { cls: 'failed', kind: 'FAIL', calls: [], note: '#24: fails closed naming the FAB host', as: FAB_HOST }),
    ...keys(`${ANDROID}/fab.xml`, ['L', 'K'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: FAB_STROKES, note: '#24: strokes to clear the FAB host, then fails', as: FAB_HOST }),
    // LAB FINDING B4-L1 — fixed on fix/r9-b4l1 (ui-tree/later-edges.ts#OverlaidEdge): Compose's bounds leave out what the
    // pinned Continue covers, so P's dumped rect ends at the button, which reaches past it at both ends — an overlay.
    // `fully` and the colour assert name it as P's cover; both rows green, struck off here, calibrated in
    // scripts/truth/calibration.json.
  ]),
  counts: {
    [`${ANDROID}/bands.xml`]: 15,
    [`${ANDROID}/bands-three-button.xml`]: 15,
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

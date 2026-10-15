import { ADB_STROKE, ANDROID, IDB_STROKE, IOS, keys, NO_CLOSE_IT_FIRST, NOT_IN_TREE, twice, type KnownFile } from './known.js';

// The presented family's ratchet (fixtures/apps/cells/presented.json): sheet-medium and alert-dim.

// This KNOWN owns the ratchet for the lab finding's rows too (L1); scripts/truth/calibration.json owns only the link
// from its note to the rows. A fix that strikes those rows off here turns L1 OPEN-NOT-REPRODUCED, and calibrate.ts
// exits 1, until the note's entry becomes `calibrate` with that fix as its after commit.
const LAB_ANDROID = 'bug:2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md';

export const presented: KnownFile = {
  family: 'presented',
  known: Object.fromEntries([
    // alert-dim.wda.json — the round-18 bug (the alert's dim, a bare childless layer, was no cover: A, B, D answered
    // Tapped, passed the colour on the dim, and scroll_until called them fully visible) went green with round 19's
    // alert fix, merged into this branch with arch/round-20 at 8600176: all 12 rows now answer "close it first". Struck
    // off. idb lists only the presented layer: a target beneath it is not in the tree. The tap times out "to appear" —
    // no false Tapped, but no "close it first"; the colour assert fails "not found" (no evidence either way: vacuous);
    // and scroll_until swipes twice beneath the presented layer looking for it.
    ...['alert-dim', 'sheet-medium'].flatMap((cell) => [
      ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented layer: the tap times out' }),
      ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists only the presented layer' }),
      ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it' }),
    ]),
    // LAB FINDING, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
    // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
    // the tree, as on idb. The tap waits 5 s "to appear" (no false Tapped, no "close it first"); the colour assert
    // fails "not found" (vacuous); scroll_until strokes 1776 → 444 twice, and on the device that stroke dismisses the
    // dialog (it lands on its dim) or expands the sheet.
    ...['alert-dim', 'sheet-medium'].flatMap((cell) => [
      ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'lab finding: uiautomator lists only the presented window; the tap times out', as: LAB_ANDROID }),
      ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'lab finding: uiautomator lists only the presented window', as: LAB_ANDROID }),
      ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(ADB_STROKE), note: 'lab finding: strokes beneath the presented layer (dismisses the dialog / expands the sheet)', as: LAB_ANDROID }),
    ]),
  ]),
  counts: {
    [`${ANDROID}/alert-dim.xml`]: 12,
    [`${ANDROID}/sheet-medium.xml`]: 15,
    [`${IOS}/alert-dim.idb.json`]: 12,
    [`${IOS}/alert-dim.wda.json`]: 12,
    [`${IOS}/sheet-medium.idb.json`]: 15,
    [`${IOS}/sheet-medium.wda.json`]: 15,
  },
};

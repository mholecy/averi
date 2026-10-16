import { ADB_STROKE, ANDROID, IDB_STROKE, IOS, keys, NO_CLOSE_IT_FIRST, NOT_IN_TREE, twice, type KnownFile } from './known.js';

// The presented family's ratchet (fixtures/apps/cells/presented.json): sheet-medium and alert-dim (phase 1/2);
// sheet-medium-edges, sheet-background, sheet-long-list, dim-cover, blur-menu and blur-menu-grouped (phase 3, B3, iOS).

// This KNOWN owns the ratchet for the lab finding's rows too (L1); scripts/truth/calibration.json owns only the link
// from its note to the rows. A fix that strikes those rows off here turns L1 OPEN-NOT-REPRODUCED, and calibrate.ts
// exits 1, until the note's entry becomes `calibrate` with that fix as its after commit.
const LAB_ANDROID = 'bug:2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md';
// Phase 3 (B3): the lab findings of the presented cells, open — and the residual of calibration.json #31.
const LAB_EDGES = 'bug:2026-10-16-lab-ios-wda-scrolled-host-beneath-a-medium-sheet-loses-the-presented-remedy.md';
const LAB_MENU = 'bug:2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md';
const LE4 = 'bug:2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md';
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)';
/** A target not in the tree is still stroked for beneath a layer the tree source did not judge (idb's lists). */
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
/** Review round 4's P4 (calibration.json NI1): idb lists a UIKit table's labels without their identifiers. */
const NO_ID = 'bug:2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md';
const IDB_UP = 'idb ui swipe 201 175 201 437 --duration 0.3';
/** The short stroke down after two IDB_UP, the third of G's and blur-menu-grouped C's strokes. */
const IDB_DOWN_SHORT = 'idb ui swipe 201 699 201 568 --duration 0.3';
/**
 * The slot targets' probe points (Base.swift#Slot) and the colour the screenshot shows over each under the blur menu:
 * A, B, D their own blurred and dimmed; C (#00897B) the menu row W's own colour — W is drawn over C's centre.
 */
const SLOT_TAP: Record<string, string> = { A: 'idb ui tap 201 142', B: 'idb ui tap 201 322', C: 'idb ui tap 201 502', D: 'idb ui tap 201 682' };
const BLURRED: Record<string, string> = { A: '#AC2B28', B: '#1766AC', C: '#00897B', D: '#BC6900' };
/** A, B, D beneath the blur menu's backdrop, which no tree lists: Tapped, a colour PASS on the blur, fully visible (#31). */
const beneathTheBlur = (file: string, tags: readonly string[]) =>
  tags.flatMap((t) => [
    ...keys(file, [t], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: [SLOT_TAP[t]], note: 'no node for the blur backdrop: tapped through it', as: BLUR }),
    ...keys(file, [t], ['colour'], { cls: `passed on ${BLURRED[t]}`, kind: 'PASS', calls: [], note: 'no node for the blur backdrop: the blurred colour measured as the target', as: BLUR }),
    ...keys(file, [t], ['scroll_until'], { cls: 'no "close it first"', kind: 'visible', calls: [], note: 'no node for the blur backdrop: fully visible beneath it', as: BLUR }),
  ]);

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
      ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
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
    // --- phase 3 (B3), iOS ---
    // idb lists only the presented layer (as on sheet-medium): beneath the medium sheet over the scrolled host, the large
    // sheet's bare background and the transparent cover, the targets are not in the tree.
    ...['sheet-medium-edges', 'sheet-background', 'dim-cover'].flatMap((cell) => {
      const tags = cell === 'sheet-medium-edges' ? ['H', 'G', 'E', 'F', 'M'] : ['A', 'B', 'C', 'D'];
      return [
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented layer: the tap times out' }),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists only the presented layer' }),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
      ];
    }),
    // LAB FINDING (calibration.json L3): beneath the medium sheet over a scrolled host, WDA's targets wholly above, wholly
    // under the status bar, a 5-pt sliver, wholly below — and M, whole on the screen under the dim — get scroll or
    // status-bar advice and scroll_until swipes the sheet — green from 753b560 to 20b800a (#30, #32, #34 calibrate there),
    // red from 41c394a (fix/r20-marks).
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['H', 'G', 'E', 'F', 'M'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'lab finding: scroll or status-bar advice beneath the sheet', as: LAB_EDGES }),
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['H', 'G', 'E', 'F', 'M'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'lab finding: scroll or status-bar advice beneath the sheet', as: LAB_EDGES }),
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['H', 'F'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'refused', calls: twice(IDB_STROKE), note: 'lab finding: strokes on the sheet for a target off the screen beneath it', as: LAB_EDGES }),
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['G'], ['scroll_until'], { cls: 'swiped 3× beneath a presented layer', kind: 'refused', calls: [IDB_UP, IDB_UP, IDB_DOWN_SHORT], note: 'lab finding: strokes on the sheet for a target under the status bar beneath it', as: LAB_EDGES }),
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['E'], ['scroll_until'], { cls: 'swiped 3× beneath a presented layer', kind: 'refused', calls: [IDB_STROKE, IDB_STROKE, IDB_UP], note: 'lab finding: strokes on the sheet for a sliver beneath it', as: LAB_EDGES }),
    ...keys(`${IOS}/sheet-medium-edges.wda.json`, ['M'], ['scroll_until'], { cls: 'swiped 3× beneath a presented layer', kind: 'refused', calls: [IDB_STROKE, IDB_STROKE, IDB_UP], note: 'lab finding: strokes on the sheet for a whole target under its dim', as: LAB_EDGES }),
    // sheet-long-list.idb.json — idb lists the UIKit table's labels without their accessibility identifiers (AXUniqueId
    // null), and none of the rows below the fold: neither target answers to its id. R's rows are NI1's (filed as its
    // note); F's, a tree source's limit no note files.
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['tap'], { cls: 'not tapped', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['colour'], { cls: 'failed', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['scroll_until'], { cls: 'stopped', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['F'], ['tap'], { cls: 'refused without scroll_until', kind: 'not found', calls: [], note: 'idb lists no row below the fold' }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['F'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists no row below the fold' }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['F'], ['scroll_until'], { cls: NOT_IN_TREE, kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists no row below the fold' }),
    // sheet-long-list-short (round 3): the same table cut short of the sheet's foot. Under idb R answers to no id, as
    // above (F, below the table's clip, is refused or fails as its rows ask: green). Under WDA F's stroke touches down
    // on the footer, beside the table holding it — lab finding LE4 (edges.known.ts), here on a UIKit table in a sheet.
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['tap'], { cls: 'not tapped', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['colour'], { cls: 'failed', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['scroll_until'], { cls: 'stopped', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list-short.wda.json`, ['F'], ['scroll_until'], { cls: 'touched down outside its scroll view list at (201,699) (201,699)', kind: 'refused', calls: twice(IDB_STROKE), note: 'lab finding: the stroke touches down on the footer, beside the table holding F', as: LE4 }),
    // RESIDUAL #31 (ADR 0018 residual 9): the blur menu's backdrop has no node in either tree — A, B, D beneath it read
    // as open. C's centre lies under the menu row W (its probe fires W): on the grouped variant's WDA tree C is refused
    // under W, truly, but not "close it first" (#31's); elsewhere C reads as open — L4's misreading, below.
    ...beneathTheBlur(`${IOS}/blur-menu.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu.wda.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-grouped.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-grouped.wda.json`, ['A', 'B', 'D']),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'refused under the menu row W drawn over its centre; the backdrop has no node', as: BLUR }),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'fails under the menu row W; the backdrop has no node', as: BLUR }),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['scroll_until'], { cls: 'swiped 3× beneath a presented layer', kind: 'refused', calls: [IDB_UP, IDB_UP, IDB_DOWN_SHORT], note: 'strokes for C under the menu row W; the backdrop has no node', as: BLUR }),
    // LAB FINDING (calibration.json L4): the menu row W, listed in reading order just before C, which it is drawn over,
    // reads as covered by C under idb and WDA (no reading break, ADR 0015) — a false refusal; and C, listed after W,
    // reads as drawn over W: Tapped at its centre, which fires W, a colour PASS on W's colour, fully visible — the unsafe
    // direction (also on the grouped variant's idb list, where W's rows are right).
    ...[`${IOS}/blur-menu.idb.json`, `${IOS}/blur-menu.wda.json`, `${IOS}/blur-menu-grouped.idb.json`].flatMap((file) => [
      ...keys(file, ['C'], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: [SLOT_TAP.C], note: 'lab finding: C read as drawn over the menu row W over its centre — the tap fires W', as: LAB_MENU }),
      ...keys(file, ['C'], ['colour'], { cls: `passed on ${BLURRED.C}`, kind: 'PASS', calls: [], note: "lab finding: W's colour measured as C's", as: LAB_MENU }),
      ...keys(file, ['C'], ['scroll_until'], { cls: 'no "close it first"', kind: 'visible', calls: [], note: 'lab finding: C fully visible under the menu row W', as: LAB_MENU }),
    ]),
    ...['idb', 'wda'].flatMap((src) => [
      ...keys(`${IOS}/blur-menu.${src}.json`, ['W'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: 'lab finding: the menu row read as under the row it is drawn over', as: LAB_MENU }),
      ...keys(`${IOS}/blur-menu.${src}.json`, ['W'], ['colour'], { cls: 'failed', kind: 'FAIL', calls: [], note: 'lab finding: the menu row read as under the row it is drawn over', as: LAB_MENU }),
      ...keys(`${IOS}/blur-menu.${src}.json`, ['W'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: [IDB_STROKE, IDB_STROKE, IDB_UP], note: 'lab finding: strokes for the menu row read as under the row it is drawn over', as: LAB_MENU }),
    ]),
  ]),
  counts: {
    [`${ANDROID}/alert-dim.xml`]: 12,
    [`${ANDROID}/sheet-medium.xml`]: 15,
    [`${IOS}/alert-dim.idb.json`]: 12,
    [`${IOS}/alert-dim.wda.json`]: 12,
    [`${IOS}/sheet-medium.idb.json`]: 15,
    [`${IOS}/sheet-medium.wda.json`]: 15,
    [`${IOS}/sheet-medium-edges.idb.json`]: 15,
    [`${IOS}/sheet-medium-edges.wda.json`]: 15,
    [`${IOS}/sheet-background.idb.json`]: 15,
    [`${IOS}/sheet-background.wda.json`]: 15,
    [`${IOS}/sheet-long-list.idb.json`]: 6,
    [`${IOS}/sheet-long-list.wda.json`]: 6,
    [`${IOS}/sheet-long-list-short.idb.json`]: 6,
    [`${IOS}/sheet-long-list-short.wda.json`]: 6,
    [`${IOS}/dim-cover.idb.json`]: 15,
    [`${IOS}/dim-cover.wda.json`]: 15,
    [`${IOS}/blur-menu.idb.json`]: 18,
    [`${IOS}/blur-menu.wda.json`]: 18,
    [`${IOS}/blur-menu-grouped.idb.json`]: 18,
    [`${IOS}/blur-menu-grouped.wda.json`]: 18,
  },
};

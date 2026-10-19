import { ADB_STROKE, ANDROID, IDB_STROKE, IOS, keys, NO_CLOSE_IT_FIRST, NOT_IN_TREE, NOT_IN_TREE_HINTED, twice, type Classed, type KnownFile } from './known.js';

// The presented family's ratchet (fixtures/apps/cells/presented.json): sheet-medium and alert-dim (phase 1/2);
// sheet-medium-edges, sheet-background, sheet-long-list, dim-cover, blur-menu and blur-menu-grouped (phase 3, B3, iOS);
// bottom-sheet-dialog and dialog-fullscreen (round 7, Android).

// The lab finding L1's tap and scroll_until rows were this KNOWN's until round 6's fix (d43df5d on arch/r22-l1)
// struck them off; scripts/truth/calibration.json calibrates the note on them.
// Phase 3 (B3): the lab findings of the presented cells, open — and the residual of calibration.json #31.
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)';
/** A target not in the tree is still stroked for beneath a layer the tree source did not judge (idb's lists). */
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
/** Review round 4's P4 (calibration.json NI1): idb lists a UIKit table's labels without their identifiers. */
const NO_ID = 'bug:2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md';
const IDB_UP = 'idb ui swipe 201 175 201 437 --duration 0.3';
/** Round 7 (T2): Android's presented window the uiautomator parser does not mark. */
const FULL_SCREEN_DIALOG: Classed = 'residual:ADR 0018 residual 19 — Android\'s presented window: the shapes are measured on one AVD and Material 3 only';
/**
 * A target beneath a window uiautomator lists alone and the parser leaves unmarked: the tap's hint, no remedy; the
 * colour assert's "not found" (no evidence either way — vacuous, no note's, as alert-dim's); two strokes on the window.
 */
const unmarkedWindow = (file: string, as: Classed) => [
  ...keys(file, ['A', 'B', 'C', 'D'], ['tap'], { cls: NOT_IN_TREE_HINTED, kind: 'not found', calls: [], note: 'uiautomator lists only the presented window, unmarked: the tap times out "to appear" with the active-window hint — its conditional "close it first", not the presented remedy', as }),
  ...keys(file, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'uiautomator lists only the presented window' }),
  ...keys(file, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(ADB_STROKE), note: 'uiautomator lists only the presented window, unmarked: scroll_until strokes it twice, then "never appeared in the tree" with the active-window hint', as }),
];
/** The short stroke down after two IDB_UP, the third of blur-menu-grouped C's strokes (and of sheet-medium-edges.wda G's until L3's fix). */
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
    // sheet-medium.idb's tap and scroll_until rows went green with round 7's A5 (merged with arch/round-23 at
    // a1261499): idb's list holds UIKit's dismiss region over the Application frame, now the presented mark
    // (src/adapters/ios-tree-source.ts#listsPresentedLayer), so the tap's wait says "close it first" and scroll_until
    // stops before any swipe — ADR 0018 residual 6 closed there (its "Closed on idb for a list holding UIKit's dismiss
    // region"; a residual, no note: nothing in scripts/truth/calibration.json), the 8 rows struck off here. Its colour
    // assert still fails "not found" (now with the presented remedy in its miss note): vacuous, no note's.
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented layer: the tap times out' }),
    ...['alert-dim', 'sheet-medium'].flatMap((cell) =>
      keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists only the presented layer' }),
    ),
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
    // LAB FINDING L1, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
    // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
    // the tree, as on idb. Fixed by round 6 (d43df5d, merged with arch/round-22): the window is marked presented, so
    // the tap's wait says "close it first" and scroll_until stops before any swipe — the 16 tap and scroll_until rows
    // green, struck off here, calibrated in scripts/truth/calibration.json. The colour assert still fails "not found":
    // no evidence either way (vacuous), as idb's above — no note's, the fix leaves the assert's wait as it was.
    ...['alert-dim', 'sheet-medium'].flatMap((cell) =>
      keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'uiautomator lists only the presented window' }),
    ),
    // --- round 7 (T2), Android: the presented windows the parser does not mark (ADR 0018 residual 19) ---
    // LAB FINDING LW1, docs/bugs/2026-10-19-lab-android-views-bottom-sheet-dialog-is-no-presented-window-scroll-until-
    // strokes-its-scrim-and-dismisses-it.md: a Views BottomSheetDialog's touch_outside scrim is unlabelled (NAF) and laid
    // between the bars, so the scrim rule does not hold. Fixed by round 7's A7 (f924893e, merged with arch/round-23): the
    // parser marks the window by Material's view ids, so the tap's wait says the presented remedy and scroll_until stops
    // before any swipe — the 8 tap and scroll_until rows green, struck off here, calibrated in
    // scripts/truth/calibration.json. The colour assert still fails "not found" (now with the presented remedy in its
    // miss note): no evidence either way (vacuous), as alert-dim's — no note's.
    ...keys(`${ANDROID}/bottom-sheet-dialog.xml`, ['A', 'B', 'C', 'D'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'uiautomator lists only the presented window' }),
    // A full-screen Compose Dialog: Compose lays its window between the bars at full width ([0,66][1080,2153]), against
    // the left edge — an app's own window by the parser's rule — and the dump carries no fact that tells it from one.
    ...unmarkedWindow(`${ANDROID}/dialog-fullscreen.xml`, FULL_SCREEN_DIALOG),
    // --- phase 3 (B3), iOS ---
    // idb lists only the presented layer (as on sheet-medium): beneath the medium sheet over the scrolled host, the large
    // sheet's bare background and the transparent cover, the targets are not in the tree. sheet-medium-edges.idb's
    // list holds the dismiss region too: its 10 tap and scroll_until rows went green with A5, as sheet-medium's above —
    // struck off; its colour rows stay (vacuous). sheet-background's and dim-cover's lists show no sign of the layer
    // (residual 6 stands there).
    ...keys(`${IOS}/sheet-medium-edges.idb.json`, ['H', 'G', 'E', 'F', 'M'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists only the presented layer' }),
    ...['sheet-background', 'dim-cover'].flatMap((cell) => {
      const tags = ['A', 'B', 'C', 'D'];
      return [
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented layer: the tap times out' }),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: 'idb lists only the presented layer' }),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
      ];
    }),
    // LAB FINDING L3 — fixed on arch/r21-presented (440786e, round 5's 0b), merged with arch/round-21: WDA marks the
    // empty medium sheet over the scrolled host as the presented screen, so H, G, E, F, M of sheet-medium-edges.wda get
    // "close it first" and scroll_until stops before any swipe — all 15 rows green, struck off here, calibrated in
    // scripts/truth/calibration.json.
    // sheet-long-list.idb.json — idb lists the UIKit table's labels without their accessibility identifiers (AXUniqueId
    // null), and none of the rows below the fold: no target answers to its id. R's rows are NI1's (filed as its note).
    // F's (a tree source's limit no note files) turned green at round 7's recapture (the 56-row table, its L added):
    // the truth now records F unlisted under idb (TargetTruth.listed), and the contract asks of it what an unlisted
    // target can meet — L's rows green alike.
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['tap'], { cls: 'not tapped', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['colour'], { cls: 'failed', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list.idb.json`, ['R'], ['scroll_until'], { cls: 'stopped', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists the table label without its identifier', as: NO_ID }),
    // sheet-long-list-short (round 3): the same table cut short of the sheet's foot. Under idb R answers to no id, as
    // above (F, below the table's clip, is refused or fails as its rows ask: green). Under WDA F's stroke touched down
    // on the footer, beside the table holding it — lab finding LE4 (edges.known.ts), fixed on arch/r21-strokes: the
    // stroke goes inside the table (201 369 → 139), the row green and struck off.
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['tap'], { cls: 'not tapped', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['colour'], { cls: 'failed', kind: 'not found', calls: [], note: 'idb lists the table label without its identifier', as: NO_ID }),
    ...keys(`${IOS}/sheet-long-list-short.idb.json`, ['R'], ['scroll_until'], { cls: 'stopped', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists the table label without its identifier', as: NO_ID }),
    // RESIDUAL #31 (ADR 0018 residual 9): the blur menu's backdrop has no node in either tree — A, B, D beneath it read
    // as open. C's centre lies under the menu row W (its probe fires W): C is refused under W, truly, but not "close it
    // first" (#31's) — on the grouped variant's WDA tree as W is listed after it, elsewhere since L4's fix (a control
    // listed before it in reading order, overlapping it, is a cover whose order is not told, ADR 0015's amendment) and,
    // since ADR 0024, seen drawn over it on the screenshot.
    ...beneathTheBlur(`${IOS}/blur-menu.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu.wda.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-grouped.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-grouped.wda.json`, ['A', 'B', 'D']),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'refused under the menu row W drawn over its centre; the backdrop has no node', as: BLUR }),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'fails under the menu row W; the backdrop has no node', as: BLUR }),
    ...keys(`${IOS}/blur-menu-grouped.wda.json`, ['C'], ['scroll_until'], { cls: 'swiped 3× beneath a presented layer', kind: 'refused', calls: [IDB_UP, IDB_UP, IDB_DOWN_SHORT], note: 'strokes for C under the menu row W; the backdrop has no node', as: BLUR }),
    ...[`${IOS}/blur-menu.idb.json`, `${IOS}/blur-menu.wda.json`, `${IOS}/blur-menu-grouped.idb.json`].flatMap((file) => [
      ...keys(file, ['C'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'refused under the menu row W, seen drawn over it on the screenshot; the backdrop has no node', as: BLUR }),
      ...keys(file, ['C'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'fails under the menu row W, seen drawn over it on the screenshot; the backdrop has no node', as: BLUR }),
      ...keys(file, ['C'], ['scroll_until'], { cls: 'no "close it first"', kind: 'refused', calls: [], note: 'stops before any swipe, under the menu row W seen drawn over it on the screenshot; the backdrop has no node', as: BLUR }),
    ]),
    // LAB FINDING (calibration.json L4, its residual) — fixed on fix/r9-l4w (ADR 0024): the menu row W, listed in
    // reading order just before C, which it is drawn over, read as covered by C under idb and WDA; the eyes now tell
    // from the screenshot that W is drawn on top — its tap, colour and scroll_until rows green, struck off here.
  ]),
  counts: {
    [`${ANDROID}/alert-dim.xml`]: 12,
    [`${ANDROID}/sheet-medium.xml`]: 15,
    [`${ANDROID}/bottom-sheet-dialog.xml`]: 15,
    [`${ANDROID}/dialog-fullscreen.xml`]: 15,
    [`${IOS}/alert-dim.idb.json`]: 12,
    [`${IOS}/alert-dim.wda.json`]: 12,
    [`${IOS}/sheet-medium.idb.json`]: 15,
    [`${IOS}/sheet-medium.wda.json`]: 15,
    [`${IOS}/sheet-medium-edges.idb.json`]: 15,
    [`${IOS}/sheet-medium-edges.wda.json`]: 15,
    [`${IOS}/sheet-background.idb.json`]: 15,
    [`${IOS}/sheet-background.wda.json`]: 15,
    [`${IOS}/sheet-long-list.idb.json`]: 9,
    [`${IOS}/sheet-long-list.wda.json`]: 9,
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

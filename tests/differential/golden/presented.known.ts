import { ANDROID, IDB_STROKE, idbUnmarkedTap, IOS, keys, NO_CLOSE_IT_FIRST, NOT_YET_IN_TREE, twice, type KnownFile } from './known.js';

// The presented family's ratchet (fixtures/apps/cells/presented.json): sheet-medium and alert-dim (phase 1/2);
// sheet-medium-edges, sheet-background, sheet-long-list, dim-cover, blur-menu and blur-menu-grouped (phase 3, B3, iOS);
// chooser-over-list (round 16, iOS);
// bottom-sheet-dialog and dialog-fullscreen (round 7, Android); dialog-views-fullscreen (Android); blur-menu-stacked and blur-menu-unhidden (round 16,
// ADR 0018 residual 9's probes, iOS).

// The lab finding L1's tap and scroll_until rows were this KNOWN's until round 6's fix (d43df5d on arch/r22-l1)
// struck them off; scripts/truth/calibration.json calibrates the note on them.
// Phase 3 (B3): the lab findings of the presented cells, open — and ADR 0018 residual 9, what of calibration.json #31
// round 16's in-window backdrop left open.
// D32 slice 1: the colour asserts beneath a presented layer that the replayed tree does not list (uiautomator's active
// window, idb's presented layer) failed "not found" — vacuous, no evidence either way — on alert-dim, sheet-medium,
// bottom-sheet-dialog, dialog-fullscreen and dialog-views-fullscreen (Android), and alert-dim, sheet-medium,
// sheet-medium-edges, sheet-background and dim-cover (idb): 41 rows. That "not found" is now judged where the tree
// lists no node of the target (golden-spec.ts#unlistedIn, presented.ts), each row by its tree source's way out: under
// uiautomator the presented remedy alone — the active-window hint is never accepted, as the tap row's — under idb the
// presented remedy or idb's reasons. Every one of them names it; struck off.
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay idb or a reading-order run does not show is not seen';
/** A modal row listed before the content drawn under it, a content control holding its centre (ADR 0015's 2026-10-22 amendment), that the eyes cannot tell: white on white. */
const CHOOSER = 'residual:ADR 0024 residual 1 — alike looks (two white rows): untold, refused';
/**
 * The slot targets' probe points (Base.swift#Slot) and the colour the screenshot shows over each under the blur menu:
 * A, B, D their own blurred and dimmed; C (#00897B) the menu row W's own colour — W is drawn over C's centre.
 */
const SLOT_TAP: Record<string, string> = { A: 'idb ui tap 201 142', B: 'idb ui tap 201 322', C: 'idb ui tap 201 502', D: 'idb ui tap 201 682' };
const BLURRED: Record<string, string> = { A: '#AC2B28', B: '#1766AC', C: '#00897B', D: '#BC6900' };
/**
 * What a tree says of the blur menu's backdrop: nothing that shows it over the target (idb lists no trace of the hidden
 * one; WDA's ungrouped run lists it first by its top, its order untold). The unhidden one under idb, an unlabelled
 * screen-sized element, is a presented `backdrop` since A38a: its rows are green.
 */
const NO_NODE = 'nothing in the tree shows the blur backdrop over it';
/** A, B, D beneath the blur menu's backdrop, which the tree does not show over them: Tapped, a colour PASS on the blur, fully visible (#31). */
const beneathTheBlur = (file: string, tags: readonly string[], backdrop = NO_NODE) =>
  tags.flatMap((t) => [
    ...keys(file, [t], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: [SLOT_TAP[t]], note: `${backdrop}: tapped through it`, as: BLUR }),
    ...keys(file, [t], ['colour'], { cls: `passed on ${BLURRED[t]}`, kind: 'PASS', calls: [], note: `${backdrop}: the blurred colour measured as the target`, as: BLUR }),
    ...keys(file, [t], ['scroll_until'], { cls: 'no "close it first"', kind: 'visible', calls: [], note: `${backdrop}: fully visible beneath it`, as: BLUR }),
  ]);

export const presented: KnownFile = {
  family: 'presented',
  known: Object.fromEntries([
    // alert-dim.wda.json — the round-18 bug (the alert's dim, a bare childless layer, was no cover: A, B, D answered
    // Tapped, passed the colour on the dim, and scroll_until called them fully visible) went green with round 19's
    // alert fix, merged into this branch with arch/round-20 at 8600176: all 12 rows now answer "close it first". Struck
    // off. idb lists only the presented layer: a target beneath it is not in the tree. The tap times out "to appear" —
    // no false Tapped, but no "close it first"; the colour assert fails "not found" naming idb's reasons (judged since
    // D32 slice 1, green); and scroll_until swipes twice beneath the presented layer looking for it.
    // sheet-medium.idb's tap and scroll_until rows went green with round 7's A5 (merged with arch/round-23 at
    // a1261499): idb's list holds UIKit's dismiss region over the Application frame, now the presented mark
    // (src/adapters/ios-tree-source.ts#listsPresentedLayer), so the tap's wait says "close it first" and scroll_until
    // stops before any swipe — ADR 0018 residual 6 closed there (its "Closed on idb for a list holding UIKit's dismiss
    // region"; a residual, no note: nothing in scripts/truth/calibration.json), the 8 rows struck off here. Its colour
    // assert fails "not found" with the presented remedy in its miss note: judged since D32 slice 1, green.
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['tap'], idbUnmarkedTap('idb lists only the presented layer: the tap times out')),
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
    // LAB FINDING L1, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
    // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
    // the tree, as on idb. Fixed by round 6 (d43df5d, merged with arch/round-22): the window is marked presented, so
    // the tap's wait says "close it first" and scroll_until stops before any swipe — the 16 tap and scroll_until rows
    // green, struck off here, calibrated in scripts/truth/calibration.json. The colour assert fails "not found" with
    // the presented remedy: judged since D32 slice 1, green.
    // --- round 7 (T2), Android: the presented windows the parser does not mark (ADR 0018 residual 19) ---
    // LAB FINDING LW1, docs/bugs/2026-10-19-lab-android-views-bottom-sheet-dialog-is-no-presented-window-scroll-until-
    // strokes-its-scrim-and-dismisses-it.md: a Views BottomSheetDialog's touch_outside scrim is unlabelled (NAF) and laid
    // between the bars, so the scrim rule does not hold. Fixed by round 7's A7 (f924893e, merged with arch/round-23): the
    // parser marks the window by Material's view ids, so the tap's wait says the presented remedy and scroll_until stops
    // before any swipe — the 8 tap and scroll_until rows green, struck off here, calibrated in
    // scripts/truth/calibration.json. The colour assert fails "not found" with the presented remedy in its miss note:
    // judged since D32 slice 1, green.
    // A full-screen Compose Dialog: Compose lays its window between the bars at full width ([0,66][1080,2153]), against
    // the left edge — an app's own window by the parser's rule — and the dump carries no fact that tells it from one.
    // ADR 0018 residual 19, closed for it by the amendment "Android's window by the window manager's
    // word": the window manager types the focused window a Dialog's at the root's bounds, asked on the miss, so the
    // tap's wait says the presented remedy and scroll_until stops before any swipe — the 8 rows green, struck off here.
    // So does dialog-views-fullscreen, a Views dialog at an activity's very shape. The colour asserts
    // there fail "not found" with the presented remedy in their note: judged since D32 slice 1, green.
    // --- phase 3 (B3), iOS ---
    // idb lists only the presented layer (as on sheet-medium): beneath the medium sheet over the scrolled host, the large
    // sheet's bare background and the transparent cover, the targets are not in the tree. sheet-medium-edges.idb's
    // list holds the dismiss region too: its 10 tap and scroll_until rows went green with A5, as sheet-medium's above —
    // struck off; its colour rows (the presented remedy) green since D32 slice 1. sheet-background's and dim-cover's
    // lists show no sign of the layer (residual 6 stands there): their colour rows fail "not found" with idb's
    // reasons — judged since D32 slice 1, green.
    ...['sheet-background', 'dim-cover'].flatMap((cell) => {
      const tags = ['A', 'B', 'C', 'D'];
      return [
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['tap'], idbUnmarkedTap('idb lists only the presented layer: the tap times out')),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
      ];
    }),
    // LAB FINDING L3 — fixed on arch/r21-presented (440786e, round 5's 0b), merged with arch/round-21: WDA marks the
    // empty medium sheet over the scrolled host as the presented screen, so H, G, E, F, M of sheet-medium-edges.wda get
    // "close it first" and scroll_until stops before any swipe — all 15 rows green, struck off here, calibrated in
    // scripts/truth/calibration.json.
    // sheet-long-list.idb.json — idb lists the UIKit table's labels without their accessibility identifiers (AXUniqueId
    // null), and none of the rows below the fold: no target answers to its id. F's (a tree source's limit no note
    // files) turned green at round 7's recapture (the 56-row table, its L added): the truth now records F unlisted
    // under idb (TargetTruth.listed), and the contract asks of it what an unlisted target can meet — L's rows green
    // alike. R's rows (NI1, docs/bugs/2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md) are
    // green since its fix: the reply names idb's limit (ui-tree/miss.ts, `noIdListed`), and an open target its source
    // does not list is asked that (golden-spec/base.ts#openRows) — struck off.
    // sheet-long-list-short (round 3): the same table cut short of the sheet's foot. Under idb R answers to no id, as
    // above, its rows green since NI1's fix (F, below the table's clip, is refused or fails as its rows ask: green).
    // Under WDA F's stroke touched down on the footer, beside the table holding it — lab finding LE4 (edges.known.ts),
    // fixed on arch/r21-strokes: the stroke goes inside the table (201 369 → 139), the row green and struck off.
    // RESIDUAL #31 (ADR 0018 residual 9): under idb, and in WDA's ungrouped reading-order run, nothing shows the blur
    // menu's backdrop over A, B, D — they read as open. C's centre lies under the menu row W (its probe fires W): C is
    // refused under W, truly, but not "close it first" (#31's) — since L4's fix (a control listed before it in reading
    // order, overlapping it, is a cover whose order is not told, ADR 0015's amendment) and, since ADR 0024, seen drawn
    // over it on the screenshot. The grouped WDA trees (blur-menu-grouped, -stacked, -unhidden) went green in round 16
    // (adapters/wda-source.ts#inWindowBackdrops: the backdrop listed after the screen beneath at its origin is a
    // presented screen) — their 12, 12 and 12 rows struck off / never listed. blur-menu-unhidden.idb's 12 went green with
    // A38a (src/adapters/ios-tree-source.ts#backdropOf: idb lists the unhidden backdrop as an unlabelled, id-less element
    // over the whole screen between the card and the screen beneath, now a presented `backdrop` covering what is listed
    // after it): A, B, D refused "close it first", their colour failing closed, scroll_until stopping before any swipe;
    // C gains "close it first" — struck off.
    ...beneathTheBlur(`${IOS}/blur-menu.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu.wda.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-grouped.idb.json`, ['A', 'B', 'D']),
    ...beneathTheBlur(`${IOS}/blur-menu-stacked.idb.json`, ['A', 'B', 'D']),
    ...[
      [`${IOS}/blur-menu.idb.json`, NO_NODE],
      [`${IOS}/blur-menu.wda.json`, NO_NODE],
      [`${IOS}/blur-menu-grouped.idb.json`, NO_NODE],
      [`${IOS}/blur-menu-stacked.idb.json`, NO_NODE],
    ].flatMap(([file, backdrop]) => [
      ...keys(file, ['C'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: `refused under the menu row W, seen drawn over it on the screenshot; ${backdrop}`, as: BLUR }),
      ...keys(file, ['C'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: `fails under the menu row W, seen drawn over it on the screenshot; ${backdrop}`, as: BLUR }),
      ...keys(file, ['C'], ['scroll_until'], { cls: 'no "close it first"', kind: 'refused', calls: [], note: `stops before any swipe, under the menu row W seen drawn over it on the screenshot; ${backdrop}`, as: BLUR }),
    ]),
    // chooser-over-list (round 16): mp-native's payment-type chooser rebuilt at its measured geometry — the card's rows O and
    // S listed before the list drawn under them, R (`row_0`) holding S's centre. Under idb S is an untold pair with R (ADR
    // 0015's 2026-10-22 amendment) and the real screenshot cannot tell it (S, the overlap and R's bands all the card's white:
    // eyes-order.test.ts): tap, colour and plain stop refuse, nothing tapped, no swipe — the accepted residual; WDA lists
    // the card over the list and taps S. R, beneath the card: refused under idb (untold), but never "close it first" —
    // idb lists no trace of the dim (#31). Under WDA R is green since the merge with round 16's in-window backdrop
    // (adapters/wda-source.ts#inWindowBackdrops): WDA lists the dim, a childless screen-sized leaf, after the list at its
    // origin — R refused "close it first", its stop before any swipe (at bugs/r16-le2 alone: three strokes on the dim).
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: 'untold under R, which holds its centre; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['colour'], { cls: 'failed', kind: 'FAIL', calls: [], note: 'untold under R, which holds its centre; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: [], note: 'stops before any swipe, untold under R; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'refused under the card row S; the dim has no node', as: BLUR }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'fails under the card row S; the dim has no node', as: BLUR }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['scroll_until'], { cls: 'no "close it first"', kind: 'refused', calls: [], note: 'stops before any swipe, untold under the card row S; the dim has no node', as: BLUR }),
    // LAB FINDING (calibration.json L4, its residual) — fixed by docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
    // (docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md): the menu row W, listed in
    // reading order just before C, which it is drawn over, read as covered by C under idb and WDA; the eyes now tell
    // from the screenshot that W is drawn on top — its tap, colour and scroll_until rows green, struck off here.
  ]),
  counts: {
    [`${ANDROID}/alert-dim.xml`]: 12,
    [`${ANDROID}/sheet-medium.xml`]: 15,
    [`${ANDROID}/bottom-sheet-dialog.xml`]: 15,
    [`${ANDROID}/dialog-fullscreen.xml`]: 15,
    [`${ANDROID}/dialog-views-fullscreen.xml`]: 15,
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
    [`${IOS}/blur-menu-stacked.idb.json`]: 18,
    [`${IOS}/blur-menu-stacked.wda.json`]: 18,
    [`${IOS}/blur-menu-unhidden.idb.json`]: 18,
    [`${IOS}/blur-menu-unhidden.wda.json`]: 18,
    [`${IOS}/chooser-over-list.idb.json`]: 9,
    [`${IOS}/chooser-over-list.wda.json`]: 9,
  },
};

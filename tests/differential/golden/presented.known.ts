import { ANDROID, IDB_STROKE, idbUnmarkedTap, IOS, keys, NO_CLOSE_IT_FIRST, NOT_YET_IN_TREE, twice, type KnownFile } from './known.js';

// The presented family's ratchet (fixtures/apps/cells/presented.json): sheet-medium and alert-dim (phase 1/2);
// sheet-medium-edges, sheet-background, sheet-long-list, dim-cover, blur-menu and blur-menu-grouped (phase 3, B3, iOS);
// chooser-over-list (round 16, iOS);
// bottom-sheet-dialog and dialog-fullscreen (round 7, Android); dialog-views-fullscreen (Android); blur-menu-stacked and blur-menu-unhidden (round 16,
// ADR 0018 residual 9's probes, iOS).
// Struck off (no row here): L1, LW1, L3, NI1, and L4 (fixed by
// docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md) — see
// scripts/truth/calibration.json.

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
 * What a tree says of the blur menu's backdrop: nothing that shows it over the target — idb lists no trace of the
 * hidden one (blur-menu, -grouped, -stacked), and WDA's ungrouped run lists it first by its top, its order untold.
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
    // idb lists only the presented layer: a target beneath it is not in the tree. The tap times out "to appear" — no
    // false Tapped, but no "close it first"; and scroll_until swipes twice beneath the presented layer looking for it.
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['tap'], idbUnmarkedTap('idb lists only the presented layer: the tap times out')),
    ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
    // --- phase 3 (B3), iOS ---
    // idb lists only the presented layer (as on sheet-medium): beneath the medium sheet over the scrolled host, the large
    // sheet's bare background and the transparent cover, the targets are not in the tree. sheet-background's and
    // dim-cover's lists show no sign of the layer (residual 6 stands there).
    ...['sheet-background', 'dim-cover'].flatMap((cell) => {
      const tags = ['A', 'B', 'C', 'D'];
      return [
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['tap'], idbUnmarkedTap('idb lists only the presented layer: the tap times out')),
        ...keys(`${IOS}/${cell}.idb.json`, tags, ['scroll_until'], { cls: 'swiped 2× beneath a presented layer', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented layer: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
      ];
    }),
    // RESIDUAL #31 (ADR 0018 residual 9): under idb, and in WDA's ungrouped reading-order run, nothing shows the blur
    // menu's backdrop over A, B, D — they read as open. C's centre lies under the menu row W (its probe fires W): C is
    // refused under W, truly, but not "close it first" (#31's) — since L4's fix (a control listed before it in reading
    // order, overlapping it, is a cover whose order is not told, ADR 0015's amendment) and, since ADR 0024, seen drawn
    // over it on the screenshot.
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
    // idb lists no trace of the dim (#31).
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: 'untold under R, which holds its centre; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['colour'], { cls: 'failed', kind: 'FAIL', calls: [], note: 'untold under R, which holds its centre; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['S'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: [], note: 'stops before any swipe, untold under R; the screenshot cannot tell (white on white)', as: CHOOSER }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'refused', calls: [], note: 'refused under the card row S; the dim has no node', as: BLUR }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['colour'], { cls: 'failed without "close it first"', kind: 'FAIL', calls: [], note: 'fails under the card row S; the dim has no node', as: BLUR }),
    ...keys(`${IOS}/chooser-over-list.idb.json`, ['R'], ['scroll_until'], { cls: 'no "close it first"', kind: 'refused', calls: [], note: 'stops before any swipe, untold under the card row S; the dim has no node', as: BLUR }),
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

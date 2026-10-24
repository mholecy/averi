import type { VerdictClass } from './live-visibility.js';
import type { ReplyKind } from './replies.js';

/**
 * The live golden's KNOWN (phase 5): the live cases not ok at HEAD that an existing note or residual explains, keyed
 * `<platform> <source> <case id>`, each with the rule it fails by (its verdict's class) and the kind of reply that
 * verdict rests on (LiveVerdict.kind, replies.ts#replyKind) — as tests/differential/golden/<family>.known.ts pins a
 * replayed row's class and kind (ADR 0020 §4): a known case failing by another rule, or by the same rule on another
 * kind of reply (a stop claimed turned into a timeout, a refusal into a tap), is not known. The notes are docs/bugs
 * file names (`bug:`) or a residual of a decision (`residual:`), the static KNOWN's own wording; tests/truth/
 * lab-notes.test.ts ties them to docs/bugs and calibration.json.
 *
 * Its contract is weaker than ADR 0020 §4's in two ways, on purpose. The strokes are not pinned: a device's timing
 * moves how many a scroll_until sends, run to run. And a case on the device can pass by chance of timing: so live.ts
 * (a run of this checkout, or a `--rejudge` of one) exits 1 on a MISMATCH not listed here, and on a listed case that
 * comes back ok unless its entry is `intermittent` — one whose runs of the same commit differ (the WDA stop on a row
 * resting a fraction of a point centre-out; LV2's flush cases were, until fixed at ae4d988a). A non-intermittent
 * case ok is fixed and must be struck off, as the static ratchet asks; an intermittent one ok is printed as such. A
 * `--side` run (a calibration of an older commit) is held to neither: this KNOWN is HEAD's.
 *
 * The kind is pinned since round 5 (it was not before: "a device's timing moves it" was assumed, not measured). The
 * committed records measured it (docs/truth/live-records, rejudged by tests/truth/live-rejudge.test.ts): every entry's
 * kind below is what its case's record reads; and the cases with
 * several records, LV2's two flush cases (android-vis.json, cal12-*.json: three runs at 9c7885e, two at d043e65), read
 * `visible` in all six — ok in four, a stop-claim in two: the timing moved the outcome, not the kind (struck off since);
 * LV5's case likewise (ios-vis-2725e76.json and ios-scroll-bounded-wda-2725e76-*.json, three runs at
 * b71cbbb's src): `refused` where it is not reached, ok in two.
 * A run that reads another kind for a known case fails as NOT known, naming both: refile it. (An entry could once list
 * other rules and kinds its runs read, `also`, each with its record — LV4's turn spending its budget, the only one; it
 * left with LV4's entry at round 7's A1, and the mechanism with it at round 7's integration 3.)
 */

/** LE2's rest, accepted — the static KNOWN's own wording (tests/differential/golden/edges.known.ts). */
const IDB_NO_SCROLL_VIEW = 'residual:ADR 0010 residual 5 — idb lists no scroll view: the tap, the plain stop and the strokes are judged on the screen alone';
const BLUR = 'residual:ADR 0018 residual 9 — an in-window overlay idb or a reading-order run does not show is not seen';
const NOT_YET_IN_TREE = 'residual:ADR 0018 residual 6 — a target not yet in the tree is stroked for';
const NO_ID_RESIDUAL = 'residual:ADR 0018 residual 20 — idb lists no identifier on a UIKit table cell label: an id-asked target there is never found, only said so';
/** calibration.json #24's status, verbatim: the decision is that note's. */
const FAB = 'residual:accepted (round 13: the FAB host layer is a cover)';
const CENTRE_A_POINT_OUT = 'bug:2026-10-22-lab-ios-wda-plain-stop-on-a-row-resting-a-fraction-of-a-point-centre-out.md';

/**
 * A known case: its note, the rule it fails by (live-visibility.ts#VerdictClass), the kind of reply that verdict rests
 * on (LiveVerdict.kind), and whether it may pass by timing.
 */
export interface KnownLive {
  note: string;
  cls: VerdictClass;
  kind: ReplyKind;
  /** Runs of the same commit differ: an ok run of it is no fix (see the header). */
  intermittent?: true;
}

/** The entries `<prefix> <id>` of every id, each known by `note`, `cls` and `kind`, with KnownLive's optional facts as given. */
const each = (prefix: string, ids: readonly string[], note: string, cls: VerdictClass, kind: ReplyKind, more: Pick<KnownLive, 'intermittent'> = {}) =>
  ids.map((id) => [`${prefix} ${id}`, { note, cls, kind, ...more }] as const);

export const LIVE_KNOWN: Readonly<Record<string, KnownLive>> = Object.fromEntries([
  // Android
  // LE1 (scroll-bounded's P.fully, S, S.fully and tap S; carousel-in-list's tap C and scroll C): fixed on round 14's
  // bugs/r14-le1 (the drawn frame on Android), all six ok live (android-vis-r14-le1.json), struck off.
  // (#10's turn:scroll-collapsing.A, filed here until 2026-10-18: ok since the owner decided no turn on uiautomator —
  // ADR 0021 — and its judge became live-visibility.ts#judgeAndroidTurn: a loud failure naming `up` after the
  // two-stroke stop, which the record reads.)
  // VA1 (scroll-sticky-cut's R.fully; docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md):
  // fixed by the flush probe toward a sticky header pinned in the row's list, ok live twice (android-vis-r14-va1*.json:
  // 2 swipes, list 66→0, 0→0, Tapped), struck off.
  // LV1 (scroll-bounded's O and F, tabbar-floating's F; docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md):
  // fixed by round 14's bugs/r14-lv1 (a read listing none of the stroked scroll view's content is no evidence), struck
  // off — live three times (android-vis-r14-lv1.json, -2.json at its first form bd1c1107; -3.json at 770344ae):
  // tabbar-floating F visible after 5 swipes and Tapped, also with timeoutMs 30000 (blank:tabbar-floating.F);
  // scroll-bounded O and F an honest LOUD at the deadline with no unchanged claim, the blank clause naming `upper`.
  // LV2 (scroll-bounded-flush's P.fully and S.fully, intermittent;
  // docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md): fixed
  // at ae4d988a (a probe that showed more of a still-flush row proved its cut: no confirm, the next
  // stroke a reveal of half the room), S.fully "fully visible after 2 swipes" in seven cell runs of seven (lower 0→58–61,
  // then →288–296; android-vis-r1023-lv2-1…7.json), P.fully after 1 as before; both struck off.
  ...each('android uiautomator', ['tap:fab.L', 'tap:fab.K'], FAB, 'tap-refused', 'refused'),
  // Round 7 (T2): the presented windows the parser does not mark (android-vis-dialogs.json, -scroll-run2/3.json; the
  // same in all three runs). Beneath the full-screen Compose Dialog every target's two strokes landed on the dialog
  // (nothing dismissed: it has no outside) — residual 19, struck off since the window manager's word types the window
  // (ADR 0018's amendment: the focused window a Dialog's at the root's bounds, asked on the miss — scroll_until stops
  // before any stroke), ok in three runs of three (android-vis-r1023b-r19-1…3.json). (LW1's four scroll cases beneath
  // the Views BottomSheetDialog — A's and B's stroke up on the touch_outside scrim dismissing the sheet, C's and D's two strokes
  // on it — struck off by round 7's A7, f924893e: the window marked presented by Material's ids, scroll_until stops
  // before any stroke, ok in three runs of three: android-vis-sheet-dialog-run1…3.json.)
  // iOS, idb: no scroll view listed (LE2, docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md),
  // partly fixed by round 14's 11daf08 — ADR 0010's residual 5 the rest. P.fully and S.fully no longer claim a stop:
  // the eyes see the clip line, the stop fails after two strokes over the screen — P's touching down below `lower`,
  // moving nothing (R-direction on refused); S's case then taps S, Tapped on the background (the tap's residual: a
  // tap-claim on Tapped). Two runs of two (ios-idb-vis-r14-le2-1.json, -2.json).
  ...each('ios idb', ['scroll:scroll-bounded.P.fully'], IDB_NO_SCROLL_VIEW, 'R-direction', 'refused'),
  ...each('ios idb', ['scroll:scroll-bounded.S', 'scroll:scroll-bounded.O'], IDB_NO_SCROLL_VIEW, 'stop-claim', 'visible'),
  ...each('ios idb', ['tap:scroll-bounded.S', 'tap:scroll-bounded.O', 'scroll:scroll-bounded.S.fully'], IDB_NO_SCROLL_VIEW, 'tap-claim', 'Tapped'),
  // LE2's rest, scroll-bounded-footer (round 16; the Continue under the clip listed after O, holding its centre): the tap no
  // longer fires Continue — it is moved clear to (201,670) and the plain stop refuses before any swipe — but the row
  // past the clip is still Tapped, on the background: by the tap case, and by the scroll case's own tap after its
  // refused stop (ios-vis-r16-le2-1.json): the residual, a tap-claim on Tapped in both.
  ...each('ios idb', ['tap:scroll-bounded-footer.O', 'scroll:scroll-bounded-footer.O'], IDB_NO_SCROLL_VIEW, 'tap-claim', 'Tapped'),
  ...each('ios idb', ['scroll:scroll-bounded.F', 'turn:scroll-bounded.F'], IDB_NO_SCROLL_VIEW, 'R-direction', 'refused'),
  // LV3's idb entry (R-direction on `refused`: the turned strokes touching down at y 175, in the header) struck off by
  // round 14's bugs/r14-lv3 (02aabfa6: a stroke carrying content back goes over the region the rows carried with R
  // showed, and a stop short of where such a stroke touches down, or past the region toward what held still, is held —
  // ADR 0010 residual 6, refined 2026-10-21): idb's tabbar-floating R ok three of three, tabbar-dense R five of five and
  // its last row L three of three (at 02aabfa6's src), the idb visibility group with nothing not known (ios-vis-r14-lv3*.json).
  // sheet-long-list's F and L: idb lists the table's labels without their identifiers (and no row below the fold), so
  // neither is ever in its tree — an honest not-reached, its strokes unjudged since round 7's recapture records them
  // unlisted (TargetTruth.listed); until then F read R-direction, filed as
  // docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md. Since NI1's fix the reply names idb's limit
  // (ui-tree/miss.ts, `noIdListed`); the stops stay not-reached, as they must (ADR 0018 residual 20). R's taps, refused
  // with nothing fired, are ok since the fix: a target its source does not list is not asked to fire
  // (live-visibility.ts#visibilityCases) — struck off.
  ...each('ios idb', ['scroll:sheet-long-list.F', 'scroll:sheet-long-list.L', 'scroll:sheet-long-list-short.F'], NO_ID_RESIDUAL, 'not-reached', 'not found'),
  // blur-menu-grouped's C under idb: struck off by round 8's L4 fix (37bf5a15) with blur-menu's C under both sources
  // — refused as overlapped by the menu row W listed before it in reading order, nothing fired, in two runs of two
  // (ios-vis-r8-l4-1.json, -2.json) and two more at its final src (94fc318b: -3.json, -4.json, the order untold); WDA's
  // entry was struck off earlier (round-4 review S8: WDA lists W after C).
  // Round 6's iOS device check (ios-vis.json at 11683c3): the refusal case beneath a presented layer in no scroll view
  // (L1's, first run on iOS). idb lists the presented layer alone, the target not in it: a target not yet in the tree is
  // stroked for (residual 6) — two strokes on the layer, the backgrounded sheet dismissed by the first or not.
  // Round 7's A5 (a1261499; ios-idb-sheet-a5-1.json, -2.json, ios-idb-vis-a5.json): a list holding UIKit's dismiss
  // region marks the layer presented, so sheet-medium's A–D and sheet-medium-edges' H and G stop before any swipe —
  // their six entries struck off (ok in three runs of three). Beneath the large sheet idb's list shows no sign of it:
  // A's and B's stroke still dismisses it, but scroll_until's changed stop says so and claims nothing — LOUD
  // (`presented-changed`) on `refused`, no longer a stop claimed on `visible`: known still, the sheet's loss
  // residual 6's cost; C and D, never dismissed, two strokes as before.
  // Round 16 (bugs/r16-r6, ADR 0018 "idb's presented layer" Decision 3; ios-vis-r16-r6-1.json, -2.json): A's and B's
  // strokes are feelers (160 pt in 600 ms from (201,175)) — the sheet springs back, nothing dismissed, the unmoved
  // stop saying idb lists only what a presented sheet, alert or cover leaves: `presented-stroke` on `not found`, as C,
  // D and the alert's and the cover's (two strokes on the layer, still residual 6).
  ...each('ios idb', ['A', 'B', 'C', 'D'].flatMap((t) => [`scroll:sheet-background.${t}`, `scroll:alert-dim.${t}`, `scroll:dim-cover.${t}`]), NOT_YET_IN_TREE, 'presented-stroke', 'not found'),
  // idb lists no carousel (LE2 across, as edges.known.ts files C's replayed rows): strokes across the screen's middle,
  // none moving the carousel, the reply "content exhausted … a layout defect" — ADR 0010's residual 5.
  ...each('ios idb', ['scroll:carousel-in-list.C'], IDB_NO_SCROLL_VIEW, 'R-direction', 'refused'),
  // blur-menu-grouped's C under idb: refused after three strokes on the blur at L4's 37bf5a15 (ios-vis-r8-l4-1.json,
  // -2.json; no dismissal), struck off at its final src (94fc318b): stopped before any swipe, nothing stroked, in two
  // runs of two (ios-vis-r8-l4-3.json, -4.json).
  // iOS, WDA
  // Round 5's device check (ios-vis-2725e76.json, src b71cbbb): LE4's and L3's entries (fixed in fecb0b3, 468dc1b: round 5's
  // 0a and 0b) and LV3's WDA one struck off, their cases ok — but LE4's two cases of F, whose strokes now go inside
  // `lower` and still do not reach it, refiled as what they measured:
  // Round 6's device check (11683c3, ADR 0021): averi now turns and says so — but not after one unmoved stroke: 2
  // strokes up moving nothing before the turn in three runs of four (F then reached, `visible`: ios-vis.json,
  // ios-wda-bounded-long-list-11683c3-2.json, -3.json), 4 in the other (the budget spent, `refused`: -1.json). Each a
  // second unmoved stroke not turned back: R-direction still. (Round 5's record, ios-vis-2725e76.json, and the
  // b71cbbb run read `refused` too: no turn at all there.) LV4's `ios wda turn:scroll-bounded.F` struck off by round 7's
  // A1 (480660a4: a read within a point is unmoved, so the turn comes after ONE unmoved stroke): ok in six runs of six
  // (ios-wda-stop-carousel-r23-1…4.json, ios-vis-r23-ios-stop-e687fe83.json, ios-wda-scroll-cells-659fdf00.json;
  // docs/truth/live-ios-2026-10-18-one-stroke-stop.md).
  // LV5's `ios wda scroll:scroll-bounded.F` struck off by round 6's iOS device check: ok in all four runs at 11683c3
  // (ios-vis.json, ios-wda-bounded-long-list-11683c3-1…3.json: `lower` at rest at 915–981, inside F's 884–1000
  // window), where round 5's src overshot to 1052 in one run of three and to 1006 (F cut, a plain stop) today.
  // The long-list carry case (live-visibility.ts#CARRY): round 6's Row 30, round 7's target L of the 56-row table. LV6's
  // two entries (its parked label read above the screen once the table had scrolled, three turns: ios-long-list-r7-lab-
  // 1.json, -2.json) struck off by round 7's A2 (a1b0b82: the parked frame of a scrolled table) — L's scroll case ok in
  // three runs of three (ios-wda-long-list-parked-1…3.json), two strokes down, no turn. What the carry case measures since
  // is ADR 0021 decision 4's final approach: L reached after 2 swipes in every run, at rest inside its window 1172–1920
  // in two (1917.3, 1903.3) and 14 pt past it in one (1933.7: -1.json), the reply honest — "CLIPPED at top, 78% of it is
  // in the viewport" — but the stroke carried it past its window: R-direction on `visible`, intermittent (ADR 0021
  // residual 1). Struck off by round 7's final device check (truth/round-7 836e04b1, A1's src in): L at rest
  // at 1635, 1869.3, 1853.3 and 1590 — 51–330 pt inside its window, fully visible after 2 swipes, in four runs of four
  // (ios-wda-vis-r7final.json, ios-wda-long-list-r7final-1…3.json).
  // carousel-in-list's C: one sideways stroke flings the carousel 447–532 pt, C's centre inside over 177–531 only; at
  // b71cbbb (ios-vis-b71cbbb.json) the stop was claimed on a read still moving, the tap then refused — ok at 11683c3.
  // Its intermittent entry struck off by round 7's A1 (f76be36a, e687fe83, 659fdf00: the unmeasured first stroke cut to
  // 126 pt, the stop judged on the read the fling rests in): C ok, settled, in six runs of six (the same records).
  // blur-menu-grouped's C: WDA lists the menu row W over it (drawn over, its order told), so the stop was refused —
  // after three strokes on the blur (residual 9), "content exhausted … a layout defect"; so at L4's final src too
  // (94fc318b: ios-vis-r8-l4-3.json, -4.json). Struck off by round 16's in-window backdrop (bugs/r16-blur 7fd1ee57,
  // adapters/wda-source.ts#inWindowBackdrops): stopped before any swipe, "close it first", nothing stroked, in two runs
  // of two (ios-vis-r16-blur-1.json, -2.json) — with blur-menu-grouped's A, B, D tap and scroll entries under WDA below.
  // chooser-over-list's R (round 16, mp-native's chooser rebuilt): WDA lists the card row S over it (drawn over, its
  // order told) and no node for the dim, so the stop is refused after three strokes on the dim (175, 175, 699), "content
  // exhausted"; the strokes close nothing (no `dismissed` logged) — blur-menu-grouped C's shape (ios-vis-r16-le2-2.json).
  // Those records were taken at bugs/r16-le2 alone. Struck off at the merge with the in-window backdrop (bugs/round-16
  // 4f48c642): the dim WDA lists (a hidden childless Other 0,0 402x874 after the list) is a backdrop — refused under S,
  // "close it first", stopped before any swipe, nothing stroked or dismissed, in two runs of two
  // (ios-vis-r16-merge-1.json, -2.json).
  // scroll-bounded-footer's O under WDA (round 16): its one stroke on `lower` flings 240–273 pt, so O rests 54–83 %
  // clipped at the top, its centre inside the clip — ok, then Tapped; once (ios-vis-r16-le2-2.json) at 272.7, O at
  // 347.3, its centre 0.7 pt above the clip's top 380: "visible … CLIPPED at top, 49 %" against the truth's centre-out,
  // the tap at (201,380) then fired O. A fraction of a point WDA's whole-point frames do not tell; the same stroke and
  // stop at 4ee14f1c (the src before LE2's rest), so not this fix's.
  ...each('ios wda', ['scroll:scroll-bounded-footer.O'], CENTRE_A_POINT_OUT, 'stop-claim', 'visible', { intermittent: true }),
  // iOS, both sources
  ...['idb', 'wda'].flatMap((src) => [
    // scroll-sticky's R with `fully: true` struck off by round 14's LE3 fix (40b4856: a heading listed before is drawn
    // over it): no stop under the pinned header — one stroke (list 24→0), R whole at 51,166, fully visible after 1 swipe
    // and Tapped, under idb and WDA, in two runs of two (ios-vis-r14-le3-1.json, -2.json).
    // blur-menu's C struck off by round 8's L4 fix (37bf5a15): refused, nothing fired (it fired W before: ios-vis-r8-l4-before.json);
    // so at its final src too (94fc318b: ios-vis-r8-l4-3.json, -4.json).
    // (idb's tap of blur-menu's A came back ok once, in ios-vis-r8-l4-3.json: the run's first case on a freshly booted
    // simulator, a wait that timed out with no tree — nothing tapped, vacuous; Tapped and the menu dismissed in -4.json.)
    // blur-menu-grouped's A, B, D under WDA struck off by round 16 (7fd1ee57): the backdrop listed after the screen
    // beneath is a presented screen — each tap refused "close it first", nothing fired, in two runs of two
    // (ios-vis-r16-blur-1.json, -2.json); under idb, which lists no trace of the backdrop, they stand — and so do
    // blur-menu-stacked's and blur-menu-unhidden's (the round-16 probes, first run under idb at the merge 4f48c642: each
    // tap Tapped, the menu dismissed, in two runs of two: ios-vis-r16-merge-1.json, -2.json; golden-known alike).
    ...each(`ios ${src}`, ['tap:blur-menu.A', 'tap:blur-menu.B', 'tap:blur-menu.D', ...(src === 'idb' ? ['grouped', 'stacked', 'unhidden'].flatMap((cell) => ['A', 'B', 'D'].map((t) => `tap:blur-menu-${cell}.${t}`)) : [])], BLUR, 'tap-claim', 'Tapped'),
    // blur-menu's W struck off by round 9's L4 fix (1ef11b9c, ADR 0024): the eyes see it drawn over C — Tapped, it alone
    // fired, under idb and WDA (ios-vis-r9-l4w-1.json, -2.json); refused under C, the order not told, before.
    // The scroll case beneath the blur (round 6's iOS check, first run on iOS): the overlay with no node unseen, the stop
    // at once.
    // (blur-menu-grouped's under WDA struck off by round 16, as its taps: stopped before any swipe, "close it first";
    // under idb the three grouped cells' stand, as their taps.)
    ...each(`ios ${src}`, ['scroll:blur-menu.A', 'scroll:blur-menu.B', 'scroll:blur-menu.D', ...(src === 'idb' ? ['grouped', 'stacked', 'unhidden'].flatMap((cell) => ['A', 'B', 'D'].map((t) => `scroll:blur-menu-${cell}.${t}`)) : [])], BLUR, 'presented-stop', 'visible'),
    // blur-menu's C: refused after three strokes on the blur at L4's 37bf5a15 (ios-vis-r8-l4-1.json, -2.json; no
    // dismissal), struck off at its final src (94fc318b): under a cover whose order is not told scroll_until stops
    // before any swipe, nothing stroked, in two runs of two (ios-vis-r8-l4-3.json, -4.json).
  ]),
]);

/** The KNOWN entry of a live case, whatever it failed by. */
export const knownEntry = (platform: string, source: string, id: string): KnownLive | undefined => LIVE_KNOWN[`${platform} ${source} ${id}`];

/**
 * The note a live case's failure is known by — undefined unless it failed by the rule, on the kind of reply, its entry
 * pins.
 */
export const knownLive = (platform: string, source: string, id: string, cls: VerdictClass | undefined, kind: ReplyKind | undefined): string | undefined => {
  const e = knownEntry(platform, source, id);
  return e !== undefined && e.cls === cls && e.kind === kind ? e.note : undefined;
};

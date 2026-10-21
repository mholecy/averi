import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * The live golden's committed visibility records (docs/truth/live-records: android-vis.json, round 6's device check;
 * android-vis-hint-ea070d2.json, its closing review's run of the active-window hint; android-vis-sheet-dialog-run1…3.json
 * and android-hint-everywhere-*-c2c4.json, round 7's A7 and A3; ios-vis.json and
 * ios-wda-bounded-long-list-11683c3-1…3.json, round 6's iOS device check; ios-wda-long-list-parked-1…3.json and
 * ios-wda-vis-parked.json, round 7's A2; ios-wda-stop-carousel-r23-*.json, ios-vis-r23-ios-stop-e687fe83.json,
 * ios-wda-forms-r23*.json and ios-wda-cut-cells-r23*.json, round 7's A1; ios-keyboard-fallbacks-*.json, A4's;
 * ios-rn-forms-a9-*.json and ios-forms-a9.json, A9's; ios-idb-sheet-a5-*.json and ios-idb-vis-a5.json, A5's;
 * android-k7-eyes-{1,2,3,r1}.json and android-forms-eyes.json, A6's; the *-r7final*.json, round 7's final device check;
 * ios-scroll-bounded-wda-2725e76-*.json, round 5's; ios-forms-r8-l2-*.json, round 8's L2 fix and the src before it; ios-vis-r8-l4-*.json, its L4 fix and the src before it; ios-vis-r9-l4w-*.json, round 9's fix of L4's remaining half; android-vis-r9-b4l1*.json, round 9's B4-L1 fix and its first src; *-r9-final*.json, round 9's final device check; android-vis-r14-le1.json, round 14's LE1 fix; android-vis-r14-va1*.json, its VA1 fix; android-vis-r14-lv1*.json, its LV1 fix; ios-idb-vis-r14-le2-*.json, its LE2 fix; ios-vis-r14-le3-*.json, its LE3 fix; ios-vis-r14-lv3*.json, its LV3 fix) judged again
 * by this checkout's judges — `live.ts --rejudge`, the very code path, no device: a judge or a live-known.ts entry
 * that changes what the records read fails here, not first on a device. Pinned: the exit code (0: no MISMATCH that
 * live-known.ts does not explain, no known case not intermittent ok), no case not known, and the counts of the
 * summary's header. Not pinned: ad-hoc probes run from a scratch copy of the harness (ios-wda-kbscroll-r23*.json, A1's
 * five keyboard scroll probes — no live.ts case asks them) and A9's raw typing diagnosis (a9-fill-tail-diag/).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);

async function rejudge(record: string, groups: string): Promise<{ code: number; out: string }> {
  try {
    const file = record.startsWith('/') ? record : `docs/truth/live-records/${record}`;
    const { stdout } = await run(process.execPath, ['--import', 'tsx', 'scripts/truth/live.ts', '--rejudge', file, '--groups', groups], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('live.ts --rejudge over the committed visibility records', () => {
  it.each([
    // round 6's closing review: the active-window hint run live (src and lab app ea070d2) — form-picker's c2–c4 ok with
    // the hint beneath the wait, scroll-bounded O and F LV1's, turn F LOUD, L1's 16 presented cases ok without it
    // round 7's A2 (LV6 fixed: src arch/r23-parked a1b0b82 through --side, the lab app truth/round-7 461d6fd): L's
    // scroll case ok in all three runs, two strokes down, no turn; its carry case reached likewise, at rest inside L's
    // window in runs 2 and 3 (ok; run 1's overshoot, ADR 0021 residual 1, is pinned below since its entry was struck)
    ['ios-wda-long-list-parked-2.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-parked-3.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    // …and the forms with the lab model's fix (a field reported from the binding's write): no fill lost one of 30
    // (b1, b4, p2 five times under each source); c2–c4 ok under both sources (idb: not in its tree, all it can say);
    // b1d and b7 (idb ui text has no keycode for them), p5 (the secure field iOS clears) and k2/k3 under WDA LOUD; the
    // run itself read c2–c4 under idb LOUD, by the judge before it was made per source
    ['ios-forms-r7-lab-1.json', 'forms', { cases: 46, ok: 38, loud: 8, mismatches: 0 }],
    ['ios-forms-r7-lab-2.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-forms-r7-lab-3.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-forms-r7-lab-4.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-forms-r7-lab-5.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-forms-r7-lab-picker.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    // round 7's A7 (LW1 fixed: src arch/r23-sheet-dialog 25da22d4 through --side, the lab app truth/round-7 41302012):
    // the Views BottomSheetDialog's cell three times — taps refused with the presented remedy, scroll_until stopped
    // before any stroke, the sheet not dismissed, tap S tapped; 13 of 13 ok in each run
    ['android-vis-sheet-dialog-run1.json', 'visibility', { cases: 13, ok: 13, loud: 0, mismatches: 0 }],
    ['android-vis-sheet-dialog-run2.json', 'visibility', { cases: 13, ok: 13, loud: 0, mismatches: 0 }],
    ['android-vis-sheet-dialog-run3.json', 'visibility', { cases: 13, ok: 13, loud: 0, mismatches: 0 }],
    // round 7's A3 (src arch/r23-hint-everywhere 9fa59ae, then e726c77 after its review round 1, through --side):
    // form-picker's c2–c4 with every not-found carrying the miss note — the replies of the taps unchanged, ok
    ['android-hint-everywhere-9fa59ae-c2c4.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['android-hint-everywhere-e726c77-c2c4.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    // round 7's code review (truth/r7-cr, this checkout): c2–c4 again and c5–c7, an assert, a colour assert and a
    // flow's wait: on name beneath the sheet — each failed, the active-window hint once, nothing fired
    ['android-hint-c5c7-r7cr.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    // round 7's React Native lab app (rn-field, `--app react-native`, the record keeping its app): the forms cases
    // rn1–rn6 and the label and icon taps; LOUD where WDA (LR1) and uiautomator (LR2) refuse a label under its own field,
    // and where a fill into an RN single-line field lost the tail of its text (averi said so: "the field shows 8").
    // 055c666: M's field laid to the box's foot (before review round 1); 97de1b9: laid as N's, the bar over its label.
    ['ios-rn-field-055c666.json', 'forms,visibility', { cases: 18, ok: 13, loud: 5, mismatches: 0 }],
    ['android-rn-field-055c666.json', 'forms,visibility', { cases: 9, ok: 6, loud: 3, mismatches: 0 }],
    ['ios-rn-field-97de1b9.json', 'forms,visibility', { cases: 18, ok: 11, loud: 7, mismatches: 0 }],
    ['android-rn-field-97de1b9.json', 'forms,visibility', { cases: 9, ok: 6, loud: 3, mismatches: 0 }],
    // round 7's A1 (src arch/r23-ios-stop through --side; docs/truth/live-ios-2026-10-18-one-stroke-stop.md): the turn of
    // F and carousel C under WDA, four runs — the turn after one unmoved stroke, C's stop settled — 2 of 2 ok each
    ['ios-wda-stop-carousel-r23-1.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    ['ios-wda-stop-carousel-r23-2.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    ['ios-wda-stop-carousel-r23-3.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    ['ios-wda-stop-carousel-r23-4.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    // …the keyboard forms under WDA at A1's src and at arch/round-23 before it (review round 1, MAJOR-1): the same
    ['ios-wda-forms-r23-ios-stop.json', 'forms', { cases: 23, ok: 18, loud: 5, mismatches: 0 }],
    ['ios-wda-forms-r23.json', 'forms', { cases: 23, ok: 18, loud: 5, mismatches: 0 }],
    // …the visibility cells whose replayed first stroke the unmeasured carry cuts, at both srcs: 16 of 16 ok
    ['ios-wda-cut-cells-r23-ios-stop.json', 'visibility', { cases: 16, ok: 16, loud: 0, mismatches: 0 }],
    ['ios-wda-cut-cells-r23.json', 'visibility', { cases: 16, ok: 16, loud: 0, mismatches: 0 }],
    // round 7's A4 (src arch/r23-keyboard through --side; docs/truth/live-ios-2026-10-18-keyboard-fallbacks.md): k1–k3
    // under WDA, three runs (k2 and k3 LOUD before the fallback drag), all ok; the dismissal group 24 of 24, no submit
    ['ios-keyboard-fallbacks-k-run1.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-k-run2.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-k-run3.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-dismissal.json', 'dismissal', { cases: 24, ok: 24, loud: 0, mismatches: 0 }],
    // round 7's A9 (src arch/r23-fill-tail through --side; docs/truth/live-rn-2026-10-19.md): the RN forms group under
    // idb and WDA, five runs — every single-line fill whole; rn4 (the label tap under WDA) LOUD, LR1's at that src;
    // run 4's rn1 LOUD (the wait for N's field timed out after launch, nothing typed)
    ['ios-rn-forms-a9-1.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-2.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-3.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-4.json', 'forms', { cases: 12, ok: 10, loud: 2, mismatches: 0 }],
    ['ios-rn-forms-a9-5.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    // …and the native forms group at the same src: unchanged (b1d, b7, p5 and k2/k3 under WDA LOUD as before A4)
    ['ios-forms-a9.json', 'forms', { cases: 46, ok: 38, loud: 8, mismatches: 0 }],
    // round 7's A5 (src arch/r23-idb-sheet through --side; docs/truth/live-ios-2026-10-18-visibility.md): idb's
    // presented layer — sheet-medium's and sheet-background's cells twice: sheet-medium's A–D stopped before any swipe,
    // ok; sheet-background's A and B LOUD, the changed stop (the stroke dismissed the large sheet, averi said the swipe
    // changed the screen and claimed nothing), C and D two strokes on the layer, residual 6's
    ['ios-idb-sheet-a5-1.json', 'visibility', { cases: 18, ok: 14, loud: 2, mismatches: 2 }],
    ['ios-idb-sheet-a5-2.json', 'visibility', { cases: 18, ok: 14, loud: 2, mismatches: 2 }],
    // (…and the whole visibility group under idb once, ios-idb-vis-a5.json: below, before L4's fix)
    // round 7's A6 (src arch/r23-eyes through --side; docs/truth/live-android-2026-10-18-visibility.md): k7 with the
    // eyes — "visible after 1 swipe — PARTLY UNDER a surface the tree does not list: its bottom 28 px …", the band
    // named, ok — three runs, once more after its review round 1; and the forms group once (b1d, b7 LOUD: adb's input
    // text has no non-ASCII)
    ['android-k7-eyes-1.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-2.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-3.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-r1.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-forms-eyes.json', 'forms', { cases: 25, ok: 23, loud: 2, mismatches: 0 }],
    // round 7's final device check (truth/round-7 836e04b1, every app rebuilt from it; the summaries' "Round 7 final
    // device check, 2026-10-19" sections): iOS — WDA's and idb's visibility groups as A2's and A5's records but LV4's
    // turn ok and the carry case at rest inside L's window (its entry struck off: three more runs of sheet-long-list),
    // dismissal 12/12 under each source, WDA's forms with k2 and k3 ok (A4's), the RN app under WDA three times and
    // under idb once all ok — rn4 and the taps of N and M no longer refused (LR1); Android — the visibility group with
    // T2's dialog cells (bottom-sheet-dialog's scroll cases ok: A7's), the forms with k7 naming the band, the RN app
    // three times all ok (LR2), the two dialog cells once more
    // (its visibility groups, ios-wda-vis-r7final.json and ios-idb-vis-r7final.json: below, before L4's fix)
    ['ios-wda-dismissal-r7final.json', 'dismissal', { cases: 12, ok: 12, loud: 0, mismatches: 0 }],
    ['ios-idb-dismissal-r7final.json', 'dismissal', { cases: 12, ok: 12, loud: 0, mismatches: 0 }],
    ['ios-wda-forms-r7final.json', 'forms', { cases: 23, ok: 20, loud: 3, mismatches: 0 }],
    ['ios-rn-wda-r7final-1.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-wda-r7final-2.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-wda-r7final-3.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-idb-r7final.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-1.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-2.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-3.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['android-forms-r7final.json', 'forms', { cases: 25, ok: 23, loud: 2, mismatches: 0 }],
    ['android-rn-r7final-1.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['android-rn-r7final-2.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['android-rn-r7final-3.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['android-vis-dialogs-r7final.json', 'visibility', { cases: 26, ok: 22, loud: 0, mismatches: 4 }],
    // round 8's L2 fix (fix/r8-l2; docs/truth/live-ios-2026-10-18-visibility.md, its round-8 section): k6 and k7, opened
    // to iOS, under idb and WDA three times — no submit; idb's k6 refused under Continue in runs 2 and 3 (run 1: idb's
    // describe-all failed, no frontmost application, so no tree — the wait timed out, nothing fired: vacuous for the
    // fix), k7 one stroke to phone clear of the bar
    ['ios-forms-r8-l2-1.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['ios-forms-r8-l2-2.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['ios-forms-r8-l2-3.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    // round 8's L4 fix at its final src (fix/r8-l4 94fc318b; docs/truth/live-ios-2026-10-18-visibility.md, its round-8
    // L4 section): the blur-menu cells under idb and WDA — C's tap refused as overlapped by the menu row W listed before
    // it, the order not told, nothing fired (blur-menu under both, the grouped variant under idb); C's scroll_until
    // stopped before any swipe, nothing stroked (the same three); W's tap refused under C, the order not told (LOUD: the
    // residual of the fix). Its first run, -3.json, is pinned below: idb's first case timed out there, vacuous.
    ['ios-vis-r8-l4-4.json', 'visibility', { cases: 40, ok: 13, loud: 2, mismatches: 25 }],
    // round 9's L4 fix, its remaining half (fix/r9-l4w 1ef11b9c, ADR 0024; docs/truth/live-ios-2026-10-18-visibility.md,
    // its round-9 section): the eyes tell the menu row W drawn over C — W's tap Tapped, W alone fired, under idb and
    // WDA; C's tap and scroll_until refused as under W, seen so, nothing fired or stroked. Its first run, -1.json, is
    // pinned below: idb's first case timed out there, vacuous, as round 8's -3.json.
    ['ios-vis-r9-l4w-2.json', 'visibility', { cases: 40, ok: 15, loud: 0, mismatches: 25 }],
    // round 9's final device check at its final src (fix/round-9 14a7d90d, after the code review tightened the eyes'
    // guards; docs/truth/live-ios-2026-10-18-visibility.md and live-android-2026-10-18-visibility.md, their round-9
    // final sections): the blur menus read as at 1ef11b9c — W Tapped, W alone fired, under idb and WDA; C's tap and
    // scroll_until refused as under W, seen so, nothing fired or stroked (-2.json; -1.json below: the first-case idb
    // timeout again). A sanity set of other iOS visibility cells as live-known.ts knows them. (Its Android record,
    // android-vis-r9-final.json, is pinned below VA1's fix.)
    ['ios-vis-r9-final-2.json', 'visibility', { cases: 40, ok: 15, loud: 0, mismatches: 25 }],
    ['ios-vis-r9-final-sanity.json', 'visibility', { cases: 78, ok: 66, loud: 2, mismatches: 10 }],
    // Round 14's fix of LE1 (bugs/r14-le1, the drawn frame on Android): its six cases ok — S's and C's taps refused
    // outside their scroll view, P and S stroked inside upper/lower, C stroked sideways inside the carousel (824,497).
    ['android-vis-r14-le1.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-idb-vis-r14-le2-1.json', 'visibility', { cases: 18, ok: 9, loud: 0, mismatches: 9 }],
    ['ios-idb-vis-r14-le2-2.json', 'visibility', { cases: 18, ok: 9, loud: 0, mismatches: 9 }],
    // Round 14's fix of LE3 (bugs/r14-le3 40b4856, a heading listed before is drawn over the target): scroll-sticky's
    // six cases ok under idb and WDA, twice — R's `fully: true` no longer stops under the pinned header: one stroke
    // (list 24→0), R whole at 51,166, fully visible after 1 swipe, Tapped; its tap and plain stop as before.
    ['ios-vis-r14-le3-1.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-le3-2.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    // Round 14's fix of VA1 (bugs/r14-va1 7957a62, the flush probe toward a sticky header pinned in the row's list):
    // scroll-sticky-cut's R fully stops after 2 swipes (list 66→0, then 0→0), Tapped; scroll-sticky-rest's R, whole at
    // rest under the same header, fully after 1 swipe (list 0→0), Tapped — twice; the taps and the plain stop as before.
    ['android-vis-r14-va1.json', 'visibility', { cases: 5, ok: 5, loud: 0, mismatches: 0 }],
    ['android-vis-r14-va1-2.json', 'visibility', { cases: 5, ok: 5, loud: 0, mismatches: 0 }],
    // Round 14's fix of LV1 (bugs/r14-lv1, a blank read is no evidence the stroke moved nothing): tabbar-floating's F
    // visible after 5 swipes (list 0→~860→…→~4275, every touch at 540,1598) and Tapped, under the 15 s default and at
    // timeoutMs 30000 (blank:tabbar-floating.F); scroll-bounded's O and F LOUD at the deadline with the blank clause, no
    // unchanged claim; turn:scroll-bounded.F as before. The whole visibility group (its 4 mismatches dialog-fullscreen's,
    // residual 19), then the two cells again.
    ['android-vis-r14-lv1.json', 'visibility', { cases: 140, ok: 131, loud: 5, mismatches: 4 }],
    ['android-vis-r14-lv1-2.json', 'visibility', { cases: 18, ok: 15, loud: 3, mismatches: 0 }],
    // ... and the two cells once more at the reviewed fix (770344ae, 00ed9ec8's src but for names and comments: rows
    // apart across a stroke shown, the clause's final wording "how far", counted over one scroll view): the same outcomes.
    ['android-vis-r14-lv1-3.json', 'visibility', { cases: 18, ok: 15, loud: 3, mismatches: 0 }],
    // Round 14's fix of LV3 (bugs/r14-lv3 02aabfa6: under idb a stroke carrying content back goes over the region the
    // rows carried with the target showed; a stop short of where such a stroke touches down, or past the region toward
    // what held still, is held; the last stroke's pushed side on every read until the next): idb's tabbar-dense R five
    // times alone — (201,699), then (201,239) twice, Tapped R after 3 swipes, once a 4th (201,699) after the fling
    // carried R into the bottom band; its last row L three times — (201,699) to the list's end, Tapped L after 2;
    // tabbar-floating's R three times — (201,699), then (201,391) three times, Tapped R after 4, once 5; the idb
    // visibility group once, nothing not known.
    ['ios-vis-r14-lv3-dense-R-1.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-R-2.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-R-3.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-R-4.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-R-5.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-L-1.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-L-2.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-dense-L-3.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-floating-R-1.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-floating-R-2.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3-floating-R-3.json', 'visibility', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['ios-vis-r14-lv3.json', 'visibility', { cases: 149, ok: 111, loud: 7, mismatches: 31 }],
  ])('%s (--groups %s): every case not ok known, the counts as recorded', { timeout: 60_000 }, async (record, groups, want) => {
    const { code, out } = await rejudge(record, groups);
    const header = /^# Live golden: (\d+) cases, (\d+) ok, (\d+) loud, (\d+) mismatches \((\d+) not known\), (\d+) skipped$/m.exec(out);
    expect(header, out.slice(0, 2000)).not.toBeNull();
    const [, cases, ok, loud, mismatches, notKnown, skipped] = header!.map(Number);
    expect({ cases, ok, loud, mismatches, notKnown, skipped }).toEqual({ ...want, notKnown: 0, skipped: 0 });
    expect(out).not.toMatch(/NOT known|FIXED, not intermittent/);
    expect(code, out.slice(-2000)).toBe(0);
  });
});

// L2's fix (round 8): the src before it, live.
describe('live.ts --rejudge over the committed iOS record of the src before L2\'s fix', () => {
  // fix/round-8's src through --side (docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md):
  // under idb the tap on phone answered Tapped and SUBMITTED the form, scroll_until called it fully visible after 0
  // swipes, its centre under the bar — no live-known.ts entry explains either: exit 1, as recorded.
  it('ios-forms-r8-l2-before.json: k6 and k7 not known, the form submitted', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-forms-r8-l2-before.json', 'forms');
    expect(out).toMatch(/^# Live golden: 2 cases, 0 ok, 0 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown).toEqual(['k6', 'k7']);
    expect(out).toMatch(/the form was SUBMITTED/);
    expect(code).toBe(1);
  });
});

// L4's fix (round 8): its first src live, and its final src's first run.
describe('live.ts --rejudge over the committed iOS records of L4\'s fix before its review\'s fixes', () => {
  // fix/r8-l4 37bf5a15: C's scroll_until under the menu row W stroked the blur three times before refusing (no
  // dismissal logged) — known as residual 9's `presented-stroke` until its final src (94fc318b) stopped it before any
  // swipe and the three entries were struck off: here they read as recorded, not known — a calibration of that src now:
  // exit 1, as recorded. C's taps refused, nothing fired, as at the final src.
  it.each([
    ['ios-vis-r8-l4-1.json'],
    ['ios-vis-r8-l4-2.json'],
  ] as const)('%s: C\'s three strokes not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 10 ok, 2 loud, 28 mismatches \(3 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['scroll:blur-menu.C', 'scroll:blur-menu.C', 'scroll:blur-menu-grouped.C'].sort());
    expect(code).toBe(1);
  });
  // 94fc318b's first run: every case as -4.json reads it but idb's tap of blur-menu's A, the run's first case on a
  // freshly booted simulator — averi's wait for A timed out with no tree, nothing tapped: ok, vacuously, so its entry
  // reads FIXED here; it read Tapped (the menu dismissed) in -4.json, so the entry stays: exit 1, as recorded.
  it('ios-vis-r8-l4-3.json: idb\'s tap of A ok by a timeout, so FIXED; nothing else not ok unknown', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-vis-r8-l4-3.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 14 ok, 2 loud, 24 mismatches \(0 not known\), 0 skipped$/m);
    expect(out).toMatch(/^- ok tap:blur-menu\.A blur-menu: .*ERROR Timed out after 5000ms waiting for element id:"lab\.blur-menu\.A" to appear/m);
    expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb tap:blur-menu.A\n');
    expect(code).toBe(1);
  });
});

// L4's remaining half (round 9): the first run at its src.
describe('live.ts --rejudge over the first committed iOS record of L4\'s remaining half', () => {
  // fix/r9-l4w 1ef11b9c's first run: every case as -2.json reads it but idb's tap of blur-menu's A, again the run's
  // first case on a freshly booted simulator — the wait for A timed out with no tree, nothing tapped: ok, vacuously, so
  // its entry reads FIXED here; it read Tapped (the menu dismissed) in -2.json, so the entry stays: exit 1, as recorded.
  it('ios-vis-r9-l4w-1.json: idb\'s tap of A ok by a timeout, so FIXED; W tapped under both sources', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-vis-r9-l4w-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 16 ok, 0 loud, 24 mismatches \(0 not known\), 0 skipped$/m);
    expect(out).toMatch(/^- ok tap:blur-menu\.A blur-menu: .*ERROR Timed out after 5000ms waiting for element id:"lab\.blur-menu\.A" to appear/m);
    expect(out.match(/^- ok tap:blur-menu\.W blur-menu: tap W \(open\): fires it alone — Tapped id:"lab\.blur-menu\.W"$/gm)).toHaveLength(2);
    expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb tap:blur-menu.A\n');
    expect(code).toBe(1);
  });
});

// Round 9's final device check (fix/round-9 14a7d90d): its first run.
describe('live.ts --rejudge over the first committed iOS record of round 9\'s final device check', () => {
  // As ios-vis-r9-l4w-1.json: every case as ios-vis-r9-final-2.json reads it but idb's tap of blur-menu's A, the run's
  // first case on a freshly booted simulator — the wait for A timed out with no tree, nothing tapped: ok, vacuously, so
  // its entry reads FIXED here; it read Tapped (the menu dismissed) in -2.json, so the entry stays: exit 1, as recorded.
  it('ios-vis-r9-final-1.json: idb\'s tap of A ok by a timeout, so FIXED; W tapped under both sources', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-vis-r9-final-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 16 ok, 0 loud, 24 mismatches \(0 not known\), 0 skipped$/m);
    expect(out).toMatch(/^- ok tap:blur-menu\.A blur-menu: .*ERROR Timed out after 5000ms waiting for element id:"lab\.blur-menu\.A" to appear/m);
    expect(out.match(/^- ok tap:blur-menu\.W blur-menu: tap W \(open\): fires it alone — Tapped id:"lab\.blur-menu\.W"$/gm)).toHaveLength(2);
    expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb tap:blur-menu.A\n');
    expect(code).toBe(1);
  });
});

// B4-L1's first src (round 9): its sticky-header clause, refused by the device.
describe('live.ts --rejudge over the committed Android record of B4-L1\'s first src', () => {
  // fix/r9-b4l1 7755978c read a sticky header in the row's own list as an overlay (VA1 with B4-L1): scroll_until R
  // fully stroked the list 66→877→439→1→205 and timed out with R under the header — no stop-claim, so VA1's live-known
  // entry does not explain it (R-direction): exit 1, as recorded. Why e6ed7d43 dropped the clause (ADR 0013, refined
  // 2026-10-20).
  it('android-vis-r9-b4l1-sticky.json: scroll-sticky-cut R fully not known, ended under the header', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('android-vis-r9-b4l1-sticky.json', 'visibility');
    // (1 not known until LV1's fix, round 14: tabbar-floating F's unchanged claim since.)
    expect(out).toMatch(/^# Live golden: 18 cases, 16 ok, 0 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['scroll:scroll-sticky-cut.R.fully', 'scroll:tabbar-floating.F'].sort());
    expect(code).toBe(1);
  });
});

// A1's fix reaching the long list (round 7's carry); struck at round 7's final device check.
describe('live.ts --rejudge over the committed iOS record of the src before the one-stroke stop reached the long list', () => {
  // The long-list carry case was known as ADR 0021 residual 1 (intermittent) until round 7's final device check struck
  // it off: at truth/round-7 836e04b1 L rested 51–330 pt inside its window in four runs of four (the records pinned
  // above). A2's run 1 (src a1b0b82, before A1's src reached it) rested L 14 pt past its window: it reads
  // as recorded, not known — a calibration of that src now: exit 1, as recorded.
  it('ios-wda-long-list-parked-1.json: the carry case not known, everything else as HEAD knows it', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-wda-long-list-parked-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 6 cases, 5 ok, 0 loud, 1 mismatches \(1 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown).toEqual(['carry:sheet-long-list.L']);
    expect(code).toBe(1);
  });
});

// A1's fix (480660a4), round 7.
describe('live.ts --rejudge over the committed iOS records of the src before the one-stroke stop', () => {
  // WDA's turn of F after strokes that moved nothing (LV4: 2–4 unmoved strokes before the turn, or none) was known until
  // round 7's A1 (480660a4: a read within a point is unmoved, the turn after ONE such stroke) and its entry was struck
  // off: in these records, each an older src's, it reads as recorded, not known — a calibration of that src now, not
  // HEAD's KNOWN: exit 1, as recorded. Everything else as HEAD knows it.
  it.each([
    // round 6's WDA smoke run of scroll-bounded and sheet-long-list at the same src: LV4 spent its budget (4 strokes up
    // before the turn: LV4's also), LV5's case ok; its carry case (Row 30, turned three times: LV6) not judged since
    // round 7, as above — 16 cases and 2 mismatches until then, in each of the three
    ['ios-wda-bounded-long-list-11683c3-1.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    // its two reruns: LV5's case ok in both (struck off: four ok of four at this src), LV4 turning after 2 unmoved
    // strokes and reaching F
    ['ios-wda-bounded-long-list-11683c3-2.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    ['ios-wda-bounded-long-list-11683c3-3.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    // (round 7's A2's whole WDA visibility group, ios-wda-vis-parked.json: below, before L4's fix too)
    // round 5's two reruns of scroll-bounded under WDA, at ios-vis-2725e76.json's src: LV5's case ok in both, LV4's not
    ['ios-scroll-bounded-wda-2725e76-1.json', 'visibility', { cases: 12, ok: 11, loud: 0, mismatches: 1 }],
    ['ios-scroll-bounded-wda-2725e76-2.json', 'visibility', { cases: 12, ok: 11, loud: 0, mismatches: 1 }],
  ] as const)('%s (--groups %s): the turn of F not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want) => {
    const { code, out } = await rejudge(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(1 not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown).toEqual(['turn:scroll-bounded.F']);
    expect(code).toBe(1);
  });
});

/**
 * idb's presented-layer cases as they read before round 7's A5 (a1261499): sheet-medium's A–D and sheet-medium-edges'
 * H and G stroked for beneath the medium sheet (A, B, H, G then claimed "fully visible" on the host it uncovered; C, D
 * two strokes on it), sheet-background's A and B a stop claimed after the stroke dismissed the large sheet. Known as
 * residual 6 until A5 struck the six off and re-classed the two as its loud changed stop (`presented-changed`).
 */
const A5_IDB = [...['A', 'B', 'C', 'D'].map((t) => `scroll:sheet-medium.${t}`), 'scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G', 'scroll:sheet-background.A', 'scroll:sheet-background.B'];

/**
 * The blur menus' C as it read before round 8's L4 fix (37bf5a15): Tapped at its centre, which fired the menu row W
 * drawn over it, and scroll_until "fully visible after 0 swipes" — idb's on both cells, WDA's on blur-menu (WDA lists
 * W after C on the grouped cell, which it refused). Known as residual 9's (`tap-claim`, `presented-stop`) until L4's fix
 * struck the taps off and re-classed the scroll cases as three strokes on the blur, refused (`presented-stroke`) —
 * struck off too at its final src (94fc318b), which stops them before any swipe.
 */
/**
 * scroll-bounded's P and S under idb with `fully: true` as they read before round 14's LE2 fix (11daf08): "fully
 * visible after 0 swipes" (`stop-claim` on `visible`), known as LE2 until the fix — since, the eyes see the clip line
 * and the stop fails (P: R-direction on refused; S: its case's tap Tapped on the background, a tap-claim), re-filed as
 * ADR 0010's residual 5.
 */
const LE2_IDB = ['scroll:scroll-bounded.P.fully', 'scroll:scroll-bounded.S.fully'];

/**
 * scroll-sticky's R with `fully: true` as it read before round 14's LE3 fix (40b4856), under idb and WDA alike: "fully
 * visible after 0 swipes" under the pinned section header (`stop-claim` on `visible`), known as LE3 until the fix —
 * since, the header listed before R is drawn over it, and one stroke brings R out from under it (ok, struck off).
 */
const LE3_IDB = ['scroll:scroll-sticky.R.fully'];
const LE3_WDA = ['scroll:scroll-sticky.R.fully'];

/**
 * tabbar-floating's R under idb as it read before round 14's LV3 fix (02aabfa6): the turned strokes touching down at
 * y 175, in the header above the list, moving nothing — R-direction on `refused`, known as LV3 until the fix struck it
 * off (R reached and tapped in every run since): a record before the fix reads not known.
 */
const LV3_IDB = ['scroll:tabbar-floating.R'];

const L4_IDB = ['tap:blur-menu.C', 'scroll:blur-menu.C', 'tap:blur-menu-grouped.C', 'scroll:blur-menu-grouped.C'];
const L4_WDA = ['tap:blur-menu.C', 'scroll:blur-menu.C'];

// L4's fix (37bf5a15), round 8 — and LE2's (11daf08), round 14: idb's two `fully` cases of scroll-bounded (LE2_IDB);
// and LE3's (40b4856), round 14: scroll-sticky's R with `fully: true` (LE3_IDB, LE3_WDA); and LV3's (02aabfa6), round
// 14: idb's tabbar-floating R (LV3_IDB).
describe('live.ts --rejudge over the committed iOS records of the src before L4\'s reading-order covers', () => {
  // C's cases beneath the blur menus, as above: in these records, each an older src's, they read as recorded — a tap
  // that fired W, a stop claimed at once — not known: a calibration of that src now, not HEAD's KNOWN: exit 1, as
  // recorded. Everything else as HEAD knows it.
  it.each([
    // round 7's A5 (src arch/r23-idb-sheet through --side): the whole visibility group under idb once — sheet-medium-edges' H and G ok too
    ['ios-idb-vis-a5.json', { cases: 145, ok: 100, loud: 8, mismatches: 37 }, [...L4_IDB, ...LE2_IDB, ...LE3_IDB, ...LV3_IDB]],
    // round 7's final device check (truth/round-7 836e04b1): the visibility groups, as the records pinned above
    ['ios-wda-vis-r7final.json', { cases: 146, ok: 129, loud: 1, mismatches: 16 }, [...L4_WDA, ...LE3_WDA]],
    ['ios-idb-vis-r7final.json', { cases: 145, ok: 100, loud: 8, mismatches: 37 }, [...L4_IDB, ...LE2_IDB, ...LE3_IDB, ...LV3_IDB]],
    // round 7's A2's whole WDA visibility group (ios-wda-long-list-parked-1…3.json's src: LV6 fixed, A1 not) — WDA's
    // turn of F not known there as well (the one-stroke stop's block above)
    ['ios-wda-vis-parked.json', { cases: 146, ok: 128, loud: 1, mismatches: 17 }, ['turn:scroll-bounded.F', ...L4_WDA, ...LE3_WDA]],
    // round 8's own --side run of fix/round-8 e0c2587e, the src before the fix: C's tap fired W under both sources
    ['ios-vis-r8-l4-before.json', { cases: 40, ok: 7, loud: 2, mismatches: 31 }, [...L4_IDB, ...L4_WDA]],
  ] as const)('%s: C\'s cases beneath the blur menus not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want, unknownIds) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${unknownIds.length} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual([...unknownIds].sort());
    expect(code).toBe(1);
  });
});

// A5's fix (a1261499), round 7.
describe('live.ts --rejudge over the committed iOS records of the src before idb\'s presented layer', () => {
  // The live entries of idb's cases beneath the medium sheet, struck off by round 7's A5, and the re-classed two of the
  // large sheet: in these records, each an older src's, they read as recorded — a stroke beneath the layer, a stop
  // claimed — not known: a calibration of that src now, not HEAD's KNOWN: exit 1, as recorded. Two of them are older
  // than A1's fix too: WDA's turn of F not known there as well (the block above).
  it.each([
    // …the whole visibility group under both sources at e687fe83 (A1's src before the 108-pt floor); its carry case
    // (Row 30 of the 40-row table) no case since round 7's 56-row table, so 286 of the 287 recorded
    ['ios-vis-r23-ios-stop-e687fe83.json', 'visibility', { cases: 286, ok: 219, loud: 6, mismatches: 61 }, [...A5_IDB, ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB]],
    // re-recorded by round 6's iOS device check (src 11683c3; the forms group run too, judged apart): the presented
    // refusal cases new (WDA ok, idb residual 6, the blur residual 9), round 6's new cells' cases new (carousel-in-list
    // C under idb LE2), LV4's turn `visible` (its entry's primary kind until A1 struck it off). Its long-list carry
    // case (LV6: Row 30 of the 40-row table, asked by its text) is no case since round 7 (the table 56 rows, the carry
    // asked of target L), so not judged: 311 cases and 64 mismatches until then. idb's scroll case of F (R-direction
    // until then) LOUD since: round 7's recapture records F unlisted under idb, its strokes unjudged.
    ['ios-vis.json', 'visibility,dismissal', { cases: 310, ok: 242, loud: 6, mismatches: 62 }, [...A5_IDB, 'turn:scroll-bounded.F', ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB]],
    // round 5's own run (src b71cbbb, harness 2725e76: ios-vis.json until round 6 re-recorded it): LV5's failing run
    // reads LOUD, its entry struck off since (round 6: ok four times at 11683c3); no sheet-medium or sheet-background
    // cell then, sheet-medium-edges' H and G alone of A5's
    // (idb's scroll case of F LOUD since round 7's recapture, as above: 6 loud, 30 mismatches until then); no scroll case
    // of the blur menus then, so of L4's only C's taps (idb's two, WDA's one: hence tap:blur-menu.C twice)
    ['ios-vis-2725e76.json', 'visibility,dismissal', { cases: 248, ok: 212, loud: 7, mismatches: 29 }, ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G', 'turn:scroll-bounded.F', 'tap:blur-menu.C', 'tap:blur-menu-grouped.C', 'tap:blur-menu.C', ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB]],
  ] as const)('%s (--groups %s): idb\'s presented-layer cases (and L4\'s C) not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want, unknownIds) => {
    const { code, out } = await rejudge(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${unknownIds.length} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual([...unknownIds].sort());
    expect(code).toBe(1);
  });
});

/** VA1's live case (docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md), struck off live-known.ts by round 14's fix. */
const VA1_CASE = 'scroll:scroll-sticky-cut.R.fully';

/** LE1's six live cases (docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md), struck off live-known.ts by round 14's fix. */
const LE1_CASES = ['scroll:scroll-bounded.P.fully', 'tap:scroll-bounded.S', 'scroll:scroll-bounded.S', 'scroll:scroll-bounded.S.fully', 'tap:carousel-in-list.C', 'scroll:carousel-in-list.C'];

/**
 * LV1's three live cases (docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md),
 * struck off live-known.ts by round 14's fix: each claimed "the last 2 … did not change the screen" while its list moved.
 */
const LV1_CASES = ['scroll:scroll-bounded.O', 'scroll:scroll-bounded.F', 'scroll:tabbar-floating.F'];

/** The ids of a rejudged record's mismatches no entry of live-known.ts explains. */
const notKnown = (out: string): string[] => [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);

// Before LV1's fix (round 14).
describe('live.ts --rejudge over the committed Android record of the active-window hint, before LV1\'s fix', () => {
  // Round 6's closing review's run of the hint (src ea070d2): scroll-bounded's O and F claimed "the last 2 … did not
  // change the screen" while their strokes moved `upper` — LV1's, known until round 14 struck them off: not known now,
  // a calibration of that src: exit 1, as recorded. Every other case as HEAD knows it.
  it('android-vis-hint-ea070d2.json: LV1\'s two scroll-bounded cases not known', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('android-vis-hint-ea070d2.json', 'forms,visibility');
    expect(out).toMatch(/^# Live golden: 24 cases, 21 ok, 1 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    expect(notKnown(out).sort()).toEqual(['scroll:scroll-bounded.F', 'scroll:scroll-bounded.O']);
    expect(code).toBe(1);
  });
});

// Before LE1's fix (round 14).
describe('live.ts --rejudge over the committed Android visibility records of the src before LE1\'s fix', () => {
  // Their six LE1 cases, known until round 14 struck them off, read MISMATCH not known — each record a calibration of
  // its src now: exit 1, as recorded; every other case as HEAD knows it.
  it.each([
    // re-recorded by round 6's device check (src e98b87e; bands, bands-three-button and tabbar-floating from a rerun of
    // the same build, the first run's three tool calls hanging past the client's 300 s: android-vis-e98b87e-run1.json):
    // L1's eight presented scroll cases new and ok, round 6's new cells' cases new — carousel-in-list's C known as LE1;
    // the turn of scroll-collapsing's A (#10's, known until then) ok since the owner's decision of 2026-10-18 (ADR 0021:
    // no turn on uiautomator, a loud failure naming `up` after the two-stroke stop — live-visibility.ts#judgeAndroidTurn)
    ['android-vis.json', { cases: 111, ok: 98, loud: 3, mismatches: 10 }],
    ['android-vis-r7final.json', { cases: 137, ok: 120, loud: 3, mismatches: 14 }],
  ] as const)('%s: LE1\'s six cases not known, and VA1\'s and LV1\'s', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudge(record, 'visibility');
    // (6 not known until VA1's fix, round 14: its case since; 7 until LV1's, its three since.)
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(10 not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...LE1_CASES, VA1_CASE, ...LV1_CASES].sort());
    expect(code).toBe(1);
  });
});

// Before VA1's fix (round 14).
describe('live.ts --rejudge over the committed Android records of round 9\'s src, before VA1\'s fix', () => {
  // round 9's B4-L1 fix (fix/r9-b4l1 e6ed7d43; docs/truth/live-android-2026-10-18-visibility.md, its round-9 B4-L1
  // section) and round 9's final device check (fix/round-9 14a7d90d): pinned-bar, text-under-bar, scroll-sticky-cut,
  // bands and tabbar-floating — every tap as before (pinned-bar P Tapped at its clear centre), tabbar-floating F LV1's
  // known mismatch, scroll-sticky-cut R fully "fully visible after 0 swipes" under the header: VA1's stop-claim, known
  // until round 14 struck it off — not known now, a calibration of that src: exit 1, as recorded.
  // Since LV1's fix (round 14), tabbar-floating F's unchanged claim not known too.
  it.each([['android-vis-r9-b4l1.json'], ['android-vis-r9-final.json']] as const)('%s: VA1\'s case not known, and LV1\'s', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 18 cases, 16 ok, 0 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    expect(notKnown(out).sort()).toEqual([VA1_CASE, 'scroll:tabbar-floating.F'].sort());
    expect(code).toBe(1);
  });
});

// A6's fix, round 7.
describe('live.ts --rejudge over the committed Android records of the src before the eyes on a "fully" claim', () => {
  // k7: scroll_until phone under the bar riding on the IME. Its stop said "fully visible" with 18 px of phone under the
  // bar's node-less padding — ok by an allowance (ADR 0013's residual) until round 7's A6 made averi name the band
  // ("PARTLY UNDER a surface …") and live-forms.ts#judgePhoneScroll ask it. A forms case has no KNOWN: in these records,
  // each an older src's, k7 reads a MISMATCH not known — a calibration of that src now: exit 1, as recorded.
  it.each([
    // round 6's device check (src e98b87e) with the forms cases: k3 (a fill into note's 14-px strip under the bar) ok
    // since the owner's decision of 2026-10-18 — refused by design, the field untouched (live.ts k3); b1d and b7
    // (F2A2) LOUD. (Its visibility group alone is pinned above.)
    // Since round 14, LE1's six cases not known too (its src before that fix), and VA1's and LV1's.
    ['android-vis.json', 'forms,visibility', { cases: 133, ok: 117, loud: 5, mismatches: 11, unknown: ['k7', ...LE1_CASES, VA1_CASE, ...LV1_CASES] }],
    // A6's own run of k7 at its base, arch/round-23 bd43fc66, before the eyes
    ['android-k7-eyes-before-bd43fc66.json', 'forms', { cases: 1, ok: 0, loud: 0, mismatches: 1, unknown: ['k7'] }],
  ] as const)('%s (--groups %s): k7 not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want) => {
    const { code, out } = await rejudge(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.unknown.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...want.unknown].sort());
    expect(out).toMatch(/^- MISMATCH k7 .*fully visible after 1 swipe — 18 px of phone under the bar, unsaid/m);
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over a committed calibration record where the flush probe\'s intermittent cases read as a stop claim', () => {
  // Lab note LV2. Its flush cases are intermittent and ok in android-vis.json, so the record above never asks their entries' class
  // or kind. cal12-d043e65-1.json (#12's live calibration, a --side run of d043e65) reads both as a stop claimed on
  // `visible`: known by LV2's entries. Its one case not known, scroll-bounded-flush.S, is #12's own defect at that
  // commit (a calibration, not HEAD's KNOWN): exit 1, as recorded.
  it('cal12-d043e65-1.json: P.fully and S.fully known by the flush probe\'s note, S alone not known', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('cal12-d043e65-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches \(1 not known\), 0 skipped$/m);
    const lv2 = 'bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md';
    for (const id of ['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S.fully'])
      expect(out).toMatch(new RegExp(`^- MISMATCH \\(stop-claim\\) ${id.replaceAll('.', '\\.')} .*\\[known: ${lv2.replaceAll('.', '\\.')}\\]$`, 'm'));
    expect(out).toMatch(/^- MISMATCH \(stop-claim\) scroll:scroll-bounded-flush\.S scroll-bounded-flush: .*(?<!\])$/m);
    expect(code).toBe(1);
  });
});

// Before L1's and F2A1's fixes.
describe('live.ts --rejudge over the committed record of a --side run of b71cbbb, before the fixes of the scroll stop beneath a presented window and of k7', () => {
  // Round 6's device check, the same cases and lab build as android-vis.json. Its cases not known are exactly the two
  // fixes' before: L1's eight scroll_until beneath the AlertDialog and the half sheet (a stop "after 1 swipe" that
  // dismissed the layer, or three strokes that expanded the sheet) and F2A1's k7 (a forms case: no KNOWN) — a
  // calibration, not HEAD's KNOWN: exit 1, as recorded.
  it('android-vis-b71cbbb.json: the scroll cases beneath the dialog and the half sheet, and k7, not known, everything else as HEAD knows it', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('android-vis-b71cbbb.json', 'forms,visibility');
    // (108 ok, 20 mismatches until 2026-10-18: the turn of scroll-collapsing's A ok by the Android turn judge since.)
    // (9 not known until round 14: LE1's six cases since, and VA1's and LV1's three.)
    expect(out).toMatch(/^# Live golden: 133 cases, 109 ok, 5 loud, 19 mismatches \(19 not known\), 0 skipped$/m);
    expect(notKnown(out).sort()).toEqual(['k7', ...LE1_CASES, VA1_CASE, ...LV1_CASES, ...['alert-dim', 'sheet-medium'].flatMap((c) => ['A', 'B', 'C', 'D'].map((t) => `scroll:${c}.${t}`))].sort());
    expect(code).toBe(1);
  });
});

// Round 5's src, round 6's iOS device check.
describe('live.ts --rejudge over the committed iOS record of a --side run of b71cbbb', () => {
  // A new run of this harness's cases at round 5's src (not round 5's own run: ios-vis-2725e76.json), the same lab
  // build as ios-vis.json (src 11683c3), the forms group with them. HEAD's KNOWN explains every visibility case not ok
  // — WDA's carousel C, its stop claimed on a read still moving, by the triage note's intermittent entry. Its cases not
  // known are two forms fills whose model lost the IBAN's last digit (lab note
  // 2026-10-15-lab-ios-swiftui-model-drops-trailing-typed-characters.md): a forms case has no KNOWN, so exit 1 — and,
  // since round 7's A1 struck their entries off, WDA's turn of F (LV4) and carousel C's stop claimed on a read still
  // moving, as recorded at that src; since A5's, idb's presented-layer cases (A5_IDB, above); since L4's, C's cases
  // beneath the blur menus (L4_IDB, L4_WDA); since LE2's and LE3's (round 14), LE2_IDB and scroll-sticky's R fully
  // (LE3_IDB, LE3_WDA); since LV3's (round 14), idb's tabbar-floating R (LV3_IDB).
  // The visibility cases A1 and A5 fixed since.
  it('ios-vis-b71cbbb.json: forms b4 and p2 not known, and the visibility cases the one-stroke stop and idb\'s presented layer fixed since', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-vis-b71cbbb.json', 'forms,visibility,dismissal');
    // (351 cases, 14 loud, 67 mismatches until round 7: its carry case, Row 30 of the 40-row table, no case since; idb's
    // scroll case of F LOUD, F recorded unlisted under idb.)
    expect(out).toMatch(/^# Live golden: 350 cases, 270 ok, 15 loud, 65 mismatches \(23 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['b4', 'p2', 'scroll:carousel-in-list.C', 'turn:scroll-bounded.F', ...A5_IDB, ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB].sort());
    expect(code).toBe(1);
  });
});

// LV6's fix (A2, a1b0b82), round 7's lab fixes, truth/r7-lab-fixes.
describe('live.ts --rejudge over the committed records of the src before the parked cell content moved to its cell', () => {
  // sheet-long-list at 56 rows, its target L past one carry and before the end. L's carry and scroll cases under WDA
  // were LV6's (its parked label read above the screen: turned three times; the scroll case's turns merged into one
  // stroke in the second run, read not-reached) until round 7's A2 fixed it (a1b0b82) and their entries were struck
  // off: here they read as recorded, not known — the src before the fix, a calibration of it now, not HEAD's KNOWN:
  // exit 1, as recorded. F and L under idb never in the tree (no identifier): LOUD.
  it.each([
    ['ios-long-list-r7-lab-1.json', { cases: 17, ok: 10, loud: 5, mismatches: 2, notKnown: 2 }, ['carry:sheet-long-list.L', 'scroll:sheet-long-list.L']],
    ['ios-long-list-r7-lab-2.json', { cases: 17, ok: 10, loud: 6, mismatches: 1, notKnown: 1 }, ['carry:sheet-long-list.L']],
    // round 7's A1 at 659fdf00 (arch/r23-ios-stop, before A2's fix reached it): the WDA scroll cells, L's two cases
    // LV6's as above, every other case ok — the turn of F in one stroke, carousel C settled
    ['ios-wda-scroll-cells-659fdf00.json', { cases: 32, ok: 30, loud: 0, mismatches: 2, notKnown: 2 }, ['carry:sheet-long-list.L', 'scroll:sheet-long-list.L']],
  ] as const)('%s: L\'s WDA cases not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want, unknownIds) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.notKnown} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual([...unknownIds].sort());
    expect(code).toBe(1);
  });
});

// LW1's fix (A7, f924893e), round 7's T2, truth/r7-dialogs.
describe('live.ts --rejudge over the committed records of the src before the Views BottomSheetDialog was marked presented', () => {
  // Round 7's presented windows the parser did not mark: both cells' taps, scroll_until and colour asserts, then their
  // eight scroll cases twice more — the same in every run. Beneath the full-screen Compose Dialog residual 19's four,
  // known; beneath the Views BottomSheetDialog LW1's four (A's and B's stroke up on the scrim dismissing the sheet and
  // claiming the stop, C's and D's two strokes on it), whose entries round 7's A7 struck off (f924893e: the window
  // marked by Material's ids): not known here — the src before the fix, a calibration of it now: exit 1, as recorded.
  it.each([
    ['android-vis-dialogs.json', { cases: 26, ok: 18, loud: 0, mismatches: 8, notKnown: 4 }],
    ['android-vis-dialogs-scroll-run2.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 4 }],
    ['android-vis-dialogs-scroll-run3.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 4 }],
  ] as const)('%s: the bottom sheet dialog\'s four scroll cases not known, the full-screen dialog\'s known', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.notKnown} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['A', 'B', 'C', 'D'].map((t) => `scroll:bottom-sheet-dialog.${t}`));
    expect(code).toBe(1);
  });
});

describe('live.ts: a known case not intermittent that comes out ok fails the run (live-known.ts\'s ratchet)', () => {
  // (Until round 8's L4 fix struck it off, the example was idb's tap:blur-menu-grouped.C read as WDA read it; until
  // round 14's LV3 fix struck it off, idb's scroll:tabbar-floating.R.)
  it('idb scroll:scroll-bounded.F read as WDA read it (known under idb, which lists no scroll view; WDA strokes inside `lower`, stops on F, the tap firing it): FIXED, exit 1', { timeout: 60_000 }, async () => {
    type Rec = { platform: string; side: string; results: { source: string; id: string }[] };
    const ios = JSON.parse(readFileSync(`${ROOT}docs/truth/live-records/ios-vis.json`, 'utf8')) as Rec;
    const wda = ios.results.find((r) => r.source === 'wda' && r.id === 'scroll:scroll-bounded.F')!;
    const dir = await mkdtemp(join(tmpdir(), 'live-rejudge-'));
    try {
      const file = join(dir, 'fixed.json');
      await writeFile(file, JSON.stringify({ ...ios, results: [{ ...wda, source: 'idb' }] }));
      const { code, out } = await rejudge(file, 'visibility');
      expect(out).toMatch(/^# Live golden: 1 cases, 1 ok, 0 loud, 0 mismatches \(0 not known\)/m);
      expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb scroll:scroll-bounded.F');
      expect(code).toBe(1);
      // the same read as a --side run's record: a calibration, not held to HEAD's KNOWN
      await writeFile(file, JSON.stringify({ ...ios, side: '/some/differential-cal-checkout', results: [{ ...wda, source: 'idb' }] }));
      expect((await rejudge(file, 'visibility')).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

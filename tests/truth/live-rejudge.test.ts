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
 * ios-rn-forms-a9-*.json and ios-forms-a9.json, A9's; ios-scroll-bounded-wda-2725e76-*.json, round 5's) judged again
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
    // re-recorded by round 6's device check (src e98b87e; bands, bands-three-button and tabbar-floating from a rerun of
    // the same build, the first run's three tool calls hanging past the client's 300 s: android-vis-e98b87e-run1.json):
    // L1's eight presented scroll cases new and ok, round 6's new cells' cases new — carousel-in-list's C known as LE1;
    // the turn of scroll-collapsing's A (#10's, known until then) ok since the owner's decision of 2026-10-18 (ADR 0021:
    // no turn on uiautomator, a loud failure naming `up` after the two-stroke stop — live-visibility.ts#judgeAndroidTurn)
    ['android-vis.json', 'visibility', { cases: 111, ok: 98, loud: 3, mismatches: 10 }],
    // …with the forms cases: k3 (a fill into note's 14-px strip under the bar) ok since the same day's decision —
    // refused by design, the field untouched (live.ts k3); k7's stop ok (18 px of phone under the bar's node-less
    // padding: a known residual, ADR 0013's); b1d and b7 (F2A2) LOUD
    ['android-vis.json', 'forms,visibility', { cases: 133, ok: 118, loud: 5, mismatches: 10 }],
    // round 6's closing review: the active-window hint run live (src and lab app ea070d2) — form-picker's c2–c4 ok with
    // the hint beneath the wait, scroll-bounded O and F LV1's, turn F LOUD, L1's 16 presented cases ok without it
    ['android-vis-hint-ea070d2.json', 'forms,visibility', { cases: 24, ok: 21, loud: 1, mismatches: 2 }],
    // round 7's A2 (LV6 fixed: src arch/r23-parked a1b0b82 through --side, the lab app truth/round-7 461d6fd): L's
    // scroll case ok in all three runs, two strokes down, no turn; its carry case reached likewise, at rest inside L's
    // window in runs 2 and 3 (ok, its entry intermittent) and 14 pt past it in run 1 — the reply "CLIPPED at top, 78%",
    // R-direction on `visible`: ADR 0021 residual 1
    ['ios-wda-long-list-parked-1.json', 'visibility', { cases: 6, ok: 5, loud: 0, mismatches: 1 }],
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
    // …the whole visibility group under both sources at e687fe83 (before the 108-pt floor): nothing not known; its
    // carry case (Row 30 of the 40-row table) no case since round 7's 56-row table, so 286 of the 287 recorded
    ['ios-vis-r23-ios-stop-e687fe83.json', 'visibility', { cases: 286, ok: 219, loud: 6, mismatches: 61 }],
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

describe('live.ts --rejudge over the committed iOS records of the src before A1\'s fix (round 7\'s one-stroke stop)', () => {
  // WDA's turn of F after strokes that moved nothing (LV4: 2–4 unmoved strokes before the turn, or none) was known until
  // round 7's A1 (480660a4: a read within a point is unmoved, the turn after ONE such stroke) and its entry was struck
  // off: in these records, each an older src's, it reads as recorded, not known — a calibration of that src now, not
  // HEAD's KNOWN: exit 1, as recorded. Everything else as HEAD knows it.
  it.each([
    // re-recorded by round 6's iOS device check (src 11683c3; the forms group run too, judged apart): the presented
    // refusal cases new (WDA ok, idb residual 6, the blur residual 9), round 6's new cells' cases new (carousel-in-list
    // C under idb LE2), LV4's turn `visible` (its entry's primary kind until A1 struck it off). Its long-list carry
    // case (LV6: Row 30 of the 40-row table, asked by its text) is no case since round 7 (the table 56 rows, the carry
    // asked of target L), so not judged: 311 cases and 64 mismatches until then. idb's scroll case of F (R-direction
    // until then) LOUD since: round 7's recapture records F unlisted under idb, its strokes unjudged.
    ['ios-vis.json', 'visibility,dismissal', { cases: 310, ok: 242, loud: 6, mismatches: 62 }],
    // round 5's own run (src b71cbbb, harness 2725e76: ios-vis.json until round 6 re-recorded it): LV5's failing run
    // reads LOUD, its entry struck off since (round 6: ok four times at 11683c3)
    // (idb's scroll case of F LOUD since round 7's recapture, as above: 6 loud, 30 mismatches until then)
    ['ios-vis-2725e76.json', 'visibility,dismissal', { cases: 248, ok: 212, loud: 7, mismatches: 29 }],
    // round 6's WDA smoke run of scroll-bounded and sheet-long-list at the same src: LV4 spent its budget (4 strokes up
    // before the turn: LV4's also), LV5's case ok; its carry case (Row 30, turned three times: LV6) not judged since
    // round 7, as above — 16 cases and 2 mismatches until then, in each of the three
    ['ios-wda-bounded-long-list-11683c3-1.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    // its two reruns: LV5's case ok in both (struck off: four ok of four at this src), LV4 turning after 2 unmoved
    // strokes and reaching F
    ['ios-wda-bounded-long-list-11683c3-2.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    ['ios-wda-bounded-long-list-11683c3-3.json', 'visibility', { cases: 15, ok: 14, loud: 0, mismatches: 1 }],
    // round 7's A2's whole WDA visibility group (ios-wda-long-list-parked-1…3.json's src, above: LV6 fixed, A1 not)
    ['ios-wda-vis-parked.json', 'visibility', { cases: 146, ok: 128, loud: 1, mismatches: 17 }],
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

describe('live.ts --rejudge over the committed record of round 5\'s src (a --side run of b71cbbb), before L1\'s and F2A1\'s fixes', () => {
  // Round 6's device check, the same cases and lab build as android-vis.json. Its cases not known are exactly the two
  // fixes' before: L1's eight scroll_until beneath the AlertDialog and the half sheet (a stop "after 1 swipe" that
  // dismissed the layer, or three strokes that expanded the sheet) and F2A1's k7 (a forms case: no KNOWN) — a
  // calibration, not HEAD's KNOWN: exit 1, as recorded.
  it('android-vis-b71cbbb.json: L1\'s scroll cases and k7 not known, everything else as HEAD knows it', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('android-vis-b71cbbb.json', 'forms,visibility');
    // (108 ok, 20 mismatches until 2026-10-18: the turn of scroll-collapsing's A ok by the Android turn judge since.)
    expect(out).toMatch(/^# Live golden: 133 cases, 109 ok, 5 loud, 19 mismatches \(9 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([a-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['k7', ...['alert-dim', 'sheet-medium'].flatMap((c) => ['A', 'B', 'C', 'D'].map((t) => `scroll:${c}.${t}`))].sort());
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over the committed iOS record of round 5\'s src (a --side run of b71cbbb), round 6\'s iOS device check', () => {
  // A new run of this harness's cases at round 5's src (not round 5's own run: ios-vis-2725e76.json), the same lab
  // build as ios-vis.json (src 11683c3), the forms group with them. HEAD's KNOWN explains every visibility case not ok
  // — WDA's carousel C, its stop claimed on a read still moving, by the triage note's intermittent entry. Its cases not
  // known are two forms fills whose model lost the IBAN's last digit (lab note
  // 2026-10-15-lab-ios-swiftui-model-drops-trailing-typed-characters.md): a forms case has no KNOWN, so exit 1 — and,
  // since round 7's A1 struck their entries off, WDA's turn of F (LV4) and carousel C's stop claimed on a read still
  // moving, as recorded at that src.
  it('ios-vis-b71cbbb.json: forms b4 and p2 not known, every visibility case as HEAD knows it', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudge('ios-vis-b71cbbb.json', 'forms,visibility,dismissal');
    // (351 cases, 14 loud, 67 mismatches until round 7: its carry case, Row 30 of the 40-row table, no case since; idb's
    // scroll case of F LOUD, F recorded unlisted under idb.)
    expect(out).toMatch(/^# Live golden: 350 cases, 270 ok, 15 loud, 65 mismatches \(4 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['b4', 'p2', 'scroll:carousel-in-list.C', 'turn:scroll-bounded.F']);
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over the committed records of the src before LV6\'s fix (round 7\'s lab fixes, truth/r7-lab-fixes)', () => {
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

describe('live.ts --rejudge over the committed records of the src before LW1\'s fix (round 7\'s T2, truth/r7-dialogs)', () => {
  // Round 7's presented windows the parser did not mark: both cells' taps, scroll_until and colour asserts, then their
  // eight scroll cases twice more — the same in every run. Beneath the full-screen Compose Dialog residual 19's four,
  // known; beneath the Views BottomSheetDialog LW1's four (A's and B's stroke up on the scrim dismissing the sheet and
  // claiming the stop, C's and D's two strokes on it), whose entries round 7's A7 struck off (f924893e: the window
  // marked by Material's ids): not known here — the src before the fix, a calibration of it now: exit 1, as recorded.
  it.each([
    ['android-vis-dialogs.json', { cases: 26, ok: 18, loud: 0, mismatches: 8, notKnown: 4 }],
    ['android-vis-dialogs-scroll-run2.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 4 }],
    ['android-vis-dialogs-scroll-run3.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 4 }],
  ] as const)('%s: LW1\'s four scroll cases not known, residual 19\'s known', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudge(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.notKnown} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['A', 'B', 'C', 'D'].map((t) => `scroll:bottom-sheet-dialog.${t}`));
    expect(code).toBe(1);
  });
});

describe('live.ts: a known case not intermittent that comes out ok fails the run (live-known.ts\'s ratchet)', () => {
  it('idb tap:blur-menu-grouped.C read as WDA read it (refused, nothing fired): FIXED, exit 1', { timeout: 60_000 }, async () => {
    type Rec = { platform: string; side: string; results: { source: string; id: string }[] };
    const ios = JSON.parse(readFileSync(`${ROOT}docs/truth/live-records/ios-vis.json`, 'utf8')) as Rec;
    const wda = ios.results.find((r) => r.source === 'wda' && r.id === 'tap:blur-menu-grouped.C')!;
    const dir = await mkdtemp(join(tmpdir(), 'live-rejudge-'));
    try {
      const file = join(dir, 'fixed.json');
      await writeFile(file, JSON.stringify({ ...ios, results: [{ ...wda, source: 'idb' }] }));
      const { code, out } = await rejudge(file, 'visibility');
      expect(out).toMatch(/^# Live golden: 1 cases, 1 ok, 0 loud, 0 mismatches \(0 not known\)/m);
      expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb tap:blur-menu-grouped.C');
      expect(code).toBe(1);
      // the same read as a --side run's record: a calibration, not held to HEAD's KNOWN
      await writeFile(file, JSON.stringify({ ...ios, side: '/some/differential-cal-checkout', results: [{ ...wda, source: 'idb' }] }));
      expect((await rejudge(file, 'visibility')).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type Case, judged, rejudge as rejudgeRecord, ROOT, type RunRecord } from '../../scripts/truth/live-cases.js';
import type { LiveVerdict } from '../../scripts/truth/live-visibility.js';
import { failuresJson, failuresOf } from '../../scripts/truth/rejudge-failures.js';
import { hedgedLead } from '../../scripts/truth/replies.js';
import type { LabState } from '../../scripts/truth/schema.js';
import { readLiveRecord, type LiveRecord, type RecordedCase, withFieldValue } from '../helpers/live-records.js';

/**
 * The live golden's committed records (docs/truth/live-records) judged again by this checkout's judges —
 * `live.ts --rejudge`, the very code path, no device: a judge or a live-known.ts entry that changes what the records
 * read fails here, not first on a device. Pinned: the exit code (0: no MISMATCH that live-known.ts does not explain,
 * no known case not intermittent ok), no case not known, and the counts of the summary's header. Which records are
 * replayed is the rows below, each with the run it comes from; tests/truth/live-records-replayed.test.ts holds every
 * committed record to one of them or to its `EXEMPT` list (the records no rejudge can judge, each with its reason) —
 * that guard, not a list here, is the source of truth.
 */

const run = promisify(execFile);
/**
 * carousel-in-list's C under idb as it read before A38b's band stroke (interact/stroke-plan.ts#bandOf): its sideways
 * strokes over the screen's middle (y 437, below the carousel), none moving it, "content exhausted … a layout defect" —
 * R-direction on `refused`, known as ADR 0010's residual 5 until A38b struck it off (stroked inside the carousel's band
 * since, the replay green; the next Gate C proves it live): a record before it reads not known.
 */
const A38B_IDB = ['scroll:carousel-in-list.C'];

const pathOf = (record: string) => (record.startsWith('/') ? record : `docs/truth/live-records/${record}`);

/**
 * `live.ts --rejudge <record> --groups <groups>`, in process (scripts/truth/live-cases.ts#rejudge — the CLI's own
 * path, a thin wrapper over it): the exit code and what it prints. A node+tsx process a record cost the suite ~45 s of
 * one worker (T1); the CLI itself is pinned once below, against this.
 */
async function rejudgeInProcess(record: string, groups: string): Promise<{ code: number; out: string }> {
  const file = pathOf(record);
  const recorded = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as RunRecord;
  const { lines, exitCode } = await rejudgeRecord(recorded, file, { groups: groups.split(',') });
  return { code: exitCode, out: `${lines.join('\n')}\n` };
}

/** The CLI itself, spawned: `node --import tsx scripts/truth/live.ts --rejudge <record> --groups <groups>`. */
const rejudgeCli = (record: string, groups: string) => rejudgeCliWith(record, groups, []);
/** The same, with more flags after it. */
const rejudgeCliWith = (record: string, groups: string, more: readonly string[]) => rejudgeCliArgs(['--rejudge', pathOf(record), '--groups', groups, ...more]);
/** live.ts spawned with these flags: its exit code, and what it printed (stdout, then stderr when it failed). */
async function rejudgeCliArgs(args: readonly string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', 'scripts/truth/live.ts', ...args], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('live.ts --rejudge, the CLI: argv in, the summary on stdout, the exit code', () => {
  it.each([
    ['ios-wda-long-list-parked-2.json', 'visibility', 0],
    ['ios-forms-r8-l2-before.json', 'forms', 1],
  ] as const)('%s (--groups %s): exit %i, printing exactly what rejudge() returns', { timeout: 60_000 }, async (record, groups, code) => {
    const cli = await rejudgeCli(record, groups);
    expect(cli).toEqual(await rejudgeInProcess(record, groups));
    expect(cli.code).toBe(code);
    expect(cli.out.split('\n')[0]).toMatch(/^<!-- averi: .+ \(rejudged from docs\/truth\/live-records\/.+\.json\) -->$/);
    expect(cli.out).toContain(`(rejudged from docs/truth/live-records/${record})`);
  });
});

// live-cases.ts#judged: a forms case not ok is read again 3 s later (`late`) — a model that catches up was the app's lag.
describe('live.ts --rejudge --failures <file>: the summary\'s failure reasons as data beside it (A21, rejudge-failures.ts#failuresJson)', () => {
  it.each([
    ['ios-wda-long-list-parked-2.json', 'visibility'],
    ['ios-forms-r8-l2-before.json', 'forms'],
  ] as const)('%s (--groups %s): the reasons rejudge() returns, written as JSON; one a reason exactly when the exit is 1', { timeout: 60_000 }, async (record, groups) => {
    const dir = await mkdtemp(join(tmpdir(), 'live-failures-'));
    try {
      const file = join(dir, 'r.rejudge.json');
      const cli = await rejudgeCliWith(record, groups, ['--failures', file]);
      const recorded = JSON.parse(readFileSync(resolve(ROOT, pathOf(record)), 'utf8')) as RunRecord;
      const own = await rejudgeRecord(recorded, pathOf(record), { groups: groups.split(',') });
      expect(readFileSync(file, 'utf8')).toBe(failuresJson(own.failures));
      expect(failuresOf(readFileSync(file, 'utf8'))!.length > 0).toBe(cli.code === 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refused without --rejudge: only a rejudge writes its reasons', { timeout: 60_000 }, async () => {
    const cli = await rejudgeCliArgs(['--serial', 'x', '--failures', '/nonexistent/f.json']);
    expect(cli.code).not.toBe(0);
    expect(cli.out).toContain('--failures: only a rejudge writes its failure reasons; pass --rejudge <record>');
  });
});

describe('judged — the first read, and the late one 3 s after it', () => {
  const read = (focus: string): LabState => ({ cell: 'form-basic', ready: true, screen: { x: 0, y: 0, width: 402, height: 874 }, scale: 3, frames: {}, events: [], focus });
  /** A case whose verdict is read off the focus each read holds — each its own outcome, rule and kind of reply. */
  const VERDICTS: Record<string, LiveVerdict> = {
    name: { outcome: 'ok', why: 'the focus on name' },
    phone: { outcome: 'LOUD', why: 'the focus on phone', cls: 'loud-untouched', kind: 'refused' },
    note: { outcome: 'LOUD', why: 'the focus on note', cls: 'loud-changed', kind: 'other' },
    email: { outcome: 'MISMATCH', why: 'the focus on email', cls: 'tap-claim', kind: 'Tapped' },
  };
  const c: Case = { id: 'x1', group: 'forms', cell: 'form-basic', says: 'a synthesized case', calls: [], judge: (s) => VERDICTS[s.focus!] };
  const judge = (state: string, late?: string) => judged(c, { source: 'idb', replies: [], launched: read('name'), after: [], state: read(state), late: late === undefined ? undefined : read(late) });

  it('a recorded late read is judged whatever the case declares now: a record is what was read then', () => {
    const declared: Case = { ...c, reads: { late: false } };
    expect(judged(declared, { source: 'idb', replies: [], launched: read('name'), after: [], state: read('phone'), late: read('name') }).outcome).toBe('ok');
  });

  it('no late read: the first verdict', () => {
    expect(judge('phone')).toEqual(VERDICTS.phone);
  });

  it('an ok first read is never read again, whatever the late one says', () => {
    expect(judge('name', 'email')).toEqual(VERDICTS.name);
  });

  it('a late read with the same outcome: the first verdict kept whole — its why, rule and kind, not the late one\'s', () => {
    expect(judge('phone', 'note')).toEqual(VERDICTS.phone);
  });

  it('a late read with another outcome: the late verdict, its why saying so and quoting the first', () => {
    expect(judge('email', 'name')).toEqual({ outcome: 'ok', why: 'the focus on name (only 3 s later; first read: the focus on email)' });
    expect(judge('email', 'phone')).toEqual({ ...VERDICTS.phone, why: 'the focus on phone (only 3 s later; first read: the focus on email)' });
  });
});

/**
 * A pre-D43a Android b1d or b7 line: the LOUD `input text` left (a prefix typed, then exit 255), NOT known against the
 * entry D43a pins — averi refuses the value before the focus tap since (docs/adr/0037-a-value-the-adapter-cannot-type-
 * is-refused-before-any-device-call.md), the field untouched. Every Android forms record committed before D43a reads it.
 */
const PRE_D43A_LOUD = /^- LOUD \(loud-changed\) (b1d|b7) .*\[NOT known: loud-changed on refused, where KNOWN pins loud-untouched on refused \(bug:2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii\.md\)\]$/gm;

/**
 * A pre-D43 WDA b1d or b7 line: refused before anything was sent (`loud-untouched`), a LOUD no KNOWN entry holds since
 * D43 (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md, the D43 amendment) — WDA types
 * them through `/wda/keys`, ok expected. Unmarked: under idb the same lines stay `[known: …]`, so only WDA's match.
 * Every forms record with a WDA leg committed before D43 reads them.
 */
const PRE_D43_WDA_LOUD = /^- LOUD \(loud-untouched\) (b1d|b7) (?!.*\[known).*$/gm;

/**
 * A pre-D72 Android g2: the reply of an averi whose dump parser trimmed the eager trailing space (`SK31 1200 0000 ` read
 * `SK31 1200 0000`), so g2 came out ok — known since D72, which reads the space and refuses it `separated` as iOS does
 * (ADR 0034 residual 10, the D72 amendment). Rejudged by HEAD's ratchet, the record says g2 is known but ok, FIXED: those
 * two lines, exactly, and the exit 1 that fixed sets. Every Android forms record with g2 committed before D72 reads them.
 */
const PRE_D72_G2 = /^(Known but ok this run|FIXED, not intermittent — strike off live-known\.ts): uiautomator g2$/gm;

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
    ['ios-forms-r7-lab-1.json', 'forms', { cases: 46, ok: 38, loud: 8, mismatches: 0, preD43Wda: true }],
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
    ['ios-wda-forms-r23-ios-stop.json', 'forms', { cases: 23, ok: 18, loud: 5, mismatches: 0, preD43Wda: true }],
    ['ios-wda-forms-r23.json', 'forms', { cases: 23, ok: 18, loud: 5, mismatches: 0, preD43Wda: true }],
    // …the visibility cells whose replayed first stroke the unmeasured carry cuts, at both srcs: 16 of 16 ok
    ['ios-wda-cut-cells-r23-ios-stop.json', 'visibility', { cases: 16, ok: 16, loud: 0, mismatches: 0 }],
    ['ios-wda-cut-cells-r23.json', 'visibility', { cases: 16, ok: 16, loud: 0, mismatches: 0 }],
    // round 7's A4 (src arch/r23-keyboard through --side; docs/truth/live-ios-2026-10-18-keyboard-fallbacks.md): k1–k3
    // under WDA, three runs (k2 and k3 LOUD before the fallback drag), all ok; the dismissal group 24 of 24, no submit
    ['ios-keyboard-fallbacks-k-run1.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-k-run2.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-k-run3.json', 'forms', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-keyboard-fallbacks-dismissal.json', 'dismissal', { cases: 24, ok: 24, loud: 0, mismatches: 0 }],
    // #7's live calibration (a --side run of d928789, before its fix): toolbar-dismiss's and toolbar-dismiss-short's taps
    // under WDA's keyboard, keyboardDismiss on the title — ks, ss and note tapped on the tall cell; vs timed out never
    // holding still, and the short cell's four refused under the keyboard: LOUD, no claim, no mismatch.
    ['cal7-d928789-1.json', 'dismissal', { cases: 8, ok: 3, loud: 5, mismatches: 0 }],
    // round 7's A9 (src arch/r23-fill-tail through --side; docs/truth/live-rn-2026-10-19.md): the RN forms group under
    // idb and WDA, five runs — every single-line fill whole; rn4 (the label tap under WDA) LOUD, LR1's at that src;
    // run 4's rn1 LOUD (the wait for N's field timed out after launch, nothing typed)
    ['ios-rn-forms-a9-1.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-2.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-3.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    ['ios-rn-forms-a9-4.json', 'forms', { cases: 12, ok: 10, loud: 2, mismatches: 0 }],
    ['ios-rn-forms-a9-5.json', 'forms', { cases: 12, ok: 11, loud: 1, mismatches: 0 }],
    // …and the native forms group at the same src: unchanged (b1d, b7, p5 and k2/k3 under WDA LOUD as before A4)
    ['ios-forms-a9.json', 'forms', { cases: 46, ok: 38, loud: 8, mismatches: 0, preD43Wda: true }],
    // round 7's A5 (src arch/r23-idb-sheet through --side; docs/truth/live-ios-2026-10-18-visibility.md): idb's
    // presented layer — sheet-medium's and sheet-background's cells twice: sheet-medium's A–D stopped before any swipe,
    // ok; sheet-background's A and B LOUD, the changed stop (the stroke dismissed the large sheet, averi said the swipe
    // changed the screen and claimed nothing), C and D two strokes on the layer, residual 6's
    // (…and the whole visibility group under idb once, ios-idb-vis-a5.json: below, before L4's fix)
    // round 7's A6 (src arch/r23-eyes through --side; docs/truth/live-android-2026-10-18-visibility.md): k7 with the
    // eyes — "visible after 1 swipe — PARTLY UNDER a surface the tree does not list: its bottom 28 px …", the band
    // named, ok — three runs, once more after its review round 1; and the forms group once (b1d, b7 LOUD: adb's input
    // text has no non-ASCII)
    ['android-k7-eyes-1.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-2.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-3.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-k7-eyes-r1.json', 'forms', { cases: 1, ok: 1, loud: 0, mismatches: 0 }],
    ['android-forms-eyes.json', 'forms', { cases: 25, ok: 23, loud: 2, mismatches: 0, preD43a: true }],
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
    ['ios-wda-forms-r7final.json', 'forms', { cases: 23, ok: 20, loud: 3, mismatches: 0, preD43Wda: true }],
    ['ios-rn-wda-r7final-1.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-wda-r7final-2.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-wda-r7final-3.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-rn-idb-r7final.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-1.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-2.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-long-list-r7final-3.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['android-forms-r7final.json', 'forms', { cases: 25, ok: 23, loud: 2, mismatches: 0, preD43a: true }],
    ['android-rn-r7final-1.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['android-rn-r7final-2.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    ['android-rn-r7final-3.json', 'forms,visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    // round 8's L2 fix (fix/r8-l2; docs/truth/live-ios-2026-10-18-visibility.md, its round-8 section): k6 and k7, opened
    // to iOS, under idb and WDA three times — no submit; idb's k6 refused under Continue in runs 2 and 3 (run 1: idb's
    // describe-all failed, no frontmost application, so no tree — the wait timed out, nothing fired: vacuous for the
    // fix), k7 one stroke to phone clear of the bar
    ['ios-forms-r8-l2-1.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['ios-forms-r8-l2-2.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['ios-forms-r8-l2-3.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    // Round 14's fix of LE1 (bugs/r14-le1, the drawn frame on Android): its six cases ok — S's and C's taps refused
    // outside their scroll view, P and S stroked inside upper/lower, C stroked sideways inside the carousel (824,497).
    ['android-vis-r14-le1.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    // (round 14's LE2 fix, ios-idb-vis-r14-le2-1.json and -2.json: below, before A38b's band stroke)
    // Round 16's LE2 rest (bugs/r16-le2: a control past the reading-order break that holds the target's centre is an untold cover):
    // scroll-bounded-footer's O under idb — the tap moved clear of Continue to (201,670), nothing fired (at the base it
    // fired button footer.continue), the plain stop refused before any swipe; the tap case and the scroll case's own tap
    // after that refusal both Tapped on the background, known (residual 5) — and under WDA refused / stopped inside `lower`
    // after 2 swipes, Tapped.
    ['ios-vis-r16-le2-1.json', 'visibility', { cases: 4, ok: 2, loud: 0, mismatches: 2 }],
    // Its code review (round 16): the same two cases at the final src, and mp-native's chooser rebuilt (chooser-over-list) —
    // under idb S refused, nothing fired (LOUD: the eyes cannot tell it over R on the real screenshot, white on white), O
    // Tapped, R refused; under WDA O and S Tapped, R refused, its stop stroking the dim (#31) — pinned below since the
    // merge struck that stroke off.
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
    // Round 16's in-window backdrop (bugs/r16-blur 7fd1ee57, ADR 0018 residual 9): WDA's three grouped blur menus
    // (blur-menu-grouped, -stacked, -unhidden) twice — A, B, C, D each tap refused "close it first", nothing fired, each
    // scroll_until stopped before any swipe, nothing stroked or dismissed; K and W Tapped, each alone fired.
    ['ios-vis-r16-blur-1.json', 'visibility', { cases: 30, ok: 30, loud: 0, mismatches: 0 }],
    ['ios-vis-r16-blur-2.json', 'visibility', { cases: 30, ok: 30, loud: 0, mismatches: 0 }],
    // Round 16's merge (bugs/round-16 4f48c642: LE2's rest beside the in-window backdrop): chooser-over-list,
    // scroll-bounded-footer and the three grouped blur menus under idb and WDA, twice — under WDA chooser-over-list's R
    // refused under S, "close it first", its scroll_until stopped before any swipe, nothing stroked or dismissed (LE2's
    // branch alone stroked the dim three times); the blur menus as bugs/r16-blur's records; under idb the menus' A, B, D
    // Tapped, the menu dismissed (residual 9, known), S refused (LOUD), footer O as LE2's records.
    ['ios-vis-r16-merge-1.json', 'visibility', { cases: 72, ok: 51, loud: 1, mismatches: 20 }],
    ['ios-vis-r16-merge-2.json', 'visibility', { cases: 72, ok: 51, loud: 1, mismatches: 20 }],
    // Round 16's feeler (bugs/r16-r6, ADR 0018 "idb's presented layer" Decision 3), idb: sheet-background, alert-dim,
    // dim-cover and the content-up cells (scroll-top-edge, tabbar-dense, tabbar-floating, carousel-in-list), twice —
    // sheet-background's A and B two feelers from (201,175), nothing dismissed, the unmoved stop with "idb lists only
    // what a presented sheet, alert or cover leaves" (presented-stroke, residual 6, known); every other case as before.
    // (ios-vis-r16-r6-1.json and -2.json: below, before A38b's band stroke)
    // …and sheet-background's A and B alone, three runs, the feeler's measurement at the values chosen (160 pt, 600 ms)
    ['ios-idb-sheet-r16-r6-1.json', 'visibility', { cases: 2, ok: 0, loud: 0, mismatches: 2 }],
    ['ios-idb-sheet-r16-r6-2.json', 'visibility', { cases: 2, ok: 0, loud: 0, mismatches: 2 }],
    ['ios-idb-sheet-r16-r6-3.json', 'visibility', { cases: 2, ok: 0, loud: 0, mismatches: 2 }],
    // NI1's fix (ADR 0018 "an idb read that lists no identifier"): sheet-long-list and
    // sheet-long-list-short under idb — R's taps refused, nothing fired, the reply naming idb's limit (ok: a target its
    // source does not list is not asked to fire); F, L and short F not reached, LOUD, ADR 0018 residual 20 — and the
    // same cells under WDA as a control, every case ok (R Tapped).
    ['ios-vis-r1023-ni1-1.json', 'visibility', { cases: 8, ok: 5, loud: 3, mismatches: 0 }],
    ['ios-vis-r1023-ni1-wda-1.json', 'visibility', { cases: 9, ok: 9, loud: 0, mismatches: 0 }],
    // Round 1023's phone-after-back fix (bugs/r1023-phone, ADR 0026): k7f — after back, phone fully visible after 0 swipes,
    // the next title over its touch margin seen clear on one screenshot — and k7 unchanged; then the whole forms group.
    ['android-forms-r1023-phone-1.json', 'forms', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    ['android-forms-r1023-phone-2.json', 'forms', { cases: 29, ok: 27, loud: 2, mismatches: 0, preD43a: true }],
    // The same two at the branch's tip (the strict beside rows, one kept answer per text, the code review's renames).
    ['android-forms-r1023-phone-3.json', 'forms', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    // Round 1023's LV2 fix (bugs/r1023-lv2, ADR 0013 refined 2026-10-23): scroll-bounded-flush five times — S.fully
    // fully visible after 2 swipes, a probe then a reveal (pinned below), P.fully after 1 — then the visibility group once.
    ['android-vis-r1023-lv2-1.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    ['android-vis-r1023-lv2-2.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    ['android-vis-r1023-lv2-3.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    ['android-vis-r1023-lv2-4.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    ['android-vis-r1023-lv2-5.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    // The cell twice more with the proof kept (`ProvenCut`, a path S never takes): the same.
    ['android-vis-r1023-lv2-6.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    ['android-vis-r1023-lv2-7.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],
    // FU1's fix (docs/truth/live-android-2026-10-23-floating-gap.md): form-keyboard-floating under a hand-floated
    // Gboard, three runs — the panel quoted over ks first, the submit in the gap visible with no stroke and tapped once,
    // ks under the panel never visible. Since D67 the kf judges rest on the panel the IME's region names at launch
    // (live-forms.ts#measuredPanel), which these runs did not read: all three SKIP "no measured panel" (the replies
    // judged against that day's region in tests/truth/live-forms.test.ts, ok there).
    ['android-forms-r1023b-fu1-cr-1.json', 'forms', { cases: 3, ok: 0, loud: 0, mismatches: 0, skipped: 3 }],
    ['android-forms-r1023b-fu1-cr-2.json', 'forms', { cases: 3, ok: 0, loud: 0, mismatches: 0, skipped: 3 }],
    ['android-forms-r1023b-fu1-cr-3.json', 'forms', { cases: 3, ok: 0, loud: 0, mismatches: 0, skipped: 3 }],
    ['android-vis-r1023b-r19-1.json', 'visibility', { cases: 39, ok: 39, loud: 0, mismatches: 0 }],
    ['android-vis-r1023b-r19-2.json', 'visibility', { cases: 39, ok: 39, loud: 0, mismatches: 0 }],
    ['android-vis-r1023b-r19-3.json', 'visibility', { cases: 39, ok: 39, loud: 0, mismatches: 0 }],
    ['android-forms-r1023b-r19-1.json', 'forms', { cases: 32, ok: 27, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    ['android-forms-r1023b-r19-2.json', 'forms', { cases: 32, ok: 27, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    ['android-forms-r1023b-r19-3.json', 'forms', { cases: 32, ok: 27, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    // …and once more where form-picker's taps and its not-founds say the sheet's own list first.
    ['android-vis-r1023b-r19-cr-1.json', 'visibility', { cases: 39, ok: 39, loud: 0, mismatches: 0 }],
    ['android-forms-r1023b-r19-cr-1.json', 'forms', { cases: 32, ok: 27, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    // …and where the sheet's own list is said in the shorter words ("scroll_until it in that window's own list first").
    ['android-vis-r1023b-r19-cr-2.json', 'visibility', { cases: 39, ok: 39, loud: 0, mismatches: 0 }],
    ['android-forms-r1023b-r19-cr-2.json', 'forms', { cases: 32, ok: 27, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    // Row 19's fix (bugs/r1023b-row19, ADR 0026 rule 8): k7 and k7f, the clear path, as before.
    ['android-forms-r1023b-row19-1.json', 'forms', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    // Round 9 (2026-10-25)'s rebound and tree-within-a-point fix (ADR 0021 decision 6): absent:scroll-top-edge-end under
    // idb and WDA, twice — each "failed after 2 swipes (the last 2 … did not change the screen)", nothing fired, the app's
    // page unmoved at 382.
    ['ios-vis-r9-absent-1.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    ['ios-vis-r9-absent-2.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    // …and once more after the review's fixes (the settled read a confirming read; the tree within a point where strokes fling).
    ['ios-vis-r9-absent-3.json', 'visibility', { cases: 2, ok: 2, loud: 0, mismatches: 0 }],
    // Round 9's LR3 fix (fix/r9-lr3, ADR 0015's amendment of 2026-10-25): the react-native app's rn-banner twice — under
    // WDA T, U and C refused, nothing fired; under idb each Tapped with nothing fired (ADR 0015 residual 4, known) — and
    // its rn-field visibility and forms groups, unchanged, every case ok.
    ['ios-rn-banner-lr3-1.json', 'visibility', { cases: 6, ok: 3, loud: 0, mismatches: 3 }],
    ['ios-rn-banner-lr3-2.json', 'visibility', { cases: 6, ok: 3, loud: 0, mismatches: 3 }],
    ['ios-rn-field-lr3.json', 'visibility', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-rn-forms-lr3.json', 'forms', { cases: 12, ok: 12, loud: 0, mismatches: 0 }],
    // …and after the review's fixes (only a field's own label excused, a narrower cover still one): rn-banner and rn-field
    // together, the RN forms group again — the same.
    ['ios-rn-vis-lr3-3.json', 'visibility', { cases: 12, ok: 9, loud: 0, mismatches: 3 }],
    ['ios-rn-forms-lr3-2.json', 'forms', { cases: 12, ok: 12, loud: 0, mismatches: 0 }],
    // D40's device run at 40ba3dd1: the forms groups, every case not ok known (D31) —
    // iOS b1d and b7 under both sources (idb ui text refuses non-ASCII, the field untouched), p5 (the secure field
    // cleared when typing resumed, averi says so); the RN app's rf4 under both (a blind `type:` dropped the tail);
    // Android b1d and b7 (input text typed a prefix, then exit 255: LOUD, NOT known since D43a — pinned below) and
    // kf1–kf3 skipped (Gboard docked).
    ['ios-forms-d40-1.json', 'forms', { cases: 68, ok: 62, loud: 6, mismatches: 0, preD43Wda: true }],
    ['ios-rn-forms-d40-1.json', 'forms', { cases: 10, ok: 8, loud: 2, mismatches: 0 }],
    ['android-forms-d40-1.json', 'forms', { cases: 42, ok: 37, loud: 2, mismatches: 0, skipped: 3, preD43a: true }],
    // D43a's device run at 0262c69d (2026-11-02, ADR 0037's amendment): b1d, b7 and p7 under iOS idb, iOS wda and
    // Android — b1d and b7 refused before anything was sent (loud-untouched, known; under WDA known no more since D43,
    // preD43Wda), p7 refused with the prefill kept; b2, b3, p1, p2 ok.
    ['ios-idb-forms-d43a-1.json', 'forms', { cases: 7, ok: 5, loud: 2, mismatches: 0 }],
    ['ios-wda-forms-d43a-1.json', 'forms', { cases: 7, ok: 5, loud: 2, mismatches: 0, preD43Wda: true }],
    ['android-forms-d43a-1.json', 'forms', { cases: 7, ok: 5, loud: 2, mismatches: 0 }],
    // batch-3's device run at 6b4a44df (2026-11-02). Block G, the ensure group (D30: D2's held "no" on a device; its
    // cases are not in the default groups — `--groups ensure`): h1–h3 ok under WDA and uiautomator. (Under idb h2 was
    // held-early — the src before D50's fix, below.)
    ['ios-wda-ensure-d30-1.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['android-ensure-d30-1.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    // batch-4's device run at 7e6d2d47 (2026-11-02), the device run at the fixes, all ok. D50 (ADR 0033's D50
    // amendment): h1–h3 under idb, h2 held on Welcome itself, not on the spinner. D51 (ADR 0034's D51 amendment):
    // f11–f14 under idb, WDA and uiautomator, f11's dotted date passing as a digit grouping.
    ['ios-idb-ensure-d50-1.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-idb-forms-d51-1.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['ios-wda-forms-d51-1.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    ['android-forms-d51-1.json', 'forms', { cases: 4, ok: 4, loud: 0, mismatches: 0 }],
    // batch-2's uptime block (2026-11-02, main 39c1fcda; D37): the fills of the forms group at 15.2 h of emulator uptime,
    // 10 of 10 ok.
    ['android-forms-d37-uptime-1.json', 'forms', { cases: 10, ok: 10, loud: 0, mismatches: 0 }],
    // batch-9's device run at e734fedf (2026-11-03), L7's first read. The forms group's f1–f14 and g1–g5: every case ok
    // under uiautomator, g2 included (the reading judged there had no trailing space — trimmed, PRE_D72_G2); under WDA g2 the D53 `separated`
    // MISMATCH, known (ADR 0034 residual 10). (Under idb g3 too — the src before D61's fix, below.)
    ['android-forms-l7-1.json', 'forms', { cases: 19, ok: 19, loud: 0, mismatches: 0, preD72: true }],
    ['ios-wda-forms-l7-1.json', 'forms', { cases: 18, ok: 17, loud: 0, mismatches: 1 }],
    // …the RN app's rf1–rf5 and rfe1–rfe3 once, then rfe1–rfe3 four times more, under idb and WDA (D60's live proof):
    // rfe1 and rfe2 ok 20 of 20, 5 of them through the retype from the eager mark; rfe3 the D53 `separated` MISMATCH,
    // known, ×10; rf4 under idb LOUD, known (ADR 0034 residual 2).
    ['ios-rn-idb-forms-l7-1.json', 'forms', { cases: 8, ok: 6, loud: 1, mismatches: 1 }],
    ['ios-rn-idb-forms-l7-2.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-idb-forms-l7-3.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-idb-forms-l7-4.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-idb-forms-l7-5.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-wda-forms-l7-1.json', 'forms', { cases: 8, ok: 7, loud: 0, mismatches: 1 }],
    ['ios-rn-wda-forms-l7-2.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-wda-forms-l7-3.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-wda-forms-l7-4.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    ['ios-rn-wda-forms-l7-5.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
    // …and the ensure group twice under each source (D30's repeat of the calibration), h1–h3 ok in all six.
    ['android-ensure-d30-2.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['android-ensure-d30-3.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-idb-ensure-d30-2.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-idb-ensure-d30-3.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-wda-ensure-d30-2.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    ['ios-wda-ensure-d30-3.json', 'ensure', { cases: 3, ok: 3, loud: 0, mismatches: 0 }],
    // batch-10's device run at 139256a2 (2026-11-03): D61, D63 and D64 proven. g3, g4, g5, f13, f15 and f16 twice under
    // each source, every case ok; then the whole forms group once — under idb and WDA g2 the D53 `separated` MISMATCH,
    // known, b1d, b7 and p5 LOUD (under WDA b1d and b7 known no more since D43, preD43Wda); under uiautomator g2 ok, b1d
    // and b7 refused before the tap (known), kf1–kf3 skipped (Gboard docked).
    ['android-forms-d61-1.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['android-forms-d61-2.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-idb-forms-d61-1.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-idb-forms-d61-2.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-forms-d61-1.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['ios-wda-forms-d61-2.json', 'forms', { cases: 6, ok: 6, loud: 0, mismatches: 0 }],
    ['android-forms-d61-whole.json', 'forms', { cases: 54, ok: 49, loud: 2, mismatches: 0, skipped: 3, preD72: true }],
    ['ios-idb-forms-d61-whole.json', 'forms', { cases: 46, ok: 42, loud: 3, mismatches: 1 }],
    ['ios-wda-forms-d61-whole.json', 'forms', { cases: 46, ok: 42, loud: 3, mismatches: 1, preD43Wda: true }],
    // T7a's live check at 75774dfd (2026-11-05): the carousel group three times on the AVD, every case ok — never "fully
    // visible" with C cut, D62's retry seen on the drop leg (the dropped reveal sent again, 0 px off), D37's pager read
    // at rest on C; hedged 1, 0 and 1 of 3 unaimable legs (lv-d59b-recycler, accepted under ADR 0021's D68 residual).
    ['android-carousel-t7a-1.json', 'carousel', { cases: 8, ok: 8, loud: 0, mismatches: 0 }],
    ['android-carousel-t7a-2.json', 'carousel', { cases: 8, ok: 8, loud: 0, mismatches: 0 }],
    ['android-carousel-t7a-3.json', 'carousel', { cases: 8, ok: 8, loud: 0, mismatches: 0 }],
    // D72's device run (2026-11-09, fix/d72-android-outer-spaces at 5bf59f85 plus os1/os2): the whole forms group, os1
    // and os2 (`Jan `, with and without clear) ok, fp2's ⚠ line saying 5, g2 the residual-10 MISMATCH, known since D72;
    // b1d, b7 LOUD, known. The RN app's rfe1–rfe3: rfe3 the same MISMATCH, known since D72 (first read on Android).
    ['d72-outer-spaces/android-forms-d72-fix.json', 'forms', { cases: 58, ok: 55, loud: 2, mismatches: 1 }],
    ['d72-outer-spaces/android-rn-forms-d72-fix.json', 'forms', { cases: 3, ok: 2, loud: 0, mismatches: 1 }],
  ])('%s (--groups %s): every case not ok known, the counts as recorded', { timeout: 60_000 }, async (record, groups, want) => {
    const { code, out } = await rejudgeInProcess(record, groups);
    const header = /^# Live golden: (\d+) cases, (\d+) ok, (\d+) loud, (\d+) mismatches \((\d+) not known\), (\d+) skipped$/m.exec(out);
    expect(header, out.slice(0, 2000)).not.toBeNull();
    const [, cases, ok, loud, mismatches, notKnown, skipped] = header!.map(Number);
    const { preD43a, preD43Wda, preD72, ...counts } = want as typeof want & { preD43a?: true; preD43Wda?: true; preD72?: true };
    expect({ cases, ok, loud, mismatches, notKnown, skipped }).toEqual({ notKnown: 0, skipped: 0, ...counts });
    // An Android forms record from before D43a: b1d and b7 read as `input text` left them (a prefix typed, then exit
    // 255 — loud-changed), NOT known against the entry D43a pins (loud-untouched: refused before the tap). Those two
    // lines, exactly, and nothing else not known; a LOUD fails no run, so the exit stays 0.
    const stale = [...out.matchAll(PRE_D43A_LOUD)].map((m) => m[1]);
    expect(stale.sort()).toEqual(preD43a ? ['b1d', 'b7'] : []);
    // A pre-D72 Android g2 (PRE_D72_G2): ok then, known since — the known-but-ok and FIXED lines, exactly, and exit 1.
    expect([...out.matchAll(PRE_D72_G2)].map((m) => m[1])).toEqual(preD72 ? ['Known but ok this run', 'FIXED, not intermittent — strike off live-known.ts'] : []);
    expect(out.replace(PRE_D43A_LOUD, '').replace(PRE_D72_G2, '')).not.toMatch(/NOT known|FIXED, not intermittent/);
    // A forms record with a WDA leg from before D43: b1d and b7 refused before anything was sent, a LOUD known no more
    // (WDA types them since) — those two lines, exactly, unmarked; a LOUD fails no run.
    expect([...out.matchAll(PRE_D43_WDA_LOUD)].map((m) => m[1]).sort()).toEqual(preD43Wda ? ['b1d', 'b7'] : []);
    expect(code, out.slice(-2000)).toBe(preD72 ? 1 : 0);
  });
});

describe('T15: the hedged stops of a visibility run, counted in its summary', () => {
  // T11's final A/B (t11-carousel-visible/final-ab, docs/truth/live-records/t11-carousel-visible): the fix's visibility
  // run held one stop hedged, scroll-sticky-cut.R.fully (`held`, its pre-T17 lead), with the target whole — ok, so before
  // T15 nothing in the summary said so; the base's held none. 32 of the 153 cases stop on their target in each.
  const FINAL_AB = 't11-carousel-visible/final-ab';
  const hedgedLines = (out: string) => out.split('\n').filter((l) => l.startsWith('Hedged stops: '));
  it('harm-visibility-fix-1.json: 1 of 32, held, its case marked', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess(`${FINAL_AB}/harm-visibility-fix-1.json`, 'visibility');
    expect(hedgedLines(out)).toEqual(['Hedged stops: 1 of 32 visible stops (target whole, ok: 1 — held 1; cut, LOUD: 0): uiautomator scroll:scroll-sticky-cut.R.fully']);
    const marked = out.split('\n').filter((l) => l.includes(' (hedged: '));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatch(/^- ok scroll:scroll-sticky-cut\.R\.fully .* \(hedged: held\)$/);
    expect(code).toBe(0);
  });
  it.each(['harm-visibility-base-1.json', 'harm-visibility-base-2.json'])('%s: 0 of 32 — the line printed, every bucket 0', { timeout: 60_000 }, async (record) => {
    const { out } = await rejudgeInProcess(`${FINAL_AB}/${record}`, 'visibility');
    expect(hedgedLines(out)).toEqual(['Hedged stops: 0 of 32 visible stops (target whole, ok: 0; cut, LOUD: 0)']);
    expect(out).not.toContain(' (hedged: ');
  });
  // Only the visibility group is counted: another group's stop is judged by its own rules, not judgeScroll's.
  it('a carousel run with a hedge (two-fix-1, lv-d62-drop-two hedged with C cut): no line, no mark', { timeout: 60_000 }, async () => {
    const { out } = await rejudgeInProcess(`${FINAL_AB}/two-fix-1.json`, 'carousel');
    expect(out).toMatch(/^- \S+ (?:\(\S+\) )?lv-d62-drop-two /m);
    // Its reply a hedged stop (the pre-T17 lead), which the visibility group would count.
    const recorded = JSON.parse(readFileSync(resolve(ROOT, pathOf(`${FINAL_AB}/two-fix-1.json`)), 'utf8')) as RunRecord;
    expect(recorded.results.flatMap((r) => r.replies).filter((x) => hedgedLead(x)?.preT17 === true)).toHaveLength(1);
    expect(hedgedLines(out)).toEqual([]);
    expect(out).not.toContain(' (hedged: ');
  });
  it('a forms run with a scroll stop (android-forms-d40-1): no line, its summary as before T15', { timeout: 60_000 }, async () => {
    const { out } = await rejudgeInProcess('android-forms-d40-1.json', 'forms');
    expect(out).toMatch(/visible (?:by the tree )?after \d+ swipes?/);
    expect(hedgedLines(out)).toEqual([]);
  });
});

describe('the flush probe\'s live records on a deep cut: a probe, then one reveal', () => {
  // docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md: S
  // (176 px, 154 of it below `lower`'s clip at rest) whole after the probe and one reveal of at most half the room above
  // it — the list never carried past the clip's top (S's top stays inside 1046–1541), and the tap fires S.
  it.each([1, 2, 3, 4, 5, 6, 7])('android-vis-r1023-lv2-%i.json: S.fully a probe of ~60 px, then a reveal that leaves S whole', (n) => {
    const record = JSON.parse(readFileSync(new URL(`../../docs/truth/live-records/android-vis-r1023-lv2-${n}.json`, import.meta.url), 'utf8')) as {
      results: { id: string; replies: string[]; state: { strokes: { view: string; from: number; to: number }[]; frames: Record<string, { y: number; height: number }> } }[];
    };
    const s = record.results.find((c) => c.id === 'scroll:scroll-bounded-flush.S.fully')!;
    expect(s.replies).toEqual(['Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes', 'Tapped id:"lab.scroll-bounded-flush.S"']);
    const [probe, reveal] = s.state.strokes;
    expect(s.state.strokes).toHaveLength(2);
    expect(probe).toMatchObject({ view: 'lower', from: 0 });
    expect(probe.to).toBeGreaterThanOrEqual(50);
    expect(probe.to).toBeLessThan(154);
    expect(reveal).toMatchObject({ view: 'lower', from: probe.to });
    expect(reveal.to).toBeGreaterThanOrEqual(154);
    const S = s.state.frames.S;
    expect(S.y).toBeGreaterThanOrEqual(1046);
    expect(S.y + S.height).toBeLessThanOrEqual(1541);
  });
});

/**
 * sheet-background's A and B under idb as they read before round 16's feeler (bugs/r16-r6, ADR 0018 "idb's presented
 * layer" Decision 3): the full stroke from (201,175) dismissed the large sheet and averi said the swipe changed the
 * screen (`presented-changed`, LOUD) — known so as residual 6's cost from round 7's A5 until the feeler, since which the
 * sheet springs back and the stop is the unmoved one (`presented-stroke`): a record before it reads not known.
 */
const R6_IDB = ['scroll:sheet-background.A', 'scroll:sheet-background.B'];

describe('live.ts --rejudge over the committed iOS records of the src before the feeler', () => {
  // In these records, each an older src's, A's and B's stroke dismissed the sheet and averi said so — LOUD, which
  // counts as no mismatch, so the run exits 0 as recorded; but HEAD's KNOWN pins them as the feeler's unmoved stop
  // (`presented-stroke` on `not found`), so each LOUD line is marked NOT known — a calibration of that src now, not
  // HEAD's. Everything else as HEAD knows it.
  it.each([
    ['ios-idb-sheet-a5-1.json', 'visibility', { cases: 18, ok: 14, loud: 2, mismatches: 2 }, []],
    ['ios-idb-sheet-a5-2.json', 'visibility', { cases: 18, ok: 14, loud: 2, mismatches: 2 }, []],
    ['ios-vis-r9-final-sanity.json', 'visibility', { cases: 78, ok: 66, loud: 2, mismatches: 10 }, []],
    // …and carousel-in-list's C under idb, from before A38b's band stroke (A38B_IDB): not known, exit 1
    ['ios-vis-r14-lv3.json', 'visibility', { cases: 149, ok: 113, loud: 5, mismatches: 31 }, A38B_IDB],
  ] as const)('%s (--groups %s): sheet-background\'s A and B LOUD, marked not known; everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want, unknownIds) => {
    const { code, out } = await rejudgeInProcess(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${unknownIds.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...unknownIds].sort());
    const marked = [...out.matchAll(/^- (?:MISMATCH|LOUD) (?:\([A-Za-z-]+\) )?(\S+) .*\[NOT known: presented-changed on refused, where KNOWN pins presented-stroke on not found .*$/gm)].map((m) => m[1]);
    expect(marked.sort()).toEqual([...R6_IDB].sort());
    expect(out.match(/NOT known/g)).toHaveLength(R6_IDB.length);
    expect(code).toBe(unknownIds.length > 0 ? 1 : 0);
  });
});

/**
 * blur-menu-grouped's seven cases under WDA as they read before round 16's in-window backdrop (bugs/r16-blur 7fd1ee57,
 * adapters/wda-source.ts#inWindowBackdrops): A, B, D Tapped through the backdrop (the menu dismissed) and their
 * scroll_until "fully visible after 0 swipes"; C's scroll_until three strokes on the blur, refused. Known as residual 9's
 * until the fix struck them off (ok in two runs of two since): a record before it reads them not known.
 */
const BLUR_WDA = ['tap:blur-menu-grouped.A', 'scroll:blur-menu-grouped.A', 'tap:blur-menu-grouped.B', 'scroll:blur-menu-grouped.B', 'scroll:blur-menu-grouped.C', 'tap:blur-menu-grouped.D', 'scroll:blur-menu-grouped.D'];

// Round 16's in-window backdrop: the records of rounds 8 and 9 that HEAD's KNOWN read whole until it.
describe('live.ts --rejudge over the committed iOS records of the src before the in-window backdrop', () => {
  // Each as recorded but blur-menu-grouped's seven WDA cases (BLUR_WDA), a calibration of that src now: exit 1.
  it.each([
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
  ] as const)('%s (--groups %s): blur-menu-grouped\'s WDA cases not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want) => {
    const { code, out } = await rejudgeInProcess(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${BLUR_WDA.length} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual([...BLUR_WDA].sort());
    expect(code).toBe(1);
  });
});

// Round 16's merge: LE2's chooser records, taken on bugs/r16-le2 alone (cefccf3d), before the in-window backdrop.
describe('live.ts --rejudge over the committed iOS records of LE2\'s chooser before the merge', () => {
  // chooser-over-list's R under WDA: its scroll_until stroked the dim three times (175, 175, 699) and refused, "content
  // exhausted", nothing dismissed — known as residual 9's `presented-stroke` until the merge (4f48c642) read the dim as
  // an in-window backdrop and stopped before any swipe (ios-vis-r16-merge-1.json, -2.json) and the entry was struck off:
  // here it reads as recorded, not known — exit 1. -2.json holds WDA's one intermittent stop on footer O 0.7 pt past
  // the clip (live-known.ts), -3.json none.
  it.each([
    ['ios-vis-r16-le2-2.json', { cases: 12, ok: 7, loud: 1, mismatches: 4 }],
    ['ios-vis-r16-le2-3.json', { cases: 12, ok: 8, loud: 1, mismatches: 3 }],
  ] as const)('%s: chooser-over-list R\'s WDA strokes not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility,dismissal');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(1 not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown).toEqual(['scroll:chooser-over-list.R']);
    expect(code).toBe(1);
  });
});

// D50's fix: the src before it, live (batch-3's block G at 6b4a44df, D30).
describe('live.ts --rejudge over the committed record of the src before D50\'s fix', () => {
  // h2 under idb: Continue tapped 0.92 s after Welcome though averi said the screen held 2.5 s — the hold began on the
  // spinner idb lists as an unlabelled `GenericElement` with a value, content to bare-tree.ts then. D50 (ADR 0033's D50
  // amendment) reads it `progress` and struck the `ios idb h2` entry off: the recorded replies read as they were, h2 not
  // known — exit 1, as recorded. h1 and h3 ok.
  it('ios-idb-ensure-d30-1.json: h2 not known, h1 and h3 ok', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-idb-ensure-d30-1.json', 'ensure');
    expect(out).toMatch(/^# Live golden: 3 cases, 2 ok, 0 loud, 1 mismatches \(1 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown).toEqual(['h2']);
    expect(code).toBe(1);
  });
});

// D51's fix: the src before it, live (batch-3's block H at 6b4a44df, D37).
describe('live.ts --rejudge over the committed records of the src before D51\'s fix', () => {
  // f11: `31122026` typed without clear into the field that dots it — the app held `31.12.2026`, averi replied "ERROR
  // fill: typed 8 characters but the field shows 10" under idb, WDA and uiautomator (ADR 0034 failed a `.` group that is
  // no thousands). D51 (ADR 0034's amendment) passes that reading and struck the three live-known.ts entries off: the
  // recorded replies read as they were, f11 not known — exit 1, as recorded. f12–f14 ok.
  it.each([['ios-idb-forms-d37-1.json'], ['ios-wda-forms-d37-1.json'], ['android-forms-d37-1.json']] as const)(
    '%s: f11 not known, f12–f14 ok',
    { timeout: 60_000 },
    async (record) => {
      const { code, out } = await rejudgeInProcess(record, 'forms');
      expect(out).toMatch(/^# Live golden: 4 cases, 3 ok, 0 loud, 1 mismatches \(1 not known\), 0 skipped$/m);
      const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
      expect(unknown).toEqual(['f11']);
      expect(code).toBe(1);
    },
  );
});

// D61's fix: the src before it, live (batch-9's forms block at e734fedf, L7's first read).
describe('live.ts --rejudge over the committed record of the src before D61\'s fix', () => {
  // g3 under idb: `421903123456` typed without clear into phoneGrouped — the app held `421 903 123 456`, averi replied
  // "ERROR fill: typed 12 characters but the field shows 15", the unnamed `+421` placeholder taken for earlier text.
  // D61 (ADR 0034's D61 amendment) lands it, ok 3 of 3 under idb since (ios-idb-forms-d61-*.json), and no live-known.ts
  // entry ever filed it: the recorded reply reads as it was, g3 not known — exit 1, as recorded. g2 the D53 `separated`
  // MISMATCH, known; every other case ok.
  it('ios-idb-forms-l7-1.json: g3 not known, g2 known, the rest ok', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-idb-forms-l7-1.json', 'forms');
    expect(out).toMatch(/^# Live golden: 18 cases, 16 ok, 0 loud, 2 mismatches \(1 not known\), 0 skipped$/m);
    expect(notKnown(out)).toEqual(['g3']);
    expect(out).toMatch(/^- MISMATCH \(failed-holds\) g2 .*\[known: residual:ADR 0034 residual 10 — /m);
    expect(code).toBe(1);
  });
});

// L2's fix (round 8): the src before it, live.
describe('live.ts --rejudge over the committed iOS record of the src before L2\'s fix', () => {
  // fix/round-8's src through --side (docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md):
  // under idb the tap on phone answered Tapped and SUBMITTED the form, scroll_until called it fully visible after 0
  // swipes, its centre under the bar — no live-known.ts entry explains either: exit 1, as recorded.
  it('ios-forms-r8-l2-before.json: k6 and k7 not known, the form submitted', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-forms-r8-l2-before.json', 'forms');
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
  // Since round 16 blur-menu-grouped's WDA cases too (BLUR_WDA), in every record below before its in-window backdrop.
  it.each([
    ['ios-vis-r8-l4-1.json'],
    ['ios-vis-r8-l4-2.json'],
  ] as const)('%s: C\'s three strokes not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 10 ok, 2 loud, 28 mismatches \(10 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['scroll:blur-menu.C', 'scroll:blur-menu.C', 'scroll:blur-menu-grouped.C', ...BLUR_WDA].sort());
    expect(code).toBe(1);
  });
  // 94fc318b's first run: every case as -4.json reads it but idb's tap of blur-menu's A, the run's first case on a
  // freshly booted simulator — averi's wait for A timed out with no tree, nothing tapped: ok, vacuously, so its entry
  // reads FIXED here; it read Tapped (the menu dismissed) in -4.json, so the entry stays: exit 1, as recorded.
  it('ios-vis-r8-l4-3.json: idb\'s tap of A ok by a timeout, so FIXED; nothing else not ok unknown', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-vis-r8-l4-3.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 14 ok, 2 loud, 24 mismatches \(7 not known\), 0 skipped$/m);
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
    const { code, out } = await rejudgeInProcess('ios-vis-r9-l4w-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 16 ok, 0 loud, 24 mismatches \(7 not known\), 0 skipped$/m);
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
    const { code, out } = await rejudgeInProcess('ios-vis-r9-final-1.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 40 cases, 16 ok, 0 loud, 24 mismatches \(7 not known\), 0 skipped$/m);
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
    const { code, out } = await rejudgeInProcess('android-vis-r9-b4l1-sticky.json', 'visibility');
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
    const { code, out } = await rejudgeInProcess('ios-wda-long-list-parked-1.json', 'visibility');
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
    const { code, out } = await rejudgeInProcess(record, groups);
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
// 14: idb's tabbar-floating R (LV3_IDB); and A38b's band stroke: idb's carousel-in-list C (A38B_IDB).
describe('live.ts --rejudge over the committed iOS records of the src before L4\'s reading-order covers', () => {
  // C's cases beneath the blur menus, as above: in these records, each an older src's, they read as recorded — a tap
  // that fired W, a stop claimed at once — not known: a calibration of that src now, not HEAD's KNOWN: exit 1, as
  // recorded. Everything else as HEAD knows it.
  it.each([
    // round 7's A5 (src arch/r23-idb-sheet through --side): the whole visibility group under idb once — sheet-medium-edges' H and G ok too
    ['ios-idb-vis-a5.json', { cases: 145, ok: 102, loud: 6, mismatches: 37 }, [...L4_IDB, ...LE2_IDB, ...LE3_IDB, ...LV3_IDB, ...A38B_IDB]],
    // round 7's final device check (truth/round-7 836e04b1): the visibility groups, as the records pinned above
    ['ios-wda-vis-r7final.json', { cases: 146, ok: 129, loud: 1, mismatches: 16 }, [...L4_WDA, ...LE3_WDA, ...BLUR_WDA]],
    ['ios-idb-vis-r7final.json', { cases: 145, ok: 102, loud: 6, mismatches: 37 }, [...L4_IDB, ...LE2_IDB, ...LE3_IDB, ...LV3_IDB, ...A38B_IDB]],
    // round 7's A2's whole WDA visibility group (ios-wda-long-list-parked-1…3.json's src: LV6 fixed, A1 not) — WDA's
    // turn of F not known there as well (the one-stroke stop's block above)
    ['ios-wda-vis-parked.json', { cases: 146, ok: 128, loud: 1, mismatches: 17 }, ['turn:scroll-bounded.F', ...L4_WDA, ...LE3_WDA, ...BLUR_WDA]],
    // round 8's own --side run of fix/round-8 e0c2587e, the src before the fix: C's tap fired W under both sources
    ['ios-vis-r8-l4-before.json', { cases: 40, ok: 7, loud: 2, mismatches: 31 }, [...L4_IDB, ...L4_WDA, ...BLUR_WDA]],
  ] as const)('%s: C\'s cases beneath the blur menus not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want, unknownIds) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
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
    ['ios-vis-r23-ios-stop-e687fe83.json', 'visibility', { cases: 286, ok: 221, loud: 4, mismatches: 61 }, [...A5_IDB, ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB, ...BLUR_WDA, ...A38B_IDB]],
    // re-recorded by round 6's iOS device check (src 11683c3; the forms group run too, judged apart): the presented
    // refusal cases new (WDA ok, idb residual 6, the blur residual 9), round 6's new cells' cases new (carousel-in-list
    // C under idb LE2), LV4's turn `visible` (its entry's primary kind until A1 struck it off). Its long-list carry
    // case (LV6: Row 30 of the 40-row table, asked by its text) is no case since round 7 (the table 56 rows, the carry
    // asked of target L), so not judged: 311 cases and 64 mismatches until then. idb's scroll case of F (R-direction
    // until then) LOUD since: round 7's recapture records F unlisted under idb, its strokes unjudged.
    ['ios-vis.json', 'visibility,dismissal', { cases: 310, ok: 244, loud: 4, mismatches: 62 }, [...A5_IDB, 'turn:scroll-bounded.F', ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB, ...BLUR_WDA, ...A38B_IDB]],
    // round 5's own run (src b71cbbb, harness 2725e76: ios-vis.json until round 6 re-recorded it): LV5's failing run
    // reads LOUD, its entry struck off since (round 6: ok four times at 11683c3); no sheet-medium or sheet-background
    // cell then, sheet-medium-edges' H and G alone of A5's
    // (idb's scroll case of F LOUD since round 7's recapture, as above: 6 loud, 30 mismatches until then); no scroll case
    // of the blur menus then, so of L4's only C's taps (idb's two, WDA's one: hence tap:blur-menu.C twice)
    ['ios-vis-2725e76.json', 'visibility,dismissal', { cases: 248, ok: 214, loud: 5, mismatches: 29 }, ['scroll:sheet-medium-edges.H', 'scroll:sheet-medium-edges.G', 'turn:scroll-bounded.F', 'tap:blur-menu.C', 'tap:blur-menu-grouped.C', 'tap:blur-menu.C', 'tap:blur-menu-grouped.A', 'tap:blur-menu-grouped.B', 'tap:blur-menu-grouped.D', ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB]],
  ] as const)('%s (--groups %s): idb\'s presented-layer cases (and L4\'s C) not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, groups, want, unknownIds) => {
    const { code, out } = await rejudgeInProcess(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${unknownIds.length} not known\\), 0 skipped$`, 'm'));
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual([...unknownIds].sort());
    expect(code).toBe(1);
  });
});

// A38b's band stroke (interact/stroke-plan.ts#bandOf).
describe('live.ts --rejudge over the committed iOS records of the src before A38b\'s band stroke', () => {
  // idb's carousel-in-list C as above (A38B_IDB): in these records, each an older src's, its strokes went over the
  // screen's middle and moved nothing — not known: a calibration of that src now, not HEAD's KNOWN: exit 1, as recorded.
  // Everything else as HEAD knows it.
  it.each([
    // Round 14's LE2 fix (bugs/r14-le2), idb's visibility cells it touched, twice
    ['ios-idb-vis-r14-le2-1.json', { cases: 18, ok: 9, loud: 0, mismatches: 9 }],
    ['ios-idb-vis-r14-le2-2.json', { cases: 18, ok: 9, loud: 0, mismatches: 9 }],
    // Round 16's feeler (bugs/r16-r6), idb: sheet-background, alert-dim, dim-cover and the content-up cells, twice
    ['ios-vis-r16-r6-1.json', { cases: 47, ok: 34, loud: 0, mismatches: 13 }],
    ['ios-vis-r16-r6-2.json', { cases: 47, ok: 34, loud: 0, mismatches: 13 }],
  ] as const)('%s: idb\'s carousel-in-list C not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${A38B_IDB.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...A38B_IDB].sort());
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

/**
 * Residual 19's four live cases beneath the full-screen Compose Dialog (its two strokes on the dialog), struck off
 * live-known.ts since the window manager's word types the window (scroll_until stops before any stroke).
 */
const FULL_SCREEN_DIALOG_CASES = ['A', 'B', 'C', 'D'].map((t) => `scroll:dialog-fullscreen.${t}`);

/** The ids of a rejudged record's mismatches no entry of live-known.ts explains. */
const notKnown = (out: string): string[] => [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);

// Before LV1's fix (round 14).
describe('live.ts --rejudge over the committed Android record of the active-window hint, before LV1\'s fix', () => {
  // Round 6's closing review's run of the hint (src ea070d2): scroll-bounded's O and F claimed "the last 2 … did not
  // change the screen" while their strokes moved `upper` — LV1's, known until round 14 struck them off: not known now,
  // a calibration of that src: exit 1, as recorded. Every other case as HEAD knows it.
  it('android-vis-hint-ea070d2.json: LV1\'s two scroll-bounded cases not known', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('android-vis-hint-ea070d2.json', 'forms,visibility');
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
    ['android-vis.json', { cases: 111, ok: 98, loud: 3, mismatches: 10, dialog: [] }],
    // (and residual 19's four beneath the full-screen dialog, since the window manager's word types it)
    ['android-vis-r7final.json', { cases: 137, ok: 120, loud: 3, mismatches: 14, dialog: FULL_SCREEN_DIALOG_CASES }],
  ] as const)('%s: LE1\'s six cases not known, and VA1\'s and LV1\'s', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    // (6 not known until VA1's fix, round 14: its case since; 7 until LV1's, its three since.)
    const unknown = [...LE1_CASES, VA1_CASE, ...LV1_CASES, ...want.dialog];
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${unknown.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual(unknown.sort());
    expect(code).toBe(1);
  });
  // The first run of that device check (android-vis-e98b87e-run1.json), whose three tool calls hung past the client's
  // 300 s — bands' Q, bands-three-button's O and tabbar-floating's F, each LOUD "Request timed out" — so those cells
  // were run again into android-vis.json. Its cases not known are android-vis.json's but tabbar-floating's F (LOUD
  // here, the hang) and bands' N, refused while the app logged a tap of Q: the hung tap of Q landing during N's case.
  it('android-vis-e98b87e-run1.json: as android-vis.json, but the three hung calls LOUD and bands N reading the hung tap of Q', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('android-vis-e98b87e-run1.json', 'visibility');
    const unknown = [...LE1_CASES, VA1_CASE, ...LV1_CASES.filter((c) => c !== 'scroll:tabbar-floating.F'), 'tap:bands.N'];
    expect(out).toMatch(new RegExp(`^# Live golden: 111 cases, 95 ok, 6 loud, 10 mismatches \\(${unknown.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual(unknown.sort());
    expect(out.match(/^- LOUD .*MCP error -32001: Request timed out$/gm)).toHaveLength(3);
    expect(out).toMatch(/^- MISMATCH \(tap-refused-fired\) tap:bands\.N .*yet the app logged tap Q/m);
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
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 18 cases, 16 ok, 0 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    expect(notKnown(out).sort()).toEqual([VA1_CASE, 'scroll:tabbar-floating.F'].sort());
    expect(code).toBe(1);
  });
});

// A6's fix, round 7.
describe('live.ts --rejudge over the committed Android records of the src before the eyes on a "fully" claim', () => {
  // k7: scroll_until phone under the bar riding on the IME. Its stop said "fully visible" with 18 px of phone under the
  // bar's node-less padding — ok by an allowance (ADR 0013's residual) until round 7's A6 made averi name the band
  // ("PARTLY UNDER a surface …") and live-forms.ts#judgePhoneScroll ask it. k7 has no KNOWN entry: in these records,
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
    const { code, out } = await rejudgeInProcess(record, groups);
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.unknown.length} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...want.unknown].sort());
    expect(out).toMatch(/^- MISMATCH k7 .*fully visible after 1 swipe — 18 px of phone under the bar, unsaid/m);
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over the first committed records of FU1\'s fix, before kf1 and kf2 evidenced the panel', () => {
  // android-forms-r1023b-fu1-{1,2,3}.json: the same device and floating Gboard, run before kf1 and kf2 began with a
  // colour assert on ks that quotes the panel over it. With no such reply a floating panel is not evidenced (an IME
  // collapsed to its strip reads the same to the app). Since D67 the judges rest on the panel the IME's region names at
  // launch, which these runs did not read: kf1, kf2 and kf3 all SKIP "no measured panel", the run's exit still 0.
  it.each(['android-forms-r1023b-fu1-1.json', 'android-forms-r1023b-fu1-2.json', 'android-forms-r1023b-fu1-3.json'])('%s: kf1, kf2 and kf3 SKIP, no measured panel', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudgeInProcess(record, 'forms');
    expect(out).toMatch(/^# Live golden: 3 cases, 0 ok, 0 loud, 0 mismatches \(0 not known\), 3 skipped$/m);
    for (const id of ['kf1', 'kf2', 'kf3']) expect(out).toMatch(new RegExp(`^- SKIP ${id} .*no measured panel \\(no IME region read at launch\\)`, 'm'));
    expect(code).toBe(0);
  });
});

describe('live.ts --rejudge over the committed calibration records of the src before the flush probe', () => {
  // cal12-d043e65-1.json and -2.json (#12's live calibration, two --side runs of d043e65, before the flush probe existed) read
  // scroll-bounded-flush's S, P.fully and S.fully as a stop claimed on `visible` ("fully visible after 0 swipes"): #12's
  // own defect at that commit. P.fully and S.fully were known by LV2's intermittent entries until round 1023 fixed LV2
  // and struck them off; they never were LV2's at that src (no probe was sent), so all three read not known now — a
  // calibration, not HEAD's KNOWN: exit 1, as recorded.
  it.each([['cal12-d043e65-1.json'], ['cal12-d043e65-2.json']] as const)('%s: S, P.fully and S.fully not known', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches \(3 not known\), 0 skipped$/m);
    expect(notKnown(out).sort()).toEqual(['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S', 'scroll:scroll-bounded-flush.S.fully']);
    expect(out).toMatch(/^- MISMATCH \(stop-claim\) scroll:scroll-bounded-flush\.S\.fully .*fully visible after 0 swipes/m);
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over the committed calibration records of #12\'s fix, before the flush probe', () => {
  // cal12-9c7885e-1…3.json (#12's live calibration at its fix, 9c7885e, three runs): P.fully and S.fully ok — "fully
  // visible" where each is drawn whole (LV2's two cases read `visible` in all of them: live-known.ts's header) — but the
  // plain stop on S, the sliver, claimed "fully visible after 0 swipes" before the flush probe existed: no live-known.ts
  // entry ever filed it, so it reads not known — a calibration of that src, not HEAD's KNOWN: exit 1, as recorded.
  it.each([['cal12-9c7885e-1.json'], ['cal12-9c7885e-2.json'], ['cal12-9c7885e-3.json']] as const)('%s: S\'s plain stop not known, the rest ok', { timeout: 60_000 }, async (record) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(/^# Live golden: 7 cases, 6 ok, 0 loud, 1 mismatches \(1 not known\), 0 skipped$/m);
    expect(notKnown(out)).toEqual(['scroll:scroll-bounded-flush.S']);
    expect(out).toMatch(/^- MISMATCH \(stop-claim\) scroll:scroll-bounded-flush\.S .*fully visible after 0 swipes/m);
    expect(code).toBe(1);
  });
});

// Before L1's and F2A1's fixes.
describe('live.ts --rejudge over the committed record of a --side run of b71cbbb, before the fixes of the scroll stop beneath a presented window and of k7', () => {
  // Round 6's device check, the same cases and lab build as android-vis.json. Its cases not known are exactly the two
  // fixes' before: L1's eight scroll_until beneath the AlertDialog and the half sheet (a stop "after 1 swipe" that
  // dismissed the layer, or three strokes that expanded the sheet) and F2A1's k7 (no KNOWN entry) — a
  // calibration, not HEAD's KNOWN: exit 1, as recorded.
  it('android-vis-b71cbbb.json: the scroll cases beneath the dialog and the half sheet, and k7, not known, everything else as HEAD knows it', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('android-vis-b71cbbb.json', 'forms,visibility');
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
  // 2026-10-15-lab-ios-swiftui-model-drops-trailing-typed-characters.md): neither has a KNOWN entry, so exit 1 — and,
  // since round 7's A1 struck their entries off, WDA's turn of F (LV4) and carousel C's stop claimed on a read still
  // moving, as recorded at that src; since A5's, idb's presented-layer cases (A5_IDB, above); since L4's, C's cases
  // beneath the blur menus (L4_IDB, L4_WDA); since LE2's and LE3's (round 14), LE2_IDB and scroll-sticky's R fully
  // (LE3_IDB, LE3_WDA); since LV3's (round 14), idb's tabbar-floating R (LV3_IDB); since A38b's band stroke, idb's
  // carousel-in-list C (A38B_IDB: hence scroll:carousel-in-list.C twice, WDA's and idb's).
  // The visibility cases A1 and A5 fixed since.
  it('ios-vis-b71cbbb.json: forms b4 and p2 not known, and the visibility cases the one-stroke stop and idb\'s presented layer fixed since', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-vis-b71cbbb.json', 'forms,visibility,dismissal');
    // (351 cases, 14 loud, 67 mismatches until round 7: its carry case, Row 30 of the 40-row table, no case since; idb's
    // scroll case of F LOUD, F recorded unlisted under idb. 270 ok, 15 loud until NI1's fix: idb's two R taps, refused
    // with nothing fired, are ok since — a target its source does not list is not asked to fire.)
    expect(out).toMatch(/^# Live golden: 350 cases, 272 ok, 13 loud, 65 mismatches \(31 not known\), 0 skipped$/m);
    const unknown = [...out.matchAll(/^- MISMATCH (?:\([A-Za-z-]+\) )?(\S+) (?!.*\[known).*$/gm)].map((m) => m[1]);
    expect(unknown.sort()).toEqual(['b4', 'p2', 'scroll:carousel-in-list.C', 'turn:scroll-bounded.F', ...A5_IDB, ...L4_IDB, ...L4_WDA, ...LE2_IDB, ...LE3_IDB, ...LE3_WDA, ...LV3_IDB, ...BLUR_WDA, ...A38B_IDB].sort());
    expect(code).toBe(1);
  });
});

// LV6's fix (A2, a1b0b82), round 7's lab fixes, truth/r7-lab-fixes.
describe('live.ts --rejudge over the committed records of the src before the parked cell content moved to its cell', () => {
  // sheet-long-list at 56 rows, its target L past one carry and before the end. L's carry and scroll cases under WDA
  // were LV6's (its parked label read above the screen: turned three times; the scroll case's turns merged into one
  // stroke in the second run, read not-reached) until round 7's A2 fixed it (a1b0b82) and their entries were struck
  // off: here they read as recorded, not known — the src before the fix, a calibration of it now, not HEAD's KNOWN:
  // exit 1, as recorded. F and L under idb never in the tree (no identifier): LOUD. R's two taps under idb, refused with
  // nothing fired, are ok since NI1's fix (a target its source does not list is not asked to fire): every iOS record
  // here that holds them reads two more ok and two fewer loud than it did before it.
  it.each([
    ['ios-long-list-r7-lab-1.json', { cases: 17, ok: 12, loud: 3, mismatches: 2, notKnown: 2 }, ['carry:sheet-long-list.L', 'scroll:sheet-long-list.L']],
    ['ios-long-list-r7-lab-2.json', { cases: 17, ok: 12, loud: 4, mismatches: 1, notKnown: 1 }, ['carry:sheet-long-list.L']],
    // round 7's A1 at 659fdf00 (arch/r23-ios-stop, before A2's fix reached it): the WDA scroll cells, L's two cases
    // LV6's as above, every other case ok — the turn of F in one stroke, carousel C settled
    ['ios-wda-scroll-cells-659fdf00.json', { cases: 32, ok: 30, loud: 0, mismatches: 2, notKnown: 2 }, ['carry:sheet-long-list.L', 'scroll:sheet-long-list.L']],
  ] as const)('%s: L\'s WDA cases not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want, unknownIds) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
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
  // known until the window manager's word struck them off; beneath the Views BottomSheetDialog LW1's four (A's and B's stroke up on the scrim dismissing the sheet and
  // claiming the stop, C's and D's two strokes on it), whose entries round 7's A7 struck off (f924893e: the window
  // marked by Material's ids): not known here — the src before the fix, a calibration of it now: exit 1, as recorded.
  it.each([
    ['android-vis-dialogs.json', { cases: 26, ok: 18, loud: 0, mismatches: 8, notKnown: 8 }],
    ['android-vis-dialogs-scroll-run2.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 8 }],
    ['android-vis-dialogs-scroll-run3.json', { cases: 8, ok: 0, loud: 0, mismatches: 8, notKnown: 8 }],
  ] as const)('%s: the bottom sheet dialog\'s four scroll cases not known, and the full-screen dialog\'s', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(${want.notKnown} not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...['A', 'B', 'C', 'D'].map((t) => `scroll:bottom-sheet-dialog.${t}`), ...FULL_SCREEN_DIALOG_CASES].sort());
    expect(code).toBe(1);
  });
});

describe('live.ts --rejudge over the committed records of the src before the full-screen dialog was typed by the window manager', () => {
  // Residual 19's four scroll cases beneath the full-screen Compose Dialog, known until the window manager's word
  // struck them off: their two strokes on the dialog read MISMATCH not known — each record a calibration of its src now.
  it.each([
    ['android-vis-dialogs-r7final.json', { cases: 26, ok: 22, loud: 0, mismatches: 4 }],
    ['android-vis-r14-lv1.json', { cases: 140, ok: 131, loud: 5, mismatches: 4 }],
    ['android-vis-r1023-lv2-group.json', { cases: 140, ok: 130, loud: 6, mismatches: 4 }],
  ] as const)('%s: the full-screen dialog\'s four scroll cases not known, everything else as HEAD knows it', { timeout: 60_000 }, async (record, want) => {
    const { code, out } = await rejudgeInProcess(record, 'visibility');
    expect(out).toMatch(new RegExp(`^# Live golden: ${want.cases} cases, ${want.ok} ok, ${want.loud} loud, ${want.mismatches} mismatches \\(4 not known\\), 0 skipped$`, 'm'));
    expect(notKnown(out).sort()).toEqual([...FULL_SCREEN_DIALOG_CASES].sort());
    expect(code).toBe(1);
  });
});

describe('live.ts: a known case not intermittent that comes out ok fails the run (live-known.ts\'s ratchet)', () => {
  // (Until round 8's L4 fix struck it off, the example was idb's tap:blur-menu-grouped.C read as WDA read it; until
  // round 14's LV3 fix struck it off, idb's scroll:tabbar-floating.R.)
  it('idb scroll:scroll-bounded.F read as WDA read it (known under idb, which lists no scroll view; WDA strokes inside `lower`, stops on F, the tap firing it): FIXED, exit 1', { timeout: 60_000 }, async () => {
    const ios = readLiveRecord('ios-vis.json');
    const wda = ios.results.find((r) => r.source === 'wda' && r.id === 'scroll:scroll-bounded.F')!;
    const dir = await mkdtemp(join(tmpdir(), 'live-rejudge-'));
    try {
      const file = join(dir, 'fixed.json');
      await writeFile(file, JSON.stringify({ ...ios, results: [{ ...wda, source: 'idb' }] }));
      const { code, out } = await rejudgeInProcess(file, 'visibility');
      expect(out).toMatch(/^# Live golden: 1 cases, 1 ok, 0 loud, 0 mismatches \(0 not known\)/m);
      expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb scroll:scroll-bounded.F');
      expect(code).toBe(1);
      // the same read as a --side run's record: a calibration, not held to HEAD's KNOWN
      await writeFile(file, JSON.stringify({ ...ios, side: '/some/differential-cal-checkout', results: [{ ...wda, source: 'idb' }] }));
      expect((await rejudgeInProcess(file, 'visibility')).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Before round 9's rebound fix (ADR 0021 decision 6).
describe('live.ts --rejudge over the committed record of absent:scroll-top-edge-end at main\'s src, before round 9\'s fix', () => {
  // main 265a2bb4 through --side: under idb "failed after 3 swipes" (the first stroke's read a point off, read as motion),
  // under WDA "failed after 6 swipes (maxSwipes)" — both end-unread, not known: a calibration of that src, exit 1.
  it('ios-vis-r9-absent-before.json: both sources end-unread, not known', { timeout: 60_000 }, async () => {
    const { code, out } = await rejudgeInProcess('ios-vis-r9-absent-before.json', 'visibility');
    expect(out).toMatch(/^# Live golden: 2 cases, 0 ok, 0 loud, 2 mismatches \(2 not known\), 0 skipped$/m);
    expect(notKnown(out)).toEqual(['absent:scroll-top-edge-end', 'absent:scroll-top-edge-end']);
    expect(code).toBe(1);
  });
});

/**
 * D31: the forms group's standing LOUDs are machine-checked — live-known.ts files b1d, b7, p5 and rf4 by the rule a
 * fill verdict fails by (live-forms.ts#holds) and the kind of its last reply, as a visibility case is filed. Over D40's
 * device run at 40ba3dd1: every LOUD line marked known; a record read otherwise is not known, or FIXED.
 */
describe('live.ts --rejudge over D40\'s forms records: every LOUD known by its rule and its kind', () => {
  it.each([
    // D43: WDA's b1d and b7 known no more (PRE_D43_WDA_LOUD) — their LOUD lines unmarked.
    ['ios-forms-d40-1.json', ['b1d', 'b7', 'p5', 'p5'], ['b1d', 'b7']],
    ['ios-rn-forms-d40-1.json', ['rf4', 'rf4'], []],
  ] as const)('%s: each LOUD [known:', { timeout: 60_000 }, async (record, louds, unmarked) => {
    const { code, out } = await rejudgeInProcess(record, 'forms');
    const marked = [...out.matchAll(/^- LOUD \((loud-untouched|loud-changed)\) (\S+) .*\[known: (?:bug|residual):[^\]]+\]$/gm)].map((m) => m[2]);
    expect(marked.sort()).toEqual([...louds].sort());
    expect([...out.matchAll(PRE_D43_WDA_LOUD)].map((m) => m[1]).sort()).toEqual([...unmarked]);
    expect(out.match(/^- LOUD /gm)).toHaveLength(louds.length + unmarked.length);
    expect(out).not.toMatch(/NOT known|FIXED, not intermittent/);
    expect(code).toBe(0);
  });

  const rejudgeOf = async (rec: LiveRecord, results: RecordedCase[]) => {
    const dir = await mkdtemp(join(tmpdir(), 'live-rejudge-'));
    try {
      const file = join(dir, 'mutated.json');
      await writeFile(file, JSON.stringify({ ...rec, results }));
      return await rejudgeInProcess(file, 'forms');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('iOS p5 with the app holding the value asked and the fill claiming it: FIXED, exit 1', { timeout: 60_000 }, async () => {
    const ios = readLiveRecord('ios-forms-d40-1.json');
    const p5 = ios.results.filter((r) => r.id === 'p5').map((r) => ({ ...withFieldValue(r, 'pin', '25801'), replies: ['Filled id:"lab.form-prefilled.pin" (1 character)'] }));
    const { code, out } = await rejudgeOf(ios, p5);
    expect(out).toMatch(/^# Live golden: 2 cases, 2 ok, 0 loud, 0 mismatches \(0 not known\)/m);
    expect(out).toContain('FIXED, not intermittent — strike off live-known.ts: idb p5, wda p5');
    expect(code).toBe(1);
  });

  it('RN rf4 with the whole value typed (no committed record reads it ok): intermittent — printed so, no FIXED, exit 0', { timeout: 60_000 }, async () => {
    const rn = readLiveRecord('ios-rn-forms-d40-1.json');
    const rf4 = rn.results.filter((r) => r.id === 'rf4').map((r) => withFieldValue(r, 'G', 'SK31 1200 0000'));
    const { code, out } = await rejudgeOf(rn, rf4);
    expect(out).toMatch(/^# Live golden: 2 cases, 2 ok, 0 loud, 0 mismatches \(0 not known\)/m);
    expect(out.match(/^- ok rf4 .*\[known \(intermittent\), ok this run: residual:ADR 0034 residual 2 /gm)).toHaveLength(2);
    expect(out).not.toMatch(/FIXED, not intermittent/);
    expect(code).toBe(0);
  });

  /**
   * D43a (ADR 0037): Android refuses `Š` and `’` before the focus tap, so b1d and b7 leave the field as the launch left
   * it — KNOWN pins `loud-untouched` now. D40's Android record predates it and reads them NOT known (PRE_D43A_LOUD, in
   * the counts' table above) until the next device run's record replaces it. That record's shape, the field
   * untouched, rejudges known with no NOT known:
   */
  it('Android b1d and b7 with the field as the launch left it (D43a\'s refusal before the tap): each LOUD known, no NOT known', { timeout: 60_000 }, async () => {
    const android = readLiveRecord('android-forms-d40-1.json');
    const refused = android.results.filter((r) => r.id === 'b1d' || r.id === 'b7').map((r) => withFieldValue(r, 'name', r.launched.fields!.name.value));
    const { code, out } = await rejudgeOf(android, refused);
    const marked = [...out.matchAll(/^- LOUD \(loud-untouched\) (\S+) .*\[known: bug:2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii\.md\]$/gm)].map((m) => m[1]);
    expect(marked.sort()).toEqual(['b1d', 'b7']);
    expect(out).not.toMatch(/NOT known|FIXED, not intermittent/);
    expect(code).toBe(0);
  });
});

describe('T16: the carousel group\'s device label, printed from the record', () => {
  // T11's final A/B control run (fix arm): a carousel record from before T16, so with no `deviceLabel`.
  const RECORD = 't11-carousel-visible/final-ab/control-fix-1.json';
  const recorded = () => JSON.parse(readFileSync(resolve(ROOT, pathOf(RECORD)), 'utf8')) as RunRecord;
  const round = (carry: number) => ({ pre: 438, preMs: 1_050, strokes: [carry, carry, carry, carry].map((c) => ({ carry: c, ms: 350 })), load: '0.10 0.20 0.30 1/1700 1' });
  const read = (carry: number, p50: number) => ({ t: '2026-11-10T12:00:00.000Z', rounds: [round(carry), round(140)], frames: { total: 90, janky: 2, p50, p90: 30 }, startCount: '11', hostLoad: '2.00 2.00 2.00' });
  const deviceLines = (lines: string[]) => lines.filter((l) => l.startsWith('Device: '));

  it('a record with no `deviceLabel` prints no Device line; one with it, the line last, and the rest and the exit code the same', { timeout: 60_000 }, async () => {
    const plain = await rejudgeRecord(recorded(), RECORD, { groups: ['carousel'] });
    expect(deviceLines(plain.lines)).toEqual([]);
    const labelled = await rejudgeRecord({ ...recorded(), deviceLabel: { before: read(60, 18), after: read(140, 22) } }, RECORD, { groups: ['carousel'] });
    expect(labelled.lines).toEqual([...plain.lines, 'Device: DISAGREE — before short 4/8, after fast 0/8 (frames p50 18 ms → 22 ms)', '']);
    expect(labelled.exitCode).toBe(plain.exitCode);
  });

  it('an older record holding the device\'s name under `device` prints no Device line', { timeout: 60_000 }, async () => {
    const OLD = 'android-hint-everywhere-9fa59ae-asserts.json';
    const old = JSON.parse(readFileSync(resolve(ROOT, pathOf(OLD)), 'utf8')) as RunRecord & { device?: unknown };
    expect(old.device).toBe('averi_lab emulator-5554');
    expect(deviceLines((await rejudgeRecord(old, OLD, { groups: ['forms'] })).lines)).toEqual([]);
  });

  it('the CLI refuses --device-read with --rejudge: a rejudge reads no device', { timeout: 60_000 }, async () => {
    const refused = await run(process.execPath, ['--import', 'tsx', 'scripts/truth/live.ts', '--rejudge', pathOf(RECORD), '--groups', 'carousel', '--device-read', 'none'], { cwd: ROOT }).then(
      () => '',
      (e: { stderr?: string }) => e.stderr ?? '',
    );
    expect(refused).toContain('--device-read: a rejudge reads no device; leave it out');
  });

  it('a failed read: unlabelled, loud in the summary, the exit code untouched', { timeout: 60_000 }, async () => {
    const plain = await rejudgeRecord(recorded(), RECORD, { groups: ['carousel'] });
    const failed = await rejudgeRecord({ ...recorded(), deviceLabel: { error: 'before: round 1: the lab app reported no carousel offset', side: 'before' } }, RECORD, { groups: ['carousel'] });
    expect(deviceLines(failed.lines)).toEqual(['Device: unlabelled — before: round 1: the lab app reported no carousel offset']);
    expect(failed.exitCode).toBe(plain.exitCode);
  });
});

describe("T20a: the chooser group's premise, printed from the record", () => {
  // T7b's review round 1, its first run: a chooser record from before T20a, so with no `chooserPremise`.
  const RECORD = 't7b-chooser/review1-run-1.json';
  const recorded = () => JSON.parse(readFileSync(resolve(ROOT, pathOf(RECORD)), 'utf8')) as RunRecord;
  const facts = [{ fact: 'default' as const, state: 'fresh' as const, why: 'as recorded' }];
  const premiseLines = (lines: string[]) => lines.filter((l) => /^(?:Chooser premise|CHOOSER PREMISE|D55 \(Android\))/.test(l));

  it('a record with no `chooserPremise` prints no premise line; one with it, its lines byte for byte, last, and the rest the same', { timeout: 60_000 }, async () => {
    const plain = await rejudgeRecord(recorded(), RECORD, { groups: ['chooser'] });
    expect(plain.exitCode).toBe(0);
    expect(premiseLines(plain.lines)).toEqual([]);
    const lines = ['Chooser premise: fresh — as  recorded, not re-read ⏎', 'Chooser premise: WARN — 1 last-chosen lab entry (mAlways=false: no default; no reinstall clears it), first: 9d3a2b9 dev.averi.lab/.Twin'];
    const fresh = await rejudgeRecord({ ...recorded(), chooserPremise: { state: 'fresh', facts, lines } }, RECORD, { groups: ['chooser'] });
    expect(fresh.lines).toEqual([...plain.lines, ...lines, '']);
    expect(fresh.exitCode).toBe(0);
  });

  it('a stale premise fails the run, its cases judged as before; an unread one leaves the exit code untouched', { timeout: 60_000 }, async () => {
    const plain = await rejudgeRecord(recorded(), RECORD, { groups: ['chooser'] });
    const lines = ['CHOOSER PREMISE: stale — 0 handlers for averilab://shared/open, not 2 — the run fails', 'D55 (Android): averilab://shared/open has 0 handlers'];
    const stale = await rejudgeRecord({ ...recorded(), chooserPremise: { state: 'stale', facts, lines } }, RECORD, { groups: ['chooser'] });
    expect(stale.lines).toEqual([...plain.lines, ...lines, '']);
    expect(stale.exitCode).toBe(1);
    // A21: the premise's line and its hand line, one failure reason; a last-chosen WARN beside them is not part of it.
    expect(stale.failures).toEqual([lines.join(' | ')]);
    const warn = 'Chooser premise: WARN — 1 last-chosen lab entry (mAlways=false: no default; no reinstall clears it), first: 9d3a2b9 dev.averi.lab/.Twin';
    const warned = await rejudgeRecord({ ...recorded(), chooserPremise: { state: 'stale', facts, lines: [...lines, warn] } }, RECORD, { groups: ['chooser'] });
    expect(warned.failures).toEqual([lines.join(' | ')]);
    const unread = await rejudgeRecord({ ...recorded(), chooserPremise: { state: 'unread', facts, lines: ['Chooser premise: unread — x'] } }, RECORD, { groups: ['chooser'] });
    expect(unread.exitCode).toBe(0);
  });

  it('a selection with no chooser case (`--groups forms`): a stale premise in the record prints nothing and fails nothing', { timeout: 60_000 }, async () => {
    const lines = ['CHOOSER PREMISE: stale — 0 handlers for averilab://shared/open, not 2 — the run fails'];
    const forms = await rejudgeRecord({ ...recorded(), chooserPremise: { state: 'stale', facts, lines } }, RECORD, { groups: ['forms'] });
    const plain = await rejudgeRecord(recorded(), RECORD, { groups: ['forms'] });
    expect(forms.lines).toEqual(plain.lines);
    expect(premiseLines(forms.lines)).toEqual([]);
    expect(forms.exitCode).toBe(0);
  });
});

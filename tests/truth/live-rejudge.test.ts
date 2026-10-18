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
 * ios-vis.json and ios-scroll-bounded-wda-2725e76-*.json, round 5's device check) judged again by this checkout's
 * judges — `live.ts --rejudge`, the very code path, no device: a judge or a live-known.ts entry that changes what the
 * records read fails here, not first on a device. Pinned: the exit code (0: no MISMATCH that live-known.ts does not
 * explain, no known case not intermittent ok), no case not known, and the counts of the summary's header.
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
    // re-recorded by round 5's device check (src b71cbbb): LE4's and L3's cases and LV3's WDA one ok, struck off; the
    // text family's 26 taps new; scroll-bounded F's two WDA cases refiled (LV4, LV5)
    ['ios-vis.json', 'visibility,dismissal', { cases: 248, ok: 212, loud: 6, mismatches: 30 }],
    // two reruns of scroll-bounded under WDA at the same src: LV5's case ok in both (it is intermittent), LV4's not
    ['ios-scroll-bounded-wda-2725e76-1.json', 'visibility', { cases: 12, ok: 11, loud: 0, mismatches: 1 }],
    ['ios-scroll-bounded-wda-2725e76-2.json', 'visibility', { cases: 12, ok: 11, loud: 0, mismatches: 1 }],
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

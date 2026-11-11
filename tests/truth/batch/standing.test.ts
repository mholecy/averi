import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { NO_SERIAL, NO_UDID } from '../../../scripts/truth/batch/runner-lines.js';
import { cleanStateCommand, deviceInHand, liveJudge, liveVerdictLine, noDeviceReason, standingExitOf, STANDING_EXIT } from '../../../scripts/truth/batch/standing.js';
import { verdictLine, type Summary } from '../../../scripts/truth/batch/words.js';
import type { ChooserPremise } from '../../../scripts/truth/chooser-premise.js';
import { failuresJson } from '../../../scripts/truth/rejudge-failures.js';
import type { Result as LiveResult } from '../../../scripts/truth/live-cases.js';
import { hedgedLegs, liveResult, liveSummary } from './standing-fakes.js';

// scripts/truth/batch/standing.ts: the standing lab batches' kit (A21), its device-free parts on their own — a live
// block's verdict from its run, its summary and the failure reasons its rejudge wrote, its judge from the block's
// folder alone, and what that judge says over summarize's own output (live-cases.ts#summarize through
// standing-fakes.ts#liveSummary: the hedged ceiling, a LOUD that fails nothing, a stale premise), the words both
// batches' hand lines share. The selection and the run are pinned through each batch (lab-run.test.ts,
// lab-run-ios.test.ts), which import no live-cases.ts.

const ok = { word: 'OK' as const, why: 'exit 0' };
const judged = { word: 'DONE' as const, why: 'judged' };
const header = '# Live golden: 2 cases, 2 ok';

describe('liveVerdictLine: a live block\'s verdict from its run, its summary and its rejudge\'s failure reasons', () => {
  it('never run, or run with no rejudge (no record): INCONCLUSIVE naming why', () => {
    expect(liveVerdictLine('x verdict', 'r', undefined, undefined, undefined)).toBe('x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: not run)');
    expect(liveVerdictLine('x verdict', 'r', { live: { word: 'FAIL', why: 'timed out' } }, undefined, [])).toBe('x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: timed out)');
  });

  it('the rejudge not judged (another exit, past its bound): INCONCLUSIVE naming its why, whatever the reasons say', () => {
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: { word: 'FAIL', why: 'exit 2' } }, header, [])).toBe("x verdict: INCONCLUSIVE — r: main's rejudge exit 2");
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: { word: 'FAIL', why: 'exit 2' } }, header, ['MISMATCH a'])).toBe("x verdict: INCONCLUSIVE — r: main's rejudge exit 2");
  });

  it('exit 0 and no reason: PASS, the summary\'s header quoted when there is one', () => {
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, `<!-- averi -->\n${header}\n`, [])).toBe(`x verdict: PASS — r: main's rejudge exit 0 (${header})`);
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, 'no header\n', [])).toBe("x verdict: PASS — r: main's rejudge exit 0");
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, undefined, [])).toBe("x verdict: PASS — r: main's rejudge exit 0");
  });

  it('exit 1 and its reasons: FAIL naming each, `; `-joined, in the rejudge\'s order', () => {
    const s = liveSummary('android', [
      liveResult('a1', 'uiautomator', { outcome: 'MISMATCH', cls: 'tap-claim', why: 'x' }),
      liveResult('a2', 'uiautomator', { outcome: 'LOUD', cls: 'no-state', why: 'no first state for a2' }),
    ]);
    expect(s.failures).toEqual(['MISMATCH a1', 'NO FIRST STATE — the app wrote none, the run fails: uiautomator a2']);
    const head = s.lines.find((l) => l.startsWith('# Live golden:'))!;
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: judged }, s.lines.join('\n'), s.failures)).toBe(
      `x verdict: FAIL — r: main's rejudge exit 1 — MISMATCH a1; NO FIRST STATE — the app wrote none, the run fails: uiautomator a2 (${head})`,
    );
  });

  it('fail closed: the reasons unread (missing, not JSON), or at odds with the exit code — INCONCLUSIVE, never a PASS or a FAIL by guess', () => {
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, header, undefined)).toBe(
      "x verdict: INCONCLUSIVE — r: main's rejudge exit 0, its failure reasons unread (r.rejudge.json): read r.rejudge.txt",
    );
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: judged }, header, undefined)).toBe(
      "x verdict: INCONCLUSIVE — r: main's rejudge exit 1, its failure reasons unread (r.rejudge.json): read r.rejudge.txt",
    );
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, header, ['MISMATCH a', 'b'])).toBe(
      "x verdict: INCONCLUSIVE — r: main's rejudge exit 0, but its failure reasons name MISMATCH a; b: read r.rejudge.txt",
    );
    expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: judged }, header, [])).toBe(
      "x verdict: INCONCLUSIVE — r: main's rejudge exit 1, but its failure reasons name none: read r.rejudge.txt",
    );
  });
});

describe('liveJudge: device-free, from the block\'s folder alone', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'batch-standing-'))), 'judged');
    mkdirSync(dir);
  });
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  it('nothing written: "not run"; its outcome, its summary and its reasons beside it: its verdict; an outcome not JSON: unreadable', async () => {
    const judge = liveJudge('x verdict', 'r');
    expect(await judge({ dir, fs: nodeFs })).toEqual(['x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: not run)']);
    writeFileSync(join(dir, 'r.outcome.json'), JSON.stringify({ live: ok, rejudge: ok }));
    writeFileSync(join(dir, 'r.rejudge.txt'), `${header}\n`);
    expect(await judge({ dir, fs: nodeFs })).toEqual(["x verdict: INCONCLUSIVE — r: main's rejudge exit 0, its failure reasons unread (r.rejudge.json): read r.rejudge.txt"]);
    writeFileSync(join(dir, 'r.rejudge.json'), failuresJson([]));
    expect(await judge({ dir, fs: nodeFs })).toEqual([`x verdict: PASS — r: main's rejudge exit 0 (${header})`]);
    writeFileSync(join(dir, 'r.outcome.json'), JSON.stringify({ live: ok, rejudge: judged }));
    writeFileSync(join(dir, 'r.rejudge.json'), failuresJson(['MISMATCH a']));
    expect(await judge({ dir, fs: nodeFs })).toEqual([`x verdict: FAIL — r: main's rejudge exit 1 — MISMATCH a (${header})`]);
    writeFileSync(join(dir, 'r.rejudge.json'), '{"failures":');
    expect(await judge({ dir, fs: nodeFs })).toEqual(["x verdict: INCONCLUSIVE — r: main's rejudge exit 1, its failure reasons unread (r.rejudge.json): read r.rejudge.txt"]);
    writeFileSync(join(dir, 'r.outcome.json'), 'not json');
    expect(await judge({ dir, fs: nodeFs })).toEqual(['x verdict: INCONCLUSIVE — r: its outcome file r.outcome.json is unreadable']);
  });
});

describe('liveJudge over summarize\'s own output: the reasons the rejudge writes, named — the prose grep missed some, named others', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'batch-standing-'))), 'judged');
    mkdirSync(dir);
  });
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  /** The block's folder as a run and its rejudge (live.ts --failures) leave it over these results; its judge's line. */
  async function judged(results: LiveResult[], premise?: ChooserPremise): Promise<{ line: string; header: string; failures: string[] }> {
    const s = liveSummary('android', results, { rejudgedFrom: join(dir, 'r.json'), premise });
    writeFileSync(join(dir, 'r.outcome.json'), JSON.stringify({ live: ok, rejudge: s.exitCode === 0 ? ok : { word: 'DONE', why: 'judged' } }));
    writeFileSync(join(dir, 'r.rejudge.txt'), `${s.lines.join('\n')}\n`);
    writeFileSync(join(dir, 'r.rejudge.json'), failuresJson(s.failures));
    const [line] = await liveJudge('x verdict', 'r')({ dir, fs: nodeFs });
    return { line, header: s.lines.find((l) => l.startsWith('# Live golden:'))!, failures: s.failures };
  }
  const chooser = (id: string, verdict?: Parameters<typeof liveResult>[2]) => liveResult(id, 'uiautomator', verdict, 'chooser');

  it('an unknown MISMATCH: FAIL naming it; a SKIP and a LOUD beside it are no failure, not named', async () => {
    const r = await judged([
      chooser('lc1', { outcome: 'MISMATCH', cls: 'tap-claim', why: 'the lab not in front' }),
      chooser('lc2', { outcome: 'SKIP', why: 'unread' }),
      chooser('lc9', { outcome: 'LOUD', cls: 'loud-untouched', why: 'loud' }),
    ]);
    expect(r.header).toBe('# Live golden: 3 cases, 0 ok, 1 loud, 1 mismatches (1 not known), 1 skipped');
    expect(r.line).toBe(`x verdict: FAIL — r: main's rejudge exit 1 — MISMATCH lc1 (${r.header})`);
  });

  it('a stale chooser premise (T20a): its line and its hand line, `|`-joined — not its last-chosen WARN', async () => {
    const lines = [
      'CHOOSER PREMISE: stale — a lab default (mAlways=true) for averilab://shared — the run fails',
      'D55 (Android): a lab default: adb -s LAB-SERIAL uninstall dev.averi.lab',
      'Chooser premise: WARN — 1 last-chosen lab entry (mAlways=false: no default; no reinstall clears it), first: 9d3a2b9 dev.averi.lab/.Twin',
    ];
    const r = await judged([chooser('lc1'), chooser('lc2')], { state: 'stale', facts: [], lines });
    expect(r.line).toBe(`x verdict: FAIL — r: main's rejudge exit 1 — ${lines[0]} | ${lines[1]} (${r.header})`);
  });

  it('the hedged ceiling\'s MISMATCH (every unaimable leg hedged, live-carousel.ts): a failure the block names, its line whole', async () => {
    const r = await judged([chooser('lc1'), ...hedgedLegs('uiautomator')]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/^MISMATCH \(hedged ceiling\): hedged 3 of 3 judged unaimable leg\(s\) — .* — the run fails$/);
    expect(r.line).toBe(`x verdict: FAIL — r: main's rejudge exit 1 — ${r.failures[0]} (${r.header})`);
  });

  it('a LOUD alone — a case, or the hedged ceiling unjudged — fails nothing: main\'s rejudge exit 0, PASS', async () => {
    const r = await judged([chooser('lc1'), chooser('lc9', { outcome: 'LOUD', cls: 'loud-untouched', why: 'loud' }), ...hedgedLegs('uiautomator').slice(0, 2)]);
    expect(liveSummary('android', [...hedgedLegs('uiautomator').slice(0, 2)]).lines).toContain(
      'LOUD (hedged ceiling): hedged 2 of 2 judged unaimable leg(s) — fewer than 3 judged, the ceiling unjudged (no pass claimed)',
    );
    expect(r.failures).toEqual([]);
    expect(r.line).toBe(`x verdict: PASS — r: main's rejudge exit 0 (${r.header})`);
    expect(r.header).toMatch(/^# Live golden: 4 cases, 3 ok, 2 loud,/);
  });
});

describe('the words both batches\' hand lines and refusals share', () => {
  it('cleanStateCommand: the state file written `{"dirty":false}`, its path quoted as a shell reads it back', () => {
    expect(cleanStateCommand('/out/chooser/run-1/state.json')).toBe(`printf '%s\\n' '{"dirty":false}' > /out/chooser/run-1/state.json`);
    expect(cleanStateCommand("/o u/it's.json")).toBe(`printf '%s\\n' '{"dirty":false}' > '/o u/it'\\''s.json'`);
  });

  it('deviceInHand: the id given, or where to give it — the words runner-lines.ts\'s NO_SERIAL and NO_UDID name', () => {
    expect(deviceInHand('serial', 'emulator-5554')).toBe('emulator-5554');
    expect(deviceInHand('serial', undefined)).toBe('<the lab emulator: --serial or AVERI_LAB_SERIAL>');
    expect(deviceInHand('udid', undefined)).toBe('<the lab simulator: --udid or AVERI_LAB_UDID>');
    expect(NO_SERIAL).toBe('no lab emulator serial given (--serial or AVERI_LAB_SERIAL)');
    expect(NO_UDID).toBe('no lab simulator udid given (--udid or AVERI_LAB_UDID)');
  });

  it('noDeviceReason: the runner\'s words for the id not given, then the batch\'s device', () => {
    expect(noDeviceReason({ batch: 'lab-run', device: 'serial' })).toBe(`${NO_SERIAL}: lab-run runs on the lab emulator only`);
    expect(noDeviceReason({ batch: 'lab-run-ios', device: 'udid' })).toBe(`${NO_UDID}: lab-run-ios runs on the lab simulator only`);
  });
});

/** A SUMMARY whose every line passes (words.ts#Summary), as words.test.ts's. */
const base: Summary = {
  name: 'batch-n',
  runId: '20261104-094426-2763',
  checkout: "OK checkout: main's HEAD f7ea6e07, clean",
  labs: ['LAB android: OK — the installed APK is main\'s'],
  blocks: [
    { block: 'kf', lines: ['kf live verdict: PASS — kf1, kf2, kf3 ok'] },
    { block: 'E5', lines: ['E5 cleanup: OK — exit 5', 'E5 verdict: PASS — a PASS, c PASS'] },
  ],
  protectedLines: ["OK   com.apple.launchservices.schemeapproval's key unchanged"],
  restore: { file: 'RESTORE.txt', written: [] },
  errors: [],
};

describe('standingExitOf — a standing batch\'s exit over the same SUMMARY (A21: lab-run\'s, lab-run-ios\'s; 0 only when proven)', () => {
  const wanted = ['kf live verdict', 'E5 verdict'];
  const blocks = (lines: string[]) => [...base.blocks, { block: 'x', lines }];

  it('the codes: a batch\'s and unproven (3)', () => {
    expect(STANDING_EXIT).toEqual({ ok: 0, failed: 1, nothingDone: 2, interrupted: 130, unproven: 3 });
  });

  it('every wanted label PASS, OK and WARN lines beside, the ERROR section empty: 0', () => {
    expect(standingExitOf({ ...base, blocks: blocks([verdictLine('x check', 'WARN', 'said')]) }, wanted)).toBe(0);
    expect(standingExitOf(base, [])).toBe(0);
  });

  it('exitCodeOf\'s 1, 2 and 130 stand, whatever else the SUMMARY holds', () => {
    expect(standingExitOf({ ...base, blocks: blocks([verdictLine('x', 'FAIL'), verdictLine('y', 'INCONCLUSIVE')]) }, wanted)).toBe(1);
    expect(standingExitOf({ ...base, noneRan: true, errors: ['ERROR x'] }, wanted)).toBe(2);
    expect(standingExitOf({ ...base, interrupted: { at: '10:12:00' } }, wanted)).toBe(130);
  });

  it('unproven (3): an INCONCLUSIVE or ERROR among the blocks\', the labs\' or the protected keys\' lines', () => {
    expect(standingExitOf({ ...base, blocks: blocks([verdictLine('x check', 'INCONCLUSIVE', 'r')]) }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, blocks: blocks([verdictLine('x check', 'ERROR', 'r')]) }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, labs: [verdictLine('LAB handlers', 'ERROR', 'r')] }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, labs: [verdictLine('LAB handlers', 'INCONCLUSIVE', 'r')] }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, protectedLines: [verdictLine('key', 'ERROR', 'unread')] }, wanted)).toBe(3);
  });

  it('unproven (3): any line in the ERROR section — an ERROR, or a log not read (what it held is not known)', () => {
    expect(standingExitOf({ ...base, errors: ['10:15:00 ERROR forms live android-forms (exit 2)'] }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, errors: ['NOTE forms/x.log not read: unreadable'] }, wanted)).toBe(3);
  });

  it('unproven (3): a wanted label with no PASS line — another verdict, or no line of it', () => {
    const kfSkip = [{ block: 'kf', lines: [verdictLine('kf live verdict', 'SKIP', 'x')] }, base.blocks[1]];
    expect(standingExitOf({ ...base, blocks: kfSkip }, wanted)).toBe(3);
    expect(standingExitOf({ ...base, blocks: [base.blocks[1]] }, wanted)).toBe(3);
    expect(standingExitOf(base, [...wanted, 'forms verdict'])).toBe(3);
  });
});

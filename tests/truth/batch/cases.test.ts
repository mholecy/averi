import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOT_STARTED, TIMED_OUT } from '../../../scripts/truth/batch/bounded.js';
import { completeness, incompleteLine, runFiles, runsIn, selectorOf, stepOutcome, writeCases, type Asked, type LiveCases, type Selector } from '../../../scripts/truth/batch/cases.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import { exitCodeOf, parseVerdictLine, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/cases.ts: what a live run was asked (`<name>.cases`, written before the run's health check), the
// judged exit-1 rule, and when a run counts — b11-analyze.ts's completeness rule. Real files in a temp dir; a fake
// selector stands in for main's live-cases.ts, which tests/truth/batch/cases-live.test.ts reads for real (kept apart:
// the mutation run's sandbox holds only scripts/truth/batch/).

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-cases-'));
});
afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const KF: Asked = { platform: 'android', app: 'native', kind: 'new', sources: ['uiautomator'], cases: ['kf1', 'kf2', 'kf3'] };
/** A fake selector: the ids main's selectCases would pick for each source. */
const picks =
  (bySource: Record<string, string[]>): Selector =>
  async (_asked, source) =>
    bySource[source] ?? [];
const select = picks({ uiautomator: ['kf1', 'kf2', 'kf3'], wda: ['p7w', 'b1d'], idb: ['p7'] });

/** live.ts's log and rejudge summary of a run, as summarize writes them: the header, `## <source>`, one line per case. */
const summaryOf = (bySource: Record<string, string[]>, header = true): string =>
  [
    '<!-- averi: this checkout -->',
    ...(header ? [`${LIVE_GOLDEN_HEADER} 3 cases, 3 ok, 0 loud, 0 mismatches (0 not known), 0 skipped`] : []),
    '',
    ...Object.entries(bySource).flatMap(([src, ids]) => [`## ${src}`, ...ids.map((id, i) => `- ${['ok', 'MISMATCH (moved)', 'SKIP', 'LOUD'][i % 4]} ${id} form-cell: says — why`), '']),
  ].join('\n');

/** A whole run beside its .cases: the record, the log and the summary, each overridable (null: not written). */
function putRun(name: string, files: { cases?: string | null; record?: string | null; log?: string | null; summary?: string | null } = {}) {
  const f = runFiles(dir, name);
  const write = (path: string, text: string | null | undefined, dflt: string) => {
    if (text !== null) writeFileSync(path, text ?? dflt);
  };
  write(f.cases, files.cases, JSON.stringify(KF));
  write(f.record, files.record, '{"platform":"android","side":"this checkout","results":[]}');
  write(f.log, files.log, summaryOf({ uiautomator: ['kf1', 'kf2', 'kf3'] }));
  write(f.summary, files.summary, summaryOf({ uiautomator: ['kf1', 'kf2', 'kf3'] }));
}
const judge = (name: string, s: Selector = select) => completeness({ fs: nodeFs, dir, name, select: s });

describe('writeCases — what a run was asked, written before anything of it runs (batch-9; batch-11.sh:420–431, batch-12.sh:276–278)', () => {
  it('writes <name>.cases as JSON, and returns its path; nothing else is written', () => {
    const path = writeCases(nodeFs, dir, 'android-kf-1', KF);
    expect(path).toBe(join(dir, 'android-kf-1.cases'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(KF);
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
    expect(readdirSync(dir)).toEqual(['android-kf-1.cases']);
  });

  it('any JSON object a block asks (batch-12\'s E5 wrote `{"runs":3}`)', () => {
    writeCases(nodeFs, dir, 'a', { runs: 3 });
    expect(readFileSync(join(dir, 'a.cases'), 'utf8')).toBe('{"runs":3}\n');
  });

  it('never overwritten: a second .cases of the same name throws, the first kept (a run folder is never reused)', () => {
    writeCases(nodeFs, dir, 'kf-1', KF);
    expect(() => writeCases(nodeFs, dir, 'kf-1', { runs: 1 })).toThrow(/kf-1\.cases already exists: what a run was asked is never overwritten/);
    expect(JSON.parse(readFileSync(join(dir, 'kf-1.cases'), 'utf8'))).toEqual(KF);
  });

  it('a name that is no plain path segment is refused: its files cannot leave the block\'s folder', () => {
    for (const bad of ['', '../x', 'a/b', '.hidden', 'a b', 'a.b']) expect(() => writeCases(nodeFs, dir, bad, KF), bad).toThrow(/one plain path segment/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a .cases that cannot be written for another reason throws that reason, never "already exists"', () => {
    chmodSync(dir, 0o500);
    expect(() => writeCases(nodeFs, dir, 'kf-1', KF)).toThrow(/EACCES/);
  });
});

describe('runFiles and runsIn — a run\'s four files, and the runs a block folder asked', () => {
  it('runFiles: <name>.cases, .json (live.ts --record), .log, .rejudge.txt', () => {
    expect(runFiles('d', 'x')).toEqual({ cases: join('d', 'x.cases'), record: join('d', 'x.json'), log: join('d', 'x.log'), summary: join('d', 'x.rejudge.txt') });
  });

  it('runsIn: every .cases\'s name, sorted; a record without one (ime.json, d62.json) is no run; a missing folder has none', () => {
    putRun('android-kf-2');
    putRun('android-kf-1');
    writeFileSync(join(dir, 'ime.json'), '{}');
    writeFileSync(join(dir, 'x.cases.bak'), '{}');
    expect(runsIn(nodeFs, dir)).toEqual(['android-kf-1', 'android-kf-2']);
    expect(runsIn(nodeFs, join(dir, 'nope'))).toEqual([]);
  });
});

describe('stepOutcome — the judged exit-1 rule (batch-10 → batch-12\'s STEP_EXIT1=judged), with why', () => {
  const golden = `<!-- averi -->\n${LIVE_GOLDEN_HEADER} 3 cases\n`;
  it('exit 0: OK', () => {
    expect(stepOutcome(0, '')).toEqual({ word: 'OK', why: 'exit 0' });
  });

  it('exit 1 with live.ts\'s `# Live golden:` line in its log: DONE, its analyzer judges', () => {
    expect(stepOutcome(1, golden)).toEqual({ word: 'DONE', why: 'exit 1: a MISMATCH or a known case off, judged by the analyzer' });
  });

  it('exit 1 without it: FAIL — live.ts died before judging', () => {
    expect(stepOutcome(1, 'Error: no device\n')).toEqual({ word: 'FAIL', why: 'exit 1 with no `# Live golden:` line in its log: live.ts did not finish' });
  });

  it('142 named as its bound passed, 127 as not started, any other exit by its code — FAIL whatever the log says', () => {
    expect(stepOutcome(TIMED_OUT, golden)).toEqual({ word: 'FAIL', why: 'timed out (exit 142: past its bound)' });
    expect(stepOutcome(NOT_STARTED, golden)).toEqual({ word: 'FAIL', why: 'not started (exit 127)' });
    expect(stepOutcome(2, golden)).toEqual({ word: 'FAIL', why: 'exit 2' });
    expect(stepOutcome(130, '')).toEqual({ word: 'FAIL', why: 'exit 130' });
  });
});

describe('completeness — a run counts only when complete (b11-analyze.ts:1–23, batch-9\'s "never an invisible gap")', () => {
  it('complete: its .cases, a record, `# Live golden:` in its log and its summary, every case main picks there: ok, with what it asked', async () => {
    putRun('kf-1');
    expect(await judge('kf-1')).toEqual({ ok: true, asked: KF });
  });

  it('asked but never ran (a .cases alone): INCONCLUSIVE, never a missing line — the batch-9 finding', async () => {
    putRun('kf-1', { record: null, log: null, summary: null });
    expect(await judge('kf-1')).toEqual({ ok: false, why: 'asked but never ran (no record, log or summary beside its .cases)' });
  });

  it('no .cases at all, and nothing else: never ran', async () => {
    expect(await judge('kf-9')).toEqual({ ok: false, why: 'never ran (no .cases, record, log or summary)' });
  });

  it('no .cases beside a record: what it was asked is unknown — the cases not checked, the rest still read', async () => {
    putRun('kf-1', { cases: null, log: 'crashed\n' });
    expect(await judge('kf-1')).toEqual({ ok: false, why: "no kf-1.cases: what it was asked is unknown; kf-1.log has no `# Live golden:` line (live.ts did not finish)" });
  });

  it('a .cases that is no JSON, or not what a live run is asked (platform, app, sources, cases): named', async () => {
    putRun('a', { cases: '{"platform":' });
    putRun('b', { cases: '{"runs":3}' });
    putRun('c', { cases: JSON.stringify({ ...KF, platform: 'web' }) });
    putRun('d', { cases: JSON.stringify({ ...KF, sources: [] }) });
    putRun('e', { cases: JSON.stringify({ ...KF, cases: [1] }) });
    putRun('f', { cases: '[]' });
    putRun('g', { cases: 'null' });
    putRun('h', { cases: JSON.stringify({ ...KF, app: 3 }) });
    expect(await judge('a')).toEqual({ ok: false, why: 'a.cases is no JSON' });
    const shape = "is not what a live run is asked (platform ios or android, app, sources: one at least, cases: ids)";
    for (const n of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) expect(await judge(n), n).toEqual({ ok: false, why: `${n}.cases ${shape}` });
  });

  it('an empty cases list is valid: every case main picks for the source must be there', async () => {
    putRun('all', { cases: JSON.stringify({ ...KF, cases: [] }) });
    expect(await judge('all')).toEqual({ ok: true, asked: { ...KF, cases: [] } });
  });

  it('a .cases there but unreadable (a folder by that name): named as unreadable, not as missing', async () => {
    mkdirSync(runFiles(dir, 'kf-1').cases);
    putRun('kf-1', { cases: null });
    expect(await judge('kf-1')).toEqual({ ok: false, why: 'kf-1.cases is unreadable' });
  });

  it('no record, an unreadable one, or one that is no JSON (live.ts died writing it): named', async () => {
    putRun('a', { record: null });
    putRun('b', { record: '{"platform"' });
    putRun('c', { record: null });
    mkdirSync(runFiles(dir, 'c').record);
    expect(await judge('a')).toEqual({ ok: false, why: 'no record (a.json)' });
    expect(await judge('b')).toEqual({ ok: false, why: 'its record (b.json) is no JSON' });
    expect(await judge('c')).toEqual({ ok: false, why: 'its record (c.json) is unreadable' });
  });

  it('the log: missing, unreadable, or without `# Live golden:` at a line\'s start — named as the log', async () => {
    putRun('a', { log: null });
    putRun('b', { log: 'x # Live golden: 3 cases\n' });
    putRun('c', { log: null });
    mkdirSync(runFiles(dir, 'c').log);
    expect(await judge('a')).toEqual({ ok: false, why: 'no live run log (a.log)' });
    expect(await judge('b')).toEqual({ ok: false, why: 'b.log has no `# Live golden:` line (live.ts did not finish)' });
    expect(await judge('c')).toEqual({ ok: false, why: 'c.log is unreadable' });
  });

  it('the summary: missing, unreadable, or without the header — named as the summary; its cases then not counted', async () => {
    putRun('a', { summary: null });
    putRun('b', { summary: summaryOf({ uiautomator: ['kf1', 'kf2', 'kf3'] }, false) });
    putRun('c', { summary: null });
    mkdirSync(runFiles(dir, 'c').summary);
    expect(await judge('a')).toEqual({ ok: false, why: 'no rejudge summary (a.rejudge.txt)' });
    expect(await judge('b')).toEqual({ ok: false, why: 'b.rejudge.txt has no `# Live golden:` line (the rejudge did not finish)' });
    expect(await judge('c')).toEqual({ ok: false, why: 'c.rejudge.txt is unreadable' });
  });

  it('a case main picks missing from the summary, per source: every id named, under its source; an ok, a MISMATCH, a SKIP and a LOUD all count as there', async () => {
    const asked: Asked = { platform: 'ios', app: 'native', sources: ['idb', 'wda'], cases: ['p7', 'p7w', 'b1d'] };
    putRun('ios-1', { cases: JSON.stringify(asked), summary: summaryOf({ wda: ['p7w'], idb: ['b1d'] }) });
    expect(await judge('ios-1')).toEqual({ ok: false, why: 'idb: p7 missing from the summary; wda: b1d missing from the summary' });
    putRun('ios-2', { cases: JSON.stringify(asked), summary: summaryOf({ idb: ['p7'], wda: ['p7w', 'b1d', 'b7', 'x'] }) });
    expect(await judge('ios-2')).toEqual({ ok: true, asked });
  });

  it('a case line under another source, or a line not in summarize\'s shape, does not count', async () => {
    const text = [`${LIVE_GOLDEN_HEADER} x`, '## wda', '- ok kf1 c: s', '## uiautomator', '- ok kf2: s', '- fine kf3 c: s', '  - ok kf3 c: s', '- ok (cls kf3 c: s'].join('\n');
    putRun('kf-1', { summary: text });
    expect(await judge('kf-1')).toEqual({ ok: false, why: 'uiautomator: kf1, kf2, kf3 missing from the summary' });
  });

  it('a line with its class in parentheses counts by its id', async () => {
    putRun('kf-1', { summary: [`${LIVE_GOLDEN_HEADER} x`, '## uiautomator', '- MISMATCH (moved) kf1 c: s', '- LOUD (refused) kf2 c: s', '- SKIP kf3 c: s'].join('\n') });
    expect(await judge('kf-1')).toEqual({ ok: true, asked: KF });
  });

  it('every gap at once, in order: the .cases, the record, the log, the summary, the missing cases', async () => {
    putRun('kf-1', { record: 'x', log: 'died\n', summary: [`${LIVE_GOLDEN_HEADER} x`, '## uiautomator', '- ok kf1 c: s'].join('\n') });
    expect(await judge('kf-1')).toEqual({ ok: false, why: 'its record (kf-1.json) is no JSON; kf-1.log has no `# Live golden:` line (live.ts did not finish); uiautomator: kf2, kf3 missing from the summary' });
  });

  it('a selector that throws (main\'s table unreadable) is a gap, named; never thrown', async () => {
    putRun('kf-1');
    expect(await judge('kf-1', () => Promise.reject(new Error('import failed\nstack')))).toEqual({ ok: false, why: 'the cases main picks could not be read (import failed)' });
  });

  it('the selector is asked once per source, with what was asked', async () => {
    const asked: [Asked, string][] = [];
    putRun('ios-1', { cases: JSON.stringify({ ...KF, platform: 'ios', sources: ['idb', 'wda'] }), summary: summaryOf({ idb: [], wda: [] }) });
    await judge('ios-1', async (a, s) => (asked.push([a, s]), []));
    expect(asked.map(([a, s]) => [a.platform, s])).toEqual([['ios', 'idb'], ['ios', 'wda']]);
  });

  it('a name that is no plain path segment is refused', async () => {
    await expect(judge('../x')).rejects.toThrow(/one plain path segment/);
  });

  it('with no fs given, the real filesystem', async () => {
    putRun('kf-1');
    expect(await completeness({ dir, name: 'kf-1', select })).toEqual({ ok: true, asked: KF });
  });
});

describe('selectorOf — main\'s selectCases per source, as b11-analyze.ts#selectorOf (Case.sources honoured)', () => {
  const cases = [{ id: 'p7', sources: ['idb', 'uiautomator'] }, { id: 'p7w', sources: ['wda'] }, { id: 'b1d' }];
  const live = (seen: unknown[]): LiveCases => ({ selectCases: async (s) => (seen.push(s), cases), catalogOf: async () => ({ cells: [] }) });

  it('the ids of the cases picked whose sources hold this one, or that name none', async () => {
    const seen: unknown[] = [];
    const s = selectorOf(live(seen));
    expect(await s(KF, 'wda')).toEqual(['p7w', 'b1d']);
    expect(await s(KF, 'idb')).toEqual(['p7', 'b1d']);
    expect(seen[0]).toEqual({ platform: 'android', app: 'native', groups: ['forms'], only: ['kf1', 'kf2', 'kf3'] });
  });

  it('no case asked: every case of the groups (no `only`); the groups the .cases names, else forms', async () => {
    const seen: unknown[] = [];
    await selectorOf(live(seen))({ ...KF, cases: [], groups: ['forms', 'ensure'] }, 'idb');
    expect(seen[0]).toEqual({ platform: 'android', app: 'native', groups: ['forms', 'ensure'] });
  });
});

describe('incompleteLine — the block\'s INCONCLUSIVE when a run is not complete, or none was asked', () => {
  it('every run complete: no line', () => {
    expect(incompleteLine('kf live verdict', [{ name: 'a', result: { ok: true, asked: KF } }])).toBeUndefined();
  });

  it('no run asked (no .cases in its folder): INCONCLUSIVE, not run — never no line at all', () => {
    expect(incompleteLine('kf live verdict', [])).toBe('kf live verdict: INCONCLUSIVE — not run: no .cases in its folder (nothing was asked)');
  });

  it('some incomplete: how many of how many, then each one\'s name and why, ` | ` between them', () => {
    const line = incompleteLine('kf live verdict', [
      { name: 'android-kf-1', result: { ok: false, why: 'asked but never ran (x)' } },
      { name: 'android-kf-2', result: { ok: true, asked: KF } },
      { name: 'android-kf-3', result: { ok: false, why: 'no record (android-kf-3.json); y' } },
    ]);
    expect(line).toBe('kf live verdict: INCONCLUSIVE — 2 of 3 run(s) incomplete: android-kf-1 — asked but never ran (x) | android-kf-3 — no record (android-kf-3.json); y');
    expect(parseVerdictLine(line ?? '')?.verdict).toBe('INCONCLUSIVE');
  });

  it('the exit rule reads it as no FAIL', () => {
    const line = incompleteLine('kf live verdict', [{ name: 'a', result: { ok: false, why: 'FAIL' } }]) ?? '';
    const s: Summary = { name: 'b', runId: '1', checkout: 'OK checkout: x', labs: [], blocks: [{ block: 'kf', lines: [line] }], protectedLines: [], restore: { file: 'R', written: [] }, errors: [] };
    expect(exitCodeOf(s)).toBe(0);
  });
});

import { execFile, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import type { GoldenCheck, GoldenJson } from '../differential/golden.js';

/**
 * Phase 3's calibration (docs/plans/2026-10-15-ground-truth-lab-app.md): golden must fail on the commit before a
 * note's fix and pass after it. For each note of scripts/truth/calibration.json that names golden rows, golden runs
 * (`--only` the rows' captures, `--json`) with THIS checkout's harness and truth over the src of the note's before and
 * after commits (side.ts loads an older src as it is), and each note gets a verdict:
 *
 *   CALIBRATED            every named row red before, green after
 *   CALIBRATED-ON-DEFECT  every row red before WITH the note's defect (`defect`, a pattern of the mismatch); after, the
 *                         defect is gone but the row stays red for another class (e.g. "not in the tree")
 *   DOES-NOT-FAIL         a row green before (or red without the defect): a hole in the truth or the spec table
 *   STILL-RED-AFTER       a row still red after (with the defect, when one is named)
 *   OPEN-RED              an open note (no fix): every row red at HEAD (with the defect)
 *   OPEN-NOT-REPRODUCED   an open note with a row green at HEAD
 *   NOT-ASKED             a named row the run did not ask (a wrong key, or a cell that went broken)
 *   SIDE-DOES-NOT-LOAD    golden could not run over that commit's src — the reason is reported
 *
 *   node --import tsx scripts/truth/calibrate.ts --worktrees <dir> [--note <n>[,<n>…]] [--out docs/truth/calibration.md] [--remove]
 *
 * The checkouts (checkout.ts, `differential-cal-<sha>` under --worktrees) are kept for the next run; --remove removes
 * every checkout this run used.
 * Exit code 1 when a note's verdict is not the one it expects (`expect`; CALIBRATED, or OPEN-RED for an open note).
 */

export type Verdict =
  | 'CALIBRATED'
  | 'CALIBRATED-ON-DEFECT'
  | 'DOES-NOT-FAIL'
  | 'STILL-RED-AFTER'
  | 'OPEN-RED'
  | 'OPEN-NOT-REPRODUCED'
  | 'NOT-ASKED'
  | 'SIDE-DOES-NOT-LOAD';

export const STATUSES = /^(calibrate|open|residual:.+|needs-cell:(edges|presented|bars|false-covers|forms)|needs-2b|needs-live|needs-ocr)$/;

export interface Regression {
  rows: string;
  broke: string;
  fixed?: string;
  why: string;
}

export interface CalibrationEntry {
  /** The analysis' number (1–36), FE1/FE2 (field errors), L1/L2 (lab findings). */
  n: string;
  /** The note's file name in docs/bugs. */
  note: string;
  status: string;
  fix?: string[];
  before?: string;
  /** The commit judged green: a fix commit (usually the first). */
  after?: string;
  verified?: 'golden' | 'merge-subject' | 'unverified';
  /** Golden rows, `<run>/<file> <target> <verb>` as tests/differential/golden.test.ts keys them. */
  checks?: string[];
  /** A pattern the mismatch carries when the note's defect is what makes the row red. */
  defect?: string;
  expect?: Verdict;
  needs?: string;
  regressions?: Regression[];
  remark?: string;
}

export interface Calibration {
  corpus: string;
  notes: CalibrationEntry[];
  excluded: { note: string; why: string }[];
}

/** A row's key, as the calibration table and golden.test.ts's KNOWN name it. */
export const keyOf = (c: Pick<GoldenCheck, 'recording' | 'target' | 'verb'>) => `${c.recording} ${c.target} ${c.verb}`;
/** The capture a row key names (`<run>/<file>`). */
export const captureOf = (key: string) => key.slice(0, key.indexOf(' '));

/** What one side answered: its checks by key, or why it did not load. */
export type SideRun = { checks: Map<string, GoldenCheck> } | { error: string };

export const expected = (e: CalibrationEntry): Verdict => e.expect ?? (e.status === 'open' ? 'OPEN-RED' : 'CALIBRATED');

/** The verdict for one note from its rows at before and after (or at HEAD, `after` unused, for an open note). */
export function verdictOf(e: CalibrationEntry, before: SideRun, after?: SideRun): Verdict {
  const rows = e.checks ?? [];
  if ('error' in before || (after !== undefined && 'error' in after)) return 'SIDE-DOES-NOT-LOAD';
  const defect = e.defect === undefined ? undefined : new RegExp(e.defect);
  const red = (c: GoldenCheck) => c.mismatch !== undefined && (defect === undefined || defect.test(c.mismatch));
  const at = (run: { checks: Map<string, GoldenCheck> }, k: string) => run.checks.get(k);
  if (rows.some((k) => at(before, k) === undefined || (after !== undefined && at(after, k) === undefined))) return 'NOT-ASKED';
  if (e.status === 'open') return rows.every((k) => red(at(before, k)!)) ? 'OPEN-RED' : 'OPEN-NOT-REPRODUCED';
  if (after === undefined) throw new Error(`calibrate: note ${e.n} has no after side`);
  if (!rows.every((k) => red(at(before, k)!))) return 'DOES-NOT-FAIL';
  if (rows.some((k) => red(at(after, k)!))) return 'STILL-RED-AFTER';
  return rows.every((k) => at(after, k)!.mismatch === undefined) ? 'CALIBRATED' : 'CALIBRATED-ON-DEFECT';
}

/** The sides to run and the captures each must replay: per commit (or 'HEAD'), the union over the notes that need it. */
export function plan(entries: readonly CalibrationEntry[]): Map<string, Set<string>> {
  const sides = new Map<string, Set<string>>();
  const need = (side: string, keys: readonly string[]) => {
    const set = sides.get(side) ?? new Set<string>();
    for (const k of keys) set.add(captureOf(k));
    sides.set(side, set);
  };
  for (const e of entries) {
    if (e.checks === undefined || e.checks.length === 0) continue;
    if (e.status === 'open') need('HEAD', e.checks);
    else {
      if (e.before === undefined || e.after === undefined) throw new Error(`calibrate: note ${e.n} names rows but no before/after commit`);
      need(e.before, e.checks);
      need(e.after, e.checks);
    }
  }
  return sides;
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim() !== '' && !/^\d+\/\d+ asserts|^All \d+ asserts/.test(l))?.slice(0, 220) ?? '';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export interface NoteResult {
  entry: CalibrationEntry;
  verdict?: Verdict;
  before?: SideRun;
  after?: SideRun;
}

/** docs/truth/calibration.md: the summary table, then per note its rows at both sides — a red row's mismatch, a green row's reply. */
export function calibrationReport(results: readonly NoteResult[]): string {
  const lines = [
    '# Calibration on the bug notes',
    '',
    'Generated by `scripts/truth/calibrate.ts` from `scripts/truth/calibration.json` — do not edit. Golden (this',
    "checkout's harness, spec and truth) replayed over each note's before and after commit; see the script for the verdicts.",
    '',
    '| # | note | status | before → after | verdict |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    const e = r.entry;
    const sides = e.status === 'open' ? 'HEAD' : e.before === undefined ? '—' : `${e.before} → ${e.after ?? e.fix?.join(', ') ?? '?'}`;
    const verdict = r.verdict === undefined ? '—' : r.verdict === expected(e) ? r.verdict : `**${r.verdict}** (expected ${expected(e)})`;
    lines.push(`| ${e.n} | ${e.note.replace(/\.md$/, '')} | ${e.status} | ${sides} | ${verdict} |`);
  }
  lines.push('');
  for (const r of results) {
    if (r.verdict === undefined) continue;
    const e = r.entry;
    lines.push(`## ${e.n}: ${r.verdict}`, '', `${e.note}${e.defect === undefined ? '' : ` — defect: \`${e.defect}\``}`, '');
    for (const [label, run] of [
      [e.status === 'open' ? 'HEAD' : `before ${e.before}`, r.before],
      ...(e.status === 'open' ? [] : [[`after ${e.after}`, r.after] as const]),
    ] as const) {
      if (run === undefined) continue;
      if ('error' in run) {
        lines.push(`- ${label}: side does not load — ${run.error}`);
        continue;
      }
      lines.push(`- ${label}:`);
      for (const k of e.checks ?? []) {
        const c = run.checks.get(k);
        lines.push(c === undefined ? `  - ${k}: not asked` : c.mismatch === undefined ? `  - ok ${k} — ${cell(firstLine(c.reply))}` : `  - RED ${k} — ${cell(c.mismatch.slice(0, 260))}`);
      }
    }
    if (e.needs !== undefined) lines.push('', `Needs: ${e.needs}`);
    if (e.remark !== undefined) lines.push('', e.remark);
    lines.push('');
  }
  const skipped = results.filter((r) => r.verdict === undefined);
  if (skipped.length > 0) {
    lines.push('## Not reproducible with the existing cells', '');
    for (const r of skipped) lines.push(`- ${r.entry.n} ${r.entry.note}: ${r.entry.status}${r.entry.needs === undefined ? '' : ` — ${r.entry.needs}`}`);
    lines.push('');
  }
  return lines.join('\n');
}

// --- the command line ---

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { worktrees: { type: 'string' }, note: { type: 'string' }, out: { type: 'string' }, remove: { type: 'boolean' } },
  });
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const table = JSON.parse(await readFile(join(repo, 'scripts/truth/calibration.json'), 'utf8')) as Calibration;
  const only = values.note?.split(',').map((s) => s.trim());
  const entries = table.notes.filter((e) => only === undefined || only.includes(e.n));
  if (only !== undefined && entries.length !== only.length) throw new Error(`calibrate --note: ${only.filter((n) => !entries.some((e) => e.n === n)).join(', ')} is no note of the table`);
  const { codeRoot } = await import('../differential/checkout.js');
  const worktrees = resolve(values.worktrees ?? join(tmpdir(), 'averi-calibration'));
  const run = promisify(execFile);
  const runs = new Map<string, SideRun>();
  const checkouts: string[] = [];
  for (const [side, captures] of plan(entries)) {
    const started = Date.now();
    let root: string;
    try {
      root = side === 'HEAD' ? repo : codeRoot(repo, side, 'cal', worktrees).root;
      if (side !== 'HEAD') checkouts.push(root);
    } catch (e) {
      runs.set(side, { error: `no checkout: ${(e as Error).message.split('\n')[0]}` });
      continue;
    }
    const args = ['--import', 'tsx', join(repo, 'scripts/differential/golden.ts'), '--corpus', join(repo, table.corpus), '--side', root, '--only', [...captures].join(','), '--json'];
    let stdout = '';
    let error: string | undefined;
    try {
      stdout = (await run(process.execPath, args, { cwd: repo, maxBuffer: 64 << 20 })).stdout;
    } catch (e) {
      // golden exits 1 on any mismatch — its JSON is still on stdout; no JSON means the side did not load.
      const err = e as { stdout?: string; stderr?: string; message: string };
      stdout = err.stdout ?? '';
      error = (err.stderr ?? err.message).split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2).join(' ') || err.message.split('\n')[0];
    }
    const json = stdout.trim().split('\n').at(-1) ?? '';
    try {
      const parsed = JSON.parse(json) as GoldenJson;
      runs.set(side, { checks: new Map(parsed.results.flatMap((r) => r.checks).map((c) => [keyOf(c), c])) });
    } catch {
      runs.set(side, { error: error ?? `no JSON from golden: ${json.slice(0, 200)}` });
    }
    console.error(`calibrate: ${side} ${'error' in runs.get(side)! ? 'DID NOT LOAD' : 'ran'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const results: NoteResult[] = entries.map((entry) => {
    if (entry.checks === undefined || entry.checks.length === 0) return { entry };
    const before = runs.get(entry.status === 'open' ? 'HEAD' : entry.before!)!;
    const after = entry.status === 'open' ? undefined : runs.get(entry.after!)!;
    return { entry, before, after, verdict: verdictOf(entry, before, after) };
  });
  const report = calibrationReport(results);
  if (values.out !== undefined) await writeFile(resolve(values.out), report);
  else console.log(report);
  for (const r of results) if (r.verdict !== undefined) console.error(`${r.entry.n.padEnd(4)} ${r.verdict}${r.verdict === expected(r.entry) ? '' : ` (expected ${expected(r.entry)})`}`);
  if (values.remove === true) for (const root of checkouts) execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', root], { stdio: 'ignore' });
  if (results.some((r) => r.verdict !== undefined && r.verdict !== expected(r.entry))) process.exitCode = 1;
}

import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import type { GoldenCheck, GoldenJson } from '../differential/golden.js';
import { runSide, sideLine, type SideDeps } from './calibrate-run.js';
import { calibrationReport, verdictCell } from './calibration-report.js';
import { FAMILIES } from './schema.js';

/**
 * Phase 3's calibration (docs/plans/2026-10-15-ground-truth-lab-app.md): golden must fail on the commit before a
 * note's fix and pass after it. Golden runs (`--json`, the whole truth corpus) with THIS checkout's harness and truth
 * over the src of every before and after commit the notes of scripts/truth/calibration.json name (side.ts loads an
 * older src as it is), and each note that names golden rows gets a verdict from its rows:
 *
 *   CALIBRATED            every named row red before WITH the note's defect (`defect`: the note's own symptom, a
 *                         pattern of the row's mismatch or of its reply where the mismatch quotes only its start),
 *                         green after
 *   CALIBRATED-ON-DEFECT  red before with the defect; after, the defect is gone but a row stays red for another class
 *                         (e.g. "not in the tree")
 *   DOES-NOT-FAIL         a row green before, or red without the defect: a hole in the truth, the spec table or
 *                         the cells
 *   STILL-RED-AFTER       a row still red after with the defect
 *   OPEN-RED              an open note (no fix): every row red with the defect in the working tree
 *   OPEN-NOT-REPRODUCED   an open note with a row green, or red without the defect, in the working tree
 *   NOT-ASKED             a named row the run did not ask (a wrong key, or a cell that went broken)
 *   SIDE-DOES-NOT-LOAD    golden could not run over that commit's src, or its run fails the canary (`sideRunOf`: a
 *                         harness or JavaScript error in a reply, a device command the fake does not model, or the
 *                         `open` cell not green) — the reason is reported
 *
 * Every row of the corpus is compared too: a row green before and red after that the note does not name has REGRESSED
 * ELSEWHERE at the fix — reported with the verdict, and unexpected unless the note's `regressions` records it (`broke`
 * the after commit, the row in `rows`).
 *
 *   node --import tsx scripts/truth/calibrate.ts --worktrees <dir> [--note <n>[,<n>…]]
 *     [--out docs/truth/calibration.md] [--remove]
 *
 * The checkouts (checkout.ts, `differential-cal-<sha>` under --worktrees) are kept for the next run; --remove removes
 * the checkouts THIS run created (one found in place stays). An open note is judged on the working tree — this checkout
 * as it is on disk, uncommitted changes included.
 * Exit code 1 when a note's verdict is not the one it expects (`expect`; CALIBRATED, or OPEN-RED for an open note), or
 * a note regressed elsewhere unrecorded. A golden process that printed no JSON or was killed is run once more
 * (calibrate-run.ts#runSide; said on the console only, so the report stays the same); a side that still does not load
 * carries why — the exit code or signal and the last lines of stderr, or git's own stderr for a checkout that failed.
 * While a side does not load where its note does not expect it, --out leaves its file as it is and writes
 * `<out>.failed`; with --note, which runs some notes only, it writes `<out>.partial` (disposition).
 *
 * This module holds the model (the table's shape, the canary, the verdicts, the disposition) and the command line;
 * calibrate-run.ts runs a side, calibration-report.ts renders docs/truth/calibration.md.
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

export const VERDICTS: readonly Verdict[] = [
  'CALIBRATED',
  'CALIBRATED-ON-DEFECT',
  'DOES-NOT-FAIL',
  'STILL-RED-AFTER',
  'OPEN-RED',
  'OPEN-NOT-REPRODUCED',
  'NOT-ASKED',
  'SIDE-DOES-NOT-LOAD',
];

/** A note's status: `needs-cell:<family>` names a family of schema.ts#FAMILIES. */
export const STATUSES = new RegExp(`^(calibrate|open|residual:.+|needs-cell:(${FAMILIES.join('|')})|needs-2b|needs-live|needs-ocr)$`);

export interface Regression {
  /** The rows that went red, keyed as `checks`. */
  rows: string[];
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
  /** The commit judged green: a fix commit (usually the first) — or, with `afterNotFix`, the commit that cured the cell. */
  after?: string;
  /**
   * Why `after` is none of the note's `fix` commits: the note's fix cured the device's tree but not the lab cell's
   * shape, which a later commit cured (#27, #28: 15896c5 fixed the device trees; the lab's SwiftUI shapes are green from
   * 41c394a). The report says so beside the sides, so the table never reads as if the note's fix were verified.
   */
  afterNotFix?: string;
  verified?: 'golden' | 'merge-subject' | 'unverified';
  /**
   * Golden rows, `<run>/<file> <target> <verb>` as the ratchet keys them (tests/differential/golden/<family>.known.ts).
   */
  checks?: string[];
  /**
   * The note's own symptom, a pattern of a red row's mismatch or reply (the mismatch quotes the reply's first line
   * only): a row red before counts only when it shows it, a row red after is the note's only when it shows it.
   */
  defect?: string;
  expect?: Verdict;
  /** What of the note the rows calibrate, when not all of it (the rest is in `needs`). */
  partial?: string;
  needs?: string;
  regressions?: Regression[];
  remark?: string;
  /** The note's live calibration (phase 5): its live cases at a before and an after commit, on the lab device. */
  live?: LiveCalibration[];
}

/**
 * A live calibration (phase 5; scripts/truth/live.ts `--side`): the note's live cases run against the REAL lab app at
 * the note's before and after commits, the app's tap log, offsets and strokes the oracle — what a replayed tree cannot
 * show. Recorded by hand from the runs (a device is no vitest test): `verdict` as the golden verdicts read — CALIBRATED
 * every case not ok before with the note's defect and ok after, DOES-NOT-FAIL a case ok before — and `summary` the
 * committed live summary holding each side's replies and app state.
 */
export interface LiveCalibration {
  platform: 'ios' | 'android';
  /** The tree sources the cases ran under. */
  sources: string[];
  before: string;
  after: string;
  /** live.ts case ids (`scroll:scroll-bounded-flush.P.fully`, `turn:…`, `dismiss:…`). */
  cases: string[];
  verdict: Verdict;
  /**
   * The cases' outcome is not the same in every run of a side (a device's timing): how many runs each side had and how
   * they went — the verdict is then the one every run bears out, never the best run's.
   */
  intermittent?: string;
  /** What each side answered, briefly. */
  remark: string;
  /** The live summary (docs/truth/) holding the replies. */
  summary: string;
}

export interface Calibration {
  corpus: string;
  notes: CalibrationEntry[];
  excluded: { note: string; why: string }[];
}

/** The side an open note is judged on: this checkout as it is on disk, not its committed HEAD. */
export const WORKING_TREE = 'working tree';

/**
 * A row's key, as the calibration table and the family's KNOWN (tests/differential/golden/<family>.known.ts) name it.
 */
export const keyOf = (c: Pick<GoldenCheck, 'recording' | 'target' | 'verb'>) => `${c.recording} ${c.target} ${c.verb}`;
/** The capture a row key names (`<run>/<file>`). */
export const captureOf = (key: string) => key.slice(0, key.indexOf(' '));
/** A capture of the `open` cell — every target open, every row green on any side that works. */
export const isOpenCell = (recording: string) => /\/open\.[^/]+$/.test(recording);

/** What one side answered: its checks by key, or why it does not count as loaded. */
export type SideRun = { checks: Map<string, GoldenCheck> } | { error: string };

/**
 * One side's golden JSON as a SideRun — or not loaded, by the canary: a side miswired (a constructor taken wrong, an
 * export renamed) still prints JSON, every reply an error that a row expecting a refusal would accept. So a side counts
 * only when no check carries a fault (golden.ts#faultsOf: a harness or JavaScript error, an unmodelled device command)
 * and the `open` cell was replayed and is green.
 */
export function sideRunOf(json: GoldenJson): SideRun {
  const checks = json.results.flatMap((r) => r.checks);
  const faults = checks.flatMap((c) => (c.faults ?? []).map((f) => `${keyOf(c)}: ${f}`));
  const open = checks.filter((c) => isOpenCell(c.recording));
  if (open.length === 0) faults.push('the open cell was not replayed');
  faults.push(...open.filter((c) => c.mismatch !== undefined).map((c) => `${keyOf(c)} (open cell) red: ${c.mismatch}`));
  if (faults.length > 0) return { error: `canary: ${faults.length} fault${faults.length === 1 ? '' : 's'}; first ${faults[0].slice(0, 300)}` };
  return { checks: new Map(checks.map((c) => [keyOf(c), c])) };
}

export const expected = (e: CalibrationEntry): Verdict => e.expect ?? (e.status === 'open' ? 'OPEN-RED' : 'CALIBRATED');

/**
 * The verdict for one note from its rows at before and after (or in the working tree, `after` unused, for an open
 * note).
 */
export function verdictOf(e: CalibrationEntry, before: SideRun, after?: SideRun): Verdict {
  const rows = e.checks ?? [];
  if ('error' in before || (after !== undefined && 'error' in after)) return 'SIDE-DOES-NOT-LOAD';
  const defect = e.defect === undefined ? undefined : new RegExp(e.defect);
  const red = (c: GoldenCheck) => c.mismatch !== undefined && (defect === undefined || defect.test(c.mismatch) || defect.test(c.reply));
  const at = (run: { checks: Map<string, GoldenCheck> }, k: string) => run.checks.get(k);
  if (rows.some((k) => at(before, k) === undefined || (after !== undefined && at(after, k) === undefined))) return 'NOT-ASKED';
  if (e.status === 'open') return rows.every((k) => red(at(before, k)!)) ? 'OPEN-RED' : 'OPEN-NOT-REPRODUCED';
  if (after === undefined) throw new Error(`calibrate: note ${e.n} has no after side`);
  if (!rows.every((k) => red(at(before, k)!))) return 'DOES-NOT-FAIL';
  if (rows.some((k) => red(at(after, k)!))) return 'STILL-RED-AFTER';
  return rows.every((k) => at(after, k)!.mismatch === undefined) ? 'CALIBRATED' : 'CALIBRATED-ON-DEFECT';
}

/** The rows of the corpus, other than the note's own, green before and red after: what the fix broke elsewhere. */
export function regressedElsewhere(e: CalibrationEntry, before: SideRun, after: SideRun): string[] {
  if ('error' in before || 'error' in after) return [];
  const own = new Set(e.checks ?? []);
  return [...after.checks].filter(([k, c]) => !own.has(k) && c.mismatch !== undefined && before.checks.get(k)?.mismatch === undefined && before.checks.has(k)).map(([k]) => k);
}

/** Of `rows` regressed at the note's after commit, those its `regressions` does not record. */
export const unrecorded = (e: CalibrationEntry, rows: readonly string[]): string[] =>
  rows.filter((k) => !(e.regressions ?? []).some((r) => r.broke === e.after && r.rows.includes(k)));

/** The sides to run, each once: every before and after commit, and the working tree for an open note. */
export function plan(entries: readonly CalibrationEntry[]): string[] {
  const sides: string[] = [];
  const need = (side: string) => {
    if (!sides.includes(side)) sides.push(side);
  };
  for (const e of entries) {
    if (e.checks === undefined || e.checks.length === 0) continue;
    if (e.status === 'open') need(WORKING_TREE);
    else {
      if (e.before === undefined || e.after === undefined) throw new Error(`calibrate: note ${e.n} names rows but no before/after commit`);
      need(e.before);
      need(e.after);
    }
  }
  return sides;
}

export interface NoteResult {
  entry: CalibrationEntry;
  verdict?: Verdict;
  before?: SideRun;
  after?: SideRun;
  /** regressedElsewhere at the note's fix. */
  elsewhere?: string[];
}

/** Each note's result from the sides' runs: which run is its before and which its after, and what it regressed. */
export function results(entries: readonly CalibrationEntry[], runs: ReadonlyMap<string, SideRun>): NoteResult[] {
  return entries.map((entry) => {
    if (entry.checks === undefined || entry.checks.length === 0) return { entry };
    const open = entry.status === 'open';
    const before = runs.get(open ? WORKING_TREE : entry.before!);
    const after = open ? undefined : runs.get(entry.after!);
    if (before === undefined || (!open && after === undefined)) throw new Error(`calibrate: note ${entry.n}: a side it needs was not run`);
    const elsewhere = after === undefined ? [] : regressedElsewhere(entry, before, after);
    return { entry, before, after, verdict: verdictOf(entry, before, after), elsewhere };
  });
}

/** The notes that fail the run: a verdict other than expected, or a regression elsewhere the table does not record. */
export const failing = (rs: readonly NoteResult[]): NoteResult[] =>
  rs.filter((r) => r.verdict !== undefined && (r.verdict !== expected(r.entry) || unrecorded(r.entry, r.elsewhere ?? []).length > 0));

/** The notes whose side did not load where they do not expect it: a report of a failed run, not of the notes. */
export const unloaded = (rs: readonly NoteResult[]): NoteResult[] =>
  rs.filter((r) => r.verdict === 'SIDE-DOES-NOT-LOAD' && expected(r.entry) !== 'SIDE-DOES-NOT-LOAD');

/**
 * Where the report goes and the run's exit code: `out` (stdout when none) — or `<out>.partial` for a run of some notes
 * (`--note`), `<out>.failed` while a side does not load unexpectedly, `out` left as it is either way; 1 when a note
 * fails (`failing`). `stale` is a `<out>.failed` a full clean run makes stale, to delete.
 */
export function disposition(rs: readonly NoteResult[], out?: string, partial = false): { path?: string; stale?: string; code: 0 | 1 } {
  const code = failing(rs).length > 0 ? 1 : 0;
  if (out === undefined) return { code };
  if (partial) return { path: `${out}.partial`, code };
  if (unloaded(rs).length > 0) return { path: `${out}.failed`, code };
  return { path: out, stale: `${out}.failed`, code };
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
  const deps: SideDeps = {
    golden: async (args) => (await run(process.execPath, args, { cwd: repo, maxBuffer: 64 << 20 })).stdout,
    args: (root) => ['--import', 'tsx', join(repo, 'scripts/differential/golden.ts'), '--corpus', join(repo, table.corpus), '--side', root, '--json'],
    checkout: (sha) => codeRoot(repo, sha, 'cal', worktrees),
  };
  const runs = new Map<string, SideRun>();
  const created: (() => void)[] = [];
  for (const side of plan(entries)) {
    const started = Date.now();
    const outcome = await runSide(side, repo, deps);
    if (outcome.cleanup !== undefined) created.push(outcome.cleanup);
    runs.set(side, outcome.run);
    console.error(sideLine(side, outcome, (Date.now() - started) / 1000));
  }
  const rs = results(entries, runs);
  const report = calibrationReport(rs);
  const out = values.out === undefined ? undefined : resolve(values.out);
  const { path, stale, code } = disposition(rs, out, only !== undefined);
  if (path === undefined) console.log(report);
  else await writeFile(path, report);
  if (only !== undefined && path !== undefined) console.error(`calibrate: --note runs some notes only — ${values.out} left as it is; the report is in ${path}`);
  else if (path !== out) console.error(`calibrate: ${unloaded(rs).length} note(s) on a side that did not load — ${values.out} left as it is; the report is in ${path}`);
  if (stale !== undefined) await rm(stale, { force: true });
  for (const r of rs) if (r.verdict !== undefined) console.error(`${r.entry.n.padEnd(4)} ${verdictCell(r).replace(/\*\*/g, '')}`);
  if (values.remove === true) for (const cleanup of created) cleanup();
  process.exitCode = code;
}

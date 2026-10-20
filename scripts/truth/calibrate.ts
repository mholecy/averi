import { execFile, execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import type { GoldenCheck } from '../differential/golden.js';
import { runSide, runSides, type SideDeps } from './calibrate-run.js';
import { calibrationReport, verdictCell } from './calibration-report.js';
import { FAMILIES } from './schema.js';
import { harnessDigest, sideCache, sideKeys, thisHost } from './side-cache.js';
import { WORKING_TREE, type SideRun } from './side-run.js';

/**
 * Phase 3's calibration (docs/plans/2026-10-15-ground-truth-lab-app.md): golden must fail on the commit before a
 * note's fix and pass after it. Golden runs (`--json`, the whole truth corpus) with THIS checkout's harness and truth
 * over the src of every before and after commit of the notes of scripts/truth/calibration.json (withSides: the commit
 * a note's first fix was made on and its last fix, unless the table says otherwise; side.ts loads an older src as it
 * is), and each note that names golden rows gets a verdict from its rows — a note with several fixes
 * one verdict per before/after pair (`pairs`, pairsOf: `<n>.1` its own, `<n>.2` … the further ones):
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
 *   NOT-ASKED             a named row the run did not ask (a wrong key, or a cell that went broken), or skipped (an
 *                         `ocr` row on a host with no working recognizer: golden.ts#ocrAvailability)
 *   SIDE-DOES-NOT-LOAD    golden could not run over that commit's src, or its run fails the canary
 *                         (side-run.ts#sideRunOf: a harness or JavaScript error in a reply, a device command the fake
 *                         does not model, or the `open` cell not green) — the reason is reported
 *
 * Every row of the corpus is compared too: a row green before and red after that the note does not name has REGRESSED
 * ELSEWHERE at the fix — reported with the verdict, and unexpected unless the note's `regressions` records it (`broke`
 * the after commit, the row in `rows`).
 *
 *   node --import tsx scripts/truth/calibrate.ts --worktrees <dir> [--note <n>[,<n>…]]
 *     [--out docs/truth/calibration.md] [--remove] [--cache <dir>] [--no-cache]
 *
 * The checkouts (checkout.ts, `differential-cal-<sha>` under --worktrees) are kept for the next run; --remove removes
 * the checkouts THIS run created (one found in place stays). An open note is judged on the working tree — this checkout
 * as it is on disk, uncommitted changes included. The sides run several at once (half the cores), and each side that
 * loaded is kept in the cache (side-cache.ts; `<worktrees>/side-cache` unless --cache names another directory) under a
 * key of the side and everything of the harness its run depends on, so the next run replays only the sides whose key
 * changed; --no-cache runs every side and keeps the runs afresh. Entries are never pruned (none can be served stale);
 * delete the cache's directory to reclaim the space. The console names the sides taken from the cache.
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
  /**
   * The commit judged red: the first fix's first parent, which withSides derives — given only to override it (none
   * does).
   */
  before?: string;
  /**
   * The commit judged green: the last fix, which withSides derives — given only to override it: another fix commit (#1:
   * the first, its own rows; the further fix a pair of its own), or, with `afterNotFix`, the commit that cured the cell.
   */
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
  /**
   * With `partial`: the static KNOWN rows (keyed as `checks`) of the part the note's fix leaves OPEN — still red, each
   * filed as this note (tests/differential/golden/<family>.known.ts). Keyed by ROW, as lab-notes.test.ts's
   * AWAITING_LIVE is by case: no other row may stay filed as a calibrated note. Not judged by calibrate (L1: the fully
   * expanded sheet its fix does not mark).
   */
  open?: string[];
  /**
   * With `partial`: the live KNOWN entries (scripts/truth/live-known.ts, keyed `<platform> <source> <case id>`) of the
   * part the note's fix leaves OPEN, each filed as this note — as `open` is for the static rows. Not judged by
   * calibrate (#10: the default direction's turn on uiautomator, which ADR 0021 leaves to the owner).
   */
  openLive?: string[];
  needs?: string;
  regressions?: Regression[];
  remark?: string;
  /**
   * A note with several fixes: a before/after pair per further fix, each judged alone on its own rows and its own
   * symptom (#7: 5cff2ad → 7542021 on the toolbar, d928789 → c3ebc62 on the scroll view). The note's own
   * `before`/`after`/`checks`/`defect` are its first pair; a note without `pairs` has that one (pairsOf).
   */
  pairs?: CalibrationPair[];
  /**
   * The note's live calibration (phase 5): its live cases at a before and an after commit, on the lab device — each
   * with the pair it calibrates (LiveCalibration.pair: the note's own unless it says so; pairsOf attaches it there).
   */
  live?: LiveCalibration[];
}

/** One more before/after pair of a note (CalibrationEntry.pairs): the fields of the note's own pair, for one fix. */
export interface CalibrationPair {
  /**
   * The commit judged red: its after's first parent (the fix it judges alone), which withSides derives — given only with
   * `afterNotFix`, whose after has no first parent that means anything, or to override it.
   */
  before?: string;
  /** The fix commit judged green — one of the note's `fix`, unless `afterNotFix` says why not. */
  after: string;
  afterNotFix?: string;
  checks: string[];
  defect: string;
  expect?: Verdict;
  partial?: string;
  remark?: string;
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
  /**
   * The before/after pair it calibrates, numbered as pairsOf numbers them: 1 the note's own (the default), 2 … the
   * further `pairs` in order. A number naming no pair of the note is an error (pairsOf), never another pair's.
   */
  pair?: number;
  /** The tree sources the cases ran under. */
  sources: string[];
  before: string;
  after: string;
  /**
   * live.ts case ids: a forms case's bare (`k6`), a visibility or dismissal case's prefixed by its kind
   * (`scroll:scroll-bounded-flush.P.fully`, `turn:…`, `dismiss:…`).
   */
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

/**
 * A note as the pairs it is judged on: the note itself (its own pair; `pairs` dropped) and, for each further pair, the
 * note with that pair's sides, rows, symptom and expectation, numbered `<n>.<i>` from 2 (the note's own pair `<n>.1`
 * then). A pair keeps the note's `regressions` (each names the commit it broke at, so it counts only at the pair whose
 * after that is) and not its `needs`, `partial` or `remark`, which are the first pair's. A `live` calibration goes
 * with the pair it names (LiveCalibration.pair, the note's own by default: #7's second fix live, `pair: 2`, beside
 * 7.2's d928789 → c3ebc62); one naming a pair the note does not have is an error.
 */
export function pairsOf(e: CalibrationEntry): CalibrationEntry[] {
  const { pairs, live, ...own } = e;
  const count = 1 + (pairs?.length ?? 0);
  for (const l of live ?? []) {
    const p = l.pair ?? 1;
    if (!Number.isInteger(p) || p < 1 || p > count) throw new Error(`calibration.json #${e.n}: a live calibration (${l.before} → ${l.after}) names pair ${p}; the note has ${count === 1 ? 'one pair' : `pairs 1–${count}`}`);
  }
  if (pairs === undefined || pairs.length === 0) return [live === undefined ? own : { ...own, live }];
  /** The live calibrations of pair `i` (0 the note's own, 1 … its `pairs`). */
  const liveOf = (i: number) => (live ?? []).filter((l) => (l.pair ?? 1) - 1 === i);
  const withLive = (entry: CalibrationEntry, ls: LiveCalibration[]): CalibrationEntry => (ls.length === 0 ? entry : { ...entry, live: ls });
  return [
    withLive({ ...own, n: `${e.n}.1` }, liveOf(0)),
    ...pairs.map((p, i): CalibrationEntry =>
      withLive(
        {
          n: `${e.n}.${i + 2}`,
          note: e.note,
          status: e.status,
          ...(e.fix !== undefined && { fix: e.fix }),
          ...(e.verified !== undefined && { verified: e.verified }),
          ...(e.regressions !== undefined && { regressions: e.regressions }),
          ...p,
        },
        liveOf(i + 1),
      ),
    ),
  ];
}

/** A commit's first parent, written as the table writes a commit (SHORT_SHA). */
export type ParentOf = (commit: string) => string;

/** How long the table's commits are, and so the report's: a short SHA of 7 characters. */
export const SHORT_SHA = 7;

/**
 * A note with the sides the table leaves out filled in from the history, so the table records only what the history
 * does not say: `before` the first fix's first parent (the commit the fix was made on), `after` the last fix, and a
 * further pair's `before` its after's first parent (the fix that pair judges alone). A side the table gives overrides
 * the derivation: an `after` that is an earlier fix (#7: the first fix, the last one judged by a further pair) or, with
 * `afterNotFix`, no fix at all (#27); a pair with `afterNotFix` must give its `before`, which nothing derives. Only a
 * note calibrate judges on its fixes (`calibrate`) gets sides: one open, needs-… or residual, or with no fix, stays as
 * the table gives it (the report's "—"). Run before pairsOf (entriesOf), which hands each pair its sides.
 */
export function withSides(e: CalibrationEntry, parentOf: ParentOf): CalibrationEntry {
  const fix = e.fix ?? [];
  if (e.status !== 'calibrate' || fix.length === 0) return e;
  const pairs = e.pairs?.map((p): CalibrationPair => {
    if (p.before !== undefined) return p;
    if (p.afterNotFix !== undefined) throw new Error(`calibration.json #${e.n}: the pair ${p.after} is no fix (afterNotFix) and gives no before`);
    return { ...p, before: parentOf(p.after) };
  });
  return {
    ...e,
    before: e.before ?? parentOf(fix[0]),
    after: e.after ?? fix[fix.length - 1],
    ...(pairs !== undefined && { pairs }),
  };
}

/**
 * The first parent from git in `repo`, as a short SHA (SHORT_SHA; git lengthens one that would be ambiguous). A commit
 * that is not there (a shallow clone, a SHA mistyped) is an error naming it: calibrate needs the history it replays.
 */
export function gitParentOf(repo: string): ParentOf {
  const known = new Map<string, string>();
  return (commit) => {
    let parent = known.get(commit);
    if (parent !== undefined) return parent;
    try {
      parent = execFileSync('git', ['-C', repo, 'rev-parse', `--short=${SHORT_SHA}`, '--verify', `${commit}^1^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      throw new Error(`calibrate: ${commit} is no commit with a first parent in ${repo} — calibrate needs the commits' history`);
    }
    known.set(commit, parent);
    return parent;
  };
}

/** A side's full SHA from git in `repo`; undefined when it names no commit there (runSide then says why). */
export const gitCommitOf =
  (repo: string) =>
  (side: string): string | undefined => {
    try {
      return execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${side}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return undefined;
    }
  };

/** The pairs a run judges: the notes `--note` names (notesOf), their sides derived (withSides), split per pair (pairsOf). */
export const entriesOf = (table: Pick<Calibration, 'notes'>, only: readonly string[] | undefined, parentOf: ParentOf): CalibrationEntry[] =>
  notesOf(table, only)
    .map((e) => withSides(e, parentOf))
    .flatMap(pairsOf);

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
  // A skipped row (golden.ts#ocrAvailability) was not asked: no verdict either way.
  const at = (run: { checks: Map<string, GoldenCheck> }, k: string) => {
    const c = run.checks.get(k);
    return c?.skipped === undefined ? c : undefined;
  };
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

/** The notes `--note` names (all without it), in the table's order; a name that is no note of the table is an error. */
export function notesOf(table: Pick<Calibration, 'notes'>, only: readonly string[] | undefined): CalibrationEntry[] {
  const notes = table.notes.filter((e) => only === undefined || only.includes(e.n));
  const unknown = (only ?? []).filter((n) => !table.notes.some((e) => e.n === n));
  if (unknown.length > 0) throw new Error(`calibrate --note: ${unknown.join(', ')} is no note of the table`);
  return notes;
}

// --- the command line ---

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      worktrees: { type: 'string' },
      note: { type: 'string' },
      out: { type: 'string' },
      remove: { type: 'boolean' },
      cache: { type: 'string' },
      'no-cache': { type: 'boolean' },
    },
  });
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const table = JSON.parse(await readFile(join(repo, 'scripts/truth/calibration.json'), 'utf8')) as Calibration;
  const only = values.note?.split(',').map((s) => s.trim());
  const entries = entriesOf(table, only, gitParentOf(repo));
  const { codeRoot } = await import('../differential/checkout.js');
  const worktrees = resolve(values.worktrees ?? join(tmpdir(), 'averi-calibration'));
  const run = promisify(execFile);
  const deps: SideDeps = {
    golden: async (args) => (await run(process.execPath, args, { cwd: repo, maxBuffer: 64 << 20 })).stdout,
    args: (root) => ['--import', 'tsx', join(repo, 'scripts/differential/golden.ts'), '--corpus', join(repo, table.corpus), '--side', root, '--json'],
    checkout: (sha) => codeRoot(repo, sha, 'cal', worktrees),
  };
  const cacheDir = resolve(values.cache ?? join(worktrees, 'side-cache'));
  const sides = plan(entries);
  const jobs = Math.max(1, Math.floor(availableParallelism() / 2));
  const started = Date.now();
  const host = await thisHost();
  const commitOf = gitCommitOf(repo);
  const { runs, cleanups, cached } = await runSides(sides, {
    run: (side) => runSide(side, repo, deps),
    cache: sideCache(cacheDir),
    keys: () => sideKeys(repo, harnessDigest(repo, table.corpus, host), commitOf),
    mode: values['no-cache'] === true ? 'refresh' : 'reuse',
    jobs,
    log: (line) => console.error(line),
  });
  console.error(`calibrate: ${sides.length} sides in ${((Date.now() - started) / 1000).toFixed(1)} s — ${cached.length} from the cache (${cacheDir}), ${sides.length - cached.length} run, ${jobs} at once`);
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
  if (values.remove === true) for (const cleanup of cleanups) cleanup();
  process.exitCode = code;
}

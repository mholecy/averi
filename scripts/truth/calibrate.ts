import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import type { GoldenCheck, GoldenJson } from '../differential/golden.js';

/**
 * Phase 3's calibration (docs/plans/2026-10-15-ground-truth-lab-app.md): golden must fail on the commit before a
 * note's fix and pass after it. Golden runs (`--json`, the whole truth corpus) with THIS checkout's harness and truth
 * over the src of every before and after commit the notes of scripts/truth/calibration.json name (side.ts loads an older
 * src as it is), and each note that names golden rows gets a verdict from its rows:
 *
 *   CALIBRATED            every named row red before WITH the note's defect (`defect`: the note's own symptom, a
 *                         pattern of the row's mismatch or of its reply where the mismatch quotes only its start),
 *                         green after
 *   CALIBRATED-ON-DEFECT  red before with the defect; after, the defect is gone but a row stays red for another class
 *                         (e.g. "not in the tree")
 *   DOES-NOT-FAIL         a row green before, or red without the defect: a hole in the truth, the spec table or the cells
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
 *   node --import tsx scripts/truth/calibrate.ts --worktrees <dir> [--note <n>[,<n>…]] [--out docs/truth/calibration.md] [--remove]
 *
 * The checkouts (checkout.ts, `differential-cal-<sha>` under --worktrees) are kept for the next run; --remove removes
 * the checkouts THIS run created (one found in place stays). An open note is judged on the working tree — this checkout
 * as it is on disk, uncommitted changes included.
 * Exit code 1 when a note's verdict is not the one it expects (`expect`; CALIBRATED, or OPEN-RED for an open note), or a
 * note regressed elsewhere unrecorded.
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

export const STATUSES = /^(calibrate|open|residual:.+|needs-cell:(edges|presented|bars|false-covers|forms)|needs-2b|needs-live|needs-ocr)$/;

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
  /** The commit judged green: a fix commit (usually the first). */
  after?: string;
  verified?: 'golden' | 'merge-subject' | 'unverified';
  /** Golden rows, `<run>/<file> <target> <verb>` as tests/differential/golden.test.ts keys them. */
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
}

export interface Calibration {
  corpus: string;
  notes: CalibrationEntry[];
  excluded: { note: string; why: string }[];
}

/** The side an open note is judged on: this checkout as it is on disk, not its committed HEAD. */
export const WORKING_TREE = 'working tree';

/** A row's key, as the calibration table and golden.test.ts's KNOWN name it. */
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

/** golden's stdout (its JSON on the last line) as a SideRun; `failure` is why the process failed, if it did. */
export function sideRunFromOutput(stdout: string, failure?: string): SideRun {
  const json = stdout.trim().split('\n').at(-1) ?? '';
  let parsed: GoldenJson;
  try {
    parsed = JSON.parse(json) as GoldenJson;
  } catch {
    return { error: failure ?? `no JSON from golden: ${json.slice(0, 200)}` };
  }
  return sideRunOf(parsed);
}

export const expected = (e: CalibrationEntry): Verdict => e.expect ?? (e.status === 'open' ? 'OPEN-RED' : 'CALIBRATED');

/** The verdict for one note from its rows at before and after (or in the working tree, `after` unused, for an open note). */
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

const firstLine = (s: string) => s.split('\n').find((l) => l.trim() !== '' && !/^\d+\/\d+ asserts|^All \d+ asserts/.test(l))?.slice(0, 220) ?? '';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rowLine = (k: string, c: GoldenCheck | undefined) =>
  c === undefined ? `  - ${k}: not asked` : c.mismatch === undefined ? `  - ok ${k} — ${cell(firstLine(c.reply))}` : `  - RED ${k} — ${cell(c.mismatch.slice(0, 260))}`;

/** The summary table's verdict: the verdict, what part of the note it covers, and what the fix regressed elsewhere. */
export function verdictCell(r: NoteResult): string {
  if (r.verdict === undefined) return '—';
  const e = r.entry;
  let v = r.verdict === expected(e) ? r.verdict : `**${r.verdict}** (expected ${expected(e)})`;
  if (e.partial !== undefined) v += ` (partial: ${e.partial})`;
  const elsewhere = r.elsewhere ?? [];
  if (elsewhere.length > 0) {
    const loose = unrecorded(e, elsewhere).length;
    v += `, regressed elsewhere: ${elsewhere.length} row${elsewhere.length === 1 ? '' : 's'}${loose === 0 ? ' (recorded)' : ` — **${loose} unrecorded**`}`;
  }
  return v;
}

/** docs/truth/calibration.md: the summary table, then per note its rows at both sides — a red row's mismatch, a green row's reply. */
export function calibrationReport(rs: readonly NoteResult[]): string {
  const lines = [
    '# Calibration on the bug notes',
    '',
    'Generated by `scripts/truth/calibrate.ts` from `scripts/truth/calibration.json` — do not edit. Golden (this',
    "checkout's harness, spec and truth) replayed over each note's before and after commit, the whole corpus at each; an",
    'open note on the working tree. See the script for the verdicts.',
    '',
    '| # | note | status | before → after | verdict |',
    '|---|---|---|---|---|',
  ];
  for (const r of rs) {
    const e = r.entry;
    const sides = e.status === 'open' ? WORKING_TREE : e.before === undefined ? '—' : `${e.before} → ${e.after ?? e.fix?.join(', ') ?? '?'}`;
    lines.push(`| ${e.n} | ${e.note.replace(/\.md$/, '')} | ${e.status} | ${sides} | ${verdictCell(r)} |`);
  }
  lines.push('');
  for (const r of rs) {
    if (r.verdict === undefined) continue;
    const e = r.entry;
    lines.push(`## ${e.n}: ${r.verdict}${e.partial === undefined ? '' : ` (partial: ${e.partial})`}`, '', `${e.note}${e.defect === undefined ? '' : ` — defect: \`${e.defect}\``}`, '');
    for (const [label, run] of [
      [e.status === 'open' ? WORKING_TREE : `before ${e.before}`, r.before],
      ...(e.status === 'open' ? [] : [[`after ${e.after}`, r.after] as const]),
    ] as const) {
      if (run === undefined) continue;
      if ('error' in run) {
        lines.push(`- ${label}: side does not load — ${cell(run.error)}`);
        continue;
      }
      lines.push(`- ${label}:`);
      for (const k of e.checks ?? []) lines.push(rowLine(k, run.checks.get(k)));
    }
    const elsewhere = r.elsewhere ?? [];
    if (elsewhere.length > 0 && r.before !== undefined && r.after !== undefined && 'checks' in r.before && 'checks' in r.after) {
      const loose = new Set(unrecorded(e, elsewhere));
      lines.push('', `Regressed elsewhere at ${e.after} (green at ${e.before}):`, '');
      for (const k of elsewhere) lines.push(`${rowLine(k, r.after.checks.get(k))}${loose.has(k) ? ' — **not in `regressions`**' : ''}`);
    }
    if (e.regressions !== undefined) {
      lines.push('', 'Regressions recorded:', '');
      for (const g of e.regressions) lines.push(`- ${g.rows.join(', ')}: broke at ${g.broke}${g.fixed === undefined ? ', not fixed' : `, fixed at ${g.fixed}`} — ${g.why}`);
    }
    if (e.needs !== undefined) lines.push('', `Needs: ${e.needs}`);
    if (e.remark !== undefined) lines.push('', e.remark);
    lines.push('');
  }
  const skipped = rs.filter((r) => r.verdict === undefined);
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
  const created: (() => void)[] = [];
  for (const side of plan(entries)) {
    const started = Date.now();
    let root: string;
    try {
      if (side === WORKING_TREE) root = repo;
      else {
        const code = codeRoot(repo, side, 'cal', worktrees);
        root = code.root;
        if (code.cleanup !== undefined) created.push(code.cleanup);
      }
    } catch (e) {
      runs.set(side, { error: `no checkout: ${(e as Error).message.split('\n')[0]}` });
      continue;
    }
    const args = ['--import', 'tsx', join(repo, 'scripts/differential/golden.ts'), '--corpus', join(repo, table.corpus), '--side', root, '--json'];
    let stdout = '';
    let failure: string | undefined;
    try {
      stdout = (await run(process.execPath, args, { cwd: repo, maxBuffer: 64 << 20 })).stdout;
    } catch (e) {
      // golden exits 1 on any mismatch — its JSON is still on stdout; no JSON means the side did not load.
      const err = e as { stdout?: string; stderr?: string; message: string };
      stdout = err.stdout ?? '';
      failure = (err.stderr ?? err.message).split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2).join(' ') || err.message.split('\n')[0];
    }
    runs.set(side, sideRunFromOutput(stdout, failure));
    console.error(`calibrate: ${side} ${'error' in runs.get(side)! ? 'DID NOT LOAD' : 'ran'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const rs = results(entries, runs);
  const report = calibrationReport(rs);
  if (values.out !== undefined) await writeFile(resolve(values.out), report);
  else console.log(report);
  for (const r of rs) if (r.verdict !== undefined) console.error(`${r.entry.n.padEnd(4)} ${verdictCell(r).replace(/\*\*/g, '')}`);
  if (values.remove === true) for (const cleanup of created) cleanup();
  if (failing(rs).length > 0) process.exitCode = 1;
}

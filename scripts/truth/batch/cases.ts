import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NOT_STARTED, TIMED_OUT } from './bounded.js';
import { isEexist, nodeFs, type BatchFs } from './io.js';
import { PLAIN_SEGMENT } from './run-dir.js';
import { holdsGoldenHeader, LIVE_GOLDEN_HEADER, stepWordOf } from './steps.js';
import { messageOf, verdictLine } from './words.js';

/**
 * A live run's own record of what it was asked, and when it counts. A block that runs live.ts writes `<name>.cases`
 * first — before the run's health check, before anything of it runs — so a run that never ran is seen as asked and
 * not complete, an INCONCLUSIVE, never a missing line (batch-9's finding: such a run vanished from the analysis).
 * Beside it the run leaves `<name>.json` (live.ts --record), `<name>.log` (its output) and `<name>.rejudge.txt` (main's
 * `--rejudge` summary, live-cases.ts#summarize).
 *
 * A run counts only when complete (b11-analyze.ts:1–23): its `.cases`, a record, live.ts's `# Live golden:` line in
 * both its log and its summary (printed only once live.ts has judged), and every case main's selectCases picks for
 * what was asked present in the summary under each source asked. What it found is the batch's analyzer's to judge;
 * this module only says whether there is a whole run to judge.
 *
 * Main's live-cases.ts is read through `liveCasesOf(repo)`, a dynamic import of the checkout's own file — never a grep,
 * and never a static import: the mutation run's sandbox holds scripts/truth/batch/ alone (ADR 0038's T2 amendment).
 */

/** What main's live-cases.ts gives this module: selectCases (the cases a run takes) and catalogOf (the lab's cells). */
export interface LiveCases {
  selectCases(s: { platform: 'ios' | 'android'; app: string; groups: readonly string[]; only?: readonly string[] }): Promise<readonly { id: string; sources?: readonly string[] }[]>;
  catalogOf(): Promise<{ cells: readonly { id: string }[] }>;
}

/** The checkout `repo`'s live-cases.ts, imported from its own file: the table main holds, read in process. */
export async function liveCasesOf(repo: string): Promise<LiveCases> {
  return (await import(pathToFileURL(join(resolve(repo), 'scripts/truth/live-cases.ts')).href)) as LiveCases;
}

/** What a live run was asked (batch-11's `asked`): the platform, the lab app, its sources and case ids (none: all). */
export interface Asked {
  platform: 'ios' | 'android';
  app: string;
  /** batch-11's `"kind": "new"`; not read here. */
  kind?: string;
  /** The tree sources it runs under (`--sources`; uiautomator on Android): one at least. */
  sources: readonly string[];
  /** `--cases`: these ids only; empty: every case of its groups. */
  cases: readonly string[];
  /** `--groups`; none: forms, as batch-11's live_run ran. */
  groups?: readonly string[];
}

/** A run's four files, by its name: `<name>.cases`, `.json`, `.log`, `.rejudge.txt`. */
export const runFiles = (dir: string, name: string) => ({
  cases: join(dir, `${name}.cases`),
  record: join(dir, `${name}.json`),
  log: join(dir, `${name}.log`),
  summary: join(dir, `${name}.rejudge.txt`),
});

const CASES_EXT = '.cases';

function checkName(name: string): void {
  if (!PLAIN_SEGMENT.test(name)) throw new Error(`run name ${JSON.stringify(name)}: one plain path segment is needed`);
}

/**
 * Write `<dir>/<name>.cases`: what the run is asked, as JSON — `Asked` for a live run, any object for another block's
 * (batch-12's E5 wrote `{"runs":3}`). Called before anything of the run is done. Never overwritten (io.ts's exclusive
 * create): a run folder is never reused, so a second .cases of one name is the batch's mistake. Returns its path.
 */
export function writeCases(fs: BatchFs, dir: string, name: string, asked: object): string {
  checkName(name);
  const path = runFiles(dir, name).cases;
  try {
    fs.createExclusive(path, `${JSON.stringify(asked)}\n`);
  } catch (e) {
    if (isEexist(e)) throw new Error(`${path} already exists: what a run was asked is never overwritten`);
    throw e;
  }
  return path;
}

/** The runs a block's folder asked: the name of every `.cases` in it, sorted. A record with none (ime.json) is no run. */
export const runsIn = (fs: BatchFs, dir: string): string[] => fs.list(dir).filter((n) => n.endsWith(CASES_EXT)).map((n) => n.slice(0, -CASES_EXT.length));

/**
 * A live.ts step's word and why, by its exit code and its log (the judged exit-1 rule, steps.ts#stepWordOf): 0 OK;
 * 1 DONE only when the log holds `# Live golden:` (a MISMATCH or a known case off, which the analyzer judges), else
 * FAIL (live.ts died before judging); anything else FAIL — 142 its bound passed, 127 not started.
 */
export function stepOutcome(code: number, log: string): { word: 'OK' | 'DONE' | 'FAIL'; why: string } {
  const word = stepWordOf(code, { judged: true, log });
  if (word === 'DONE') return { word, why: 'exit 1: a MISMATCH or a known case off, judged by the analyzer' };
  if (code === 1) return { word, why: `exit 1 with no \`${LIVE_GOLDEN_HEADER}\` line in its log: live.ts did not finish` };
  if (code === TIMED_OUT) return { word, why: `timed out (exit ${TIMED_OUT}: past its bound)` };
  if (code === NOT_STARTED) return { word, why: `not started (exit ${NOT_STARTED})` };
  return { word, why: `exit ${code}` };
}

/** The ids main picks for one source of what a run was asked. */
export type Selector = (asked: Asked, source: string) => Promise<readonly string[]>;

/**
 * main's selectCases as a Selector (b11-analyze.ts#selectorOf): the cases of the run's platform, app and groups (forms
 * when the .cases names none), only those asked when any were, and of them those whose sources hold this one or name
 * none (Case.sources).
 */
export const selectorOf =
  (live: LiveCases): Selector =>
  async (asked, source) =>
    (await live.selectCases({ platform: asked.platform, app: asked.app, groups: asked.groups ?? ['forms'], ...(asked.cases.length > 0 && { only: asked.cases }) }))
      .filter((c) => c.sources === undefined || c.sources.includes(source))
      .map((c) => c.id);

/** A run: complete, with what it was asked; or why not, every gap at once. */
export type Completeness = { ok: true; asked: Asked } | { ok: false; why: string };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The .cases read as what a live run is asked, or undefined when it is not. */
function askedOf(v: unknown): Asked | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;
  const shaped = (a.platform === 'ios' || a.platform === 'android') && typeof a.app === 'string' && isStrings(a.sources) && a.sources.length > 0 && isStrings(a.cases) && (a.groups === undefined || isStrings(a.groups));
  return shaped ? (a as unknown as Asked) : undefined;
}

/** A summary line of summarize's shape (`- <outcome>[ (<cls>)] <id> <cell>: …`): its case id. */
const CASE_LINE = /^- (?:ok|LOUD|MISMATCH|SKIP)(?: \([^)]+\))? (\S+) \S+: /;

/** The case ids a summary lists under each `## <source>`: an ok, a MISMATCH, a SKIP or a LOUD alike — all are there. */
function idsBySource(summary: string): Map<string, Set<string>> {
  const by = new Map<string, Set<string>>();
  let ids: Set<string> | undefined;
  for (const line of summary.split('\n')) {
    const source = /^## (\S+)/.exec(line)?.[1];
    if (source !== undefined) by.set(source, (ids = by.get(source) ?? new Set()));
    else {
      const id = CASE_LINE.exec(line)?.[1];
      if (id !== undefined) ids?.add(id);
    }
  }
  return by;
}

/** A file's text; or, when it cannot be had, the gap: `missing` when nothing is there, else unreadable. */
function readOr(fs: BatchFs, path: string, file: string, missing: string): { text: string } | { gap: string } {
  const text = fs.read(path);
  if (text !== undefined) return { text };
  return { gap: fs.exists(path) ? `${file} is unreadable` : missing };
}

/**
 * Whether the run `name` in `dir` is complete (b11-analyze.ts#readRun's rule): its `.cases` read as what a live run is
 * asked; its record JSON; `# Live golden:` in its log and in its summary; every id `select` picks for each source asked
 * listed in the summary under that source. A `.cases` with nothing beside it was asked but never ran. Every gap is said,
 * in that order, `; ` between them: the whole why at once, so one rerun fixes it.
 */
export async function completeness({ fs = nodeFs, dir, name, select }: { fs?: BatchFs; dir: string; name: string; select: Selector }): Promise<Completeness> {
  checkName(name);
  const f = runFiles(dir, name);
  const ran = [f.record, f.log, f.summary].some((p) => fs.exists(p));
  if (!ran) return { ok: false, why: fs.exists(f.cases) ? 'asked but never ran (no record, log or summary beside its .cases)' : 'never ran (no .cases, record, log or summary)' };
  const gaps: string[] = [];
  let asked: Asked | undefined;
  const cases = readOr(fs, f.cases, `${name}.cases`, `no ${name}.cases: what it was asked is unknown`);
  if ('gap' in cases) gaps.push(cases.gap);
  else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cases.text);
    } catch {
      gaps.push(`${name}.cases is no JSON`);
    }
    if (parsed !== undefined) {
      asked = askedOf(parsed);
      if (asked === undefined) gaps.push(`${name}.cases is not what a live run is asked (platform ios or android, app, sources: one at least, cases: ids)`);
    }
  }
  const record = readOr(fs, f.record, `its record (${name}.json)`, `no record (${name}.json)`);
  if ('gap' in record) gaps.push(record.gap);
  else {
    try {
      JSON.parse(record.text);
    } catch {
      gaps.push(`its record (${name}.json) is no JSON`);
    }
  }
  const log = readOr(fs, f.log, `${name}.log`, `no live run log (${name}.log)`);
  if ('gap' in log) gaps.push(log.gap);
  else if (!holdsGoldenHeader(log.text)) gaps.push(`${name}.log has no \`${LIVE_GOLDEN_HEADER}\` line (live.ts did not finish)`);
  const summary = readOr(fs, f.summary, `${name}.rejudge.txt`, `no rejudge summary (${name}.rejudge.txt)`);
  let listed: Map<string, Set<string>> | undefined;
  if ('gap' in summary) gaps.push(summary.gap);
  else if (!holdsGoldenHeader(summary.text)) gaps.push(`${name}.rejudge.txt has no \`${LIVE_GOLDEN_HEADER}\` line (the rejudge did not finish)`);
  else listed = idsBySource(summary.text);
  if (asked !== undefined && listed !== undefined) {
    try {
      for (const source of asked.sources) {
        const have = listed.get(source) ?? new Set<string>();
        const missing = (await select(asked, source)).filter((id) => !have.has(id));
        if (missing.length > 0) gaps.push(`${source}: ${missing.join(', ')} missing from the summary`);
      }
    } catch (e) {
      gaps.push(`the cases main picks could not be read (${messageOf(e).split('\n', 1)[0]})`);
    }
  }
  return gaps.length === 0 && asked !== undefined ? { ok: true, asked } : { ok: false, why: gaps.join('; ') };
}

/**
 * The block's INCONCLUSIVE when a run it asked is not complete: `<label>: INCONCLUSIVE — <k> of <n> run(s) incomplete:
 * <name> — <why> | …`; and when it asked none (no `.cases` in its folder), `not run`, never no line at all. Undefined
 * when every run is complete: then the analyzer judges.
 */
export function incompleteLine(label: string, runs: readonly { name: string; result: Completeness }[]): string | undefined {
  if (runs.length === 0) return verdictLine(label, 'INCONCLUSIVE', 'not run: no .cases in its folder (nothing was asked)');
  const bad = runs.flatMap((r) => (r.result.ok ? [] : [`${r.name} — ${r.result.why}`]));
  return bad.length === 0 ? undefined : verdictLine(label, 'INCONCLUSIVE', `${bad.length} of ${runs.length} run(s) incomplete: ${bad.join(' | ')}`);
}

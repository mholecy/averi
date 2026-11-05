import { join } from 'node:path';
import { NOT_STARTED, TIMED_OUT } from './bounded.js';
import { isEexist, nodeFs, type BatchFs } from './io.js';
import { DEFAULT_GROUPS, unreadLive, type LiveSelection, type LiveTable } from './live-table.js';
import { PLAIN_SEGMENT, plainSegment } from './run-dir.js';
import { holdsGoldenHeader, LIVE_GOLDEN_HEADER, stepWordOf } from './steps.js';
import { nameInLine, verdictLine } from './words.js';

/**
 * A live run's own record of what it was asked, and when it counts. A block that runs live.ts writes `<name>.cases`
 * first — before the run's health check, before anything of it runs — so a run that never ran is seen as asked and
 * not complete, an INCONCLUSIVE, never a missing line (batch-9's finding: such a run vanished from the analysis).
 * Beside it the run leaves `<name>.json` (live.ts --record), `<name>.log` (its output) and `<name>.rejudge.txt` (main's
 * `--rejudge` summary, live-cases.ts#summarize).
 *
 * A run counts only when complete (b11-analyze.ts:1–23): its `.cases`, a record, live.ts's `# Live golden:` line in
 * both its log and its summary (printed only once live.ts has judged), and every case main's selectCases picks for
 * what was asked present in the summary under each source asked — and something to prove: every id asked is one main
 * runs under a source asked, and main picks one case at least. What it found is the batch's analyzer's to judge; this
 * module only says whether there is a whole run to judge.
 *
 * Main's live-cases.ts is read through a LiveTable (live-table.ts#liveTableOf), a dynamic import of the checkout's own
 * file — never a grep, and never a static import.
 */

/**
 * What a live run was asked (batch-11's `asked`): the platform, the lab app, its sources and case ids (none: all).
 * batch-11 also wrote `"kind": "new"`, which nothing read: it is not asked for, and a `.cases` holding it still reads.
 */
export interface Asked {
  platform: LiveSelection['platform'];
  app: string;
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

/** What a `.cases` must hold to be a live run's, as its whys say it. */
const LIVE_SHAPE = 'is not what a live run is asked (platform ios or android, app, sources: one at least, cases: ids)';

/**
 * Write `<dir>/<name>.cases`: what the live run is asked, as JSON. Called before anything of the run is done. Only a
 * live run's (`Asked`, checked at run time too: nothing is written for anything else): runsIn and completeness read
 * every `.cases` as one, so a non-live block keeps its own record elsewhere (batch-12's E5 wrote `{"runs":3}`; the
 * runner's asks and record, T2 S6a). Never overwritten (io.ts's exclusive create): a run folder is never reused, so a
 * second .cases of one name is the batch's mistake. Returns its path.
 */
export function writeCases(fs: BatchFs, dir: string, name: string, asked: Asked): string {
  plainSegment('run name', name);
  if (askedOf(asked) === undefined) throw new Error(`${name}${CASES_EXT}: ${JSON.stringify(asked)} ${LIVE_SHAPE}`);
  const path = runFiles(dir, name).cases;
  try {
    fs.createExclusive(path, `${JSON.stringify(asked)}\n`);
  } catch (e) {
    if (isEexist(e)) throw new Error(`${path} already exists: what a run was asked is never overwritten`);
    throw e;
  }
  return path;
}

/**
 * The runs a block's folder asked: the name of every `.cases` in it, sorted. A record with none (ime.json) is no run.
 */
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
 * main's selectCases as a Selector (b11-analyze.ts's selectorOf): the cases of the run's platform, app and groups
 * (forms when the .cases names none), only those asked when any were, and of them those whose sources hold this one or
 * name none (Case.sources). The table is loaded at each call (Node caches the module); a load or a read that fails
 * rejects the call, and completeness names either with live-table.ts's unreadLive, the same words casesOnMain says.
 */
export const selectorOf =
  (table: LiveTable): Selector =>
  async (asked, source) =>
    (await (await table()).selectCases({ platform: asked.platform, app: asked.app, groups: asked.groups ?? DEFAULT_GROUPS, ...(asked.cases.length > 0 && { only: asked.cases }) }))
      .filter((c) => c.sources === undefined || c.sources.includes(source))
      .map((c) => c.id);

/** A run: complete, with what it was asked; or why not, every gap at once. */
export type Completeness = { ok: true; asked: Asked } | { ok: false; why: string };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The .cases read as what a live run is asked, or undefined when it is not. */
function askedOf(v: unknown): Asked | undefined {
  // JSON's null read as no field at all; an array, a number or a string has none of the fields either.
  const a = (v ?? {}) as Record<string, unknown>;
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
      // A case line before any `## <source>` belongs to none.
      const m = CASE_LINE.exec(line);
      if (m !== null) ids?.add(m[1]);
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

/** `ids` as a why lists them: each as a line may name it, `, ` between. */
const listed = (ids: readonly string[]): string => ids.map(nameInLine).join(', ');

/**
 * What the selection says of a run: every id asked that main runs under none of the sources asked, then — when main
 * picks no case at all for any source — that the run proves nothing (a run of zero cases is no evidence, whatever its
 * header says); then, when the summary is there to read, every picked id it does not list under its source.
 */
async function selectionGaps(asked: Asked, select: Selector, summary: string | undefined): Promise<string[]> {
  const gaps: string[] = [];
  const picked = new Map<string, readonly string[]>();
  for (const source of asked.sources) picked.set(source, await select(asked, source));
  const any = new Set([...picked.values()].flat());
  const sources = asked.sources.map(nameInLine).join(' or ');
  for (const id of new Set(asked.cases)) if (!any.has(id)) gaps.push(`${nameInLine(id)}: no case main runs on ${asked.platform} under ${sources}`);
  if (any.size === 0) gaps.push(`main picks no case for what was asked (${asked.platform}, ${nameInLine(asked.app)} app, under ${sources}): the run proves nothing`);
  if (summary === undefined) return gaps;
  const shown = idsBySource(summary);
  for (const [source, ids] of picked) {
    const have = shown.get(source) ?? new Set<string>();
    const missing = ids.filter((id) => !have.has(id));
    if (missing.length > 0) gaps.push(`${nameInLine(source)}: ${listed(missing)} missing from the summary`);
  }
  return gaps;
}

/**
 * Whether the run `name` in `dir` is complete (b11-analyze.ts's readRun's rule): its `.cases` read as what a live run
 * is asked; its record JSON; `# Live golden:` in its log and in its summary; every id `select` picks for each source
 * asked listed in the summary under that source; and something to prove (selectionGaps). A `.cases` with nothing beside
 * it was asked but never ran. Every gap is said, in that order, `; ` between them: the whole why at once, so one rerun
 * fixes it — but the cases are checked only when the `.cases` was read as asked (else what to pick is unknown), and
 * against the summary only when it could be read (with or without its header). A name that is no plain path segment (a
 * stray `.cases` or `x.y.cases` in the folder) is a gap of its own, and nothing of it is read. Never throws.
 */
export async function completeness({ fs = nodeFs, dir, name, select }: { fs?: BatchFs; dir: string; name: string; select: Selector }): Promise<Completeness> {
  if (!PLAIN_SEGMENT.test(name)) return { ok: false, why: `${nameInLine(`${name}${CASES_EXT}`)}: its name is no plain path segment (letters, digits, _ and -), not read as a run` };
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
      if (asked === undefined) gaps.push(`${name}.cases ${LIVE_SHAPE}`);
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
  if ('gap' in summary) gaps.push(summary.gap);
  else if (!holdsGoldenHeader(summary.text)) gaps.push(`${name}.rejudge.txt has no \`${LIVE_GOLDEN_HEADER}\` line (the rejudge did not finish)`);
  if (asked !== undefined) {
    try {
      gaps.push(...(await selectionGaps(asked, select, 'text' in summary ? summary.text : undefined)));
    } catch (e) {
      gaps.push(unreadLive(e));
    }
  }
  // No gap means `asked` was read: its check is for the type.
  return gaps.length === 0 && asked !== undefined ? { ok: true, asked } : { ok: false, why: gaps.join('; ') };
}

/**
 * The block's INCONCLUSIVE when a run it asked is not complete: `<label>: INCONCLUSIVE — <k> of <n> run(s) incomplete:
 * <name> — <why> | …`; and when it asked none (no `.cases` in its folder), `not run`, never no line at all. Undefined
 * when every run is complete: then the analyzer judges. A run is a live run's Completeness, or any other result of that
 * shape (runner.ts: a non-live block's record, T2 S6a).
 */
export function incompleteLine(label: string, runs: readonly { name: string; result: { ok: true; asked?: Asked } | { ok: false; why: string } }[]): string | undefined {
  if (runs.length === 0) return verdictLine(label, 'INCONCLUSIVE', 'not run: no .cases in its folder (nothing was asked)');
  const bad = runs.flatMap((r) => (r.result.ok ? [] : [`${nameInLine(r.name)} — ${r.result.why}`]));
  return bad.length === 0 ? undefined : verdictLine(label, 'INCONCLUSIVE', `${bad.length} of ${runs.length} run(s) incomplete: ${bad.join(' | ')}`);
}

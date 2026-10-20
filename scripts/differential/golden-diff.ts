import { captureOf, keyOf } from '../truth/side-run.js';
import type { GoldenCheck, GoldenResult } from './golden.js';

/**
 * golden against an earlier run (`golden.ts --against <base.json>`, the base a `--json` run): what a fix changed, in
 * place of a hand diff of two `--json` files (docs/truth/open-bugs.md, "How to fix one bug", step 6).
 *
 * - Every check whose verdict (ok, MISMATCH and its reason, skipped), reply, device calls or faults differ from the
 *   base's, and every check one run asks and the other does not — of the captures both runs replayed, so an `--only`
 *   run is not told the rest of the corpus vanished, nor a run wider than its base flooded with new checks. A capture
 *   this run replayed and the base did not is named once.
 * - The ratchet's KNOWN rows this run finds green, as the exact keys to strike, per family file: the rows golden.test.ts
 *   ("no known mismatch is fixed without being struck off KNOWN") would fail. A row of a capture not replayed here, or
 *   skipped for want of OCR, is held; a row its capture no longer asks is struck, as the ratchet fails it. The files
 *   are not rewritten — their rows are built with `keys(file, tags, verbs, …)` over tag lists, which only a person (or
 *   agent) edits well.
 * - The checks per capture where they differ from the ratchet's COUNTS, per family file, as the line to write — only
 *   the captures replayed here, and only those that differ: the lines to edit, not the whole table. A COUNTS entry
 *   whose capture left the corpus, and the family file of a capture no file counts yet, golden.test.ts names.
 *
 * Checks are matched by `<recording> <target> <verb>` (the ratchet's key, scripts/truth/side-run.ts#keyOf), a key asked
 * twice by its occurrence.
 */

/** One family's ratchet as this module reads it (tests/differential/golden/known.ts#KnownFile). */
export interface Ratchet {
  family: string;
  known: Readonly<Record<string, unknown>>;
  counts: Readonly<Record<string, number>>;
}

/** What differs of one check: absent on a side that does not ask it. */
export interface CheckChange {
  key: string;
  was?: GoldenCheck;
  now?: GoldenCheck;
}

/** A run's totals, as golden's report heads them. */
export interface Tally {
  checks: number;
  mismatches: number;
  broken: number;
  skipped: number;
}

export interface GoldenDiff {
  /** Both runs' totals over the captures both replayed. */
  tally: { was: Tally; now: Tally };
  changed: CheckChange[];
  /** The captures this run replayed and the base did not: their checks are not compared. */
  unbased: string[];
  /** Per family file, the KNOWN keys this run finds green. */
  strike: { family: string; keys: string[] }[];
  /** Per family file (undefined: a capture no file counts), each capture whose checks differ from COUNTS. */
  counts: { family: string | undefined; recording: string; was: number | undefined; now: number }[];
}

/** A check's verdict as the report words it. */
const checkVerdictText = (c: GoldenCheck) => (c.skipped !== undefined ? `skipped (${c.skipped})` : c.mismatch === undefined ? 'ok' : `MISMATCH ${c.mismatch}`);

/** The checks of `results` by key, a key asked again suffixed with its occurrence (` #2`). */
function byKey(results: readonly GoldenResult[]): Map<string, GoldenCheck> {
  const map = new Map<string, GoldenCheck>();
  for (const c of results.flatMap((r) => r.checks)) {
    let key = keyOf(c);
    for (let n = 2; map.has(key); n++) key = `${keyOf(c)} #${n}`;
    map.set(key, c);
  }
  return map;
}

const same = (a: GoldenCheck, b: GoldenCheck) =>
  checkVerdictText(a) === checkVerdictText(b) && a.reply === b.reply && JSON.stringify(a.calls) === JSON.stringify(b.calls) && JSON.stringify(a.faults ?? []) === JSON.stringify(b.faults ?? []);

const tallyOf = (results: readonly GoldenResult[]): Tally => {
  const checks = results.flatMap((r) => r.checks);
  return {
    checks: checks.length,
    mismatches: checks.filter((c) => c.mismatch !== undefined).length,
    broken: results.reduce((a, r) => a + r.broken.length, 0),
    skipped: checks.filter((c) => c.skipped !== undefined).length,
  };
};

export function goldenDiff(base: readonly GoldenResult[], now: readonly GoldenResult[], ratchet: readonly Ratchet[]): GoldenDiff {
  const ran = new Set(now.map((r) => r.recording));
  const based = new Set(base.map((r) => r.recording));
  const both = (r: GoldenResult) => ran.has(r.recording) && based.has(r.recording);
  const was = byKey(base.filter(both));
  const is = byKey(now.filter(both));
  const changed: CheckChange[] = [];
  for (const [key, c] of is) {
    const b = was.get(key);
    if (b === undefined || !same(b, c)) changed.push({ key, ...(b !== undefined && { was: b }), now: c });
  }
  for (const [key, b] of was) if (!is.has(key)) changed.push({ key, was: b });

  // golden.test.ts's "no known mismatch is fixed without being struck off KNOWN", over the captures run here: a KNOWN
  // row that is no mismatch and not skipped is fixed — asked green, or no longer asked.
  const red = new Set(now.flatMap((r) => r.checks).filter((c) => c.mismatch !== undefined || c.skipped !== undefined).map(keyOf));
  const strike = ratchet
    .map((f) => ({ family: f.family, keys: Object.keys(f.known).filter((k) => ran.has(captureOf(k)) && !red.has(k)) }))
    .filter((f) => f.keys.length > 0);

  const counts: GoldenDiff['counts'] = now.flatMap((r) => {
    const file = ratchet.find((f) => Object.hasOwn(f.counts, r.recording));
    const counted = file?.counts[r.recording];
    return counted === r.checks.length ? [] : [{ family: file?.family, recording: r.recording, was: counted, now: r.checks.length }];
  });
  const unbased = now.map((r) => r.recording).filter((r) => !based.has(r));
  return { tally: { was: tallyOf(base.filter(both)), now: tallyOf(now.filter(both)) }, changed, unbased, strike, counts };
}

const fileOf = (family: string | undefined) => (family === undefined ? 'no family file counts it' : `tests/differential/golden/${family}.known.ts`);

/** The reply's lines that differ, by position: `-` the base's, `+` this run's. */
function replyLines(was: string, now: string): string[] {
  const a = was.split('\n');
  const b = now.split('\n');
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).flatMap((i) =>
    a[i] === b[i] ? [] : [...(a[i] === undefined ? [] : [`    - ${a[i]}`]), ...(b[i] === undefined ? [] : [`    + ${b[i]}`])],
  );
}

function changeLines({ key, was, now }: CheckChange): string[] {
  if (was === undefined) return [`- NEW ${key}: ${checkVerdictText(now!)}`];
  if (now === undefined) return [`- GONE ${key}: was ${checkVerdictText(was)}`];
  const lines = [`- ${key}`];
  if (checkVerdictText(was) !== checkVerdictText(now)) lines.push(`  verdict: was ${checkVerdictText(was)}`, `           now ${checkVerdictText(now)}`);
  // A skipped row's reply is the harness's stub: its verdict says all.
  if (was.reply !== now.reply && was.skipped === undefined && now.skipped === undefined) lines.push('  reply:', ...replyLines(was.reply, now.reply));
  if (JSON.stringify(was.calls) !== JSON.stringify(now.calls)) lines.push(`  calls: was ${JSON.stringify(was.calls)}`, `         now ${JSON.stringify(now.calls)}`);
  if (JSON.stringify(was.faults ?? []) !== JSON.stringify(now.faults ?? [])) lines.push(`  faults: was ${JSON.stringify(was.faults ?? [])}`, `          now ${JSON.stringify(now.faults ?? [])}`);
  return lines;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The report: this run's tally beside the base's (of the captures both replayed), then the sections of GoldenDiff. */
export function diffReport(against: string, d: GoldenDiff): string {
  const { was: b, now: n } = d.tally;
  const lines = [
    `# Golden against ${against}: ${n.checks} checks (was ${b.checks}), ${n.mismatches} mismatches (was ${b.mismatches}), ${n.broken} broken targets (was ${b.broken}), ${n.skipped} skipped (was ${b.skipped})`,
    '',
    `## Changed: ${plural(d.changed.length, 'check')}`,
    ...d.changed.flatMap(changeLines),
    ...(d.unbased.length === 0 ? [] : ['', `## Not in the base, not compared: ${plural(d.unbased.length, 'capture')}`, ...d.unbased.map((r) => `  ${r}`)]),
    '',
    `## Strike from KNOWN: ${plural(d.strike.reduce((a, f) => a + f.keys.length, 0), 'row')}`,
    ...d.strike.flatMap((f) => [fileOf(f.family), ...f.keys.map((k) => `  ${k}`)]),
    '',
    `## COUNTS: ${plural(d.counts.length, 'capture')}`,
  ];
  for (const family of [...new Set(d.counts.map((c) => c.family))]) {
    lines.push(fileOf(family));
    for (const c of d.counts.filter((x) => x.family === family)) lines.push(`  ${c.recording}: ${c.now} (was ${c.was ?? 'none'})`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The results of a `--json` run's output, or why `text` is none — read before any replay, so a wrong base fails at
 * once.
 */
export function baseOf(text: string, path: string): GoldenResult[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`golden --against: ${path} is no JSON (${(e as Error).message})`);
  }
  const results = (json as { results?: unknown } | null)?.results;
  const isResult = (r: unknown) =>
    typeof r === 'object' && r !== null && typeof (r as GoldenResult).recording === 'string' && Array.isArray((r as GoldenResult).checks) && Array.isArray((r as GoldenResult).broken);
  if (!Array.isArray(results) || !results.every(isResult)) throw new Error(`golden --against: ${path} is no golden --json output`);
  return results as GoldenResult[];
}

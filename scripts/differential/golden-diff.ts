import type { GoldenCheck, GoldenResult } from './golden.js';

/**
 * golden against an earlier run (`golden.ts --against <base.json>`, the base a `--json` run): what a fix changed, in
 * place of a hand diff of two `--json` files (docs/truth/open-bugs.md, "How to fix one bug", step 6).
 *
 * - Every check whose verdict (ok, MISMATCH and its reason, skipped), reply, device calls or faults differ from the
 *   base's, and every check one run asks and the other does not — of the captures this run replayed only, so an
 *   `--only` run is not told the rest of the corpus vanished.
 * - The ratchet's KNOWN rows this run finds green, as the exact keys to strike, per family file: the rows golden.test.ts
 *   would fail as "fixed without being struck off" (a row not asked, or skipped for want of OCR, is held). The files are
 *   not rewritten — their rows are built with `keys(file, tags, verbs, …)` over tag lists, which only a person (or
 *   agent) edits well.
 * - The checks per capture where they differ from the ratchet's COUNTS, per family file, as the line to write.
 *
 * Checks are matched by `<recording> <target> <verb>` (the ratchet's key), a key asked twice by its occurrence.
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

export interface GoldenDiff {
  changed: CheckChange[];
  /** Per family file, the KNOWN keys this run finds green. */
  strike: { family: string; keys: string[] }[];
  /** Per family file (undefined: a capture no file counts), each capture whose checks differ from COUNTS. */
  counts: { family: string | undefined; recording: string; was: number | undefined; now: number }[];
}

export const checkKey = (c: Pick<GoldenCheck, 'recording' | 'target' | 'verb'>) => `${c.recording} ${c.target} ${c.verb}`;

/** A check's verdict as the report words it. */
export const verdictOf = (c: GoldenCheck) => (c.skipped !== undefined ? `skipped (${c.skipped})` : c.mismatch === undefined ? 'ok' : `MISMATCH ${c.mismatch}`);

/** The checks of `results` by key, a key asked again suffixed with its occurrence (` #2`). */
function byKey(results: readonly GoldenResult[]): Map<string, GoldenCheck> {
  const map = new Map<string, GoldenCheck>();
  for (const c of results.flatMap((r) => r.checks)) {
    let key = checkKey(c);
    for (let n = 2; map.has(key); n++) key = `${checkKey(c)} #${n}`;
    map.set(key, c);
  }
  return map;
}

const same = (a: GoldenCheck, b: GoldenCheck) =>
  verdictOf(a) === verdictOf(b) && a.reply === b.reply && JSON.stringify(a.calls) === JSON.stringify(b.calls) && JSON.stringify(a.faults ?? []) === JSON.stringify(b.faults ?? []);

export function goldenDiff(base: readonly GoldenResult[], now: readonly GoldenResult[], ratchet: readonly Ratchet[]): GoldenDiff {
  const ran = new Set(now.map((r) => r.recording));
  const was = byKey(base.filter((r) => ran.has(r.recording)));
  const is = byKey(now);
  const changed: CheckChange[] = [];
  for (const [key, c] of is) {
    const b = was.get(key);
    if (b === undefined || !same(b, c)) changed.push({ key, ...(b !== undefined && { was: b }), now: c });
  }
  for (const [key, b] of was) if (!is.has(key)) changed.push({ key, was: b });

  // As golden.test.ts's ratchet: a KNOWN row of a capture run here that is no mismatch and not skipped is fixed.
  const red = new Set([...is.values()].filter((c) => c.mismatch !== undefined || c.skipped !== undefined).map(checkKey));
  const strike = ratchet
    .map((f) => ({ family: f.family, keys: Object.keys(f.known).filter((k) => ran.has(k.split(' ')[0]) && !red.has(k)) }))
    .filter((f) => f.keys.length > 0);

  const counts: GoldenDiff['counts'] = now.flatMap((r) => {
    const file = ratchet.find((f) => Object.hasOwn(f.counts, r.recording));
    const counted = file?.counts[r.recording];
    return counted === r.checks.length ? [] : [{ family: file?.family, recording: r.recording, was: counted, now: r.checks.length }];
  });
  return { changed, strike, counts };
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
  if (was === undefined) return [`- NEW ${key}: ${verdictOf(now!)}`];
  if (now === undefined) return [`- GONE ${key}: was ${verdictOf(was)}`];
  const lines = [`- ${key}`];
  if (verdictOf(was) !== verdictOf(now)) lines.push(`  verdict: was ${verdictOf(was)}`, `           now ${verdictOf(now)}`);
  // A skipped row's reply is the harness's stub: its verdict says all.
  if (was.reply !== now.reply && was.skipped === undefined && now.skipped === undefined) lines.push('  reply:', ...replyLines(was.reply, now.reply));
  if (JSON.stringify(was.calls) !== JSON.stringify(now.calls)) lines.push(`  calls: was ${JSON.stringify(was.calls)}`, `         now ${JSON.stringify(now.calls)}`);
  if (JSON.stringify(was.faults ?? []) !== JSON.stringify(now.faults ?? [])) lines.push(`  faults: was ${JSON.stringify(was.faults ?? [])}`, `          now ${JSON.stringify(now.faults ?? [])}`);
  return lines;
}

const tally = (results: readonly GoldenResult[]) => {
  const checks = results.flatMap((r) => r.checks);
  return {
    checks: checks.length,
    mismatches: checks.filter((c) => c.mismatch !== undefined).length,
    broken: results.reduce((a, r) => a + r.broken.length, 0),
    skipped: checks.filter((c) => c.skipped !== undefined).length,
  };
};

/** The report: this run's tally beside the base's (of the captures run here), then the three sections of GoldenDiff. */
export function diffReport(against: string, base: readonly GoldenResult[], now: readonly GoldenResult[], d: GoldenDiff): string {
  const ran = new Set(now.map((r) => r.recording));
  const n = tally(now);
  const b = tally(base.filter((r) => ran.has(r.recording)));
  const lines = [
    `# Golden against ${against}: ${n.checks} checks (was ${b.checks}), ${n.mismatches} mismatches (was ${b.mismatches}), ${n.broken} broken targets (was ${b.broken}), ${n.skipped} skipped (was ${b.skipped})`,
    '',
    `## Changed: ${d.changed.length} checks`,
    ...d.changed.flatMap(changeLines),
    '',
    `## Strike from KNOWN: ${d.strike.reduce((a, f) => a + f.keys.length, 0)} rows`,
    ...d.strike.flatMap((f) => [fileOf(f.family), ...f.keys.map((k) => `  ${k}`)]),
    '',
    `## COUNTS: ${d.counts.length} captures`,
  ];
  for (const family of [...new Set(d.counts.map((c) => c.family))]) {
    lines.push(fileOf(family));
    for (const c of d.counts.filter((x) => x.family === family)) lines.push(`  ${c.recording}: ${c.now} (was ${c.was ?? 'none'})`);
  }
  lines.push('');
  return lines.join('\n');
}

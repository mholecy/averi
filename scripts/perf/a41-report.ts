import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain } from '../is-main.js';
import { A41_CHILD_NAMES, A41_CHILDREN, CADENCES, childLog, reportOf, summaryLines, WDA_BUILD_LINE, type A41Parts, type CadencePass, type Trial } from './a41.js';
import { installReplayClock, replaySettles } from './a41-settle.js';

/**
 * The A41 probe's files summed, device-free (scripts/truth/batch/lab-a41-ios.ts's last block; rerunnable by hand on
 * the run's folders): each child's file of a41.ts#A41_CHILDREN from its block's folder — the settle trace replayed
 * through the production settle at each of a41.ts#CADENCES (a41-settle.ts, on virtual time) — and whether a
 * WebDriverAgent build ran (a41.ts#WDA_BUILD_LINE in a WDA child's log), into `a41.json` (the report, a41.ts#A41Report,
 * with the trace beside it as evidence) and `summary.txt` (a41.ts#summaryLines), both in `--out`, the summary on stdout
 * too. A file missing or unreadable is named in the report's `missing` and its part said MISSING, never a number; a
 * required part read but not proven, in its `unproven` (a41.ts#unprovenOf), said UNPROVEN. Exit 0 once both are
 * written — the batch's report block judges `missing` and `unproven`; 1 when the report itself could not be.
 *
 *   node --import tsx scripts/perf/a41-report.ts --idb <a41-idb run folder> --wda <a41-wda run folder> --out <dir>
 */

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** The report indented, then the trace beside it one trial a line (the d35 fixture's layout, and a small file). */
export function a41Json(report: object, trials: readonly Trial[] | undefined): string {
  const body = JSON.stringify(report, null, 1);
  if (trials === undefined) return `${body}\n`;
  return `${body.slice(0, body.lastIndexOf('}')).trimEnd()},\n "cadenceTrace": [\n${trials.map((t) => JSON.stringify(t)).join(',\n')}\n ]\n}\n`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { idb: { type: 'string' }, wda: { type: 'string' }, out: { type: 'string' } } });
  if (values.idb === undefined || values.wda === undefined || values.out === undefined) throw new Error('usage: a41-report.ts --idb <dir> --wda <dir> --out <dir>');
  const dirs = { idb: values.idb, wda: values.wda };
  const parts: Record<string, unknown> = {};
  const missing: string[] = [];
  let wdaBuilt: boolean | undefined;
  for (const name of A41_CHILD_NAMES) {
    const c = A41_CHILDREN[name];
    const text = await readText(join(dirs[c.block], c.file));
    try {
      parts[c.part] = JSON.parse(text ?? '') as unknown;
    } catch {
      missing.push(c.file);
    }
    if (c.block !== 'wda') continue;
    const log = await readText(join(dirs.wda, childLog(name)));
    if (log !== undefined) wdaBuilt = wdaBuilt === true || WDA_BUILD_LINE.test(log);
  }
  let trials: Trial[] | undefined;
  const trace = parts.cadence as { meta?: unknown; trials?: Trial[] } | undefined;
  if (trace !== undefined) {
    trials = trace.trials ?? [];
    const passes: CadencePass[] = [];
    const clock = installReplayClock();
    try {
      for (const pollMs of CADENCES) passes.push(await replaySettles(trials, { pollMs }, clock));
    } finally {
      clock.uninstall();
    }
    parts.cadence = { meta: trace.meta, trials, passes };
  }
  const report = reportOf(parts as A41Parts, missing, new Date().toISOString(), wdaBuilt);
  const lines = summaryLines(report);
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, 'a41.json'), a41Json(report, trials));
  await writeFile(join(values.out, 'summary.txt'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));

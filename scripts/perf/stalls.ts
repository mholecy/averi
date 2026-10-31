import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtMs, stallCells, stallLines } from './report.js';
import { overallStalls, scenarioStalls, type Spread, type TimedRun, type Window } from './stats.js';

/**
 * D26's stall summary recomputed from D0 results JSON (baseline.ts `--out`) — for files written before the report
 * carried it, from each run's recorded window: per scenario its screenshot calls/stalls (`simctl io screenshot` and,
 * since D26b, `idb screenshot` — stats.ts#SCREENSHOT_LABELS), its wall median and
 * its stall-free one, then the overall line per capture; with several files, the pooled lines last.
 *
 *   node --import tsx scripts/perf/stalls.ts <result.json> [<result.json> …]
 */

/** The part of a results JSON this reads. */
export interface ResultsJson {
  scenarios: { id: string; summary: { wallMs?: Spread }; runs: TimedRun[] }[];
}

/** Per file its name, a line per scenario and the overall line per capture; with several files, the pooled lines last. */
export function stallReport(files: readonly { file: string; result: ResultsJson }[]): string[] {
  const out: string[] = [];
  const pooled: Window[] = [];
  for (const { file, result } of files) {
    const { lines, windows } = oneFile(result);
    out.push(file, ...lines);
    pooled.push(...windows);
  }
  if (files.length > 1) out.push(...stallLines(overallStalls(pooled)).map((l) => `pooled, ${files.length} files: ${l}`));
  return out;
}

function oneFile(result: ResultsJson): { lines: string[]; windows: Window[] } {
  const width = Math.max(0, ...result.scenarios.map((s) => s.id.length));
  const lines = result.scenarios.map((s) => {
    const [shots, free] = stallCells(scenarioStalls(s.runs));
    const wall = s.summary.wallMs === undefined ? '—' : fmtMs(s.summary.wallMs.median);
    return `  ${s.id.padEnd(width)}  ${shots}  wall med ${wall}  stall-free ${free}`;
  });
  const windows = result.scenarios.flatMap((s) => s.runs.map((r) => r.window));
  return { lines: [...lines, ...stallLines(overallStalls(windows)).map((l) => `  ${l}`)], windows };
}

async function main(files: string[]): Promise<void> {
  if (files.length === 0) throw new Error('usage: stalls.ts <result.json> [<result.json> …]');
  const read = await Promise.all(files.map(async (file) => ({ file, result: JSON.parse(await readFile(file, 'utf8')) as ResultsJson })));
  for (const l of stallReport(read)) console.log(l);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

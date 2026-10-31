import { SCREENSHOT_LABELS, type OverallStalls, type ScenarioStalls, type Spread, type StallCounts, type Summary } from './stats.js';

/**
 * The text of the performance baseline's report (baseline.ts, and scripts/perf/stalls.ts): the table, D26's stall
 * columns and line, and the two number formats every line uses. The arithmetic is stats.ts's; this only renders it,
 * and is tested in tests/perf/report.test.ts.
 */

/** A length in whole ms. */
export function fmtMs(x: number): string {
  return Math.round(x).toString();
}

/** A spread as `median [min–max]`, in whole ms; a dash for none. */
export function fmtSpread(s: Spread | undefined): string {
  return s === undefined ? '—' : `${fmtMs(s.median)} [${fmtMs(s.min)}–${fmtMs(s.max)}]`;
}

const med = (s: Spread | undefined) => (s === undefined ? '—' : fmtMs(s.median));

/** One capture's stall line of the text report (`label`): the share is of the screenshots that completed. */
export function stallLine(o: StallCounts, thresholdMs: number, label: string): string {
  return [
    `${label}: ${o.stalls} stalls (> ${thresholdMs} ms) in ${o.screenshots} calls` +
      (o.failed > 0 ? ` (${o.failed} failed, not timed)` : '') +
      `, ${o.screenshots > o.failed ? ((100 * o.stalls) / (o.screenshots - o.failed)).toFixed(1) : '—'} %`,
    ...(o.okMs ? [`ok calls ${fmtSpread(o.okMs)} ms`] : []),
    ...(o.stallMs ? [`stalls ${fmtSpread(o.stallMs)} ms`] : []),
  ].join(' · ');
}

/**
 * The run's stall lines: one per capture it took (D26b — `simctl io screenshot` first, then `idb screenshot`), so a run
 * that took one kind has the one line it always had; one that took none says so.
 */
export function stallLines(o: OverallStalls): string[] {
  const lines = SCREENSHOT_LABELS.flatMap((label) => {
    const counts = o.byLabel[label];
    return counts === undefined ? [] : [stallLine(counts, o.thresholdMs, label)];
  });
  return lines.length > 0 ? lines : [`${SCREENSHOT_LABELS.join(' / ')}: none taken`];
}

/** A scenario's two stall columns of the text table: `screenshots/stalls`, and the stall-free wall median `(runs)`. */
export function stallCells(s: ScenarioStalls): [string, string] {
  return [`${s.screenshots}/${s.stalls}`, s.stallFreeWallMs === undefined ? '—' : `${fmtMs(s.stallFreeWallMs.median)} (${s.stallFreeRuns})`];
}

/**
 * The text table under the run's header line: a row per scenario, the median and range of the wall clock and the
 * medians of the rest. When the run took any screenshot (D26: simctl's or, D26b, idb's), two more columns —
 * screenshots/stalls and the stall-free wall median — and the stall lines under the table; otherwise the columns it always had.
 */
export function reportTable(reports: readonly { id: string; summary: Summary; stalls: ScenarioStalls }[], stalls: OverallStalls): string[] {
  const shots = stalls.screenshots > 0;
  const head = ['scenario', 'ok/runs', 'wall ms med [min–max]', 'dev calls', 'dev ms', 'dev busy', 'slept ms', 'sleeps', 'host ms', 'cpu ms', ...(shots ? ['shots/stalls', 'stall-free wall med (runs)'] : [])];
  const rows = reports.map((r) => {
    const s = r.summary;
    const other = Object.entries(s.statuses).filter(([k]) => k !== 'ok').map(([k, n]) => ` ${n} ${k}`).join('');
    return [r.id, `${s.statuses.ok ?? 0}/${s.runs}${other}`, fmtSpread(s.wallMs), med(s.deviceCalls), med(s.deviceMs), med(s.deviceBusyMs), med(s.sleptMs), med(s.sleeps), med(s.hostMs), med(s.cpuMs), ...(shots ? stallCells(r.stalls) : [])];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(head), ...rows.map(line), ...(shots ? stallLines(stalls) : [])];
}

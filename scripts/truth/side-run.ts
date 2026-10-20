import type { GoldenCheck, GoldenJson } from '../differential/golden.js';

/**
 * One side of the calibration as calibrate reads it (calibrate.ts judges the notes by it, calibrate-run.ts makes it
 * from a golden process, side-cache.ts keeps it): the sides' names, a row's key, and a side's run — its checks by key,
 * or why it does not count as loaded (the canary, sideRunOf). Below the three, so none of them imports another for it.
 */

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
  const count = `${faults.length} fault${faults.length === 1 ? '' : 's'}`;
  if (faults.length > 0) return { error: `canary: ${count}; first ${faults[0].slice(0, 300)}` };
  return { checks: new Map(checks.map((c) => [keyOf(c), c])) };
}

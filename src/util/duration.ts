/**
 * Timeouts are written the way a human would in averi.yaml ("15s") and the way
 * a caller would in a tool argument (a number of ms). One parser for both,
 * owned here because every layer needs it — flow steps, assert specs,
 * scroll_until — and none of them owns the notion of a duration.
 */

/** "15s" | "500ms" | "2m" | number(ms) → ms */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;
  const m = value.match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!m) throw new Error(`Invalid duration "${value}" — use e.g. 500ms, 15s, 2m`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60_000;
}

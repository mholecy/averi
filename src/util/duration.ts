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

/**
 * ms → "N s", the way a tool description or a message quotes a budget
 * ("5 s", "0.4 s"). The inverse direction of parseDuration for the one
 * place a default is SHOWN rather than read: the MCP tool descriptions cite
 * each module's exported default through it, so the number an agent reads
 * has the module's constant as its one owner (architecture review
 * 2026-10-07, mcp-surface candidate 3).
 */
export const formatSeconds = (ms: number): string => `${ms / 1000} s`;

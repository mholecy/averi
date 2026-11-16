/**
 * The device-log excerpt `get_logs` returns: a grep, the tail, and a header saying what both did.
 */

/**
 * The flags a log grep compiles with — case-insensitive, nothing else. Named
 * so get_logs' schema validates the pattern under the same flags
 * (util/regex.ts) rather than a copy of them. Never `g` or `y`:
 * formatLogExcerpt compiles the pattern once and calls `.test` on every line,
 * and a global or sticky regex carries `lastIndex` from one line into the
 * next, silently dropping matches.
 */
export const LOG_GREP_FLAGS = 'i';

/**
 * How many matching lines a log excerpt keeps when the caller names no
 * budget — the tail, where the failure is. Owned here, where the limit is
 * applied; the MCP get_logs tool's schema default and description quote it.
 */
export const LOG_MAX_LINES = 400;

/**
 * Device-log excerpt: filter to a regex, keep the tail, and say what that did.
 * Pure — it takes the lines rather than the device — because the COUNTING is
 * the part that misleads when it is wrong: a grep that silently matched
 * nothing reads exactly like a quiet device, and a truncated pull that does
 * not admit it reads like the whole story. Worth a test; untestable inside a
 * tool handler.
 */
export function formatLogExcerpt(all: string[], grep: string | undefined, maxLines = LOG_MAX_LINES): string {
  const re = grep === undefined ? undefined : new RegExp(grep, LOG_GREP_FLAGS);
  const lines = re === undefined ? all : all.filter((l) => re.test(l));
  const tail = lines.slice(-maxLines);
  const header: string[] = [];
  if (grep !== undefined) header.push(`[grep /${grep}/${LOG_GREP_FLAGS} matched ${lines.length} of ${all.length} lines]`);
  if (lines.length > tail.length) {
    header.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);
  }
  return [...header, ...tail].join('\n');
}

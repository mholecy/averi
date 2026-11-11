/**
 * The `.rejudge.json` format (backlog A21): a rejudge's failure reasons, as `live.ts --rejudge … --failures <file>`
 * writes them beside its summary — live-cases.ts#Summary's `failures`, each one reason the run fails (none: it does
 * not), in the words the summary says it — and as a standing batch's judge reads them back (batch/standing.ts), never a
 * grep of the summary's prose. A leaf: it imports nothing, so neither the batch layer nor its tests reach live-cases.ts
 * through it.
 */

/** The file's suffix beside a run's name (batch/cases.ts#runFiles: `<name>.rejudge.json`). */
export const FAILURES_SUFFIX = '.rejudge.json';

/** The reasons as the rejudge writes them: one JSON object, `{"failures": [...]}`, one line. */
export const failuresJson = (failures: readonly string[]): string => `${JSON.stringify({ failures })}\n`;

/**
 * failuresJson's text read back, fail closed: the reasons, or undefined when there is no text, no JSON, or not that
 * shape (no `failures` array, an entry not a string) — never "no failure".
 */
export function failuresOf(text: string | undefined): string[] | undefined {
  let v: unknown;
  try {
    // No text parses as `undefined`, which is no JSON: the throw.
    v = JSON.parse(String(text));
  } catch {
    return undefined;
  }
  // Outside the try: JSON's `null` read with `.` would throw here, not be caught.
  const failures = (v as { failures?: unknown } | null)?.failures;
  return Array.isArray(failures) && failures.every((f) => typeof f === 'string') ? failures : undefined;
}

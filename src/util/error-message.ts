/**
 * The message of whatever was thrown: a caught value need not be an Error,
 * so every site that quotes one needs the same guard. A util leaf, so every
 * layer can reach it.
 */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The first line of what was thrown: the cause, without a stack, the stderr
 * beneath it or a paragraph of advice. What a one-line note, trace entry or
 * fail-closed reason quotes of an error.
 */
export const errorHeadline = (e: unknown): string => errorMessage(e).split('\n')[0];

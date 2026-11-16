/**
 * The message of whatever was thrown: a caught value need not be an Error,
 * so every site that quotes one needs the same guard. A util leaf, so every
 * layer can reach it.
 */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

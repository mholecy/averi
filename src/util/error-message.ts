/**
 * The message of whatever was thrown. Adapters shell out, and a rejected
 * child process can surface as a string rather than an Error, so every site
 * that quotes a caught value needs the same guard. A util leaf, so every
 * layer can reach it.
 */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

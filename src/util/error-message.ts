/**
 * The message of whatever was thrown. Adapters shell out, and a rejected
 * child process can surface as a string rather than an Error, so every site
 * that quotes a caught value needs the same guard — it was written inline at
 * seven of them across verify/ and run/ (review 2026-10-03). A util leaf, so
 * every layer can reach it.
 */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

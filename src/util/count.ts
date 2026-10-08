/**
 * `1 swipe`, `3 swipes`, `0 characters` — a count with its noun, singular
 * only for exactly one. Regular plurals only (`noun + s`): every noun averi
 * counts in a message is one. A util leaf, so every layer can reach it
 * (code review of round 2, 2026-10-08: fill.ts#charactersText,
 * scroll.ts's swipesText and its turn count each wrote the ternary, as did
 * the node, element and invalid-field counts — `1 characters` was a
 * device-check finding of the same day).
 */
export const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

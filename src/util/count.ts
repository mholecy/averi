/**
 * `1 swipe`, `3 swipes`, `0 characters` — a count with its noun, singular
 * only for exactly one. Regular plurals only (`noun + s`): every noun averi
 * counts in a message is one. A util leaf, so every layer can reach it.
 */
export const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * `1 character`, `N characters`. A plural written by hand would read `Typed 1
 * characters` and `(1 characters, cleared 3 characters first)`, as the device
 * checks of docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md
 * read on both platforms.
 * Here beside countOf: type_text without a selector counts characters too,
 * and is no fill.
 */
export const charactersText = (n: number): string => countOf(n, 'character');

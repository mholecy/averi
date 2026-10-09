/**
 * `1 swipe`, `3 swipes`, `0 characters` — a count with its noun, singular
 * only for exactly one. Regular plurals only (`noun + s`): every noun averi
 * counts in a message is one. A util leaf, so every layer can reach it
 * (code review of round 2, 2026-10-08: the fill's character count,
 * scroll.ts's swipesText and its turn count each wrote the ternary, as did
 * the node, element and invalid-field counts — `1 characters` was a
 * device-check finding of the same day).
 */
export const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * `1 character`, `N characters` — every count fill and type_text print goes
 * through this. Until 2026-10-08 they all said `characters`, and the device
 * checks of docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-
 * cleared.md read `Typed 1 characters` and `(1 characters, cleared 3
 * characters first)` on both platforms. Here beside countOf since
 * 2026-10-09 (it was fill.ts's, then fill-verdict.ts's): type_text without a
 * selector counts characters too, and is no fill.
 */
export const charactersText = (n: number): string => countOf(n, 'character');

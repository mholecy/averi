/**
 * A secure field's read-back: bullets only (• ● ∙ · or *), one per character.
 * uiautomator and WDA both expose a password field this way (measured
 * 2026-09-17, both platforms), so its CONTENT can never be compared — only its
 * length can. Tree vocabulary, so it lives with the tree (ARCHITECTURE.md §3):
 * the flow engine's `fillField` is the first consumer; an assert over a
 * password field would be the next.
 */
export const isMaskedValue = (observed: string): boolean =>
  observed.length > 0 && /^[\u2022\u25CF\u2219\u00B7*]+$/.test(observed);

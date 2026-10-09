/**
 * The mask characters, in two sets. BULLETS — • and ● — are written by a
 * mask and by almost nothing else; the rest — ∙ · and * — are masks too
 * (measured 2026-09-17, both platforms) but also ordinary text (a middle
 * dot in a name, an asterisk in a password). One owner for both, so the
 * whole-reading test below and the partial one cannot drift apart (review
 * 2026-10-09: fill.ts carried its own copy of the first set).
 */
const BULLETS = '•●';
const ALSO_MASKS = '∙·*';

const ALL_MASK = new RegExp(`^[${BULLETS}${ALSO_MASKS}]+$`);
const ANY_BULLET = new RegExp(`[${BULLETS}]`);

/**
 * A secure field's read-back: bullets only (• ● ∙ · or *), one per character.
 * uiautomator and WDA both expose a password field this way (measured
 * 2026-09-17, both platforms), so its CONTENT can never be compared — only its
 * length can. Tree vocabulary, so it lives with the tree (ARCHITECTURE.md §3):
 * the flow engine's `fillField` is the first consumer; an assert over a
 * password field would be the next.
 */
export const isMaskedValue = (observed: string): boolean => observed.length > 0 && ALL_MASK.test(observed);

/**
 * A reading with a • or ● ANYWHERE in it — a PARTLY masked one, such as
 * Android's show-the-last-character password field (`•••••t`), whose
 * content is not comparable either. Only the BULLETS set: `*` and `·` in a
 * plain reading are ordinary text, and counting them would turn a real
 * text mismatch into a lengths-only one.
 */
export const hasBullet = (observed: string): boolean => ANY_BULLET.test(observed);

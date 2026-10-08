/**
 * The one sentence a single-element assert ends with when it could not check
 * what it was asked: the reason, then what went unchecked. A check the caller
 * asked for and did not get must never read as a pass — and must always read
 * the same way, which it did not: the suffix was hand-built at eight sites
 * across assert.ts, color-parity.ts and rect-parity.ts (review 2026-10-03;
 * its second round found the last two, one of which had already drifted to
 * a bare "failing closed"). A leaf module because all three files need it and
 * assert.ts imports the other two.
 */
/**
 * What went unchecked — the noun the sentence ends with. The pixel asserts
 * use the first two; `baseline match` is the screenshot assert's, for a
 * capture the adapter refused (2026-10-08, pixel-poll.ts#screenshotFailed).
 */
export type Unchecked = 'color' | 'rendered text' | 'geometry' | 'baseline match';

export const failClosed = (reason: string, unchecked: Unchecked): string =>
  `${reason}; failing closed, ${unchecked} unchecked`;

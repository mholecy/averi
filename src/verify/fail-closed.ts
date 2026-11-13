/**
 * The one sentence a single-element assert ends with when it could not check
 * what it was asked: the reason, then what went unchecked. A check the caller
 * asked for and did not get must never read as a pass — and must always read
 * the same way. A leaf module because assert.ts and the parity modules it
 * imports all need it.
 */
/**
 * What went unchecked — the noun the sentence ends with. The pixel asserts
 * use the first two; `baseline match` is the screenshot assert's, for a
 * capture the adapter refused (pixel-poll.ts#screenshotFailed); `ink height`
 * is the ocr assert's when the string WAS read and only its size could not
 * be judged (multi-line text, text-parity.ts#evaluateOcrAssert).
 */
export type Unchecked = 'color' | 'rendered text' | 'ink height' | 'geometry' | 'baseline match';

/**
 * The reason is often another component's sentence (an adapter's transport
 * error, a recognizer's message) and ends with a full stop; one is dropped
 * here so the detail never reads `attention.; failing closed` (seen on
 * device, 2026-10-08). An ellipsis is left alone.
 */
export const failClosed = (reason: string, unchecked: Unchecked): string =>
  `${reason.replace(/(?<!\.)\.$/, '')}; failing closed, ${unchecked} unchecked`;

import { describe, expect, it } from 'vitest';
import { LIVE_GOLDEN_HEADER, stepWordOf } from '../../../scripts/truth/batch/steps.js';
import { summarize, THIS_CHECKOUT } from '../../../scripts/truth/live-cases.js';

// The judged exit-1 rule (steps.ts#stepWordOf) reads live.ts's own header: held to the line live-cases.ts#summarize
// writes, so a renamed header fails here and not on a device. Kept apart from steps.test.ts: the mutation run's sandbox
// copies only scripts/truth/batch/, not live-cases.ts and what it imports.

describe("LIVE_GOLDEN_HEADER is live-cases.ts's summary header", () => {
  it('a run summary of no case still starts its judged line with it, and stepWordOf reads that run\'s exit 1 as DONE', () => {
    const { lines } = summarize({ platform: 'android', sources: [], results: [], side: THIS_CHECKOUT });
    expect(lines.filter((l) => l.startsWith(LIVE_GOLDEN_HEADER))).toHaveLength(1);
    expect(stepWordOf(1, { judged: true, log: lines.join('\n') })).toBe('DONE');
  });
});

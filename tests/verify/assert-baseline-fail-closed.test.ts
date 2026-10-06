import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaselineFrame } from '../../src/verify/capture.js';
import { Verifier } from '../../src/verify/assert.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * Baseline creation fails CLOSED (review 2026-10-06): only a confirmed
 * window stores a file. The one frame that exercises it — `unjudged`, no
 * `confirmed` at all — cannot come out of the real `captureBaselineFrame`
 * today: creation passes no deadline, so the pair always gets its second
 * capture. The capture is therefore replaced here, in its own file so no
 * other test sees the mock, with one that hands the assert exactly that
 * frame. The first cut of the check (`confirmed === false`) stored it.
 */
const next = vi.hoisted(() => ({ frame: undefined as unknown }));
vi.mock('../../src/verify/capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/verify/capture.js')>()),
  captureBaselineFrame: async () => next.frame,
}));

describe('screenshot baseline creation fails closed on a frame the window did not confirm', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('an `unjudged` frame (one capture, no window) is refused, worded as not judged, and nothing is written', async () => {
    const unjudged: BaselineFrame = { shot: Buffer.from('one look'), stability: 'unjudged', captures: 1 };
    next.frame = unjudged;
    const fake = new FakeAdapter({ s: node({ role: 'container' }) }, 's');
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs: 100, baselineDir: dir }).assert({
      screenshot: { baseline: 'dash' },
    });
    expect(result).toMatchObject({
      pass: false,
      detail:
        'baseline not created: the screen was not judged: 1 capture before the deadline, too few to say whether it was still (a baseline needs a settled pair and its confirmation window); re-run with more time',
    });
    await expect(readFile(join(dir, 'android', 'dash.png'))).rejects.toThrow();
  });
});

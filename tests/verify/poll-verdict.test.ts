import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { pollVerdicts } from '../../src/verify/poll-verdict.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

// The verifier's poll (verify/poll-verdict.ts#pollVerdicts): a pass and a final miss end it, a miss is kept in its
// memory until a later round replaces or withdraws it, and the timeout tail words what is left.

beforeEach(() => resetSleeps());

const FAST = { pollMs: 5, timeoutMs: 100 };

function counted() {
  const fake = new FakeAdapter({ s: screen(node({ identifier: 'card' })) }, 's');
  let reads = 0;
  const real = fake.uiTree.bind(fake);
  fake.uiTree = async () => {
    reads++;
    return real();
  };
  return { fake, reads: () => reads };
}

const wording = ({ miss }: { miss?: string }): string => `timed out on ${miss ?? 'nothing'}`;

describe('pollVerdicts', () => {
  it('a final verdict ends the poll at once with its sentence', async () => {
    const { fake, reads } = counted();
    const verdict = await pollVerdicts<string>(fake, () => ({ pass: false, detail: 'the engine will never read', final: true }), {
      ...FAST,
      timeoutDetail: wording,
    });
    expect(verdict).toEqual({ pass: false, detail: 'the engine will never read' });
    expect(reads()).toBe(1);
  });

  it('a final verdict or a miss on a handed-on tree is discarded: the fresh reads decide', async () => {
    const { fake, reads } = counted();
    const handed = { tree: screen(), startedAt: Date.now(), endedAt: Date.now() };
    const verdict = await pollVerdicts<string>(
      fake,
      (_tree, { handedOn }) => (handedOn ? { pass: false, detail: 'handed', final: true } : undefined),
      { ...FAST, first: { take: () => handed }, timeoutDetail: wording },
    );
    expect(verdict).toEqual({ pass: false, detail: 'timed out on nothing' });
    expect(reads()).toBeGreaterThan(1);
  });

  it('a miss is the timeout wording; a later round with nothing to say does not erase it', async () => {
    const { fake } = counted();
    let round = 0;
    const verdict = await pollVerdicts<string>(fake, () => (round++ === 0 ? { pass: false, miss: 'wrong content' } : undefined), {
      ...FAST,
      timeoutDetail: wording,
    });
    expect(verdict).toEqual({ pass: false, detail: 'timed out on wrong content' });
  });

  it('a later round withdraws a covered miss: the timeout words the silence after it', async () => {
    const { fake } = counted();
    type Miss = { detail: string; covered: boolean };
    let round = 0;
    const verdict = await pollVerdicts<Miss>(
      fake,
      (_tree, _round, finding) => {
        if (round++ === 0) return { pass: false, miss: { detail: 'the keyboard covers it', covered: true } };
        finding.withdraw((m) => m.covered);
        return undefined;
      },
      { ...FAST, timeoutDetail: ({ miss }) => miss?.detail ?? 'found, no time' },
    );
    expect(verdict).toEqual({ pass: false, detail: 'found, no time' });
  });

  it('a withdrawal leaves a miss it does not match standing', async () => {
    const { fake } = counted();
    type Miss = { detail: string; covered: boolean };
    let round = 0;
    const verdict = await pollVerdicts<Miss>(
      fake,
      (_tree, _round, finding) => {
        finding.withdraw((m) => m.covered);
        return round++ === 0 ? { pass: false, miss: { detail: 'sampled #3F3F50', covered: false } } : undefined;
      },
      { ...FAST, timeoutDetail: ({ miss }) => miss?.detail ?? 'found, no time' },
    );
    expect(verdict).toEqual({ pass: false, detail: 'sampled #3F3F50' });
  });

  it('a pass carries its detail', async () => {
    const { fake } = counted();
    const verdict = await pollVerdicts<string>(fake, () => ({ pass: true, detail: 'measured' }), { ...FAST, timeoutDetail: wording });
    expect(verdict).toEqual({ pass: true, detail: 'measured' });
  });
});

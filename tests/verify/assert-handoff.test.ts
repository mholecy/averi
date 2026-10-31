import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { Verifier, type AssertSpec } from '../../src/verify/assert.js';
import { ReadHandOff } from '../../src/ui-tree/read-handoff.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

// The asserts' share of the read hand-off (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-positive-
// verdict.md): every assert produces, only the element assert takes, and only a pass is taken from the handed tree.

beforeEach(() => resetSleeps());
afterEach(() => vi.useRealTimers());

const FAST = { pollMs: 5, timeoutMs: 100 };

function counted() {
  const fake = new FakeAdapter(
    {
      home: screen(
        node({ identifier: 'title', label: 'Home', rect: { x: 0, y: 0, width: 200, height: 40 } }),
        node({ identifier: 'balance', value: '10', rect: { x: 0, y: 100, width: 200, height: 40 } }),
      ),
    },
    'home',
  );
  let reads = 0;
  const real = fake.uiTree.bind(fake);
  fake.uiTree = async () => {
    reads++;
    return real();
  };
  return { fake, reads: () => reads };
}

const title: AssertSpec = { element: { id: 'title' } };
const balance: AssertSpec = { element: { id: 'balance' }, text: '10' };

describe('Verifier — the read hand-off', () => {
  it('an element assert after an element assert passes on the first one\'s read', async () => {
    const { fake, reads } = counted();
    const results = await new Verifier(fake, FAST).assertAll([title, balance]);
    expect(results.every((r) => r.pass)).toBe(true);
    expect(reads()).toBe(1);
  });

  it('a read is handed on once: a third assert reads fresh, a fourth takes the third\'s', async () => {
    const { fake, reads } = counted();
    await new Verifier(fake, FAST).assertAll([title, balance, title]);
    expect(reads()).toBe(2);
    await new Verifier(fake, FAST).assertAll([title, balance, title, balance]);
    expect(reads()).toBe(4);
  });

  it('a miss on the handed tree reads fresh: the value changed after the first assert\'s read is found', async () => {
    const { fake, reads } = counted();
    const verifier = new Verifier(fake, FAST);
    await verifier.assert(title);
    fake.live().children[1].value = '20';
    const [r] = await verifier.assertAll([{ element: { id: 'balance' }, text: '20' }]);
    expect(r.pass).toBe(true);
    expect(reads()).toBe(2);
  });

  it('a failing element assert after a handed miss words what the FRESH reads saw', async () => {
    const { fake } = counted();
    const verifier = new Verifier(fake, FAST);
    await verifier.assert(title);
    const [r] = await verifier.assertAll([{ element: { id: 'balance' }, text: '99' }]);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/content was: "10"/);
  });

  // The asserts that never take: an absence, a measured position, and every pixel locator. Spied on the hand-off
  // itself, so the test cannot pass by the assert reading fresh after taking.
  const neverTaking: [string, AssertSpec][] = [
    ['absent', { element: { id: 'gone' }, absent: true }],
    ['rect', { element: { id: 'title' }, rect: { x: 0, w: 200, frameWidth: 1000 } }],
    ['color', { element: { id: 'title' }, color: { expected: '#ffffff' } }],
    ['ocr', { element: { id: 'title' }, ocr: { text: 'Home' } }],
    ['screenshot', { screenshot: { baseline: 'never-there' } }],
  ];
  for (const [kind, spec] of neverTaking) {
    it(`a ${kind} assert never takes the hand-off`, async () => {
      const { fake } = counted();
      const handOff = new ReadHandOff();
      const take = vi.spyOn(handOff, 'take');
      const verifier = new Verifier(fake, { ...FAST, handOff, ocr: { engine: { recognize: async () => [] } }, baselineDir: '/nonexistent-averi-baselines' });
      await verifier.assert(title);
      take.mockClear();
      await verifier.assert(spec).catch(() => undefined);
      expect(take).not.toHaveBeenCalled();
    });
  }

  it('nothing crosses Verifiers: the next call reads fresh', async () => {
    const { fake, reads } = counted();
    await new Verifier(fake, FAST).assertAll([title]);
    await new Verifier(fake, FAST).assertAll([title]);
    expect(reads()).toBe(2);
  });

  it('an action between two asserts on a shared hand-off sends the second to the device', async () => {
    const { fake, reads } = counted();
    const handOff = new ReadHandOff();
    const verifier = new Verifier(fake, { ...FAST, handOff });
    await verifier.assert(title);
    await handOff.watch(fake).pressKey('back');
    await verifier.assert(balance);
    expect(reads()).toBe(2);
  });
});

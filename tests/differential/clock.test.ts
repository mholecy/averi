import { describe, expect, it } from 'vitest';
import { installVirtualClock, resetClock } from '../../scripts/differential/clock.js';
import { sleep } from '../../src/util/sleep.js';

// Virtual time: averi's one sleep owner moves the clock and returns at once; any other timer stays real.

describe('installVirtualClock', () => {
  it('a 30 s sleep of util/sleep.ts returns at once and moves Date.now by 30 s; resetClock starts it over', async () => {
    installVirtualClock();
    resetClock();
    const before = Date.now();
    const wall = performance.now();
    await sleep(30_000);
    expect([Date.now() - before, performance.now() - wall < 1_000]).toEqual([30_000, true]);
    resetClock();
    expect(Date.now()).toBe(before);
  });

  it('a timer set anywhere else is real: it neither moves the clock nor fires early', async () => {
    installVirtualClock();
    resetClock();
    const before = Date.now();
    const wall = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect([Date.now() - before, performance.now() - wall >= 45]).toEqual([0, true]);
  });
});

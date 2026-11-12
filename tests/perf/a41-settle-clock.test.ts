import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Trial } from '../../scripts/perf/a41.js';
import { installReplayClock, replaySettles } from '../../scripts/perf/a41-settle.js';

// a41-settle.ts#installReplayClock — the clock scripts/perf/a41-report.ts replays the device trace on: the real sleep
// module (no mock), its timers moved to virtual time by the stack. Held to T5's sensitivity pin on the d35 fixture's
// carousel trials (M2, at 100 ms: one wrong settle, M2#14's C), and put back after.

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/d35-b11-settle.json', import.meta.url), 'utf8')) as { trials: Trial[] };

describe('installReplayClock: the production settle on virtual time, in a plain process', () => {
  it("M2 at 100 ms: T5's 60 settles and its one wrong one; Date and setTimeout put back", async () => {
    const [now, timer] = [Date.now, globalThis.setTimeout];
    const clock = installReplayClock();
    let pass;
    try {
      pass = await replaySettles(
        FIXTURE.trials.filter((t) => t.motion === 'M2'),
        { pollMs: 100 },
        clock,
      );
    } finally {
      clock.uninstall();
    }
    expect(pass).toEqual({ pollMs: 100, settles: { M2: 60 }, wrong: ['M2#14 lab.carousel-in-list.C @20'], moving: 20, censored: 0, judged: 20, wrongJudged: 1 });
    expect([Date.now, globalThis.setTimeout]).toEqual([now, timer]);
  });

  it('a timer not set by the sleep owner stays real; set and now are whole milliseconds', async () => {
    const clock = installReplayClock();
    try {
      clock.set(12.9);
      expect(clock.now()).toBe(12);
      expect(Date.now()).toBe(12);
      await new Promise((r) => setTimeout(r, 1));
      expect(Date.now()).toBe(12);
    } finally {
      clock.uninstall();
    }
  });
});

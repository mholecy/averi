import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Trial } from '../../scripts/perf/a41.js';
import { replaySettles, type ReplayClock } from '../../scripts/perf/a41-settle.js';

// No-yield sleep, as tests/interact/settle-trace.test.ts (T5) mocks it: a sleep only moves the faked clock.
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number): Promise<void> => {
    vi.setSystemTime(Date.now() + ms);
  },
}));

// a41-settle.ts#replaySettles is T5's replay as a module (A41b's WDA cadence is judged by it): held here to T5's own
// pins on the same d35 fixture, at the same cadences — the same settles and the same wrong one — so the module's
// replay is T5's, not a re-implementation of the settle. Only Date is faked; resolveSettled runs unmodified.

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/d35-b11-settle.json', import.meta.url), 'utf8')) as { trials: Trial[] };

const viClock: ReplayClock = { now: () => Date.now(), set: (ms) => vi.setSystemTime(ms) };

async function replay(pollMs: number, trials: readonly Trial[] = FIXTURE.trials) {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    return await replaySettles(trials, { pollMs }, viClock);
  } finally {
    vi.useRealTimers();
  }
}

describe('replaySettles: a settle of a static id, and one with too little window after it, are counted apart', () => {
  it('a static id settles on its second read; a moving one late, censored when under 500 ms of reads follow', async () => {
    // Reads every 400 ms for 2.4 s; `s` never moves, `m` moves until read 3 and then holds.
    const reads: [number, number][] = [0, 1, 2, 3, 4, 5].map((i) => [i * 400 + 1, i * 400 + 31]);
    const t: Trial = { motion: 'M', cell: 'x', trial: 0, trigger: [0, 1], appMoved: null, reads, rects: { 'lab.x.s': '+.....', 'lab.x.m': '++++..' } };
    // s settles at read 1 (2000 ms of reads after: not censored); m at read 4 (400 ms after: censored).
    expect(await replay(300, [t])).toEqual({ pollMs: 300, settles: { M: 2 }, wrong: [], moving: 1, censored: 1 });
  });
});

describe('replaySettles on the d35 fixture: T5\'s pins', () => {
  it('at 300: 0 wrong settles in 160 (M1a 0, M1b 100, M2 60)', async () => {
    expect(await replay(300)).toEqual({ pollMs: 300, settles: { M1a: 0, M1b: 100, M2: 60 }, wrong: [], moving: 80, censored: 12 });
  });

  it('at 100: the carousel settles wrong once, in its late deceleration (M2#14, C)', async () => {
    expect(await replay(100)).toEqual({ pollMs: 100, settles: { M1a: 245, M1b: 100, M2: 60 }, wrong: ['M2#14 lab.carousel-in-list.C @20'], moving: 325, censored: 245 });
  });

  it('a trial whose window ends before any settle counts none, and a motion with no trial is not listed', async () => {
    const t: Trial = { motion: 'M9', cell: 'x', trial: 0, trigger: [0, 1], appMoved: null, reads: [[1, 2]], rects: { 'lab.x.A': '+' } };
    expect(await replay(300, [t])).toEqual({ pollMs: 300, settles: { M9: 0 }, wrong: [], moving: 0, censored: 0 });
  });
});

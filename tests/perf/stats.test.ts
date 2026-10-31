import { describe, expect, it } from 'vitest';
import { breakdown, busyMs, measure, median, summarize } from '../../scripts/perf/stats.js';

// stats.ts: what one measured tool call adds up to, and what N repeats of it add up to. The numbers below are worked by
// hand from the intervals, not recomputed the way the code computes them.

describe('busyMs — the time at least one interval was open', () => {
  it('counts overlapping intervals once and adds the disjoint ones', () => {
    expect(busyMs([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 20 }, { startMs: 30, endMs: 35 }])).toBe(25);
  });
  it('does not depend on the order the intervals were recorded in, and nests', () => {
    expect(busyMs([{ startMs: 30, endMs: 35 }, { startMs: 0, endMs: 100 }, { startMs: 10, endMs: 20 }])).toBe(100);
  });
  it('is 0 for none', () => {
    expect(busyMs([])).toBe(0);
  });
});

describe('median', () => {
  it('is the middle of an odd count and the mean of the two middles of an even one', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
  });
});

describe('measure — one window of one tool call', () => {
  it('splits device calls from host processes, sums their time, and takes slept time as the union of the sleeps', () => {
    const m = measure(
      {
        calls: [
          { kind: 'adb', label: 'adb exec-out uiautomator dump', startMs: 0, endMs: 300, ok: true },
          { kind: 'adb', label: 'adb shell input tap', startMs: 800, endMs: 900, ok: true },
          { kind: 'wda', label: 'wda GET /source', startMs: 850, endMs: 950, ok: true },
          { kind: 'host', label: 'host averi-ocr', startMs: 1000, endMs: 1200, ok: false },
        ],
        sleeps: [
          { ms: 500, caller: 'src/ui-tree/read-tree.ts:306', startMs: 300, endMs: 801 },
          { ms: 150, caller: 'src/adapters/android.ts:724', startMs: 700, endMs: 852 },
        ],
      },
      1300,
      120,
    );
    expect(m).toMatchObject({
      wallMs: 1300,
      cpuMs: 120,
      deviceCalls: 3,
      calls: { adb: 2, wda: 1 },
      deviceMs: 500,
      deviceBusyMs: 450,
      hostCalls: 1,
      hostMs: 200,
      sleeps: 2,
      sleptMs: 552,
    });
  });
});

describe('summarize — N repeats of one scenario', () => {
  const run = (wallMs: number, deviceCalls: number, sleptMs: number) => ({
    status: 'ok' as const,
    wallMs,
    cpuMs: 10,
    deviceCalls,
    calls: { adb: deviceCalls },
    deviceMs: wallMs / 2,
    deviceBusyMs: wallMs / 2,
    hostCalls: 0,
    hostMs: 0,
    sleeps: 1,
    sleptMs,
  });

  it('reports the median and the spread of the ok runs, and how many there were of each status', () => {
    const s = summarize([run(1000, 4, 500), run(1400, 5, 500), run(1100, 4, 1000), { ...run(9000, 9, 0), status: 'failed' }]);
    expect(s).toMatchObject({
      runs: 4,
      statuses: { ok: 3, failed: 1 },
      wallMs: { median: 1100, min: 1000, max: 1400 },
      deviceCalls: { median: 4, min: 4, max: 5 },
      sleptMs: { median: 500, min: 500, max: 1000 },
      deviceMs: { median: 550 },
    });
  });

  it('has no numbers when no run was ok — an unavailable scenario says so instead of measuring its refusal', () => {
    const s = summarize([{ ...run(30, 0, 0), status: 'unavailable' }]);
    expect(s.statuses).toEqual({ unavailable: 1 });
    expect(s.wallMs).toBeUndefined();
    expect(Object.keys(s)).toEqual(['runs', 'statuses']);
  });
});

describe('breakdown — where a scenario\'s time goes, per run', () => {
  it('averages each command\'s calls and time, and each sleep caller\'s sleeps and asked-for time, over the runs, the costliest first', () => {
    const call = (label: string, ms: number) => ({ kind: 'adb', label, startMs: 0, endMs: ms, ok: true });
    const sleep = (caller: string, ms: number) => ({ ms, caller, startMs: 0, endMs: ms + 3 });
    const b = breakdown([
      { calls: [call('adb exec-out uiautomator dump', 400), call('adb exec-out uiautomator dump', 600), call('adb shell input tap', 50)], sleeps: [sleep('src/ui-tree/read-tree.ts:306', 500)] },
      { calls: [call('adb exec-out uiautomator dump', 500)], sleeps: [sleep('src/ui-tree/read-tree.ts:306', 500), sleep('src/adapters/android.ts:724', 150)] },
    ]);
    expect(b.calls).toEqual([
      { kind: 'adb', label: 'adb exec-out uiautomator dump', count: 1.5, ms: 750 },
      { kind: 'adb', label: 'adb shell input tap', count: 0.5, ms: 25 },
    ]);
    expect(b.sleeps).toEqual([
      { caller: 'src/ui-tree/read-tree.ts:306', count: 1, ms: 500 },
      { caller: 'src/adapters/android.ts:724', count: 0.5, ms: 75 },
    ]);
  });
});

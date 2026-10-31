import { describe, expect, it } from 'vitest';
import {
  isScreenshotStall,
  overallStalls,
  scenarioStalls,
  SCREENSHOT_LABEL,
  SCREENSHOT_STALL_MS,
  type DeviceCall,
  type Status,
  type TimedRun,
  type Window,
} from '../../scripts/perf/stats.js';

// D26's arithmetic in stats.ts: `simctl io screenshot` is bimodal (~400 ms, or ~1 400 ms when it stalls), so the D0
// report counts the screenshots and the stalls apart, and gives each scenario's wall clock over its stall-free runs.
// Numbers worked by hand. The rendering is tests/perf/report.test.ts's.

const shot = (startMs: number, ms: number): DeviceCall => ({ kind: 'simctl', label: SCREENSHOT_LABEL, startMs, endMs: startMs + ms, ok: true });
const other = (ms: number): DeviceCall => ({ kind: 'idb', label: 'idb ui describe-all', startMs: 0, endMs: ms, ok: true });
const win = (...calls: DeviceCall[]): Window => ({ calls, sleeps: [] });
const run = (wallMs: number, window: Window, status: Status = 'ok'): TimedRun => ({ status, wallMs, window });

describe('isScreenshotStall — a simctl screenshot over the threshold', () => {
  it('sits between the modes: 900 ms', () => {
    expect(SCREENSHOT_STALL_MS).toBe(900);
  });
  it('is a stall over the threshold, not at it', () => {
    expect(isScreenshotStall(shot(0, 1400))).toBe(true);
    expect(isScreenshotStall(shot(0, 901))).toBe(true);
    expect(isScreenshotStall(shot(0, 900))).toBe(false);
    expect(isScreenshotStall(shot(0, 400))).toBe(false);
  });
  it('is only a screenshot that completed: a failed or pending one is no stall, however long', () => {
    expect(isScreenshotStall({ ...shot(0, 1400), ok: false })).toBe(false);
    expect(isScreenshotStall({ ...shot(0, 1400), ok: false, pending: true })).toBe(false);
    // Recorder.end marks a pending call not ok; the type does not, and pending alone is enough.
    expect(isScreenshotStall({ ...shot(0, 1400), pending: true })).toBe(false);
  });
  it('is only ever a simctl screenshot: a slow call of any other command is not one', () => {
    expect(isScreenshotStall(other(5000))).toBe(false);
    expect(isScreenshotStall({ ...shot(0, 1400), label: 'simctl io recordVideo' })).toBe(false);
  });
});

describe('scenarioStalls — one scenario\'s screenshots, stalls, and wall clock without them', () => {
  it('counts screenshots and stalls over every run, and the wall clock over the ok runs with no stall', () => {
    const s = scenarioStalls([
      run(1100, win(shot(0, 400), other(200))),
      // Two stalls in one run are two stalls, not one stalled run.
      run(3500, win(shot(0, 1400), shot(1500, 1380))),
      run(1000, win(shot(0, 380), shot(500, 390))),
      run(1300, win(shot(0, 410))),
      // A failed run's screenshots are counted (the stall is simctl's, not the scenario's), its wall clock is not.
      run(9000, win(shot(0, 1390)), 'failed'),
      // …and a failed run that did not stall is still not a stall-free ok run.
      run(30, win(shot(0, 400)), 'failed'),
    ]);
    expect(s).toEqual({ screenshots: 8, stalls: 3, failed: 0, stallFreeRuns: 3, stallFreeWallMs: { median: 1100, min: 1000, max: 1300 } });
  });
  it('has no stall-free wall clock when every ok run stalled', () => {
    expect(scenarioStalls([run(2000, win(shot(0, 1400)))])).toEqual({ screenshots: 1, stalls: 1, failed: 0, stallFreeRuns: 0 });
  });
  it('counts a failed or pending screenshot as failed, not as a stall — and its ok run is not stall-free either: it is untimed', () => {
    expect(
      scenarioStalls([
        run(5000, win({ ...shot(0, 4000), ok: false })),
        run(4400, win(shot(0, 400), { ...shot(4000, 400), ok: false, pending: true })),
        run(1000, win(shot(0, 400))),
      ]),
    ).toEqual({ screenshots: 4, stalls: 0, failed: 2, stallFreeRuns: 1, stallFreeWallMs: { median: 1000, min: 1000, max: 1000 } });
  });
  it('is zero screenshots for a scenario that took none, and every ok run is stall-free', () => {
    expect(scenarioStalls([run(150, win(other(100))), run(170, win())])).toEqual({
      screenshots: 0,
      stalls: 0,
      failed: 0,
      stallFreeRuns: 2,
      stallFreeWallMs: { median: 160, min: 150, max: 170 },
    });
  });
});

describe('overallStalls — the whole run\'s screenshots, and each mode\'s length', () => {
  it('pools every window, and gives the ok calls\' and the stalls\' length apart', () => {
    const o = overallStalls([win(shot(0, 400), other(3000)), win(shot(0, 1400), shot(2000, 350)), win(shot(0, 1380))]);
    expect(o).toEqual({
      thresholdMs: 900,
      screenshots: 4,
      stalls: 2,
      failed: 0,
      okMs: { median: 375, min: 350, max: 400 },
      stallMs: { median: 1390, min: 1380, max: 1400 },
    });
  });
  it('is zero, with no lengths, when no screenshot was taken', () => {
    expect(overallStalls([win(other(100))])).toEqual({ thresholdMs: 900, screenshots: 0, stalls: 0, failed: 0 });
  });
  it('keeps a failed or pending screenshot out of the stalls and out of both lengths, and counts it apart', () => {
    expect(overallStalls([win(shot(0, 400), { ...shot(500, 1500), ok: false }, { ...shot(2000, 50), ok: false, pending: true }, shot(3000, 1400))])).toEqual({
      thresholdMs: 900,
      screenshots: 4,
      stalls: 1,
      failed: 2,
      okMs: { median: 400, min: 400, max: 400 },
      stallMs: { median: 1400, min: 1400, max: 1400 },
    });
  });
});

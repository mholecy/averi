import { describe, expect, it } from 'vitest';
import {
  isScreenshotStall,
  overallStalls,
  scenarioStalls,
  SCREENSHOT_LABEL,
  SCREENSHOT_STALL_MS,
  stallCells,
  stallLine,
  type DeviceCall,
  type Status,
  type Window,
} from '../../scripts/perf/stats.js';

// D26: `simctl io screenshot` is bimodal (~400 ms, or ~1 400 ms when it stalls). The D0 report counts the screenshots
// and the stalls apart, and gives each scenario's wall clock over its stall-free runs. Numbers worked by hand.

const shot = (startMs: number, ms: number): DeviceCall => ({ kind: 'simctl', label: SCREENSHOT_LABEL, startMs, endMs: startMs + ms, ok: true });
const other = (ms: number): DeviceCall => ({ kind: 'idb', label: 'idb ui describe-all', startMs: 0, endMs: ms, ok: true });
const win = (...calls: DeviceCall[]): Window => ({ calls, sleeps: [] });
const run = (wallMs: number, window: Window, status: Status = 'ok') => ({ status, wallMs, window });

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
  it('is only ever a simctl screenshot: a slow call of any other command is not one', () => {
    expect(isScreenshotStall(other(5000))).toBe(false);
    expect(isScreenshotStall({ ...shot(0, 1400), label: 'simctl io recordVideo' })).toBe(false);
  });
});

describe('scenarioStalls — one scenario\'s screenshots, stalls, and wall clock without them', () => {
  it('counts screenshots and stalls over every run, and the wall clock over the ok runs with no stall', () => {
    const s = scenarioStalls([
      run(1100, win(shot(0, 400), other(200))),
      run(2100, win(shot(0, 1400))),
      run(1000, win(shot(0, 380), shot(500, 390))),
      run(1300, win(shot(0, 410))),
      // A failed run's screenshots are counted (the stall is simctl's, not the scenario's), its wall clock is not.
      run(9000, win(shot(0, 1390)), 'failed'),
      // …and a failed run that did not stall is still not a stall-free ok run.
      run(30, win(shot(0, 400)), 'failed'),
    ]);
    expect(s).toEqual({ screenshots: 7, stalls: 2, stallFreeRuns: 3, stallFreeWallMs: { median: 1100, min: 1000, max: 1300 } });
  });
  it('has no stall-free wall clock when every ok run stalled', () => {
    expect(scenarioStalls([run(2000, win(shot(0, 1400)))])).toEqual({ screenshots: 1, stalls: 1, stallFreeRuns: 0 });
  });
  it('is zero screenshots for a scenario that took none, and every ok run is stall-free', () => {
    expect(scenarioStalls([run(150, win(other(100))), run(170, win())])).toEqual({
      screenshots: 0,
      stalls: 0,
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
      okMs: { median: 375, min: 350, max: 400 },
      stallMs: { median: 1390, min: 1380, max: 1400 },
    });
  });
  it('is zero, with no lengths, when no screenshot was taken', () => {
    expect(overallStalls([win(other(100))])).toEqual({ thresholdMs: 900, screenshots: 0, stalls: 0 });
  });
});

describe('stallLine — the overall stall line of the text report', () => {
  it('says the count, the share and both modes', () => {
    expect(
      stallLine({ thresholdMs: 900, screenshots: 201, stalls: 24, okMs: { median: 382.4, min: 336, max: 451 }, stallMs: { median: 1390, min: 1366, max: 1415 } }),
    ).toBe('simctl io screenshot: 24 stalls (> 900 ms) in 201 calls, 11.9 % · ok calls 382 [336–451] ms · stalls 1390 [1366–1415] ms');
  });
  it('says none stalled without a stall length', () => {
    expect(stallLine({ thresholdMs: 900, screenshots: 50, stalls: 0, okMs: { median: 260, min: 240, max: 300 } })).toBe(
      'simctl io screenshot: 0 stalls (> 900 ms) in 50 calls, 0.0 % · ok calls 260 [240–300] ms',
    );
  });
  it('says none were taken', () => {
    expect(stallLine({ thresholdMs: 900, screenshots: 0, stalls: 0 })).toBe('simctl io screenshot: none taken');
  });
});

describe('stallCells — a scenario\'s two stall columns of the text table', () => {
  it('gives screenshots/stalls, and the stall-free median with how many runs it is over', () => {
    expect(stallCells({ screenshots: 10, stalls: 4, stallFreeRuns: 1, stallFreeWallMs: { median: 3872.4, min: 3872.4, max: 3872.4 } })).toEqual(['10/4', '3872 (1)']);
  });
  it('dashes a median it has no run for', () => {
    expect(stallCells({ screenshots: 5, stalls: 5, stallFreeRuns: 0 })).toEqual(['5/5', '—']);
  });
});

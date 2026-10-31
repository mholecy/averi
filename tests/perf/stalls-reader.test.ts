import { describe, expect, it } from 'vitest';
import { stallReport, type Result } from '../../scripts/perf/stalls.js';
import { SCREENSHOT_LABEL, type DeviceCall } from '../../scripts/perf/stats.js';

// scripts/perf/stalls.ts: the D26 stall summary recomputed from a D0 results JSON written before the report carried it
// — from each run's recorded window, not from anything the old file summarised.

const shot = (ms: number): DeviceCall => ({ kind: 'simctl', label: SCREENSHOT_LABEL, startMs: 10, endMs: 10 + ms, ok: true });
const result: Result = {
  meta: { described: 'averi-lab iPhone 17 simulator, iOS 27.0' },
  scenarios: [
    {
      id: 'screenshot',
      summary: { wallMs: { median: 1100, min: 1000, max: 2100 } },
      runs: [
        { status: 'ok', wallMs: 1000, window: { calls: [shot(400)], sleeps: [] } },
        { status: 'ok', wallMs: 2100, window: { calls: [shot(1400)], sleeps: [] } },
        { status: 'ok', wallMs: 1100, window: { calls: [shot(380)], sleeps: [] } },
      ],
    },
    { id: 'tree', summary: { wallMs: { median: 110, min: 100, max: 120 } }, runs: [{ status: 'ok', wallMs: 110, window: { calls: [], sleeps: [] } }] },
  ],
};

describe('stallReport — one results JSON\'s stalls, recomputed', () => {
  it('gives a line per scenario (its screenshots/stalls, its wall median, the stall-free one) and the overall line', () => {
    const { lines, windows } = stallReport(result);
    expect(lines).toEqual([
      '  screenshot  3/1  wall med 1100  stall-free 1050 (2)',
      '  tree        0/0  wall med 110  stall-free 110 (1)',
      '  simctl io screenshot: 1 stalls (> 900 ms) in 3 calls, 33.3 % · ok calls 390 [380–400] ms · stalls 1400 [1400–1400] ms',
    ]);
    expect(windows).toHaveLength(4);
  });
});

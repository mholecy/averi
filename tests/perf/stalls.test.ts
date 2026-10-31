import { describe, expect, it } from 'vitest';
import { stallReport, type ResultsJson } from '../../scripts/perf/stalls.js';
import { SCREENSHOT_LABEL, type DeviceCall } from '../../scripts/perf/stats.js';

// scripts/perf/stalls.ts: the D26 stall summary recomputed from D0 results JSON written before the report carried it
// — from each run's recorded window, not from anything the old file summarised.

const shot = (ms: number): DeviceCall => ({ kind: 'simctl', label: SCREENSHOT_LABEL, startMs: 10, endMs: 10 + ms, ok: true });
/** Three ok screenshot runs (one stalled), a failed run that stalled, and a tree read with no screenshot. */
const oneStallOkOneStallFailed: ResultsJson = {
  scenarios: [
    {
      id: 'screenshot',
      summary: { wallMs: { median: 1100, min: 1000, max: 2100 } },
      runs: [
        { status: 'ok', wallMs: 1000, window: { calls: [shot(400)], sleeps: [] } },
        { status: 'ok', wallMs: 2100, window: { calls: [shot(1400)], sleeps: [] } },
        { status: 'ok', wallMs: 1100, window: { calls: [shot(380)], sleeps: [] } },
        // A failed run's stall is simctl's all the same: it is in the overall and the pooled line.
        { status: 'failed', wallMs: 9000, window: { calls: [shot(1380)], sleeps: [] } },
      ],
    },
    { id: 'tree', summary: { wallMs: { median: 110, min: 100, max: 120 } }, runs: [{ status: 'ok', wallMs: 110, window: { calls: [], sleeps: [] } }] },
  ],
};
/** One ok screenshot run, no stall. */
const noStall: ResultsJson = {
  scenarios: [{ id: 'screenshot', summary: { wallMs: { median: 1000, min: 1000, max: 1000 } }, runs: [{ status: 'ok', wallMs: 1000, window: { calls: [shot(420)], sleeps: [] } }] }],
};

describe('stallReport — results JSON\'s stalls, recomputed', () => {
  it('gives per file a line per scenario (screenshots/stalls, the wall median, the stall-free one) and the overall line', () => {
    expect(stallReport([{ file: 'on.json', result: oneStallOkOneStallFailed }])).toEqual([
      'on.json',
      '  screenshot  4/2  wall med 1100  stall-free 1050 (2)',
      '  tree        0/0  wall med 110  stall-free 110 (1)',
      '  simctl io screenshot: 2 stalls (> 900 ms) in 4 calls, 50.0 % · ok calls 390 [380–400] ms · stalls 1390 [1380–1400] ms',
    ]);
  });
  it('pools several files in a last line', () => {
    expect(stallReport([{ file: 'on.json', result: oneStallOkOneStallFailed }, { file: 'off.json', result: noStall }]).slice(-4)).toEqual([
      'off.json',
      '  screenshot  1/0  wall med 1000  stall-free 1000 (1)',
      '  simctl io screenshot: 0 stalls (> 900 ms) in 1 calls, 0.0 % · ok calls 420 [420–420] ms',
      'pooled, 2 files: simctl io screenshot: 2 stalls (> 900 ms) in 5 calls, 40.0 % · ok calls 400 [380–420] ms · stalls 1390 [1380–1400] ms',
    ]);
  });
});

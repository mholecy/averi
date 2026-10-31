import { describe, expect, it } from 'vitest';
import { fmtMs, fmtSpread, reportTable, stallCells, stallLine, stallLines } from '../../scripts/perf/report.js';
import type { OverallStalls, Summary } from '../../scripts/perf/stats.js';

// report.ts: the D0 report's text — the table, and D26's stall columns and line. Strings written out by hand.

describe('fmtMs / fmtSpread — the two number formats', () => {
  it('rounds a length to whole ms', () => {
    expect(fmtMs(382.5)).toBe('383');
    expect(fmtMs(382.4)).toBe('382');
  });
  it('gives a spread as median [min–max], and a dash for none', () => {
    expect(fmtSpread({ median: 1000.4, min: 899.6, max: 1100 })).toBe('1000 [900–1100]');
    expect(fmtSpread(undefined)).toBe('—');
  });
});

describe('stallLine — one capture\'s stall line of the text report', () => {
  it('says the count, the share and both modes', () => {
    expect(
      stallLine({ screenshots: 201, stalls: 24, failed: 0, okMs: { median: 382.4, min: 336, max: 451 }, stallMs: { median: 1390, min: 1366, max: 1415 } }, 900, 'simctl io screenshot'),
    ).toBe('simctl io screenshot: 24 stalls (> 900 ms) in 201 calls, 11.9 % · ok calls 382 [336–451] ms · stalls 1390 [1366–1415] ms');
  });
  it('says none stalled without a stall length', () => {
    expect(stallLine({ screenshots: 50, stalls: 0, failed: 0, okMs: { median: 260, min: 240, max: 300 } }, 900, 'simctl io screenshot')).toBe(
      'simctl io screenshot: 0 stalls (> 900 ms) in 50 calls, 0.0 % · ok calls 260 [240–300] ms',
    );
  });
  it('says how many failed, and gives the share over the calls that completed', () => {
    expect(stallLine({ screenshots: 10, stalls: 2, failed: 1, okMs: { median: 400, min: 380, max: 420 }, stallMs: { median: 1400, min: 1390, max: 1410 } }, 900, 'simctl io screenshot')).toBe(
      'simctl io screenshot: 2 stalls (> 900 ms) in 10 calls (1 failed, not timed), 22.2 % · ok calls 400 [380–420] ms · stalls 1400 [1390–1410] ms',
    );
  });
  it('gives no share when every screenshot failed', () => {
    expect(stallLine({ screenshots: 2, stalls: 0, failed: 2 }, 900, 'simctl io screenshot')).toBe('simctl io screenshot: 0 stalls (> 900 ms) in 2 calls (2 failed, not timed), — %');
  });
});

describe('stallLines — the run\'s stall lines: one per capture it took (D26b)', () => {
  const one = { screenshots: 2, stalls: 1, failed: 0, okMs: { median: 400, min: 400, max: 400 }, stallMs: { median: 1400, min: 1400, max: 1400 } };
  const idb = { screenshots: 3, stalls: 0, failed: 0, okMs: { median: 85, min: 80, max: 90 } };
  const total = (byLabel: OverallStalls['byLabel']): OverallStalls => ({ thresholdMs: 900, screenshots: 5, stalls: 1, failed: 0, byLabel });
  it('is the one line it always was when the run took one kind', () => {
    expect(stallLines(total({ 'simctl io screenshot': one }))).toEqual([
      'simctl io screenshot: 1 stalls (> 900 ms) in 2 calls, 50.0 % · ok calls 400 [400–400] ms · stalls 1400 [1400–1400] ms',
    ]);
  });
  it('is a line per capture when it took both, simctl\'s first', () => {
    expect(stallLines(total({ 'idb screenshot': idb, 'simctl io screenshot': one }))).toEqual([
      'simctl io screenshot: 1 stalls (> 900 ms) in 2 calls, 50.0 % · ok calls 400 [400–400] ms · stalls 1400 [1400–1400] ms',
      'idb screenshot: 0 stalls (> 900 ms) in 3 calls, 0.0 % · ok calls 85 [80–90] ms',
    ]);
  });
  it('says none were taken, naming both captures', () => {
    expect(stallLines({ thresholdMs: 900, screenshots: 0, stalls: 0, failed: 0, byLabel: {} })).toEqual(['simctl io screenshot / idb screenshot: none taken']);
  });
});

describe('stallCells — a scenario\'s two stall columns of the text table', () => {
  it('gives screenshots/stalls, and the stall-free median with how many runs it is over', () => {
    expect(stallCells({ screenshots: 10, stalls: 4, failed: 0, stallFreeRuns: 1, stallFreeWallMs: { median: 3872.4, min: 3872.4, max: 3872.4 } })).toEqual(['10/4', '3872 (1)']);
  });
  it('dashes a median it has no run for', () => {
    expect(stallCells({ screenshots: 5, stalls: 5, failed: 0, stallFreeRuns: 0 })).toEqual(['5/5', '—']);
  });
});

describe('reportTable — the text table under the run\'s header line', () => {
  const sp = (median: number, min = median, max = median) => ({ median, min, max });
  const tap: Summary = {
    runs: 2,
    statuses: { ok: 1, failed: 1 },
    wallMs: sp(1000, 900, 1100),
    cpuMs: sp(50),
    deviceCalls: sp(3),
    deviceMs: sp(600),
    deviceBusyMs: sp(500),
    hostCalls: sp(0),
    hostMs: sp(0),
    sleeps: sp(1),
    sleptMs: sp(300),
  };
  const ocr: Summary = { runs: 1, statuses: { unavailable: 1 } };
  const none = { screenshots: 0, stalls: 0, failed: 0, stallFreeRuns: 1 };

  it('with no screenshot taken is the columns it always had, and no stall line', () => {
    expect(
      reportTable(
        [
          { id: 'tap', summary: tap, stalls: none },
          { id: 'ocr', summary: ocr, stalls: { ...none, stallFreeRuns: 0 } },
        ],
        { thresholdMs: 900, screenshots: 0, stalls: 0, failed: 0, byLabel: {} },
      ),
    ).toEqual([
      'scenario            ok/runs  wall ms med [min–max]  dev calls  dev ms  dev busy  slept ms  sleeps  host ms  cpu ms',
      'tap            1/2 1 failed        1000 [900–1100]          3     600       500       300       1        0      50',
      'ocr       0/1 1 unavailable                      —          —       —         —         —       —        —       —',
    ]);
  });
  it('adds the stall columns when screenshots were taken, even with no stall', () => {
    const [head] = reportTable([{ id: 'screenshot', summary: tap, stalls: { ...none, screenshots: 3 } }], { thresholdMs: 900, screenshots: 3, stalls: 0, failed: 0, byLabel: { 'idb screenshot': { screenshots: 3, stalls: 0, failed: 0 } } });
    expect(head).toMatch(/shots\/stalls  stall-free wall med \(runs\)$/);
  });
  it('with one adds the two stall columns and the stall line', () => {
    expect(
      reportTable([{ id: 'screenshot', summary: tap, stalls: { screenshots: 10, stalls: 2, failed: 0, stallFreeRuns: 3, stallFreeWallMs: sp(950, 900, 1000) } }], {
        thresholdMs: 900,
        screenshots: 10,
        stalls: 2,
        failed: 0,
        okMs: sp(400, 380, 420),
        stallMs: sp(1400, 1390, 1410),
        byLabel: { 'simctl io screenshot': { screenshots: 10, stalls: 2, failed: 0, okMs: sp(400, 380, 420), stallMs: sp(1400, 1390, 1410) } },
      }),
    ).toEqual([
      'scenario         ok/runs  wall ms med [min–max]  dev calls  dev ms  dev busy  slept ms  sleeps  host ms  cpu ms  shots/stalls  stall-free wall med (runs)',
      'screenshot  1/2 1 failed        1000 [900–1100]          3     600       500       300       1        0      50          10/2                     950 (3)',
      'simctl io screenshot: 2 stalls (> 900 ms) in 10 calls, 20.0 % · ok calls 400 [380–420] ms · stalls 1400 [1390–1410] ms',
    ]);
  });
});

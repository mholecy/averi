import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trial } from '../../scripts/perf/a41.js';
import { main } from '../../scripts/perf/a41-report.js';

// scripts/perf/a41-report.ts over real files (A44 review): a cadence run that recorded some trials and some errors
// exits 0 (a41.ts#cadenceExit: only no trial is 3), and is caught here instead — its judgement unproven, so the report
// says it in `unproven`, and the batch's report block is INCONCLUSIVE on it (lab-a41-ios.test.ts).

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/d35-b11-settle.json', import.meta.url), 'utf8')) as { trials: Trial[] };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'a41-report-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

async function reportOver(trace: { trials: Trial[]; errors: string[] }): Promise<{ unproven: string[]; summary: string }> {
  const [idb, wda, out] = ['idb', 'wda', 'out'].map((d) => join(root, d));
  for (const d of [idb, wda]) mkdirSync(d);
  writeFileSync(join(wda, 'cadence-trace.json'), JSON.stringify({ meta: {}, windowMs: 3000, motions: [], ...trace }));
  expect(await main(['--idb', idb, '--wda', wda, '--out', out])).toBe(0);
  return {
    unproven: (JSON.parse(readFileSync(join(out, 'a41.json'), 'utf8')) as { unproven: string[] }).unproven,
    summary: readFileSync(join(out, 'summary.txt'), 'utf8'),
  };
}

describe('a41-report.ts: a cadence part read but not proven is `unproven`, never a pass', () => {
  it('some trials and errors (a run that exited 0): the judgement unproven, said in `unproven` and the summary', async () => {
    const trials = FIXTURE.trials.filter((t) => t.motion === 'M2').slice(0, 3);
    const r = await reportOver({ trials, errors: ['M1a#0: cell sheet-long-list: the app did not report ready within 10 s'] });
    expect(r.unproven).toHaveLength(1);
    expect(r.unproven[0]).toMatch(/^cadence \(a motion seen moving fewer than 15 times: /);
    expect(r.summary).toContain(`UNPROVEN: ${r.unproven[0]}`);
  });

  it('no trial (a run that exited 3): unproven, no trial recorded', async () => {
    const r = await reportOver({ trials: [], errors: ['M1a#0: x'] });
    expect(r.unproven).toEqual(['cadence (no trial recorded)']);
  });
});

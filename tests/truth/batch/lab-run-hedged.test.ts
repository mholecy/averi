import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { labRun } from '../../../scripts/truth/batch/lab-run.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { StartOptions } from '../../../scripts/truth/batch/proc.js';
import { STANDING_EXIT } from '../../../scripts/truth/batch/standing.js';
import { UNAIMABLE_LEGS } from '../../../scripts/truth/live-carousel.js';
import { CATALOG, FakeSeam, LAB_SERIAL, labWorld, rejudgeWith, type Answer, type LabWorld } from './lab-fakes.js';
import { hedgedLegs, liveSummary } from './standing-fakes.js';

// The hedged ceiling's MISMATCH end to end (A21's code review, carried into A22): a carousel run whose every unaimable
// leg ended hedged, judged by live-cases.ts#summarize itself (standing-fakes.ts#liveSummary), its lines and its failure
// reasons the fake rejudge's — through labRun and runBatch to the carousel block's FAIL and exit 1. Its own file:
// lab-run.test.ts stays off live-cases.ts (its case tables are a heavy import, paid by every mutant's run of the lab
// group: ADR 0038's A21 amendment), and this file is in no mutation group's tests. No device.

const HEAD = 'a'.repeat(40);
const ID = '20261111-101500-4242';

/** live.ts as the fake answers it: the run writes a record; its rejudge says what summarize says of hedged legs. */
class HedgedSeam extends FakeSeam {
  constructor(
    world: LabWorld,
    private readonly judged: ReturnType<typeof liveSummary>,
  ) {
    super(world, HEAD);
  }
  protected answer(cmd: string, args: readonly string[], options: StartOptions): Answer | undefined {
    if (cmd === process.execPath && args.some((a) => a.endsWith('live.ts'))) {
      const out = `${this.judged.lines.join('\n')}\n`;
      if (args.includes('--rejudge')) return rejudgeWith(args, { code: this.judged.exitCode, out, failures: this.judged.failures });
      writeFileSync(args[args.indexOf('--record') + 1], '{"results":[]}');
      return { code: this.judged.exitCode, out, err: '' };
    }
    return this.world.answer(cmd, args, { cwd: options.cwd });
  }
}

const table: LiveTable = async () =>
  ({
    selectCases: async (s) => (s.groups.includes('carousel') ? UNAIMABLE_LEGS.map((id) => ({ id })) : []),
    catalogOf: async () => ({ cells: [{ id: 'open' }] }),
  }) satisfies LiveCases;

let root: string;
let world: LabWorld;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-lab-run-hedged-')));
  mkdirSync(join(root, 'repo', 'fixtures', 'apps', 'android'), { recursive: true });
  writeFileSync(join(root, 'repo', 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir: root });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});

describe('lab-run.ts end to end: the carousel\'s hedged ceiling, a MISMATCH by summarize\'s own rule, fails the run', () => {
  it('every unaimable leg hedged: main\'s rejudge exit 1 naming the hedged ceiling; the carousel block FAILs naming it; exit 1', async () => {
    const judged = liveSummary('android', hedgedLegs('uiautomator'));
    expect(judged.exitCode).toBe(1);
    const [ceiling] = judged.failures;
    expect(ceiling).toMatch(/^MISMATCH \(hedged ceiling\): hedged 3 of 3 judged unaimable leg\(s\) — .* — the run fails$/);
    const seam = new HedgedSeam(world, judged);
    const out = join(root, 'out');
    const io = { fs: nodeFs, seam, terminal: () => {}, clock: () => new Date(2026, 10, 11, 10, 15, 0), pid: 4242, table, graceMs: 5 };
    const argv = ['--out', out, '--repo', join(root, 'repo'), '--serial', LAB_SERIAL, '--groups', 'carousel'];
    expect(await labRun({ argv, env: {}, io, wait: async () => {} })).toBe(STANDING_EXIT.failed);
    const summary = readFileSync(join(out, 'meta', `run-${ID}`, 'summary.txt'), 'utf8').split('\n');
    const header = judged.lines.find((l) => l.startsWith('# Live golden:'))!;
    expect(summary.filter((l) => / verdict: /.test(l))).toEqual([`carousel verdict: FAIL — android-carousel: main's rejudge exit 1 — ${ceiling} (${header})`]);
    expect(seam.exitCodes.at(-1)).toBe(STANDING_EXIT.failed);
  });
});

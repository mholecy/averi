import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { A41_BLOCK_IDS, A41_SECS, EXPECTED_OVERHEAD_SECS, EXPECTED_SECS, labA41Ios, siblingDir } from '../../../scripts/truth/batch/lab-a41-ios.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { StartOptions } from '../../../scripts/truth/batch/proc.js';
import { A41_FILES } from '../../../scripts/perf/a41-report.js';
import { CATALOG, FakeSeam, LAB_UDID, labWorld, type Answer, type LabWorld } from './lab-fakes.js';

// The A41 probe batch (scripts/truth/batch/lab-a41-ios.ts) under runBatch, over the shared fake lab (lab-fakes.ts) and a
// fake process seam that answers git and the batch's node children — golden.ts, baseline.ts, a41-probe.ts, a41-report.ts
// — by writing what each writes, with real files in a temp dir: the blocks' order (the lab, the idb probes, then the
// WDA probes inside one D43 window, then the report), every child after its health check, the children's argv, a child
// that fails, `--groups idb`. Every call is checked for b11-dry's VIOLATIONs (afterEach). No device.

const HEAD = 'a'.repeat(40);
const ID = '20261112-101500-4242';
const clock = () => new Date(2026, 10, 12, 10, 15, 0);

/** The child a node call is, by its script. */
const scriptOf = (args: readonly string[]): string | undefined => args.find((a) => a.endsWith('.ts'))?.split('/').at(-1);
const at = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

class A41Seam extends FakeSeam {
  /** A child's exit code, by name (`baseline-wda`, `hit-test`, …; the golden's `golden`). */
  codes: Record<string, number> = {};
  goldenOut = '{"side":"x","results":[]}';
  /** Children that exit 0 and write no file. */
  noFile = new Set<string>();
  constructor(world: LabWorld) {
    super(world, HEAD);
  }
  protected answer(cmd: string, args: readonly string[], options: StartOptions): Answer | undefined {
    const script = cmd === process.execPath ? scriptOf(args) : undefined;
    // Anything else — the lab build's own node child among them — is the fake lab's.
    if (script === undefined || !['golden.ts', 'baseline.ts', 'a41-probe.ts', 'a41-report.ts'].includes(script)) return this.world.answer(cmd, args, { cwd: options.cwd });
    if (script === 'golden.ts') return { code: this.codes.golden ?? 0, out: this.goldenOut, err: '' };
    if (script === 'a41-report.ts') {
      const [idb, wda, out] = [at(args, '--idb'), at(args, '--wda'), at(args, '--out')];
      const missing = [
        ...Object.values(A41_FILES.idb).filter((f) => !existsSync(join(idb, f))),
        ...Object.values(A41_FILES.wda).filter((f) => !existsSync(join(wda, f))),
      ];
      writeFileSync(join(out, 'a41.json'), JSON.stringify({ missing }));
      writeFileSync(join(out, 'summary.txt'), 'A41 probe\n');
      return { code: 0, out: 'A41 probe\n', err: '' };
    }
    const name = script === 'baseline.ts' ? `baseline-${at(args, '--tree-source')}` : at(args, '--mode');
    // Under WebDriverAgent the lab's runner starts: it listens on 8120, its exit flips the domains.
    if (['baseline-wda', 'wda-cold', 'auto-tap', 'cadence'].includes(name)) this.world.startWda();
    const code = this.codes[name] ?? 0;
    if (code === 0 && !this.noFile.has(name)) writeFileSync(at(args, '--out'), '{}');
    return { code, out: `${name} ran\n`, err: '' };
  }
}

const table: LiveTable = async () => ({ selectCases: async () => [], catalogOf: async () => ({ cells: [{ id: 'open' }] }) }) satisfies LiveCases;

let root: string;
let repo: string;
let out: string;
let seam: A41Seam;
let world: LabWorld;
const printed: string[] = [];
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-lab-a41-ios-')));
  repo = join(root, 'repo');
  out = join(root, 'out');
  mkdirSync(join(repo, 'fixtures', 'apps', 'ios'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir: root });
  seam = new A41Seam(world);
  printed.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});

const dirOf = (block: string) => join(out, block, `run-${ID}`);
const summary = () => readFileSync(join(dirOf('meta'), 'summary.txt'), 'utf8').split('\n').slice(0, -1);
const io = () => ({ fs: nodeFs, seam, terminal: (t: string) => void printed.push(t), clock, pid: 4242, table, graceMs: 5 });
const go = (argv: readonly string[] = [], env: Record<string, string> = {}): Promise<number> =>
  labA41Ios({ argv: ['--out', out, '--repo', repo, '--udid', LAB_UDID, ...argv], env, io: io(), wait: async () => {} });
const callAt = (text: string, from = 0) => seam.words.findIndex((w, i) => i >= from && w.includes(text));
/** The children in the order they ran: `golden`, `baseline-idb`, `hit-test`, … */
const children = () =>
  seam.words
    .filter((w) => w.startsWith('node ') && /(golden|baseline|a41-probe|a41-report)\.ts/.test(w))
    .map((w) => {
      const a = w.split(' ');
      const s = scriptOf(a);
      return s === 'baseline.ts' ? `baseline-${at(a, '--tree-source')}` : s === 'a41-probe.ts' ? at(a, '--mode') : s!.replace(/\.ts$/, '');
    });
const verdicts = () => summary().filter((l) => / verdict: /.test(l));

describe('lab-a41-ios.ts: a clean run — the lab, the idb probes, the WDA probes in one window, the report', () => {
  it('every child in order, each probe after its health check, the WDA ones inside the window; exit 0', async () => {
    expect(await go()).toBe(0);
    expect(children()).toEqual(['golden', 'baseline-idb', 'hit-test', 'baseline-wda', 'wda-cold', 'auto-tap', 'cadence', 'a41-report']);
    expect(verdicts()).toEqual([
      'a41 idb probe verdict: PASS — baseline-idb and hit-test measured',
      'a41 wda probe verdict: PASS — baseline-wda, wda-cold, auto-tap and cadence measured',
      `a41 report verdict: PASS — every part measured: ${join(dirOf('a41-report'), 'a41.json')}`,
    ]);
    expect(summary()).toContain('lab check: PASS — every lab need met: ios (each one\'s LAB line above)');
    expect(summary()).toContain('RESTORE: none — everything dirty was put back and verified');
    // Every idb probe before the window's backup; every WDA probe between the backup and the restore.
    const backup = callAt('defaults export');
    const restored = seam.words.findIndex((w, i) => i > backup && / defaults (write|import) /.test(w));
    expect(callAt('--mode hit-test')).toBeLessThan(backup);
    for (const c of ['--tree-source wda', '--mode wda-cold', '--mode auto-tap', '--mode cadence']) {
      expect(callAt(c)).toBeGreaterThan(backup);
      expect(callAt(c)).toBeLessThan(restored);
    }
    expect(callAt('a41-report.ts')).toBeGreaterThan(restored);
    // Each device child right after its own health check (the lab's WebDriverAgent ended, then describe-all and a swipe).
    for (const c of ['--tree-source idb', '--mode hit-test', '--tree-source wda', '--mode wda-cold', '--mode auto-tap', '--mode cadence']) {
      const i = callAt(c);
      expect(seam.words[i - 1], c).toBe(`idb ui swipe 200 600 200 400 --udid ${LAB_UDID}`);
    }
    // The lab's processes ended at the run's end.
    expect(seam.words.slice(-2)).toEqual([`pkill -f idb_companion --udid ${LAB_UDID}`, `idb disconnect ${LAB_UDID}`]);
  });

  it("the children's argv: the checkout's scripts, the lab udid, the repeats, each file in its block's folder", async () => {
    expect(await go()).toBe(0);
    const word = (c: string) => seam.words[callAt(c)];
    const tsx = (s: string) => `node --import tsx ${join(repo, s)}`;
    expect(word('golden.ts')).toBe(`${tsx('scripts/differential/golden.ts')} --corpus ${join(repo, 'tests/fixtures/truth')} --json`);
    expect(word('--tree-source idb')).toBe(
      `${tsx('scripts/perf/baseline.ts')} --platform ios --device ${LAB_UDID} --tree-source idb --repeat 8 --scenarios tree,tap,fill,scroll,ensure-cold,ensure-warm --out ${join(dirOf('a41-idb'), 'baseline-idb.json')}`,
    );
    expect(word('--mode hit-test')).toBe(
      `${tsx('scripts/perf/a41-probe.ts')} --mode hit-test --device ${LAB_UDID} --out ${join(dirOf('a41-idb'), 'hit-test.json')} --golden ${join(dirOf('a41-idb'), 'golden.json')}`,
    );
    expect(word('--mode wda-cold')).toBe(`${tsx('scripts/perf/a41-probe.ts')} --mode wda-cold --device ${LAB_UDID} --out ${join(dirOf('a41-wda'), 'wda-cold.json')} --repeat 5`);
    expect(word('--mode cadence')).toBe(`${tsx('scripts/perf/a41-probe.ts')} --mode cadence --device ${LAB_UDID} --out ${join(dirOf('a41-wda'), 'cadence-trace.json')} --repeat 20`);
    expect(word('a41-report.ts')).toBe(`${tsx('scripts/perf/a41-report.ts')} --idb ${dirOf('a41-idb')} --wda ${dirOf('a41-wda')} --out ${dirOf('a41-report')}`);
    // The golden's stdout is the file the hit test reads; each child logged beside its file.
    expect(readFileSync(join(dirOf('a41-idb'), 'golden.json'), 'utf8')).toBe(seam.goldenOut);
    expect(readFileSync(join(dirOf('a41-wda'), 'cadence.log'), 'utf8')).toBe('cadence ran\n');
  });

  it('the bounds: each child bounded; the expected total — children, lab block, health checks, window — under 30 minutes', async () => {
    expect(await go()).toBe(0);
    expect(Object.keys(A41_SECS).sort()).toEqual(Object.keys(EXPECTED_SECS).sort());
    for (const [k, v] of Object.entries(EXPECTED_SECS)) expect(A41_SECS[k as keyof typeof A41_SECS], k).toBeGreaterThanOrEqual(2 * v);
    // The overhead counts each health check this run made (one before each device child).
    expect(seam.words.filter((w) => w.startsWith('idb ui swipe 200 600 200 400')).length).toBeLessThanOrEqual(7 + 2);
    expect(Object.values(EXPECTED_SECS).reduce((a, b) => a + b, 0) + EXPECTED_OVERHEAD_SECS).toBeLessThan(25 * 60);
  });
});

describe('a probe that is not whole: INCONCLUSIVE naming it, the window still put back; exit 3', () => {
  it('baseline-wda exits 1: the WDA block INCONCLUSIVE, the others run, the report names the file missing', async () => {
    seam.codes['baseline-wda'] = 1;
    expect(await go()).toBe(3);
    const v = verdicts();
    expect(v[0]).toBe('a41 idb probe verdict: PASS — baseline-idb and hit-test measured');
    expect(v[1]).toMatch(/^a41 wda probe verdict: INCONCLUSIVE — baseline-wda: exit 1 — see .*baseline-wda\.log$/);
    expect(v[2]).toBe(`a41 report verdict: INCONCLUSIVE — baseline-wda.json missing: ${join(dirOf('a41-report'), 'a41.json')}`);
    expect(children()).toEqual(['golden', 'baseline-idb', 'hit-test', 'baseline-wda', 'wda-cold', 'auto-tap', 'cadence', 'a41-report']);
    expect(summary()).toContain('RESTORE: none — everything dirty was put back and verified');
  });

  it('a child exits 0 but writes no file: not whole either', async () => {
    seam.noFile.add('hit-test');
    expect(await go()).toBe(3);
    expect(verdicts()[0]).toMatch(/^a41 idb probe verdict: INCONCLUSIVE — hit-test: wrote no hit-test\.json — see .*hit-test\.log$/);
  });

  it("the window's backup fails: nothing run under WDA, the window's own INCONCLUSIVE alone", async () => {
    seam.world = world = labWorld({ dir: root, exportFails: 'com.apple.Preferences' });
    expect(await go()).toBe(3);
    expect(children()).toEqual(['golden', 'baseline-idb', 'hit-test', 'a41-report']);
    expect(verdicts().filter((l) => l.startsWith('a41 wda'))).toEqual([expect.stringMatching(/^a41 wda probe verdict: INCONCLUSIVE — the WDA window did not run: /)]);
  });

  it('a health check whose reset fails inside the window: the WDA block stops there, naming what did not run', async () => {
    let n = 0;
    // The wda-cold child leaves the lab sick (its describe-all fails from then on) and boot fails: the check before
    // auto-tap cannot reset it.
    const answer = seam.world.answer;
    seam.world.answer = (cmd, args, o) => {
      if (cmd === 'idb' && args[0] === 'ui' && args[1] === 'describe-all' && args[2] !== '--json' && seam.words.some((w) => w.includes('--mode wda-cold'))) return { code: 1, out: '', err: 'sick' };
      if (cmd === 'xcrun' && args[1] === 'boot' && seam.words.some((w) => w.includes('--mode wda-cold'))) return (n++, { code: 149, out: '', err: 'Unable to boot device' });
      return answer(cmd, args, o);
    };
    expect(await go()).toBe(3);
    expect(children()).toEqual(['golden', 'baseline-idb', 'hit-test', 'baseline-wda', 'wda-cold', 'a41-report']);
    // Two boots: the failed reset before auto-tap, and the window's own end check (ios-lab.ts#wdaWindow, as Gate C) — none
    // before cadence.
    expect(n).toBe(2);
    expect(verdicts().find((l) => l.startsWith('a41 wda probe verdict: INCONCLUSIVE'))).toMatch(/the iOS reset before a41 auto-tap failed: .* — no a41 auto-tap; not run: cadence$/);
  });

  it('the golden prints no JSON: no hit test, the idb block INCONCLUSIVE', async () => {
    seam.goldenOut = 'not json';
    seam.codes.golden = 1;
    expect(await go()).toBe(3);
    expect(children()).not.toContain('hit-test');
    expect(verdicts()[0]).toBe('a41 idb probe verdict: INCONCLUSIVE — golden: no JSON (exit 1) — no hit test');
  });
});

describe('the selection', () => {
  it('--groups idb: the idb probes and the report, no window; the report names the WDA files missing', async () => {
    expect(await go(['--groups', 'idb'])).toBe(3);
    expect(children()).toEqual(['golden', 'baseline-idb', 'hit-test', 'a41-report']);
    expect(seam.words.some((w) => w.includes('defaults export'))).toBe(false);
    expect(verdicts()[1]).toMatch(/^a41 report verdict: INCONCLUSIVE — baseline-wda\.json, wda-cold\.json, auto-tap\.json, cadence-trace\.json missing/);
  });

  it('no udid: refused before anything is done, exit 2', async () => {
    expect(await labA41Ios({ argv: ['--out', out, '--repo', repo], env: {}, io: io() })).toBe(2);
    expect(printed.join('')).toContain('lab-a41-ios runs on the lab simulator only');
    expect(seam.words).toEqual([]);
  });

  it('the blocks and the report\'s sibling folders', () => {
    expect(A41_BLOCK_IDS).toEqual(['lab', 'a41-idb', 'a41-wda', 'a41-report']);
    expect(siblingDir(join('o', 'a41-report', 'run-1'), 'a41-idb')).toBe(join('o', 'a41-idb', 'run-1'));
  });
});

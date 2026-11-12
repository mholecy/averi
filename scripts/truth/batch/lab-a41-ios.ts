import { basename, dirname, join } from 'node:path';
import { isMain } from '../../is-main.js';
import { A41_CHILD_NAMES, A41_CHILDREN, A41B_SCENARIOS, type A41ChildName, type ChildSpec } from '../../perf/a41.js';
import { iosCheck, iosLab, wdaWindow, type IosSim } from './ios-lab.js';
import { labBlock, labBuild } from './lab-build.js';
import type { Block, BlockCtx } from './runner.js';
import { knobs as readKnobs } from './select.js';
import { KNOBS, standingRun, standingSelection, windowStateHand, type Standing, type StandingExit, type StandingKnobs, type StandingOptions } from './standing.js';
import { exitText, failedCall } from './words.js';

/**
 * The A41b/A41c probe on the lab simulator (docs/plans/2026-10-30-performance-backlog.md, rows A41b and A41c): Gate C's
 * harness (lab-run-ios.ts's plumbing, runBatch through standing.ts) with probe blocks in place of the live groups —
 * the measurement A41b's table, its cadence question and A41c's hit-test question need, in one owner run:
 *
 * - `lab` (lab-build.ts#labBlock over the ios need): the guard (device-check's udid and any simulator not named
 *   `averi-lab …` refused before any call), the reset, the finportal key's first read, this checkout's lab app built
 *   and installed, its cells.json main's;
 * - `a41-idb`, every call idb's (no WebDriverAgent): the golden's `--json` (device-free, the A41c targets' source),
 *   then — each after the health check (ios-lab.ts#iosCheck) — scripts/perf/baseline.ts `--tree-source idb` (the
 *   A41b table's idb column: one session, BASELINE_REPEAT repeats) and scripts/perf/a41-probe.ts `--mode hit-test`;
 * - `a41-wda`, one D43 window (ios-lab.ts#wdaWindow: the health check, the three domains backed up, the work, the
 *   lab's WebDriverAgent ended, port 8120 proven free, the domains put back key by key, the end check, the compare),
 *   its work — each child after its own health check, which ends the lab's WebDriverAgent, so each starts from a
 *   stopped one — baseline.ts `--tree-source wda` (the WDA column; its build, if any, paid here), then a41-probe.ts
 *   `--mode wda-cold`, `--mode auto-tap` and `--mode cadence`;
 * - `a41-report`, device-free: scripts/perf/a41-report.ts over the two blocks' folders of this run — `a41.json` and
 *   `summary.txt` in its own folder (the files to commit, after scripts/release/clean-log.ts).
 *
 * Every child is bounded (A41_SECS, each its own process group: a child past its bound goes whole) and logged
 * (`<name>.log` beside its JSON). A block's verdict is PASS when every child exited 0 and wrote its file, else
 * INCONCLUSIVE naming which — a probe measures, its verdict says only whether the measurement is whole. The ios
 * need's end reads the finportal key again; the run's last step ends the lab's WebDriverAgent and idb_companion. A
 * signal puts an open window back and exits 130. What it leaves on the simulator is what Gate C leaves: the WDA
 * window's domains put back and compared; the lab app (and, if installed, the React Native lab app) launched on cells
 * through lab-device.ts, as live.ts launches them.
 *
 *     npm run truth:lab:ios:a41 -- --out <dir outside the checkout> --udid <lab simulator> [--groups idb|wda]
 *
 * The owner's, outside the agent's sandbox, on main as committed (the checkout precondition). The exit code is the
 * standing one (standing.ts#standingExitOf): 0 only when every wanted block PASSed; 3 unproven; 2 refused; 130
 * interrupted.
 */

export const A41_GROUPS = ['idb', 'wda'] as const;
export type A41Group = (typeof A41_GROUPS)[number];

export const A41_REPORT = 'a41-report';
/** A group's block. */
export const a41BlockId = (g: A41Group): string => `a41-${g}`;
export const A41_BLOCK_IDS: readonly string[] = ['lab', ...A41_GROUPS.map(a41BlockId), A41_REPORT];

/** `--groups idb` runs the idb block and the report (which then says the WDA files missing). */
export const A41_STANDING: Standing<A41Group> = {
  batch: 'lab-a41-ios',
  device: 'udid',
  groups: A41_GROUPS,
  hint: `${A41_GROUPS.join(', ')}, or both joined by a comma`,
  blockIds: A41_BLOCK_IDS,
  blocksOf: (g) => [a41BlockId(g), A41_REPORT],
};

/** A run's bounded steps: the device children (a41.ts#A41_CHILDREN), the golden's JSON before them, the report after. */
export type A41Step = A41ChildName | 'golden' | 'report';

/**
 * Each step's bound, in seconds — about three times its expected length on the lab (EXPECTED_SECS) or more:
 * baseline.ts's WDA run pays a WebDriverAgent build when none is cached.
 */
export const A41_SECS: Readonly<Record<A41Step, number>> = {
  golden: 300,
  'baseline-idb': 900,
  'hit-test': 600,
  'baseline-wda': 1800,
  'wda-cold': 900,
  'auto-tap': 900,
  cadence: 1500,
  report: 120,
};

/**
 * What each step is expected to take on the lab, in seconds: about 22 min of steps. EXPECTED_OVERHEAD_SECS adds the
 * rest of a run that goes well — the lab block (its reset, a cached build, the install: 26 s in Gate C on 2026-11-12),
 * the 8 health checks (one before each device child, the window's first and its end check; ~4 s each), the window's
 * backup and restore (~15 s) — about 23–24 min in all. A WebDriverAgent build not cached adds its minutes to
 * baseline-wda (the summary then says WDA was built).
 *
 * The worst case is the bounds: the steps' A41_SECS (7 020 s, 117 min), the lab block's build (B_BUILD, 2 400 s by
 * default) and installs, and any reset a health check makes (simctl shutdown, boot and bootstatus, each bounded at
 * 300 s: ~16 min a reset; a reset that fails ends its block) — well over two hours, reached only when every call hangs
 * to its bound.
 */
export const EXPECTED_SECS: Readonly<Record<A41Step, number>> = {
  golden: 20,
  'baseline-idb': 200,
  'hit-test': 100,
  'baseline-wda': 240,
  'wda-cold': 90,
  'auto-tap': 200,
  cadence: 480,
  report: 5,
};
export const EXPECTED_OVERHEAD_SECS = 26 + 8 * 4 + 15;

const tsx = (repo: string, script: string): string[] => ['--import', 'tsx', join(repo, script)];

/** The golden's `--json` over the committed corpus: device-free, its stdout the file. */
export const goldenArgs = (repo: string): string[] => [...tsx(repo, 'scripts/differential/golden.ts'), '--corpus', join(repo, 'tests/fixtures/truth'), '--json'];

/**
 * A device child's argv, from its row of a41.ts#A41_CHILDREN: baseline.ts on its block's tree source (the A41b
 * scenarios), or a41-probe.ts in its mode (the hit test reading the golden's JSON); `--repeat` the row's.
 */
export function childArgs(repo: string, udid: string, name: A41ChildName, out: string, golden?: string): string[] {
  const c: ChildSpec = A41_CHILDREN[name];
  const repeat = ['--repeat', String(c.repeat)];
  if (c.mode === undefined) {
    const scenarios = ['--scenarios', A41B_SCENARIOS.join(',')];
    return [...tsx(repo, 'scripts/perf/baseline.ts'), '--platform', 'ios', '--device', udid, '--tree-source', c.block, ...repeat, ...scenarios, '--out', out];
  }
  const extra = c.mode === 'hit-test' ? ['--golden', golden ?? ''] : [];
  return [...tsx(repo, 'scripts/perf/a41-probe.ts'), '--mode', c.mode, '--device', udid, '--out', out, ...repeat, ...extra];
}

/** a41-report.ts over the two blocks' folders. */
export const reportArgs = (repo: string, idb: string, wda: string, out: string): string[] => [...tsx(repo, 'scripts/perf/a41-report.ts'), '--idb', idb, '--wda', wda, '--out', out];

/** Another block's folder of this run: `<out>/<block>/run-<id>`, beside this block's. */
export const siblingDir = (dir: string, block: string): string => join(dirname(dirname(dir)), block, basename(dir));

/** A block's children, in their run order (a41.ts#A41_CHILDREN's). */
export const childrenOf = (block: ChildSpec['block']): A41ChildName[] => A41_CHILD_NAMES.filter((n) => A41_CHILDREN[n].block === block);

/**
 * A step run: bounded, from the checkout, logged in `<name>.log` — or, `stdout` (the golden's JSON), its stdout the file
 * and its stderr the log. Ok when it exited 0 (the golden: any exit, its stdout JSON) and wrote `file`; else why not. A
 * step line says it either way.
 */
async function child(ctx: BlockCtx<StandingKnobs>, name: A41Step, args: readonly string[], file: string, o: { stdout?: true } = {}): Promise<string | undefined> {
  const log = join(ctx.dir, `${name}.log`);
  ctx.print(`== ${ctx.id} ${name} (bound ${A41_SECS[name]} s; log: ${log}) ==`);
  const r = await ctx.bounded(process.execPath, args, { secs: A41_SECS[name], cwd: ctx.config.repo, ...(o.stdout === true ? {} : { log }) });
  let why: string | undefined;
  if (o.stdout === true) {
    ctx.fs.createExclusive(log, r.err);
    try {
      JSON.parse(r.out);
      ctx.fs.createExclusive(file, r.out);
    } catch {
      why = `${name}: no JSON (${r.timedOut ? `past its ${A41_SECS[name]} s bound` : `exit ${r.code}`}) — see ${log}`;
    }
  } else if (failedCall(r)) why = `${name}: ${exitText(r)} — see ${log}`;
  else if (ctx.fs.read(file) === undefined) why = `${name}: wrote no ${basename(file)} — see ${log}`;
  ctx.step(why === undefined ? 'OK' : 'FAIL', why === undefined ? `${ctx.id} ${name}${o.stdout === true ? ` (exit ${r.code})` : ''}` : `${ctx.id} ${why}`);
  return why;
}

/**
 * The health check before a child (iosCheck: the lab's WebDriverAgent ended, the alert, describe-all and a swipe; a
 * reset when sick); why not fit.
 */
async function fit(ctx: BlockCtx<StandingKnobs>, sim: IosSim, name: string, warnings: string[]): Promise<string | undefined> {
  const done = await iosCheck(ctx, sim, name);
  if (!done.ok) return `${done.why} — no ${name}`;
  if (done.warning !== undefined) warnings.push(done.warning);
  return undefined;
}

/**
 * A block's children in order, each after its health check: a check whose reset failed ends them there — no more
 * checks or resets on the shared simulator (lab-run-ios.ts's way) — what is left said not run. `skip` names a child
 * that cannot run (the hit test with no golden JSON). The whys, in order.
 */
async function children(
  ctx: BlockCtx<StandingKnobs>,
  sim: IosSim,
  names: readonly A41ChildName[],
  o: { warnings: string[]; golden?: string; skip?: (name: A41ChildName) => string | undefined },
): Promise<string[]> {
  const whys: string[] = [];
  for (const [i, name] of names.entries()) {
    const skipped = o.skip?.(name);
    if (skipped !== undefined) {
      whys.push(skipped);
      continue;
    }
    const unfit = await fit(ctx, sim, `a41 ${name}`, o.warnings);
    if (unfit !== undefined) {
      whys.push(unfit, `not run: ${names.slice(i).join(', ')}`);
      ctx.step('ERROR', `${ctx.id}: ${unfit}`);
      break;
    }
    const file = join(ctx.dir, A41_CHILDREN[name].file);
    const why = await child(ctx, name, childArgs(ctx.config.repo, sim.udid, name, file, o.golden), file);
    if (why !== undefined) whys.push(why);
  }
  return whys;
}

/** A probe block's verdict: PASS with every child whole, else INCONCLUSIVE naming what is not. */
function verdictOf(ctx: BlockCtx<StandingKnobs>, whys: readonly string[], whole: string): void {
  if (whys.length === 0) ctx.verdict('PASS', whole);
  else ctx.verdict('INCONCLUSIVE', whys.join('; '));
}

/** The run, start to end: its exit code (standing.ts#STANDING_EXIT), for the CLI entry to exit with. */
export async function labA41Ios(o: StandingOptions): Promise<StandingExit> {
  const { wanted, config } = standingSelection(o, A41_STANDING);
  const udid = config.ok ? config.config.udid : undefined;
  const pre = readKnobs(KNOBS, o.env);
  const build = labBuild({ ...(pre.ok ? { secs: pre.values.B_BUILD } : {}) });
  const ios = iosLab({ build: build.ios, wait: o.wait });

  const idbBlock: Block<StandingKnobs> = {
    id: a41BlockId('idb'),
    label: 'a41 idb probe verdict',
    needs: ['ios'],
    noRecords: true,
    async run(ctx) {
      const sim = await ios.open(ctx);
      if (!sim.ok) return ctx.verdict('INCONCLUSIVE', sim.why);
      const warnings: string[] = [];
      const golden = join(ctx.dir, 'golden.json');
      const g = await child(ctx, 'golden', goldenArgs(ctx.config.repo), golden, { stdout: true });
      const names = childrenOf('idb');
      const skip = (n: A41ChildName) => (n === 'hit-test' && g !== undefined ? `${g} — no hit-test` : undefined);
      const whys = await children(ctx, sim.value, names, { warnings, golden, skip });
      if (warnings.length > 0) ctx.step('WARN', `${ctx.id}: ${warnings.join('; ')}`);
      verdictOf(ctx, whys, `${names.join(' and ')} measured`);
    },
  };

  const wdaBlock: Block<StandingKnobs> = {
    id: a41BlockId('wda'),
    label: 'a41 wda probe verdict',
    needs: ['ios'],
    noRecords: true,
    stateful: { what: 'the WDA window not put back', hand: (file) => [windowStateHand(udid, file)] },
    async run(ctx) {
      const sim = await ios.open(ctx);
      if (!sim.ok) return ctx.verdict('INCONCLUSIVE', sim.why);
      const said: string[] = [];
      const names = childrenOf('wda');
      let whys: string[] = [];
      const w = await wdaWindow(ctx, sim.value, {
        secs: ctx.knobs.B_RESTORE,
        work: async () => void (whys = await children(ctx, sim.value, names, { warnings: said })),
      });
      const warnings = [...w.warnings, ...said];
      if (warnings.length > 0) ctx.step('WARN', `${ctx.id}: ${warnings.join('; ')}`);
      // The window's own INCONCLUSIVE (not run, not put back) stands; the probe's verdict is said only beside a window that ran.
      if (w.ran && w.putBack) verdictOf(ctx, whys, `${names.slice(0, -1).join(', ')} and ${names.at(-1)} measured`);
    },
  };

  const reportBlock: Block<StandingKnobs> = {
    id: A41_REPORT,
    label: 'a41 report verdict',
    needs: [],
    noRecords: true,
    async run(ctx) {
      const out = join(ctx.dir, 'a41.json');
      const why = await child(ctx, 'report', reportArgs(ctx.config.repo, siblingDir(ctx.dir, a41BlockId('idb')), siblingDir(ctx.dir, a41BlockId('wda')), ctx.dir), out);
      if (why !== undefined) return ctx.verdict('INCONCLUSIVE', why);
      let missing: string[] = [];
      try {
        missing = (JSON.parse(ctx.fs.read(out) ?? '{}') as { missing?: string[] }).missing ?? [];
      } catch {
        return ctx.verdict('INCONCLUSIVE', `a41.json unreadable (${out})`);
      }
      ctx.note(`A41 summary: ${join(ctx.dir, 'summary.txt')}`);
      if (missing.length === 0) ctx.verdict('PASS', `every part measured: ${out}`);
      else ctx.verdict('INCONCLUSIVE', `${missing.join(', ')} missing: ${out}`);
    },
  };

  return standingRun(o, A41_STANDING, {
    blocks: [labBlock(['ios'], { build }), idbBlock, wdaBlock, reportBlock],
    wanted,
    needs: { ...build.needs, ios: ios.need },
    lastly: [ios.lastly, build.lastly],
    config,
  });
}

// The exit at once, as runBatch leaves it to its caller (runner.ts#runBatch).
if (isMain(import.meta.url)) process.exit(await labA41Ios({ argv: process.argv.slice(2), env: process.env }));

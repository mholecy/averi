import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { IosTreeSourceSetting } from '../../src/adapters/ios-node.js';
import { exec } from '../../src/adapters/exec.js';
import { IdbHelper } from '../../src/adapters/idb-helper.js';
import { withUdid } from '../../src/adapters/idb.js';
import { iosAdapterFor } from '../../src/mcp/registry.js';
import { detectXcodeEnv } from '../../src/adapters/xcode-env.js';
import { errorMessage } from '../../src/util/error-message.js';
import { sleep } from '../../src/util/sleep.js';
import { isMain } from '../is-main.js';
import { IosLab, LAB_APP, LAB_WDA_DERIVED_DATA, LAB_WDA_PORT } from '../truth/lab-device.js';
import { claimsTap, firstLine, isError } from '../truth/replies.js';
import { labId, labSelector, type LabState } from '../truth/schema.js';
import {
  A41_CHILDREN,
  cadenceExit,
  clearsStateOn,
  COVER_NOT_UP,
  coverIdsOf,
  coverUp,
  encodeRects,
  hitTargetsOf,
  namedBy,
  parseDescribePoint,
  PROBE_MODES,
  tenths,
  traceIds,
  snapshotRootLabel,
  WAITED_GAP_MS,
  type AutoRun,
  type ColdRun,
  type ForegroundRun,
  type GoldenResultLike,
  type HitProbe,
  type HitResult,
  type HitTarget,
  type IdbElementLike,
  type Point,
  type ProbeMode,
  type Rect,
  type Step,
  type Trial,
} from './a41.js';
import { averiServer, commitOf } from './session.js';

/**
 * The A41b/A41c device probe (docs/plans/2026-10-30-performance-backlog.md): one mode per run, each writing its JSON to
 * `--out`, on the lab simulator only (lab-device.ts's guard: device-check's udid and any simulator not named
 * `averi-lab …` refused before any call). Run by scripts/truth/batch/lab-a41-ios.ts inside Gate C's harness — the idb
 * modes before any WebDriverAgent, the WDA modes inside a D43 window — never by hand on another simulator. The A41b
 * table's tree/tap/fill/scroll_until/ensure rows are scripts/perf/baseline.ts's own, run by the same batch; this file
 * measures what baseline.ts does not. Its records are a41.ts's types, its arithmetic a41.ts's, unit-tested;
 * a41-report.ts sums the files. `--repeat` defaults to a41.ts#A41_CHILDREN's.
 *
 *   node --import tsx scripts/perf/a41-probe.ts --mode hit-test --device <udid> --golden <golden --json> --out <file>
 *   node --import tsx scripts/perf/a41-probe.ts --mode wda-cold|auto-tap|cadence --device <udid> --out <file> [--repeat N]
 *
 * - `hit-test` (A41c, idb only): the targets from the golden's JSON (a41.ts#hitTargetsOf: the false-Tapped idb taps and
 *   their open controls); per cell the lab launched on it (the React Native lab for an `ios-rn` capture; not installed:
 *   its targets skipped, said), describe-all polled up to COVER_WAIT_MS until the cover is up (a41.ts#coverUp: the
 *   lab's `ready`, and every cover id the cell's recorded idb capture lists) — not up: its targets COVER_NOT_UP, never
 *   sound or unsound — then per target `--repeat` `idb ui describe-point X Y --json` at averi's stroke point through
 *   the CLI, and as many through a persistent idb helper (the process ADR 0032 runs; describe-point is on no allowlist
 *   of averi's, so the helper is driven directly — nothing in src/ changes). Each: its latency, what it named.
 * - `wda-cold` (A41b, under WDA): `--repeat` fresh MCP servers (treeSource wda, the lab's port and derived data) — each
 *   from a stopped WebDriverAgent with its build cached: the open cell launched outside the window, then ui_snapshot
 *   (the first read: WDA's start) and ui_snapshot again (warm), then the server closed (its shutdown stops the WDA it
 *   started and waits for the port). A WDA this server did not start is refused by WdaServer, never measured as cold.
 * - `auto-tap` (A41b, under `treeSource: auto`): `--repeat` fresh servers, each (a41.ts#AutoRun) — launch_app (the
 *   catalog), the first tap after it (`text:"open"`, WDA's bring-up inside it); untimed, the open cell waited for
 *   (`openSettled`), two warm taps on its A; launch_app again and the same first tap with WDA up; launch_app a third
 *   time, untimed the catalog waited for (`catalogSettled`), and the same catalog tap warm — the tap the first one is
 *   judged against. Then two more fresh servers each (A41b review r1): launch_app, no read until WAITED_GAP_MS after it
 *   replied, and the same first tap (the pre-warm given the time WDA's start takes); and launch_app (a `clearState`
 *   one on the last repeat, a41.ts#clearsStateOn: auto-tap is the WDA block's last child, so no later session runs on
 *   the wiped app — A44) with the first read at once — its root's label and WDA's active bundle, the app in
 *   front while WDA came up beside the launch's foreground wait. A reply that fell back to idb is marked; a41.ts leaves
 *   it out of WDA's numbers.
 * - `cadence` (A41b, ADR 0040, under WDA): MOTIONS × `--repeat` trials (20: D35's count) — the cell launched, one read
 *   before the trigger (WDA attached), the trigger (an idb swipe, as averi strokes), then WDA reads back to back for
 *   WINDOW_MS after it; each trial kept in the d35 fixture's shape (a41.ts#encodeRects). The settle is replayed offline
 *   (a41-report.ts → a41-settle.ts), never on the device. No trial recorded: the file still written (its errors), the
 *   exit a41.ts#PROBE_UNPROVEN_EXIT (A44).
 */

/** The trace's window after the trigger (d35's 3 s). */
export const WINDOW_MS = 3000;
/** How long the idb helper is given to come up before the helper path is said unavailable. */
const HELPER_READY_MS = 20_000;
/** describe-point's own budget (the CLI's describe-all is 15 s in averi). */
const HIT_TIMEOUT_MS = 15_000;
/** How long a hit-test cell's cover is polled for. */
export const COVER_WAIT_MS = 3000;
/** How long the open cell, or the catalog, is waited for before a warm tap (untimed). */
const SETTLE_WAIT_MS = 10_000;
/** The quiet after it is first listed: the transition's end. */
const SETTLE_QUIET_MS = 1000;

/**
 * The motions of the trace (D35's M1a, M1b, M2, as T5's fixture names them), each a fling inside its cell's scroller
 * at the lab's iPhone 17 points (tests/fixtures/truth/ios-iphone17-ios27/<cell>.state.json's scroll views):
 * sheet-long-list's list (0,62 402×812; rows listed with no identifier, kept by label), scroll-bounded's upper view
 * (0,110 402×220), carousel-in-list's carousel (24,138 354×85).
 */
export const MOTIONS: readonly { motion: string; cell: string; from: Point; to: Point; durationMs: number; labels?: RegExp }[] = [
  { motion: 'M1a', cell: 'sheet-long-list', from: { x: 201, y: 700 }, to: { x: 201, y: 250 }, durationMs: 100, labels: /^Row \d+$/ },
  { motion: 'M1b', cell: 'scroll-bounded', from: { x: 201, y: 310 }, to: { x: 201, y: 130 }, durationMs: 100 },
  { motion: 'M2', cell: 'carousel-in-list', from: { x: 340, y: 180 }, to: { x: 60, y: 180 }, durationMs: 150 },
];

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const timed = async <T>(f: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const t0 = performance.now();
  const value = await f();
  return { ms: performance.now() - t0, value };
};
const said = (e: unknown): string => firstLine(errorMessage(e));

// ------------------------------------------------------------------------------------------------- the MCP side

interface Session {
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

/**
 * A fresh averi server (session.ts#averiServer), as an agent's session starts: iOS adapters of `kind` on the lab's
 * WebDriverAgent port and derived data, the device selected. Its config: the lab app, `kind`.
 */
async function session(device: string, kind: IosTreeSourceSetting): Promise<Session> {
  const dir = join(tmpdir(), `averi-a41-${process.pid}-${kind}`);
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, 'averi.yaml');
  await writeFile(configPath, JSON.stringify({ app: { ios: { bundleId: LAB_APP.native.bundle, treeSource: kind } } }));
  const server = await averiServer({ treeSource: kind, driver: 'a41-probe' });
  const call = (tool: string, args: Record<string, unknown>) => server.call(tool, { platform: 'ios', configPath, ...args });
  const done = async () => {
    await server.close().catch((e: unknown) => console.error(`close: ${errorMessage(e)}`));
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };
  const selected = await call('select_device', { device });
  if (isError(selected)) {
    await done();
    throw new Error(`select_device ${device}: ${firstLine(selected)}`);
  }
  return { call, close: done };
}

const step = async (s: Session, tool: string, args: Record<string, unknown>, ok: (reply: string) => boolean): Promise<Step> => {
  const { ms, value } = await timed(() => s.call(tool, args));
  return { ms, ok: ok(value), reply: firstLine(value), ...(/read through idb/.test(value) && { fellBack: true as const }) };
};

async function wdaCold(lab: IosLab, device: string, repeat: number): Promise<ColdRun[]> {
  const runs: ColdRun[] = [];
  for (let r = 1; r <= repeat; r++) {
    const run: ColdRun = { repeat: r };
    runs.push(run);
    let s: Session | undefined;
    try {
      s = await session(device, 'wda');
      await lab.launch('open');
      run.cold = await step(s, 'ui_snapshot', {}, (x) => !isError(x));
      run.warm = await step(s, 'ui_snapshot', {}, (x) => !isError(x));
    } catch (e) {
      run.error = said(e);
    } finally {
      await s?.close();
    }
    console.error(`wda-cold ${r}/${repeat}: first read ${run.cold?.ms.toFixed(0) ?? '—'} ms, then ${run.warm?.ms.toFixed(0) ?? '—'} ms${run.error === undefined ? '' : ` — ${run.error}`}`);
  }
  return runs;
}

/**
 * Untimed: ui_snapshot (its nodes as JSON) until it matches `listed` (at most SETTLE_WAIT_MS), then SETTLE_QUIET_MS;
 * whether it was seen.
 */
async function settledOn(s: Session, listed: RegExp): Promise<boolean> {
  let seen = false;
  for (const end = performance.now() + SETTLE_WAIT_MS; !seen && performance.now() < end; ) {
    seen = listed.test(await s.call('ui_snapshot', {}));
    if (!seen) await sleep(250);
  }
  await sleep(SETTLE_QUIET_MS);
  return seen;
}

/** WebDriverAgent's active app's bundle (GET /wda/activeAppInfo on the lab's port); undefined when it cannot say. */
async function activeBundle(): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${LAB_WDA_PORT}/wda/activeAppInfo`, { signal: AbortSignal.timeout(5000) });
    const id = ((await res.json()) as { value?: { bundleId?: unknown } }).value?.bundleId;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The waited leg: a fresh `auto` server, launch_app, no read until WAITED_GAP_MS after it replied, the first tap. */
async function waitedTap(stop: () => Promise<unknown>, device: string, run: AutoRun, tap: Record<string, unknown>): Promise<void> {
  let s: Session | undefined;
  try {
    s = await session(device, 'auto');
    await stop();
    run.waitedLaunch = await step(s, 'launch_app', { appId: LAB_APP.native.bundle }, (x) => !isError(x));
    // From the reply, not the call: the launch pre-warms WDA only once `simctl launch` returned (ADR 0046).
    const replied = performance.now();
    await sleep(WAITED_GAP_MS);
    run.waitedGapMs = performance.now() - replied;
    run.firstWaited = await step(s, 'tap', tap, claimsTap);
  } catch (e) {
    run.waitedError = said(e);
  } finally {
    await s?.close();
  }
}

/** The foreground leg: a fresh `auto` server, launch_app (wiping when `clearState`), the first read at once. */
async function foreground(stop: () => Promise<unknown>, device: string, clearState: boolean): Promise<ForegroundRun> {
  const run: ForegroundRun = { clearState, expected: { label: LAB_APP.native.name, bundle: LAB_APP.native.bundle } };
  let s: Session | undefined;
  try {
    s = await session(device, 'auto');
    await stop();
    run.launch = await step(s, 'launch_app', { appId: LAB_APP.native.bundle, clearState }, (x) => !isError(x));
    const read = await s.call('ui_snapshot', {});
    const label = snapshotRootLabel(read);
    if (label !== undefined) run.label = label;
    if (/read through idb/.test(read)) run.fellBack = true;
    const bundle = await activeBundle();
    if (bundle !== undefined) run.bundle = bundle;
  } catch (e) {
    run.error = said(e);
  } finally {
    await s?.close();
  }
  return run;
}

async function autoTap(lab: IosLab, device: string, repeat: number): Promise<AutoRun[]> {
  const bundle = LAB_APP.native.bundle;
  const ok = (x: string) => !isError(x);
  const stop = () => lab.simctl('terminate', device, bundle).catch(() => undefined);
  const catalogTap = { selector: 'text:"open"' };
  const runs: AutoRun[] = [];
  for (let r = 1; r <= repeat; r++) {
    const run: AutoRun = { repeat: r, warm: [] };
    runs.push(run);
    let s: Session | undefined;
    try {
      s = await session(device, 'auto');
      await stop();
      run.launch = await step(s, 'launch_app', { appId: bundle }, ok);
      run.firstCold = await step(s, 'tap', catalogTap, claimsTap);
      run.openSettled = await settledOn(s, new RegExp(`"${labId('open', 'A').replace(/\./g, '\\.')}"`));
      for (let k = 0; k < 2; k++) run.warm.push(await step(s, 'tap', { selector: labSelector('open', 'A') }, claimsTap));
      await stop();
      run.relaunch = await step(s, 'launch_app', { appId: bundle }, ok);
      run.firstWdaUp = await step(s, 'tap', catalogTap, claimsTap);
      await stop();
      await s.call('launch_app', { appId: bundle });
      run.catalogSettled = await settledOn(s, /"label":\s*"open"/);
      run.warmCatalog = await step(s, 'tap', catalogTap, claimsTap);
    } catch (e) {
      run.error = said(e);
    } finally {
      await s?.close();
    }
    await waitedTap(stop, device, run, catalogTap);
    run.foreground = await foreground(stop, device, clearsStateOn(r, repeat));
    const t = (x: Step | undefined) => (x === undefined ? '—' : `${x.ms.toFixed(0)}${x.ok ? '' : ' (not ok)'}`);
    const f = run.foreground;
    console.error(
      `auto-tap ${r}/${repeat}: first ${t(run.firstCold)}, after relaunch ${t(run.firstWdaUp)}, warm ${t(run.warmCatalog)}, open.A ${run.warm.map(t).join('/')} ms; ` +
        `waited ${t(run.firstWaited)} ms (${run.waitedGapMs?.toFixed(0) ?? '—'} ms after launch_app replied); ` +
        `foreground${f.clearState ? ' (clearState)' : ''}: ${f.label ?? 'no label'} / ${f.bundle ?? 'no bundle'}` +
        [run.error, run.waitedError, f.error].filter((x) => x !== undefined).map((x) => ` — ${x}`).join(''),
    );
  }
  return runs;
}

// -------------------------------------------------------------------------------------------------- the trace

async function cadence(lab: IosLab, device: string, perMotion: number): Promise<{ trials: Trial[]; errors: string[] }> {
  const adapter = iosAdapterFor(device, 'wda', { port: LAB_WDA_PORT, derivedDataPath: LAB_WDA_DERIVED_DATA });
  const trials: Trial[] = [];
  const errors: string[] = [];
  try {
    for (const m of MOTIONS) {
      for (let i = 0; i < perMotion; i++) {
        try {
          await lab.launch(m.cell);
          await adapter.uiTree();
          const t0 = performance.now();
          await adapter.swipe(m.from, m.to, m.durationMs);
          const trigger: [number, number] = [0, tenths(performance.now() - t0)];
          const reads: [number, number][] = [];
          const perRead: Record<string, string>[] = [];
          while (performance.now() - t0 < WINDOW_MS) {
            const at = performance.now();
            const tree = await adapter.uiTree();
            reads.push([tenths(at - t0), tenths(performance.now() - t0)]);
            perRead.push(traceIds(tree, m.labels));
          }
          trials.push({ motion: m.motion, cell: m.cell, trial: i, trigger, appMoved: null, reads, rects: encodeRects(perRead) });
          console.error(`cadence ${m.motion}#${i}: ${reads.length} reads`);
        } catch (e) {
          errors.push(`${m.motion}#${i}: ${said(e)}`);
          console.error(`cadence ${m.motion}#${i}: ${errors.at(-1)}`);
        }
      }
    }
  } finally {
    await adapter.dispose?.().catch((e: unknown) => console.error(`dispose: ${errorMessage(e)}`));
  }
  return { trials, errors };
}

// ---------------------------------------------------------------------------------------------- the hit test

/**
 * The persistent helper up, or false past HELPER_READY_MS: it starts on the first call it is offered and answers
 * undefined until ready.
 */
async function helperUp(helper: IdbHelper, device: string, env: Record<string, string> | undefined): Promise<boolean> {
  const argv = withUdid(['ui', 'describe-all', '--json'], device).argv;
  for (const end = performance.now() + HELPER_READY_MS; performance.now() < end; await sleep(250)) {
    const p = helper.run(argv, { env, timeoutMs: HIT_TIMEOUT_MS });
    if (p === undefined) continue;
    const r = await p;
    return r.kind === 'answer' && r.code === 0;
  }
  return false;
}

async function probeOnce(run: () => Promise<string>, target: HitTarget, frame: Rect | undefined): Promise<HitProbe> {
  const t0 = performance.now();
  try {
    const out = await run();
    const ms = performance.now() - t0;
    const hit = parseDescribePoint(out);
    return { ms, hit, named: namedBy(hit, { id: target.id, ...(frame !== undefined && { frame }) }) };
  } catch (e) {
    return { ms: performance.now() - t0, error: said(e) };
  }
}

/** The cell's recorded idb capture (its cover ids' source); none readable: no cover id to ask for. */
async function captureOf(t: HitTarget): Promise<IdbElementLike[]> {
  try {
    const v = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'truth', t.run, `${t.cell}.idb.json`), 'utf8')) as unknown;
    return Array.isArray(v) ? (v as IdbElementLike[]) : [];
  } catch {
    return [];
  }
}

async function hitTest(device: string, golden: { results: GoldenResultLike[] }, repeat: number): Promise<{ helperReady: boolean; results: HitResult[] }> {
  const targets = hitTargetsOf(golden.results);
  const labs = { native: new IosLab(device, { app: 'native' }), 'react-native': new IosLab(device, { app: 'react-native' }) };
  const env = await detectXcodeEnv(exec);
  const helper = new IdbHelper();
  const results: HitResult[] = [];
  const skip = (mine: readonly HitTarget[], why: string) => mine.forEach((target) => results.push({ target, cli: [], helper: [], skipped: why }));
  const describeAll = async (): Promise<IdbElementLike[]> => {
    const v = JSON.parse((await exec('idb', withUdid(['ui', 'describe-all', '--json'], device).argv, { env, timeoutMs: HIT_TIMEOUT_MS })).stdout.toString('utf8')) as unknown;
    if (!Array.isArray(v)) throw new Error(`describe-all answered no list: ${JSON.stringify(v).slice(0, 120)}`);
    return v as IdbElementLike[];
  };
  let helperReady = false;
  try {
    helperReady = await helperUp(helper, device, env);
    const cells = [...new Map(targets.map((t) => [`${t.app}/${t.cell}`, t])).values()];
    for (const c of cells) {
      const mine = targets.filter((t) => t.app === c.app && t.cell === c.cell);
      let state: LabState;
      try {
        state = await labs[c.app].launch(c.cell);
      } catch (e) {
        skip(mine, `the ${c.app} lab not launched on ${c.cell}: ${said(e)}`);
        continue;
      }
      // The cover first: polled until up, at most COVER_WAIT_MS; a describe-all that fails skips this cell alone.
      const coverIds = coverIdsOf(await captureOf(c), c.cell);
      let all: IdbElementLike[] = [];
      let cover = { up: false, how: 'not read' };
      try {
        for (const end = performance.now() + COVER_WAIT_MS; ; await sleep(250)) {
          all = await describeAll();
          cover = coverUp({ ready: state.ready === true, listed: all, coverIds });
          if (cover.up || performance.now() >= end) break;
        }
      } catch (e) {
        skip(mine, `describe-all on ${c.cell} failed: ${said(e)}`);
        continue;
      }
      if (!cover.up) {
        skip(mine, `${COVER_NOT_UP}: ${cover.how}`);
        continue;
      }
      for (const target of mine) {
        const frame = all.filter((e) => e.AXUniqueId === target.id).at(-1)?.frame;
        const argv = withUdid(['ui', 'describe-point', String(Math.round(target.point.x)), String(Math.round(target.point.y)), '--json'], device).argv;
        const cli: HitProbe[] = [];
        const viaHelper: HitProbe[] = [];
        for (let k = 0; k < repeat; k++) {
          cli.push(await probeOnce(async () => (await exec('idb', argv, { env, timeoutMs: HIT_TIMEOUT_MS })).stdout.toString('utf8'), target, frame));
          if (!helperReady) continue;
          viaHelper.push(
            await probeOnce(async () => {
              const p = helper.run(argv, { env, timeoutMs: HIT_TIMEOUT_MS });
              if (p === undefined) throw new Error('the idb helper did not take the call');
              const r = await p;
              if (r.kind !== 'answer') throw new Error(`the idb helper: ${r.kind}`);
              if (r.code !== 0) throw new Error(`idb describe-point exit ${r.code}: ${firstLine(r.stderr)}`);
              return r.stdout.toString('utf8');
            }, target, frame),
          );
        }
        results.push({ target, ...(frame !== undefined && { frame }), cli, helper: viaHelper });
        console.error(`hit-test ${target.kind} ${target.id}: ${[...cli, ...viaHelper].map((p) => p.named ?? `error ${p.error}`).join(', ')}`);
      }
    }
  } finally {
    await helper.dispose();
    // Both lab apps terminated (lab-device.ts#close: only one the guard cleared, and launched or not, a no-op at worst).
    for (const l of Object.values(labs)) await l.close().catch((e: unknown) => console.error(`close: ${errorMessage(e)}`));
  }
  return { helperReady, results };
}

// ------------------------------------------------------------------------------------------- the command line

const USAGE = `usage: a41-probe.ts --mode ${PROBE_MODES.join('|')} --device <lab simulator udid> --out <file.json> [--repeat N] [--golden <golden --json file>]`;

/** A mode's child in a41.ts#A41_CHILDREN: its default `--repeat`. */
const childOf = (mode: ProbeMode) => Object.values(A41_CHILDREN).find((c) => 'mode' in c && c.mode === mode)!;

export async function main(argv: readonly string[]): Promise<number> {
  const options = { mode: { type: 'string' }, device: { type: 'string' }, out: { type: 'string' }, repeat: { type: 'string' }, golden: { type: 'string' } } as const;
  const { values } = parseArgs({ args: [...argv], options });
  const mode = values.mode as ProbeMode | undefined;
  if (mode === undefined || !PROBE_MODES.includes(mode) || values.device === undefined || values.out === undefined) throw new Error(USAGE);
  if (mode === 'hit-test' && values.golden === undefined) throw new Error(`--mode hit-test needs --golden\n${USAGE}`);
  const repeat = Number(values.repeat ?? childOf(mode).repeat);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat ${values.repeat}: a whole number ≥ 1`);
  const device = values.device;
  const lab = new IosLab(device, { app: 'native', wdaPort: LAB_WDA_PORT });
  const described = await lab.describe();
  const started = new Date().toISOString();
  const meta = () => ({ mode, described, repeat, started, finished: new Date().toISOString(), commit: commitOf() });
  const write = async (body: Record<string, unknown>) => {
    await mkdir(dirname(values.out!), { recursive: true });
    await writeFile(values.out!, `${JSON.stringify({ meta: meta(), ...body }, null, 1)}\n`);
  };
  console.error(`a41-probe ${mode}: ${described}`);
  let exit = 0;
  try {
    if (mode === 'hit-test') {
      const golden = JSON.parse(await readFile(values.golden!, 'utf8')) as { results: GoldenResultLike[] };
      await write(await hitTest(device, golden, repeat));
    } else if (mode === 'wda-cold') await write({ runs: await wdaCold(lab, device, repeat) });
    else if (mode === 'auto-tap') await write({ runs: await autoTap(lab, device, repeat) });
    else {
      const { trials, errors } = await cadence(lab, device, repeat);
      await write({ windowMs: WINDOW_MS, motions: MOTIONS.map((m) => ({ ...m, labels: m.labels?.source })), errors, trials });
      // No trial is no measurement (A44): the file kept with its errors, the run unproven, never 0.
      exit = cadenceExit(trials.length);
    }
  } finally {
    // The lab app terminated, as live.ts closes its lab (lab-device.ts#close).
    await lab.close().catch((e: unknown) => console.error(`close: ${errorMessage(e)}`));
  }
  return exit;
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));

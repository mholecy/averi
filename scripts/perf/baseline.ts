import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { createIosTreeSource } from '../../src/adapters/ios-tree-source.js';
import type { Platform } from '../../src/adapters/types.js';
import { AdapterRegistry, defaultDiscovery, defaultFactory, defaultIosBooted } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { AndroidLab, IosLab, LAB_APP, LAB_WDA_DERIVED_DATA } from '../truth/lab-device.js';
import { allPassed, callReply, claimsDone, claimsTap, claimsVisible, isError, OCR_FAILED_CLOSED } from '../truth/replies.js';
import { labId, labSelector, parseLabApp, type LabApp } from '../truth/schema.js';
import { installRecorder, Recorder } from './instrument.js';
import { breakdown, measure, summarize, type Breakdown, type Measured, type Status, type Summary, type Window } from './stats.js';

/**
 * The performance baseline (docs/plans/2026-10-30-performance-backlog.md, D0): averi driven the way an agent drives it —
 * its MCP tools, called through a real MCP client over the SDK's in-memory transport, on a server built by
 * src/mcp/tools.ts#createAveriServer over a real AdapterRegistry (real discovery, real adapters) — on the lab apps, and
 * per scenario what the call cost: wall clock, device calls (adb, simctl, idb, WebDriverAgent HTTP) and the time in
 * them, host processes (the OCR recognizer), averi's sleeps, and the process's CPU. It is what the D rows are chosen by,
 * and each D row's before and after is this run again.
 *
 *   node --import tsx scripts/perf/baseline.ts --platform android --device emulator-5554 [--app native|react-native]
 *     [--repeat 5] [--scenarios tap,fill] [--out <file.json>]
 *   node --import tsx scripts/perf/baseline.ts --platform ios --device <lab simulator udid> [--tree-source idb|wda]
 *     [--wda-port 8120] [--app native|react-native] [--repeat 5] [--scenarios …] [--out <file.json>]
 *
 * `adb` (and on iOS `idb`, `xcrun`) must be on PATH, as for averi itself. The device must be the lab's — the
 * `averi_lab` AVD, a simulator named `averi-lab …` — or the run refuses before touching it (scripts/truth/lab-device.ts
 * guards); the lab app must be installed. iOS's tree source is idb for the native app and wda for the React Native one
 * unless `--tree-source` says (SETUP.md: an RN app on iOS reads its tree through WDA); WDA runs on `--wda-port` (8120,
 * never device-check's 8100/8101) and builds into the lab's derived data, as scripts/truth/live.ts does.
 *
 * What is measured, and how (instrument.ts): the process boundary is wrapped for the length of each tool call —
 * `child_process.execFile` (every adb/simctl/idb), the global `fetch` (WDA) and `setTimeout` from src/util/sleep.ts —
 * so nothing in src/ is changed or injected and the numbers include everything the agent pays: the registry's device
 * probe on every call, config load, the tool's reads, settles and polls, and the MCP round trip (not the stdio pipe).
 * The harness's own setup — a fresh launch of the scenario's cell through lab-device.ts, waiting for the app to report
 * ready — runs between the windows and is not counted.
 *
 * Scenarios (`SCENARIOS` below; `--scenarios` narrows them): a tree read (ui_snapshot), one screenshot, a selector tap,
 * a colour assert and an OCR assert on a target, a fill of an empty field with a short and with a 20-character value,
 * scroll_until the last row of a 45-row picker (content ~3 screens tall), and ensure_state cold (the app stopped: detect fails, the
 * reach flow launches, taps the catalog row, waits) and warm (right after: detect alone). The React Native app runs its
 * own: a tree read and the two fills on rn-field. A scenario that cannot run on this host — the OCR assert where the
 * macOS Vision recognizer does not work — is recorded `unavailable` and the run goes on; one whose reply is an error or
 * does not claim what it was asked is `failed`, and its numbers stay out of the medians (they measure another path).
 *
 * Every scenario runs once per repeat, the repeats interleaved (scenario 1..k, then again), so a burst of load on the
 * host lands on every scenario rather than all on one; the summary is the median and the range over the ok runs. The
 * first repeat carries the one-time costs of a fresh server (the OCR recognizer's compile check, the Xcode environment
 * probe, WDA's start): the per-run rows in the JSON show them. The host's load average is recorded at every repeat —
 * the machine is shared, and a baseline taken under load says so.
 *
 * Output: the JSON (`--out`; default `$TMPDIR/averi-perf-<platform>-<app>-<time>.json`) holds the meta (commit, device,
 * load), and per scenario the summary, the breakdown (which commands and which sleep callers the time went to, per run)
 * and every run's window (each call and sleep with its times) and reply; a table goes to stdout.
 * Not a vitest test: it needs the device. Its arithmetic and wrappers are tested in tests/perf/.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    device: { type: 'string' },
    app: { type: 'string' },
    repeat: { type: 'string' },
    scenarios: { type: 'string' },
    out: { type: 'string' },
    'tree-source': { type: 'string' },
    'wda-port': { type: 'string' },
  },
});
const USAGE =
  'usage: baseline.ts --platform android|ios --device <serial|udid> [--app native|react-native] [--repeat N] [--scenarios a,b] [--out <file>] [--tree-source idb|wda] [--wda-port 8120]';
if (values.platform !== 'android' && values.platform !== 'ios') throw new Error(USAGE);
if (values.device === undefined) throw new Error(USAGE);
const platform: Platform = values.platform;
const device = values.device;
const app: LabApp = parseLabApp(values.app);
const repeat = Number(values.repeat ?? 5);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat ${values.repeat}: a whole number ≥ 1`);
const treeSource: IosTreeSourceKind = (values['tree-source'] as IosTreeSourceKind | undefined) ?? (app === 'react-native' ? 'wda' : 'idb');
if (treeSource !== 'idb' && treeSource !== 'wda') throw new Error(`--tree-source ${treeSource as string}: idb or wda`);
const wdaPort = Number(values['wda-port'] ?? 8120);
if (!Number.isInteger(wdaPort) || wdaPort < 1024 || wdaPort > 65535) throw new Error(`--wda-port ${values['wda-port']}: a whole port number, 1024–65535`);

// --- the scenarios ---

/** What the harness does before a scenario's window: a fresh process on a cell, the app stopped, or nothing. */
type Setup = { cell: string } | 'stopped' | 'as-left';

interface Scenario {
  id: string;
  says: string;
  app: LabApp;
  setup: Setup;
  tool: string;
  args: Record<string, unknown>;
  /** The reply claims what was asked (a tap, a visible stop, a passing assert); else the run is `failed`. */
  ok(reply: string): boolean;
  /** A reply that says this host cannot run it at all: `unavailable`, not `failed`. */
  unavailable?: RegExp;
}

const id = labSelector;
const answered = (reply: string) => !isError(reply);
/** 20 characters: Android types one `input text` per character, 100 ms apart (src/adapters/android.ts#TYPING_PACE_MS). */
const TWENTY = 'Jan Novak Bratislava';
const STATE = 'lab_open';
/**
 * scroll_until's budget: the default (15 s, src/interact/scroll.ts#DEFAULT_SCROLL_TIMEOUT_MS) does not cover three
 * screens on the Android emulator, whose tree read alone takes 2–2.5 s — a run that timed out would measure the timeout.
 * Raised so the scenario measures the whole scroll; its wall clock says how far past the default that is.
 */
const SCROLL_TIMEOUT_MS = 90_000;

const SCENARIOS: Scenario[] = [
  { id: 'tree', says: 'ui_snapshot of the open cell', app: 'native', setup: { cell: 'open' }, tool: 'ui_snapshot', args: {}, ok: answered },
  { id: 'screenshot', says: 'one screenshot of the open cell', app: 'native', setup: { cell: 'open' }, tool: 'screenshot', args: {}, ok: answered },
  { id: 'tap', says: 'tap by selector, open cell target A', app: 'native', setup: { cell: 'open' }, tool: 'tap', args: { selector: id('open', 'A') }, ok: claimsTap },
  {
    id: 'color',
    says: 'colour assert on open cell target A (#E53935)',
    app: 'native',
    setup: { cell: 'open' },
    tool: 'assert',
    args: { asserts: [{ element: { id: labId('open', 'A') }, color: { expected: '#E53935' } }] },
    ok: allPassed,
  },
  {
    id: 'ocr',
    says: 'OCR assert on text-sample target A ("Prihlásiť sa")',
    app: 'native',
    setup: { cell: 'text-sample' },
    tool: 'assert',
    args: { asserts: [{ element: { id: labId('text-sample', 'A') }, ocr: { text: 'Prihlásiť sa' } }] },
    ok: allPassed,
    unavailable: OCR_FAILED_CLOSED,
  },
  { id: 'fill', says: 'fill the empty name field of form-basic with "Jan"', app: 'native', setup: { cell: 'form-basic' }, tool: 'type_text', args: { selector: id('form-basic', 'name'), text: 'Jan' }, ok: claimsDone },
  { id: 'fill-20', says: `fill the empty name field of form-basic with 20 characters`, app: 'native', setup: { cell: 'form-basic' }, tool: 'type_text', args: { selector: id('form-basic', 'name'), text: TWENTY }, ok: claimsDone },
  {
    id: 'scroll',
    says: 'scroll_until the country picker\'s last row (GB; 45 rows of 52 dp, content ~3 screens tall)',
    app: 'native',
    setup: { cell: 'form-picker' },
    tool: 'scroll_until',
    args: { selector: id('form-picker', 'country.GB'), direction: 'down', timeoutMs: SCROLL_TIMEOUT_MS },
    ok: claimsVisible,
  },
  { id: 'ensure-cold', says: `ensure_state ${STATE}, the app stopped: detect, launch, tap the catalog row, wait`, app: 'native', setup: 'stopped', tool: 'ensure_state', args: { state: STATE }, ok: (reply) => !isError(reply) && /reached after open_from_catalog/.test(reply) },
  { id: 'ensure-warm', says: `ensure_state ${STATE} again, already there: detect alone`, app: 'native', setup: 'as-left', tool: 'ensure_state', args: { state: STATE }, ok: (reply) => !isError(reply) && /already active/.test(reply) },
  { id: 'rn-tree', says: 'ui_snapshot of rn-field', app: 'react-native', setup: { cell: 'rn-field' }, tool: 'ui_snapshot', args: {}, ok: answered },
  { id: 'rn-fill', says: 'fill the empty single-line RN field with "Jan"', app: 'react-native', setup: { cell: 'rn-field' }, tool: 'type_text', args: { selector: id('rn-field', 'N.field'), text: 'Jan' }, ok: claimsDone },
  { id: 'rn-fill-20', says: 'fill the empty single-line RN field with 20 characters', app: 'react-native', setup: { cell: 'rn-field' }, tool: 'type_text', args: { selector: id('rn-field', 'N.field'), text: TWENTY }, ok: claimsDone },
];

const only = values.scenarios?.split(',');
const scenarios = SCENARIOS.filter((s) => s.app === app && (only === undefined || only.includes(s.id)));
if (only !== undefined) for (const o of only) if (!SCENARIOS.some((s) => s.id === o && s.app === app)) throw new Error(`no ${app} scenario ${o}: ${SCENARIOS.filter((s) => s.app === app).map((s) => s.id).join(', ')}`);
if (scenarios.some((s) => s.setup === 'as-left') && !scenarios.some((s) => s.setup === 'stopped')) throw new Error('ensure-warm follows ensure-cold: ask for both');

// --- the device and the config ---

const lab = platform === 'android' ? new AndroidLab(device, { app }) : new IosLab(device, { app, wdaPort });
const described = await lab.describe();
console.error(`lab: ${described}`);

/**
 * The averi.yaml of the run: the lab app, and for ensure_state one state — the open cell's target A on the screen —
 * reached by launching the app (which, with no cell asked, shows the catalog) and tapping the catalog's `open` row.
 * JSON is YAML.
 */
const configDir = join(tmpdir(), `averi-perf-${process.pid}`);
await mkdir(configDir, { recursive: true });
const configPath = join(configDir, 'averi.yaml');
await writeFile(
  configPath,
  JSON.stringify({
    app: {
      android: { package: LAB_APP[app].package, activity: '.MainActivity' },
      ios: { bundleId: LAB_APP[app].bundle, treeSource },
    },
    states: { [STATE]: { detect: { element: { id: labId('open', 'A') } }, reach: ['open_from_catalog'] } },
    flows: {
      open_from_catalog: {
        steps: [{ launch: {} }, { tap: { text: 'open' } }, { wait: { element: { id: labId('open', 'A') }, timeout: '15s' } }],
      },
    },
  }),
);

async function setUp(setup: Setup): Promise<void> {
  if (setup === 'as-left') return;
  if (setup !== 'stopped') return void (await lab.launch(setup.cell));
  if (lab instanceof AndroidLab) await lab.adb('shell', 'am', 'force-stop', LAB_APP[app].package);
  else await lab.simctl('terminate', device, LAB_APP[app].bundle).catch(() => undefined);
}

const commit = (() => {
  const git = (...a: string[]) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
  try {
    return { head: git('rev-parse', 'HEAD'), subject: git('log', '-1', '--format=%s'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' };
  } catch {
    return undefined;
  }
})();

// --- the server, and the recorder in the process boundary ---

const recorder = new Recorder();
installRecorder(recorder);

const registry = new AdapterRegistry({
  // Android: the registry's own adapter. iOS: the registry's own wiring, with WDA (when asked) on the lab's port and
  // derived data rather than 8100, which another session's WebDriverAgent may hold.
  factory: (p, deviceId, opts) =>
    p === 'android'
      ? defaultFactory(p, deviceId, opts)
      : new IosAdapter({ udid: deviceId, treeSource: createIosTreeSource(opts?.treeSource ?? treeSource, deviceId, { port: wdaPort, derivedDataPath: LAB_WDA_DERIVED_DATA }) }),
  discovery: defaultDiscovery,
  // The server's own proof (D22): a bound simulator proven booted from its device.plist, as `new AdapterRegistry()` does.
  iosBooted: defaultIosBooted,
});
const server = createAveriServer({ registry, version: 'perf-baseline' });
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'perf-baseline', version: '0' });
await client.connect(clientSide);

/** A tool call's reply as the judges read it (scripts/truth/replies.ts#callReply), the platform and config added. */
const call = (tool: string, args: Record<string, unknown>) => callReply(client, tool, { platform, configPath, ...args });

// --- the runs ---

interface Run extends Measured {
  repeat: number;
  status: Status;
  reply: string;
  window: Window;
}

const runs = new Map<string, Run[]>(scenarios.map((s) => [s.id, []]));
const loads: { repeat: number; load: number[] }[] = [];
const started = new Date();

/**
 * One scenario once: its setup outside the window, then the call inside it. A setup that throws (the cell did not
 * report ready, adb refused) is a failed run with the error as its reply and nothing measured — the run goes on.
 */
async function runOnce(s: Scenario, r: number): Promise<Run> {
  try {
    await setUp(s.setup);
  } catch (e) {
    const reply = `SETUP FAILED ${(e as Error).message}`;
    return { repeat: r, status: 'failed', ...measure({ calls: [], sleeps: [] }, 0, 0), reply, window: { calls: [], sleeps: [] } };
  }
  const cpu = process.cpuUsage();
  recorder.begin();
  const t0 = performance.now();
  const reply = await call(s.tool, s.args);
  const wallMs = performance.now() - t0;
  const window = recorder.end();
  const used = process.cpuUsage(cpu);
  const status: Status = s.ok(reply) ? 'ok' : s.unavailable?.test(reply) === true ? 'unavailable' : 'failed';
  return { repeat: r, status, ...measure(window, wallMs, (used.user + used.system) / 1000), reply: reply.slice(0, 2_000), window };
}

// Whatever ends the runs, the server is closed — the registry's shutdown stops a WebDriverAgent it started on the
// lab's port — the temp config removed, and what was measured written.
try {
  const selected = await call('select_device', { device });
  if (isError(selected)) throw new Error(`select_device ${device}: ${selected}`);
  for (let r = 1; r <= repeat; r++) {
    loads.push({ repeat: r, load: loadavg() });
    console.error(`repeat ${r}/${repeat} (load ${loadavg().map((l) => l.toFixed(2)).join(' ')})`);
    for (const s of scenarios) {
      const run = await runOnce(s, r);
      runs.get(s.id)!.push(run);
      console.error(
        `  ${s.id.padEnd(12)} ${run.status.padEnd(11)} ${ms(run.wallMs).padStart(7)} ms, ${run.deviceCalls} device calls, slept ${ms(run.sleptMs)} ms` +
          (run.status === 'ok' ? '' : ` — ${firstLine(run.reply)}`),
      );
    }
  }
  const all = [...runs.values()].flat();
  if (all.some((r) => r.deviceCalls > 0) && all.every((r) => r.sleeps === 0)) {
    console.error('no sleep recorded in any scenario: has src/util/sleep.ts moved? instrument.ts tells its timers by the stack');
  }
} finally {
  await client.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  await registry.shutdown().catch((e: unknown) => console.error(`registry shutdown: ${(e as Error).message}`));
  await rm(configDir, { recursive: true, force: true }).catch(() => undefined);
  await report();
}

function ms(x: number): string {
  return Math.round(x).toString();
}
function firstLine(reply: string): string {
  return reply.split('\n')[0].slice(0, 160);
}

// --- the report ---

interface ScenarioReport {
  id: string;
  says: string;
  tool: string;
  args: Record<string, unknown>;
  summary: Summary;
  breakdown: Breakdown;
  runs: Run[];
}

/** The JSON, and the table on stdout: of the runs there are, however the run ended. */
async function report(): Promise<void> {
  const reports: ScenarioReport[] = scenarios.map((s) => {
    const rs = runs.get(s.id)!;
    return { id: s.id, says: s.says, tool: s.tool, args: s.args, summary: summarize(rs), breakdown: breakdown(rs.filter((r) => r.status === 'ok').map((r) => r.window)), runs: rs };
  });

  const out = values.out ?? join(tmpdir(), `averi-perf-${platform}-${app}-${started.toISOString().replace(/[:.]/g, '-')}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        meta: {
          platform,
          device,
          described,
          app,
          treeSource: platform === 'ios' ? treeSource : undefined,
          repeat,
          started: started.toISOString(),
          finished: new Date().toISOString(),
          commit,
          node: process.version,
          cpus: cpus().length,
          loads,
        },
        scenarios: reports,
      },
      null,
      1,
    ) + '\n',
  );

  const spread = (s: { median: number; min: number; max: number } | undefined) => (s === undefined ? '—' : `${ms(s.median)} [${ms(s.min)}–${ms(s.max)}]`);
  const med = (s: { median: number } | undefined) => (s === undefined ? '—' : ms(s.median));

  const head = ['scenario', 'ok/runs', 'wall ms med [min–max]', 'dev calls', 'dev ms', 'dev busy', 'slept ms', 'sleeps', 'host ms', 'cpu ms'];
  const rows = reports.map((r) => {
    const s = r.summary;
    const other = Object.entries(s.statuses).filter(([k]) => k !== 'ok').map(([k, n]) => ` ${n} ${k}`).join('');
    return [r.id, `${s.statuses.ok ?? 0}/${s.runs}${other}`, spread(s.wallMs), med(s.deviceCalls), med(s.deviceMs), med(s.deviceBusyMs), med(s.sleptMs), med(s.sleeps), med(s.hostMs), med(s.cpuMs)];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(`\n${described} · ${app}${platform === 'ios' ? ` · ${treeSource}` : ''} · ${repeat} repeats · ${commit?.head.slice(0, 8) ?? '?'}${commit?.dirty === true ? '+dirty' : ''}`);
  console.log(line(head));
  for (const row of rows) console.log(line(row));
  console.log('\nwhere the time goes (per ok run):');
  for (const r of reports) {
    const top = [
      ...r.breakdown.calls.slice(0, 4).map((c) => `${c.label} ×${+c.count.toFixed(1)} ${ms(c.ms)} ms`),
      ...r.breakdown.sleeps.slice(0, 3).map((s) => `sleep ${s.caller} ×${+s.count.toFixed(1)} ${ms(s.ms)} ms`),
    ];
    console.log(`  ${r.id}: ${top.join(' · ') || '—'}`);
  }
  console.log(`\n${out}`);
}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { listIosDevices } from '../../src/adapters/discovery.js';
import type { Platform } from '../differential/corpus.js';
import { loadSide } from '../differential/side.js';
import { AndroidLab, IosLab, LAB_AVD, LAB_WDA_DERIVED_DATA, pause } from './lab-device.js';
import { type Call, type Case, caseConfig, judged, rejudge, type Result, ROOT, type RunRecord, selectCases, summarize, THIS_CHECKOUT } from './live-cases.js';
import type { Source } from './live-forms.js';
import type { LiveVerdict } from './live-visibility.js';
import { callReply } from './replies.js';
import { labSelector, parseLabApp, type LabApp, type LabState } from './schema.js';

/**
 * The live golden (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 1b — phase 5's mode brought forward for the
 * forms): averi's verbs that CHANGE state — a fill with and without clear, typing into the focused field, a fill on the
 * secure field and on a prefilled one, a tap under the keyboard with and without a dismissal, a picker row reached by
 * scroll_until — run through averi's MCP tools against the REAL lab simulator, and the app's own model (the state
 * file, Forms.swift) is the oracle. A replayed tree cannot judge these: typing changes nothing in it.
 *
 *   node --import tsx scripts/truth/live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda]
 *     [--cases b1,p4] [--shots <dir>]
 *   node --import tsx scripts/truth/live.ts --serial <lab emulator> [--cases b1,p4] [--shots <dir>]
 *
 * Android (phase 2b, `--serial`): the same cases against the Compose app on the `averi_lab` AVD (Forms.kt; the guard
 * refuses any other device), one tree source (uiautomator), the server's adapter the registry's own (defaultFactory),
 * discovery listing that emulator alone — no adb call reaches another attached device. Its typing is one `input text`
 * per character (src/adapters/android.ts#typeText). A case may judge per platform: Android hides the keyboard with
 * `back` and taps (k1, k3), sets no `error` on a field (e1 asserts the message's text), and has no keyboardDismiss
 * (k2 is iOS only).
 *
 * The server is built as tests/mcp/tools.test.ts builds one (createAveriServer over the SDK's in-memory transport and
 * a real Client), over a REAL AdapterRegistry whose factory constructs the iOS adapter itself: averi gives WDA port
 * 8100 to the first simulator a process asks for, and 8100/8101 may belong to another session's WebDriverAgent — here
 * the WDA source takes `--wda-port` (default 8120, capture.ts's) and builds into the lab's own derived data
 * (lab-device.ts#LAB_WDA_DERIVED_DATA), never device-check's `averi-wda`. Discovery lists the lab simulator only, so no
 * tool call can bind another booted device. Each case launches its cell in a fresh process (simctl, as the capture does
 * — not averi's launch_app, which is not under test here), runs its calls, waits for the app to write, and reads the
 * model.
 *
 * Outcome per case:
 *  - ok: the model holds what the case asked for, and averi's reply does not contradict it;
 *  - LOUD: the model does not hold it, and averi said so (an error, or "NOT verified") — honest, not a pass;
 *  - MISMATCH: averi claimed what did not happen ("Filled", "Tapped" with the model unchanged), or failed what did;
 *  - SKIP: a keyboard case whose launch shows no soft keyboard — the simulator hides it once it has seen HID typing
 *    (idb ui text); IosLab.launch writes the simulator's keyboard preferences back before every launch, and the
 *    keyboard's cases run first besides.
 * Not a vitest test: it needs the simulator.
 *
 * Groups (`--groups`, `forms` by default — the earlier summaries' reproduce lines): `forms` the cases above; `visibility` (phase 5) the coloured-target cells'
 * taps and scroll_until — every case built from the cell's static truth (tests/fixtures/truth) by live-visibility.ts,
 * the app's tap log, scroll offsets and strokes the oracle (`--cells` narrows them); `dismissal` (phase 5, iOS) a tap
 * under the keyboard on the false-covers toolbar cells, under the cell's own `keyboardDismiss` (CellConfig): the
 * control focused, nothing typed. A case not ok prints its whole replies, and every scroll case (and any case not ok)
 * the app's state beneath it. A case not ok that an existing note explains is KNOWN (live-known.ts) and marked so; the
 * exit code is 1 on a MISMATCH not known, and — in a run of this checkout, not a `--side` one — on a known case not
 * `intermittent` that came out ok (fixed: strike it off, as the static ratchet asks). `--record <file>` writes every
 * read (the launch state, the state between the calls, after them) as JSON; `--rejudge <file>` judges such a record
 * again with this checkout's judges, no device (live-cases.ts#rejudge, which tests/truth/live-rejudge.test.ts calls in
 * process). The cases, their judging and the summary live in live-cases.ts; this file is the CLI and the device run.
 *
 * `--app react-native` runs the cases of the React Native lab app's cells (fixtures/apps/rn, its own bundle and package:
 * lab-device.ts#LAB_APP; the visibility cases from its own truth runs, the manifests whose `app` is AveriLabRN) — the
 * native app's (`native`, the default) otherwise: one app per run, its cases only (schema.ts#appOf).
 *
 * `--side <checkout>` runs another averi's src (a calibration checkout, calibrate.ts's `differential-cal-<sha>`): its
 * tools, registry, iOS adapter and tree source, loaded as scripts/differential/side.ts loads a side — the live
 * calibration of a note (calibration.json `live`) runs its cases at the note's before and after commits.
 *
 * `ensure` (backlog D30, not in the default groups): ensure_state on the held cells — D2's held "no" (ADR 0033) on a
 * device: h1 and h2 (through a spinner) with no wipe ahead, the hold ending the second look ~2 s after Welcome; h3 with
 * a destructive rung ahead, the full window (live-ensure.ts). The app's phase events and Continue's tap are the oracle.
 */

const { values } = parseArgs({
  options: {
    udid: { type: 'string' },
    serial: { type: 'string' },
    'wda-port': { type: 'string' },
    sources: { type: 'string' },
    cases: { type: 'string' },
    shots: { type: 'string' },
    groups: { type: 'string' },
    cells: { type: 'string' },
    side: { type: 'string' },
    record: { type: 'string' },
    rejudge: { type: 'string' },
    app: { type: 'string' },
  },
});
// `--rejudge`'s record (live-cases.ts#RunRecord): read here, judged by live-cases.ts#rejudge.
const rejudging = values.rejudge === undefined ? undefined : (JSON.parse(await readFile(values.rejudge, 'utf8')) as RunRecord);
if (rejudging === undefined && (values.udid === undefined) === (values.serial === undefined)) {
  throw new Error('usage: live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda] [--groups forms,visibility,dismissal,ensure] [--cells …] [--cases …] [--side <checkout>] [--record <file>] | --serial <lab emulator> […] | --rejudge <record>');
}
const platform: Platform = rejudging?.platform ?? (values.serial !== undefined ? 'android' : 'ios');
const app: LabApp = rejudging?.app ?? parseLabApp(values.app);
const device = (values.udid ?? values.serial ?? 'rejudged')!;
const port = Number(values['wda-port'] ?? 8120);
/** The tree sources the cases run under: iOS's (idb, wda), Android's one. */
const sources: Source[] = rejudging !== undefined ? [...new Set(rejudging.results.map((r) => r.source))] : platform === 'android' ? ['uiautomator'] : ((values.sources ?? 'idb,wda').split(',') as IosTreeSourceKind[]);
const only = values.cases?.split(',');
// `forms` by default: the reproduce lines of the earlier summaries (docs/truth/live-android-2026-10-16.md) stay true.
const groups = (values.groups ?? 'forms').split(',');
const onlyCells = values.cells?.split(',');
/** Where a case that is not ok leaves its screenshot (`--shots <dir>`), for the evidence. */
const shots = values.shots;
if (shots !== undefined) await mkdir(shots, { recursive: true });
// The WDA port too: 8100/8101 are refused (lab-device.ts#DEVICE_CHECK_WDA_PORTS). No device at all when rejudging.
const ios = rejudging === undefined && platform === 'ios' ? new IosLab(device, { wdaPort: port, app }) : undefined;
const android = rejudging === undefined && platform === 'android' ? new AndroidLab(device, { app }) : undefined;
// The lab simulator or the lab AVD, or nothing (lab-device.ts#IosLab.guard, #AndroidLab.guard): refused before any
// tool binds it.
if (rejudging === undefined) console.error(`lab: ${ios !== undefined ? await ios.guard() : (await android!.guard(), `${device}, AVD ${LAB_AVD}`)}`);

// --- the server: a real registry, the lab simulator only, WDA on a port of its own ---

/**
 * The averi under test: this checkout's src, or `--side`'s (a checkout of another commit) — its tools, registry, iOS
 * adapter and tree source, loaded by scripts/differential/side.ts#loadSide (the export guard, the old registry's shim).
 */
const averi = rejudging === undefined ? await loadSide(values.side ?? ROOT) : undefined;
if (averi !== undefined) console.error(`averi: ${averi.root}`);
function iosAdapter(udid: string, source: IosTreeSourceKind): DeviceAdapter {
  const create = averi!.createIosTreeSource;
  if (create === undefined) throw new Error(`side ${averi!.root}: no src/adapters/ios-tree-source.ts#createIosTreeSource — the live golden cannot build its tree source`);
  const side = averi!;
  return new side.IosAdapter({ udid, treeSource: create(source, udid, { port, derivedDataPath: LAB_WDA_DERIVED_DATA }) as ConstructorParameters<typeof side.IosAdapter>[0]['treeSource'] });
}

async function connect(): Promise<{ client: Client; close(): Promise<void> }> {
  const registry = averi!.registry({
    factory: (p, deviceId, opts) => (p === 'android' ? averi!.defaultFactory(p, deviceId, opts) : iosAdapter(deviceId, opts?.treeSource ?? 'idb')),
    // The lab device alone. Android: listed without asking adb (its listing runs getprop on every attached device).
    discovery: async (p) =>
      p !== platform ? []
      : p === 'ios' ? (await listIosDevices()).filter((d) => d.id === device)
      : [{ id: device, platform: 'android', name: LAB_AVD, osVersion: 'lab', state: 'booted' }],
  });
  const server = averi!.createAveriServer({ registry, version: 'live-golden' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'live-golden', version: '0' });
  await client.connect(clientSide);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
      await registry.shutdown();
    },
  };
}

const configDir = join(tmpdir(), `averi-live-${process.pid}`);
await mkdir(configDir, { recursive: true });
async function configFor(source: Source, c: Case): Promise<string> {
  const { dismiss, flows, states } = c;
  const path = join(configDir, `averi-${source}${dismiss === undefined ? '' : '-dismiss'}${flows === undefined && states === undefined ? '' : `-${c.id}`}.yaml`);
  // JSON is YAML (live-cases.ts#caseConfig).
  await writeFile(path, JSON.stringify(caseConfig(source, c, app)));
  return path;
}

function callTool(client: Client, call: Call, configPath: string): Promise<string> {
  return callReply(client, call.tool, { platform, ...call.args, configPath });
}

if (rejudging !== undefined) {
  // No device: each recorded case judged again by this checkout's judges (live-cases.ts#rejudge, in process for the tests).
  const { lines, exitCode } = await rejudge(rejudging, values.rejudge!, { groups, only, onlyCells, app });
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
} else {
  const results: Result[] = [];
  const record: RunRecord = { platform, ...(app !== 'native' && { app }), side: values.side ?? THIS_CHECKOUT, results: [] };
  const selected = await selectCases({ platform, app, groups, only, onlyCells });
  const lab = (ios ?? android)!;
  if (platform === 'ios') console.error(`WDA: port ${port}, derived data ${LAB_WDA_DERIVED_DATA}`);
  /** The screen now, for the evidence of a case that is not ok. */
  const shoot = async (file: string) => writeFile(file, await lab.screenshot());
  const { client, close } = await connect();
  try {
    // Cases outer, sources inner: the keyboard's cases run on both sources before anything types.
    for (const c of selected) {
      for (const source of sources) {
        if (c.sources !== undefined && !c.sources.includes(source)) continue;
        // An ensure case's timing starts at the launch (live-ensure.ts): its tree source is bound first — WDA started,
        // idb's companion up — by one read under the case's own config, its reply discarded, so the entry probe reads
        // the bare screen rather than a Welcome the binding outran.
        if (c.group === 'ensure') await callTool(client, { tool: 'ui_snapshot', args: { filter: labSelector(c.cell, 'home') } }, await configFor(source, c));
        const launched = await lab.launch(c.cell);
        if (c.keyboard && launched.keyboard?.visible !== true) {
          const verdict: LiveVerdict = { outcome: 'SKIP', why: platform === 'ios' ? 'no soft keyboard at launch (the simulator saw HID typing; see IosLab.launch)' : 'no IME at launch' };
          results.push({ source, c, verdict, replies: [] });
          record.results.push({ source, id: c.id, skip: verdict.why, replies: [], launched, after: [], state: undefined });
          console.error(`${source} ${c.id} SKIP: ${verdict.why}`);
          continue;
        }
        const config = await configFor(source, c);
        const replies: string[] = [];
        const after: (LabState | undefined)[] = [];
        for (const [i, call] of c.calls.entries()) {
          replies.push(await callTool(client, call, config));
          // A visibility case reads the app between its calls: its stop is judged as scroll_until left it.
          if (c.group === 'visibility' && i < c.calls.length - 1) after.push(await lab.state());
        }
        await pause(800);
        const state = (await lab.state())!;
        let late: LabState | undefined;
        if (c.group !== 'visibility' && c.judge(state, replies, source, launched, after).outcome !== 'ok') {
          await pause(3_000);
          late = await lab.state();
        }
        const verdict = judged(c, source, replies, launched, after, state, late);
        if (shots !== undefined && verdict.outcome !== 'ok') await shoot(join(shots, `${source}-${c.id}-${Date.now()}.png`));
        results.push({ source, c, verdict, replies });
        record.results.push({ source, id: c.id, replies, launched, after, state, ...(late !== undefined && { late }) });
        console.error(`${source} ${c.id} ${verdict.outcome}: ${verdict.why}`);
      }
    }
  } finally {
    await close();
    await lab.close();
    if (values.record !== undefined) await writeFile(values.record, JSON.stringify(record) + '\n');
  }
  // The summary: every case, a known one marked with its note (live-known.ts); exit 1 on an unknown MISMATCH, and on a
  // known case not intermittent that came out ok in a run of this checkout (fixed: strike it off).
  const { lines, exitCode } = summarize({ platform, sources, results, side: values.side ?? THIS_CHECKOUT });
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
}

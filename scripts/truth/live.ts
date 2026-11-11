import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { listIosDevices } from '../../src/adapters/discovery.js';
import { errorMessage } from '../../src/util/error-message.js';
import type { Platform } from '../differential/corpus.js';
import { loadSide } from '../differential/side.js';
import { readPremiseInto } from './chooser-premise.js';
import { deviceLabelling, type DeviceReadMode } from './device-state.js';
import { AndroidLab, IosLab, LAB_AVD, LAB_WDA_DERIVED_DATA } from './lab-device.js';
import { hookSwipes, SwipeHook } from './live-carousel.js';
import { finishRun } from './live-finish.js';
import {
  type Call,
  type Case,
  caseConfig,
  rejudge,
  type Result,
  ROOT,
  type RunRecord,
  selectCases,
  sideLabel,
  summarizeRecord,
  THIS_CHECKOUT,
} from './live-cases.js';
import type { Source } from './live-forms.js';
import { callReply } from './replies.js';
import { failuresJson } from './rejudge-failures.js';
import { type CaseRig, runCase } from './run-case.js';
import { parseLabApp, type LabApp } from './schema.js';

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
 *    a LOUD of class `no-state` is the lab's, not averi's: the app wrote no state after the calls, no judge asked, and
 *    the run fails (T10);
 *  - MISMATCH: averi claimed what did not happen ("Filled", "Tapped" with the model unchanged), or failed what did;
 *  - SKIP: a keyboard case whose launch shows no soft keyboard — the simulator hides it once it has seen HID typing
 *    (idb ui text); IosLab.launch writes the simulator's keyboard preferences back before every launch, and the
 *    keyboard's cases run first besides.
 * Not a vitest test: it needs the simulator.
 *
 * Groups (`--groups`, `forms` by default — the earlier summaries' reproduce lines): `forms` the cases above;
 * `visibility` (phase 5) the coloured-target cells' taps and scroll_until — every case built from the cell's static
 * truth (tests/fixtures/truth) by live-visibility.ts, the app's tap log, scroll offsets and strokes the oracle
 * (`--cells` narrows them); `dismissal` (phase 5, iOS) a tap under the keyboard on the false-covers toolbar cells,
 * under the cell's own `keyboardDismiss` (CellConfig): the control focused, nothing typed. A case not ok prints its
 * whole replies, and every scroll case (and any case not ok) the app's state beneath it. A case not ok that an existing
 * note explains is KNOWN (live-known.ts) and marked so; the exit code is 1 on a MISMATCH not known, on a case whose app
 * wrote no state after its calls (T10: LOUD, `no-state`; any run, `--side` too), and — in a run of this checkout, not a
 * `--side` one — on a known case not `intermittent` that came out ok (fixed: strike it off, as the static ratchet
 * asks). The visibility group's hedged stops are counted under the cases, no exit code (T15: ADR 0013's T15
 * paragraph). `--record <file>` writes every read (the launch state, the state between the calls, after them) as JSON;
 * `--rejudge <file>` judges such a record again with this checkout's judges, no device (live-cases.ts#rejudge, which
 * tests/truth/live-rejudge.test.ts calls in process); with `--failures <file>` it writes the summary's failure reasons
 * there as JSON (rejudge-failures.ts#failuresJson: what the standing lab batch names, A21). The cases, their judging
 * and the summary live in live-cases.ts,
 * one case's device cycle in run-case.ts, the finish (the record written before anything closes, D82) in
 * live-finish.ts; this file is the CLI.
 *
 * `--app react-native` runs the cases of the React Native lab app's cells (fixtures/apps/rn, its own bundle and package:
 * lab-device.ts#LAB_APP; the visibility cases from its own truth runs, the manifests whose `app` is AveriLabRN) — the
 * native app's (`native`, the default) otherwise: one app per run, its cases only (schema.ts#appOf).
 *
 * `--side <checkout>` runs another averi's src (a calibration checkout, calibrate.ts's `differential-cal-<sha>`): its
 * tools, registry, iOS adapter and tree source, loaded as scripts/differential/side.ts loads a side — the live
 * calibration of a note (calibration.json `live`) runs its cases at the note's before and after commits. The record
 * names it by a portable label (live-cases.ts#sideLabel), never the host's path.
 *
 * `ensure` (backlog D30, not in the default groups): ensure_state on the held cells — D2's held "no" (ADR 0033) on a
 * device: h1 and h2 (through a spinner phase) with no wipe ahead, the hold ending the second look heldS after Welcome;
 * h3 with a destructive rung ahead, the full window — each after an entry probe the reply says was bare
 * (live-ensure.ts). The app's phase events and Continue's tap are the oracle; a SKIP among them exits 1.
 *
 * `carousel` (T7a, Android, not in the default groups): the probes the device batches copied from batch to batch, as
 * cases (live-carousel.ts) — lv-d62's drop and control, D68 from a fresh launch, D59b's strokes in the band, D52's E2,
 * D37's settled read on the snapping pagers. A case may drag the carousel raw first (Case.preDrag, AndroidLab.swipe),
 * and drop its Nth stroke (CaseReads.swipes): the Android adapter the registry builds has its `swipe` routed through one
 * SwipeHook, armed around each case's calls, which logs every stroke averi draws into the record (`swipes`). A run on
 * Android with a carousel case among the cases selected (T16, ADR 0044's T16 amendment) reads the device's state
 * (device-state.ts#readDevice: T11's raw strokes, no averi, four rounds, and the lab app's frames) before the first case
 * and after the last, into the record (`deviceLabel`) and the summary's `Device:` line — short or fast by the T11/T19
 * rule, DISAGREE when the two differ, a framework restart between them said; a read that fails leaves `Device:
 * unlabelled — <why>`, the exit code untouched. `--device-read none` skips both reads (about 55 s each) and records the
 * run unlabelled (refused with `--rejudge`). A run with no carousel case selected, and iOS, reads nothing of it
 * (device-state.ts#deviceLabelling).
 *
 * `chooser` (T7b, Android, not in the default groups): launch_app and open_deep_link around Android's "Open with"
 * chooser (live-chooser.ts) — lc1 the `-p` start that raises it, named; lc2 a one-handler link, no note; lc3 `.Twin`
 * named, no chooser; lc4' monkey from the launcher and lc4'' monkey over a link's chooser (D73's net: on demand, or in
 * the standing lab batch, `npm run truth:lab`, scripts/truth/batch/lab-run.ts, T20b — a release gate, docs/release.md,
 * T24). The oracle is the device's focus and activity stack (AndroidLab.focus, the record's `focus`), read
 * before, between and after the calls; a chooser left in front is dropped with one BACK. A SKIP fails the run. Before
 * the cases (T20a, ADR 0041's T20a amendment), the group's premise is read once, read only
 * (chooser-premise.ts#readPremiseInto): no lab default (`mAlways=true`, `dumpsys package preferred`), two handlers for
 * `averilab://shared/open`, no chooser on the stack, HOME a launcher — into the record (`chooserPremise`), its lines
 * said at once on stderr (stop the run there if you like) and again in the summary. A stale fact is `CHOOSER PREMISE:
 * stale — … — the run fails` with the owner's hand line under it, and the exit code 1 — a `--side` run's too: the
 * premise is the lab's state, not the averi under test, so a calibration on a stale lab proves no more than a run of
 * this checkout. The cases still run, their verdicts unchanged: the line says why lc1 or lc4'' SKIPs. A last-chosen
 * entry (`mAlways=false`) is a WARN line only; a read that fails is `unread — <why>`, never a throw, the exit code
 * untouched. `--rejudge` prints the record's lines as they are, and only when a chooser case is among the cases it
 * judges (`--groups forms` over a chooser record: nothing).
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
    failures: { type: 'string' },
    app: { type: 'string' },
    'device-read': { type: 'string' },
  },
});
// `--rejudge`'s record (live-cases.ts#RunRecord): read here, judged by live-cases.ts#rejudge.
const rejudging = values.rejudge === undefined ? undefined : (JSON.parse(await readFile(values.rejudge, 'utf8')) as RunRecord);
if (rejudging === undefined && (values.udid === undefined) === (values.serial === undefined)) {
  throw new Error('usage: live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda] [--groups forms,visibility,dismissal,ensure,carousel,chooser] [--cells …] [--cases …] [--side <checkout>] [--record <file>] | --serial <lab emulator> […] [--device-read none] | --rejudge <record> [--failures <file>]');
}
if (values.failures !== undefined && rejudging === undefined) throw new Error('--failures: only a rejudge writes its failure reasons; pass --rejudge <record>');
// `--device-read none`: the carousel group's device reads skipped (device-state.ts#deviceLabelling). A rejudge reads no
// device, so the flag is refused there rather than ignored.
const deviceReadFlag = values['device-read'];
if (deviceReadFlag !== undefined && rejudging !== undefined) throw new Error('--device-read: a rejudge reads no device; leave it out');
if (deviceReadFlag !== undefined && deviceReadFlag !== 'none') throw new Error(`--device-read: none, or leave it out (the carousel group reads the device), not "${deviceReadFlag}"`);
const deviceReadMode: DeviceReadMode = deviceReadFlag === 'none' ? 'none' : 'read';
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

/** The carousel group's hook on the Android adapter's strokes (live-carousel.ts#SwipeHook): armed around a case's calls. */
const swipeHook = new SwipeHook();

async function connect(): Promise<{ client: Client; close(): Promise<void> }> {
  const registry = averi!.registry({
    factory: (p, deviceId, opts) => (p === 'android' ? hookSwipes(averi!.defaultFactory(p, deviceId, opts), swipeHook) : iosAdapter(deviceId, opts?.treeSource ?? 'idb')),
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
    // One closer for finishRun (D82), not three: InMemoryTransport's close only drops references and the registry's
    // shutdown disposes each adapter quietly (src/mcp/registry.ts#shutdown), so a dead device cannot throw out of it
    // and leave the server's processes alive.
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
  const { lines, failures, exitCode } = await rejudge(rejudging, values.rejudge!, { groups, only, onlyCells, app });
  // The reasons first: a summary printed with no file beside it is read as unproven, never as "no failure".
  if (values.failures !== undefined) await writeFile(values.failures, failuresJson(failures));
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
} else {
  const results: Result[] = [];
  const record: RunRecord = { platform, ...(app !== 'native' && { app }), side: sideLabel(values.side), results: [] };
  const selected = await selectCases({ platform, app, groups, only, onlyCells });
  const lab = (ios ?? android)!;
  if (platform === 'ios') console.error(`WDA: port ${port}, derived data ${LAB_WDA_DERIVED_DATA}`);
  const { client, close } = await connect();
  const rig: CaseRig = {
    lab,
    callTool: (call, config) => callTool(client, call, config),
    configFor,
    swipes: swipeHook,
    // Where a case that is not ok leaves the screen, for the evidence.
    ...(shots !== undefined && { keepShot: (name: string, png: Buffer) => writeFile(join(shots, name), png) }),
    note: (line) => console.error(line),
  };
  // T16: a carousel case selected on Android reads the device's state around the cases (device-state.ts): a read that
  // fails, or `--device-read none`, leaves the run unlabelled, said in the summary, never aborted. A case that throws
  // skips the after read: the record keeps `{ before }`, "no read after the cases".
  const deviceReads = deviceLabelling(android, selected, deviceReadMode, { note: (line) => console.error(line) });
  try {
    // T20a: a chooser case selected on Android reads the chooser's premise once, before anything else touches the
    // device (chooser-premise.ts#readPremiseInto): read only, into the record, its lines said at once; a read that
    // fails is its fact unread; the cases run whatever it says. Inside the try: nothing it throws skips the close.
    await readPremiseInto(record, android, selected, { note: (line) => console.error(line) });
    await deviceReads?.read('before');
    // Cases outer, sources inner: the keyboard's cases run on both sources before anything types.
    for (const c of selected) {
      for (const source of sources) {
        if (c.sources !== undefined && !c.sources.includes(source)) continue;
        const run = await runCase(c, source, rig);
        results.push({ source, c, verdict: run.verdict, replies: run.record.replies });
        record.results.push(run.record);
        console.error(`${source} ${c.id} ${run.verdict.outcome}: ${run.verdict.why}`);
      }
    }
    await deviceReads?.read('after');
  } catch (e) {
    // Said here: a record write that fails throws from the `finally` below, and that error replaces this one (D82).
    console.error(`run: threw — ${errorMessage(e)}`);
    throw e;
  } finally {
    // The record before the closes, each close tried: `finishRun` in live-finish.ts (D82).
    await finishRun({
      record,
      recordPath: values.record,
      ...(deviceReads !== undefined && { deviceLabel: () => deviceReads.label() }),
      closers: [
        { name: 'mcp (client, server, registry)', close },
        { name: `lab (${platform === 'android' ? 'am force-stop' : 'WDA shutdown, simctl terminate'})`, close: () => lab.close() },
      ],
      note: (line) => console.error(line),
    });
  }
  // The summary: every case, a known one marked with its note (live-known.ts); exit 1 on an unknown MISMATCH, on a
  // known case not intermittent that came out ok in a run of this checkout (fixed: strike it off), and on a case whose
  // app wrote no first state (T10, live-cases.ts#noFirstState); and on a stale chooser premise (T20a). The record's
  // labels (T16's device label, T20a's premise) as a rejudge reads them (live-cases.ts#summarizeRecord).
  const side = values.side ?? THIS_CHECKOUT;
  const { lines, exitCode } = summarizeRecord(record, results, { sources, side });
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
}

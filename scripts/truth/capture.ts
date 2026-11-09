import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CellFailure } from '../differential/corpus.js';
import { capture, type CaptureResult } from './capture-run.js';
import { loadCatalog, selectCells } from './catalog.js';
import { AndroidLab, IosLab, LAB_APP, type LabDevice } from './lab-device.js';
import { parseLabApp } from './schema.js';
import { isMain } from '../is-main.js';

/**
 * The truth capture's command lines (capture-run.ts does the work; README.md beside scripts/differential, "Golden
 * mode"):
 *
 *   node --import tsx scripts/truth/capture.ts --udid <lab simulator> --out tests/fixtures/truth/<run>
 *        [--wda-port 8120] [--app native|react-native] [--family presented,edges] [--cells open,alert-dim]
 *   node --import tsx scripts/truth/capture-android.ts --serial <lab emulator> --out tests/fixtures/truth/<run>
 *        [--app native|react-native] [--family presented] [--cells open,alert-dim]
 *
 * iOS: the raw WDA `/source?format=json` body (averi's own WdaServer, only its process lifecycle, on a port of its own
 * — never 8100/8101, the device-check simulator's — and a derived-data directory of its own) and the raw idb `ui
 * describe-all --json` list; probes with `idb ui tap`. Android: the raw `uiautomator dump /dev/tty` output; probes with
 * `adb -s <serial> shell input tap`; never restarts the adb server. The device must be the lab's — a simulator named
 * `averi-lab …` (never the device-check simulator), the `averi_lab` AVD — or the capture refuses before touching it
 * (lab-device.ts#IosLab.guard, #AndroidLab.guard); the manifest's device is what simctl / adb report, no label of
 * the caller's. `--family` keeps the cells of those families (schema.ts#FAMILIES), `--cells` those cells (both: the
 * named cells of those families; catalog.ts#selectCells — a name that matches nothing is an error, never an empty run).
 * A run of some cells adds to (or replaces those cells in) the run's manifest, from the same device only —
 * the description the guard reports equal to the manifest's. A cell built for another platform, or (Android) captured
 * under another navigation mode than the device's, is skipped and said (catalog.ts#captureRefusal). `--app` names the
 * lab app the run captures (schema.ts#LabApp; the native one unless said): a cell another app builds is skipped and
 * said (lab-device.ts#otherApp), and a run holds one app's captures — the React Native app's go to a run of their own
 * (tests/fixtures/truth/ios-rn-…, android-rn-…), its manifest's `app` AveriLabRN. A catalog target the app lays out
 * no frame for, where the catalog allows it (CatalogTarget.mayBeAbsent), is recorded absent (CellTruth.absent), never
 * probed; any other missing frame fails the cell. A cell whose capture throws fails alone: nothing of it written, the
 * other cells captured, the manifest written listing it under `failed` (capture-run.ts); a halt
 * (capture-run.ts#CaptureHalt, or a programming error — rethrown here once the summary is said) stops the run once the
 * manifest is written. Exit code 1 when a cell is broken (its truth's sources disagree) or failed, or the run halted
 * (outcome); failures carried from an earlier run are said, not counted.
 */

export async function main(platform: 'ios' | 'android', argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      udid: { type: 'string' },
      serial: { type: 'string' },
      out: { type: 'string' },
      'wda-port': { type: 'string' },
      family: { type: 'string' },
      cells: { type: 'string' },
      app: { type: 'string' },
    },
  });
  const id = platform === 'ios' ? values.udid : values.serial;
  if (id === undefined || values.out === undefined) {
    throw new Error(platform === 'ios' ? 'usage: capture.ts --udid <udid> --out <dir> [--wda-port N] [--app native|react-native] [--family f,g] [--cells a,b]' : 'usage: capture-android.ts --serial <serial> --out <dir> [--app native|react-native] [--family f,g] [--cells a,b]');
  }
  const app = parseLabApp(values.app);
  // The selection before the device: a name that matches nothing is refused without touching it.
  const catalog = await loadCatalog();
  const cells = selectCells(catalog, { families: values.family?.split(','), cells: values.cells?.split(',') });
  const lab: LabDevice = platform === 'ios' ? new IosLab(id, { wdaPort: Number(values['wda-port'] ?? 8120), app }) : new AndroidLab(id, { app });
  const script = platform === 'ios' ? 'capture.ts' : 'capture-android.ts';
  const source = LAB_APP[app].source[platform];
  let result;
  try {
    result = await capture(lab, cells, { out: resolve(values.out), note: `Ground truth: the ${platform === 'ios' ? 'iOS' : 'Android'} ${app === 'native' ? '' : `${app} `}lab app (${source}), captured by scripts/truth/${script}`, catalog: catalog.cells });
  } finally {
    await lab.close();
  }
  const { lines, exitCode, rethrow } = outcome(result);
  for (const line of lines) console.error(line);
  if (exitCode !== 0) process.exitCode = exitCode;
  if (rethrow !== undefined) throw rethrow;
}

/**
 * What the command line says of a run on stderr, and its exit code: 1 when a cell is broken (its truth's sources
 * disagree) or failed (its capture threw — capture-run.ts#CaptureResult.failed, the manifest's `failed`), each listed
 * with why, or the run halted (CaptureResult.halted, said last); failures carried from an earlier run
 * (CaptureResult.carried) are said and leave the code as it is; 0 and nothing said otherwise. `rethrow`: a bug in the
 * capture, for main to throw once all of this is said.
 */
export function outcome(result: CaptureResult): { lines: string[]; exitCode: 0 | 1; rethrow?: Error } {
  const lines: string[] = [];
  const list = (xs: string[]) => xs.map((x) => `  ${x}`).join('\n');
  const said = (fs: readonly CellFailure[]) => fs.map((f) => `${f.cell}: ${f.reason}`);
  if (result.broken.length > 0) lines.push(`\nBROKEN CELLS — the truth's sources disagree:\n${list(result.broken)}`);
  if (result.failed.length > 0) lines.push(`\nFAILED CELLS — the capture threw; nothing of them written this run (an earlier capture, if any, kept; manifest.json lists them under \`failed\`):\n${list(said(result.failed))}`);
  if (result.halted !== undefined) lines.push(`\nHALTED at ${result.halted.cell} — ${result.halted.reason}; the cells after it were not captured`);
  const exitCode = lines.length > 0 ? 1 : 0;
  if (result.carried.length > 0) lines.push(`\nstill failed from an earlier run (manifest.json \`failed\`): ${said(result.carried).join('; ')}`);
  return { lines, exitCode, ...(result.halted?.bug !== undefined && { rethrow: result.halted.bug }) };
}

if (isMain(import.meta.url)) await main('ios');

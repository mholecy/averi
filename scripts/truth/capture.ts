import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { capture } from './capture-run.js';
import { loadCatalog, selectCells } from './catalog.js';
import { AndroidLab, IosLab, type LabDevice } from './lab-device.js';

/**
 * The truth capture's command lines (capture-run.ts does the work; README.md beside scripts/differential, "Golden
 * mode"):
 *
 *   node --import tsx scripts/truth/capture.ts --udid <lab simulator> --out tests/fixtures/truth/<run>
 *        [--wda-port 8120] [--family presented,edges] [--cells open,alert-dim]
 *   node --import tsx scripts/truth/capture-android.ts --serial <lab emulator> --out tests/fixtures/truth/<run>
 *        [--family presented] [--cells open,alert-dim]
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
 * the description the guard reports equal to the manifest's. Exit code 1 when a cell is broken (its truth's sources
 * disagree).
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
    },
  });
  const id = platform === 'ios' ? values.udid : values.serial;
  if (id === undefined || values.out === undefined) {
    throw new Error(platform === 'ios' ? 'usage: capture.ts --udid <udid> --out <dir> [--wda-port N] [--family f,g] [--cells a,b]' : 'usage: capture-android.ts --serial <serial> --out <dir> [--family f,g] [--cells a,b]');
  }
  // The selection before the device: a name that matches nothing is refused without touching it.
  const catalog = await loadCatalog();
  const cells = selectCells(catalog, { families: values.family?.split(','), cells: values.cells?.split(',') });
  const lab: LabDevice = platform === 'ios' ? new IosLab(id, { wdaPort: Number(values['wda-port'] ?? 8120) }) : new AndroidLab(id);
  const script = platform === 'ios' ? 'capture.ts' : 'capture-android.ts';
  const app = platform === 'ios' ? 'fixtures/apps/ios' : 'fixtures/apps/android';
  let result;
  try {
    result = await capture(lab, cells, { out: resolve(values.out), note: `Ground truth: the ${platform === 'ios' ? 'iOS' : 'Android'} lab app (${app}), captured by scripts/truth/${script}`, catalog: catalog.cells });
  } finally {
    await lab.close();
  }
  if (result.broken.length > 0) {
    console.error(`\nBROKEN CELLS — the truth's sources disagree:\n${result.broken.map((b) => `  ${b}`).join('\n')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main('ios');

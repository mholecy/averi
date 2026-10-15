import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { PNG } from 'pngjs';
import type { RunManifest } from '../differential/corpus.js';
import { measure } from './pixels.js';
import { consistency, type Catalog, type CellTruth, type LabState } from './schema.js';

/**
 * The truth capture of the Android lab app (fixtures/apps/android; docs/plans/2026-10-15-ground-truth-lab-app.md,
 * phase 2) — capture.ts's Android twin:
 *
 *   node --import tsx scripts/truth/capture-android.ts --serial <lab emulator> --out tests/fixtures/truth/<run>
 *        [--device "<avd>, Android <version> (API <N>)"] [--cells open,alert-dim]
 *
 * Per cell: launch it in a fresh process (`am force-stop`, the state file removed, `am start … --es cell <id>`), wait
 * for the app's `ready`, save the raw `uiautomator dump /dev/tty` output (status line and all — what averi's adapter
 * reads), the `screencap -p` screenshot and the app's state; then, per target, relaunch the cell and tap the target's
 * centre with a raw `adb shell input tap` — the probe: did its click fire? — and measure from the screenshot how much
 * of it is drawn as itself. Writes a differential corpus run (manifest.json; one uiautomator capture per cell).
 *
 * Units are screen PIXELS throughout — uiautomator's bounds, the app's frames (Lab.kt) — so the truth's `scale` is 1.
 * averi judges nothing here: the tree is read with the raw tool, so the truth does not depend on the code it will
 * test. Every adb command names the serial; nothing restarts the adb server. Run it against an emulator that holds
 * nothing else of value: the lab app's data is cleared per launch.
 */

const run = promisify(execFile);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE = 'dev.averi.lab';
/** The cell layers the Android app builds (Lab.kt#SUPPORTED_LAYERS); a cell of another layer is skipped, said so. */
const LAYERS = new Set(['none', 'sheet-medium', 'alert']);

const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    out: { type: 'string' },
    device: { type: 'string' },
    cells: { type: 'string' },
  },
});
if (values.serial === undefined || values.out === undefined) throw new Error('usage: capture-android.ts --serial <serial> --out <dir> [--device …] [--cells a,b]');
const serial = values.serial;
const out = resolve(values.out);

const adb = (...args: string[]) => run('adb', ['-s', serial, ...args], { maxBuffer: 64 << 20 });
/** Bytes, not text: a PNG on stdout. */
const adbRaw = (...args: string[]) => run('adb', ['-s', serial, ...args], { maxBuffer: 64 << 20, encoding: 'buffer' });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state(): Promise<LabState | undefined> {
  try {
    return JSON.parse((await adb('exec-out', 'run-as', PACKAGE, 'cat', 'files/lab-state.json')).stdout) as LabState;
  } catch {
    return undefined;
  }
}

/**
 * Launch the cell in a fresh process and wait until the app says it has settled (10 s at most). The last process's
 * state file is removed first: it names the same cell, ready, and would be read as this one's before the new process
 * has drawn anything — the probe tap would land before the layer is up (capture.ts learned it on iOS).
 */
async function launch(cell: string): Promise<LabState> {
  await adb('shell', 'am', 'force-stop', PACKAGE);
  await adb('shell', 'run-as', PACKAGE, 'rm', '-f', 'files/lab-state.json');
  await adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`, '--es', 'cell', cell);
  for (let waited = 0; waited < 10_000; waited += 200) {
    await pause(200);
    const s = await state();
    if (s?.cell === cell && s.ready) {
      await pause(300);
      return (await state())!;
    }
  }
  throw new Error(`cell ${cell}: the app did not report ready within 10 s`);
}

const catalog = JSON.parse(await readFile(join(HERE, '../../fixtures/apps/cells.json'), 'utf8')) as Catalog;
const only = values.cells?.split(',');
const cells = catalog.cells.filter((c) => only === undefined || only.includes(c.id));
const sdk = (await adb('shell', 'getprop', 'ro.build.version.sdk')).stdout.trim();
const release = (await adb('shell', 'getprop', 'ro.build.version.release')).stdout.trim();
const avd = (await adb('emu', 'avd', 'name').catch(() => ({ stdout: 'emulator' }))).stdout.split(/\r?\n/)[0].trim();
const device = values.device ?? `${avd} emulator, Android ${release} (API ${sdk})`;
await mkdir(out, { recursive: true });

const manifest: RunManifest = { platform: 'android', app: 'AveriLab', device, note: 'Ground truth: the Android lab app (fixtures/apps/android), captured by scripts/truth/capture-android.ts', captures: [] };
const broken: string[] = [];
for (const cell of cells) {
  if (!LAYERS.has(cell.layer)) {
    console.log(`${cell.id}: skipped — layer ${cell.layer} is not one the Android app builds`);
    continue;
  }
  const s = await launch(cell.id);
  const dump = (await adb('exec-out', 'uiautomator', 'dump', '/dev/tty')).stdout;
  const shot = (await adbRaw('exec-out', 'screencap', '-p')).stdout;
  const png = PNG.sync.read(shot);
  await writeFile(join(out, `${cell.id}.png`), shot);
  await writeFile(join(out, `${cell.id}.xml`), dump);
  await writeFile(join(out, `${cell.id}.state.json`), JSON.stringify(s, null, 2) + '\n');

  const truth: CellTruth = { cell: cell.id, layer: cell.layer, device, screen: { width: s.screen.width, height: s.screen.height }, scale: s.scale, targets: [] };
  for (const t of cell.targets) {
    const frame = s.frames[t.tag];
    if (frame === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for target ${t.tag}`);
    const { drawn, seen } = measure(png, frame, s.scale, t.color);
    await launch(cell.id);
    await adb('shell', 'input', 'tap', String(Math.round(frame.x + frame.width / 2)), String(Math.round(frame.y + frame.height / 2)));
    await pause(1_000);
    const events = (await state())?.events ?? [];
    const reached = events.some((e) => e.kind === 'tap' && e.tag === t.tag);
    const probe = events.filter((e) => !(e.kind === 'tap' && e.tag === t.tag)).map((e) => `${e.kind} ${e.tag}`);
    const target = { tag: t.tag, id: `lab.${cell.id}.${t.tag}`, color: t.color, declared: t.declared, frame, reached, probe, drawn: Math.round(drawn * 1000) / 1000, seen };
    truth.targets.push(target);
    const why = consistency(target);
    if (why !== undefined) broken.push(`${cell.id}/${t.tag}: ${why}`);
    console.log(`${cell.id}/${t.tag}: reached ${reached}, drawn ${target.drawn}, seen ${seen}${probe.length ? `, probe ${probe.join('; ')}` : ''}`);
  }
  await writeFile(join(out, `${cell.id}.truth.json`), JSON.stringify(truth, null, 2) + '\n');
  manifest.captures.push({ file: `${cell.id}.xml`, source: 'uiautomator', form: 'raw', screen: truth.screen, screenshot: `${cell.id}.png`, truth: `${cell.id}.truth.json` });
}
await adb('shell', 'am', 'force-stop', PACKAGE);
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (broken.length > 0) {
  console.error(`\nBROKEN CELLS — the truth's sources disagree:\n${broken.map((b) => `  ${b}`).join('\n')}`);
  process.exitCode = 1;
}

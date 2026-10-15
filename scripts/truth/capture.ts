import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { PNG } from 'pngjs';
import { WdaServer } from '../../src/adapters/wda.js';
import type { RunManifest } from '../differential/corpus.js';
import { measure } from './pixels.js';
import { consistency, type Catalog, type CellTruth, type LabState } from './schema.js';

/**
 * The truth capture of the iOS lab app (docs/plans/2026-10-15-ground-truth-lab-app.md):
 *
 *   node --import tsx scripts/truth/capture.ts --udid <lab simulator> --out tests/fixtures/truth/<run>
 *        [--device "<name>, iOS <version>"] [--wda-port 8120] [--cells open,alert-dim]
 *
 * Per cell: launch the app on it (`-cell <id>`, a fresh process), wait for the app's `ready`, save the raw WDA
 * `/source?format=json` body, the raw idb `ui describe-all --json` list, the screenshot and the app's state; then, per
 * target, relaunch the cell and tap the target's centre with a raw `idb ui tap` — the probe: did its action fire? —
 * and measure from the screenshot how much of it is drawn as itself. Writes a differential corpus run (manifest.json;
 * two captures per cell, WDA and idb, sharing the screenshot and the truth).
 *
 * averi judges nothing here: the trees are read with the raw tools, so the truth does not depend on the code it will
 * test. WDA is averi's own WdaServer (only its process lifecycle) on a port of its own, never 8100/8101 — the
 * device-check simulator's. Run it against a simulator that holds nothing else of value.
 */

const run = promisify(execFile);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BUNDLE = 'dev.averi.lab';

const { values } = parseArgs({
  options: {
    udid: { type: 'string' },
    out: { type: 'string' },
    device: { type: 'string' },
    'wda-port': { type: 'string' },
    cells: { type: 'string' },
  },
});
if (values.udid === undefined || values.out === undefined) throw new Error('usage: capture.ts --udid <udid> --out <dir> [--device …] [--wda-port N] [--cells a,b]');
const udid = values.udid;
const out = resolve(values.out);

const simctl = (...args: string[]) => run('xcrun', ['simctl', ...args], { maxBuffer: 64 << 20 });
const idb = (...args: string[]) => run('idb', [...args, '--udid', udid], { maxBuffer: 64 << 20 });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let stateFile: string | undefined;
async function state(): Promise<LabState | undefined> {
  stateFile ??= join((await simctl('get_app_container', udid, BUNDLE, 'data')).stdout.trim(), 'Documents', 'lab-state.json');
  try {
    return JSON.parse(await readFile(stateFile, 'utf8')) as LabState;
  } catch {
    return undefined;
  }
}

/**
 * Launch the cell in a fresh process and wait until the app says it has settled (10 s at most). The last process's
 * state file is removed first: it names the same cell, ready, and would be read as this one's before the new process
 * has drawn anything.
 */
async function launch(cell: string): Promise<LabState> {
  await simctl('terminate', udid, BUNDLE).catch(() => undefined);
  await state();
  await rm(stateFile!, { force: true });
  await simctl('launch', udid, BUNDLE, '-cell', cell);
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
const device = values.device ?? 'averi-lab iPhone 17 simulator, iOS 27.0';
const wda = new WdaServer({ udid, port: Number(values['wda-port'] ?? 8120) });
await mkdir(out, { recursive: true });

const manifest: RunManifest = { platform: 'ios', app: 'AveriLab', device, note: 'Ground truth: the iOS lab app (fixtures/apps/ios), captured by scripts/truth/capture.ts', captures: [] };
const broken: string[] = [];
try {
  for (const cell of cells) {
    const s = await launch(cell.id);
    const source = await wda.source();
    const idbTree = (await idb('ui', 'describe-all', '--json')).stdout;
    const shot = join(out, `${cell.id}.png`);
    await simctl('io', udid, 'screenshot', shot);
    const png = PNG.sync.read(await readFile(shot));
    await writeFile(join(out, `${cell.id}.wda.json`), JSON.stringify(source, null, 1) + '\n');
    await writeFile(join(out, `${cell.id}.idb.json`), idbTree);
    await writeFile(join(out, `${cell.id}.state.json`), JSON.stringify(s, null, 2) + '\n');

    const truth: CellTruth = { cell: cell.id, layer: cell.layer, device, screen: { width: s.screen.width, height: s.screen.height }, scale: s.scale, targets: [] };
    for (const t of cell.targets) {
      const frame = s.frames[t.tag];
      if (frame === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for target ${t.tag}`);
      const { drawn, seen } = measure(png, frame, s.scale, t.color);
      await launch(cell.id);
      await idb('ui', 'tap', String(Math.round(frame.x + frame.width / 2)), String(Math.round(frame.y + frame.height / 2)));
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
    for (const source of ['wda', 'idb'] as const) {
      manifest.captures.push({ file: `${cell.id}.${source}.json`, source, form: 'raw', screen: truth.screen, screenshot: `${cell.id}.png`, truth: `${cell.id}.truth.json` });
    }
  }
} finally {
  await wda.shutdown();
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (broken.length > 0) {
  console.error(`\nBROKEN CELLS — the truth's sources disagree:\n${broken.map((b) => `  ${b}`).join('\n')}`);
  process.exitCode = 1;
}

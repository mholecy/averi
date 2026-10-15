import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { WdaServer } from '../../src/adapters/wda.js';
import type { RunManifest } from '../differential/corpus.js';
import { LabDevice, pause } from './lab-device.js';
import { measure } from './pixels.js';
import {
  consistency,
  controlConsistency,
  type Catalog,
  type CatalogCell,
  type CatalogForm,
  type CellTruth,
  type ControlTruth,
  type FormTruth,
  type LabState,
  type Rect,
  type Situation,
} from './schema.js';

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
 * A form cell (phase 1b) has no coloured targets: its truth is the app's own model of each field (value, focus, the
 * error shown and its identifier), the keyboard's frame and the submits, as the state file held them when the trees
 * were read, plus per control (field, submit, the picker's probe rows) where its frame lies — open, under the keyboard,
 * under the sheet, off the screen (situationOf) — and whether a raw tap at its centre reached it: focused the field,
 * fired the button, chose the row.
 *
 * averi judges nothing here: the trees are read with the raw tools, so the truth does not depend on the code it will
 * test. WDA is averi's own WdaServer (only its process lifecycle) on a port of its own, never 8100/8101 — the
 * device-check simulator's. Run it against a simulator that holds nothing else of value.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));

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

const lab = new LabDevice(udid);

const catalog = JSON.parse(await readFile(join(HERE, '../../fixtures/apps/cells.json'), 'utf8')) as Catalog;
const only = values.cells?.split(',');
const cells = catalog.cells.filter((c) => only === undefined || only.includes(c.id));
const device = values.device ?? 'averi-lab iPhone 17 simulator, iOS 27.0';
const wda = new WdaServer({ udid, port: Number(values['wda-port'] ?? 8120) });
await mkdir(out, { recursive: true });

/** A cell already captured and not asked for again keeps its entries — a run of `--cells a,b` adds to the manifest. */
const previous = await readFile(join(out, 'manifest.json'), 'utf8').then((t) => JSON.parse(t) as RunManifest).catch(() => undefined);
const manifest: RunManifest = { platform: 'ios', app: 'AveriLab', device, note: 'Ground truth: the iOS lab app (fixtures/apps/ios), captured by scripts/truth/capture.ts', captures: [] };
const broken: string[] = [];
try {
  for (const cell of cells) {
    const s = await lab.launch(cell.id);
    const source = await wda.source();
    // idb's first read on a freshly booted simulator can fail ("No translation object returned"): one retry.
    const idbTree = (await lab.idb('ui', 'describe-all', '--json').catch(async () => (await pause(2_000), lab.idb('ui', 'describe-all', '--json')))).stdout;
    const shot = join(out, `${cell.id}.png`);
    await lab.simctl('io', udid, 'screenshot', shot);
    const png = PNG.sync.read(await readFile(shot));
    await writeFile(join(out, `${cell.id}.wda.json`), JSON.stringify(source, null, 1) + '\n');
    await writeFile(join(out, `${cell.id}.idb.json`), idbTree);
    await writeFile(join(out, `${cell.id}.state.json`), JSON.stringify(s, null, 2) + '\n');

    const truth: CellTruth = { cell: cell.id, layer: cell.layer, device, screen: { width: s.screen.width, height: s.screen.height }, scale: s.scale, targets: [] };
    for (const t of cell.targets) {
      const frame = s.frames[t.tag];
      if (frame === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for target ${t.tag}`);
      const { drawn, seen } = measure(png, frame, s.scale, t.color);
      await lab.launch(cell.id);
      await lab.tap(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await pause(1_000);
      const events = (await lab.state())?.events ?? [];
      const reached = events.some((e) => e.kind === 'tap' && e.tag === t.tag);
      const probe = events.filter((e) => !(e.kind === 'tap' && e.tag === t.tag)).map((e) => `${e.kind} ${e.tag}`);
      const target = { tag: t.tag, id: `lab.${cell.id}.${t.tag}`, color: t.color, declared: t.declared, frame, reached, probe, drawn: Math.round(drawn * 1000) / 1000, seen };
      truth.targets.push(target);
      const why = consistency(target);
      if (why !== undefined) broken.push(`${cell.id}/${t.tag}: ${why}`);
      console.log(`${cell.id}/${t.tag}: reached ${reached}, drawn ${target.drawn}, seen ${seen}${probe.length ? `, probe ${probe.join('; ')}` : ''}`);
    }
    if (cell.form !== undefined) truth.form = await formTruth(cell, cell.form, s);
    await writeFile(join(out, `${cell.id}.truth.json`), JSON.stringify(truth, null, 2) + '\n');
    for (const source of ['wda', 'idb'] as const) {
      manifest.captures.push({ file: `${cell.id}.${source}.json`, source, form: 'raw', screen: truth.screen, screenshot: `${cell.id}.png`, truth: `${cell.id}.truth.json` });
    }
  }
} finally {
  await wda.shutdown();
}
const captured = new Set(cells.map((c) => c.id));
const kept = (previous?.captures ?? []).filter((c) => !captured.has(c.file.slice(0, c.file.indexOf('.'))));
manifest.captures = [...kept, ...manifest.captures].sort((a, b) => order(a.file) - order(b.file));
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (broken.length > 0) {
  console.error(`\nBROKEN CELLS — the truth's sources disagree:\n${broken.map((b) => `  ${b}`).join('\n')}`);
  process.exitCode = 1;
}

/** A capture file's place in the catalog — the manifest lists cells in the catalog's order. */
function order(file: string): number {
  return catalog.cells.findIndex((c) => file.startsWith(`${c.id}.`));
}

/**
 * Where a control's frame lies, from the app's frames alone. The pinned submit's bar (the submit's frame and the
 * inset's 10 pt padding, full width) covers what is laid under it; a control straddling the keyboard's top, or with its
 * centre under the bar, is `covered` — partly hidden, judged by no row.
 */
function situationOf(frame: Rect | undefined, s: LabState, form: CatalogForm, own: { tag: string; inSheet: boolean }): Situation {
  if (frame === undefined) return 'not-rendered';
  const cy = frame.y + frame.height / 2;
  if (cy < 0 || cy >= s.screen.height) return 'off-screen';
  const sheet = s.frames.sheet;
  if (!own.inSheet && form.picker?.open === true && sheet !== undefined && cy >= sheet.y) return 'presented-over';
  const k = s.keyboard?.visible === true ? s.keyboard.frame : undefined;
  if (k !== undefined && frame.y >= k.y) return 'under-keyboard';
  if (k !== undefined && frame.y + frame.height > k.y) return 'covered';
  const submit = s.frames[form.submit.tag];
  if (form.submit.pinned === true && own.tag !== form.submit.tag && submit !== undefined && cy >= submit.y - 10 && cy <= submit.y + submit.height + 10) return 'covered';
  return 'open';
}

async function formTruth(cell: CatalogCell, form: CatalogForm, s: LabState): Promise<FormTruth> {
  const frameOf = (tag: string): Rect => {
    const f = s.frames[tag];
    if (f === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for ${tag}`);
    return f;
  };
  const fields = form.fields.map((f) => {
    const st = s.fields?.[f.tag];
    if (st === undefined) throw new Error(`cell ${cell.id}: the app reported no state for field ${f.tag}`);
    return {
      tag: f.tag,
      id: `lab.${cell.id}.${f.tag}`,
      kind: f.kind,
      title: f.title,
      titleId: f.titleId ?? `lab.${cell.id}.${f.tag}.title`,
      frame: frameOf(f.tag),
      ...st,
      ...(st.error !== null && { errorFrame: frameOf(`${f.tag}.error`) }),
    };
  });
  const wanted: { tag: string; id: string; kind: ControlTruth['kind']; inSheet: boolean; frame: string }[] = [
    ...form.fields.map((f) => ({ tag: f.tag, id: `lab.${cell.id}.${f.tag}`, kind: 'field' as const, inSheet: false, frame: f.tag })),
    { tag: form.submit.tag, id: `lab.${cell.id}.${form.submit.tag}`, kind: 'button', inSheet: false, frame: form.submit.tag },
    ...(form.picker?.open === true ? form.picker.probe ?? [] : []).map((code) => ({
      tag: `${form.picker!.field}.${code}`,
      id: `lab.${cell.id}.${form.picker!.field}.${code}`,
      kind: 'row' as const,
      inSheet: true,
      frame: `row.${code}`,
    })),
  ];
  const controls: ControlTruth[] = [];
  for (const w of wanted) {
    const frame = s.frames[w.frame];
    const situation = situationOf(frame, s, form, w);
    let reached = false;
    let probe: string[] = [];
    if (frame === undefined || situation === 'off-screen' || situation === 'not-rendered') {
      probe = [`not tapped: ${situation}`];
    } else {
      // Only what the tap did: the launch's own events (the on-appear submit, the on-appear focus) are left out.
      const before = (await lab.launch(cell.id)).events.length;
      await lab.tap(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await pause(1_000);
      const after = await lab.state();
      const events = (after?.events ?? []).slice(before);
      const field = form.fields.find((f) => f.tag === w.tag);
      const hit = (e: { kind: string; tag: string }) =>
        w.kind === 'row' ? e.kind === 'select' && w.tag.endsWith(`.${e.tag}`)
        : w.kind === 'button' ? e.kind === 'submit'
        : field?.kind === 'country' ? e.kind === 'tap' && e.tag === w.tag
        : e.kind === 'focus' && e.tag === w.tag;
      // A field the cell focuses on appear is reached when the tap leaves the focus on it.
      reached = events.some(hit) || (w.kind === 'field' && field?.kind !== 'country' && after?.focus === w.tag);
      probe = events.filter((e) => !hit(e)).map((e) => `${e.kind} ${e.tag}`);
    }
    const c: ControlTruth = { tag: w.tag, id: w.id, kind: w.kind, ...(frame !== undefined && { frame }), situation, reached, probe };
    controls.push(c);
    const why = controlConsistency(c);
    if (why !== undefined) broken.push(`${cell.id}/${w.tag}: ${why}`);
    console.log(`${cell.id}/${w.tag}: ${situation}, reached ${reached}${probe.length ? `, probe ${probe.join('; ')}` : ''}`);
  }
  const k = s.keyboard?.visible === true ? s.keyboard : undefined;
  const screenError = form.screenError !== undefined && s.frames.screenError !== undefined ? { ...form.screenError, frame: s.frames.screenError } : null;
  return {
    fields,
    controls,
    keyboard: k === undefined ? null : { frame: k.frame, field: k.field },
    screenError,
    submits: (s.submits ?? []).map((x) => ({ valid: x.valid })),
    ...(form.picker?.open === true && s.frames.sheet !== undefined && { sheet: s.frames.sheet }),
  };
}

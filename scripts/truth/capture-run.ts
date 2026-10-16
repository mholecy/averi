import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { RunManifest } from '../differential/corpus.js';
import type { LabDevice } from './lab-device.js';
import { captureRefusal } from './catalog.js';
import { measure } from './pixels.js';
import type { CatalogCell, CatalogForm, CellTruth, ControlTruth, FormTruth, LabState, Rect, TargetTruth } from './schema.js';
import { consistency, controlConsistency, controlPiece, imePanels, listedIn, measuredGeometry, outOfProcessKeyboard, pieceAfterBack, pieceProbePoint, probeEvents, probePoint, readControlProbe, readDismissalProbe, readTargetProbe, situationOf, textListedIn, unprobedReason } from './truth.js';

/**
 * The truth capture (docs/plans/2026-10-15-ground-truth-lab-app.md), one for both platforms — the device behind a
 * LabDevice (lab-device.ts), the command lines thin (capture.ts: iOS, capture-android.ts: Android):
 *
 * Per cell: launch it in a fresh process, wait for the app's `ready`, save every raw tree the platform has (WDA and
 * idb; uiautomator), the screenshot and the app's state; then per target, and per control of a form cell, relaunch the
 * cell and tap its centre with a raw tap — the probe: did its action fire, and (the positive control) did the tap reach
 * the app at all? — and, for a target, measure from the screenshot how much of it is drawn as itself. Writes a
 * differential corpus run: one capture per tree, sharing the cell's screenshot and truth.
 *
 * When the state reports the screen's bands, scroll views or chrome (phase 3's cells), each target also carries its
 * measured geometry (truth.ts#geometryOf): an off-screen target is not probed, and a target whose tappable piece is not
 * centred where its frame is gets a second probe at the piece's centre (`reachedAtPiece`). A state reporting none of it
 * — every cell before phase 3 — captures as before. On any cell, a target whose probe point (probePoint, its rounded
 * centre) lies off the screen is not tapped there — a raw tap off the screen reaches no window of the app and would log
 * no touch — and records why (`unprobed`), `reached` false (unmeasured, a declared-open one is then broken, as before
 * phase 3: truth.ts#consistency). A centre in a system band is probed: measured, the tap there is the app's or the
 * bar's (truth.ts#systemBarSwallows, #statusBarMaySwallow, #navigationBandTakes — the last by the navigation mode an
 * Android capture records, LabDevice.navigation). One rule decides what is never tapped, for the capture and
 * consistency both: truth.ts#unprobedReason.
 *
 * A form cell has no coloured targets: its truth is the app's own model of each field (value, focus, the error shown
 * and its identifier), the keyboard's frame and the submits, as the state file held them when the trees were read, plus
 * per control (field, submit, the picker's probe rows) where its frame lies (truth.ts#situationOf) and what its probe
 * did.
 *
 * averi judges nothing here: the trees are read with the raw tools, so the truth does not depend on the code it will
 * test. Run it against a device that holds nothing else of value: the lab app's data is replaced per launch.
 */

export interface CaptureOptions {
  /** The run's directory (tests/fixtures/truth/<run>). */
  out: string;
  /** The manifest's note: what captured it. */
  note: string;
  /** The catalog, for the manifest's order. */
  catalog: readonly CatalogCell[];
  log?: (line: string) => void;
}

export interface CaptureResult {
  /** Targets and controls whose truth's sources disagree — `<cell>/<tag>: why`. */
  broken: string[];
  /** Cells the app cannot build — `<cell>: why`. */
  skipped: string[];
  manifest: RunManifest;
}

export async function capture(lab: LabDevice, cells: readonly CatalogCell[], opts: CaptureOptions): Promise<CaptureResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const device = await lab.describe();
  await mkdir(opts.out, { recursive: true });
  // A cell already captured and not asked for again keeps its entries — a run of some cells adds to the manifest. Only
  // from the same device: a manifest names one device for all its captures.
  const previous = await readFile(join(opts.out, 'manifest.json'), 'utf8').then((t) => JSON.parse(t) as RunManifest).catch(() => undefined);
  if (previous !== undefined && (previous.platform !== lab.platform || previous.device !== device)) {
    throw new Error(`${opts.out} holds captures of ${previous.platform} "${previous.device}", not ${lab.platform} "${device}": capture into a run of its own, or recapture every cell`);
  }
  const manifest: RunManifest = { platform: lab.platform, app: 'AveriLab', device, note: opts.note, captures: [] };
  const broken: string[] = [];
  const skipped: string[] = [];
  // Who takes a tap in the navigation band depends on it (truth.ts#navigationBandTakes): read once per run.
  const navigation = await lab.navigation?.();
  const captured = new Set<string>();
  for (const cell of cells) {
    const why = captureRefusal(cell, lab.platform, navigation) ?? lab.unsupported(cell);
    if (why !== undefined) {
      skipped.push(`${cell.id}: ${why}`);
      log(`${cell.id}: skipped — ${why}`);
      continue;
    }
    const s = await lab.launch(cell.id);
    const trees = await lab.trees();
    const shot = await lab.screenshot();
    const png = PNG.sync.read(shot);
    await writeFile(join(opts.out, `${cell.id}.png`), shot);
    for (const t of trees) await writeFile(join(opts.out, `${cell.id}${t.suffix}`), t.payload);
    await writeFile(join(opts.out, `${cell.id}.state.json`), JSON.stringify(s, null, 2) + '\n');

    const truth: CellTruth = {
      cell: cell.id,
      layer: cell.layer,
      device,
      screen: { width: s.screen.width, height: s.screen.height },
      scale: s.scale,
      targets: [],
      ...(s.safeArea !== undefined && { safeArea: s.safeArea }),
      ...(s.scrollViews !== undefined && { scrollViews: s.scrollViews }),
      ...(s.chrome !== undefined && { chrome: s.chrome }),
      ...(cell.config !== undefined && { config: cell.config }),
      ...(navigation !== undefined && { navigation }),
    };
    for (const t of cell.targets) {
      const frame = s.frames[t.tag];
      if (frame === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for target ${t.tag}`);
      // A text target is drawn on its control: how much of the control's box shows its colour (the text on it).
      const box = t.text === undefined ? frame : s.frames[`${t.tag}.box`];
      if (box === undefined) throw new Error(`cell ${cell.id}: the app reported no frame for text target ${t.tag}'s box (${t.tag}.box)`);
      const { drawn, seen } = measure(png, box, s.scale, t.color);
      const geometry = measuredGeometry(frame, s, t.scrollView);
      // The centre is never tapped where it lies off the screen (truth.ts#unprobedReason, the rule consistency holds
      // the target to).
      const unprobed = unprobedReason({ frame, ...geometry }, s.screen)?.says;
      const read = unprobed !== undefined ? { reached: false, probe: [] } : readTargetProbe((await probe(lab, cell.id, frame)).events, t.tag);
      const second = geometry.geometry === 'off-screen' ? undefined : pieceProbePoint(frame, geometry.piece);
      const reachedAtPiece = second === undefined ? undefined : readTargetProbe((await probe(lab, cell.id, second)).events, t.tag).reached;
      const id = `lab.${cell.id}.${t.tag}`;
      const target: TargetTruth = {
        tag: t.tag,
        id,
        ...(t.text !== undefined && { text: t.text }),
        color: t.color,
        declared: t.declared,
        frame,
        ...read,
        drawn: Math.round(drawn * 1000) / 1000,
        seen,
        ...geometry,
        ...(t.scrollView !== undefined && { scrollView: t.scrollView }),
        // Whether each tree lists it — read by the edge rows (target-contract.ts#unlistedBy), so recorded with a geometry.
        ...(geometry.geometry !== undefined && { listed: Object.fromEntries(trees.map((tree) => [tree.source, listedIn(tree.payload, tree.source, id)])) }),
        // Whether each tree lists its string (golden-spec/text.ts: a covered string's "not found" is right only there).
        ...(t.text !== undefined && { textListed: Object.fromEntries(trees.map((tree) => [tree.source, textListedIn(tree.payload, tree.source, t.text!)])) }),
        ...(reachedAtPiece !== undefined && { reachedAtPiece }),
        ...(unprobed !== undefined && { unprobed }),
      };
      truth.targets.push(target);
      const bad = consistency(target, lab.platform, s.screen, navigation);
      if (bad !== undefined) broken.push(`${cell.id}/${t.tag}: ${bad}`);
      log(`${cell.id}/${t.tag}: ${target.geometry === undefined ? '' : `${target.geometry}, `}reached ${target.reached}${unprobed === undefined ? '' : ` (unprobed: ${unprobed})`}${reachedAtPiece === undefined ? '' : ` (at its piece ${reachedAtPiece})`}, drawn ${target.drawn}, seen ${seen}${described(target.probe)}`);
    }
    // Android with the IME up: what averi's keyboard queries answer, for the golden mode's fake device to serve
    // (CellTruth.ime) — read after the trees and the screenshot, since it leaves the keyboard hidden.
    let afterBack: LabState | undefined;
    let panels: Rect[] = [];
    if (s.keyboard?.visible === true && lab.ime !== undefined) {
      const ime = await lab.ime();
      // A floating IME's panels (truth.ts#imePanels): only on a cell captured floating (CatalogCell.ime), and always there.
      panels = imePanels(ime.shown.touchable, s.keyboard.frame);
      if (cell.ime === 'floating' && panels.length === 0) throw new Error(`cell ${cell.id}: captured with the IME floating only, but its touchable region holds no panel beyond its band — switch Gboard to Floating first`);
      if (cell.ime !== 'floating' && panels.length > 0) throw new Error(`cell ${cell.id}: the IME is floating (a panel beyond its band: ${panels.map((p) => `${p.x},${p.y} ${p.width}x${p.height}`).join(', ')}) — dock it first; only a cell marked ime: floating is captured so`);
      await writeFile(join(opts.out, `${cell.id}.ime.json`), JSON.stringify(ime, null, 1) + '\n');
      truth.ime = `${cell.id}.ime.json`;
      // ime() left the keyboard hidden by one back: the layout averi finds an element again in after its guard's
      // back — its trees and the app's state, beside the truth (CellTruth.afterBack).
      const backTrees = await lab.trees();
      afterBack = await lab.state();
      if (afterBack === undefined) throw new Error(`cell ${cell.id}: no state after back`);
      for (const t of backTrees) await writeFile(join(opts.out, `${cell.id}.after-back${t.suffix}`), t.payload);
      await writeFile(join(opts.out, `${cell.id}.after-back.state.json`), JSON.stringify(afterBack, null, 2) + '\n');
      truth.afterBack = { state: `${cell.id}.after-back.state.json`, trees: Object.fromEntries(backTrees.map((t) => [t.source, `${cell.id}.after-back${t.suffix}`])) };
    }
    // Android: the device's own system bands with the IME down (CellTruth.displays; a cell captured with it up has been
    // hidden by ime()'s back by now) — the navigation bar's top depends on the navigation mode, which the fake device's
    // stock dump (gesture navigation) does not follow.
    if (lab.displays !== undefined) {
      await writeFile(join(opts.out, `${cell.id}.displays.txt`), await lab.displays());
      truth.displays = `${cell.id}.displays.txt`;
    }
    if (cell.ime === 'floating' && panels.length === 0) throw new Error(`cell ${cell.id}: captured with the IME floating only, but no IME was up`);
    if (cell.form !== undefined) truth.form = await formTruth(lab, cell, cell.form, s, png, broken, log, afterBack, panels);
    await writeFile(join(opts.out, `${cell.id}.truth.json`), JSON.stringify(truth, null, 2) + '\n');
    for (const t of trees) {
      manifest.captures.push({ file: `${cell.id}${t.suffix}`, source: t.source, form: 'raw', screen: truth.screen, screenshot: `${cell.id}.png`, truth: `${cell.id}.truth.json` });
    }
    captured.add(cell.id);
  }
  const order = (file: string) => opts.catalog.findIndex((c) => file.startsWith(`${c.id}.`));
  const kept = (previous?.captures ?? []).filter((c) => !captured.has(c.file.slice(0, c.file.indexOf('.'))));
  manifest.captures = [...kept, ...manifest.captures].sort((a, b) => order(a.file) - order(b.file));
  await writeFile(join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { broken, skipped, manifest };
}

/**
 * Relaunch the cell, run `first` when given (LabDevice.hideKeyboard), tap the frame's centre (or the point given), give
 * the app 1 s to log — the events the tap produced, the launch's and `first`'s own left out.
 */
async function probe(lab: LabDevice, cell: string, where: Rect | { x: number; y: number }, first?: () => Promise<void>): Promise<{ events: ReturnType<typeof probeEvents>; after: LabState | undefined }> {
  const launched = await lab.launch(cell);
  // Something done before the tap (LabDevice.hideKeyboard): the events it made are left out, as the launch's are.
  if (first !== undefined) await first();
  const before = first === undefined ? launched.events.length : (await lab.state())!.events.length;
  const at = 'width' in where ? probePoint(where) : where;
  await lab.tap(at.x, at.y);
  await new Promise((r) => setTimeout(r, 1_000));
  const after = await lab.state();
  return { events: probeEvents(after, before), after };
}

const described = (probe: readonly { kind: string; tag: string }[]) => (probe.length ? `, probe ${probe.map((e) => `${e.kind} ${e.tag}`).join('; ')}` : '');

async function formTruth(lab: LabDevice, cell: CatalogCell, form: CatalogForm, s: LabState, png: PNG, broken: string[], log: (line: string) => void, afterBack?: LabState, panels: Rect[] = []): Promise<FormTruth> {
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
      id: f.fieldId ?? `lab.${cell.id}.${f.tag}`,
      kind: f.kind,
      title: f.title,
      titleId: f.titleId ?? `lab.${cell.id}.${f.tag}.title`,
      frame: frameOf(f.tag),
      ...st,
      ...(st.error !== null && { errorFrame: frameOf(`${f.tag}.error`) }),
      ...(s.frames[`${f.tag}.title`] !== undefined && { titleFrame: s.frames[`${f.tag}.title`] }),
    };
  });
  const wanted: { tag: string; id: string; kind: ControlTruth['kind']; inSheet: boolean; frame: string }[] = [
    ...form.fields.map((f) => ({ tag: f.tag, id: f.fieldId ?? `lab.${cell.id}.${f.tag}`, kind: 'field' as const, inSheet: false, frame: f.tag })),
    { tag: form.submit.tag, id: `lab.${cell.id}.${form.submit.tag}`, kind: 'button', inSheet: false, frame: form.submit.tag },
    ...(form.picker?.open === true ? form.picker.probe ?? [] : []).map((code) => ({
      tag: `${form.picker!.field}.${code}`,
      id: `lab.${cell.id}.${form.picker!.field}.${code}`,
      kind: 'row' as const,
      inSheet: true,
      frame: `row.${code}`,
    })),
  ];
  // The pinned submit's bar is what situationOf reads as its cover: a state without it would measure every control
  // under it open.
  if (form.submit.pinned === true) frameOf(`${form.submit.tag}.bar`);
  const keyboard = s.keyboard?.visible === true ? s.keyboard : undefined;
  const controls: ControlTruth[] = [];
  for (const w of wanted) {
    const frame = s.frames[w.frame];
    const situation = situationOf(frame, s, form, w, panels);
    // One probe of this control (probe, then readControlProbe): relaunch, `first` when given, a raw tap at `where`.
    const field = form.fields.find((f) => f.tag === w.tag);
    const probeControl = async (where: Rect | { x: number; y: number }, first?: () => Promise<void>) => {
      const { events, after } = await probe(lab, cell.id, where, first);
      return readControlProbe(events, w, field, after?.focus);
    };
    let read: { reached: boolean; probe: ControlTruth['probe'] } = { reached: false, probe: [] };
    if (frame !== undefined && situation !== 'off-screen' && situation !== 'not-rendered') read = await probeControl(frame);
    // What the screen shows over a control laid under the keyboard: the colour a pixel assert there would measure.
    const seen = frame !== undefined && situation === 'under-keyboard' ? measure(png, frame, s.scale, '#000000').seen : undefined;
    // Android: what averi's tap guard does with a control under the IME — hide it (back), then tap — probed too.
    const hide = lab.hideKeyboard === undefined ? undefined : () => lab.hideKeyboard!();
    let back: ControlTruth['afterBack'];
    if (frame !== undefined && situation === 'under-keyboard' && hide !== undefined) {
      back = await probeControl(frame, hide);
      // Not reached at its centre after back: a probe, after back, at its piece of the layout then (truth.ts
      // #pieceAfterBack).
      const backFrame = afterBack?.frames[w.frame];
      const piece = !back.reached && backFrame !== undefined && afterBack !== undefined ? pieceAfterBack(backFrame, afterBack, form, w) : null;
      if (piece !== null) back.piece = { piece, reached: (await probeControl(piece, hide)).reached };
    }
    // A covered control: a second probe at the centre of its piece clear of the keyboard and the pinned submit, when
    // that is not its frame's — where a tap moved off the cover would land.
    const piece = frame !== undefined && situation === 'covered' ? controlPiece(frame, s, form, w, panels) : null;
    const second = frame === undefined ? undefined : pieceProbePoint(frame, piece);
    const atPiece = second === undefined ? undefined : { piece: piece!, reached: (await probeControl(second)).reached };
    const c: ControlTruth = {
      tag: w.tag,
      id: w.id,
      kind: w.kind,
      ...(frame !== undefined && { frame }),
      situation,
      ...read,
      ...(seen !== undefined && { seen }),
      ...(back !== undefined && { afterBack: back }),
      ...(atPiece !== undefined && { atPiece }),
    };
    controls.push(c);
    const bad = controlConsistency(c, outOfProcessKeyboard(lab.platform, keyboard?.frame, panels));
    if (bad !== undefined) broken.push(`${cell.id}/${w.tag}: ${bad}`);
    log(`${cell.id}/${w.tag}: ${situation}, reached ${c.reached}${back === undefined ? '' : ` (after back ${back.reached}${described(back.probe)})`}${back?.piece === undefined ? '' : ` (after back at its piece ${back.piece.reached})`}${atPiece === undefined ? '' : ` (at its piece ${atPiece.reached})`}${described(c.probe)}`);
  }
  // The principal title a keyboard dismissal taps (CatalogForm.titleId): probed — a tap on it must end the editing.
  let title: FormTruth['title'];
  if (form.titleId !== undefined && s.frames.title !== undefined) {
    const { events } = await probe(lab, cell.id, s.frames.title);
    title = { id: form.titleId, frame: s.frames.title, ...readDismissalProbe(events) };
    if (!title.reached) broken.push(`${cell.id}/title: a raw tap on the title did not end the editing — no dismissal to judge`);
    log(`${cell.id}/title: reached ${title.reached}${described(title.probe)}`);
  }
  const screenError = form.screenError !== undefined && s.frames.screenError !== undefined ? { ...form.screenError, frame: s.frames.screenError } : null;
  return {
    fields,
    controls,
    keyboard: keyboard === undefined ? null : { frame: keyboard.frame, field: keyboard.field, ...(panels.length > 0 && { panels }) },
    screenError,
    submits: (s.submits ?? []).map((x) => ({ valid: x.valid })),
    ...(form.picker?.open === true && s.frames.sheet !== undefined && { sheet: s.frames.sheet }),
    ...(title !== undefined && { title }),
  };
}

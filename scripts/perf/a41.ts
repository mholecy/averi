import { median } from './stats.js';

/**
 * The A41b/A41c probe's device-free arithmetic (docs/plans/2026-10-30-performance-backlog.md, rows A41b and A41c): what
 * scripts/perf/a41-probe.ts measures on the lab simulator is judged and summed here, so every rule is a unit test
 * (tests/perf/a41.test.ts) and the device run only records.
 *
 * - A41c's targets (hitTargetsOf): from the golden's `--json` (scripts/differential/golden.ts), every idb tap that says
 *   Tapped where the truth refuses — the false success claims — at the point averi struck (its `idb ui tap X Y`), and as
 *   controls the truly open taps that say Tapped in the same cells and in CONTROL_CELLS. A recording's file is
 *   `<run>/<cell>.idb.json`; an `ios-rn-…` run is the React Native lab app's.
 * - idb's hit test (parseDescribePoint, namedBy, hitVerdict): `idb ui describe-point X Y --json` names one element; it
 *   names the target by its id, or as an unidentified element inside the target's frame (a label within a button).
 *   A false-Tapped target is `sound` when no probe names it, a control `open` when every probe does; an error, or no
 *   probe, is `unproven`, never a verdict.
 * - The medians (spreadOf, baselineCell): a baseline scenario's first repeat carries a fresh server's one-time costs
 *   (scripts/perf/baseline.ts), so it is kept apart and the warm spread is over the ok repeats after it.
 * - The settle trace (encodeRects, classesOf, movedTrial, wrongSettle): tests/fixtures/d35-b11-settle.json's encoding —
 *   per id a token per read: `-` absent, `.` the class of the read before, `+` a rect not seen before, `(k)` its k-th
 *   rect again — and ADR 0040's wrong settle: a later read in the window has the id at another rect.
 * - The cadence judgement (cadenceJudgement): ADR 0040's rule for a value — measured, 0 wrong settles at the shorter
 *   cadence, every motion seen moving at least MOVING_PER_MOTION times (D35's ≥ 15 a motion).
 * - The summary (summaryLines): the A41b table and acceptance numbers, the cadence, the A41c counts; a part not measured
 *   is said MISSING, never a number.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

// ------------------------------------------------------------------------------------------------- the medians

export interface Spread {
  n: number;
  median: number;
  min: number;
  max: number;
}

/** n, the median and the range of the numbers; undefined for none. */
export const spreadOf = (xs: readonly number[]): Spread | undefined =>
  xs.length === 0 ? undefined : { n: xs.length, median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };

/** A baseline run as scripts/perf/baseline.ts writes it (the fields read here). */
export interface BaselineRunLike {
  repeat: number;
  status: string;
  wallMs: number;
}

/** A scenario under one source: its first repeat's wall clock (ok only), the warm spread after it, how many failed. */
export interface TableCell {
  first?: number;
  warm?: Spread;
  failed: number;
}

export function baselineCell(runs: readonly BaselineRunLike[]): TableCell {
  const ok = runs.filter((r) => r.status === 'ok');
  const first = ok.find((r) => r.repeat === 1)?.wallMs;
  const warm = spreadOf(ok.filter((r) => r.repeat > 1).map((r) => r.wallMs));
  return { ...(first !== undefined && { first }), ...(warm !== undefined && { warm }), failed: runs.length - ok.length };
}

// ---------------------------------------------------------------------------------------------- A41c: targets

export type LabAppKind = 'native' | 'react-native';

/** A target of the hit test: a false-Tapped idb tap (A41c's 15), or a truly open one as its control. */
export interface HitTarget {
  kind: 'false-tapped' | 'control';
  app: LabAppKind;
  cell: string;
  target: string;
  id: string;
  /** Where averi struck: the golden check's `idb ui tap X Y`. */
  point: Point;
  /** What the truth implies there (the golden's `says`). */
  says: string;
}

/** The golden's `--json` as read here (golden.ts#GoldenJson's results). */
export interface GoldenCheckLike {
  target: string;
  verb: string;
  kind: string;
  mismatch?: string;
  calls: readonly string[];
  says?: string;
}
export interface GoldenResultLike {
  recording: string;
  checks: readonly GoldenCheckLike[];
}

/** The cells probed as controls beside the false targets' own: blur-menu-unhidden's K and W, open under the menu. */
export const CONTROL_CELLS: readonly string[] = ['blur-menu-unhidden'];

const IDB_RECORDING = /^ios(-rn)?-[^/]+\/([a-z0-9-]+)\.idb\.json$/;
const IDB_TAP = /^idb ui tap (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/;

export function hitTargetsOf(results: readonly GoldenResultLike[], controlCells: readonly string[] = CONTROL_CELLS): HitTarget[] {
  const taps = results.flatMap((r) => {
    const m = IDB_RECORDING.exec(r.recording);
    if (m === null) return [];
    const [app, cell] = [m[1] === undefined ? ('native' as const) : ('react-native' as const), m[2]];
    return r.checks
      .filter((c) => c.verb === 'tap' && c.kind === 'Tapped')
      .map((c) => {
        const id = `lab.${cell}.${c.target}`;
        const call = c.calls.map((x) => IDB_TAP.exec(x)).find((x) => x !== null);
        if (call === undefined) throw new Error(`${id}: its golden check sent no idb ui tap`);
        const kind = c.mismatch === undefined ? ('control' as const) : ('false-tapped' as const);
        return { kind, app, cell, target: c.target, id, point: { x: Number(call[1]), y: Number(call[2]) }, says: c.says ?? '' };
      });
  });
  const falseCells = new Set(taps.filter((t) => t.kind === 'false-tapped').map((t) => t.cell));
  return [
    ...taps.filter((t) => t.kind === 'false-tapped'),
    ...taps.filter((t) => t.kind === 'control' && (falseCells.has(t.cell) || controlCells.includes(t.cell))),
  ];
}

// ------------------------------------------------------------------------------------------ A41c: the hit test

/** The element describe-point names: its type, label, id and frame (an empty string is none). */
export interface HitElement {
  type: string | null;
  label: string | null;
  id: string | null;
  frame: Rect | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const rectOf = (v: unknown): Rect | null => {
  const r = v as Partial<Rect> | null | undefined;
  return r != null && [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number') ? (r as Rect) : null;
};

/** `idb ui describe-point X Y --json`'s stdout: one element, as an object or a one-element list. */
export function parseDescribePoint(stdout: string): HitElement {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    throw new Error(`describe-point: not JSON: ${stdout.trim().slice(0, 200)}`);
  }
  const el = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;
  if (el === undefined || el === null || typeof el !== 'object') throw new Error(`describe-point: no element in ${stdout.trim().slice(0, 200)}`);
  return { type: text(el.type), label: text(el.AXLabel), id: text(el.AXUniqueId), frame: rectOf(el.frame) };
}

/** What a hit names: the target (its id), an unidentified element inside its frame, another element, or nothing (none, or the app). */
export type Named = 'target' | 'inside-target' | 'other' | 'nothing';
export const namesTarget = (n: Named): boolean => n === 'target' || n === 'inside-target';

const within = (a: Rect, b: Rect, slack = 0.5): boolean =>
  a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.width <= b.x + b.width + slack && a.y + a.height <= b.y + b.height + slack;

export function namedBy(hit: HitElement | undefined, target: { id: string; frame?: Rect }): Named {
  if (hit === undefined || hit.type === 'Application') return 'nothing';
  if (hit.id === target.id) return 'target';
  if (hit.id === null && hit.frame !== null && target.frame !== undefined && within(hit.frame, target.frame)) return 'inside-target';
  return 'other';
}

/** One describe-point: its latency, and what it named — or its error. */
export interface HitProbe {
  ms: number;
  named?: Named;
  hit?: HitElement;
  error?: string;
}

/** A target's probes: through the idb CLI and through averi's persistent idb helper (ADR 0032); or why not probed. */
export interface HitResult {
  target: HitTarget;
  /** The target's frame in a describe-all read just before (absent: not listed). */
  frame?: Rect;
  cli: HitProbe[];
  helper: HitProbe[];
  skipped?: string;
}

export type HitVerdict = 'sound' | 'unsound' | 'open' | 'false-refusal' | 'unproven';

export function hitVerdict(r: HitResult): HitVerdict {
  const probes = [...r.cli, ...r.helper];
  if (r.skipped !== undefined || probes.length === 0 || probes.some((p) => p.error !== undefined || p.named === undefined)) return 'unproven';
  const named = probes.map((p) => namesTarget(p.named!));
  if (r.target.kind === 'false-tapped') return named.some((n) => n) ? 'unsound' : 'sound';
  return named.every((n) => n) ? 'open' : 'false-refusal';
}

// -------------------------------------------------------------------------------------- A41b: the settle trace

/** A rect's key: equal keys iff equal rects. */
export const rectKey = (r: Rect): string => `${r.x},${r.y},${r.width},${r.height}`;

/** A tree node as a trace reads it (src/adapters/types.ts#UiNode's fields used here). */
export interface TraceNode {
  label: string | null;
  identifier: string | null;
  rect: Rect;
  children: readonly TraceNode[];
}

/**
 * What a trace keeps of one read: each `lab.*` identifier's rect, and — for a motion whose rows its source lists with
 * no identifier (sheet-long-list's) — `label:<text>` for an unidentified node whose label matches. The last node wins
 * on a duplicate (the d35 probe's rule).
 */
export function traceIds(tree: TraceNode, labels?: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (n: TraceNode): void => {
    if (n.identifier?.startsWith('lab.') === true) out[n.identifier] = rectKey(n.rect);
    else if (n.identifier === null && labels !== undefined && n.label !== null && labels.test(n.label)) out[`label:${n.label}`] = rectKey(n.rect);
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/** A time at 0.1 ms, as the d35 fixture keeps it. */
export const tenths = (ms: number): number => Math.round(ms * 10) / 10;

/** A trial of the settle trace (tests/fixtures/d35-b11-settle.json's shape): times in ms from the trigger's start. */
export interface Trial {
  motion: string;
  cell: string;
  trial: number;
  trigger: [number, number];
  /** Whether the app's own log saw the motion: null, this probe does not read it. */
  appMoved: boolean | null;
  reads: [number, number][];
  rects: Record<string, string>;
}

/** Per read, id → rect key (absent: not in that read), as the encoding's tokens per id. */
export function encodeRects(perRead: readonly Readonly<Record<string, string>>[]): Record<string, string> {
  const ids = [...new Set(perRead.flatMap((r) => Object.keys(r)))].sort();
  return Object.fromEntries(
    ids.map((id) => {
      const seen: string[] = [];
      let prev: number | undefined;
      const tokens = perRead.map((r) => {
        const key = r[id];
        if (key === undefined) return (prev = undefined), '-';
        let k = seen.indexOf(key);
        const fresh = k === -1;
        if (fresh) k = seen.push(key) - 1;
        const token = fresh ? '+' : k === prev ? '.' : `(${k})`;
        prev = k;
        return token;
      });
      return [id, tokens.join('')];
    }),
  );
}

/** Per read, per id: its rect's equality class (absent: not in that read). */
export function classesOf(t: Pick<Trial, 'reads' | 'rects'>): Record<string, number>[] {
  const out = t.reads.map((): Record<string, number> => ({}));
  for (const [id, s] of Object.entries(t.rects)) {
    const tokens = s.match(/\(\d+\)|[-.+]/g) ?? [];
    if (tokens.join('') !== s || tokens.length !== t.reads.length) throw new Error(`${id}: ${tokens.length} tokens for ${t.reads.length} reads (${s})`);
    let next = 0;
    let cur: number | undefined;
    tokens.forEach((c, k) => {
      if (c === '-') cur = undefined;
      else if (c === '+') cur = next++;
      else if (c !== '.') cur = Number(c.slice(1, -1));
      if (cur !== undefined) out[k][id] = cur;
    });
  }
  return out;
}

/** A trial moved: some id held two rects in its window. */
export const movedTrial = (t: Pick<Trial, 'reads' | 'rects'>): boolean => {
  const classes = classesOf(t);
  return Object.keys(t.rects).some((id) => new Set(classes.map((c) => c[id]).filter((c) => c !== undefined)).size > 1);
};

/** ADR 0040's wrong settle: id settled at read k, and a later read has it present at another rect. */
export const wrongSettle = (classes: readonly Record<string, number>[], id: string, k: number): boolean =>
  classes.slice(k + 1).some((c) => c[id] !== undefined && c[id] !== classes[k][id]);

// --------------------------------------------------------------------------------- A41b: the cadence judgement

/** D35's rule: a motion counts only when seen moving at least this many times. */
export const MOVING_PER_MOTION = 15;

/** A replay of the trace at one cadence: settles per motion, the wrong ones (`<motion>#<trial> <id> @<read>`). */
export interface CadencePass {
  pollMs: number;
  settles: Record<string, number>;
  wrong: string[];
}

export interface CadenceJudgement {
  verdict: 'shorten' | 'keep' | 'unproven';
  why: string;
}

const sumOf = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const perMotionText = (r: Record<string, number>): string =>
  Object.entries(r)
    .map(([m, n]) => `${m} ${n}`)
    .join(', ');

export function cadenceJudgement(o: { trials: readonly { motion: string; moved: boolean }[]; at300: CadencePass }): CadenceJudgement {
  const moving: Record<string, number> = {};
  for (const t of o.trials) moving[t.motion] = (moving[t.motion] ?? 0) + (t.moved ? 1 : 0);
  const said = perMotionText(moving);
  if (o.trials.length === 0) return { verdict: 'unproven', why: 'no trial recorded' };
  if (Object.values(moving).some((n) => n < MOVING_PER_MOTION)) return { verdict: 'unproven', why: `a motion seen moving fewer than ${MOVING_PER_MOTION} times: ${said}` };
  const settles = sumOf(o.at300.settles);
  if (settles === 0) return { verdict: 'unproven', why: `no settle at 300 ms in the window; moving trials ${said}` };
  if (o.at300.wrong.length > 0) return { verdict: 'keep', why: `${o.at300.wrong.length} wrong settles in ${settles} at 300 ms (${o.at300.wrong.join('; ')})` };
  return { verdict: 'shorten', why: `0 wrong settles in ${settles} at 300 ms; moving trials ${said}` };
}

// ----------------------------------------------------------------------------------------------- the report

/** A hit-test row as the report keeps it. */
export interface HitRow {
  kind: HitTarget['kind'];
  id: string;
  point: Point;
  verdict: HitVerdict;
  /** What each probe named (CLI then helper): the element's id, or its type and label. */
  named: string[];
  cliMs?: number;
  helperMs?: number;
  skipped?: string;
}

export interface A41Report {
  meta: { commit?: string; device?: string; generated: string };
  /** The parts not found or not readable (their files), each said in the summary. */
  missing: string[];
  table: { scenario: string; idb: TableCell; wda: TableCell }[];
  wdaCold?: { coldRead?: Spread; warmRead?: Spread; failed: number };
  autoTap?: { firstCold?: Spread; firstWdaUp?: Spread; warm?: Spread; fellBack: number; failed: number };
  cadence?: { trials: number; moving: Record<string, number>; passes: CadencePass[]; judgement: CadenceJudgement };
  hitTest?: {
    rows: HitRow[];
    counts: { falseTapped: number; sound: number; unsound: number; unprovenFalse: number; controls: number; open: number; falseRefusal: number; unprovenControls: number };
    cli?: Spread;
    helper?: Spread;
  };
}

const ms = (n: number): string => `${Math.round(n)} ms`;
const spreadText = (s: Spread): string => `${ms(s.median)} (n ${s.n}, ${Math.round(s.min)}–${Math.round(s.max)})`;

function cellText(c: TableCell): string {
  const extras = [...(c.first !== undefined ? [`first ${Math.round(c.first)}`] : []), ...(c.failed > 0 ? [`${c.failed} failed`] : [])];
  if (c.warm === undefined) return `— (${extras.join('; ') || 'no run'})`;
  const head = `${ms(c.warm.median)} (n ${c.warm.n}, ${Math.round(c.warm.min)}–${Math.round(c.warm.max)}`;
  return `${head}${extras.length > 0 ? `; ${extras.join('; ')}` : ''})`;
}

const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n))} ms`;
const deltaOf = (row: A41Report['table'][number]): number | undefined =>
  row.idb.warm === undefined || row.wda.warm === undefined ? undefined : row.wda.warm.median - row.idb.warm.median;

export function summaryLines(r: A41Report): string[] {
  const lines = [`A41 probe — ${r.meta.device ?? 'device not read'} — commit ${r.meta.commit?.slice(0, 8) ?? '?'} — ${r.meta.generated}`];
  if (r.missing.length > 0) lines.push(`MISSING: ${r.missing.join(', ')}`);
  lines.push('', 'A41b — idb vs WDA, one session per source (warm median, n, range; first = the first repeat)');
  for (const row of r.table) {
    const d = deltaOf(row);
    lines.push(`${row.scenario} | idb ${cellText(row.idb)} | wda ${cellText(row.wda)} | wda−idb ${d === undefined ? '—' : signed(d)}`);
  }
  if (r.wdaCold === undefined) lines.push('WDA cold start: not measured');
  else {
    const c = r.wdaCold;
    lines.push(`WDA cold start, first read: ${c.coldRead === undefined ? '—' : spreadText(c.coldRead)}; the read after it: ${c.warmRead === undefined ? '—' : spreadText(c.warmRead)}${c.failed > 0 ? `; ${c.failed} failed` : ''}`);
  }
  if (r.autoTap === undefined) lines.push('auto, first tap after launch_app: not measured');
  else {
    const a = r.autoTap;
    const s = (x: Spread | undefined) => (x === undefined ? '—' : spreadText(x));
    lines.push(`auto, first tap after launch_app (WDA stopped): ${s(a.firstCold)}; after a relaunch, WDA up: ${s(a.firstWdaUp)}; warm tap: ${s(a.warm)}${a.fellBack > 0 ? `; ${a.fellBack} fell back to idb` : ''}${a.failed > 0 ? `; ${a.failed} failed` : ''}`);
  }
  lines.push('', 'A41b acceptance (current main: the numbers before any pre-warm)');
  const tapRow = r.table.find((x) => x.scenario === 'tap');
  const tapDelta = tapRow === undefined ? undefined : deltaOf(tapRow);
  lines.push(`WDA tap median within 100 ms of idb: ${tapDelta === undefined ? 'not measured' : `${Math.abs(tapDelta) <= 100 ? 'yes' : 'no'} (${signed(tapDelta)})`}`);
  const first = r.autoTap?.firstCold;
  const warm = r.autoTap?.warm;
  lines.push(
    `first tap after launch_app ≤ warm tap + 500 ms: ${
      first === undefined || warm === undefined ? 'not measured' : `${first.median <= warm.median + 500 ? 'yes' : 'no'} (${Math.round(first.median)} vs ${Math.round(warm.median)} + 500)`
    }`,
  );
  lines.push('', "A41b cadence — WDA's settle replayed at 300 ms against its 500 (ADR 0040)");
  if (r.cadence === undefined) lines.push('cadence: not measured');
  else {
    lines.push(`trials: ${r.cadence.trials}; seen moving: ${perMotionText(r.cadence.moving)}`);
    for (const p of r.cadence.passes) lines.push(`wrong settles at ${p.pollMs} ms: ${p.wrong.length} in ${sumOf(p.settles)} settles (${perMotionText(p.settles)})${p.wrong.length > 0 ? ` — ${p.wrong.join('; ')}` : ''}`);
    lines.push(`cadence: ${r.cadence.judgement.verdict} — ${r.cadence.judgement.why}`);
  }
  lines.push('', 'A41c — idb ui describe-point at the stroke point');
  if (r.hitTest === undefined) lines.push('A41c: not measured');
  else {
    const c = r.hitTest.counts;
    lines.push(`false-Tapped targets: ${c.falseTapped} — sound ${c.sound}, unsound ${c.unsound}, unproven ${c.unprovenFalse}`);
    lines.push(`controls (truly open): ${c.controls} — open ${c.open}, false refusals ${c.falseRefusal}, unproven ${c.unprovenControls}`);
    const lat = (x: Spread | undefined) => (x === undefined ? '—' : `${ms(x.median)} (n ${x.n})`);
    lines.push(`describe-point latency: CLI ${lat(r.hitTest.cli)}, helper ${lat(r.hitTest.helper)}`);
    for (const row of r.hitTest.rows) {
      lines.push(`  ${row.verdict.padEnd(13)} ${row.kind.padEnd(12)} ${row.id} at ${row.point.x},${row.point.y}: ${row.skipped ?? row.named.join(' | ')}`);
    }
  }
  return lines;
}

// ------------------------------------------------------------------------------------------- the files summed

/** The A41b table's scenarios: scripts/perf/baseline.ts's ids, in the row's order. */
export const A41B_SCENARIOS = ['tree', 'tap', 'fill', 'scroll', 'ensure-cold', 'ensure-warm'] as const;

/** A probe file's meta, as a41-probe.ts and baseline.ts write it (the fields read here). */
interface MetaLike {
  described?: string;
  commit?: { head?: string };
}
/** A timed tool call as a41-probe.ts writes it. */
export interface StepLike {
  ms: number;
  ok: boolean;
  reply: string;
  fellBack?: true;
}

/** The probe's files, as read (absent: missing — said in `missing`). */
export interface A41Parts {
  baselineIdb?: { meta?: MetaLike; scenarios: { id: string; runs: BaselineRunLike[] }[] };
  baselineWda?: { meta?: MetaLike; scenarios: { id: string; runs: BaselineRunLike[] }[] };
  wdaCold?: { meta?: MetaLike; runs: { repeat: number; cold?: StepLike; warm?: StepLike; error?: string }[] };
  autoTap?: {
    meta?: MetaLike;
    runs: { repeat: number; launch?: StepLike; firstCold?: StepLike; warm: StepLike[]; relaunch?: StepLike; firstWdaUp?: StepLike; error?: string }[];
  };
  hitTest?: { meta?: MetaLike; helperReady: boolean; results: HitResult[] };
  /** The trace and its replays (a41-settle.ts#replaySettles at each cadence). */
  cadence?: { meta?: MetaLike; trials: Trial[]; passes: CadencePass[] };
}

const okMs = (steps: readonly (StepLike | undefined)[]): Spread | undefined => spreadOf(steps.filter((s): s is StepLike => s?.ok === true).map((s) => s.ms));

const probeName = (path: string, p: HitProbe): string =>
  p.error !== undefined ? `${path} error: ${p.error}` : `${path} ${p.hit?.id ?? `${p.hit?.type ?? '?'} "${p.hit?.label ?? ''}"`}`;

function hitRow(r: HitResult): HitRow {
  const ms = (ps: readonly HitProbe[]) => spreadOf(ps.filter((p) => p.error === undefined).map((p) => p.ms))?.median;
  const [cliMs, helperMs] = [ms(r.cli), ms(r.helper)];
  return {
    kind: r.target.kind,
    id: r.target.id,
    point: r.target.point,
    verdict: hitVerdict(r),
    named: [...r.cli.map((p) => probeName('cli', p)), ...r.helper.map((p) => probeName('helper', p))],
    ...(cliMs !== undefined && { cliMs }),
    ...(helperMs !== undefined && { helperMs }),
    ...(r.skipped !== undefined && { skipped: r.skipped }),
  };
}

export function reportOf(p: A41Parts, missing: readonly string[], generated: string): A41Report {
  const metas = [p.baselineWda?.meta, p.baselineIdb?.meta, p.wdaCold?.meta, p.autoTap?.meta, p.hitTest?.meta, p.cadence?.meta];
  const commit = metas.find((m) => m?.commit?.head !== undefined)?.commit?.head;
  const device = metas.find((m) => m?.described !== undefined)?.described;
  const runsOf = (b: A41Parts['baselineIdb'], id: string) => b?.scenarios.find((s) => s.id === id)?.runs ?? [];
  const report: A41Report = {
    meta: { ...(commit !== undefined && { commit }), ...(device !== undefined && { device }), generated },
    missing: [...missing],
    table: A41B_SCENARIOS.map((scenario) => ({ scenario, idb: baselineCell(runsOf(p.baselineIdb, scenario)), wda: baselineCell(runsOf(p.baselineWda, scenario)) })),
  };
  if (p.wdaCold !== undefined) {
    const runs = p.wdaCold.runs;
    report.wdaCold = {
      ...spreadField('coldRead', okMs(runs.map((r) => r.cold))),
      ...spreadField('warmRead', okMs(runs.map((r) => r.warm))),
      failed: runs.filter((r) => r.error !== undefined || r.cold?.ok !== true).length,
    };
  }
  if (p.autoTap !== undefined) {
    const runs = p.autoTap.runs;
    const steps = (r: (typeof runs)[number]) => [r.launch, r.firstCold, ...r.warm, r.relaunch, r.firstWdaUp];
    report.autoTap = {
      ...spreadField('firstCold', okMs(runs.map((r) => r.firstCold))),
      ...spreadField('firstWdaUp', okMs(runs.map((r) => r.firstWdaUp))),
      ...spreadField('warm', okMs(runs.flatMap((r) => r.warm))),
      fellBack: runs.flatMap(steps).filter((s) => s?.fellBack === true).length,
      failed: runs.filter((r) => r.error !== undefined || steps(r).some((s) => s !== undefined && !s.ok)).length,
    };
  }
  if (p.cadence !== undefined) {
    const moving: Record<string, number> = {};
    const trials = p.cadence.trials.map((t) => ({ motion: t.motion, moved: movedTrial(t) }));
    for (const t of trials) moving[t.motion] = (moving[t.motion] ?? 0) + (t.moved ? 1 : 0);
    const at300 = p.cadence.passes.find((x) => x.pollMs === 300) ?? { pollMs: 300, settles: {}, wrong: [] };
    report.cadence = { trials: trials.length, moving, passes: p.cadence.passes, judgement: cadenceJudgement({ trials, at300 }) };
  }
  if (p.hitTest !== undefined) {
    const rows = p.hitTest.results.map(hitRow);
    const of = (kind: HitTarget['kind']) => rows.filter((r) => r.kind === kind);
    const count = (kind: HitTarget['kind'], v: HitVerdict) => of(kind).filter((r) => r.verdict === v).length;
    const latency = (path: 'cli' | 'helper') => spreadOf(p.hitTest!.results.flatMap((r) => r[path]).filter((x) => x.error === undefined).map((x) => x.ms));
    report.hitTest = {
      rows,
      counts: {
        falseTapped: of('false-tapped').length,
        sound: count('false-tapped', 'sound'),
        unsound: count('false-tapped', 'unsound'),
        unprovenFalse: count('false-tapped', 'unproven'),
        controls: of('control').length,
        open: count('control', 'open'),
        falseRefusal: count('control', 'false-refusal'),
        unprovenControls: count('control', 'unproven'),
      },
      ...spreadField('cli', latency('cli')),
      ...spreadField('helper', latency('helper')),
    };
  }
  return report;
}

/** `{ [name]: spread }`, or nothing when there is none (no key holding undefined). */
const spreadField = <K extends string>(name: K, s: Spread | undefined): Partial<Record<K, Spread>> => (s === undefined ? {} : ({ [name]: s } as Record<K, Spread>));

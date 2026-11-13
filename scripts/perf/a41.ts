import { median, type Spread } from './stats.js';

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
 *   cadence over at least JUDGED_MIN settles of ids that moved with CENSOR_MS of reads after them, every motion seen
 *   moving at least MOVING_PER_MOTION times (D35's ≥ 15 a motion).
 * - The cover (coverIdsOf, coverUp): a hit-test cell is probed only with its cover up — the lab's `ready` (the layer
 *   presented, its animation done) and every cover id its recorded idb capture lists (the blur menus list none: idb
 *   lists no presented layer, which is A41c's question).
 * - The children (A41_CHILDREN): each device run's file, mode and repeats — one table for the probe, the batch and the
 *   report.
 * - The summary (summaryLines): the A41b table and acceptance numbers, the cadence, the A41c counts; a part not measured
 *   is said MISSING, never a number; a required part read but not proven (unprovenOf: the cadence, legs (a) and (b)
 *   of the first tap, the foreground leg) is said UNPROVEN (A44, A41d).
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

/** stats.ts's median and range, with how many numbers they are of. */
export type CountedSpread = Spread & { n: number };

/** n, the median and the range of the numbers; undefined for none. */
export const spreadOf = (xs: readonly number[]): CountedSpread | undefined =>
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
  warm?: CountedSpread;
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
  /** The capture's run folder under tests/fixtures/truth (`ios-iphone17-ios27`): its idb capture names the cover. */
  run: string;
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

const IDB_RECORDING = /^(ios(-rn)?-[^/]+)\/([a-z0-9-]+)\.idb\.json$/;
const IDB_TAP = /^idb ui tap (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/;

export function hitTargetsOf(results: readonly GoldenResultLike[], controlCells: readonly string[] = CONTROL_CELLS): HitTarget[] {
  const taps = results.flatMap((r) => {
    const m = IDB_RECORDING.exec(r.recording);
    if (m === null) return [];
    const [run, app, cell] = [m[1], m[2] === undefined ? ('native' as const) : ('react-native' as const), m[3]];
    return r.checks
      .filter((c) => c.verb === 'tap' && c.kind === 'Tapped')
      .map((c) => {
        const id = `lab.${cell}.${c.target}`;
        const call = c.calls.map((x) => IDB_TAP.exec(x)).find((x) => x !== null);
        if (call === undefined) throw new Error(`${id}: its golden check sent no idb ui tap`);
        const kind = c.mismatch === undefined ? ('control' as const) : ('false-tapped' as const);
        return { kind, app, run, cell, target: c.target, id, point: { x: Number(call[1]), y: Number(call[2]) }, says: c.says ?? '' };
      });
  });
  const falseCells = new Set(taps.filter((t) => t.kind === 'false-tapped').map((t) => t.cell));
  return [
    ...taps.filter((t) => t.kind === 'false-tapped'),
    ...taps.filter((t) => t.kind === 'control' && (falseCells.has(t.cell) || controlCells.includes(t.cell))),
  ];
}

// --------------------------------------------------------------------------------------------- A41c: the cover

/** An element of an idb capture or describe-all, as read here. */
export interface IdbElementLike {
  AXUniqueId?: string | null;
  frame?: Rect;
}

/**
 * The cover ids a cell's recorded idb capture lists: its `lab.<cell>.*` ids that are no target (a target is one
 * capital letter) — rn-banner's `T.cover`, scroll-bounded-footer's `continue`. The blur menus list none.
 */
export const coverIdsOf = (capture: readonly IdbElementLike[], cell: string): string[] =>
  capture
    .map((e) => e.AXUniqueId)
    .filter((id): id is string => typeof id === 'string' && id.startsWith(`lab.${cell}.`) && !/^[A-Z]$/.test(id.slice(`lab.${cell}.`.length)));

/** The cover up: the lab said `ready` (its layer presented, the animation done) and describe-all lists every cover id. */
export function coverUp(o: { ready: boolean; listed: readonly IdbElementLike[]; coverIds: readonly string[] }): { up: boolean; how: string } {
  const listed = new Set(o.listed.map((e) => e.AXUniqueId));
  const missing = o.coverIds.filter((id) => !listed.has(id));
  if (!o.ready) return { up: false, how: 'the lab never said ready' };
  if (missing.length > 0) return { up: false, how: `describe-all lists no ${missing.join(', ')}` };
  return { up: true, how: o.coverIds.length === 0 ? 'ready (idb lists no cover here)' : `ready; ${o.coverIds.join(', ')} listed` };
}

/** How a cell whose cover is not up is said: its targets unproven, never sound or unsound. */
export const COVER_NOT_UP = 'unproven (cover not up)';

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

/**
 * What a hit names: the target (its id), an unidentified element inside its frame, another element, or nothing (none,
 * or the app).
 */
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
  return Object.keys(t.rects).some((id) => movedId(classes, id));
};

/** ADR 0040's wrong settle: id settled at read k, and a later read has it present at another rect. */
export const wrongSettle = (classes: readonly Record<string, number>[], id: string, k: number): boolean =>
  classes.slice(k + 1).some((c) => c[id] !== undefined && c[id] !== classes[k][id]);

// --------------------------------------------------------------------------------- A41b: the cadence judgement

/** D35's rule: a motion counts only when seen moving at least this many times. */
export const MOVING_PER_MOTION = 15;
/** The shorter cadence A41b asks about, then WDA's 500 before A41b (ADR 0040): the trace is replayed at each. */
export const CADENCES = [300, 500] as const;
/** A settle followed by less recorded time than this is censored: its wrongness is not observable. */
export const CENSOR_MS = 500;
/** A41b's "0 wrong in 60": the judged settles (of ids that moved, uncensored) a shorter cadence needs. */
export const JUDGED_MIN = 60;

/**
 * A replay of the trace at one cadence: settles per motion and the wrong ones (`<motion>#<trial> <id> @<read>`); of
 * them, the judged ones — an id that moved in its trial (a static id settles trivially and proves nothing) with
 * CENSOR_MS of reads after it (a later move could be seen) — and the wrong among those; the censored count.
 */
export interface CadencePass {
  pollMs: number;
  settles: Record<string, number>;
  wrong: string[];
  /** Of the settles: those of an id that moved in its trial. */
  moving: number;
  /** Of the settles: those with under CENSOR_MS of reads after the settled read. */
  censored: number;
  /** Of the settles: moving and not censored — what A41b's "N wrong in M" counts. */
  judged: number;
  /** Of the wrong ones: those judged. */
  wrongJudged: number;
}

/** An id that held two rects in its trial's window. */
export const movedId = (classes: readonly Record<string, number>[], id: string): boolean =>
  new Set(classes.map((c) => c[id]).filter((c) => c !== undefined)).size > 1;

/** Censored: the trial's last read ends under CENSOR_MS after read k ends. */
export const censoredAt = (reads: readonly [number, number][], k: number): boolean => reads[reads.length - 1][1] - reads[k][1] < CENSOR_MS;

/** Per motion, how many trials moved — counted once (movedTrial), for the judgement and the summary alike. */
export function movingTally(trials: readonly Pick<Trial, 'motion' | 'reads' | 'rects'>[]): Record<string, number> {
  const moving: Record<string, number> = {};
  for (const t of trials) moving[t.motion] = (moving[t.motion] ?? 0) + (movedTrial(t) ? 1 : 0);
  return moving;
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

/** A41b's line: the wrong judged settles over the judged ones, over the trials. */
export const judgedText = (p: CadencePass, trials: number): string =>
  `${p.wrongJudged} wrong in ${p.judged} moving, uncensored settles over ${trials} trials`;

/**
 * Shorten to the short cadence only on 0 wrong settles there over at least JUDGED_MIN judged ones, every motion seen
 * moving MOVING_PER_MOTION times; any wrong settle there keeps 500 (a wrong one is seen, censored or not).
 */
export function cadenceJudgement(o: { trials: number; moving: Record<string, number>; short: CadencePass }): CadenceJudgement {
  const said = perMotionText(o.moving);
  const p = o.short;
  if (o.trials === 0) return { verdict: 'unproven', why: 'no trial recorded' };
  if (Object.values(o.moving).some((n) => n < MOVING_PER_MOTION)) return { verdict: 'unproven', why: `a motion seen moving fewer than ${MOVING_PER_MOTION} times: ${said}` };
  if (p.wrong.length > 0) return { verdict: 'keep', why: `${p.wrong.length} wrong settles at ${p.pollMs} ms (${p.wrong.join('; ')})` };
  if (p.judged < JUDGED_MIN) {
    return { verdict: 'unproven', why: `${judgedText(p, o.trials)} at ${p.pollMs} ms: under ${JUDGED_MIN} judged; moving trials ${said}` };
  }
  return { verdict: 'shorten', why: `${judgedText(p, o.trials)} at ${p.pollMs} ms; moving trials ${said}` };
}

// --------------------------------------------------------------------------------------------- the children

/** A probe child: which block runs it, its file, its a41-probe.ts mode (none: baseline.ts), its repeats, its part. */
export interface ChildSpec {
  block: 'idb' | 'wda';
  file: string;
  mode?: ProbeMode;
  /** baseline.ts's `--repeat`; a probe mode's default `--repeat` (hit-test: describe-points per path). */
  repeat: number;
  /** Its key in A41Parts. */
  part: keyof A41Parts;
  /** Its last repeat launches with `clearState` (clearsStateOn): no child may run after it (tests/perf/a41.test.ts). */
  wipes?: true;
}
export const PROBE_MODES = ['hit-test', 'wda-cold', 'auto-tap', 'cadence'] as const;
export type ProbeMode = (typeof PROBE_MODES)[number];

/**
 * The device children, in their run order: the idb block's (baseline.ts with its first repeat kept apart, so 8 for a
 * warm n of 7; the hit test, 3 describe-points a path), then the WDA block's (baseline.ts first, so a WebDriverAgent
 * build is its cost alone; 5 fresh servers for the cold start; 20 trials a motion, D35's; 5 fresh servers for the auto
 * taps). auto-tap is last (A44): its `clearState` launch (clearsStateOn) wipes the lab app's data, and no later leg
 * may run on a wiped app — probe-2's cadence, after it, recorded no trial.
 */
export const A41_CHILDREN = {
  'baseline-idb': { block: 'idb', file: 'baseline-idb.json', repeat: 8, part: 'baselineIdb' },
  'hit-test': { block: 'idb', file: 'hit-test.json', mode: 'hit-test', repeat: 3, part: 'hitTest' },
  'baseline-wda': { block: 'wda', file: 'baseline-wda.json', repeat: 8, part: 'baselineWda' },
  'wda-cold': { block: 'wda', file: 'wda-cold.json', mode: 'wda-cold', repeat: 5, part: 'wdaCold' },
  cadence: { block: 'wda', file: 'cadence-trace.json', mode: 'cadence', repeat: 20, part: 'cadence' },
  'auto-tap': { block: 'wda', file: 'auto-tap.json', mode: 'auto-tap', repeat: 5, part: 'autoTap', wipes: true },
} as const satisfies Record<string, ChildSpec>;
export type A41ChildName = keyof typeof A41_CHILDREN;
export const A41_CHILD_NAMES = Object.keys(A41_CHILDREN) as A41ChildName[];

/** auto-tap's foreground leg wipes (`clearState`) on its last repeat only, so no session after it runs on a wiped app. */
export const clearsStateOn = (r: number, repeat: number): boolean => r === repeat;

/**
 * A probe run whose measurement is unproven exits so: scripts/truth/batch/standing.ts#STANDING_EXIT's `unproven`, the
 * same 3 (a test holds them equal). Not imported: standing.ts brings the batch runner and its processes into this
 * device-free leaf, whose only import is stats.ts.
 */
export const PROBE_UNPROVEN_EXIT = 3;
/** The cadence run's exit: unproven with no trial recorded (its file is still written, with its errors), else 0. */
export const cadenceExit = (trials: number): number => (trials === 0 ? PROBE_UNPROVEN_EXIT : 0);

/** A child's log beside its file (the batch writes `<name>.log`). */
export const childLog = (name: A41ChildName): string => `${name}.log`;

/** The WebDriverAgent build's line on averi's stderr (src/adapters/wda.ts): the run paid a build. */
export const WDA_BUILD_LINE = /first WDA build for this Xcode version/;

// ----------------------------------------------------------------------------------- the probe's records

/** One timed tool call and whether its reply claims what was asked; `fellBack`: an `auto` reply read through idb. */
export interface Step {
  ms: number;
  ok: boolean;
  reply: string;
  fellBack?: true;
}

export interface ColdRun {
  repeat: number;
  cold?: Step;
  warm?: Step;
  error?: string;
}

/**
 * How long after launch_app's reply the waited leg's first tap starts — WDA's cold start (3.1–3.6 s on the lab) and a
 * margin. From the reply, not the call. Set for A41b's pre-warm, which started WDA once `simctl launch` returned; since
 * A41d the launch brings WDA up before `simctl launch` (ADR 0046's A41d amendment), so WDA is up at the reply and the
 * leg is kept unchanged, comparable with probes 2 and 3.
 */
export const WAITED_GAP_MS = 4000;
/** The least gap after launch_app's reply leg (b) is judged on: a tap that started earlier is unproven. */
export const WAITED_GAP_MIN_MS = 3500;

/**
 * Leg (a)'s total before A41d, for information: launch_app 1 993 + the first tap 5 180 ms, probe-2 on 6f80d529, an idle
 * machine (docs/truth/live-records/a41-probe-2/). Not the bar: probe-3 measured the same total at 10 298 ms under load
 * (docs/truth/live-records/a41-probe-3/), so a fixed figure judges the machine. The bar is the same run's (legATotal).
 */
export const LEG_A_BEFORE_A41D_MS = 7173;

/**
 * A fresh `auto` session (A41b review r1): launch_app (WDA stopped; a `clearState` one on the first repeat), then the
 * first tree read at once (ui_snapshot) — which app it read: its root's label, and the bundle WDA's activeAppInfo names
 * after it. `expected`: the lab app's. Whether the app is in front after the launch (A41b: WDA's start ran beside the
 * launch's foreground wait; since A41d it is done before `simctl launch`).
 */
export interface ForegroundRun {
  clearState: boolean;
  expected: { label: string; bundle: string };
  launch?: Step;
  label?: string;
  bundle?: string;
  fellBack?: true;
  error?: string;
}

/** The app in front after the launch: the read's root label and WDA's active bundle are the lab's. */
export const foregroundOk = (f: ForegroundRun): boolean =>
  f.error === undefined && f.label === f.expected.label && f.bundle === f.expected.bundle;

/**
 * The root's label of a ui_snapshot reply — its JSON first (mcp/tools.ts#snapshotJson, 2-space indent: the root's
 * closing brace is the first at column 0), then any note; undefined for an error, an unreadable reply or no label.
 */
export function snapshotRootLabel(reply: string): string | undefined {
  const end = reply.indexOf('\n}');
  if (reply.startsWith('ERROR') || end < 0) return undefined;
  try {
    const label = (JSON.parse(reply.slice(0, end + 2)) as { label?: unknown }).label;
    return typeof label === 'string' ? label : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An `auto` session: launch_app (WDA stopped), the first tap (the catalog's `open`), the open cell waited for
 * (`openSettled`: listed in time — else the warm taps paid the push), two warm taps on its A; launch_app again and the
 * same first tap with WDA up; launch_app a third time, the catalog waited for (`catalogSettled`), and the same tap warm.
 * Then two more fresh sessions (A41b review r1): the waited leg — launch_app, an untimed wait of WAITED_GAP_MS after
 * it replied (no tree read), the same first tap (`firstWaited`; `waitedGapMs`, the time from launch_app's reply to the
 * tap's) — and `foreground` (ForegroundRun).
 */
export interface AutoRun {
  repeat: number;
  launch?: Step;
  firstCold?: Step;
  openSettled?: boolean;
  warm: Step[];
  relaunch?: Step;
  firstWdaUp?: Step;
  catalogSettled?: boolean;
  warmCatalog?: Step;
  error?: string;
  waitedLaunch?: Step;
  waitedGapMs?: number;
  firstWaited?: Step;
  waitedError?: string;
  foreground?: ForegroundRun;
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
  /** Which rule decided each probe, in the same order (namedBy's word; `error` for a probe that failed). */
  rules: (Named | 'error')[];
  cliMs?: number;
  helperMs?: number;
  skipped?: string;
}

export interface A41Report {
  meta: { commit?: string; device?: string; generated: string };
  /** The parts not found or not readable (their files), each said in the summary. */
  missing: string[];
  /**
   * The required parts read but not proven (unprovenOf, A44): the cadence judgement, leg (b) of the first tap and the
   * foreground leg. The batch's report block is INCONCLUSIVE on any, as on a missing file.
   */
  unproven: string[];
  /** Whether a WebDriverAgent build ran (WDA_BUILD_LINE in a WDA child's log); undefined: no log read. */
  wdaBuilt?: boolean;
  table: { scenario: string; idb: TableCell; wda: TableCell }[];
  wdaCold?: { coldRead?: CountedSpread; warmRead?: CountedSpread; failed: number };
  autoTap?: {
    launch?: CountedSpread;
    relaunch?: CountedSpread;
    firstCold?: CountedSpread;
    firstWdaUp?: CountedSpread;
    warmCatalog?: CountedSpread;
    warm?: CountedSpread;
    /** The waited leg's first tap (WDA's own), and the gap it had from the adapter's creation. */
    firstWaited?: CountedSpread;
    waitedGap?: CountedSpread;
    /** Leg (a), per session: launch_app (WDA stopped) + the first tap after it, both ok and WDA's (A41d). */
    firstTotal?: CountedSpread;
    /** The waited leg's launch_app (WDA stopped; since A41d WDA's bring-up is inside it): its spread, and per repeat. */
    waitedLaunch?: CountedSpread;
    waitedLaunches: { repeat: number; ms: number }[];
    /** The first taps that claimed the catalog's `open` (the app in front), of those made: each leg. */
    firstTaps: { ok: number; n: number };
    waitedTaps: { ok: number; n: number };
    /** The first read after a launch named the lab app (foregroundOk), of the launches made; how many wiped. */
    foreground: { ok: number; n: number; clearState: number; seen: string[] };
    fellBack: number;
    /** Warm taps left out: their open cell was not seen settled (they paid the push). */
    paidPush: number;
    /** Warm catalog taps left out: the catalog was not seen settled. */
    catalogUnsettled: number;
    failed: number;
  };
  cadence?: { trials: number; moving: Record<string, number>; passes: CadencePass[]; judgement: CadenceJudgement };
  hitTest?: {
    rows: HitRow[];
    counts: { falseTapped: number; sound: number; unsound: number; unprovenFalse: number; controls: number; open: number; falseRefusal: number; unprovenControls: number };
    cli?: CountedSpread;
    helper?: CountedSpread;
  };
}

const ms = (n: number): string => `${Math.round(n)} ms`;
const spreadText = (s: CountedSpread, extras: readonly string[] = []): string =>
  `${ms(s.median)} (n ${s.n}, ${Math.round(s.min)}–${Math.round(s.max)}${extras.map((e) => `; ${e}`).join('')})`;
const orDash = (s: CountedSpread | undefined): string => (s === undefined ? '—' : spreadText(s));

function cellText(c: TableCell): string {
  const extras = [...(c.first !== undefined ? [`first ${Math.round(c.first)}`] : []), ...(c.failed > 0 ? [`${c.failed} failed`] : [])];
  return c.warm === undefined ? `— (${extras.join('; ') || 'no run'})` : spreadText(c.warm, extras);
}

const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n))} ms`;
const deltaOf = (row: A41Report['table'][number]): number | undefined =>
  row.idb.warm === undefined || row.wda.warm === undefined ? undefined : row.wda.warm.median - row.idb.warm.median;

function autoLines(a: NonNullable<A41Report['autoTap']>): string[] {
  const left = [
    ...(a.fellBack > 0 ? [`${a.fellBack} fell back to idb`] : []),
    ...(a.paidPush > 0 ? [`${a.paidPush} warm taps paid the push`] : []),
    ...(a.catalogUnsettled > 0 ? [`${a.catalogUnsettled} warm catalog taps on an unsettled catalog`] : []),
  ];
  const inTap = a.firstCold === undefined || a.firstWdaUp === undefined ? '—' : signed(a.firstCold.median - a.firstWdaUp.median);
  const inLaunch = a.launch === undefined || a.relaunch === undefined ? '—' : signed(a.launch.median - a.relaunch.median);
  return [
    `auto, launch_app: ${orDash(a.launch)} (WDA stopped); relaunch: ${orDash(a.relaunch)} (WDA up)`,
    `auto, the catalog's open tap — first after launch_app (WDA stopped): ${orDash(a.firstCold)}; first after a relaunch, WDA up: ${orDash(a.firstWdaUp)}; warm: ${orDash(a.warmCatalog)}`,
    `auto, warm tap on open.A (another target, for information): ${orDash(a.warm)}`,
    `auto, WDA's bring-up in launch_app (launch_app − relaunch): ${inLaunch}; in the first tap (first − first with WDA up): ${inTap}`,
    `auto, the waited leg's launch_app (WDA stopped): ${orDash(a.waitedLaunch)}`,
    `auto, the same first tap ${orDash(a.waitedGap)} after launch_app replied (no read before it): ${orDash(a.firstWaited)}`,
    ...(left.length > 0 || a.failed > 0 ? [`auto, left out: ${[...left, ...(a.failed > 0 ? [`${a.failed} sessions with a failed step`] : [])].join('; ')}`] : []),
  ];
}

const okOf = (c: { ok: number; n: number }): string => `${c.ok}/${c.n}`;

/**
 * The first tap after launch_app in two legs, each with how many first taps found the app in front: (a) as a session
 * runs — launch_app, then the tap at once — judged since A41d on the total (legATotal); (b) the tap WAITED_GAP_MS after
 * launch_app replied: `first ≤ warm + 500`, unproven when a gap was under WAITED_GAP_MIN_MS or a step fell back to idb
 * (not WDA's taps). Then whether every first read after a launch was the lab app.
 */
function firstTapLines(r: A41Report): string[] {
  const a = r.autoTap;
  if (a === undefined) return ['first tap after launch_app: not measured'];
  const legA = legATotal(a, r.wdaCold).words;
  const legB = waitedTapAnswer(a).words;
  const f = a.foreground;
  const front = f.n === 0 ? 'not measured' : `${f.ok === f.n && foregroundJudged(f) ? 'yes' : 'no'}`;
  return [
    `first tap after launch_app (a, at once) — launch_app + the first tap ≤ relaunch (WDA up) + WDA cold start + the first tap with WDA up + 500 ms: ${legA}; first tap ok ${okOf(a.firstTaps)}; before A41d ${LEG_A_BEFORE_A41D_MS} (probe-2, idle)`,
    `first tap after launch_app (b, ≥ ${WAITED_GAP_MIN_MS / 1000} s after it replied) ≤ the same tap warm + 500 ms: ${legB}; first tap ok ${okOf(a.waitedTaps)}`,
    `foreground after launch ok ${okOf(f)} (${f.clearState} clearState; n ≥ 5 with one: ${front})${f.seen.length > 0 ? ` — read instead: ${f.seen.join('; ')}` : ''}`,
  ];
}

/**
 * Leg (a) (A41d, ADR 0046's A41d amendment): the median of launch_app + the first tap, per session, against the same
 * run's parts of that path done one after another — launch_app with WDA up (`relaunch`), WDA's cold start (wda-cold's
 * first read) and the first tap with WDA up — + 500 ms. Since A41d launch_app awaits WDA's bring-up, so the total
 * should be those parts and no more; the 500 is leg (b)'s allowance (noise, and the cold read's own ~100 ms read).
 * Same-run parts, not a fixed figure: load moves them together (probe-3's total was 10 298 ms against probe-2's 7 173).
 * The bar is under the total before A41d in both recorded runs (probe-2 1 949 + 3 101 + 1 202 + 500 = 6 752 < 7 173;
 * probe-3 2 839 + 3 595 + 2 207 + 500 = 9 141 < 10 298), so a pass also says "no slower than before".
 * `unproven` when a step fell back to idb, `not-measured` without the total or a part; else yes or no.
 */
function legATotal(a: NonNullable<A41Report['autoTap']>, cold: A41Report['wdaCold']): LegAnswer {
  const [total, relaunch, coldRead, wdaUp] = [a.firstTotal, a.relaunch, cold?.coldRead, a.firstWdaUp];
  if (a.fellBack > 0) return fellBackAnswer(a.fellBack);
  if (total === undefined || relaunch === undefined || coldRead === undefined || wdaUp === undefined) return { state: 'not-measured', words: 'not measured' };
  const [t, parts] = [Math.round(total.median), [relaunch, coldRead, wdaUp].map((x) => Math.round(x.median))];
  const bar = parts.reduce((x, y) => x + y, 500);
  const state = t <= bar ? 'yes' : 'no';
  return { state, words: `${state} (${t} vs ${parts.join(' + ')} + 500 = ${bar})` };
}

const fellBackAnswer = (n: number): LegAnswer => ({ state: 'unproven', words: `unproven (${n} auto steps fell back to idb: not WDA's taps)` });

/** A leg's answer: yes or no measured; unproven or not measured, neither a measurement. */
interface LegAnswer {
  state: 'yes' | 'no' | 'unproven' | 'not-measured';
  /** The acceptance line's words after its colon (firstTapLines). */
  words: string;
}

/**
 * Leg (b), the waited first tap against the same tap warm + 500 ms: `unproven` when a step fell back to idb or a gap
 * was under WAITED_GAP_MIN_MS, `not-measured` without the waited tap, its warm tap or its gap; else yes or no.
 */
function waitedTapAnswer(a: NonNullable<A41Report['autoTap']>): LegAnswer {
  const [waited, warm, gap] = [a.firstWaited, a.warmCatalog, a.waitedGap];
  if (a.fellBack > 0) return fellBackAnswer(a.fellBack);
  if (waited === undefined || warm === undefined || gap === undefined) return { state: 'not-measured', words: 'not measured' };
  if (gap.min < WAITED_GAP_MIN_MS) {
    return { state: 'unproven', words: `unproven (a tap ${Math.round(gap.min)} ms after launch_app replied, under ${WAITED_GAP_MIN_MS})` };
  }
  const state = waited.median <= warm.median + 500 ? 'yes' : 'no';
  return { state, words: `${state} (${Math.round(waited.median)} vs ${Math.round(warm.median)} + 500)` };
}

/** The foreground leg is judged on at least 5 launches, one of them `clearState` (ADR 0046's acceptance). */
const foregroundJudged = (f: NonNullable<A41Report['autoTap']>['foreground']): boolean => f.n >= 5 && f.clearState >= 1;

/**
 * The required parts read but not proven (A44): the cadence's judgement `unproven`; leg (a) (A41d) or leg (b) of the
 * first tap unproven or not measured; the foreground leg on under 5 launches or none with `clearState` — each with its
 * why. A measured no (`keep`, a leg's `no`, a launch not in front) is proven. A part whose file is absent is
 * `missing`'s, not this — but leg (a) without wda-cold's cold start is not measured, and said here too.
 */
export function unprovenOf(r: Pick<A41Report, 'cadence' | 'autoTap' | 'wdaCold'>): string[] {
  const out: string[] = [];
  if (r.cadence?.judgement.verdict === 'unproven') out.push(`cadence (${r.cadence.judgement.why})`);
  if (r.autoTap === undefined) return out;
  const a = legATotal(r.autoTap, r.wdaCold);
  if (a.state === 'unproven' || a.state === 'not-measured') out.push(`first tap (a) (${a.words})`);
  const b = waitedTapAnswer(r.autoTap);
  if (b.state === 'unproven' || b.state === 'not-measured') out.push(`first tap (b) (${b.words})`);
  const f = r.autoTap.foreground;
  if (!foregroundJudged(f)) out.push(`foreground (${f.n} launches, ${f.clearState} clearState: n ≥ 5 with one needed)`);
  return out;
}

export function summaryLines(r: A41Report): string[] {
  const lines = [`A41 probe — ${r.meta.device ?? 'device not read'} — commit ${r.meta.commit?.slice(0, 8) ?? '?'} — ${r.meta.generated}`];
  if (r.missing.length > 0) lines.push(`MISSING: ${r.missing.join(', ')}`);
  if (r.unproven.length > 0) lines.push(`UNPROVEN: ${r.unproven.join('; ')}`);
  if (r.wdaBuilt === true) lines.push("WDA was built in this run: baseline-wda's first repeat and the run's length include the build");
  lines.push('', 'A41b — idb vs WDA, one session per source (warm median, n, range; first = the first repeat)');
  for (const row of r.table) {
    const d = deltaOf(row);
    lines.push(`${row.scenario} | idb ${cellText(row.idb)} | wda ${cellText(row.wda)} | wda−idb ${d === undefined ? '—' : signed(d)}`);
  }
  if (r.wdaCold === undefined) lines.push('WDA cold start: not measured');
  else {
    const c = r.wdaCold;
    lines.push(`WDA cold start, first read: ${orDash(c.coldRead)}; the read after it: ${orDash(c.warmRead)}${c.failed > 0 ? `; ${c.failed} failed` : ''}`);
  }
  if (r.autoTap === undefined) lines.push('auto, first tap after launch_app: not measured');
  else lines.push(...autoLines(r.autoTap));
  lines.push('', 'A41b acceptance');
  const tapRow = r.table.find((x) => x.scenario === 'tap');
  const tapDelta = tapRow === undefined ? undefined : deltaOf(tapRow);
  lines.push(
    `WDA tap median within 100 ms of idb's, one-sided (WDA no more than 100 ms slower; faster always passes): ${
      tapDelta === undefined ? 'not measured' : `${tapDelta <= 100 ? 'yes' : 'no'} (wda−idb ${signed(tapDelta)})`
    }`,
  );
  lines.push(...firstTapLines(r));
  lines.push('', `A41b cadence — WDA's settle replayed at ${CADENCES[0]} ms against its ${CADENCES[1]} (ADR 0040)`);
  if (r.cadence === undefined) lines.push('cadence: not measured');
  else {
    const c = r.cadence;
    lines.push(`trials: ${c.trials}; seen moving: ${perMotionText(c.moving)}`);
    for (const p of c.passes) {
      lines.push(
        `at ${p.pollMs} ms: ${judgedText(p, c.trials)} — of ${sumOf(p.settles)} settles (${perMotionText(p.settles)}), ${p.moving} of moving ids, ` +
          `${p.censored} censored (< ${CENSOR_MS} ms of reads after), ${p.wrong.length} wrong in all${p.wrong.length > 0 ? ` — ${p.wrong.join('; ')}` : ''}`,
      );
    }
    lines.push(`cadence: ${c.judgement.verdict} — ${c.judgement.why}`);
  }
  lines.push('', 'A41c — idb ui describe-point at the stroke point');
  if (r.hitTest === undefined) lines.push('A41c: not measured');
  else {
    const c = r.hitTest.counts;
    lines.push(`false-Tapped targets: ${c.falseTapped} — sound ${c.sound}, unsound ${c.unsound}, unproven ${c.unprovenFalse}`);
    lines.push(`controls (truly open): ${c.controls} — open ${c.open}, false refusals ${c.falseRefusal}, unproven ${c.unprovenControls}`);
    const lat = (x: CountedSpread | undefined) => (x === undefined ? '—' : `${ms(x.median)} (n ${x.n})`);
    lines.push(`describe-point latency: CLI ${lat(r.hitTest.cli)}, helper ${lat(r.hitTest.helper)}`);
    for (const row of r.hitTest.rows) {
      const said = row.skipped ?? row.named.map((n, i) => `${n} [${row.rules[i]}]`).join(' | ');
      lines.push(`  ${row.verdict.padEnd(13)} ${row.kind.padEnd(12)} ${row.id} at ${row.point.x},${row.point.y}: ${said}`);
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
interface BaselineLike {
  meta?: MetaLike;
  scenarios: { id: string; runs: BaselineRunLike[] }[];
}

/** The probe's files, as read (absent: missing — said in `missing`), in a41-probe.ts's own record types. */
export interface A41Parts {
  baselineIdb?: BaselineLike;
  baselineWda?: BaselineLike;
  wdaCold?: { meta?: MetaLike; runs: ColdRun[] };
  autoTap?: { meta?: MetaLike; runs: AutoRun[] };
  hitTest?: { meta?: MetaLike; helperReady: boolean; results: HitResult[] };
  /** The trace and its replays (a41-settle.ts#replaySettles at each of CADENCES). */
  cadence?: { meta?: MetaLike; trials: Trial[]; passes: CadencePass[] };
}

const okMs = (steps: readonly (Step | undefined)[]): CountedSpread | undefined =>
  spreadOf(steps.filter((s): s is Step => s?.ok === true).map((s) => s.ms));
/** WDA's own taps: ok, and not read through idb (an `auto` step that fell back is idb's, never WDA's). */
const wdaMs = (steps: readonly (Step | undefined)[]): CountedSpread | undefined => okMs(steps.filter((s) => s?.fellBack !== true));
/** One step ok and WDA's (wdaMs's rule). */
const wdaOk = (s: Step | undefined): s is Step => s?.ok === true && s.fellBack !== true;

const probeName = (path: string, p: HitProbe): string =>
  p.error !== undefined ? `${path} error: ${p.error}` : `${path} ${p.hit?.id ?? `${p.hit?.type ?? '?'} "${p.hit?.label ?? ''}"`}`;

function hitRow(r: HitResult): HitRow {
  const msOf = (ps: readonly HitProbe[]) => spreadOf(ps.filter((p) => p.error === undefined).map((p) => p.ms))?.median;
  const [cliMs, helperMs] = [msOf(r.cli), msOf(r.helper)];
  return {
    kind: r.target.kind,
    id: r.target.id,
    point: r.target.point,
    verdict: hitVerdict(r),
    named: [...r.cli.map((p) => probeName('cli', p)), ...r.helper.map((p) => probeName('helper', p))],
    // probeOnce gives a probe `named` or `error`, never both.
    rules: [...r.cli, ...r.helper].map((p) => p.named ?? 'error'),
    ...(cliMs !== undefined && { cliMs }),
    ...(helperMs !== undefined && { helperMs }),
    ...(r.skipped !== undefined && { skipped: r.skipped }),
  };
}

const tapsOk = (steps: readonly (Step | undefined)[]): { ok: number; n: number } => {
  const made = steps.filter((s): s is Step => s !== undefined);
  return { ok: made.filter((s) => s.ok).length, n: made.length };
};

function foregroundOf(runs: readonly AutoRun[]): NonNullable<A41Report['autoTap']>['foreground'] {
  const made = runs.flatMap((r) => (r.foreground === undefined ? [] : [r.foreground]));
  return {
    ok: made.filter(foregroundOk).length,
    n: made.length,
    clearState: made.filter((f) => f.clearState).length,
    seen: made.filter((f) => !foregroundOk(f)).map((f) => f.error ?? `${f.label ?? 'no label'} / ${f.bundle ?? 'no bundle'}${f.fellBack === true ? ' (idb)' : ''}`),
  };
}

function autoOf(runs: readonly AutoRun[]): NonNullable<A41Report['autoTap']> {
  const steps = (r: AutoRun) => [r.launch, r.firstCold, ...r.warm, r.relaunch, r.firstWdaUp, r.warmCatalog, r.waitedLaunch, r.firstWaited, r.foreground?.launch];
  const settledWarm = runs.filter((r) => r.openSettled === true).flatMap((r) => r.warm);
  const settledCatalog = runs.filter((r) => r.catalogSettled === true).map((r) => r.warmCatalog);
  return {
    ...spreadField('launch', okMs(runs.map((r) => r.launch))),
    ...spreadField('relaunch', okMs(runs.map((r) => r.relaunch))),
    ...spreadField('firstCold', wdaMs(runs.map((r) => r.firstCold))),
    ...spreadField('firstWdaUp', wdaMs(runs.map((r) => r.firstWdaUp))),
    ...spreadField('warmCatalog', wdaMs(settledCatalog)),
    ...spreadField('warm', wdaMs(settledWarm)),
    ...spreadField('firstWaited', wdaMs(runs.map((r) => r.firstWaited))),
    ...spreadField('waitedGap', spreadOf(runs.flatMap((r) => (r.waitedGapMs === undefined ? [] : [r.waitedGapMs])))),
    ...spreadField('firstTotal', spreadOf(runs.flatMap((r) => (wdaOk(r.launch) && wdaOk(r.firstCold) ? [r.launch.ms + r.firstCold.ms] : [])))),
    ...spreadField('waitedLaunch', okMs(runs.map((r) => r.waitedLaunch))),
    waitedLaunches: runs.flatMap((r) => (r.waitedLaunch?.ok === true ? [{ repeat: r.repeat, ms: r.waitedLaunch.ms }] : [])),
    firstTaps: tapsOk(runs.map((r) => r.firstCold)),
    waitedTaps: tapsOk(runs.map((r) => r.firstWaited)),
    foreground: foregroundOf(runs),
    fellBack: runs.flatMap(steps).filter((s) => s?.fellBack === true).length,
    paidPush: runs.filter((r) => r.openSettled === false).flatMap((r) => r.warm).length,
    catalogUnsettled: runs.filter((r) => r.catalogSettled === false && r.warmCatalog !== undefined).length,
    failed: runs.filter((r) => r.error !== undefined || r.waitedError !== undefined || steps(r).some((s) => s !== undefined && !s.ok)).length,
  };
}

function hitOf(h: NonNullable<A41Parts['hitTest']>): NonNullable<A41Report['hitTest']> {
  const rows = h.results.map(hitRow);
  const of = (kind: HitTarget['kind']) => rows.filter((r) => r.kind === kind);
  const count = (kind: HitTarget['kind'], v: HitVerdict) => of(kind).filter((r) => r.verdict === v).length;
  const latency = (path: 'cli' | 'helper') => spreadOf(h.results.flatMap((r) => r[path]).filter((x) => x.error === undefined).map((x) => x.ms));
  return {
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

const NO_PASS = (pollMs: number): CadencePass => ({ pollMs, settles: {}, wrong: [], moving: 0, censored: 0, judged: 0, wrongJudged: 0 });

/** The parts summed; `wdaBuilt` as read from the WDA children's logs (undefined: none read). */
export function reportOf(p: A41Parts, missing: readonly string[], generated: string, wdaBuilt?: boolean): A41Report {
  const metas = [p.baselineWda?.meta, p.baselineIdb?.meta, p.wdaCold?.meta, p.autoTap?.meta, p.hitTest?.meta, p.cadence?.meta];
  const commit = metas.find((m) => m?.commit?.head !== undefined)?.commit?.head;
  const device = metas.find((m) => m?.described !== undefined)?.described;
  const runsOf = (b: BaselineLike | undefined, id: string) => b?.scenarios.find((s) => s.id === id)?.runs ?? [];
  const report: A41Report = {
    meta: { ...(commit !== undefined && { commit }), ...(device !== undefined && { device }), generated },
    missing: [...missing],
    unproven: [],
    ...(wdaBuilt !== undefined && { wdaBuilt }),
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
  if (p.autoTap !== undefined) report.autoTap = autoOf(p.autoTap.runs);
  if (p.cadence !== undefined) {
    const { trials, passes } = p.cadence;
    const moving = movingTally(trials);
    const short = passes.find((x) => x.pollMs === CADENCES[0]) ?? NO_PASS(CADENCES[0]);
    report.cadence = { trials: trials.length, moving, passes, judgement: cadenceJudgement({ trials: trials.length, moving, short }) };
  }
  if (p.hitTest !== undefined) report.hitTest = hitOf(p.hitTest);
  report.unproven = unprovenOf(report);
  return report;
}

/** `{ [name]: spread }`, or nothing when there is none (no key holding undefined). */
const spreadField = <K extends string>(name: K, s: CountedSpread | undefined): Partial<Record<K, CountedSpread>> =>
  s === undefined ? {} : ({ [name]: s } as Record<K, CountedSpread>);

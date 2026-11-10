/**
 * The carousel group's device read (T16, ADR 0044's T16 amendment): raw strokes on the carousel with no averi, the
 * lab app's frames and the device's counters, read before the group's cases and after them, so the device's state —
 * fast, or the short carry T11 found by accident — is labelled in the record.
 */

import { loadavg } from 'node:os';
import { type AndroidLab, LAB_APP, pause } from './lab-device.js';
import type { Platform } from '../differential/corpus.js';
import { LAB_CAROUSEL, onMidLine, PRE_DRAG_PX, PRE_DRAG_SETTLE_MS, preDragStroke, RECYCLER_FREE } from './live-carousel.js';

/** One raw stroke's carry (px the app's carousel moved, from its state file) and how long its `input swipe` took. */
export interface RawStroke {
  carry: number;
  ms: number;
}

/** One round, as T11's raw/raw-strokes.mjs wrote a JSONL row: the pre-drag's carry and time, four strokes, the device's loadavg. */
export interface DeviceRound {
  pre: number;
  preMs: number;
  strokes: RawStroke[];
  load: string;
}

/** A carry at or under this, of a 142-px stroke, is short: the old line for lv-d62's 142-px probe (ADR 0013's T11 amendment). */
export const SHORT_CARRY_PX = 94;

export interface DeviceStateOf {
  state: 'short' | 'fast';
  /** Strokes at SHORT_CARRY_PX or less, of `strokes`. */
  short: number;
  strokes: number;
}

/**
 * The T11/T19 rule, exactly as its scripts read it (T11's final-ab/label-group.mjs, T12's label-group.mjs, T19's
 * analyze.mjs): every round's strokes pooled, short when one in four or more carried SHORT_CARRY_PX or less.
 */
export function stateOf(rounds: readonly DeviceRound[]): DeviceStateOf {
  const carries = rounds.flatMap((r) => r.strokes.map((s) => s.carry));
  const short = carries.filter((c) => c <= SHORT_CARRY_PX).length;
  return { state: short * 4 >= carries.length ? 'short' : 'fast', short, strokes: carries.length };
}

/** The lab app's frames over a read's last round (`dumpsys gfxinfo <package>`): rendered, janky, and two percentiles, ms. */
export interface Frames {
  total: number;
  janky: number;
  p50: number;
  p90: number;
}

/** One `dumpsys gfxinfo` line's number, the line read whole from its start (not `Janky frames (legacy)`, not a GPU percentile). */
const gfxNumber = (text: string, line: string): number | undefined => {
  const m = new RegExp(`^\\s*${line}: (\\d+)`, 'm').exec(text);
  return m === null ? undefined : Number(m[1]);
};

/** The frames `dumpsys gfxinfo <package>` printed, or undefined when any of its four lines is missing. */
export function parseGfxinfo(text: string): Frames | undefined {
  const total = gfxNumber(text, 'Total frames rendered');
  const janky = gfxNumber(text, 'Janky frames');
  const p50 = gfxNumber(text, '50th percentile');
  const p90 = gfxNumber(text, '90th percentile');
  if (total === undefined || janky === undefined || p50 === undefined || p90 === undefined) return undefined;
  return { total, janky, p50, p90 };
}

/** One read of the device: its rounds of raw strokes, the frames of the last round, the framework's start count, the host's load. */
export interface DeviceRead {
  /** When the read began (ISO). */
  t: string;
  rounds: DeviceRound[];
  /** Undefined when gfxinfo printed none of them (parseGfxinfo). */
  frames?: Frames;
  /** `sys.system_server.start_count`: a change between two reads is a framework restart (final-ab.sh's stamp). */
  startCount: string;
  /** The host's loadavg, 1, 5 and 15 minutes. */
  hostLoad: string;
}

/**
 * A run's label (RunRecord `deviceLabel`): the reads before the group's cases and after them, or why one is missing — a
 * read that failed (`error`, `before:` or `after:` and its words) leaves the run unlabelled, never aborted.
 */
export interface DeviceLabel {
  before?: DeviceRead;
  after?: DeviceRead;
  error?: string;
}

const restarted = (before: DeviceRead, after: DeviceRead): string =>
  before.startCount === after.startCount ? '' : `, framework restarted (start count ${before.startCount} → ${after.startCount})`;
const stateText = (read: DeviceRead): string => {
  const { state, short, strokes } = stateOf(read.rounds);
  return `${state} ${short}/${strokes}`;
};
const p50Text = (read: DeviceRead): string => (read.frames === undefined ? 'unread' : `${read.frames.p50} ms`);

/**
 * The summary's Device line: both states and the frames' p50, DISAGREE first when the states differ, a framework
 * restart between the reads (the start count changed, final-ab.sh's abort) last; unlabelled with why.
 */
export function deviceLine({ before, after, error }: DeviceLabel): string {
  const unlabelled = (why: string) => `Device: unlabelled — ${why}`;
  if (error !== undefined) return unlabelled(error);
  if (before === undefined) return unlabelled('no read before the cases');
  if (after === undefined) return unlabelled('no read after the cases');
  const disagree = stateOf(before.rounds).state !== stateOf(after.rounds).state;
  return `Device: ${disagree ? 'DISAGREE — ' : ''}before ${stateText(before)}, after ${stateText(after)} (frames p50 ${p50Text(before)} → ${p50Text(after)})${restarted(before, after)}`;
}

// --- the read: T11's raw/raw-strokes.mjs, on AndroidLab ---

/**
 * The raw stroke: lv-d62's first probe as averi draws it on the lab's clip, 142 px left along its mid-line from 80 %
 * of its width, 300 ms (raw-strokes.mjs's 824 → 682 at y 497).
 */
export const RAW_STROKE = { from: onMidLine(LAB_CAROUSEL, 0.8), to: onMidLine(LAB_CAROUSEL, 0.65), durationMs: 300 } as const;
/**
 * The wait after the launch, before the pre-drag: raw-strokes.mjs's `await sleep(1500)` after its `am start -W`. Kept
 * on top of AndroidLab.launch's settle on the app's ready, so that settle is a floor, never a shorter wait.
 */
export const LAUNCH_SETTLE_MS = 1_500;
/** Strokes per round, and the wait after each before its carry is read (raw-strokes.mjs). */
export const STROKES_PER_ROUND = 4;
export const STROKE_SETTLE_MS = 1_500;
/** Rounds per read: T19's (t19.sh `raw_read 4`); T11's final A/B read 6. */
export const DEFAULT_ROUNDS = 4;

/** What a read needs of the lab: AndroidLab's launch, raw stroke, state file and adb. */
export type DeviceLab = Pick<AndroidLab, 'app' | 'launch' | 'swipe' | 'state' | 'adb'>;

export interface ReadOptions {
  rounds?: number;
  wait?: (ms: number) => Promise<unknown>;
  /** The clock the strokes are timed by, ms. */
  now?: () => number;
  /** The host's loadavg: os.loadavg(), two decimals. */
  hostLoad?: () => string;
}

const hostLoadavg = (): string => loadavg().map((l) => l.toFixed(2)).join(' ');

/**
 * One read, as raw-strokes.mjs read a round, `rounds` times (one or more): a fresh launch of RECYCLER_FREE
 * (AndroidLab.launch, settled on the app's ready) and LAUNCH_SETTLE_MS, gfxinfo reset, the probes' 440-px pre-drag (live-carousel.ts's), then
 * STROKES_PER_ROUND raw strokes, each carry the carousel offset's change in the state file, and the device's loadavg.
 * Then the frames of the last round (its pre-drag and strokes), the framework's start count first. Throws on a state
 * file with no carousel offset after a stroke: no carry, no label.
 */
export async function readDevice(lab: DeviceLab, { rounds = DEFAULT_ROUNDS, wait = pause, now = Date.now, hostLoad = hostLoadavg }: ReadOptions = {}): Promise<DeviceRead> {
  if (rounds < 1) throw new Error(`a device read needs one round or more, not ${rounds}`);
  const pkg = LAB_APP[lab.app].package;
  const t = new Date(now()).toISOString();
  const shell = async (...args: string[]) => (await lab.adb('shell', ...args)).stdout.trim();
  const startCount = await shell('getprop', 'sys.system_server.start_count');
  const timed = async (stroke: () => Promise<void>) => {
    const start = now();
    await stroke();
    return now() - start;
  };
  const read: DeviceRound[] = [];
  for (let i = 1; i <= rounds; i++) {
    const offset = async () => {
      const at = (await lab.state())?.offsets?.carousel;
      if (at === undefined) throw new Error(`round ${i}: the lab app reported no carousel offset`);
      return at;
    };
    const launched = await lab.launch(RECYCLER_FREE);
    await wait(LAUNCH_SETTLE_MS);
    await shell('dumpsys', 'gfxinfo', pkg, 'reset');
    const pre = preDragStroke(LAB_CAROUSEL, PRE_DRAG_PX);
    const preMs = await timed(() => lab.swipe(pre.from, pre.to, pre.durationMs));
    await wait(PRE_DRAG_SETTLE_MS);
    const dragged = await offset();
    const strokes: RawStroke[] = [];
    let at = dragged;
    for (let n = 0; n < STROKES_PER_ROUND; n++) {
      const ms = await timed(() => lab.swipe(RAW_STROKE.from, RAW_STROKE.to, RAW_STROKE.durationMs));
      await wait(STROKE_SETTLE_MS);
      const next = await offset();
      strokes.push({ carry: next - at, ms });
      at = next;
    }
    read.push({ pre: dragged - (launched.offsets?.carousel ?? 0), preMs, strokes, load: await shell('cat', '/proc/loadavg') });
  }
  const frames = parseGfxinfo(await shell('dumpsys', 'gfxinfo', pkg));
  return { t, rounds: read, ...(frames !== undefined && { frames }), startCount, hostLoad: hostLoad() };
}

/** One read into the run's label: kept, or its failure as the label's error (`before: …`); nothing read after a failure. */
export async function readInto(label: DeviceLabel, side: 'before' | 'after', read: () => Promise<DeviceRead>): Promise<void> {
  if (label.error !== undefined) return;
  try {
    label[side] = await read();
  } catch (e) {
    label.error = `${side}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** `--device-read`'s one value: the run reads nothing, and its record says so (unlabelled). */
export const DEVICE_READ_NONE = 'none';

/**
 * The label a run starts with (live.ts): `{}` to be read when it is on Android with a carousel case among the cases
 * selected (not the `--groups` asked: `--cases` may leave none); `{ error }` when `--device-read none` opts out, so the
 * record still says unlabelled; undefined — nothing read, no Device line — for any other run. `deviceRead` is the
 * flag's value; any but `none` is refused.
 */
export function deviceLabelAtStart(platform: Platform, selected: readonly { group: string }[], deviceRead: string | undefined): DeviceLabel | undefined {
  if (deviceRead !== undefined && deviceRead !== DEVICE_READ_NONE) throw new Error(`--device-read: ${DEVICE_READ_NONE}, or leave it out (the carousel group reads the device), not "${deviceRead}"`);
  if (platform !== 'android' || !selected.some((c) => c.group === 'carousel')) return undefined;
  return deviceRead === DEVICE_READ_NONE ? { error: `not read (--device-read ${DEVICE_READ_NONE})` } : {};
}

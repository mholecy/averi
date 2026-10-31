/**
 * The arithmetic of the performance baseline (baseline.ts): what one measured tool call adds up to (`measure`), and what
 * N repeats of one scenario add up to (`summarize`). Pure — the recording itself is instrument.ts's — so it is tested
 * without a device (tests/perf/stats.test.ts).
 *
 * Two sums are kept for device time, because averi runs some device calls side by side (a tree read beside a keyboard
 * query, `Promise.all` of `defaults write`): `deviceMs` is what the calls cost added up — the work a D row could remove —
 * and `deviceBusyMs` the wall-clock time during which at least one was open, which is what the agent waited for.
 * Slept time is the same union over averi's sleeps (src/util/sleep.ts): the wall-clock time during which a sleep was
 * pending, so two sleeps that overlap are not counted twice against the call's wall clock.
 */

/** A process or HTTP request averi started during a measured call, on the harness's clock (performance.now()). */
export interface DeviceCall {
  /** `adb`, `simctl`, `idb`, `wda` (WebDriverAgent HTTP) — the device's — or `host`: a process that is not (the OCR recognizer, swiftc, lsof). */
  kind: string;
  /** The command with its device id dropped and its first words kept (`adb shell input text`), to group by. */
  label: string;
  startMs: number;
  endMs: number;
  ok: boolean;
  /** Still open when the window closed: ended there (Recorder.end). */
  pending?: true;
  /** Served by the persistent idb helper (D7a, src/adapters/idb-helper.ts), not an `idb` process. */
  via?: 'helper';
}

/** One `sleep(ms)` of src/util/sleep.ts: what it asked for, who asked (file:line of the caller), when it began and fired. */
export interface Sleep {
  ms: number;
  caller: string;
  startMs: number;
  /** When it fired; a sleep still pending when the window closed ends there. */
  endMs: number;
}

/** What a recorder saw between begin and end: the calls and the sleeps that began inside the window. */
export interface Window {
  calls: DeviceCall[];
  sleeps: Sleep[];
}

/** How a measured run ended: the tool answered without an error, answered with one, or could not run here at all. */
export type Status = 'ok' | 'failed' | 'unavailable';

export interface Measured {
  wallMs: number;
  /** The harness process's CPU (user + system) over the call: averi's own work — tree, pixels — plus the MCP round trip. */
  cpuMs: number;
  /** Calls to the device: every kind but `host`. */
  deviceCalls: number;
  /** Count per kind, `host` included. */
  calls: Record<string, number>;
  deviceMs: number;
  deviceBusyMs: number;
  hostCalls: number;
  hostMs: number;
  sleeps: number;
  sleptMs: number;
}

export interface Spread {
  median: number;
  min: number;
  max: number;
}

export interface Summary {
  runs: number;
  statuses: Partial<Record<Status, number>>;
  /** Over the ok runs only; undefined when there were none. */
  wallMs?: Spread;
  cpuMs?: Spread;
  deviceCalls?: Spread;
  deviceMs?: Spread;
  deviceBusyMs?: Spread;
  hostCalls?: Spread;
  hostMs?: Spread;
  sleeps?: Spread;
  sleptMs?: Spread;
}

/** The length of the union of the intervals. */
export function busyMs(intervals: readonly { startMs: number; endMs: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return 0;
  let total = 0;
  let { startMs: open, endMs: close } = sorted[0];
  for (const { startMs, endMs } of sorted.slice(1)) {
    if (startMs > close) {
      total += close - open;
      open = startMs;
      close = endMs;
    } else if (endMs > close) {
      close = endMs;
    }
  }
  return total + (close - open);
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const length = (c: { startMs: number; endMs: number }) => c.endMs - c.startMs;

/** One window, the tool call's round trip as the client measured it, and the process's CPU over it. */
export function measure(window: Window, wallMs: number, cpuMs: number): Measured {
  const device = window.calls.filter((c) => c.kind !== 'host');
  const host = window.calls.filter((c) => c.kind === 'host');
  const calls: Record<string, number> = {};
  for (const c of window.calls) calls[c.kind] = (calls[c.kind] ?? 0) + 1;
  return {
    wallMs,
    cpuMs,
    deviceCalls: device.length,
    calls,
    deviceMs: sum(device.map(length)),
    deviceBusyMs: busyMs(device),
    hostCalls: host.length,
    hostMs: sum(host.map(length)),
    sleeps: window.sleeps.length,
    sleptMs: busyMs(window.sleeps),
  };
}

const NUMBERS = ['wallMs', 'cpuMs', 'deviceCalls', 'deviceMs', 'deviceBusyMs', 'hostCalls', 'hostMs', 'sleeps', 'sleptMs'] as const;

/**
 * N runs of one scenario: how many ended how, and the median and range of each number over the ok runs — a failed
 * run measures a different path (a timeout, a refusal) and an unavailable one measures nothing.
 */
export function summarize(runs: readonly (Measured & { status: Status })[]): Summary {
  const statuses: Summary['statuses'] = {};
  for (const r of runs) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const ok = runs.filter((r) => r.status === 'ok');
  const summary: Summary = { runs: runs.length, statuses };
  if (ok.length === 0) return summary;
  for (const key of NUMBERS) {
    const xs = ok.map((r) => r[key]);
    summary[key] = { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
  }
  return summary;
}

export interface Breakdown {
  /** Per command label: calls and time per run, the costliest first. */
  calls: { kind: string; label: string; count: number; ms: number }[];
  /** Per caller of `sleep`: sleeps and the time they asked for per run, the longest first. */
  sleeps: { caller: string; count: number; ms: number }[];
}

/** Where the time of a scenario's runs goes, averaged per run: which commands, which sleeps. */
export function breakdown(windows: readonly Window[]): Breakdown {
  const calls = new Map<string, { kind: string; label: string; count: number; ms: number }>();
  const sleeps = new Map<string, { caller: string; count: number; ms: number }>();
  for (const w of windows) {
    for (const c of w.calls) {
      const row = calls.get(c.label) ?? calls.set(c.label, { kind: c.kind, label: c.label, count: 0, ms: 0 }).get(c.label)!;
      row.count++;
      row.ms += length(c);
    }
    for (const s of w.sleeps) {
      const row = sleeps.get(s.caller) ?? sleeps.set(s.caller, { caller: s.caller, count: 0, ms: 0 }).get(s.caller)!;
      row.count++;
      row.ms += s.ms;
    }
  }
  const n = Math.max(1, windows.length);
  const perRun = <T extends { count: number; ms: number }>(rows: Iterable<T>) =>
    [...rows].map((r) => ({ ...r, count: r.count / n, ms: r.ms / n })).sort((a, b) => b.ms - a.ms);
  return { calls: perRun(calls.values()), sleeps: perRun(sleeps.values()) };
}

// --- D26: simctl screenshot stalls ---

/** How instrument.ts#classify labels `xcrun simctl io <udid> screenshot …`. */
export const SCREENSHOT_LABEL = 'simctl io screenshot';

/**
 * A `simctl io screenshot` longer than this stalled (D26). The call is bimodal with nothing between the modes: across
 * the recorded iOS D0 runs (2026-10-30/31; 42 stalls in ~460 calls) the ok calls took 336–451 ms and the stalls 1 366–1 415 ms —
 * the ok time plus ~1 000 ms. 900 ms sits near the middle of that ~900 ms gap, ~450 ms from either mode, so neither a
 * slow ok call on a loaded host nor a slightly short stall falls on the wrong side.
 */
export const SCREENSHOT_STALL_MS = 900;

export function isScreenshotStall(c: DeviceCall): boolean {
  return c.label === SCREENSHOT_LABEL && length(c) > SCREENSHOT_STALL_MS;
}

/** One scenario's screenshots and stalls, and its wall clock over the ok runs where no screenshot stalled. */
export interface ScenarioStalls {
  /** Over every run, whatever its status: the stall is simctl's, not the scenario's. */
  screenshots: number;
  stalls: number;
  /** The ok runs with no stall. */
  stallFreeRuns: number;
  /** Their wall clock; undefined when every ok run stalled (or none was ok). */
  stallFreeWallMs?: Spread;
}

const spread = (xs: readonly number[]): Spread | undefined => (xs.length === 0 ? undefined : { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
const screenshots = (w: Window) => w.calls.filter((c) => c.label === SCREENSHOT_LABEL);

export function scenarioStalls(runs: readonly { status: Status; wallMs: number; window: Window }[]): ScenarioStalls {
  const shots = runs.flatMap((r) => screenshots(r.window));
  const free = runs.filter((r) => r.status === 'ok' && !r.window.calls.some(isScreenshotStall));
  const wall = spread(free.map((r) => r.wallMs));
  return { screenshots: shots.length, stalls: shots.filter(isScreenshotStall).length, stallFreeRuns: free.length, ...(wall ? { stallFreeWallMs: wall } : {}) };
}

/** The whole run's screenshots and stalls, and how long each mode took. */
export interface OverallStalls {
  thresholdMs: number;
  screenshots: number;
  stalls: number;
  /** The calls that did not stall; undefined when there were none. */
  okMs?: Spread;
  /** The stalls; undefined when there were none. */
  stallMs?: Spread;
}

export function overallStalls(windows: readonly Window[]): OverallStalls {
  const shots = windows.flatMap(screenshots);
  const stalled = shots.filter(isScreenshotStall);
  const okMs = spread(shots.filter((c) => !isScreenshotStall(c)).map(length));
  const stallMs = spread(stalled.map(length));
  return { thresholdMs: SCREENSHOT_STALL_MS, screenshots: shots.length, stalls: stalled.length, ...(okMs ? { okMs } : {}), ...(stallMs ? { stallMs } : {}) };
}

/** The overall stall line of the text report. */
export function stallLine(o: OverallStalls): string {
  if (o.screenshots === 0) return `${SCREENSHOT_LABEL}: none taken`;
  const ms = (s: Spread) => `${Math.round(s.median)} [${Math.round(s.min)}–${Math.round(s.max)}] ms`;
  return [
    `${SCREENSHOT_LABEL}: ${o.stalls} stalls (> ${o.thresholdMs} ms) in ${o.screenshots} calls, ${((100 * o.stalls) / o.screenshots).toFixed(1)} %`,
    ...(o.okMs ? [`ok calls ${ms(o.okMs)}`] : []),
    ...(o.stallMs ? [`stalls ${ms(o.stallMs)}`] : []),
  ].join(' · ');
}

/** A scenario's two stall columns of the text table: `screenshots/stalls`, and the stall-free wall median `(runs)`. */
export function stallCells(s: ScenarioStalls): [string, string] {
  return [`${s.screenshots}/${s.stalls}`, s.stallFreeWallMs === undefined ? '—' : `${Math.round(s.stallFreeWallMs.median)} (${s.stallFreeRuns})`];
}

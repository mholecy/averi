import type { execFile as ExecFileFn } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { IDB_HELPER_CALL_END, IDB_HELPER_CALL_START, type IdbHelperCall } from '../../src/adapters/idb.js';
import { SLEEP_OWNER } from '../differential/clock.js';
import type { DeviceCall, Sleep, Window } from './stats.js';

/**
 * What the performance baseline (baseline.ts) counts, and how it sees it with nothing in src/ injected: averi reaches
 * the device through three doors, and the harness stands in each for the length of one tool call — and a fourth, the
 * idb helper, publishes its calls itself.
 *
 * - Processes: every adb, simctl, idb (and the OCR recognizer, swiftc, lsof) goes through `child_process.execFile` —
 *   src/adapters/exec.ts is its one caller. `recordingExecFile` wraps it, and `installRecorder` puts the wrapper into the
 *   builtin module and `syncBuiltinESMExports()` into every ESM `import { execFile }` of it — the technique
 *   scripts/differential/fake-device.ts uses to replace the device; here the real one is kept and only timed.
 * - WebDriverAgent: its HTTP goes through the global `fetch` (src/adapters/wda.ts#defaultFetch reads it per call);
 *   `recordingFetch` wraps that. The xcodebuild that serves WDA is a long-running `spawn`, a server and not a call, and
 *   is not counted.
 * - The idb helper (D7a): a call it serves is no process — it is published on src/adapters/idb.ts's diagnostics
 *   channels, and `recordHelperCalls` records it as the `idb` call it stands for (`idb ui describe-all`,
 *   `via: helper`), so a breakdown still names it. The helper's own start is a server, as WDA's xcodebuild is, and is
 *   not counted.
 * - Sleeps: averi has one sleep owner, src/util/sleep.ts ("waits, not sleeps"), and it is the only `setTimeout` in src/
 *   outside the process shutdown and the idb helper's deadlines (src/adapters/idb-helper.ts: a request's timeout and a
 *   start's ready deadline — bounds, not sleeps). `recordingSetTimeout` tells its timers from every other one (the
 *   MCP SDK's, node's) by the stack, as scripts/differential/clock.ts does, and records each with the file:line that called `sleep` — the
 *   settle or poll a D row names. Nothing is faked: the timer runs for its real length.
 *
 * Only calls that START inside a window (`Recorder.begin` … `end`) are recorded, so the harness's own setup — launching
 * a cell through scripts/truth/lab-device.ts, whose promisified execFile was bound before the wrapper went in anyway —
 * stays out of the numbers. If the sleep owner ever moves, every scenario reads 0 sleeps; baseline.ts warns when a run
 * made device calls and recorded none.
 */

/** A call as the recorder holds it while it may still be open: its end and outcome come with its answer. */
type OpenCall = Omit<DeviceCall, 'endMs' | 'ok'> & { endMs?: number; ok?: boolean };
/** A sleep as the recorder holds it while it may still be pending: its end comes when it fires. */
type OpenSleep = Omit<Sleep, 'endMs'> & { endMs?: number };

/** The calls and sleeps that begin between `begin` and `end` — one window per measured tool call. */
export class Recorder {
  private open = false;
  private calls: OpenCall[] = [];
  private sleeps: OpenSleep[] = [];

  /** @param now the recorder's clock: performance.now() unless a test hands one in. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(): void {
    this.open = true;
    this.calls = [];
    this.sleeps = [];
  }

  /**
   * Close the window: a copy of what began in it. A call still open ends now, not ok and marked `pending` (the tool
   * returned with it in flight — it is the window's cost only as far as the window); a sleep still pending ends now.
   * What finishes later changes the recorder's own entries, never the window returned.
   */
  end(): Window {
    this.open = false;
    const at = this.now();
    return {
      calls: this.calls.map(({ endMs, ok, ...c }) => (endMs === undefined ? { ...c, endMs: at, ok: false, pending: true as const } : { ...c, endMs, ok: ok! })),
      sleeps: this.sleeps.map((s) => ({ ...s, endMs: s.endMs ?? at })),
    };
  }

  /** A call begins; the returned function ends it. Outside a window both do nothing. */
  call(kind: string, label: string, via?: 'helper'): (ok: boolean) => void {
    if (!this.open) return () => undefined;
    const entry: OpenCall = { kind, label, startMs: this.now(), ...(via ? { via } : {}) };
    this.calls.push(entry);
    return (ok) => {
      if (entry.endMs !== undefined) return;
      entry.endMs = this.now();
      entry.ok = ok;
    };
  }

  /** A sleep begins; the returned function is called when it fires. */
  sleep(ms: number, caller: string): () => void {
    if (!this.open) return () => undefined;
    const entry: OpenSleep = { ms, caller, startMs: this.now() };
    this.sleeps.push(entry);
    return () => void (entry.endMs ??= this.now());
  }
}

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/**
 * Which device a command talks to, and the words it is grouped by in the breakdown: the device id dropped (adb's
 * `-s <serial>`, idb's `--udid <udid>`, a simulator udid anywhere), flags dropped, a shell command given as one string
 * split into words, then the first few words — `adb shell input text`, `simctl io screenshot`, `idb ui describe-all`.
 * Anything else is a `host` process, named by its file (`recognizer-<key>`) or, under xcrun, by its tool.
 */
export function classify(cmd: string, args: readonly string[]): { kind: string; label: string } {
  const words = (from: readonly string[]) => {
    const out: string[] = [];
    for (let i = 0; i < from.length; i++) {
      if (from[i] === '-s' || from[i] === '--udid') {
        i++;
        continue;
      }
      for (const w of from[i].split(/\s+/)) if (w !== '' && !w.startsWith('-') && !UDID.test(w)) out.push(w);
    }
    return out;
  };
  const name = basename(cmd);
  if (name === 'adb') return { kind: 'adb', label: ['adb', ...words(args).slice(0, 3)].join(' ') };
  if (name === 'idb') return { kind: 'idb', label: ['idb', ...words(args).slice(0, 2)].join(' ') };
  if (name === 'xcrun' && args[0] === 'simctl') return { kind: 'simctl', label: ['simctl', ...words(args.slice(1)).slice(0, 2)].join(' ') };
  if (name === 'xcrun') return { kind: 'host', label: `xcrun ${args[0] ?? ''}`.trim() };
  return { kind: 'host', label: name };
}

/** execFile with every call recorded: the callback (its last function argument) is where the call ends. */
export function recordingExecFile(original: typeof ExecFileFn, rec: Recorder): typeof ExecFileFn {
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const cmd = String(args[0]);
    const argv = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
    const { kind, label } = classify(cmd, argv);
    const done = rec.call(kind, label);
    let at = args.length - 1;
    while (at >= 0 && typeof args[at] !== 'function') at--;
    if (at >= 0) {
      const callback = args[at] as (err: unknown, ...rest: unknown[]) => void;
      args[at] = (err: unknown, ...rest: unknown[]) => {
        done(err === null || err === undefined);
        callback(err, ...rest);
      };
    }
    return (original as unknown as (...a: unknown[]) => unknown).apply(this, args);
  };
  // promisify(execFile) resolves { stdout, stderr } through this symbol; a promisified wrapper would lose it. Such a
  // caller (lab-device.ts) is not counted — it is the harness's, not averi's.
  const custom = (original as unknown as Record<symbol, unknown>)[promisify.custom];
  if (custom !== undefined) Object.defineProperty(wrapped, promisify.custom, { value: custom });
  return wrapped as unknown as typeof ExecFileFn;
}

/**
 * Record each call the idb helper serves (D7a), labelled as the CLI call would be (classify) and marked `via: helper`;
 * returns the unsubscribe. The end is published with the start's own object, so that object keys the record.
 */
export function recordHelperCalls(rec: Recorder): () => void {
  const open = new WeakMap<object, (ok: boolean) => void>();
  const onStart = (m: unknown) => {
    const { kind, label } = classify('idb', (m as IdbHelperCall).argv);
    open.set(m as object, rec.call(kind, label, 'helper'));
  };
  const onEnd = (m: unknown) => open.get(m as object)?.((m as IdbHelperCall).ok === true);
  IDB_HELPER_CALL_START.subscribe(onStart);
  IDB_HELPER_CALL_END.subscribe(onEnd);
  return () => {
    IDB_HELPER_CALL_START.unsubscribe(onStart);
    IDB_HELPER_CALL_END.unsubscribe(onEnd);
  };
}

/** `wda GET /session/:id/source`: the method and the path, session and element ids and the query dropped. */
function fetchLabel(input: unknown, init?: { method?: string }): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const path = new URL(url).pathname.replace(/\/(session|element)\/[^/]+/g, '/$1/:id');
  return `wda ${method.toUpperCase()} ${path}`;
}

/** fetch with every request recorded as a WebDriverAgent call — averi fetches nothing else. */
export function recordingFetch(original: typeof fetch, rec: Recorder): typeof fetch {
  return async (input, init) => {
    const done = rec.call('wda', fetchLabel(input, init));
    try {
      const r = await original(input, init);
      done(true);
      return r;
    } catch (e) {
      done(false);
      throw e;
    }
  };
}

const FRAME = /\(?((?:[A-Za-z]:)?[^\s()]+):(\d+):\d+\)?$/;

/** The frame that called `sleep`: the first after the last sleep.ts frame, as `src/<path>:<line>`. */
function sleepCaller(stack: string): string | undefined {
  const lines = stack.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !SLEEP_OWNER.test(lines[last])) last--;
  if (last < 0) return undefined;
  for (const line of lines.slice(last + 1)) {
    const m = FRAME.exec(line.trim());
    if (m === null) continue;
    const at = m[1].lastIndexOf('/src/');
    return `${at >= 0 ? m[1].slice(at + 1) : m[1]}:${m[2]}`;
  }
  return 'unknown';
}

/** setTimeout with averi's sleeps recorded; every other timer passed through untouched. */
export function recordingSetTimeout(original: typeof setTimeout, rec: Recorder, stackOf: () => string = () => new Error().stack ?? ''): typeof setTimeout {
  return function (this: unknown, fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) {
    const caller = sleepCaller(stackOf());
    if (caller === undefined) return original(fn, ms, ...args);
    const fired = rec.sleep(ms ?? 0, caller);
    return original((...a: unknown[]) => {
      fired();
      fn(...a);
    }, ms, ...args);
  } as unknown as typeof setTimeout;
}

/**
 * Put the three wrappers in, and the idb helper's subscriber, for the rest of the process. Called after the harness's
 * own imports: scripts/truth/lab-device.ts binds `promisify(execFile)` at load, and stays on the original.
 */
export function installRecorder(rec: Recorder): void {
  const cp = createRequire(import.meta.url)('node:child_process') as { execFile: typeof ExecFileFn };
  cp.execFile = recordingExecFile(cp.execFile, rec);
  syncBuiltinESMExports();
  globalThis.fetch = recordingFetch(globalThis.fetch, rec);
  globalThis.setTimeout = recordingSetTimeout(globalThis.setTimeout, rec);
  recordHelperCalls(rec);
}

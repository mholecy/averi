import { closeSync, openSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';
import { rebootSimulatorAdvice } from './simulator-reboot.js';
import { sleep } from '../util/sleep.js';
import { formatSeconds } from '../util/duration.js';
import { errorMessage } from '../util/error-message.js';

/**
 * WebDriverAgent lifecycle for one simulator (docs/plans/ios-wda-tree-source.md,
 * Phase 1). WDA ships as the `appium-webdriveragent` optional dependency (pinned in package.json);
 * measured 2026-08-12 on Xcode 26.6 / iOS 26.5:
 * - build once per Xcode version (`xcodebuild build-for-testing`, cached in
 *   DerivedData — the first build takes MINUTES, then it's a no-op),
 * - start per session with `test-without-building`; xcodebuild forwards
 *   TEST_RUNNER_* env to the runner, so TEST_RUNNER_USE_PORT picks the port,
 * - readiness = `GET /status` 200 with
 *   value.build.productBundleIdentifier === com.facebook.WebDriverAgentRunner.
 *
 * The tree read lives here, and since D43 the typing of what idb cannot type (keys(): one WebDriver session per WDA
 * start, the one session averi holds — docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-
 * call.md, the D43 amendment); taps, every other typing and install stay on idb/simctl (plan, decision 4).
 */

const WDA_BUNDLE_ID = 'com.facebook.WebDriverAgentRunner';
const STATUS_PROBE_TIMEOUT_MS = 1_000;
const BUILD_TIMEOUT_MS = 600_000;
/**
 * `/wda/activeAppInfo` (activeAppInfo) asks AX which app is active — no tree walk —
 * so a running WDA answers it in the tens of ms (unmeasured: D48's device check).
 * 2 s, not STATUS_PROBE_TIMEOUT_MS's 1 s: the launch's foreground wait (ios-foreground.ts)
 * adds one in-flight ask to its bound at worst, and a loaded host must not turn a slow
 * answer into a "could not check" note.
 */
const ACTIVE_APP_TIMEOUT_MS = 2_000;
/** /source on deep trees is the known WDA weakness — Phase 4 measures it. */
const SOURCE_TIMEOUT_MS = 30_000;
/**
 * quickSourceIfUp's budget (D54): the one /source a deep link's foreground wait reads at its 3 s bound to name iOS's system
 * alert. 2 s, as ACTIVE_APP_TIMEOUT_MS: a whole app tree read in 0.9–1.25 s (batch-2 D, the lab's), and the alert's
 * SpringBoard tree is small (about 24 KB of XML, batch-5 D49A) — so 2 s clears a healthy WDA on a loaded host, and
 * it caps what the aid adds to a link's reply (the bound, one ask in flight, then this) where SOURCE_TIMEOUT_MS's
 * 30 s would let a wedged runner hold it. A read past it is no alert: the reply falls back to its note.
 */
export const SYSTEM_ALERT_SOURCE_TIMEOUT_MS = 2_000;
/**
 * `POST /session`'s budget (D43): no app is launched (no bundleId), so WDA only resets its settings — 2–3 ms measured
 * (batch-10's G3 and G4); 10 s is a wedged runner, not a slow one.
 */
const SESSION_TIMEOUT_MS = 10_000;
/**
 * `/wda/keys`' budget (D43), by the text's length in characters: batch-10's G3 measured ~300 ms + ~16 ms a character
 * (XCTest's 60 characters a second), 967 ms at 40; this gives each part about three times that — 2 s + 50 ms a
 * character, 4 s at 40.
 */
export const keysTimeoutMs = (characters: number): number => 2_000 + 50 * characters;
/**
 * The session a typing is sent on (D43): no software keyboard forced into view, so averi's keyboard readings (the WDA
 * keyboard band, `keyboardDismiss`) are not changed by the first non-ASCII fill — batch-10's G4: the keyboard prefs,
 * the three simulator domains and the sessionless /source unchanged, and `/wda/keys` types with no keyboard shown.
 */
export const KEYS_SESSION = { capabilities: { alwaysMatch: { forceSimulatorSoftwareKeyboardPresence: false }, firstMatch: [{}] } };
/** Post-build: the first app-install on the simulator dominates this. The bound of a launch's start too (launch_app's description). */
export const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
/**
 * shutdown()'s phases must ADD UP to less than mcp/lifecycle.ts's
 * SHUTDOWN_BUDGET_MS (1 500), or the budget cuts off the one step that frees
 * the port: wait ≤ 600, plus one straggling probe that may START just before
 * the deadline (≤ 150), + lsof ≤ 300 + the kills ≈ 1 050 < 1 500 — measured
 * 694–833 ms against real sockets; the earlier 1 000 + 2 000 sizing measured
 * 1 030–1 134 ms, i.e. over budget (review 2026-09-18).
 */
const SHUTDOWN_GONE_MS = 600;
const SHUTDOWN_POLL_MS = 100;
const SHUTDOWN_PROBE_MS = 150;
const SHUTDOWN_LSOF_MS = 300;

const FIRST_BUILD_NOTE =
  'Note: the first WDA build per Xcode version takes minutes (cached in DerivedData afterwards).';

/** Structural subset of global fetch — injectable for tests. A GET passes `signal` alone; keys()' POSTs add the rest. */
export type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

/** A W3C error body's `value.error` and `value.message`, where they are strings — parsed once, here. */
interface WdaError {
  readonly error?: string;
  readonly message?: string;
}

function wdaErrorOf(body: unknown): WdaError {
  const value = (body as { value?: { error?: unknown; message?: unknown } } | null | undefined)?.value;
  return {
    ...(typeof value?.error === 'string' && { error: value.error }),
    ...(typeof value?.message === 'string' && { message: value.message }),
  };
}

/**
 * An error answer as a reply says it: the status, WDA's `error`, and its `message` (cut to 200 characters) when given.
 * `/wda/keys` never passes the message: it is NSError's description and may hold the typed value, escaped (`\U0161`) or
 * in part, where no cut of the text can find it (review round 1).
 */
function describeWdaError(status: number, { error, message }: WdaError): string {
  return `HTTP ${status}${error === undefined ? '' : ` ${error}`}${message === undefined || message === '' ? '' : `: ${message.slice(0, 200)}`}`;
}

/** Structural subset of node's ChildProcess — injectable for tests. */
export interface WdaChild {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: () => void): unknown;
  once(event: 'error', listener: (err: Error) => void): unknown;
  unref(): void;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; detached: boolean; stdio: ['ignore', number, number] },
) => WdaChild;

const defaultSpawn: SpawnFn = (cmd, args, opts) => nodeSpawn(cmd, args, opts);

/**
 * In-process port allocator: sequential from 8100, one port per UDID for the
 * life of the process — two WdaServers in this process can NEVER share a port.
 * (The previous 8100 + hash(udid) % 100 scheme collided at ~1% per pair, and a
 * collision silently delivered the WRONG device's tree.) Servers left behind
 * by OTHER processes cannot be solved by allocation; they are caught at probe
 * time instead — see the not-ours check in doEnsureRunning.
 */
const WDA_BASE_PORT = 8100;
const portByUdid = new Map<string, number>();

/** Same UDID → same port; distinct UDIDs → distinct ports (8100, 8101, ...). */
export function wdaPortFor(udid: string): number {
  let port = portByUdid.get(udid);
  if (port === undefined) {
    port = WDA_BASE_PORT + portByUdid.size;
    portByUdid.set(udid, port);
  }
  return port;
}

/** Test-only: forget all allocations so each test starts at 8100. */
export function resetWdaPortAllocatorForTests(): void {
  portByUdid.clear();
}

/**
 * require.resolve is unavailable in ESM — createRequire bridges it. The
 * resolve is preflighted with its own message because appium-webdriveragent
 * is an OPTIONAL dependency of averi: absent when the install skipped optional
 * dependencies (`--omit=optional`) or its install failed, and a bare resolve
 * error wrapped as a "build failure" would send the user debugging xcodebuild.
 * The advice reinstalls averi itself: the resolve walks up from averi's own
 * files, so `npm i -D appium-webdriveragent` in the user's app repo reaches
 * only an averi installed in that repo, never an npx or global one.
 */
export function wdaProjectPath(
  resolvePkg: (id: string) => string = createRequire(import.meta.url).resolve,
): string {
  let pkgJson: string;
  try {
    pkgJson = resolvePkg('appium-webdriveragent/package.json');
  } catch (err) {
    throw new Error(
      'WebDriverAgent requires the appium-webdriveragent package, an optional dependency of averi ' +
        'that is not installed (optional dependencies were skipped, e.g. --omit=optional, or its install failed) — ' +
        'reinstall averi without --omit=optional (and with npm_config_omit unset); under npx, clear its cache ' +
        '(`rm -rf ~/.npm/_npx`) and run it again',
      { cause: err },
    );
  }
  return join(dirname(pkgJson), 'WebDriverAgent.xcodeproj');
}

export interface WdaServerOptions {
  udid: string;
  /** Explicit port; defaults to the per-UDID allocation (wdaPortFor). */
  port?: number;
  exec?: ExecFn;
  fetchFn?: FetchFn;
  spawnFn?: SpawnFn;
  /** Test knob — default ~/Library/Developer/Xcode/DerivedData/averi-wda. */
  derivedDataPath?: string;
  /** Test knobs — readiness polling. */
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Seam for shutdown()'s last resort — production is process.kill. */
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  /** Test knob — the package resolve wdaProjectPath preflights; production is require.resolve. */
  resolvePackage?: (id: string) => string;
}

export class WdaServer {
  readonly udid: string;
  readonly port: number;
  /** xcodebuild output lands here — every failure message points at it. */
  readonly logPath: string;
  private readonly exec: ExecFn;
  private readonly fetchFn: FetchFn;
  private readonly spawnFn: SpawnFn;
  private readonly derivedDataPath: string;
  private readonly readyTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly killProcess: (pid: number, signal: NodeJS.Signals) => void;
  private readonly resolvePackage: ((id: string) => string) | undefined;

  private inflight: Promise<void> | undefined;
  /** Set by shutdown(): terminal — unlike stop(), no restart may follow. */
  private shutDown = false;
  private child: WdaChild | undefined;
  /** The child whose WDA answered /status in awaitReady — up (upGeneration) while it is still `child` and alive. */
  private readyChild: WdaChild | undefined;
  /** Counts the starts that reached /status; `readyChild`'s is upGeneration()'s answer. */
  private readyStarts = 0;
  private childExited = false;
  private childError: Error | undefined;
  private exitHook: (() => void) | undefined;
  /**
   * Bumped by stop(). An in-flight doEnsureRunning captures the value at
   * start and aborts at the next checkpoint when it changed — otherwise a
   * stop() during the minutes-long first build would be followed by a spawn
   * that leaks a WDA for a deselected device. A new ensureRunning() captures
   * the NEW value, so a stopped server can be legitimately restarted.
   */
  private stopEpoch = 0;
  /**
   * keys()' WebDriver session and the WDA start (upGeneration) it was made on — or the making of it, in flight. It dies
   * with that runner, so a start under another number makes a new one; stop() and shutdown() forget it.
   */
  private session: { generation: number; id: Promise<string> } | undefined;

  constructor(opts: WdaServerOptions) {
    this.udid = opts.udid;
    this.port = opts.port ?? wdaPortFor(opts.udid);
    this.exec = opts.exec ?? defaultExec;
    this.fetchFn = opts.fetchFn ?? defaultFetch;
    this.spawnFn = opts.spawnFn ?? defaultSpawn;
    this.derivedDataPath =
      opts.derivedDataPath ??
      join(homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData', 'averi-wda');
    this.readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.killProcess = opts.killProcess ?? ((pid, signal) => process.kill(pid, signal));
    this.resolvePackage = opts.resolvePackage;
    this.logPath = join(tmpdir(), `averi-wda-${opts.udid}.log`);
  }

  /**
   * Idempotent, single-flight: concurrent callers share one attempt. Cleared
   * on settle — failure makes retry possible, success makes the next call
   * re-verify /status cheaply (self-healing if the server died meanwhile).
   */
  ensureRunning(): Promise<void> {
    if (this.shutDown) {
      return Promise.reject(new Error(`WdaServer for ${this.udid} has been shut down — the process is exiting`));
    }
    if (!this.inflight) {
      const p = this.doEnsureRunning();
      const clear = () => {
        if (this.inflight === p) this.inflight = undefined;
      };
      p.then(clear, clear);
      this.inflight = p;
    }
    return this.inflight;
  }

  /**
   * Whether WebDriverAgent's build is in DerivedData (an xctestrun under Build/Products), so a start needs no
   * `xcodebuild build-for-testing` — a directory listing, no device call, no process. What a launch's start asks before it
   * starts anything (wda-tree-source.ts#startBeforeLaunch, A41d).
   */
  async isBuilt(): Promise<boolean> {
    return (await this.findXctestrun()) !== undefined;
  }

  /**
   * GET /source?format=json (sessionless — no WebDriver session needed).
   * Returns the raw WDA envelope `{ value: <root element>, sessionId }`;
   * callers unwrap `.value` (parseWdaSource, Phase 2).
   */
  async source(): Promise<unknown> {
    return this.sourceAttempt(false);
  }

  /**
   * Which start of OUR WebDriverAgent is up now, without asking it — or
   * undefined when none is: a start of ours reached /status and its
   * xcodebuild has neither exited nor been stopped since (stop() and
   * shutdown() clear `child`; a restart is up again only once its own start
   * reached /status, under a new number). No device call — what the
   * launch's foreground wait asks before activeAppInfo (wda-tree-source.ts),
   * so a launch never starts WDA; the number lets it remember a failed ask
   * for one child's life. A runner that died inside the simulator while
   * xcodebuild lives on still reads as up; activeAppInfo then fails in WDA's
   * words.
   */
  upGeneration(): number | undefined {
    return this.child !== undefined && this.child === this.readyChild && !this.childExited ? this.readyStarts : undefined;
  }

  /**
   * GET /wda/activeAppInfo (sessionless): the app WDA's sessionless reads
   * read — FBCustomCommands.m answers it with the same
   * `request.session.activeApplication ?: fb_activeApplication` as /source,
   * so it names the app the next /source walks, without walking it.
   * Returns the raw envelope `{ value: { pid, bundleId, name, … } }`.
   * NEVER starts WDA (no ensureRunning) and never restarts it: one request
   * under ACTIVE_APP_TIMEOUT_MS; a refusal, a timeout or an HTTP error
   * fails naming the port and the log, like source(). Callers ask
   * upGeneration() first.
   */
  async activeAppInfo(): Promise<unknown> {
    return this.askOnce('/wda/activeAppInfo', ACTIVE_APP_TIMEOUT_MS);
  }

  /**
   * GET /source?format=json ONCE, under the short SYSTEM_ALERT_SOURCE_TIMEOUT_MS, and only from a WDA of ours that is
   * up (upGeneration) — undefined, with no call, when none is (D54: the read of a deep link's wait at its bound).
   * Unlike source(), it NEVER starts WDA (no ensureRunning), never probes /status and never restarts it: the read is
   * an aid to a reply, and a WDA that cannot answer it in time is left as it is — a refusal, a timeout or an HTTP
   * error fails naming the port and the log, as activeAppInfo's do.
   */
  async quickSourceIfUp(): Promise<unknown> {
    if (this.upGeneration() === undefined) return undefined;
    return this.askOnce('/source?format=json', SYSTEM_ALERT_SOURCE_TIMEOUT_MS, '/source');
  }

  /**
   * Types `text` into whatever holds keyboard focus: `POST /session/:id/wda/keys` (D43, WDA 16.1.7's FBTypeText — no
   * element, no focus check, like `idb ui text`; it returns once the events are delivered, batch-10's G1: 20/20 whole on
   * the read right after). Starts WDA when it is not up (ensureRunning), then sends on this start's session, made once
   * (KEYS_SESSION).
   * - A lost session — HTTP 404 or "invalid session id", what a restarted runner answers with nothing typed (G4) — is
   *   made again once and the text sent once more; a second loss fails.
   * - A request that did not complete (its budget, keysTimeoutMs, ran out, or the connection went) is NEVER sent again:
   *   it may have typed part of the text, and a retry could type it twice. It fails saying so.
   * - Any other error answer fails with its status and WDA's error alone — not WDA's message, which may hold the value
   *   (a credential, perhaps) — naming the port and the log, as askOnce does.
   */
  async keys(text: string): Promise<void> {
    await this.ensureRunning();
    const id = this.sessionId();
    let answer = await this.postKeys(await id, text);
    if (answer.kind === 'lost') {
      // Only the session this typing was sent on: a typing beside it may already have made the next one (review round 1).
      if (this.session?.id === id) this.session = undefined;
      answer = await this.postKeys(await this.sessionId(), text);
    }
    if (answer.kind === 'typed') return;
    throw new Error(`WDA /wda/keys failed: ${describeWdaError(answer.status, { error: answer.error })} ${this.where()}`);
  }

  /** This WDA start's session for keys(): the one made on it, or a new one (KEYS_SESSION), single-flight. */
  private sessionId(): Promise<string> {
    const generation = this.upGeneration() ?? -1;
    if (this.session?.generation !== generation) {
      const id = this.newSession();
      this.session = { generation, id };
      id.catch(() => {
        if (this.session?.id === id) this.session = undefined;
      });
    }
    return this.session.id;
  }

  private async newSession(): Promise<string> {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.post('/session', KEYS_SESSION, SESSION_TIMEOUT_MS);
    } catch (err) {
      throw new Error(`WDA POST /session request failed on port ${this.port} (udid ${this.udid}): ${errorMessage(err)} — xcodebuild log: ${this.logPath}`, { cause: err });
    }
    const body = (await res.json().catch(() => undefined)) as { sessionId?: unknown; value?: { sessionId?: unknown } } | undefined;
    const id = body?.sessionId ?? body?.value?.sessionId;
    if (!res.ok || typeof id !== 'string' || id === '') throw new Error(`WDA POST /session failed: ${describeWdaError(res.status, wdaErrorOf(body))} ${this.where()}`);
    return id;
  }

  /**
   * One `/wda/keys` on `session`, never sent again here: `typed`; `lost` — the session is gone (HTTP 404 or "invalid
   * session id"), nothing typed; `refused` — any other error answer. A request that did not complete throws.
   */
  private async postKeys(session: string, text: string): Promise<{ kind: 'typed' } | { kind: 'lost' | 'refused'; status: number; error?: string }> {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.post(`/session/${session}/wda/keys`, { value: [...text] }, keysTimeoutMs([...text].length));
    } catch (err) {
      throw new Error(
        `WDA /wda/keys did not complete on port ${this.port} (udid ${this.udid}): ${errorMessage(err)} — it may have typed ` +
          `part of the text, so it is not sent again (a retry could type it twice); read the field before typing more. ` +
          `xcodebuild log: ${this.logPath}`,
        { cause: err },
      );
    }
    const body = await res.json().catch(() => undefined); // read on success too: an unread body holds the connection
    if (res.ok) return { kind: 'typed' };
    const { error } = wdaErrorOf(body);
    return { kind: res.status === 404 || error === 'invalid session id' ? 'lost' : 'refused', status: res.status, ...(error !== undefined && { error }) };
  }

  /** A JSON POST of `route` under `timeoutMs`; a request that did not complete throws as fetch threw it. */
  private post(route: string, body: unknown, timeoutMs: number): ReturnType<FetchFn> {
    return this.fetchFn(`${this.baseUrl()}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** One GET of a running WDA under `timeoutMs`, no start and no retry; fails naming `name` (the route), the port and the log. */
  private async askOnce(route: string, timeoutMs: number, name = route): Promise<unknown> {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.request(route, timeoutMs);
    } catch (err) {
      throw new Error(
        `WDA ${name} request failed on port ${this.port} (udid ${this.udid}): ${errorMessage(err)} — ` +
          `xcodebuild log: ${this.logPath}`,
        { cause: err },
      );
    }
    return this.body(name, res);
  }

  /** GET `route` under `timeoutMs`. A request that did not complete throws as fetch threw it: each caller words it (source() decides on a restart). */
  private request(route: string, timeoutMs: number): ReturnType<FetchFn> {
    return this.fetchFn(`${this.baseUrl()}${route}`, { signal: AbortSignal.timeout(timeoutMs) });
  }

  /** A completed request's JSON body; a non-2xx fails naming the route, the port, the udid and the log. */
  private body(route: string, res: Awaited<ReturnType<FetchFn>>): Promise<unknown> {
    if (!res.ok) {
      throw new Error(
        `WDA ${route} failed: HTTP ${res.status} ${this.where()}`,
      );
    }
    return res.json();
  }

  private async sourceAttempt(restarted: boolean): Promise<unknown> {
    await this.ensureRunning();
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.request('/source?format=json', SOURCE_TIMEOUT_MS);
    } catch (err) {
      // A bare "fetch failed"/"TimeoutError" names neither device nor server —
      // keep the log-path contract even for connection-level failures.
      const reason = errorMessage(err);
      // Two failures share this catch and want opposite remedies. A server
      // that still answers /status is ALIVE: /source on a deep tree is the
      // known WDA weakness (SOURCE_TIMEOUT_MS), and killing it would trade a
      // slow read for a lost session and a false "still does not answer"
      // (review 2026-09-18). A server that answers nothing is dead or gone —
      // measured 2026-09-18 (finportal, overnight idle): `pkill -f
      // WebDriverAgentRunner` + retry was the manual cure. Apply that cure
      // once, here: the child is OURS (adoption is refused in doEnsureRunning),
      // so killing it costs nobody else a server.
      // Two probes: STATUS_PROBE_TIMEOUT_MS is 1 s, and the loaded host this
      // path exists for can make a healthy WDA miss one — a single miss must
      // not turn a slow server into a killed one.
      const alive = (await this.probeStatus().catch(() => false)) || (await this.probeStatus().catch(() => false));
      if (alive) {
        throw new Error(
          `WDA on port ${this.port} (udid ${this.udid}) answered /status but GET /source did not complete ` +
            `(${reason}) — a deep tree (the known WDA weakness; budget ${formatSeconds(SOURCE_TIMEOUT_MS)}) or a wedged ` +
            'server. Read a narrower screen and retry; if it repeats, `pkill -f WebDriverAgentRunner`; ' +
            `xcodebuild log: ${this.logPath}`,
          { cause: err },
        );
      }
      if (!restarted) {
        console.error(
          `averi: WDA on port ${this.port} (udid ${this.udid}) stopped answering (${reason}) — restarting it once`,
        );
        this.stop();
        return this.sourceAttempt(true);
      }
      throw new Error(
        `WDA /source request failed on port ${this.port} (udid ${this.udid}): ${reason} — ` +
          `the server was restarted once and still does not answer; xcodebuild log: ${this.logPath}`,
        { cause: err },
      );
    }
    return this.body('/source', res);
  }

  /**
   * The process-shutdown form of stop(): stop, then WAIT until the port is
   * genuinely free, and if xcodebuild's own teardown did not take the runner
   * with it within the budget, SIGKILL whatever still LISTENS on our port.
   * Needed because the group kill in killChild reaches only xcodebuild: the
   * WebDriverAgentRunner is a child of launchd_sim inside the simulator, in its
   * own process group (measured 2026-09-18), so "signal sent" and "port free"
   * are two different facts and the next session cares only about the second.
   *
   * "Free" means the connection is REFUSED. A probe that times out or resets
   * is a listener that is wedged, not gone — the state a shutdown mid-/source
   * most often meets — so it keeps waiting and then escalates; reading it as
   * quiet returned in 1 ms and left the runner up (review 2026-09-18).
   *
   * Killing by port is safe only because of `hadChild`: this runs solely when
   * WE spawned onto the port, and doEnsureRunning refused to spawn if anything
   * foreign already held it — so the listener is ours or its remains. The
   * per-UDID port is NOT the reason: wdaPortFor allocates per PROCESS, so the
   * same port can mean another simulator in another process.
   */
  async shutdown(): Promise<void> {
    this.shutDown = true;
    const hadChild = this.child !== undefined; // read BEFORE stop(), which clears this.child
    this.stop();
    if (!hadChild) return;
    const deadline = Date.now() + SHUTDOWN_GONE_MS;
    while (Date.now() < deadline) {
      if ((await this.portState()) === 'refused') return;
      if (Date.now() + SHUTDOWN_POLL_MS >= deadline) break; // no sleep we would not use
      await sleep(SHUTDOWN_POLL_MS);
    }
    await this.killListener();
  }

  /**
   * refused = nothing listens; answering = something replied; held = anything
   * else. The rule is conservative on purpose: whatever is not PROVABLY refused
   * is treated as a listener still there (a wedged runner times out; a reset
   * or an unclassifiable error is not evidence of a free port), and we would
   * rather wait 600 ms and kill than leave a runner up. `answering` is not
   * checked for the WDA bundle id: a foreign process binding OUR port inside
   * the ≤ 600 ms window after our own runner died would be killed — accepted,
   * since we only ever get here on a port we spawned onto. The message
   * fallback covers fetch implementations and fakes that do not wrap the
   * socket error in `cause`.
   */
  private async portState(): Promise<'refused' | 'answering' | 'held'> {
    try {
      await this.fetchFn(`${this.baseUrl()}/status`, { signal: AbortSignal.timeout(SHUTDOWN_PROBE_MS) });
      return 'answering';
    } catch (err) {
      // undici wraps the socket error: `TypeError: fetch failed` with cause.code.
      const code = (err as { cause?: { code?: string } }).cause?.code ?? (err instanceof Error ? err.message : '');
      return /ECONNREFUSED/.test(code) ? 'refused' : 'held';
    }
  }

  /**
   * Last resort: SIGKILL every process that LISTENS on our port. `-sTCP:LISTEN`
   * is load-bearing — a bare `lsof -t -i tcp:<port>` also lists the CLIENT end,
   * which after the probes above is this very process: the first cut SIGKILLed
   * averi itself, before the runner (review 2026-09-18, measured with the real
   * lsof). `-n -P` skip host/port name lookups, the usual reason lsof takes
   * seconds. Our own pid is filtered as a second belt.
   */
  private async killListener(): Promise<void> {
    let pids: number[];
    try {
      // `-i` must be immediately followed by its address: with other flags in
      // between, `tcp:<port>` becomes a FILE name and lsof exits 1 (measured).
      const { stdout } = await this.exec('lsof', ['-t', '-n', '-P', '-sTCP:LISTEN', '-i', `tcp:${this.port}`], {
        timeoutMs: SHUTDOWN_LSOF_MS,
      });
      pids = stdout
        .toString('utf8')
        .split('\n')
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
    } catch (e) {
      // lsof exits 1 when nothing listens — nothing to kill. Anything else
      // (no lsof, a timeout) means we could NOT clear the port: say so, since
      // the next session will meet the refusal and needs to know why.
      if (!(e instanceof ExecError && e.exitCode === 1 && !e.timedOut)) {
        console.error(`averi: could not list the listener on port ${this.port} (${errorMessage(e).split('\n')[0]}) — a WebDriverAgent may be left behind; \`pkill -f WebDriverAgentRunner\` before the next iOS call`);
      }
      return;
    }
    for (const pid of pids) {
      try {
        this.killProcess(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * Sync teardown: signal and unhook, without waiting. The restart path
   * (sourceAttempt) and the process 'exit' hook need this form — neither can
   * await. Anything that CAN await calls shutdown(), which also verifies the
   * port went free. Tolerates not-running.
   */
  stop(): void {
    this.stopEpoch++;
    this.session = undefined; // it dies with the runner
    if (this.exitHook) {
      process.removeListener('exit', this.exitHook);
      this.exitHook = undefined;
    }
    this.inflight = undefined;
    this.killChild();
  }

  /** The tail of a failure that names where: `on port … (udid …) — xcodebuild log: …`. */
  private where(): string {
    return `on port ${this.port} (udid ${this.udid}) — xcodebuild log: ${this.logPath}`;
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async doEnsureRunning(): Promise<void> {
    const epoch = this.stopEpoch;
    const assertNotStopped = (): void => {
      if (this.stopEpoch !== epoch) {
        throw new Error(`WdaServer for ${this.udid} was stopped during startup`);
      }
    };
    if (await this.probeStatus()) {
      // Genuine WDA answering — but is it OURS? /status carries no UDID, so
      // the bundle-id check above can never be an IDENTITY check: every real
      // WDA passes it, including one serving a different simulator. Only a
      // child spawned by THIS instance is known to target this.udid; anything
      // else is adopted-at-your-peril, so fail loudly instead.
      if (this.child !== undefined && !this.childExited) return;
      throw new Error(
        `A WebDriverAgent answers /status on port ${this.port}, but this session did not start it ` +
          `(udid ${this.udid}). /status carries no UDID, so it cannot be verified as serving THIS ` +
          `simulator — adopting it could silently deliver another device's UI tree. Likely a stale ` +
          `WDA from a previous session: a server that was still busy when the host closed it took a SIGTERM, and ` +
          `before 0.8.1 nothing then stopped its WebDriverAgent (0.8.1 stops it and waits for the port to go quiet; ` +
          `a SIGKILL, or a second signal during that wait, still leaves it). ` +
          `Recover: \`pkill -f WebDriverAgentRunner\` or ${rebootSimulatorAdvice(this.udid)}.`,
      );
    }
    assertNotStopped();
    let xctestrun = await this.findXctestrun();
    assertNotStopped();
    if (!xctestrun) {
      // The package first (A41a review m4): a missing one is said before, and instead of, the build line below — the
      // build could never start, and "takes minutes" followed by "not installed" sent readers of stderr waiting.
      const project = wdaProjectPath(this.resolvePackage);
      // Loud by design (plan, Risks): a silent multi-minute first build reads
      // as a hang. stderr is the sanctioned channel (server.ts logs there too).
      console.error(
        `averi: first WDA build for this Xcode version — takes minutes, cached afterwards; log: ${this.logPath}`,
      );
      await this.build(project);
      assertNotStopped();
      xctestrun = await this.findXctestrun();
      assertNotStopped();
      if (!xctestrun) {
        throw new Error(
          'xcodebuild build-for-testing succeeded but no ' +
            'WebDriverAgentRunner_iphonesimulator*.xctestrun appeared under ' +
            `${join(this.derivedDataPath, 'Build', 'Products')} — xcodebuild log: ${this.logPath}`,
        );
      }
    }
    const env = await detectXcodeEnv(this.exec);
    assertNotStopped(); // last checkpoint before the spawn — nothing async in between
    const child = this.startChild(xctestrun, env);
    await this.awaitReady(epoch, child);
  }

  /**
   * false = nothing listening OR a listener that did not answer within 1 s —
   * the readiness loop treats both as "not up yet", deliberately; true =
   * something that looks like WDA answered (the caller decides whether it is
   * OURS). Anything else on our port is a foreign server — fail loudly rather
   * than talk to it. When a caller must tell "free" from "wedged" apart (the
   * teardown does), it uses portState() instead.
   */
  private async probeStatus(): Promise<boolean> {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(`${this.baseUrl()}/status`, {
        signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS),
      });
    } catch {
      return false;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const bundle = (body as { value?: { build?: { productBundleIdentifier?: unknown } } } | undefined)
      ?.value?.build?.productBundleIdentifier;
    if (res.ok && bundle === WDA_BUNDLE_ID) return true;
    throw new Error(
      `Port ${this.port} answers /status but is not WebDriverAgent ` +
        `(${res.ok ? `productBundleIdentifier=${JSON.stringify(bundle ?? null)}` : `HTTP ${res.status}`}). ` +
        `WDA ports are allocated per UDID starting at 8100 (${this.port} for ${this.udid}); ` +
        'free the port.',
    );
  }

  /** Newest by mtime when several SDK versions coexist in DerivedData. */
  private async findXctestrun(): Promise<string | undefined> {
    const products = join(this.derivedDataPath, 'Build', 'Products');
    let entries: string[];
    try {
      entries = await readdir(products);
    } catch {
      return undefined;
    }
    // The file name embeds the SDK version (e.g. ..._iphonesimulator26.5-arm64
    // .xctestrun on this machine) — never hardcode it.
    const candidates = entries.filter(
      (e) => e.startsWith('WebDriverAgentRunner_iphonesimulator') && e.endsWith('.xctestrun'),
    );
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return join(products, candidates[0]);
    const stats = await Promise.all(
      candidates.map(async (e) => {
        const path = join(products, e);
        return { path, mtimeMs: (await stat(path)).mtimeMs };
      }),
    );
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return stats[0].path;
  }

  /** `project`: wdaProjectPath()'s, preflighted by the caller — a missing package is no failed build. */
  private async build(project: string): Promise<void> {
    const env = await detectXcodeEnv(this.exec);
    try {
      const { stdout, stderr } = await this.exec(
        'xcodebuild',
        [
          'build-for-testing',
          '-project', project,
          '-scheme', 'WebDriverAgentRunner',
          '-destination', `id=${this.udid}`,
          '-derivedDataPath', this.derivedDataPath,
        ],
        { timeoutMs: BUILD_TIMEOUT_MS, ...(env ? { env } : {}) },
      );
      // Success writes the log too: the "no .xctestrun appeared" branch cites
      // it, and a later start failure benefits from having the build tail.
      this.writeBuildLog(stdout.toString('utf8'), stderr);
    } catch (err) {
      // xcodebuild puts the compile diagnostics on STDOUT — stderr usually
      // carries little more than "** BUILD FAILED **". Persist both.
      if (err instanceof ExecError) {
        this.writeBuildLog(err.stdout.toString('utf8'), err.stderr || err.message);
      } else {
        this.writeBuildLog('', String(err));
      }
      const timedOut = err instanceof ExecError && err.timedOut;
      throw new Error(
        `WDA build failed (xcodebuild build-for-testing${timedOut ? ', timed out after 10 min' : ''}) ` +
          `— output: ${this.logPath}. ${FIRST_BUILD_NOTE}`,
        { cause: err },
      );
    }
  }

  private writeBuildLog(stdout: string, stderr: string): void {
    const body = stderr.trim() === '' ? stdout : `${stdout}\n--- stderr ---\n${stderr}`;
    try {
      writeFileSync(this.logPath, body);
    } catch {
      /* the failure message still carries the path it would have been */
    }
  }

  private startChild(xctestrun: string, developerEnv: Record<string, string> | undefined): WdaChild {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...developerEnv,
      // xcodebuild forwards TEST_RUNNER_* to the test runner (measured 2026-08-12).
      TEST_RUNNER_USE_PORT: String(this.port),
    };
    // exec.ts is execFile-with-kill-timeout — wrong for a long-running server,
    // hence raw spawn. detached: xcodebuild leads its own process group, which
    // killChild signals as a whole — that reaches xcodebuild and any helper it
    // keeps in its group, NOT the WebDriverAgentRunner in the simulator (a
    // launchd_sim child, its own group; measured 2026-09-18): the runner ends
    // through xcodebuild's test-session teardown, and shutdown() verifies that.
    const fd = openSync(this.logPath, 'w');
    let child: WdaChild;
    try {
      child = this.spawnFn(
        'xcodebuild',
        ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${this.udid}`],
        { env, detached: true, stdio: ['ignore', fd, fd] },
      );
    } finally {
      closeSync(fd); // the child holds its own dup
    }
    this.child = child;
    this.childExited = false;
    this.childError = undefined;
    // Identity guards: a killed child's LATE 'exit'/'error' must not poison
    // the flags of a fresh child spawned by a retry.
    child.once('exit', () => {
      if (this.child === child) this.childExited = true;
    });
    // ENOENT and friends arrive as an 'error' EVENT, not a spawn throw — with
    // no listener that is an uncaught exception that takes the MCP server
    // down, and 'exit' never fires for a failed spawn.
    child.once('error', (err) => {
      if (this.child === child) {
        this.childError = err;
        this.childExited = true;
      }
    });
    // unref keeps the MCP server free to exit. Two hooks cover the child:
    // mcp/lifecycle.ts disposes the registry on SIGTERM/SIGINT/SIGHUP (Node
    // runs no 'exit' hook for a signal) and its process.exit then fires THIS
    // 'exit' hook as the backstop for anything dispose did not reach. Only a
    // SIGKILL runs neither; doEnsureRunning's refusal is what the next session
    // meets then (docs/bugs/2026-09-18-wda-orphan-after-server-restart.md).
    child.unref();
    if (!this.exitHook) {
      this.exitHook = () => this.killChild();
      process.once('exit', this.exitHook);
    }
    return child;
  }

  private async awaitReady(epoch: number, myChild: WdaChild): Promise<void> {
    try {
      const deadline = Date.now() + this.readyTimeoutMs;
      while (Date.now() < deadline) {
        if (this.stopEpoch !== epoch) {
          throw new Error(`WdaServer for ${this.udid} was stopped during startup`);
        }
        if (this.childExited) {
          throw new Error(
            this.childError
              ? `xcodebuild test-without-building failed to start: ${this.childError.message} — ` +
                `xcodebuild log: ${this.logPath}`
              : `xcodebuild test-without-building exited before WDA answered /status — ` +
                `xcodebuild log: ${this.logPath}. ${FIRST_BUILD_NOTE}`,
          );
        }
        if (await this.probeStatus()) {
          this.readyChild = myChild;
          this.readyStarts++;
          return;
        }
        await sleep(this.pollIntervalMs);
      }
      throw new Error(
        `WDA did not answer /status on port ${this.port} within ${formatSeconds(this.readyTimeoutMs)} ` +
          `— xcodebuild log: ${this.logPath}. First install on a fresh simulator is slow. ${FIRST_BUILD_NOTE}`,
      );
    } catch (err) {
      // NO exit path may leak the child we just spawned — timeout, child
      // death, cancellation, AND a probeStatus foreign-server throw all land
      // here. Guarded by identity: stop() may already have killed ours and a
      // newer attempt may own this.child by now.
      if (this.child === myChild) this.killChild();
      throw err;
    }
  }

  private killChild(): void {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    // Both kills only while the child is known alive: once it is reaped its
    // PID is free for reuse, and -pid would then signal a stranger's group.
    if (!this.childExited) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      // detached made xcodebuild a group leader — this reaches its group
      // (xcodebuild itself; helpers it keeps there), not the runner in the
      // simulator — see startChild and shutdown().
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* group already gone */
        }
      }
    }
  }
}


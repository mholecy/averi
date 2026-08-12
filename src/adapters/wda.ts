import { closeSync, openSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';

/**
 * WebDriverAgent lifecycle for one simulator (docs/plans/ios-wda-tree-source.md,
 * Phase 1). WDA ships as the `appium-webdriveragent` devDependency (16.1.7);
 * measured 2026-08-12 on Xcode 26.6 / iOS 26.5:
 * - build once per Xcode version (`xcodebuild build-for-testing`, cached in
 *   DerivedData — the first build takes MINUTES, then it's a no-op),
 * - start per session with `test-without-building`; xcodebuild forwards
 *   TEST_RUNNER_* env to the runner, so TEST_RUNNER_USE_PORT picks the port,
 * - readiness = `GET /status` 200 with
 *   value.build.productBundleIdentifier === com.facebook.WebDriverAgentRunner.
 *
 * Only the tree read lives here; taps/typing/install stay on idb/simctl
 * (WDA input would drag in session management — plan, decision 4).
 */

const WDA_BUNDLE_ID = 'com.facebook.WebDriverAgentRunner';
const STATUS_PROBE_TIMEOUT_MS = 1_000;
const BUILD_TIMEOUT_MS = 600_000;
/** /source on deep trees is the known WDA weakness — Phase 4 measures it. */
const SOURCE_TIMEOUT_MS = 30_000;
/** Post-build: the first app-install on the simulator dominates this. */
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

const FIRST_BUILD_NOTE =
  'Note: the first WDA build per Xcode version takes minutes (cached in DerivedData afterwards).';

/** Structural subset of global fetch — injectable for tests. */
export type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

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
 * is a devDependency: absent in production installs, and a bare resolve error
 * wrapped as a "build failure" would send the user debugging xcodebuild.
 */
export function wdaProjectPath(
  resolvePkg: (id: string) => string = createRequire(import.meta.url).resolve,
): string {
  let pkgJson: string;
  try {
    pkgJson = resolvePkg('appium-webdriveragent/package.json');
  } catch (err) {
    throw new Error(
      'treeSource: wda requires the appium-webdriveragent package (a devDependency, ' +
        'not present in production installs) — `npm i -D appium-webdriveragent@16.1.7`',
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

  private inflight: Promise<void> | undefined;
  private child: WdaChild | undefined;
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
    this.logPath = join(tmpdir(), `averi-wda-${opts.udid}.log`);
  }

  /**
   * Idempotent, single-flight: concurrent callers share one attempt. Cleared
   * on settle — failure makes retry possible, success makes the next call
   * re-verify /status cheaply (self-healing if the server died meanwhile).
   */
  ensureRunning(): Promise<void> {
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
   * GET /source?format=json (sessionless — no WebDriver session needed).
   * Returns the raw WDA envelope `{ value: <root element>, sessionId }`;
   * callers unwrap `.value` (parseWdaSource, Phase 2).
   */
  async source(): Promise<unknown> {
    await this.ensureRunning();
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(`${this.baseUrl()}/source?format=json`, {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
    } catch (err) {
      // A bare "fetch failed"/"TimeoutError" names neither device nor server —
      // keep the log-path contract even for connection-level failures.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `WDA /source request failed on port ${this.port} (udid ${this.udid}): ${reason} — ` +
          `the server may have died mid-session; xcodebuild log: ${this.logPath}`,
        { cause: err },
      );
    }
    if (!res.ok) {
      throw new Error(
        `WDA /source failed: HTTP ${res.status} on port ${this.port} — xcodebuild log: ${this.logPath}`,
      );
    }
    return res.json();
  }

  /** Tolerates not-running; unhooks the process-exit kill. */
  stop(): void {
    this.stopEpoch++;
    if (this.exitHook) {
      process.removeListener('exit', this.exitHook);
      this.exitHook = undefined;
    }
    this.inflight = undefined;
    this.killChild();
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
          `WDA from a previous session (SIGTERM/SIGINT deaths skip the process-exit cleanup hook). ` +
          'Recover: `pkill -f WebDriverAgentRunner`, or reboot the simulator, or pass an explicit `port`.',
      );
    }
    assertNotStopped();
    let xctestrun = await this.findXctestrun();
    assertNotStopped();
    if (!xctestrun) {
      // Loud by design (plan, Risks): a silent multi-minute first build reads
      // as a hang. stderr is the sanctioned channel (server.ts logs there too).
      console.error(
        `averi: first WDA build for this Xcode version — takes minutes, cached afterwards; log: ${this.logPath}`,
      );
      await this.build();
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
   * false = nothing listening (start it); true = something that looks like
   * WDA answered (the caller decides whether it is OURS). Anything else on
   * our port is a foreign server — fail loudly rather than talk to it.
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
        'free the port or pass an explicit `port`.',
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

  private async build(): Promise<void> {
    const project = wdaProjectPath(); // preflight — its failure is a missing-package error, not a build failure
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
    // hence raw spawn. detached: xcodebuild leads its own process group so
    // stop() can take the spawned test runner down with it.
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
    // unref keeps the MCP server free to exit; the exit hook kills the
    // xcodebuild group on the way out so nothing leaks. SIGTERM/SIGINT deaths
    // skip 'exit' hooks, so a WDA can outlive the session — the next session
    // then finds a WDA it did not spawn and fails LOUDLY (see doEnsureRunning)
    // rather than adopting a server that may target another simulator; that
    // error tells the user how to clean up (pkill / reboot the simulator).
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
        if (await this.probeStatus()) return;
        await sleep(this.pollIntervalMs);
      }
      throw new Error(
        `WDA did not answer /status on port ${this.port} within ${Math.round(this.readyTimeoutMs / 1000)}s ` +
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
    if (!this.childExited) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    // detached made xcodebuild a group leader — signal the group so the test
    // runner it spawned dies too.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* group already gone */
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

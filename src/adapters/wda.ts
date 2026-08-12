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
  unref(): void;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; detached: boolean; stdio: ['ignore', number, number] },
) => WdaChild;

const defaultSpawn: SpawnFn = (cmd, args, opts) => nodeSpawn(cmd, args, opts);

/**
 * 8100 + FNV-1a(udid) % 100 — stable per UDID so parallel simulators get
 * distinct WDA ports without coordination. An explicit `port` opt wins.
 */
export function wdaPortFor(udid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < udid.length; i++) {
    h ^= udid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 8100 + ((h >>> 0) % 100);
}

/** require.resolve is unavailable in ESM — createRequire bridges it. */
function wdaProjectPath(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve('appium-webdriveragent/package.json');
  return join(dirname(pkgJson), 'WebDriverAgent.xcodeproj');
}

export interface WdaServerOptions {
  udid: string;
  /** Explicit port; defaults to the per-UDID derivation (wdaPortFor). */
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
  private exitHook: (() => void) | undefined;

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
    const res = await this.fetchFn(`${this.baseUrl()}/source?format=json`, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `WDA /source failed: HTTP ${res.status} on port ${this.port} — xcodebuild log: ${this.logPath}`,
      );
    }
    return res.json();
  }

  /** Tolerates not-running; unhooks the process-exit kill. */
  stop(): void {
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
    if (await this.probeStatus()) return;
    let xctestrun = await this.findXctestrun();
    if (!xctestrun) {
      await this.build();
      xctestrun = await this.findXctestrun();
      if (!xctestrun) {
        throw new Error(
          'xcodebuild build-for-testing succeeded but no ' +
            'WebDriverAgentRunner_iphonesimulator*.xctestrun appeared under ' +
            `${join(this.derivedDataPath, 'Build', 'Products')} — xcodebuild log: ${this.logPath}`,
        );
      }
    }
    await this.startChild(xctestrun);
    await this.awaitReady();
  }

  /**
   * false = nothing listening (start it); true = WDA answered. Anything else
   * on OUR port is a foreign server — fail loudly rather than talk to it.
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
        `WDA ports are derived per UDID (8100 + hash(udid) % 100 → ${this.port} for ${this.udid}); ` +
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
    const env = await detectXcodeEnv(this.exec);
    try {
      await this.exec(
        'xcodebuild',
        [
          'build-for-testing',
          '-project', wdaProjectPath(),
          '-scheme', 'WebDriverAgentRunner',
          '-destination', `id=${this.udid}`,
          '-derivedDataPath', this.derivedDataPath,
        ],
        { timeoutMs: BUILD_TIMEOUT_MS, ...(env ? { env } : {}) },
      );
    } catch (err) {
      const detail = err instanceof ExecError ? err.stderr || err.message : String(err);
      try {
        writeFileSync(this.logPath, detail);
      } catch {
        /* the message below still carries the path it would have been */
      }
      const timedOut = err instanceof ExecError && err.timedOut;
      throw new Error(
        `WDA build failed (xcodebuild build-for-testing${timedOut ? ', timed out after 10 min' : ''}) ` +
          `— output: ${this.logPath}. ${FIRST_BUILD_NOTE}`,
        { cause: err },
      );
    }
  }

  private async startChild(xctestrun: string): Promise<void> {
    const developerEnv = await detectXcodeEnv(this.exec);
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
    child.once('exit', () => {
      this.childExited = true;
    });
    // unref keeps the MCP server free to exit; the exit hook kills the
    // xcodebuild group on the way out so nothing leaks.
    child.unref();
    if (!this.exitHook) {
      this.exitHook = () => this.killChild();
      process.once('exit', this.exitHook);
    }
  }

  private async awaitReady(): Promise<void> {
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.childExited) {
        throw new Error(
          `xcodebuild test-without-building exited before WDA answered /status — ` +
            `xcodebuild log: ${this.logPath}. ${FIRST_BUILD_NOTE}`,
        );
      }
      if (await this.probeStatus()) return;
      await sleep(this.pollIntervalMs);
    }
    this.killChild();
    throw new Error(
      `WDA did not answer /status on port ${this.port} within ${Math.round(this.readyTimeoutMs / 1000)}s ` +
        `— xcodebuild log: ${this.logPath}. First install on a fresh simulator is slow. ${FIRST_BUILD_NOTE}`,
    );
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

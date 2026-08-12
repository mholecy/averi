import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetWdaPortAllocatorForTests,
  WdaServer,
  wdaPortFor,
  wdaProjectPath,
  type FetchFn,
  type SpawnFn,
  type WdaChild,
} from '../../src/adapters/wda.js';
import { ExecError, type ExecFn, type ExecResult } from '../../src/adapters/exec.js';

const WDA_STATUS = {
  value: { build: { productBundleIdentifier: 'com.facebook.WebDriverAgentRunner' } },
  sessionId: null,
};

const IMPOSTER_STATUS = {
  value: { build: { productBundleIdentifier: 'com.example.something-else' } },
};

function fakeExec(onCall?: (full: string) => Promise<void> | void) {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    await onCall?.(full);
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
}

/** handler returns 'refused' (nothing listening) or an HTTP response. */
function fakeFetch(handler: (url: string) => 'refused' | { status: number; body?: unknown }) {
  const urls: string[] = [];
  const fn: FetchFn = async (url) => {
    urls.push(url);
    const r = handler(url);
    if (r === 'refused') throw new Error('ECONNREFUSED');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fn, urls };
}

interface FakeChildListeners {
  exit: Array<() => void>;
  error: Array<(err: Error) => void>;
}

function fakeSpawn(opts: { spawnError?: Error } = {}) {
  const spawns: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const kills: string[] = [];
  const children: FakeChildListeners[] = [];
  const fn: SpawnFn = (cmd, args, o) => {
    const listeners: FakeChildListeners = { exit: [], error: [] };
    children.push(listeners);
    spawns.push({ cmd, args, env: o.env });
    if (opts.spawnError) {
      // node delivers ENOENT as an async 'error' EVENT, never a spawn throw.
      setTimeout(() => listeners.error.forEach((l) => l(opts.spawnError!)), 0);
    }
    const child: WdaChild = {
      // pid stays undefined so killChild never signals a real process group.
      pid: undefined,
      kill: (signal) => {
        kills.push(signal ?? 'SIGTERM');
        return true;
      },
      once: ((event: 'exit' | 'error', listener: (...args: never[]) => void) => {
        if (event === 'exit') listeners.exit.push(listener as () => void);
        else listeners.error.push(listener as (err: Error) => void);
        return undefined;
      }) as WdaChild['once'],
      unref: () => undefined,
    };
    return child;
  };
  return { fn, spawns, kills, children };
}

async function tempDerivedData(withXctestrun = false): Promise<{ dd: string; products: string; xctestrun: string }> {
  const dd = await mkdtemp(join(tmpdir(), 'averi-wda-test-'));
  const products = join(dd, 'Build', 'Products');
  const xctestrun = join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun');
  if (withXctestrun) {
    await mkdir(products, { recursive: true });
    await writeFile(xctestrun, '');
  }
  return { dd, products, xctestrun };
}

describe('wdaPortFor / port selection', () => {
  it('allocates sequential ports from 8100 — first UDID 8100, second 8101', () => {
    resetWdaPortAllocatorForTests();
    expect(wdaPortFor('AAAA-1111')).toBe(8100);
    expect(wdaPortFor('BBBB-2222')).toBe(8101);
    expect(wdaPortFor('CCCC-3333')).toBe(8102);
  });

  it('same UDID always gets the same port back', () => {
    resetWdaPortAllocatorForTests();
    expect(wdaPortFor('AAAA-1111')).toBe(wdaPortFor('AAAA-1111'));
    expect(new WdaServer({ udid: 'AAAA-1111' }).port).toBe(wdaPortFor('AAAA-1111'));
  });

  it('distinct UDIDs can NEVER share a port (the old hash collided ~1% per pair)', () => {
    resetWdaPortAllocatorForTests();
    const ports = Array.from({ length: 150 }, (_, i) => wdaPortFor(`UDID-${i}`));
    expect(new Set(ports).size).toBe(150);
  });

  it('an explicit port wins over the allocator', () => {
    expect(new WdaServer({ udid: 'AAAA-1111', port: 9100 }).port).toBe(9100);
  });
});

describe('wdaProjectPath', () => {
  it('resolves the installed appium-webdriveragent project', () => {
    expect(wdaProjectPath()).toContain('WebDriverAgent.xcodeproj');
  });

  it('a missing package is its own error with the install command, not a build failure', () => {
    const failingResolve = () => {
      throw new Error("Cannot find module 'appium-webdriveragent/package.json'");
    };
    expect(() => wdaProjectPath(failingResolve)).toThrow(/npm i -D appium-webdriveragent@16\.1\.7/);
    expect(() => wdaProjectPath(failingResolve)).toThrow(/treeSource: wda/);
  });
});

describe('WdaServer.ensureRunning', () => {
  it('an answering WDA this session did NOT spawn is a loud error, never adopted', async () => {
    // /status carries no UDID — a stale WDA from a killed session (or another
    // device's server on this port) passes the bundle-id check. Adopting it
    // could deliver the wrong device's tree, so only OUR child counts.
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() => ({ status: 200, body: WDA_STATUS }));
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('did not start it');
    expect(err?.message).toContain(String(server.port));
    expect(err?.message).toContain('AAAA-1111');
    expect(err?.message).toContain('pkill -f WebDriverAgentRunner');
    expect(spawner.spawns).toHaveLength(0);
  });

  it('reuses OUR running server: one spawn, the second ensureRunning fast-paths on /status', async () => {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    await server.ensureRunning();
    await server.ensureRunning();
    expect(spawner.spawns).toHaveLength(1);
    server.stop();
  });

  it('single-flight: concurrent callers share one attempt (one spawn)', async () => {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    await Promise.all([server.ensureRunning(), server.ensureRunning()]);
    expect(spawner.spawns).toHaveLength(1);
    server.stop();
  });

  it('fails loudly when a non-WDA server answers on the allocated port', async () => {
    const fetcher = fakeFetch(() => ({ status: 200, body: IMPOSTER_STATUS }));
    const server = new WdaServer({ udid: 'AAAA-1111', fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('not WebDriverAgent');
    expect(err?.message).toContain(String(server.port));
    expect(err?.message).toContain('allocated per UDID');
  });

  it('skips the build when an xctestrun exists, and starts with TEST_RUNNER_USE_PORT', async () => {
    const { dd, xctestrun } = await tempDerivedData(true);

    const exec = fakeExec();
    const spawner = fakeSpawn();
    // Nothing listening until our child is spawned, then WDA answers.
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    await server.ensureRunning();

    expect(exec.calls.filter((c) => c.startsWith('xcodebuild build-for-testing'))).toHaveLength(0);
    expect(spawner.spawns).toHaveLength(1);
    const spawn = spawner.spawns[0];
    expect(spawn.cmd).toBe('xcodebuild');
    expect(spawn.args).toEqual([
      'test-without-building', '-xctestrun', xctestrun, '-destination', 'id=AAAA-1111',
    ]);
    expect(spawn.env.TEST_RUNNER_USE_PORT).toBe(String(server.port));
    server.stop();
  });

  it('builds first when no xctestrun exists, announcing the first-build cost on stderr', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dd, products } = await tempDerivedData();
    const exec = fakeExec(async (full) => {
      if (full.startsWith('xcodebuild build-for-testing')) {
        await mkdir(products, { recursive: true });
        await writeFile(join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun'), '');
      }
    });
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    await server.ensureRunning();

    const build = exec.calls.find((c) => c.startsWith('xcodebuild build-for-testing'));
    expect(build).toBeDefined();
    expect(build).toContain('WebDriverAgent.xcodeproj');
    expect(build).toContain('-scheme WebDriverAgentRunner');
    expect(build).toContain(`-derivedDataPath ${dd}`);
    expect(build).toContain('-destination id=AAAA-1111');
    expect(spawner.spawns).toHaveLength(1);
    // The plan's Risks section: a silent multi-minute build reads as a hang.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('first WDA build'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining(server.logPath));
    server.stop();
    errSpy.mockRestore();
  });

  it('a failed build writes stdout AND stderr to logPath — xcodebuild diagnostics live on stdout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dd } = await tempDerivedData();
    const exec: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('xcodebuild build-for-testing')) {
        throw new ExecError(
          full, 65, '** BUILD FAILED **', false,
          Buffer.from("WebDriverAgent.m:12:8: error: cannot find 'FBConfiguration' in scope"),
        );
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const server = new WdaServer({
      udid: 'BUILD-FAIL-1', exec, fetchFn: fakeFetch(() => 'refused').fn,
      spawnFn: fakeSpawn().fn, derivedDataPath: dd,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('WDA build failed');
    expect(err?.message).toContain(server.logPath);
    const log = await readFile(server.logPath, 'utf8');
    expect(log).toContain("cannot find 'FBConfiguration' in scope");
    expect(log).toContain('** BUILD FAILED **');
    vi.restoreAllMocks();
  });

  it('build "succeeded" with no xctestrun: the cited logPath actually holds the build output', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dd } = await tempDerivedData();
    const exec: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('xcodebuild build-for-testing')) {
        return { stdout: Buffer.from('** BUILD SUCCEEDED ** (but wrote nowhere)'), stderr: 'a warning' };
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const server = new WdaServer({
      udid: 'BUILD-EMPTY-1', exec, fetchFn: fakeFetch(() => 'refused').fn,
      spawnFn: fakeSpawn().fn, derivedDataPath: dd,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('no WebDriverAgentRunner_iphonesimulator*.xctestrun appeared');
    expect(err?.message).toContain(server.logPath);
    const log = await readFile(server.logPath, 'utf8');
    expect(log).toContain('** BUILD SUCCEEDED **');
    expect(log).toContain('a warning');
    vi.restoreAllMocks();
  });

  it('picks the newest xctestrun by mtime when several SDK versions coexist', async () => {
    const { dd, products } = await tempDerivedData();
    await mkdir(products, { recursive: true });
    const older = join(products, 'WebDriverAgentRunner_iphonesimulator18.2-arm64.xctestrun');
    const newer = join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun');
    await writeFile(older, '');
    await writeFile(newer, '');
    await utimes(older, new Date('2025-01-01'), new Date('2025-01-01'));
    await utimes(newer, new Date('2026-08-12'), new Date('2026-08-12'));

    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    await server.ensureRunning();
    expect(spawner.spawns[0].args).toContain(newer);
    server.stop();
  });

  it('readiness timeout names the xcodebuild log path and the first-build cost', async () => {
    const { dd } = await tempDerivedData(true);

    const spawner = fakeSpawn();
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: spawner.fn,
      fetchFn: fakeFetch(() => 'refused').fn,
      derivedDataPath: dd, readyTimeoutMs: 40, pollIntervalMs: 5,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain(server.logPath);
    expect(err?.message).toContain('first WDA build per Xcode version takes minutes');
    expect(spawner.kills).toContain('SIGTERM'); // no orphaned xcodebuild
    server.stop();
  });

  it('a failed attempt clears the single-flight so a retry is possible', async () => {
    const { dd } = await tempDerivedData(true);

    const spawner = fakeSpawn();
    // First spawned server never answers (times out); the retry's does.
    const fetcher = fakeFetch(() =>
      spawner.spawns.length < 2 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: spawner.fn, fetchFn: fetcher.fn,
      derivedDataPath: dd, readyTimeoutMs: 30, pollIntervalMs: 5,
    });
    await expect(server.ensureRunning()).rejects.toThrow(/xcodebuild log/);
    await expect(server.ensureRunning()).resolves.toBeUndefined();
    expect(spawner.spawns).toHaveLength(2);
    server.stop();
  });

  it('stop() during the build cancels the attempt: no spawn, loud rejection, restart works', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dd, products } = await tempDerivedData();
    let releaseBuild!: () => void;
    const buildGate = new Promise<void>((r) => { releaseBuild = r; });
    let signalBuildStarted!: () => void;
    const buildStarted = new Promise<void>((r) => { signalBuildStarted = r; });
    const exec = fakeExec(async (full) => {
      if (full.startsWith('xcodebuild build-for-testing')) {
        signalBuildStarted();
        await buildGate; // a real first build takes minutes — plenty of room for stop()
        await mkdir(products, { recursive: true });
        await writeFile(join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun'), '');
      }
    });
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });

    const attempt = server.ensureRunning();
    await buildStarted;
    server.stop(); // device deselected mid-build
    releaseBuild();
    const err = await attempt.then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('stopped during startup');
    expect(spawner.spawns).toHaveLength(0); // the whole point: nothing leaks for a deselected device

    // A stopped server may be legitimately restarted.
    await expect(server.ensureRunning()).resolves.toBeUndefined();
    expect(spawner.spawns).toHaveLength(1);
    server.stop();
    vi.restoreAllMocks();
  });

  it("a spawn 'error' (ENOENT) rejects ensureRunning with the error named — not an uncaught crash", async () => {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn({ spawnError: new Error('spawn xcodebuild ENOENT') });
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: spawner.fn,
      fetchFn: fakeFetch(() => 'refused').fn,
      derivedDataPath: dd, readyTimeoutMs: 5_000, pollIntervalMs: 5,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('failed to start');
    expect(err?.message).toContain('spawn xcodebuild ENOENT');
    expect(err?.message).toContain(server.logPath);
    server.stop();
  });

  it("a killed child's LATE 'exit' does not poison the retry's fresh child", async () => {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    let statusCalls = 0;
    const fetcher = fakeFetch((url) => {
      if (!url.endsWith('/status')) return { status: 200, body: {} };
      statusCalls++;
      if (statusCalls === 1) return 'refused'; // attempt 1, pre-spawn
      if (statusCalls === 2) return { status: 200, body: IMPOSTER_STATUS }; // attempt 1 dies, child 1 killed
      if (statusCalls === 3) return 'refused'; // attempt 2, pre-spawn
      if (statusCalls === 4) {
        // child 1's SIGTERM finally lands mid-way through attempt 2's polling
        spawner.children[0].exit.forEach((l) => l());
        return 'refused';
      }
      return { status: 200, body: WDA_STATUS };
    });
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: spawner.fn, fetchFn: fetcher.fn,
      derivedDataPath: dd, readyTimeoutMs: 5_000, pollIntervalMs: 5,
    });
    await expect(server.ensureRunning()).rejects.toThrow(/not WebDriverAgent/);
    // Without the listener identity guard this rejects with "exited before WDA answered".
    await expect(server.ensureRunning()).resolves.toBeUndefined();
    expect(spawner.spawns).toHaveLength(2);
    server.stop();
  });

  it('a foreign server appearing mid-poll kills the just-spawned child before rethrowing', async () => {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    // Nothing listening pre-spawn; after OUR spawn, an imposter answers —
    // probeStatus throws from inside awaitReady's poll loop.
    const fetcher = fakeFetch(() =>
      spawner.spawns.length === 0 ? 'refused' : { status: 200, body: IMPOSTER_STATUS },
    );
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: spawner.fn, fetchFn: fetcher.fn,
      derivedDataPath: dd, readyTimeoutMs: 5_000, pollIntervalMs: 5,
    });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('not WebDriverAgent');
    expect(spawner.kills).toContain('SIGTERM'); // the child we spawned did not leak
    server.stop();
  });
});

describe('WdaServer.source', () => {
  /** A server that reached ready through OUR OWN spawn (adoption is an error now). */
  async function readySetup(sourceHandler: (url: string) => 'refused' | { status: number; body?: unknown }) {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch((url) => {
      if (url.endsWith('/status')) {
        return spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS };
      }
      return sourceHandler(url);
    });
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
      derivedDataPath: dd, pollIntervalMs: 5,
    });
    return { server, fetcher };
  }

  it('GETs /source?format=json and returns the {value, sessionId} envelope', async () => {
    const envelope = {
      value: { type: 'XCUIElementTypeApplication', label: 'MyPort', children: [] },
      sessionId: 'abc-123',
    };
    const { server, fetcher } = await readySetup(() => ({ status: 200, body: envelope }));
    await expect(server.source()).resolves.toEqual(envelope);
    expect(fetcher.urls.at(-1)).toBe(`http://127.0.0.1:${server.port}/source?format=json`);
    server.stop();
  });

  it('surfaces a non-200 /source with the port and log path', async () => {
    const { server } = await readySetup(() => ({ status: 500, body: {} }));
    const err = await server.source().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('HTTP 500');
    expect(err?.message).toContain(server.logPath);
    server.stop();
  });

  it('a network-level /source failure names the udid, port, and log path — never a bare "fetch failed"', async () => {
    const { server } = await readySetup(() => 'refused');
    const err = await server.source().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('ECONNREFUSED');
    expect(err?.message).toContain('AAAA-1111');
    expect(err?.message).toContain(String(server.port));
    expect(err?.message).toContain(server.logPath);
    server.stop();
  });
});

describe('WdaServer.stop', () => {
  it('tolerates never having started', () => {
    expect(() => new WdaServer({ udid: 'AAAA-1111' }).stop()).not.toThrow();
  });
});

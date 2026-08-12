import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WdaServer, wdaPortFor, type FetchFn, type SpawnFn } from '../../src/adapters/wda.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';

const WDA_STATUS = {
  value: { build: { productBundleIdentifier: 'com.facebook.WebDriverAgentRunner' } },
  sessionId: null,
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

function fakeSpawn() {
  const spawns: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const kills: string[] = [];
  // pid stays undefined so killChild never signals a real process group.
  const fn: SpawnFn = (cmd, args, opts) => {
    spawns.push({ cmd, args, env: opts.env });
    return {
      pid: undefined,
      kill: (signal) => {
        kills.push(signal ?? 'SIGTERM');
        return true;
      },
      once: () => undefined,
      unref: () => undefined,
    };
  };
  return { fn, spawns, kills };
}

async function tempDerivedData(): Promise<{ dd: string; products: string }> {
  const dd = await mkdtemp(join(tmpdir(), 'averi-wda-test-'));
  const products = join(dd, 'Build', 'Products');
  return { dd, products };
}

describe('wdaPortFor / port selection', () => {
  it('derives a stable per-UDID port in [8100, 8200)', () => {
    expect(wdaPortFor('AAAA-1111')).toBe(wdaPortFor('AAAA-1111'));
    expect(wdaPortFor('AAAA-1111')).toBeGreaterThanOrEqual(8100);
    expect(wdaPortFor('AAAA-1111')).toBeLessThan(8200);
  });

  it('distinct UDIDs get distinct ports so parallel simulators do not collide', () => {
    expect(wdaPortFor('AAAA-1111')).not.toBe(wdaPortFor('BBBB-2222'));
    expect(new WdaServer({ udid: 'AAAA-1111' }).port).toBe(wdaPortFor('AAAA-1111'));
  });

  it('an explicit port wins over the derivation', () => {
    expect(new WdaServer({ udid: 'AAAA-1111', port: 9100 }).port).toBe(9100);
  });
});

describe('WdaServer.ensureRunning', () => {
  it('fast path: an already-running WDA means no build, no spawn', async () => {
    const exec = fakeExec();
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() => ({ status: 200, body: WDA_STATUS }));
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
    });
    await server.ensureRunning();
    expect(spawner.spawns).toHaveLength(0);
    expect(exec.calls.filter((c) => c.startsWith('xcodebuild'))).toHaveLength(0);
    expect(fetcher.urls[0]).toBe(`http://127.0.0.1:${server.port}/status`);
  });

  it('single-flight: concurrent callers share one attempt', async () => {
    const fetcher = fakeFetch(() => ({ status: 200, body: WDA_STATUS }));
    const server = new WdaServer({ udid: 'AAAA-1111', fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn });
    await Promise.all([server.ensureRunning(), server.ensureRunning()]);
    expect(fetcher.urls).toHaveLength(1);
  });

  it('fails loudly when a non-WDA server answers on the derived port', async () => {
    const fetcher = fakeFetch(() => ({
      status: 200,
      body: { value: { build: { productBundleIdentifier: 'com.example.something-else' } } },
    }));
    const server = new WdaServer({ udid: 'AAAA-1111', fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn });
    const err = await server.ensureRunning().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('not WebDriverAgent');
    expect(err?.message).toContain(String(server.port));
    expect(err?.message).toContain('8100 + hash(udid) % 100');
  });

  it('skips the build when an xctestrun exists, and starts with TEST_RUNNER_USE_PORT', async () => {
    const { dd, products } = await tempDerivedData();
    await mkdir(products, { recursive: true });
    const xctestrun = join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun');
    await writeFile(xctestrun, '');

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

  it('builds first when no xctestrun exists', async () => {
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
    server.stop();
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
    const { dd, products } = await tempDerivedData();
    await mkdir(products, { recursive: true });
    await writeFile(join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun'), '');

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
    const { dd, products } = await tempDerivedData();
    await mkdir(products, { recursive: true });
    await writeFile(join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun'), '');

    let up = false;
    const server = new WdaServer({
      udid: 'AAAA-1111', exec: fakeExec().fn, spawnFn: fakeSpawn().fn,
      fetchFn: fakeFetch(() => (up ? { status: 200, body: WDA_STATUS } : 'refused')).fn,
      derivedDataPath: dd, readyTimeoutMs: 20, pollIntervalMs: 5,
    });
    await expect(server.ensureRunning()).rejects.toThrow(/xcodebuild log/);
    up = true;
    await expect(server.ensureRunning()).resolves.toBeUndefined();
    server.stop();
  });
});

describe('WdaServer.source', () => {
  it('GETs /source?format=json and returns the {value, sessionId} envelope', async () => {
    const envelope = {
      value: { type: 'XCUIElementTypeApplication', label: 'MyPort', children: [] },
      sessionId: 'abc-123',
    };
    const fetcher = fakeFetch((url) =>
      url.endsWith('/status') ? { status: 200, body: WDA_STATUS } : { status: 200, body: envelope },
    );
    const server = new WdaServer({ udid: 'AAAA-1111', fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn });
    await expect(server.source()).resolves.toEqual(envelope);
    expect(fetcher.urls.at(-1)).toBe(`http://127.0.0.1:${server.port}/source?format=json`);
  });

  it('surfaces a non-200 /source with the port and log path', async () => {
    const fetcher = fakeFetch((url) =>
      url.endsWith('/status') ? { status: 200, body: WDA_STATUS } : { status: 500, body: {} },
    );
    const server = new WdaServer({ udid: 'AAAA-1111', fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn });
    const err = await server.source().then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('HTTP 500');
    expect(err?.message).toContain(server.logPath);
  });
});

describe('WdaServer.stop', () => {
  it('tolerates never having started', () => {
    expect(() => new WdaServer({ udid: 'AAAA-1111' }).stop()).not.toThrow();
  });
});

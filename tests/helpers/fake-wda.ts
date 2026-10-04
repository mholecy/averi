import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchFn, SpawnFn, WdaChild } from '../../src/adapters/wda.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';

/**
 * The fakes that drive WdaServer without xcodebuild, a simulator or a socket:
 * an exec that records, a fetch scripted per URL, a spawn whose child never
 * has a pid (so nothing real is ever signalled), and a DerivedData directory
 * with or without an .xctestrun. Shared by wda.test.ts (the server) and
 * wda-tree-source.test.ts (the adapter at the tree-source seam that owns one)
 * so the seam's tests exercise the REAL WdaServer through the same fakes.
 */
export const WDA_STATUS = {
  value: { build: { productBundleIdentifier: 'com.facebook.WebDriverAgentRunner' } },
  sessionId: null,
};

export const IMPOSTER_STATUS = {
  value: { build: { productBundleIdentifier: 'com.example.something-else' } },
};

export function fakeExec(onCall?: (full: string) => Promise<void> | void) {
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
export function fakeFetch(handler: (url: string) => 'refused' | { status: number; body?: unknown }) {
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

export function fakeSpawn(opts: { spawnError?: Error } = {}) {
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

export async function tempDerivedData(withXctestrun = false): Promise<{ dd: string; products: string; xctestrun: string }> {
  const dd = await mkdtemp(join(tmpdir(), 'averi-wda-test-'));
  const products = join(dd, 'Build', 'Products');
  const xctestrun = join(products, 'WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun');
  if (withXctestrun) {
    await mkdir(products, { recursive: true });
    await writeFile(xctestrun, '');
  }
  return { dd, products, xctestrun };
}

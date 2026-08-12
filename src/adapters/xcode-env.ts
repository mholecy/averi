import { existsSync } from 'node:fs';
import { exec as defaultExec, type ExecFn } from './exec.js';

/**
 * simctl/idb/xcodebuild need xcode-select to point at Xcode, but many machines
 * point at CommandLineTools. Probe once; if broken and Xcode exists at the
 * default location, inject DEVELOPER_DIR instead of requiring sudo.
 *
 * Memoized per ExecFn (WeakMap), so the probe runs once per process for the
 * real exec while tests get a fresh probe per fake.
 */
const memo = new WeakMap<ExecFn, Promise<Record<string, string> | undefined>>();

export function detectXcodeEnv(exec: ExecFn = defaultExec): Promise<Record<string, string> | undefined> {
  let promise = memo.get(exec);
  if (!promise) {
    promise = probe(exec);
    memo.set(exec, promise);
  }
  return promise;
}

async function probe(exec: ExecFn): Promise<Record<string, string> | undefined> {
  if (process.env.DEVELOPER_DIR) return undefined;
  try {
    await exec('xcrun', ['--find', 'simctl']);
    return undefined;
  } catch {
    const xcode = '/Applications/Xcode.app/Contents/Developer';
    if (existsSync(xcode)) return { DEVELOPER_DIR: xcode };
    throw new Error(
      'simctl not found: xcode-select points at CommandLineTools and no ' +
        '/Applications/Xcode.app — install Xcode or run ' +
        '`sudo xcode-select -s /path/to/Xcode.app/Contents/Developer`',
    );
  }
}

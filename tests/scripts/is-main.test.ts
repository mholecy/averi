import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMain } from '../../scripts/is-main.js';

// scripts/is-main.ts: the one entry guard every script runs `main` behind (D46). Node resolves symlinks in
// import.meta.url but not in process.argv[1], so a guard that compares the two as given does nothing when a script is
// started through a symlink (/tmp → /private/tmp on macOS, a symlinked checkout) — and exits 0, a silent pass.

const SCRIPTS = fileURLToPath(new URL('../../scripts/', import.meta.url));

describe('isMain — is this module the script node was started with?', () => {
  let dir: string;
  const argv1 = process.argv[1];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'averi-is-main-'));
  });
  afterEach(() => {
    process.argv[1] = argv1!;
    rmSync(dir, { recursive: true, force: true });
  });
  const file = (path: string): string => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
    return path;
  };

  it('started by its own path: yes; started as another script: no', () => {
    const script = file(join(dir, 'a.ts'));
    process.argv[1] = script;
    expect(isMain(pathToFileURL(script).href)).toBe(true);
    expect(isMain(pathToFileURL(file(join(dir, 'b.ts'))).href)).toBe(false);
  });

  it('started through a symlink to it, or through a symlinked directory: yes', () => {
    const script = file(join(dir, 'real', 'a.ts'));
    symlinkSync(script, join(dir, 'link.ts'));
    symlinkSync(join(dir, 'real'), join(dir, 'checkout'));
    process.argv[1] = join(dir, 'link.ts');
    expect(isMain(pathToFileURL(script).href)).toBe(true);
    process.argv[1] = join(dir, 'checkout', 'a.ts');
    expect(isMain(pathToFileURL(script).href)).toBe(true);
  });

  it('a path that needs URL encoding (a space, non-ASCII): yes — import.meta.url is percent-encoded, argv[1] is not', () => {
    const script = file(join(dir, 'my scripts', 'čaj.ts'));
    process.argv[1] = script;
    expect(pathToFileURL(script).href).not.toBe(`file://${script}`);
    expect(isMain(pathToFileURL(script).href)).toBe(true);
  });

  it('no argv[1] (a REPL, node -e), or one that does not exist: no, never a throw', () => {
    const script = file(join(dir, 'a.ts'));
    process.argv.length = 1;
    expect(isMain(pathToFileURL(script).href)).toBe(false);
    process.argv[1] = join(dir, 'missing.ts');
    expect(isMain(pathToFileURL(script).href)).toBe(false);
  });

  it('a real script started through a symlink runs: stalls.ts without files fails with its usage, never exits 0 idle', () => {
    symlinkSync(join(SCRIPTS, 'perf', 'stalls.ts'), join(dir, 'stalls.ts'));
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(dir, 'stalls.ts')], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage: stalls.ts');
  });
});

describe('the scripts guard their entry with isMain, and only with it', () => {
  it('no script under scripts/ reads process.argv[1] itself', () => {
    const own = readdirSync(SCRIPTS, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && f !== 'is-main.ts')
      .filter((f) => readFileSync(join(SCRIPTS, f), 'utf8').includes('process.argv[1]'));
    expect(own).toEqual([]);
  });
});

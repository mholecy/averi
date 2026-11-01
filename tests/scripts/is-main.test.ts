import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMain } from '../../scripts/is-main.js';

// scripts/is-main.ts: the one entry guard every script runs `main` behind (D46; why real paths: its doc comment).

const SCRIPTS = fileURLToPath(new URL('../../scripts/', import.meta.url));
/** isMain as the module at path `p` calls it: with its import.meta.url. */
const mainAt = (p: string): boolean => isMain(pathToFileURL(p).href);

describe('isMain — is this module the script node was started with?', () => {
  let dir: string;
  const argv = [...process.argv];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'averi-is-main-'));
  });
  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...argv);
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
    expect(mainAt(script)).toBe(true);
    expect(mainAt(file(join(dir, 'b.ts')))).toBe(false);
  });

  it('started through a symlink to it, or through a symlinked directory: yes', () => {
    const script = file(join(dir, 'real', 'a.ts'));
    symlinkSync(script, join(dir, 'link.ts'));
    symlinkSync(join(dir, 'real'), join(dir, 'checkout'));
    process.argv[1] = join(dir, 'link.ts');
    expect(mainAt(script)).toBe(true);
    process.argv[1] = join(dir, 'checkout', 'a.ts');
    expect(mainAt(script)).toBe(true);
  });

  it('a module URL through a symlink, argv[1] the real path: yes — real paths on the URL side too, on any platform', () => {
    const script = file(join(dir, 'real', 'a.ts'));
    symlinkSync(script, join(dir, 'link.ts'));
    process.argv[1] = script;
    expect(mainAt(join(dir, 'link.ts'))).toBe(true);
  });

  it('a path that needs URL encoding (a space, non-ASCII): yes — import.meta.url is percent-encoded, argv[1] is not', () => {
    const script = file(join(dir, 'my scripts', 'čaj.ts'));
    process.argv[1] = script;
    expect(pathToFileURL(script).href).not.toBe(`file://${script}`);
    expect(mainAt(script)).toBe(true);
  });

  it('no argv[1] (a REPL, node -e), or one that does not exist: no, never a throw', () => {
    const script = file(join(dir, 'a.ts'));
    process.argv.length = 1;
    expect(mainAt(script)).toBe(false);
    process.argv[1] = join(dir, 'missing.ts');
    expect(mainAt(script)).toBe(false);
  });

  it('a real script started through a symlink runs: stalls.ts without files fails with its usage, never exits 0 idle', () => {
    symlinkSync(join(SCRIPTS, 'perf', 'stalls.ts'), join(dir, 'stalls.ts'));
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(dir, 'stalls.ts')], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage: stalls.ts');
  });
});

describe('the scripts guard their entry with isMain, and only with it', () => {
  const scripts = readdirSync(SCRIPTS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && f !== 'is-main.ts');
  const source = (f: string): string => readFileSync(join(SCRIPTS, f), 'utf8');

  it('each entry script runs behind isMain(import.meta.url)', () => {
    const entries = ['differential/convert.ts', 'differential/golden.ts', 'mutation/mutate.ts', 'perf/stalls.ts', 'truth/calibrate.ts', 'truth/capture.ts', 'truth/catalog.ts'];
    expect(entries.filter((f) => !source(f).includes('if (isMain(import.meta.url))'))).toEqual([]);
  });

  it('no script reads its own path from process.argv — argv[1], argv.at(1), or a destructuring of argv', () => {
    const own = /process\.argv(\[1\]|\.at\(1\))|(const|let|var)\s*[[{][^=;]*[\]}]\s*=\s*process\.argv\b/;
    expect(scripts.filter((f) => own.test(source(f)))).toEqual([]);
  });
});

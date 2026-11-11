import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE.md's layering, for mcp/ (A16): the composition root (mcp/registry.ts) chooses by platform and so imports
 * the platform adapters; every other mcp/ module reads adapters/ through its platform-neutral modules only — the
 * DeviceAdapter interface and its types (adapters/types.ts), never a platform module. A constant a tool description
 * quotes lives where both may read it (FOREGROUND_WAIT_MS in adapters/types.ts, not adapters/ios-foreground.ts).
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const ADAPTERS = join(SRC, 'adapters');
const MCP = join(SRC, 'mcp');
const COMPOSITION_ROOT = join(MCP, 'registry.ts');

/** A platform module: one named for the platform or a tool of it (ios*.ts, android*.ts, idb*, wda*, adb*, simctl*, …). */
const PLATFORM = /^(ios|android|idb|wda|adb|simctl|simulator|xcode)(?:-|\.)/;
const isPlatformModule = (file: string): boolean => dirname(file) === ADAPTERS && PLATFORM.test(basename(file));

/** Every module specifier a file names: static imports and re-exports (one or many lines), bare imports, `import()`. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\bfrom\s+'([^']+)'|\bimport\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'\s*\)/g)) found.push(m[1] ?? m[2] ?? m[3]!);
  return found;
}

/** The src files a module imports, resolved (`.js` → `.ts`). */
const importsOf = (file: string): string[] =>
  specifiers(readFileSync(file, 'utf8'))
    .filter((s) => s.startsWith('.'))
    .map((s) => resolve(dirname(file), s).replace(/\.js$/, '.ts'));

const rel = (file: string): string => relative(SRC, file);

describe('mcp/ imports no platform module outside its composition root (ARCHITECTURE.md, A16)', () => {
  const modules = readdirSync(MCP, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(MCP, f));

  it('the check sees what it guards: the composition root imports the platform adapters, the classifier names them', () => {
    expect(modules).toContain(COMPOSITION_ROOT);
    const platform = importsOf(COMPOSITION_ROOT).filter(isPlatformModule).map(rel);
    expect(platform).toEqual(expect.arrayContaining(['adapters/ios.ts', 'adapters/android.ts']));
    expect(isPlatformModule(join(ADAPTERS, 'ios-foreground.ts'))).toBe(true);
    expect(isPlatformModule(join(ADAPTERS, 'types.ts'))).toBe(false);
  });

  it('no other mcp/ module imports one', () => {
    const offending = modules
      .filter((m) => m !== COMPOSITION_ROOT)
      .flatMap((m) => importsOf(m).filter(isPlatformModule).map((target) => `${rel(m)} -> ${rel(target)}`));
    expect(offending).toEqual([]);
  });
});

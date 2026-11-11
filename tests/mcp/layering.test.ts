import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE.md's layering, for mcp/ (A16): the composition root (mcp/registry.ts) chooses by platform and so
 * imports the platform adapters; every other mcp/ module reads adapters/ through the platform-neutral modules in
 * NEUTRAL only — today the DeviceAdapter interface and its types (adapters/types.ts). A constant a tool description
 * quotes lives where both may read it (FOREGROUND_WAIT_MS in adapters/types.ts, not adapters/ios-foreground.ts).
 *
 * Fail closed: any other adapters/ module counts as platform code, whatever its name (discovery.ts lists simctl's and
 * adb's devices; input-text.ts and screenshot-bytes.ts are a platform's too). Adding a neutral leaf takes a deliberate
 * entry in NEUTRAL, with its reason beside it.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const ADAPTERS = join(SRC, 'adapters');
const MCP = join(SRC, 'mcp');
const COMPOSITION_ROOT = join(MCP, 'registry.ts');

/** The adapters/ modules mcp/ may read outside its composition root, each with its reason. */
const NEUTRAL: ReadonlySet<string> = new Set([
  join(ADAPTERS, 'types.ts'), // the DeviceAdapter interface, its types and the constants both sides quote
]);
/** Flagged: any module under adapters/ that NEUTRAL does not name. */
const flagged = (file: string): boolean => file.startsWith(ADAPTERS + sep) && !NEUTRAL.has(file);

/**
 * Every module specifier a file names, in either quote style: static imports and re-exports (one or many lines), bare
 * imports, `import()`.
 */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const named = /\bfrom\s+(['"])([^'"]+)\1|\bimport\s+(['"])([^'"]+)\3|\bimport\s*\(\s*(['"])([^'"]+)\5\s*\)/g;
  for (const m of source.matchAll(named)) found.push(m[2] ?? m[4] ?? m[6]!);
  return found;
}

/** The src files a module imports, resolved (`.js` → `.ts`). */
const importsOf = (file: string): string[] =>
  specifiers(readFileSync(file, 'utf8'))
    .filter((s) => s.startsWith('.'))
    .map((s) => resolve(dirname(file), s).replace(/\.js$/, '.ts'));

const rel = (file: string): string => relative(SRC, file);

describe('outside its composition root, mcp/ imports only a neutral adapters/ module (ARCHITECTURE.md, A16)', () => {
  const modules = readdirSync(MCP, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(MCP, f));

  it('the check sees what it guards: the composition root imports the platform adapters, each of them flagged', () => {
    expect(modules).toContain(COMPOSITION_ROOT);
    const platform = importsOf(COMPOSITION_ROOT).filter(flagged).map(rel);
    expect(platform).toEqual(
      expect.arrayContaining(['adapters/ios.ts', 'adapters/android.ts', 'adapters/discovery.ts']),
    );
    expect(flagged(join(ADAPTERS, 'ios-foreground.ts'))).toBe(true);
    expect(flagged(join(ADAPTERS, 'discovery.ts'))).toBe(true);
    expect(flagged(join(ADAPTERS, 'types.ts'))).toBe(false);
  });

  it('a specifier is read in either quote style', () => {
    const source = [
      `import { a } from "../adapters/ios.js";`,
      `import b from '../adapters/android.js';`,
      `const c = import("../adapters/idb.js");`,
    ].join('\n');
    expect(specifiers(source)).toEqual([
      '../adapters/ios.js',
      '../adapters/android.js',
      '../adapters/idb.js',
    ]);
  });

  it('no other mcp/ module imports one', () => {
    const offending = modules
      .filter((m) => m !== COMPOSITION_ROOT)
      .flatMap((m) => importsOf(m).filter(flagged).map((target) => `${rel(m)} -> ${rel(target)}`));
    expect(offending).toEqual([]);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE.md's layering ("Device Adapter"): which adapters/ modules a layer above may import, one row per layer.
 *
 * - mcp/ (A16): the composition root (mcp/registry.ts) chooses by platform and so imports the platform adapters; every
 *   other mcp/ module reads adapters/ through the interface module only. A constant a tool description quotes lives
 *   where both may read it (FOREGROUND_WAIT_MS in adapters/types.ts, not adapters/ios-foreground.ts).
 * - interact/ (A18): imports no platform module — the interface module and typeable.ts (the per-adapter typing fact's
 *   shape and its one reader), plus ARCHITECTURE.md's named exception: interact/type-text.ts reads
 *   adapters/input-text.ts, Android's `input text` control-character vocabulary, to word its refusal before any device
 *   call (input-text.ts is a leaf so interact/ does not import the Android adapter for a sentence).
 *
 * Fail closed: any other adapters/ module counts as platform code, whatever its name (discovery.ts lists simctl's and
 * adb's devices; screenshot-bytes.ts is a platform's too). Adding a neutral leaf takes a deliberate entry in a row's
 * `neutral`, with its reason beside it; a platform module one file needs takes an `exceptions` entry, named in
 * ARCHITECTURE.md too.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const ADAPTERS = join(SRC, 'adapters');
const adapter = (name: string): string => join(ADAPTERS, name);

interface Layer {
  /** The layer's directory under src/. */
  readonly dir: string;
  /** Its modules the rule does not apply to (a composition root), each with its reason. */
  readonly exempt: ReadonlyMap<string, string>;
  /** The adapters/ modules any of its modules may import, each with its reason. */
  readonly neutral: ReadonlyMap<string, string>;
  /** One importer reading one platform module, each named in ARCHITECTURE.md with its reason. */
  readonly exceptions: readonly { readonly from: string; readonly to: string; readonly why: string }[];
}

const MCP = join(SRC, 'mcp');
const INTERACT = join(SRC, 'interact');
const COMPOSITION_ROOT = join(MCP, 'registry.ts');
const TYPES = 'the DeviceAdapter interface, its types and the constants both sides quote';

const LAYERS: readonly Layer[] = [
  {
    dir: MCP,
    exempt: new Map([[COMPOSITION_ROOT, 'the composition root: it chooses the adapter by platform']]),
    neutral: new Map([[adapter('types.ts'), TYPES]]),
    exceptions: [],
  },
  {
    dir: INTERACT,
    exempt: new Map(),
    neutral: new Map([
      [adapter('types.ts'), TYPES],
      [adapter('typeable.ts'), "DeviceAdapter.typeable's shape and refusalOf, its one reader (ADR 0037), a leaf importing nothing"],
    ]),
    exceptions: [
      {
        from: join(INTERACT, 'type-text.ts'),
        to: adapter('input-text.ts'),
        why: "Android's `input text` control-character vocabulary, which the refusal words before any device call",
      },
    ],
  },
];

/** Whether `layer`'s `file` importing `target` breaks the layering: an adapters/ module it does not allow. */
const breaks = (layer: Layer, file: string, target: string): boolean =>
  target.startsWith(ADAPTERS + sep) &&
  !layer.neutral.has(target) &&
  !layer.exceptions.some((e) => e.from === file && e.to === target);

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

const modulesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));

/** Every import in `layer` that breaks it, as `importer -> target`. */
const offending = (layer: Layer): string[] =>
  modulesOf(layer.dir)
    .filter((m) => !layer.exempt.has(m))
    .flatMap((m) =>
      importsOf(m)
        .filter((target) => breaks(layer, m, target))
        .map((target) => `${rel(m)} -> ${rel(target)}`),
    );

describe('a layer above adapters/ imports only the adapters/ modules its row allows (ARCHITECTURE.md, A16, A18)', () => {
  const [mcp, interact] = LAYERS as [Layer, Layer];

  it('the check sees what it guards: the composition root imports the platform adapters, each of them flagged', () => {
    expect(modulesOf(MCP)).toContain(COMPOSITION_ROOT);
    const platform = importsOf(COMPOSITION_ROOT)
      .filter((t) => breaks(mcp, COMPOSITION_ROOT, t))
      .map(rel);
    expect(platform).toEqual(
      expect.arrayContaining(['adapters/ios.ts', 'adapters/android.ts', 'adapters/discovery.ts']),
    );
    expect(breaks(mcp, join(MCP, 'tools.ts'), adapter('ios-foreground.ts'))).toBe(true);
    expect(breaks(mcp, join(MCP, 'tools.ts'), adapter('discovery.ts'))).toBe(true);
    expect(breaks(mcp, join(MCP, 'tools.ts'), adapter('types.ts'))).toBe(false);
  });

  it("an exception is one importer's: input-text.ts is allowed to type-text.ts, flagged from any other module", () => {
    expect(breaks(interact, join(INTERACT, 'type-text.ts'), adapter('input-text.ts'))).toBe(false);
    expect(breaks(interact, join(INTERACT, 'fill-type.ts'), adapter('input-text.ts'))).toBe(true);
    expect(breaks(mcp, join(MCP, 'tools.ts'), adapter('input-text.ts'))).toBe(true);
    expect(breaks(interact, join(INTERACT, 'type-text.ts'), adapter('android.ts'))).toBe(true);
    expect(breaks(interact, join(INTERACT, 'type-text.ts'), join(SRC, 'ui-tree', 'geometry.ts'))).toBe(false);
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

  it.each(LAYERS.map((layer) => [rel(layer.dir), layer] as const))(
    '%s imports no other adapters/ module',
    (_name, layer) => {
      const found = offending(layer);
      expect(
        found,
        `${found.join(', ')}: a platform module, by ARCHITECTURE.md's "Device Adapter" layering — ` +
          `move what is shared into a neutral adapters/ leaf, or name the exception there and in this test's LAYERS`,
      ).toEqual([]);
    },
  );

  it.each(LAYERS.flatMap((layer) => layer.exceptions.map((e) => [rel(e.from), rel(e.to), e] as const)))(
    'the exception %s -> %s still holds (a stale one is removed, here and in ARCHITECTURE.md)',
    (_from, _to, e) => {
      expect(importsOf(e.from)).toContain(e.to);
    },
  );
});

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE.md §2's rule, "dependencies point one way only", in two parts.
 *
 * The layer ORDER (A24): `mcp → run → flow → interact → verify → ui-tree → adapters`, with `util/` a leaf every layer
 * may import and that imports no other layer. A module imports only from its own layer or one below it; interact/ also
 * skips verify/ (it imports ui-tree, adapters and util only — verify/'s judge is handed in at the composition roots).
 * Fail closed: an import upward, or sideways out of util/, fails naming the edge, and a directory of src/ the order does
 * not name fails until it is placed in it.
 *
 * Into adapters/ ("Device Adapter"): which adapters/ modules a layer above may import, one row per layer.
 *
 * - mcp/ (A16): the composition root (mcp/registry.ts) chooses by platform and so imports the platform adapters; every
 *   other mcp/ module reads adapters/ through the interface module only. A constant a tool description quotes lives
 *   where both may read it (FOREGROUND_WAIT_MS in adapters/types.ts, not adapters/ios-foreground.ts).
 * - interact/ (A18): imports no platform module — the interface module and typeable.ts (the per-adapter typing fact's
 *   shape and its one reader), plus ARCHITECTURE.md's named exception: interact/type-text.ts reads
 *   adapters/input-text.ts, Android's `input text` control-character vocabulary, to word its refusal before any device
 *   call (input-text.ts is a leaf so interact/ does not import the Android adapter for a sentence).
 * - flow/, verify/, ui-tree/, run/ (A24): the interface module, plus ARCHITECTURE.md's named exceptions — the config
 *   (flow/config.ts, flow/tool-config.ts) takes the iOS tree-source kinds from adapters/ios-node.ts, pure, where the
 *   registry keys on them; verify/ocr.ts runs the host's OCR recognizer through adapters/exec.ts (a host process, not
 *   a device command); verify/shot.ts encodes a raw capture through adapters/png-encode.ts (the codec split backlog A5
 *   tracks).
 *
 * Fail closed: any other adapters/ module counts as platform code, whatever its name (discovery.ts lists simctl's and
 * adb's devices; screenshot-bytes.ts is a platform's too). Adding a neutral leaf takes a deliberate entry in a row's
 * `neutral`, with its reason beside it; a platform module one file needs takes an `exceptions` entry, named in
 * ARCHITECTURE.md too.
 *
 * The rule is a module's direct imports: a platform module reached through another layer's module (a re-export, or a
 * module that imports it) is that layer's row to allow or refuse.
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
const FLOW = join(SRC, 'flow');
const VERIFY = join(SRC, 'verify');
const UI_TREE = join(SRC, 'ui-tree');
const RUN = join(SRC, 'run');
const COMPOSITION_ROOT = join(MCP, 'registry.ts');
const TYPES = 'the DeviceAdapter interface, its types and the constants both sides quote';

const MCP_LAYER: Layer = {
  dir: MCP,
  exempt: new Map([[COMPOSITION_ROOT, 'the composition root: it chooses the adapter by platform']]),
  neutral: new Map([[adapter('types.ts'), TYPES]]),
  exceptions: [],
};

const INTERACT_LAYER: Layer = {
  dir: INTERACT,
  exempt: new Map(),
  neutral: new Map([
    [adapter('types.ts'), TYPES],
    [
      adapter('typeable.ts'),
      "DeviceAdapter.typeable's shape and refusalOf, its one reader (ADR 0037), a leaf importing nothing",
    ],
  ]),
  exceptions: [
    {
      from: join(INTERACT, 'type-text.ts'),
      to: adapter('input-text.ts'),
      why: "Android's `input text` control-character vocabulary, which the refusal words before any device call",
    },
  ],
};

const IOS_TREE_SOURCE_KINDS =
  "the configured iOS tree source's kinds and default (`app.ios.treeSource`), pure, spelled once where the registry " +
  'keys on them';

const FLOW_LAYER: Layer = {
  dir: FLOW,
  exempt: new Map(),
  neutral: new Map([[adapter('types.ts'), TYPES]]),
  exceptions: [
    { from: join(FLOW, 'config.ts'), to: adapter('ios-node.ts'), why: IOS_TREE_SOURCE_KINDS },
    { from: join(FLOW, 'tool-config.ts'), to: adapter('ios-node.ts'), why: IOS_TREE_SOURCE_KINDS },
  ],
};

const VERIFY_LAYER: Layer = {
  dir: VERIFY,
  exempt: new Map(),
  neutral: new Map([[adapter('types.ts'), TYPES]]),
  exceptions: [
    {
      from: join(VERIFY, 'ocr.ts'),
      to: adapter('exec.ts'),
      why: "the host's OCR recognizer runs as a host process, not a device command",
    },
    {
      from: join(VERIFY, 'shot.ts'),
      to: adapter('png-encode.ts'),
      why: 'a raw capture encoded on the host where a PNG leaves the process (the codec split, backlog A5)',
    },
  ],
};

const UI_TREE_LAYER: Layer = {
  dir: UI_TREE,
  exempt: new Map(),
  neutral: new Map([[adapter('types.ts'), TYPES]]),
  exceptions: [],
};

const RUN_LAYER: Layer = {
  dir: RUN,
  exempt: new Map(),
  neutral: new Map([[adapter('types.ts'), TYPES]]),
  exceptions: [],
};

const LAYERS: readonly Layer[] = [MCP_LAYER, RUN_LAYER, FLOW_LAYER, INTERACT_LAYER, VERIFY_LAYER, UI_TREE_LAYER];

/** ARCHITECTURE.md §2's order, top first: a module may import its own layer's and those after it. */
const ORDER = ['mcp', 'run', 'flow', 'interact', 'verify', 'ui-tree', 'adapters'] as const;
/** The leaf every layer may import; it imports no other layer. */
const LEAF = 'util';
/** A layer below that a layer still may not import, each with its reason. */
const SKIPS: readonly { readonly from: string; readonly to: string; readonly why: string }[] = [
  {
    from: 'interact',
    to: 'verify',
    why: 'verify/ stays reachable from both engines; its judge (the eyes) is handed in at the composition roots',
  },
];

/** The src/ layer a file belongs to: its first directory under src/ (a file at src/'s root is its own name). */
const layerOf = (file: string): string => relative(SRC, file).split(sep)[0]!;

/**
 * Whether `file` importing `target` breaks the order: a target in a layer above the importer's, in a layer the
 * importer skips, out of util/ into a layer, or in or out of a layer the order does not name (fail closed).
 */
function upward(file: string, target: string): boolean {
  const from = layerOf(file);
  const to = layerOf(target);
  if (from === to || to === LEAF) return false;
  if (from === LEAF) return true;
  const rankFrom = ORDER.indexOf(from as (typeof ORDER)[number]);
  const rankTo = ORDER.indexOf(to as (typeof ORDER)[number]);
  if (rankFrom < 0 || rankTo < 0) return true;
  return rankTo < rankFrom || SKIPS.some((s) => s.from === from && s.to === to);
}

/** Whether `layer`'s `file` importing `target` breaks the layering: an adapters/ module it does not allow. */
const breaks = (layer: Layer, file: string, target: string): boolean =>
  target.startsWith(ADAPTERS + sep) &&
  !layer.neutral.has(target) &&
  !layer.exceptions.some((e) => e.from === file && e.to === target);

/**
 * Every module specifier a file names, in either quote style: static imports and re-exports (one or many lines), bare
 * imports, `import()`. Not read: `require(…)`, `import x = require(…)`, a template-literal `import(`…`)`, or
 * `createRequire`. A comment or string that quotes an import is read as one — fail closed.
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

/** Every src/ import that breaks the order, as `importer -> target`. */
const againstTheOrder = (): string[] =>
  modulesOf(SRC).flatMap((m) =>
    importsOf(m)
      .filter((target) => target.startsWith(SRC + sep) && upward(m, target))
      .map((target) => `${rel(m)} -> ${rel(target)}`),
  );

const ORDER_TITLE = `dependencies point one way only: ${ORDER.join(' → ')}, ${LEAF}/ a leaf (ARCHITECTURE.md §2, A24)`;
describe(ORDER_TITLE, () => {
  it('every src/ module lives in a layer the order names', () => {
    const entries = readdirSync(SRC, { withFileTypes: true });
    expect(entries.filter((e) => !e.isDirectory()).map((e) => e.name)).toEqual([]);
    expect(entries.map((e) => e.name).sort()).toEqual([...ORDER, LEAF].sort());
  });

  it('the check sees what it guards: down and into util/ pass; up, a skip, out of util/ or an unplaced layer fail', () => {
    expect(upward(join(MCP, 'tools.ts'), join(RUN, 'verify.ts'))).toBe(false);
    expect(upward(join(FLOW, 'engine.ts'), join(VERIFY, 'capture.ts'))).toBe(false);
    expect(upward(join(UI_TREE, 'geometry.ts'), adapter('types.ts'))).toBe(false);
    expect(upward(adapter('ios.ts'), join(SRC, 'util', 'sleep.ts'))).toBe(false);
    expect(upward(join(VERIFY, 'shot.ts'), join(VERIFY, 'png.ts'))).toBe(false);

    expect(upward(adapter('ios.ts'), join(UI_TREE, 'geometry.ts'))).toBe(true);
    expect(upward(join(VERIFY, 'eyes.ts'), join(INTERACT, 'resolve.ts'))).toBe(true);
    expect(upward(join(RUN, 'verify.ts'), join(MCP, 'tools.ts'))).toBe(true);
    expect(upward(join(INTERACT, 'resolve.ts'), join(VERIFY, 'eyes.ts'))).toBe(true);
    expect(upward(join(SRC, 'util', 'sleep.ts'), adapter('types.ts'))).toBe(true);
    expect(upward(join(SRC, 'cli', 'main.ts'), adapter('types.ts'))).toBe(true);
    expect(upward(join(VERIFY, 'eyes.ts'), join(SRC, 'cli', 'main.ts'))).toBe(true);
  });

  it('no src/ module imports against the order', () => {
    expect(modulesOf(SRC).length).toBeGreaterThan(100);
    const found = againstTheOrder();
    expect(
      found,
      `${found.join(', ')}: against ARCHITECTURE.md §2's order — move what both need down a layer (as ` +
        `ui-tree/geometry.ts holds the absent-in-viewport rule for interact/ and verify/), or hand it in at a ` +
        `composition root`,
    ).toEqual([]);
  });
});

const TITLE = 'a layer above adapters/ imports only the adapters/ modules its row allows (ARCHITECTURE.md, A16, A18, A24)';
describe(TITLE, () => {

  it('the check sees what it guards: the composition root imports the platform adapters, each of them flagged', () => {
    expect(modulesOf(MCP)).toContain(COMPOSITION_ROOT);
    const platform = importsOf(COMPOSITION_ROOT)
      .filter((t) => breaks(MCP_LAYER, COMPOSITION_ROOT, t))
      .map(rel);
    expect(platform).toEqual(
      expect.arrayContaining(['adapters/ios.ts', 'adapters/android.ts', 'adapters/discovery.ts']),
    );
    expect(breaks(MCP_LAYER, join(MCP, 'tools.ts'), adapter('ios-foreground.ts'))).toBe(true);
    expect(breaks(MCP_LAYER, join(MCP, 'tools.ts'), adapter('discovery.ts'))).toBe(true);
    expect(breaks(MCP_LAYER, join(MCP, 'tools.ts'), adapter('types.ts'))).toBe(false);
  });

  it('type-text.ts alone may import input-text.ts; any other importer is flagged', () => {
    expect(breaks(INTERACT_LAYER, join(INTERACT, 'type-text.ts'), adapter('input-text.ts'))).toBe(false);
    expect(breaks(INTERACT_LAYER, join(INTERACT, 'fill-type.ts'), adapter('input-text.ts'))).toBe(true);
    expect(breaks(MCP_LAYER, join(MCP, 'tools.ts'), adapter('input-text.ts'))).toBe(true);
    expect(breaks(INTERACT_LAYER, join(INTERACT, 'type-text.ts'), adapter('android.ts'))).toBe(true);
    expect(breaks(INTERACT_LAYER, join(INTERACT, 'type-text.ts'), join(SRC, 'ui-tree', 'geometry.ts'))).toBe(false);
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

import { builtinModules } from 'node:module';


/**
 * Gate A's smoke, its pure half (docs/release.md; tests/release/pack-files.test.ts): what the package's tarball must
 * hold and must not, and the tools its bin must list. The process half — pack, extract, spawn — is pack-smoke.ts.
 */

/** What of package.json the file check reads. */
export interface PackageShape {
  /** A string bin is the package-named one. */
  bin?: string | Readonly<Record<string, string>>;
  files?: readonly string[];
}

/** npm packs these whatever `files` says; the package must have them. */
const ALWAYS = ['README.md', 'LICENSE', 'package.json'] as const;
/** Trees of the checkout that never belong in the package. */
const FORBIDDEN_TREES = ['tests', 'fixtures', 'docs', 'reports', 'src', 'scripts', 'node_modules'] as const;
/** A compiled test (a `*.test.*` or `*.spec.*` anywhere): never shipped. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;

const strip = (path: string) => (path.startsWith('./') ? path.slice(2) : path);
const under = (path: string, tree: string) => path.startsWith(`${tree}/`);

/** The problems of a packed file list (`npm pack --json`'s `files[].path`), each a line; none when it is fit to ship. */
export function packFileProblems(packed: readonly string[], pkg: PackageShape): string[] {
  const files = new Set(packed.map(strip));
  const problems: string[] = [];
  const bins: [string | undefined, string][] = typeof pkg.bin === 'string' ? [[undefined, pkg.bin]] : Object.entries(pkg.bin ?? {});
  for (const [name, target] of bins) if (!files.has(strip(target))) problems.push(`missing: ${strip(target)} (bin${name === undefined ? '' : ` ${name}`})`);
  for (const f of ALWAYS) if (!files.has(f)) problems.push(`missing: ${f}`);
  for (const entry of (pkg.files ?? []).map(strip)) {
    if ((ALWAYS as readonly string[]).includes(entry) || files.has(entry)) continue;
    if (![...files].some((f) => under(f, entry))) problems.push(`missing: anything under ${entry} (package.json files)`);
  }
  for (const f of packed.map(strip)) if (FORBIDDEN_TREES.some((t) => under(f, t)) || TEST_FILE.test(f)) problems.push(`not for the package: ${f}`);
  return problems;
}

/** The problems of the tools a server listed against the expected ones, in order; none when they are equal. */
export function toolProblems(listed: readonly string[], expected: readonly string[]): string[] {
  const problems = [...expected.filter((t) => !listed.includes(t)).map((t) => `tool missing: ${t}`), ...listed.filter((t) => !expected.includes(t)).map((t) => `tool not expected: ${t}`)];
  if (problems.length === 0 && listed.join(',') !== expected.join(',')) problems.push(`tools listed in another order: ${listed.join(', ')} (expected ${expected.join(', ')})`);
  return problems;
}

/**
 * The statements that load a module: `import … from '…'` and `export … from '…'` (spanning lines), a side-effect
 * `import '…'` at a line's start, and a dynamic `import('…')` — never a string that merely follows the word.
 */
const IMPORTS = [/^\s*(?:import|export)\s[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gm, /^\s*import\s*(['"])([^'"]+)\1/gm, /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g];

/** The non-relative specifiers a compiled module imports, in source order. */
export function bareImports(source: string): string[] {
  const found = IMPORTS.flatMap((re) => [...source.matchAll(re)].map((m) => ({ at: m.index, spec: m[2] })));
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.spec)
    .filter((s) => !s.startsWith('.') && !s.startsWith('/'));
}

/** What of package.json the import check reads. */
export interface PackageDeps {
  dependencies?: Readonly<Record<string, string>>;
  optionalDependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
}

/** A specifier's package: `@scope/name` or `name`. */
const packageOf = (spec: string) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/**
 * The bare imports no dependency declares, each a line, each package once. Node's builtins (bare or `node:`) are
 * declared by the runtime. The smoke's tarball runs over the checkout's node_modules, devDependencies among them, so a
 * dev-only import would start there and fail for a user: this check is what catches it.
 */
export function undeclaredImports(specifiers: readonly string[], pkg: PackageDeps): string[] {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const named = new Map<string, string>();
  for (const spec of specifiers) {
    if (spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0])) continue;
    const name = packageOf(spec);
    if (!declared.has(name) && !named.has(name)) named.set(name, spec);
  }
  return [...named].map(([name, spec]) => `undeclared import: ${name}${spec === name ? '' : ` (${spec})`}`);
}

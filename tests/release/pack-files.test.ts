import { describe, expect, it } from 'vitest';
import { bareImports, packFileProblems, toolProblems, undeclaredImports } from '../../scripts/release/pack-files.js';

/**
 * Gate A's smoke (docs/release.md), its pure half: what `npm pack --json` lists against what the package needs, and the
 * tools the packed bin serves against the expected list. The process half (pack, extract, spawn the bin over stdio) is
 * `npm run release:smoke`, pack-smoke.ts — run by the runbook after `npm run build`, never by `npm test`.
 */

const PKG = { bin: { averi: 'dist/mcp/server.js' }, files: ['dist', 'skill', 'SETUP.md', 'ARCHITECTURE.md', 'LICENSE'] };
const GOOD = ['package.json', 'README.md', 'LICENSE', 'SETUP.md', 'ARCHITECTURE.md', 'dist/mcp/server.js', 'dist/mcp/tools.js', 'skill/SKILL.md'];

describe('packFileProblems: the packed file list against what the package needs', () => {
  it('none for a list holding the bin, every `files` entry, README, LICENSE and package.json', () => {
    expect(packFileProblems(GOOD, PKG)).toEqual([]);
  });

  it("names the bin's target when it is not packed", () => {
    expect(packFileProblems(GOOD.filter((f) => f !== 'dist/mcp/server.js'), PKG)).toEqual(['missing: dist/mcp/server.js (bin averi)']);
  });

  it('takes a string bin as the package-named one', () => {
    expect(packFileProblems(GOOD, { ...PKG, bin: 'dist/cli.js' })).toEqual(['missing: dist/cli.js (bin)']);
  });

  it('accepts a bin written with a leading ./', () => {
    expect(packFileProblems(GOOD, { ...PKG, bin: { averi: './dist/mcp/server.js' } })).toEqual([]);
  });

  it('names README.md, LICENSE and package.json when absent', () => {
    expect(packFileProblems(GOOD.filter((f) => !['README.md', 'LICENSE', 'package.json'].includes(f)), PKG)).toEqual(['missing: README.md', 'missing: LICENSE', 'missing: package.json']);
  });

  it('names a `files` entry nothing was packed under — a directory by its prefix, not a look-alike', () => {
    const noSkill = [...GOOD.filter((f) => !f.startsWith('skill/')), 'skills-old/x.md', 'skill.md'];
    expect(packFileProblems(noSkill, PKG)).toEqual(['missing: anything under skill (package.json files)']);
  });

  it('names each file packed from a tree the package must not ship', () => {
    const leaked = [...GOOD, 'tests/a.test.ts', 'fixtures/apps/x.swift', 'docs/release.md', 'reports/mutation/m.json', 'src/mcp/server.ts', 'scripts/release/pack-smoke.ts', 'node_modules/x/index.js'];
    expect(packFileProblems(leaked, PKG)).toEqual([
      'not for the package: tests/a.test.ts',
      'not for the package: fixtures/apps/x.swift',
      'not for the package: docs/release.md',
      'not for the package: reports/mutation/m.json',
      'not for the package: src/mcp/server.ts',
      'not for the package: scripts/release/pack-smoke.ts',
      'not for the package: node_modules/x/index.js',
    ]);
  });

  it('a test file compiled into dist is not for the package either, in any module flavour; a name merely holding .test. is', () => {
    const tests = ['dist/mcp/tools.test.js', 'dist/a.spec.mjs', 'dist/b.test.cjs'];
    expect(packFileProblems([...GOOD, ...tests, 'dist/fixtures.test.json', 'dist/x.test.jsx'], PKG)).toEqual(['not for the package: dist/mcp/tools.test.js', 'not for the package: dist/a.spec.mjs', 'not for the package: dist/b.test.cjs']);
  });

  it('only a leading ./ is dropped: a ./ inside a name is kept', () => {
    expect(packFileProblems([...GOOD.filter((f) => f !== 'dist/mcp/server.js'), 'dist/v./mcp/server.js'], { ...PKG, bin: { averi: 'dist/v./mcp/server.js' } })).toEqual([]);
    expect(packFileProblems(GOOD, { ...PKG, bin: { averi: 'dist/./mcp/server.js' } })).toEqual(['missing: dist/./mcp/server.js (bin averi)']);
  });

  it('a name that only starts like a forbidden tree passes (testsuite.md is no tests/)', () => {
    expect(packFileProblems([...GOOD, 'dist/docs-index.js', 'testsuite.md'], PKG)).toEqual([]);
  });
});

describe('toolProblems: the tools the packed bin lists against the expected ones', () => {
  it('none when the lists are equal, in order', () => {
    expect(toolProblems(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('names the missing and the unexpected', () => {
    expect(toolProblems(['a', 'c'], ['a', 'b'])).toEqual(['tool missing: b', 'tool not expected: c']);
  });

  it('names an order that differs when the sets agree', () => {
    expect(toolProblems(['b', 'a'], ['a', 'b'])).toEqual(['tools listed in another order: b, a (expected a, b)']);
  });
});

describe('bareImports: the package specifiers a compiled module imports', () => {
  it('reads static imports and re-exports, side-effect imports and dynamic imports, and drops relative and absolute ones', () => {
    const source = [
      "import 'pngjs';",
      "import { z } from 'zod';",
      "import { abs } from '/opt/abs.js';",
      "import {",
      "  McpServer,",
      "} from '@modelcontextprotocol/sdk/server/mcp.js';",
      "export { x } from './x.js';",
      "export * from \"yaml\";",
      "const m = await import( 'pixelmatch' );",
      "  import { q } from 'indented';",
      "  import 'indented-side';",
      'export * from"tight";',
      'import"tight-side";',
      "import { y } from '../y.js';",
    ].join('\n');
    expect(bareImports(source)).toEqual(['pngjs', 'zod', '@modelcontextprotocol/sdk/server/mcp.js', 'yaml', 'pixelmatch', 'indented', 'indented-side', 'tight', 'tight-side']);
  });

  it('a string in prose that merely follows the word import is no import', () => {
    expect(bareImports("const why = `the import failed`; say('import this read failed');\nlog(\"from 'nowhere'\");\nconst s = \"we import it from 'nowhere'\";\nsay(\"import 'nowhere'\");")).toEqual([]);
  });
});

describe('undeclaredImports: a bare import the package does not declare (the extracted tarball borrows the checkout\'s node_modules, devDependencies too)', () => {
  const DEPS = { dependencies: { zod: '^3', '@modelcontextprotocol/sdk': '^1' }, optionalDependencies: { 'appium-webdriveragent': '1' } };

  it('none for builtins, `node:` specifiers and declared packages, a scoped one by its scope and name', () => {
    expect(undeclaredImports(['node:fs', 'fs/promises', 'zod', '@modelcontextprotocol/sdk/server/mcp.js', 'appium-webdriveragent/lib/x.js'], DEPS)).toEqual([]);
  });

  it('names each undeclared package once, with the specifier that first imported it', () => {
    expect(undeclaredImports(['tsx', 'vitest/config', 'vitest', '@types/node'], DEPS)).toEqual(['undeclared import: tsx', 'undeclared import: vitest (vitest/config)', 'undeclared import: @types/node']);
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_NAMES } from '../../tests/helpers/tool-names.js';
import { isMain } from '../is-main.js';
import { hostPaths, scrub } from './clean-log.js';
import { bareImports, packFileProblems, toolProblems, undeclaredImports, type PackageDeps, type PackageShape } from './pack-files.js';

/**
 * Gate A's smoke (docs/release.md): the package as npm would publish it, started the way a client starts it.
 *
 *   npm run build && npm run release:smoke
 *
 * 1. `npm pack --json` into a temporary folder: the file list judged by pack-files.ts#packFileProblems (the bin's
 *    target, every `files` entry, README, LICENSE, package.json; nothing from tests/, fixtures/, docs/, reports/, src/,
 *    scripts/, no compiled test);
 * 2. the tarball extracted, every bare import of its dist judged by pack-files.ts#undeclaredImports (the step below
 *    borrows the checkout's node_modules, devDependencies too: a dev-only import is caught here, not there);
 * 3. the extracted bin spawned with node over stdio, the checkout's node_modules linked beside it, and an MCP client
 *    asks it `initialize` and `tools/list`: the server's name and version must be package.json's, its tools exactly
 *    tests/helpers/tool-names.ts's, in order (pack-files.ts#toolProblems). The version check proves only that the bin
 *    reads the package.json shipped beside it (src/util/version.ts): the server reports whatever that file says, so a
 *    version left unbumped passes here — the bump is Gate D's to check by eye.
 *
 * Not part of `npm test`: it needs `npm run build` first (dist is the package's), and packs and spawns. No device, no
 * network. Prints no absolute path (its output goes into the release record), removes its temporary folder, and exits
 * 0 on PASS, 1 on FAIL (package.json's bin not built among them), 2 when dist/ is missing.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** The bin's start, `initialize` and `tools/list` together (about 1 s on an idle machine). */
const SPAWN_BOUND_MS = 30_000;

type Pkg = PackageShape & PackageDeps & { name: string; version: string };

async function jsFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => join(e.parentPath, e.name));
}

const binOf = (pkg: Pkg): string => (typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0]);

/** The bin's answer; on a failure the error carries the bin's stderr lines that name an error (else its first lines). */
async function listTools(packageDir: string, bin: string): Promise<{ name?: string; version?: string; tools: string[] }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(packageDir, bin)], cwd: packageDir, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const client = new Client({ name: 'release-smoke', version: '0' });
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the bin did not answer initialize and tools/list within ${SPAWN_BOUND_MS / 1000} s`)), SPAWN_BOUND_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        const server = client.getServerVersion();
        return { name: server?.name, version: server?.version, tools: (await client.listTools()).tools.map((t) => t.name) };
      })(),
      bound,
    ]);
  } catch (e) {
    const said = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const errors = said.filter((l) => /\bError\b|^Cannot /.test(l));
    const tail = (errors.length > 0 ? errors : said).slice(0, 3).join(' ⏎ ');
    throw new Error(`${e instanceof Error ? e.message : String(e)}${tail === '' ? '' : ` — the bin's stderr: ${tail}`}`);
  } finally {
    clearTimeout(timer);
    await client.close();
  }
}

export async function smoke(): Promise<{ lines: string[]; exitCode: 0 | 1 | 2 }> {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as Pkg;
  const bin = binOf(pkg).replace(/^\.\//, '');
  if (!existsSync(join(ROOT, 'dist'))) return { lines: ['release smoke: REFUSED — dist/ is missing; run `npm run build` first'], exitCode: 2 };
  const lines: string[] = [`release smoke: ${pkg.name}@${pkg.version}, bin ${bin}`];
  const problems: string[] = [];
  // Built, but nothing where package.json's bin points: the file check below FAILs naming it (`missing: … (bin …)`).
  const tmp = await mkdtemp(join(tmpdir(), 'averi-release-smoke-'));
  try {
    // 1. the tarball and its file list
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as { filename: string; size: number; unpackedSize: number; files: { path: string }[] }[];
    const { filename, size, unpackedSize, files } = packed[0];
    const tops = [...new Set(files.map((f) => f.path.split('/')[0]))].sort();
    lines.push(`pack: ${filename}, ${files.length} files, ${(size / 1024).toFixed(0)} kB packed, ${(unpackedSize / 1024).toFixed(0)} kB unpacked; top level: ${tops.join(', ')}`);
    const fileProblems = packFileProblems(files.map((f) => f.path), pkg);
    lines.push(`files: ${fileProblems.length === 0 ? 'ok' : `${fileProblems.length} problem(s)`}`);
    problems.push(...fileProblems);

    // 2. the extracted package's imports
    execFileSync('tar', ['-xzf', join(tmp, filename), '-C', tmp]);
    const packageDir = join(tmp, 'package');
    const specifiers = (await Promise.all((await jsFilesUnder(join(packageDir, 'dist'))).map(async (f) => bareImports(await readFile(f, 'utf8'))))).flat();
    const importProblems = undeclaredImports(specifiers, pkg);
    lines.push(`imports: ${[...new Set(specifiers.filter((s) => !s.startsWith('node:')))].length} bare specifiers, ${importProblems.length === 0 ? 'all declared' : `${importProblems.length} undeclared`}`);
    problems.push(...importProblems);

    // 3. the bin, started as a client starts it
    if (!existsSync(join(packageDir, bin))) problems.push(`not started: package.json's bin ${bin} is not in the tarball`);
    else {
      await symlink(join(ROOT, 'node_modules'), join(packageDir, 'node_modules'), 'dir');
      try {
        const served = await listTools(packageDir, bin);
        lines.push(`server: ${served.name}@${served.version}, ${served.tools.length} tools: ${served.tools.join(', ')}`);
        if (served.name !== pkg.name || served.version !== pkg.version) problems.push(`server says ${served.name}@${served.version}, package.json ${pkg.name}@${pkg.version}`);
        problems.push(...toolProblems(served.tools, TOOL_NAMES));
      } catch (e) {
        // No host path in the output (clean-log.ts's): the smoke's folder as made and as node resolved it, then the rest.
        const said = e instanceof Error ? e.message : String(e);
        problems.push(`not started: ${scrub(said, hostPaths({ repo: ROOT, tmp: tmpdir(), home: homedir(), real: realpathSync }, [[tmp, '<tmp>']]))}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  lines.push(...problems.map((p) => `- ${p}`), problems.length === 0 ? 'release smoke: PASS' : `release smoke: FAIL — ${problems.length} problem(s)`);
  return { lines, exitCode: problems.length === 0 ? 0 : 1 };
}

if (isMain(import.meta.url)) {
  const { lines, exitCode } = await smoke();
  console.log(lines.join('\n'));
  process.exitCode = exitCode;
}

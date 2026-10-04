import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

/**
 * src/mcp/server.ts is the stdio entry and connects at import, so the only
 * way to test it is the way a client uses it: as a process. One spawn pins
 * the three things the entry alone decides — which version it hands the
 * server, that the tools are on the server it connects, and that a signal
 * meets the shutdown handlers. Everything a handler does is
 * tests/mcp/tools.test.ts's, in memory.
 *
 * Run from source through the LOCAL tsx loader (a devDependency, resolved
 * from node_modules — no dist, no npx, no network): `node --import tsx` is
 * one process, so the SIGTERM below reaches the server itself rather than a
 * CLI wrapper. The SDK transport gives the child a minimal environment, so
 * vitest's NODE_OPTIONS are not inherited.
 */

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

describe('the stdio entry (src/mcp/server.ts), as a process', () => {
  // ~0.5 s on an idle machine; the budget is for a loaded one.
  it('reports package.json\'s version, serves the 18 tools, and exits 0 on SIGTERM', { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', tsxLoader, repoFile('src/mcp/server.ts')],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'server-test', version: '0' });
    try {
      await client.connect(transport);

      const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8')) as { version: string };
      // The regression (a87161c): a literal here reported 0.0.1 for every release.
      expect(client.getServerVersion()).toMatchObject({ name: 'averi', version: pkg.version });
      expect((await client.listTools()).tools).toHaveLength(18);

      // Deliberate private reach (a rename is caught only at runtime): the
      // transport exposes the pid but not the exit, and the exit is the
      // evidence. Handled → code 0, no signal (mcp/lifecycle.ts says why 0);
      // unhandled, Node dies BY the signal → code null, signal 'SIGTERM'.
      const child = (transport as unknown as { _process: ChildProcess })._process;
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      child.kill('SIGTERM');
      expect(await exited).toEqual({ code: 0, signal: null });
    } finally {
      await client.close();
    }
  });
});

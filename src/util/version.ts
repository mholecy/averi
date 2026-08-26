import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The package's own version, for the MCP handshake's `serverInfo`.
 *
 * Read from package.json at runtime rather than written out here, because a
 * hand-copied literal is exactly what drifted: `serverInfo` reported 0.0.1 to
 * every client for every release since the first, so the one place a caller
 * can ask which averi it is talking to was the one place that never knew. A
 * JSON import is not the alternative — package.json sits outside `rootDir`, so
 * it would not compile.
 *
 * Its own module because mcp/server.ts connects stdio at import and therefore
 * cannot be imported by a test — the same constraint that moved
 * formatLogExcerpt and assertSummary out of it.
 *
 * `../../package.json` holds for both layouts: dist/util/version.js and
 * src/util/version.ts are each two levels below the package root.
 */
export async function packageVersion(): Promise<string> {
  const path = fileURLToPath(new URL('../../package.json', import.meta.url));
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error(`No version string in ${path}`);
  }
  return parsed.version;
}

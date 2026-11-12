import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { IosTreeSourceSetting } from '../../src/adapters/ios-node.js';
import { defaultDiscovery } from '../../src/adapters/discovery.js';
import { AdapterRegistry, defaultFactory, iosAdapterFor } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { connectInProcess } from '../differential/connection.js';
import { LAB_WDA_DERIVED_DATA, LAB_WDA_PORT } from '../truth/lab-device.js';
import { callReply } from '../truth/replies.js';

/**
 * What the performance harnesses share (scripts/perf/baseline.ts, scripts/perf/a41-probe.ts): the checkout's commit, and
 * an averi server driven the way an agent drives it — its MCP tools through a real MCP client over the SDK's in-memory
 * transport (scripts/differential/connection.ts), on src/mcp/tools.ts#createAveriServer over a real AdapterRegistry:
 * Android's own adapter; on iOS the registry's own wiring (iosAdapterFor, the idb helper with it), with WebDriverAgent on
 * the lab's port and derived data (LAB_WDA_PORT, never 8100, which another session's WDA may hold).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** HEAD, its subject, whether a tracked file is modified; undefined outside a git checkout. */
export function commitOf(root: string = ROOT): { head: string; subject: string; dirty: boolean } | undefined {
  const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  try {
    return { head: git('rev-parse', 'HEAD'), subject: git('log', '-1', '--format=%s'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' };
  } catch {
    return undefined;
  }
}

export interface AveriServer {
  client: Client;
  /** A tool call's reply as the judges read it (scripts/truth/replies.ts#callReply). */
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  /** The client, the server and the registry closed: its shutdown stops a WebDriverAgent it started. */
  close(): Promise<void>;
}

/** A fresh server; iOS adapters of `treeSource` unless the call's config names one. */
export async function averiServer(o: { treeSource: IosTreeSourceSetting; driver: string; wdaPort?: number }): Promise<AveriServer> {
  const registry = new AdapterRegistry({
    factory: (p, deviceId, opts) =>
      p === 'android'
        ? defaultFactory(p, deviceId, opts)
        : iosAdapterFor(deviceId, opts?.treeSource ?? o.treeSource, { port: o.wdaPort ?? LAB_WDA_PORT, derivedDataPath: LAB_WDA_DERIVED_DATA }),
    // The server's own discovery, its check's device.plist proof (D22) included, as `new AdapterRegistry()` has.
    discovery: defaultDiscovery,
  });
  const { client, close } = await connectInProcess({ createAveriServer }, registry, o.driver);
  return { client, call: (tool, args) => callReply(client, tool, args), close };
}

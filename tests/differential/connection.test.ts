import { describe, expect, it } from 'vitest';
import { connectInProcess, type InProcess } from '../../scripts/differential/connection.js';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';

// The harnesses' in-process connection (scripts/differential/connection.ts, A33): this checkout's server over a real
// registry, a real MCP client over the SDK's in-memory transport. What it owns: the open (server before client, what
// was opened closed again when the open fails) and the close (client, server, the registry's shutdown — each tried
// whatever the one before it threw, the first failure thrown after all of them, D82).

/** A real registry over no device (nothing is listed, no adapter built), its shutdown logged. */
function registryLogging(log: string[], fails?: string): AdapterRegistry {
  const registry = new AdapterRegistry({
    factory: () => {
      throw new Error('connection.test: no adapter is built');
    },
    discovery: { list: async () => [], check: async () => ({ usable: false, listed: undefined }) },
  });
  const shutdown = registry.shutdown.bind(registry);
  registry.shutdown = async () => {
    log.push('registry');
    await shutdown();
    if (fails !== undefined) throw new Error(fails);
  };
  return registry;
}

/** createAveriServer with the server's connect and close logged; `connectFails` / `closeFails` throw there. */
function serverLogging(log: string[], opts: { connectFails?: string; closeFails?: string } = {}): { createAveriServer: typeof createAveriServer } {
  return {
    createAveriServer: (deps) => {
      const server = createAveriServer(deps);
      const connect = server.connect.bind(server);
      const close = server.close.bind(server);
      server.connect = async (transport) => {
        log.push('server connect');
        if (opts.connectFails !== undefined) throw new Error(opts.connectFails);
        await connect(transport);
      };
      server.close = async () => {
        log.push('server');
        await close();
        if (opts.closeFails !== undefined) throw new Error(opts.closeFails);
      };
      return server;
    },
  };
}

/** The connection's client with its close logged; `fails` throws there, after the client closed. */
function clientLogging(c: InProcess, log: string[], fails?: string): void {
  const close = c.client.close.bind(c.client);
  c.client.close = async () => {
    log.push('client');
    await close();
    if (fails !== undefined) throw new Error(fails);
  };
}

describe('connectInProcess: one averi server and its client in this process', () => {
  it('opens: the client talks to the server, which reports the name as its version; the client is named so too', async () => {
    const log: string[] = [];
    const c = await connectInProcess(serverLogging(log), registryLogging(log), 'live-golden');
    expect(c.client.getServerVersion()).toEqual({ name: 'averi', version: 'live-golden' });
    const { tools } = await c.client.listTools();
    expect(tools.map((t) => t.name)).toContain('ui_snapshot');
    await c.close();
  });

  it('closes the client, then the server, then the registry (its shutdown stops the adapters’ processes)', async () => {
    const log: string[] = [];
    const c = await connectInProcess(serverLogging(log), registryLogging(log), 'differential');
    clientLogging(c, log);
    await c.close();
    expect(log).toEqual(['server connect', 'client', 'server', 'registry']);
  });

  it('D82: a close that throws skips none after it — every one is tried, the first failure thrown after the last', async () => {
    const log: string[] = [];
    const c = await connectInProcess(serverLogging(log, { closeFails: 'server gone' }), registryLogging(log, 'adb: device offline'), 'perf-baseline');
    clientLogging(c, log, 'transport gone');
    await expect(c.close()).rejects.toThrow('transport gone');
    expect(log).toEqual(['server connect', 'client', 'server', 'registry']);
  });

  it('a later close’s failure is thrown when the earlier ones held', async () => {
    const log: string[] = [];
    const c = await connectInProcess(serverLogging(log), registryLogging(log, 'adb: device offline'), 'live-golden');
    await expect(c.close()).rejects.toThrow('adb: device offline');
    expect(log).toEqual(['server connect', 'server', 'registry']);
  });

  it("a side's registry with no shutdown (before f9b4a67f) closes the client and the server, nothing thrown", async () => {
    const log: string[] = [];
    const registry = registryLogging(log);
    Object.defineProperty(registry, 'shutdown', { value: undefined });
    const c = await connectInProcess(serverLogging(log), registry, 'differential');
    await c.close();
    expect(log).toEqual(['server connect', 'server']);
  });

  it('an open that fails closes what it opened — the server and the registry — and throws the open’s error', async () => {
    const log: string[] = [];
    await expect(connectInProcess(serverLogging(log, { connectFails: 'no transport' }), registryLogging(log), 'live-golden')).rejects.toThrow('no transport');
    expect(log).toEqual(['server connect', 'server', 'registry']);
  });

  it('an open that fails throws its own error, not a close’s', async () => {
    const log: string[] = [];
    await expect(
      connectInProcess(serverLogging(log, { connectFails: 'no transport', closeFails: 'server gone' }), registryLogging(log, 'adb: device offline'), 'live-golden'),
    ).rejects.toThrow('no transport');
    expect(log).toEqual(['server connect', 'server', 'registry']);
  });

  it('a server that cannot be built: the registry handed in is still shut down, and the build’s error thrown', async () => {
    const log: string[] = [];
    const unbuildable = {
      createAveriServer: (): never => {
        throw new Error('no tools');
      },
    };
    await expect(connectInProcess(unbuildable, registryLogging(log), 'live-golden')).rejects.toThrow('no tools');
    expect(log).toEqual(['registry']);
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AdapterRegistry } from '../../src/mcp/registry.js';
import type { Side } from './side.js';

/**
 * One averi server and its client in this process (A33, review card 5's TL6): the server a side's (or this
 * checkout's) `createAveriServer` builds over the registry handed in, a real MCP client over the SDK's in-memory
 * transport — what tests/mcp/tools.test.ts builds. The live golden (scripts/truth/live.ts), the replay
 * (differential.ts#connect, golden.ts through it) and the performance baseline (scripts/perf/baseline.ts) open
 * theirs here; each calls through `client` in its own reply encoding (live.ts and baseline.ts:
 * scripts/truth/replies.ts#callReply; the replay its own, which the golden base pins) and keeps its own registry.
 *
 * The connection owns the registry once handed it:
 *  - open: the server connects before the client (the client's initialize needs it listening). An open that fails
 *    (a server that cannot be built too) closes what it opened, the registry included, and throws its own error, not
 *    a close's.
 *  - close: the client, then the server, then the registry's shutdown — what stops the adapters' child processes
 *    (WebDriverAgent, the idb helper), so node can exit. Each is tried whatever the one before it threw (D82: a
 *    dead device must not keep the server's processes alive); the first failure is thrown after the last. A side's
 *    registry from before its shutdown (f9b4a67f, 2026-09-18) has none to call.
 *
 * `name` is the client's name and the server's reported version: who drives it (`live-golden`, `differential`,
 * `perf-baseline`).
 */
export interface InProcess {
  client: Client;
  close(): Promise<void>;
}

export async function connectInProcess(averi: Pick<Side, 'createAveriServer'>, registry: AdapterRegistry, name: string): Promise<InProcess> {
  const client = new Client({ name, version: '0' });
  let server: ReturnType<Side['createAveriServer']> | undefined;
  // Typed as this checkout's registry; an older side's may lack shutdown.
  const shutdown = (registry as { shutdown?: () => Promise<void> }).shutdown?.bind(registry);
  const close = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const step of [() => client.close(), server === undefined ? undefined : () => server!.close(), shutdown]) {
      if (step === undefined) continue;
      await step().catch((e: unknown) => failures.push(e));
    }
    if (failures.length > 0) throw failures[0];
  };
  try {
    // Inside the try: a server that cannot be built still leaves the registry shut down.
    server = averi.createAveriServer({ registry, version: name });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
  } catch (e) {
    await close().catch(() => undefined);
    throw e;
  }
  return { client, close };
}

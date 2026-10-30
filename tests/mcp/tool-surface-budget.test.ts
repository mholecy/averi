import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';

/**
 * What every agent session pays before its first call: the server's `instructions` (initialize) plus the whole
 * `tools/list` result, as JSON. A budget, so the surface cannot regrow silently: a description that needs more room
 * moves its detail to skill/references/tools.md, or raises this number deliberately. Bytes are UTF-8 (an em dash is
 * three); tokens are roughly bytes / 4.
 */
const BUDGET_BYTES = 31_000;

let listed: { instructions: string; tools: Awaited<ReturnType<Client['listTools']>> };
let close: () => Promise<void>;

beforeAll(async () => {
  const untouched = (): never => {
    throw new Error('test harness: listing tools touches no device');
  };
  const server = createAveriServer({ registry: new AdapterRegistry({ factory: untouched, discovery: untouched }), version: '0.0.0-test' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'tool-surface-budget-test', version: '0' });
  await client.connect(clientSide);
  listed = { instructions: client.getInstructions() ?? '', tools: await client.listTools() };
  close = async () => {
    await client.close();
    await server.close();
  };
});
afterAll(async () => close());

describe('the tool surface an agent loads every session', () => {
  it(`instructions + tools/list stay within ${BUDGET_BYTES} bytes`, () => {
    const bytes = Buffer.byteLength(listed.instructions) + Buffer.byteLength(JSON.stringify(listed.tools));
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer, REPOSITORY_URL } from '../../src/mcp/tools.js';

/**
 * What every agent session pays before its first call: the server's `instructions` (initialize) plus the whole
 * `tools/list` result, as JSON. A budget, so the surface cannot regrow silently: a description that needs more room
 * moves its detail to skill/references/tools.md, or raises this number deliberately. Bytes are UTF-8 (an em dash is
 * three); tokens are roughly bytes / 4.
 */
const BUDGET_BYTES = 31_000;

/**
 * Claude Code cuts an MCP server's instructions and each tool description past CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH
 * characters, 4096 by default: the tail of a longer one — where a rule may sit — never reaches the agent.
 */
const CLIENT_CUT_CHARS = 4096;

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

  it(`the instructions and every description fit Claude Code's default cut (${CLIENT_CUT_CHARS} characters)`, () => {
    expect(listed.instructions.length).toBeLessThanOrEqual(CLIENT_CUT_CHARS);
    for (const tool of listed.tools.tools) expect((tool.description ?? '').length, tool.name).toBeLessThanOrEqual(CLIENT_CUT_CHARS);
  });

  it("the instructions point at the full reference at this release's tag, in the repository package.json names", () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { repository: { url: string } };
    expect(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')).toBe(REPOSITORY_URL);
    expect(listed.instructions).toContain(`${REPOSITORY_URL}/blob/v0.0.0-test/skill/references/tools.md`);
  });
});

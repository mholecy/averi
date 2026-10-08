import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { snapshotNote } from '../../src/mcp/tool-text.js';
import { node } from '../helpers/fake.js';

/**
 * The operation defaults a tool description quotes have one owner — the
 * module whose code applies them (architecture review 2026-10-07,
 * mcp-surface candidate 3). A test that only compared a description with the
 * constant's CURRENT value would pass for a literal that happens to equal it
 * today, which is exactly the drift being ruled out; so each owner's
 * constant is replaced here with a value no description could carry by
 * accident, and the descriptions must quote THAT. A description that
 * restates the number as a literal fails, and so does one that still carries
 * the old literal beside the derived one.
 *
 * The mocks keep every other export real; the owners' own code still reads
 * their unmocked constants, which is irrelevant here — no tool is called,
 * only listed.
 */
vi.mock('../../src/interact/resolve.js', async (orig) => ({
  ...(await orig<typeof import('../../src/interact/resolve.js')>()),
  DEFAULT_SETTLE_TIMEOUT_MS: 5_250,
}));
vi.mock('../../src/interact/scroll.js', async (orig) => ({
  ...(await orig<typeof import('../../src/interact/scroll.js')>()),
  DEFAULT_MAX_SWIPES: 17,
  DEFAULT_SCROLL_TIMEOUT_MS: 15_250,
}));
vi.mock('../../src/verify/assert.js', async (orig) => ({
  ...(await orig<typeof import('../../src/verify/assert.js')>()),
  ASSERT_TIMEOUT_MS: 3_250,
  PIXEL_ASSERT_TIMEOUT_MS: 12_250,
}));
vi.mock('../../src/verify/color-parity.js', async (orig) => ({
  ...(await orig<typeof import('../../src/verify/color-parity.js')>()),
  DEFAULT_TOLERANCE_DE: 8.25,
  CONTRACT_TOL_FACTOR: 1.75,
}));
vi.mock('../../src/verify/text-parity.js', async (orig) => ({
  ...(await orig<typeof import('../../src/verify/text-parity.js')>()),
  DEFAULT_SIZE_TOLERANCE_PCT: 10.25,
}));
vi.mock('../../src/run/verify.js', async (orig) => ({
  ...(await orig<typeof import('../../src/run/verify.js')>()),
  LOG_MAX_LINES: 425,
}));
vi.mock('../../src/flow/engine.js', async (orig) => ({
  ...(await orig<typeof import('../../src/flow/engine.js')>()),
  DEFAULT_ENSURE_TIMEOUT_MS: 20_250,
}));

type Listed = Awaited<ReturnType<Client['listTools']>>['tools'][number];
let tools: Map<string, Listed>;
let close: () => Promise<void>;

beforeAll(async () => {
  const untouched = (): never => {
    throw new Error('test harness: listing tools touches no device');
  };
  const registry = new AdapterRegistry({ factory: untouched, discovery: untouched });
  const server = createAveriServer({ registry, version: '0.0.0-test' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'tool-descriptions-test', version: '0' });
  await client.connect(clientSide);
  tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
  close = async () => {
    await client.close();
    await server.close();
  };
});
afterAll(async () => close());

const description = (tool: string): string => tools.get(tool)?.description ?? '';
const property = (tool: string, name: string): { description?: string; default?: unknown } =>
  ((tools.get(tool)?.inputSchema.properties ?? {}) as Record<string, { description?: string; default?: unknown }>)[name] ?? {};

describe('tool descriptions quote each operation default from its owner', () => {
  it('tap and type_text: the settle budget (interact/resolve.ts DEFAULT_SETTLE_TIMEOUT_MS)', () => {
    for (const tool of ['tap', 'type_text']) {
      expect(description(tool)).toContain('up to 5.25 s');
      expect(description(tool)).not.toMatch(/(?<![\d.])5 s\b/);
    }
  });

  it('ui_snapshot: the tree assert budget (verify/assert.ts ASSERT_TIMEOUT_MS)', () => {
    expect(description('ui_snapshot')).toContain('assert polls (3.25 s by default');
    expect(description('ui_snapshot')).not.toMatch(/(?<![\d.])3 s\b/);
  });

  it('assert: the tree and the pixel assert budgets (ASSERT_TIMEOUT_MS, PIXEL_ASSERT_TIMEOUT_MS)', () => {
    expect(description('assert')).toContain('waits up to 3.25 s (tree asserts) or 12.25 s (color/ocr');
    expect(description('assert')).not.toMatch(/(?<![\d.])(3|12) s\b/);
  });

  it('ensure_state: the second look (flow/engine.ts DEFAULT_ENSURE_TIMEOUT_MS)', () => {
    expect(description('ensure_state')).toContain('the whole ~20.25 s second look');
    expect(description('ensure_state')).not.toMatch(/(?<![\d.])20 s\b/);
  });

  it('scroll_until: the swipe and time bounds (interact/scroll.ts DEFAULT_MAX_SWIPES, DEFAULT_SCROLL_TIMEOUT_MS)', () => {
    expect(property('scroll_until', 'maxSwipes').description).toBe('Default 17');
    expect(property('scroll_until', 'timeoutMs').description).toBe('Default 15250');
  });

  it('get_logs: the line budget, schema default and description alike (run/verify.ts LOG_MAX_LINES)', () => {
    const maxLines = property('get_logs', 'maxLines');
    expect(maxLines.default).toBe(425);
    expect(maxLines.description).toContain('(default 425)');
  });

  it('verify: the contract tolerances (color-parity DEFAULT_TOLERANCE_DE, CONTRACT_TOL_FACTOR; text-parity DEFAULT_SIZE_TOLERANCE_PCT)', () => {
    const contract = property('verify', 'contract').description ?? '';
    expect(contract).toContain('primary at tolerance_de, default 8.25; vs-contract at 1.75x');
    expect(contract).toContain('(tolerance_size_pct, default 10.25%');
    expect(contract).not.toMatch(/default 8;|at 1\.5x|default 10%/);
  });

  it("the ui_snapshot bare-tree note (mcp/tool-text.ts) quotes ASSERT_TIMEOUT_MS too", () => {
    const ZERO = { x: 0, y: 0, width: 0, height: 0 };
    const bare = node({ role: 'container', rect: ZERO, children: [node({ role: 'other', rect: ZERO })] });
    expect(snapshotNote(bare)).toContain('assert polls (3.25 s by default');
  });
});

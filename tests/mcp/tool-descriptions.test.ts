import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
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
vi.mock('../../src/interact/swipe.js', async (orig) => ({
  ...(await orig<typeof import('../../src/interact/swipe.js')>()),
  SWIPE_REACH_FRACTION: 0.275,
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

vi.mock('../../src/adapters/ios-foreground.js', async (orig) => ({
  ...(await orig<typeof import('../../src/adapters/ios-foreground.js')>()),
  FOREGROUND_WAIT_MS: 3_250,
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

  it("launch_app: the iOS foreground wait's bound (adapters/ios-foreground.ts FOREGROUND_WAIT_MS)", () => {
    expect(description('launch_app')).toContain('waiting at most 3.25 s');
    expect(description('launch_app')).not.toMatch(/(?<![\d.])3 s\b/);
  });

  it('scroll_until: the swipe and time bounds (interact/scroll.ts DEFAULT_MAX_SWIPES, DEFAULT_SCROLL_TIMEOUT_MS)', () => {
    expect(property('scroll_until', 'maxSwipes').description).toBe('Default 17');
    expect(property('scroll_until', 'timeoutMs').description).toBe('Default 15250');
  });

  it('swipe: how far a direction stroke reaches from the centre (interact/swipe.ts SWIPE_REACH_FRACTION)', () => {
    expect(description('swipe')).toContain('a stroke through the screen centre, 27.5% of the screen either side');
    expect(description('swipe')).not.toMatch(/(?<![\d.])30%/);
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

/**
 * What the descriptions say an idb tree's keyboard does (ADR 0006): idb marks
 * no keyboard, but its band, read by its shape, is a keyboard line for the
 * tap, scroll_until and the pixel assert alike — no description may say
 * nothing changes under idb.
 */
describe('tool descriptions on idb\'s keyboard band', () => {
  it('scroll_until judges against the band: viewport above it, swipes above it, no centre below it', () => {
    expect(description('scroll_until')).toContain('With the soft keyboard up (Android; iOS with treeSource: wda, or idb\'s band read by its shape) the viewport is the screen ABOVE it');
    expect(description('scroll_until')).toContain(
      'With treeSource: idb nothing in the tree is marked as the keyboard; averi reads where its background starts by its shape and judges against that line as above: the swipes touch down above it, no stop has the element\'s centre below it, and with fully: true none of the element may lie below it.',
    );
    expect(description('scroll_until')).not.toContain('nothing changes there');
  });

  it('a color/ocr assert counts the band as covering', () => {
    expect(description('assert')).toContain('one under the soft keyboard (Android; iOS with treeSource: wda, or idb\'s band read by its shape)');
  });

  it('the tap: a centre under the band is refused, and a covered node was measured absent from idb\'s tree', () => {
    expect(description('tap')).toContain('a target whose centre lies below that line is REFUSED, nothing tapped');
    expect(description('tap')).toContain('Measured twice on iOS 27, a covered node was absent from idb\'s tree and the tap timed out waiting for it to appear.');
  });
});

/**
 * The structural row's trade-off (draw-order.ts NOT_DRAWN.structural, FRAME_EXCUSES), said where a refusal beside a
 * floating action button is read: which wrappers with children count as a cover, as the code excuses them — the
 * screen's size (`screenSizedHost`), an unlabelled, unvalued one holding the target with its whole scroll view, or one
 * with no identifier holding only empty frames.
 */
describe('tool descriptions on a wrapper counted as a cover', () => {
  it('tap says when a wrapper with children covers, and what to do beside a FAB', () => {
    expect(description('tap')).toContain(
      'A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over all of its rect, unless, among others, it is the screen\'s size (90 % of it or more), or it has no label and no value and holds the target together with the target\'s whole scroll view, or it has no label, value or identifier and holds only empty frames —',
    );
    expect(description('tap')).toContain('tap the FAB\'s own button when that is the target, or scroll_until the row out of the host\'s band');
  });

  it('scroll_until points at it where it fails naming a cover', () => {
    expect(description('scroll_until')).toContain('it fails naming that element (on Android a floating action button\'s full-width host counts as one — see tap)');
  });
});

/** A screen presented over the target (ADR 0018): the tap's and scroll_until's own sentences, and the troubleshooting entry. */
describe('tool descriptions on a screen presented over the target', () => {
  const TROUBLESHOOTING = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');

  it('tap: the general remedy defers to it, and its refusal says to close the screen first; a host with children is no such screen', () => {
    expect(description('tap')).toContain('with less showing it is REFUSED, naming the cover, nothing tapped — scroll_until it first, unless the cover is a screen presented over the target (below). ');
    expect(description('tap')).toContain(
      'Under a screen presented over the target — a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window — the refusal says so instead of "scroll_until it first": \'a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen\'. Close that screen first. A full-screen host that only carries a bar or other content of its own (a host with children) is no such screen: only what it draws covers.',
    );
  });

  it('scroll_until: one confirming read when the timeout allows, then it fails without swiping further, saying which', () => {
    expect(description('scroll_until')).toContain(
      'Once a read finds the target in the viewport under a screen presented over it (a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window), scroll_until confirms with one more read when the timeout allows, and fails without swiping further — "stopped before any swipe …" or "stopped after N swipes, without swiping further …", then "a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it" — since a swipe there could dismiss a sheet or raise its discard prompt.',
    );
  });

  it('troubleshooting: the entry, the wrapper sentence as the code has it, and the picker\'s exception over another screen', () => {
    expect(TROUBLESHOOTING).toContain(
      '- **`… a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen`** (tap or `scroll_until`): the target lies on the screen beneath a modal or sheet that is still up; nothing was tapped and no further swipe was sent.',
    );
    expect(TROUBLESHOOTING).toContain('A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over its whole rect, unless, among others, it is the screen\'s size (90 % of it or more), or it has no label and no value and holds the target together with the target\'s whole scroll view, or it has no label, value or identifier and holds only empty frames:');
    expect(TROUBLESHOOTING).toContain(
      'still is. Over another screen these excuses lapse: a scroll view of a modal or sheet laid in the same window over the entry\'s screen, or a full-screen leaf of it (its dimming view), covers the entry, which is skipped `covered by …`; a host with children there still does not.',
    );
    expect(TROUBLESHOOTING).toContain('(a host with children: Safari\'s full-screen host of its bottom bar) is no such screen');
    expect(TROUBLESHOOTING).toContain(
      'and so does a modal\'s full-screen dimming view or a sheet\'s scroll view over the screen beneath.',
    );
  });

  it('color/ocr: under a presented screen the assert fails closed saying to close it first, not to scroll — in the description and the troubleshooting entry', () => {
    expect(description('assert')).toContain(
      'Under a screen presented over the element (a modal\'s full-screen dimming view or a sheet\'s scroll view, as for tap) no scroll helps, and the failure says so instead: \'a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen\'.',
    );
    expect(TROUBLESHOOTING).toContain(
      'Under a modal or sheet still up over the element\'s screen the message ends `… a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen` instead: close that screen, then assert again.',
    );
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { snapshotNote } from '../../src/mcp/tool-text.js';
import { wholeThinWayPast } from '../../src/interact/target-text.js';
import { boundText } from '../../src/interact/scroll-text.js';
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

// The presented remedy a description quotes has one owner too — ui-tree/standing.ts, whose words every verb says:
// `presentedRemedy` (of "it" for the tap, of "the element" for the pixel assert) and scroll_until's stop on it
// (`presentedStop`). Replaced by sentinels the descriptions must quote; the troubleshooting reference, a file no import
// reaches, is pinned against the real sentences (`actualSentences`).
vi.mock('../../src/ui-tree/standing.js', async (orig) => ({
  ...(await orig<typeof import('../../src/ui-tree/standing.js')>()),
  presentedRemedy: (what: 'it' | 'the element', layer?: { kind: string; label?: string }) =>
    `<the presented remedy, as ui-tree/standing.ts renders it of "${what}"${layer === undefined ? '' : ` under an ${layer.kind} titled ${layer.label}`}>`,
  presentedStop: (layer?: { kind: string; label?: string }) => `<the presented stop's remedy, as ui-tree/standing.ts renders it${layer === undefined ? '' : ` under an ${layer.kind} titled ${layer.label}`}>`,
}));
vi.mock('../../src/verify/pixel-poll.js', async (orig) => ({
  ...(await orig<typeof import('../../src/verify/pixel-poll.js')>()),
  OFF_THE_SCREEN: '<the off-screen miss, as verify/pixel-poll.ts renders it>',
  TOO_THIN_ON_THE_SCREEN: '<the thin-sliver miss, as verify/pixel-poll.ts renders it>',
  OUTSIDE_ITS_SCROLL_VIEW: '<the outside-its-scroll-view miss, as verify/pixel-poll.ts renders it>',
  TOO_THIN_IN_ITS_SCROLL_VIEW: '<the scroll view\'s thin-sliver miss, as verify/pixel-poll.ts renders it>',
}));

// The pixel slack a description quotes (a sliver no thicker than it, an overlap no thicker than it) has one owner too.
vi.mock('../../src/ui-tree/geometry.js', async (orig) => ({
  ...(await orig<typeof import('../../src/ui-tree/geometry.js')>()),
  PIXEL_OVERLAP_SLACK: 2.25,
}));

vi.mock('../../src/adapters/ios-foreground.js', async (orig) => ({
  ...(await orig<typeof import('../../src/adapters/ios-foreground.js')>()),
  FOREGROUND_WAIT_MS: 3_250,
}));

type Listed = Awaited<ReturnType<Client['listTools']>>['tools'][number];
let tools: Map<string, Listed>;
let instructions: string;
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
  instructions = client.getInstructions() ?? '';
  close = async () => {
    await client.close();
    await server.close();
  };
});
afterAll(async () => close());

const description = (tool: string): string => tools.get(tool)?.description ?? '';
const property = (tool: string, name: string): { description?: string; default?: unknown } =>
  ((tools.get(tool)?.inputSchema.properties ?? {}) as Record<string, { description?: string; default?: unknown }>)[name] ?? {};

/**
 * One tool's section of the full reference (skill/references/tools.md, `## \`<tool>\`` to the next `## `), its
 * bullets joined back into running text: the tool's whole behaviour, of which its description keeps the rules. Pinned
 * against the owners' REAL sentences and numbers — the mocks above reach only the descriptions, no import reaches the
 * file — as troubleshooting.md is.
 */
const TOOLS_MD = readFileSync(new URL('../../skill/references/tools.md', import.meta.url), 'utf8');
const full = (tool: string): string => {
  const start = TOOLS_MD.indexOf(`\n## \`${tool}\`\n`);
  if (start < 0) return '';
  const end = TOOLS_MD.indexOf('\n## ', start + 1);
  return TOOLS_MD.slice(start, end < 0 ? undefined : end).replace(/\n- /g, ' ');
};

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

  it('ui_snapshot: says what WDA\'s `"hidden": true` and a parked cell\'s content mean (adapters/types.ts#UiNode.hidden, adapters/wda-source.ts#parkedIn)', () => {
    expect(description('ui_snapshot')).toContain('"hidden": true (iOS wda) — listed but not shown (a tab bar a pushed screen hides), no cover');
    expect(full('ui_snapshot')).toContain('"hidden": true');
    expect(full('ui_snapshot')).toContain('a screen presented over that element covers it all the same, through the layer WebDriverAgent shows presented');
    expect(full('ui_snapshot')).toContain('at its cell\'s rect');
  });

  it('ui_snapshot: says what WDA\'s `"presentation": "alert"` means (adapters/types.ts#UiNode.presentation): the alert covers the whole screen beneath it', () => {
    expect(description('ui_snapshot')).toContain('"presentation" ("alert", "actionSheet", "popover", "screen", "backdrop"; on an Android root "dialog"/"screen") — a layer presented over the screen, covering everything beneath it');
    expect(full('ui_snapshot')).toContain('"presentation": "alert"');
    expect(full('ui_snapshot')).toContain('covers the whole screen beneath it');
  });

  it('ui_snapshot and scroll_until: the alert\'s remedy is quoted from its owner (ui-tree/standing.ts) — of "it" for tap and scroll_until, of "the element" for color/ocr — never typed out', async () => {
    const { presentedRemedy, presentedStop } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
    const alert = { kind: 'alert', label: '…' } as const;
    expect(full('ui_snapshot')).toContain(
      `tap and scroll_until refuse a target there naming the alert ('${presentedRemedy('it', alert)}'), ` +
        `color/ocr fail closed likewise ('${presentedRemedy('the element', alert)}')`,
    );
    expect(full('ui_snapshot')).toContain(
      `an action sheet or a popover is named the same way; under a "screen" layer they name what of that layer lies at the point — the layer itself where nothing of it draws — and say '${presentedRemedy('it')}'`,
    );
    expect(full('scroll_until')).toContain(`on … — ${presentedStop(alert)}, so none was sent"`);
    for (const tool of ['ui_snapshot', 'scroll_until']) expect(description(tool)).not.toContain('an alert is presented over');
  });

  it('ui_snapshot: says what the root\'s dialect marks mean — WDA\'s `"unclippedFrames": true` (adapters/types.ts#UiNode.unclippedFrames) and idb\'s `"flatList": true`', () => {
    expect(description('ui_snapshot')).toContain('"unclippedFrames" (iOS wda: frames as laid out, past their scroll view\'s), "flatList" (iOS idb: no nesting)');
    expect(full('ui_snapshot')).toContain('"unclippedFrames": true under iOS wda');
    expect(full('ui_snapshot')).toContain('"flatList": true under iOS idb');
  });

  it('ui_snapshot: a hidden subtree\'s root is any element but a structural wrapper — a scroll view and a toolbar too, as adapters/wda-source.ts#hiddenRoots asks (STRUCTURAL_ROLES), not only a control, an image or a text', () => {
    expect(full('ui_snapshot')).toContain('a subtree whose ROOT — any element but a structural wrapper —');
    expect(full('ui_snapshot')).not.toContain('a control, an image or a text, never a wrapper');
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

  it('scroll_until: the timeout is checked once a round, so a call can run past it by one swipe, its settle and one more round', () => {
    expect(description('scroll_until')).toContain('at maxSwipes / timeoutMs (checked once a round, so a call can run past it by one swipe and one more read)');
    expect(full('scroll_until')).toContain(
      'The timeout is checked once a round, after its tree read (and, on Android, its keyboard queries), so a call can run past it by one swipe, the settle after it and one more such round — the one that shows what that swipe did; the time a failure reports includes all of it. ',
    );
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(
      'The budget is checked once a round, after its tree read and keyboard queries, so the time taken can pass `timeoutMs` by one swipe, the settle after it and one more round — its tree read and, on Android, its keyboard queries — and includes them.',
    );
  });

  it('troubleshooting quotes the failure of a fully: true call whose margin text, seen drawn over it, moved with it, as the code words it', () => {
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    const words = boundText({ of: 'movesWith', offset: { dx: 0, dy: -300 } }, 1);
    expect(words).toBe('after 1 swipe (the text drawn over it moved with it, both by 0,-300 since a screenshot saw it there: it scrolls with the element, so no swipe brings the element out from under it)');
    expect(troubleshooting).toContain(`failed ${words.replace('1 swipe', 'N swipes').replace('0,-300', 'dx,dy')} — …`);
    expect(troubleshooting).not.toContain('runs to its timeout (a known limit)');
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
    expect(full('scroll_until')).toContain('With the soft keyboard up (Android; iOS with treeSource: wda, or idb\'s band read by its shape) the viewport is the screen ABOVE it');
    expect(full('scroll_until')).toContain(
      'With treeSource: idb nothing in the tree is marked as the keyboard; averi reads where its background starts by its shape and judges against that line as above: the swipes touch down above it, no stop has the element\'s centre below it, and with fully: true none of the element may lie below it.',
    );
    expect(full('scroll_until')).not.toContain('nothing changes there');
    expect(description('scroll_until')).toContain('With the soft keyboard up the viewport is the screen above it');
  });

  it('a color/ocr assert counts the band as covering', () => {
    expect(full('assert')).toContain('one under the soft keyboard (Android; iOS with treeSource: wda, or idb\'s band read by its shape)');
    expect(description('assert')).toContain('A color/ocr assert never measures what covers its element: under the soft keyboard');
  });

  it('the tap: a centre under the band is refused, and a covered node was measured absent from idb\'s tree', () => {
    expect(description('tap')).toContain('iOS idb marks no keyboard and refuses a centre below the keyboard\'s top line likewise');
    expect(full('tap')).toContain('a target whose centre lies below that line is REFUSED, nothing tapped');
    expect(full('tap')).toContain('Measured twice on iOS 27, a covered node was absent from idb\'s tree and the tap timed out waiting for it to appear.');
  });
});

/**
 * The structural row's trade-off (draw-order.ts NOT_DRAWN.structural, FRAME_EXCUSES), said where a refusal beside a
 * floating action button is read: which wrappers with children count as a cover, as the code excuses them — the
 * screen's size (`screenSizedHost`), an unlabelled, unvalued one holding the target with its whole scroll view, or one
 * with no identifier holding only empty frames.
 */
describe('tool descriptions on a wrapper counted as a cover', () => {
  it('tap says when a wrapper with children covers, and that a FAB\'s host can be refused — what to do said once, in the refusal\'s quoted hint', () => {
    expect(full('tap')).toContain(
      'A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over all of its rect, unless, among others, it is the screen\'s size (90 % of it or more), or it has no label and no value and holds the target together with the target\'s whole scroll view, or it has no label, value or identifier and holds only empty frames —',
    );
    expect(full('tap')).toContain(
      'a target beside or under such a FAB can be refused naming the container. When such a wrapper holds one child only, a control of at most a quarter of its area, the refusal says so',
    );
    expect(full('tap')).not.toContain('tap the FAB\'s own button');
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    expect(troubleshooting).toContain('and a `color`/`ocr` assert there fails closed on it. When the wrapper holds one child only');
    expect(troubleshooting).not.toContain('Tap the FAB\'s own button');
  });

  it('tap and troubleshooting say the refusal names the wrapper\'s one small control, and that a tab bar\'s host gets no such line', () => {
    const SENTENCE =
      'When such a wrapper holds one child only, a control of at most a quarter of its area, the refusal says so in place of "scroll_until it first": \'the wrapper may only position its one child, <child>: tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first\'; a wrapper of several children (a tab bar\'s host) gets no such line.';
    expect(full('tap')).toContain(SENTENCE);
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(
      'When the wrapper holds one child only, a control of at most a quarter of its area, the refusal ends `… — the wrapper may only position its one child, <child>: tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first` instead; a wrapper of several children (a tab bar\'s host) gets no such line.',
    );
  });

  it('troubleshooting quotes the cut-by-a-later-node refusal and failure with their way past, as the code words it', () => {
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    const wayPast = wholeThinWayPast(node({ role: '<role>' }));
    expect(troubleshooting).toContain(`scroll_until it out from under that <role> first (${wayPast}); nothing was tapped\`**`);
    expect(troubleshooting).toContain('— or it is only that thin, laid flush against it; a tap refuses it so cut (…)`** (Android)');
    expect(full('tap')).toContain('So is a control Android dumps as a strip thinner than that minimum flush against an element drawn after it that spans it');
  });

  it('scroll_until points at it where it fails naming a cover', () => {
    expect(full('scroll_until')).toContain('it fails naming that element (on Android a floating action button\'s full-width host counts as one — see tap)');
  });
});

/**
 * The owners' real presented sentences — the mocks above replace them for the descriptions — for the troubleshooting
 * reference, which quotes them as text: derived from the code, never typed out here.
 */
async function actualSentences(): Promise<{
  PRESENTED_OVER: string;
  PRESENTED_STOP: string;
  PRESENTED_OVER_THE_ELEMENT: string;
  OFF_THE_SCREEN: string;
  TOO_THIN_ON_THE_SCREEN: string;
  OUTSIDE_ITS_SCROLL_VIEW: string;
  TOO_THIN_IN_ITS_SCROLL_VIEW: string;
}> {
  const { presentedRemedy, presentedStop } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
  const [PRESENTED_OVER, PRESENTED_STOP, PRESENTED_OVER_THE_ELEMENT] = [presentedRemedy('it'), presentedStop(), presentedRemedy('the element')];
  const { OFF_THE_SCREEN, TOO_THIN_ON_THE_SCREEN, OUTSIDE_ITS_SCROLL_VIEW, TOO_THIN_IN_ITS_SCROLL_VIEW } = await vi.importActual<typeof import('../../src/verify/pixel-poll.js')>(
    '../../src/verify/pixel-poll.js',
  );
  return { PRESENTED_OVER, PRESENTED_STOP, PRESENTED_OVER_THE_ELEMENT, OFF_THE_SCREEN, TOO_THIN_ON_THE_SCREEN, OUTSIDE_ITS_SCROLL_VIEW, TOO_THIN_IN_ITS_SCROLL_VIEW };
}

/** The real pixel slack, for the troubleshooting reference (no import reaches it). */
async function actualSlack(): Promise<number> {
  return (await vi.importActual<typeof import('../../src/ui-tree/geometry.js')>('../../src/ui-tree/geometry.js')).PIXEL_OVERLAP_SLACK;
}

/** A screen presented over the target (ADR 0018): the tap's and scroll_until's own sentences, and the troubleshooting entry. */
describe('tool descriptions on a screen presented over the target', () => {
  const TROUBLESHOOTING = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
  const TAP_SENTINEL = '<the presented remedy, as ui-tree/standing.ts renders it of "it">';
  const PIXEL_SENTINEL = '<the presented remedy, as ui-tree/standing.ts renders it of "the element">';
  const STOP_SENTINEL = '<the presented stop\'s remedy, as ui-tree/standing.ts renders it>';

  it('every description quotes the owners\' sentences, never a copy of them', async () => {
    const { PRESENTED_OVER, PRESENTED_STOP, PRESENTED_OVER_THE_ELEMENT } = await actualSentences();
    for (const tool of ['tap', 'scroll_until', 'assert']) {
      for (const sentence of [PRESENTED_OVER, PRESENTED_STOP, PRESENTED_OVER_THE_ELEMENT]) expect(description(tool)).not.toContain(sentence);
    }
    expect(description('tap')).toContain(`Under a screen presented over the target the refusal says '${TAP_SENTINEL}' instead, whatever else is wrong.`);
    expect(description('scroll_until')).toContain(`— a swipe there could dismiss it — and fails "… ${STOP_SENTINEL}".`);
    expect(description('assert')).toContain(`under a screen presented over the element it says '${PIXEL_SENTINEL}'.`);
  });

  it('every elided quote of the presented remedy ("— a screen is presented over it …") in a description or the troubleshooting reference is how the owner\'s sentence begins', async () => {
    const { PRESENTED_OVER } = await actualSentences();
    const elided = (text: string): string[] => [...text.matchAll(/— (a screen is presented over [^…"`]*?) …/g)].map((m) => m[1]);
    const quoted = [...elided(full('scroll_until')), ...elided(TROUBLESHOOTING)];
    expect(quoted.length).toBeGreaterThanOrEqual(4);
    for (const head of quoted) expect(PRESENTED_OVER.startsWith(`${head} `)).toBe(true);
  });

  it('tap: the general remedy defers to it, and its refusal says to close the screen first; a host with children is no such screen', async () => {
    const { PRESENTED_OVER } = await actualSentences();
    expect(full('tap')).toContain('with less showing it is REFUSED, naming the cover, nothing tapped — scroll_until it first, unless the cover is a screen presented over the target (below); ');
    // …or a cover whose order the tree does not tell (iOS's reading order): one screenshot tells it (ADR 0024); no scroll advised either.
    expect(full('tap')).toContain('averi then takes ONE screenshot and compares the two controls\' colours where they overlap and beside it: the target seen on top is tapped as usual; ');
    expect(full('tap')).toContain('"under …, drawn over it as a screenshot shows (the two are listed in reading order)" — close a menu or popover first, no scroll; ');
    expect(full('tap')).toContain('"overlapped by …, the two listed in reading order: which is drawn on top is not told" and why the screenshot could not tell, advising no scroll (if the target is the one on top, tap it by coordinates). ');
    expect(full('scroll_until')).toContain('"overlapped by …, the two listed in reading order: which is drawn on top is not told") is judged on one screenshot, as for tap — seen on top, it is reached; else it stops before any swipe');
    expect(full('assert')).toContain('the assert judges which is drawn on top on the frame it captures anyway, as for tap: the element seen on top is measured; else the failure names the control drawn over it (or says the order is not told) and advises no scroll. ');
    expect(full('tap')).toContain('fully: true when the next step measures it), unless a screen is presented over the target (below); ');
    expect(full('tap')).toContain(
      'Under a screen presented over the target — iOS wda: a layer WebDriverAgent shows presented (see ui_snapshot\'s "presentation"; an alert, an action sheet or a popover is named as ui_snapshot says); elsewhere (Android): a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window — the refusal says so instead of "scroll_until it first" or the status bar\'s advice, whatever else keeps the target from a tap — its centre under that screen, off the screen or under the status bar (wholly too: the screen is judged presented over the target itself, wherever it lies), or a cut at its scroll container\'s edge: ' +
        `'${PRESENTED_OVER}'. Close that screen first. A full-screen host that only carries a bar or other content of its own (a host with children) is no such screen: only what it draws covers.`,
    );
  });

  it('tap, scroll_until, ui_snapshot and the troubleshooting reference: on Android a presented window is listed alone, and a target not in it gets the presented remedy', async () => {
    const { presentedRemedy, presentedStop } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
    expect(full('tap')).toContain('On Android uiautomator lists the active window only: with a dialog or a bottom sheet up the tree holds that window alone');
    expect(full('scroll_until')).toContain('The same on Android when the tree is a presented window (ui_snapshot\'s root carries "presentation": "dialog" or "screen"; or, for a target its read does not hold, the window manager names the window a Dialog\'s — asked once before the first swipe');
    expect(full('ui_snapshot')).toContain('"activeWindowOnly": true under Android — uiautomator lists the active window only');
    expect(full('ui_snapshot')).toContain('the screen beneath is not in the tree at all — tap, fill and scroll_until say');
    expect(full('tap')).toContain('and the wait for it (this tap\'s, and fill\'s) ends');
    expect(description('tap')).toContain('On Android the tree lists the active window only: a target beneath a dialog or sheet is not in it, and the wait ends "… is not in the tree, which lists only the window presented on top …"');
    expect(description('ui_snapshot')).toContain('"activeWindowOnly" (Android: only the active window is listed)');
    expect(TROUBLESHOOTING).toContain(`is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — ${presentedRemedy('it', { kind: 'dialog' })}\`** (tap, fill; Android)`);
    expect(TROUBLESHOOTING).toContain(`— ${presentedStop({ kind: 'dialog' })}, so none was sent\``);
  });

  it('tap, assert and the troubleshooting reference quote the active-window hint every not-found carries on Android with no window marked presented — the waits\', scroll_until\'s, the asserts\', a flow\'s wait: and an optional step\'s skip', async () => {
    const { ACTIVE_WINDOW_HINT } = await vi.importActual<typeof import('../../src/ui-tree/miss.js')>('../../src/ui-tree/miss.js');
    expect(full('tap')).toContain(`the wait still ends "… to appear", with "(${ACTIVE_WINDOW_HINT})" beneath it when the window manager does not say the window is the app's screen alone (its call failed, or another window of the app shows; unless the target matched only 0×0 nodes, whose hint takes its place:`);
    expect(full('tap')).toContain('a full-screen dialog or a sheet whose dump carries no scrim, once the wait has found nothing, by the window manager\'s word');
    expect(full('tap')).toContain('instead of "… to appear" — where that window holds a list of its own, the reply says first to scroll_until it in that list (');
    expect(full('tap')).toContain(
      'as scroll_until\'s "element never appeared in the tree" carries it (its stop under a keyboard over the whole screen too), and so do a flow\'s tap, fill and scroll_until steps (the same waits), a flow\'s wait: on an element (beneath its "Timed out …"), every assert\'s "not found within …" (after it) and a skipped optional step\'s line ("(not present) (…)", or a skipped wait:\'s "Timed out … (…)"): every reply that says a target is not in such a tree, once.',
    );
    expect(description('tap')).toContain(`"… to appear" with "(${ACTIVE_WINDOW_HINT})"`);
    expect(full('assert')).toContain(`On Android an assert whose element is not in the tree fails "not found within … (${ACTIVE_WINDOW_HINT})" when the window manager does not say the window is the app's screen alone`);
    expect(TROUBLESHOOTING).toContain(
      `\`element never appeared in the tree\` (its stop under a keyboard over the whole screen too), every assert's \`not found within …\`, a flow's \`wait:\` on an element and an optional step's \`(not present)\` (a skipped \`wait:\`'s headline too) carry \`(${ACTIVE_WINDOW_HINT})\``,
    );
  });

  it('tap, assert and the troubleshooting reference: an assert and a flow\'s wait: beneath a window listed alone say the presented remedy, as the tap does', () => {
    // The note is miss.ts's (missNote, quoted by the descriptions from its owner), one phrase with no parenthesis inside.
    const note = 'a dialog is presented over it, and the tree lists only that window — close it first';
    expect(full('assert')).toContain(`the parenthesis names it instead: "(${note})"`);
    expect(full('tap')).toContain(`(a flow's wait: on an element says "(${note})" beneath its "Timed out …", every assert's "not found within …" after it)`);
    expect(TROUBLESHOOTING).toContain(`An assert's \`not found within …\` and a flow's \`wait:\` on an element say the same remedy, in their parenthesis: \`(${note})\``);
  });

  it('scroll_until: one confirming read when the timeout allows, then it fails without swiping further, saying which', async () => {
    const { PRESENTED_STOP } = await actualSentences();
    expect(full('scroll_until')).toContain(
      'Once a read finds the target in the viewport under a screen presented over it (as for tap: a layer WebDriverAgent shows presented, or elsewhere a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window), scroll_until confirms with one more read when the timeout allows, and fails without swiping further — "stopped before any swipe …" or "stopped after N swipes, without swiping further …", then "' +
        `${PRESENTED_STOP}" — since a swipe there could dismiss a sheet or raise its discard prompt.`,
    );
  });

  it('scroll_until: a target not judged in the viewport whose swipe would touch down on that screen fails without the swipe — the description and the troubleshooting entry say so, and that a target not yet in the tree is still swiped for', () => {
    expect(full('scroll_until')).toContain(
      'The same holds, with the same confirming read, for a target in the tree that is NOT judged in the viewport (below the fold, under the soft keyboard, cut, or under a bar of its own screen) when the next swipe would touch down on such a screen: it fails without that swipe, saying why the target is not in the viewport and where the swipe would have landed — e.g. "element lies below the viewport, and the next swipe would touch down at (201,699) on container "dismiss popup" (0,0 402x874) — a screen is presented over it …" — since that swipe would land on the presented screen, not on the target\'s (a popover closed, a sheet moved to another detent); a read that fails meanwhile is retried, never answered with a swipe. When a bound (maxSwipes, the timeout, content exhausted) ends the scroll first, the failure adds "The next swipe would have touched down at (x,y) on … — a screen is presented over it …". A row of the presented sheet itself is still swiped for on the sheet, and a target not yet in the tree is still swiped for — except under a layer WebDriverAgent shows presented',
    );
    expect(TROUBLESHOOTING).toContain(
      '`scroll_until` says the same when the target is in the tree but not in the viewport (below the fold, under the soft keyboard, cut) and the next swipe would touch down on such a screen: `… — element lies below the viewport, and the next swipe would touch down at (x,y) on <that screen\'s dimming view or scroll view> — a screen is presented over it …`, and no swipe was sent, because that swipe would land on the modal or sheet (closing a popover, moving a sheet to another size) and not on the target\'s screen. A failure at a bound adds `The next swipe would have touched down at (x,y) on … — a screen is presented over it …` for the same reason. Close that screen first here too.',
    );
  });

  it('scroll_until: under a layer WDA shows presented no swipe is sent for a target not in the tree either, but on that layer\'s own scroll view — the description says so', () => {
    expect(full('scroll_until')).toContain(
      'except under a layer WebDriverAgent shows presented (iOS wda: an alert, an action sheet, a popover, or a "screen" layer such as a sheet), where no swipe is sent for any target unless it would touch down on a scroll view of that layer\'s own (a search inside the sheet\'s list)',
    );
  });

  it('troubleshooting: the entry, the wrapper sentence as the code has it, and the picker\'s exception over another screen', async () => {
    const { PRESENTED_OVER, PRESENTED_STOP } = await actualSentences();
    expect(TROUBLESHOOTING).toContain(`\`scroll_until\` says it as \`… ${PRESENTED_STOP}, so none was sent\` (or \`so no further swipe was sent\`).`);
    expect(TROUBLESHOOTING).toContain(
      `- **\`… ${PRESENTED_OVER}\`** (tap or \`scroll_until\`): the target lies on the screen beneath a modal or sheet that is still up — whatever else keeps it from a tap (its centre under that screen, off the screen or under the status bar — wholly too, since the screen is judged presented over the target itself, wherever it lies — or a cut at its scroll container's edge), a tap says this in place of that remedy (\`scroll_until it first\`, the status bar's advice); nothing was tapped and no further swipe was sent.`,
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

  it('troubleshooting: under an alert — the tap\'s, scroll_until\'s (its swipe would land on the alert; a target not in the tree included), the picker\'s and color/ocr\'s words, as the owner renders them', async () => {
    const { presentedRemedy, presentedStop } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
    const alert = { kind: 'alert', label: '…' } as const;
    expect(TROUBLESHOOTING).toContain(`- **\`… ${presentedRemedy('it', alert)}\`** (tap or \`scroll_until\`; iOS with \`treeSource: wda\`)`);
    expect(TROUBLESHOOTING).toContain(`\`scroll_until\` says it as \`… ${presentedStop(alert)}, so none was sent\` (or \`so no further swipe was sent\`)`);
    expect(TROUBLESHOOTING).toContain(`\`scroll_until … stopped before any swipe — element is not in the tree, and the next swipe would touch down at (x,y) on … — ${presentedStop(alert)}, so none was sent\``);
    expect(TROUBLESHOOTING).toContain(`  - \`${presentedRemedy('it', alert)}\` (iOS with \`treeSource: wda\`): an alert is up over the entry's screen`);
    expect(TROUBLESHOOTING).toContain(`the message ends \`… ${presentedRemedy('the element', alert)}\` instead: tap the alert's button that closes it`);
  });

  it('troubleshooting: an action sheet or a popover reads as the alert, named by its kind; a layer WDA shows presented stops a swipe for a target not in the tree, but on its own scroll view', async () => {
    const { presentedRemedy } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
    expect(TROUBLESHOOTING).toContain(`\`… ${presentedRemedy('it', { kind: 'actionSheet', label: '…' })}\``);
    expect(TROUBLESHOOTING).toContain('`ui_snapshot` marks its layer `"presentation": "alert"` and the Alert itself `"presentationElement": true`');
    expect(TROUBLESHOOTING).toContain('`ui_snapshot` marks the layer `"presentation": "screen"`');
    expect(TROUBLESHOOTING).toContain(
      'Under a layer WebDriverAgent shows presented (iOS with `treeSource: wda`) no swipe is sent for a target not in the tree either — `scroll_until … stopped before any swipe — element is not in the tree, and the next swipe would touch down at (x,y) on … — a screen is presented over it …` — unless the swipe would touch down on a scroll view of that layer\'s own',
    );
  });

  it('color/ocr: under a presented screen the assert fails closed saying to close it first, not to scroll — in the description and the troubleshooting entry', async () => {
    const { PRESENTED_OVER_THE_ELEMENT } = await actualSentences();
    expect(full('assert')).toContain(
      `Under a screen presented over the element (a layer WebDriverAgent shows presented, or a modal's full-screen dimming view or a sheet's scroll view, as for tap) no scroll helps, and the failure says so instead: '${PRESENTED_OVER_THE_ELEMENT}' (whatever else lies over it — the status bar, a possible cut at the navigation bar — in place of its own advice, and wherever the element lies, nothing of it on the screen included; a keyboard the device reports is still named first, with its own).`,
    );
    expect(TROUBLESHOOTING).toContain(
      `Under a modal or sheet still up over the element's screen the message ends \`… ${PRESENTED_OVER_THE_ELEMENT}\` instead, whatever else lies over it (the status bar, a possible cut at the navigation bar): the message still names what lies over it, and this replaces its own advice. Close that screen, then assert again.`,
    );
  });

  it('color/ocr and tap: an element on the screen that its scroll view draws none of (WDA) is never measured nor tapped — the description and the troubleshooting entries quote the misses', async () => {
    const { OUTSIDE_ITS_SCROLL_VIEW, TOO_THIN_IN_ITS_SCROLL_VIEW } = await actualSentences();
    expect(full('assert')).toContain(
      `On iOS with treeSource: wda an element on the screen that its scroll view draws none of (listed past the scroll view's frame, as WebDriverAgent lists a scroll view's content) fails closed likewise with '${OUTSIDE_ITS_SCROLL_VIEW} <the scroll view> (element …, screen …)', and one its scroll view's edge leaves a sliver no thicker than ${await actualSlack()} pt with '${TOO_THIN_IN_ITS_SCROLL_VIEW} <the scroll view> (element …, drawn …, screen …)'`,
    );
    expect(TROUBLESHOOTING).toContain(`- **\`color\`/\`ocr\` fails with \`${OUTSIDE_ITS_SCROLL_VIEW} <scroll view> (element …, screen …)\`** or **\`${TOO_THIN_IN_ITS_SCROLL_VIEW} <scroll view> (element …, drawn …, screen …)\`**`);
    expect(TROUBLESHOOTING).toContain(`or only a sliver no thicker than ${await actualSlack()} pt at the scroll view's edge`);
    expect(full('tap')).toContain('is REFUSED as off screen, naming the scroll view, nothing tapped — scroll_until it first — after the keyboard is hidden');
    expect(TROUBLESHOOTING).toContain('- **`… is outside its scroll view <scroll view> at (x,y): nothing of it is drawn (rect …) — scroll_until it first; nothing was tapped`**');
  });

  it('color/ocr: an element nothing of which lies on the screen fails closed saying so — scroll it on-screen, or close the presented screen first — and color is judged over the region its sampler reads', async () => {
    const { PRESENTED_OVER_THE_ELEMENT, OFF_THE_SCREEN, TOO_THIN_ON_THE_SCREEN } = await actualSentences();
    expect(full('assert')).toContain(
      `An element nothing of which (of what the assert reads) lies on the screen fails closed with '${OFF_THE_SCREEN} (element …, screen …)', and one of which the screen's edge leaves a sliver no thicker than ${await actualSlack()} units (pt on iOS, px on Android) with '${TOO_THIN_ON_THE_SCREEN} (element …, on the screen …, screen …)' — scroll it on-screen (scroll_until it first), or, under a presented screen, close that screen first; the poll goes on, so one scrolled on-screen before the deadline is measured.`,
    );
    expect(TROUBLESHOOTING).toContain(`or **\`${TOO_THIN_ON_THE_SCREEN} (element …, on the screen …, screen …)\`**: nothing of what the assert reads lies on the screen`);
    expect(TROUBLESHOOTING).toContain(`or the screen's edge leaves only a sliver of it no thicker than ${await actualSlack()} units (pt on iOS, px on Android)`);
    expect(TROUBLESHOOTING).toContain(`An overlap of ${await actualSlack()} units or less (pt on iOS, px on Android) does not count`);
    expect(TROUBLESHOOTING).toContain(`with \`fully: true\` none of the element may lie under a system bar past ${await actualSlack()} units (pt on iOS, px on Android)`);
    expect(full('assert')).toContain(`and an overlap of ${await actualSlack()} units or less are not counted`);
    expect(full('scroll_until')).toContain(`past ${await actualSlack()} units (pt on iOS, px on Android)`);
    expect(description('scroll_until')).toContain('past 2.25 units (pt on iOS, px on Android)');
    expect(full('assert')).toContain('Judged over what the assert reads: the whole rect for ocr; for color the part of the rect on the screen, inset 12% a side — the region its sampler reads — so');
    expect(TROUBLESHOOTING).toContain(`- **\`color\`/\`ocr\` fails with \`${OFF_THE_SCREEN} (element …, screen …)\`** or`);
    expect(TROUBLESHOOTING).toContain(`the message ends \`… ${PRESENTED_OVER_THE_ELEMENT.slice(0, PRESENTED_OVER_THE_ELEMENT.indexOf(' — close it first') + ' — close it first'.length)}; …\` instead: close that screen first.`);
    expect(TROUBLESHOOTING).toContain('for `color` the part of the rect on the screen, less 12% on each side of it — the region its sampler reads');
    // The sampler's own fact for a rect of no area, from its owner (verify/color-parity.ts#NO_AREA).
    const { NO_AREA } = await vi.importActual<typeof import('../../src/verify/color-parity.js')>('../../src/verify/color-parity.js');
    expect(TROUBLESHOOTING).toContain(`- **\`color\` fails with \`${NO_AREA} (rect …)\`**: the element's rect is collapsed to no width or no height — a node idb lists as 0x0 once scrolled off the screen`);
  });
});

/**
 * scroll_until's timeout reply (interact/scroll-text.ts#timeoutText): the troubleshooting reference quotes one
 * rendering of it, derived here from the owner — never typed out — so the entry cannot drift from the reply.
 */
describe('troubleshooting on a scroll_until timeout', () => {
  it('quotes the reply as interact/scroll-text.ts renders it: the time spent, the budget, no swipe sent, what the read took', async () => {
    const { timeoutText } = await vi.importActual<typeof import('../../src/interact/scroll-text.js')>('../../src/interact/scroll-text.js');
    const rendered = timeoutText({ of: 'timeout', timeoutMs: 15_000, elapsedMs: 38_204, reads: { count: 1, totalMs: 38_204, lastMs: 38_204 } }, 0);
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(`\`scroll_until … failed ${rendered} — …\``);
  });
});

/**
 * scroll_until's end proof, the fully probe's `axis` clause and the presented touch-down on a dialog's dim
 * (interact/scroll-text.ts#endTurnText, #boundText, #flushText, #touchDownText): the troubleshooting reference quotes
 * one rendering of each, derived here from the owner — the scroll view or container elided where the entry says
 * `<scroll view>` — so an entry cannot drift from the reply.
 */
describe('troubleshooting on scroll_until\'s end proof, unchecked axis and the dim outside a dialog', () => {
  const TROUBLESHOOTING = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
  const lower = node({ role: 'scrollable', rect: { x: 0, y: 380, width: 402, height: 180 } });

  it('the end turn\'s clause and the one-stroke stop\'s failure, as the code words them', async () => {
    const { endTurnText, boundText } = await vi.importActual<typeof import('../../src/interact/scroll-text.js')>('../../src/interact/scroll-text.js');
    const { nodeText } = await vi.importActual<typeof import('../../src/ui-tree/geometry.js')>('../../src/ui-tree/geometry.js');
    const elide = (text: string): string => text.replace(nodeText(lower), '<scroll view>');
    expect(TROUBLESHOOTING).toContain(`- **\`scroll_until\` reply or failure has \`${elide(endTurnText({ way: 'up', to: 'down', after: 1, unmoved: 1, scrollView: lower }))}\`**`);
    expect(TROUBLESHOOTING).toContain(`\`${elide(endTurnText({ way: 'up', to: 'down', after: 3, unmoved: 1, scrollView: lower })).split(' — ')[0].slice(2)}\` means`);
    const proven = boundText({ of: 'exhausted', lastStroke: 'up', unchanged: 'matches', ends: { way: 'up', unmoved: 1, scrollView: lower } }, 1);
    expect(TROUBLESHOOTING).toContain(`- **\`scroll_until … failed ${elide(proven)} — …\`**`);
  });

  it('the fully probe unchecked for its axis, and the swipe that would touch down on the dim outside a dialog', async () => {
    const { flushText, touchDownText } = await vi.importActual<typeof import('../../src/interact/scroll-text.js')>('../../src/interact/scroll-text.js');
    const axis = flushText({ edge: 'top', container: { x: 66, y: 380, width: 948, height: 234 }, checked: false, why: 'axis' });
    expect(TROUBLESHOOTING).toContain(`\`… ${axis.slice(axis.indexOf('and every scroll container'))}\`**`);
    const dialog = { x: 155, y: 851, width: 770, height: 517 };
    const dim = touchDownText({ touchDown: { x: 540, y: 1776 }, surface: node({ role: 'container', rect: dialog }), reach: dialog });
    expect(TROUBLESHOOTING).toContain(`\`…${dim} — a dialog is presented over it …\``);
  });
});

/**
 * The full reference (skill/references/tools.md) is prose no import reaches, so the defaults it quotes are literals:
 * each pinned here against its owner's REAL constant, as the descriptions are against the mocked one above.
 */
describe('the full reference quotes each operation default as shipped', () => {
  it('the settle, assert, foreground and ensure budgets, the swipe reach and the scroll, log and contract defaults', async () => {
    const actual = async <T>(path: string): Promise<T> => vi.importActual<T>(path);
    const { formatSeconds } = await actual<typeof import('../../src/util/duration.js')>('../../src/util/duration.js');
    const { DEFAULT_SETTLE_TIMEOUT_MS } = await actual<typeof import('../../src/interact/resolve.js')>('../../src/interact/resolve.js');
    const { ASSERT_TIMEOUT_MS, PIXEL_ASSERT_TIMEOUT_MS } = await actual<typeof import('../../src/verify/assert.js')>('../../src/verify/assert.js');
    const { FOREGROUND_WAIT_MS } = await actual<typeof import('../../src/adapters/ios-foreground.js')>('../../src/adapters/ios-foreground.js');
    const { SWIPE_REACH_FRACTION } = await actual<typeof import('../../src/interact/swipe.js')>('../../src/interact/swipe.js');
    const { DEFAULT_MAX_SWIPES, DEFAULT_SCROLL_TIMEOUT_MS } = await actual<typeof import('../../src/interact/scroll.js')>('../../src/interact/scroll.js');
    const { DEFAULT_ENSURE_TIMEOUT_MS } = await actual<typeof import('../../src/flow/engine.js')>('../../src/flow/engine.js');
    const { LOG_MAX_LINES } = await actual<typeof import('../../src/run/verify.js')>('../../src/run/verify.js');
    const { DEFAULT_TOLERANCE_DE, CONTRACT_TOL_FACTOR } = await actual<typeof import('../../src/verify/color-parity.js')>('../../src/verify/color-parity.js');
    const { DEFAULT_SIZE_TOLERANCE_PCT } = await actual<typeof import('../../src/verify/text-parity.js')>('../../src/verify/text-parity.js');

    for (const tool of ['tap', 'type_text']) expect(full(tool)).toContain(`up to ${formatSeconds(DEFAULT_SETTLE_TIMEOUT_MS)}`);
    expect(full('ui_snapshot')).toContain(`assert polls (${formatSeconds(ASSERT_TIMEOUT_MS)} by default`);
    expect(full('assert')).toContain(`waits up to ${formatSeconds(ASSERT_TIMEOUT_MS)} (tree asserts) or ${formatSeconds(PIXEL_ASSERT_TIMEOUT_MS)} (color/ocr`);
    expect(full('launch_app')).toContain(`waiting at most ${formatSeconds(FOREGROUND_WAIT_MS)}`);
    expect(full('ensure_state')).toContain(`the whole ~${formatSeconds(DEFAULT_ENSURE_TIMEOUT_MS)} second look`);
    expect(full('swipe')).toContain(`a stroke through the screen centre, ${Number((SWIPE_REACH_FRACTION * 100).toFixed(2))}% of the screen either side`);
    expect(full('scroll_until')).toContain(`\`maxSwipes\`: Default ${DEFAULT_MAX_SWIPES} `);
    expect(full('scroll_until')).toContain(`\`timeoutMs\`: Default ${DEFAULT_SCROLL_TIMEOUT_MS}\n`);
    expect(full('get_logs')).toContain(`(default ${LOG_MAX_LINES})`);
    expect(full('verify')).toContain(`primary at tolerance_de, default ${DEFAULT_TOLERANCE_DE}; vs-contract at ${CONTRACT_TOL_FACTOR}x`);
    expect(full('verify')).toContain(`(tolerance_size_pct, default ${DEFAULT_SIZE_TOLERANCE_PCT}%`);
  });
});

/**
 * What the server's instructions say once for every tool (mcp/tools.ts#serverInstructions), and the pointers that
 * send an agent from a description to the full reference: each must land on a section that exists.
 */
describe('the server instructions and the pointers into the full reference', () => {
  it('the instructions carry the shared rules no description repeats', () => {
    expect(instructions).toContain('Double-quote a value with spaces: text:"Sign in" (text:Sign in fails at "in")');
    expect(instructions).toContain('"~" an unanchored JavaScript regex (no inline flags such as (?i))');
    expect(instructions).toContain('a missing one fails only the tools that cannot work without it (ensure_state, run_flow, verify, install_app without a path)');
    expect(instructions).toContain('Under a screen presented over the target (an alert, a sheet, a modal, an Android dialog) no scroll helps: close it first.');
    expect(instructions).toContain('An empty or bare tree is not absence: compare with screenshot.');
    expect(instructions).toContain("the averi skill's references/tools.md");
  });

  it('every references/tools.md#<tool> pointer names a section of the file', () => {
    const texts = [instructions, ...[...tools.values()].map((t) => JSON.stringify(t))];
    const pointed = texts.flatMap((text) => [...text.matchAll(/references\/tools\.md#([a-z_]+)/g)].map((m) => m[1]));
    expect(pointed.length).toBeGreaterThanOrEqual(6);
    for (const tool of pointed) expect(full(tool), tool).not.toBe('');
  });
});

/**
 * The rules a description keeps because breaking them makes an agent do something wrong or unsafe — the reason the
 * descriptions stayed this long and no shorter. Each is pinned by its phrase where the agent reads it (the description,
 * a parameter's, or the server's instructions), so a later trim cannot drop one unseen.
 */
describe('every description keeps the rules an agent must not break', () => {
  const KEPT: ReadonlyArray<readonly [tool: string, phrase: string]> = [
    ['tap', 'never the return key (it submits)'],
    ['tap', 'hide it yourself (tap a neutral element such as a title), then tap again'],
    ['tap', 'several interactive matches are REFUSED with the list — narrow the selector'],
    ['tap', 'at x/y coordinates (sent as given, unguarded)'],
    ['type_text', 'APPENDING to pre-filled content unless clear: true deletes it first'],
    ['type_text', '"Typed … — NOT verified"'],
    ['type_text', 'FAILS the read-back, saying whether only letter case differs — never the text'],
    ['type_text', 'The keyboard is NOT dismissed afterwards'],
    ['scroll_until', 'Pass fully: true when the next step MEASURES the element'],
    ['scroll_until', 'It never swipes on a screen presented over the target'],
    ['scroll_until', 'a swipe that CHANGES THE SCREEN stops the call'],
    ['scroll_until', 'A top bar the tree lists before the scroll view (iOS\'s navigation bar under wda) is not seen: check a stop near the top with a screenshot.'],
    ['assert', 'it fails closed naming what and where'],
    ['assert', 'is refused before any device is touched'],
    ['assert', 'pass timeout to shorten it'],
    ['verify', 'run the default (both) before declaring the task done'],
    ['verify', 'REFUSES the call before any device is touched'],
    ['ensure_state', 'is refused rather than run blind'],
    ['ensure_state', 'nothing was wiped'],
    ['select_device', 'never a silent fallback to another device'],
    ['launch_app', 'the launcher activity is picked arbitrarily — LeakCanary instead of the app'],
    ['get_logs', 'An invalid grep is refused before any device is touched'],
    ['swipe', 'in tree units (px on Android, pt on iOS)'],
    ['tap', "Element to tap, e.g. 'id:login_button' or 'text:\"Sign in\"' (quote values with spaces)"],
    ['ui_snapshot', 'Selector to filter nodes (quote values with spaces)'],
    ['type_text', "Field to focus first, e.g. 'id:amount_input' (quote values with spaces)"],
    ['scroll_until', "Element to scroll into view, e.g. 'id:submit_button' (quote values with spaces)"],
    ['tap', 'In tree units: px on Android, pt on iOS'],
    ['ui_snapshot', 'Rects are in tree units (px on Android, pt on iOS).'],
    ['ui_snapshot', '"heading": true (iOS) — drawn over the nodes listed after it that it overlaps (a pinned section header)'],
    ['ui_snapshot', '"secure": true — a masked input, its value bullets'],
    ['instructions', 'Coordinates and rects are in tree units: pixels on Android, points on iOS.'],
    ['instructions', 'follow it rather than retrying unchanged'],
  ];

  it.each(KEPT)('%s: "%s"', (tool, phrase) => {
    const where = tool === 'instructions' ? [instructions] : [description(tool), ...Object.keys(tools.get(tool)?.inputSchema.properties ?? {}).map((p) => property(tool, p).description ?? '')];
    expect(where.some((text) => text.includes(phrase)), `${tool} no longer says: ${phrase}`).toBe(true);
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { snapshotNote } from '../../src/mcp/tool-text.js';
import { wholeThinWayPast } from '../../src/interact/target-text.js';
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

  it('ui_snapshot: says what WDA\'s `"hidden": true` and a parked cell\'s content mean (adapters/types.ts#UiNode.hidden, adapters/wda-source.ts#parkedIn)', () => {
    expect(description('ui_snapshot')).toContain('"hidden": true');
    expect(description('ui_snapshot')).toContain('a screen presented over that element covers it all the same, through the layer WebDriverAgent shows presented');
    expect(description('ui_snapshot')).toContain('at its cell\'s rect');
  });

  it('ui_snapshot: says what WDA\'s `"presentation": "alert"` means (adapters/types.ts#UiNode.presentation): the alert covers the whole screen beneath it', () => {
    expect(description('ui_snapshot')).toContain('"presentation": "alert"');
    expect(description('ui_snapshot')).toContain('covers the whole screen beneath it');
  });

  it('ui_snapshot and scroll_until: the alert\'s remedy is quoted from its owner (ui-tree/standing.ts) — of "it" for tap and scroll_until, of "the element" for color/ocr — never typed out', () => {
    expect(description('ui_snapshot')).toContain(
      'tap and scroll_until refuse a target there naming the alert (\'<the presented remedy, as ui-tree/standing.ts renders it of "it" under an alert titled …>\'), ' +
        'color/ocr fail closed likewise (\'<the presented remedy, as ui-tree/standing.ts renders it of "the element" under an alert titled …>\')',
    );
    expect(description('ui_snapshot')).toContain(
      'an action sheet or a popover is named the same way; under a "screen" layer they name what of that layer lies at the point — the layer itself where nothing of it draws — and say \'<the presented remedy, as ui-tree/standing.ts renders it of "it">\'',
    );
    expect(description('scroll_until')).toContain('on … — <the presented stop\'s remedy, as ui-tree/standing.ts renders it under an alert titled …>, so none was sent"');
    for (const tool of ['ui_snapshot', 'scroll_until']) expect(description(tool)).not.toContain('an alert is presented over');
  });

  it('ui_snapshot: says what the root\'s dialect marks mean — WDA\'s `"unclippedFrames": true` (adapters/types.ts#UiNode.unclippedFrames) and idb\'s `"flatList": true`', () => {
    expect(description('ui_snapshot')).toContain('"unclippedFrames": true under iOS wda');
    expect(description('ui_snapshot')).toContain('"flatList": true under iOS idb');
  });

  it('ui_snapshot: a hidden subtree\'s root is any element but a structural wrapper — a scroll view and a toolbar too, as adapters/wda-source.ts#hiddenRoots asks (STRUCTURAL_ROLES), not only a control, an image or a text', () => {
    expect(description('ui_snapshot')).toContain('a subtree whose ROOT — any element but a structural wrapper —');
    expect(description('ui_snapshot')).not.toContain('a control, an image or a text, never a wrapper');
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
    expect(description('scroll_until')).toContain(
      'The timeout is checked once a round, after its tree read (and, on Android, its keyboard queries), so a call can run past it by one swipe, the settle after it and one more such round — the one that shows what that swipe did; the time a failure reports includes all of it. ',
    );
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(
      'The budget is checked once a round, after its tree read and keyboard queries, so the time taken can pass `timeoutMs` by one swipe, the settle after it and one more round — its tree read and, on Android, its keyboard queries — and includes them.',
    );
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
  it('tap says when a wrapper with children covers, and that a FAB\'s host can be refused — what to do said once, in the refusal\'s quoted hint', () => {
    expect(description('tap')).toContain(
      'A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over all of its rect, unless, among others, it is the screen\'s size (90 % of it or more), or it has no label and no value and holds the target together with the target\'s whole scroll view, or it has no label, value or identifier and holds only empty frames —',
    );
    expect(description('tap')).toContain(
      'a target beside or under such a FAB can be refused naming the container. When such a wrapper holds one child only, a control of at most a quarter of its area, the refusal says so',
    );
    expect(description('tap')).not.toContain('tap the FAB\'s own button');
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    expect(troubleshooting).toContain('and a `color`/`ocr` assert there fails closed on it. When the wrapper holds one child only');
    expect(troubleshooting).not.toContain('Tap the FAB\'s own button');
  });

  it('tap and troubleshooting say the refusal names the wrapper\'s one small control, and that a tab bar\'s host gets no such line', () => {
    const SENTENCE =
      'When such a wrapper holds one child only, a control of at most a quarter of its area, the refusal says so in place of "scroll_until it first": \'the wrapper may only position its one child, <child>: tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first\'; a wrapper of several children (a tab bar\'s host) gets no such line.';
    expect(description('tap')).toContain(SENTENCE);
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(
      'When the wrapper holds one child only, a control of at most a quarter of its area, the refusal ends `… — the wrapper may only position its one child, <child>: tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first` instead; a wrapper of several children (a tab bar\'s host) gets no such line.',
    );
  });

  it('troubleshooting quotes the cut-by-a-later-node refusal and failure with their way past, as the code words it', () => {
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    const wayPast = wholeThinWayPast(node({ role: '<role>' }));
    expect(troubleshooting).toContain(`scroll_until it out from under that <role> first (${wayPast}); nothing was tapped\`**`);
    expect(troubleshooting).toContain('— or it is only that thin, laid flush against it; a tap refuses it so cut (…)`** (Android)');
    expect(description('tap')).toContain('So is a control Android dumps as a strip thinner than that minimum flush against an element drawn after it that spans it');
  });

  it('scroll_until points at it where it fails naming a cover', () => {
    expect(description('scroll_until')).toContain('it fails naming that element (on Android a floating action button\'s full-width host counts as one — see tap)');
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
  });

  it('every elided quote of the presented remedy ("— a screen is presented over it …") in a description or the troubleshooting reference is how the owner\'s sentence begins', async () => {
    const { PRESENTED_OVER } = await actualSentences();
    const elided = (text: string): string[] => [...text.matchAll(/— (a screen is presented over [^…"`]*?) …/g)].map((m) => m[1]);
    const quoted = [...elided(description('scroll_until')), ...elided(TROUBLESHOOTING)];
    expect(quoted.length).toBeGreaterThanOrEqual(4);
    for (const head of quoted) expect(PRESENTED_OVER.startsWith(`${head} `)).toBe(true);
  });

  it('tap: the general remedy defers to it, and its refusal says to close the screen first; a host with children is no such screen', () => {
    expect(description('tap')).toContain('with less showing it is REFUSED, naming the cover, nothing tapped — scroll_until it first, unless the cover is a screen presented over the target (below). ');
    expect(description('tap')).toContain('fully: true when the next step measures it), unless a screen is presented over the target (below); ');
    expect(description('tap')).toContain(
      'Under a screen presented over the target — iOS wda: a layer WebDriverAgent shows presented (see ui_snapshot\'s "presentation"; an alert, an action sheet or a popover is named as ui_snapshot says); elsewhere (Android): a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window — the refusal says so instead of "scroll_until it first" or the status bar\'s advice, whatever else keeps the target from a tap — its centre under that screen, off the screen or under the status bar (wholly too: the screen is judged presented over the target itself, wherever it lies), or a cut at its scroll container\'s edge: ' +
        `'${TAP_SENTINEL}'. Close that screen first. A full-screen host that only carries a bar or other content of its own (a host with children) is no such screen: only what it draws covers.`,
    );
  });

  it('tap, scroll_until, ui_snapshot and the troubleshooting reference: on Android a presented window is listed alone, and a target not in it gets the presented remedy', async () => {
    const { presentedRemedy, presentedStop } = await vi.importActual<typeof import('../../src/ui-tree/standing.js')>('../../src/ui-tree/standing.js');
    expect(description('tap')).toContain('On Android uiautomator lists the active window only: with a dialog or a bottom sheet up the tree holds that window alone');
    expect(description('scroll_until')).toContain('The same on Android when the tree is a presented window (ui_snapshot\'s root carries "presentation": "dialog" or "screen")');
    expect(description('ui_snapshot')).toContain('"activeWindowOnly": true under Android — uiautomator lists the active window only');
    expect(description('ui_snapshot')).toContain('the screen beneath is not in the tree at all — tap, fill and scroll_until say');
    expect(description('tap')).toContain('and the wait for it (this tap\'s, and fill\'s) ends');
    expect(TROUBLESHOOTING).toContain(`is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — ${presentedRemedy('it', { kind: 'dialog' })}\`** (tap, fill; Android)`);
    expect(TROUBLESHOOTING).toContain(`— ${presentedStop({ kind: 'dialog' })}, so none was sent\``);
  });

  it('scroll_until: one confirming read when the timeout allows, then it fails without swiping further, saying which', () => {
    expect(description('scroll_until')).toContain(
      'Once a read finds the target in the viewport under a screen presented over it (as for tap: a layer WebDriverAgent shows presented, or elsewhere a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window), scroll_until confirms with one more read when the timeout allows, and fails without swiping further — "stopped before any swipe …" or "stopped after N swipes, without swiping further …", then "' +
        `${STOP_SENTINEL}" — since a swipe there could dismiss a sheet or raise its discard prompt.`,
    );
  });

  it('scroll_until: a target not judged in the viewport whose swipe would touch down on that screen fails without the swipe — the description and the troubleshooting entry say so, and that a target not yet in the tree is still swiped for', () => {
    expect(description('scroll_until')).toContain(
      'The same holds, with the same confirming read, for a target in the tree that is NOT judged in the viewport (below the fold, under the soft keyboard, cut, or under a bar of its own screen) when the next swipe would touch down on such a screen: it fails without that swipe, saying why the target is not in the viewport and where the swipe would have landed — e.g. "element lies below the viewport, and the next swipe would touch down at (201,699) on container "dismiss popup" (0,0 402x874) — a screen is presented over it …" — since that swipe would land on the presented screen, not on the target\'s (a popover closed, a sheet moved to another detent); a read that fails meanwhile is retried, never answered with a swipe. When a bound (maxSwipes, the timeout, content exhausted) ends the scroll first, the failure adds "The next swipe would have touched down at (x,y) on … — a screen is presented over it …". A row of the presented sheet itself is still swiped for on the sheet, and a target not yet in the tree is still swiped for — except under a layer WebDriverAgent shows presented',
    );
    expect(TROUBLESHOOTING).toContain(
      '`scroll_until` says the same when the target is in the tree but not in the viewport (below the fold, under the soft keyboard, cut) and the next swipe would touch down on such a screen: `… — element lies below the viewport, and the next swipe would touch down at (x,y) on <that screen\'s dimming view or scroll view> — a screen is presented over it …`, and no swipe was sent, because that swipe would land on the modal or sheet (closing a popover, moving a sheet to another size) and not on the target\'s screen. A failure at a bound adds `The next swipe would have touched down at (x,y) on … — a screen is presented over it …` for the same reason. Close that screen first here too.',
    );
  });

  it('scroll_until: under a layer WDA shows presented no swipe is sent for a target not in the tree either, but on that layer\'s own scroll view — the description says so', () => {
    expect(description('scroll_until')).toContain(
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
    expect(description('assert')).toContain(
      `Under a screen presented over the element (a layer WebDriverAgent shows presented, or a modal's full-screen dimming view or a sheet's scroll view, as for tap) no scroll helps, and the failure says so instead: '${PIXEL_SENTINEL}' (whatever else lies over it — the status bar, a possible cut at the navigation bar — in place of its own advice, and wherever the element lies, nothing of it on the screen included; a keyboard the device reports is still named first, with its own).`,
    );
    expect(TROUBLESHOOTING).toContain(
      `Under a modal or sheet still up over the element's screen the message ends \`… ${PRESENTED_OVER_THE_ELEMENT}\` instead, whatever else lies over it (the status bar, a possible cut at the navigation bar): the message still names what lies over it, and this replaces its own advice. Close that screen, then assert again.`,
    );
  });

  it('color/ocr and tap: an element on the screen that its scroll view draws none of (WDA) is never measured nor tapped — the description and the troubleshooting entries quote the misses', async () => {
    const { OUTSIDE_ITS_SCROLL_VIEW, TOO_THIN_IN_ITS_SCROLL_VIEW } = await actualSentences();
    expect(description('assert')).toContain(
      "On iOS with treeSource: wda an element on the screen that its scroll view draws none of (listed past the scroll view's frame, as WebDriverAgent lists a scroll view's content) fails closed likewise with '<the outside-its-scroll-view miss, as verify/pixel-poll.ts renders it> <the scroll view> (element …, screen …)', and one its scroll view's edge leaves a sliver no thicker than 2.25 pt with '<the scroll view's thin-sliver miss, as verify/pixel-poll.ts renders it> <the scroll view> (element …, drawn …, screen …)'",
    );
    expect(TROUBLESHOOTING).toContain(`- **\`color\`/\`ocr\` fails with \`${OUTSIDE_ITS_SCROLL_VIEW} <scroll view> (element …, screen …)\`** or **\`${TOO_THIN_IN_ITS_SCROLL_VIEW} <scroll view> (element …, drawn …, screen …)\`**`);
    expect(TROUBLESHOOTING).toContain(`or only a sliver no thicker than ${await actualSlack()} pt at the scroll view's edge`);
    expect(description('tap')).toContain('is REFUSED as off screen, naming the scroll view, nothing tapped — scroll_until it first — after the keyboard is hidden');
    expect(TROUBLESHOOTING).toContain('- **`… is outside its scroll view <scroll view> at (x,y): nothing of it is drawn (rect …) — scroll_until it first; nothing was tapped`**');
  });

  it('color/ocr: an element nothing of which lies on the screen fails closed saying so — scroll it on-screen, or close the presented screen first — and color is judged over the region its sampler reads', async () => {
    const { PRESENTED_OVER_THE_ELEMENT, OFF_THE_SCREEN, TOO_THIN_ON_THE_SCREEN } = await actualSentences();
    expect(description('assert')).toContain(
      "An element nothing of which (of what the assert reads) lies on the screen fails closed with '<the off-screen miss, as verify/pixel-poll.ts renders it> (element …, screen …)', and one of which the screen's edge leaves a sliver no thicker than 2.25 units (pt on iOS, px on Android) with '<the thin-sliver miss, as verify/pixel-poll.ts renders it> (element …, on the screen …, screen …)' — scroll it on-screen (scroll_until it first), or, under a presented screen, close that screen first; the poll goes on, so one scrolled on-screen before the deadline is measured.",
    );
    expect(TROUBLESHOOTING).toContain(`or **\`${TOO_THIN_ON_THE_SCREEN} (element …, on the screen …, screen …)\`**: nothing of what the assert reads lies on the screen`);
    expect(TROUBLESHOOTING).toContain(`or the screen's edge leaves only a sliver of it no thicker than ${await actualSlack()} units (pt on iOS, px on Android)`);
    expect(TROUBLESHOOTING).toContain(`An overlap of ${await actualSlack()} units or less (pt on iOS, px on Android) does not count`);
    expect(TROUBLESHOOTING).toContain(`with \`fully: true\` none of the element may lie under a system bar past ${await actualSlack()} units (pt on iOS, px on Android)`);
    expect(description('assert')).toContain('and an overlap of 2.25 units or less are not counted');
    expect(description('scroll_until')).toContain('past 2.25 units (pt on iOS, px on Android)');
    expect(description('assert')).toContain('Judged over what the assert reads: the whole rect for ocr; for color the part of the rect on the screen, inset 12% a side — the region its sampler reads — so');
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

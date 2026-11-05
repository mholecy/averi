import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { FlowEngine } from '../../src/flow/engine.js';
import { parseConfig } from '../../src/flow/config.js';
import { EngineSession, launchApp } from '../../src/flow/launch.js';
import { deepLinkText, launchText, tapText } from '../../src/mcp/tool-text.js';
import { tapElement } from '../../src/interact/tap.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

beforeEach(() => {
  resetSleeps();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/**
 * A real AndroidAdapter over batch-11's D55b replies (averi_lab, API 33): every `am start` answers the `-p` start's real
 * stdout, the focus read averi's own read at its return — the chooser in front.
 */
async function chooserUp(dump: string | Error = ''): Promise<AndroidAdapter> {
  const start = await fixture('am-start-p-api33-b11-chooser.txt');
  const focus = await fixture('dumpsys-window-focus-api33-b11-after-launch-intent-start.txt');
  const exec: ExecFn = async (_cmd, args) => {
    if (args.includes('uiautomator') && dump instanceof Error) throw dump;
    const stdout = args.includes('am') ? start : args.some((a) => a.startsWith('dumpsys window')) ? focus : args.includes('uiautomator') ? (dump as string) : '';
    return { stdout: Buffer.from(stdout), stderr: '' };
  };
  return new AndroidAdapter({ drawnOverStrip, serial: 'e', exec });
}

const NOTE =
  'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
  'is in front, and dev.averi.lab is not. Take a ui_snapshot, tap the app you mean, then its "Just once" button if it ' +
  'shows one (never "Always": it changes the device\'s default for the intent it answers); press_key back drops the ' +
  'chooser. averi taps nothing itself. Naming the activity (`activity:` on the launch step / launch_app) starts it ' +
  'without the chooser.';

/**
 * open_deep_link's reply over the chooser with no sheet read (D55's; the pre-D55c text): the one literal every
 * fail-open case below pins, byte for byte. batch-13 rerun 1 recorded it live for shared and pair, 3/3 each (D55d).
 */
const LINK_FAILED_OPEN = (url: string) =>
  `Android has not opened ${url} yet: its chooser (android/com.android.internal.app.ResolverActivity) is in front, ` +
  'asking which app opens it. Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one ' +
  '(never "Always": it changes the device\'s default for such links); press_key back drops the link. averi taps ' +
  'nothing itself.';

// The replies with Android's chooser in front, end to end — a real AndroidAdapter through flow/launch.ts and the reply
// text (tool-text.ts): launch_app's ⚠ line and the flow's `⚠ launch` line name the chooser (D55b; ADR 0041's D55b
// amendment, D56's shape on iOS), and open_deep_link's reply over the same chooser stays D55's, byte for byte.
describe("launch_app's, the flow's and open_deep_link's replies over Android's chooser (D55b)", () => {
  it("launch_app's reply: the Launched headline, then the chooser note as its one ⚠ line", async () => {
    const launched = await launchApp(await chooserUp(), undefined, new EngineSession(), {
      appId: 'dev.averi.lab',
      intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' },
    });
    expect(launchText('android', launched)).toBe(`Launched dev.averi.lab on android\n⚠ ${NOTE}`);
  });

  it("a flow's launch: the `⚠ launch` line carries the chooser note, and the flow goes on", async () => {
    const cfg = parseConfig(`
app:
  android: { package: dev.averi.lab }
flows:
  open:
    steps:
      - launch:
          intent: { action: android.intent.action.VIEW, data: "averilab://shared/x" }
`);
    const trace = await FlowEngine.run(cfg, await chooserUp(), { env: {}, session: new EngineSession() }, { flow: 'open' });
    const at = trace.findIndex((t) => t.action === 'launch');
    expect(trace.slice(at, at + 2)).toEqual([
      { action: 'launch', detail: 'dev.averi.lab' },
      { action: '⚠ launch', detail: NOTE },
    ]);
    expect(trace.at(-1)).toEqual({ action: 'flow open', detail: 'done' });
  });

  it("open_deep_link's reply over the chooser is D55's, unchanged (batch-11's raise, as averi replied it)", async () => {
    const adapter = await chooserUp();
    expect(deepLinkText('android', 'averilab://shared/open', await adapter.openDeepLink('averilab://shared/open'))).toBe(LINK_FAILED_OPEN('averilab://shared/open'));
  });
});

const withDefault = (link: 'shared' | 'pair') => readFileSync(new URL(`../fixtures/uiautomator-lab-resolver-with-default-${link}.xml`, import.meta.url), 'utf8');

/**
 * The `uiautomator dump`s D55c fails open on, each named: each leaves the replies above byte for byte. The last two
 * are batch-13 rerun 1's real resolver_list_with_default trees (D55d; android-chooser.test.ts pins why each is no sheet).
 */
const FAILED_DUMPS: [string, string | Error][] = [
  ['no XML', ''],
  ['"null root node"', 'ERROR: null root node returned by UiTestAutomationBridge.\n'],
  ['a failed dump', execErrorLikeExec('adb -s e exec-out uiautomator dump /dev/tty', 255, "adb: device 'e' not found\n")],
  ['a timed-out dump', execErrorLikeExec('adb -s e exec-out uiautomator dump /dev/tty', null, '', { timedOut: true })],
  ['another layout (the lab\'s own screen)', readFileSync(new URL('../fixtures/uiautomator-lab-open.xml', import.meta.url), 'utf8')],
  ['the with_default chooser of averilab://shared/open (batch-13)', withDefault('shared')],
  ['the with_default chooser of averilab://pair/open (batch-13)', withDefault('pair')],
];

// D55c (ADR 0041's D55c amendment): the same replies when the chooser's dump is batch-10's fresh layout — the sheet
// quoted with the rows' and the buttons' centres, and the advice to tap a row and then id:button_once.
describe("open_deep_link's, launch_app's and the flow's replies quote the chooser's sheet (D55c)", () => {
  const SHEET =
    'Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and ' +
    'the buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058) (disabled). Tap the app\'s row at its x ' +
    'and y (one tap only selects it and enables the buttons), then tap id:button_once (never id:button_always: it ' +
    'changes the device\'s default for ';
  const LINK_REPLY =
    'Android has not opened averilab://shared/open yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
    `is in front, asking which app opens it. ${SHEET}such links); press_key back drops the link. averi taps nothing ` +
    'itself.';
  const SHEET_NOTE =
    'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
    `is in front, and dev.averi.lab is not. ${SHEET}the intent it answers); press_key back drops the chooser. averi ` +
    'taps nothing itself. Naming the activity (`activity:` on the launch step / launch_app) starts it without the ' +
    'chooser.';

  it("open_deep_link's reply: the chooser's title, its rows and buttons with their centres, then the advice", async () => {
    const adapter = await chooserUp(await fixture('uiautomator-lab-resolver.xml'));
    expect(deepLinkText('android', 'averilab://shared/open', await adapter.openDeepLink('averilab://shared/open'))).toBe(LINK_REPLY);
  });

  it("batch-11's selected chooser (a row tapped): the same reply, no \"(disabled)\"", async () => {
    const adapter = await chooserUp(await fixture('uiautomator-lab-resolver-selected.xml'));
    expect(deepLinkText('android', 'averilab://shared/open', await adapter.openDeepLink('averilab://shared/open'))).toBe(
      LINK_REPLY.replaceAll(' (disabled)', '').replace(' and enables the buttons', ''),
    );
  });

  it("launch_app's reply: Launched, then the note quoting the sheet as its one ⚠ line", async () => {
    const launched = await launchApp(await chooserUp(await fixture('uiautomator-lab-resolver.xml')), undefined, new EngineSession(), {
      appId: 'dev.averi.lab',
      intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' },
    });
    expect(launchText('android', launched)).toBe(`Launched dev.averi.lab on android\n⚠ ${SHEET_NOTE}`);
  });

  it("a flow's launch: the `⚠ launch` line quotes the sheet, and the flow goes on", async () => {
    const cfg = parseConfig(`
app:
  android: { package: dev.averi.lab }
flows:
  open:
    steps:
      - launch:
          intent: { action: android.intent.action.VIEW, data: "averilab://shared/x" }
`);
    const trace = await FlowEngine.run(cfg, await chooserUp(await fixture('uiautomator-lab-resolver.xml')), { env: {}, session: new EngineSession() }, { flow: 'open' });
    const at = trace.findIndex((t) => t.action === 'launch');
    expect(trace.slice(at, at + 2)).toEqual([
      { action: 'launch', detail: 'dev.averi.lab' },
      { action: '⚠ launch', detail: SHEET_NOTE },
    ]);
    expect(trace.at(-1)).toEqual({ action: 'flow open', detail: 'done' });
  });

  it.each(FAILED_DUMPS)('%s: open_deep_link\'s and launch_app\'s replies are D55\'s and D55b\'s, byte for byte', async (_dump, dump) => {
    const linked = await (await chooserUp(dump)).openDeepLink('averilab://shared/open');
    expect(deepLinkText('android', 'averilab://shared/open', linked)).toBe(LINK_FAILED_OPEN('averilab://shared/open'));
    const launched = await launchApp(await chooserUp(dump), undefined, new EngineSession(), {
      appId: 'dev.averi.lab',
      intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' },
    });
    expect(launchText('android', launched)).toBe(`Launched dev.averi.lab on android\n⚠ ${NOTE}`);
  });

  // D55d: each link batch-13 rerun 1 raised, with its own with_default tree in front, replies the pre-D55c text for
  // its own URL — what averi replied live, 3/3 per link.
  it.each(['shared', 'pair'] as const)("averilab://%s/open over its own with_default tree: open_deep_link's reply as batch-13 recorded it, byte for byte", async (link) => {
    const url = `averilab://${link}/open`;
    const adapter = await chooserUp(withDefault(link));
    expect(deepLinkText('android', url, await adapter.openDeepLink(url))).toBe(LINK_FAILED_OPEN(url));
  });
});

/**
 * A real AndroidAdapter whose `uiautomator dump` answers the committed chooser capture (uiautomator-lab-resolver.xml,
 * batch-10 E2); every other command answers nothing. `taps` records the `input tap` calls the adapter sent.
 */
async function chooserTree(): Promise<{ adapter: AndroidAdapter; taps: string[] }> {
  const xml = await fixture('uiautomator-lab-resolver.xml');
  const taps: string[] = [];
  const exec: ExecFn = async (_cmd, args) => {
    const line = args.join(' ');
    if (line.includes('input tap')) taps.push(line.slice(line.indexOf('input tap')));
    return { stdout: Buffer.from(line.includes('uiautomator') ? xml : ''), stderr: '' };
  };
  return { adapter: new AndroidAdapter({ drawnOverStrip, serial: 'e', exec }), taps };
}

// D66 (docs/adr/0042-a-node-its-source-marks-not-enabled-is-said-disabled.md): the chooser's fresh layout dumps "Just
// once" and "Always" enabled="false" — a tap on either is sent, and the reply says the tree marks it disabled.
describe("tap's reply on Android's chooser (D66): warned on a disabled button, never refused", () => {
  const WARN = '⚠ The tree marks the target disabled, the tap may do nothing; read again before relying on it.';

  it.each([
    ['id:button_once', 'input tap 723 2058'],
    ['text:"Always"', 'input tap 936 2058'],
  ])('%s: tapped at its centre, and the ⚠ line follows the Tapped line', async (selector, sent) => {
    const { adapter, taps } = await chooserTree();
    const tapped = await tapElement(adapter, selector, { ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 });
    expect(taps).toEqual([sent]);
    expect(tapText(selector, tapped)).toBe(`Tapped ${selector}\n${WARN}`);
  });

  it('a row\'s app name (enabled): the reply is the one Tapped line, byte for byte as before D66', async () => {
    const { adapter, taps } = await chooserTree();
    const tapped = await tapElement(adapter, 'text:"AveriLab twin"', { ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 });
    expect(taps).toHaveLength(1);
    expect(tapText('text:"AveriLab twin"', tapped)).toBe('Tapped text:"AveriLab twin"');
  });
});

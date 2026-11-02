import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { ApplicationLabel, IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { FOREGROUND_POLL_MS, FOREGROUND_WAIT_MS } from '../../src/adapters/ios-foreground.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { appinfo } from '../helpers/simctl-appinfo.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';

// The one sleep owner, recorded and not waited on; under a Date-only fake clock each recorded sleep moves the clock
// by its length, so the wait's deadline plays out in virtual time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

// D49a (2026-11-02, spec-D49 and its orchestrator decisions; ADR 0032's D49a amendment): `open_deep_link` replied
// "Opened" while iOS asked "Open in “AveriLab”?" over SpringBoard — batch-1 D's probe, where every launch after the
// link stayed behind the alert. A link whose scheme the project's own app declares (its Info.plist's
// CFBundleURLTypes, read on the host with plutil at appinfo's Path) is now followed by launch's bounded foreground
// wait (ios-foreground.ts); any other link is opened exactly as before.

const LAB = 'dev.averi.lab';
const LAB_PATH = '/Sim/Containers/Bundle/Application/5E1F/AveriLab.app';
const LAB_INFO = appinfo('AveriLab', 'AveriLab', { path: LAB_PATH, executable: 'AveriLab' });
/** `plutil -extract CFBundleURLTypes json` of the lab app, as measured. */
const LAB_TYPES = '[{"CFBundleURLName":"dev.averi.lab","CFBundleURLSchemes":["averilab"]}]';
const PLUTIL = `plutil -extract CFBundleURLTypes json -o - ${LAB_PATH}/Info.plist`;
const WRITES = [
  'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility AutomationEnabled -bool true',
  'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true',
];
const openurl = (url: string) => `xcrun simctl openurl AAAA-1111 ${url}`;

const bundle = (bundleId: string): ApplicationLabel => ({ kind: 'bundle', bundleId });
const label = (text: string): ApplicationLabel => ({ kind: 'label', label: text });
const SPRINGBOARD = bundle('com.apple.springboard');

/**
 * An IosAdapter over a source whose applicationLabel answers in turn from `answers` (the last repeats) — the
 * `kind` given — and an exec answering `simctl appinfo` with `info` and plutil with `types` (an Error rejects each).
 * Every exec command line but xcode-env's one-time `xcrun --find simctl` is recorded.
 */
function lab(answers: ApplicationLabel[], opts: { kind?: IosTreeSourceKind; info?: string | Error; types?: string | Error } = {}) {
  const calls: string[] = [];
  let asked = 0;
  const source: IosTreeSource = {
    kind: opts.kind ?? 'wda',
    read: () => Promise.reject(new Error('unused')),
    applicationLabel: async () => answers[Math.min(asked++, answers.length - 1)],
    dispose: () => Promise.resolve(),
  };
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    const answer = (out: string | Error) => {
      if (out instanceof Error) throw out;
      return { stdout: Buffer.from(out), stderr: '' };
    };
    if (full.startsWith('xcrun simctl appinfo')) return answer(opts.info ?? LAB_INFO);
    if (full.startsWith('plutil ')) return answer(opts.types ?? LAB_TYPES);
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { adapter: new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: source }), calls, asks: () => asked };
}

let stderr: { mock: { calls: unknown[][] } };
/** The stderr lines other than the accessibility write's announcement. */
const stderrLines = () => stderr.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => !l.startsWith('averi: set com.apple.Accessibility'));

beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IosAdapter.openDeepLink — a link nothing expects is opened exactly as before (no read, no wait)", () => {
  it('no project app: the writes and openurl, nothing else — no appinfo, no plutil, no ask', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab://d49')).toEqual({});
    expect(d.calls).toEqual([...WRITES, openurl('averilab://d49')]);
    expect(d.asks()).toBe(0);
  });

  it('an https link with a project app: the same calls — a web link expects no app', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('https://averi.dev/x', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('HTTP://averi.dev/x', { appId: LAB })).toEqual({});
    expect(d.calls).toEqual([...WRITES, openurl('https://averi.dev/x'), ...WRITES, openurl('HTTP://averi.dev/x')]);
    expect(d.asks()).toBe(0);
  });

  it('a link with no scheme: no lookup either', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab', { appId: LAB })).toEqual({});
    expect(d.calls).toEqual([...WRITES, openurl('averilab')]);
  });

  it("a scheme the project's app does not declare: no ask, no wait, no note — its schemes read once and cached", async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('tel:+421900', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('contacts://new', { appId: LAB })).toEqual({});
    expect(d.calls).toEqual([
      ...WRITES,
      openurl('tel:+421900'),
      'xcrun simctl appinfo AAAA-1111 dev.averi.lab',
      PLUTIL,
      ...WRITES,
      openurl('contacts://new'),
    ]);
    expect(d.asks()).toBe(0);
    expect(sleeps).toEqual([]);
    expect(stderrLines()).toEqual([]);
  });

  it('an app that declares no URL types (plutil: no value at that key path): no wait, nothing said — and cached', async () => {
    const missing = execErrorLikeExec(PLUTIL, 1, `${LAB_PATH}/Info.plist: Could not extract value, error: No value at that key path or invalid key path: CFBundleURLTypes\n`);
    const d = lab([bundle(LAB)], { types: missing });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toHaveLength(1);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([]);
  });
});

describe('IosAdapter.openDeepLink — the schemes could not be read: opened as before, one stderr line, asked again next link', () => {
  it('an unreadable Info.plist (any other plutil failure)', async () => {
    const d = lab([bundle(LAB)], { types: execErrorLikeExec(PLUTIL, 1, `${LAB_PATH}/Info.plist: (The file couldn’t be opened.)\n`) });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(0);
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toHaveLength(2);
    expect(stderrLines()).toEqual([
      `averi: could not read dev.averi.lab's URL schemes (Command failed (exit 1): ${PLUTIL}) — opened averilab://d49 without waiting for dev.averi.lab to come forward`,
      `averi: could not read dev.averi.lab's URL schemes (Command failed (exit 1): ${PLUTIL}) — opened averilab://d49 without waiting for dev.averi.lab to come forward`,
    ]);
  });

  it('a plutil answer of another shape', async () => {
    const d = lab([bundle(LAB)], { types: '{"CFBundleURLSchemes":["averilab"]}' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([
      "averi: could not read dev.averi.lab's URL schemes (CFBundleURLTypes is not an array) — opened averilab://d49 without waiting for dev.averi.lab to come forward",
    ]);
  });

  it('appinfo fails (the app not installed): no plutil', async () => {
    const d = lab([bundle(LAB)], { info: new Error('simctl appinfo: no such bundle\nmore') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([
      "averi: could not read dev.averi.lab's URL schemes (simctl appinfo: no such bundle) — opened averilab://d49 without waiting for dev.averi.lab to come forward",
    ]);
  });

  it('appinfo lists no Path: no plutil', async () => {
    const d = lab([bundle(LAB)], { info: appinfo('AveriLab', 'AveriLab') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([
      "averi: could not read dev.averi.lab's URL schemes (simctl appinfo listed no Path) — opened averilab://d49 without waiting for dev.averi.lab to come forward",
    ]);
  });
});

describe("IosAdapter.openDeepLink — a link to the project's own scheme waits like a launch (D49a)", () => {
  it('WebDriverAgent names the app at the first ask: no note, one ask; the schemes read once across two links, again after install()', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
    expect(await d.adapter.openDeepLink('AveriLab://again', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(2);
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL]);
    await d.adapter.install('/builds/AveriLab.app');
    await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL, PLUTIL]);
  });

  it('the writes and openurl first, as before; the lookup after them', async () => {
    const d = lab([bundle(LAB)]);
    await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(d.calls).toEqual([...WRITES, openurl('averilab://d49'), 'xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL]);
  });

  it("idb reads SpringBoard's ' ' twice, then the app's name: waited out — three reads, two pauses, no note", async () => {
    const d = lab([label(' '), label(' '), label('AveriLab')], { kind: 'idb' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(3);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS, FOREGROUND_POLL_MS]);
    expect(d.calls.filter((c) => c.startsWith('xcrun simctl appinfo'))).toHaveLength(1); // the names share the lookup
  });

  it('WebDriverAgent reads SpringBoard to the bound: asks until it and no longer, then a ⚠ note that leads with the link', async () => {
    const d = lab([SPRINGBOARD]);
    const outcome = await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(outcome.note).toBe(
      'averi did not see dev.averi.lab come forward after the link: iOS may be asking to confirm it ("Open in “…”?") ' +
        'or another app may be in front — take a screenshot, and if it shows a system alert, answer it (every launch ' +
        'stays behind it until then). 3 s after opening averilab://d49 in dev.averi.lab, WebDriverAgent still read ' +
        'SpringBoard (the home screen, the launch animation or a system alert) as the active app — a ui_snapshot now ' +
        "reads that app's tree, on which an absent check passes. Read again; if it repeats, take a screenshot",
    );
    expect(d.asks()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
  });

  it("idb reads another app's label to the bound: the same lead, then launch's note worded for the link", async () => {
    const outcome = await lab([label('Contacts')], { kind: 'idb' }).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(outcome.note).toMatch(/^averi did not see dev\.averi\.lab come forward after the link: iOS may be asking to confirm it/);
    expect(outcome.note).toMatch(/\(every launch stays behind it until then\)\. 3 s after opening averilab:\/\/d49 in dev\.averi\.lab \("AveriLab"\), the UI tree was still the app labelled "Contacts" — /);
  });

  it('WebDriverAgent not up yet (declined): no wait, no note', async () => {
    const d = lab([{ kind: 'declined' }]);
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

// D24's memory of which app is in front (ios.ts#FrontApp): a link that brought the project's app forward is a launch
// of it; one that did not — or was not checked — leaves the memory where it was.
describe('IosAdapter.openDeepLink — which app the typing goes into', () => {
  /** An adapter that launched the lab app and saw it drop a tail, then launched another app — so typing does not split. */
  async function afterAnotherLaunch(answers: ApplicationLabel[]) {
    let next: ApplicationLabel[] = [bundle(LAB)];
    let i = 0;
    const typed: string[] = [];
    const source: IosTreeSource = {
      kind: 'wda',
      read: () => Promise.reject(new Error('unused')),
      applicationLabel: async () => next[Math.min(i++, next.length - 1)],
      dispose: () => Promise.resolve(),
    };
    const exec: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('idb ui text')) typed.push(args[2]);
      if (full.startsWith('xcrun simctl appinfo')) return { stdout: Buffer.from(LAB_INFO), stderr: '' };
      if (full.startsWith('plutil ')) return { stdout: Buffer.from(LAB_TYPES), stderr: '' };
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: source });
    await adapter.launch(LAB);
    adapter.noteDroppedTail();
    next = [bundle('com.apple.MobileAddressBook')];
    i = 0;
    await adapter.launch('com.apple.MobileAddressBook');
    next = answers;
    i = 0;
    return { adapter, typed };
  }

  it('the link brought the app forward: typing goes into it — its first key alone again', async () => {
    const { adapter, typed } = await afterAnotherLaunch([bundle(LAB)]);
    await adapter.openDeepLink('averilab://d49', { appId: LAB });
    await adapter.typeText('Jan');
    expect(typed).toEqual(['J', 'an']);
  });

  it('it did not come forward within the bound: the memory stays with the app launched last', async () => {
    const { adapter, typed } = await afterAnotherLaunch([SPRINGBOARD]);
    await adapter.openDeepLink('averilab://d49', { appId: LAB });
    await adapter.typeText('Jan');
    expect(typed).toEqual(['Jan']);
  });

  it('not checked (WebDriverAgent not up): the memory stays too', async () => {
    const { adapter, typed } = await afterAnotherLaunch([{ kind: 'declined' }]);
    await adapter.openDeepLink('averilab://d49', { appId: LAB });
    await adapter.typeText('Jan');
    expect(typed).toEqual(['Jan']);
  });
});

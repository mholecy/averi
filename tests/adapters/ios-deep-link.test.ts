import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbEmptyTreeError, IdbTreeSource, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { FOREGROUND_POLL_MS, FOREGROUND_WAIT_MS } from '../../src/adapters/ios-foreground.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import type { DeepLinkOutcome, UiNode } from '../../src/adapters/types.js';
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
function lab(
  answers: Array<ApplicationLabel | Error>,
  opts: { kind?: IosTreeSourceKind; info?: string | Error | (() => string | Error); types?: string | Error; tree?: UiNode | Error } = {},
) {
  const calls: string[] = [];
  let asked = 0;
  let reads = 0;
  const source: IosTreeSource = {
    kind: opts.kind ?? 'wda',
    // A whole tree read — WDA's /source (D54: asked at the bound only); `tree` answers it, unset it is not expected.
    read: async () => {
      reads++;
      const tree = opts.tree ?? new Error('unused');
      if (tree instanceof Error) throw tree;
      return structuredClone(tree);
    },
    applicationLabel: async () => {
      const a = answers[Math.min(asked++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
    dispose: () => Promise.resolve(),
  };
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    const answer = (out: string | Error) => {
      if (out instanceof Error) throw out;
      return { stdout: Buffer.from(out), stderr: '' };
    };
    if (full.startsWith('xcrun simctl appinfo')) return answer(typeof opts.info === 'function' ? opts.info() : (opts.info ?? LAB_INFO));
    if (full.startsWith('plutil ')) return answer(opts.types ?? LAB_TYPES);
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { adapter: new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: source }), calls, asks: () => asked, reads: () => reads };
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

  // Review of D49a: iOS's own schemes are never the project's app — no lookup at all.
  it.each(['tel:+421900', 'TELPROMPT:1', 'mailto:a@b.c', 'sms:1', 'facetime:a', 'facetime-audio:a', 'maps://?q=x', 'itms-apps://x', 'itms-services://x', 'app-settings:', 'shortcuts://run', 'x-apple-health://'])(
    'one of iOS\'s own schemes (%s): the writes and openurl, nothing else',
    async (url) => {
      const d = lab([bundle(LAB)]);
      expect(await d.adapter.openDeepLink(url, { appId: LAB })).toEqual({});
      expect(d.calls).toEqual([...WRITES, openurl(url)]);
      expect(d.asks()).toBe(0);
    },
  );

  it("a scheme the project's app does not declare: no ask, no wait, no note — its schemes read once and cached", async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('contacts://new', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('x-apples://new', { appId: LAB })).toEqual({});
    expect(d.calls).toEqual([
      ...WRITES,
      openurl('contacts://new'),
      'xcrun simctl appinfo AAAA-1111 dev.averi.lab',
      PLUTIL,
      ...WRITES,
      openurl('x-apples://new'),
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

const couldNotRead = (why: string) =>
  `averi: could not read dev.averi.lab's URL schemes (${why}) — opened averilab://d49 without waiting for dev.averi.lab ` +
  'to come forward, and will not wait for it on later links until the app is installed again';
/** The line of a failure that is not cached (appinfo's: the app may be installed later outside averi) — asked again next link. */
const notYetRead = (why: string) =>
  `averi: could not read dev.averi.lab's URL schemes (${why}) — opened averilab://d49 without waiting for dev.averi.lab ` +
  'to come forward; asked again on the next link';

describe('IosAdapter.openDeepLink — the schemes could not be read: opened as before, one stderr line, the failure cached until install()', () => {
  it('an unreadable Info.plist (any other plutil failure): one lookup and one line for two links; install() asks again', async () => {
    const d = lab([bundle(LAB)], { types: execErrorLikeExec(PLUTIL, 1, `${LAB_PATH}/Info.plist: (The file couldn’t be opened.)\n`) });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(0);
    expect(d.calls.filter((c) => c.startsWith('plutil') || c.includes('appinfo'))).toHaveLength(2);
    expect(stderrLines()).toEqual([couldNotRead(`Command failed (exit 1): ${PLUTIL}`)]);
    await d.adapter.install('/builds/AveriLab.app');
    await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toHaveLength(2);
    expect(stderrLines()).toHaveLength(2);
  });

  it('a plutil answer of another shape', async () => {
    const d = lab([bundle(LAB)], { types: '{"CFBundleURLSchemes":["averilab"]}' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([couldNotRead('CFBundleURLTypes is not an array')]);
  });

  it('appinfo fails (the app not installed): no plutil', async () => {
    const d = lab([bundle(LAB)], { info: new Error('simctl appinfo: no such bundle\nmore') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([notYetRead('simctl appinfo: no such bundle')]);
  });

  // Review round 2: an appinfo failure is not cached — the app may be installed outside averi (Xcode, `simctl install`
  // by hand), and every later own-scheme link would otherwise reply a bare "Opened".
  it('a link before the app is installed, then the app appears outside averi: the next link looks up again and waits', async () => {
    let installed = false;
    const d = lab([bundle(LAB)], { info: () => (installed ? LAB_INFO : new Error('simctl appinfo: no such bundle')) });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(0);
    installed = true;
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toHaveLength(2);
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL]);
  });

  it('appinfo lists no Path: no plutil — and not cached: the next link asks again (and says so again)', async () => {
    const d = lab([bundle(LAB)], { info: appinfo('AveriLab', 'AveriLab') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({});
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([notYetRead('simctl appinfo listed no Path'), notYetRead('simctl appinfo listed no Path')]);
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

  // Review of D49a (MINOR 1): a launch before WDA is up stays silent, but an own-scheme link may wait behind "Open in
  // …?" — so it says it did not check rather than a bare "Opened".
  it('WebDriverAgent not up yet (declined): no wait — and a short note that it was not checked', async () => {
    const d = lab([{ kind: 'declined' }]);
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({
      note:
        'whether dev.averi.lab came forward after the link was not checked (WebDriverAgent is not running yet) — ' +
        'if iOS asks "Open in “…”?", answer it (a screenshot shows it)',
    });
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  // Review of D49a: "did not see it come forward" only when the wait read another app; when it could not tell, the
  // lead says so.
  it('the ask fails: no "did not see" — a lead that it could not check, then launch\'s "could not check" note worded for the link', async () => {
    const outcome = await lab([new Error('WDA /wda/activeAppInfo request failed: ECONNREFUSED\nstack')]).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(outcome.note).toBe(
      'averi could not check that dev.averi.lab came forward after the link: if iOS asks to confirm it ("Open in “…”?"), ' +
        'the link waits behind the alert — take a screenshot, and if it shows a system alert, answer it (every launch ' +
        'stays behind it until then). could not check that dev.averi.lab is in front (WDA /wda/activeAppInfo request ' +
        'failed: ECONNREFUSED) — for a moment after an app switch WebDriverAgent can still read the previous app; read again ' +
        'before trusting a read (the screenshot switches before the tree)',
    );
  });

  it('no bundle id to the bound (unlabelled): the could-not-check lead too', async () => {
    const outcome = await lab([{ kind: 'unlabelled' }]).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(outcome.note).toMatch(/^averi could not check that dev\.averi\.lab came forward after the link: /);
    expect(outcome.note).not.toMatch(/did not see/);
  });

  it("idb's tree empty to the bound: the could-not-check lead, then the empty-tree note worded for the link", async () => {
    const outcome = await lab([new IdbEmptyTreeError('AAAA-1111', [])], { kind: 'idb' }).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(outcome.note).toMatch(
      /^averi could not check that dev\.averi\.lab came forward after the link: .*\. idb's tree stayed empty for the 3 s averi waited after opening averilab:\/\/d49 in dev\.averi\.lab, /,
    );
  });
});

// D54 (D49b, 2026-11-02; ADR 0032's D54 amendment): when iOS's "Open in “AveriLab”?" is what holds the link, the
// reply names it — its title and its buttons at their centres — instead of the vague note. Batch-5 D49A's captures
// (E2): idb lists the alert alone under SpringBoard; WDA's activeAppInfo names com.apple.springboard while it is up,
// and its /source holds the Alert. The happy path's device calls are unchanged on both sources.
const fixture = async (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const IDB_ALERT = JSON.stringify((JSON.parse(await fixture('idb-springboard-open-in-alert.json')) as { elements: unknown[] }).elements);
const WDA_ALERT = parseWdaSourceValue(JSON.parse(await fixture('wda-capture-springboard-open-in-alert.json')));
/** The lab app in front, as idb lists it (batch-5 case-rs-idb-E6, its four targets cut to one). */
const IDB_LAB = JSON.stringify([
  { type: 'Application', AXLabel: 'AveriLab', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { type: 'Button', AXLabel: 'Target A', AXUniqueId: 'lab.open.A', frame: { x: 51, y: 110, width: 300, height: 64 } },
]);
const ALERT: DeepLinkOutcome = {
  alert: {
    title: 'Open in “AveriLab”?',
    buttons: [
      { label: 'Cancel', centre: { x: 127, y: 474 } },
      { label: 'Open', centre: { x: 275, y: 474 } },
    ],
    namesApp: true,
  },
};
const DESCRIBE_ALL = 'idb ui describe-all --json --udid AAAA-1111';

/** An IosAdapter on the REAL idb source, its describe-all answering from `reads` in turn (the last repeats). */
function idbLab(reads: string[]) {
  const calls: string[] = [];
  let read = 0;
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    const out = (s: string) => ({ stdout: Buffer.from(s), stderr: '' });
    if (full === DESCRIBE_ALL) return out(reads[Math.min(read++, reads.length - 1)]);
    if (full.startsWith('xcrun simctl appinfo')) return out(LAB_INFO);
    if (full.startsWith('plutil ')) return out(LAB_TYPES);
    return out('');
  };
  const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec }) });
  return { adapter, calls, describeAlls: () => calls.filter((c) => c === DESCRIBE_ALL).length };
}

describe("IosAdapter.openDeepLink — iOS's \"Open in …?\" alert named (D54)", () => {
  it('idb, the lab in front: one describe-all, no note — the same calls as before D54', async () => {
    const d = idbLab([IDB_LAB]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({});
    expect(d.calls).toEqual([...WRITES, openurl('averilab://d54'), 'xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL, DESCRIBE_ALL]);
    expect(sleeps).toEqual([]);
  });

  it('idb lists the alert at the first read: the wait ends at once with it — one describe-all, no pause, no note, no extra call', async () => {
    const d = idbLab([IDB_ALERT]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual(ALERT);
    expect(d.calls).toEqual([...WRITES, openurl('averilab://d54'), 'xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL, DESCRIBE_ALL]);
    expect(sleeps).toEqual([]);
  });

  it("idb reads the lab, then the alert: ends at the read that lists it", async () => {
    const d = idbLab([IDB_LAB.replace('AveriLab', 'Contacts'), IDB_ALERT]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual(ALERT);
    expect(d.describeAlls()).toBe(2);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS]);
  });

  it('a launch (no link) over the same alert is unchanged: it reads to the bound and gives its note, no alert', async () => {
    const d = idbLab([IDB_ALERT]);
    expect(await d.adapter.launch(LAB)).toEqual({ note: expect.stringMatching(/the UI tree was still SpringBoard's/) });
    expect(d.describeAlls()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
  });

  it('WebDriverAgent names the app at once: no /source read', async () => {
    const d = lab([bundle(LAB)], { tree: WDA_ALERT });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({});
    expect(d.asks()).toBe(1);
    expect(d.reads()).toBe(0);
  });

  it('WebDriverAgent reads SpringBoard to the bound: the same asks as before, then exactly one /source — the alert, no note', async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual(ALERT);
    expect(d.asks()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
    expect(d.reads()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toHaveLength(1); // the names come from the lookup's cache
  });

  it('SpringBoard, then the app before the bound: no /source read', async () => {
    const d = lab([SPRINGBOARD, SPRINGBOARD, bundle(LAB)], { tree: WDA_ALERT });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({});
    expect(d.reads()).toBe(0);
  });

  const SAW_SPRINGBOARD =
    'averi did not see dev.averi.lab come forward after the link: iOS may be asking to confirm it ("Open in “…”?") ' +
    'or another app may be in front — take a screenshot, and if it shows a system alert, answer it (every launch ' +
    'stays behind it until then). 3 s after opening averilab://d54 in dev.averi.lab, WebDriverAgent still read ' +
    'SpringBoard (the home screen, the launch animation or a system alert) as the active app — a ui_snapshot now ' +
    "reads that app's tree, on which an absent check passes. Read again; if it repeats, take a screenshot";

  it('the /source read fails: fails open — exactly the note of before D54', async () => {
    const d = lab([SPRINGBOARD], { tree: new Error('WDA /source request failed: ECONNRESET') });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ note: SAW_SPRINGBOARD });
    expect(d.reads()).toBe(1);
  });

  it('/source holds no alert (the home screen): the note of before D54', async () => {
    const home = structuredClone(WDA_ALERT);
    const unmark = (n: UiNode): void => {
      delete n.presentation;
      n.children.forEach(unmark);
    };
    unmark(home);
    const d = lab([SPRINGBOARD], { tree: home });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ note: SAW_SPRINGBOARD });
    expect(d.reads()).toBe(1);
  });

  it('another app to the bound (not SpringBoard): no /source read — the note of before', async () => {
    const d = lab([bundle('com.apple.MobileAddressBook')], { tree: WDA_ALERT });
    expect((await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).note).toMatch(/WebDriverAgent still read com\.apple\.MobileAddressBook as the active app/);
    expect(d.reads()).toBe(0);
  });

  it('a launch (no link) that reads SpringBoard to the bound: no /source read, its note as before', async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT });
    const outcome = await d.adapter.launch(LAB);
    expect(outcome).toEqual({ note: expect.stringMatching(/^3 s after launching dev\.averi\.lab, WebDriverAgent still read SpringBoard/) });
    expect(d.reads()).toBe(0);
  });

  it("the alert's title names none of the app's names: named all the same, marked as not naming the app", async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT, info: appinfo('Lab Two', 'LabTwo', { path: LAB_PATH, executable: 'LabTwo' }) });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ alert: { ...ALERT.alert!, namesApp: false } });
  });

  it("the app's names cannot be read (appinfo lists only a Path): the alert is named, not as naming the app", async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT, info: appinfo(undefined, undefined, { path: LAB_PATH }) });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ alert: { ...ALERT.alert!, namesApp: false } });
  });
});

// D24's memory of which app is in front (ios.ts#FrontApp): a link that brought the project's app forward is a launch
// of it; one that did not — or was not checked — leaves the memory where it was.
describe('IosAdapter.openDeepLink — which app the typing goes into', () => {
  /** An adapter that launched the lab app and saw it drop a tail, then launched another app — so typing does not split. */
  async function afterAnotherLaunch(answers: ApplicationLabel[], tree?: UiNode) {
    let next: ApplicationLabel[] = [bundle(LAB)];
    let i = 0;
    const typed: string[] = [];
    const source: IosTreeSource = {
      kind: 'wda',
      read: () => (tree === undefined ? Promise.reject(new Error('unused')) : Promise.resolve(structuredClone(tree))),
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

  it("iOS's alert named (D54): the memory stays too — the app is not in front", async () => {
    const { adapter, typed } = await afterAnotherLaunch([SPRINGBOARD], WDA_ALERT);
    expect((await adapter.openDeepLink('averilab://d49', { appId: LAB })).alert).toBeDefined();
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

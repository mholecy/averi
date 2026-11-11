import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbEmptyTreeError, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { FOREGROUND_POLL_MS } from '../../src/adapters/ios-foreground.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { alertInWda } from '../../src/adapters/ios-system-alert.js';
import { FOREGROUND_WAIT_MS, type AppHolder, type UiNode } from '../../src/adapters/types.js';
import { launchTextOf, linkTextOf, worded } from '../helpers/app-holder.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { appinfo } from '../helpers/simctl-appinfo.js';
import {
  APPROVAL, bundle, DESCRIBE_ALL, IDB_ALERT, IDB_LAB, idbLab, lab, label, LAB, LAB_INFO, LAB_PATH, LAB_TYPES, LAUNCH_ALERT_NOTE, openurl,
  PLUTIL, SPRINGBOARD, WDA_ALERT, WRITES,
} from '../helpers/ios-lab.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';
import { deepLinkText } from '../../src/mcp/tool-text.js';

// The one sleep owner, recorded and not waited on; under a Date-only fake clock each recorded sleep moves the clock
// by its length, so the wait's deadline plays out in virtual time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

// D49a (2026-11-02, spec-D49 and its orchestrator decisions; ADR 0032's D49a amendment): `open_deep_link` replied
// "Opened" while iOS asked "Open in “AveriLab”?" over SpringBoard — batch-1 D's probe, where every launch after the
// link stayed behind the alert. A link whose scheme the project's own app declares (its Info.plist's
// CFBundleURLTypes, read on the host with plutil at appinfo's Path) is now followed by launch's bounded foreground
// wait (ios-foreground.ts); any other link is opened exactly as before.


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
    expect(await d.adapter.openDeepLink('averilab://d49')).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([...WRITES, openurl('averilab://d49')]);
    expect(d.asks()).toBe(0);
  });

  it('an https link with a project app: the same calls — a web link expects no app', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('https://averi.dev/x', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('HTTP://averi.dev/x', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([...WRITES, openurl('https://averi.dev/x'), ...WRITES, openurl('HTTP://averi.dev/x')]);
    expect(d.asks()).toBe(0);
  });

  it('a link with no scheme: no lookup either', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([...WRITES, openurl('averilab')]);
  });

  // Review of D49a: iOS's own schemes are never the project's app — no lookup at all.
  it.each(['tel:+421900', 'TELPROMPT:1', 'mailto:a@b.c', 'sms:1', 'facetime:a', 'facetime-audio:a', 'maps://?q=x', 'itms-apps://x', 'itms-services://x', 'app-settings:', 'shortcuts://run', 'x-apple-health://'])(
    'one of iOS\'s own schemes (%s): the writes and openurl, nothing else',
    async (url) => {
      const d = lab([bundle(LAB)]);
      expect(await d.adapter.openDeepLink(url, { appId: LAB })).toEqual({ holder: 'none' });
      expect(d.calls).toEqual([...WRITES, openurl(url)]);
      expect(d.asks()).toBe(0);
    },
  );

  it("a scheme the project's app does not declare: no ask, no wait, no note — its schemes read once and cached", async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('contacts://new', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('x-apples://new', { appId: LAB })).toEqual({ holder: 'none' });
    // D58: the lookup now runs before the writes (it decides the pre-approval); no pre-approval for a scheme not
    // declared.
    expect(d.calls).toEqual([
      'xcrun simctl appinfo AAAA-1111 dev.averi.lab',
      PLUTIL,
      ...WRITES,
      openurl('contacts://new'),
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
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toHaveLength(1);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([]);
  });
});

const couldNotRead = (why: string) =>
  `averi: could not read dev.averi.lab's URL schemes (${why}) — opening averilab://d49 without waiting for dev.averi.lab ` +
  'to come forward, and will not wait for it on later links until the app is installed again';
/** The line of a failure that is not cached (appinfo's: the app may be installed later outside averi) — asked again next link. */
const notYetRead = (why: string) =>
  `averi: could not read dev.averi.lab's URL schemes (${why}) — opening averilab://d49 without waiting for dev.averi.lab ` +
  'to come forward; asked again on the next link';

describe('IosAdapter.openDeepLink — the schemes could not be read: opened as before, one stderr line, the failure cached until install()', () => {
  it('an unreadable Info.plist (any other plutil failure): one lookup and one line for two links; install() asks again', async () => {
    const d = lab([bundle(LAB)], { types: execErrorLikeExec(PLUTIL, 1, `${LAB_PATH}/Info.plist: (The file couldn’t be opened.)\n`) });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
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
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([couldNotRead('CFBundleURLTypes is not an array')]);
  });

  it('appinfo fails (the app not installed): no plutil', async () => {
    const d = lab([bundle(LAB)], { info: new Error('simctl appinfo: no such bundle\nmore') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([notYetRead('simctl appinfo: no such bundle')]);
  });

  // Review round 2: an appinfo failure is not cached — the app may be installed outside averi (Xcode, `simctl install`
  // by hand), and every later own-scheme link would otherwise reply a bare "Opened".
  it('a link before the app is installed, then the app appears outside averi: the next link looks up again and waits', async () => {
    let installed = false;
    const d = lab([bundle(LAB)], { info: () => (installed ? LAB_INFO : new Error('simctl appinfo: no such bundle')) });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(0);
    installed = true;
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toHaveLength(2);
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL]);
  });

  it('appinfo lists no Path: no plutil — and not cached: the next link asks again (and says so again)', async () => {
    const d = lab([bundle(LAB)], { info: appinfo('AveriLab', 'AveriLab') });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([]);
    expect(d.asks()).toBe(0);
    expect(stderrLines()).toEqual([notYetRead('simctl appinfo listed no Path'), notYetRead('simctl appinfo listed no Path')]);
  });
});

describe("IosAdapter.openDeepLink — a link to the project's own scheme waits like a launch (D49a)", () => {
  it('WebDriverAgent names the app at the first ask: no note, one ask; the schemes read once across two links, again after install()', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
    expect(await d.adapter.openDeepLink('AveriLab://again', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(2);
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL]);
    await d.adapter.install('/builds/AveriLab.app');
    await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(d.calls.filter((c) => c.startsWith('plutil'))).toEqual([PLUTIL, PLUTIL]);
  });

  // D58 rewrote this pin on purpose (it read "the writes and openurl first; the lookup after them"): the lookup decides
  // the scheme's pre-approval, which must land before openurl.
  it('the lookup first, then the writes with the pre-approval, then openurl', async () => {
    const d = lab([bundle(LAB)]);
    await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(d.calls).toEqual(['xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL, ...WRITES, APPROVAL, openurl('averilab://d49')]);
  });

  it("idb reads SpringBoard's ' ' twice, then the app's name: waited out — three reads, two pauses, no note", async () => {
    const d = lab([label(' '), label(' '), label('AveriLab')], { kind: 'idb' });
    expect(await d.adapter.openDeepLink('averilab://d49', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.asks()).toBe(3);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS, FOREGROUND_POLL_MS]);
    expect(d.calls.filter((c) => c.startsWith('xcrun simctl appinfo'))).toHaveLength(1); // the names share the lookup
  });

  it('WebDriverAgent reads SpringBoard to the bound: asks until it and no longer, then a ⚠ note that leads with the link', async () => {
    const d = lab([SPRINGBOARD]);
    const outcome = await d.adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(linkTextOf(outcome)).toBe(
      'averi did not see dev.averi.lab come forward after the link: iOS may be asking to confirm it ("Open in “…”?") ' +
        'or another app may be in front — take a screenshot, and if it shows a system alert, answer it (every launch ' +
        'stays behind it until then). 3 s after opening averilab://d49 in dev.averi.lab, WebDriverAgent still read ' +
        'SpringBoard (the home screen, the launch animation or a system alert) as the active app — a ui_snapshot now ' +
        "reads that app's tree, on which an absent check passes. Read again; if it repeats, take a screenshot",
    );
    expect(d.asks()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
  });

  // T4: a HISTORICAL WORDING pin over a synthetic source: batch-5's D49A E2 reply (main 28c1d37d, WDA, the "Open in
  // “AveriLab”?" alert up, its activeAppInfo naming SpringBoard: wda-activeappinfo-springboard-b5.json, read in
  // wda-tree-source.test.ts), before D54 read the alert. On that device today the alert IS found at the bound (D54:
  // WDA_ALERT, the same run's /source) and the reply is the alert instead; this wording is today's only when the alert
  // read finds none or fails, as the synthetic source here makes it.
  it('SpringBoard to the bound and no alert read: batch-5 E2\'s reply, byte for byte', async () => {
    const d = lab([SPRINGBOARD], { tree: new Error('no alert read') });
    const outcome = await d.adapter.openDeepLink('averilab://cell/open', { appId: LAB });
    expect(deepLinkText('ios', 'averilab://cell/open', outcome)).toBe(
      'Opened averilab://cell/open on ios\n⚠ averi did not see dev.averi.lab come forward after the link: iOS may be ' +
        'asking to confirm it ("Open in “…”?") or another app may be in front — take a screenshot, and if it shows a ' +
        'system alert, answer it (every launch stays behind it until then). 3 s after opening averilab://cell/open in ' +
        'dev.averi.lab, WebDriverAgent still read SpringBoard (the home screen, the launch animation or a system alert) ' +
        "as the active app — a ui_snapshot now reads that app's tree, on which an absent check passes. Read again; if it " +
        'repeats, take a screenshot',
    );
    expect(d.reads()).toBe(1);
  });

  it("idb reads another app's label to the bound: the same lead, then launch's note worded for the link", async () => {
    const outcome = await lab([label('Contacts')], { kind: 'idb' }).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(linkTextOf(outcome)).toMatch(/^averi did not see dev\.averi\.lab come forward after the link: iOS may be asking to confirm it/);
    expect(linkTextOf(outcome)).toMatch(/\(every launch stays behind it until then\)\. 3 s after opening averilab:\/\/d49 in dev\.averi\.lab \("AveriLab"\), the UI tree was still the app labelled "Contacts" — /);
  });

  // Review of D49a (MINOR 1): a launch before WDA is up stays silent, but an own-scheme link may wait behind "Open in
  // …?" — so it says it did not check rather than a bare "Opened".
  it('WebDriverAgent not up yet (declined): no wait — and a short note that it was not checked', async () => {
    const d = lab([{ kind: 'declined' }]);
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d49', { appId: LAB }))).toBe(
      'whether dev.averi.lab came forward after the link was not checked (WebDriverAgent is not running yet) — ' +
        'if iOS asks "Open in “…”?", answer it (a screenshot shows it)',
    );
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  // Review of D49a: "did not see it come forward" only when the wait read another app; when it could not tell, the
  // lead says so.
  it('the ask fails: no "did not see" — a lead that it could not check, then launch\'s "could not check" note worded for the link', async () => {
    const outcome = await lab([new Error('WDA /wda/activeAppInfo request failed: ECONNREFUSED\nstack')]).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(linkTextOf(outcome)).toBe(
      'averi could not check that dev.averi.lab came forward after the link: if iOS asks to confirm it ("Open in “…”?"), ' +
        'the link waits behind the alert — take a screenshot, and if it shows a system alert, answer it (every launch ' +
        'stays behind it until then). could not check that dev.averi.lab is in front (WDA /wda/activeAppInfo request ' +
        'failed: ECONNREFUSED) — for a moment after an app switch WebDriverAgent can still read the previous app; read again ' +
        'before trusting a read (the screenshot switches before the tree)',
    );
  });

  it('no bundle id to the bound (unlabelled): the could-not-check lead too', async () => {
    const outcome = await lab([{ kind: 'unlabelled' }]).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(linkTextOf(outcome)).toMatch(/^averi could not check that dev\.averi\.lab came forward after the link: /);
    expect(linkTextOf(outcome)).not.toMatch(/did not see/);
  });

  it("idb's tree empty to the bound: the could-not-check lead, then the empty-tree note worded for the link", async () => {
    const outcome = await lab([new IdbEmptyTreeError('AAAA-1111', [])], { kind: 'idb' }).adapter.openDeepLink('averilab://d49', { appId: LAB });
    expect(linkTextOf(outcome)).toMatch(
      /^averi could not check that dev\.averi\.lab came forward after the link: .*\. idb's tree stayed empty for the 3 s averi waited after opening averilab:\/\/d49 in dev\.averi\.lab, /,
    );
  });
});

// D54 (D49b, 2026-11-02; ADR 0032's D54 amendment): when iOS's "Open in “AveriLab”?" is what holds the link, the
// reply names it — its title and its buttons at their centres — instead of the vague note. Batch-5 D49A's captures
// (E2): idb lists the alert alone under SpringBoard; WDA's activeAppInfo names com.apple.springboard while it is up,
// and its /source holds the Alert. The happy path's device calls are unchanged on both sources.
const OPEN_IN = {
  title: 'Open in “AveriLab”?',
  buttons: [
    { label: 'Cancel', centre: { x: 127, y: 474 } },
    { label: 'Open', centre: { x: 275, y: 474 } },
  ],
  asksForApp: true,
};
const ALERT: AppHolder = { holder: 'alert', alert: OPEN_IN };

describe("IosAdapter.openDeepLink — iOS's \"Open in …?\" alert named (D54)", () => {
  it('idb, the lab in front: one describe-all, no note — D54 adds no call', async () => {
    const d = idbLab([IDB_LAB]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls).toEqual(['xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL, ...WRITES, APPROVAL, openurl('averilab://d54'), DESCRIBE_ALL]);
    expect(sleeps).toEqual([]);
  });

  it('idb lists the alert at the first read: the wait ends at once with it — one describe-all, no pause, no note, no extra call', async () => {
    const d = idbLab([IDB_ALERT]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual(ALERT);
    expect(d.calls).toEqual(['xcrun simctl appinfo AAAA-1111 dev.averi.lab', PLUTIL, ...WRITES, APPROVAL, openurl('averilab://d54'), DESCRIBE_ALL]);
    expect(sleeps).toEqual([]);
  });

  it("idb reads the lab, then the alert: ends at the read that lists it", async () => {
    const d = idbLab([IDB_LAB.replace('AveriLab', 'Contacts'), IDB_ALERT]);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual(ALERT);
    expect(d.describeAlls()).toBe(2);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS]);
  });

  it("idb: an alert found by its English \"Open in “…”?\" form, the app's names not in it (\"Lab Two\"): named, not as asking for the app", async () => {
    const d = idbLab([IDB_ALERT], appinfo('"Lab Two"', 'LabTwo', { path: LAB_PATH, executable: 'LabTwo' }));
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'alert', alert: { ...OPEN_IN, asksForApp: false } });
    expect(d.describeAlls()).toBe(1);
  });

  it('idb: an alert shape whose title neither names the app nor reads "Open in “…”?": no alert — the note at the bound, as before', async () => {
    const d = idbLab([IDB_ALERT.replace('Open in “AveriLab”?', 'Allow notifications?')]);
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d54', { appId: LAB }))).toMatch(/^averi did not see dev\.averi\.lab come forward/);
    expect(d.describeAlls()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
  });

  it('WebDriverAgent names the app at once: no /source read', async () => {
    const d = lab([bundle(LAB)], { tree: WDA_ALERT });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'none' });
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
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'none' });
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
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d54', { appId: LAB }))).toBe(SAW_SPRINGBOARD);
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
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d54', { appId: LAB }))).toBe(SAW_SPRINGBOARD);
    expect(d.reads()).toBe(1);
  });

  it('another app to the bound (not SpringBoard): no /source read — the note of before', async () => {
    const d = lab([bundle('com.apple.MobileAddressBook')], { tree: WDA_ALERT });
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d54', { appId: LAB }))).toMatch(/WebDriverAgent still read com\.apple\.MobileAddressBook as the active app/);
    expect(d.reads()).toBe(0);
  });

  it("the alert's title names none of the app's names: named all the same, marked as not naming the app", async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT, info: appinfo('Lab Two', 'LabTwo', { path: LAB_PATH, executable: 'LabTwo' }) });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'alert', alert: { ...OPEN_IN, asksForApp: false } });
  });

  it("the app's names cannot be read (appinfo lists only a Path): the alert is named, not as naming the app", async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT, info: appinfo(undefined, undefined, { path: LAB_PATH }) });
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'alert', alert: { ...OPEN_IN, asksForApp: false } });
  });

  // Review of D54: on idb the names are asked at the first label. When they cannot be read, an alert whose title reads
  // the English "Open in “…”?" needs none, so it is named all the same; only one that needs the names is "could not check".
  const NO_NAMES = appinfo(undefined, undefined, { path: LAB_PATH });

  it("idb, the app's names unreadable: the English-form alert is named (not as asking for the app) — one describe-all, no pause", async () => {
    const d = idbLab([IDB_ALERT], NO_NAMES);
    expect(await d.adapter.openDeepLink('averilab://d54', { appId: LAB })).toEqual({ holder: 'alert', alert: { ...OPEN_IN, asksForApp: false } });
    expect(d.describeAlls()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("idb, the app's names unreadable and a localised title that needs them: \"could not check\" at once, as before", async () => {
    const d = idbLab([IDB_ALERT.replace('Open in “AveriLab”?', 'In „AveriLab“ öffnen?')], NO_NAMES);
    const outcome = await d.adapter.openDeepLink('averilab://d54', { appId: LAB });
    expect(outcome.holder).toBe('unknown');
    expect(linkTextOf(outcome)).toMatch(/^averi could not check that dev\.averi\.lab came forward after the link: .*\(simctl appinfo listed neither CFBundleDisplayName nor CFBundleName\)/);
    expect(d.describeAlls()).toBe(1);
  });

  it("idb, the app's names unreadable and no alert shape (the lab's tree): \"could not check\", as before", async () => {
    const d = idbLab([IDB_LAB], NO_NAMES);
    expect(linkTextOf(await d.adapter.openDeepLink('averilab://d54', { appId: LAB }))).toMatch(/^averi could not check that dev\.averi\.lab came forward/);
  });
});

// D56 (2026-11-02; ADR 0032's D56 amendment): a launch behind iOS's system alert — an unanswered "Open in “AveriLab”?"
// keeps every launch behind it (batch-2) — names it and its buttons' centres in its ⚠ note, from the same reads as a
// link's (D54): on idb the label read that lists it, on WDA one short /source at the bound. The launch still never
// fails, and its happy path makes the same calls as before.
describe("IosAdapter.launch — the system alert it waits behind, named in its note (D56)", () => {
  const LAUNCH = 'xcrun simctl launch AAAA-1111 dev.averi.lab';
  const APPINFO = 'xcrun simctl appinfo AAAA-1111 dev.averi.lab';
  const ALERT_NOTE = LAUNCH_ALERT_NOTE;
  /** D48's note for a WDA launch that read SpringBoard to the bound, byte for byte. */
  const D48_SPRINGBOARD =
    '3 s after launching dev.averi.lab, WebDriverAgent still read SpringBoard (the home screen, the launch animation or ' +
    "a system alert) as the active app — a ui_snapshot now reads that app's tree, on which an absent check passes. " +
    'Read again; if it repeats, take a screenshot';
  const NO_NAMES = appinfo(undefined, undefined, { path: LAB_PATH });

  it('idb, the lab in front: one describe-all, then the names, no note — the same calls as before D56', async () => {
    const d = idbLab([IDB_LAB]);
    expect(await d.adapter.launch(LAB)).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([...WRITES, LAUNCH, DESCRIBE_ALL, APPINFO]);
    expect(sleeps).toEqual([]);
  });

  it('idb lists the alert at the first read: the wait ends at once with the alert note — one describe-all, no pause, no extra call', async () => {
    const d = idbLab([IDB_ALERT]);
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: ALERT_NOTE });
    expect(d.calls).toEqual([...WRITES, LAUNCH, DESCRIBE_ALL, APPINFO]);
    expect(sleeps).toEqual([]);
  });

  it('idb reads another app, then the alert: ends at the read that lists it', async () => {
    const d = idbLab([IDB_LAB.replace('AveriLab', 'Contacts'), IDB_ALERT]);
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: ALERT_NOTE });
    expect(d.describeAlls()).toBe(2);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS]);
  });

  it("idb: a SpringBoard prompt titled \"Allow notifications?\": no alert — D48's SpringBoard note at the bound, as before", async () => {
    const d = idbLab([IDB_ALERT.replace('Open in “AveriLab”?', 'Allow notifications?')]);
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: expect.stringMatching(/^3 s after launching dev\.averi\.lab \("AveriLab"\), the UI tree was still SpringBoard's/) });
    expect(d.describeAlls()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
  });

  it("idb, the app's names unreadable: the English-form alert is named all the same — one describe-all, one appinfo", async () => {
    const d = idbLab([IDB_ALERT], NO_NAMES);
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: ALERT_NOTE });
    expect(d.describeAlls()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toHaveLength(1);
  });

  it("idb, the app's names unreadable and a localised title that needs them: \"could not check\" at once, as before", async () => {
    const d = idbLab([IDB_ALERT.replace('Open in “AveriLab”?', 'In „AveriLab“ öffnen?')], NO_NAMES);
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: expect.stringMatching(/^could not check that dev\.averi\.lab is in front/) });
    expect(d.describeAlls()).toBe(1);
  });

  it('WebDriverAgent names the app at once: the same calls as before — no /source, no appinfo', async () => {
    const d = lab([bundle(LAB)], { tree: WDA_ALERT });
    expect(await d.adapter.launch(LAB)).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([...WRITES, LAUNCH]);
    expect(d.asks()).toBe(1);
    expect(d.reads()).toBe(0);
  });

  it('WebDriverAgent reads SpringBoard to the bound: the same asks, then exactly one /source — the alert note, no appinfo', async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT });
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: ALERT_NOTE });
    expect(d.asks()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
    expect(d.reads()).toBe(1);
    expect(d.calls).toEqual([...WRITES, LAUNCH]);
  });

  it("the /source read fails: fails open — D48's note, byte-identical", async () => {
    const d = lab([SPRINGBOARD], { tree: new Error('WDA /source request failed: ECONNRESET') });
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: D48_SPRINGBOARD });
    expect(d.reads()).toBe(1);
  });

  it("/source holds no alert (the home screen): D48's note, byte-identical", async () => {
    const home = structuredClone(WDA_ALERT);
    const unmark = (n: UiNode): void => {
      delete n.presentation;
      n.children.forEach(unmark);
    };
    unmark(home);
    const d = lab([SPRINGBOARD], { tree: home });
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: D48_SPRINGBOARD });
    expect(d.reads()).toBe(1);
  });

  // The asymmetry the amendment states: on WDA any SpringBoard alert at the bound is named — no title gate, and no
  // names to judge one with (a launch asks none); on idb only "Open in “…”?" or a title naming the app (above).
  it('WebDriverAgent: a SpringBoard alert titled "Allow notifications?" at the bound is named all the same, no appinfo', async () => {
    const other = structuredClone(WDA_ALERT);
    const retitle = (n: UiNode): void => {
      if (n.label === 'Open in “AveriLab”?') n.label = 'Allow notifications?';
      n.children.forEach(retitle);
    };
    retitle(other);
    const d = lab([SPRINGBOARD], { tree: other });
    expect(worded(await d.adapter.launch(LAB))).toEqual({ note: ALERT_NOTE.replace('"Open in “AveriLab”?"', '"Allow notifications?"') });
    expect(d.reads()).toBe(1);
    expect(d.calls).toEqual([...WRITES, LAUNCH]);
  });

  it('SpringBoard, then the app before the bound: no /source read, no note', async () => {
    const d = lab([SPRINGBOARD, SPRINGBOARD, bundle(LAB)], { tree: WDA_ALERT });
    expect(await d.adapter.launch(LAB)).toEqual({ holder: 'none' });
    expect(d.reads()).toBe(0);
  });

  it('another app to the bound (not SpringBoard): no /source read — its note as before', async () => {
    const d = lab([bundle('com.apple.MobileAddressBook')], { tree: WDA_ALERT });
    expect(launchTextOf(await d.adapter.launch(LAB))).toMatch(/^3 s after launching dev\.averi\.lab, WebDriverAgent still read com\.apple\.MobileAddressBook as the active app/);
    expect(d.reads()).toBe(0);
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
      read: () => Promise.reject(new Error('unused')),
      systemAlert: async () => (tree === undefined ? Promise.reject(new Error('unused')) : alertInWda(structuredClone(tree))),
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
    expect((await adapter.openDeepLink('averilab://d49', { appId: LAB })).holder).toBe('alert');
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

// D58 (2026-11-02; ADR 0032's D58 amendment): iOS asks "Open in “AveriLab”?" once per simulator because simctl's opener
// (CoreSimulatorBridge) has no remembered answer for the scheme. Before a link to the project's own scheme, averi now
// writes the answer an Open tap records — com.apple.launchservices.schemeapproval,
// com.apple.CoreSimulator.CoreSimulatorBridge-->averilab = dev.averi.lab — beside the accessibility writes, so the
// alert should not come. Every other link, and launch(), writes nothing new; every reply is unchanged; D54's naming
// stays the fallback when the simulator ignores the write.
describe("IosAdapter.openDeepLink — the project's own scheme pre-approved for simctl's opener (D58)", () => {
  const APPINFO = 'xcrun simctl appinfo AAAA-1111 dev.averi.lab';
  const ANNOUNCED =
    'averi: recorded iOS\'s "Open" answer for averilab links to dev.averi.lab from simctl openurl on AAAA-1111 ' +
    '(com.apple.launchservices.schemeapproval com.apple.CoreSimulator.CoreSimulatorBridge-->averilab = dev.averi.lab; ' +
    'simulator-wide, not restored; before every link to the app\'s own scheme, so iOS should not ask "Open in “…”?")';
  const FAILED =
    'averi: could not pre-approve averilab links to dev.averi.lab for simctl openurl on AAAA-1111 ' +
    '(simctl spawn: defaults write failed) — iOS may ask "Open in “…”?" first, and the reply names the alert if it ' +
    'does; not tried again until the app is installed again';
  const approvalLines = () => stderrLines().filter((l) => l.includes('averilab links'));

  it('one pre-approval beside the accessibility writes, before openurl; the key lower-cased; written on every link, said once', async () => {
    const d = lab([bundle(LAB)]);
    expect(await d.adapter.openDeepLink('averilab://d58', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('AveriLab://again', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([APPINFO, PLUTIL, ...WRITES, APPROVAL, openurl('averilab://d58'), ...WRITES, APPROVAL, openurl('AveriLab://again')]);
    expect(stderrLines()).toEqual([ANNOUNCED]);
  });

  it('the three writes are in flight together, and openurl waits for all three', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let done = 0;
    const d = lab([bundle(LAB)], {
      hook: async (full) => {
        if (full.includes(' defaults write ')) {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          done += 1;
        }
        if (full.includes(' openurl ')) expect(done).toBe(3);
      },
    });
    await d.adapter.openDeepLink('averilab://d58', { appId: LAB });
    expect(maxInFlight).toBe(3);
    expect(d.calls.filter((c) => c.includes(' openurl '))).toHaveLength(1);
  });

  it("https, tel, no scheme, another app's scheme, no project app: no pre-approval", async () => {
    const d = lab([bundle(LAB)]);
    for (const url of ['https://averi.dev/x', 'tel:+421900', 'averilab', 'contacts://new']) await d.adapter.openDeepLink(url, { appId: LAB });
    await d.adapter.openDeepLink('averilab://d58');
    expect(d.calls.filter((c) => c.includes('schemeapproval'))).toEqual([]);
    expect(approvalLines()).toEqual([]);
  });

  it('schemes that could not be read: no pre-approval', async () => {
    const d = lab([bundle(LAB)], { types: execErrorLikeExec(PLUTIL, 1, `${LAB_PATH}/Info.plist: (The file couldn’t be opened.)\n`) });
    await d.adapter.openDeepLink('averilab://d58', { appId: LAB });
    expect(d.calls.filter((c) => c.includes('schemeapproval'))).toEqual([]);
  });

  it('the write fails: openurl and the wait run as before, one stderr line, not tried again until install()', async () => {
    const d = lab([bundle(LAB)], { approval: new Error('simctl spawn: defaults write failed\nmore') });
    expect(await d.adapter.openDeepLink('averilab://d58', { appId: LAB })).toEqual({ holder: 'none' });
    expect(await d.adapter.openDeepLink('averilab://d58', { appId: LAB })).toEqual({ holder: 'none' });
    expect(d.calls).toEqual([APPINFO, PLUTIL, ...WRITES, APPROVAL, openurl('averilab://d58'), ...WRITES, openurl('averilab://d58')]);
    expect(d.asks()).toBe(2);
    expect(stderrLines()).toEqual([FAILED]);
    await d.adapter.install('/builds/AveriLab.app');
    await d.adapter.openDeepLink('averilab://d58', { appId: LAB });
    expect(d.calls.filter((c) => c === APPROVAL)).toHaveLength(2);
    expect(stderrLines()).toEqual([FAILED, FAILED]);
  });

  it('the write fails and iOS asks: the alert named as D54 has it (fails open)', async () => {
    const d = lab([SPRINGBOARD], { tree: WDA_ALERT, approval: new Error('simctl spawn: defaults write failed') });
    expect(await d.adapter.openDeepLink('averilab://d58', { appId: LAB })).toEqual(ALERT);
    expect(d.calls).toContain(openurl('averilab://d58'));
  });

  it('an accessibility write failing does not hold the pre-approval back, nor say it failed', async () => {
    const d = lab([bundle(LAB)], {
      hook: async (full) => {
        if (full.includes('com.apple.Accessibility')) throw new Error('spawn failed');
      },
    });
    await d.adapter.openDeepLink('averilab://d58', { appId: LAB });
    expect(d.calls).toContain(APPROVAL);
    expect(approvalLines()).toEqual([ANNOUNCED]);
    expect(stderrLines().filter((l) => l.startsWith('averi: could not set com.apple.Accessibility AutomationEnabled'))).toHaveLength(1);
  });

  it('launch() writes no pre-approval — not even after a link wrote one', async () => {
    const d = lab([bundle(LAB)]);
    await d.adapter.launch(LAB);
    await d.adapter.openDeepLink('averilab://d58', { appId: LAB });
    await d.adapter.launch(LAB);
    expect(d.calls.filter((c) => c === APPROVAL)).toHaveLength(1);
    expect(d.calls.slice(-3)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 dev.averi.lab']);
    expect(d.calls.slice(0, 3)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 dev.averi.lab']);
  });
});

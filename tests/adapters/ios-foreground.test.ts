import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbTreeSource, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { awaitForeground, FOREGROUND_POLL_MS, FOREGROUND_WAIT_MS } from '../../src/adapters/ios-foreground.js';
import { Verifier } from '../../src/verify/assert.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { appinfo } from '../helpers/simctl-appinfo.js';

// The one sleep owner, recorded and not waited on; under a Date-only fake
// clock each recorded sleep moves the clock by its length, so the wait's
// deadline plays out in virtual time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

// docs/bugs/2026-10-09-ios-launch-app-reads-previous-apps-tree.md, measured
// on iOS 27.0 with idb: `launch_app com.apple.MobileAddressBook` from the
// bank app returned in 0.8 s, and the next two describe-all reads were still
// the bank app's whole tree — headed by an Application labelled "Skeleton
// Internal" — with Contacts' from the third. An `absent:` assert right after
// passed on the bank's tree, 3 of 3. The payloads below are shaped like
// those reads (and like the triage repro that pinned the bug at c11d179).
const f = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const BANK = JSON.stringify([
  { type: 'Application', AXLabel: 'Skeleton Internal', frame: f(0, 0, 402, 874) },
  { type: 'TextField', AXLabel: 'Search', AXUniqueId: 'accounts.detail.search_field', frame: f(16, 120, 370, 40) },
  { type: 'StaticText', AXLabel: 'Something went wrong', frame: f(16, 200, 370, 20) },
  { type: 'Button', AXLabel: 'Accounts', frame: f(0, 790, 100, 50) },
]);
const CONTACTS = JSON.stringify([
  { type: 'Application', AXLabel: 'Contacts', frame: f(0, 0, 402, 874) },
  { type: 'Other', AXLabel: 'New Contact', AXUniqueId: 'New Contact', frame: f(0, 78, 402, 54) },
  { type: 'Button', AXLabel: 'Cancel', frame: f(16, 90, 60, 30) },
]);
/** SpringBoard during a cold launch (2026-10-08): its Application is labelled ' '. */
const SPRINGBOARD = JSON.stringify([
  { type: 'Application', AXLabel: ' ', frame: f(0, 0, 402, 874) },
  { type: 'StaticText', AXLabel: '18:29', frame: f(50, 22, 48, 22) },
  { type: 'Button', AXLabel: 'Contacts', AXUniqueId: 'Contacts', frame: f(-2, 234, 406, 406) },
]);
/** idb's launch transient: a lone 0×0 Application — IdbEmptyTreeError. */
const EMPTY = JSON.stringify([{ type: 'Application', AXLabel: 'Contacts', frame: f(0, 0, 0, 0) }]);

const CONTACTS_INFO = appinfo('Contacts', 'Contacts');
/** The bank app's names, as `simctl appinfo com.finshape.dbosbanking` would list them (the measured label). */
const BANK_INFO = appinfo('"Skeleton Internal"', 'Runner');
/** appinfo per bundle: the bank app's for its id, Contacts' for every other. */
const perBundle = (bundle: string) => (bundle === 'com.finshape.dbosbanking' ? BANK_INFO : CONTACTS_INFO);

/**
 * An exec whose describe-all answers in turn from `reads` (the last repeats),
 * and whose `simctl appinfo` answers `info` (an Error rejects; a function
 * answers per bundle id). Every command line is recorded.
 */
function device(reads: string[], info: string | Error | ((bundle: string) => string) = CONTACTS_INFO, took: { readMs?: number; appinfoMs?: number } = {}) {
  const calls: string[] = [];
  /** The virtual time each describe-all STARTED at. */
  const readStarts: number[] = [];
  let read = 0;
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    const out = (s: string) => ({ stdout: Buffer.from(s), stderr: '' });
    if (full.startsWith('idb ui describe-all')) {
      readStarts.push(Date.now());
      if (took.readMs !== undefined) vi.setSystemTime(Date.now() + took.readMs);
      return out(reads[Math.min(read++, reads.length - 1)]);
    }
    if (full.startsWith('xcrun simctl appinfo') && took.appinfoMs !== undefined) vi.setSystemTime(Date.now() + took.appinfoMs);
    if (full.startsWith('idb describe --json')) return out(JSON.stringify({ screen_dimensions: { width_points: 402, height_points: 874 } }));
    if (full.startsWith('xcrun simctl appinfo')) {
      if (info instanceof Error) throw info;
      return out(typeof info === 'function' ? info(args.at(-1)!) : info);
    }
    return out('');
  };
  const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
  return {
    adapter,
    describeAlls: () => calls.filter((c) => c.startsWith('idb ui describe-all')).length,
    appinfos: () => calls.filter((c) => c.startsWith('xcrun simctl appinfo')),
    calls,
    readStarts,
  };
}

/**
 * An IosAdapter over a WDA-kind source whose applicationLabel answers in turn
 * from `answers` (the last repeats; an Error rejects) — WdaTreeSource's
 * answers, WdaServer's fakes being wda-tree-source.test.ts's. Every exec
 * command line is recorded.
 */
function wdaDevice(answers: Array<ApplicationLabel | Error>) {
  const calls: string[] = [];
  let asked = 0;
  const source: IosTreeSource = {
    kind: 'wda',
    read: () => Promise.reject(new Error('unused')),
    applicationLabel: async () => {
      const a = answers[Math.min(asked++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
    dispose: () => Promise.resolve(),
  };
  const exec: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { adapter: new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: source }), calls, asks: () => asked };
}

const LAB: ApplicationLabel = { kind: 'bundle', bundleId: 'dev.averi.lab' };
const CONTACTS_APP: ApplicationLabel = { kind: 'bundle', bundleId: 'com.apple.MobileAddressBook' };
const SPRINGBOARD_APP: ApplicationLabel = { kind: 'bundle', bundleId: 'com.apple.springboard' };

beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // the accessibility-write announcement
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('IosAdapter.launch waits until the tree is the launched app\'s', () => {
  it('the bound and the pause are the documented ones: 3 s, 200 ms', () => {
    expect(FOREGROUND_WAIT_MS).toBe(3_000);
    expect(FOREGROUND_POLL_MS).toBe(200);
  });

  it('already in front at the first read: one describe-all, one appinfo, no wait, no note', async () => {
    const d = device([CONTACTS]);
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(1);
    expect(d.appinfos()).toEqual(['xcrun simctl appinfo AAAA-1111 com.apple.MobileAddressBook']);
    expect(sleeps).toEqual([]);
    // after the launch itself, never before it
    const launchedAt = d.calls.indexOf('xcrun simctl launch AAAA-1111 com.apple.MobileAddressBook');
    expect(launchedAt).toBeGreaterThanOrEqual(0);
    expect(launchedAt).toBeLessThan(d.calls.findIndex((c) => c.startsWith('idb ui describe-all')));
  });

  it("the measured switch — the previous app's tree for two reads — is waited out: three reads, two pauses, no note", async () => {
    const d = device([BANK, BANK, CONTACTS]);
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(3);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS, FOREGROUND_POLL_MS]);
    expect(d.appinfos()).toHaveLength(1); // looked up once per wait, not per read
  });

  it('SpringBoard (a cold launch, its Application labelled " ") is waited out the same way', async () => {
    const d = device([SPRINGBOARD, CONTACTS]);
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(2);
  });

  it("idb's empty tree (the launch transient) is a miss, not a stop: read on until the app's tree", async () => {
    const d = device([EMPTY, EMPTY, CONTACTS]);
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(3);
  });

  it('CFBundleName counts as the app\'s name too', async () => {
    const d = device([BANK, CONTACTS], appinfo('"Kontakte"', 'Contacts'));
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(2);
  });

  /**
   * docs/bugs/2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md (11:25:29, at 347e70d) — THE MEASURED
   * CASE: the session's first launch, the bank app in front since before the server started (never launched by it, so its
   * names are unknown here); the screenshot showed Contacts while idb served "Skeleton Internal" >= 4.5 s after the launch and
   * Contacts' only by ~15 s. The old note said "If the screenshot shows com.apple.MobileAddressBook … this can be ignored":
   * the screenshot did, and ignoring it was the wrong-app read. Now: the previous app's until proven otherwise, and the
   * localized reading only past a 20 s re-read — never on the screenshot alone.
   */
  it('never in front, the label no app averi launched (the measured case): reads until the bound and no longer, then a note: the previous app\'s tree until a read says otherwise, a localized name only past 20 s', async () => {
    const d = device([BANK]);
    const started = Date.now();
    const outcome = await d.adapter.launch('com.apple.MobileAddressBook');
    // Instant reads: one every pause, the last one STARTED a pause before the deadline — no pause is taken that would end on it.
    const rounds = FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS - 1;
    expect(sleeps).toEqual(Array(rounds).fill(FOREGROUND_POLL_MS));
    expect(d.describeAlls()).toBe(rounds + 1);
    expect(d.readStarts.at(-1)! - started).toBe(FOREGROUND_WAIT_MS - FOREGROUND_POLL_MS);
    expect(outcome.note).toBe(
      '3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal" — ' +
        "iOS can hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app " +
        '(an absent check passes on it). Treat the tree as the previous app\'s until a read is labelled "Contacts": after an app ' +
        "switch idb was measured serving the previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is " +
        'still labelled "Skeleton Internal" while the screenshot shows com.apple.MobileAddressBook is that label its on-screen ' +
        'name (a localized display name its Info.plist does not carry), and this note can be ignored. The screenshot alone ' +
        "cannot tell them apart: it shows the launched app before idb's tree does",
    );
  });

  /**
   * The same switch when averi itself launched the app being left (a flow or session that opened the bank app first):
   * its names are cached, so the label is known to be ANOTHER app's — the note says whose tree it is and nothing else.
   */
  it('never in front, the label the name of an app averi launched earlier: the note says the tree is still that app\'s — no localized-name reading, no screenshot test', async () => {
    const d = device([BANK], perBundle);
    expect(await d.adapter.launch('com.finshape.dbosbanking')).toEqual({}); // its names now known to the adapter
    const outcome = await d.adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toBe(
      '3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal" — ' +
        "iOS can hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app " +
        '(an absent check passes on it). "Skeleton Internal" is the name of com.finshape.dbosbanking, which averi launched ' +
        "earlier, not of com.apple.MobileAddressBook: the tree is still that app's, even if the screenshot already shows " +
        "com.apple.MobileAddressBook (it switches before idb's tree does) — read again before trusting what the tree says",
    );
    expect(outcome.note).not.toMatch(/localized|can be ignored/);
  });

  it('a known name is matched by any of that app\'s names — its CFBundleName too', async () => {
    const d = device([BANK.replace('Skeleton Internal', 'Runner')], perBundle);
    await d.adapter.launch('com.finshape.dbosbanking'); // "Runner" is its CFBundleName: a match, names cached
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toMatch(/"Runner" is the name of com\.finshape\.dbosbanking, which averi launched earlier/);
  });

  it('reads that take time: no read STARTS at or after the deadline', async () => {
    const d = device([BANK], CONTACTS_INFO, { readMs: 150 });
    const started = Date.now();
    await d.adapter.launch('com.apple.MobileAddressBook');
    expect(d.readStarts.length).toBeGreaterThan(1);
    for (const at of d.readStarts) expect(at - started).toBeLessThan(FOREGROUND_WAIT_MS);
    // and the window was used: the last read started within one read-and-pause of its end
    expect(d.readStarts.at(-1)! - started).toBeGreaterThanOrEqual(FOREGROUND_WAIT_MS - 150 - FOREGROUND_POLL_MS);
  });

  it("a slow appinfo is added to the window, not taken from it: the stale window is still waited out", async () => {
    const d = device([BANK, BANK, CONTACTS], CONTACTS_INFO, { appinfoMs: 5_000 });
    expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
    expect(d.describeAlls()).toBe(3);
  });

  it("never past SpringBoard: the note calls it SpringBoard's, not \" \"", async () => {
    const outcome = await device([SPRINGBOARD]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toMatch(/the UI tree was still SpringBoard's \(the home screen or the launch animation\) — /);
    // never "a localized display name": SpringBoard is not the app under another name
    expect(outcome.note).toMatch(
      /\(an absent check passes on it\)\. Read again before trusting a read \(the screenshot switches before the tree\)\. A screenshot does tell one thing here: whether a system alert is in front \(answer it\) or the home screen still is$/,
    );
  });

  it('a check whose names() lists none (the ForegroundCheck contract allows it): the note quotes no empty name — "labelled with one of its names", never "labelled :" (code review of fix/r4, S11)', async () => {
    const { note } = await awaitForeground({
      bundleId: 'com.apple.MobileAddressBook',
      label: async () => ({ kind: 'label', label: 'Skeleton Internal' }),
      names: async () => [],
      ownerOf: () => undefined,
      source: 'idb',
    });
    expect(note).toMatch(/^3 s after launching com\.apple\.MobileAddressBook, the UI tree/);
    expect(note).toMatch(/Treat the tree as the previous app's until a read is labelled with one of com\.apple\.MobileAddressBook's names: after/);
    expect(note).not.toMatch(/labelled :/);
  });

  it('empty for the whole bound: a note that nothing was checked', async () => {
    const outcome = await device([EMPTY]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toBe(
      "idb's tree stayed empty for the 3 s averi waited after launching com.apple.MobileAddressBook, so which app is in " +
        'front was not checked — read again before trusting a read (the screenshot switches before the tree)',
    );
  });

  it('a stale label, then empty to the bound: the note names the stale label, the last thing actually read', async () => {
    const outcome = await device([BANK, EMPTY]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toMatch(/the UI tree was still the app labelled "Skeleton Internal"/);
  });
});

describe('IosAdapter.launch — the wait fails open: it never fails a launch and never waits on what it cannot tell', () => {
  it('a read error other than the empty tree: stops at once, with a note quoting its first line', async () => {
    const source: IosTreeSource = {
      kind: 'idb',
      read: () => Promise.reject(new Error('unused')),
      applicationLabel: () => Promise.reject(new Error('idb: connection refused\nstack…')),
      dispose: () => Promise.resolve(),
    };
    const outcome = await new IosAdapter({ udid: 'AAAA-1111', exec: async () => ({ stdout: Buffer.alloc(0), stderr: '' }), treeSource: source }).launch('com.app');
    expect(outcome.note).toBe(
      'could not check that com.app is in front (idb: connection refused) — for a moment after an app switch iOS can hand ' +
        "idb the previous app's tree; read again before trusting a read (the screenshot switches before the tree)",
    );
    expect(sleeps).toEqual([]);
  });

  it('appinfo fails: stops after one read WITH a note quoting it — and the next launch asks again (a failure is not cached)', async () => {
    const d = device([BANK], new Error('Command failed: xcrun simctl appinfo\nmore'));
    const outcome = await d.adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toMatch(/^could not check that com\.apple\.MobileAddressBook is in front \(.*Command failed: xcrun simctl appinfo\) — /);
    expect(d.describeAlls()).toBe(1);
    expect(sleeps).toEqual([]);
    await d.adapter.launch('com.apple.MobileAddressBook');
    expect(d.appinfos()).toHaveLength(2);
  });

  it('appinfo lists neither name nor Path (a format drift, or not installed): a note saying so, not a silent pass — and asked again next launch', async () => {
    const d = device([BANK], '');
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toBe(
      'could not check that com.apple.MobileAddressBook is in front (simctl appinfo listed neither CFBundleDisplayName nor ' +
        "CFBundleName) — for a moment after an app switch iOS can hand idb the previous app's tree; " +
        'read again before trusting a read (the screenshot switches before the tree)',
    );
    expect(d.describeAlls()).toBe(1);
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toMatch(/listed neither CFBundleDisplayName nor CFBundleName/);
    expect(d.appinfos()).toHaveLength(2);
  });

  it('appinfo lists a Path but no name: the note on every launch, from the cache (D33: the liveness check uses that Path)', async () => {
    const d = device([BANK], appinfo(undefined, undefined, { path: '/x/AAAA-1111/data/Containers/Bundle/Application/G/C.app' }));
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toMatch(/listed neither CFBundleDisplayName nor CFBundleName/);
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toMatch(/listed neither CFBundleDisplayName nor CFBundleName/);
    expect(d.appinfos()).toHaveLength(1);
  });

  it('names found are cached per bundle: a second launch of the same bundle asks appinfo nothing', async () => {
    const d = device([CONTACTS]);
    await d.adapter.launch('com.apple.MobileAddressBook');
    await d.adapter.launch('com.apple.MobileAddressBook');
    expect(d.appinfos()).toHaveLength(1);
  });

  // Review round 2: a read that cannot say whose tree it is (no Application,
  // or an unlabelled one — unmeasured, and possibly idb's full-frame launch
  // transient) is a poll miss, not a stop, so a cold launch keeps its wait.
  const BUTTON = { type: 'Button', AXLabel: 'Cancel', frame: f(16, 90, 60, 30) };
  const UNSAYABLE = [
    JSON.stringify([BUTTON]),
    JSON.stringify([{ type: 'Application', frame: f(0, 0, 402, 874) }, BUTTON]),
    JSON.stringify([{ type: 'Application', AXLabel: '', frame: f(0, 0, 402, 874) }, BUTTON]),
  ];

  it('an unlabelled read, then the app\'s: read on, match, no note — the unlabelled read cost one pause', async () => {
    for (const payload of UNSAYABLE) {
      resetSleeps();
      const d = device([payload, CONTACTS]);
      expect(await d.adapter.launch('com.apple.MobileAddressBook')).toEqual({});
      expect(d.describeAlls()).toBe(2);
      expect(d.appinfos()).toHaveLength(1); // asked only once a label could be compared
    }
  });

  it('unlabelled to the deadline: never silent — a note saying it could not check; no appinfo asked', async () => {
    for (const payload of UNSAYABLE) {
      const d = device([payload]);
      expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toBe(
        "could not check that com.apple.MobileAddressBook is in front (the tree's Application element had no label, or there " +
          "was none, for the 3 s averi waited) — for a moment after an app switch iOS can hand idb the previous app's tree; " +
          'read again before trusting a read (the screenshot switches before the tree)',
      );
      expect(d.describeAlls()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
      expect(d.appinfos()).toEqual([]);
    }
  });

  it('a stale label outranks a later unlabelled read in the note: the last real label read is named', async () => {
    const outcome = await device([BANK, UNSAYABLE[1]]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toMatch(/the UI tree was still the app labelled "Skeleton Internal"/);
  });

  it('an unlabelled read, then only empty trees: the note is the unlabelled one — the most telling thing read', async () => {
    const outcome = await device([UNSAYABLE[1], EMPTY]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toMatch(/^could not check that .* \(the tree's Application element had no label/);
  });

  it('a WDA source that is not up: no ask beyond the declined one, no appinfo, no note', async () => {
    const d = wdaDevice([{ kind: 'declined' }]);
    expect(await d.adapter.launch('dev.averi.lab')).toEqual({});
    expect(d.asks()).toBe(1);
    expect(d.calls.filter((c) => c.includes('appinfo') || c.startsWith('idb'))).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  // D49a: only a link to the project's own scheme waits (tests/adapters/ios-deep-link.test.ts); one opened with no project app reads nothing.
  it('a deep link with no project app does not wait — it may legitimately bring another app forward', async () => {
    const d = device([BANK]);
    await d.adapter.openDeepLink('contacts://new');
    expect(d.describeAlls()).toBe(0);
    expect(d.appinfos()).toEqual([]);
  });
});

// D48 (batch-2 D, 2026-11-02, main 39c1fcda): on the WDA source `launch_app`
// waited for nothing, and in 2 of 5 runs the `ui_snapshot` right after it read
// Contacts' whole tree. WebDriverAgent's sessionless /source reads the app AX
// lists as active, which lags the switch like idb's; the launch now asks WDA
// which app that is (/wda/activeAppInfo, by bundle id) once WDA is up.
describe('IosAdapter.launch on the WDA source waits until WebDriverAgent names the launched bundle (D48)', () => {
  it("the launched bundle on the first ask: one ask, no pause, no note — and simctl appinfo never asked", async () => {
    const d = wdaDevice([LAB]);
    expect(await d.adapter.launch('dev.averi.lab')).toEqual({});
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toEqual([]);
  });

  it('Contacts for two asks, then the launched bundle: waited out, asks spaced by the poll, no note, no appinfo', async () => {
    const d = wdaDevice([CONTACTS_APP, CONTACTS_APP, LAB]);
    expect(await d.adapter.launch('dev.averi.lab')).toEqual({});
    expect(d.asks()).toBe(3);
    expect(sleeps).toEqual([FOREGROUND_POLL_MS, FOREGROUND_POLL_MS]);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toEqual([]);
  });

  it('another bundle throughout: asks until the bound and no longer, then a note naming the app WebDriverAgent still reads — no localized-name reading', async () => {
    const d = wdaDevice([CONTACTS_APP]);
    const outcome = await d.adapter.launch('dev.averi.lab');
    expect(outcome.note).toBe(
      '3 s after launching dev.averi.lab, WebDriverAgent still read com.apple.MobileAddressBook as the active app — ' +
        "a ui_snapshot now reads that app's tree, on which an absent check passes. Read again; if it repeats, take a screenshot",
    );
    expect(d.asks()).toBe(FOREGROUND_WAIT_MS / FOREGROUND_POLL_MS);
    expect(outcome.note).not.toMatch(/locali[sz]ed|idb/);
    expect(d.calls.filter((c) => c.includes('appinfo'))).toEqual([]);
  });

  it('SpringBoard throughout: named as what it is, not by its bundle id', async () => {
    const outcome = await wdaDevice([SPRINGBOARD_APP]).adapter.launch('dev.averi.lab');
    expect(outcome.note).toMatch(
      /^3 s after launching dev\.averi\.lab, WebDriverAgent still read SpringBoard \(the home screen, the launch animation or a system alert\) as the active app — /,
    );
    expect(outcome.note).not.toMatch(/com\.apple\.springboard/);
  });

  it('the ask fails: a "could not check" note at once, quoting its first line, worded for WebDriverAgent', async () => {
    const d = wdaDevice([new Error('WDA /wda/activeAppInfo request failed on port 8100 (udid AAAA-1111): ECONNREFUSED — xcodebuild log: /tmp/x.log\nstack…')]);
    const outcome = await d.adapter.launch('dev.averi.lab');
    expect(outcome.note).toBe(
      'could not check that dev.averi.lab is in front (WDA /wda/activeAppInfo request failed on port 8100 (udid AAAA-1111): ' +
        'ECONNREFUSED — xcodebuild log: /tmp/x.log) — for a moment after an app switch WebDriverAgent can still read the ' +
        'previous app; read again before trusting a read (the screenshot switches before the tree)',
    );
    expect(d.asks()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('no bundle id to the bound (unlabelled): never silent — a note saying WebDriverAgent named none, not an Application element', async () => {
    const outcome = await wdaDevice([{ kind: 'unlabelled' }]).adapter.launch('dev.averi.lab');
    expect(outcome.note).toBe(
      "could not check that dev.averi.lab is in front (WebDriverAgent's active app carried no bundle id for the 3 s averi " +
        'waited) — for a moment after an app switch WebDriverAgent can still read the previous app; ' +
        'read again before trusting a read (the screenshot switches before the tree)',
    );
  });

  it('a stale bundle outranks a later unlabelled answer: the note names the last app actually named', async () => {
    const outcome = await wdaDevice([CONTACTS_APP, { kind: 'unlabelled' }]).adapter.launch('dev.averi.lab');
    expect(outcome.note).toMatch(/WebDriverAgent still read com\.apple\.MobileAddressBook as the active app/);
  });

  it('a stale bundle, then the launched one after an unlabelled answer: matched, no note', async () => {
    expect(await wdaDevice([CONTACTS_APP, { kind: 'unlabelled' }, LAB]).adapter.launch('dev.averi.lab')).toEqual({});
  });
});

// The triage repro (scratchpad triage-launch, at c11d179), as a regression
// test through the real adapter and the real verifier: before the fix the
// absent assert PASSED on the bank app's tree, and so did a presence assert
// on the bank's own field.
describe('regression: an assert right after launch_app judges the launched app, not the one it covered', () => {
  it("absent: on an element the launched app shows does not pass on the previous app's tree", async () => {
    const d = device([BANK, BANK, CONTACTS]);
    await d.adapter.launch('com.apple.MobileAddressBook');
    const verifier = new Verifier(d.adapter, { pollMs: 5, timeoutMs: 500 });
    const r = await verifier.assert({ element: { id: 'New Contact' }, absent: true, timeout: 500 });
    expect(r.pass).toBe(false);
  });

  it("a presence assert on the previous app's own field does not pass either", async () => {
    const d = device([BANK, BANK, CONTACTS]);
    await d.adapter.launch('com.apple.MobileAddressBook');
    const verifier = new Verifier(d.adapter, { pollMs: 5, timeoutMs: 500 });
    const r = await verifier.assert({ element: { id: 'accounts.detail.search_field' }, timeout: 500 });
    expect(r.pass).toBe(false);
  });
});

describe('the launch and the liveness check share one appinfo per bundle (D33)', () => {
  it('an idb launch, then isAppRunning: one appinfo in all, and the check asks pgrep with its Path', async () => {
    const info = appinfo(undefined, 'Contacts', {
      path: '/Users/me/Library/Developer/CoreSimulator/Devices/AAAA-1111/data/Containers/Bundle/Application/G/Contacts.app',
    });
    const d = device([CONTACTS], info);
    await d.adapter.launch('com.apple.MobileAddressBook');
    expect(await d.adapter.isAppRunning('com.apple.MobileAddressBook')).toBe(true);
    expect(d.appinfos()).toHaveLength(1);
    expect(d.calls.filter((c) => c.startsWith('/usr/bin/pgrep'))).toHaveLength(1);
    expect(d.calls.filter((c) => c.includes('launchctl'))).toEqual([]);
  });
});

// D54: the WDA alert read (ForegroundCheck.alert) is a link's alone, and only at the bound with SpringBoard last named.
describe('awaitForeground — the one alert read, at the bound, for a link only (D54)', () => {
  const ALERT = { title: 'Open in “AveriLab”?', buttons: [{ label: 'Open', centre: { x: 275, y: 474 } }] };
  const check = (link: string | undefined) => {
    let reads = 0;
    return {
      reads: () => reads,
      check: {
        bundleId: 'dev.averi.lab',
        label: async () => ({ kind: 'bundle' as const, bundleId: 'com.apple.springboard' }),
        names: async () => ['AveriLab'],
        ownerOf: () => undefined,
        source: 'wda' as const,
        alert: async () => (reads++, ALERT),
        ...(link !== undefined && { link }),
      },
    };
  };

  it('a link: read once, at the bound — the alert, marked as naming the app', async () => {
    const c = check('averilab://d54');
    expect(await awaitForeground(c.check)).toEqual({ alert: { ...ALERT, asksForApp: true } });
    expect(c.reads()).toBe(1);
  });

  it('a launch handed the same read: never asked — its note as before', async () => {
    const c = check(undefined);
    expect(await awaitForeground(c.check)).toEqual({ note: expect.stringMatching(/^3 s after launching dev\.averi\.lab, WebDriverAgent still read SpringBoard/) });
    expect(c.reads()).toBe(0);
  });
});

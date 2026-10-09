import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbTreeSource, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { appInfoNames, FOREGROUND_POLL_MS, FOREGROUND_WAIT_MS } from '../../src/adapters/ios-foreground.js';
import { Verifier } from '../../src/verify/assert.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';

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

/** `simctl appinfo` as it prints (an old-style plist), trimmed to the keys read and two around them. */
const appinfo = (display: string | undefined, name: string) =>
  '{\n' +
  '    ApplicationType = System;\n' +
  '    CFBundleExecutable = Contacts;\n' +
  (display === undefined ? '' : `    CFBundleDisplayName = ${display};\n`) +
  '    CFBundleIdentifier = "com.apple.MobileAddressBook";\n' +
  `    CFBundleName = ${name};\n` +
  '    GroupContainers =     {\n        "group.com.apple.contacts" = "file:///tmp/x/";\n    };\n' +
  '}\n';
const CONTACTS_INFO = appinfo('Contacts', 'Contacts');

/**
 * An exec whose describe-all answers in turn from `reads` (the last repeats),
 * and whose `simctl appinfo` answers `info` (an Error rejects). Every command
 * line is recorded.
 */
function device(reads: string[], info: string | Error = CONTACTS_INFO, took: { readMs?: number; appinfoMs?: number } = {}) {
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
      return out(info);
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

beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // the accessibility-write announcement
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('appInfoNames — the names an app\'s Application may carry, from `simctl appinfo`', () => {
  it('CFBundleDisplayName then CFBundleName, quoted or bare; a repeat is listed once', () => {
    expect(appInfoNames(appinfo('"Skeleton Internal"', 'Skeleton'))).toEqual(['Skeleton Internal', 'Skeleton']);
    expect(appInfoNames(CONTACTS_INFO)).toEqual(['Contacts']);
  });

  it('without a display name, the bundle name alone', () => {
    expect(appInfoNames(appinfo(undefined, 'Runner'))).toEqual(['Runner']);
  });

  it('decodes the plist escapes inside quotes — \\U for non-ASCII, \\" and \\\\', () => {
    expect(appInfoNames(appinfo('"Caf\\U00e9 \\"Bar\\" \\\\ 1"', 'Cafe'))).toEqual(['Café "Bar" \\ 1', 'Cafe']);
  });

  it('an output with neither key — not installed, or not a plist at all — is no names', () => {
    expect(appInfoNames('')).toEqual([]);
    expect(appInfoNames('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2)')).toEqual([]);
  });

  it("only TOP-LEVEL keys count: a nested dictionary's CFBundleName (an extension's) is not the app's, before or after", () => {
    const nested =
      '{\n' +
      '    Extensions =     {\n        "com.app.widget" =         {\n            CFBundleName = WidgetExt;\n            CFBundleDisplayName = "Widget; Ext";\n        };\n    };\n' +
      '    Path = "/x/{y;z";\n' + // a brace and a `;` inside a string are text
      '    CFBundleName = Skeleton;\n' +
      '}\n';
    expect(appInfoNames(nested)).toEqual(['Skeleton']);
  });

  it('a key is matched whole: CFBundleNameSuffix-like keys are not CFBundleName', () => {
    expect(appInfoNames('{\n    CFBundleNameSomething = Wrong;\n    CFBundleName = Right;\n}\n')).toEqual(['Right']);
  });
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

  it('never in front: reads until the bound and no longer, then goes on with a note naming the label read and both readings of it', async () => {
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
        '(an absent check passes on it). Compare with screenshot. If the screenshot shows com.apple.MobileAddressBook, its ' +
        "on-screen name differs from its Info.plist name (a localized display name) and this can be ignored; otherwise read " +
        'again before trusting what the tree says',
    );
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
    expect(outcome.note).toMatch(/Compare with screenshot\. Read again before trusting what the tree says$/);
  });

  it('empty for the whole bound: a note that nothing was checked', async () => {
    const outcome = await device([EMPTY]).adapter.launch('com.apple.MobileAddressBook');
    expect(outcome.note).toBe(
      "idb's tree stayed empty for the 3 s averi waited after launching com.apple.MobileAddressBook, so which app is in " +
        'front was not checked — compare with screenshot before trusting a read',
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
      'could not check that com.app is in front (idb: connection refused) — for a moment after a launch iOS can hand ' +
        "idb the previous app's tree; compare with screenshot before trusting a read",
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

  it('appinfo lists neither name (a format drift reads the same): a note saying so, not a silent pass — and not cached either', async () => {
    const d = device([BANK], '');
    expect((await d.adapter.launch('com.apple.MobileAddressBook')).note).toBe(
      'could not check that com.apple.MobileAddressBook is in front (simctl appinfo listed neither CFBundleDisplayName nor ' +
        "CFBundleName) — for a moment after a launch iOS can hand idb the previous app's tree; compare with screenshot " +
        'before trusting a read',
    );
    expect(d.describeAlls()).toBe(1);
    await d.adapter.launch('com.apple.MobileAddressBook');
    expect(d.appinfos()).toHaveLength(2);
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
          "was none, for the 3 s averi waited) — for a moment after a launch iOS can hand idb the previous app's tree; " +
          'compare with screenshot before trusting a read',
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

  it('a WDA-source adapter: no read, no appinfo, no note — the source does not ask, by decision', async () => {
    const reads: string[] = [];
    const wda: IosTreeSource = {
      kind: 'wda',
      read: () => Promise.reject(new Error('unused')),
      applicationLabel: async () => {
        reads.push('label');
        return { kind: 'declined' };
      },
      dispose: () => Promise.resolve(),
    };
    const calls: string[] = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    expect(await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: wda }).launch('com.app')).toEqual({});
    expect(calls.filter((c) => c.includes('appinfo') || c.startsWith('idb'))).toEqual([]);
  });

  it('a deep link does not wait — it may legitimately bring another app forward', async () => {
    const d = device([BANK]);
    await d.adapter.openDeepLink('contacts://new');
    expect(d.describeAlls()).toBe(0);
    expect(d.appinfos()).toEqual([]);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChooserPremise } from '../../scripts/truth/chooser-premise.js';
import { ACTIVITIES_COMMAND, AndroidLab, FOCUS_WINDOW_COMMAND, HOME_COMMAND, type Exec } from '../../scripts/truth/lab-device.js';

// scripts/truth/chooser-premise.ts#readChooserPremise (T20a): the chooser group's premise, read once before its cases
// through an AndroidLab over a fake adb — the API 33 reads batch-10 kept (tests/fixtures/batch) and T7b's review round 1
// recorded (docs/truth/live-records/t7b-chooser/review1-run-1.json: the launcher in front, its HOME read).

const BATCH = join(import.meta.dirname, '..', 'fixtures', 'batch');
const fixture = (name: string): string => readFileSync(join(BATCH, name), 'utf8');
const BLOCK = fixture('dumpsys-package-preferred-api33-b10.txt');
const SHARED = fixture('query-activities-api33-b10-shared.txt');
const SERIAL = 'emulator-5554';
const LAUNCHER = 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity';
/** T7b review round 1's launcher read, lc4' before its calls. */
const LAUNCHER_WINDOW = `  mCurrentFocus=Window{651fa6b u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}\n  mFocusedApp=ActivityRecord{95524f u0 ${LAUNCHER}} t4862}\n`;
const LAUNCHER_STACK = `      * Hist  #0: ActivityRecord{95524f u0 ${LAUNCHER}} t4862}\n`;
const HOME = `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${LAUNCHER}\n`;

/** What each read answers: its stdout, or an Error adb would throw. */
interface Answers {
  preferred: string | Error;
  handlers: string | Error;
  window: string | Error;
  activities: string | Error;
  home: string | Error;
}
const FRESH: Answers = { preferred: BLOCK, handlers: SHARED, window: LAUNCHER_WINDOW, activities: LAUNCHER_STACK, home: HOME };

/** The lab AVD over a fake adb: the guard's name, then the premise's reads; every call kept. */
function fakeLab(answers: Partial<Answers> = {}) {
  const a = { ...FRESH, ...answers };
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    calls.push(args);
    const [, serial, ...words] = args;
    if (file !== 'adb' || serial !== SERIAL) throw new Error(`unexpected ${file} ${args.join(' ')}`);
    const said = words.join(' ');
    const answer =
      said === 'emu avd name' ? 'averi_lab\nOK\n'
      : said === 'shell dumpsys package preferred' ? a.preferred
      : said === 'shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://shared/open' ? a.handlers
      : said === `shell ${FOCUS_WINDOW_COMMAND}` ? a.window
      : said === `shell ${ACTIVITIES_COMMAND}` ? a.activities
      : said === `shell ${HOME_COMMAND}` ? a.home
      : new Error(`unexpected adb ${said}`);
    if (answer instanceof Error) throw answer;
    return { stdout: answer };
  };
  return { lab: new AndroidLab(SERIAL, { exec }), calls };
}
const chooser = [{ group: 'chooser' }];

describe('readChooserPremise: which runs read it', () => {
  it('no Android lab, or no chooser case among the cases selected: none, and nothing asked', async () => {
    const { lab, calls } = fakeLab();
    expect(await readChooserPremise(undefined, chooser)).toBeUndefined();
    expect(await readChooserPremise(lab, [{ group: 'forms' }, { group: 'carousel' }])).toBeUndefined();
    expect(await readChooserPremise(lab, [])).toBeUndefined();
    expect(calls).toEqual([]);
    const notes: string[] = [];
    expect(await readChooserPremise(undefined, chooser, { note: (l) => void notes.push(l) })).toBeUndefined();
    expect(notes).toEqual([]);
    expect(await readChooserPremise(lab, [{ group: 'forms' }, { group: 'chooser' }], { note: (l) => void notes.push(l) })).toBeDefined();
    expect(notes).toEqual(['chooser premise: reading it before the cases']);
  });
});

describe('readChooserPremise: a fresh premise', () => {
  it('no lab default, two handlers, no chooser on the stack, the launcher as HOME: fresh, one line naming each', async () => {
    const { lab } = fakeLab();
    const premise = (await readChooserPremise(lab, chooser))!;
    expect(premise.state).toBe('fresh');
    expect(premise.facts.map((f) => [f.fact, f.state])).toEqual([['default', 'fresh'], ['handlers', 'fresh'], ['stack', 'fresh'], ['home', 'fresh']]);
    expect(premise.lines).toEqual([
      `Chooser premise: fresh — no lab default (mAlways=true) for dev.averi.lab; 2 handlers for averilab://shared/open; no chooser on the stack; HOME ${LAUNCHER}`,
    ]);
  });
});

/** A lab entry under the block's `Schemes:`, in the dump's shape (lab-chooser.test.ts's labEntry, shortened). */
const entry = (flag: 'true' | 'false' | 'none', component = 'dev.averi.lab/.Twin'): string =>
  ['      averilab:', `        9d3a2b9 ${component}`, `         mMatch=0x300000${flag === 'none' ? '' : ` mAlways=${flag}`}`, '          Scheme: "averilab"', '          Authority: "shared": -1'].join('\n');
const withEntries = (...entries: string[]): string => BLOCK.replace('  Schemes:\n', `  Schemes:\n${entries.join('\n')}\n`);
const RERUN = 'node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups chooser';
const APK = 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk';
const FRESH_WHYS = ['no lab default (mAlways=true) for dev.averi.lab', '2 handlers for averilab://shared/open', 'no chooser on the stack', `HOME ${LAUNCHER}`];
/** The fresh whys with `at` replaced. */
const whys = (at: Record<number, string>): string => FRESH_WHYS.map((w, i) => at[i] ?? w).join('; ');
const premiseOf = async (answers: Partial<Answers>) => (await readChooserPremise(fakeLab(answers).lab, chooser))!;

describe('readChooserPremise: a stale premise — the run fails, and the owner\'s hand line', () => {
  it('a lab default (mAlways=true): stale, the default named, and the hand line that clears it (chooser-premise.ts#defaultHand, as the batches clear it)', async () => {
    const premise = await premiseOf({ preferred: withEntries(entry('true')) });
    expect(premise.state).toBe('stale');
    expect(premise.facts.map((f) => [f.fact, f.state])).toEqual([['default', 'stale'], ['handlers', 'fresh'], ['stack', 'fresh'], ['home', 'fresh']]);
    expect(premise.lines).toEqual([
      `CHOOSER PREMISE: stale — ${whys({ 0: '1 lab default (mAlways=true) for dev.averi.lab, first: 9d3a2b9 dev.averi.lab/.Twin | mMatch=0x300000 mAlways=true | Scheme: "averilab" | Authority: "shared": -1' })} — the run fails`,
      `D55 (Android): a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: adb -s emulator-5554 uninstall dev.averi.lab && adb -s emulator-5554 install ${APK} (clears it; wipes the lab's data); then: ${RERUN}`,
    ]);
  });

  it('two defaults: counted, the first quoted, cut at 200 characters', async () => {
    const long = entry('true', `dev.averi.lab/.${'A'.repeat(220)}`);
    const premise = await premiseOf({ preferred: withEntries(long, entry('true')) });
    const why = premise.facts[0].why;
    expect(why.startsWith(`2 lab defaults (mAlways=true) for dev.averi.lab, first: 9d3a2b9 dev.averi.lab/.${'A'.repeat(177)}…`)).toBe(true);
    expect(why).toHaveLength('2 lab defaults (mAlways=true) for dev.averi.lab, first: '.length + 201);
    // 200 characters exactly: whole, no `…`.
    const exact = (await premiseOf({ preferred: withEntries(entry('true', `dev.averi.lab/.${'B'.repeat(99)}`)) })).facts[0].why;
    expect(exact).toBe(`1 lab default (mAlways=true) for dev.averi.lab, first: 9d3a2b9 dev.averi.lab/.${'B'.repeat(99)} | mMatch=0x300000 mAlways=true | Scheme: "averilab" | Authority: "shared": -1`);
  });

  it('the shared link with one handler, or three: stale, and the hand line that lists them and puts the lab back', async () => {
    const one = await premiseOf({ handlers: '1 activity found:\n  Activity #0:\n    dev.averi.lab/.MainActivity\n' });
    expect(one.state).toBe('stale');
    expect(one.lines).toEqual([
      `CHOOSER PREMISE: stale — ${whys({ 1: '1 handler for averilab://shared/open, not 2' })} — the run fails`,
      `D55 (Android): averilab://shared/open has 1 handler, not the lab's 2 (.MainActivity and .Twin): adb -s emulator-5554 shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://shared/open lists them; another app among them: uninstall it; the lab's .Twin missing: adb -s emulator-5554 install -r ${APK}; then: ${RERUN}`,
    ]);
    const three = await premiseOf({ handlers: `${SHARED.replace('2 activities found:', '3 activities found:')}    dev.averi.lab.rn/.MainActivity\n` });
    expect(three.facts[1]).toEqual({ fact: 'handlers', state: 'stale', why: '3 handlers for averilab://shared/open, not 2' });
    expect(three.lines[1]).toContain('averilab://shared/open has 3 handlers, not');
    expect((await premiseOf({ handlers: 'No activities found\n' })).facts[1].why).toBe('0 handlers for averilab://shared/open, not 2');
  });

  it('a chooser on the stack: stale, the records named, and the hand line that drops it', async () => {
    const stack = `    * Hist  #0: ActivityRecord{1b799c2 u0 android/com.android.internal.app.ResolverActivity} t6282}\n${LAUNCHER_STACK}`;
    const premise = await premiseOf({ activities: stack });
    const two = await premiseOf({ activities: `    * Hist  #0: ActivityRecord{1c u0 com.android.intentresolver/.ChooserActivity} t6283}\n${stack}` });
    expect(two.facts[2].why).toBe('a chooser on the stack (com.android.intentresolver/.ChooserActivity, android/com.android.internal.app.ResolverActivity)');
    expect(premise.lines).toEqual([
      `CHOOSER PREMISE: stale — ${whys({ 2: 'a chooser on the stack (android/com.android.internal.app.ResolverActivity)' })} — the run fails`,
      `D55 (Android): a chooser on the stack before the cases: adb -s emulator-5554 shell input keyevent KEYCODE_BACK until adb -s emulator-5554 shell dumpsys activity activities lists no ResolverActivity or ChooserActivity record; then: ${RERUN}`,
    ]);
  });

  it("HOME resolving to the platform's chooser (two Home apps, none chosen) or to the lab: stale, and the hand line that chooses the launcher", async () => {
    const resolver = await premiseOf({ home: 'android/com.android.internal.app.ResolverActivity\n' });
    expect(resolver.lines).toEqual([
      `CHOOSER PREMISE: stale — ${whys({ 3: "HOME is android/com.android.internal.app.ResolverActivity, the platform's chooser, not a launcher" })} — the run fails`,
      `D55 (Android): HOME is not a launcher: choose the launcher as the Home app on the emulator (Settings, Apps, Default apps, Home app), then adb -s emulator-5554 shell cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN must name it; then: ${RERUN}`,
    ]);
    expect((await premiseOf({ home: 'dev.averi.lab/.MainActivity\n' })).facts[3]).toEqual({ fact: 'home', state: 'stale', why: 'HOME is dev.averi.lab/.MainActivity, the lab, not a launcher' });
    expect((await premiseOf({ home: 'dev.averi.lab.rn/.MainActivity\n' })).facts[3].state).toBe('fresh');
  });

  it('two stale facts: both named, a hand line each, in the facts\' order', async () => {
    const premise = await premiseOf({ home: 'android/com.android.internal.app.ResolverActivity\n', preferred: withEntries(entry('true')) });
    expect(premise.lines).toHaveLength(3);
    expect(premise.lines[1]).toMatch(/^D55 \(Android\): a lab default/);
    expect(premise.lines[2]).toMatch(/^D55 \(Android\): HOME is not a launcher/);
  });
});

describe('readChooserPremise: a last-chosen entry is a warning only', () => {
  it('mAlways=false: the premise fresh, and a WARN line under it', async () => {
    const premise = await premiseOf({ preferred: withEntries(entry('false')) });
    expect(premise.state).toBe('fresh');
    expect(premise.lines).toEqual([
      `Chooser premise: fresh — ${whys({})}`,
      'Chooser premise: WARN — 1 last-chosen lab entry (mAlways=false: no default; no reinstall clears it), first: 9d3a2b9 dev.averi.lab/.Twin | mMatch=0x300000 mAlways=false | Scheme: "averilab" | Authority: "shared": -1',
    ]);
    const two = await premiseOf({ preferred: withEntries(entry('false'), entry('false', 'dev.averi.lab/.MainActivity')) });
    expect(two.lines[1]).toMatch(/^Chooser premise: WARN — 2 last-chosen lab entries \(/);
  });

  it('beside a stale fact: the WARN after the hand lines', async () => {
    const premise = await premiseOf({ preferred: withEntries(entry('false'), entry('true', 'dev.averi.lab/.MainActivity')) });
    expect(premise.state).toBe('stale');
    expect(premise.lines.map((l) => l.slice(0, 30))).toEqual(['CHOOSER PREMISE: stale — 1 lab', 'D55 (Android): a lab default (', 'Chooser premise: WARN — 1 last']);
  });
});

describe('readChooserPremise: a read that fails or proves nothing — unread, never a throw', () => {
  it("each read failing, alone: its fact unread with adb's words, the others still read, the premise unread", async () => {
    const down = new Error("adb: device 'emulator-5554' not found");
    const preferred = await premiseOf({ preferred: down });
    expect(preferred.state).toBe('unread');
    expect(preferred.lines).toEqual([`Chooser premise: unread — ${whys({ 0: "the preferred activities unread (dumpsys package preferred: adb: device 'emulator-5554' not found)" })}`]);
    expect((await premiseOf({ handlers: down })).facts[1]).toEqual({ fact: 'handlers', state: 'unread', why: "the handlers of averilab://shared/open unread (query-activities: adb: device 'emulator-5554' not found)" });
    expect((await premiseOf({ window: down })).facts[2]).toEqual({ fact: 'stack', state: 'unread', why: "the stack unread (the focus read failed: adb: device 'emulator-5554' not found)" });
    expect((await premiseOf({ home: down })).facts[3]).toEqual({ fact: 'home', state: 'unread', why: "HOME unread (the HOME activity read failed: adb: device 'emulator-5554' not found)" });
  });

  it('every read failing: all four unread, one line, no hand line', async () => {
    const down = new Error('adb: no devices/emulators found');
    const premise = await premiseOf({ preferred: down, handlers: down, window: down, home: down });
    expect(premise.state).toBe('unread');
    expect(premise.facts.map((f) => f.state)).toEqual(['unread', 'unread', 'unread', 'unread']);
    expect(premise.lines).toHaveLength(1);
  });

  it('reads that answer but prove nothing: no Preferred Activities block, an entry with no mAlways line, no count line, no HOME component', async () => {
    expect((await premiseOf({ preferred: 'Database versions:\n' })).facts[0].why).toBe('the preferred activities unread (no `Preferred Activities User N:` block in the dump)');
    expect((await premiseOf({ preferred: withEntries(entry('none')) })).facts[0]).toEqual({
      fact: 'default',
      state: 'unread',
      why: 'the preferred activities not proven: 1 lab entry with no mAlways line, first: 9d3a2b9 dev.averi.lab/.Twin | mMatch=0x300000 | Scheme: "averilab" | Authority: "shared": -1',
    });
    expect((await premiseOf({ preferred: withEntries(entry('none'), entry('none')) })).facts[0].why).toMatch(/^the preferred activities not proven: 2 lab entries with/);
    expect((await premiseOf({ handlers: '  dev.averi.lab/.MainActivity  \nmore\n' })).facts[1]).toEqual({
      fact: 'handlers',
      state: 'unread',
      why: 'the handlers of averilab://shared/open unread (query-activities printed no `N activities found:` line: dev.averi.lab/.MainActivity)',
    });
    expect((await premiseOf({ home: 'No activity found\n' })).facts[3]).toEqual({ fact: 'home', state: 'unread', why: 'HOME unread (the HOME activity read names no component: No activity found)' });
  });

  it('a stale fact beside an unread one: stale, the unread one named in the same line', async () => {
    const premise = await premiseOf({ home: new Error('adb: closed'), handlers: 'No activities found\n' });
    expect(premise.state).toBe('stale');
    expect(premise.lines[0]).toBe(`CHOOSER PREMISE: stale — ${whys({ 1: '0 handlers for averilab://shared/open, not 2', 3: 'HOME unread (the HOME activity read failed: adb: closed)' })} — the run fails`);
    expect(premise.lines).toHaveLength(2);
  });
});

describe('readChooserPremise: read only', () => {
  it('the guard, then the four reads — no key, no start, no install, no setting', async () => {
    const { lab, calls } = fakeLab();
    await readChooserPremise(lab, chooser);
    expect(calls.map((c) => c.slice(2).join(' '))).toEqual([
      'emu avd name',
      'shell dumpsys package preferred',
      'shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://shared/open',
      `shell ${FOCUS_WINDOW_COMMAND}`,
      `shell ${ACTIVITIES_COMMAND}`,
      `shell ${HOME_COMMAND}`,
    ]);
  });
});

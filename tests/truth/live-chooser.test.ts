import { describe, expect, it } from 'vitest';
import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import type { FocusRead } from '../../scripts/truth/lab-device.js';
import { CHOOSER_CASES, chooserInFront, frontOf, homeOf, isChooser, type FocusReads } from '../../scripts/truth/live-chooser.js';
import type { LiveVerdict } from '../../scripts/truth/live-visibility.js';
import type { LabState } from '../../scripts/truth/schema.js';

/**
 * The chooser group's device reads and judges (scripts/truth/live-chooser.ts, T7b), over device text recorded on the lab
 * AVD (emulator-5554, averi_lab, API 33, 2026-11-09): each read is the two greps AndroidLab.focus runs, verbatim.
 */

/** The window manager's two focus lines (`dumpsys window displays | grep …`), naming `component`. */
const windowOf = (component: string, window = component.replace('/.', `/${component.split('/')[0]}.`)) =>
  `  mCurrentFocus=Window{c0532ac u0 ${window}}\n  mFocusedApp=ActivityRecord{895a020 u0 ${component}} t6235}\n`;
const hist = (component: string, task: number, indent = '    ') => `${indent}* Hist  #0: ActivityRecord{be9992f u0 ${component}} t${task}}\n`;

const LAUNCHER = 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity';
const MAIN = 'dev.averi.lab/.MainActivity';
const RESOLVER = 'android/com.android.internal.app.ResolverActivity';

/** Recorded: the launcher in front, the lab force-stopped (no record of it). */
const AT_LAUNCHER: FocusRead = { window: windowOf(LAUNCHER), activities: hist(LAUNCHER, 4862, '      ') };
/** Recorded: the lab's cell launched (`am start -W -n …/.MainActivity`), one record of it over the launcher's. */
const AT_LAB: FocusRead = { window: windowOf(MAIN), activities: hist(MAIN, 6235) + hist(LAUNCHER, 4862, '      ') };
/** Recorded: `am start -p dev.averi.lab -a VIEW -d averilab://shared/x` over the lab: the chooser in front, in a task of its own. */
/** Recorded (T7b's first run, lc4''): the window mid-transition, `mCurrentFocus=null`, `component` already mFocusedApp. */
const UNSETTLED = (component: string) => `  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{d0a6cbc u0 ${component}} t6245}\n`;
const AT_CHOOSER: FocusRead = { window: windowOf(RESOLVER, RESOLVER), activities: hist(RESOLVER, 6236) + hist(MAIN, 6235) + hist(LAUNCHER, 4862, '      ') };

describe('frontOf: what one read says is in front, and on the stack', () => {
  it('the focused activity and every record, top first, as the device prints them', () => {
    expect(frontOf(AT_CHOOSER)).toEqual({ focusedFirst: RESOLVER, focusedSettled: RESOLVER, settle: 'settled', records: [RESOLVER, MAIN, LAUNCHER] });
    expect(frontOf(AT_LAB)).toEqual({ focusedFirst: MAIN, focusedSettled: MAIN, settle: 'settled', records: [MAIN, LAUNCHER] });
    expect(frontOf(AT_LAUNCHER)).toEqual({ focusedFirst: LAUNCHER, focusedSettled: LAUNCHER, settle: 'settled', records: [LAUNCHER] });
  });

  it('a read that waited: `focusedFirst` is the first window read\'s (what the device showed when averi replied), `focusedSettled` the settled one\'s', () => {
    expect(frontOf({ ...AT_LAB, settle: { firstWindow: UNSETTLED(LAUNCHER), waitedMs: 300 } })).toEqual({ focusedFirst: LAUNCHER, focusedSettled: MAIN, settle: 'settled', records: [MAIN, LAUNCHER] });
    expect(frontOf({ ...AT_LAB, settle: { firstWindow: '  mCurrentFocus=null\n', waitedMs: 300 } })).toEqual({ why: 'the first focus read holds no mFocusedApp line' });
  });

  it("review round 1's records kept `waitedMs` and `firstWindow` at the read's top: read the same", () => {
    const legacy = { ...AT_LAB, firstWindow: UNSETTLED(LAUNCHER), waitedMs: 300 } as FocusRead;
    expect(frontOf(legacy)).toEqual({ focusedFirst: LAUNCHER, focusedSettled: MAIN, settle: 'settled', records: [MAIN, LAUNCHER] });
    expect(frontOf({ window: UNSETTLED(MAIN), activities: hist(MAIN, 1), waitedMs: 5_000 } as FocusRead)).toMatchObject({ focusedFirst: MAIN, settle: 'ran-out' });
  });

  it('a window still mid-transition (`mCurrentFocus=null`): the wait ran out, or none was taken (an old record)', () => {
    expect(frontOf({ window: UNSETTLED(MAIN), activities: hist(MAIN, 1) })).toEqual({ focusedFirst: MAIN, focusedSettled: MAIN, settle: 'not-waited', records: [MAIN] });
    expect(frontOf({ window: UNSETTLED(MAIN), activities: hist(MAIN, 1), settle: { firstWindow: UNSETTLED(MAIN), waitedMs: 5_000 } })).toMatchObject({ settle: 'ran-out' });
  });

  it("API 36's shape, the task after a space: the component ends there", () => {
    expect(frontOf({ window: `  mFocusedApp=ActivityRecord{1 u0 ${LAUNCHER} t2}\n`, activities: `  * Hist  #0: ActivityRecord{1 u0 ${LAUNCHER} t2}\n` })).toEqual({ focusedFirst: LAUNCHER, focusedSettled: LAUNCHER, settle: 'settled', records: [LAUNCHER] });
  });

  it('a read that failed, or one with no mFocusedApp line, is unread with why — never "nothing in front"', () => {
    expect(frontOf({ error: 'adb: device offline' })).toEqual({ why: 'the focus read failed: adb: device offline' });
    expect(frontOf({ window: '  mCurrentFocus=null\n', activities: hist(MAIN, 1) })).toEqual({ why: 'the focus read holds no mFocusedApp line' });
    expect(frontOf({ window: '  mFocusedApp=null\n', activities: hist(MAIN, 1) })).toEqual({ why: 'the focus read holds no mFocusedApp line' });
    expect(frontOf({ window: windowOf(MAIN), activities: '' })).toEqual({ why: 'the activities read lists no record' });
  });

  it('isChooser: the platform\'s resolver or chooser, by package and class; never an app\'s activity of that name', () => {
    expect(isChooser(RESOLVER)).toBe(true);
    expect(isChooser('android/com.android.internal.app.ChooserActivity')).toBe(true);
    expect(isChooser('com.android.intentresolver/.ChooserActivity')).toBe(true);
    expect(isChooser('android/.ResolverActivity')).toBe(true);
    expect(isChooser('dev.averi.lab/.ResolverActivity')).toBe(false);
    expect(isChooser('android/com.android.internal.app.ResolverActivityX')).toBe(false);
    expect(isChooser('android/com.android.internal.app.NotResolverActivity')).toBe(false);
    expect(isChooser(MAIN)).toBe(false);
    expect(isChooser(undefined)).toBe(false);
  });

  it('chooserInFront: the chooser the settled read has focused, else none (an unread read, a record below, a chooser only in the first read)', () => {
    expect(chooserInFront(AT_CHOOSER)).toBe(RESOLVER);
    expect(chooserInFront(AT_LAB)).toBeUndefined();
    expect(chooserInFront({ window: windowOf(MAIN), activities: hist(MAIN, 1) + hist(RESOLVER, 2) })).toBeUndefined();
    expect(chooserInFront({ ...AT_LAB, settle: { firstWindow: UNSETTLED(RESOLVER), waitedMs: 300 } })).toBeUndefined();
    expect(chooserInFront({ error: 'offline' })).toBeUndefined();
  });

  it('homeOf: the HOME activity `cmd package resolve-activity --brief` names on its last line (recorded), else unread with why', () => {
    expect(homeOf({ resolved: `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${LAUNCHER}\n` })).toBe(LAUNCHER);
    expect(homeOf({ error: 'offline' })).toEqual({ why: 'the HOME activity read failed: offline' });
    expect(homeOf({ resolved: 'No activity found\n' })).toEqual({ why: 'the HOME activity read names no component: No activity found' });
  });
});

// --- the judges, each over recorded reads: what passes, and the regression each one is there to catch ---

const state = (cell: string): LabState => ({ cell, ready: true, screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, frames: {}, events: [] });
const LAUNCHED = state('form-basic');
const chooser: AppHolder = { holder: 'chooser', chooser: { component: RESOLVER } };
/** launch_app's reply as src words it (mcp/tool-text.ts#launchText): `app` as launched, its note the holder's. */
const launched = (app: string, answer: AppHolder = { holder: 'none' }) => launchText('android', { app, note: appHolderText({ app: app.split('/')[0] }, answer) });
const linked = (url: string, answer: AppHolder) => deepLinkText('android', url, answer);
const REFUSED = 'ERROR monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed … ** SYS_KEYS has no physical keys but with factor 2.0%.';

const RAN_OUT: LiveVerdict = { outcome: 'SKIP', why: 'the read after the calls did not settle in the 5 s wait (mCurrentFocus=null), and lists no chooser: whether one is left is unread' };
const NOT_WAITED: LiveVerdict = { outcome: 'SKIP', why: 'the read after the calls was not waited (an old record) and is mid-transition (mCurrentFocus=null): whether a chooser is left on the stack is unread' };
/** The wait ran out on `window`, the stack `activities`. */
const ranOut = (window: string, activities: string): FocusRead => ({ window, activities, settle: { firstWindow: window, waitedMs: 5_000 } });
const HOME = { resolved: `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${LAUNCHER}\n` };
const caseOf = (id: string) => CHOOSER_CASES.find((c) => c.id === id)!;
const judge = (id: string, replies: string[], focus: Partial<FocusReads>, s: LabState = LAUNCHED): LiveVerdict =>
  caseOf(id).judge(s, replies, 'uiautomator', LAUNCHED, [], { focus: { before: AT_LAB, between: [], after: AT_LAB, ...focus } });

describe('the chooser group: five cases, each declaring its reads', () => {
  it('lc1, lc2, lc3, lc4\', lc4\'\'; every one reads the focus, no late read, and a SKIP fails the run', () => {
    expect(CHOOSER_CASES.map((c) => c.id)).toEqual(['lc1', 'lc2', 'lc3', "lc4'", "lc4''"]);
    for (const c of CHOOSER_CASES) expect([c.id, c.reads, c.skipFails, c.platforms]).toEqual([c.id, { focus: true, late: false }, true, ['android']]);
    expect(CHOOSER_CASES.filter((c) => c.fromLauncher === true).map((c) => c.id)).toEqual(["lc4'", "lc4''"]);
  });

  it('the calls: the -p start, the one-handler link, the named twin, monkey, and monkey over the link\'s chooser', () => {
    expect(CHOOSER_CASES.map((c) => c.calls)).toEqual([
      [{ tool: 'launch_app', args: { appId: 'dev.averi.lab', intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' } } }],
      [{ tool: 'launch_app', args: { appId: 'dev.averi.lab', intent: { action: 'android.intent.action.VIEW', data: 'averilab://cell/form-prefilled' } } }],
      [{ tool: 'launch_app', args: { appId: 'dev.averi.lab', activity: '.Twin', intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' } } }],
      [{ tool: 'launch_app', args: { appId: 'dev.averi.lab' } }],
      [{ tool: 'open_deep_link', args: { url: 'averilab://shared/open' } }, { tool: 'launch_app', args: { appId: 'dev.averi.lab' } }],
    ]);
  });

  it('a focus read unread is the case\'s SKIP, with why', () => {
    for (const c of CHOOSER_CASES) {
      expect(c.judge(LAUNCHED, ['x', 'y'], 'uiautomator', LAUNCHED, [], { focus: { before: { error: 'offline' }, between: [AT_LAB], after: AT_LAB } })).toEqual({ outcome: 'SKIP', why: 'before the calls: the focus read failed: offline' });
      expect(c.judge(LAUNCHED, ['x', 'y'], 'uiautomator', LAUNCHED, [], {})).toEqual({ outcome: 'SKIP', why: 'no focus read recorded' });
    }
  });
});

describe('lc1: launch_app with a -p intent two activities answer names the chooser in front', () => {
  it('ok: the chooser in front, and the reply names it under Launched', () => {
    expect(judge('lc1', [launched('dev.averi.lab', chooser)], { after: AT_CHOOSER })).toMatchObject({ outcome: 'ok' });
  });

  it('MISMATCH: a bare Launched with the chooser in front (D55b undone)', () => {
    expect(judge('lc1', [launched('dev.averi.lab')], { after: AT_CHOOSER })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" and names no chooser — ${RESOLVER} is in front` });
  });

  it('MISMATCH: the chooser named with the lab in front', () => {
    expect(judge('lc1', [launched('dev.averi.lab', chooser)], { after: AT_LAB })).toMatchObject({ outcome: 'MISMATCH', why: `averi names the chooser (${RESOLVER}) — ${MAIN} is in front` });
  });

  it("MISMATCH: a headline that names another app than the lab, in its own words", () => {
    const other = `Launched com.other on android\n⚠ ${appHolderText({ app: 'com.other' }, chooser)}`;
    expect(judge('lc1', [other], { after: AT_CHOOSER })).toEqual({ outcome: 'MISMATCH', why: 'averi\'s headline names com.other, not dev.averi.lab: "Launched com.other on android"' });
  });

  it('MISMATCH: another component named than the one in front', () => {
    expect(judge('lc1', [linked('averilab://shared/x', chooser)], { after: AT_CHOOSER }).outcome).toBe('MISMATCH');
    const other: AppHolder = { holder: 'chooser', chooser: { component: 'android/com.android.internal.app.ChooserActivity' } };
    expect(judge('lc1', [launched('dev.averi.lab', other)], { after: AT_CHOOSER }).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: an error with the chooser the start raised in front; LOUD with nothing raised', () => {
    expect(judge('lc1', ['ERROR Android started nothing'], { after: AT_CHOOSER }).outcome).toBe('MISMATCH');
    expect(judge('lc1', ['ERROR Android started nothing'], { after: AT_LAB }).outcome).toBe('LOUD');
  });

  it('SKIP: no chooser raised and none named (a preferred activity?), or one already up before the calls', () => {
    expect(judge('lc1', [launched('dev.averi.lab')], { after: AT_LAB })).toMatchObject({ outcome: 'SKIP' });
    expect(judge('lc1', [launched('dev.averi.lab', chooser)], { before: AT_CHOOSER, after: AT_CHOOSER })).toEqual({ outcome: 'SKIP', why: `a chooser was on the stack before the calls (${RESOLVER})` });
  });
});

describe('lc2: launch_app with a one-handler intent opens the cell, no note', () => {
  const opened = state('form-prefilled');
  it('ok: Launched with no ⚠, the lab in front, the app showing the link\'s cell', () => {
    expect(judge('lc2', [launched('dev.averi.lab')], { after: AT_LAB }, opened)).toMatchObject({ outcome: 'ok' });
  });

  it('MISMATCH: a ⚠ chooser note with the lab in front', () => {
    expect(judge('lc2', [launched('dev.averi.lab', chooser)], { after: AT_LAB }, opened).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: Launched, but the app still shows the launch\'s cell (the intent never reached it)', () => {
    expect(judge('lc2', [launched('dev.averi.lab')], { after: AT_LAB })).toEqual({ outcome: 'MISMATCH', why: 'averi says "Launched dev.averi.lab on android" — the app shows cell form-basic, not form-prefilled' });
  });

  it('MISMATCH: Launched with another activity in front', () => {
    expect(judge('lc2', [launched('dev.averi.lab')], { after: AT_LAUNCHER }, opened).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: an error with the cell open; LOUD with it not', () => {
    expect(judge('lc2', ['ERROR x'], { after: AT_LAB }, opened).outcome).toBe('MISMATCH');
    expect(judge('lc2', ['ERROR x'], { after: AT_LAB }).outcome).toBe('LOUD');
  });

  it('SKIP: a chooser for a one-handler link is the device\'s, not averi\'s', () => {
    expect(judge('lc2', [launched('dev.averi.lab', chooser)], { after: AT_CHOOSER }, opened).outcome).toBe('SKIP');
  });
});

describe('lc3: launch_app naming .Twin with the same intent: no chooser, no note, one start', () => {
  it('ok: Launched dev.averi.lab/.Twin, no ⚠, the lab in front, no chooser record, no second record', () => {
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: AT_LAB })).toMatchObject({ outcome: 'ok' });
  });

  it('MISMATCH: a chooser on the stack (the activity dropped, a -p start)', () => {
    const under: FocusRead = { window: windowOf(MAIN), activities: hist(MAIN, 6235) + hist(RESOLVER, 6236) + hist(LAUNCHER, 4862) };
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: under })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab/.Twin on android" — a chooser is on the stack (${RESOLVER}): .Twin was not started by name` });
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: AT_CHOOSER }).outcome).toBe('MISMATCH');
    expect(judge('lc3', [launched('dev.averi.lab', chooser)], { after: AT_CHOOSER }).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: the reply does not name .Twin, or carries a ⚠ line', () => {
    expect(judge('lc3', [launched('dev.averi.lab')], { after: AT_LAB }).outcome).toBe('MISMATCH');
    expect(judge('lc3', [launched('dev.averi.lab/.Twin', chooser)], { after: AT_LAB }).outcome).toBe('MISMATCH');
  });

  it('the read after the call unsettled: SKIP with no chooser listed (ran out, or not waited); MISMATCH with one still listed after the 5 s wait', () => {
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: ranOut(UNSETTLED(MAIN), hist(MAIN, 1)) })).toEqual(RAN_OUT);
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: { window: UNSETTLED(MAIN), activities: hist(MAIN, 1) + hist(RESOLVER, 2) } })).toEqual(NOT_WAITED);
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: ranOut(UNSETTLED(MAIN), hist(MAIN, 1) + hist(RESOLVER, 2)) })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab/.Twin on android" — a chooser is still on the stack after the 5 s wait (${RESOLVER}), well past the ~1.3 s measured` });
  });

  it('an error reply is judged before the settle: MISMATCH with the lab in front and no chooser, an unsettled read or not', () => {
    expect(judge('lc3', ['ERROR x'], { after: ranOut(UNSETTLED(MAIN), hist(MAIN, 1)) }).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: two starts — two more records of the lab than before', () => {
    const twice: FocusRead = { window: windowOf(MAIN), activities: hist(MAIN, 6235) + hist(MAIN, 6235) + hist(MAIN, 6235) + hist(LAUNCHER, 4862) };
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: twice })).toEqual({ outcome: 'MISMATCH', why: 'averi says "Launched dev.averi.lab/.Twin on android" — the lab has 3 activity records, 1 before the call: more than one start' });
    const once: FocusRead = { window: windowOf(MAIN), activities: hist(MAIN, 6235) + hist(MAIN, 6235) + hist(LAUNCHER, 4862) };
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: once }).outcome).toBe('ok');
  });

  it('MISMATCH: Launched with the launcher in front; MISMATCH: an error with the lab in front', () => {
    expect(judge('lc3', [launched('dev.averi.lab/.Twin')], { after: AT_LAUNCHER }).outcome).toBe('MISMATCH');
    expect(judge('lc3', ['ERROR x'], { after: AT_LAB }).outcome).toBe('MISMATCH');
    expect(judge('lc3', ['ERROR x'], { after: AT_LAUNCHER }).outcome).toBe('LOUD');
  });
});

describe("lc4': launch_app with no activity, from the launcher (monkey): Launched, the app in front", () => {
  const fromLauncher = { before: AT_LAUNCHER, home: HOME };
  it('ok: a bare Launched, the lab\'s .MainActivity focused, no chooser', () => {
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: AT_LAB }, state(''))).toMatchObject({ outcome: 'ok' });
  });

  it("MISMATCH: monkey's refusal (D73 undone: no --pct-syskeys 0)", () => {
    expect(judge("lc4'", [REFUSED], { ...fromLauncher, after: AT_LAUNCHER })).toEqual({ outcome: 'MISMATCH', why: `averi refused the launch (${REFUSED.slice(0, 80)}…) — monkey can start the app from the launcher on this AVD (D73); ${LAUNCHER} is in front` });
  });

  it('MISMATCH: Launched with the launcher still in front, or with a ⚠ line', () => {
    const twin: FocusRead = { window: windowOf('dev.averi.lab/.Twin'), activities: hist('dev.averi.lab/.Twin', 1) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: twin })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" — dev.averi.lab/.Twin was mFocusedApp at the first read after it, not ${MAIN}` });
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: AT_LAUNCHER }).outcome).toBe('MISMATCH');
    expect(judge("lc4'", [launched('dev.averi.lab', chooser)], { ...fromLauncher, after: AT_LAB }).outcome).toBe('MISMATCH');
  });

  it('mFocusedApp is judged on the first read (when averi replied), the stack on the settled one', () => {
    const late = { ...AT_LAB, settle: { firstWindow: UNSETTLED(LAUNCHER), waitedMs: 300 } };
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: late })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" — ${LAUNCHER} was mFocusedApp at the first read after it, not ${MAIN}` });
    const settledLater = { ...AT_LAB, settle: { firstWindow: UNSETTLED(MAIN), waitedMs: 300 } };
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: settledLater }, state('')).outcome).toBe('ok');
    const notWaited = { window: UNSETTLED(MAIN), activities: hist(MAIN, 1) + hist(RESOLVER, 2) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: notWaited })).toEqual(NOT_WAITED);
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: ranOut(UNSETTLED(MAIN), hist(MAIN, 1)) })).toEqual(RAN_OUT);
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: ranOut(UNSETTLED(MAIN), hist(MAIN, 1) + hist(RESOLVER, 2)) })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" — a chooser is still on the stack after the 5 s wait (${RESOLVER}), well past the ~1.3 s measured` });
  });

  it('SKIP: not the HOME activity in front before the calls (the lab, another app), or the HOME activity unread', () => {
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: AT_LAB, home: HOME, after: AT_LAB })).toEqual({ outcome: 'SKIP', why: `not started from the launcher: ${MAIN} was in front before the calls, not the HOME activity ${LAUNCHER}` });
    const settings: FocusRead = { window: windowOf('com.android.settings/.Settings'), activities: hist('com.android.settings/.Settings', 3) + hist(LAUNCHER, 4862) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: settings, home: HOME, after: AT_LAB }).outcome).toBe('SKIP');
    const expanded = { resolved: 'x\ncom.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity\n' };
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: AT_LAUNCHER, home: expanded, after: AT_LAB }, state('')).outcome).toBe('ok');
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: AT_LAUNCHER, home: { error: 'offline' }, after: AT_LAB })).toEqual({ outcome: 'SKIP', why: 'the HOME activity read failed: offline' });
  });

  it('a record with no HOME read (before the review): at least not the platform in front, and no lab or chooser record', () => {
    const settings: FocusRead = { window: windowOf('com.android.settings/.Settings'), activities: hist('com.android.settings/.Settings', 3) + hist(LAUNCHER, 4862) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: settings, after: AT_LAB }, state('')).outcome).toBe('ok');
    const platform: FocusRead = { window: windowOf('android/.Something'), activities: hist(LAUNCHER, 4862) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: platform, after: AT_LAB })).toEqual({ outcome: 'SKIP', why: 'not started from the launcher: android/.Something was in front before the calls (no HOME activity read: a package of the platform\'s chooser)' });
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: AT_LAB, after: AT_LAB }).outcome).toBe('SKIP');
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: { window: windowOf(LAUNCHER), activities: hist(LAUNCHER, 1) + hist(MAIN, 2) }, after: AT_LAB }).outcome).toBe('SKIP');
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: { window: windowOf(LAUNCHER), activities: hist(LAUNCHER, 1) + hist(RESOLVER, 2) }, after: AT_LAB }).outcome).toBe('SKIP');
  });
});

describe("lc4'': open_deep_link's chooser, then launch_app with no activity: Launched, no ResolverActivity left", () => {
  const LINK = 'averilab://shared/open';
  const over = { before: AT_LAUNCHER, home: HOME, between: [AT_CHOOSER] };
  it('ok: the link names the chooser, the launch is a bare Launched, the lab focused, no chooser record left', () => {
    expect(judge("lc4''", [linked(LINK, chooser), launched('dev.averi.lab')], { ...over, after: AT_LAB }, state(''))).toMatchObject({ outcome: 'ok' });
  });

  it('MISMATCH: a ResolverActivity record left on the stack, though the lab is focused', () => {
    const left: FocusRead = { window: windowOf(MAIN), activities: hist(MAIN, 6237) + hist(RESOLVER, 6236) + hist(LAUNCHER, 4862) };
    expect(judge("lc4''", [linked(LINK, chooser), launched('dev.averi.lab')], { ...over, after: left })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" — a chooser is still on the stack (${RESOLVER})` });
  });

  it("MISMATCH: monkey's refusal under the chooser; Launched with the chooser still in front", () => {
    expect(judge("lc4''", [linked(LINK, chooser), REFUSED], { ...over, after: AT_CHOOSER }).outcome).toBe('MISMATCH');
    expect(judge("lc4''", [linked(LINK, chooser), launched('dev.averi.lab')], { ...over, after: AT_CHOOSER }).outcome).toBe('MISMATCH');
  });

  it('MISMATCH: the link said Opened with the chooser in front (D55 undone)', () => {
    const demoted = `Opened ${LINK} on android\n⚠ ${linked(LINK, chooser)}`;
    expect(judge("lc4''", [demoted, launched('dev.averi.lab')], { ...over, after: AT_LAB }).outcome).toBe('MISMATCH');
    expect(judge("lc4''", [linked(LINK, { holder: 'none' }), launched('dev.averi.lab')], { ...over, after: AT_LAB })).toEqual({ outcome: 'MISMATCH', why: `the link: averi says "Opened ${LINK} on android" — ${RESOLVER} was in front after it` });
  });

  it('SKIP: the link raised no chooser; or not started from the launcher', () => {
    expect(judge("lc4''", [linked(LINK, { holder: 'none' }), launched('dev.averi.lab')], { before: AT_LAUNCHER, between: [AT_LAB], after: AT_LAB }).outcome).toBe('SKIP');
    expect(judge("lc4''", [linked(LINK, chooser), launched('dev.averi.lab')], { before: AT_LAB, between: [AT_CHOOSER], after: AT_LAB }).outcome).toBe('SKIP');
  });
});

import { describe, expect, it } from 'vitest';
import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import { CHOOSER_CASES, frontOf, isChooser, type FocusRead, type FocusReads } from '../../scripts/truth/live-chooser.js';
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
const AT_CHOOSER: FocusRead = { window: windowOf(RESOLVER, RESOLVER), activities: hist(RESOLVER, 6236) + hist(MAIN, 6235) + hist(LAUNCHER, 4862, '      ') };

describe('frontOf: what one read says is in front, and on the stack', () => {
  it('the focused activity and every record, top first, as the device prints them', () => {
    expect(frontOf(AT_CHOOSER)).toEqual({ focused: RESOLVER, records: [RESOLVER, MAIN, LAUNCHER] });
    expect(frontOf(AT_LAB)).toEqual({ focused: MAIN, records: [MAIN, LAUNCHER] });
    expect(frontOf(AT_LAUNCHER)).toEqual({ focused: LAUNCHER, records: [LAUNCHER] });
  });

  it("API 36's shape, the task after a space: the component ends there", () => {
    expect(frontOf({ window: `  mFocusedApp=ActivityRecord{1 u0 ${LAUNCHER} t2}\n`, activities: `  * Hist  #0: ActivityRecord{1 u0 ${LAUNCHER} t2}\n` })).toEqual({ focused: LAUNCHER, records: [LAUNCHER] });
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
});

// --- the judges, each over recorded reads: what passes, and the regression each one is there to catch ---

const state = (cell: string): LabState => ({ cell, ready: true, screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, frames: {}, events: [] });
const LAUNCHED = state('form-basic');
const chooser: AppHolder = { holder: 'chooser', chooser: { component: RESOLVER } };
/** launch_app's reply as src words it (mcp/tool-text.ts#launchText): `app` as launched, its note the holder's. */
const launched = (app: string, answer: AppHolder = { holder: 'none' }) => launchText('android', { app, note: appHolderText({ app: app.split('/')[0] }, answer) });
const linked = (url: string, answer: AppHolder) => deepLinkText('android', url, answer);
const REFUSED = 'ERROR monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed … ** SYS_KEYS has no physical keys but with factor 2.0%.';

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
  const fromLauncher = { before: AT_LAUNCHER };
  it('ok: a bare Launched, the lab\'s .MainActivity focused, no chooser', () => {
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: AT_LAB }, state(''))).toMatchObject({ outcome: 'ok' });
  });

  it("MISMATCH: monkey's refusal (D73 undone: no --pct-syskeys 0)", () => {
    expect(judge("lc4'", [REFUSED], { ...fromLauncher, after: AT_LAUNCHER })).toEqual({ outcome: 'MISMATCH', why: `averi refused the launch (${REFUSED.slice(0, 80)}…) — monkey can start the app from the launcher on this AVD (D73); ${LAUNCHER} is in front` });
  });

  it('MISMATCH: Launched with the launcher still in front, or with a ⚠ line', () => {
    const twin: FocusRead = { window: windowOf('dev.averi.lab/.Twin'), activities: hist('dev.averi.lab/.Twin', 1) };
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: twin })).toEqual({ outcome: 'MISMATCH', why: `averi says "Launched dev.averi.lab on android" — dev.averi.lab/.Twin is in front, not ${MAIN}` });
    expect(judge("lc4'", [launched('dev.averi.lab')], { ...fromLauncher, after: AT_LAUNCHER }).outcome).toBe('MISMATCH');
    expect(judge("lc4'", [launched('dev.averi.lab', chooser)], { ...fromLauncher, after: AT_LAB }).outcome).toBe('MISMATCH');
  });

  it('SKIP: the lab in front before the calls, not the launcher', () => {
    expect(judge("lc4'", [launched('dev.averi.lab')], { before: AT_LAB, after: AT_LAB })).toEqual({ outcome: 'SKIP', why: `not started from the launcher: ${MAIN} was in front before the calls` });
  });
});

describe("lc4'': open_deep_link's chooser, then launch_app with no activity: Launched, no ResolverActivity left", () => {
  const LINK = 'averilab://shared/open';
  const over = { before: AT_LAUNCHER, between: [AT_CHOOSER] };
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

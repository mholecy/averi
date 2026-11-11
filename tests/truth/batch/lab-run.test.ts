import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { cleanState, LAB_RUN_STANDING, labRun, leftLine, stateHand } from '../../../scripts/truth/batch/lab-run.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { StartOptions } from '../../../scripts/truth/batch/proc.js';
import { groupsOf, onlyWith } from '../../../scripts/truth/batch/standing.js';
import { STANDING_EXIT as LAB_RUN_EXIT } from '../../../scripts/truth/batch/words.js';
import type { ChooserPremise } from '../../../scripts/truth/chooser-premise.js';
import type { Result as LiveResult } from '../../../scripts/truth/live-cases.js';
import { CATALOG, FakeSeam, FOCUS_CHOOSER, LAB_SERIAL, labWorld, PREFERRED_WITH_DEFAULT, until, type Answer, type LabWorld, type WorldOptions } from './lab-fakes.js';
import { hedgedLegs, liveResult, liveSummary, rejudgeAnswer } from './standing-fakes.js';

// The standing lab batch (T20b, scripts/truth/batch/lab-run.ts) under runBatch, over the shared fake lab
// (lab-fakes.ts) and a fake process seam that answers git and live.ts — its `--groups` run and its `--rejudge` —
// with real files in a temp dir, a fixed clock and pid — its summary live-cases.ts#summarize's own, over the results a
// test gives (standing-fakes.ts#rejudgeAnswer), its failure reasons written where `--failures` names. The blocks' order and the device calls' order; `--groups` as
// the selection; the refusals (no serial, a group that is none, a dirty state file) and the lab guard's; the --check
// before and after the chooser group, a default the run left failing the batch by name; the exit codes 0, 1, 2, 3, 130.
// Every call is checked for b11-dry's VIOLATIONs (afterEach). No device.

const HEAD = 'a'.repeat(40);
const ID = '20261111-101500-4242';
const clock = () => new Date(2026, 10, 11, 10, 15, 0);

/** The cases each group selects in the fake table. */
const GROUP_CASES: Record<string, string[]> = { chooser: ['lc1', 'lc2'], forms: ['f1'] };

/** What a fake live.ts run does: its exit and its rejudge's, and a change to the lab while it runs. */
interface LiveScript {
  code?: number;
  /** What its rejudge judged, case by case (each case of its group ok unless given). */
  rejudged?: LiveResult[];
  /** The chooser premise its record kept. */
  premise?: ChooserPremise;
  /** Its rejudge's answer as given, nothing summarized and no failure reasons written. */
  rejudgeRaw?: Answer;
  /** live.ts wrote no record and never judged (cut at its bound). */
  noRecord?: boolean;
  /** A line live.ts prints into its log before its summary. */
  logLine?: string;
  during?: (w: LabWorld) => void;
}

class RunSeam extends FakeSeam {
  /** The first `gradlew --stop` fails (exit 1): the daemon left to the run's last step. */
  stopFailsOnce = false;
  /** What each group's live.ts run does. */
  live: Record<string, LiveScript> = {};
  private readonly asked = new Map<string, string>();
  constructor(world: LabWorld) {
    super(world, HEAD);
  }
  protected answer(cmd: string, args: readonly string[], options: StartOptions): Answer | undefined {
    if (cmd === process.execPath && args.some((a) => a.endsWith('live.ts'))) {
      const at = (flag: string) => args[args.indexOf(flag) + 1];
      const group = at('--groups');
      const script = this.live[group] ?? {};
      if (args.includes('--rejudge')) return script.rejudgeRaw ?? rejudgeAnswer(args, 'android', script.rejudged ?? okResults(group), script.premise);
      this.asked.set(at('--record'), group);
      script.during?.(this.world);
      if (script.noRecord === true) return { code: script.code ?? 0, out: '', err: '' };
      writeFileSync(at('--record'), '{"results":[]}');
      return { code: script.code ?? 0, out: `${script.logLine === undefined ? '' : `${script.logLine}\n`}${liveSummary('android', okResults(group)).lines.join('\n')}\n`, err: '' };
    }
    if (cmd.endsWith('gradlew') && args.includes('--stop') && this.stopFailsOnce) {
      this.stopFailsOnce = false;
      return { code: 1, out: '', err: 'Could not stop the daemon' };
    }
    return this.world.answer(cmd, args, { cwd: options.cwd });
  }
}
/** Each case of a group, ok, as its run judged it. */
const okResults = (group: string): LiveResult[] => GROUP_CASES[group].map((id) => liveResult(id, 'uiautomator', undefined, group as 'chooser' | 'forms'));

const table: LiveTable = async () =>
  ({
    selectCases: async (s) => s.groups.flatMap((g) => GROUP_CASES[g] ?? []).filter((id) => s.only === undefined || s.only.includes(id)).map((id) => ({ id })),
    catalogOf: async () => ({ cells: [{ id: 'open' }] }),
  }) satisfies LiveCases;

let root: string;
let repo: string;
let out: string;
let seam: RunSeam;
let world: LabWorld;
const printed: string[] = [];
const noWait = async () => {};
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-lab-run-')));
  repo = join(root, 'repo');
  out = join(root, 'out');
  mkdirSync(join(repo, 'fixtures', 'apps', 'android'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir: root });
  seam = new RunSeam(world);
  printed.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});
const fresh = (o: Omit<WorldOptions, 'dir'>) => (seam.world = world = labWorld({ dir: root, ...o }));

const dirOf = (block: string) => join(out, block, `run-${ID}`);
const summary = () => readFileSync(join(dirOf('meta'), 'summary.txt'), 'utf8').split('\n').slice(0, -1);
const io = () => ({ fs: nodeFs, seam, terminal: (t: string) => void printed.push(t), clock, pid: 4242, table, graceMs: 5 });
const go = (argv: readonly string[] = [], env: Record<string, string> = {}): Promise<number> =>
  labRun({ argv: ['--out', out, '--repo', repo, '--serial', LAB_SERIAL, ...argv], env, io: io(), wait: noWait });
/** The live.ts calls, by their groups (`--rejudge` ones left out). */
const liveGroups = () => seam.words.filter((w) => w.includes('live.ts') && !w.includes('--rejudge')).map((w) => w.split(' ')[w.split(' ').indexOf('--groups') + 1]);
const outText = () => readFileSync(join(dirOf('meta'), 'lab-run.out'), 'utf8');
/** A dirty state file an earlier run of the chooser block left. */
const dirtyState = (): string => {
  const file = join(out, 'chooser', 'run-20261110-090000-1', 'state.json');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '{"dirty":true}');
  return file;
};
/** The index of the first call holding `text` at or after `from`. */
const callAt = (text: string, from = 0) => seam.words.findIndex((w, i) => i >= from && w.includes(text));

describe('lab-run.ts: a clean run, the blocks\' order and the lab block', () => {
  it('a clean run of both groups: every line in the blocks\' order, the checks around the chooser run, exit 0', async () => {
    expect(await go()).toBe(0);
    const s = summary();
    const apk = join(dirOf('lab'), 'installed.apk');
    expect(s.slice(0, 4)).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      `LAB android: OK — averi_lab emulator ${LAB_SERIAL}; this run's build installed under JDK 17: ${join(root, 'jdk17')} (from java_home); the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
      'LAB handlers: OK — handlers as expected: averilab://shared/open 2, averilab://cell/open 1',
    ]);
    const after = s.slice(4);
    expect(after[0]).toBe('lab check: PASS — every lab need met: android, handlers (each one\'s LAB line above)');
    expect(after[1]).toMatch(/^chooser check before: OK — chooser no; preferred read \(1 user\); lab entries 0 \(defaults 0, last-chosen 0\)$/);
    expect(after[2]).toMatch(/^chooser check after: OK — chooser no; preferred read \(1 user\); lab entries 0 /);
    expect(after[3]).toMatch(/^chooser verdict: PASS — android-chooser: main's rejudge exit 0 \(# Live golden: 2 cases, 2 ok, 0 loud, 0 mismatches \(0 not known\), 0 skipped\)$/);
    expect(after[4]).toMatch(/^forms verdict: PASS — android-forms: main's rejudge exit 0 \(# Live golden: 1 cases, 1 ok, 0 loud, 0 mismatches \(0 not known\), 0 skipped\)$/);
    expect(after[5]).toBe('RESTORE: none — everything dirty was put back and verified');
    // Built from this checkout, after the guard: the build's own call after the emulator's AVD was read.
    expect(callAt('assembleDebug')).toBeGreaterThan(callAt('emu avd name'));
    // The device's order: the --check before, the chooser group's run, the --check after; then the forms group.
    const before = callAt('dumpsys package preferred', callAt('query-activities'));
    const chooser = callAt('--groups chooser');
    const check = callAt('dumpsys package preferred', chooser);
    const forms = callAt('--groups forms');
    expect([before, chooser, check, forms].every((n) => n >= 0)).toBe(true);
    expect(before < chooser && chooser < check && check < forms).toBe(true);
    expect(liveGroups()).toEqual(['chooser', 'forms']);
    // The chooser's asked run: all of the group's cases on the lab emulator, its record under --out.
    expect(JSON.parse(readFileSync(join(dirOf('chooser'), 'android-chooser.cases'), 'utf8'))).toEqual({ platform: 'android', app: 'native', sources: ['uiautomator'], cases: [], groups: ['chooser'] });
    expect(seam.words.find((w) => w.includes('--groups chooser') && !w.includes('--rejudge'))).toBe(
      `node --import tsx ${join(repo, 'scripts/truth/live.ts')} --serial ${LAB_SERIAL} --groups chooser --record ${join(dirOf('chooser'), 'android-chooser.json')}`,
    );
    // Its state file clean: the next run is not refused.
    expect(JSON.parse(readFileSync(join(dirOf('chooser'), 'state.json'), 'utf8'))).toEqual({ dirty: false });
    expect(seam.exits).toEqual([]);
  });

  it('T23, the agent\'s sandbox: java_home finds no JDK, one in a JVM folder builds — the android line WARNs naming both, the lab check PASS, exit 0', async () => {
    fresh({ buildFails: 'java' });
    const jvms = join(root, 'jvms');
    const zulu = join(jvms, 'zulu-17.jdk', 'Contents', 'Home');
    mkdirSync(join(zulu, 'bin'), { recursive: true });
    writeFileSync(join(zulu, 'release'), 'JAVA_VERSION="17.0.12"\n');
    writeFileSync(join(zulu, 'bin', 'javac'), '');
    const argv = ['--out', out, '--repo', repo, '--serial', LAB_SERIAL, '--groups', 'forms'];
    expect(await labRun({ argv, env: {}, io: io(), wait: noWait, jvms: [join(root, 'none'), jvms] })).toBe(0);
    const s = summary();
    const jdk = `JDK 17: ${zulu} (from JavaVirtualMachines)`;
    const passed = `java_home -v 17 → nothing: exit 1 Unable to find any JVMs matching version "17"; ${join(root, 'none')}: no *.jdk (or unreadable)`;
    expect(s.find((l) => l.startsWith('LAB android:'))).toBe(
      `LAB android: WARN — ${passed} — the build used the one from JavaVirtualMachines: averi_lab emulator ${LAB_SERIAL}; this run's build installed under ${jdk}; the APK's assets/cells.json is main's (pulled: ${join(dirOf('lab'), 'installed.apk')}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
    );
    expect(s.find((l) => l.startsWith('lab check:'))).toMatch(/^lab check: PASS — /);
    expect(seam.words.find((w) => w.endsWith('assembleDebug'))).toBeDefined();
  });

  it('T23, no JDK 17 anywhere: nothing built, the android line WARNs (not rebuilt), the lab check WARNs naming every source, exit 3', async () => {
    fresh({ buildFails: 'java' });
    const none = join(root, 'none');
    const argv = ['--out', out, '--repo', repo, '--serial', LAB_SERIAL, '--groups', 'forms'];
    expect(await labRun({ argv, env: {}, io: io(), wait: noWait, jvms: [none] })).toBe(LAB_RUN_EXIT.unproven);
    const s = summary();
    const why = `no JDK 17 (JAVA_HOME unset; java_home -v 17 → nothing: exit 1 Unable to find any JVMs matching version "17"; ${none}: no *.jdk (or unreadable))`;
    expect(s.find((l) => l.startsWith('LAB android:'))).toBe(
      `LAB android: WARN — ${why}; the app already installed is used: averi_lab emulator ${LAB_SERIAL}; not rebuilt; the APK's assets/cells.json is main's (pulled: ${join(dirOf('lab'), 'installed.apk')}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
    );
    expect(s.find((l) => l.startsWith('lab check:'))).toBe(`lab check: WARN — the lab devices checked, but this run's build failed (android-build: ${why}): the app already installed is used`);
    expect(seam.words.some((w) => w.includes('gradlew'))).toBe(false);
  });

  it('this run\'s build failing: the lab check WARNs naming it; the live groups run on the APK already installed; unproven, exit 3', async () => {
    fresh({ buildFails: 'gradlew' });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    const s = summary();
    expect(s.find((l) => l.startsWith('lab check:'))).toMatch(/^lab check: WARN — the lab devices checked, but this run's build failed \(android-build: the Android build failed/);
    expect(s.find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
  });

  it('the run\'s output is lab-run\'s: meta/lab-run.out', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(existsSync(join(dirOf('meta'), 'lab-run.out'))).toBe(true);
  });

  it('a Gradle daemon its build could not stop: stopped by the run\'s last step, said so', async () => {
    seam.stopFailsOnce = true;
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(seam.words.filter((w) => w.includes('gradlew') && w.includes('--stop'))).toHaveLength(2);
    expect(outText()).toContain("lab android: the Gradle daemon stopped at the run's end (its --stop failed: exit 1)");
  });
});

describe('--groups: a selection, as ONLY= is — every block stays the batch\'s', () => {
  it('--groups forms: no chooser block, no handlers need, no --check, no chooser run', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    const s = summary();
    expect(s).toContain("lab check: PASS — every lab need met: android (each one's LAB line above)");
    expect(s.some((l) => l.startsWith('chooser') || l.startsWith('LAB handlers'))).toBe(false);
    expect(s.find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
    expect(liveGroups()).toEqual(['forms']);
    expect(seam.words.some((w) => w.includes('dumpsys package preferred'))).toBe(false);
    expect(existsSync(join(out, 'chooser'))).toBe(false);
  });

  it('--groups chooser: the chooser group alone, between its checks', async () => {
    expect(await go(['--groups', 'chooser'])).toBe(0);
    expect(liveGroups()).toEqual(['chooser']);
    expect(summary().some((l) => l.startsWith('forms'))).toBe(false);
  });

  it('--groups forms,chooser: both, in the batch\'s order (chooser first)', async () => {
    expect(await go(['--groups', 'forms,chooser'])).toBe(0);
    expect(liveGroups()).toEqual(['chooser', 'forms']);
  });

  it.each([
    [['--groups', 'carousel'], "--groups names 'carousel', which is no group of lab-run (chooser, forms)"],
    [['--groups'], '--groups needs a value (chooser, forms or chooser,forms)'],
    [['--groups', '--udid'], '--groups needs a value (chooser, forms or chooser,forms)'],
    [['--groups', 'forms', '--groups', 'chooser'], '--groups is given twice'],
  ])('%j is refused: exit 2, nothing done', async (argv, why) => {
    expect(await go(argv)).toBe(2);
    expect(printed.join('')).toContain(why);
    expect(seam.words).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });

  it('a group refused with the config\'s own error: both said', async () => {
    expect(await labRun({ argv: ['--repo', repo, '--groups', 'x'], env: {}, io: io() })).toBe(2);
    expect(printed.join('')).toMatch(/no out folder[\s\S]*--groups names 'x'/);
  });

  it('the refusal holds its own lines only: a bad group alone, the config\'s error alone', async () => {
    expect(await go(['--groups', 'x'])).toBe(2);
    expect(printed.join('').split('\n').filter((l) => l !== '')).toHaveLength(1);
    printed.length = 0;
    expect(await labRun({ argv: ['--repo', repo, '--groups', 'forms'], env: {}, io: io() })).toBe(2);
    const lines = printed.join('').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('no out folder');
  });

  it('--groups forms over a dirty chooser state file: refused naming it, exit 2, nothing done', async () => {
    const file = dirtyState();
    expect(await go(['--groups', 'forms'])).toBe(2);
    expect(printed.join('')).toContain(`${file} is dirty (the chooser window not put back):`);
    expect(seam.words).toEqual([]);
  });

  it('ONLY= and --groups together: the blocks both name; none left is refused', async () => {
    expect(await go(['--groups', 'chooser,forms'], { ONLY: 'forms' })).toBe(0);
    expect(liveGroups()).toEqual(['forms']);
    printed.length = 0;
    expect(await go(['--groups', 'chooser'], { ONLY: 'forms' })).toBe(2);
    expect(printed.join('')).toContain('ONLY=forms and --groups chooser leave no block of lab-run to run');
  });

  it.each([
    [[], { ONLY: 'lab' }, 'ONLY=lab'],
    [['--groups', 'forms'], { ONLY: 'lab' }, 'ONLY=lab --groups forms'],
    [['--groups', 'chooser,forms'], { ONLY: 'lab' }, 'ONLY=lab --groups chooser,forms'],
  ])('%j with %j selects no live group: refused up front, named, exit 2, nothing done', async (argv, env, said) => {
    expect(await go(argv, env)).toBe(LAB_RUN_EXIT.nothingDone);
    expect(printed.join('')).toContain(`${said} selects no live group of lab-run (chooser, forms): a standing run that runs none proves nothing`);
    expect(seam.words).toEqual([]);
  });

  describe('onlyWith and groupsOf: --groups as ONLY=', () => {
    it('no --groups: ONLY as given', () => {
      expect(onlyWith(undefined, undefined, LAB_RUN_STANDING)).toStrictEqual({});
      expect(onlyWith(undefined, 'forms', LAB_RUN_STANDING)).toStrictEqual({ only: 'forms' });
      expect(groupsOf(['--out', '/x'], LAB_RUN_STANDING)).toStrictEqual({ rest: ['--out', '/x'], errors: [] });
    });
    it('--groups alone: the lab block and the groups', () => {
      expect(onlyWith(['forms'], undefined, LAB_RUN_STANDING)).toEqual({ only: 'lab,forms' });
      expect(onlyWith(['chooser', 'forms'], '', LAB_RUN_STANDING)).toEqual({ only: 'lab,chooser,forms' });
    });
    it('with ONLY: the names both allow, a name that is no block kept for the runner\'s WARN; none left refused', () => {
      expect(onlyWith(['chooser', 'forms'], 'forms  lab,nope', LAB_RUN_STANDING)).toEqual({ only: 'forms,lab,nope' });
      expect(onlyWith(['forms'], 'chooser,forms', LAB_RUN_STANDING)).toEqual({ only: 'forms' });
      expect(onlyWith(['chooser'], 'forms,nope', LAB_RUN_STANDING)).toEqual({ why: expect.stringContaining('ONLY=forms,nope and --groups chooser leave no block of lab-run to run') });
      expect(onlyWith(['chooser', 'forms'], 'nope', LAB_RUN_STANDING)).toEqual({ why: expect.stringContaining('ONLY=nope and --groups chooser,forms leave no block') });
    });
  });
});

describe('the refusals and the lab guard: nothing done to a device that is not the lab emulator', () => {
  it('no serial: refused before anything is done, exit 2', async () => {
    expect(await labRun({ argv: ['--out', out, '--repo', repo], env: {}, io: io() })).toBe(2);
    expect(printed.join('')).toContain('no lab emulator serial given (--serial or AVERI_LAB_SERIAL): lab-run runs on the lab emulator only');
    expect(seam.words).toEqual([]);
  });

  it('the serial from AVERI_LAB_SERIAL is taken', async () => {
    expect(await labRun({ argv: ['--out', out, '--repo', repo, '--groups', 'forms'], env: { AVERI_LAB_SERIAL: LAB_SERIAL }, io: io(), wait: noWait })).toBe(0);
  });

  it('an emulator that is not the lab AVD: refused by the lab guard, every block INCONCLUSIVE, no live run, exit 2', async () => {
    fresh({ avd: 'Pixel_7' });
    expect(await go()).toBe(2);
    const why = `the lab guard refused ${LAB_SERIAL} (nothing was done to it): ${LAB_SERIAL} is AVD "Pixel_7", not the lab's averi_lab: refused`;
    const s = summary();
    expect(s).toContain(`chooser verdict: INCONCLUSIVE — android: ${why}; handlers: ${why}`);
    expect(s).toContain(`forms verdict: INCONCLUSIVE — android: ${why}`);
    expect(liveGroups()).toEqual([]);
    // Only the guard's own read reached the emulator.
    expect(new Set(world.calls.filter((c) => c.startsWith('adb ')).map((c) => c.split(' ').slice(3).join(' ')))).toEqual(new Set(['emu avd name']));
    // Nothing built for a device that is not the lab's: the build is asked only after the guard.
    expect(seam.words.some((w) => w.includes('gradlew') || w.includes('catalog.ts'))).toBe(false);
  });

  it('a bad knob refuses the run: exit 2', async () => {
    expect(await go([], { B_LIVE: '5' })).toBe(2);
    expect(seam.words).toEqual([]);
  });
});

describe('the --check before: read only, in its own words; only a default goes to RESTORE', () => {
  it('a default before the run: the chooser group not run, the before line FAIL with its hand line in RESTORE; forms still runs; exit 1', async () => {
    fresh({ preferred: PREFERRED_WITH_DEFAULT });
    expect(await go()).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: FAIL — a lab default \(mAlways=true\) is set before the run — the chooser group not run: chooser no; /);
    expect(s).toContain("chooser verdict: INCONCLUSIVE — the lab not proven clean before the chooser group (chooser check before's line) — not run");
    expect(s.some((l) => l.startsWith('chooser check after') || l.startsWith('chooser left'))).toBe(false);
    expect(s).toContain(`RESTORE: state not provably put back — ${join(out, 'RESTORE.txt')}:`);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toContain(
      `adb -s ${LAB_SERIAL} uninstall dev.averi.lab && adb -s ${LAB_SERIAL} install ${join(dirOf('lab'), 'installed.apk')} (clears it; wipes the lab's data); then: adb -s ${LAB_SERIAL} shell dumpsys package preferred`,
    );
    expect(liveGroups()).toEqual(['forms']);
    // Read only: no reinstall, no key pressed.
    expect(world.calls.some((c) => / (uninstall|shell input) /.test(c))).toBe(false);
    expect(existsSync(join(dirOf('chooser'), 'state.json'))).toBe(false);
  });

  it('a chooser in front before the run: ERROR in the before check\'s own words, nothing pressed, no RESTORE; unproven, exit 3', async () => {
    fresh({ focus: FOCUS_CHOOSER });
    expect(await go()).toBe(LAB_RUN_EXIT.unproven);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: ERROR — a chooser is in front before the run \(read only: nothing pressed\) — the chooser group not run: chooser yes \(/);
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(false);
    expect(world.calls.some((c) => c.includes('keyevent'))).toBe(false);
    expect(liveGroups()).toEqual(['forms']);
  });

  it('the preferred block unread before the run: ERROR, no RESTORE; exit 3', async () => {
    fresh({ preferred: 'nothing here\n' });
    expect(await go(['--groups', 'chooser'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: ERROR — the preferred activities or the focus not proven clean \(read only: nothing pressed\) — the chooser group not run: /);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(false);
  });

  it('a last-chosen entry before and after: WARN lines only, the chooser group run, exit 0', async () => {
    fresh({ preferred: PREFERRED_WITH_DEFAULT.replace('mAlways=true', 'mAlways=false') });
    expect(await go(['--groups', 'chooser'])).toBe(0);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: WARN — a last-chosen entry \(mAlways=false: no default; no reinstall clears it\): chooser no; /);
    expect(liveGroups()).toEqual(['chooser']);
  });
});

describe('the --check after and the chooser block\'s state file', () => {
  it('a default the chooser group left: the after check FAILs, the reinstall clears it, the run FAILs by name, exit 1; the state file clean', async () => {
    seam.live.chooser = { during: (w) => void (w.st.preferred = PREFERRED_WITH_DEFAULT) };
    expect(await go()).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: OK — /);
    const afterLine = s.find((l) => l.startsWith('chooser check after:'))!;
    expect(afterLine).toMatch(/^chooser check after: FAIL — the chooser group's run left a lab default \(mAlways=true\) — chooser check before found none: chooser no; .*; cleared: uninstalled and reinstalled from /);
    expect(afterLine).not.toContain('predates');
    expect(s).toContain('chooser left a default: FAIL — the chooser group\'s run left a lab default (mAlways=true): chooser check before found none, chooser check after found one');
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(s.find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
    expect(world.st.preferred).not.toContain('mAlways=true\n          Selected from:\n            dev.averi.lab');
    expect(JSON.parse(readFileSync(join(dirOf('chooser'), 'state.json'), 'utf8'))).toEqual({ dirty: false });
  });

  it('a default the chooser group left that the reinstall does not clear: the after line says so, NOT cleared, its hand line in RESTORE; exit 1', async () => {
    seam.live.chooser = { during: (w) => void ((w.st.preferred = PREFERRED_WITH_DEFAULT), (w.st.apkCells = '{"cells":[]}\n')) };
    expect(await go(['--groups', 'chooser'])).toBe(1);
    const afterLine = summary().find((l) => l.startsWith('chooser check after:'))!;
    expect(afterLine).toMatch(/^chooser check after: FAIL — the chooser group's run left a lab default \(mAlways=true\) — chooser check before found none: chooser no; [^]*; NOT cleared: the reinstall not proven: /);
    expect(afterLine.match(/cleared: /g)).toHaveLength(1);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(true);
  });

  it('the --check after not proving the lab: its ERROR and hand line in RESTORE, the state file left dirty; the next run refused naming it', async () => {
    seam.live.chooser = { during: (w) => void (w.st.preferred = 'no preferred block here\n') };
    expect(await go(['--groups', 'chooser'])).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check after:'))).toMatch(/^chooser check after: ERROR — the preferred activities or the focus not proven clean/);
    const state = join(dirOf('chooser'), 'state.json');
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ dirty: true });
    expect(s).not.toContain('chooser left a default: FAIL');
    rmSync(join(out, 'RESTORE.txt'));
    printed.length = 0;
    seam.words.length = 0;
    expect(await labRun({ argv: ['--out', out, '--repo', repo, '--serial', LAB_SERIAL], env: {}, io: { ...io(), clock: () => new Date(2026, 10, 11, 11, 0, 0) } })).toBe(2);
    const said = printed.join('');
    expect(said).toContain(`${state} is dirty (the chooser window not put back):`);
    const apk = join(dirOf('lab'), 'installed.apk');
    expect(said).toContain(
      `  → adb -s ${LAB_SERIAL} shell dumpsys package preferred: a lab entry with mAlways=true left, ` +
        `adb -s ${LAB_SERIAL} uninstall dev.averi.lab && adb -s ${LAB_SERIAL} install ${apk}; ` +
        `a chooser in front, adb -s ${LAB_SERIAL} shell input keyevent KEYCODE_BACK; ` +
        `adb -s ${LAB_SERIAL} shell pm path dev.averi.lab (installed); then: printf '%s\\n' '{"dirty":false}' > ${state}`,
    );
    expect(seam.words).toEqual([]);
  });

  it('leftLine: the cleanup\'s tail by search; a line holding none is kept whole, its label and verdict still the after check\'s', () => {
    const check = { exit: 1 as const, focus: { state: 'read' as const, chooser: undefined }, preferred: { state: 'unread' as const, why: 'r' } };
    const said = 'the chooser group\'s run left a lab default (mAlways=true) — chooser check before found none: chooser no; preferred unread (r)';
    expect(leftLine({ line: 'chooser check after: FAIL — words; first: x; cleared: done', check })).toBe(`chooser check after: FAIL — ${said}; cleared: done`);
    expect(leftLine({ line: 'chooser check after: FAIL — w; NOT cleared: no; cleared: inner', check })).toBe(`chooser check after: FAIL — ${said}; NOT cleared: no; cleared: inner`);
    expect(leftLine({ line: 'chooser check after: FAIL — another wording', check })).toBe('chooser check after: FAIL — another wording');
  });

  it('stateHand: the chooser state file\'s hand line — the serial given, or where to give it; the run\'s pulled APK; the file written clean last', () => {
    const file = '/out/chooser/run-20261111-101500-4242/state.json';
    const tail = (s: string) =>
      `adb -s ${s} shell dumpsys package preferred: a lab entry with mAlways=true left, adb -s ${s} uninstall dev.averi.lab && adb -s ${s} install /out/lab/run-20261111-101500-4242/installed.apk; ` +
      `a chooser in front, adb -s ${s} shell input keyevent KEYCODE_BACK; adb -s ${s} shell pm path dev.averi.lab (installed); then: printf '%s\\n' '{"dirty":false}' > ${file}`;
    expect(stateHand('emulator-5554', file)).toBe(`  → ${tail('emulator-5554')}`);
    expect(stateHand(undefined, file)).toBe(`  → ${tail("'<the lab emulator: --serial or AVERI_LAB_SERIAL>'")}`);
  });

  it('cleanState: the file written `{"dirty":false}` whole, said so; its hand command writes the same', async () => {
    const file = join(root, 'state.json');
    writeFileSync(file, '{"dirty":true,"kept":1}');
    const r = cleanState(nodeFs, file);
    expect(await r.restore(async () => ({ code: 0, timedOut: false, signal: null, out: '', err: '' }))).toEqual({ ok: true, how: 'lab-run keeps no lab data: its state file written clean' });
    expect(readFileSync(file, 'utf8')).toBe('{"dirty":false}\n');
    expect(r.command).toBe(`printf '%s\\n' '{"dirty":false}' > ${file}`);
  });
});

describe('each live block\'s verdict: main\'s rejudge exit code, its FAIL naming the failure reasons the rejudge wrote (A21)', () => {
  /** The verdict line the chooser block gives over these results: summarize's header and failure reasons, as the rejudge wrote them. */
  const chooserFail = (results: LiveResult[], premise?: ChooserPremise) => {
    const s = liveSummary('android', results, { premise });
    const header = s.lines.find((l) => l.startsWith('# Live golden:'))!;
    return `chooser verdict: FAIL — android-chooser: main's rejudge exit 1 — ${s.failures.join('; ')} (${header})`;
  };
  const chooserLine = () => summary().find((l) => l.startsWith('chooser verdict:'));

  it('an unknown MISMATCH: the block FAILs naming it; a SKIP and a LOUD beside it are no failure, not named', async () => {
    const rejudged = [
      liveResult('lc1', 'uiautomator', { outcome: 'MISMATCH', cls: 'tap-claim', why: 'the lab not in front' }, 'chooser'),
      liveResult('lc2', 'uiautomator', { outcome: 'SKIP', why: 'unread' }, 'chooser'),
      liveResult('lc9', 'uiautomator', { outcome: 'LOUD', cls: 'loud-untouched', why: 'loud' }, 'chooser'),
    ];
    seam.live.chooser = { code: 1, rejudged };
    expect(await go()).toBe(1);
    expect(chooserLine()).toBe(chooserFail(rejudged));
    expect(chooserLine()).toMatch(/main's rejudge exit 1 — MISMATCH lc1 \(# Live golden: 3 cases, 0 ok, 1 loud, 1 mismatches \(1 not known\), 1 skipped\)$/);
  });

  it('a stale chooser premise (T20a): the FAIL quotes the premise line and its hand line, not its last-chosen WARN', async () => {
    const lines = [
      'CHOOSER PREMISE: stale — a lab default (mAlways=true) for averilab://shared — the run fails',
      `D55 (Android): a lab default: adb -s ${LAB_SERIAL} uninstall dev.averi.lab`,
      'Chooser premise: WARN — 1 last-chosen lab entry (mAlways=false: no default; no reinstall clears it), first: 9d3a2b9 dev.averi.lab/.Twin',
    ];
    const premise: ChooserPremise = { state: 'stale', facts: [], lines };
    const rejudged = okResults('chooser');
    seam.live.chooser = { code: 1, rejudged, premise };
    expect(await go()).toBe(1);
    expect(chooserLine()).toBe(chooserFail(rejudged, premise));
    expect(chooserLine()).toContain(`main's rejudge exit 1 — ${lines[0]} | ${lines[1]} (# Live golden:`);
  });

  it('the hedged ceiling\'s MISMATCH (every unaimable leg hedged, live-carousel.ts): a failure the block names — the prose grep missed it', async () => {
    const rejudged = [...okResults('chooser'), ...hedgedLegs('uiautomator')];
    seam.live.chooser = { rejudged };
    expect(await go()).toBe(1);
    expect(chooserLine()).toBe(chooserFail(rejudged));
    expect(chooserLine()).toMatch(/main's rejudge exit 1 — MISMATCH \(hedged ceiling\): hedged 3 of 3 judged unaimable leg\(s\) — .* — the run fails \(# Live golden: /);
  });

  it('a LOUD alone — a case, or the hedged ceiling unjudged — fails nothing: main\'s rejudge exit 0, PASS, exit 0', async () => {
    const rejudged = [
      ...okResults('chooser'),
      liveResult('lc9', 'uiautomator', { outcome: 'LOUD', cls: 'loud-untouched', why: 'loud' }, 'chooser'),
      ...hedgedLegs('uiautomator').slice(0, 2),
    ];
    expect(liveSummary('android', rejudged).lines).toContain('LOUD (hedged ceiling): hedged 2 of 2 judged unaimable leg(s) — fewer than 3 judged, the ceiling unjudged (no pass claimed)');
    seam.live.chooser = { rejudged };
    expect(await go()).toBe(0);
    expect(chooserLine()).toMatch(/^chooser verdict: PASS — android-chooser: main's rejudge exit 0 \(# Live golden: 5 cases, 4 ok, 2 loud,/);
  });

  it('the failure reasons not written beside the summary: INCONCLUSIVE, unproven (3) — never read as "no failure"', async () => {
    seam.live.forms = { rejudgeRaw: { code: 0, out: `${liveSummary('android', okResults('forms')).lines.join('\n')}\n`, err: '' } };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toBe(
      "forms verdict: INCONCLUSIVE — android-forms: main's rejudge exit 0, its failure reasons unread (android-forms.rejudge.json): read android-forms.rejudge.txt",
    );
  });

  it('a live run past its bound: no record, the block INCONCLUSIVE from the backstop (its run not complete)', async () => {
    seam.live.forms = { code: 142, noRecord: true };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: INCONCLUSIVE/);
  });

  it('a live run writes its outcome beside its record, and its rejudge its failure reasons', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(JSON.parse(readFileSync(join(dirOf('forms'), 'android-forms.outcome.json'), 'utf8'))).toEqual({ live: { word: 'OK', why: 'exit 0' }, rejudge: { word: 'OK', why: 'exit 0' } });
    expect(readFileSync(join(dirOf('forms'), 'android-forms.rejudge.json'), 'utf8')).toBe('{"failures":[]}\n');
  });
});

describe('the exit code (words.ts#STANDING_EXIT, over the SUMMARY runBatch returns): 0 only when every selected block PASSed', () => {
  it('the codes', () => {
    expect(LAB_RUN_EXIT).toEqual({ ok: 0, failed: 1, nothingDone: 2, interrupted: 130, unproven: 3 });
  });

  it('a SIGINT during the forms run: exit 130, the chooser block judged from its folder by the abort (PASS), forms INTERRUPTED', async () => {
    seam.hang = '--groups forms --record';
    const done = go();
    await until(() => seam.words.some((w) => w.includes('--groups forms --record')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(LAB_RUN_EXIT.interrupted);
    expect(seam.exits).toEqual([130]);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser verdict:'))).toMatch(/^chooser verdict: PASS — android-chooser: main's rejudge exit 0/);
    expect(s.find((l) => l.startsWith('forms:'))).toMatch(/^forms: INTERRUPTED — not judged/);
  });

  it('an earlier run\'s clean SUMMARY beside it is never read: this run unproven, exit 3; neither run exits by itself (the CLI entry does)', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    seam.live.forms = { code: 142, noRecord: true };
    const later = { ...io(), clock: () => new Date(2026, 10, 11, 12, 0, 0) };
    expect(await labRun({ argv: ['--out', out, '--repo', repo, '--serial', LAB_SERIAL, '--groups', 'forms'], env: {}, io: later, wait: noWait })).toBe(LAB_RUN_EXIT.unproven);
    expect(seam.exits).toEqual([]);
  });

  it('an ERROR line in a live run\'s log, every block PASS: the SUMMARY\'s ERROR section makes it unproven, exit 3', async () => {
    seam.live.forms = { logLine: 'ERROR the lab app crashed once' };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary()).toContain('ERROR the lab app crashed once');
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
  });

  it('a line in a live run\'s log that does not start with ERROR (`x ERROR y`): no ERROR section, exit 0', async () => {
    seam.live.forms = { logLine: 'x ERROR y' };
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(summary().some((l) => l.includes('x ERROR y'))).toBe(false);
  });
});

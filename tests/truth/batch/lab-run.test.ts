import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import {
  cleanState,
  failuresIn,
  groupsOf,
  LAB_RUN_EXIT,
  labRun,
  labRunExit,
  leftLine,
  liveJudge,
  liveVerdictLine,
  onlyWith,
} from '../../../scripts/truth/batch/lab-run.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, Handlers, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import { CATALOG, FOCUS_CHOOSER, LAB_SERIAL, labWorld, PREFERRED_WITH_DEFAULT, type LabWorld, type WorldOptions } from './lab-fakes.js';

// The standing lab batch (T20b, scripts/truth/batch/lab-run.ts) under runBatch, over the shared fake lab
// (lab-fakes.ts) and a fake process seam that answers git and live.ts — its `--groups` run and its `--rejudge` —
// with real files in a temp dir, a fixed clock and pid. The blocks' order and the device calls' order; `--groups` as
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
  rejudgeCode?: number;
  /** live.ts wrote no record and never judged (cut at its bound). */
  noRecord?: boolean;
  /** A line live.ts prints into its log before its summary. */
  logLine?: string;
  /** What its rejudge prints (the cases' summary unless given). */
  rejudgeOut?: string;
  during?: (w: LabWorld) => void;
}

class RunSeam implements ProcessSeam {
  readonly words: string[] = [];
  readonly exits: number[] = [];
  handlers: Handlers | undefined;
  /** A call whose words include this runs until its group is signalled (the first one only). */
  hang: string | undefined;
  /** The first `gradlew --stop` fails (exit 1): the daemon left to the run's last step. */
  stopFailsOnce = false;
  private nextPid = 100;
  private readonly ends = new Map<number, (e: Ended) => void>();
  private readonly ended = new Set<number>();
  /** What each group's live.ts run does. */
  live: Record<string, LiveScript> = {};
  private readonly asked = new Map<string, string>();
  constructor(public world: LabWorld) {}
  start(cmd: string, args: readonly string[], options: StartOptions): Started {
    const said = `${cmd === process.execPath ? 'node' : cmd} ${args.join(' ')}`;
    this.words.push(said);
    const a = this.answer(cmd, args, options);
    if (a === undefined) throw new Error(`no answer for ${said}`);
    if (options.logFd !== undefined) writeSync(options.logFd, `${a.out}${a.err}`);
    const pid = this.nextPid++;
    let end!: (e: Ended) => void;
    const exited = new Promise<Ended>((r) => (end = r));
    this.ends.set(pid, (e) => (this.ended.add(pid), end(e)));
    if (this.hang === undefined || !said.includes(this.hang)) this.ends.get(pid)!({ code: a.code, signal: null });
    else this.hang = undefined;
    return { pid, exited, closed: exited.then(() => {}), out: () => (options.logFd === undefined ? a.out : ''), err: () => (options.logFd === undefined ? a.err : ''), release: () => {} };
  }
  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult {
    if (this.ended.has(pid)) return 'gone';
    if (signal !== 0) this.ends.get(pid)?.({ code: null, signal });
    return 'sent';
  }
  install(h: Handlers): void {
    this.handlers = h;
  }
  exit(code: number): void {
    this.exits.push(code);
  }
  stderr(): void {}
  private answer(cmd: string, args: readonly string[], options: StartOptions): { code: number; out: string; err: string } | undefined {
    if (cmd === 'git') {
      const said = args.slice(2).join(' ');
      if (said === 'rev-parse --show-toplevel') return { code: 0, out: `${nodeFs.real(args[1])}\n`, err: '' };
      if (said.startsWith('rev-parse --verify')) return { code: 0, out: `${HEAD}\n`, err: '' };
      return { code: 0, out: '', err: '' };
    }
    if (cmd === process.execPath && args.some((a) => a.endsWith('live.ts'))) {
      const at = (flag: string) => args[args.indexOf(flag) + 1];
      const group = at('--groups');
      const script = this.live[group] ?? {};
      if (args.includes('--rejudge')) return { code: script.rejudgeCode ?? 0, out: script.rejudgeOut ?? summaryOf(GROUP_CASES[group]), err: '' };
      this.asked.set(at('--record'), group);
      script.during?.(this.world);
      if (script.noRecord === true) return { code: script.code ?? 0, out: '', err: '' };
      writeFileSync(at('--record'), '{"results":[]}');
      return { code: script.code ?? 0, out: `${script.logLine === undefined ? '' : `${script.logLine}\n`}${summaryOf(GROUP_CASES[group])}`, err: '' };
    }
    if (cmd.endsWith('gradlew') && args.includes('--stop') && this.stopFailsOnce) {
      this.stopFailsOnce = false;
      return { code: 1, out: '', err: 'Could not stop the daemon' };
    }
    return this.world.answer(cmd, args, { cwd: options.cwd });
  }
}
const summaryOf = (ids: readonly string[]) => [`${LIVE_GOLDEN_HEADER} ${ids.length} cases, ${ids.length} ok`, '', '## uiautomator', ...ids.map((id) => `- ok ${id} open: says — fine`), ''].join('\n');

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
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 1500): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; await tick(2)) if (ok()) return;
  throw new Error('the condition never held');
}
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
      `LAB android: OK — averi_lab emulator ${LAB_SERIAL}; this run's build installed; the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
      'LAB handlers: OK — handlers as expected: averilab://shared/open 2, averilab://cell/open 1',
    ]);
    const after = s.slice(4);
    expect(after[0]).toBe('lab check: PASS — every lab need met: android, handlers (each one\'s LAB line above)');
    expect(after[1]).toMatch(/^chooser check before: OK — chooser no; preferred read \(1 user\); lab entries 0 \(defaults 0, last-chosen 0\)$/);
    expect(after[2]).toMatch(/^chooser check after: OK — chooser no; preferred read \(1 user\); lab entries 0 /);
    expect(after[3]).toMatch(/^chooser verdict: PASS — android-chooser: main's rejudge exit 0 \(# Live golden: 2 cases, 2 ok\)$/);
    expect(after[4]).toMatch(/^forms verdict: PASS — android-forms: main's rejudge exit 0 \(# Live golden: 1 cases, 1 ok\)$/);
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
    expect(seam.exits).toEqual([0]);
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
      expect(onlyWith(undefined, undefined)).toStrictEqual({});
      expect(onlyWith(undefined, 'forms')).toStrictEqual({ only: 'forms' });
      expect(groupsOf(['--out', '/x'])).toStrictEqual({ rest: ['--out', '/x'], errors: [] });
    });
    it('--groups alone: the lab block and the groups', () => {
      expect(onlyWith(['forms'], undefined)).toEqual({ only: 'lab,forms' });
      expect(onlyWith(['chooser', 'forms'], '')).toEqual({ only: 'lab,chooser,forms' });
    });
    it('with ONLY: the names both allow, a name that is no block kept for the runner\'s WARN; none left refused', () => {
      expect(onlyWith(['chooser', 'forms'], 'forms  lab,nope')).toEqual({ only: 'forms,lab,nope' });
      expect(onlyWith(['forms'], 'chooser,forms')).toEqual({ only: 'forms' });
      expect(onlyWith(['chooser'], 'forms,nope')).toEqual({ why: expect.stringContaining('ONLY=forms,nope and --groups chooser leave no block of lab-run to run') });
      expect(onlyWith(['chooser', 'forms'], 'nope')).toEqual({ why: expect.stringContaining('ONLY=nope and --groups chooser,forms leave no block') });
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

  it('cleanState: the file written `{"dirty":false}` whole, said so; its hand command writes the same', async () => {
    const file = join(root, 'state.json');
    writeFileSync(file, '{"dirty":true,"kept":1}');
    const r = cleanState(nodeFs, file);
    expect(await r.restore(async () => ({ code: 0, timedOut: false, signal: null, out: '', err: '' }))).toEqual({ ok: true, how: 'lab-run keeps no lab data: its state file written clean' });
    expect(readFileSync(file, 'utf8')).toBe('{"dirty":false}\n');
    expect(r.command).toBe(`printf '%s\\n' '{"dirty":false}' > ${file}`);
  });
});

describe('each live block\'s verdict: main\'s rejudge exit code, judged from the block\'s folder', () => {
  it('a rejudge exit 1 on an unknown MISMATCH and a SKIP: the block FAILs naming them (a known MISMATCH not among them), exit 1', async () => {
    const out = [
      `${LIVE_GOLDEN_HEADER} 3 cases, 1 ok, 0 loud, 2 mismatches (1 not known), 1 skipped`,
      '',
      '## uiautomator',
      '- MISMATCH (front) lc1 open: says — the lab not in front',
      '    launch_app → Launched',
      '- MISMATCH (front) lc2 open: says — known [known: D99]',
      '- SKIP lc3 open: says — unread',
      '- ok lc4 open: says — fine',
      '',
    ].join('\n');
    seam.live.chooser = { code: 1, rejudgeCode: 1, rejudgeOut: out };
    expect(await go()).toBe(1);
    expect(summary()).toContain(
      `chooser verdict: FAIL — android-chooser: main's rejudge exit 1 — MISMATCH lc1; SKIP lc3 (${LIVE_GOLDEN_HEADER} 3 cases, 1 ok, 0 loud, 2 mismatches (1 not known), 1 skipped)`,
    );
  });

  it('a rejudge exit 1 on a stale chooser premise (T20a): the FAIL quotes the premise line and its hand line', async () => {
    const out = [
      `${LIVE_GOLDEN_HEADER} 2 cases, 2 ok, 0 loud, 0 mismatches (0 not known), 0 skipped`,
      '',
      '## uiautomator',
      '- ok lc1 open: says — fine',
      '- ok lc2 open: says — fine',
      '',
      'CHOOSER PREMISE: stale — a lab default (mAlways=true) for averilab://shared — the run fails',
      `D55 (Android): a lab default: adb -s ${LAB_SERIAL} uninstall dev.averi.lab`,
      '',
    ].join('\n');
    seam.live.chooser = { code: 1, rejudgeCode: 1, rejudgeOut: out };
    expect(await go()).toBe(1);
    expect(summary()).toContain(
      `chooser verdict: FAIL — android-chooser: main's rejudge exit 1 — CHOOSER PREMISE: stale — a lab default (mAlways=true) for averilab://shared — the run fails | D55 (Android): a lab default: adb -s ${LAB_SERIAL} uninstall dev.averi.lab (${LIVE_GOLDEN_HEADER} 2 cases, 2 ok, 0 loud, 0 mismatches (0 not known), 0 skipped)`,
    );
  });

  it('a live run past its bound: no record, the block INCONCLUSIVE from the backstop (its run not complete)', async () => {
    seam.live.forms = { code: 142, noRecord: true };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: INCONCLUSIVE/);
  });

  describe('liveVerdictLine: a live block\'s verdict from its run and its summary', () => {
    const ok = { word: 'OK' as const, why: 'exit 0' };
    const header = '# Live golden: 2 cases, 2 ok';
    it('never run: INCONCLUSIVE, said so', () => {
      expect(liveVerdictLine('x verdict', 'r', undefined, undefined)).toBe('x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: not run)');
    });
    it('run, no rejudge (no record): INCONCLUSIVE naming live.ts\'s why', () => {
      expect(liveVerdictLine('x verdict', 'r', { live: { word: 'FAIL', why: 'timed out' } }, undefined)).toBe('x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: timed out)');
    });
    it('the rejudge not judged: INCONCLUSIVE naming its why', () => {
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: { word: 'FAIL', why: 'exit 2' } }, header)).toBe("x verdict: INCONCLUSIVE — r: main's rejudge exit 2");
    });
    it('exit 0 PASS, exit 1 FAIL, the summary\'s header quoted when there is one', () => {
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, `<!-- averi -->\n${header}\n`)).toBe(`x verdict: PASS — r: main's rejudge exit 0 (${header})`);
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, 'no header\n')).toBe("x verdict: PASS — r: main's rejudge exit 0");
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: ok }, undefined)).toBe("x verdict: PASS — r: main's rejudge exit 0");
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: { word: 'DONE', why: 'judged' } }, header)).toBe(
        `x verdict: FAIL — r: main's rejudge exit 1 — its summary names no case or premise: read r.rejudge.txt (${header})`,
      );
      const tallies = ['SKIPPED where a skip proves nothing — the run fails: uiautomator e1', 'NO FIRST STATE — the app wrote none, the run fails: uiautomator f2', 'FIXED, not intermittent — strike off live-known.ts: uiautomator f3'];
      expect(liveVerdictLine('x verdict', 'r', { live: ok, rejudge: { word: 'DONE', why: 'judged' } }, ['- LOUD (x) f9 open: says — loud', ...tallies].join('\n'))).toBe(
        `x verdict: FAIL — r: main's rejudge exit 1 — LOUD f9; ${tallies.join('; ')}`,
      );
    });
  });

  describe('liveJudge: device-free, from the block\'s folder alone', () => {
    it('nothing written: "not run"; the outcome written beside its summary: its verdict', async () => {
      const dir = join(root, 'judged');
      mkdirSync(dir);
      const judge = liveJudge('x verdict', 'r');
      expect(await judge({ dir, fs: nodeFs })).toEqual(['x verdict: INCONCLUSIVE — r: no rejudge of its record (live.ts: not run)']);
      writeFileSync(join(dir, 'r.outcome.json'), JSON.stringify({ live: { word: 'OK', why: 'exit 0' }, rejudge: { word: 'OK', why: 'exit 0' } }));
      writeFileSync(join(dir, 'r.rejudge.txt'), `${LIVE_GOLDEN_HEADER} 1 cases, 1 ok\n`);
      expect(await judge({ dir, fs: nodeFs })).toEqual([`x verdict: PASS — r: main's rejudge exit 0 (${LIVE_GOLDEN_HEADER} 1 cases, 1 ok)`]);
      writeFileSync(join(dir, 'r.outcome.json'), 'not json');
      expect(await judge({ dir, fs: nodeFs })).toEqual(['x verdict: INCONCLUSIVE — r: its outcome file r.outcome.json is unreadable']);
    });

    it('a live run writes its outcome beside its record', async () => {
      expect(await go(['--groups', 'forms'])).toBe(0);
      expect(JSON.parse(readFileSync(join(dirOf('forms'), 'android-forms.outcome.json'), 'utf8'))).toEqual({ live: { word: 'OK', why: 'exit 0' }, rejudge: { word: 'OK', why: 'exit 0' } });
    });
  });

  describe('failuresIn: what a failed rejudge summary names', () => {
    it('a premise first, its hand lines up to the next other line', () => {
      const text = ['CHOOSER PREMISE: stale — a — the run fails', 'D55 (Android): one', 'D55 (Android): two', 'after', 'D55 (Android): not its'].join('\n');
      expect(failuresIn(text)).toEqual(['CHOOSER PREMISE: stale — a — the run fails | D55 (Android): one | D55 (Android): two']);
      expect(failuresIn('x\nCHOOSER PREMISE: stale — b — the run fails\nD55 (Android): h')).toEqual(['CHOOSER PREMISE: stale — b — the run fails | D55 (Android): h']);
    });
    it('only lines that start so: an indented reply or a quoted word is none', () => {
      expect(failuresIn('    - MISMATCH lc1 open: x\n  SKIPPED where a skip proves nothing — the run fails: e\n- ok lc2 open: - MISMATCH lc9 \n')).toEqual([]);
      expect(failuresIn('- LOUD f1 open: x\n- SKIP (c) s2 open: y')).toEqual(['LOUD f1', 'SKIP s2']);
    });
  });
});

describe('the exit code (LAB_RUN_EXIT): 0 only when every selected block PASSed', () => {
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

  it('an earlier run\'s clean SUMMARY beside it is never read: this run unproven, exit 3', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    seam.live.forms = { code: 142, noRecord: true };
    const later = { ...io(), clock: () => new Date(2026, 10, 11, 12, 0, 0) };
    expect(await labRun({ argv: ['--out', out, '--repo', repo, '--serial', LAB_SERIAL, '--groups', 'forms'], env: {}, io: later, wait: noWait })).toBe(LAB_RUN_EXIT.unproven);
    expect(seam.exits).toEqual([0, 3]);
  });

  it('an ERROR line in a live run\'s log, every block PASS: the SUMMARY\'s ERROR section makes it unproven, exit 3', async () => {
    seam.live.forms = { logLine: 'ERROR the lab app crashed once' };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary()).toContain('ERROR the lab app crashed once');
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
  });

  describe('labRunExit: 0 only when every wanted block PASSed and no line is INCONCLUSIVE or ERROR', () => {
    const pass = ['lab check: PASS — met', 'forms verdict: PASS — ok', 'LAB android: OK — fine', 'RESTORE: none — everything dirty was put back and verified', 'x step: WARN — said'];
    const labels = ['lab check', 'forms verdict'];
    it('an ERROR step line (steps.log, timed) or a log\'s ERROR line beside every block PASS: unproven, 3', () => {
      expect(labRunExit(0, [...pass, '10:15:00 ERROR forms live android-forms (exit 2) — see x.log'], labels)).toBe(3);
      expect(labRunExit(0, [...pass, 'ERROR something in a log (×2, in forms/android-forms.log)'], labels)).toBe(3);
      expect(labRunExit(0, [...pass, '[forms/x.log] ERROR boom'], labels)).toBe(3);
      expect(labRunExit(0, [...pass, 'ERRORS seen: none', 'x ERROR y'], labels)).toBe(0);
    });

    it('the runner\'s 1, 2 and 130 stand', () => {
      for (const c of [1, 2, 130]) expect(labRunExit(c, pass, labels)).toBe(c);
    });
    it('every wanted block PASS, OK and WARN lines beside: 0', () => {
      expect(labRunExit(0, pass, labels)).toBe(0);
    });
    it('unproven (3): the SUMMARY unread; an INCONCLUSIVE line; an ERROR line; a wanted block not PASS or missing', () => {
      expect(labRunExit(0, undefined, labels)).toBe(3);
      expect(labRunExit(0, [...pass, 'chooser check before: INCONCLUSIVE — x'], labels)).toBe(3);
      expect(labRunExit(0, [...pass, 'LAB handlers: ERROR — x'], labels)).toBe(3);
      expect(labRunExit(0, ['lab check: WARN — build failed', 'forms verdict: PASS — ok'], labels)).toBe(3);
      expect(labRunExit(0, ['forms verdict: PASS — ok'], labels)).toBe(3);
      expect(labRunExit(0, ['lab check: PASS — x', 'forms verdict: SKIP — x'], labels)).toBe(3);
    });
  });
});

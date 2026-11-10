import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { cleanState, labRun, liveVerdictLine } from '../../../scripts/truth/batch/lab-run.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import { CATALOG, LAB_SERIAL, labWorld, PREFERRED_WITH_DEFAULT, type LabWorld, type WorldOptions } from './lab-fakes.js';

// The standing lab batch (T20b, scripts/truth/batch/lab-run.ts) under runBatch, over the shared fake lab (lab-fakes.ts)
// and a fake process seam that answers git and live.ts — its `--groups` run and its `--rejudge` — with real files in a
// temp dir, a fixed clock and pid. The blocks' order and the device calls' order; `--groups`; the refusals (no serial,
// a group that is none) and the lab guard's; the --check before and after the chooser group, a default the run left
// failing the batch by name. Every call is checked for b11-dry's VIOLATIONs (afterEach). No device.

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
  during?: (w: LabWorld) => void;
}

class RunSeam implements ProcessSeam {
  readonly words: string[] = [];
  readonly exits: number[] = [];
  private nextPid = 100;
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
    const exited = Promise.resolve<Ended>({ code: a.code, signal: null });
    return { pid: this.nextPid++, exited, closed: exited.then(() => {}), out: () => (options.logFd === undefined ? a.out : ''), err: () => (options.logFd === undefined ? a.err : ''), release: () => {} };
  }
  killGroup(): KillResult {
    return 'gone';
  }
  install(): void {}
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
      if (args.includes('--rejudge')) return { code: script.rejudgeCode ?? 0, out: summaryOf(GROUP_CASES[group]), err: '' };
      this.asked.set(at('--record'), group);
      script.during?.(this.world);
      if (script.noRecord === true) return { code: script.code ?? 0, out: '', err: '' };
      writeFileSync(at('--record'), '{"results":[]}');
      return { code: script.code ?? 0, out: summaryOf(GROUP_CASES[group]), err: '' };
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
/** The index of the first call holding `text` at or after `from`. */
const callAt = (text: string, from = 0) => seam.words.findIndex((w, i) => i >= from && w.includes(text));

describe('lab-run.ts: the standing lab batch (T20b) — the lab block, the chooser group between --check before and after, the forms group', () => {
  it('a clean run of both groups: every line in the blocks\' order, the checks around the chooser run, exit 0', async () => {
    expect(await go()).toBe(0);
    const s = summary();
    const apk = join(dirOf('lab'), 'installed.apk');
    expect(s.slice(0, 5)).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      `LAB android-build: OK — built from the checkout under test (${join(repo, 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk')}); its assets/cells.json main's; the Gradle daemon stopped`,
      `LAB android: OK — averi_lab emulator ${LAB_SERIAL}; this run's build installed; the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
      'LAB handlers: OK — handlers as expected: averilab://shared/open 2, averilab://cell/open 1',
    ]);
    const after = s.slice(5);
    expect(after[0]).toBe('lab check: PASS — every lab need met: android-build, android, handlers (each one\'s LAB line above)');
    expect(after[1]).toMatch(/^chooser check before: OK — chooser no; preferred read \(1 user\); lab entries 0 \(defaults 0, last-chosen 0\)$/);
    expect(after[2]).toMatch(/^chooser check after: OK — chooser no; preferred read \(1 user\); lab entries 0 /);
    expect(after[3]).toMatch(/^chooser verdict: PASS — android-chooser: main's rejudge exit 0 \(# Live golden: 2 cases, 2 ok\)$/);
    expect(after[4]).toMatch(/^forms verdict: PASS — android-forms: main's rejudge exit 0 \(# Live golden: 1 cases, 1 ok\)$/);
    expect(after[5]).toBe('RESTORE: none — everything dirty was put back and verified');
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
});

describe('--groups: the live blocks it picks (default both), each in the batch\'s order', () => {
  it('--groups forms: no chooser block, no handlers need, no --check, no chooser run', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    const s = summary();
    expect(s).toContain("lab check: PASS — every lab need met: android-build, android (each one's LAB line above)");
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
  });

  it('a bad knob refuses the run: exit 2', async () => {
    expect(await go([], { B_LIVE: '5' })).toBe(2);
    expect(seam.words).toEqual([]);
  });
});

describe('the --check before and after the chooser group (lab-chooser.ts#CHECK_OUTCOME)', () => {
  it('a default the chooser group left: the after check FAILs, the reinstall clears it, the run FAILs by name, exit 1; the state file clean', async () => {
    seam.live.chooser = { during: (w) => void (w.st.preferred = PREFERRED_WITH_DEFAULT) };
    expect(await go()).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: OK — /);
    expect(s.find((l) => l.startsWith('chooser check after:'))).toMatch(/^chooser check after: FAIL — a lab default \(mAlways=true\) is set .*; cleared: uninstalled and reinstalled from /);
    expect(s).toContain('chooser left a default: FAIL — the chooser group\'s run left a lab default (mAlways=true): chooser check before found none, chooser check after found one');
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(s.find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
    expect(world.st.preferred).not.toContain('mAlways=true\n          Selected from:\n            dev.averi.lab');
    expect(JSON.parse(readFileSync(join(dirOf('chooser'), 'state.json'), 'utf8'))).toEqual({ dirty: false });
  });

  it('a default before the run: the chooser group not run, the before line FAIL with its hand line in RESTORE; forms still runs; exit 1', async () => {
    fresh({ preferred: PREFERRED_WITH_DEFAULT });
    expect(await go()).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check before:'))).toMatch(/^chooser check before: FAIL — a lab default \(mAlways=true\) is set/);
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
});

describe('each live block\'s verdict: main\'s rejudge exit code (live-cases.ts#summarize)', () => {
  it('a rejudge exit 1 (an unknown MISMATCH, a stale premise): the block FAILs, exit 1', async () => {
    seam.live.chooser = { code: 1, rejudgeCode: 1 };
    expect(await go()).toBe(1);
    expect(summary()).toContain("chooser verdict: FAIL — android-chooser: main's rejudge exit 1: an unknown MISMATCH, a stale chooser premise or a SKIP that proves nothing (# Live golden: 2 cases, 2 ok)");
  });

  it('a live run past its bound: no record, the block INCONCLUSIVE from the backstop (its run not complete)', async () => {
    seam.live.forms = { code: 142, noRecord: true };
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(summary().find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: INCONCLUSIVE/);
  });
});

describe('the chooser block\'s state file (run-dir.ts#refusals): clean only once the lab is proven', () => {
  it('the --check after not proving the lab: its ERROR and hand line in RESTORE, the state file left dirty; the next run refused naming it', async () => {
    seam.live.chooser = { during: (w) => void (w.st.preferred = 'no preferred block here\n') };
    expect(await go(['--groups', 'chooser'])).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('chooser check after:'))).toMatch(/^chooser check after: ERROR — the preferred activities or the focus not proven clean/);
    const state = join(dirOf('chooser'), 'state.json');
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ dirty: true });
    rmSync(join(out, 'RESTORE.txt'));
    printed.length = 0;
    seam.words.length = 0;
    expect(await labRun({ argv: ['--out', out, '--repo', repo, '--serial', LAB_SERIAL], env: {}, io: { ...io(), clock: () => new Date(2026, 10, 11, 11, 0, 0) } })).toBe(2);
    const said = printed.join('');
    expect(said).toContain(`${state} is dirty (the chooser window not put back):`);
    expect(said).toContain(`  → adb -s <lab emulator> shell dumpsys package preferred (no lab entry with mAlways=true may be left); adb -s <lab emulator> shell pm path dev.averi.lab (installed); then: printf '%s\\n' '{"dirty":false}' > ${state}`);
    expect(seam.words).toEqual([]);
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

describe('the lab block and the run\'s own files', () => {
  it('this run\'s build failing: the lab check INCONCLUSIVE naming it; the live groups run on the APK already installed', async () => {
    fresh({ buildFails: 'gradlew' });
    expect(await go(['--groups', 'forms'])).toBe(0);
    const s = summary();
    expect(s.find((l) => l.startsWith('lab check:'))).toMatch(/^lab check: INCONCLUSIVE — android-build: the Android build failed/);
    expect(s.find((l) => l.startsWith('forms verdict:'))).toMatch(/^forms verdict: PASS/);
  });

  it('the run\'s output is lab-run\'s: meta/lab-run.out', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(existsSync(join(dirOf('meta'), 'lab-run.out'))).toBe(true);
  });
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
      `x verdict: FAIL — r: main's rejudge exit 1: an unknown MISMATCH, a stale chooser premise or a SKIP that proves nothing (${header})`,
    );
  });
});

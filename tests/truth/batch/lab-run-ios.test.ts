import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import {
  IOS_BLOCK_IDS,
  IOS_STANDING,
  iosAskedOf,
  iosBlockId,
  iosLabel,
  iosRunName,
  labRunIos,
  windowStateHand,
} from '../../../scripts/truth/batch/lab-run-ios.js';
import { groupsOf, LAB_RUN_EXIT, onlyWith } from '../../../scripts/truth/batch/lab-run.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, Handlers, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import { CATALOG, LAB_UDID, labWorld, type LabWorld, type WorldOptions } from './lab-fakes.js';

// The standing lab batch on the lab simulator (T24, scripts/truth/batch/lab-run-ios.ts) under runBatch, over the shared
// fake lab (lab-fakes.ts) and a fake process seam that answers git and live.ts — its run and its `--rejudge` — with
// real files in a temp dir, a fixed clock and pid: the blocks' order (the lab, every idb run, then every WebDriverAgent
// run, each in its own D43 window); the guard and the refusals; a simulator not up; a FAIL, an unproven run, a backup
// that fails, a CHANGED finportal key; the interrupt inside a window. Every call is checked for b11-dry's VIOLATIONs
// (afterEach). No device.

const HEAD = 'a'.repeat(40);
const ID = '20261111-101500-4242';
const clock = () => new Date(2026, 10, 11, 10, 15, 0);
const GROUPS = ['forms', 'visibility', 'dismissal', 'ensure'] as const;

/** What a fake live.ts run does, by its run name (`ios-<source>-<group>`). */
interface LiveScript {
  code?: number;
  rejudgeCode?: number;
  noRecord?: boolean;
  rejudgeOut?: string;
  /** A change to the lab while it runs (a health check after it then finds it sick). */
  during?: (w: LabWorld, seam: IosSeam) => void;
}

class IosSeam implements ProcessSeam {
  readonly words: string[] = [];
  readonly exits: number[] = [];
  handlers: Handlers | undefined;
  hang: string | undefined;
  live: Record<string, LiveScript> = {};
  /** `simctl boot` fails from now on (a reset after this point cannot be made). */
  bootFails = false;
  /** `idb disconnect` drops the entry but answers exit 1 from now on: the reset's warning, the lab still fit. */
  disconnectSaysFailed = false;
  private nextPid = 100;
  private readonly ends = new Map<number, (e: Ended) => void>();
  private readonly ended = new Set<number>();
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
      if (args.includes('--rejudge')) {
        const name = at('--rejudge').split('/').at(-1)!.replace(/\.json$/, '');
        const script = this.live[name] ?? {};
        return { code: script.rejudgeCode ?? 0, out: script.rejudgeOut ?? summaryOf(name), err: '' };
      }
      const name = `ios-${at('--sources')}-${at('--groups')}`;
      const script = this.live[name] ?? {};
      // A run under WebDriverAgent starts the lab's runner: it listens on 8120, its exit flips the domains.
      if (at('--sources') === 'wda') this.world.startWda();
      script.during?.(this.world, this);
      if (script.noRecord === true) return { code: script.code ?? 0, out: '', err: '' };
      writeFileSync(at('--record'), '{"results":[]}');
      return { code: script.code ?? 0, out: summaryOf(name), err: '' };
    }
    if (this.disconnectSaysFailed && cmd === 'idb' && args[0] === 'disconnect') {
      this.world.answer(cmd, args, { cwd: options.cwd });
      return { code: 1, out: '', err: 'DisconnectCommandException: Could not disconnect' };
    }
    if (this.bootFails && cmd === 'xcrun' && args[1] === 'boot') return { code: 149, out: '', err: 'Unable to boot device' };
    return this.world.answer(cmd, args, { cwd: options.cwd });
  }
}
const summaryOf = (name: string) => [`${LIVE_GOLDEN_HEADER} 1 cases, 1 ok`, '', `## ${name.split('-')[1]}`, '- ok c1 form-basic: says — fine', ''].join('\n');

const table: LiveTable = async () =>
  ({
    selectCases: async (s) => [{ id: 'c1' }].filter((c) => s.only === undefined || s.only.includes(c.id)),
    catalogOf: async () => ({ cells: [{ id: 'open' }, { id: 'form-basic' }] }),
  }) satisfies LiveCases;

let root: string;
let repo: string;
let out: string;
let seam: IosSeam;
let world: LabWorld;
const printed: string[] = [];
const noWait = async () => {};
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-lab-run-ios-')));
  repo = join(root, 'repo');
  out = join(root, 'out');
  mkdirSync(join(repo, 'fixtures', 'apps', 'ios'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir: root });
  seam = new IosSeam(world);
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
  labRunIos({ argv: ['--out', out, '--repo', repo, '--udid', LAB_UDID, ...argv], env, io: io(), wait: noWait });
/** The live.ts runs, by name (`--rejudge` ones left out). */
const liveRuns = () =>
  seam.words
    .filter((w) => w.includes('live.ts') && !w.includes('--rejudge'))
    .map((w) => {
      const a = w.split(' ');
      return `ios-${a[a.indexOf('--sources') + 1]}-${a[a.indexOf('--groups') + 1]}`;
    });
const outText = () => readFileSync(join(dirOf('meta'), 'lab-run-ios.out'), 'utf8');
const callAt = (text: string, from = 0) => seam.words.findIndex((w, i) => i >= from && w.includes(text));
/** The index of the last call holding `text` before `before` (all calls when not given), or -1. */
const lastCallAt = (text: string, before = Infinity) => {
  let at = -1;
  seam.words.forEach((w, i) => void (i < before && w.includes(text) && (at = i)));
  return at;
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 1500): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; await tick(2)) if (ok()) return;
  throw new Error('the condition never held');
}

describe('lab-run-ios.ts: a clean run — the lab, every idb run, then every WebDriverAgent run in its own window', () => {
  it('every line in the blocks\' order, the finportal key unchanged, RESTORE none; exit 0', async () => {
    expect(await go()).toBe(0);
    const s = summary();
    expect(s.slice(0, 4)).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      "LAB ios: OK — averi-lab iPhone 17 simulator, iOS 27.0, reset; this run's build installed; the installed cells.json is main's",
      "lab check: PASS — every lab need met: ios (each one's LAB line above)",
    ]);
    const verdicts = s.filter((l) => / verdict: /.test(l));
    expect(verdicts).toEqual([
      ...GROUPS.map((g) => `ios idb ${g} verdict: PASS — ios-idb-${g}: main's rejudge exit 0 (${LIVE_GOLDEN_HEADER} 1 cases, 1 ok)`),
      ...GROUPS.map((g) => `ios wda ${g} verdict: PASS — ios-wda-${g}: main's rejudge exit 0 (${LIVE_GOLDEN_HEADER} 1 cases, 1 ok)`),
    ]);
    // Each WebDriverAgent run in its own window: its restore and its compare before its verdict (the SUMMARY prints a
    // line said again once, words.ts#summaryLines: the four windows' equal lines are one; each window's own state below).
    const wdaForms = s.indexOf(verdicts[4]);
    expect(s[wdaForms - 2]).toMatch(/^D43 WDA-window restore: OK/);
    expect(s[wdaForms - 1]).toBe('D43 WDA-window compare: OK — every domain still equals its backup after the end check');
    expect(s).toContain("OK   com.apple.launchservices.schemeapproval's -->sk.finportal.myport unchanged (absent; read only)");
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(liveRuns()).toEqual([...GROUPS.map((g) => `ios-idb-${g}`), ...GROUPS.map((g) => `ios-wda-${g}`)]);
    // Built after the guard; each run asked whole: every case of its group, its one source.
    expect(callAt('xcodebuild')).toBeGreaterThan(callAt('simctl list'));
    expect(JSON.parse(readFileSync(join(dirOf('wda-ensure'), 'ios-wda-ensure.cases'), 'utf8'))).toEqual(iosAskedOf('wda', 'ensure'));
    expect(seam.words.find((w) => w.includes('--groups visibility') && w.includes('--sources idb') && !w.includes('--rejudge'))).toBe(
      `node --import tsx ${join(repo, 'scripts/truth/live.ts')} --udid ${LAB_UDID} --sources idb --groups visibility --record ${join(dirOf('idb-visibility'), 'ios-idb-visibility.json')}`,
    );
    // No idb run inside a window: every idb run before the first backup. Each WDA run between its window's backup and
    // that window's restore (its own key writes or imports), and each backup after the previous window's restore.
    const firstExport = callAt('defaults export');
    expect(lastCallAt('--sources idb --groups')).toBeLessThan(firstExport);
    const restoreAt = (from: number) => seam.words.findIndex((w, i) => i > from && / defaults (write|import) /.test(w));
    let previous = lastCallAt('--sources idb --groups');
    for (const g of GROUPS) {
      const run = callAt(`--sources wda --groups ${g}`);
      const backup = callAt('defaults export', previous);
      const restored = restoreAt(run);
      expect(backup).toBeGreaterThan(previous);
      expect(backup).toBeLessThan(run);
      expect(restoreAt(backup)).toBe(restored);
      expect(restored).toBeGreaterThan(run);
      expect(JSON.parse(readFileSync(join(dirOf(`wda-${g}`), 'state.json'), 'utf8')).dirty).toBe(false);
      previous = restored;
    }
    // The lab's processes ended at the run's end.
    expect(seam.words.slice(-2)).toEqual([`pkill -f idb_companion --udid ${LAB_UDID}`, `idb disconnect ${LAB_UDID}`]);
    expect(seam.exits).toEqual([0]);
    // Its output is lab-run-ios's; no check left a warning, so no run's WARN step.
    expect(outText()).not.toMatch(/WARN ios-/);
  });

  it('--groups forms: the idb forms run, then the wda forms run in its window; nothing else', async () => {
    expect(await go(['--groups', 'forms'])).toBe(0);
    expect(liveRuns()).toEqual(['ios-idb-forms', 'ios-wda-forms']);
    expect(summary().filter((l) => / verdict: /.test(l))).toHaveLength(2);
    expect(existsSync(join(out, 'idb-visibility'))).toBe(false);
  });

  it('ONLY=lab,idb-forms: the idb forms run alone, no window', async () => {
    expect(await go([], { ONLY: 'lab,idb-forms' })).toBe(0);
    expect(liveRuns()).toEqual(['ios-idb-forms']);
    expect(seam.words.some((w) => w.includes('defaults export'))).toBe(false);
  });
});

describe('the refusals, the guard and a simulator not up: nothing done to a device that is not the lab simulator', () => {
  it('no udid: refused before anything is done, exit 2', async () => {
    expect(await labRunIos({ argv: ['--out', out, '--repo', repo], env: {}, io: io() })).toBe(2);
    expect(printed.join('')).toContain('no lab simulator udid given (--udid or AVERI_LAB_UDID): lab-run-ios runs on the lab simulator only');
    expect(seam.words).toEqual([]);
  });

  it('the udid from AVERI_LAB_UDID is taken', async () => {
    expect(await labRunIos({ argv: ['--out', out, '--repo', repo, '--groups', 'forms'], env: { AVERI_LAB_UDID: LAB_UDID }, io: io(), wait: noWait })).toBe(0);
  });

  it.each([
    [['--groups', 'carousel'], "--groups names 'carousel', which is no group of lab-run-ios (forms, visibility, dismissal, ensure)"],
    [['--groups'], '--groups needs a value (forms, visibility, dismissal, ensure, or several joined by commas)'],
  ])('%j is refused: exit 2, nothing done', async (argv, why) => {
    expect(await go(argv)).toBe(2);
    expect(printed.join('')).toContain(why);
    expect(seam.words).toEqual([]);
  });

  it('a refusal holds its own lines only: a bad group under ONLY=lab is said alone; with the config\'s error, both', async () => {
    expect(await go(['--groups', 'x'], { ONLY: 'lab' })).toBe(2);
    expect(printed.join('').split('\n').filter((l) => l !== '')).toHaveLength(1);
    printed.length = 0;
    expect(await labRunIos({ argv: ['--repo', repo, '--groups', 'x'], env: {}, io: io() })).toBe(2);
    expect(printed.join('')).toMatch(/no out folder[\s\S]*--groups names 'x'/);
  });

  it('ONLY=lab selects no live run: refused, exit 2', async () => {
    expect(await go([], { ONLY: 'lab' })).toBe(2);
    expect(printed.join('')).toContain('ONLY=lab selects no live group of lab-run-ios (forms, visibility, dismissal, ensure): a standing run that runs none proves nothing');
  });

  it('a WDA window an earlier run left dirty: refused naming it and its hand line, exit 2, nothing done', async () => {
    const file = join(out, 'wda-forms', 'run-20261110-090000-1', 'state.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{"dirty":true}');
    expect(await go(['--groups', 'visibility'])).toBe(2);
    expect(printed.join('')).toContain(`${file} is dirty (the WDA window not put back):`);
    expect(printed.join('')).toContain(`xcrun simctl spawn ${LAB_UDID} defaults import <domain>`);
    expect(seam.words).toEqual([]);
  });

  it('a simulator not named averi-lab: refused by the guard before any other call, every block INCONCLUSIVE, nothing built or run; exit 2 (nothing ran)', async () => {
    fresh({ simName: 'iPhone 17' });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.nothingDone);
    const s = summary();
    expect(s.find((l) => l.startsWith('ios idb forms verdict:'))).toMatch(/^ios idb forms verdict: INCONCLUSIVE — ios: the lab guard refused/);
    expect(s.find((l) => l.startsWith('ios wda forms verdict:'))).toMatch(/^ios wda forms verdict: INCONCLUSIVE — ios: the lab guard refused/);
    expect(liveRuns()).toEqual([]);
    expect(world.calls.filter((c) => c.startsWith('xcrun '))).toEqual(['xcrun simctl list devices -j']);
    expect(seam.words.some((w) => w.includes('xcodebuild') || w.includes('catalog.ts'))).toBe(false);
  });

  it('the simulator does not boot: the ios need not met, every block INCONCLUSIVE, nothing ran; exit 2', async () => {
    fresh({ bootFails: true });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.nothingDone);
    expect(summary().find((l) => l.startsWith('LAB ios:'))).toMatch(/initial iOS reset failed: simctl boot: exit 149/);
    expect(liveRuns()).toEqual([]);
  });
});

describe('the verdicts and the exit code: 0 only when every wanted block PASSed', () => {
  it('a rejudge exit 1 on an unknown MISMATCH: the block FAILs naming it, exit 1', async () => {
    const said = [`${LIVE_GOLDEN_HEADER} 1 cases, 0 ok, 0 loud, 1 mismatches (1 not known), 0 skipped`, '', '## wda', '- MISMATCH (claim) c1 form-basic: says — filled nothing', ''].join('\n');
    seam.live['ios-wda-forms'] = { code: 1, rejudgeCode: 1, rejudgeOut: said };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.failed);
    expect(summary()).toContain(`ios wda forms verdict: FAIL — ios-wda-forms: main's rejudge exit 1 — MISMATCH c1 (${LIVE_GOLDEN_HEADER} 1 cases, 0 ok, 0 loud, 1 mismatches (1 not known), 0 skipped)`);
  });

  it('an idb run past its bound (no record): INCONCLUSIVE from the backstop; the wda run still in its window; unproven, exit 3', async () => {
    seam.live['ios-idb-forms'] = { code: 142, noRecord: true };
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    const s = summary();
    expect(s.find((l) => l.startsWith('ios idb forms verdict:'))).toMatch(/^ios idb forms verdict: INCONCLUSIVE/);
    expect(s.find((l) => l.startsWith('ios wda forms verdict:'))).toMatch(/^ios wda forms verdict: PASS/);
  });

  it('the backup fails (d43-backupfail): the wda block INCONCLUSIVE naming why, nothing changed, no wda run; exit 3', async () => {
    fresh({ exportFails: 'com.apple.Preferences' });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('ios wda forms verdict:'))).toMatch(/^ios wda forms verdict: INCONCLUSIVE — the WDA window did not run: the simulator domains could not be backed up/);
    expect(liveRuns()).toEqual(['ios-idb-forms']);
    // Its run asked before the window, so the backstop can say it never ran.
    expect(JSON.parse(readFileSync(join(dirOf('wda-forms'), 'ios-wda-forms.cases'), 'utf8'))).toEqual(iosAskedOf('wda', 'forms'));
  });

  it('the lab sick after the first run and no reset possible: the next idb block and the window INCONCLUSIVE naming why, no run; exit 3', async () => {
    seam.live['ios-idb-forms'] = { during: (w, sm) => ((w.st.sick = 'swipe'), (sm.bootFails = true)) };
    expect(await go(['--groups', 'forms,visibility'])).toBe(LAB_RUN_EXIT.unproven);
    const s = summary();
    expect(s.find((l) => l.startsWith('ios idb forms verdict:'))).toMatch(/^ios idb forms verdict: PASS/);
    expect(s.find((l) => l.startsWith('ios idb visibility verdict:'))).toBe(
      'ios idb visibility verdict: INCONCLUSIVE — the iOS reset before ios-idb-visibility failed: simctl boot: exit 149 Unable to boot device — no idb run',
    );
    expect(s.find((l) => l.startsWith('ios wda forms verdict:'))).toMatch(/^ios wda forms verdict: INCONCLUSIVE — the WDA window did not run: the iOS reset before the WDA window failed/);
    expect(liveRuns()).toEqual(['ios-idb-forms']);
  });

  it("a check's reset leaving a warning (the companion entry may be stale): the run's WARN step names it, its verdict stands; exit 0", async () => {
    // The lab sick after a run: the next check resets, and the companion entry's drop answers a failure.
    seam.live['ios-idb-forms'] = { during: (w, sm) => ((w.st.sick = 'swipe'), (sm.disconnectSaysFailed = true)) };
    seam.live['ios-idb-visibility'] = { during: (w) => (w.st.sick = 'swipe') };
    expect(await go(['--groups', 'forms,visibility'])).toBe(0);
    const said = "idb's companion entry may be stale — idb disconnect: exit 1 DisconnectCommandException: Could not disconnect";
    expect(outText()).toContain(`WARN ios-idb-visibility: ${said}`);
    // The window's own check after the visibility run (sick again): its warning said under the wda run's name.
    expect(outText()).toContain(`WARN ios-wda-forms: ${said}`);
    expect(outText()).not.toContain('WARN ios-idb-forms');
    expect(outText()).not.toContain('WARN ios-wda-visibility');
    expect(summary().filter((l) => / verdict: /.test(l)).every((l) => / verdict: PASS/.test(l))).toBe(true);
  });

  it("this run's build failing: the lab check WARNs naming it, the runs on the app already installed; unproven, exit 3", async () => {
    fresh({ buildFails: 'xcodebuild' });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.unproven);
    expect(summary().find((l) => l.startsWith('lab check:'))).toMatch(/^lab check: WARN — the lab devices checked, but this run's build failed \(ios-build: the iOS build failed/);
    expect(liveRuns()).toEqual(['ios-idb-forms', 'ios-wda-forms']);
  });

  it('a late writer after a restore: the compare WARN, its hand lines in RESTORE, exit 1', async () => {
    fresh({ lateFlip: true });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.failed);
    expect(summary().find((l) => l.startsWith('D43 WDA-window compare:'))).toMatch(/^D43 WDA-window compare: WARN — com\.apple\.Accessibility/);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(true);
  });

  it('the finportal key CHANGED between the stretch\'s start and end: a FAIL line from the ios need\'s end, exit 1', async () => {
    fresh({ finportal: '1', finportalEnd: '2' });
    expect(await go(['--groups', 'forms'])).toBe(LAB_RUN_EXIT.failed);
    expect(summary().find((l) => l.includes('finportal'))).toMatch(/^FAIL .*CHANGED: 1 at the start, 2 at the end/);
  });

  it('SIGINT during a wda run: the window put back by the abort, verified; exit 130', async () => {
    seam.hang = '--sources wda --groups forms --record';
    const done = go(['--groups', 'forms']);
    await until(() => seam.words.some((w) => w.includes('--sources wda --groups forms --record')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(LAB_RUN_EXIT.interrupted);
    expect(seam.exits).toEqual([130]);
    const s = summary();
    expect(s.find((l) => l.startsWith('ios idb forms verdict:'))).toMatch(/^ios idb forms verdict: PASS/);
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(JSON.parse(readFileSync(join(dirOf('wda-forms'), 'state.json'), 'utf8')).dirty).toBe(false);
    expect(world.domains.get('com.apple.Accessibility')!.ApplicationAccessibilityEnabled).toEqual({ t: 'bool', c: 'true', v: 'true' });
  });
});

describe('the names and the selection words', () => {
  it('the blocks in the batch\'s order: the lab, every idb run, then every wda run', () => {
    expect(IOS_BLOCK_IDS).toEqual(['lab', ...GROUPS.map((g) => `idb-${g}`), ...GROUPS.map((g) => `wda-${g}`)]);
    expect([iosBlockId('wda', 'ensure'), iosRunName('idb', 'forms'), iosLabel('wda', 'dismissal')]).toEqual(['wda-ensure', 'ios-idb-forms', 'ios wda dismissal verdict']);
    expect(iosAskedOf('idb', 'visibility')).toEqual({ platform: 'ios', app: 'native', sources: ['idb'], cases: [], groups: ['visibility'] });
  });

  it('a group selects its idb block and its wda block; ONLY within them', () => {
    expect(onlyWith(['forms', 'ensure'], undefined, IOS_STANDING)).toEqual({ only: 'lab,idb-forms,wda-forms,idb-ensure,wda-ensure' });
    expect(onlyWith(['forms'], 'wda-forms,idb-ensure', IOS_STANDING)).toEqual({ only: 'wda-forms' });
    expect(onlyWith(['forms'], 'idb-ensure', IOS_STANDING)).toEqual({ why: expect.stringContaining('leave no block of lab-run-ios to run') });
    expect(groupsOf(['--groups', 'forms,dismissal', '--out', 'x'], IOS_STANDING)).toEqual({ named: ['forms', 'dismissal'], rest: ['--out', 'x'], errors: [] });
  });

  it('windowStateHand: the import per domain, the compare by hand, the file written clean; a udid not given said so', () => {
    expect(windowStateHand(LAB_UDID, '/w/out/wda-forms/run-1/state.json')).toBe(
      `  → the WDA window's settings not put back: for each domain in /w/out/wda-forms/run-1/state.json, xcrun simctl spawn ${LAB_UDID} defaults import <domain> <its backup beside the file>; compare them by hand; then: printf '%s\\n' '{"dirty":false}' > /w/out/wda-forms/run-1/state.json`,
    );
    expect(windowStateHand(undefined, 'x')).toContain('xcrun simctl spawn <the lab simulator: --udid or AVERI_LAB_UDID> defaults import');
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asked } from '../../../scripts/truth/batch/cases.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { NEED_END_SECS, runBatch, type Block, type NeedCheck as NeedCtxCheck, type NeedCtx, type NeedEndCtx, type NeedSpec, type RunBatchOptions, type RunIo } from '../../../scripts/truth/batch/runner.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import type { KnobSpec } from '../../../scripts/truth/batch/select.js';
import { BATCH_FAKE_MS, advanceUntil, onFakeTime } from './fake-time.js';

// scripts/truth/batch/runner.ts: runBatch over a fake process seam — git, the probes and live.ts answered by rules —
// with real files in a temp dir, a fixed clock and pid, and a fake live-cases table: no process started, no device.
// A fake two-block batch (one iOS block, one Android) yields the whole SUMMARY; then each rule of the order: the
// refusals, the lab folder, the preconditions and needs (INCONCLUSIVE, never refused), the backstop, the ERROR lines,
// RESTORE and the exit code, the abort, the non-live records and live_run. The real signals are
// tests/truth/batch/runner-proc.test.ts. The titles name the fix and the batch or review that found it.

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ID = '20261105-094426-4242';
const clock = () => new Date(2026, 10, 5, 9, 44, 26);

interface Answer {
  code?: number;
  out?: string;
  err?: string;
  /** Written to the call's log fd (Call.log) as it starts. */
  log?: string;
  /** Files the call writes. */
  files?: Record<string, string>;
  /** It runs until its group is signalled. */
  hang?: boolean;
  /** Something of its group outlives its leader (a daemon: idb_companion) until the group is signalled. */
  leaves?: boolean;
}
type Rule = (cmd: string, args: readonly string[]) => Answer | undefined;

/** A fake seam: each call answered by the first rule that knows it (git, the probes, live.ts); every call recorded. */
class FakeSeam implements ProcessSeam {
  readonly calls: { cmd: string; args: readonly string[]; cwd?: string; at: number }[] = [];
  handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void } | undefined;
  readonly exits: number[] = [];
  readonly said: string[] = [];
  private readonly ends = new Map<number, (e: Ended) => void>();
  private readonly ended = new Set<number>();
  private readonly left = new Set<number>();
  /** Each signal sent, `<signal> <command>`. */
  readonly signals: string[] = [];
  private nextPid = 100;
  /** What a call saw when it started: whether each named file was there. */
  readonly seen: Record<string, boolean>[] = [];
  watch: string[] = [];
  constructor(public rules: Rule[]) {}

  start(cmd: string, args: readonly string[], options: StartOptions): Started {
    this.calls.push({ cmd, args, cwd: options.cwd, at: this.calls.length });
    this.seen.push(Object.fromEntries(this.watch.map((f) => [f, existsSync(f)])));
    let a: Answer | undefined;
    for (const r of this.rules) if ((a = r(cmd, args)) !== undefined) break;
    if (a === undefined) throw new Error(`no answer for ${cmd} ${args.join(' ')}`);
    if (a.log !== undefined && options.logFd !== undefined) writeSync(options.logFd, a.log);
    for (const [path, text] of Object.entries(a.files ?? {})) writeFileSync(path, text);
    const pid = this.nextPid++;
    if (a.leaves === true) this.left.add(pid);
    let end!: (e: Ended) => void;
    const exited = new Promise<Ended>((r) => (end = r));
    this.ends.set(pid, (e) => {
      this.ended.add(pid);
      end(e);
    });
    if (a.hang !== true) this.ends.get(pid)!({ code: a.code ?? 0, signal: null });
    const answer = a;
    return { pid, exited, closed: exited.then(() => {}), out: () => answer.out ?? '', err: () => answer.err ?? '', release: () => {} };
  }
  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult {
    if (signal !== 0 && (this.left.has(pid) || !this.ended.has(pid))) this.signals.push(`${signal} ${this.calls[pid - 100].cmd} ${this.calls[pid - 100].args.join(' ')}`);
    if (this.left.has(pid)) {
      if (signal !== 0) this.left.delete(pid);
      return 'sent';
    }
    if (this.ended.has(pid)) return 'gone';
    if (signal !== 0) this.ends.get(pid)?.({ code: null, signal });
    return 'sent';
  }
  install(handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void }): void {
    this.handlers = handlers;
  }
  exit(code: number): void {
    this.exits.push(code);
  }
  stderr(text: string): void {
    this.said.push(text);
  }
  /** The words of each call: `git <args after -C repo>`, or the command and its args. */
  words(): string[] {
    return this.calls.map((c) => (c.cmd === 'git' ? `git ${c.args.slice(2).join(' ')}` : [c.cmd === process.execPath ? 'node' : c.cmd, ...c.args].join(' ')));
  }
}

const ok = (out = ''): Answer => ({ out });
/** git, as a clean checkout at main answers it; `over` answers first. */
const git =
  (over: Record<string, Answer> = {}): Rule =>
  (cmd, args) => {
    if (cmd !== 'git') return undefined;
    const said = args.slice(2).join(' ');
    const hit = Object.entries(over).find(([words]) => said.includes(words));
    if (hit !== undefined) return hit[1];
    if (said === 'rev-parse --show-toplevel') return ok(`${nodeFs.real(args[1])}\n`);
    if (said.startsWith('rev-parse --verify')) return ok(`${HEAD}\n`);
    if (said.includes('status')) return ok('');
    if (said.startsWith('cat-file') || said.startsWith('merge-base')) return ok();
    return undefined;
  };

const casesSummary = (ids: readonly string[]) => [`${LIVE_GOLDEN_HEADER} ${ids.length} cases, ${ids.length} ok`, '', '## uiautomator', ...ids.map((id) => `- ok ${id} form-basic: says — fine`), ''].join('\n');
/**
 * live.ts as a fake: `--record` writes its log (with the golden header, unless `code` 1 says it died) and its record;
 * `--rejudge` writes the summary. `noRecord`: it writes none.
 */
const live =
  ({ code = 0, header = true, noRecord = false, logExtra = '', rejudge }: { code?: number; header?: boolean; noRecord?: boolean; logExtra?: string; rejudge?: Answer } = {}): Rule =>
  (cmd, args) => {
    if (cmd !== process.execPath || !args.some((a) => a.endsWith('live.ts'))) return undefined;
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    if (args.includes('--rejudge')) return rejudge ?? { log: casesSummary(['kf1', 'kf2', 'kf3']) };
    const cases = args.includes('--cases') ? at('--cases').split(',') : [];
    return { code, log: `${header ? casesSummary(cases) : 'live.ts: started\n'}${logExtra}`, files: noRecord ? {} : { [at('--record')]: '{"platform":"android","results":[]}' } };
  };
/** A probe: `probe <name>` exits 0, `hang` runs until stopped; `idb …` leaves its companion in its group. */
const probes: Rule = (cmd, args) => {
  if (cmd === 'idb') return { leaves: true };
  return cmd === 'probe' ? (args[0] === 'hang' ? { hang: true } : ok(`${args[0]} done\n`)) : undefined;
};

const table: LiveTable = async () =>
  ({
    selectCases: async (s) => ['kf1', 'kf2', 'kf3', 'p7w'].filter((id) => s.only === undefined || s.only.includes(id)).map((id) => ({ id })),
    catalogOf: async () => ({ cells: [{ id: 'open' }, { id: 'form-basic' }] }),
  }) satisfies LiveCases;

let root: string;
let repo: string;
let out: string;
let seam: FakeSeam;
let terminal: string[];
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-runner-')));
  repo = join(root, 'repo');
  out = join(root, 'out');
  mkdirSync(repo);
  seam = new FakeSeam([git(), probes, live()]);
  terminal = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
// A test hung past vitest's timeout leaves no fake timers or Date to the next (T2c; fake-time.ts).
afterEach(() => void vi.useRealTimers());

const dirOf = (block: string) => join(out, block, `run-${ID}`);
const text = (p: string) => readFileSync(p, 'utf8');
const summary = () => text(join(dirOf('meta'), 'summary.txt')).split('\n').slice(0, -1);
const outText = () => text(join(dirOf('meta'), 'batch-t.out'));
const KF: Asked = { platform: 'android', app: 'native', sources: ['uiautomator'], cases: ['kf1', 'kf2', 'kf3'] };

const needs = {
  android: async () => ({ ok: true as const, how: 'emulator-5554, averi_lab' }),
  ios: async () => ({ ok: true as const, how: 'averi-lab iPhone 17' }),
};

function go(blocks: Block[], over: Partial<Pick<RunBatchOptions<KnobSpec>, 'knobs' | 'needs' | 'batchReasons' | 'lastly'>> & { env?: Record<string, string>; argv?: string[]; io?: Partial<RunIo> } = {}): Promise<number> {
  const { env = {}, argv = ['--out', out, '--repo', repo, '--serial', 'emulator-5554', '--udid', 'U-1'], io, ...rest } = over;
  return runBatch({
    name: 'batch-t',
    blocks,
    needs,
    config: { ok: true, config: configFrom(argv, env) },
    io: { fs: nodeFs, seam, terminal: (t) => void terminal.push(t), clock, pid: 4242, table, graceMs: 5, ...io },
    ...rest,
  });
}
/** argv as configOf reads it, without its checks (they are runner-lines.test.ts's). */
function configFrom(argv: string[], env: Record<string, string>) {
  const at = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const [udid, serial] = [at('--udid'), at('--serial')];
  return { out: at('--out')!, repo: at('--repo')!, ...(udid === undefined ? {} : { udid }), ...(serial === undefined ? {} : { serial }), env };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 1000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; await tick(2)) if (ok()) return;
  throw new Error('the condition never held');
}
/** `go` inside onFakeTime (fake-time.ts, T2c): fake time advanced until the batch has ended. */
async function goFaked(...args: Parameters<typeof go>): Promise<number> {
  let ended: { code: number } | { error: unknown } | undefined;
  void go(...args).then((code) => void (ended = { code }), (error: unknown) => void (ended = { error }));
  await advanceUntil(() => ended !== undefined, BATCH_FAKE_MS, 'the batch did not end');
  const e = ended!; // advanceUntil threw unless the batch ended
  if ('error' in e) throw e.error;
  return e.code;
}

// ------------------------------------------------------------------------------------------------ the whole batch

const COMPARE_WARN = 'D43 WDA-window compare: WARN — com.apple.Accessibility: ApplicationAccessibilityEnabled bool false → int 0 — the state file marked dirty again; the hand lines are in RESTORE';
const LATE_HAND = 'D43 (iOS, changed after the restore — a late writer): xcrun simctl spawn U-1 defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool false';
const PROTECTED = "OK   com.apple.launchservices.schemeapproval's finportal key unchanged (no batch writes it)";

const kfBlock = (over: Partial<Block> = {}): Block => ({
  id: 'kf',
  label: 'kf live verdict',
  needs: ['android'],
  run: async (ctx) => void (await ctx.liveRun('android-kf-1', KF, { secs: 60 })),
  judge: async () => ['kf live kf1: PASS', 'kf live verdict: PASS — kf1, kf2, kf3 ok'],
  details: [{ file: 'android-kf-1.rejudge.txt', match: /^- / }],
  ...over,
});
const d43Block = (over: Partial<Block> = {}): Block => ({
  id: 'D43',
  label: 'D43 live verdict',
  needs: ['ios'],
  run: async (ctx) => {
    ctx.open('D43 WDA window', { hand: ['D43 (iOS): import the backups'], restore: async () => ({ ok: true, how: 'read back' }) });
    await ctx.bounded('probe', ['d43'], { secs: 5 });
    ctx.close('D43 WDA window');
    ctx.verdictAndHand({ line: COMPARE_WARN, hand: [LATE_HAND] });
    ctx.verdict('PASS', 'p7w ok under wda');
    ctx.protectedLine(PROTECTED);
  },
  ...over,
});

describe('a fake two-block batch, one Android and one iOS block: the whole SUMMARY (spec T2 S6; batch-11.sh:718–735)', () => {
  it('checkout, lab lines in the order checked, each block\'s verdicts, the protected-key line, RESTORE, this run\'s ERRORs; exit 1 for the RESTORE', async () => {
    seam.rules = [git(), probes, live({ logExtra: 'ERROR the lab app did not launch on the first try\n' })];
    const code = await go([kfBlock(), d43Block()]);
    expect(code).toBe(1);
    expect(seam.exits).toEqual([1]);
    const restore = join(out, 'RESTORE.txt');
    expect(summary()).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      'LAB android: OK — emulator-5554, averi_lab',
      'LAB ios: OK — averi-lab iPhone 17',
      'kf live kf1: PASS',
      'kf live verdict: PASS — kf1, kf2, kf3 ok',
      COMPARE_WARN,
      'D43 live verdict: PASS — p7w ok under wda',
      PROTECTED,
      `RESTORE: state not provably put back — ${restore}:`,
      `batch-t run ${ID} left by D43 at 2026-11-05 09:44:26; state to put back by hand:`,
      LATE_HAND,
      `09:44:26 ERROR D43: state not provably put back — the hand commands are in ${restore}`,
      'ERROR the lab app did not launch on the first try',
      `======== SUMMARY end (run ${ID})`,
    ]);
    expect(text(restore)).toBe(`batch-t run ${ID} left by D43 at 2026-11-05 09:44:26; state to put back by hand:\n${LATE_HAND}\n`);
    expect(terminal.at(-1)).toBe(`${summary().join('\n')}\n`);
  });

  it('the order: the checkout, each block in the batch\'s order, the judge after every block ran, the details, then the SUMMARY', async () => {
    await go([kfBlock(), d43Block()]);
    expect(seam.words()).toEqual([
      'git rev-parse --show-toplevel',
      `git rev-parse --verify HEAD^{commit}`,
      'git rev-parse --verify refs/heads/main^{commit}',
      'git --no-optional-locks status --porcelain -z --untracked-files=no',
      `node --import tsx ${join(repo, 'scripts/truth/live.ts')} --serial emulator-5554 --groups forms --cases kf1,kf2,kf3 --record ${join(dirOf('kf'), 'android-kf-1.json')}`,
      `node --import tsx ${join(repo, 'scripts/truth/live.ts')} --rejudge ${join(dirOf('kf'), 'android-kf-1.json')} --groups forms`,
      'probe d43',
    ]);
    const o = outText();
    const at = (s: string) => o.indexOf(s);
    expect(at('== kf (')).toBeGreaterThan(at("OK checkout: main's HEAD aaaaaaaa, clean"));
    expect(at('== D43 (')).toBeGreaterThan(at('== kf ('));
    expect(at('================================ details')).toBeGreaterThan(at('== D43 ('));
    expect(at('======== SUMMARY')).toBeGreaterThan(at('================================ details'));
  });

  it('the details before the SUMMARY: this run\'s steps and each block\'s detail lines (batch-11.sh:698–716)', async () => {
    await go([kfBlock(), d43Block()]);
    const o = outText().split('\n');
    const from = o.indexOf('================================ details ================================');
    const details = o.slice(from, o.indexOf('======== SUMMARY'));
    expect(details[1]).toBe("OK checkout: main's HEAD aaaaaaaa, clean");
    expect(details[2]).toBe(`-- steps of this run (${ID}; the whole log: ${join(out, 'steps.log')})`);
    expect(details[3]).toBe(`09:44:26 ---- batch-t run ${ID}, blocks kf,D43`);
    expect(details).toContain(`-- kf (${dirOf('kf')}/)`);
    expect(details.slice(details.indexOf(`-- kf (${dirOf('kf')}/)`) + 1, details.indexOf(`-- D43 (${dirOf('D43')}/)`))).toEqual(['   - ok kf1 form-basic: says — fine', '   - ok kf2 form-basic: says — fine', '   - ok kf3 form-basic: says — fine']);
    expect(details).toContain(`== DONE — all outputs in ${out}/<block>/run-${ID} ==`);
  });

  it('each block\'s verdict lines kept in its verdict.txt too, as batch-11\'s verdict() tee\'d them', async () => {
    await go([kfBlock(), d43Block()]);
    expect(text(join(dirOf('D43'), 'verdict.txt'))).toBe(`${COMPARE_WARN}\nD43 live verdict: PASS — p7w ok under wda\n`);
    expect(text(join(dirOf('kf'), 'verdict.txt'))).toBe('kf live kf1: PASS\nkf live verdict: PASS — kf1, kf2, kf3 ok\n');
  });
});

// ------------------------------------------------------------------------------------------------ before the run

const plain = (id: string, over: Partial<Block> = {}): Block => ({ id, label: `${id} verdict`, needs: [], run: async (ctx) => ctx.verdict('PASS'), ...over });

describe('refused to start: exit 2, nothing done — no folder, no call (batch-10/11; S1\'s select and run-dir)', () => {
  it('a knob that breaks its rule: its error, before any refusal is read', async () => {
    mkdirSync(out);
    writeFileSync(join(out, 'RESTORE.txt'), 'old hand line\n');
    const knobs = { counts: { KF_RUNS: { default: 1, min: 1 } } };
    expect(await go([plain('kf')], { knobs, env: { KF_RUNS: '0' } })).toBe(2);
    expect(terminal).toEqual(['ERROR KF_RUNS=0: a whole number >= 1 is needed — nothing was done\n']);
    expect(seam.exits).toEqual([2]);
    expect(seam.calls).toEqual([]);
    expect(existsSync(join(out, 'meta'))).toBe(false);
  });

  it('the config read with errors (no out folder): its lines, exit 2', async () => {
    const code = await runBatch({ name: 'batch-t', blocks: [plain('kf')], config: { ok: false, errors: ['ERROR no out folder: pass --out <dir> or set AVERI_BATCH_OUT — nothing was done'] }, io: { seam, terminal: (t) => void terminal.push(t) } });
    expect(code).toBe(2);
    expect(terminal).toEqual(['ERROR no out folder: pass --out <dir> or set AVERI_BATCH_OUT — nothing was done\n']);
  });

  it('ONLY= naming no block: refused; a name that is no block a WARN in the run\'s log', async () => {
    expect(await go([plain('kf')], { env: { ONLY: 'zz' } })).toBe(2);
    expect(terminal.join('')).toContain('ERROR ONLY=zz names no block of this batch — nothing was done');
    terminal.length = 0;
    expect(await go([plain('kf'), plain('E5')], { env: { ONLY: 'E5,zz' } })).toBe(0);
    expect(outText()).toContain("WARN ONLY names 'zz', which is not a block of this batch (kf, E5): ignored");
    expect(summary()).toContain('E5 verdict: PASS');
    expect(summary()).not.toContain('kf verdict: PASS');
    expect(existsSync(dirOf('kf'))).toBe(false);
  });

  it('a RESTORE left by an earlier run: refused with its hand lines (batch-10.sh:86–94)', async () => {
    mkdirSync(out);
    writeFileSync(join(out, 'RESTORE.txt'), 'D55 (Android): adb -s emulator-5554 install x.apk\n');
    expect(await go([plain('kf')])).toBe(2);
    const said = terminal.join('');
    expect(said).toContain('ERROR batch-t refuses to start — nothing was done:\n');
    expect(said).toContain('D55 (Android): adb -s emulator-5554 install x.apk\n');
    expect(seam.calls).toEqual([]);
    expect(existsSync(join(out, 'meta'))).toBe(false);
  });

  it('an earlier run\'s state file not clean: refused with the block\'s own hand lines (batch-11.sh:111–112)', async () => {
    mkdirSync(join(out, 'E5', 'run-old'), { recursive: true });
    writeFileSync(join(out, 'E5', 'run-old', 'state.json'), '{"dirty":true}');
    const stateful = { what: 'E5 not put back', hand: (f: string) => [`  → node e5.ts --restore --state ${f}`] };
    expect(await go([plain('E5', { stateful })])).toBe(2);
    expect(terminal.join('')).toContain(`${join(out, 'E5', 'run-old', 'state.json')} is dirty (E5 not put back):\n  → node e5.ts --restore --state ${join(out, 'E5', 'run-old', 'state.json')}\n`);
  });

  it('a run folder of this run\'s id already there: refused, nothing written into it (S1: never reused)', async () => {
    mkdirSync(dirOf('kf'), { recursive: true });
    expect(await go([plain('kf')])).toBe(2);
    expect(terminal).toEqual([`ERROR the run folder ${dirOf('kf')} already exists — nothing was done\n`]);
    expect(existsSync(dirOf('meta'))).toBe(false);
  });

  it('an out folder that cannot be made (EPERM: the sandbox): refused, exit 2, its line on the terminal — never a stack trace, no SUMMARY, no call (T2b batch-13 gap 7)', async () => {
    const fs = { ...nodeFs, mkdirExclusive: () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } };
    expect(await go([plain('kf')], { io: { fs } })).toBe(2);
    expect(terminal).toEqual([`ERROR the run folder ${dirOf('meta')} cannot be made (EPERM); made before it: none — nothing was done\n`]);
    expect(seam.exits).toEqual([2]);
    expect(seam.calls).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });

  it('a block that is not stateful: an earlier state file in its folder is not its to read, so no refusal', async () => {
    mkdirSync(join(out, 'E5', 'run-old'), { recursive: true });
    writeFileSync(join(out, 'E5', 'run-old', 'state.json'), '{"dirty":true}');
    expect(await go([plain('E5')])).toBe(0);
  });

  it('the batch\'s own reasons refuse too (batch-12\'s pre-D62 worktree)', async () => {
    expect(await go([plain('kf')], { batchReasons: ['the pre-D62 worktree is still registered'] })).toBe(2);
    expect(terminal.join('')).toContain('the pre-D62 worktree is still registered\n');
  });

  it('an out folder inside the checkout: refused (analysis §5)', async () => {
    expect(await go([plain('kf')], { argv: ['--out', join(repo, 'o'), '--repo', repo] })).toBe(2);
    expect(terminal.join('')).toContain(`the out folder ${join(repo, 'o')} lies inside the checkout ${repo}`);
  });

  it('the batch\'s own mistakes are thrown before anything: a block naming a need with no check, an id twice, a label with a colon', async () => {
    await expect(go([plain('kf', { needs: ['tv'] })])).rejects.toThrow('kf needs tv, which has no check (needs: android, ios)');
    await expect(go([plain('kf'), plain('kf')])).rejects.toThrow('block kf is named twice');
    await expect(go([plain('kf', { label: 'kf: x' })])).rejects.toThrow('holds a colon');
    await expect(go([plain('k f')])).rejects.toThrow('block name "k f": one plain path segment, not "meta", is needed');
    await expect(go([plain('meta')])).rejects.toThrow('block name "meta": one plain path segment, not "meta", is needed');
    await expect(runBatch({ name: 'batch-t', blocks: [plain('kf'), plain('kf')], config: { ok: false, errors: ['ERROR x — nothing was done'] }, io: { seam, terminal: (t) => void terminal.push(t) } })).rejects.toThrow('block kf is named twice');
    await expect(runBatch({ name: 'batch-t', blocks: [plain('meta')], config: { ok: false, errors: ['ERROR x — nothing was done'] }, io: { seam, terminal: (t) => void terminal.push(t) } })).rejects.toThrow('block name "meta"');
    expect(terminal).toEqual([]);
    expect(seam.calls).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });
});

describe('the run\'s folders: one fresh run-<id> per wanted block, and the lab folder on every run (batch-11.sh:116–121)', () => {
  it('with no clock or pid given, the run\'s id is now\'s and this process\'s (`date +%Y%m%d-%H%M%S`-$$)', async () => {
    await runBatch({ name: 'batch-t', blocks: [plain('kf')], config: { ok: true, config: configFrom(['--out', out, '--repo', repo], {}) }, io: { seam, terminal: (t) => void terminal.push(t), table, graceMs: 5 } });
    const [run] = nodeFs.list(join(out, 'meta'));
    expect(run).toMatch(new RegExp(`^run-${new Date().getFullYear()}\\d{4}-\\d{6}-${process.pid}$`));
  });

  it('meta, lab and each wanted block\'s folder made; an unwanted block gets none', async () => {
    await go([plain('kf'), plain('E5')], { env: { ONLY: 'kf' } });
    expect([dirOf('meta'), dirOf('lab'), dirOf('kf')].map(existsSync)).toEqual([true, true, true]);
    expect(existsSync(dirOf('E5'))).toBe(false);
  });

  it('a block named lab (batch-11 and batch-12 had one) is that folder; made even when not wanted', async () => {
    let seen: { dir: string; lab: string } | undefined;
    await go([plain('lab', { run: async (ctx) => void (seen = { dir: ctx.dir, lab: ctx.labDir }) }), plain('kf')], { env: { ONLY: 'kf' } });
    expect(existsSync(dirOf('lab'))).toBe(true);
    seen = undefined;
    await go([plain('lab', { run: async (ctx) => void (seen = { dir: ctx.dir, lab: ctx.labDir }) })], { io: { pid: 4243 } });
    expect(seen).toEqual({ dir: join(out, 'lab', 'run-20261105-094426-4243'), lab: join(out, 'lab', 'run-20261105-094426-4243') });
  });
});

describe('a block\'s ctx: its steps, its lines, its folder (S1\'s steps.ts under the runner)', () => {
  it('step, note, err and print land in the .out (and steps.log); each verdict line is printed before the SUMMARY', async () => {
    await go([plain('kf', { run: async (ctx) => (ctx.step('OK', 'kf probe'), ctx.note('NOTE kf noted'), ctx.print('kf printed'), ctx.err('kf erred'), ctx.verdict('PASS', 'ok')) })]);
    const before = outText().split('======== SUMMARY')[0];
    expect(before).toContain('09:44:26 OK   kf probe\n');
    expect(before).toContain('09:44:26 NOTE kf noted\n');
    expect(before).toContain('\nkf printed\n');
    expect(before).toContain('\nkf verdict: PASS — ok\n');
    expect(text(join(out, 'steps.log'))).toContain('09:44:26 ERROR kf erred\n');
  });

  it('verdictLines: an analyzer\'s lines as they are, each of its lines (CR LF, a lone CR) one line, empty ones dropped', async () => {
    await go([plain('kf', { run: async (ctx) => ctx.verdictLines(['kf live kf1: PASS\r\nkf verdict: PASS\r\n', '']) })]);
    expect(summary().slice(2, 4)).toEqual(['kf live kf1: PASS', 'kf verdict: PASS']);
  });

  it('a verdict or protected-key line holding a line break is the batch\'s mistake: thrown (the abort), and the abort SUMMARY is still printed', async () => {
    expect(await go([plain('kf', { run: async (ctx) => ctx.verdictAndHand({ line: 'kf verdict: PASS\nx', hand: [] }) })])).toBe(130);
    expect(summary()[0]).toBe('======== SUMMARY');
    expect(summary().join('\n')).toContain("by an error: kf's verdict line holds a line break");
    rmSync(out, { recursive: true, force: true });
    seam = new FakeSeam([git(), probes, live()]);
    expect(await go([plain('kf', { run: async (ctx) => ctx.protectedLine('OK x\ny') })])).toBe(130);
    expect(summary().join('\n')).toContain('by an error: a protected-key line holds a line break');
  });

  it('a file of a record that cannot be written for another reason than EEXIST: its own error, not "already exists"', async () => {
    expect(await go([plain('E5', { run: async (ctx) => (rmSync(ctx.dir, { recursive: true }), ctx.asks('c', { kind: 'runs', runs: 1 })) })])).toBe(130);
    expect(summary().join('\n')).toContain('ENOENT');
    expect(summary().join('\n')).not.toContain('already exists');
  });

  it('a details spec naming a file the block did not write prints nothing for it', async () => {
    await go([plain('kf', { details: [{ file: 'never.log' }] })]);
    const o = outText().split('\n');
    expect(o[o.indexOf(`-- kf (${dirOf('kf')}/)`) + 1]).toBe(`== DONE — all outputs in ${out}/<block>/run-${ID} ==`);
  });
});

// ------------------------------------------------------------------------------------------------ preconditions

describe('preconditions: a failed one makes the block INCONCLUSIVE, never a refusal; the SUMMARY is written (S3: the runner\'s choice, batch-11\'s way)', () => {
  it('HEAD ≠ main: the checkout line says so (once: a NOTE step, no ERROR line besides), every block INCONCLUSIVE with its why, none run, no need checked, exit 2 (review round 1)', async () => {
    seam.rules = [git({ 'refs/heads/main': ok(`${OTHER}\n`) }), probes, live()];
    const ran: string[] = [];
    const code = await go([kfBlock({ run: async () => void ran.push('kf') }), d43Block({ run: async () => void ran.push('D43'), preconditions: [async (k) => k.ancestor('c'.repeat(40), 'M_D43')] })]);
    expect(code).toBe(2);
    expect(seam.exits).toEqual([2]);
    const why = "the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun";
    expect(summary()).toEqual([
      '======== SUMMARY',
      `ERROR checkout: ${why} — every block INCONCLUSIVE, none run`,
      `kf live verdict: INCONCLUSIVE — precondition: ${why}`,
      `D43 live verdict: INCONCLUSIVE — precondition: ${why}`,
      "NOTE no wanted block ran (each one's why above)",
      'RESTORE: none — everything dirty was put back and verified',
      `======== SUMMARY end (run ${ID})`,
    ]);
    expect(outText()).toContain(`09:44:26 NOTE checkout: ${why} — every block INCONCLUSIVE, none run\n`);
    expect(ran).toEqual([]);
    expect(seam.words().some((w) => w.startsWith('git cat-file'))).toBe(false);
  });

  it('a block\'s own precondition not shown (an ancestry): that block INCONCLUSIVE naming it; the others run', async () => {
    seam.rules = [git({ 'merge-base': { code: 1 } }), probes, live()];
    await go([plain('kf'), plain('D43', { preconditions: [async (k) => k.ancestor('c'.repeat(40), 'M_D43')] })]);
    expect(summary()).toContain('kf verdict: PASS');
    expect(summary()).toContain(`D43 verdict: INCONCLUSIVE — precondition: M_D43=${'c'.repeat(40)} is not an ancestor of HEAD (not merged into main yet)`);
    expect(outText()).toContain(`SKIP D43 not run: precondition: M_D43=${'c'.repeat(40)} is not an ancestor of HEAD`);
  });

  it('every wanted block\'s preconditions are asked before the first block runs (batch-11\'s prechecks)', async () => {
    await go([plain('kf', { run: async (ctx) => void (await ctx.bounded('probe', ['kf'], { secs: 5 })) }), plain('D43', { preconditions: [async (k) => k.ancestor('c'.repeat(40))] })]);
    const w = seam.words();
    expect(w.findIndex((x) => x.startsWith('git merge-base'))).toBeLessThan(w.indexOf('probe kf'));
  });

  it('the cases and cells on main, from the table given (never grepped): a missing case INCONCLUSIVE', async () => {
    await go([
      plain('kf', { preconditions: [async (k) => k.casesOnMain({ ids: ['kf1', 'zz9'], platform: 'android' }), async (k) => k.cellsOnMain(['open', 'nope'])] }),
    ]);
    expect(summary()).toContain("kf verdict: INCONCLUSIVE — precondition: live case(s) zz9 not on main's live-cases.ts (android, native app, groups forms); cell(s) nope not in main's catalog (fixtures/apps/cells.json)");
  });

  it('a precondition check that throws: INCONCLUSIVE naming it, its first line — never the run\'s error', async () => {
    await go([plain('kf', { preconditions: [async () => { throw new Error('boom\nstack'); }] })]);
    expect(summary()).toContain('kf verdict: INCONCLUSIVE — precondition: its check threw: boom');
  });

  it('a precondition\'s why holding a line break keeps its first line: the verdict line never breaks', async () => {
    await go([plain('kf', { preconditions: [async () => ({ ok: false, why: 'one\ntwo' })] })]);
    expect(summary()).toContain('kf verdict: INCONCLUSIVE — precondition: one');
  });
});

describe('needs: each checked once, when the first wanted block needing it comes; a failed one makes the block INCONCLUSIVE, not run (spec S6a)', () => {
  it('a failed need: `<label>: INCONCLUSIVE — <need>: <why>`, its LAB line ERROR, the block not run (b11-dry noandroid, b2-noios)', async () => {
    const ran: string[] = [];
    await go([kfBlock({ run: async () => void ran.push('kf') }), d43Block()], { needs: { ...needs, android: async () => ({ ok: false, why: 'adb unreachable (get-state exit 1)' }) } });
    expect(summary()).toContain('LAB android: ERROR — adb unreachable (get-state exit 1)');
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — android: adb unreachable (get-state exit 1)');
    expect(summary()).toContain('D43 live verdict: PASS — p7w ok under wda');
    expect(ran).toEqual([]);
    expect(outText()).toContain('SKIP kf not run: android: adb unreachable (get-state exit 1)');
  });

  it('a need is checked in full by the first block naming it, then its cheap `alive` before each later one; its lab line once; a need no wanted block names never checked (review round 1)', async () => {
    const checked: string[] = [];
    const n: Record<string, NeedSpec> = {
      android: { check: async () => (checked.push('android check'), { ok: true, how: 'up' }), alive: async () => (checked.push('android alive'), { ok: true, how: 'still up' }) },
      ios: async () => (checked.push('ios'), { ok: true as const, how: 'up' }),
    };
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] }), plain('c', { needs: ['android'] }), plain('d', { needs: ['ios'] })], { needs: n, env: { ONLY: 'a,b,c' } });
    expect(checked).toEqual(['android check', 'android alive', 'android alive']);
    expect(summary().filter((l) => l.startsWith('LAB '))).toEqual(['LAB android: OK — up']);
    expect(summary()).toContain('c verdict: PASS');
  });

  it('a need with no `alive` is rechecked in full before each later block (never trusted blindly)', async () => {
    const checked: string[] = [];
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] })], { needs: { ...needs, android: async () => (checked.push('android'), { ok: true, how: 'up' }) } });
    expect(checked).toEqual(['android', 'android']);
    expect(summary().filter((l) => l.startsWith('LAB '))).toEqual(['LAB android: OK — up']);
  });

  it('a recheck that fails: that block INCONCLUSIVE naming the need, a lab line saying before which block; the later ones not rechecked', async () => {
    const answers = [true, false];
    const checked: string[] = [];
    const n: Record<string, NeedSpec> = { android: { check: async () => ({ ok: true, how: 'up' }), alive: async () => (checked.push('alive'), answers.shift() ? { ok: true, how: 'up' } : { ok: false, why: 'the emulator went offline' }) } };
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] }), plain('c', { needs: ['android'] }), plain('d', { needs: ['android'] })], { needs: n });
    expect(checked).toEqual(['alive', 'alive']);
    expect(summary()).toContain('a verdict: PASS');
    expect(summary()).toContain('b verdict: PASS');
    expect(summary()).toContain('c verdict: INCONCLUSIVE — android: the emulator went offline');
    expect(summary()).toContain('d verdict: INCONCLUSIVE — android: the emulator went offline');
    expect(summary().filter((l) => l.startsWith('LAB '))).toEqual(['LAB android: OK — up', 'LAB android: ERROR — the emulator went offline (rechecked before c)']);
  });

  it('a need whose first check failed is not checked again: every later block INCONCLUSIVE with the same why', async () => {
    const checked: string[] = [];
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] })], { needs: { android: async () => (checked.push('x'), { ok: false, why: 'down' }) } });
    expect(checked).toEqual(['x']);
    expect(summary()).toContain('b verdict: INCONCLUSIVE — android: down');
  });

  it('no wanted block ran (every need failed): exit 2, "nothing was done" — never success (review round 1); one that ran: its own exit', async () => {
    const down = { ...needs, android: async () => ({ ok: false as const, why: 'down' }) };
    expect(await go([plain('a', { needs: ['android'] }), plain('b', { preconditions: [async () => ({ ok: false, why: 'no' })] })], { needs: down })).toBe(2);
    expect(summary().slice(-4, -1)).toEqual(['b verdict: INCONCLUSIVE — precondition: no', 'NOTE no wanted block ran (each one\'s why above)', 'RESTORE: none — everything dirty was put back and verified']);
    rmSync(out, { recursive: true, force: true });
    expect(await go([plain('a', { needs: ['android'] }), plain('c')], { needs: down })).toBe(0);
    expect(summary().some((l) => l.startsWith('NOTE no wanted block ran'))).toBe(false);
  });

  it('two needs failed: both named; a check that throws is a failed need and an ERROR line, never the run\'s abort', async () => {
    const n = { android: async () => ({ ok: false as const, why: 'down' }), ios: async (): Promise<never> => { throw new Error('simctl gone'); } };
    expect(await go([plain('B2', { needs: ['ios', 'android'] })], { needs: n })).toBe(2);
    expect(summary()).toContain('B2 verdict: INCONCLUSIVE — ios: its check threw: simctl gone; android: down');
    expect(summary().some((l) => /ERROR LAB ios: its check threw: simctl gone$/.test(l))).toBe(true);
  });

  it('the check gets the bounded calls, the lab folder and the config', async () => {
    let got: { labDir: string; serial?: string } | undefined;
    const n = {
      android: async (c: NeedCtx) => {
        const r = await c.bounded('probe', ['emu'], { secs: 5 });
        got = { labDir: c.labDir, serial: c.config.serial };
        return r.code === 0 ? { ok: true as const, how: 'emu answers' } : { ok: false as const, why: 'no' };
      },
    };
    await go([plain('kf', { needs: ['android'] })], { needs: { android: async (c: NeedCtx) => (c.step('NOTE', 'android: the emulator asked'), n.android(c)) } });
    expect(got).toEqual({ labDir: dirOf('lab'), serial: 'emulator-5554' });
    expect(seam.words()).toContain('probe emu');
    expect(outText()).toContain('09:44:26 NOTE android: the emulator asked\n');
    expect(outText()).toContain('09:44:26 LAB android: OK — emu answers\n');
  });
});

describe('a block\'s calls are its own: stopKept ends the groups it kept, no other block\'s (S2: batch-12 ended the companion after each iOS block)', () => {
  it('an idb call\'s companion kept past the call; the block\'s stopKept ends it; another block\'s stays to the run\'s end', async () => {
    await go([
      plain('A', { run: async (ctx) => (await ctx.bounded('idb', ['a'], { secs: 5 }), ctx.verdict('PASS')) }),
      plain('B', { run: async (ctx) => (await ctx.bounded('idb', ['b'], { secs: 5 }), await ctx.stopKept(), seam.signals.push('-- B stopped its own'), ctx.verdict('PASS')) }),
    ]);
    expect(seam.signals).toEqual(['SIGTERM idb b', '-- B stopped its own', 'SIGTERM idb a']);
  });
});

describe('a need\'s end: once per need met, after the last block and before the windows go to RESTORE; its protected-key lines into the SUMMARY\'s slot (T2b batch-13 gap 4)', () => {
  /** A need met (or not), its end recording when it ran and what it saw. */
  const ending = (order: string[], name: string, o: { ok?: boolean; end?: (c: NeedEndCtx) => Promise<void>; endSecs?: number; unread?: boolean; alive?: NeedCtxCheck } = {}): NeedSpec => ({
    check: async () => (o.ok === false ? { ok: false, why: `${name} down` } : { ok: true, how: `${name} up` }),
    ...(o.alive !== undefined && { alive: o.alive }),
    end: o.end ?? (async (c) => void order.push(`${name} end: RESTORE ${existsSync(join(out, 'RESTORE.txt')) ? 'written' : 'not yet'}, kept groups ${seam.signals.length === 0 ? 'alive' : 'ended'}, lab ${c.labDir === dirOf('lab')}, serial ${c.config.serial}`)),
    ...(o.endSecs !== undefined && { endSecs: o.endSecs }),
    ...(o.unread === true && { endUnread: (why: string) => `ERROR ${name}'s key unread: ${why}` }),
  });

  it('called once per need met, after the last block, before finish and the judges; never for a need not met, nor one no wanted block named', async () => {
    const order: string[] = [];
    const n = { android: ending(order, 'android'), ios: ending(order, 'ios', { ok: false }), other: ending(order, 'other') };
    const window = { hand: ['W: by hand'], restore: async () => ({ ok: true as const, how: 'x' }) };
    expect(
      await go(
        [
          plain('a', { needs: ['android'], run: async (ctx) => (order.push('a'), ctx.verdict('PASS')) }),
          plain('b', { needs: ['android', 'ios'], run: async () => void order.push('b') }),
          plain('c', { noRecords: true, run: async (ctx) => (order.push('c'), ctx.open('W', window), void (await ctx.bounded('idb', ['c'], { secs: 5 }))), judge: async () => (order.push('c judged'), ['c verdict: PASS']) }),
        ],
        { needs: n },
      ),
    ).toBe(1);
    expect(order).toEqual(['a', 'c', 'android end: RESTORE not yet, kept groups alive, lab true, serial emulator-5554', 'c judged']);
    expect(summary().some((l) => l.includes('its end'))).toBe(false);
  });

  it('its protected-key lines in the SUMMARY\'s slot, after the blocks\' and before RESTORE; a FAIL among them exits 1, an ERROR (unread) alone 0', async () => {
    const line = (l: string) => ({ android: ending([], 'android', { end: async (c) => c.protectedLine(l) }) });
    expect(await go([plain('a', { needs: ['android'] })], { needs: line('FAIL the finportal key CHANGED') })).toBe(1);
    expect(summary().slice(-4, -1)).toEqual(['a verdict: PASS', 'FAIL the finportal key CHANGED', 'RESTORE: none — everything dirty was put back and verified']);
    rmSync(out, { recursive: true, force: true });
    expect(await go([plain('a', { needs: ['android'] })], { needs: line('ERROR the finportal key unread') })).toBe(0);
    expect(summary()).toContain('ERROR the finportal key unread');
  });

  it('its calls bounded, through the run\'s guard; a bare NeedCheck has no end', async () => {
    const n = { android: ending([], 'android', { end: async (c) => void (await c.bounded('probe', ['end'], { secs: 5 })) }), ios: needs.ios };
    expect(await go([plain('a', { needs: ['android', 'ios'] })], { needs: n })).toBe(0);
    expect(seam.words()).toContain('probe end');
  });

  it('an end that throws: an ERROR line naming the need and its first line, and its unread line (endUnread) in the slot; the next need\'s end still runs (T2b review round 1)', async () => {
    const order: string[] = [];
    const n = {
      android: ending(order, 'android', { unread: true, end: async () => { throw new Error('simctl gone\nmore'); } }),
      ios: ending(order, 'ios', { end: async (c) => c.protectedLine('OK   the key unchanged') }),
    };
    expect(await go([plain('a', { needs: ['android', 'ios'] })], { needs: n })).toBe(0);
    expect(summary()).toContain('09:44:26 ERROR LAB android: its end threw: simctl gone');
    const slot = summary().indexOf('a verdict: PASS') + 1;
    expect(summary().slice(slot, slot + 3)).toEqual(["ERROR android's key unread: its end threw: simctl gone", 'OK   the key unchanged', 'RESTORE: none — everything dirty was put back and verified']);
  });

  it('an end past its bound (endSecs; NEED_END_SECS unless given): an ERROR line and its unread line; settled before the SUMMARY, its lines replace the unread one — a late FAIL exits 1 (T2b review round 1, BLOCKER; T2c: on fake time)', () =>
    onFakeTime(async () => {
      expect(NEED_END_SECS).toBe(60);
      const slow = plain('slow', { noRecords: true, run: async () => {}, judge: async () => (await tick(120), ['slow verdict: PASS']) });
      const n = { android: ending([], 'android', { unread: true, endSecs: 0.02, end: async (c) => (await tick(60), c.protectedLine('FAIL late')) }) };
      expect(await goFaked([plain('a', { needs: ['android'] }), slow], { needs: n })).toBe(1);
      expect(summary()).toContain('09:44:26 ERROR LAB android: its end did not finish within 0.02 s');
      const slot = summary().indexOf('slow verdict: PASS') + 1;
      expect(summary().slice(slot, slot + 2)).toEqual(['FAIL late', 'RESTORE: none — everything dirty was put back and verified']);
      expect(summary().some((l) => l.includes('key unread'))).toBe(false);
      expect(text(join(out, 'steps.log'))).toContain("NOTE LAB android: a protected-key line after its end's bound, kept if its end finishes before the SUMMARY: FAIL late");
    }));

  it('a late end with no unread line of its own: its settled lines still taken; one not settled by the SUMMARY: the unread line stands, its later line never kept (T2c: on fake time)', () =>
    onFakeTime(async () => {
      const slow = plain('slow', { noRecords: true, run: async () => {}, judge: async () => (await tick(120), ['slow verdict: PASS']) });
      let n: Record<string, NeedSpec> = {
        android: ending([], 'android', { endSecs: 0.02, end: async (c) => (await tick(60), c.protectedLine('FAIL late')) }),
        ios: ending([], 'ios', { end: async (c) => c.protectedLine('OK   the other key unchanged') }),
      };
      expect(await goFaked([plain('a', { needs: ['android', 'ios'] }), slow], { needs: n })).toBe(1);
      const slot = summary().indexOf('slow verdict: PASS') + 1;
      expect(summary().slice(slot, slot + 2)).toEqual(['OK   the other key unchanged', 'FAIL late']);
      expect(summary()).not.toContain('undefined');
      rmSync(out, { recursive: true, force: true });
      n = { android: ending([], 'android', { unread: true, endSecs: 0.02, end: async (c) => (await tick(150), c.protectedLine('FAIL later')) }) };
      expect(await goFaked([plain('a', { needs: ['android'] })], { needs: n })).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(summary()).toContain("ERROR android's key unread: its end did not finish within 0.02 s");
      expect(summary()).not.toContain('FAIL later');
    }));

  it('a late end taken only once settled and only with lines: one still running keeps its unread line, its partial line not taken; one settled with none keeps it too (T2c: on fake time)', () =>
    onFakeTime(async () => {
      const slow = plain('slow', { noRecords: true, run: async () => {}, judge: async () => (await tick(120), ['slow verdict: PASS']) });
      const unreadLine = "ERROR android's key unread: its end did not finish within 0.02 s";
      let n = { android: ending([], 'android', { unread: true, endSecs: 0.02, end: async (c) => (await tick(60), c.protectedLine('FAIL partial'), void (await tick(400))) }) };
      expect(await goFaked([plain('a', { needs: ['android'] }), slow], { needs: n })).toBe(0);
      expect(summary()).toContain(unreadLine);
      expect(summary()).not.toContain('FAIL partial');
      rmSync(out, { recursive: true, force: true });
      n = { android: ending([], 'android', { unread: true, endSecs: 0.02, end: async () => void (await tick(60)) }) };
      expect(await goFaked([plain('a', { needs: ['android'] }), slow], { needs: n })).toBe(0);
      expect(summary()).toContain(unreadLine);
    }));

  it('a need met once, then down before a later block: its end still called once (T2b review round 1, MAJOR)', async () => {
    const order: string[] = [];
    const n = { android: ending(order, 'android', { alive: async () => ({ ok: false, why: 'gone' }) }) };
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] })], { needs: n });
    expect(summary()).toContain('b verdict: INCONCLUSIVE — android: gone');
    expect(order).toEqual(['android end: RESTORE not yet, kept groups alive, lab true, serial emulator-5554']);
  });

  it('interrupted in the last block: no end is called; interrupted during an end (its probe stopped): exit 130, only the abort\'s SUMMARY, no later end', async () => {
    const order: string[] = [];
    const hang = plain('h', { needs: ['android'], run: async (ctx) => void (await ctx.bounded('probe', ['hang'], { secs: 30 })) });
    const ABORTED = 'not read at its end: the run was interrupted (the abort reads nothing)';
    let done = go([hang], { needs: { android: ending(order, 'android', { unread: true }) } });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(order).toEqual([]);
    // The abort's SUMMARY says the key was not read (T2b review round 1): never silent about it.
    expect(summary()).toContain(`ERROR android's key unread: ${ABORTED}`);
    rmSync(out, { recursive: true, force: true });
    seam = new FakeSeam([git(), probes, live()]);
    const n = {
      fine: ending(order, 'fine', { unread: true, end: async (c) => c.protectedLine('OK   fine key unchanged') }),
      // Its probe stopped by the abort, it says a line: after the interrupt, that is no say — the abort still says unread.
      android: ending(order, 'android', { unread: true, end: async (c) => (await c.bounded('probe', ['hang'], { secs: 30 }), c.protectedLine('OK   android key after the interrupt')) }),
      ios: ending(order, 'ios'),
    };
    done = go([plain('a', { needs: ['fine', 'android', 'ios'] })], { needs: n });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    await tick(5);
    expect(order).toEqual([]);
    expect(summary().filter((l) => l.includes('key'))).toEqual(['OK   fine key unchanged', `ERROR android's key unread: ${ABORTED}`]);
    expect(seam.exits).toEqual([130]);
    expect(text(join(dirOf('meta'), 'summary.txt')).split('======== SUMMARY end').length).toBe(2);
    expect(summary()).toContain('a verdict: PASS');
    // The body stops at once: the normal end's finish is never asked while the abort puts the windows back.
    expect(text(join(out, 'steps.log'))).not.toContain('finish() ignored');
  });
});

describe('a need\'s calls recorded in lab/<need>-calls.jsonl, appended through the run\'s fs (T2b batch-13 gap 6: a failed LAB line diagnosed without a rerun)', () => {
  const callsOf = (need: string) => text(join(dirOf('lab'), `${need}-calls.jsonl`)).split('\n').slice(0, -1).map((l) => JSON.parse(l) as Record<string, unknown>);

  it('its check\'s, its alive\'s and its end\'s calls, in order, each its phase; a block\'s own calls not among them', async () => {
    const n: Record<string, NeedSpec> = {
      android: {
        check: async (c) => (await c.bounded('probe', ['emu'], { secs: 5 }), { ok: true, how: 'up' }),
        alive: async (c) => (await c.bounded('probe', ['alive'], { secs: 3 }), { ok: true, how: 'up' }),
        end: async (c) => void (await c.bounded('probe', ['end'], { secs: 7 })),
      },
    };
    await go([plain('a', { needs: ['android'], run: async (ctx) => (await ctx.bounded('probe', ['block'], { secs: 5 }), ctx.verdict('PASS')) }), plain('b', { needs: ['android'] })], { needs: n });
    expect(callsOf('android')).toEqual([
      { need: 'android', phase: 'check', at: '09:44:26', cmd: 'probe', args: ['emu'], secs: 5, code: 0, timedOut: false },
      { need: 'android', phase: 'alive', at: '09:44:26', cmd: 'probe', args: ['alive'], secs: 3, code: 0, timedOut: false },
      { need: 'android', phase: 'end', at: '09:44:26', cmd: 'probe', args: ['end'], secs: 7, code: 0, timedOut: false },
    ]);
  });

  it('a check that throws after its calls: they are still recorded; a call that failed says its first line', async () => {
    seam.rules = [git(), (cmd, args) => (cmd === 'probe' && args[0] === 'sick' ? { code: 3, err: 'adb: device offline\nmore' } : undefined), probes, live()];
    const n = { android: async (c: NeedCtx): Promise<never> => { await c.bounded('probe', ['sick'], { secs: 5 }); throw new Error('gone'); } };
    await go([plain('a', { needs: ['android'] })], { needs: n });
    expect(callsOf('android')).toEqual([{ need: 'android', phase: 'check', at: '09:44:26', cmd: 'probe', args: ['sick'], secs: 5, code: 3, timedOut: false, said: 'adb: device offline' }]);
  });

  it('a record that cannot be written: one NOTE per need, never the need\'s failure', async () => {
    const fs = { ...nodeFs, append: (path: string, t: string) => (path.endsWith('-calls.jsonl') ? (() => { throw new Error('ENOSPC: no space\nmore'); })() : nodeFs.append(path, t)) };
    const n = { android: async (c: NeedCtx) => (await c.bounded('probe', ['a'], { secs: 5 }), await c.bounded('probe', ['b'], { secs: 5 }), { ok: true as const, how: 'up' }) };
    expect(await go([plain('a', { needs: ['android'] })], { needs: n, io: { fs } })).toBe(0);
    expect(summary()).toContain('a verdict: PASS');
    expect(text(join(out, 'steps.log')).split('\n').filter((l) => l.includes('its calls not recorded'))).toEqual([`09:44:26 NOTE LAB android: its calls not recorded (ENOSPC: no space)`]);
  });

  it('bounded: past NEED_CALLS_MAX calls of one need, one line says the rest were not recorded', async () => {
    const n = { android: async (c: NeedCtx) => { for (let i = 0; i < 502; i++) await c.bounded('probe', [String(i)], { secs: 5 }); return { ok: true as const, how: 'up' }; } };
    await go([plain('a', { needs: ['android'] })], { needs: n });
    const calls = callsOf('android');
    expect(calls).toHaveLength(501);
    expect(calls[499]).toMatchObject({ args: ['499'] });
    expect(calls[500]).toEqual({ need: 'android', dropped: 'the calls past the first 500 not recorded' });
  });

  it('a need named by no plain path segment is the batch\'s mistake: thrown before anything', async () => {
    await expect(go([plain('a', { needs: ['a/b'] })], { needs: { 'a/b': needs.android } })).rejects.toThrow('need "a/b": one plain path segment is needed');
    expect(seam.calls).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ the backstop

describe('the backstop: a wanted block with no verdict line of its label gets one (batch-10/11; b11-dry d43-backupfail, noandroid)', () => {
  it('a block that wrote nothing: "not run (see the ERROR lines)"', async () => {
    await go([plain('D62', { run: async (ctx) => ctx.err('D62: the lab is not main\'s — skipped') })]);
    expect(summary()).toContain('D62 verdict: INCONCLUSIVE — not run (see the ERROR lines)');
    expect(summary()).toContain("09:44:26 ERROR D62: the lab is not main's — skipped");
    expect(outText()).not.toContain('analyze');
  });

  it('a cleanup or compare line is no verdict of the block: the backstop still comes', async () => {
    await go([plain('D43', { run: async (ctx) => ctx.verdict('OK', 'restored', 'D43 WDA-window restore') })]);
    expect(summary()).toContain('D43 WDA-window restore: OK — restored');
    expect(summary()).toContain('D43 verdict: INCONCLUSIVE — not run (see the ERROR lines)');
  });

  it('a live run that died: S3\'s incompleteLine names the run and every gap (batch-9: never a missing line)', async () => {
    seam.rules = [git(), probes, live({ code: 2, header: false, noRecord: true })];
    await go([kfBlock({ judge: undefined })]);
    expect(summary()).toContain(
      'kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — no record (android-kf-1.json); android-kf-1.log has no `# Live golden:` line (live.ts did not finish); no rejudge summary (android-kf-1.rejudge.txt)',
    );
  });

  it('a judge that throws: an ERROR line naming it, then the backstop over its runs', async () => {
    await go([kfBlock({ judge: async () => { throw new Error('b11-analyze.ts: no --set'); } })]);
    expect(summary()).toContain('09:44:26 ERROR kf analyze: b11-analyze.ts: no --set');
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — its 1 run(s) are complete, but no verdict line was written (see the ERROR lines)');
  });

  it('a block whose live run died is not judged: its judge\'s PASS never hides the gap; incompleteLine says it (code review c1)', async () => {
    seam.rules = [git(), probes, live({ code: 2, header: false, noRecord: true })];
    const judged: string[] = [];
    await go([kfBlock({ judge: async () => (judged.push('kf'), ['kf live verdict: PASS']) })]);
    expect(judged).toEqual([]);
    expect(summary().find((l) => l.startsWith('kf live verdict:'))).toMatch(/^kf live verdict: INCONCLUSIVE — 1 of 1 run\(s\) incomplete: android-kf-1 — no record/);
  });

  it('a live run whose rejudge summary lacks cases asked is not complete: not judged, INCONCLUSIVE naming them (review round 5, R3)', async () => {
    seam.rules = [git(), probes, live({ rejudge: { log: casesSummary(['kf1']) } })];
    const judged: string[] = [];
    await go([kfBlock({ judge: async () => (judged.push('kf'), ['kf live verdict: PASS']) })]);
    expect(judged).toEqual([]);
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — uiautomator: kf2, kf3 missing from the summary');
  });

  it('the same on the abort path: an incomplete run is INCONCLUSIVE with its gap, its judge not run (review round 5, R3)', async () => {
    seam.rules = [git(), probes, live({ rejudge: { log: casesSummary(['kf1']) } })];
    const judged: string[] = [];
    const done = go([kfBlock({ judge: async () => (judged.push('kf'), ['kf live verdict: PASS']) }), plain('E5', { run: async (ctx) => void (await ctx.bounded('probe', ['hang'], { secs: 30 })) })]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(judged).toEqual([]);
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — uiautomator: kf2, kf3 missing from the summary');
  });

  it('a noRecords block that asks, records or runs live: the batch\'s mistake, thrown at that call (review round 5, R4, R5)', async () => {
    for (const [call, run] of [
      ['asks', async (ctx: Parameters<Block['run']>[0]) => ctx.asks('c', { kind: 'runs', runs: 1 })],
      ['record', async (ctx: Parameters<Block['run']>[0]) => ctx.record('c', { kind: 'runs', runs: 1 })],
      ['liveRun', async (ctx: Parameters<Block['run']>[0]) => void (await ctx.liveRun('k', KF, { secs: 60 }))],
    ] as const) {
      rmSync(out, { recursive: true, force: true });
      seam = new FakeSeam([git(), probes, live()]);
      expect(await go([plain('E5', { noRecords: true, run })])).toBe(130);
      expect(summary().join('\n')).toContain(`E5 declared noRecords, yet called ${call}: a block that asks or records runs declares none`);
      expect(seam.words().some((w) => w.includes('live.ts'))).toBe(false);
    }
  });

  it('a block\'s own complete() only adds a requirement: it never hides a live run\'s gap (review round 6, the R3 summary with complete: () => true)', async () => {
    seam.rules = [git(), probes, live({ rejudge: { log: casesSummary(['kf1']) } })];
    const judged: string[] = [];
    await go([kfBlock({ complete: () => true, judge: async () => (judged.push('kf'), ['kf live verdict: PASS']) })]);
    expect(judged).toEqual([]);
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — uiautomator: kf2, kf3 missing from the summary');
  });

  it('a noRecords block with its own complete(): both must hold', async () => {
    const judged: string[] = [];
    await go([plain('a', { run: async () => {}, noRecords: true, complete: () => false, judge: async () => (judged.push('a'), ['a verdict: PASS']) })]);
    expect(judged).toEqual([]);
  });

  it('a block whose record does not match what it asked is not judged either', async () => {
    const judged: string[] = [];
    await go([plain('E5', { run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 3 }), ctx.record('c', { kind: 'runs', runs: 2 })), judge: async () => (judged.push('E5'), ['E5 verdict: PASS']) })]);
    expect(judged).toEqual([]);
    expect(summary()).toContain('E5 verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: c — asked 3 run(s), recorded 2');
  });

  it('a complete() that throws is not complete: not judged, the backstop\'s line, never the run\'s abort', async () => {
    const judged: string[] = [];
    const code = await go([plain('T6', { run: async () => {}, complete: () => { throw new Error('static.txt unreadable'); }, judge: async () => (judged.push('T6'), ['T6 verdict: PASS']) }), plain('kf')]);
    expect(code).toBe(0);
    expect(judged).toEqual([]);
    expect(summary()).toContain('T6 verdict: INCONCLUSIVE — not run (see the ERROR lines)');
  });

  it('a block that asked nothing is judged only when it declared it records nothing (noRecords), once its run returned', async () => {
    const judged: string[] = [];
    const j = (id: string) => async () => (judged.push(id), [`${id} verdict: PASS`]);
    await go([plain('a', { run: async () => {}, judge: j('a') }), plain('b', { run: async () => {}, noRecords: true, judge: j('b') })]);
    expect(judged).toEqual(['b']);
    expect(summary()).toContain('a verdict: INCONCLUSIVE — not run (see the ERROR lines)');
    expect(summary()).toContain('b verdict: PASS');
    rmSync(out, { recursive: true, force: true });
    judged.length = 0;
    await go([plain('c', { noRecords: true, judge: j('c') })]);
    expect(judged).toEqual([]);
  });

  it('the judges run after finish: every window still open written to RESTORE and the kept groups ended first (review round 1)', async () => {
    let seen: { restore: boolean; signals: string[] } | undefined;
    await go([
      plain('a', {
        noRecords: true,
        run: async (ctx) => (ctx.open('W', { hand: ['W: by hand'], restore: async () => ({ ok: true, how: 'x' }) }), void (await ctx.bounded('idb', ['a'], { secs: 5 }))),
        judge: async () => ((seen = { restore: existsSync(join(out, 'RESTORE.txt')), signals: [...seam.signals] }), ['a verdict: PASS']),
      }),
    ]);
    expect(seen).toEqual({ restore: true, signals: ['SIGTERM idb a'] });
  });

  it('the judge on the normal path: only for a block that ran and wrote no verdict of its own; its run and folder given', async () => {
    const judged: string[] = [];
    const judge = (id: string) => async (j: { dir: string }) => (judged.push(`${id} ${j.dir}`), [`${id} verdict: PASS — judged`]);
    await go([
      plain('a', { judge: judge('a'), run: async () => {}, noRecords: true }),
      plain('b', { judge: judge('b') }),
      plain('c', { judge: judge('c'), needs: ['android'] }),
      plain('d', { judge: judge('d'), preconditions: [async () => ({ ok: false, why: 'no' })] }),
    ], { needs: { ...needs, android: async () => ({ ok: false, why: 'down' }) } });
    expect(judged).toEqual([`a ${dirOf('a')}`]);
    expect(summary()).toContain('a verdict: PASS — judged');
    rmSync(out, { recursive: true, force: true });
    await go([plain('a', { run: async () => {}, noRecords: true, judge: async () => ['a live x: PASS\r\na verdict: PASS\r\n'] })]);
    expect(summary().slice(2, 4)).toEqual(['a live x: PASS', 'a verdict: PASS']);
    expect(outText()).toContain('OK   a analyze');
  });
});

// ------------------------------------------------------------------------------------------------ ERROR lines

describe('the ERROR lines: this run\'s steps and every ERROR line of its blocks\' logs and analyze.txt, each once (batch-6, batch-12.sh:667–668)', () => {
  it('a block\'s .log and analyze.txt and the lab folder\'s logs read; another file, and an earlier run\'s logs, not; a line twice printed once, with its count (review round 2)', async () => {
    mkdirSync(join(out, 'kf', 'run-old'), { recursive: true });
    writeFileSync(join(out, 'kf', 'run-old', 'probe.log'), 'ERROR an earlier run\'s\n');
    await go([
      plain('kf', {
        run: async (ctx) => {
          writeFileSync(join(ctx.dir, 'probe.log'), 'x\nERROR the cell did not open\nERROR the cell did not open\n');
          writeFileSync(join(ctx.dir, 'analyze.txt'), 'kf live verdict: PASS\nERROR the analyzer\'s own\n');
          writeFileSync(join(ctx.dir, 'notes.txt'), 'ERROR not a log\n');
          writeFileSync(join(ctx.labDir, 'catalog-check.log'), 'ERROR the catalog drifted\n');
          ctx.verdict('PASS');
        },
      }),
    ]);
    const errors = summary().slice(summary().indexOf('RESTORE: none — everything dirty was put back and verified') + 1, -1);
    expect(errors).toEqual(['ERROR the catalog drifted', 'ERROR the analyzer\'s own', `ERROR the cell did not open (×2, in kf/probe.log)`]);
  });

  it('an ERROR said as a step and repeated in a log: one line, counted together, steps.log named (code review a4)', async () => {
    await go([plain('kf', { run: async (ctx) => (ctx.err('the cell did not open'), writeFileSync(join(ctx.dir, 'probe.log'), 'ERROR the cell did not open\nERROR the cell did not open\n'), ctx.verdict('PASS')) })]);
    expect(summary().filter((l) => l.includes('the cell did not open'))).toEqual(['09:44:26 ERROR the cell did not open (×3, in steps.log, kf/probe.log)']);
    rmSync(out, { recursive: true, force: true });
    await go([plain('kf', { run: async (ctx) => (ctx.err('one'), ctx.err('two'), ctx.verdict('PASS')) })]);
    expect(summary().filter((l) => /ERROR (one|two)/.test(l))).toEqual(['09:44:26 ERROR one', '09:44:26 ERROR two']);
  });

  it('one ERROR in several of this run\'s logs: one line, its total and where (review round 3: 50 in p, 1 in q, 2 in r)', async () => {
    await go([
      plain('kf', { run: async (ctx) => (writeFileSync(join(ctx.dir, 'p.log'), Array.from({ length: 50 }, () => 'ERROR same').join('\n')), writeFileSync(join(ctx.labDir, 'q.log'), 'ERROR same\n'), ctx.verdict('PASS')) }),
      plain('E5', { run: async (ctx) => (writeFileSync(join(ctx.dir, 'r.log'), 'ERROR same\nERROR same\n'), ctx.verdict('PASS')) }),
    ]);
    expect(summary().filter((l) => l.includes('ERROR same'))).toEqual(['ERROR same (×53, in lab/q.log, kf/p.log, E5/r.log)']);
  });

  it('a probe log\'s progress line (a lone CR) never breaks the SUMMARY: each overwritten part its own line', async () => {
    expect(await go([plain('kf', { run: async (ctx) => (writeFileSync(join(ctx.dir, 'p.log'), '10%\rERROR stalled\r20%\n'), ctx.verdict('PASS')) })])).toBe(0);
    expect(summary()).toContain('ERROR stalled');
  });

  it('a log the folder lists but that cannot be read: a NOTE naming it in the SUMMARY; a long ERROR line cut (review round 1)', async () => {
    await go([
      plain('kf', {
        run: async (ctx) => (mkdirSync(join(ctx.dir, 'stuck.log')), mkdirSync(join(ctx.dir, 'full.log')), writeFileSync(join(ctx.dir, 'full.log', 'x'), ''), writeFileSync(join(ctx.dir, 'p.log'), `ERROR ${'x'.repeat(900)}\n`), ctx.verdict('PASS')),
      }),
    ]);
    expect(summary()).toContain(`NOTE ${join(dirOf('kf'), 'stuck.log')} not read: unreadable`);
    expect(summary()).toContain(`NOTE ${join(dirOf('kf'), 'full.log')} not read: unreadable: a folder`);
    expect(summary().find((l) => l.startsWith('ERROR x'))).toHaveLength(700);
  });

  it('an ERROR inside a verdict line is that block\'s verdict, never an ERROR line (S1)', async () => {
    await go([plain('E5', { run: async (ctx) => (ctx.verdict('ERROR', 'the lab not proven installed', 'E5 cleanup'), ctx.verdict('PASS')) })]);
    expect(summary()).toContain('E5 cleanup: ERROR — the lab not proven installed');
    expect(summary().filter((l) => /ERROR/.test(l) && !l.startsWith('E5 cleanup'))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ RESTORE, exit

describe('RESTORE and the exit code (words.ts#exitCodeOf: 1 for a FAIL or a RESTORE line; WARN, INCONCLUSIVE, ERROR alone 0 once a block ran — 2 when none ran, pinned under the needs and preconditions)', () => {
  it('restoreHand: the lines appended to RESTORE now, the SUMMARY\'s RESTORE section, exit 1 (S4\'s LATE_HAND)', async () => {
    expect(await go([plain('D43', { run: async (ctx) => (ctx.restoreHand(['D43: compare it by hand']), ctx.verdict('PASS')) })])).toBe(1);
    expect(summary()).toContain('D43: compare it by hand');
    expect(text(join(out, 'RESTORE.txt'))).toContain('D43: compare it by hand\n');
  });

  it('restoreHand with no line writes nothing and leaves the exit alone', async () => {
    expect(await go([plain('D43', { run: async (ctx) => (ctx.restoreHand([]), ctx.verdictAndHand({ line: 'D43 WDA-window compare: OK — every domain still equals its backup', hand: [] }), ctx.verdict('PASS')) })])).toBe(0);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(false);
    expect(summary()).toContain('RESTORE: none — everything dirty was put back and verified');
  });

  it('a WARN alone exits 0 (S4: the compare\'s WARN never fails the run by itself)', async () => {
    expect(await go([plain('D43', { run: async (ctx) => (ctx.verdict('WARN', 'not compared: x', 'D43 WDA-window compare'), ctx.verdict('PASS')) })])).toBe(0);
  });

  it('a FAIL verdict exits 1', async () => {
    expect(await go([plain('E5', { run: async (ctx) => ctx.verdict('FAIL', 'a lab default') })])).toBe(1);
  });

  it('a window still open at the end: its hand lines to RESTORE (S2\'s finish), exit 1', async () => {
    expect(await go([plain('E5', { run: async (ctx) => (ctx.open('E5', { hand: ['E5: node e5.ts --restore'], restore: async () => ({ ok: true, how: 'x' }) }), ctx.verdict('PASS')) })])).toBe(1);
    expect(summary()).toContain('E5: node e5.ts --restore');
  });
});

// ------------------------------------------------------------------------------------------------ the abort

describe('the abort mid-block: exit 130, the abort SUMMARY with INTERRUPTED (S2\'s AbortGuard under runBatch)', () => {
  const e5 = (over: Partial<Block> = {}): Block =>
    plain('E5', {
      run: async (ctx) => {
        ctx.open('E5', { hand: ['E5: node e5.ts --restore'], cleanup: 'E5 cleanup', restore: async () => ({ ok: true, how: 'read back' }) });
        await ctx.bounded('probe', ['hang'], { secs: 30 });
        ctx.verdict('PASS', 'never reached in time');
      },
      ...over,
    });

  it('SIGINT while E5\'s probe runs: the probe stopped, the window put back, kf (complete) judged, E5 INTERRUPTED, no further block, exit 130', async () => {
    const ran: string[] = [];
    seam.rules = [git(), probes, live({ logExtra: 'ERROR a log line of kf\'s\n' })];
    const done = go([kfBlock(), e5(), plain('later', { run: async () => void ran.push('later') })]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(seam.exits).toEqual([130]);
    expect(ran).toEqual([]);
    expect(outText()).toContain('NOTE E5: a verdict after the interrupt not kept: E5 verdict: PASS — never reached in time');
    expect(summary()).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      'INTERRUPTED: batch-t run 20261105-094426-4242 was interrupted at 09:44:26',
      'LAB android: OK — emulator-5554, averi_lab',
      'kf live kf1: PASS',
      'kf live verdict: PASS — kf1, kf2, kf3 ok',
      'E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)',
      'E5 cleanup: OK — read back (verified by the abort)',
      'later: INTERRUPTED — its records are not complete, not judged (rerun ONLY=later)',
      'RESTORE: none — everything dirty was put back and verified',
      `09:44:26 ERROR batch-t interrupted (run ${ID}) by SIGINT`,
      "ERROR a log line of kf's",
      `======== SUMMARY end (run ${ID}, INTERRUPTED)`,
    ]);
  });

  it('no block starts once the abort began: a later block\'s need is never checked, a block with a judge not reached never judged', async () => {
    const checked: string[] = [];
    const judged: string[] = [];
    const done = go([e5(), plain('x', { needs: ['android'], judge: async () => (judged.push('x'), ['x verdict: PASS']) })], { needs: { android: async () => (checked.push('android'), { ok: true, how: 'up' }) } });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(checked).toEqual([]);
    expect(judged).toEqual([]);
    expect(summary()).toContain('x: INTERRUPTED — its records are not complete, not judged (rerun ONLY=x)');
  });

  it('a need being checked when the abort begins (its probe stopped): its block is not started', async () => {
    const ran: string[] = [];
    // A check that says up whatever its probe did: only the abort keeps the block from starting.
    const n = { android: async (c: NeedCtx) => (await c.bounded('probe', ['hang'], { secs: 30 }), { ok: true as const, how: 'up' }) };
    const done = go([plain('kf', { needs: ['android'], run: async () => void ran.push('kf') })], { needs: n });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(ran).toEqual([]);
  });

  it('a later block skipped for its precondition is not even said skipped once the abort began: nothing more of the body runs (review round 2 mutation)', async () => {
    const done = go([e5(), plain('b', { preconditions: [async () => ({ ok: false, why: 'no' })] })]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(outText()).not.toContain('SKIP b not run');
  });

  it('no further need of a block is checked once the abort began during one of them (review round 2)', async () => {
    const checked: string[] = [];
    const n = {
      android: async (c: NeedCtx) => (checked.push('android'), await c.bounded('probe', ['hang'], { secs: 30 }), { ok: true as const, how: 'up' }),
      ios: async () => (checked.push('ios'), { ok: true as const, how: 'up' }),
    };
    const done = go([plain('B2', { needs: ['android', 'ios'] })], { needs: n });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(checked).toEqual(['android']);
  });

  it('a live run whose rejudge was cut: its run had not returned — INTERRUPTED, its gap the why, the rerun hint kept (batch-12: every .cases its record and rejudge; review round 6)', async () => {
    seam.rules = [git(), probes, live({ rejudge: { hang: true } })];
    const done = go([kfBlock()]);
    await until(() => seam.words().some((w) => w.includes('--rejudge')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('kf: INTERRUPTED — not judged (1 of 1 run(s) incomplete: android-kf-1 — android-kf-1.rejudge.txt has no `# Live golden:` line (the rejudge did not finish); uiautomator: kf1, kf2, kf3 missing from the summary; rerun ONLY=kf)');
  });

  it('interrupted inside live.ts (no record yet): its run had not returned — INTERRUPTED, its gap the why, `rerun ONLY=kf` kept (review round 6)', async () => {
    seam.rules = [git(), probes, (cmd, args) => (args.includes('--record') ? { hang: true } : undefined)];
    const done = go([kfBlock()]);
    await until(() => seam.words().some((w) => w.includes('--record')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('kf: INTERRUPTED — not judged (1 of 1 run(s) incomplete: android-kf-1 — no record (android-kf-1.json); android-kf-1.log has no `# Live golden:` line (live.ts did not finish); no rejudge summary (android-kf-1.rejudge.txt); rerun ONLY=kf)');
    expect(summary().some((l) => l.startsWith('kf live verdict:'))).toBe(false);
  });

  it('the abort reads completeness within what is left of its judging budget: a table that never loads — not complete, said so (review round 6)', async () => {
    const done = go([kfBlock(), plain('E5', { run: async (ctx) => void (await ctx.bounded('probe', ['hang'], { secs: 30 })) })], { io: { table: () => new Promise(() => {}), judgeBudgetSecs: 0.05 } });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('kf: INTERRUPTED — not judged (completeness not read in time; rerun ONLY=kf)');
  });

  it('the abort\'s judge and a block\'s complete() read its folder', async () => {
    const T6 = plain('T6', {
      run: async (ctx) => writeFileSync(join(ctx.dir, 'static.txt'), 'captured'),
      complete: ({ dir, fs }) => fs.exists(join(dir, 'static.txt')),
      judge: async ({ dir, fs }) => [`T6 verdict: PASS — ${fs.read(join(dir, 'static.txt'))}`],
    });
    const done = go([T6, e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('T6 verdict: PASS — captured');
  });

  it('interrupted during the normal end\'s judging: only the abort\'s SUMMARY, never a second', async () => {
    let calls = 0;
    // The normal end's judge waits on a probe; the abort's (the block is complete) answers at once.
    const done = go([plain('a', { run: async () => {}, noRecords: true, judge: async ({ run }) => (calls++ === 0 && (await run('probe', ['hang'], { secs: 30 })), ['a verdict: PASS — judged']) })]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(seam.exits).toEqual([130]);
    expect(text(join(dirOf('meta'), 'summary.txt')).split('======== SUMMARY end').length).toBe(2);
  });

  it('interrupted in the last block: the normal end\'s judges are not run (the abort judges what is complete)', async () => {
    const judged: string[] = [];
    const done = go([plain('a', { run: async () => {}, judge: async () => (judged.push('a'), ['a verdict: PASS']) }), e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    await tick(10);
    expect(judged).toEqual([]);
    expect(outText()).not.toContain('finish() ignored');
  });

  it('records complete, judged by the abort, but its judge wrote no verdict of its label: INCONCLUSIVE saying so, never missing (review round 1, MAJOR)', async () => {
    const T6 = (judge: string[]) => plain('T6', { run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 })), judge: async () => judge });
    for (const lines of [[], ['T6 sample: 3 of 3']]) {
      rmSync(out, { recursive: true, force: true });
      seam = new FakeSeam([git(), probes, live()]);
      const done = go([T6(lines), e5()]);
      await until(() => seam.words().includes('probe hang'));
      seam.handlers!.signal('SIGINT');
      expect(await done).toBe(130);
      expect(summary()).toEqual(expect.arrayContaining([...lines, 'T6 verdict: INCONCLUSIVE — interrupted: its judge wrote no verdict']));
    }
  });

  it('every wanted block has a line in the abort SUMMARY, whatever its state at the interrupt (review round 1: the invariant)', async () => {
    const blocks = [
      plain('own'),
      plain('skipped', { preconditions: [async () => ({ ok: false, why: 'no' })] }),
      plain('down', { needs: ['android'] }),
      plain('empty', { run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 })), judge: async () => [] }),
      plain('half', { run: async (ctx) => ctx.asks('c', { kind: 'runs', runs: 2 }), judge: async () => ['half verdict: PASS'] }),
      e5(),
      plain('later', { judge: async () => ['later verdict: PASS'] }),
    ];
    const done = go(blocks, { needs: { ...needs, android: async () => ({ ok: false, why: 'down' }) } });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    for (const b of blocks) expect(summary().some((l) => l.startsWith(`${b.label}:`) || l.startsWith(`${b.id}:`)), b.id).toBe(true);
  });

  it('every wanted block has a line in the normal SUMMARY too', async () => {
    const blocks = [plain('own'), plain('skipped', { preconditions: [async () => ({ ok: false, why: 'no' })] }), plain('down', { needs: ['android'] }), plain('silent', { run: async () => {} }), plain('judged', { run: async () => {}, judge: async () => [] })];
    await go(blocks, { needs: { ...needs, android: async () => ({ ok: false, why: 'down' }) } });
    for (const b of blocks) expect(summary().some((l) => l.startsWith(`${b.label}:`)), b.id).toBe(true);
  });

  it('a protected-key line written after the interrupt is only noted: it never reaches the abort SUMMARY (review round 1, MAJOR)', async () => {
    const done = go([plain('E5', { run: async (ctx) => (await ctx.bounded('probe', ['hang'], { secs: 30 }), ctx.protectedLine('OK   the finportal key unchanged')) })]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    await tick(5);
    expect(summary()).not.toContain('OK   the finportal key unchanged');
    expect(outText()).toContain('NOTE a protected-key line after the interrupt not kept: OK   the finportal key unchanged');
  });

  it('a need whose check ends after the interrupt (its probe stopped): no LAB line blaming the lab, no ERROR — only noted (review round 1, MAJOR)', async () => {
    for (const ending of ['fails', 'throws']) {
      rmSync(out, { recursive: true, force: true });
      seam = new FakeSeam([git(), probes, live()]);
      const n = {
        android: async (c: NeedCtx) => {
          await c.bounded('probe', ['hang'], { secs: 30 });
          if (ending === 'throws') throw new Error('adb gone');
          return { ok: false as const, why: 'its probe was stopped' };
        },
      };
      const done = go([plain('kf', { needs: ['android'] })], { needs: n });
      await until(() => seam.words().includes('probe hang'));
      seam.handlers!.signal('SIGINT');
      expect(await done).toBe(130);
      expect(summary().some((l) => l.startsWith('LAB '))).toBe(false);
      expect(summary().some((l) => /ERROR LAB/.test(l))).toBe(false);
      expect(outText()).toContain('NOTE LAB android: its answer after the interrupt not kept');
    }
  });

  it('a noRecords block is complete for the abort only once its run returned: finished, judged; cut mid-run, INTERRUPTED (code review c1)', async () => {
    const done = go([
      plain('a', { run: async () => {}, noRecords: true, judge: async () => ['a verdict: PASS — judged'] }),
      plain('E5', { noRecords: true, run: async (ctx) => void (await ctx.bounded('probe', ['hang'], { secs: 30 })), judge: async () => ['E5 verdict: PASS — never'] }),
    ]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('a verdict: PASS — judged');
    expect(summary()).toContain('E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)');
  });

  it('records complete but no judge to read them: INTERRUPTED, nothing invented', async () => {
    const done = go([plain('T6', { run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 })) }), e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('T6: INTERRUPTED — its records are not complete, not judged (rerun ONLY=T6)');
  });

  it('a block that wrote its own verdict keeps those lines: its judge is not run again by the abort', async () => {
    const judged: string[] = [];
    const done = go([plain('a', { judge: async () => (judged.push('a'), ['a verdict: FAIL — judged again']) }), e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(judged).toEqual([]);
    expect(summary()).toContain('a verdict: PASS');
    expect(summary()).not.toContain('a verdict: FAIL — judged again');
  });

  it('a block whose verdict was written before the interrupt keeps it, judged as is; one skipped keeps its INCONCLUSIVE', async () => {
    const done = go([plain('a'), plain('b', { preconditions: [async () => ({ ok: false, why: 'no' })] }), e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('a verdict: PASS');
    expect(summary()).toContain('b verdict: INCONCLUSIVE — precondition: no');
    expect(summary()).not.toContain('a: INTERRUPTED — its records are not complete, not judged (rerun ONLY=a)');
  });

  it('a throw out of a block takes the abort path (S2: TRAPEXIT\'s port), exit 130, its window put back', async () => {
    const code = await go([plain('E5', { run: async (ctx) => { ctx.open('E5', { hand: ['h'], restore: async () => ({ ok: true, how: 'read back' }) }); throw new Error('EVIL is not defined'); } })]);
    expect(code).toBe(130);
    expect(summary()).toContain(`09:44:26 ERROR batch-t interrupted (run ${ID}) by an error: EVIL is not defined`);
    expect(outText()).toContain('OK   E5 put back (verified by the abort): read back');
  });

  it('interrupted before the checkout was read: the abort\'s checkout line says so', async () => {
    seam.rules = [(cmd) => (cmd === 'git' ? { hang: true } : undefined)];
    const done = go([plain('kf')]);
    await until(() => seam.calls.length > 0);
    seam.handlers!.signal('SIGTERM');
    expect(await done).toBe(130);
    expect(summary()[1]).toBe('NOTE checkout: not read before the interrupt');
  });

  it('a non-live record complete is judged by the abort; an incomplete one INCONCLUSIVE with its gap (review round 5)', async () => {
    const recorded = (id: string, runs: number) =>
      plain(id, {
        run: async (ctx) => {
          ctx.asks('c', { kind: 'runs', runs: 3 });
          ctx.record('c', { kind: 'runs', runs });
        },
        judge: async () => [`${id} verdict: PASS — judged by the abort`],
      });
    const done = go([recorded('T6', 3), recorded('T7', 2), e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('T6 verdict: PASS — judged by the abort');
    expect(summary()).toContain('T7 verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: c — asked 3 run(s), recorded 2');
  });

  it('a block\'s own complete() overrides the record rule, either way (batch-12\'s kf premise, T6\'s capture)', async () => {
    const T6 = plain('T6', {
      run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 })),
      complete: ({ dir }) => existsSync(join(dir, 'static.txt')),
      judge: async () => ['T6 verdict: PASS'],
    });
    const kf = plain('kf', { run: async () => {}, complete: () => true, judge: async () => ['kf verdict: PASS — its premise verdict'] });
    const done = go([T6, kf, e5()]);
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(summary()).toContain('T6: INTERRUPTED — its records are not complete, not judged (rerun ONLY=T6)');
    expect(summary()).toContain('kf verdict: PASS — its premise verdict');
  });
});

// ------------------------------------------------------------------------------------------------ records

describe('a non-live block\'s record: what it was asked, then what it did — complete only when they match (S3 review: batch-12\'s E5/T6 `{"runs":N}`)', () => {
  it('asked 3, recorded 3, no verdict: the backstop says the runs are complete but nothing judged them', async () => {
    await go([plain('E5', { run: async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 3 }), ctx.record('c', { kind: 'runs', runs: 3 })) })]);
    expect(summary()).toContain('E5 verdict: INCONCLUSIVE — its 1 run(s) are complete, but no verdict line was written (see the ERROR lines)');
    expect(outText()).not.toContain('analyze');
    expect(JSON.parse(text(join(dirOf('E5'), 'c.asked.json')))).toEqual({ kind: 'runs', runs: 3 });
    expect(JSON.parse(text(join(dirOf('E5'), 'c.done.json')))).toEqual({ kind: 'runs', runs: 3 });
    expect(existsSync(join(dirOf('E5'), 'c.cases'))).toBe(false);
  });

  it('asked 3, recorded 2, or nothing recorded: incomplete, each named', async () => {
    await go([plain('E5', { run: async (ctx) => (ctx.asks('a', { kind: 'runs', runs: 3 }), ctx.record('a', { kind: 'runs', runs: 2 }), ctx.asks('c', { kind: 'runs', runs: 1 })) })]);
    expect(summary()).toContain('E5 verdict: INCONCLUSIVE — 2 of 2 run(s) incomplete: a — asked 3 run(s), recorded 2 | c — asked 1 run(s), nothing recorded (no c.done.json)');
  });

  it('a live run and a record in one block: both counted', async () => {
    await go([kfBlock({ judge: undefined, run: async (ctx) => (await ctx.liveRun('android-kf-1', KF, { secs: 60 }), ctx.asks('t', { kind: 'runs', runs: 1 })) })]);
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 2 run(s) incomplete: t — asked 1 run(s), nothing recorded (no t.done.json)');
  });

  it('the batch\'s mistakes thrown (and so the abort): asked twice, recorded twice, recorded before asked, not a record, a name that is no plain segment', async () => {
    const throwsIn = async (run: Block['run'], message: string) => {
      seam = new FakeSeam([git(), probes, live()]);
      rmSync(out, { recursive: true, force: true });
      expect(await go([plain('E5', { run })])).toBe(130);
      expect(summary().join('\n')).toContain(message);
    };
    await throwsIn(async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.asks('c', { kind: 'runs', runs: 1 })), 'c.asked.json already exists: what a run was asked is never overwritten');
    await throwsIn(async (ctx) => (ctx.asks('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 }), ctx.record('c', { kind: 'runs', runs: 1 })), 'c.done.json already exists: what a run recorded is never overwritten');
    await throwsIn(async (ctx) => ctx.record('c', { kind: 'runs', runs: 1 }), 'c: recorded before it was asked (asks first)');
    await throwsIn(async (ctx) => ctx.asks('c', { kind: 'runs', runs: -1 }), 'c: {"kind":"runs","runs":-1} is no record of runs');
    await throwsIn(async (ctx) => ctx.asks('c.d', { kind: 'runs', runs: 1 }), 'run name "c.d": one plain path segment is needed');
  });
});

// ------------------------------------------------------------------------------------------------ live_run

describe('liveRun: the .cases first, live.ts with its record, then its rejudge — each a bounded step (batch-11.sh:459–481, S3\'s stepOutcome)', () => {
  it('the .cases written before live.ts starts; live.ts run from the checkout under test, its log and record in the block\'s folder', async () => {
    seam.watch = [join(dirOf('kf'), 'android-kf-1.cases')];
    let got: unknown;
    await go([kfBlock({ run: async (ctx) => void (got = await ctx.liveRun('android-kf-1', KF, { secs: 60 })) })]);
    const liveCall = seam.calls.findIndex((c) => c.args.includes('--record'));
    expect(seam.seen[liveCall]).toEqual({ [join(dirOf('kf'), 'android-kf-1.cases')]: true });
    expect(seam.calls[liveCall].cwd).toBe(repo);
    expect(JSON.parse(text(join(dirOf('kf'), 'android-kf-1.cases')))).toEqual(KF);
    expect(got).toEqual({ live: { word: 'OK', why: 'exit 0' }, rejudge: { word: 'OK', why: 'exit 0' } });
    expect(text(join(dirOf('kf'), 'android-kf-1.rejudge.txt'))).toContain(LIVE_GOLDEN_HEADER);
    expect(outText()).toContain(`\n== kf live android-kf-1 (log: ${join(dirOf('kf'), 'android-kf-1.log')}) ==\n`);
    expect(outText()).toContain('OK   kf live android-kf-1\n');
    expect(outText()).toContain('OK   kf rejudge android-kf-1\n');
  });

  it('exit 1 with `# Live golden:` in its log is DONE (a MISMATCH, judged later); then the rejudge', async () => {
    seam.rules = [git(), probes, live({ code: 1 })];
    await go([kfBlock()]);
    expect(outText()).toContain(`DONE kf live android-kf-1 (exit 1: a MISMATCH or a known case off, judged by the analyzer) — see ${join(dirOf('kf'), 'android-kf-1.log')}`);
    expect(seam.words().some((w) => w.includes('--rejudge'))).toBe(true);
  });

  it('the rejudge is judged the same way: exit 1 with its header DONE, any other failure FAIL', async () => {
    seam.rules = [git(), probes, live({ rejudge: { code: 1, log: casesSummary(['kf1']) } })];
    await go([kfBlock()]);
    expect(outText()).toContain(`DONE kf rejudge android-kf-1 (exit 1: a MISMATCH or a known case off, judged by the analyzer) — see ${join(dirOf('kf'), 'android-kf-1.rejudge.txt')}`);
    rmSync(out, { recursive: true, force: true });
    seam.rules = [git(), probes, live({ rejudge: { code: 2, log: 'Error: no record\n' } })];
    await go([kfBlock()]);
    expect(outText()).toContain(`FAIL kf rejudge android-kf-1 (exit 2) — see ${join(dirOf('kf'), 'android-kf-1.rejudge.txt')}`);
  });

  it('the rejudge is bounded by rejudgeSecs: past it, its group stopped and the step FAIL (review round 1)', async () => {
    seam.rules = [git(), probes, live({ rejudge: { hang: true } })];
    await go([kfBlock({ run: async (ctx) => void (await ctx.liveRun('android-kf-1', KF, { secs: 60, rejudgeSecs: 0.05 })) })]);
    expect(outText()).toContain(`FAIL kf rejudge android-kf-1 (timed out (exit 142: past its bound)) — see ${join(dirOf('kf'), 'android-kf-1.rejudge.txt')}`);
  });

  it('exit 1 without it is FAIL: live.ts died before judging (batch-10\'s judged exit-1 rule)', async () => {
    seam.rules = [git(), probes, live({ code: 1, header: false })];
    let got: unknown;
    await go([kfBlock({ run: async (ctx) => void (got = await ctx.liveRun('android-kf-1', KF, { secs: 60 })) })]);
    expect(outText()).toContain('FAIL kf live android-kf-1 (exit 1 with no `# Live golden:` line in its log: live.ts did not finish)');
    expect(got).toMatchObject({ live: { word: 'FAIL' } });
  });

  it('no record written: FAIL naming it, and no rejudge (batch-11.sh:480)', async () => {
    seam.rules = [git(), probes, live({ noRecord: true })];
    let got: unknown;
    await go([kfBlock({ run: async (ctx) => void (got = await ctx.liveRun('android-kf-1', KF, { secs: 60 })) })]);
    expect(outText()).toContain(`FAIL kf android-kf-1: no record written (${join(dirOf('kf'), 'android-kf-1.json')})`);
    expect(seam.words().some((w) => w.includes('--rejudge'))).toBe(false);
    expect(got).toEqual({ live: { word: 'OK', why: 'exit 0' } });
  });

  it('no device id for its platform: FAIL, nothing run, the .cases kept (asked, never ran — the backstop says so)', async () => {
    let got: unknown;
    await go([kfBlock({ judge: undefined, run: async (ctx) => void (got = await ctx.liveRun('android-kf-1', KF, { secs: 60 })) })], { argv: ['--out', out, '--repo', repo] });
    expect(got).toEqual({ live: { word: 'FAIL', why: 'no lab emulator serial given (--serial or AVERI_LAB_SERIAL)' } });
    expect(seam.words().some((w) => w.includes('live.ts'))).toBe(false);
    expect(outText()).toContain('FAIL kf live android-kf-1: no lab emulator serial given (--serial or AVERI_LAB_SERIAL)');
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — asked but never ran (no record, log or summary beside its .cases)');
  });

  it('the iOS run gets --udid and its sources; each call bounded by the secs given, the rejudge by its own', async () => {
    const asked: Asked = { platform: 'ios', app: 'native', sources: ['wda'], cases: ['p7w'] };
    await go([plain('D43', { run: async (ctx) => void (await ctx.liveRun('ios-wda-1', asked, { secs: 60, rejudgeSecs: 30 })) })]);
    expect(seam.words().find((w) => w.includes('--record'))).toContain('--udid U-1 --sources wda --groups forms --cases p7w');
  });
});

describe('asksLive: a live run\'s .cases written before a stretch that may never reach it (T2 S6b: batch-11\'s WDA window wrote its .cases before its backup, 625–627)', () => {
  it('the .cases written at once; liveRun of that name and the same asked later runs without writing it again', async () => {
    seam.watch = [join(dirOf('kf'), 'android-kf-1.cases')];
    await go([kfBlock({ run: async (ctx) => {
      ctx.asksLive('android-kf-1', KF);
      await ctx.bounded('probe', ['backup'], { secs: 5 });
      // The same ask built in another field order: the same ask.
      await ctx.liveRun('android-kf-1', { cases: KF.cases, sources: KF.sources, app: KF.app, platform: KF.platform }, { secs: 60 });
    } })]);
    expect(seam.seen[seam.words().indexOf('probe backup')]).toEqual({ [join(dirOf('kf'), 'android-kf-1.cases')]: true });
    expect(summary()).toContain('kf live verdict: PASS — kf1, kf2, kf3 ok');
  });

  it('asked and never run: the backstop says so (b11-dry d43-backupfail: "asked but never ran", never a missing line)', async () => {
    await go([kfBlock({ judge: undefined, run: async (ctx) => ctx.asksLive('android-kf-1', KF) })]);
    expect(summary()).toContain('kf live verdict: INCONCLUSIVE — 1 of 1 run(s) incomplete: android-kf-1 — asked but never ran (no record, log or summary beside its .cases)');
  });

  it('liveRun of that name asked otherwise, or a second asksLive of it: the batch\'s mistake, thrown (what a run was asked is never overwritten)', async () => {
    const other: Asked = { ...KF, cases: ['kf1'] };
    await go([kfBlock({ run: async (ctx) => (ctx.asksLive('android-kf-1', KF), void (await ctx.liveRun('android-kf-1', other, { secs: 60 }))) })]);
    expect(summary().join('\n')).toContain('android-kf-1 was asked otherwise before');
    rmSync(out, { recursive: true, force: true });
    await go([kfBlock({ run: async (ctx) => (ctx.asksLive('android-kf-1', KF), ctx.asksLive('android-kf-1', KF)) })]);
    expect(summary().join('\n')).toContain('android-kf-1.cases already exists');
  });

  it('a noRecords block that calls it: thrown, as for liveRun', async () => {
    await go([plain('p', { noRecords: true, run: async (ctx) => ctx.asksLive('r', KF) })]);
    expect(summary().join('\n')).toContain('p declared noRecords, yet called asksLive');
  });
});

describe('the run\'s fs in a block\'s and a need\'s ctx: the lab plumbing reads and writes through it (io.ts, T2 S6b)', () => {
  it('both get the run\'s own BatchFs', async () => {
    const seen: unknown[] = [];
    await go([plain('kf', { needs: ['android'], run: async (ctx) => (seen.push(ctx.fs), ctx.verdict('PASS')) })], {
      needs: { android: async (c: NeedCtx) => (seen.push(c.fs), { ok: true as const, how: 'x' }) },
    });
    expect(seen).toEqual([nodeFs, nodeFs]);
  });
});

describe('the run\'s last steps (lastly): each after the kept groups, on both ends, through detached calls (T2 S6b: batch-11.sh:660, 205–206)', () => {
  const pkill: NonNullable<RunBatchOptions<KnobSpec>['lastly']>[number] = async ({ run, step }) => {
    const r = await run('probe', ['pkill-wda'], { secs: 5 });
    step('NOTE', `the lab's WebDriverAgent: probe exit ${r.code}`);
  };

  it('the normal end: after the windows went to RESTORE and the kept groups ended, before the judges and the SUMMARY; a throw an ERROR line, the next step still run', async () => {
    const order: string[] = [];
    await go([plain('A', { run: async (ctx) => (await ctx.bounded('idb', ['a'], { secs: 5 }), ctx.verdict('PASS')) })], {
      lastly: [
        async () => {
          order.push(`first, the companion ${seam.signals.includes('SIGTERM idb a') ? 'ended' : 'alive'}`);
          throw new Error('pkill: refused\nmore');
        },
        async (l) => (order.push('second'), pkill(l)),
      ],
    });
    expect(order).toEqual(['first, the companion ended', 'second']);
    expect(outText()).toContain("NOTE the lab's WebDriverAgent: probe exit 0");
    expect(summary()).toContain("09:44:26 ERROR the run's last step 1 failed: pkill: refused");
  });

  it('the abort: run after the restores, its calls detached (they start while the run is being stopped)', async () => {
    const done = go([plain('E5', { run: async (ctx) => void (await ctx.bounded('probe', ['hang'], { secs: 30 })) })], { lastly: [pkill] });
    await until(() => seam.words().includes('probe hang'));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(seam.words()).toContain('probe pkill-wda');
    expect(text(join(out, 'steps.log'))).toContain("NOTE the lab's WebDriverAgent: probe exit 0");
  });
});

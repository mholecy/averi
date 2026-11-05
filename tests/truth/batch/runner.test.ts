import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Asked } from '../../../scripts/truth/batch/cases.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { runBatch, type Block, type NeedCtx, type RunBatchOptions, type RunIo } from '../../../scripts/truth/batch/runner.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import type { KnobSpec } from '../../../scripts/truth/batch/select.js';

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
  ({ code = 0, header = true, noRecord = false, logExtra = '' }: { code?: number; header?: boolean; noRecord?: boolean; logExtra?: string } = {}): Rule =>
  (cmd, args) => {
    if (cmd !== process.execPath || !args.some((a) => a.endsWith('live.ts'))) return undefined;
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    if (args.includes('--rejudge')) return { log: casesSummary(['kf1', 'kf2', 'kf3']) };
    const cases = args.includes('--cases') ? at('--cases').split(',') : [];
    return { code, log: `${header ? casesSummary(cases) : 'live.ts: started\n'}${logExtra}`, files: noRecord ? {} : { [at('--record')]: '{"platform":"android","results":[]}' } };
  };
/** A probe: `probe <name>` exits 0, `hang` runs until stopped. */
const probes: Rule = (cmd, args) => (cmd === 'probe' ? (args[0] === 'hang' ? { hang: true } : ok(`${args[0]} done\n`)) : undefined);

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

const dirOf = (block: string) => join(out, block, `run-${ID}`);
const text = (p: string) => readFileSync(p, 'utf8');
const summary = () => text(join(dirOf('meta'), 'summary.txt')).split('\n').slice(0, -1);
const outText = () => text(join(dirOf('meta'), 'batch-t.out'));
const KF: Asked = { platform: 'android', app: 'native', sources: ['uiautomator'], cases: ['kf1', 'kf2', 'kf3'] };

const needs = {
  android: async () => ({ ok: true as const, how: 'emulator-5554, averi_lab' }),
  ios: async () => ({ ok: true as const, how: 'averi-lab iPhone 17' }),
};

function go(blocks: Block[], over: Partial<Pick<RunBatchOptions<KnobSpec>, 'knobs' | 'needs' | 'batchReasons'>> & { env?: Record<string, string>; argv?: string[]; io?: Partial<RunIo> } = {}): Promise<number> {
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
    await expect(go([plain('k f')])).rejects.toThrow('one plain path segment');
    expect(seam.calls).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });
});

describe('the run\'s folders: one fresh run-<id> per wanted block, and the lab folder on every run (batch-11.sh:116–121)', () => {
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

// ------------------------------------------------------------------------------------------------ preconditions

describe('preconditions: a failed one makes the block INCONCLUSIVE, never a refusal; the SUMMARY is written (S3: the runner\'s choice, batch-11\'s way)', () => {
  it('HEAD ≠ main: the checkout line says so, every block INCONCLUSIVE with its why, none run, no need checked, exit 0', async () => {
    seam.rules = [git({ 'refs/heads/main': ok(`${OTHER}\n`) }), probes, live()];
    const ran: string[] = [];
    const code = await go([kfBlock({ run: async () => void ran.push('kf') }), d43Block({ run: async () => void ran.push('D43'), preconditions: [async (k) => k.ancestor('c'.repeat(40), 'M_D43')] })]);
    expect(code).toBe(0);
    const why = "the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun";
    expect(summary()).toEqual([
      '======== SUMMARY',
      `ERROR checkout: ${why} — every block INCONCLUSIVE, none run`,
      `kf live verdict: INCONCLUSIVE — precondition: ${why}`,
      `D43 live verdict: INCONCLUSIVE — precondition: ${why}`,
      'RESTORE: none — everything dirty was put back and verified',
      `09:44:26 ERROR checkout: ${why} — every block INCONCLUSIVE, none run`,
      `======== SUMMARY end (run ${ID})`,
    ]);
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

  it('a need shared by two blocks is checked once; its lab line once; a need no wanted block names is never checked', async () => {
    const checked: string[] = [];
    const n = { android: async () => (checked.push('android'), { ok: true as const, how: 'up' }), ios: async () => (checked.push('ios'), { ok: true as const, how: 'up' }) };
    await go([plain('a', { needs: ['android'] }), plain('b', { needs: ['android'] }), plain('c', { needs: ['ios'] })], { needs: n, env: { ONLY: 'a,b' } });
    expect(checked).toEqual(['android']);
    expect(summary().filter((l) => l.startsWith('LAB '))).toEqual(['LAB android: OK — up']);
  });

  it('two needs failed: both named; a check that throws is a failed need and an ERROR line, never the run\'s abort', async () => {
    const n = { android: async () => ({ ok: false as const, why: 'down' }), ios: async (): Promise<never> => { throw new Error('simctl gone'); } };
    expect(await go([plain('B2', { needs: ['ios', 'android'] })], { needs: n })).toBe(0);
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
    await go([plain('kf', { needs: ['android'] })], { needs: n });
    expect(got).toEqual({ labDir: dirOf('lab'), serial: 'emulator-5554' });
    expect(seam.words()).toContain('probe emu');
  });
});

// ------------------------------------------------------------------------------------------------ the backstop

describe('the backstop: a wanted block with no verdict line of its label gets one (batch-10/11; b11-dry d43-backupfail, noandroid)', () => {
  it('a block that wrote nothing: "not run (see the ERROR lines)"', async () => {
    await go([plain('D62', { run: async (ctx) => ctx.err('D62: the lab is not main\'s — skipped') })]);
    expect(summary()).toContain('D62 verdict: INCONCLUSIVE — not run (see the ERROR lines)');
    expect(summary()).toContain("09:44:26 ERROR D62: the lab is not main's — skipped");
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

  it('the judge on the normal path: only for a block that ran and wrote no verdict of its own; its run and folder given', async () => {
    const judged: string[] = [];
    const judge = (id: string) => async (j: { dir: string }) => (judged.push(`${id} ${j.dir}`), [`${id} verdict: PASS — judged`]);
    await go([
      plain('a', { judge: judge('a'), run: async () => {} }),
      plain('b', { judge: judge('b') }),
      plain('c', { judge: judge('c'), needs: ['android'] }),
      plain('d', { judge: judge('d'), preconditions: [async () => ({ ok: false, why: 'no' })] }),
    ], { needs: { ...needs, android: async () => ({ ok: false, why: 'down' }) } });
    expect(judged).toEqual([`a ${dirOf('a')}`]);
    expect(summary()).toContain('a verdict: PASS — judged');
    expect(outText()).toContain('OK   a analyze');
  });
});

// ------------------------------------------------------------------------------------------------ ERROR lines

describe('the ERROR lines: this run\'s steps and every ERROR line of its blocks\' logs and analyze.txt, each once (batch-6, batch-12.sh:667–668)', () => {
  it('a block\'s .log and analyze.txt and the lab folder\'s logs read; another file, and an earlier run\'s logs, not; a line twice printed once', async () => {
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
    expect(errors).toEqual(['ERROR the catalog drifted', 'ERROR the analyzer\'s own', 'ERROR the cell did not open']);
  });

  it('an ERROR inside a verdict line is that block\'s verdict, never an ERROR line (S1)', async () => {
    await go([plain('E5', { run: async (ctx) => ctx.verdict('ERROR', 'the lab not proven installed', 'E5 cleanup') })]);
    expect(summary()).toContain('E5 cleanup: ERROR — the lab not proven installed');
    expect(summary().filter((l) => /ERROR/.test(l) && !l.startsWith('E5 cleanup'))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ RESTORE, exit

describe('RESTORE and the exit code (words.ts#exitCodeOf: 1 for a FAIL or a RESTORE line; WARN, INCONCLUSIVE, ERROR alone 0)', () => {
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

  it('a non-live record complete is judged by the abort; an incomplete one INTERRUPTED', async () => {
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
    expect(summary()).toContain('T7: INTERRUPTED — its records are not complete, not judged (rerun ONLY=T7)');
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
    expect(outText()).toContain('OK   kf live android-kf-1\n');
    expect(outText()).toContain('OK   kf rejudge android-kf-1\n');
  });

  it('exit 1 with `# Live golden:` in its log is DONE (a MISMATCH, judged later); then the rejudge', async () => {
    seam.rules = [git(), probes, live({ code: 1 })];
    await go([kfBlock()]);
    expect(outText()).toContain(`DONE kf live android-kf-1 (exit 1: a MISMATCH or a known case off, judged by the analyzer) — see ${join(dirOf('kf'), 'android-kf-1.log')}`);
    expect(seam.words().some((w) => w.includes('--rejudge'))).toBe(true);
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
    await go([kfBlock({ judge: undefined })], { argv: ['--out', out, '--repo', repo] });
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

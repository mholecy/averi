import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Calls } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { ancestor, checkout, preconditionLine, shortSha } from '../../../scripts/truth/batch/preconditions.js';
import { nodeProcess } from '../../../scripts/truth/batch/proc.js';

vi.setConfig({ testTimeout: 10_000, hookTimeout: 10_000 });

// scripts/truth/batch/preconditions.ts over real temporary git repos, git started through S2's bounded seam (proc.ts):
// the answers preconditions.test.ts fakes, given by git itself. Each repo is made in a mkdtemp with its own HOME and
// git config, and without the GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE a hook's context would pass down: nothing of
// the machine's git setup, or of the checkout running the tests, reaches it. Kept apart from preconditions.test.ts: it
// starts processes, which the mutation run does not.

let tmp: string;
let repo: string;
let env: NodeJS.ProcessEnv;
const calls = new Calls(nodeProcess);
const run = calls.bounded;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'batch-git-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  writeFileSync(join(tmp, 'gitconfig'), '');
  env = { ...process.env, HOME: tmp, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_SYSTEM: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[k];
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** git in the temp repo, through the bounded seam; it must succeed. Its stdout, trimmed. */
async function git(...args: string[]): Promise<string> {
  const r = await run('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { env, secs: 10 });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: exit ${r.code}: ${r.err}`);
  return r.out.trim();
}
/** A commit of `file` holding `text`; its sha. */
async function commit(file: string, text: string): Promise<string> {
  writeFileSync(join(repo, file), text);
  await git('add', file);
  await git('commit', '-q', '-m', `${file}: ${text}`);
  return git('rev-parse', 'HEAD');
}
/** main with two commits; HEAD on main. */
async function mainRepo(): Promise<{ first: string; head: string }> {
  await git('init', '-q', '-b', 'main');
  const first = await commit('a.txt', '1');
  return { first, head: await commit('b.txt', '2') };
}
const g = () => ({ repo, run, env });

describe('checkout over a real repo — main\'s clean HEAD (batch-11.sh:209–219)', () => {
  it('HEAD = main, clean: ok, with its sha (batch-11\'s checkout gate)', async () => {
    const { head } = await mainRepo();
    expect(await checkout(g())).toEqual({ ok: true, head });
  });

  it('HEAD on a branch whose commit is not main\'s: both named (batch-11\'s "git switch main, then rerun")', async () => {
    const { head } = await mainRepo();
    await git('switch', '-q', '-c', 'side');
    const side = await commit('c.txt', '3');
    expect(await checkout(g())).toEqual({ ok: false, why: `the checkout's HEAD (${shortSha(side)}) is not main's (${shortSha(head)}) — git switch main, then rerun` });
  });

  it('a branch at main\'s very commit: ok (the code is main\'s); a detached HEAD at main\'s commit: ok too (T2 S3 decision)', async () => {
    const { head } = await mainRepo();
    await git('switch', '-q', '-c', 'same');
    expect(await checkout(g())).toEqual({ ok: true, head });
    await git('switch', '-q', '--detach', 'main');
    expect(await checkout(g())).toEqual({ ok: true, head });
  });

  it('a detached HEAD at another commit: not main\'s (batch-11 compared the shas; T2 S3 decision)', async () => {
    const { first, head } = await mainRepo();
    await git('switch', '-q', '--detach', first);
    expect(await checkout(g())).toEqual({ ok: false, why: `the checkout's HEAD (${shortSha(first)}) is not main's (${shortSha(head)}) — git switch main, then rerun` });
  });

  it('a modified tracked file: named, counted (batch-11: the batch runs main as committed)', async () => {
    await mainRepo();
    writeFileSync(join(repo, 'a.txt'), 'changed');
    expect(await checkout(g())).toEqual({ ok: false, why: 'the checkout has 1 modified tracked file(s) (a.txt) — the batch runs main as committed' });
  });

  it('an untracked file is allowed (batch-11 and batch-12: --untracked-files=no)', async () => {
    const { head } = await mainRepo();
    writeFileSync(join(repo, 'new.txt'), 'x');
    expect(await checkout(g())).toEqual({ ok: true, head });
  });

  it('a staged change counts as modified, a new file staged too; a staged rename once, by its new name (T2 S3 decision: status -z)', async () => {
    await mainRepo();
    writeFileSync(join(repo, 'n.txt'), 'x');
    await git('add', 'n.txt');
    await git('mv', 'b.txt', 'c d.txt');
    expect(await checkout(g())).toEqual({ ok: false, why: 'the checkout has 2 modified tracked file(s) (c d.txt, n.txt) — the batch runs main as committed' });
  });

  it('no branch main (init -b trunk): said, never a pass (T2 S3 decision)', async () => {
    await git('init', '-q', '-b', 'trunk');
    await commit('a.txt', '1');
    const r = await checkout(g());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toMatch(/^the repo has no branch main \(git rev-parse: exit 128: fatal: /);
  });

  it('no repo there: git failed, its own first line said (T2 S3: git failing is never a precondition\'s answer)', async () => {
    const r = await checkout({ ...g(), env: { ...env, GIT_CEILING_DIRECTORIES: tmp } });
    expect(r.ok === false && r.why).toMatch(/^git rev-parse --show-toplevel failed \(exit 128: fatal: not a git repository/);
  });

  it('GIT_DIR inherited from a hook\'s context does not leak in: the repo named is the repo read (T2 S3 decision)', async () => {
    const { head } = await mainRepo();
    const other = join(tmp, 'other');
    mkdirSync(other);
    await run('git', ['-C', other, 'init', '-q', '-b', 'main'], { env, secs: 10 });
    expect(await checkout({ ...g(), env: { ...env, GIT_DIR: join(other, '.git'), GIT_INDEX_FILE: join(other, '.git', 'index') } })).toEqual({ ok: true, head });
  });

  it('a folder inside the checkout named as the repo: not its top, the top named; ancestor says the same (review round 1)', async () => {
    const { first } = await mainRepo();
    const sub = join(repo, 'sub');
    mkdirSync(sub);
    const why = `${sub} is not the top of a git checkout (top is ${nodeFs.real(repo)})`;
    expect(await checkout({ ...g(), repo: sub })).toEqual({ ok: false, why });
    expect(await ancestor({ ...g(), repo: sub, sha: first })).toEqual({ ok: false, why });
  });

  it('config given through the env (git -c\'s GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT/KEY/VALUE) cannot hide a modified file (review round 1)', async () => {
    await mainRepo();
    chmodSync(join(repo, 'a.txt'), 0o755);
    const dirty = { ok: false, why: 'the checkout has 1 modified tracked file(s) (a.txt) — the batch runs main as committed' };
    const viaParameters = { ...env, GIT_CONFIG_PARAMETERS: "'core.filemode'='false'" };
    const viaCount = { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fileMode', GIT_CONFIG_VALUE_0: 'false' };
    // Handed to git, either hides the mode change: the status reads clean.
    for (const e of [viaParameters, viaCount]) expect((await run('git', ['-C', repo, 'status', '--porcelain'], { env: e, secs: 10 })).out).toBe('');
    expect(await checkout({ ...g(), env: viaParameters })).toEqual(dirty);
    expect(await checkout({ ...g(), env: viaCount })).toEqual(dirty);
  });

  it('a tracked file named with a line break, modified: named JSON-quoted, and the block\'s line made without a throw (review round 1)', async () => {
    await mainRepo();
    await commit('a\nb', '1');
    writeFileSync(join(repo, 'a\nb'), '2');
    const r = await checkout(g());
    expect(r).toEqual({ ok: false, why: 'the checkout has 1 modified tracked file(s) ("a\\nb") — the batch runs main as committed' });
    expect(preconditionLine('kf live verdict', [r])).toBe('kf live verdict: INCONCLUSIVE — precondition: the checkout has 1 modified tracked file(s) ("a\\nb") — the batch runs main as committed');
  });

  it('git past an injected bound (a git that hangs): "git timed out", the call and the bound named, back in under 3 s (batch-7\'s bounded calls; T2 S3: batch-11 ran git unbounded)', async () => {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 5\n');
    chmodSync(join(bin, 'git'), 0o755);
    const t0 = Date.now();
    expect(await checkout({ repo, run, env: { ...env, PATH: `${bin}:${env.PATH ?? ''}` }, secs: 0.3 })).toEqual({ ok: false, why: 'git timed out (rev-parse --show-toplevel, past its 0.3 s bound)' });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('ancestor over a real repo — a required commit by ancestry (batch-11.sh:238–242)', () => {
  it('the first commit, an ancestor of HEAD: ok; HEAD itself: ok; by a 7-digit short sha too (batch-4\'s ancestry gate)', async () => {
    const { first, head } = await mainRepo();
    expect(await ancestor({ ...g(), sha: first })).toEqual({ ok: true });
    expect(await ancestor({ ...g(), sha: head })).toEqual({ ok: true });
    expect(await ancestor({ ...g(), sha: first.slice(0, 7) })).toEqual({ ok: true });
  });

  it('a sha of a bad format: refused before git is asked (batch-11.sh:80\'s knob rule)', async () => {
    await mainRepo();
    expect(await ancestor({ ...g(), sha: 'HEAD~1', what: 'M_D43' })).toEqual({ ok: false, why: 'M_D43="HEAD~1" is not a commit sha (7–40 hex digits)' });
  });

  it('an unknown sha: no commit of this repo, git\'s own line said (batch-11\'s "no commit of this repo"; T2 S3: cat-file exits 128 for no repo too)', async () => {
    await mainRepo();
    expect(await ancestor({ ...g(), sha: 'deadbeef', what: 'M_D43' })).toEqual({ ok: false, why: 'M_D43=deadbeef names no commit of this repo (git: fatal: Not a valid object name deadbeef^{commit})' });
  });

  it('a tree\'s sha (an object, but no commit): no commit of this repo (T2 S3 decision: ^{commit})', async () => {
    await mainRepo();
    const tree = await git('rev-parse', 'HEAD^{tree}');
    const r = await ancestor({ ...g(), sha: tree });
    expect(r.ok === false && r.why).toMatch(new RegExp(`^${tree} names no commit of this repo \\(git: `));
  });

  it('a commit on a side branch, not merged: not an ancestor of HEAD (batch-11\'s D43 gate: "not merged into main yet")', async () => {
    await mainRepo();
    await git('switch', '-q', '-c', 'side');
    const side = await commit('s.txt', 'x');
    await git('switch', '-q', 'main');
    expect(await ancestor({ ...g(), sha: side, what: 'M_D43' })).toEqual({ ok: false, why: `M_D43=${side} is not an ancestor of HEAD (not merged into main yet)` });
    await git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    expect(await ancestor({ ...g(), sha: side })).toEqual({ ok: true });
  });
});

import { describe, expect, it } from 'vitest';
import { GIT_SECS, NOT_STARTED, TIMED_OUT, type Call, type CallResult, type Run } from '../../../scripts/truth/batch/bounded.js';
import type { LiveCases } from '../../../scripts/truth/batch/cases.js';
import { ancestor, casesOnMain, cellsOnMain, checkout, gitEnv, preconditionLine, SHA_FORMAT, SHOWN_PATHS } from '../../../scripts/truth/batch/preconditions.js';
import { exitCodeOf, parseVerdictLine, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/preconditions.ts over a fake Run: which git calls a precondition makes, in which order, and what
// each answer of git becomes — a pass, or one short why an agent can act on. The same preconditions over real
// temporary git repos are tests/truth/batch/preconditions-git.test.ts (kept apart: it starts git, which the mutation run
// does not), and over the real live-cases table tests/truth/batch/cases-live.test.ts.

const HEAD = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);
const ok = (out = ''): CallResult => ({ code: 0, timedOut: false, signal: null, out, err: '' });
const exit = (code: number, err = ''): CallResult => ({ code, timedOut: false, signal: null, out: '', err });
const timedOut: CallResult = { code: TIMED_OUT, timedOut: true, signal: 'SIGKILL', out: '', err: '' };

/** A fake Run: each git call answered by the first rule whose words it holds; every call recorded. */
function fakeGit(rules: readonly [string, CallResult][]) {
  const calls: { cmd: string; args: readonly string[]; call: Call | undefined }[] = [];
  const run: Run = async (cmd, args, call) => {
    calls.push({ cmd, args, call });
    const said = args.join(' ');
    const rule = rules.find(([words]) => said.includes(words));
    if (rule === undefined) throw new Error(`no answer for git ${said}`);
    return rule[1];
  };
  /** The git words of each call, without `-C <repo>`. */
  const said = () => calls.map((c) => c.args.slice(2).join(' '));
  return { run, calls, said };
}

const clean: [string, CallResult][] = [
  ['rev-parse --verify HEAD^{commit}', ok(`${HEAD}\n`)],
  ['rev-parse --verify refs/heads/main^{commit}', ok(`${HEAD}\n`)],
  ['status', ok('')],
];

describe('checkout — main\'s HEAD, no modified tracked file (batch-11.sh:209–219, batch-12.sh:117–121)', () => {
  it('HEAD = main, clean: ok, with the HEAD commit; every call git -C <repo>, in order, through the Run given', async () => {
    const g = fakeGit(clean);
    expect(await checkout({ repo: 'the/repo', run: g.run })).toEqual({ ok: true, head: HEAD });
    expect(g.calls.every((c) => c.cmd === 'git' && c.args[0] === '-C' && c.args[1] === 'the/repo')).toBe(true);
    expect(g.said()).toEqual(['rev-parse --verify HEAD^{commit}', 'rev-parse --verify refs/heads/main^{commit}', '--no-optional-locks status --porcelain -z --untracked-files=no']);
  });

  it('HEAD ≠ main: both named by their short shas, and what to do (batch-11\'s "git switch main, then rerun")', async () => {
    const g = fakeGit([['refs/heads/main', ok(`${MAIN}\n`)], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: "the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun" });
  });

  it('modified tracked files: their count and the first few paths named; a rename counted once, by its new path (status -z)', async () => {
    const g = fakeGit([['status', ok(' M a.ts\0M  b.ts\0R  new.ts\0old.ts\0')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'the checkout has 3 modified tracked file(s) (a.ts, b.ts, new.ts) — the batch runs main as committed' });
  });

  it('a modified path holding an R or a C (README, CHANGELOG) is no rename: the entry after it is counted', async () => {
    const g = fakeGit([['status', ok(' M README.md\0 M CHANGELOG.md\0 M x.ts\0')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'the checkout has 3 modified tracked file(s) (README.md, CHANGELOG.md, x.ts) — the batch runs main as committed' });
  });

  it(`more than ${SHOWN_PATHS} modified: the first ${SHOWN_PATHS} named, then how many more; a copy (C) skips its origin too`, async () => {
    const g = fakeGit([['status', ok('C  c2.ts\0c.ts\0 M d.ts\0 D e.ts\0AM f.ts\0 M g.ts\0')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'the checkout has 5 modified tracked file(s) (c2.ts, d.ts, e.ts and 2 more) — the batch runs main as committed' });
    expect(SHOWN_PATHS).toBe(3);
  });

  it('a path with a space or a non-ASCII letter is named as it is (status -z quotes nothing)', async () => {
    const g = fakeGit([['status', ok(' M a b/Šť.ts\0')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'the checkout has 1 modified tracked file(s) (a b/Šť.ts) — the batch runs main as committed' });
  });

  it('HEAD ≠ main and modified files: both said, HEAD first (one rerun fixes both, T2 S3)', async () => {
    const g = fakeGit([['refs/heads/main', ok(`${MAIN}\n`)], ['status', ok(' M a.ts\0')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({
      ok: false,
      why: "the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun; the checkout has 1 modified tracked file(s) (a.ts) — the batch runs main as committed",
    });
  });

  it('no branch main: said so, with git\'s own words; the status still read', async () => {
    const g = fakeGit([['refs/heads/main', exit(128, 'fatal: Needed a single revision\nmore')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'the repo has no branch main (git rev-parse: exit 128: fatal: Needed a single revision)' });
    expect(g.said()).toHaveLength(3);
  });

  it('main unreadable with nothing on stderr: its exit alone; main past its bound: "git timed out", never "no branch main"', async () => {
    expect(await checkout({ repo: 'r', run: fakeGit([['refs/heads/main', exit(128)], ...clean]).run })).toEqual({ ok: false, why: 'the repo has no branch main (git rev-parse: exit 128)' });
    expect(await checkout({ repo: 'r', run: fakeGit([['refs/heads/main', timedOut], ...clean]).run })).toEqual({ ok: false, why: `git timed out (rev-parse main, past its ${GIT_SECS} s bound)` });
  });

  it('HEAD unreadable (no repo there): git failed, its first line said, and nothing else is asked', async () => {
    const g = fakeGit([['HEAD^{commit}', exit(128, 'fatal: not a git repository (or any of the parent directories): .git\n')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'git rev-parse HEAD failed (exit 128: fatal: not a git repository (or any of the parent directories): .git)' });
    expect(g.said()).toEqual(['rev-parse --verify HEAD^{commit}']);
  });

  it('a git failure with nothing but blanks on stderr names its exit alone; git\'s line is trimmed (a \\r too)', async () => {
    expect(await checkout({ repo: 'r', run: fakeGit([['status', exit(129)], ...clean]).run })).toEqual({ ok: false, why: 'git status failed (exit 129)' });
    expect(await checkout({ repo: 'r', run: fakeGit([['status', exit(129, '  \r\n')], ...clean]).run })).toEqual({ ok: false, why: 'git status failed (exit 129)' });
    expect(await checkout({ repo: 'r', run: fakeGit([['status', exit(129, ' usage: git status \r\nmore')], ...clean]).run })).toEqual({ ok: false, why: 'git status failed (exit 129: usage: git status)' });
  });

  it('git past its bound: "git timed out", the call and its bound named — the tool\'s own (30 s) or the one given', async () => {
    expect(await checkout({ repo: 'r', run: fakeGit([['HEAD^{commit}', timedOut], ...clean]).run })).toEqual({ ok: false, why: `git timed out (rev-parse HEAD, past its ${GIT_SECS} s bound)` });
    const g = fakeGit([['status', timedOut], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run, secs: 0.5 })).toEqual({ ok: false, why: 'git timed out (status, past its 0.5 s bound)' });
    expect(g.calls.map((c) => c.call?.secs)).toEqual([0.5, 0.5, 0.5]);
  });

  it('exit 142 alone counts as past the bound too (the shell\'s code, timedOut unset)', async () => {
    const g = fakeGit([['status', exit(TIMED_OUT)], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: `git timed out (status, past its ${GIT_SECS} s bound)` });
  });

  it('git not started (127): said so, never a dirty checkout', async () => {
    const g = fakeGit([['HEAD^{commit}', exit(NOT_STARTED, 'spawn git ENOENT')], ...clean]);
    expect(await checkout({ repo: 'r', run: g.run })).toEqual({ ok: false, why: 'git could not be started (spawn git ENOENT)' });
  });

  it('no secs given: the call takes git\'s own bound (boundFor), none passed', async () => {
    const g = fakeGit(clean);
    await checkout({ repo: 'r', run: g.run });
    expect(g.calls.map((c) => c.call?.secs)).toEqual([undefined, undefined, undefined]);
  });

  it('the env handed to git has no GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE: a hook\'s context cannot point git elsewhere', async () => {
    const g = fakeGit(clean);
    await checkout({ repo: 'r', run: g.run, env: { PATH: '/bin', GIT_DIR: 'x', GIT_WORK_TREE: 'y', GIT_INDEX_FILE: 'z', GIT_COMMON_DIR: 'c', GIT_OBJECT_DIRECTORY: 'o', GIT_ALTERNATE_OBJECT_DIRECTORIES: 'a', HOME: 'h' } });
    for (const c of g.calls) expect(c.call?.env).toEqual({ PATH: '/bin', HOME: 'h' });
  });
});

describe('gitEnv — the repo-locating variables dropped, everything else kept, the env given never changed', () => {
  it('drops the six, keeps the rest, copies', () => {
    const env = { GIT_DIR: '.git', GIT_AUTHOR_NAME: 't', PATH: '/bin' };
    expect(gitEnv(env)).toEqual({ GIT_AUTHOR_NAME: 't', PATH: '/bin' });
    expect(env.GIT_DIR).toBe('.git');
  });

  it('none given: process.env\'s, without them', () => {
    expect(gitEnv().PATH).toBe(process.env.PATH);
  });
});

describe('ancestor — a required commit by ancestry, never by a symbol (batch-4.sh:200 → batch-11.sh:238–242, batch-11-README:101)', () => {
  const SHA = 'abc1234';
  const known: [string, CallResult][] = [
    ['cat-file -e', ok()],
    ['merge-base --is-ancestor', ok()],
  ];

  it('a known commit, an ancestor of HEAD: ok; cat-file -e <sha>^{commit} first, then merge-base --is-ancestor <sha> HEAD', async () => {
    const g = fakeGit(known);
    expect(await ancestor({ repo: 'r', run: g.run, sha: SHA })).toEqual({ ok: true });
    expect(g.said()).toEqual([`cat-file -e ${SHA}^{commit}`, `merge-base --is-ancestor ${SHA} HEAD`]);
  });

  it('the sha format first, batch-11\'s knob rule exactly (7–40 lowercase hex digits): no git call for one that breaks it', async () => {
    for (const bad of ['abc123', 'ABC1234', 'abc1234 ', 'g'.repeat(7), 'a'.repeat(41), 'HEAD', 'main', 'abc1234^']) {
      const g = fakeGit(known);
      expect(await ancestor({ repo: 'r', run: g.run, sha: bad }), bad).toEqual({ ok: false, why: `${JSON.stringify(bad)} is not a commit sha (7–40 hex digits)` });
      expect(g.calls).toEqual([]);
    }
    expect([SHA_FORMAT.test('a'.repeat(7)), SHA_FORMAT.test('0'.repeat(40))]).toEqual([true, true]);
  });

  it('`what` names the commit the way the batch does (`M_D43=<sha>`); unset, it says so (batch-11\'s "M_D43 is not set")', async () => {
    const g = fakeGit([['merge-base', exit(1)], ...known]);
    expect(await ancestor({ repo: 'r', run: g.run, sha: SHA, what: 'M_D43' })).toEqual({ ok: false, why: `M_D43=${SHA} is not an ancestor of HEAD (not merged into main yet)` });
    expect(await ancestor({ repo: 'r', run: g.run, sha: '', what: 'M_D43' })).toEqual({ ok: false, why: 'M_D43 is not set' });
    expect(await ancestor({ repo: 'r', run: g.run, sha: 'xyz', what: 'M_D43' })).toEqual({ ok: false, why: 'M_D43="xyz" is not a commit sha (7–40 hex digits)' });
    expect(await ancestor({ repo: 'r', run: g.run, sha: '' })).toEqual({ ok: false, why: 'the commit is not set' });
  });

  it('a sha that names no commit (unknown, ambiguous, a tree): said with git\'s own first line; ancestry never asked', async () => {
    const g = fakeGit([['cat-file', exit(128, `fatal: Not a valid object name ${SHA}^{commit}\n`)], ...known]);
    expect(await ancestor({ repo: 'r', run: g.run, sha: SHA })).toEqual({ ok: false, why: `${SHA} names no commit of this repo (git: fatal: Not a valid object name ${SHA}^{commit})` });
    expect(g.said()).toEqual([`cat-file -e ${SHA}^{commit}`]);
    const quiet = fakeGit([['cat-file', exit(1)], ...known]);
    expect(await ancestor({ repo: 'r', run: quiet.run, sha: SHA })).toEqual({ ok: false, why: `${SHA} names no commit of this repo` });
  });

  it('not an ancestor of HEAD (exit 1): batch-11\'s words', async () => {
    const g = fakeGit([['merge-base', exit(1)], ...known]);
    expect(await ancestor({ repo: 'r', run: g.run, sha: SHA })).toEqual({ ok: false, why: `${SHA} is not an ancestor of HEAD (not merged into main yet)` });
  });

  it('merge-base failing otherwise (exit 128) is git failing, never "not an ancestor"', async () => {
    const g = fakeGit([['merge-base', exit(128, 'fatal: bad object')], ...known]);
    expect(await ancestor({ repo: 'r', run: g.run, sha: SHA })).toEqual({ ok: false, why: 'git merge-base failed (exit 128: fatal: bad object)' });
  });

  it('past its bound or not started, at either call: said so, never "no commit" or "not an ancestor"', async () => {
    expect(await ancestor({ repo: 'r', run: fakeGit([['cat-file', timedOut], ...known]).run, sha: SHA })).toEqual({ ok: false, why: `git timed out (cat-file, past its ${GIT_SECS} s bound)` });
    expect(await ancestor({ repo: 'r', run: fakeGit([['merge-base', timedOut], ...known]).run, sha: SHA, secs: 2 })).toEqual({ ok: false, why: 'git timed out (merge-base, past its 2 s bound)' });
    expect(await ancestor({ repo: 'r', run: fakeGit([['cat-file', exit(NOT_STARTED, 'spawn git ENOENT')], ...known]).run, sha: SHA })).toEqual({ ok: false, why: 'git could not be started (spawn git ENOENT)' });
  });

  it('the env handed to git has no repo-locating variable', async () => {
    const g = fakeGit(known);
    await ancestor({ repo: 'r', run: g.run, sha: SHA, env: { GIT_DIR: 'x', PATH: '/bin' } });
    for (const c of g.calls) expect(c.call?.env).toEqual({ PATH: '/bin' });
  });
});

/** A fake live-cases table: the cases selectCases picks (platform, groups and only honoured), and the catalog's cells. */
function fakeLive(cases: { id: string; platforms?: string[]; group?: string }[], cells: string[] = []) {
  const asked: unknown[] = [];
  const live: LiveCases = {
    selectCases: async (s) => {
      asked.push(s);
      return cases.filter((c) => (c.platforms === undefined || c.platforms.includes(s.platform)) && s.groups.includes(c.group ?? 'forms') && (s.only === undefined || s.only.includes(c.id)));
    },
    catalogOf: async () => ({ cells: cells.map((id) => ({ id })) }),
  };
  return { live, asked };
}

describe('casesOnMain — the live cases a block runs, read from main\'s live-cases.ts table, never grepped (batch-11.sh:228 grepped `id: \'kf1\'`)', () => {
  it('all there: ok; selectCases asked for these ids, the platform, the native app and the forms group by default (live_run\'s --groups forms)', async () => {
    const { live, asked } = fakeLive([{ id: 'kf1' }, { id: 'kf2' }, { id: 'kf3' }]);
    expect(await casesOnMain({ ids: ['kf1', 'kf2'], platform: 'android', live })).toEqual({ ok: true });
    expect(asked).toEqual([{ platform: 'android', app: 'native', groups: ['forms'], only: ['kf1', 'kf2'] }]);
  });

  it('a missing id named, every one, in the order asked, each once; the platform, app and groups said', async () => {
    const { live } = fakeLive([{ id: 'kf1' }, { id: 'p7w', platforms: ['ios'] }]);
    expect(await casesOnMain({ ids: ['zz', 'kf1', 'p7w', 'zz'], platform: 'android', live })).toEqual({ ok: false, why: "live case(s) zz, p7w not on main's live-cases.ts (android, native app, groups forms)" });
  });

  it('another app and groups when given', async () => {
    const { live, asked } = fakeLive([{ id: 'v1', group: 'visibility' }]);
    expect(await casesOnMain({ ids: ['v1'], platform: 'ios', app: 'react-native', groups: ['forms', 'visibility'], live })).toEqual({ ok: true });
    expect(asked).toEqual([{ platform: 'ios', app: 'react-native', groups: ['forms', 'visibility'], only: ['v1'] }]);
    expect(await casesOnMain({ ids: ['v2'], platform: 'ios', app: 'react-native', groups: ['forms', 'visibility'], live })).toEqual({ ok: false, why: "live case(s) v2 not on main's live-cases.ts (ios, react-native app, groups forms, visibility)" });
  });

  it('no id given: never a pass (a block judged on no case proves nothing)', async () => {
    const { live, asked } = fakeLive([{ id: 'kf1' }]);
    expect(await casesOnMain({ ids: [], platform: 'android', live })).toEqual({ ok: false, why: 'no live case id given' });
    expect(asked).toEqual([]);
  });

  it('a table that cannot be read: said, never thrown', async () => {
    const live: LiveCases = { selectCases: () => Promise.reject(new Error('catalog: held cell x has no `held`')), catalogOf: () => Promise.reject(new Error('no')) };
    expect(await casesOnMain({ ids: ['kf1'], platform: 'android', live })).toEqual({ ok: false, why: "main's live cases could not be read (catalog: held cell x has no `held`)" });
  });
});

describe('cellsOnMain — the lab cells a block uses, in main\'s catalog (batch-11.sh:223–234 and batch-12.sh:282–292\'s cells_have)', () => {
  it('all there: ok; one missing or more named, in order, each once', async () => {
    const { live } = fakeLive([], ['open', 'form-basic', 'carousel-recycler-free']);
    expect(await cellsOnMain({ ids: ['open', 'carousel-recycler-free'], live })).toEqual({ ok: true });
    expect(await cellsOnMain({ ids: ['open', 'nope', 'gone', 'nope'], live })).toEqual({ ok: false, why: "cell(s) nope, gone not in main's catalog (fixtures/apps/cells.json)" });
  });

  it('no id given, or a catalog that cannot be read: never a pass', async () => {
    const { live } = fakeLive([], ['open']);
    expect(await cellsOnMain({ ids: [], live })).toEqual({ ok: false, why: 'no cell id given' });
    const broken: LiveCases = { selectCases: async () => [], catalogOf: () => Promise.reject(new Error('ENOENT cells.json')) };
    expect(await cellsOnMain({ ids: ['open'], live: broken })).toEqual({ ok: false, why: "main's catalog could not be read (ENOENT cells.json)" });
  });
});

describe('preconditionLine — a precondition not shown makes the block INCONCLUSIVE, naming why (batch-2 on; batch-11.sh:441–442)', () => {
  it('all ok: no line', () => {
    expect(preconditionLine('D43 live verdict', [{ ok: true }, { ok: true, head: HEAD } as never])).toBeUndefined();
    expect(preconditionLine('D43 live verdict', [])).toBeUndefined();
  });

  it('one failed: `<label>: INCONCLUSIVE — precondition: <why>`, a verdict line words.ts reads back', () => {
    const line = preconditionLine('D43 live verdict', [{ ok: true }, { ok: false, why: 'M_D43 is not set' }]);
    expect(line).toBe('D43 live verdict: INCONCLUSIVE — precondition: M_D43 is not set');
    expect(parseVerdictLine(line ?? '')).toEqual({ label: 'D43 live verdict', verdict: 'INCONCLUSIVE', why: 'precondition: M_D43 is not set' });
  });

  it('several failed: every why, in order, on one line', () => {
    expect(preconditionLine('kf live verdict', [{ ok: false, why: 'a' }, { ok: true }, { ok: false, why: 'b' }])).toBe('kf live verdict: INCONCLUSIVE — precondition: a; b');
  });

  it('a why with a line break is refused (the SUMMARY is read line by line)', () => {
    expect(() => preconditionLine('kf live verdict', [{ ok: false, why: 'a\nb' }])).toThrow(/line break/);
  });

  it('the SUMMARY\'s exit rule reads it as no FAIL, even when a why says FAIL', () => {
    const line = preconditionLine('kf live verdict', [{ ok: false, why: 'FAIL in the name of a branch' }]) ?? '';
    const s: Summary = { name: 'b', runId: '1', checkout: 'OK checkout: x', labs: [], blocks: [{ block: 'kf', lines: [line] }], protectedLines: [], restore: { file: 'R', written: [] }, errors: [] };
    expect(exitCodeOf(s)).toBe(0);
  });
});

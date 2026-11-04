import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { layoutOf, newRunId, openRun, refusals, refusalLines, stateOf, writeRestore, type Stateful } from '../../../scripts/truth/batch/run-dir.js';

// scripts/truth/batch/run-dir.ts: where a run writes (one fresh `run-<RUN_ID>` folder per block, never emptied or
// reused) and when it must not start at all (a RESTORE file left, an earlier run's state not clean). Real files in a
// temp dir; every assertion is on paths relative to it.

let out: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  writeFileSync(join(out, rel), text);
};
const tree = (dir = out): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(dir, e.name)) : [relative(out, join(dir, e.name))])).sort();

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'batch-run-dir-'));
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

const E5: Stateful = { block: 'E5', what: 'E5 not put back', hand: (file) => [`  → node e5.ts --restore --state ${file}`] };
const D43: Stateful = { block: 'D43', what: 'the simulator settings not put back', hand: () => ['  → node d43-gate.ts --restore'] };

describe('stateOf — a probe\'s state file: dirty, clean or unreadable, by JSON\'s own parser (batch-7 → batch-12)', () => {
  it('clean only when `dirty` is exactly false', () => {
    put('s.json', '{"dirty":false,"backup":"x"}');
    expect(stateOf(nodeFs, join(out, 's.json'))).toBe('clean');
  });

  it('dirty when `dirty` is true, missing, null, 0 or "false" — anything but false', () => {
    for (const text of ['{"dirty":true}', '{}', '{"dirty":null}', '{"dirty":0}', '{"dirty":"false"}']) {
      put('s.json', text);
      expect(stateOf(nodeFs, join(out, 's.json')), text).toBe('dirty');
    }
  });

  it('unreadable when the file is missing, cut short, not JSON, or JSON but no object', () => {
    expect(stateOf(nodeFs, join(out, 'none.json'))).toBe('unreadable');
    for (const text of ['{"dirty":fal', '', 'dirty', '[false]', 'null', 'false', '"clean"']) {
      put('s.json', text);
      expect(stateOf(nodeFs, join(out, 's.json')), text).toBe('unreadable');
    }
  });
});

describe('refusals — the batch refuses to start, nothing done, while state is left (batch-10 refused, batch-11 every run)', () => {
  it('a first run, an empty or missing out folder: nothing refuses', () => {
    expect(refusals(nodeFs, { out, stateful: [E5] })).toEqual([]);
    expect(refusals(nodeFs, { out: join(out, 'not-yet'), stateful: [E5] })).toEqual([]);
  });

  it('refuse-restore: a RESTORE file left refuses, its hand lines printed, never renamed aside (batch-7 to batch-9 only renamed it with a WARN; batch-10 refuses)', () => {
    put('RESTORE.txt', 'batch-n run 1 interrupted; state to put back by hand:\nE5: adb install lab.apk\n');
    const lines = refusals(nodeFs, { out, stateful: [] });
    expect(lines).toEqual([
      `${join(out, 'RESTORE.txt')} exists (an earlier run left state not provably put back):`,
      'batch-n run 1 interrupted; state to put back by hand:',
      'E5: adb install lab.apk',
      `  → run its hand commands, then: mv ${join(out, 'RESTORE.txt')} ${join(out, 'RESTORE.done-$(date +%Y%m%d-%H%M%S).txt')}`,
    ]);
    expect(tree()).toEqual(['RESTORE.txt']);
  });

  it('a RESTORE that cannot be read (a folder in its place) still refuses, saying so', () => {
    mkdirSync(join(out, 'RESTORE.txt'));
    expect(refusals(nodeFs, { out, stateful: [] }).slice(0, 2)).toEqual([`${join(out, 'RESTORE.txt')} exists (an earlier run left state not provably put back):`, '(unreadable)']);
  });

  it('an empty RESTORE file refuses too: its presence is the marker', () => {
    put('RESTORE.txt', '');
    expect(refusals(nodeFs, { out, stateful: [] })[0]).toMatch(/RESTORE\.txt exists/);
  });

  it('refuse-dirty: every earlier run\'s state of every stateful block is read — dirty and unreadable refuse, clean does not (batch-11 extended it to every run folder)', () => {
    put('E5/run-1/state.json', '{"dirty":false}');
    put('E5/run-2/state.json', '{"dirty":true}');
    put('E5/run-3/state.json', '{"dirty":');
    put('D43/run-1/state.json', '{"dirty":true}');
    put('E5/run-4/other.json', '{"dirty":true}');
    put('kf/run-1/state.json', '{"dirty":true}');
    const lines = refusals(nodeFs, { out, stateful: [E5, D43] }).map((l) => l.replaceAll(out, '<out>'));
    expect(lines).toEqual([
      '<out>/E5/run-2/state.json is dirty (E5 not put back):',
      '  → node e5.ts --restore --state <out>/E5/run-2/state.json',
      '<out>/E5/run-3/state.json is unreadable, so not provably clean (E5 not put back):',
      '  → node e5.ts --restore --state <out>/E5/run-3/state.json',
      '<out>/D43/run-1/state.json is dirty (the simulator settings not put back):',
      '  → node d43-gate.ts --restore',
    ]);
  });

  it('a folder not named run-* is no run of the batch and is not read', () => {
    put('E5/old/state.json', '{"dirty":true}');
    put('E5/run-/state.json', '{"dirty":true}');
    expect(refusals(nodeFs, { out, stateful: [E5] })).toHaveLength(2);
  });

  it('the RESTORE file and dirty states together: every reason at once', () => {
    put('RESTORE.txt', 'x\n');
    put('E5/run-2/state.json', '{"dirty":true}');
    const lines = refusals(nodeFs, { out, stateful: [E5] });
    expect(lines.filter((l) => /exists|is dirty/.test(l))).toHaveLength(2);
  });

  it('an out folder inside the checkout is refused: the checkout must stay clean, and a tracked-files status would not notice', () => {
    const repo = join(out, 'repo');
    mkdirSync(repo);
    expect(refusals(nodeFs, { out: join(repo, 'runs'), repo, stateful: [] })).toEqual([
      `the out folder ${join(repo, 'runs')} lies inside the checkout ${repo}: give an --out outside it`,
    ]);
    expect(refusals(nodeFs, { out: repo, repo, stateful: [] })).toHaveLength(1);
    expect(refusals(nodeFs, { out: join(out, 'repo-runs'), repo, stateful: [] })).toEqual([]);
    expect(refusals(nodeFs, { out: join(out, 'elsewhere'), repo, stateful: [] })).toEqual([]);
    expect(refusals(nodeFs, { out, repo, stateful: [] })).toEqual([]);
  });

  it('a checkout reached through a symlink is the same checkout', () => {
    const repo = join(out, 'repo');
    mkdirSync(join(repo, 'runs'), { recursive: true });
    symlinkSync(repo, join(out, 'link'));
    expect(refusals(nodeFs, { out: join(out, 'link', 'runs'), repo, stateful: [] })).toHaveLength(1);
  });

  it('refusalLines heads the reasons with the batch\'s name and "nothing was done"', () => {
    expect(refusalLines('batch-n', ['a', 'b'])).toEqual(['ERROR batch-n refuses to start — nothing was done:', 'a', 'b']);
  });
});

describe('newRunId — the date and the pid, as batch-3 to batch-12 name a run', () => {
  it('YYYYMMDD-HHMMSS-<pid>, local time, zero-padded', () => {
    expect(newRunId(new Date(2026, 10, 4, 9, 4, 6), 2763)).toBe('20261104-090406-2763');
    expect(newRunId(new Date(2026, 0, 1, 23, 59, 59), 1)).toBe('20260101-235959-1');
  });
});

describe('openRun — one fresh run-<RUN_ID> folder per block, never emptied or reused (batch-3\'s B2 lost its raw data to a second run that emptied the folder)', () => {
  const BLOCKS = ['lab', 'kf', 'E5'];

  it('creates meta and each wanted block\'s folder, nothing for a block not wanted (batch-12\'s run folder per block)', () => {
    const run = openRun(nodeFs, { out, runId: '20261104-094426-2763', blocks: BLOCKS, wanted: ['lab', 'E5'] });
    expect(run).toEqual({
      ok: true,
      dirs: { meta: join(out, 'meta/run-20261104-094426-2763'), lab: join(out, 'lab/run-20261104-094426-2763'), E5: join(out, 'E5/run-20261104-094426-2763') },
    });
    expect(readdirSync(out).sort()).toEqual(['E5', 'lab', 'meta']);
  });

  it("an earlier run's folders and files are left as they were (b11-dry: run-OLD/marker.txt intact)", () => {
    for (const b of [...BLOCKS, 'meta']) put(`${b}/run-OLD/marker.txt`, `old ${b}`);
    put('steps.log', 'old steps\n');
    openRun(nodeFs, { out, runId: 'NEW', blocks: BLOCKS, wanted: BLOCKS });
    for (const b of [...BLOCKS, 'meta']) expect(readFileSync(join(out, b, 'run-OLD/marker.txt'), 'utf8')).toBe(`old ${b}`);
    expect(readFileSync(join(out, 'steps.log'), 'utf8')).toBe('old steps\n');
    expect(tree()).toEqual(['E5/run-OLD/marker.txt', 'kf/run-OLD/marker.txt', 'lab/run-OLD/marker.txt', 'meta/run-OLD/marker.txt', 'steps.log']);
    expect(existsSync(join(out, 'kf/run-NEW'))).toBe(true);
  });

  it('a folder of this RUN_ID that already exists refuses before anything is created — for any block of the batch, wanted or not', () => {
    put('kf/run-X/data.json', 'kept');
    const run = openRun(nodeFs, { out, runId: 'X', blocks: BLOCKS, wanted: ['lab'] });
    expect(run).toEqual({ ok: false, error: `ERROR the run folder ${join(out, 'kf/run-X')} already exists: nothing was done` });
    expect(tree()).toEqual(['kf/run-X/data.json']);
    expect(existsSync(join(out, 'meta'))).toBe(false);
  });

  it('meta\'s folder of this RUN_ID refuses as well, and a file in a folder\'s place does', () => {
    put('meta/run-X', 'a file');
    expect(openRun(nodeFs, { out, runId: 'X', blocks: BLOCKS, wanted: BLOCKS })).toMatchObject({ ok: false });
    expect(tree()).toEqual(['meta/run-X']);
  });

  it('a dangling symlink in a folder\'s place refuses: it exists, if only as a link', () => {
    mkdirSync(join(out, 'lab'));
    symlinkSync(join(out, 'nowhere'), join(out, 'lab/run-X'));
    expect(openRun(nodeFs, { out, runId: 'X', blocks: BLOCKS, wanted: BLOCKS })).toMatchObject({ ok: false });
  });

  it('a folder made between the check and the mkdir is refused, not reused (the mkdir itself is exclusive)', () => {
    const racing = { ...nodeFs, exists: () => false };
    put('E5/run-X/data.json', 'kept');
    expect(openRun(racing, { out, runId: 'X', blocks: BLOCKS, wanted: BLOCKS })).toEqual({ ok: false, error: `ERROR the run folder ${join(out, 'E5/run-X')} already exists: nothing was done` });
    expect(readFileSync(join(out, 'E5/run-X/data.json'), 'utf8')).toBe('kept');
  });

  it('a folder that cannot be made for another reason throws that reason, never "already exists"', () => {
    const denied = { ...nodeFs, mkdirExclusive: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } };
    expect(() => openRun(denied, { out, runId: 'X', blocks: BLOCKS, wanted: BLOCKS })).toThrow(/^EACCES: permission denied$/);
  });

  it('a RUN_ID or block name that could leave its folder is a programming error', () => {
    for (const runId of ['', '../x', 'a/b', '.', '..', 'a b']) expect(() => openRun(nodeFs, { out, runId, blocks: BLOCKS, wanted: [] }), runId).toThrow(/RUN_ID/);
    for (const b of ['', '..', 'a/b', '-x', 'meta']) expect(() => openRun(nodeFs, { out, runId: 'X', blocks: [b], wanted: [] }), b).toThrow(/block name/);
    expect(() => openRun(nodeFs, { out, runId: 'X', blocks: ['kf', 'kf'], wanted: [] })).toThrow(/block kf is named twice/);
    expect(() => openRun(nodeFs, { out, runId: 'X', blocks: ['kf'], wanted: ['E5'] })).toThrow(/wanted block E5 is not a block of the batch/);
    expect(tree()).toEqual([]);
  });
});

describe('layoutOf — the run\'s files, all under the out folder the batch was given (nothing literal)', () => {
  it('RESTORE, steps.log and the latest-out link at the top; the run\'s own .out in meta\'s folder', () => {
    expect(layoutOf('/o', 'batch-n', '/o/meta/run-1')).toEqual({ restoreFile: '/o/RESTORE.txt', stepsFile: '/o/steps.log', latestOut: '/o/batch-n.out', outFile: '/o/meta/run-1/batch-n.out' });
  });
});

describe('writeRestore — the hand commands of state not provably put back', () => {
  it('nothing to put back: no file is written', () => {
    expect(writeRestore(nodeFs, join(out, 'RESTORE.txt'), { header: 'batch-n run 1 ended', hand: [] })).toBe(false);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(false);
  });

  it('a header naming the run, then each hand line', () => {
    expect(writeRestore(nodeFs, join(out, 'RESTORE.txt'), { header: 'batch-n run 1 ended 2026-11-04 10:00:00', hand: ['E5: one', 'lvd62: two'] })).toBe(true);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe('batch-n run 1 ended 2026-11-04 10:00:00; state to put back by hand:\nE5: one\nlvd62: two\n');
  });

  it('appends, never overwrites: a second write in the same run (the end, then an abort) keeps the first\'s lines', () => {
    writeRestore(nodeFs, join(out, 'RESTORE.txt'), { header: 'run 1 ended', hand: ['E5: one'] });
    writeRestore(nodeFs, join(out, 'RESTORE.txt'), { header: 'run 1 interrupted', hand: ['lvd62: two'] });
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe('run 1 ended; state to put back by hand:\nE5: one\nrun 1 interrupted; state to put back by hand:\nlvd62: two\n');
  });

  it('a hand line with a line break is refused: one command per line', () => {
    expect(() => writeRestore(nodeFs, join(out, 'RESTORE.txt'), { header: 'h', hand: ['a\nb'] })).toThrow(/a RESTORE line holds a line break/);
    expect(existsSync(join(out, 'RESTORE.txt'))).toBe(false);
  });
});

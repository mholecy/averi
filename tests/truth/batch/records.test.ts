import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { recordFiles, recordGap, recordGapIn, recordOf, recordsComplete, recordsIn, writeAsked, writeDone } from '../../../scripts/truth/batch/records.js';

// scripts/truth/batch/records.ts: a non-live block's records — what a run is asked, then what it did — and when a
// block's records are complete (batch-12's block_complete). Real files in a temp dir; runner.test.ts runs them inside
// runBatch. The titles name the fix and the batch or review that found it.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-records-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('recordOf and recordGap — a non-live block\'s own record, apart from the live runs\' .cases (S3 review: batch-12\'s E5/T6 `{"runs":N}`)', () => {
  it('a record is `{kind: "runs", runs: <whole number>}`', () => {
    expect(recordOf({ kind: 'runs', runs: 3 })).toEqual({ kind: 'runs', runs: 3 });
    expect(recordOf({ kind: 'runs', runs: 0 })).toEqual({ kind: 'runs', runs: 0 });
    for (const bad of [null, undefined, 3, 'runs', [], { runs: 3 }, { kind: 'run', runs: 3 }, { kind: 'runs', runs: -1 }, { kind: 'runs', runs: 1.5 }, { kind: 'runs', runs: '3' }, { kind: 'runs' }]) {
      expect(recordOf(bad)).toBeUndefined();
    }
  });

  it('its two files: `<name>.asked.json` (written first) and `<name>.done.json`, never the live run\'s `.cases` or `.json`', () => {
    expect(recordFiles('/d', 'e5-c')).toEqual({ asked: join('/d', 'e5-c.asked.json'), done: join('/d', 'e5-c.done.json') });
  });

  it('complete only when what was recorded matches what was asked', () => {
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"kind":"runs","runs":3}')).toBeUndefined();
  });

  it('nothing recorded, fewer or more runs recorded: each said with both counts', () => {
    expect(recordGap('c', '{"kind":"runs","runs":3}', undefined)).toBe('asked 3 run(s), nothing recorded (no c.done.json)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"kind":"runs","runs":2}')).toBe('asked 3 run(s), recorded 2');
    expect(recordGap('c', '{"kind":"runs","runs":1}', '{"kind":"runs","runs":2}')).toBe('asked 1 run(s), recorded 2');
  });

  it('a file that is no record (no JSON, another shape, unreadable) is a gap naming it, never a pass', () => {
    expect(recordGap('c', undefined, '{"kind":"runs","runs":3}')).toBe('c.asked.json is unreadable: what it was asked is unknown');
    expect(recordGap('c', '{', '{"kind":"runs","runs":3}')).toBe('c.asked.json is no record of runs (kind "runs", runs: a whole number)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"runs":3}')).toBe('c.done.json is no record of runs (kind "runs", runs: a whole number)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', 'x')).toBe('c.done.json is no record of runs (kind "runs", runs: a whole number)');
  });
});


describe('the records in a folder, written once each, and when a block\'s are complete (T2 S6a code review: moved out of the runner)', () => {
  it('writeAsked then writeDone; recordsIn lists each asked, sorted; recordGapIn reads both files', () => {
    writeAsked(nodeFs, dir, 'b', { kind: 'runs', runs: 2 });
    writeAsked(nodeFs, dir, 'a', { kind: 'runs', runs: 1 });
    writeDone(nodeFs, dir, 'a', { kind: 'runs', runs: 1 });
    expect(recordsIn(nodeFs, dir)).toEqual(['a', 'b']);
    expect(recordGapIn(nodeFs, dir, 'a')).toBeUndefined();
    expect(recordGapIn(nodeFs, dir, 'b')).toBe('asked 2 run(s), nothing recorded (no b.done.json)');
  });

  it('never overwritten; done only after asked; a value that is no record or a name that is no segment thrown', () => {
    writeAsked(nodeFs, dir, 'c', { kind: 'runs', runs: 1 });
    expect(() => writeAsked(nodeFs, dir, 'c', { kind: 'runs', runs: 1 })).toThrow(`${join(dir, 'c.asked.json')} already exists: what a run was asked is never overwritten`);
    writeDone(nodeFs, dir, 'c', { kind: 'runs', runs: 1 });
    expect(() => writeDone(nodeFs, dir, 'c', { kind: 'runs', runs: 1 })).toThrow('c.done.json already exists: what a run recorded is never overwritten');
    expect(() => writeDone(nodeFs, dir, 'd', { kind: 'runs', runs: 1 })).toThrow('d: recorded before it was asked (asks first)');
    expect(() => writeAsked(nodeFs, dir, 'e', { kind: 'runs', runs: -1 })).toThrow('e: {"kind":"runs","runs":-1} is no record of runs');
    expect(() => writeAsked(nodeFs, dir, 'e.f', { kind: 'runs', runs: 1 })).toThrow('run name "e.f": one plain path segment is needed');
    expect(() => writeAsked(nodeFs, join(dir, 'gone'), 'g', { kind: 'runs', runs: 1 })).toThrow(/ENOENT/);
  });

  it('recordsComplete: one run asked at least; every live run\'s record and rejudge summary written; every record what it asked (batch-12\'s block_complete)', () => {
    expect(recordsComplete(nodeFs, dir)).toBe(false);
    writeFileSync(join(dir, 'k.cases'), '{}');
    expect(recordsComplete(nodeFs, dir)).toBe(false);
    writeFileSync(join(dir, 'k.json'), '{}');
    expect(recordsComplete(nodeFs, dir)).toBe(false);
    writeFileSync(join(dir, 'k.rejudge.txt'), '');
    expect(recordsComplete(nodeFs, dir)).toBe(false);
    writeFileSync(join(dir, 'k.rejudge.txt'), '# Live golden: 1 case');
    expect(recordsComplete(nodeFs, dir)).toBe(true);
    writeAsked(nodeFs, dir, 'r', { kind: 'runs', runs: 2 });
    writeDone(nodeFs, dir, 'r', { kind: 'runs', runs: 1 });
    expect(recordsComplete(nodeFs, dir)).toBe(false);
  });

  it('a folder with records alone is complete when each matches', () => {
    writeAsked(nodeFs, dir, 'r', { kind: 'runs', runs: 2 });
    writeDone(nodeFs, dir, 'r', { kind: 'runs', runs: 2 });
    expect(recordsComplete(nodeFs, dir)).toBe(true);
  });
});

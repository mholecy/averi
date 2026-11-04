import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';

// scripts/truth/batch/io.ts: the module's one filesystem seam, held to its contract on real files in a temp dir —
// above all, that nothing it does removes or overwrites what a run wrote.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-io-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('nodeFs: reads', () => {
  it('exists: a file, a folder, a dangling symlink yes; nothing there no', () => {
    writeFileSync(join(dir, 'f'), '');
    symlinkSync(join(dir, 'nowhere'), join(dir, 'dangling'));
    expect([nodeFs.exists(join(dir, 'f')), nodeFs.exists(dir), nodeFs.exists(join(dir, 'dangling')), nodeFs.exists(join(dir, 'none'))]).toEqual([true, true, true, false]);
  });

  it('read: the text, or undefined for nothing there and for a folder', () => {
    writeFileSync(join(dir, 'f'), 'text');
    expect([nodeFs.read(join(dir, 'f')), nodeFs.read(join(dir, 'none')), nodeFs.read(dir)]).toEqual(['text', undefined, undefined]);
  });

  it('list: the names sorted; none for a missing folder or a file', () => {
    for (const n of ['run-b', 'run-a', 'run-c']) mkdirSync(join(dir, n));
    writeFileSync(join(dir, 'f'), '');
    expect(nodeFs.list(dir)).toEqual(['f', 'run-a', 'run-b', 'run-c']);
    expect(nodeFs.list(join(dir, 'none'))).toEqual([]);
    expect(nodeFs.list(join(dir, 'f'))).toEqual([]);
  });

  it('real: symlinks resolved; a tail that does not exist yet kept as written', () => {
    mkdirSync(join(dir, 'repo'));
    symlinkSync(join(dir, 'repo'), join(dir, 'link'));
    const real = realpathSync(dir);
    expect(nodeFs.real(join(dir, 'link'))).toBe(join(real, 'repo'));
    expect(nodeFs.real(join(dir, 'link', 'runs', 'x'))).toBe(join(real, 'repo', 'runs', 'x'));
  });
});

describe('nodeFs: writes never remove or overwrite', () => {
  it('mkdirExclusive makes the parents, and throws EEXIST for a folder that exists, leaving it as it was', () => {
    nodeFs.mkdirExclusive(join(dir, 'a', 'b', 'run-1'));
    writeFileSync(join(dir, 'a', 'b', 'run-1', 'kept'), 'x');
    expect(() => nodeFs.mkdirExclusive(join(dir, 'a', 'b', 'run-1'))).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(join(dir, 'a', 'b', 'run-1', 'kept'), 'utf8')).toBe('x');
  });

  it('createExclusive writes a new file, and throws EEXIST for one that exists, its text kept', () => {
    nodeFs.createExclusive(join(dir, 'f'), 'first');
    expect(() => nodeFs.createExclusive(join(dir, 'f'), 'second')).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('first');
  });

  it('append adds to the end, creating the file', () => {
    nodeFs.append(join(dir, 'f'), 'a\n');
    nodeFs.append(join(dir, 'f'), 'b\n');
    expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('a\nb\n');
  });

  it('linkLatest: made where nothing is, a link replaced, a file kept and said', () => {
    expect(nodeFs.linkLatest(join(dir, 'latest'), join(dir, 'one'))).toBeUndefined();
    expect(nodeFs.linkLatest(join(dir, 'latest'), join(dir, 'two'))).toBeUndefined();
    expect(readlinkSync(join(dir, 'latest'))).toBe(join(dir, 'two'));
    writeFileSync(join(dir, 'file'), 'kept');
    expect(nodeFs.linkLatest(join(dir, 'file'), join(dir, 'two'))).toBe('a file, not a link, is there');
    expect(readFileSync(join(dir, 'file'), 'utf8')).toBe('kept');
  });

  it('linkLatest: a link that cannot even be looked at (its folder a file) is said, not guessed past', () => {
    writeFileSync(join(dir, 'file'), 'kept');
    expect(nodeFs.linkLatest(join(dir, 'file', 'latest'), join(dir, 'two'))).toMatch(/^the link could not be checked \(ENOTDIR/);
  });
});

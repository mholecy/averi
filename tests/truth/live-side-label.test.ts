import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPortableSide, SIDE_LABEL, sideLabel, THIS_CHECKOUT } from '../../scripts/truth/live-cases.js';

/**
 * The `side` live.ts writes into a record (T8): a run of this checkout says THIS_CHECKOUT; a `--side` run says which
 * checkout by a portable label — never the host's absolute path (a record is committed), and never THIS_CHECKOUT (a
 * `--side` run is a calibration, not held to live-known.ts: live-cases.ts#summarize reads `side`). Made-up paths only;
 * the repo root and the working directory are given, never this process's own.
 */
describe('sideLabel: the side a record names', () => {
  const at = { root: '/work/averi', cwd: '/work/averi' };

  it('no --side: this checkout', () => {
    expect(sideLabel(undefined, at)).toBe(THIS_CHECKOUT);
  });

  it('a --side outside the repo: its folder under <scratch>/, a calibration checkout under <cal>/', () => {
    expect(sideLabel('/elsewhere/session/r23-eyes', at)).toBe('<scratch>/r23-eyes');
    expect(sideLabel('/elsewhere/session/r23-eyes/', at)).toBe('<scratch>/r23-eyes');
    expect(sideLabel('/work/r8', at)).toBe('<scratch>/r8');
    expect(sideLabel('/elsewhere/averi-calibration/differential-cal-d928789', at)).toBe('<cal>/differential-cal-d928789');
    expect([SIDE_LABEL.scratch, SIDE_LABEL.cal]).toEqual(['<scratch>', '<cal>']);
  });

  it('a relative --side resolves from the given working directory, as live.ts loads it; a dot-dot names the folder it resolves to', () => {
    expect(sideLabel('../r23-keyboard', at)).toBe('<scratch>/r23-keyboard');
    expect(sideLabel('r23-keyboard', { root: '/work/averi', cwd: '/elsewhere/session' })).toBe('<scratch>/r23-keyboard');
    expect(sideLabel('side', { root: '/work/averi', cwd: '/work/averi/build' })).toBe('build/side');
    expect(sideLabel('/elsewhere/r8/..', at)).toBe('<scratch>/elsewhere');
  });

  it('a --side inside the repo: its repo-relative path, a folder whose name starts with two dots too; the repo itself: "."', () => {
    expect(sideLabel('/work/averi/build/side', at)).toBe('build/side');
    expect(sideLabel('/work/averi/..cache/side', at)).toBe('..cache/side');
    expect(sideLabel('/work/averi', at)).toBe('.');
  });

  it('never absolute, never this checkout', () => {
    for (const side of ['/a', '/a/b/c', '/work/averi', '/work/averi/x', '/work/averix', 'rel/dir', '..']) {
      const label = sideLabel(side, at);
      expect(isAbsolute(label)).toBe(false);
      expect(label).not.toBe(THIS_CHECKOUT);
      expect(isPortableSide(label)).toBe(true);
    }
  });
});

describe('isPortableSide: a side that names no host', () => {
  it('this checkout, a label sideLabel writes, an older relative one', () => {
    expect([THIS_CHECKOUT, '<scratch>/r23-eyes', '<cal>/differential-cal-d928789', '../r8', 'build/side', '.'].map(isPortableSide)).toEqual([true, true, true, true, true, true]);
  });

  it('never absolute, never under a home, never empty or not a string', () => {
    expect(['/a/b/r23-eyes', '~/r8', '', undefined, 1].map(isPortableSide)).toEqual([false, false, false, false, false]);
  });
});

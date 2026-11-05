import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sideLabel, THIS_CHECKOUT } from '../../scripts/truth/live-cases.js';

/**
 * The `side` live.ts writes into a record (T8): a run of this checkout says THIS_CHECKOUT; a `--side` run says which
 * checkout by a portable label — never the host's absolute path (a record is committed), and never THIS_CHECKOUT (a
 * `--side` run is a calibration, not held to live-known.ts: live-cases.ts#summarize reads `side`). Made-up paths only.
 */
describe('sideLabel: the side a record names', () => {
  const root = '/work/averi';

  it('no --side: this checkout', () => {
    expect(sideLabel(undefined, root)).toBe(THIS_CHECKOUT);
  });

  it('a --side outside the repo: its folder under <scratch>/, a calibration checkout under <cal>/', () => {
    expect(sideLabel('/elsewhere/session/r23-eyes', root)).toBe('<scratch>/r23-eyes');
    expect(sideLabel('/elsewhere/session/r23-eyes/', root)).toBe('<scratch>/r23-eyes');
    expect(sideLabel('/work/r8', root)).toBe('<scratch>/r8');
    expect(sideLabel('/elsewhere/averi-calibration/differential-cal-d928789', root)).toBe('<cal>/differential-cal-d928789');
  });

  it('a relative --side resolves from the working directory, as live.ts loads it; a dot-dot names the folder it resolves to', () => {
    expect(sideLabel('../r23-keyboard', root)).toBe('<scratch>/r23-keyboard');
    expect(sideLabel('/elsewhere/r8/..', root)).toBe('<scratch>/elsewhere');
  });

  it('a --side inside the repo: its repo-relative path; the repo itself: "."', () => {
    expect(sideLabel('/work/averi/build/side', root)).toBe('build/side');
    expect(sideLabel('/work/averi', root)).toBe('.');
  });

  it('never absolute, never this checkout', () => {
    for (const side of ['/a', '/a/b/c', '/work/averi', '/work/averi/x', '/work/averix', 'rel/dir', '..']) {
      const label = sideLabel(side, root);
      expect(isAbsolute(label)).toBe(false);
      expect(label).not.toBe(THIS_CHECKOUT);
    }
  });
});

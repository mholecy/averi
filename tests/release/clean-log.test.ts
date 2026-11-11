import { describe, expect, it } from 'vitest';
import { hostPaths, scrub, subsOf } from '../../scripts/release/clean-log.js';

/** The release record's logs hold no host path (docs/release.md; path-hygiene.test.ts holds docs/ to it): clean-log.ts. */
describe('scrub: host paths replaced by labels, longest first', () => {
  it('replaces every occurrence of each path', () => {
    expect(scrub('a /w/repo/x and /w/repo/y', [['/w/repo', '<repo>']])).toBe('a <repo>/x and <repo>/y');
  });

  it('a longer path wins over its prefix, whatever the order given', () => {
    expect(scrub('/h/me/repo/src /h/me/.npm', [['/h/me', '~'], ['/h/me/repo', '<repo>']])).toBe('<repo>/src ~/.npm');
  });

  it('skips empty and root paths: they would eat every slash', () => {
    expect(scrub('/a/b', [['', '<x>'], ['/', '<root>']])).toBe('/a/b');
  });
});

describe("hostPaths: the checkout, the temporary folder and home, each as given and as resolved, then the caller's", () => {
  it('pairs each with its label, a resolved twin only where it differs', () => {
    const real = (p: string) => (p === '/t-x' ? '/r/t-x' : p);
    expect(hostPaths({ repo: '/w/repo', tmp: '/t-x', home: '/h/me', real }, [['/w/out', '<out>']])).toEqual([
      ['/w/repo', '<repo>'],
      ['/t-x', '<tmp>'],
      ['/r/t-x', '<tmp>'],
      ['/h/me', '~'],
      ['/w/out', '<out>'],
    ]);
  });

  it('strips trailing slashes (a TMPDIR ends in one), but never the root\'s own', () => {
    expect(hostPaths({ repo: '/w/repo//', tmp: '/t/', home: '/', real: (p) => p }, [['/', '<root>']])).toEqual([
      ['/w/repo', '<repo>'],
      ['/t', '<tmp>'],
      ['/', '~'],
      ['/', '<root>'],
    ]);
  });
});

describe("subsOf: the caller's <path>=<label> arguments", () => {
  it('splits each at its last =, so a path may hold one', () => {
    expect(subsOf(['/w/out=<out>', '/w/a=b=<x>'])).toEqual([
      ['/w/out', '<out>'],
      ['/w/a=b', '<x>'],
    ]);
  });

  it('refuses one with no = or no path before it', () => {
    expect(() => subsOf(['/w/out'])).toThrow('clean-log: <path>=<label>, not "/w/out"');
    expect(() => subsOf(['=<out>'])).toThrow('not "=<out>"');
  });
});

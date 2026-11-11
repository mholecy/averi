import { describe, expect, it } from 'vitest';
import { hostPaths, scrub } from '../../scripts/release/clean-log.js';

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

  it('strips a trailing slash (a TMPDIR ends in one)', () => {
    expect(hostPaths({ repo: '/w/repo/', tmp: '/t/', home: '/h/me', real: (p) => p }, [])).toEqual([
      ['/w/repo', '<repo>'],
      ['/t', '<tmp>'],
      ['/h/me', '~'],
    ]);
  });
});

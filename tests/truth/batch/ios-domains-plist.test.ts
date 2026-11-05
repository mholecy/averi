import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideRestore, TYPED_PY, typedMapOf } from '../../../scripts/truth/batch/ios-domains.js';

// ios-domains.ts's typed read (TYPED_PY) through the host's real python3 plistlib, on XML plists written here: the
// read the fakes of ios-domains-sim.test.ts stand in for. Kept apart, in the normal suite only: it starts python3,
// which the mutation run's tests do not. Each run bounded (spawnSync's timeout); no device.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-ios-plist-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n${body}\n</plist>\n`;
/** python3 -I -c TYPED_PY <file>: its exit and output. */
function typedRead(name: string, text: string): { code: number | null; out: string; err: string } {
  const file = join(dir, name);
  writeFileSync(file, text);
  const r = spawnSync('python3', ['-I', '-c', TYPED_PY, file], { encoding: 'utf8', timeout: 10_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("TYPED_PY on the host's plistlib (batch-10: bool true read int 0 after the runner's exit)", () => {
  it('each plist type its own: bool apart from int, real as float, dates and data tagged, nested values canonical', () => {
    const r = typedRead(
      'a.plist',
      plist(`<dict>
  <key>b</key><true/>
  <key>f</key><false/>
  <key>i</key><integer>0</integer>
  <key>r</key><real>1.5</real>
  <key>s</key><string>en_US</string>
  <key>t</key><date>2026-11-03T09:02:10Z</date>
  <key>z</key><data>AAE=</data>
  <key>d</key><dict><key>y</key><true/><key>x</key><integer>1</integer></dict>
  <key>a</key><array><string>q</string><false/></array>
</dict>`),
    );
    expect(r.code).toBe(0);
    expect(typedMapOf(r.out)).toEqual({
      a: { t: 'array', c: '["q", false]' },
      b: { t: 'bool', c: 'true', v: 'true' },
      d: { t: 'dict', c: '{"x": 1, "y": true}' },
      f: { t: 'bool', c: 'false', v: 'false' },
      i: { t: 'int', c: '0', v: '0' },
      r: { t: 'float', c: '1.5', v: '1.5' },
      s: { t: 'string', c: '"en_US"', v: 'en_US' },
      t: { t: 'date', c: '{"$date": "2026-11-03T09:02:10"}' },
      z: { t: 'data', c: '{"$data": "AAE="}' },
    });
  });

  it('read twice, the flip is a change and its write-back typed: bool false and int 0 are not equal', () => {
    const before = typedMapOf(typedRead('b.plist', plist('<dict><key>k</key><false/></dict>')).out);
    const after = typedMapOf(typedRead('c.plist', plist('<dict><key>k</key><integer>0</integer></dict>')).out);
    if (typeof before === 'string' || typeof after === 'string') throw new Error('not read');
    expect(decideRestore({ domain: 'com.apple.Accessibility', backupPath: '/b', backup: before, now: after })).toMatchObject({ verdict: 'act', actions: [{ op: 'write', key: 'k', flag: '-bool', value: 'false' }] });
  });

  it("the host's export of a domain not there (an empty dictionary, exit 0) reads as an empty map — so it proves nothing absent", () => {
    const r = typedRead('m.plist', readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'batch', 'defaults-host-export-missing-domain.plist'), 'utf8'));
    expect([r.code, typedMapOf(r.out)]).toEqual([0, {}]);
  });

  it('a top level that is no dictionary, or no plist at all, exits non-zero: never read as an empty domain', () => {
    expect(typedRead('d.plist', plist('<array><true/></array>')).code).not.toBe(0);
    expect(typedRead('e.plist', 'not a plist').code).not.toBe(0);
  });
});

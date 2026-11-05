import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filesUnder, hitsIn, ROOT, type Rule } from '../../helpers/path-hygiene.js';

/**
 * The batch module's own hygiene rule (spec T2 S4): no committed file under its directories holds a UUID. The module
 * takes its device ids from its caller; a literal id would tie it to one lab and one machine. The path rules — no
 * scratchpad, temporary folder, evidence folder, home directory or user — hold repo-wide, these directories among
 * them: tests/docs/path-hygiene.test.ts (T8).
 */

/** The directories the batch module owns: its code, its tests and its fixtures (any `tests/fixtures/batch*`). */
const BATCH_DIRS = ['scripts/truth/batch', 'tests/truth/batch', ...readdirSync(join(ROOT, 'tests', 'fixtures')).filter((n) => n.startsWith('batch')).map((n) => `tests/fixtures/${n}`)];

const UUID_RULE = 'a UUID (a device udid or any other id)';
// Any UUID, not only a device's (T2 S4: the D43 exports held the lab simulator's udid and an index id): a device id
// comes from args, and a fixture names a placeholder for any id of this shape.
const UUID: Rule = { what: UUID_RULE, re: new RegExp(['[0-9A-F]{8}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{12}'].join('-'), 'i') };

describe("the batch module's directories hold no UUID (T2 S4)", () => {
  it('scans something: the module, its tests', () => {
    const files = BATCH_DIRS.flatMap(filesUnder);
    expect(files.some((f) => f.startsWith('scripts/truth/batch/'))).toBe(true);
    expect(files).toContain(relative(ROOT, join(import.meta.dirname, 'hygiene.test.ts')));
  });

  it('no file holds a UUID', () => {
    expect(hitsIn(BATCH_DIRS.flatMap(filesUnder), [UUID])).toEqual([]);
  });

  it('the rule catches a UUID in either case, and no placeholder', () => {
    expect(UUID.re.test(['ABCDEF01', '2345', '6789', 'abcd', 'EF0123456789'].join('-'))).toBe(true);
    expect(UUID.re.test('LAB-SIMULATOR-UDID, AN-INDEX-UUID')).toBe(false);
  });
});

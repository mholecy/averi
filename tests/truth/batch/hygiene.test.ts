import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Path hygiene of the batch module's own directories (spec T2: S1 seeds it, T8 later widens the same list): no committed
 * file under them names a scratchpad, a temporary folder, the evidence folder, a home directory or the user. The module
 * takes its output folder and device ids from its caller; a literal path would tie it to one machine and one session.
 *
 * The forbidden fragments are built here, never written whole, so this file holds none of them itself and is scanned
 * like any other.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
/** The directories the batch module owns: its code, its tests and its fixtures (any `tests/fixtures/batch*`). */
const DIRS = ['scripts/truth/batch', 'tests/truth/batch', ...readdirSync(join(ROOT, 'tests', 'fixtures')).filter((n) => n.startsWith('batch')).map((n) => `tests/fixtures/${n}`)];

const filesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });

const slash = '/';
const user = userInfo().username;
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name as given (trimmed), or none when it is shorter than 3 characters: too short to mean a name. */
const asOwner = (name: string): string | undefined => (name.trim().length >= 3 ? name.trim() : undefined);
/** The owner's name as git knows it (`git config user.name`), read at run time so no name is ever written here. */
function ownerName(): string | undefined {
  try {
    return asOwner(execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }));
  } catch {
    return undefined; // unset: git exits 1
  }
}
const owner = ownerName();
/**
 * Each forbidden fragment and why. A user name counts only as `~name/` (a home directory path is caught by its own
 * pattern): as a bare word it is English. The owner's name counts anywhere, in any case.
 */
const FORBIDDEN: readonly { what: string; re: RegExp }[] = [
  { what: 'a macOS temporary folder', re: new RegExp(['', 'private', 'tmp'].join(slash)) },
  { what: 'a macOS per-user temporary folder', re: new RegExp(['', 'var', 'folders', ''].join(slash)) },
  { what: 'a temporary folder', re: new RegExp(`(^|[\\s'"\`(=])${slash}tmp${slash}`) },
  { what: "the session's temporary root", re: new RegExp(`claude-\\d+${slash}`) },
  { what: 'a scratchpad path', re: new RegExp(`${slash}scratch` + `pad\\b`) },
  { what: 'the evidence folder', re: new RegExp('averi-' + 'evidence') },
  { what: 'a home directory', re: new RegExp(`${slash}(Users|home)${slash}`) },
  { what: 'a mounted volume', re: new RegExp(`${slash}Volumes${slash}`) },
  { what: "this machine's home directory", re: new RegExp(escaped(homedir())) },
  { what: "the user's home as ~user/", re: new RegExp(`~${escaped(user)}${slash}`) },
  // Any UUID, not only a device's (T2 S4: the D43 exports held the lab simulator's udid and an index id): a device id
  // comes from args, and a fixture names a placeholder for any id of this shape.
  { what: 'a UUID (a device udid or any other id)', re: new RegExp(['[0-9A-F]{8}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{12}'].join('-'), 'i') },
  ...(owner === undefined ? [] : [{ what: "the owner's name (git config user.name)", re: new RegExp(escaped(owner), 'i') }]),
];

describe("path hygiene: the batch module's directories hold no machine- or session-bound path (T2 S1, seed of T8)", () => {
  it('scans something: the module, its tests', () => {
    const files = DIRS.flatMap(filesUnder);
    expect(files.some((f) => f.startsWith('scripts/truth/batch/'))).toBe(true);
    expect(files).toContain(relative(ROOT, join(import.meta.dirname, 'hygiene.test.ts')));
  });

  it('no file names a scratchpad, a temporary folder, the evidence folder, a home directory or the user', () => {
    const hits = DIRS.flatMap(filesUnder).flatMap((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => FORBIDDEN.filter((f) => f.re.test(line)).map((f) => `${file}:${i + 1}: ${f.what}`)),
    );
    expect(hits).toEqual([]);
  });

  it('each pattern catches what it names (a pattern that matches nothing guards nothing)', () => {
    const caught = (s: string) => FORBIDDEN.filter((f) => f.re.test(s)).map((f) => f.what);
    expect(caught(['', 'private', 'tmp', 'x'].join(slash))).toContain('a macOS temporary folder');
    expect(caught(['', 'var', 'folders', 'ab'].join(slash))).toContain('a macOS per-user temporary folder');
    expect(caught(`cd ${slash}tmp${slash}x`)).toContain('a temporary folder');
    expect(caught(`x${slash}claude-502${slash}y`)).toContain("the session's temporary root");
    expect(caught(`a${slash}scratch` + `pad${slash}b`)).toContain('a scratchpad path');
    expect(caught('averi-' + 'evidence')).toContain('the evidence folder');
    expect(caught(`${slash}Users${slash}someone`)).toContain('a home directory');
    expect(caught(`${slash}Volumes${slash}Disk`)).toContain('a mounted volume');
    expect(caught(`${homedir()}${slash}x`)).toContain("this machine's home directory");
    expect(caught(`~${user}${slash}y`)).toContain("the user's home as ~user/");
    expect(caught(['ABCDEF01', '2345', '6789', 'abcd', 'EF0123456789'].join('-'))).toContain('a UUID (a device udid or any other id)');
    expect(caught('LAB-SIMULATOR-UDID, AN-INDEX-UUID')).toEqual([]);
    expect(caught(`an ${user} or ~${user}`)).toEqual([]);
    expect(caught('a relative path: meta/run-1/batch-n.out, or src/tmp/x')).toEqual([]);
  });

  it('a name from git counts from 3 characters, trimmed; an unset or shorter one is skipped (made-up names only)', () => {
    expect([asOwner('Ada Example\n'), asOwner('Abc'), asOwner('Ab'), asOwner('  Ab \n'), asOwner('')]).toEqual(['Ada Example', 'Abc', undefined, undefined, undefined]);
  });

  it.runIf(owner !== undefined)("the owner's name, read from git at run time, is caught in any case", () => {
    const name = owner ?? '';
    expect(FORBIDDEN.filter((f) => f.re.test(`by ${name.toUpperCase()}`)).map((f) => f.what)).toContain("the owner's name (git config user.name)");
  });
});

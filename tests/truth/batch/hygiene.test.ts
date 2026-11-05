import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THIS_CHECKOUT } from '../../../scripts/truth/live-cases.js';

/**
 * Path hygiene (spec T2 S1 seeded it over the batch module's own directories; T8 widened it): no committed file under
 * the trees below names a scratchpad, a temporary folder, the evidence folder, a home directory or the user. The batch
 * module takes its output folder and device ids from its caller; a literal path would tie it to one machine and one
 * session. The committed live records (and, T8, the notes) are read on other machines: a host path there names the
 * user and says nothing a reader can use.
 *
 * The path rules are bounded — an anchored path shape, never a bare word — so prose (`back/home/enter`, a deep link's
 * `myport://home/…`, a placeholder `/Users/…`) and the lab's own facts (a simulator runtime's
 * `CoreSimulator/Volumes/…`) pass; each rule's test names what it allows. A UUID counts only in the batch module's
 * directories: elsewhere it is a lab fact (a simulator udid in a judged reply).
 *
 * The forbidden fragments are built here, never written whole, so this file holds none of them itself and is scanned
 * like any other.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
/** The directories the batch module owns: its code, its tests and its fixtures (any `tests/fixtures/batch*`). */
const BATCH_DIRS = ['scripts/truth/batch', 'tests/truth/batch', ...readdirSync(join(ROOT, 'tests', 'fixtures')).filter((n) => n.startsWith('batch')).map((n) => `tests/fixtures/${n}`)];
/** The committed live records (T8): every file under them, the raw diagnosis folders included. */
const RECORDS = 'docs/truth/live-records';
/** The trees held to the path rules besides the batch module's (T8): the notes, the records among them, the skill. */
const WIDE = ['docs', 'skill', 'README.md', 'ARCHITECTURE.md'];

/** Every file under a tree (a file: itself). */
const filesUnder = (path: string): string[] =>
  statSync(join(ROOT, path)).isDirectory() ? readdirSync(join(ROOT, path)).flatMap((name) => filesUnder(join(path, name))) : [path];

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
/** A path segment's first character: what makes a path shape a path, not a placeholder (`…`) or a bare folder name. */
const seg = '[\\w.-]';
/**
 * Each forbidden fragment and why, held over every tree. A user name counts only as `~name/` (a home directory path is
 * caught by its own pattern): as a bare word it is English. The owner's name counts anywhere, in any case.
 */
const PATHS: readonly { what: string; re: RegExp }[] = [
  { what: 'a macOS temporary folder', re: new RegExp(`${slash}private${slash}(tmp|var)${slash}${seg}`) },
  { what: 'a macOS per-user temporary folder', re: new RegExp(`${slash}var${slash}folders${slash}${seg}`) },
  { what: 'a temporary folder', re: new RegExp(`(^|[\\s'"\`(=])${slash}tmp${slash}${seg}`) },
  { what: "the session's temporary root", re: new RegExp(`claude-\\d+${slash}`) },
  { what: 'a scratchpad path', re: new RegExp(`${slash}scratch` + `pad\\b`) },
  { what: 'the evidence folder', re: new RegExp('averi-' + 'evidence') },
  // At a path's start — a line's, after a non-path character, or a file URL's — so `back/home/enter` and a deep link's
  // `myport://home/…` are no home.
  { what: 'a home directory', re: new RegExp(`(^|[^\\w.~${slash}-]|file:${slash}${slash})${slash}(Users|home)${slash}${seg}`) },
  // A simulator runtime's image mounts under CoreSimulator/Volumes/: the lab's, no host's.
  { what: 'a mounted volume', re: new RegExp(`(?<!CoreSimulator)${slash}Volumes${slash}${seg}`) },
  { what: "this machine's home directory", re: new RegExp(escaped(homedir())) },
  { what: "the user's home as ~user/", re: new RegExp(`~${escaped(user)}${slash}`) },
  ...(owner === undefined ? [] : [{ what: "the owner's name (git config user.name)", re: new RegExp(escaped(owner), 'i') }]),
];
/** Held over the batch module's directories alone: elsewhere a UUID is a lab fact (a simulator udid in a reply). */
const BATCH_ONLY: readonly { what: string; re: RegExp }[] = [
  // Any UUID, not only a device's (T2 S4: the D43 exports held the lab simulator's udid and an index id): a device id
  // comes from args, and a fixture names a placeholder for any id of this shape.
  { what: 'a UUID (a device udid or any other id)', re: new RegExp(['[0-9A-F]{8}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{4}', '[0-9A-F]{12}'].join('-'), 'i') },
];
const FORBIDDEN = [...PATHS, ...BATCH_ONLY];

/**
 * A record's `side` that names no host: THIS_CHECKOUT, or a label live-cases.ts#sideLabel writes (`<scratch>/<dir>`,
 * `<cal>/<dir>`, a repo-relative path) or an older relative one (`../r8`) — never absolute, never under a home (`~`).
 */
const portable = (side: unknown) => side === THIS_CHECKOUT || (typeof side === 'string' && side !== '' && !isAbsolute(side) && !side.startsWith('~'));

/** Each line of each file that holds a fragment: `file:line: what`. */
const hitsIn = (files: readonly string[], rules: readonly { what: string; re: RegExp }[]): string[] =>
  files.flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => rules.filter((f) => f.re.test(line)).map((f) => `${file}:${i + 1}: ${f.what}`)),
  );

describe('path hygiene: the batch module, the live records and the notes hold no machine- or session-bound path (T2 S1, T8)', () => {
  it('scans something: the module, its tests, the live records, the notes, the skill', () => {
    const files = BATCH_DIRS.flatMap(filesUnder);
    expect(files.some((f) => f.startsWith('scripts/truth/batch/'))).toBe(true);
    expect(files).toContain(relative(ROOT, join(import.meta.dirname, 'hygiene.test.ts')));
    const wide = WIDE.flatMap(filesUnder);
    expect(wide.filter((f) => f.startsWith(`${RECORDS}/`)).length).toBeGreaterThan(200);
    expect(wide.filter((f) => f.startsWith('docs/bugs/')).length).toBeGreaterThan(30);
    expect(wide.filter((f) => f.startsWith('skill/')).length).toBeGreaterThan(0);
    expect(wide).toEqual(expect.arrayContaining(['README.md', 'ARCHITECTURE.md']));
  });

  it("no file of the batch module's names a scratchpad, a temporary folder, the evidence folder, a home directory, the user or a UUID", () => {
    expect(hitsIn(BATCH_DIRS.flatMap(filesUnder), FORBIDDEN)).toEqual([]);
  });

  it('no live record or note names a scratchpad, a temporary folder, the evidence folder, a home directory or the user', () => {
    expect(hitsIn(WIDE.flatMap(filesUnder), PATHS)).toEqual([]);
  });

  it("every live record's side is this checkout or a portable label (a --side run's: a calibration, never this checkout's)", () => {
    const sides = readdirSync(join(ROOT, RECORDS))
      .filter((n) => n.endsWith('.json'))
      .map((n) => ({ n, side: (JSON.parse(readFileSync(join(ROOT, RECORDS, n), 'utf8')) as { side?: unknown }).side }))
      .filter(({ side }) => side !== undefined);
    expect(sides.length).toBeGreaterThan(200);
    expect(sides.filter(({ side }) => !portable(side)).map(({ n, side }) => `${n}: ${String(side)}`)).toEqual([]);
  });

  it('each pattern catches what it names (a pattern that matches nothing guards nothing)', () => {
    const caught = (s: string) => FORBIDDEN.filter((f) => f.re.test(s)).map((f) => f.what);
    expect(caught(['', 'private', 'tmp', 'x'].join(slash))).toContain('a macOS temporary folder');
    expect(caught(['', 'private', 'var', 'x'].join(slash))).toContain('a macOS temporary folder');
    expect(caught(['', 'var', 'folders', 'ab'].join(slash))).toContain('a macOS per-user temporary folder');
    expect(caught(`cd ${slash}tmp${slash}x`)).toContain('a temporary folder');
    expect(caught(`x${slash}claude-502${slash}y`)).toContain("the session's temporary root");
    expect(caught(`a${slash}scratch` + `pad${slash}b`)).toContain('a scratchpad path');
    expect(caught('averi-' + 'evidence')).toContain('the evidence folder');
    expect(caught(`${slash}Users${slash}someone`)).toContain('a home directory');
    expect(caught(`cwd \`${slash}Users${slash}someone${slash}app\``)).toContain('a home directory');
    expect(caught(`File "${slash}home${slash}someone${slash}.local"`)).toContain('a home directory');
    expect(caught(`file:${slash}${slash}${slash}Users${slash}someone${slash}Library`)).toContain('a home directory');
    expect(caught(`${slash}Volumes${slash}Disk`)).toContain('a mounted volume');
    expect(caught(`cd ${slash}Volumes${slash}Disk${slash}x`)).toContain('a mounted volume');
    expect(caught(`${homedir()}${slash}x`)).toContain("this machine's home directory");
    expect(caught(`~${user}${slash}y`)).toContain("the user's home as ~user/");
    expect(caught(['ABCDEF01', '2345', '6789', 'abcd', 'EF0123456789'].join('-'))).toContain('a UUID (a device udid or any other id)');
    expect(caught('LAB-SIMULATOR-UDID, AN-INDEX-UUID')).toEqual([]);
    expect(caught(`an ${user} or ~${user}`)).toEqual([]);
    expect(caught('a relative path: meta/run-1/batch-n.out, or src/tmp/x')).toEqual([]);
  });

  it('a portable side: this checkout or a relative label, never absolute, never under a home (made-up paths)', () => {
    expect([THIS_CHECKOUT, '<scratch>/r23-eyes', '<cal>/differential-cal-d928789', '../r8', 'build/side'].map(portable)).toEqual([true, true, true, true, true]);
    expect([`${slash}a${slash}b${slash}r23-eyes`, `~${slash}r8`, '', undefined, 1].map(portable)).toEqual([false, false, false, false, false]);
  });

  it('what each path rule allows: prose, placeholders, a deep link, the lab simulator runtime (T8)', () => {
    const caught = (s: string) => PATHS.filter((f) => f.re.test(s)).map((f) => f.what);
    // a home directory: a path inside a word, a deep link's host, a placeholder
    expect(caught('pressKey(back/home/enter)')).toEqual([]);
    expect(caught(`myport:${slash}${slash}home${slash}x`)).toEqual([]);
    expect(caught(`an absolute ${slash}Users${slash}… or ${slash}home${slash}<name> path`)).toEqual([]);
    expect(caught(`~${slash}.local${slash}pipx and <home>${slash}x`)).toEqual([]);
    // a temporary folder: the bare folder (a symlink's name), a placeholder
    expect(caught(`(${slash}tmp → ${slash}private${slash}tmp)`)).toEqual([]);
    expect(caught(`${slash}private${slash}tmp${slash}…, ${slash}tmp${slash}… or ${slash}var${slash}folders${slash}…`)).toEqual([]);
    // a mounted volume: the simulator runtime's image (a lab fact)
    expect(caught(`Library${slash}Developer${slash}CoreSimulator${slash}Volumes${slash}iOS_22A3351${slash}x`)).toEqual([]);
    // a portable side label
    expect(caught('<scratch>/r23-eyes, <cal>/differential-cal-d928789, ../r8')).toEqual([]);
  });

  it('a name from git counts from 3 characters, trimmed; an unset or shorter one is skipped (made-up names only)', () => {
    expect([asOwner('Ada Example\n'), asOwner('Abc'), asOwner('Ab'), asOwner('  Ab \n'), asOwner('')]).toEqual(['Ada Example', 'Abc', undefined, undefined, undefined]);
  });

  it.runIf(owner !== undefined)("the owner's name, read from git at run time, is caught in any case", () => {
    const name = owner ?? '';
    expect(FORBIDDEN.filter((f) => f.re.test(`by ${name.toUpperCase()}`)).map((f) => f.what)).toContain("the owner's name (git config user.name)");
  });
});

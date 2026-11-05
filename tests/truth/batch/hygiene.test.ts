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
 * `CoreSimulator/Volumes/…`) pass; each rule's test names what it allows, and the tests' made-up sample homes and
 * temporary files are named in SAMPLES. A UUID counts only in the batch module's directories: elsewhere it is a lab
 * fact (a simulator udid in a judged reply).
 *
 * The forbidden fragments are built here, never written whole, so this file holds none of them itself and is scanned
 * like any other.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
/** The directories the batch module owns: its code, its tests and its fixtures (any `tests/fixtures/batch*`). */
const BATCH_DIRS = ['scripts/truth/batch', 'tests/truth/batch', ...readdirSync(join(ROOT, 'tests', 'fixtures')).filter((n) => n.startsWith('batch')).map((n) => `tests/fixtures/${n}`)];
/** The committed live records (T8): every file under them, the raw diagnosis folders included. */
const RECORDS = 'docs/truth/live-records';
/** The trees held to the path rules besides the batch module's (T8): the notes, the records among them, the skill, the tests and their fixtures. */
const WIDE = ['docs', 'skill', 'README.md', 'ARCHITECTURE.md', 'tests'];

/** Every file under a tree (a file: itself). */
const filesUnder = (path: string): string[] =>
  statSync(join(ROOT, path)).isDirectory() ? readdirSync(join(ROOT, path)).flatMap((name) => filesUnder(join(path, name))) : [path];

const slash = '/';
const user = userInfo().username;
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Accents folded (NFD, the combining marks dropped): a name typed without its accents is still the name. */
const folded = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
/**
 * A name as given (folded, its parts single-spaced), or none when it could be a code word: a name counts with two parts
 * or more, or as one part of 4 letters or more (`Max`, `Lab`: maxScroll, the lab app).
 */
const asOwner = (name: string): string | undefined => {
  const parts = folded(name).trim().split(/\s+/).filter((p) => p !== '');
  return parts.length >= 2 || (parts.length === 1 && [...parts[0]].length >= 4) ? parts.join(' ') : undefined;
};
/** A name (asOwner's) as whole words, any case, any spacing between its parts; read off a folded line (rulesHitting). */
const ownerRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${name.split(' ').map(escaped).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');
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
  { what: "this machine's home directory", re: new RegExp(escaped(folded(homedir()))) },
  { what: "the user's home as ~user/", re: new RegExp(`~${escaped(folded(user))}${slash}`) },
  ...(owner === undefined ? [] : [{ what: "the owner's name (git config user.name)", re: ownerRe(owner) }]),
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

/**
 * The made-up host paths tests use as samples (T8), each named: struck from a line of a file under tests/ (where they
 * occur, and nowhere else) before the rules read it. Whole names only: a home ends at a slash, a quote, a space or the
 * line's end (`me.smith`, `lab-ops` are still caught); a temporary file at a word's end (`xavier` is still caught).
 */
const SAMPLES: readonly { what: string; re: RegExp }[] = [
  { what: `a made-up home: ${['me', 'lab', 'tester', 'a b'].map((n) => `${slash}Users${slash}${n}`).join(', ')}, ${slash}home${slash}x`, re: new RegExp(`${slash}(Users${slash}(me|lab|tester|a b)|home${slash}x)(?=[${slash}'"\`\\s]|$)`, 'g') },
  { what: 'a made-up temporary file: /tmp/x…, /tmp/App.app, /tmp/averi-test-baselines, /var/folders/x/', re: new RegExp(`(?<![\\w.-])${slash}tmp${slash}(x|App\\.app|averi-test-baselines)\\b|${slash}var${slash}folders${slash}x${slash}`, 'g') },
];
/** What of the rules a line of `file` holds, its accents folded and (under tests/) its samples struck. */
const rulesHitting = (rules: readonly { what: string; re: RegExp }[], line: string, file: string): string[] => {
  const samples = file.startsWith('tests/') ? SAMPLES : [];
  const read = samples.reduce((l, sample) => l.replace(sample.re, '<sample>'), folded(line));
  return rules.filter((f) => f.re.test(read)).map((f) => f.what);
};

/** A file outside tests/, for the rules' own tests: no sample struck. */
const NOTE = 'docs/x.md';

/** Each line of each file that holds a fragment: `file:line: what`. */
const hitsIn = (files: readonly string[], rules: readonly { what: string; re: RegExp }[]): string[] =>
  files.flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => rulesHitting(rules, line, file).map((what) => `${file}:${i + 1}: ${what}`)),
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
    expect(wide).toEqual(expect.arrayContaining(['README.md', 'ARCHITECTURE.md', 'tests/helpers/simctl-appinfo.ts']));
    expect(wide.filter((f) => f.startsWith('tests/fixtures/truth/')).length).toBeGreaterThan(0);
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
    const caught = (s: string) => rulesHitting(FORBIDDEN, s, NOTE);
    expect(caught(['', 'private', 'tmp', 'x'].join(slash))).toContain('a macOS temporary folder');
    expect(caught(['', 'private', 'var', 'x'].join(slash))).toContain('a macOS temporary folder');
    expect(caught(['', 'var', 'folders', 'ab'].join(slash))).toContain('a macOS per-user temporary folder');
    expect(caught(`cd ${slash}tmp${slash}run-1`)).toContain('a temporary folder');
    expect(caught(`x${slash}claude-123${slash}y`)).toContain("the session's temporary root");
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
    const caught = (s: string) => rulesHitting(PATHS, s, NOTE);
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

  it('what the tests may hold: made-up homes and temporary files, each named — and nothing like them (T8)', () => {
    const caught = (s: string) => rulesHitting(PATHS, s, 'tests/x.test.ts');
    for (const sample of ['me', 'lab', 'tester', 'a b']) expect(caught(`'${slash}Users${slash}${sample}${slash}Library'`)).toEqual([]);
    expect(caught(`HOME: '${slash}home${slash}x'`)).toEqual([]);
    expect(caught(`"${slash}Users${slash}me" or ${slash}Users${slash}lab\tx, cd ${slash}Users${slash}tester`)).toEqual([]);
    for (const longer of ['me.smith', 'lab-ops', 'tester.john']) expect(caught(`'${slash}Users${slash}${longer}${slash}x'`)).toContain('a home directory');
    expect(caught(`'${slash}home${slash}x-y${slash}z'`)).toContain('a home directory');
    expect(caught(`install('${slash}tmp${slash}App.app'), log: ${slash}tmp${slash}x.log, '${slash}tmp${slash}x', ${slash}tmp${slash}averi-test-baselines`)).toEqual([]);
    expect(caught(`classify('${slash}var${slash}folders${slash}x${slash}averi-ocr')`)).toEqual([]);
    expect(caught(`'${slash}Users${slash}meyer${slash}x'`)).toContain('a home directory');
    expect(caught(`'${slash}home${slash}xavier${slash}x'`)).toContain('a home directory');
    expect(caught(`'${slash}tmp${slash}xavier'`)).toContain('a temporary folder');
    expect(caught(`'${slash}var${slash}folders${slash}xy${slash}z'`)).toContain('a macOS per-user temporary folder');
  });

  it('the samples are struck in tests/ alone: a note, the skill, README.md or ARCHITECTURE.md naming one is caught', () => {
    for (const where of [NOTE, 'skill/x.md', 'README.md', 'ARCHITECTURE.md']) {
      expect(rulesHitting(PATHS, `cwd ${slash}Users${slash}me${slash}app`, where)).toContain('a home directory');
      expect(rulesHitting(PATHS, `cd ${slash}tmp${slash}x`, where)).toContain('a temporary folder');
    }
  });

  it('a name from git counts when it has two parts, or one of 4 letters or more, accents folded; an unset or shorter one is skipped (made-up names only)', () => {
    expect([asOwner('Ada Example\n'), asOwner('Abcd'), asOwner('Al Bo'), asOwner('Max'), asOwner('Lab'), asOwner('  Ab \n'), asOwner(''), asOwner('Zoë Ünder')]).toEqual([
      'Ada Example', 'Abcd', 'Al Bo', undefined, undefined, undefined, undefined, 'Zoe Under',
    ]);
  });

  it("the owner's name: whole words, any case, accents folded on both sides — no code word (made-up names only)", () => {
    const named = (name: string, line: string) => rulesHitting([{ what: 'owner', re: ownerRe(asOwner(name) ?? '') }], line, NOTE).length > 0;
    expect(named('Zoë Ünder', 'by Zoe Under')).toBe(true);
    expect(named('Zoe Under', 'by ZOË  ÜNDER.')).toBe(true);
    expect(named('Zoë Ünder', 'zoeunder, Zoe Underhill, Zoe')).toBe(false);
    expect(named('Maxi', 'maxiScroll, maximum, Maxi1, setMaxi')).toBe(false);
    expect(named('Maxi', 'asked Maxi.')).toBe(true);
  });

  it.runIf(owner !== undefined)("the owner's name, read from git at run time, is caught in any case, accented or not", () => {
    const name = owner ?? '';
    const hit = (line: string) => rulesHitting(FORBIDDEN, line, NOTE);
    expect(hit(`by ${name.toUpperCase()}`)).toContain("the owner's name (git config user.name)");
    expect(hit(`by ${name.normalize('NFD').replace(/\p{M}/gu, '')}`)).toContain("the owner's name (git config user.name)");
  });
});

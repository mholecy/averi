import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { escapeRegExp } from '../../src/util/regex.js';

/**
 * The path hygiene rules (T2 S1 seeded them over the batch module, T8 made them repo-wide): what no committed file may
 * name — a scratchpad, a temporary folder, the evidence folder, a home directory, the user. Read by
 * tests/docs/path-hygiene.test.ts (the repo's trees) and tests/truth/batch/hygiene.test.ts (the batch module's UUID
 * rule). The forbidden fragments are built here, never written whole, so this file holds none of them itself and is
 * scanned like any other.
 */

/** The averi checkout's root. */
export const ROOT = join(import.meta.dirname, '..', '..');

/** A forbidden fragment and why. */
export interface Rule {
  what: string;
  re: RegExp;
}

export const SLASH = '/';
/** Accents folded (NFD, the combining marks dropped): a name typed without its accents is still the name. */
export const folded = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Every file under a tree, relative to ROOT (a file: itself). */
export const filesUnder = (path: string): string[] =>
  statSync(join(ROOT, path)).isDirectory() ? readdirSync(join(ROOT, path)).flatMap((name) => filesUnder(join(path, name))) : [path];

/**
 * A name as given (folded, its parts single-spaced), or none when it could be a code word: a name counts with two parts
 * or more, or as one part of 4 letters or more (`Max`, `Lab`: maxScroll, the lab app).
 */
export const asOwner = (name: string): string | undefined => {
  const parts = folded(name).trim().split(/\s+/).filter((p) => p !== '');
  return parts.length >= 2 || (parts.length === 1 && [...parts[0]].length >= 4) ? parts.join(' ') : undefined;
};
/** A name (asOwner's) as whole words, any case, any spacing between its parts; read off a folded line (rulesHitting). */
export const ownerRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${name.split(' ').map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');
/** The owner's name as git knows it (`git config user.name`), read at run time so no name is ever written here. */
function ownerAsGiven(): string | undefined {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return undefined; // unset: git exits 1
  }
}
export const OWNER_AS_GIVEN = ownerAsGiven();
/** The owner's name as the rule reads it (asOwner's), or none. */
export const OWNER = OWNER_AS_GIVEN === undefined ? undefined : asOwner(OWNER_AS_GIVEN);
export const OWNER_RULE = "the owner's name (git config user.name)";

/** Where a path ends: a slash, a quote, whitespace or the line's end — so a longer name is not read as this one. */
const PATH_END = `(?=[${SLASH}'"\`\\s]|$)`;
/** A path segment's first character: what makes a path shape a path, not a placeholder (`…`) or a bare folder name. */
const SEG_START = '[\\w.-]';

export const HOME_RULE = "this machine's home directory";
/**
 * This machine's home as a rule, ending at a path's end; none for a shallow home (`/`, or one segment such as a
 * root user's): it would match far more than a home.
 */
export function homeRule(home: string): Rule | undefined {
  if (home.split(SLASH).filter((s) => s !== '').length < 2) return undefined;
  return { what: HOME_RULE, re: new RegExp(`${escapeRegExp(folded(home))}${PATH_END}`) };
}

const user = userInfo().username;
const machineHome = homeRule(homedir());
/**
 * Each forbidden path fragment and why, held over every tree. A user name counts only as `~name/` (a home directory
 * path is caught by its own pattern): as a bare word it is English. The owner's name counts as whole words.
 */
export const PATH_RULES: readonly Rule[] = [
  { what: 'a macOS temporary folder', re: new RegExp(`${SLASH}private${SLASH}(tmp|var)${SLASH}${SEG_START}`) },
  { what: 'a macOS per-user temporary folder', re: new RegExp(`${SLASH}var${SLASH}folders${SLASH}${SEG_START}`) },
  { what: 'a temporary folder', re: new RegExp(`(^|[\\s'"\`(=])${SLASH}tmp${SLASH}${SEG_START}`) },
  { what: "the session's temporary root", re: new RegExp(`claude-\\d+${SLASH}`) },
  { what: 'a scratchpad path', re: new RegExp(`${SLASH}scratch` + `pad\\b`) },
  { what: 'the evidence folder', re: new RegExp('averi-' + 'evidence') },
  // At a path's start — a line's, after a non-path character, or a file URL's — so `back/home/enter` and a deep link's
  // `myport://home/…` are no home.
  { what: 'a home directory', re: new RegExp(`(^|[^\\w.~${SLASH}-]|file:${SLASH}${SLASH})${SLASH}(Users|home)${SLASH}${SEG_START}`) },
  // A simulator runtime's image mounts under CoreSimulator/Volumes/: the lab's, no host's.
  { what: 'a mounted volume', re: new RegExp(`(?<!CoreSimulator)${SLASH}Volumes${SLASH}${SEG_START}`) },
  ...(machineHome === undefined ? [] : [machineHome]),
  { what: "the user's home as ~user/", re: new RegExp(`~${escapeRegExp(folded(user))}${SLASH}`) },
  ...(OWNER === undefined ? [] : [{ what: OWNER_RULE, re: ownerRe(OWNER) }]),
];

/**
 * The made-up host paths tests use as samples (T8), each named: struck from a line of a file under tests/ (where they
 * occur, and nowhere else) before the rules read it. Whole names only: a home ends at a path's end (`me.smith`,
 * `lab-ops` are still caught); a temporary file at a word's end (`xavier` is still caught).
 */
export const SAMPLES: readonly Rule[] = [
  {
    what: `a made-up home: ${['me', 'lab', 'tester', 'a b'].map((n) => `${SLASH}Users${SLASH}${n}`).join(', ')}, ${SLASH}home${SLASH}x`,
    re: new RegExp(`${SLASH}(Users${SLASH}(me|lab|tester|a b)|home${SLASH}x)${PATH_END}`, 'g'),
  },
  { what: 'a made-up temporary file: /tmp/x…, /tmp/App.app, /tmp/averi-test-baselines, /var/folders/x/', re: new RegExp(`(?<![\\w.-])${SLASH}tmp${SLASH}(x|App\\.app|averi-test-baselines)\\b|${SLASH}var${SLASH}folders${SLASH}x${SLASH}`, 'g') },
];

/** What of the rules a line of `file` holds, its accents folded and (under tests/) its samples struck. */
export const rulesHitting = (rules: readonly Rule[], line: string, file: string): string[] => {
  const samples = file.startsWith('tests/') ? SAMPLES : [];
  const scrubbed = samples.reduce((l, sample) => l.replace(sample.re, '<sample>'), folded(line));
  return rules.filter((f) => f.re.test(scrubbed)).map((f) => f.what);
};

/** Each line of each file that holds a fragment: `file:line: what`. */
export const hitsIn = (files: readonly string[], rules: readonly Rule[]): string[] =>
  files.flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => rulesHitting(rules, line, file).map((what) => `${file}:${i + 1}: ${what}`)),
  );

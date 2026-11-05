import { readdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPortableSide } from '../../scripts/truth/live-cases.js';
import { asOwner, filesUnder, folded, hitsIn, HOME_RULE, homeRule, OWNER, OWNER_AS_GIVEN, OWNER_RULE, ownerRe, PATH_RULES, ROOT, rulesHitting, SLASH } from '../helpers/path-hygiene.js';

/**
 * Path hygiene, repo-wide (T8; the batch module's own directories were its seed, T2 S1): no committed note, live
 * record, skill, test or fixture — nor the batch module's code — names a scratchpad, a temporary folder, the evidence
 * folder, a home directory or the user. They are read on other machines: a host path there names the user and says
 * nothing a reader can use.
 *
 * The rules (tests/helpers/path-hygiene.ts) are bounded — an anchored path shape, never a bare word — so prose
 * (`back/home/enter`, a deep link's `myport://home/…`, a placeholder `/Users/…`) and the lab's own facts (a simulator
 * runtime's `CoreSimulator/Volumes/…`) pass; each rule's test names what it allows, and the tests' made-up sample
 * homes and temporary files are named in SAMPLES. A UUID is no host path: here it is a lab fact (a simulator udid in a
 * judged reply); the batch module's own test holds its directories to no UUID at all.
 */

/** The committed live records: every file under them, the raw diagnosis folders included. */
const RECORDS = 'docs/truth/live-records';
/** The trees held to the path rules: the notes (the records among them), the skill, the tests and their fixtures, the batch module's code. */
const HELD_TREES = ['docs', 'skill', 'README.md', 'ARCHITECTURE.md', 'tests', 'scripts/truth/batch'];
/** A file outside tests/, for the rules' own tests: no sample struck. */
const NOTE_PATH = 'docs/x.md';
const user = userInfo().username;

describe('path hygiene: the notes, the live records, the skill, the tests and the batch module hold no machine- or session-bound path (T8)', () => {
  it('scans something: the live records, the notes, the skill, the tests and their fixtures, the batch module', () => {
    const held = HELD_TREES.flatMap(filesUnder);
    expect(held.filter((f) => f.startsWith(`${RECORDS}/`)).length).toBeGreaterThan(200);
    expect(held.filter((f) => f.startsWith('docs/bugs/')).length).toBeGreaterThan(30);
    expect(held.filter((f) => f.startsWith('skill/')).length).toBeGreaterThan(0);
    expect(held).toEqual(expect.arrayContaining(['README.md', 'ARCHITECTURE.md', 'tests/helpers/simctl-appinfo.ts', 'tests/docs/path-hygiene.test.ts', 'tests/helpers/path-hygiene.ts']));
    expect(held.filter((f) => f.startsWith('tests/fixtures/truth/')).length).toBeGreaterThan(0);
    expect(held.some((f) => f.startsWith('scripts/truth/batch/'))).toBe(true);
  });

  it('no file names a scratchpad, a temporary folder, the evidence folder, a home directory or the user', () => {
    expect(hitsIn(HELD_TREES.flatMap(filesUnder), PATH_RULES)).toEqual([]);
  });

  it("every live record's side is this checkout or a portable label (a --side run's: a calibration, never this checkout's)", () => {
    const sides = readdirSync(join(ROOT, RECORDS))
      .filter((n) => n.endsWith('.json'))
      .map((n) => ({ n, side: (JSON.parse(readFileSync(join(ROOT, RECORDS, n), 'utf8')) as { side?: unknown }).side }))
      .filter(({ side }) => side !== undefined);
    expect(sides.length).toBeGreaterThan(200);
    expect(sides.filter(({ side }) => !isPortableSide(side)).map(({ n, side }) => `${n}: ${String(side)}`)).toEqual([]);
  });

  it('each rule catches what it names (a rule that matches nothing guards nothing)', () => {
    const caught = (s: string) => rulesHitting(PATH_RULES, s, NOTE_PATH);
    expect(caught(['', 'private', 'tmp', 'x'].join(SLASH))).toContain('a macOS temporary folder');
    expect(caught(['', 'private', 'var', 'x'].join(SLASH))).toContain('a macOS temporary folder');
    expect(caught(['', 'var', 'folders', 'ab'].join(SLASH))).toContain('a macOS per-user temporary folder');
    expect(caught(`cd ${SLASH}tmp${SLASH}run-1`)).toContain('a temporary folder');
    expect(caught(`x${SLASH}claude-123${SLASH}y`)).toContain("the session's temporary root");
    expect(caught(`a${SLASH}scratch` + `pad${SLASH}b`)).toContain('a scratchpad path');
    expect(caught('averi-' + 'evidence')).toContain('the evidence folder');
    expect(caught(`${SLASH}Users${SLASH}someone`)).toContain('a home directory');
    expect(caught(`cwd \`${SLASH}Users${SLASH}someone${SLASH}app\``)).toContain('a home directory');
    expect(caught(`File "${SLASH}home${SLASH}someone${SLASH}.local"`)).toContain('a home directory');
    expect(caught(`file:${SLASH}${SLASH}${SLASH}Users${SLASH}someone${SLASH}Library`)).toContain('a home directory');
    expect(caught(`${SLASH}Volumes${SLASH}Disk`)).toContain('a mounted volume');
    expect(caught(`cd ${SLASH}Volumes${SLASH}Disk${SLASH}x`)).toContain('a mounted volume');
    expect(caught(`~${user}${SLASH}y`)).toContain("the user's home as ~user/");
    expect(caught(`an ${user} or ~${user}`)).toEqual([]);
    expect(caught('a relative path: meta/run-1/batch-n.out, or src/tmp/x')).toEqual([]);
  });

  it.runIf(homeRule(homedir()) !== undefined)("this machine's home, as it is, is caught", () => {
    expect(rulesHitting(PATH_RULES, `${homedir()}${SLASH}x`, NOTE_PATH)).toContain(HOME_RULE);
  });

  it("a home as a rule ends at a path's end, and a shallow one (the root, one segment) is no rule (made-up homes)", () => {
    const home = [SLASH, 'Users', SLASH, 'zed'].join('');
    const hit = (line: string) => rulesHitting([homeRule(home)!], line, NOTE_PATH).length > 0;
    expect([`${home}${SLASH}x`, `"${home}"`, `cd ${home}`, `${home} and`].map(hit)).toEqual([true, true, true, true]);
    expect([`${home}d${SLASH}x`, `${home}.old${SLASH}x`, `${home}-b`].map(hit)).toEqual([false, false, false]);
    expect([homeRule(SLASH), homeRule(`${SLASH}root`), homeRule(`${SLASH}root${SLASH}`)]).toEqual([undefined, undefined, undefined]);
    expect(homeRule(`${SLASH}home${SLASH}zed`)?.what).toBe(HOME_RULE);
  });

  it('what each path rule allows: prose, placeholders, a deep link, the lab simulator runtime', () => {
    const caught = (s: string) => rulesHitting(PATH_RULES, s, NOTE_PATH);
    // a home directory: a path inside a word, a deep link's host, a placeholder
    expect(caught('pressKey(back/home/enter)')).toEqual([]);
    expect(caught(`myport:${SLASH}${SLASH}home${SLASH}x`)).toEqual([]);
    expect(caught(`an absolute ${SLASH}Users${SLASH}… or ${SLASH}home${SLASH}<name> path`)).toEqual([]);
    expect(caught(`~${SLASH}.local${SLASH}pipx and <home>${SLASH}x`)).toEqual([]);
    // a temporary folder: the bare folder (a symlink's name), a placeholder
    expect(caught(`(${SLASH}tmp → ${SLASH}private${SLASH}tmp)`)).toEqual([]);
    expect(caught(`${SLASH}private${SLASH}tmp${SLASH}…, ${SLASH}tmp${SLASH}… or ${SLASH}var${SLASH}folders${SLASH}…`)).toEqual([]);
    // a mounted volume: the simulator runtime's image (a lab fact)
    expect(caught(`Library${SLASH}Developer${SLASH}CoreSimulator${SLASH}Volumes${SLASH}iOS_22A3351${SLASH}x`)).toEqual([]);
    // a portable side label
    expect(caught('<scratch>/r23-eyes, <cal>/differential-cal-d928789, ../r8')).toEqual([]);
  });

  it('what the tests may hold: made-up homes and temporary files, each named — and nothing like them', () => {
    const caught = (s: string) => rulesHitting(PATH_RULES, s, 'tests/x.test.ts');
    for (const sample of ['me', 'lab', 'tester', 'a b']) expect(caught(`'${SLASH}Users${SLASH}${sample}${SLASH}Library'`)).toEqual([]);
    expect(caught(`HOME: '${SLASH}home${SLASH}x'`)).toEqual([]);
    expect(caught(`"${SLASH}Users${SLASH}me" or ${SLASH}Users${SLASH}lab\tx, cd ${SLASH}Users${SLASH}tester`)).toEqual([]);
    for (const longer of ['me.smith', 'lab-ops', 'tester.john']) expect(caught(`'${SLASH}Users${SLASH}${longer}${SLASH}x'`)).toContain('a home directory');
    expect(caught(`'${SLASH}home${SLASH}x-y${SLASH}z'`)).toContain('a home directory');
    expect(caught(`install('${SLASH}tmp${SLASH}App.app'), log: ${SLASH}tmp${SLASH}x.log, '${SLASH}tmp${SLASH}x', ${SLASH}tmp${SLASH}averi-test-baselines`)).toEqual([]);
    expect(caught(`classify('${SLASH}var${SLASH}folders${SLASH}x${SLASH}averi-ocr')`)).toEqual([]);
    expect(caught(`'${SLASH}Users${SLASH}meyer${SLASH}x'`)).toContain('a home directory');
    expect(caught(`'${SLASH}home${SLASH}xavier${SLASH}x'`)).toContain('a home directory');
    expect(caught(`'${SLASH}tmp${SLASH}xavier'`)).toContain('a temporary folder');
    expect(caught(`'${SLASH}var${SLASH}folders${SLASH}xy${SLASH}z'`)).toContain('a macOS per-user temporary folder');
  });

  it('the samples are struck in tests/ alone: a note, the skill, README.md or ARCHITECTURE.md naming one is caught', () => {
    for (const where of [NOTE_PATH, 'skill/x.md', 'README.md', 'ARCHITECTURE.md']) {
      expect(rulesHitting(PATH_RULES, `cwd ${SLASH}Users${SLASH}me${SLASH}app`, where)).toContain('a home directory');
      expect(rulesHitting(PATH_RULES, `cd ${SLASH}tmp${SLASH}x`, where)).toContain('a temporary folder');
    }
  });

  it('a name from git counts when it has two parts, or one of 4 letters or more, accents folded; an unset or shorter one is skipped (made-up names only)', () => {
    expect([asOwner('Ada Example\n'), asOwner('Abcd'), asOwner('Al Bo'), asOwner('Max'), asOwner('Lab'), asOwner('  Ab \n'), asOwner(''), asOwner('Zoë Ünder')]).toEqual([
      'Ada Example', 'Abcd', 'Al Bo', undefined, undefined, undefined, undefined, 'Zoe Under',
    ]);
  });

  it("the owner's name: whole words, any case, accents folded on both sides — no code word (made-up names only)", () => {
    const named = (name: string, line: string) => rulesHitting([{ what: 'owner', re: ownerRe(asOwner(name) ?? '') }], line, NOTE_PATH).length > 0;
    expect(named('Zoë Ünder', 'by Zoe Under')).toBe(true);
    expect(named('Zoe Under', 'by ZOË  ÜNDER.')).toBe(true);
    expect(named('Zoë Ünder', 'zoeunder, Zoe Underhill, Zoe')).toBe(false);
    expect(named('Maxi', 'maxiScroll, maximum, Maxi1, setMaxi')).toBe(false);
    expect(named('Maxi', 'asked Maxi.')).toBe(true);
  });

  it.runIf(OWNER !== undefined)("the owner's name, read from git at run time, is caught in any case, accented or not", () => {
    const name = OWNER_AS_GIVEN ?? '';
    const hit = (line: string) => rulesHitting(PATH_RULES, line, NOTE_PATH);
    expect(hit(`by ${name}`)).toContain(OWNER_RULE);
    expect(hit(`by ${name.toUpperCase()}`)).toContain(OWNER_RULE);
    expect(hit(`by ${folded(name)}`)).toContain(OWNER_RULE);
  });
});

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeOf, logicalLines, wordsOf } from '../helpers/comments.js';

/**
 * The prose of this repo points at its owners by name — `file.ts#symbol`
 * (or `file.ts#Type.member`) and `docs/bugs/<note>.md` — instead of
 * restating their rules. A pointer whose target was renamed, deleted or
 * never written sends the next reader nowhere, and nothing else notices:
 * the compiler does not read comments. This test resolves every such
 * reference in src/, scripts/, tests/, ARCHITECTURE.md, the skill docs and
 * the ADRs (docs/adr/) and names each dangling one — an ADR named by its
 * path (`docs/adr/<n>-<title>.md`) included, and a file named with one of
 * its words (`path.ts's camelName`).
 *
 * A file part resolves when some file under src/, scripts/ or tests/ ends
 * with it (`capture.ts`, `verify/capture.ts` and `src/verify/capture.ts` all
 * name the same file; `../x.ts` is taken from where it is written); a symbol
 * resolves when one of those files declares its first segment and every
 * further segment inside that declaration. A bug note
 * resolves when git tracks it — a note that exists only in one checkout is
 * as dangling as a missing one for everyone else.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * Bug notes the source cites that git does not track yet: exactly these paths are let through, and a NEW untracked
 * reference still fails. Remove a line once its note is tracked (the test then says so) or its references are gone.
 */
const UNDECIDED_BUG_NOTES: ReadonlySet<string> = new Set<string>([]);

const filesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });

const SRC = filesUnder('src').filter((f) => f.endsWith('.ts'));
const TESTS = filesUnder('tests').filter((f) => f.endsWith('.ts'));
const SCRIPTS = filesUnder('scripts').filter((f) => f.endsWith('.ts'));
// The scripts' and the tests' prose too, except this file's own, whose examples (`a.ts#x`) name nothing.
const PROSE = [...SRC, ...SCRIPTS, ...TESTS.filter((f) => f !== 'tests/docs/references.test.ts'), 'ARCHITECTURE.md', ...filesUnder('skill').filter((f) => f.endsWith('.md')), ...filesUnder('docs/adr').filter((f) => f.endsWith('.md'))];

const text = new Map<string, string>();
const read = (file: string): string => {
  let t = text.get(file);
  if (t === undefined) text.set(file, (t = readFileSync(join(ROOT, file), 'utf8')));
  return t;
};

const escape = (s: string): string => s.replace(/[$]/g, '\\$');
/** A member (method, property, field, object-literal key) declared at the start of its line. */
const MEMBER = (name: string): string => `^\\s*(?:(?:private|protected|public|static|readonly|async|get|set|override)\\s+)*\\*?${escape(name)}\\??\\s*[(:<=]`;
/** Where `source` declares `name` — top level, re-exported, or a member at the start of its line — or -1. */
const declaredAt = (source: string, name: string): number =>
  source.search(
    new RegExp(
      `\\b(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${escape(name)}\\b` + `|export\\s*\\{[^}]*\\b${escape(name)}\\b` + `|${MEMBER(name)}`,
      'm',
    ),
  );
/** A member of a one-line object (`EXIT = { ok: 0, nothingDone: 2 }`): a key after a `{` or a `,` on the declaration's own line. */
const inFirstLine = (body: string, name: string): boolean => new RegExp(`[{,]\\s*${escape(name)}\\??\\s*:`).test(body.split('\n')[0]);

/**
 * `source` with its import statements blanked (same length, so offsets hold):
 * `import { type X } from …` names X, it does not declare it.
 */
const withoutImports = (source: string): string => source.replace(/^import\b[^;]*;/gm, (m) => m.replace(/[^\n]/g, ' '));

/**
 * A reference into tests/ resolves against the tests, any other against src/ — and, written in a test (`from`), against
 * the tests and the scripts too (a test's prose names its siblings by their bare names, `scroll.test.ts#wdaForm`,
 * `rounds.ts#treeOf`, and the scripts it tests, `golden.ts#…`).
 */
function resolves(file: string, symbol: string, from: string): boolean {
  const [head, ...members] = symbol.split('.');
  const pool = file.startsWith('tests/') ? TESTS : from.startsWith('tests/') || from.startsWith('scripts/') ? [...SRC, ...TESTS, ...SCRIPTS] : SRC;
  const names = owners(file, from);
  // Each member is declared inside what it is a member of: after it, before the next top-level declaration.
  return pool.some((f) => {
    if (!names(f)) return false;
    const source = withoutImports(read(f));
    const at = declaredAt(source, head);
    if (at < 0) return false;
    const rest = source.slice(at);
    const end = rest.slice(1).search(/^(?:export\s|function\s|const\s|let\s|class\s|interface\s|type\s)/m);
    const body = end < 0 ? rest : rest.slice(0, end + 1);
    return members.every((m) => declaredAt(body, m) >= 0 || inFirstLine(body, m));
  });
}

/** Whether a file is the one a pointer's file part names, written in `from`: `../x.ts` from where it is written, else by its tail. */
const owners = (file: string, from: string) => {
  if (file.startsWith('../') || file.startsWith('./')) {
    const exact = normalize(join(dirname(from), file));
    return (f: string) => f === exact;
  }
  return (f: string) => f === file || f.endsWith(`/${file}`);
};

/** A name after a file's possessive: camelCase or PascalCase with an inner word — an acronym (iOS, WDA) or a plain word is none. */
const CAMEL = /^(?:[a-z]+|[A-Z][a-z]+)[A-Z][\w$]*$/;
const camelName = (name: string): boolean => CAMEL.test(name) && /.[A-Z][a-z]/.test(name);

/**
 * The possessives in a line of `from` that name nothing: `path.ts's camelName` whose file is no source of src/,
 * scripts/ or tests/, or whose code (strings included) holds no such word.
 */
function possessivesIn(text: string, from: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([\w./-]+\.m?ts)(?:'s|’s) ([A-Za-z_$][\w$]*)/g)) {
    const [, file, name] = m;
    if (!camelName(name)) continue;
    const names = owners(file, from);
    const found = [...SRC, ...SCRIPTS, ...TESTS].filter(names);
    if (!found.some((f) => wordsIn(f).has(name))) out.push(`${file}'s ${name}`);
  }
  return out;
}

const words = new Map<string, Set<string>>();
/** A source's code words (comments blanked, strings kept), read once. */
const wordsIn = (file: string): Set<string> => {
  let w = words.get(file);
  if (w === undefined) words.set(file, (w = wordsOf(codeOf(file, read(file)))));
  return w;
};

/** Every reference in the prose, with where it starts. */
function references(pattern: RegExp): { where: string; ref: string; groups: string[] }[] {
  return PROSE.flatMap((file) =>
    logicalLines(read(file)).flatMap(({ line, text }) => [...text.matchAll(pattern)].map((m) => ({ where: `${file}:${line}`, ref: m[0], groups: m.slice(1) }))),
  );
}

describe('how a reference resolves', () => {
  it('a pointer written in scripts/ resolves against src/, scripts/ and tests/, `../` taken from where it is written', () => {
    expect(resolves('../rejudge-failures.ts', 'failuresOf', 'scripts/truth/batch/standing.ts')).toBe(true);
    expect(resolves('scripts/truth/lab-device.ts', 'FocusRead', 'scripts/truth/live-cases.ts')).toBe(true);
    expect(resolves('../rejudge-failures.ts', 'failuresOf', 'scripts/truth/batch/deeper/x.ts')).toBe(false);
  });

  it('a member of a one-line object resolves (`EXIT.nothingDone`); one it does not hold, or a name its file does not declare, does not', () => {
    expect(resolves('words.ts', 'EXIT.nothingDone', 'scripts/truth/batch/select.ts')).toBe(true);
    expect(resolves('words.ts', 'EXIT.nothingMuch', 'scripts/truth/batch/select.ts')).toBe(false);
    expect(resolves('live-chooser.ts', 'FocusRead', 'scripts/truth/live-cases.ts')).toBe(false);
  });

  it("`path.ts's camelName` names a file that exists and a word its code holds; an acronym or a plain word after it is no name", () => {
    const from = 'src/adapters/simulator-reboot.ts';
    expect(possessivesIn("(run/app-health.ts's appAlive: unknown line", from)).toEqual([]);
    expect(possessivesIn("lab-run.ts's iOS counterpart, baseline.ts's WDA run, live.ts's own groups", from)).toEqual([]);
    expect(possessivesIn("run/app-health.ts's appGone line", from)).toEqual(["run/app-health.ts's appGone"]);
    expect(possessivesIn("run/no-such-file.ts's appAlive line", from)).toEqual(["run/no-such-file.ts's appAlive"]);
  });
});

describe('references in the prose', () => {
  it('every file.ts#symbol names a symbol its file declares — and every bare #symbol continuing a list after one (`a.ts#x`, `#y`)', () => {
    // A trailing dot ends the sentence, not the symbol. A bare `#y` resolves against the last file named before it on its line;
    // one after `](` or `(` is an anchor or an aside, and one with no file before it on the line is not a reference.
    const dangling = PROSE.flatMap((file) =>
      logicalLines(read(file)).flatMap(({ line, text }) => {
        let last: string | undefined;
        const out: string[] = [];
        for (const m of text.matchAll(/([\w./-]+\.ts)?(?<![\w\]]\(|\])#([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g)) {
          const bare = m[1] === undefined;
          if (bare && (last === undefined || !/[\s`/,]/.test(text[m.index - 1] ?? ''))) continue;
          const owner = m[1] ?? last!;
          last = owner;
          if (!resolves(owner, m[2], file)) out.push(`${file}:${line}  ${bare ? `${owner} … ${m[0]}` : m[0]}`);
        }
        return out;
      }),
    );
    expect(dangling).toEqual([]);
  });

  it("every `path.ts's camelName` names a file that exists and a word of its code", () => {
    const dangling = PROSE.flatMap((file) => logicalLines(read(file)).flatMap(({ line, text }) => possessivesIn(text, file).map((p) => `${file}:${line}  ${p}`)));
    expect(dangling).toEqual([]);
  });

  it('every docs/bugs note is tracked by git', () => {
    const tracked = new Set(execFileSync('git', ['ls-files', 'docs/bugs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean));
    const cited = references(/docs\/bugs\/[\w.-]+?\.md/g);
    const dangling = cited.filter(({ ref }) => !tracked.has(ref) && !UNDECIDED_BUG_NOTES.has(ref)).map(({ where, ref }) => `${where}  ${ref}`);
    expect(dangling).toEqual([]);
    // An allow-listed note that is tracked now, or cited nowhere, is a stale line.
    const stale = [...UNDECIDED_BUG_NOTES].filter((note) => tracked.has(note) || !cited.some(({ ref }) => ref === note));
    expect(stale).toEqual([]);
  });

  it('every docs/adr record named exists', () => {
    const records = new Set(filesUnder('docs/adr'));
    const dangling = references(/docs\/adr\/[\w.-]+?\.md/g).filter(({ ref }) => !records.has(ref)).map(({ where, ref }) => `${where}  ${ref}`);
    expect(dangling).toEqual([]);
  });
});

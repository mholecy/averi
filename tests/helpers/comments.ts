import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * What the comment guards (tests/docs/comments.test.ts, references.test.ts) read: the comments and test titles of
 * src/, scripts/ and tests/, as the TypeScript parser finds them, and the words their code is made of. Read once per
 * worker (corpus).
 */

/** The averi checkout's root. */
export const ROOT = join(import.meta.dirname, '..', '..');

/** A line of prose: where it starts (1-based) and its text. */
export interface Line {
  file: string;
  line: number;
  text: string;
}

/** A comment line's lead: the indent, the `/**`, `/*`, `*` or `//`, the space after. */
const LEAD = /^\s*(?:\/\*\*?|\*(?!\/)|\/\/+)?\s*/;

/**
 * A line wrapped onto the next: a path cut at a hyphen or a slash (`docs/bugs/2026-10-09-` / `android-…md`, `scroll-` /
 * `rounds.ts#…`) or before its extension (`tests/verify/baseline-confirmation` / `.test.ts`), or a pointer cut after
 * its file (`scroll-read.ts` / `#judgeRead`, or `scroll-read.ts#` / `judgeRead`). Any line ending in a slash joins,
 * a bare root too: `src/` at a line's end and `are` on the next read `src/are`, so prose keeps a root off a line's end.
 */
const wrapped = (text: string, next: string): boolean => {
  const rest = next.replace(LEAD, '');
  return /[\w.#/-][-/]$|\.ts#$/.test(text) || (/\.ts$/.test(text) && rest.startsWith('#')) || (/\/[\w-]+$/.test(text) && /^\.(?:test\.)?m?ts\b/.test(rest));
};

/**
 * A text's lines, a wrapped one (see wrapped) joined to its continuation with the continuation's lead dropped, each
 * numbered by the line it starts on.
 */
export function logicalLines(source: string): { line: number; text: string }[] {
  const lines = source.split('\n');
  const out: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let text = lines[i];
    while (i + 1 < lines.length && wrapped(text, lines[i + 1])) text += lines[++i].replace(LEAD, '');
    out.push({ line: start + 1, text });
  }
  return out;
}

const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

/** Every comment of a source, once each, in order: the leading and trailing ranges around every node and token. */
function commentRanges(sf: ts.SourceFile): ts.CommentRange[] {
  const text = sf.text;
  const seen = new Map<number, ts.CommentRange>();
  const add = (pos: number) => {
    for (const r of ts.getLeadingCommentRanges(text, pos) ?? []) seen.set(r.pos, r);
    for (const r of ts.getTrailingCommentRanges(text, pos) ?? []) seen.set(r.pos, r);
  };
  const visit = (n: ts.Node) => {
    add(n.pos);
    add(n.end);
    for (const c of n.getChildren(sf)) visit(c);
  };
  add(0);
  visit(sf);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * A source's comment lines, lead and closing `*\/` dropped, a wrapped line (see wrapped) joined to its continuation in
 * the same comment; blank lines left out.
 */
export const commentsOf = (file: string, source: string): Line[] => {
  const sf = parse(file, source);
  return commentLines(file, sf, commentRanges(sf));
};

function commentLines(file: string, sf: ts.SourceFile, ranges: readonly ts.CommentRange[]): Line[] {
  const source = sf.text;
  return ranges.flatMap((r) => {
    const first = sf.getLineAndCharacterOfPosition(r.pos).line + 1;
    const body = source
      .slice(r.pos, r.end)
      .split('\n')
      .map((l) => l.replace(LEAD, '').replace(/\s*\*\/\s*$/, ''))
      .join('\n');
    return logicalLines(body)
      .filter(({ text }) => text.trim() !== '')
      .map(({ line, text }) => ({ file, line: first + line - 1, text }));
  });
}

/**
 * A source with its comments and its test titles blanked (same length, line breaks kept): its code and strings. A
 * title is prose, so its words hold up no backticked name — its own least of all.
 */
export const codeOf = (file: string, source: string): string => {
  const sf = parse(file, source);
  return blanked(source, [...commentRanges(sf), ...titleNodes(sf).map(({ node }) => ({ pos: node.getStart(sf), end: node.end }))]);
};

function blanked(source: string, ranges: readonly { pos: number; end: number }[]): string {
  let out = '';
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.pos - b.pos)) {
    if (r.pos < at) continue;
    out += source.slice(at, r.pos) + source.slice(r.pos, r.end).replace(/[^\n]/g, ' ');
    at = r.end;
  }
  return out + source.slice(at);
}

const TEST_CALL = /^(?:describe|it|test)(?:\.(?:skip|only|todo|concurrent|sequential|fails|runIf\(.*\)|skipIf\(.*\)))*$/s;
const isText = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
/** A title's text: a string's value, a template's source between its backticks. */
const titleText = (n: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression, sf: ts.SourceFile): string =>
  ts.isTemplateExpression(n) ? n.getText(sf).slice(1, -1) : n.text;

/**
 * A test file's titles: the first argument of describe/it/test (and their .skip, .only, …), and of `X.each(rows)(title)`
 * the title and each inline row's first string (a row's title part, `%s`), each at the line it starts on.
 */
export const titlesOf = (file: string, source: string): Line[] =>
  titlesIn(file, parse(file, source));

const titlesIn = (file: string, sf: ts.SourceFile): Line[] =>
  titleNodes(sf).map(({ node, text }) => ({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text }));

/** The title literals of a source (titlesOf), each with its text. */
function titleNodes(sf: ts.SourceFile): { node: ts.Node; text: string }[] {
  const out: { node: ts.Node; text: string }[] = [];
  const at = (node: ts.Node, text: string) => out.push({ node, text });
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments[0] && isText(n.arguments[0])) {
      const callee = n.expression;
      if (TEST_CALL.test(callee.getText(sf))) at(n.arguments[0], titleText(n.arguments[0], sf));
      else if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'each' && TEST_CALL.test(callee.expression.expression.getText(sf))) {
        at(n.arguments[0], titleText(n.arguments[0], sf));
        const rows = callee.arguments[0];
        if (rows && ts.isArrayLiteralExpression(rows))
          for (const row of rows.elements) {
            const first = ts.isArrayLiteralExpression(row) ? row.elements[0] : row;
            if (first && isText(first)) at(first, titleText(first, sf));
          }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The words of a text: identifiers, and the words after an escape (`\nappAlive:` holds appAlive). */
export function wordsOf(text: string, into = new Set<string>()): Set<string> {
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) into.add(m[0]);
  for (const m of text.replace(/\\[nrtv]/g, ' ').matchAll(/[A-Za-z_$][\w$]*/g)) into.add(m[0]);
  return into;
}

/** The checkout's files: what git tracks, and what it would (untracked, not ignored). */
export const repoFiles = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);

export interface Corpus {
  /** The checkout's files (repoFiles). */
  files: readonly string[];
  /** The .ts and .mts sources of src/, scripts/ and tests/. */
  sources: readonly string[];
  comments: readonly Line[];
  titles: readonly Line[];
  /** Each source's code words: its code (codeOf, strings kept) read by wordsOf. */
  codeWords: ReadonlyMap<string, ReadonlySet<string>>;
  /** The words of tests/fixtures/ and fixtures/ (their text files). */
  fixtureWords: ReadonlySet<string>;
}

/** A fixture file worth reading for words: a text file. */
const textFixture = (f: string) => /^(?:tests\/)?fixtures\//.test(f) && !/\.(?:png|jpe?g|gif|jar|webp|ico|keystore|zip)$/i.test(f);

let cached: Corpus | undefined;

/** The checkout's comments, titles and code words, read once per worker. */
export function corpus(): Corpus {
  if (cached) return cached;
  const files = repoFiles();
  const sources = files.filter((f) => /^(?:src|scripts|tests)\//.test(f) && /\.m?ts$/.test(f));
  const comments: Line[] = [];
  const titles: Line[] = [];
  const codeWords = new Map<string, Set<string>>();
  const fixtureWords = new Set<string>();
  for (const f of sources) {
    const source = readFileSync(join(ROOT, f), 'utf8');
    const sf = parse(f, source);
    const ranges = commentRanges(sf);
    const named = titleNodes(sf);
    comments.push(...commentLines(f, sf, ranges));
    if (f.startsWith('tests/')) titles.push(...titlesIn(f, sf));
    codeWords.set(f, wordsOf(blanked(source, [...ranges, ...named.map(({ node }) => ({ pos: node.getStart(sf), end: node.end }))])));
  }
  for (const f of files.filter(textFixture)) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    if (!text.includes('\0')) wordsOf(text, fixtureWords);
  }
  return (cached = { files, sources, comments, titles, codeWords, fixtureWords });
}

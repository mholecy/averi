import { describe, expect, it } from 'vitest';
import { codeOf, commentsOf, corpus, titlesOf, wordsOf, type Line } from '../helpers/comments.js';

/**
 * The comments and test titles of src/, scripts/ and tests/ say nothing a machine can see is false: no path to a file
 * that is not there, no line number, no backticked name that no code holds, no bare review label or caller list. Each
 * rule below names its hits as `file:line  rule  fragment`; a fix rewords the comment, never the rule.
 * Not checked, on purpose: whether the prose is true, history told as today ("no longer", "the old"), how many callers
 * a name has (those need a reader), and titles held in variables or `.each(table)` rows not written inline.
 */

/** What a rule reads a line against: the checkout's files and directories, and the words its code is made of. */
interface Ctx {
  files: ReadonlySet<string>;
  /** Every file's tails after a slash (`verify/capture.ts`, `capture.ts`): what a bare name may be. */
  tails: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
  sorted: readonly string[];
  words: ReadonlySet<string>;
}

const ctxOf = (files: readonly string[], words: ReadonlySet<string>): Ctx => {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const tails = new Set<string>();
  for (const f of files) for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) tails.add(f.slice(i + 1));
  return { files: new Set(files), tails, dirs, sorted: [...files, ...dirs].sort(), words };
};

/** Whether some file or directory of the checkout starts with `prefix`. */
const startsSome = (ctx: Ctx, prefix: string): boolean => {
  let lo = 0;
  let hi = ctx.sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo < ctx.sorted.length && ctx.sorted[lo].startsWith(prefix);
};

const MINIATURE = 'a file of the miniature checkout tests/truth/side-cache.test.ts writes to a temporary folder';
/**
 * Paths not in this checkout that its comments and titles name on purpose: the superrepo's scripts the parity code
 * ports, a batch kept with its evidence, the folder a release makes, a test's made-up checkout. An entry nothing
 * names any more, or that the checkout holds now, is a stale line.
 */
const OUT_OF_REPO: ReadonlyMap<string, string> = new Map([
  ['scripts/color-parity.py', "the superrepo's colour math, which src/verify/color-parity.ts and ciede2000.ts port"],
  ['scripts/rect-parity.py', "the superrepo's rect parity, which src/verify/rect-parity.ts ports"],
  ['batch-13.ts', 'a lab batch kept with its evidence, outside the repo (scripts/truth/batch/runner.ts says so)'],
  ['docs/releases', "the release records' folder, which the first release makes (docs/release.md)"],
  ['src/a.ts', MINIATURE],
  ['src/a2.ts', MINIATURE],
  ['src/b.ts', MINIATURE],
  ['src/c.ts', MINIATURE],
  ['tests/fixtures/truth/cell.json', MINIATURE],
  ['tests/fixtures/dumpsys.txt', MINIATURE],
]);

const ROOTS = 'src|scripts|tests|docs|fixtures|skill';
/** A path under one of the roots, and what follows it when it is a pattern: a glob, a brace list, a placeholder. */
const ROOTED = new RegExp(`(?<![\\w./@-])((?:${ROOTS})/[\\w./@-]*[\\w@])([.-]?[*{<…])?`, 'g');
/** A .ts or .mts name with no root, after nothing that makes it a pattern (`<family>.known.ts`, `draw-order*.test.ts`). */
const BARE_TS = new RegExp(`(?<![\\w./@<>*{}…-])((?:[\\w-]+/)*[\\w.-]+\\.m?ts)(?![\\w/])`, 'g');

/** (a) A path that names no file or directory of the checkout. */
function missingPaths(text: string, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ROOTED)) {
    const [, p, pattern] = m;
    if (ctx.files.has(p) || ctx.dirs.has(p) || OUT_OF_REPO.has(p)) continue;
    // A pattern's head, or a record named by its number (`docs/adr/0044`): some path starts with it.
    if (pattern !== undefined ? startsSome(ctx, p) : startsSome(ctx, `${p}-`)) continue;
    if (p.endsWith('.js') && ctx.files.has(p.replace(/\.js$/, '.ts'))) continue;
    out.push(p);
  }
  for (const m of text.matchAll(BARE_TS)) {
    const p = m[1];
    if (new RegExp(`^(?:${ROOTS})/`).test(p) || OUT_OF_REPO.has(p)) continue;
    if (ctx.files.has(p) || ctx.tails.has(p)) continue;
    out.push(p);
  }
  return out;
}

const SOURCE_EXT = 'm?ts|tsx|m?js|md|kts?|swift|json|sh|ya?ml|py|java|cpp|xml|txt';
/** (b) A pointer at a line: `file.ts:120`, `#L12`, "line 40 of x.ts". */
function linePointers(text: string): string[] {
  return [
    ...text.matchAll(new RegExp(`\\b[\\w./-]+\\.(?:${SOURCE_EXT}):\\d+\\b`, 'g')),
    ...text.matchAll(/#L\d+\b/g),
    ...text.matchAll(new RegExp(`\\blines? \\d+(?:[-–]\\d+)? of [\\w./-]+\\.(?:${SOURCE_EXT})\\b`, 'gi')),
  ].map((m) => m[0]);
}

/**
 * Names the comments cite in backticks that no code of this repo holds, by where they come from. An entry the code
 * holds now, or that no comment cites any more, is a stale line.
 */
const EXTERNAL_NAMES: readonly { origin: string; why: string; names: readonly string[] }[] = [
  {
    origin: 'Android SDK and Jetpack',
    why: "the platform code a dump's shape comes from, cited where averi reads it",
    names: [
      'textAllCaps',
      'ViewGroup.ViewLocationHolder.compareBoundsOfTree',
      'ViewGroup.addChildrenForAccessibility',
      'addChildrenForAccessibility',
      'onInitializeAccessibilityNodeInfoInternal',
      'BottomSheetDialogFragment',
      'KeyCharacterMap.getEvents',
      'Popup',
      'touchBoundsInRoot',
      'reverseLayout',
    ],
  },
  { origin: 'adb', why: 'its quoting and its device states, which averi parses or mirrors', names: ['escape_arg', 'authorizing', 'connecting'] },
  { origin: 'Apple: UIKit, CoreGraphics, the simulator runtime, WebDriverAgent', why: 'what an iOS reading or a WDA call is made of', names: ['CGImage', 'df', 'inputAccessoryView', 'keyboardDismissMode', 'onDrag', 'keyNames', 'fb_activeApplication'] },
  { origin: 'Python and fb-idb', why: "the interpreter and the CLI averi's idb helper runs inside", names: ['PYTHONPATH', 'PYTHONSAFEPATH', 'prog', 'video'] },
  { origin: 'React Native', why: 'the props and roles a React Native screen is built with', names: ['absoluteFill', 'tablist'] },
  { origin: 'TypeScript', why: 'a compiler option, which tsconfig.json holds and no code does', names: ['rootDir'] },
  { origin: 'JavaScript', why: "an object's built-in key, named where a lookup must not inherit it", names: ['__proto__'] },
  { origin: 'the MCP protocol', why: "the handshake's field the server's version is reported in", names: ['serverInfo', 'serverInfo.version'] },
  { origin: 'made-up examples', why: "an identifier and a reading a comment makes up to show a rule's edge", names: ['error_iban', 'aba'] },
  {
    origin: "the client app's ids and its device checks",
    why: 'the measured screens, backend replies and checks a finding was made on (docs/bugs/)',
    names: ['invalid_grant', 'credit_select', 'user_settings.overview', 'base.color4', 'goto_payment_type_chooser', 'CompanyAcme', 'title_then_submit'],
  },
  { origin: "averi's own records", why: 'a heading quoted from docs/adr/0016, naming the method that ADR deleted', names: ['shadowing'] },
];

const EXTERNAL: ReadonlySet<string> = new Set(EXTERNAL_NAMES.flatMap((g) => g.names));
/** A backticked identifier, dotted or not, its call parentheses dropped. */
const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** The platforms whose possessive owns the backticked name after it — UIKit's `UIScrollView`, Material's, an RN Pressable's: their names are theirs. */
const PLATFORM_OWNERS = ['UIKit', 'Material', 'Pressable'];
const PLATFORM_POSSESSIVE = new RegExp(`\\b(?:${PLATFORM_OWNERS.join('|')})(?:'s|’s) $`);

/** The backticked identifiers of a line, but those a platform's possessive owns (PLATFORM_OWNERS) and values with spaces. */
function backticked(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    // A value with its spaces (`Jan `) is text, not a name.
    const name = m[1].replace(/\(\)$/, '');
    if (!IDENT.test(name)) continue;
    if (PLATFORM_POSSESSIVE.test(text.slice(0, m.index))) continue;
    out.push(name);
  }
  return out;
}

/** (c) A backticked identifier that no code holds (every dotted part a code word), and no reviewed outside name. */
const unknownNames = (text: string, ctx: Ctx): string[] =>
  backticked(text).filter((name) => !EXTERNAL.has(name) && !name.split('.').every((part) => ctx.words.has(part)));

const REVIEW_LABELS = [/\breview round \d+\b/gi, /\bcode[- ]review\b/gi, /\b(?:BLOCKER|MAJOR|MINOR|NIT)-\d+\b/g, /\ba review found\b/gi, /\bthe reviewer(?:'s|’s)/gi];
/** An id that a review label may follow: a backlog or decision id (D18, A53, T7b), an ADR, a lab id. */
const OWNED = /(?:\b[A-Z]{1,3}\d+[a-z]?\d*(?:'s|’s)?|\bADR \d{4}|\blab [\w-]+(?:'s|’s)?|\bround \d+(?:'s|’s))[\s,(]*$/;
const CALLER_PHRASES = [/\b(?:the|its) (?:one|only|sole) (?:reader|writer|producer|caller)s?\b/gi, /\b(?:used|called) (?:only )?by\b/gi];

/** (d) A review label no id owns, or a sentence about who calls what. */
const reviewLabels = (text: string): string[] =>
  REVIEW_LABELS.flatMap((re) =>
    [...text.matchAll(re)].filter((m) => !OWNED.test(text.slice(0, m.index))).map((m) => m[0]),
  );
const callerPhrases = (text: string): string[] => CALLER_PHRASES.flatMap((re) => [...text.matchAll(re)].map((m) => m[0]));

/**
 * The list entries no longer needed: an OUT_OF_REPO path nothing cites or the checkout holds (a file or a folder), an
 * EXTERNAL_NAMES name no backtick cites or the code holds.
 */
function staleEntries(prose: readonly Line[], ctx: Ctx): string[] {
  const cited = (s: string) => prose.some((l) => l.text.includes(s));
  const staleOut = [...OUT_OF_REPO.keys()].filter((p) => !cited(p) || ctx.files.has(p) || ctx.dirs.has(p));
  const staleNames = [...EXTERNAL].filter((n) => !prose.some((l) => backticked(l.text).includes(n)) || n.split('.').every((part) => ctx.words.has(part)));
  return [...staleOut, ...staleNames];
}

/** The guard's own files: their examples name nothing on purpose; the pins below hold them. */
const GUARD = new Set(['tests/docs/comments.test.ts', 'tests/docs/references.test.ts', 'tests/helpers/comments.ts']);

const hits = (lines: readonly Line[], rule: string, find: (text: string) => string[]): string[] =>
  lines.filter((l) => !GUARD.has(l.file)).flatMap((l) => find(l.text).map((f) => `${l.file}:${l.line}  ${rule}  ${f}`));

const PIN_CTX = ctxOf(
  ['src/verify/capture.ts', 'docs/adr/0044-a-case-declares-its-reads.md', 'tests/fixtures/truth/ios/blur-menu.idb.json', 'tests/differential/golden/base.known.ts', 'src/util/sleep.ts'],
  new Set(['clipThenInset', 'Modifier', 'clickable', 'appAlive']),
);

describe('what the guard reads', () => {
  it('every comment once — a trailing one and one alone in a block included — its lead dropped, a path wrapped before its extension joined', () => {
    const source = ['/** Head, see tests/verify/baseline-confirmation', ' * .test.ts too. */', 'const a = 1; // trailing', 'try {', '  a;', '} catch {', '  // alone', '}', "const s = '// not a comment';"].join('\n');
    expect(commentsOf('x.ts', source).map(({ line, text }) => `${line} ${text}`)).toEqual(['1 Head, see tests/verify/baseline-confirmation.test.ts too.', '3 trailing', '7 alone']);
  });

  it("the titles: describe, it and test, and of X.each its title and each inline row's first string", () => {
    const source = ["describe('a group', () => {", "  it.skip('a test', () => {});", '  it.each([', "    ['row one', 1],", "    ['row two', 2],", "  ])('%s: each', () => {});", "  helper('not a title');", '});'].join('\n');
    expect(titlesOf('x.test.ts', source).map(({ line, text }) => `${line} ${text}`)).toEqual(['1 a group', '2 a test', '6 %s: each', '4 row one', '5 row two']);
  });

  it("code words: a string's words kept, a comment's and a test title's not, and the word after an escape", () => {
    const source = "const shown = '\\nappAlive: yes'; // hiddenWord\nit('titleWord', () => shown);\nit.each([['rowWord', 1]])('%s', () => {});";
    const words = wordsOf(codeOf('x.test.ts', source));
    expect([...words].filter((w) => ['shown', 'appAlive', 'yes', 'hiddenWord', 'titleWord', 'rowWord'].includes(w)).sort()).toEqual(['appAlive', 'shown', 'yes']);
  });
});

describe('the comment rules, each on what it names and what it keeps', () => {
  it('(a) a path that is not there is named; a file, a directory, a pattern, a record by its number, a .js import of a .ts, and an outside path on the list are kept', () => {
    expect(missingPaths('see src/verify/capturing.ts and src/are no waits', PIN_CTX)).toEqual(['src/verify/capturing.ts', 'src/are']);
    expect(missingPaths('a bare capturing.ts', PIN_CTX)).toEqual(['capturing.ts']);
    expect(
      missingPaths(
        'src/verify/capture.ts, src/verify/, tests/fixtures/truth/ios/blur-menu.{idb,wda}.json, tests/fixtures/truth/ios/blur-*.json, docs/adr/0044, src/util/sleep.js, tests/differential/golden/<family>.known.ts, capture.ts, scripts/color-parity.py',
        PIN_CTX,
      ),
    ).toEqual([]);
  });

  it('(b) a line pointer is named in each of its forms; a time, a ratio and a symbol pointer are kept', () => {
    expect(linePointers('see capture.ts:120 and live.ts:201-270, README.md#L12, and line 40 of x.ts')).toEqual(['capture.ts:120', 'live.ts:201', '#L12', 'line 40 of x.ts']);
    expect(linePointers('at 12:30, 16:9, capture.ts#clipThenInset, the line 239 of the band')).toEqual([]);
  });

  it("(c) a backticked name no code holds is named; a code word, a dotted chain of them and a platform's possessive are kept", () => {
    expect(unknownNames('its `homeFocus`, `preLen()`', PIN_CTX)).toEqual(['homeFocus', 'preLen']);
    expect(unknownNames("Foo's `madeUpName`, Lab's `otherMadeUp`", PIN_CTX)).toEqual(['madeUpName', 'otherMadeUp']);
    // A title's own words hold nothing up: its unknown name is caught against the file's code.
    const source = "it('reads `noSuchReader` once', () => { clipThenInset(); });";
    const fileCtx = ctxOf([], wordsOf(codeOf('x.test.ts', source)));
    expect(titlesOf('x.test.ts', source).flatMap((t) => unknownNames(t.text, fileCtx))).toEqual(['noSuchReader']);
    expect(unknownNames("`clipThenInset`, `Modifier.clickable`, UIKit's `UIScrollView`, `a value with spaces`, `JJan `", PIN_CTX)).toEqual([]);
  });

  it('a list entry is stale once nothing cites it or the checkout holds it — a file, a folder (docs/releases), a code word', () => {
    const cites: Line[] = [...OUT_OF_REPO.keys(), ...EXTERNAL].map((p, i) => ({ file: 'x.ts', line: i + 1, text: `see ${p} and \`${p}\`` }));
    expect(staleEntries(cites, ctxOf([], new Set()))).toEqual([]);
    expect(staleEntries(cites.slice(1), ctxOf(['docs/releases/v1.0.0.md', 'batch-13.ts'], new Set(['rootDir'])))).toEqual(['scripts/color-parity.py', 'batch-13.ts', 'docs/releases', 'rootDir']);
  });

  it('(d) a bare review label and a caller phrase are named; a label an id owns is kept', () => {
    expect(reviewLabels('Review round 1: the key; a code review; ADR-free MAJOR-2; every pair a review found; the reviewer\'s cover')).toEqual([
      'Review round 1',
      'code review',
      'MAJOR-2',
      'a review found',
      "the reviewer's",
    ]);
    // A determiner owns nothing: a label is bare whatever article it wears.
    expect(reviewLabels("the code review's renames; their review round 4; the code-review renamed it; A3 after its review round 1")).toEqual([
      'review round 4',
      'review round 1',
      'code review',
      'code-review',
    ]);
    expect(reviewLabels("T7b's review round 1 records; ADR 0032 NIT-2; A53's code review; D7b, review round 2; round 7's code review; A3's review round 1")).toEqual([]);
    expect(callerPhrases('launch is its one writer; the only reader; used by run.ts; Used ONLY by the CLI; called by tap')).toEqual([
      'its one writer',
      'the only reader',
      'used by',
      'Used ONLY by',
      'called by',
    ]);
    expect(callerPhrases('the one place it is read; used to be; a reader of it')).toEqual([]);
  });
});

describe('the comments and test titles of src/, scripts/ and tests/', () => {
  const { files, comments, titles, codeWords, fixtureWords } = corpus();
  // The guard's own strings are examples, not code: a name its pins make up holds nothing up.
  const words = new Set(fixtureWords);
  for (const [file, w] of codeWords) if (!GUARD.has(file)) for (const word of w) words.add(word);
  const ctx = ctxOf(files, words);
  const prose = [...comments, ...titles];

  it('(a) name no path that is not there', () => {
    expect(hits(prose, 'path', (t) => missingPaths(t, ctx))).toEqual([]);
  });

  it('(b) point at no line', () => {
    expect(hits(prose, 'line pointer', linePointers)).toEqual([]);
  });

  it('(c) backtick no name that no code holds', () => {
    expect(hits(prose, 'unknown name', (t) => unknownNames(t, ctx))).toEqual([]);
  });

  it('(d) carry no bare review label and no caller phrase', () => {
    expect([...hits(prose, 'review label', reviewLabels), ...hits(prose, 'caller phrase', callerPhrases)]).toEqual([]);
  });

  it('every OUT_OF_REPO and EXTERNAL_NAMES entry is still needed: cited, and not in this repo', () => {
    expect(staleEntries(prose, ctx)).toEqual([]);
  });
});

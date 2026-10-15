import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The prose of this repo points at its owners by name — `file.ts#symbol`
 * (or `file.ts#Type.member`) and `docs/bugs/<note>.md` — instead of
 * restating their rules. A pointer whose target was renamed, deleted or
 * never written sends the next reader nowhere, and nothing else notices:
 * the compiler does not read comments. This test resolves every such
 * reference in src/, ARCHITECTURE.md, the skill docs and the ADRs
 * (docs/adr/) and names each
 * dangling one — an ADR named by its path (`docs/adr/<n>-<title>.md`)
 * included.
 *
 * A file part resolves when some file under src/ or tests/ ends with it
 * (`capture.ts`, `verify/capture.ts` and `src/verify/capture.ts` all name
 * the same file); a symbol resolves when one of those files declares its
 * first segment and mentions every further segment as a word. A bug note
 * resolves when git tracks it — a note that exists only in one checkout is
 * as dangling as a missing one for everyone else.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * Bug notes the source cites that git does not track yet. The owner has not
 * decided whether these notes are committed or the references to them are
 * dropped; until then exactly these paths are let through, and a NEW
 * untracked reference still fails. Remove a line once its note is tracked
 * (the test then says so) or its references are gone.
 */
const UNDECIDED_BUG_NOTES: ReadonlySet<string> = new Set([
  // Untracked in the main checkout; cited by the decision record's amendment "a layer holding an alert".
  'docs/bugs/2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md',
  'docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md',
  'docs/bugs/2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md',
  'docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md',
  'docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md',
  'docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md',
  'docs/bugs/2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md',
  'docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md',
  'docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md',
  'docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md',
  'docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md',
  'docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md',
  'docs/bugs/2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md',
  'docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md',
  'docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md',
  // Tracked on docs/device-check-r5-r12 (5f1996e), not yet on this branch's base; cited by ADR 0018.
  'docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md',
  'docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md',
  // Untracked in the main checkout, not yet on this branch's base; cited by ADR 0018's amendment and residual 9.
  'docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md',
  'docs/bugs/2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md',
  // Untracked in the main checkout, not yet on this branch's base; cited by draw-order's `hidden` row, UiNode.hidden and ADR 0019.
  'docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md',
  // Untracked in the main checkout; cited by ADR 0018's amendment "No stroke onto a presented screen".
  'docs/bugs/2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md',
  // Untracked in the main checkout; cited by ADR 0018's amendment "presented judged of the node" and capture.ts#clipThenInset.
  'docs/bugs/2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md',
  'docs/bugs/2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md',
]);

const filesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });

const SRC = filesUnder('src').filter((f) => f.endsWith('.ts'));
const TESTS = filesUnder('tests').filter((f) => f.endsWith('.ts'));
const PROSE = [...SRC, 'ARCHITECTURE.md', ...filesUnder('skill').filter((f) => f.endsWith('.md')), ...filesUnder('docs/adr').filter((f) => f.endsWith('.md'))];

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

/**
 * `source` with its import statements blanked (same length, so offsets hold):
 * `import { type X } from …` names X, it does not declare it.
 */
const withoutImports = (source: string): string => source.replace(/^import\b[^;]*;/gm, (m) => m.replace(/[^\n]/g, ' '));

/** A reference into tests/ resolves against the tests, any other against src/. */
function resolves(file: string, symbol: string): boolean {
  const [head, ...members] = symbol.split('.');
  const pool = file.startsWith('tests/') ? TESTS : SRC;
  // Each member is declared inside what it is a member of: after it, before the next top-level declaration.
  return pool.some((f) => {
    if (f !== file && !f.endsWith(`/${file}`)) return false;
    const source = withoutImports(read(f));
    const at = declaredAt(source, head);
    if (at < 0) return false;
    const rest = source.slice(at);
    const end = rest.slice(1).search(/^(?:export\s|function\s|const\s|let\s|class\s|interface\s|type\s)/m);
    const body = end < 0 ? rest : rest.slice(0, end + 1);
    return members.every((m) => declaredAt(body, m) >= 0);
  });
}

/** A comment line's lead: the indent, the `*` or `//`, the space after. */
const LEAD = /^\s*(?:\*(?!\/)|\/\/)?\s*/;

/**
 * The prose's lines, a path wrapped at a hyphen or a slash joined back to
 * its continuation (`docs/bugs/2026-10-09-` / ` * android-…md`, `scroll-` /
 * ` * rounds.ts#…`), and a pointer wrapped after its file (`scroll-read.ts`
 * / ` * #judgeRead`, or `scroll-read.ts#` / ` * judgeRead`) — the comment's `*` or `//` dropped — each numbered by
 * the line it starts on.
 */
function logicalLines(file: string): { line: number; text: string }[] {
  const lines = read(file).split('\n');
  const out: { line: number; text: string }[] = [];
  const wrapped = (text: string, next: string): boolean => /[\w.#/-][-/]$|\.ts#$/.test(text) || (/\.ts$/.test(text) && next.replace(LEAD, '').startsWith('#'));
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let text = lines[i];
    while (i + 1 < lines.length && wrapped(text, lines[i + 1])) text += lines[++i].replace(LEAD, '');
    out.push({ line: start + 1, text });
  }
  return out;
}

/** Every reference in the prose, with where it starts. */
function references(pattern: RegExp): { where: string; ref: string; groups: string[] }[] {
  return PROSE.flatMap((file) =>
    logicalLines(file).flatMap(({ line, text }) => [...text.matchAll(pattern)].map((m) => ({ where: `${file}:${line}`, ref: m[0], groups: m.slice(1) }))),
  );
}

describe('references in the prose', () => {
  it('every file.ts#symbol names a symbol its file declares — and every bare #symbol continuing a list after one (`a.ts#x`, `#y`)', () => {
    // A trailing dot ends the sentence, not the symbol. A bare `#y` resolves against the last file named before it on its line;
    // one after `](` or `(` is an anchor or an aside, and one with no file before it on the line is not a reference.
    const dangling = PROSE.flatMap((file) =>
      logicalLines(file).flatMap(({ line, text }) => {
        let last: string | undefined;
        const out: string[] = [];
        for (const m of text.matchAll(/([\w./-]+\.ts)?(?<![\w\]]\(|\])#([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g)) {
          const bare = m[1] === undefined;
          if (bare && (last === undefined || !/[\s`/,]/.test(text[m.index - 1] ?? ''))) continue;
          const owner = m[1] ?? last!;
          last = owner;
          if (!resolves(owner, m[2])) out.push(`${file}:${line}  ${bare ? `${owner} … ${m[0]}` : m[0]}`);
        }
        return out;
      }),
    );
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

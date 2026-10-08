import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { rebootSimulatorAdvice } from '../../src/adapters/simulator-reboot.js';

/**
 * 2026-10-08 (iOS adapter stack review, candidate 2): the simulator reboot
 * command was spelled in three messages, two ways, one of them with a
 * `<udid>` placeholder. simulator-reboot.ts owns it now; this file pins the
 * wording and that no other module under src/ spells the command in its
 * CODE — a new message that needs the reboot calls the builder, or this
 * fails. The call sites themselves are proven by their full-string pins
 * (ios.test.ts, ios-tree-source.test.ts, wda.test.ts), not here.
 *
 * Comments are stripped before matching: a comment that mentions
 * `xcrun simctl boot` advises no one. The match is the TEXT form
 * (`simctl shutdown`, `simctl boot`), so the argv form —
 * `simctl(['shutdown', udid])` — is deliberately not matched: running a
 * command is not advising it.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * The file without its comments, as TypeScript's own printer writes it back
 * with `removeComments` — so a string is a string and a comment is a
 * comment, whatever characters sit around them. Until round 4 (2026-10-08)
 * this was two regexes: block comments, then `//` to the line's end where it
 * started a line or followed whitespace. That kept a comment that follows
 * code with no space (`foo();// …`), which the scan then matched as code,
 * and it cut a line at a ` // ` inside a string (`'a // b'`), so any code
 * after it on that line — a second string spelling the command — was never
 * scanned. The printer re-quotes strings (`'…'` comes back as `"…"`) and,
 * with no parent nodes to read the source text from, escapes non-ASCII
 * (`—` comes back as `\u2014`); the match below never looks at quotes and
 * is ASCII, so a future non-ASCII phrase in it would need the source text.
 */
const withoutComments = (text: string): string =>
  ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile('scan.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));

describe('rebootSimulatorAdvice — the one owner of the simulator reboot hint', () => {
  it('names the bound UDID in both halves of the command, as a code span, as a clause the caller leads into', () => {
    expect(rebootSimulatorAdvice('AAAA-1111')).toBe(
      'reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`)',
    );
  });

  it('the comment stripper keeps code and strings, whatever surrounds a `//`, and drops only comments', () => {
    const scanned = (code: string): boolean => /simctl (shutdown|boot)\b/.test(withoutComments(code));
    // Comments, however they touch the code before them, advise no one.
    expect(scanned("foo();// xcrun simctl boot X\n")).toBe(false);
    expect(scanned('/** xcrun simctl shutdown X */\nexport const a = 1;\n')).toBe(false);
    expect(scanned("const a = 1; /* xcrun simctl boot X */\n")).toBe(false);
    // A `//` or `/*` inside a string is the string's: the code after it is still scanned.
    expect(scanned("const u = 'http://x'; const m = 'xcrun simctl boot X';\n")).toBe(true);
    expect(scanned("const u = 'a // b'; const m = 'xcrun simctl boot X';\n")).toBe(true);
    expect(scanned("const g = 'src/**/*.ts'; const m = 'xcrun simctl boot X'; // */\n")).toBe(true);
    expect(scanned('const m = `see // then xcrun simctl boot ${id}`;\n')).toBe(true);
  });

  it('no other file under src/ spells `simctl shutdown` or `simctl boot` in code — every reboot hint comes from the builder', () => {
    const spellers = sourceFiles(SRC)
      .filter((file) => /simctl (shutdown|boot)\b/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));
    expect(
      spellers,
      'a message under src/ spells the simulator reboot command itself — build it with ' +
        'rebootSimulatorAdvice(udid) from src/adapters/simulator-reboot.ts instead (comments are ignored)',
    ).toEqual(['adapters/simulator-reboot.ts']);
  });
});

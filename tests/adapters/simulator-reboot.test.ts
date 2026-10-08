import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * The file without its comments: block comments, then line comments that
 * start a line or follow whitespace (so `https://…` inside a string stays).
 * Good enough for this repo's sources — not a tokenizer: a `/*` inside a
 * string would eat code, which can only make the scan miss, never trip it.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

describe('rebootSimulatorAdvice — the one owner of the simulator reboot hint', () => {
  it('names the bound UDID in both halves of the command, as a code span, as a clause the caller leads into', () => {
    expect(rebootSimulatorAdvice('AAAA-1111')).toBe(
      'reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`)',
    );
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

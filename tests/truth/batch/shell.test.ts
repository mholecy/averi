import { describe, expect, it } from 'vitest';
import { shellQuote, singleQuoted } from '../../../scripts/truth/batch/shell.js';

// scripts/truth/batch/shell.ts: the batches' one host-shell quoter (A21, TL8) — a word in a hand line a person pastes.

describe('shellQuote — a hand line a person pastes (d43-gate.ts\'s shq, renamed in the T2 S4 code review; one leaf since A21)', () => {
  it('a plain word as given; anything else single-quoted, a quote in it as \'\\\'\'', () => {
    expect(shellQuote('com.apple.Accessibility')).toBe('com.apple.Accessibility');
    expect(shellQuote('a@b%c+d=e:f,g./h-i_9')).toBe('a@b%c+d=e:f,g./h-i_9');
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('x\ny')).toBe("'x\ny'");
  });
});

describe('singleQuoted — a word quoted whatever it holds (run-dir.ts\'s RESTORE line)', () => {
  it('a plain word quoted too; every quote in it as \'\\\'\'', () => {
    expect(singleQuoted('/out/RESTORE.txt')).toBe("'/out/RESTORE.txt'");
    expect(singleQuoted("/o/it's/a'b")).toBe("'/o/it'\\''s/a'\\''b'");
    expect(singleQuoted('')).toBe("''");
  });
});

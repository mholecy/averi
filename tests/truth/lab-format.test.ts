import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The lab apps' field formats (scripts/truth/schema.ts#FieldFormat) as the React Native app spells them
// (fixtures/apps/rn/src/format.ts). Forms.kt#formatted and Forms.swift#formatted spell the same rules, and carry this
// table in their comments: a change to one rule is a change to all three apps and to this table.
//
// The file is transpiled here, not imported: the RN app's tsconfig extends a package only its own node_modules hold
// (the RN README's install), which a checkout of averi alone has not got.
type Format = (format: string | undefined, text: string) => string;
const source = readFileSync(new URL('../../fixtures/apps/rn/src/format.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { formatted } = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as { formatted: Format };

const NBSP = '\u00A0';
const NNBSP = '\u202F';

describe('group4eager (L7, D60): groups of four, and a space as soon as a group is complete, but none at 24 characters', () => {
  it.each([
    ['', ''],
    ['S', 'S'],
    ['SK3', 'SK3'],
    ['SK31', 'SK31 '],
    ['SK31 ', 'SK31 '],
    ['SK311', 'SK31 1'],
    ['SK3112000000', 'SK31 1200 0000 '],
    ['SK3112000000123', 'SK31 1200 0000 123'],
    ['SK31 1200 0000 123', 'SK31 1200 0000 123'],
    [`SK31${NBSP}1200${NNBSP}0000`, 'SK31 1200 0000 '],
    ['SK31120000001234567890', 'SK31 1200 0000 1234 5678 90'],
    ['SK3112000000123456789012', 'SK31 1200 0000 1234 5678 9012'],
    ['SK311200000012345678901234', 'SK31 1200 0000 1234 5678 9012'],
  ])('%j → %j', (typed, shown) => {
    expect(formatted('group4eager', typed)).toBe(shown);
  });

  it('formats its own output to itself: a key typed after the eager space lands in the next group', () => {
    for (const s of ['SK31 ', 'SK31 1200 ', 'SK31 1200 0000 123']) expect(formatted('group4eager', formatted('group4eager', s))).toBe(formatted('group4eager', s));
    expect(formatted('group4eager', `${formatted('group4eager', 'SK31')}1`)).toBe('SK31 1');
  });
});

describe('phone3 (L7, D37 `+421`): a leading `+` kept, digits only, in threes from the left', () => {
  it.each([
    ['', ''],
    ['+', '+'],
    ['+42', '+42'],
    ['+421', '+421'],
    ['+4219', '+421 9'],
    ['421903123456', '421 903 123 456'],
    ['+421903123456', '+421 903 123 456'],
    ['+421 903 123 456', '+421 903 123 456'],
    [' +421903', '+421 903'],
    ['421+903', '421 903'],
    ['+421-903/123', '+421 903 123'],
    ['+4219031234567', '+421 903 123 456 7'],
  ])('%j → %j', (typed, shown) => {
    expect(formatted('phone3', typed)).toBe(shown);
  });
});

describe('the formats before L7 do not move', () => {
  it('group4 adds no eager space; thousands and no format as before', () => {
    expect(formatted('group4', 'SK31')).toBe('SK31');
    expect(formatted('group4', 'SK3112000000')).toBe('SK31 1200 0000');
    expect(formatted('thousands', '1234567,89')).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(formatted(undefined, '+421 903')).toBe('+421 903');
  });
});

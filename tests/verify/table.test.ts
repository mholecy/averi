import { describe, expect, it } from 'vitest';
import { headerWithRule, row, type Column } from '../../src/verify/table.js';

/**
 * The whole purpose of this module is that two tables printed into the same
 * report stay aligned with each other. Alignment is exactly what substring
 * assertions in the formatter tests cannot see, so it is asserted here on
 * whole lines.
 */

const COLUMNS: Column[] = [
  { title: 'anchor', width: 10, align: 'left' },
  { title: 'figma', width: 6 },
  { title: 'android', width: 8 },
];

describe('headerWithRule', () => {
  it('pads each title to its column and rules the full width', () => {
    const [header, rule] = headerWithRule(COLUMNS);
    expect(header).toBe('anchor      figma  android');
    expect(rule).toBe('-'.repeat(header.length));
  });

  it('counts trailing text in the rule — the rule must span the whole header', () => {
    const [header, rule] = headerWithRule(COLUMNS, '  verdict');
    expect(header).toBe('anchor      figma  android  verdict');
    expect(rule.length).toBe(header.length);
  });

  it('defaults a column to right alignment', () => {
    const [header] = headerWithRule([{ title: 'x', width: 4 }]);
    expect(header).toBe('   x');
  });
});

describe('row', () => {
  it('aligns cells under their headers', () => {
    const [header] = headerWithRule(COLUMNS);
    const line = row(COLUMNS, ['card', '345', '948.1']);
    expect(line).toBe('card          345    948.1');
    expect(line.length).toBe(header.length);
    // The right-aligned columns must end where their titles end.
    expect(line.indexOf('345') + 3).toBe(header.indexOf('figma') + 'figma'.length);
  });

  it('appends trailing text outside the column grid', () => {
    expect(row(COLUMNS, ['card', '345', '948.1'], '  <-- ASPECT')).toBe(
      'card          345    948.1  <-- ASPECT',
    );
  });

  it('ends the row at the last supplied cell rather than padding empty columns', () => {
    // The aspect row on a single-platform run supplies no delta cells; the old
    // hand-rolled code ended the line there and this must keep doing so.
    expect(row(COLUMNS, ['card', '345'], '  <-- ASPECT')).toBe('card          345  <-- ASPECT');
  });

  it('separates columns with exactly one space', () => {
    expect(row([{ title: 'a', width: 2 }, { title: 'b', width: 2 }], ['x', 'y'])).toBe(' x  y');
  });
});

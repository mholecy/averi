/**
 * Fixed-width table mechanics for the parity reports: column padding, the
 * header, and the rule under it.
 *
 * Deliberately NOT a reporting framework. The rect and color tables differ in
 * column count, column widths and trailing markers, and their prose sections
 * (MISSING causes, the dispatch-and-re-measure advice) differ word for word —
 * that wording is measured advice earned from specific bugs, not boilerplate,
 * and collapsing it would cost more than it saves. Only the ALIGNMENT is
 * shared, because two tables printed into the same report drifting out of
 * alignment is the failure this prevents.
 */

export interface Column {
  title: string;
  width: number;
  /** Default 'right'. The anchor/id column is the 'left' one. */
  align?: 'left' | 'right';
}

const cell = (text: string, column: Column): string =>
  column.align === 'left' ? text.padEnd(column.width) : text.padStart(column.width);

/** The header line and the `-` rule sized to match it. */
export function headerWithRule(columns: Column[], trailing = ''): [header: string, rule: string] {
  const header = columns.map((c) => cell(c.title, c)).join(' ') + trailing;
  return [header, '-'.repeat(header.length)];
}

/**
 * One data row. `cells` is positional against `columns`, and a SHORT `cells`
 * ends the row there rather than padding out the remaining columns — a row
 * with nothing left to say must not trail whitespace before its marker (the
 * aspect row on a single-platform run supplies no delta cells).
 */
export function row(columns: Column[], cells: string[], trailing = ''): string {
  return cells.map((text, i) => cell(text, columns[i])).join(' ') + trailing;
}

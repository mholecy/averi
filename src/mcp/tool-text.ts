/**
 * The one-line responses of the tap and type_text tools, as pure functions.
 *
 * They are here rather than inline in server.ts because server.ts connects a
 * transport at module load and cannot be imported by a test — and these lines
 * carry information the agent acts on: the resolution note (which of several
 * nodes was tapped) and the fill warning (a masked field that already held
 * text). A regression that dropped either would otherwise be invisible to
 * every test in the repo (review 2026-10-03).
 */

/** `Tapped <selector>`, with the resolution note in parentheses when there was one. */
export const tapText = (selector: string, note: string | undefined): string =>
  `Tapped ${selector}${note ? ` (${note})` : ''}`;

/**
 * `Filled <selector> (N characters[, cleared first])[ (note)]`, and on its own
 * line below, `⚠ <warning>` when the fill was legal but suspicious. The
 * warning gets a line of its own so it is not lost inside the parentheses.
 */
export const fillText = (
  selector: string,
  length: number,
  cleared: boolean,
  note: string | undefined,
  warning: string | undefined,
): string =>
  `Filled ${selector} (${length} characters${cleared ? ', cleared first' : ''})${note ? ` (${note})` : ''}` +
  (warning ? `\n⚠ ${warning}` : '');

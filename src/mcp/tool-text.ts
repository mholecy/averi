/**
 * The one-line responses of the tap, type_text and launch_app tools, as pure functions.
 *
 * They are here rather than inline in server.ts because server.ts connects a
 * transport at module load and cannot be imported by a test — and these lines
 * carry information the agent acts on: the resolution note (which of several
 * nodes was tapped) and the fill warning (a masked field that already held
 * text). A regression that dropped either would otherwise be invisible to
 * every test in the repo (review 2026-10-03).
 *
 * 2026-10-03, later the same day: the reason above no longer holds — the
 * handlers moved to mcp/tools.ts, which is importable and tested through an
 * in-memory transport. The functions stay here anyway: they are pure, and
 * tool-text.test.ts pins every wording variant (note, warning, cleared)
 * without building a server, a registry or a fake device to provoke each one.
 */

import type { Platform } from '../adapters/types.js';
import type { FillResult } from '../interact/fill.js';

/** `Tapped <selector>`, with the resolution note in parentheses when there was one. */
export const tapText = (selector: string, note: string | undefined): string =>
  `Tapped ${selector}${note ? ` (${note})` : ''}`;

/**
 * `Filled <selector> (N characters[, cleared first])[ (note)]`, and on its own
 * line below, `⚠ <warning>` when the fill was legal but suspicious. The
 * warning gets a line of its own so it is not lost inside the parentheses.
 * Takes the fill's own result spread in, so the tool never passes two
 * `undefined`s positionally (review 2026-10-03, C2 shape).
 */
export const fillText = (
  selector: string,
  fill: { length: number; cleared: boolean } & FillResult,
): string =>
  `Filled ${selector} (${fill.length} characters${fill.cleared ? ', cleared first' : ''})${fill.note ? ` (${fill.note})` : ''}` +
  (fill.warning ? `\n⚠ ${fill.warning}` : '');

/**
 * `Launched <appId>[/<Activity>] on <platform>[ (state cleared)]`. The
 * activity is shown by its last path segment — a fully-qualified
 * `pkg/pkg.MainActivity` reads as `pkg.MainActivity` — and is whichever one
 * the launch actually used, so a fallback to averi.yaml's is visible in the
 * response. Moved out of the handler 2026-10-03: wording, not delegation.
 */
export const launchText = (launch: {
  appId: string;
  platform: Platform;
  activity?: string;
  clearState?: boolean;
}): string =>
  `Launched ${launch.appId}${launch.activity === undefined ? '' : `/${launch.activity.split('/').pop()}`} on ${launch.platform}${launch.clearState ? ' (state cleared)' : ''}`;

import type { LiveVerdict } from './live-visibility.js';
import type { Source } from './live-forms.js';
import { short } from './live-forms.js';
import { heldStill, isError, replyKind } from './replies.js';
import type { LabState } from './schema.js';

/**
 * The live golden's `ensure` judges (backlog D30; docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-
 * rung.md): ensure_state run on the held cells (fixtures/apps/cells/held.json) — a screen bare for 3 s (held-no-spinner:
 * then 4 s of an unlabelled spinner), then Welcome with Continue; Continue shows Home. The state `home` detects Home,
 * its ladder's first rung `continue` taps Continue and waits for Home. The entry probe reads the bare screen, so the
 * second look runs; with no wipe ahead (h1, h2) the hold ends it ~reachRecheckMs after Welcome and says so in one line,
 * with one ahead (h3) it keeps its full window. Pure over the app's phase events (`phase`, `bare` / `spinner` /
 * `welcome` / `home`) and Continue's `tap`, each stamped by the app's clock, and the reply's held line
 * (replies.ts#heldStill) — pinned without a device (tests/truth/live-ensure.test.ts).
 *
 * Welcome is drawn after its phase event is written, and the hold's reads are stamped when they return
 * (engine.ts#detects), so a hold on Welcome cannot end before Welcome + HOLD_S: a tap earlier than that, after a held
 * line, is a hold that ended on something else — the spinner, through a tree source that reads it as no progress
 * (D37's idb spelling) — and its rung's tap waited for Continue. A tap that early with NO held line is a run whose
 * entry probe already read Welcome (the launch outran the call): no second look ran, and there is nothing to judge.
 */

/** reachRecheckMs (src/flow/engine.ts:531, 2 s by default): how long a rendered "no" must hold. */
export const HOLD_S = 2;

/** The slack past Welcome + HOLD_S a held run's Continue tap may take: a read's interval and the tap (D30's spec). */
export const HELD_SLACK_S: Record<Source, number> = { idb: 1, wda: 1, uiautomator: 3 };

/**
 * A wipe ahead: the look keeps its ensureTimeoutMs (20 s) window, begun before Welcome (the entry probe read the bare
 * screen) — so Continue is tapped no sooner than this after Welcome, with 2+ s to spare for a slow entry probe.
 */
export const WIPE_WINDOW_S = 15;

/** When the app logged a phase (its first), or Continue's tap: seconds since the epoch, the app's clock. */
const phaseAt = (s: LabState, phase: string) => s.events.find((e) => e.kind === 'phase' && e.tag === phase)?.at;
const continueAt = (s: LabState) => s.events.find((e) => e.kind === 'tap' && e.tag === 'continue')?.at;
const secs = (n: number) => `${n.toFixed(1)} s`;

/**
 * What both judges ask first: Home and the reply held to each other, Welcome shown, Continue tapped — a verdict when
 * any is not so, else Continue's tap in seconds after Welcome and the held line (if any).
 */
function reached(s: LabState, reply: string): LiveVerdict | { after: number; held: ReturnType<typeof heldStill> } {
  const kind = replyKind(reply);
  const home = phaseAt(s, 'home') !== undefined;
  const welcome = phaseAt(s, 'welcome');
  const tap = continueAt(s);
  if (!home) {
    const shown = welcome === undefined ? 'no welcome phase logged' : tap === undefined ? 'Continue never tapped' : 'Continue tapped, no home phase';
    return isError(reply) ? { outcome: 'LOUD', cls: 'not-reached', kind, why: `Home not reached (${shown}), and averi said so: ${short(reply)}` } : { outcome: 'MISMATCH', cls: 'ensure-claim', kind, why: `averi did not fail — Home not reached (${shown}): ${short(reply)}` };
  }
  if (isError(reply)) return { outcome: 'MISMATCH', cls: 'failed-holds', kind, why: `the app shows Home, but averi failed: ${short(reply)}` };
  if (welcome === undefined || tap === undefined) return { outcome: 'MISMATCH', cls: 'ensure-claim', kind, why: `Home without ${welcome === undefined ? 'a welcome phase' : 'a Continue tap'} logged: ${short(reply)}` };
  return { after: tap - welcome, held: heldStill(reply) };
}

const entryRead = (after: number, kind: LiveVerdict['kind']): LiveVerdict => ({
  outcome: 'SKIP',
  kind,
  why: `Continue tapped ${secs(after)} after Welcome with no held line: the entry probe read Welcome (the launch outran the call), no second look ran`,
});

/**
 * h1, h2 — no wipe ahead: Continue tapped within [Welcome + HOLD_S, Welcome + HOLD_S + the source's slack], the held
 * line said, Home reached. Earlier after a held line: `held-early` (the hold ended before Welcome held — on the
 * spinner); later: `held-late` (the look ran on); in time without the line: `held-unsaid`.
 */
export function judgeHeldNo(s: LabState, [reply]: string[], source: Source, _launched: LabState): LiveVerdict {
  const r = reached(s, reply);
  if ('outcome' in r) return r;
  const kind = replyKind(reply);
  const { after, held } = r;
  const said = held === undefined ? 'no held line' : `held ${held.heldS} s, then ${held.flow}`;
  if (after < HOLD_S) {
    return held === undefined ? entryRead(after, kind) : { outcome: 'MISMATCH', cls: 'held-early', kind, why: `Continue tapped ${secs(after)} after Welcome — the hold (${said}) ended before Welcome had held ${HOLD_S} s: on what came before it` };
  }
  const limit = HOLD_S + HELD_SLACK_S[source];
  if (after > limit) return { outcome: 'MISMATCH', cls: 'held-late', kind, why: `Continue tapped ${secs(after)} after Welcome, past the ${limit} s a hold takes (${said}): the look ran on` };
  if (held === undefined) return { outcome: 'MISMATCH', cls: 'held-unsaid', kind, why: `Continue tapped ${secs(after)} after Welcome, but the reply has no held line: ${short(reply)}` };
  return { outcome: 'ok', kind, why: `Continue tapped ${secs(after)} after Welcome; ${said}` };
}

/**
 * h3 — a wipe ahead (the ladder's last rung marked destructive): the look keeps its full window — no held line, Continue
 * tapped no sooner than Welcome + WIPE_WINDOW_S, Home reached. A held line: `held-said`; a tap sooner: `window-cut`.
 */
export function judgeFullWindow(s: LabState, [reply]: string[], _source: Source, _launched: LabState): LiveVerdict {
  const r = reached(s, reply);
  if ('outcome' in r) return r;
  const kind = replyKind(reply);
  const { after, held } = r;
  if (held !== undefined) return { outcome: 'MISMATCH', cls: 'held-said', kind, why: `a wipe lies ahead, yet the hold ended the look (held ${held.heldS} s, then ${held.flow}); Continue tapped ${secs(after)} after Welcome` };
  if (after < HOLD_S) return entryRead(after, kind);
  if (after < WIPE_WINDOW_S) return { outcome: 'MISMATCH', cls: 'window-cut', kind, why: `a wipe lies ahead, yet Continue was tapped ${secs(after)} after Welcome — under the ${WIPE_WINDOW_S} s the full window leaves` };
  return { outcome: 'ok', kind, why: `the full window: Continue tapped ${secs(after)} after Welcome, no held line` };
}

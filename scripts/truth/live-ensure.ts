import { DEFAULT_ENSURE_TIMEOUT_MS } from '../../src/flow/engine.js';
import type { LiveVerdict } from './live-visibility.js';
import type { Source } from './live-forms.js';
import { short } from './live-forms.js';
import { bareEntry, heldStill, isError, replyKind } from './replies.js';
import type { LabState } from './schema.js';

/**
 * The live golden's `ensure` judges (backlog D30; docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-
 * rung.md): ensure_state run on the held cells (fixtures/apps/cells/held.json) — a screen bare for 6 s (held-no-spinner:
 * then 4 s of an unlabelled spinner), then Welcome with Continue; Continue shows Home. The state `home` detects Home,
 * its ladder's first rung `continue` taps Continue and waits for Home. Pure over the app's phase events (`phase`,
 * `bare` / `spinner` / `welcome` / `home`) and Continue's `tap`, each stamped by the app's clock, and two lines of the
 * reply (replies.ts): the entry probe's bare line (#bareEntry) and the held line (#heldStill) — pinned without a
 * device (tests/truth/live-ensure.test.ts; the lines themselves against the engine's own trace,
 * live-ensure-engine.test.ts).
 *
 * The entry probe must have read the bare screen — the reply's own `⚠ detect … every UI tree read was bare` line, not
 * the timing: without it no second look was earned, and the case proves nothing about the hold. That is a MISMATCH
 * (`entry-not-bare`), never a SKIP: the engine skipping the look, bare-tree.ts reading the empty screen as content, an
 * entry read that failed all land there. A SKIP is only what the app's own events prove happened outside averi — no
 * bare phase logged — and a SKIP in this group fails the run (live-cases.ts#summarize).
 *
 * Timing. Welcome is logged before it is drawn, and the hold's reads are stamped when they return (engine.ts#detects;
 * hold-tracker.ts: `heldMs` = the ending read's stamp − the first read's that saw the screen). So a hold on Welcome ends
 * no sooner than Welcome + heldS: a tap earlier than that (less EPS_S) is a hold that began before Welcome — on the
 * spinner, through a tree source that reads it as content — whose rung's tap then waited for Continue. And it ends no
 * later than Welcome + heldS + heldSlackS(source): the first read that saw Welcome returned at most a read in flight, a
 * poll and a whole read after it, and the rung's tap takes at most one more read (to resolve Continue) and the tap.
 */

/** Below heldS: the held line's rounding (ms) and the app's timestamps (doubles of seconds). */
export const EPS_S = 0.05;
/** The engine's poll interval between a detect's reads (src/flow/engine.ts:526, pollMs 500). */
export const POLL_S = 0.5;
/**
 * One tree read, with room: idb `describe-all` ~150 ms and a WDA `/source` 35–90 ms warm, uiautomator's dump ~2.3 s
 * (docs/plans/2026-10-30-performance-backlog.md, the per-verb measurements). To be confirmed by block G's device run.
 */
export const READ_S: Record<Source, number> = { idb: 0.5, wda: 0.5, uiautomator: 3 };
/** One tap: idb `ui tap` ~185 ms, WDA's alike; adb `input tap` slower — the same measurements, with room. */
export const TAP_S: Record<Source, number> = { idb: 0.5, wda: 0.5, uiautomator: 1 };
// Upper bounds with room on purpose: block G's device run measures tap − Welcome − heldS per source and tightens READ_S / TAP_S.
/** How long after Welcome + heldS Continue may be tapped: a read in flight, a poll and a read to see Welcome; a read and a tap to tap it. */
export const heldSlackS = (source: Source) => POLL_S + 3 * READ_S[source] + TAP_S[source];

/**
 * The second look's window (DEFAULT_ENSURE_TIMEOUT_MS, 20 s). It begins after the launch — after the app's bare phase
 * was logged — so with a wipe ahead Continue is tapped no sooner than the bare phase + this.
 */
export const ENSURE_WINDOW_S = DEFAULT_ENSURE_TIMEOUT_MS / 1000;

/** When the app logged a phase (its first), or Continue's tap: seconds since the epoch, the app's clock. */
const phaseAt = (s: LabState, phase: string) => s.events.find((e) => e.kind === 'phase' && e.tag === phase)?.at;
const continueAt = (s: LabState) => s.events.find((e) => e.kind === 'tap' && e.tag === 'continue')?.at;
const secs = (n: number) => `${n.toFixed(2)} s`;

interface Reached {
  /** The kind of the reply (replies.ts#replyKind), for the verdict. */
  kind: LiveVerdict['kind'];
  /** Continue's tap, in seconds after Welcome and after the bare phase. */
  afterWelcome: number;
  afterBare: number;
  held: ReturnType<typeof heldStill>;
}

/**
 * What both judges ask first: Home and the reply held to each other, Welcome shown, Continue tapped, the bare phase
 * logged (else SKIP), the entry probe bare by the reply (else `entry-not-bare`) — a verdict when any is not so.
 */
function reached(s: LabState, reply: string): LiveVerdict | Reached {
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
  const bare = phaseAt(s, 'bare');
  if (bare === undefined) return { outcome: 'SKIP', kind, why: 'the app logged no bare phase: the case never set up (an old lab app?) — nothing to judge' };
  if (!bareEntry(reply)) return { outcome: 'MISMATCH', cls: 'entry-not-bare', kind, why: `the reply has no bare entry probe line — no second look was earned on a screen bare for ${secs(welcome - bare)}: ${short(reply)}` };
  return { kind, afterWelcome: tap - welcome, afterBare: tap - bare, held: heldStill(reply) };
}

/**
 * h1, h2 — no wipe ahead: the held line said, Continue tapped within [Welcome + heldS − EPS_S, Welcome + heldS +
 * heldSlackS(source)], Home reached. Earlier: `held-early` (the hold began before Welcome — on the spinner); later:
 * `held-late`. No held line: `held-late` when the tap came after the whole window, else `held-unsaid`.
 */
export function judgeHeldNo(s: LabState, [reply]: string[], source: Source, _launched: LabState): LiveVerdict {
  const r = reached(s, reply);
  if ('outcome' in r) return r;
  const { kind, afterWelcome, afterBare, held } = r;
  if (held === undefined) {
    return afterBare >= ENSURE_WINDOW_S - EPS_S ?
        { outcome: 'MISMATCH', cls: 'held-late', kind, why: `no held line, Continue tapped ${secs(afterBare)} after the bare phase: the look ran its whole ${ENSURE_WINDOW_S} s window` }
      : { outcome: 'MISMATCH', cls: 'held-unsaid', kind, why: `Continue tapped ${secs(afterWelcome)} after Welcome, but the reply has no held line: ${short(reply)}` };
  }
  if (afterWelcome < held.heldS - EPS_S) {
    return { outcome: 'MISMATCH', cls: 'held-early', kind, why: `Continue tapped ${secs(afterWelcome)} after Welcome, though the screen held ${held.heldS} s: the hold began before Welcome — on what came before it` };
  }
  const limit = held.heldS + heldSlackS(source);
  if (afterWelcome > limit) return { outcome: 'MISMATCH', cls: 'held-late', kind, why: `Continue tapped ${secs(afterWelcome)} after Welcome, past the ${secs(limit)} a ${held.heldS} s hold allows under ${source}` };
  return { outcome: 'ok', kind, why: `Continue tapped ${secs(afterWelcome)} after Welcome; held ${held.heldS} s, then ${held.flow}` };
}

/**
 * h3 — a wipe ahead (the ladder's last rung marked destructive): the look keeps its full window — no held line,
 * Continue tapped no sooner than the bare phase + ENSURE_WINDOW_S, Home reached. A held line: `held-said`; a tap
 * sooner: `window-cut`.
 */
export function judgeFullWindow(s: LabState, [reply]: string[], _source: Source, _launched: LabState): LiveVerdict {
  const r = reached(s, reply);
  if ('outcome' in r) return r;
  const { kind, afterWelcome, afterBare, held } = r;
  if (held !== undefined) return { outcome: 'MISMATCH', cls: 'held-said', kind, why: `a wipe lies ahead, yet the hold ended the look (held ${held.heldS} s, then ${held.flow}); Continue tapped ${secs(afterWelcome)} after Welcome` };
  if (afterBare < ENSURE_WINDOW_S - EPS_S) return { outcome: 'MISMATCH', cls: 'window-cut', kind, why: `a wipe lies ahead, yet Continue was tapped ${secs(afterBare)} after the bare phase — under the ${ENSURE_WINDOW_S} s window` };
  return { outcome: 'ok', kind, why: `the full window: Continue tapped ${secs(afterBare)} after the bare phase (${secs(afterWelcome)} after Welcome), no held line` };
}

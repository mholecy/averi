/**
 * Every sentence a fill says, and the one renderer of a fill verdict for
 * both media it is reported in — the MCP type_text reply and the flow's
 * `fill` trace — side by side, so the two layouts are read, changed and
 * tested together.
 *
 * Why one module for two media: they say the same thing in two layouts, and
 * when each caller laid out its own they drifted — until df8a91a a clear
 * alone that was not verified read `(N deletes sent)` in the reply and
 * `(cleared N characters first)` on the flow line
 * (docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md).
 * The judgement is interact/fill-verdict.ts's (`judgeFill`: codes, never a
 * sentence); the words are this module's, all of them — the per-code
 * sentence tables (`REASON_SENTENCE`, `CAVEAT_SENTENCE`, `SENT_SENTENCE`,
 * exhaustive, so a new code without its sentence does not compile), the
 * wording they make (`wordingOf`, `caveatText`) and where it goes. Until
 * 2026-10-09 (code review S1) the tables sat in fill-verdict.ts and only the
 * layout was here, so the fill split judge from words one module later than
 * scroll_until did; now both follow one rule — the judge emits typed codes,
 * the renderer owns every sentence.
 *
 * Why in interact/ rather than mcp/tool-text.ts with the other replies: the
 * flow engine may not import mcp/ (ARCHITECTURE.md §2: `mcp → run → flow →
 * interact`), so the two layouts cannot sit together there. flow/ would
 * satisfy the layering too (mcp/ may import it); interact/ was CHOSEN, beside
 * the verdict it renders and the facts it comes from — the precedent is
 * interact/scroll-text.ts, every sentence scroll_until says (its
 * `describeScrollResult` the MCP tool and the flow line both print), over
 * the typed outcome interact/scroll-rounds.ts judged. fill.ts imports this
 * module for one sentence, `caveatText` (its mismatch error names the input
 * in the same words); nothing here imports fill.ts.
 *
 * THE RULE for every renderer here (and any added later, e.g. a JSON
 * reply): branch only on `did` and on whether `sent` / `unverified` are
 * present — never on a ReadBack, on `cleared`, or on a Reason or Caveat
 * code. Those are judged once, in judgeFill; a renderer that looked at them
 * again would be a second judge, which is the bug this module ends. A
 * renderer that wants codes (structured output) reads the verdict as data;
 * it does not re-derive them.
 *
 * The renderer never sees the typed value: the step medium takes `shown`,
 * the caller's own rendering of it (`***` for a secret — the engine's
 * decision, uninspected here).
 */

import { rectText } from '../ui-tree/geometry.js';
import { charactersText, countOf } from '../util/count.js';
import type { LostWhy } from './fill-facts.js';
import type { Caveat, FillVerdict, Reason, Sent } from './fill-verdict.js';
import { INPUT_ROLE } from './input-role.js';

/** One flow trace line: the action column and its text. */
export interface FillTraceLine {
  action: 'fill' | '⚠ fill';
  text: string;
}

/**
 * The flow medium. `caveats` are meant to be logged BEFORE the keyboard is
 * dismissed (a dismissal that throws must not take them down with it), and
 * `line` last — the engine appends `; keyboard hidden by …` to its text,
 * since the dismissal is a second call (fill.ts) and not the fill's to report.
 */
export interface FillStepText {
  caveats: FillTraceLine[];
  line: FillTraceLine;
}

/**
 * Render a verdict:
 *
 * `{ reply: selector }` — the MCP reply, one string:
 * - `filled`: `Filled <selector> (N characters[, cleared M characters first])`
 * - `typed`: `Typed N characters into <selector>[ (cleared M characters
 *   first)] — NOT verified: <reasons>` — a different verb, so "Filled"
 *   never stands for a fill nobody saw;
 * - `cleared` (a clear alone, deletes sent, not seen to land):
 *   `Cleared <selector> (N deletes sent) — NOT verified: …`;
 * - `focused` (nothing typed, nothing deleted, not verified):
 *   `Focused <selector> — NOT verified: …` — the focus tap is all that was
 *   done;
 * then ` (note)` when the resolution left one, then each caveat on its own
 * `\n⚠ ` line, so it is not lost inside the parentheses.
 *
 * `{ step, shown }` — the flow trace, `step` the element as the flow named
 * it (describeElementSpec):
 * - `caveats`: each `⚠ fill  <step>: <caveat>`;
 * - `line`: `fill` when verified, else `⚠ fill`, with
 *   `<step> = <shown>[ (<sent>)][ — NOT verified: …]`. No head verb (the
 *   action column says it) and no note (the trace never printed one). A
 *   clear alone keeps the ` = ` with nothing after it
 *   (`id:"amount_input" =  (cleared 4 characters first)`): cosmetic, and
 *   pinned by the engine tests as it always read.
 */
export function fillText(v: FillVerdict, as: { reply: string }): string;
export function fillText(v: FillVerdict, as: { step: string; shown: string }): FillStepText;
export function fillText(v: FillVerdict, as: { reply: string } | { step: string; shown: string }): string | FillStepText {
  const w = wordingOf(v);
  const sent = (open: string, close: string) => (w.sent === undefined ? '' : `${open}${w.sent}${close}`);
  const unverified = w.unverified === undefined ? '' : ` — ${w.unverified}`;
  if ('reply' in as) {
    // One row per head verb: a new `did` without its row does not compile
    // (until review round 1 of 2026-10-09 the last branch was a catch-all,
    // so a new verb would have rendered silently as "Focused").
    const head: Record<FillVerdict['did'], () => string> = {
      filled: () => `Filled ${as.reply} (${w.typed}${sent(', ', '')})`,
      typed: () => `Typed ${w.typed} into ${as.reply}${sent(' (', ')')}${unverified}`,
      cleared: () => `Cleared ${as.reply}${sent(' (', ')')}${unverified}`,
      focused: () => `Focused ${as.reply}${unverified}`,
    };
    return head[v.did]() + (v.note ? ` (${v.note})` : '') + w.caveats.map((c) => `\n⚠ ${c}`).join('');
  }
  return {
    caveats: w.caveats.map((c) => ({ action: '⚠ fill', text: `${as.step}: ${c}` })),
    line: { action: v.did === 'filled' ? 'fill' : '⚠ fill', text: `${as.step} = ${as.shown}${sent(' (', ')')}${unverified}` },
  };
}

/**
 * The words of a verdict, layout-free — what the renderers below place:
 * - `typed`: `N character(s)`;
 * - `sent`: `cleared N character(s) first` | `N delete(s) sent`, present
 *   with the verdict's `sent`;
 * - `unverified`: `NOT verified: ` and every reason's sentence joined by
 *   `; `, present ⇔ the verdict has reasons;
 * - `caveats`: one sentence per caveat, in the verdict's order.
 */
export interface FillWording {
  typed: string;
  sent?: string;
  unverified?: string;
  caveats: string[];
}

/** The verdict in words. Pure; with `caveatText`, the only producer of fill sentences. */
export function wordingOf(v: FillVerdict): FillWording {
  return {
    typed: charactersText(v.typed),
    sent: v.sent === undefined ? undefined : SENT_SENTENCE[v.sent.what](v.sent.n),
    unverified: v.reasons.length === 0 ? undefined : `NOT verified: ${v.reasons.map(reasonText).join('; ')}`,
    caveats: v.caveats.map(caveatText),
  };
}

/** One caveat's sentence. Exported for fill.ts's mismatch error, which names the input the caller probably meant in the same words. */
export function caveatText(c: Caveat): string {
  return (CAVEAT_SENTENCE[c.code] as (c: Caveat) => string)(c);
}

function reasonText(r: Reason): string {
  return (REASON_SENTENCE[r.code] as (r: Reason) => string)(r);
}

/** One row per code; the mapped type makes a missing row a compile error. */
type SentenceTable<U extends { code: string }> = { [C in U['code']]: (u: Extract<U, { code: C }>) => string };

const SENT_SENTENCE: Record<Sent['what'], (n: number) => string> = {
  characters: (n) => `cleared ${charactersText(n)} first`,
  deletes: (n) => `${countOf(n, 'delete')} sent`,
};

const REASON_SENTENCE: SentenceTable<Reason> = {
  'no-value': (r) => `the matched node exposes no value (role ${r.role})`,
  'not-taken': (r) => `the matched node's value does not show the typed text (role ${r.role}) — it is not the field`,
  lost: (r) => `the field could not be found again${LOST_WHY_TEXT[r.why]}`,
  'clear-unmeasured': (r) => `clear sent no delete — a role ${r.role} node's length is not the field's`,
  'clear-no-length': () => 'clear sent no delete — the node gave no length to delete',
};

/** ` (why)` for a `lost` read-back, chosen per reason (review 2026-10-08, n-3: it read as "the selector no longer matches it" whatever the reason). */
const LOST_WHY_TEXT: Record<LostWhy, string> = {
  'screen-changed': ' (the screen changed while typing)',
  unmatched: ' (the selector no longer matches it)',
};

const CAVEAT_SENTENCE: SentenceTable<Caveat> = {
  'not-input': ({ role, typed, input }) => {
    const head =
      `the matched node is role ${role}, not a ${INPUT_ROLE} — ` +
      (typed ? 'typing goes wherever the focus tap left the focus' : 'nothing was deleted, and the focus is wherever the tap left it');
    if (input === 'none') return `${head}; no ${INPUT_ROLE} is on the screen`;
    if (input === 'unread') return `${head}; the screen could not be read again to name the input`;
    // Identifier and rect only: never the label or the value (on Android an
    // EditText's label falls back to its text, and a field may hold a credential).
    const id = input.identifier === null ? '' : ` id:"${input.identifier}"`;
    return (
      `${head}; the ${input.overlaps ? 'input overlapping it' : 'nearest input'} is ${INPUT_ROLE}${id} at ${rectText(input.rect)} — ` +
      `select the input itself (role:${INPUT_ROLE} with its id:, or its current value: when inputs share an id)`
    );
  },
  'masked-append': ({ held }) => `masked field already held ${charactersText(held)} and clear is not set — typing APPENDS; pass clear: true to replace`,
};

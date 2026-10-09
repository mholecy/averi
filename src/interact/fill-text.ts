/**
 * The one renderer of a fill verdict, for both media it is reported in —
 * the MCP type_text reply and the flow's `fill` trace — side by side, so
 * the two layouts are read, changed and tested together.
 *
 * Why one module for two media: they say the same thing in two layouts, and
 * when each caller laid out its own they drifted — until df8a91a a clear
 * alone that was not verified read `(N deletes sent)` in the reply and
 * `(cleared N characters first)` on the flow line
 * (docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md).
 * The judgement and the words are interact/fill-verdict.ts's; this module
 * holds only where they go.
 *
 * Why in interact/ rather than mcp/tool-text.ts with the other replies: the
 * flow engine may not import mcp/ (ARCHITECTURE.md §2: `mcp → run → flow →
 * interact`), so the two layouts cannot sit together there. flow/ would
 * satisfy the layering too (mcp/ may import it); interact/ was CHOSEN, beside
 * the verdict it renders and the facts it comes from — the precedent is
 * interact/scroll.ts#describeScrollResult, which the MCP tool and the flow
 * line both print.
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

import { wordingOf, type FillVerdict } from './fill-verdict.js';

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

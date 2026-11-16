import { z } from 'zod';
import { errorMessage } from './error-message.js';

/**
 * A string field that IS a regular expression, validated where the field is
 * parsed, not where the pattern is first compiled.
 *
 * Were such a field a bare `z.string()`, the pattern would meet `new RegExp`
 * only deep inside the run, and one typo would fail differently per kind: an
 * element assert's `match: "("` would throw out of the tree poll's predicate
 * a few milliseconds in, out of assertAll mid-batch, losing every result
 * already judged; an ocr assert's would throw inside the measure, whose catch
 * would turn it into "OCR failed: Invalid regular expression…" every round
 * and poll the whole 12 s budget for a mistake no screen could fix; and an
 * averi.yaml carrying the element kind in an `assert:` step (the only kind a
 * flow step takes) would load clean and fail only mid-flow, on a device. The
 * schema says it instead: the MCP call's arguments, or averi.yaml at load,
 * are refused naming the field (zod's path) and the engine's own diagnosis,
 * before any device is bound — the shape of the layout contract's field
 * values.
 *
 * `flags` must be the flags the consumer compiles with (`'i'` for the log
 * grep, none for the asserts), so the verdict here is the verdict there: only
 * `u`/`v` change what parses today, but stating them costs nothing and keeps
 * the check honest if a consumer ever adds one. The runtime compiles stay in
 * each consumer — a string that passed this cannot throw there — so the spec
 * types are plain `string`.
 *
 * A util leaf, like duration.ts, because the field lives in more than one
 * layer — verify's assert schemas and mcp's get_logs — and none of them owns
 * the notion of "this string is a pattern".
 */
export const regexSource = (flags = ''): z.ZodEffects<z.ZodString> =>
  z.string().superRefine((source, ctx) => {
    try {
      new RegExp(source, flags);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a valid regular expression — ${errorMessage(e)}` });
    }
  });

/**
 * `value` as a regex source matching it as literal text: a backslash before each of `. * + ? ^ $ { } ( ) | [ ] \`,
 * nothing else. Valid with or without the `u` flag, and outside a character class only. `/` is left alone (a RegExp
 * constructor needs no `/` escape) and so is `-` (literal outside a class, and `\-` there is a syntax error under `u`).
 *
 * The one escape for JS patterns: the element assert's text hint shows its output verbatim as the `match:` to
 * write (verify/text-hint.ts#textHint), and every other literal spliced into a pattern goes through it. Here, not in
 * verify/, because every layer and the scripts can reach a util leaf. adapters/ios-liveness.ts#ereEscape escapes the
 * same 14 characters for pgrep's POSIX ERE, another grammar.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

import { z } from 'zod';
import { errorMessage } from './error-message.js';

/**
 * A string field that IS a regular expression — an element assert's `match`,
 * an ocr assert's `ocr.match`, get_logs' `grep` — validated where the field is
 * parsed, not where the pattern is first compiled.
 *
 * Before this (architecture review 2026-10-07, assert-capture-ocr C3) every
 * such field was a bare `z.string()`, and the pattern met `new RegExp` only
 * deep inside the run, so one typo had a different failure per kind: an
 * element assert's `match: "("` threw out of the tree poll's predicate a few
 * milliseconds in, out of assertAll mid-batch, losing every result already
 * judged; an ocr assert's threw inside the measure, whose catch turned it
 * into "OCR failed: Invalid regular expression…" every round and polled the
 * whole 12 s budget for a mistake no screen could fix; and an averi.yaml
 * carrying the element kind in an `assert:` step (the only kind a flow step
 * takes) loaded clean and failed only mid-flow, on a device. Now the
 * schema says it: the MCP call's arguments, or averi.yaml at load, are
 * refused naming the field (zod's path) and the engine's own diagnosis,
 * before any device is bound — the shape 441f0c5 gave the layout contract's
 * field values.
 *
 * `flags` must be the flags the consumer compiles with (`'i'` for the log
 * grep, none for the asserts), so the verdict here is the verdict there: only
 * `u`/`v` change what parses today, but stating them costs nothing and keeps
 * the check honest if a consumer ever adds one. The runtime compiles stay
 * where they are — a string that passed this cannot throw there — so the
 * spec types remain plain `string` and every consumer is unchanged.
 *
 * A util leaf, like duration.ts, because the field lives in more than one
 * layer — verify's two assert schemas (which flow/config's `assert:` step
 * reuses) and mcp's get_logs — and none of them owns the notion of "this
 * string is a pattern".
 */
export const regexSource = (flags = ''): z.ZodEffects<z.ZodString> =>
  z.string().superRefine((source, ctx) => {
    try {
      new RegExp(source, flags);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a valid regular expression — ${errorMessage(e)}` });
    }
  });

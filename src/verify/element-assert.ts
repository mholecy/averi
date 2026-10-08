import { z } from 'zod';
import { elementSpecSchema, type ElementSpec } from '../ui-tree/element-spec.js';
import { regexSource } from '../util/regex.js';

/**
 * Element assert, shared by the `assert` tool (assert.ts builds its spec union
 * from this) and by averi.yaml's inline `assert:` step (flow/config.ts):
 * exists (default) / absent / text / match / error.
 *
 * `absent` means gone from the tree OR outside the visible viewport — the
 * portable meaning of "disappeared" (iOS keeps off-screen nodes in its tree,
 * Android prunes them).
 *
 * Its own module rather than part of assert.ts so flow/config can validate an
 * `assert:` step without importing the Verifier and its device machinery.
 */

export interface ElementAssert {
  element: ElementSpec;
  absent?: boolean;
  text?: string;
  match?: string;
  error?: string;
  timeout?: string | number;
}

export const elementAssertSchema: z.ZodType<ElementAssert> = z
  .object({
    element: elementSpecSchema,
    absent: z.boolean().optional(),
    text: z.string().optional(),
    /** Unanchored, no flags — assert.ts compiles it as `new RegExp(match)`; refused at parse when it does not compile. */
    match: regexSource().optional(),
    error: z.string().optional(),
    timeout: z.union([z.number(), z.string()]).optional(),
  })
  .strict()
  .refine(
    (a) => !(a.absent && (a.text !== undefined || a.match !== undefined || a.error !== undefined)),
    { message: 'absent cannot be combined with text/match/error' },
  );

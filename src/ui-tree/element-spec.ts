import { z } from 'zod';

/**
 * A structured element selector: the declarative form of the selector strings
 * in selectors.ts, resolved against the normalized UI tree by `findBySpec`.
 *
 * It lives here, with the tree it addresses, rather than in flow/config —
 * averi.yaml is one consumer (tap/fill/wait steps), the assert layer is
 * another, and neither owns the vocabulary. The schema sits beside the type so
 * a single module owns both what a spec IS and what counts as a valid one.
 */

export interface ElementSpec {
  id?: string;
  text?: string;
  role?: string;
  label?: string;
}

export const elementSpecSchema: z.ZodType<ElementSpec> = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()
  .refine((s) => Object.values(s).some((v) => v !== undefined), {
    message: 'element spec needs at least one of: id, text, role, label',
  });

/**
 * Render a spec the way a human reads it: `id:"login_button" role:"button"`.
 * User-facing vocabulary — it appears in flow traces AND in assert
 * descriptions, which must agree, so it has one owner.
 */
export function describeElementSpec(spec: ElementSpec): string {
  return Object.entries(spec)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join(' ');
}

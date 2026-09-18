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

/**
 * The fields alone, BEFORE the at-least-one-selector refinement — the form
 * step schemas extend (`fill`, `tap` add `value`/`clear`/`timeout` beside a
 * selector). Exported because a refined schema is a ZodEffects with no
 * `.extend()`, so the alternative is hand-copying the four fields into every
 * such step, which is how `value:` came to exist in the selector-string
 * grammar (selectors.ts) without ever reaching the structured form.
 * Extenders re-apply `hasSelector` with their own message — "tap needs …"
 * beats "element spec needs …" when the step is what the author typed.
 */
export const elementSpecObject = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
  })
  .strict();

/**
 * Does this spec name anything to look for? Deliberately checks the four
 * fields BY NAME rather than `Object.values(...).some(...)`: extended specs
 * carry non-selector keys (`value`, `clear`, `timeout`) that must not count
 * as a selector, and the value-based form silently accepted them.
 */
export const hasSelector = (spec: ElementSpec): boolean =>
  SELECTOR_FIELDS.some((f) => spec[f] !== undefined);

/**
 * The selector fields, DERIVED from the schema — the one list a field must be
 * on to arrive from averi.yaml at all. Every place that needs "just the
 * selector half" of an extended step payload (`fill` with its `value`, `tap`
 * with its `timeout`) goes through `selectorOnly` instead of destructuring the
 * four names again. Adding a field to `elementSpecObject` without adding it to
 * `ElementSpec` fails to compile (the indexed access below), and vice versa
 * `hasSelector` and every trace line pick the new field up with no edit —
 * a `satisfies` on a literal list only checked the listed names were keys, not
 * that every key was listed (architecture review 2026-09-18).
 */
export const SELECTOR_FIELDS = Object.keys(elementSpecObject.shape) as (keyof typeof elementSpecObject.shape)[];

/** The selector half of an extended payload — never `value`, `clear`, `timeout`. */
export const selectorOnly = (payload: Record<string, unknown>): ElementSpec => {
  const spec: ElementSpec = {};
  for (const f of SELECTOR_FIELDS) if (typeof payload[f] === 'string') spec[f] = payload[f] as string;
  return spec;
};

export const elementSpecSchema: z.ZodType<ElementSpec> = elementSpecObject.refine(hasSelector, {
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

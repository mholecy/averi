import { z } from 'zod';

/**
 * The layout contract: a screen's anchors in Figma-frame units, checked into
 * the app repo and passed to `verify` via `contract:`. ONE contract feeds every
 * parity dimension — rect-parity.ts reads the geometry fields, color-parity.ts
 * reads the fill fields, text-parity.ts reads the copy fields — so it is owned
 * here rather than by any one consumer.
 *
 * `bg` / `bg_dark` / `sample` / `text` / `text_dynamic` are declared but
 * deliberately typed `unknown`:
 * the contract is hand-written JSON, and the actionable diagnosis for a bad
 * value ("'#white-ish' is neither #RRGGBB(AA) nor a <hue>.<colorN> token
 * name", "unknown sample mode") belongs to the comparator that knows what the
 * field means. Typing them here would replace those messages with a generic
 * zod parse error at load time, and would reject a contract whose colour
 * fields are wrong even for a caller only asking for geometry.
 *
 * Both schemas stay `.passthrough()`: unknown fields (`_note`, future
 * dimensions) must survive a round trip, never be rejected.
 */

const anchorSchema = z
  .object({
    id: z.string().min(1),
    // Geometry, Figma-frame units (rect-parity.ts).
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    // Fill (color-parity.ts) — validated by the comparator, see header.
    /** Expected fill under the light theme: '#RRGGBB(AA)' or a `<hue>.<colorN>` token name. */
    bg: z.unknown().optional(),
    /** Expected fill under the dark theme; without it, dark runs skip vs-contract. */
    bg_dark: z.unknown().optional(),
    /** Sampling strategy: 'dominant' (default) or 'patches'. */
    sample: z.unknown().optional(),
    // Copy (text-parity.ts) — validated by the comparator, see header.
    /**
     * The exact string this anchor RENDERS, asserted on both platforms.
     * Declaring it (or `text_dynamic`) is what opts an anchor into the text
     * check at all. Placeholder copy must be asserted in the EMPTY state:
     * measured 2026-08-14, iOS drops the placeholder node once the field is
     * filled, so the same assert after a fill step finds nothing to compare.
     */
    text: z.unknown().optional(),
    /**
     * True for amounts, balances and dates: values whose formatting
     * legitimately differs per locale (`1,121.00` vs `1 121,00`) and whose node
     * granularity differs too (Android splits the balance across two nodes
     * where iOS renders one). Literal comparison — and with it the size check,
     * which needs identical strings — is skipped for these.
     */
    text_dynamic: z.unknown().optional(),
  })
  .passthrough();

const contractSchema = z
  .object({
    screen: z.string().optional(),
    tolerance_pct: z.number().positive().optional(),
    /** Max CIEDE2000 on the android-vs-ios axis; vs-contract runs at 1.5x. */
    tolerance_de: z.unknown().optional(),
    /**
     * Max relative ink-height difference in %, android-vs-ios (default 10).
     * Measured basis: a matching pair reads 0.74% apart, the known 22sp-vs-17pt
     * title drift reads 12.63% apart.
     */
    tolerance_size_pct: z.unknown().optional(),
    figma_frame_width: z.number().positive().optional(),
    anchors: z.array(anchorSchema).min(1),
  })
  .passthrough();

export type LayoutContract = z.infer<typeof contractSchema>;
export type LayoutAnchor = z.infer<typeof anchorSchema>;

/**
 * Validate one of the `tolerance_*` fields the schema deliberately leaves
 * `unknown` (see header). The caller passes what to CALL it — 'color parity:
 * tolerance_de', 'text parity: tolerance_size_pct' — so the message still
 * names the comparator and the field the author actually typed, which is the
 * whole reason these are not typed at load time; only the rule itself (a
 * finite number above zero, never NaN, never a string that looks numeric) is
 * shared. A tolerance that silently defaulted instead of throwing would make
 * every row in the table pass for the wrong reason.
 */
export function positiveTolerance(raw: unknown, what: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${what} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

export function parseLayoutContract(jsonText: string, source = 'layout contract'): LayoutContract {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`${source}: not valid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = contractSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`${source}: ${issues}`);
  }
  return result.data;
}

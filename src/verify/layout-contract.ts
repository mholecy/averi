import { z } from 'zod';

/**
 * The layout contract: a screen's anchors in Figma-frame units, checked into
 * the app repo and passed to `verify` via `contract:`. ONE contract feeds every
 * parity dimension — rect-parity.ts reads the geometry fields, color-parity.ts
 * reads the fill fields — so it is owned here rather than by either consumer.
 *
 * `bg` / `bg_dark` / `sample` are declared but deliberately typed `unknown`:
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
  })
  .passthrough();

const contractSchema = z
  .object({
    screen: z.string().optional(),
    tolerance_pct: z.number().positive().optional(),
    /** Max CIEDE2000 on the android-vs-ios axis; vs-contract runs at 1.5x. */
    tolerance_de: z.unknown().optional(),
    figma_frame_width: z.number().positive().optional(),
    anchors: z.array(anchorSchema).min(1),
  })
  .passthrough();

export type LayoutContract = z.infer<typeof contractSchema>;
export type LayoutAnchor = z.infer<typeof anchorSchema>;

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

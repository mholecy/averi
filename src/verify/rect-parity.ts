import { z } from 'zod';
import type { Platform, UiNode } from '../adapters/types.js';

/**
 * Deterministic rect parity: device geometry vs a layout contract, and vs the
 * other platform. Port of the superrepo's `scripts/rect-parity.py` (the
 * semantic source of truth; the script stays for CI/offline use on saved
 * snapshots). averi already holds the normalized UI tree per platform, so
 * this port drops the script's rect/id autodetection entirely and consumes
 * `UiNode` directly.
 *
 * Why it exists: the screenshot judge cannot see a 46-vs-24pt margin or a
 * 1.81-vs-1.60 aspect ratio. Geometry is arithmetic, so it belongs in code
 * that prints numbers — numbers over impressions.
 *
 * Semantics preserved from the script:
 * - Every comparison is in PERCENT OF SCREEN WIDTH. Per-platform width = the
 *   widest rect in the WHOLE tree (the root/window node, which carries no id
 *   — inferring from id-bearing children only scaled every delta by the
 *   content inset and reported a phantom +5.7% on correct geometry).
 * - Contract values are Figma-frame units, normalized by `figma_frame_width`
 *   (fallback: the widest anchor `w`). Omitted anchor fields are compared
 *   platform-to-platform only, never against the contract.
 * - Absolute `y` is NEVER a finding source: it is normalized by width, so two
 *   devices with different aspect ratios (1080x2400 = 2.22 vs 393x852 = 2.17)
 *   drift ~2% apart near the bottom of the screen from geometry alone.
 *   Vertical position is judged by the gap-to-previous-anchor rows, which are
 *   local and aspect-independent.
 * - A MISSING anchor resets the gap chain and fails the run, but is reported
 *   separately — it is not a parity delta.
 * - First occurrence of an id wins when a tree duplicates it.
 */

type Rect = UiNode['rect'];

const anchorSchema = z
  .object({
    id: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  })
  // Unknown per-anchor fields (bg, bg_dark, sample, _note, ...) are IGNORED —
  // a future color check will consume them; geometry must not reject them.
  .passthrough();

const contractSchema = z
  .object({
    screen: z.string().optional(),
    tolerance_pct: z.number().positive().optional(),
    figma_frame_width: z.number().positive().optional(),
    anchors: z.array(anchorSchema).min(1),
  })
  .passthrough();

export type RectContract = z.infer<typeof contractSchema>;
export type RectAnchor = z.infer<typeof anchorSchema>;

export function parseRectContract(jsonText: string, source = 'layout contract'): RectContract {
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

export interface ScreenWidth {
  width: number;
  /**
   * True when the widest rect starts at the left screen edge — that is the
   * root/window node. When it starts inset, the tree was filtered and the
   * width is a CONTENT width, which silently scales every delta.
   */
  reliable: boolean;
}

/** Screen width = widest rect in the whole tree (id-less root/window included). */
export function inferScreenWidth(tree: UiNode): ScreenWidth {
  let widest = tree.rect;
  const walk = (n: UiNode): void => {
    if (n.rect.x + n.rect.width > widest.x + widest.width) widest = n.rect;
    n.children.forEach(walk);
  };
  walk(tree);
  return { width: widest.x + widest.width, reliable: Math.abs(widest.x) < 1.0 };
}

/** {id → rect} for the FIRST occurrence of each identifier (pre-order). */
function collectRects(tree: UiNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: UiNode): void => {
    if (n.identifier !== null && n.identifier !== '' && !out.has(n.identifier)) {
      out.set(n.identifier, n.rect);
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

export type RectField = 'x' | 'y' | 'w' | 'h' | 'gap' | 'aspect';
export type RectComparison = 'android-vs-contract' | 'ios-vs-contract' | 'android-vs-ios';

export interface RectFinding {
  /** Anchor id; for gap findings "prevId -> id". */
  anchor: string;
  field: RectField;
  comparison: RectComparison;
  /** % of screen width (aspect: relative spread in %). Always over tolerance. */
  delta: number;
  /** Measured values: raw device units for x/w/h, % for gap, ratio for aspect. */
  android?: number;
  ios?: number;
  /** Contract value in Figma units (gap: contract gap in %). */
  contract?: number;
}

export type RectEntry =
  | {
      kind: 'field';
      anchor: string;
      field: RectField;
      /** Figma units for x/y/w/h; % for gap; absent for aspect. */
      contract?: number;
      /** Raw device units for x/y/w/h; % for gap; ratio for aspect. */
      android?: number;
      ios?: number;
      dAc?: number;
      dIc?: number;
      /** For aspect this is the spread in % (always >= 0). */
      dAi?: number;
      aspectOver?: boolean;
    }
  | { kind: 'missing'; anchor: string; absentOn: Platform[] }
  | { kind: 'skipped'; anchor: string };

export interface RectParityResult {
  screen: string;
  tolerancePct: number;
  frameWidth: number;
  platforms: Platform[];
  anchorCount: number;
  widths: { platform: Platform; width: number; reliable: boolean }[];
  entries: RectEntry[];
  missing: { id: string; absentOn: Platform[] }[];
  /** Single-platform runs only: anchors with no contract fields — nothing to compare. */
  skipped: string[];
  findings: RectFinding[];
  pass: boolean;
}

export interface RectParityOptions {
  /** Overrides the contract's tolerance_pct (default 2.0). */
  tolerancePct?: number;
}

const norm = (value: number, width: number): number => (value / width) * 100;

const FIELDS: { field: 'x' | 'y' | 'w' | 'h'; get: (r: Rect) => number }[] = [
  { field: 'x', get: (r) => r.x },
  { field: 'y', get: (r) => r.y },
  { field: 'w', get: (r) => r.width },
  { field: 'h', get: (r) => r.height },
];

export function compareRectParity(
  contract: RectContract,
  trees: Partial<Record<Platform, UiNode>>,
  opts: RectParityOptions = {},
): RectParityResult {
  const platforms = (['android', 'ios'] as const).filter((p) => trees[p] !== undefined);
  if (platforms.length === 0) throw new Error('rect parity: no platform tree provided');
  const single = platforms.length === 1;
  const tolerancePct = opts.tolerancePct ?? contract.tolerance_pct ?? 2.0;
  const frameWidth =
    contract.figma_frame_width ?? Math.max(0, ...contract.anchors.map((a) => a.w ?? 0));

  const widths = platforms.map((p) => ({ platform: p, ...inferScreenWidth(trees[p] as UiNode) }));
  const widthOf: Partial<Record<Platform, number>> = {};
  for (const w of widths) {
    if (w.width <= 0) throw new Error(`rect parity: ${w.platform} tree has no usable width`);
    widthOf[w.platform] = w.width;
  }
  const rectsOf: Partial<Record<Platform, Map<string, Rect>>> = {};
  for (const p of platforms) rectsOf[p] = collectRects(trees[p] as UiNode);

  const entries: RectEntry[] = [];
  const missing: { id: string; absentOn: Platform[] }[] = [];
  const skipped: string[] = [];
  const findings: RectFinding[] = [];

  const addFinding = (
    anchor: string,
    field: RectField,
    comparison: RectComparison,
    delta: number | undefined,
    values: { android?: number; ios?: number; contract?: number },
  ): void => {
    if (delta !== undefined && Math.abs(delta) > tolerancePct) {
      findings.push({ anchor, field, comparison, delta, ...values });
    }
  };

  // Gap chain: previous anchor for gap-to-previous rows. MISSING resets it —
  // a gap measured across an unresolved anchor would be meaningless.
  let prev: { anchor: RectAnchor; rects: Partial<Record<Platform, Rect>> } | null = null;

  for (const anchor of contract.anchors) {
    const found: Partial<Record<Platform, Rect>> = {};
    const absentOn: Platform[] = [];
    for (const p of platforms) {
      const rect = rectsOf[p]?.get(anchor.id);
      if (rect === undefined) absentOn.push(p);
      else found[p] = rect;
    }
    if (absentOn.length > 0) {
      missing.push({ id: anchor.id, absentOn });
      entries.push({ kind: 'missing', anchor: anchor.id, absentOn });
      prev = null;
      continue;
    }

    // Single-platform: an anchor with no contract fields has nothing to
    // compare against (no other platform, no contract) — skip with a note.
    // It behaves as if not listed: the gap chain continues over it.
    const hasContractFields = FIELDS.some(({ field }) => anchor[field] !== undefined);
    if (single && !hasContractFields) {
      skipped.push(anchor.id);
      entries.push({ kind: 'skipped', anchor: anchor.id });
      continue;
    }

    const a = found.android;
    const i = found.ios;

    for (const { field, get } of FIELDS) {
      const want = anchor[field];
      const aRaw = a === undefined ? undefined : get(a);
      const iRaw = i === undefined ? undefined : get(i);
      const aVal = aRaw === undefined ? undefined : norm(aRaw, widthOf.android as number);
      const iVal = iRaw === undefined ? undefined : norm(iRaw, widthOf.ios as number);
      const cVal = want !== undefined && frameWidth > 0 ? norm(want, frameWidth) : undefined;
      const dAc = aVal !== undefined && cVal !== undefined ? aVal - cVal : undefined;
      const dIc = iVal !== undefined && cVal !== undefined ? iVal - cVal : undefined;
      const dAi = aVal !== undefined && iVal !== undefined ? aVal - iVal : undefined;
      entries.push({
        kind: 'field',
        anchor: anchor.id,
        field,
        contract: want,
        android: aRaw,
        ios: iRaw,
        dAc,
        dIc,
        dAi,
      });
      // Absolute y is measured and shown but never a finding — see header.
      if (field === 'y') continue;
      const values = { android: aRaw, ios: iRaw, contract: want };
      addFinding(anchor.id, field, 'android-vs-contract', dAc, values);
      addFinding(anchor.id, field, 'ios-vs-contract', dIc, values);
      addFinding(anchor.id, field, 'android-vs-ios', dAi, values);
    }

    // Gap to the previous anchor (previous bottom → this top): what the
    // layout contract actually specifies, and aspect-independent.
    if (prev !== null) {
      const gaps: Partial<Record<Platform, number>> = {};
      for (const p of platforms) {
        const cur = found[p] as Rect;
        const before = prev.rects[p] as Rect;
        gaps[p] = norm(cur.y - (before.y + before.height), widthOf[p] as number);
      }
      let cGap: number | undefined;
      if (
        anchor.y !== undefined &&
        prev.anchor.y !== undefined &&
        prev.anchor.h !== undefined &&
        frameWidth > 0
      ) {
        cGap = norm(anchor.y - (prev.anchor.y + prev.anchor.h), frameWidth);
      }
      const dAc = gaps.android !== undefined && cGap !== undefined ? gaps.android - cGap : undefined;
      const dIc = gaps.ios !== undefined && cGap !== undefined ? gaps.ios - cGap : undefined;
      const dAi = gaps.android !== undefined && gaps.ios !== undefined ? gaps.android - gaps.ios : undefined;
      entries.push({
        kind: 'field',
        anchor: anchor.id,
        field: 'gap',
        contract: cGap,
        android: gaps.android,
        ios: gaps.ios,
        dAc,
        dIc,
        dAi,
      });
      const gapId = `${prev.anchor.id} -> ${anchor.id}`;
      const values = {
        android: gaps.android,
        ios: gaps.ios,
        contract: cGap === undefined ? undefined : Math.round(cGap * 100) / 100,
      };
      addFinding(gapId, 'gap', 'android-vs-contract', dAc, values);
      addFinding(gapId, 'gap', 'ios-vs-contract', dIc, values);
      addFinding(gapId, 'gap', 'android-vs-ios', dAi, values);
    }

    // Aspect ratio, android-vs-ios only: a same-margin, same-width element
    // can still be the wrong shape.
    if (a !== undefined && i !== undefined) {
      const aAspect = a.height !== 0 ? a.width / a.height : undefined;
      const iAspect = i.height !== 0 ? i.width / i.height : undefined;
      if (aAspect !== undefined && iAspect !== undefined) {
        const spread = (Math.abs(aAspect - iAspect) / Math.max(aAspect, iAspect)) * 100;
        const over = spread > tolerancePct;
        entries.push({
          kind: 'field',
          anchor: anchor.id,
          field: 'aspect',
          android: aAspect,
          ios: iAspect,
          dAi: spread,
          aspectOver: over,
        });
        if (over) {
          findings.push({
            anchor: anchor.id,
            field: 'aspect',
            comparison: 'android-vs-ios',
            delta: spread,
            android: aAspect,
            ios: iAspect,
          });
        }
      }
    }

    prev = { anchor, rects: found };
  }

  return {
    screen: contract.screen ?? '(unnamed)',
    tolerancePct,
    frameWidth,
    platforms: [...platforms],
    anchorCount: contract.anchors.length,
    widths,
    entries,
    missing,
    skipped,
    findings,
    pass: findings.length === 0 && missing.length === 0,
  };
}

/** One-line verdict — the number the caller quotes. */
export function rectParityVerdict(r: RectParityResult): string {
  if (r.pass) {
    return `rect parity: WITHIN TOLERANCE (${r.tolerancePct.toFixed(2)}%) on all ${r.anchorCount} anchor(s).`;
  }
  const bits: string[] = [];
  if (r.findings.length > 0) bits.push(`${r.findings.length} DELTA(S) OVER ${r.tolerancePct.toFixed(2)}%`);
  if (r.missing.length > 0) bits.push(`${r.missing.length} MISSING anchor(s)`);
  return `rect parity: ${bits.join(' + ')}`;
}

/** Python-%g-ish number: no trailing zeros, 6 significant digits. */
const g = (v: number): string => String(Number(v.toPrecision(6)));

const fmtDelta = (v: number | undefined): string =>
  v === undefined ? '  —' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/**
 * Fixed-width table close to the Python script's output:
 * anchor | field | figma | android | ios | a-vs-c | i-vs-c | a-vs-i,
 * with gap^ and aspect rows, then MISSING / findings sections and a verdict.
 * Single-platform runs render only that platform's columns.
 */
export function formatRectParity(r: RectParityResult): string {
  const lines: string[] = [];
  lines.push(`screen: ${r.screen}   tolerance: ${r.tolerancePct.toFixed(2)}% of screen width`);
  lines.push(
    `widths: ${r.widths.map((w) => `${w.platform} ${g(w.width)}`).join('   ')}   figma frame ${g(r.frameWidth)}`,
  );
  const unreliable = r.widths.filter((w) => !w.reliable).map((w) => w.platform);
  if (unreliable.length > 0) {
    lines.push(
      `  ! ${unreliable.join(' + ')}: the widest rect does not start at x=0, so this is a FILTERED tree and`,
      '    the width above is a content width — every delta below is scaled wrong. Re-read the',
      '    tree unfiltered before trusting any number here.',
    );
  }
  lines.push('');

  const both = r.platforms.length === 2;
  const deltaTitles = both ? ['a-vs-c', 'i-vs-c', 'a-vs-i'] : r.platforms[0] === 'android' ? ['a-vs-c'] : ['i-vs-c'];
  const header = [
    'anchor'.padEnd(38),
    'field'.padEnd(7),
    'figma'.padStart(8),
    ...r.platforms.map((p) => p.padStart(8)),
    ...deltaTitles.map((t) => t.padStart(8)),
  ].join(' ');
  lines.push(header, '-'.repeat(header.length));

  let lastAnchor: string | undefined;
  let lastWasField = false;
  for (const e of r.entries) {
    if (lastWasField && e.anchor !== lastAnchor) lines.push('');
    if (e.kind === 'missing') {
      lines.push(`${e.anchor.padEnd(38)} MISSING on ${e.absentOn.join(' + ')}`);
      lastWasField = false;
    } else if (e.kind === 'skipped') {
      lines.push(`${e.anchor.padEnd(38)} skipped — no contract fields to compare on a single-platform run`);
      lastWasField = false;
    } else {
      const anchorCell = e.anchor === lastAnchor && lastWasField ? '' : e.anchor;
      const measured = (v: number | undefined): string =>
        v === undefined ? ''
        : e.field === 'gap' ? `${v.toFixed(2)}%`
        : e.field === 'aspect' ? v.toFixed(3)
        : v.toFixed(1);
      const figmaCell =
        e.contract === undefined ? '' : e.field === 'gap' ? `${e.contract.toFixed(2)}%` : g(e.contract);
      const deltas =
        e.field === 'aspect'
          ? (both ? ['—', '—', `${(e.dAi as number).toFixed(2)}%`] : [])
          : both
            ? [fmtDelta(e.dAc), fmtDelta(e.dIc), fmtDelta(e.dAi)]
            : [fmtDelta(r.platforms[0] === 'android' ? e.dAc : e.dIc)];
      const cells = [
        anchorCell.padEnd(38),
        (e.field === 'gap' ? 'gap^' : e.field).padEnd(7),
        figmaCell.padStart(8),
        ...r.platforms.map((p) => measured(e[p]).padStart(8)),
        ...deltas.map((d) => d.padStart(8)),
      ];
      lines.push(cells.join(' ') + (e.aspectOver ? '  <-- ASPECT' : ''));
      lastWasField = true;
    }
    lastAnchor = e.anchor;
  }
  if (lastWasField) lines.push('');

  if (r.missing.length > 0) {
    lines.push('MISSING ANCHORS — these are not parity findings yet; resolve them first:');
    for (const m of r.missing) lines.push(`  ${m.id}: absent on ${m.absentOn.join(' + ')}`);
    lines.push(
      '  Causes, in order of likelihood: the element is off-screen (scroll, then re-read);',
      '  iOS does not surface plain containers (use a labeled/interactive child id); the id',
      '  was never applied on that platform (that IS a finding — accessibility.md §2).',
      '',
    );
  }

  if (r.findings.length > 0) {
    lines.push(
      `${r.findings.length} DELTA(S) OVER ${r.tolerancePct.toFixed(2)}% — each is a code-fix finding carrying its numbers:`,
    );
    for (const f of r.findings) {
      const unit = f.field === 'aspect' ? '%' : '% of width';
      const bits: string[] = [];
      if (f.android !== undefined) bits.push(`android ${f.android.toFixed(1)}`);
      if (f.ios !== undefined) bits.push(`ios ${f.ios.toFixed(1)}`);
      if (f.contract !== undefined) bits.push(`contract ${g(f.contract)}`);
      lines.push(
        `  ${f.anchor} ${f.field}: ${f.comparison} ${f.delta >= 0 ? '+' : ''}${f.delta.toFixed(2)}${unit} (${bits.join(', ')})`,
      );
    }
    lines.push(
      '',
      'Dispatch these to the implementers verbatim, then RE-MEASURE. A fix that should',
      "change a rect and doesn't is a mis-aimed fix — the card run edited a padding that",
      "wasn't the effective one and only the re-measure exposed it.",
      '',
    );
  }

  lines.push(rectParityVerdict(r));
  return lines.join('\n');
}

/** Expected geometry for a single element — the `rect` assert spec's payload. */
export interface RectExpectation {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Width of the Figma frame the expected values were measured in. */
  frameWidth: number;
  /** Max |delta| in % of screen width (default 2.0). */
  tolerancePct?: number;
}

/**
 * Single-element rect check, same normalization rules as the whole-screen
 * comparator. `y` is measured and reported but NEVER fails the assert —
 * absolute y drifts with device aspect ratio alone; whole-screen gap rows
 * are the vertical-position check.
 */
export function evaluateRectAssert(
  rect: Rect,
  expected: RectExpectation,
  tree: UiNode,
): { pass: boolean; detail: string } {
  const tolerancePct = expected.tolerancePct ?? 2.0;
  const { width, reliable } = inferScreenWidth(tree);
  const parts: string[] = [];
  let pass = true;
  const checks: { field: 'x' | 'y' | 'w' | 'h'; raw: number; want?: number }[] = [
    { field: 'x', raw: rect.x, want: expected.x },
    { field: 'y', raw: rect.y, want: expected.y },
    { field: 'w', raw: rect.width, want: expected.w },
    { field: 'h', raw: rect.height, want: expected.h },
  ];
  for (const { field, raw, want } of checks) {
    if (want === undefined) continue;
    const delta = norm(raw, width) - norm(want, expected.frameWidth);
    const over = Math.abs(delta) > tolerancePct;
    if (field !== 'y' && over) pass = false;
    const suffix = field === 'y' ? ' (measured only, never fails)' : over ? ' OVER' : '';
    parts.push(`${field} ${raw.toFixed(1)} vs contract ${g(want)} → Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%${suffix}`);
  }
  const widthNote = `screen width ${g(width)}${reliable ? '' : ' (UNRELIABLE: widest rect starts inset — filtered tree?)'}`;
  return { pass, detail: `${parts.join(' · ')}; ${widthNote}` };
}

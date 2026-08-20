import type { Platform, UiNode } from '../adapters/types.js';
import { deltaEHex, rgbToHex, type Rgb } from './ciede2000.js';
import { collectRects, inferScreenWidth } from '../ui-tree/geometry.js';
import { positiveTolerance, type LayoutAnchor, type LayoutContract } from './layout-contract.js';
import { headerWithRule, row as tableRow, type Column } from './table.js';

/**
 * Deterministic color parity: sampled device fills vs the layout contract,
 * and vs the other platform. Port of the superrepo's
 * `scripts/color-parity.py` (the semantic source of truth; the script stays
 * as the offline/CI comparator over saved snapshots). averi holds the tree
 * AND the screenshot in one hand, so the rect→pixels join happens here.
 *
 * Why it exists: the screenshot judge cannot see that a card is `base.color4`
 * grey where iOS renders `base.color1` white — exactly that shipped past
 * every gate on 2026-08-13 (own-transfer form/summary cards, Android #CFCFD3
 * where iOS had #FDFDFD) and was caught only by the owner's eye. The color of
 * an anchored region is arithmetic — numbers over impressions.
 *
 * Semantics preserved from the script (live-validated on device 2026-08-14:
 * android scale 1.000 / ios scale 3.000, fixed build dE 0.00, reverted build
 * dE00(#CFCFD3, #FDFDFD) = 10.19):
 * - Dominant sampling: 12% per-edge inset, mode over 4-bit/channel quantized
 *   buckets; the reported hex is the MEAN of the winning bucket's pixels (a
 *   centroid is more honest than the bucket corner). `sample: "patches"` (4
 *   corners inset 15% + center, ~9x9 each, mode over the union) suits busy
 *   centers.
 * - dE(a,i) CIEDE2000 android-vs-ios is the PRIMARY axis (default tolerance
 *   8); each platform vs its contract target runs at 1.5x that — deliberately
 *   looser, because the app background is a gradient and translucent fills
 *   composite to different values per y-position, so both devices drift from
 *   the contract hex together while staying close to each other.
 * - Measured consequence: the real 2026-08-13 bug (10.19) is over the primary
 *   axis (8) but UNDER the default contract axis (12) — a single-platform run
 *   at defaults would MISS it, so the output says "consider tolerance_de 6"
 *   whenever only vs-contract comparisons apply.
 * - Scale is derived per platform at runtime: scale = png_width / tree root
 *   width (widest rect in the WHOLE tree, id-less root included). Never
 *   hardcoded 2x/3x. Degenerate width/scale is an explicit failure, never a
 *   vacuous pass.
 * - An anchor PARTIALLY off-png is clamped and still sampled; when the clip
 *   removes >40% of the rect's area a note flags that the remaining sliver's
 *   dominant may be a neighbor's fill. Fully off-png → MISSING.
 * - Contract `bg` / `bg_dark` accept '#RRGGBB' / '#RRGGBBAA' (alpha dropped).
 *   Token names (`base.color1`) are SKIPPED with a note at this level — token
 *   resolution stays in the superrepo layer (resolve to hex before committing
 *   the contract); averi never reads platform definition files.
 *
 * Known limitations (accepted, same as the script): thin 1-2px strokes are
 * invisible to region sampling; gradients within one anchor produce a
 * dominant that depends on region size (fine for verdicts, don't over-read
 * the absolute hex); dark-mode targets need a device actually captured in
 * dark mode.
 */

export const DEFAULT_TOLERANCE_DE = 8.0;
/** vs-contract multiplier — gradient bg + composited translucent fills. */
export const CONTRACT_TOL_FACTOR = 1.5;
const EDGE_INSET = 0.12;
const PATCH_INSET = 0.15;
const PATCH_SIZE = 9;

const HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const TOKEN_RE = /^[a-z][a-z0-9]*\.color\d+$/;

export type ColorTheme = 'light' | 'dark';
export type ColorSampleMode = 'dominant' | 'patches';

/** Decoded RGBA screenshot — pngjs's `PNG` satisfies this structurally. */
export interface RgbaImage {
  width: number;
  height: number;
  /** 8-bit RGBA, row-major (pngjs normalizes every PNG variant to this). */
  data: Buffer | Uint8Array;
}

type Rect = UiNode['rect'];
type Region = { x0: number; y0: number; x1: number; y1: number };

/** '#RRGGBB(AA)' → '#RRGGBB' uppercase (alpha dropped — see header). */
export const normalizeHex = (raw: string): string => raw.slice(0, 7).toUpperCase();

// ---------------------------------------------------------------- sampling

/**
 * Anchor device rect -> clipped png-pixel region with the 12% edge inset, or
 * undefined when the rect is (effectively) outside the png — off-screen in
 * this capture. A PARTIALLY off-png rect is clamped and still sampled; the
 * caller notes it when the clip removes a meaningful share of the area,
 * because a thin remaining sliver can sample a neighbor's fill.
 */
export function scaledRegion(
  rect: Rect,
  scale: number,
  img: RgbaImage,
): { region: Region; clipped: number } | undefined {
  // Known deviation from the Python port: Math.round rounds half UP where
  // Python's round() is banker's (half to even), so a bound whose scaled
  // product lands exactly on .5 can shift 1px. Accepted deliberately: the
  // 12% edge inset swallows any single-pixel edge, and the fixture tests pin
  // THIS behavior — do not "fix" it to banker's without re-pinning them.
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.width) * scale);
  const y1 = Math.round((rect.y + rect.height) * scale);
  const cx0 = Math.max(x0, 0);
  const cy0 = Math.max(y0, 0);
  const cx1 = Math.min(x1, img.width);
  const cy1 = Math.min(y1, img.height);
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return undefined;
  const full = (x1 - x0) * (y1 - y0);
  const clipped = full > 0 ? 1.0 - ((cx1 - cx0) * (cy1 - cy0)) / full : 0.0;
  const iw = cx1 - cx0;
  const ih = cy1 - cy0;
  const ix = Math.min(Math.floor(iw * EDGE_INSET), Math.floor((iw - 1) / 2));
  const iy = Math.min(Math.floor(ih * EDGE_INSET), Math.floor((ih - 1) / 2));
  return { region: { x0: cx0 + ix, y0: cy0 + iy, x1: cx1 - ix, y1: cy1 - iy }, clipped };
}

/** 5 patches: 4 corners inset 15% + center, each ~9x9 (smaller if tiny). */
export function patchRegions(region: Region): Region[] {
  const { x0, y0, x1, y1 } = region;
  const w = x1 - x0;
  const h = y1 - y0;
  const p = Math.max(1, Math.min(PATCH_SIZE, w, h));
  const centers: [number, number][] = [
    [x0 + w * PATCH_INSET, y0 + h * PATCH_INSET],
    [x1 - w * PATCH_INSET, y0 + h * PATCH_INSET],
    [x0 + w * PATCH_INSET, y1 - h * PATCH_INSET],
    [x1 - w * PATCH_INSET, y1 - h * PATCH_INSET],
    [(x0 + x1) / 2, (y0 + y1) / 2],
  ];
  return centers.map(([cx, cy]) => {
    const px0 = Math.max(x0, Math.min(Math.trunc(cx - p / 2), x1 - p));
    const py0 = Math.max(y0, Math.min(Math.trunc(cy - p / 2), y1 - p));
    return { x0: px0, y0: py0, x1: px0 + p, y1: py0 + p };
  });
}

/**
 * Mode after quantizing to 4 bits/channel; the returned color is the MEAN of
 * the winning bucket's pixels. -> {rgb, share of region} or undefined when
 * the regions are empty. Alpha is ignored — screenshots are opaque; when
 * alpha < 255 appears the caller notes it, modeling compositing here would
 * be dishonest guessing.
 */
export function sampleDominant(
  img: RgbaImage,
  regions: Region[],
): { rgb: Rgb; share: number } | undefined {
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  let total = 0;
  const { data, width } = img;
  for (const { x0, y0, x1, y1 } of regions) {
    for (let y = y0; y < y1; y++) {
      const base = y * width * 4;
      for (let x = x0; x < x1; x++) {
        const o = base + x * 4;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const c = counts.get(k);
        if (c === undefined) {
          counts.set(k, 1);
          sums.set(k, [r, g, b]);
        } else {
          counts.set(k, c + 1);
          const s = sums.get(k) as [number, number, number];
          s[0] += r;
          s[1] += g;
          s[2] += b;
        }
        total++;
      }
    }
  }
  if (total === 0) return undefined;
  let bestKey = -1;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestKey = k;
    }
  }
  const s = sums.get(bestKey) as [number, number, number];
  return {
    rgb: [Math.round(s[0] / bestCount), Math.round(s[1] / bestCount), Math.round(s[2] / bestCount)],
    share: bestCount / total,
  };
}

// ------------------------------------------------------- contract handling

/** Do the contract's anchors opt into color checks at all? */
export function contractHasColorAnchors(contract: LayoutContract): boolean {
  return contract.anchors.some((a) => a.bg !== undefined || a.bg_dark !== undefined || a.sample !== undefined);
}

function sampleModeOf(anchor: LayoutAnchor, id: string): ColorSampleMode {
  const mode = anchor.sample ?? 'dominant';
  if (mode !== 'dominant' && mode !== 'patches') {
    throw new Error(`color parity: anchor ${id}: unknown sample mode ${JSON.stringify(mode)} — "dominant" or "patches".`);
  }
  return mode;
}

type ContractTarget = { kind: 'hex'; hex: string } | { kind: 'token'; token: string } | undefined;

/** Resolved target for one anchor under one theme, or undefined (no bg declared). */
function contractTargetOf(anchor: LayoutAnchor, id: string, theme: ColorTheme): ContractTarget {
  const key = theme === 'dark' ? 'bg_dark' : 'bg';
  const raw = anchor[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(
      `color parity: anchor ${id}: '${key}' is ${JSON.stringify(raw)} — must be a '#RRGGBB(AA)' string or a <hue>.<colorN> token name.`,
    );
  }
  if (HEX_RE.test(raw)) return { kind: 'hex', hex: normalizeHex(raw) };
  if (TOKEN_RE.test(raw)) return { kind: 'token', token: raw };
  throw new Error(
    `color parity: anchor ${id}: '${key}' value '${raw}' is neither #RRGGBB(AA) nor a <hue>.<colorN> token name.`,
  );
}

// --------------------------------------------------------------- pipeline

export interface ColorCapture {
  tree: UiNode;
  png: RgbaImage;
}

export interface ColorPlatformStats {
  platform: Platform;
  pngWidth: number;
  pngHeight: number;
  rootWidth: number;
  scale: number;
  /** False when the widest rect starts inset — filtered tree, content width. */
  reliable: boolean;
  /** Any alpha < 255 in the png — alpha is ignored, RGB used as stored. */
  translucent: boolean;
}

export interface ColorSample {
  hex: string;
  /** Winning bucket's share of the sampled region (mode confidence). */
  share: number;
}

export type ColorComparison = 'android-vs-ios' | 'android-vs-contract' | 'ios-vs-contract';

export interface ColorFinding {
  anchor: string;
  comparison: ColorComparison;
  de: number;
  limit: number;
  /** Measured hexes, e.g. "android #CFCFD3, ios #FDFDFD". */
  detail: string;
}

export interface ColorRow {
  id: string;
  android?: ColorSample;
  ios?: ColorSample;
  deAi?: number;
  deAc?: number;
  deIc?: number;
  verdict: 'OK' | 'FAIL' | 'MISSING' | '—';
  /** Per-platform absence reasons (also set when only ONE platform is absent). */
  absent?: Partial<Record<Platform, string>>;
}

export interface ColorParityResult {
  screen: string;
  theme: ColorTheme;
  toleranceDe: number;
  contractToleranceDe: number;
  platforms: Platform[];
  anchorCount: number;
  stats: ColorPlatformStats[];
  rows: ColorRow[];
  findings: ColorFinding[];
  missing: { id: string; absent: Partial<Record<Platform, string>> }[];
  notes: string[];
  pass: boolean;
}

export interface ColorParityOptions {
  theme?: ColorTheme;
  /**
   * Overrides the contract's `tolerance_de` (default 8). Test-facing only,
   * same stance as rect parity: the tolerance belongs to the committed
   * contract, not to the caller of a run.
   */
  toleranceDe?: number;
}

const SCALE_SANE_MIN = 0.5;
const SCALE_SANE_MAX = 4.0;

/**
 * Per-platform scale and sanity, failing closed on anything degenerate: a
 * 0-width root or a 0-width png would make every region empty and every
 * comparison vacuous.
 */
function statsFor(platform: Platform, capture: ColorCapture): ColorPlatformStats {
  const { tree, png } = capture;
  const { width: rootWidth, reliable } = inferScreenWidth(tree);
  if (rootWidth <= 0) {
    throw new Error(`color parity: ${platform} tree has no usable width — cannot derive a png scale; failing closed.`);
  }
  if (!Number.isFinite(png.width) || png.width <= 0 || !Number.isFinite(png.height) || png.height <= 0) {
    throw new Error(`color parity: ${platform} screenshot has degenerate dimensions ${png.width}x${png.height}; failing closed.`);
  }
  let translucent = false;
  for (let o = 3; o < png.data.length; o += 4) {
    if (png.data[o] < 255) {
      translucent = true;
      break;
    }
  }
  return {
    platform,
    pngWidth: png.width,
    pngHeight: png.height,
    rootWidth,
    scale: png.width / rootWidth,
    reliable,
    translucent,
  };
}

/**
 * One anchor's fill on one platform: locate its rect, scale it into png
 * pixels, sample. Returns either the sample or the reason it is absent —
 * never both — plus any caveats about how trustworthy the sample is.
 */
function sampleAnchor(
  id: string,
  platform: Platform,
  rect: Rect | undefined,
  capture: ColorCapture,
  scale: number,
  mode: ColorSampleMode,
): { sample?: ColorSample; absent?: string; notes: string[] } {
  const notes: string[] = [];
  if (rect === undefined) return { absent: 'no id in tree', notes };
  const got = scaledRegion(rect, scale, capture.png);
  if (got === undefined) return { absent: 'rect outside png (off-screen)', notes };
  if (got.clipped > 0.4) {
    notes.push(
      `${id} [${platform}]: clipped ${Math.round(got.clipped * 100)}% off-png — the remaining sliver's ` +
        `dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row.`,
    );
  }
  const regions = mode === 'patches' ? patchRegions(got.region) : [got.region];
  const s = sampleDominant(capture.png, regions);
  if (s === undefined) return { absent: 'empty sample region', notes };
  if (s.share < 0.4) {
    notes.push(
      `${id} [${platform}]: dominant bucket covers only ${Math.round(s.share * 100)}% of the region — ` +
        `busy content; consider sample: "patches" or a tighter anchor.`,
    );
  }
  return { sample: { hex: rgbToHex(s.rgb), share: s.share }, notes };
}

export function compareColorParity(
  contract: LayoutContract,
  captures: Partial<Record<Platform, ColorCapture>>,
  opts: ColorParityOptions = {},
): ColorParityResult {
  const platforms = (['android', 'ios'] as const).filter((p) => captures[p] !== undefined);
  if (platforms.length === 0) throw new Error('color parity: no platform capture provided');
  const theme = opts.theme ?? 'light';

  const tol = positiveTolerance(
    opts.toleranceDe ?? contract.tolerance_de ?? DEFAULT_TOLERANCE_DE,
    'color parity: tolerance_de',
  );
  const ctol = tol * CONTRACT_TOL_FACTOR;

  // Per-platform stats + scale — failing closed on anything degenerate: a
  // 0-width root or a 0-width png would make every region empty and every
  // comparison vacuous.
  const stats: ColorPlatformStats[] = [];
  const scaleOf: Partial<Record<Platform, number>> = {};
  const rectsOf: Partial<Record<Platform, Map<string, Rect>>> = {};
  for (const p of platforms) {
    const capture = captures[p] as ColorCapture;
    const platformStats = statsFor(p, capture);
    stats.push(platformStats);
    scaleOf[p] = platformStats.scale;
    rectsOf[p] = collectRects(capture.tree);
  }

  const rows: ColorRow[] = [];
  const findings: ColorFinding[] = [];
  const missing: { id: string; absent: Partial<Record<Platform, string>> }[] = [];
  const notes: string[] = [];

  for (const anchor of contract.anchors) {
    const id = anchor.id;
    const mode = sampleModeOf(anchor, id);

    const sampled: Partial<Record<Platform, ColorSample>> = {};
    const absent: Partial<Record<Platform, string>> = {};
    for (const p of platforms) {
      const measured = sampleAnchor(
        id,
        p,
        rectsOf[p]?.get(id),
        captures[p] as ColorCapture,
        scaleOf[p] as number,
        mode,
      );
      notes.push(...measured.notes);
      if (measured.sample === undefined) absent[p] = measured.absent as string;
      else sampled[p] = measured.sample;
    }

    const anyAbsent = Object.keys(absent).length > 0;
    const anySampled = Object.keys(sampled).length > 0;
    if (anyAbsent) missing.push({ id, absent });
    if (!anySampled) {
      rows.push({ id, verdict: 'MISSING', absent });
      continue;
    }

    // Contract target: hex is used; a token name is skipped with a note —
    // token resolution stays in the superrepo layer.
    let targetHex: string | undefined;
    const target = contractTargetOf(anchor, id, theme);
    if (target?.kind === 'token') {
      notes.push(
        `${id}: contract '${target.token}' is a token name — token names resolve in the superrepo ` +
          `layer (put the resolved hex in the contract); vs-contract skipped.`,
      );
    } else if (target?.kind === 'hex') {
      targetHex = target.hex;
    } else if (theme === 'dark' && anchor.bg !== undefined) {
      notes.push(`${id}: no bg_dark in contract — vs-contract skipped under dark theme.`);
    }

    const a = sampled.android;
    const i = sampled.ios;
    let deAi: number | undefined;
    let deAc: number | undefined;
    let deIc: number | undefined;
    if (a && i) {
      deAi = deltaEHex(a.hex, i.hex);
      if (deAi > tol) {
        findings.push({ anchor: id, comparison: 'android-vs-ios', de: deAi, limit: tol, detail: `android ${a.hex}, ios ${i.hex}` });
      }
    }
    if (a && targetHex !== undefined) {
      deAc = deltaEHex(a.hex, targetHex);
      if (deAc > ctol) {
        findings.push({ anchor: id, comparison: 'android-vs-contract', de: deAc, limit: ctol, detail: `android ${a.hex}, contract ${targetHex}` });
      }
    }
    if (i && targetHex !== undefined) {
      deIc = deltaEHex(i.hex, targetHex);
      if (deIc > ctol) {
        findings.push({ anchor: id, comparison: 'ios-vs-contract', de: deIc, limit: ctol, detail: `ios ${i.hex}, contract ${targetHex}` });
      }
    }

    const comparable = deAi !== undefined || deAc !== undefined || deIc !== undefined;
    if (!comparable) {
      notes.push(`${id}: nothing to compare on this run (no usable contract target and only one platform).`);
    }
    rows.push({
      id,
      android: a,
      ios: i,
      deAi,
      deAc,
      deIc,
      verdict: findings.some((f) => f.anchor === id) ? 'FAIL' : comparable ? 'OK' : '—',
      absent: anyAbsent ? absent : undefined,
    });
  }

  return {
    screen: contract.screen ?? '(unnamed)',
    theme,
    toleranceDe: tol,
    contractToleranceDe: ctol,
    platforms: [...platforms],
    anchorCount: contract.anchors.length,
    stats,
    rows,
    findings,
    missing,
    notes,
    pass: findings.length === 0 && missing.length === 0,
  };
}

// -------------------------------------------------------------- rendering

/** One-line verdict — the number the caller quotes. */
export function colorParityVerdict(r: ColorParityResult): string {
  if (r.pass) {
    const n = r.rows.filter((row) => row.verdict !== 'MISSING').length;
    return `color parity: WITHIN TOLERANCE (dE ${r.toleranceDe.toFixed(2)} / contract ${r.contractToleranceDe.toFixed(2)}) on ${n === r.anchorCount ? `all ${n}` : `${n}`} anchor(s).`;
  }
  const bits: string[] = [];
  if (r.findings.length > 0) bits.push(`${r.findings.length} COLOR DELTA(S) OVER TOLERANCE`);
  if (r.missing.length > 0) bits.push(`${r.missing.length} MISSING anchor(s)`);
  return `color parity: ${bits.join(' + ')}`;
}

const fde = (v: number | undefined): string => (v === undefined ? '—' : v.toFixed(2));

/**
 * Fixed-width table close to the Python script's output:
 * anchor | android hex | ios hex | dE(a,i) | dE(a,c) | dE(i,c) | verdict,
 * then notes, MISSING and findings sections, and a verdict line.
 */
export function formatColorParity(r: ColorParityResult): string {
  const lines: string[] = [];
  lines.push(
    `screen: ${r.screen}   theme: ${r.theme}   tolerance: dE(a,i) ${r.toleranceDe.toFixed(2)} · ` +
      `vs-contract ${r.contractToleranceDe.toFixed(2)} (${CONTRACT_TOL_FACTOR}x — gradient bg + composited translucent fills)`,
  );
  for (const p of ['android', 'ios'] as const) {
    const s = r.stats.find((st) => st.platform === p);
    if (s === undefined) {
      let line = `${p}: (not provided — platform-to-platform axis skipped`;
      if (r.toleranceDe > 6) {
        line +=
          '; consider tolerance_de: 6 in the contract — the real 2026-08-13 bug measured dE00 10.19, UNDER the default vs-contract axis';
      }
      lines.push(line + ')');
      continue;
    }
    let line = `${p}: png ${s.pngWidth}x${s.pngHeight}  root ${s.rootWidth}  scale ${s.scale.toFixed(3)}`;
    if (s.scale < SCALE_SANE_MIN || s.scale > SCALE_SANE_MAX) {
      line += `   ! scale outside [${SCALE_SANE_MIN}, ${SCALE_SANE_MAX}] — wrong png/tree pairing?`;
    }
    if (!s.reliable) line += '   ! FILTERED tree (widest rect not at x=0) — scale may be a content width';
    if (s.translucent) line += '   ! alpha<255 pixels present — alpha ignored, RGB used as stored';
    lines.push(line);
  }
  lines.push('');

  const columns: Column[] = [
    { title: 'anchor', width: 38, align: 'left' },
    { title: 'android', width: 9 },
    { title: 'ios', width: 9 },
    { title: 'dE(a,i)', width: 8 },
    { title: 'dE(a,c)', width: 8 },
    { title: 'dE(i,c)', width: 8 },
  ];
  lines.push(...headerWithRule(columns, '  verdict'));
  for (const row of r.rows) {
    if (row.verdict === 'MISSING') {
      const where = Object.entries(row.absent ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, reason]) => `${p} (${reason})`)
        .join(' + ');
      lines.push(`${row.id.padEnd(38)} MISSING on ${where}`);
      continue;
    }
    lines.push(
      tableRow(
        columns,
        [
          row.id,
          row.android?.hex ?? '—',
          row.ios?.hex ?? '—',
          fde(row.deAi),
          fde(row.deAc),
          fde(row.deIc),
        ],
        `  ${row.verdict}`,
      ),
    );
  }
  lines.push('');

  for (const note of r.notes) lines.push(`  note: ${note}`);
  if (r.notes.length > 0) lines.push('');

  if (r.missing.length > 0) {
    lines.push('MISSING ANCHORS — these are not color findings yet; resolve them first:');
    for (const m of r.missing) {
      for (const [p, reason] of Object.entries(m.absent).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${m.id}: ${p} — ${reason}`);
      }
    }
    lines.push(
      '  Causes, in order of likelihood: the element is off-screen in this capture (scroll, then',
      '  re-run so tree AND screenshot come from the same state); iOS does not surface plain',
      '  containers (use a labeled/interactive child id); the id was never applied on that',
      '  platform (that IS a finding — accessibility.md §2).',
      '',
    );
  }

  if (r.findings.length > 0) {
    lines.push(`${r.findings.length} COLOR DELTA(S) OVER TOLERANCE — each is a code-fix finding carrying its numbers:`);
    for (const f of r.findings) {
      lines.push(`  ${f.anchor}: ${f.comparison} dE ${f.de.toFixed(2)} > ${f.limit.toFixed(2)} (${f.detail})`);
    }
    lines.push(
      '',
      'Dispatch these to the implementers verbatim, then RE-MEASURE. A fix that should',
      'change a fill and doesn\'t is a mis-aimed fix — the 2026-08-13 grey card shipped',
      'precisely because nobody re-sampled color after the token edit.',
      '',
    );
  }

  lines.push(colorParityVerdict(r));
  return lines.join('\n');
}

// ------------------------------------------------------- the color assert

/** Expected fill for a single element — the `color` assert spec's payload. */
export interface ColorExpectation {
  /** '#RRGGBB' or '#RRGGBBAA' (alpha dropped). Hex only — token names resolve in the superrepo layer. */
  expected: string;
  /** Max CIEDE2000 (default 8). Compared DIRECTLY — no 1.5x contract slack here: the caller chose the hex. */
  deltaE?: number;
  sample?: ColorSampleMode;
  /**
   * Declarative annotation only: names the theme `expected` was authored for.
   * averi does not switch device themes — the device must actually be
   * captured in this theme for the check to mean anything.
   */
  theme?: ColorTheme;
}

/**
 * Single-element fill check: sample the element's region from the screenshot
 * and compare CIEDE2000 against the expected hex. Fails closed on degenerate
 * width/scale, an off-png rect, or an empty region — never a vacuous pass.
 */
export function evaluateColorAssert(
  rect: Rect,
  expectation: ColorExpectation,
  tree: UiNode,
  png: RgbaImage,
): { pass: boolean; detail: string } {
  const tol = expectation.deltaE ?? DEFAULT_TOLERANCE_DE;
  const { width, reliable } = inferScreenWidth(tree);
  if (width <= 0) {
    return {
      pass: false,
      detail:
        'screen width could not be inferred (the widest rect in the tree is 0 wide) — ' +
        'cannot derive the png scale; failing closed, color unchecked',
    };
  }
  if (!Number.isFinite(png.width) || png.width <= 0) {
    return { pass: false, detail: `screenshot has degenerate width ${png.width}; failing closed, color unchecked` };
  }
  const scale = png.width / width;
  const got = scaledRegion(rect, scale, png);
  if (got === undefined) {
    return {
      pass: false,
      detail: `element rect is outside the screenshot (off-screen in this capture; scale ${scale.toFixed(3)}) — scroll it on-screen and re-run; failing closed`,
    };
  }
  const mode: ColorSampleMode = expectation.sample ?? 'dominant';
  const regions = mode === 'patches' ? patchRegions(got.region) : [got.region];
  const s = sampleDominant(png, regions);
  if (s === undefined) {
    return { pass: false, detail: 'sample region is empty after inset/clamp; failing closed, color unchecked' };
  }
  const hex = rgbToHex(s.rgb);
  const expectedHex = normalizeHex(expectation.expected);
  const de = deltaEHex(hex, expectedHex);
  const pass = de <= tol;
  const notes: string[] = [];
  if (got.clipped > 0.4) {
    notes.push(`clipped ${Math.round(got.clipped * 100)}% off-png — the sampled sliver may be a neighbor's fill`);
  }
  if (s.share < 0.4) {
    notes.push(`dominant bucket covers only ${Math.round(s.share * 100)}% of the region — busy content; consider sample: "patches"`);
  }
  if (!reliable) notes.push('screen width UNRELIABLE (widest rect starts inset — filtered tree?)');
  if (scale < SCALE_SANE_MIN || scale > SCALE_SANE_MAX) {
    notes.push(`scale ${scale.toFixed(3)} outside [${SCALE_SANE_MIN}, ${SCALE_SANE_MAX}] — wrong png/tree pairing?`);
  }
  return {
    pass,
    detail:
      `sampled ${hex} (${mode}, ${Math.round(s.share * 100)}% of region) vs expected ${expectedHex} → ` +
      `dE00 ${de.toFixed(2)} ${pass ? '≤' : '>'} ${tol}; scale ${scale.toFixed(3)}` +
      (notes.length > 0 ? `; ${notes.join('; ')}` : ''),
  };
}

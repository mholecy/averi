import type { Platform, UiNode } from '../adapters/types.js';
import { collectRects } from '../ui-tree/geometry.js';
import { pngScale, type DeviceScreen } from './scale.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { positiveTolerance, type LayoutAnchor, type LayoutContract } from './layout-contract.js';
import type { OcrLine, OcrRegion, OcrRegionResult } from './ocr.js';
import { headerWithRule, row as tableRow, type Column } from './table.js';

/**
 * Deterministic text parity: the copy an anchor RENDERS, compared
 * platform-to-platform and against the layout contract — plus the rendered type
 * SIZE, which falls out of the same measurement.
 *
 * Why it exists: the screenshot judge silently passed two whole classes of
 * drift on 2026-08-13/14 — placeholder copy ('Enter amount' on iOS vs '0.00' on
 * Android) and a visibly different top-bar title size (22sp vs ~17pt), the
 * latter caught only by the owner's eye. Both are arithmetic once the strings
 * and their ink boxes are in hand — numbers over impressions.
 *
 * TWO SOURCES, deliberately kept apart (all of this measured on the live
 * payment form, both platforms, 2026-08-14):
 *
 * - The TREE is what assistive technology is told. It is NOT a record of
 *   rendered copy: on iOS, SwiftUI collapses a card or button into one element
 *   whose `label` is an authored a11y summary — `credit_select` says
 *   'To account' while the screen reads 'Select credit account', and the
 *   visible 'CONTINUE' is absent from the tree entirely. Tree-only parity
 *   therefore covered 2 of 7 payment-form anchors.
 * - OCR is what the user SEES. It covered every anchor measured, at confidence
 *   1.0, including both the tree cannot see.
 *
 * Rules that follow from those measurements, each of which cost a real
 * false-positive class:
 *
 * 1. NEVER compare `label` of a non-text node. Authored a11y summaries differ
 *    legitimately between platforms; diffing them would fire on nearly every
 *    anchor for reasons that are not copy drift. Only `role === 'text'` labels
 *    and `role === 'textfield'` VALUES count as rendered copy.
 * 2. NEVER read `label` on a textfield. Android's adapter falls back
 *    `label = contentDesc ?? text`, so a filled field's label mirrors its value
 *    ('123') while iOS keeps `label = null` — reading it would report a drift on
 *    every filled field on every screen.
 * 3. ALL nodes carrying the id contribute, not just the first. This diverges
 *    from rect/color parity's first-occurrence-wins on purpose: SwiftUI
 *    propagates one `accessibilityIdentifier` to every leaf, so
 *    `payment.form.amount_input` matches three nodes and the placeholder text
 *    is on the SECOND — first-wins would read the textfield and miss the copy
 *    entirely.
 * 4. Compare OCR against OCR, or tree against tree — never one platform's OCR
 *    against the other's tree. Mixed sources would compare two different
 *    questions and call the difference a finding.
 * 5. Ink height is compared ONLY where the two strings are identical. Different
 *    glyphs have different ink extents (descenders, all-caps), so a height
 *    comparison across differing text is meaningless. Dynamic anchors are
 *    therefore never size-checked either — their strings legitimately differ.
 *
 * Validation pairs (measured, and pinned in the tests): `CONTINUE` reads
 * android 2.96% vs ios 2.99% of screen width — 0.74% apart, PASS; the top-bar
 * title reads 3.80% vs 3.32% — 12.63% apart, FAIL. The tolerance sits between
 * them with margin on both sides.
 */

/** Max relative ink-height difference, in %, before a size row is a finding. */
export const DEFAULT_SIZE_TOLERANCE_PCT = 10.0;

export type TextComparison = 'android-vs-ios' | 'android-vs-contract' | 'ios-vs-contract';
export type TextField = 'text' | 'size';
/** Which measurement the strings on a row came from — never mixed (rule 4). */
export type TextSource = 'ocr' | 'tree';

export interface TextFinding {
  anchor: string;
  field: TextField;
  comparison: TextComparison;
  /** Size findings only: relative difference in %, always over tolerance. */
  delta?: number;
  /** Measured strings / percentages, ready to quote. */
  detail: string;
}

export interface TextMeasurement {
  /** Rendered copy per rule 1/2/3, joined and whitespace-normalized. */
  tree: string;
  /** Recognized copy, joined and whitespace-normalized; absent when OCR did not run. */
  ocr?: string;
  /** Ink height in % of screen width — single-line anchors only (rule 5). */
  inkPct?: number;
}

export interface TextRow {
  id: string;
  source: TextSource;
  android?: TextMeasurement;
  ios?: TextMeasurement;
  contract?: string;
  /** Relative ink-height difference in %, when both platforms offered one. */
  sizeDelta?: number;
  dynamic: boolean;
  verdict: 'OK' | 'FAIL' | 'MISSING' | 'OCCLUDED' | '—';
  absent?: Partial<Record<Platform, string>>;
}

export interface TextParityResult {
  screen: string;
  sizeTolerancePct: number;
  platforms: Platform[];
  anchorCount: number;
  /** Anchors the contract opted into a text check for. */
  checkedCount: number;
  rows: TextRow[];
  findings: TextFinding[];
  missing: { id: string; absent: Partial<Record<Platform, string>> }[];
  /** Anchors whose rect was covered in the capture — resolve before reading the row. */
  occluded: { id: string; covered: Partial<Record<Platform, string>> }[];
  notes: string[];
  pass: boolean;
}

/** One platform's inputs. `ocr`/`pngWidth` are present only when OCR ran. */
export interface TextCapture {
  tree: UiNode;
  /** Recognizer output keyed by anchor id. */
  ocr?: Map<string, OcrRegionResult>;
  /** PNG width in pixels — the normalizer for ink height. Required with `ocr`. */
  pngWidth?: number;
}

export interface TextParityOptions {
  /**
   * Overrides the contract's `tolerance_size_pct`. Test-facing only, same
   * stance as rect and color parity: the tolerance belongs to the committed
   * contract, not to the caller of a run.
   */
  sizeTolerancePct?: number;
}

// ------------------------------------------------------------- extraction

/**
 * Whitespace-normalized for comparison: runs of any space (including NBSP and
 * narrow NBSP, which locale-formatted amounts use) collapse to one, ends
 * trimmed. Case is deliberately NOT normalized — both platforms were measured
 * rendering the same casing, so a case difference is a real finding.
 */
export const normalizeText = (raw: string): string => raw.replace(/[\s  ]+/g, ' ').trim();

/**
 * The copy an anchor renders, per rules 1-3: every node carrying the id, plus
 * its descendants; `label` of text nodes and `value` of fields; nothing else.
 */
export function renderedTextFromTree(tree: UiNode, id: string): string[] {
  const matches = findBySpec(tree, { id });
  // `findBySpec` returns ancestors AND their matching descendants, so when an
  // id sits on a container and again on the text node inside it — which is
  // exactly what identifier propagation produces — walking every match would
  // collect the leaf once per ancestor and report 'Enter amount Enter amount'
  // as a copy drift. Walk only the OUTERMOST matches; their walk already
  // reaches the rest.
  const inner = new Set<UiNode>();
  const markDescendants = (n: UiNode): void => {
    for (const child of n.children) {
      inner.add(child);
      markDescendants(child);
    }
  };
  for (const m of matches) markDescendants(m);

  const out: string[] = [];
  const walk = (n: UiNode): void => {
    if (n.role === 'text' && n.label !== null) out.push(n.label);
    // Rule 2: a field's VALUE is rendered copy; its label is not.
    else if (n.role === 'textfield' && n.value !== null) out.push(n.value);
    n.children.forEach(walk);
  };
  for (const node of matches) if (!inner.has(node)) walk(node);
  return out;
}

/**
 * Did a tree string survive into the recognized reading? Used ONLY by the
 * UNREAD guard, to ask "did this copy vanish", never to judge copy drift — so
 * it is deliberately forgiving where the two sources differ for known,
 * innocent reasons:
 *
 * - CASE. Android's accessibility tree reports the UNTRANSFORMED text, so a
 *   Material button with `textAllCaps` exposes 'Continue' while rendering
 *   'CONTINUE'. A case-sensitive test would mark every such button UNREAD and
 *   fail the run.
 * - TRUNCATION. An ellipsized TextView renders 'Select credit acc…' where the
 *   tree holds the full string, so the reading is a PREFIX of the tree value.
 *
 * Drift comparison stays exact (`normalizeText` only collapses whitespace) —
 * a real case change is a real finding, and this leniency must not leak there.
 */
function survivesIn(treeString: string, seen: string): boolean {
  const want = treeString.toLowerCase();
  const got = seen.toLowerCase();
  if (got.includes(want)) return true;
  // Ellipsized render: drop the ellipsis and accept a prefix of the tree value.
  const head = got.replace(/[…\.]+$/, '').trim();
  return head.length >= 3 && want.startsWith(head);
}

/**
 * Does the anchor carry ANY accessible name at all — on the id-bearing nodes or
 * their descendants? Used only to word the a11y note: text that is rendered but
 * reachable by no label, value or text node is invisible to a screen reader.
 * Measured case: Android's amount placeholder renders '0.00' from a Compose
 * `Text` with no semantics, and the field exposes `label = value = null`.
 */
function hasAccessibleName(tree: UiNode, id: string): boolean {
  let found = false;
  const walk = (n: UiNode): void => {
    if (n.label !== null || n.value !== null) found = true;
    else n.children.forEach(walk);
  };
  for (const node of findBySpec(tree, { id })) walk(node);
  return found;
}

/**
 * Anchor rects scaled into PNG pixels, ready for the recognizer. Lives here so
 * the run layer stays thin, and takes the png width rather than the image so it
 * is testable without decoding anything.
 *
 * Unlike color sampling there is NO edge inset: an inset crop clips glyphs and
 * the recognizer then reads a different string. Rects ARE clamped to the png
 * (see ocrRegionForRect); anchors fully outside it are omitted and surface as
 * OCR-less rows.
 *
 * Returns the scale's own caveat alongside the regions — the device and the
 * tree disagreeing is a whole-capture fact, so the table says it once per
 * platform rather than once per anchor (run/verify.ts pushes it).
 *
 * THROWS when the SCALE itself is unusable — that is a whole-capture fault,
 * not a per-anchor one, so returning an empty list would read to the caller as
 * "this screen has no text anchors" and quietly drop the entire text table.
 * run/verify.ts contains the throw as a per-platform note.
 */
export function ocrRegionsFor(
  contract: LayoutContract,
  tree: UiNode,
  pngWidth: number,
  pngHeight: number,
  screen?: DeviceScreen,
): { regions: OcrRegion[]; note?: string } {
  const scaled = pngScale(tree, pngWidth, pngHeight, screen);
  if (scaled.error !== undefined) throw new Error(`text parity: ${scaled.error}; failing closed`);
  const rects = collectRects(tree);
  const regions: OcrRegion[] = [];
  for (const anchor of contract.anchors) {
    if (!wantsTextCheck(anchor)) continue;
    const rect = rects.get(anchor.id);
    if (rect === undefined) continue;
    const region = regionForRect(anchor.id, rect, scaled.scale, pngWidth, pngHeight);
    if (region !== undefined) regions.push(region);
  }
  return { regions, note: scaled.note };
}

/**
 * One rect scaled into png pixels and CLAMPED to the image, or the reason
 * there is no region — the caller must report that reason, never silently
 * pass. Discriminated so `{}` cannot type-check: a caller that reads `error`
 * after a failed `region` check always has a string, never "undefined".
 *
 * Clamping is not cosmetic. iOS keeps off-viewport nodes in the tree with
 * negative or oversized rects; handed one of those unclamped, `CGImage`
 * silently intersects the crop, and the ink measured inside that clipped crop
 * would be normalized as if it were the whole anchor — a phantom type-size
 * delta built out of a partly off-screen element.
 */
export function ocrRegionForRect(
  id: string,
  rect: UiNode['rect'],
  tree: UiNode,
  pngWidth: number,
  pngHeight: number,
  screen?: DeviceScreen,
): { region: OcrRegion; note?: string; error?: undefined } | { region?: undefined; note?: undefined; error: string } {
  const scaled = pngScale(tree, pngWidth, pngHeight, screen);
  if (scaled.error !== undefined) return { error: scaled.error };
  const region = regionForRect(id, rect, scaled.scale, pngWidth, pngHeight);
  return region === undefined
    ? { error: `element rect ${rect.x},${rect.y} ${rect.width}x${rect.height} scaled by ${scaled.scale.toFixed(3)} leaves nothing on-screen` }
    : { region, note: scaled.note };
}

/** The scaled-and-clamped crop itself, shared by both callers above. */
function regionForRect(
  id: string,
  rect: UiNode['rect'],
  scale: number,
  pngWidth: number,
  pngHeight: number,
): OcrRegion | undefined {
  const x0 = Math.max(0, Math.round(rect.x * scale));
  const y0 = Math.max(0, Math.round(rect.y * scale));
  const x1 = Math.min(pngWidth, Math.round((rect.x + rect.width) * scale));
  const y1 = Math.min(pngHeight, Math.round((rect.y + rect.height) * scale));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return undefined;
  return { id, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ------------------------------------------------------- contract handling

/** Does this anchor opt into a text/size check at all? */
function wantsTextCheck(anchor: LayoutAnchor): boolean {
  return anchor.text !== undefined || anchor.text_dynamic !== undefined;
}

/** Do the contract's anchors opt into text checks at all? */
export function contractHasTextAnchors(contract: LayoutContract): boolean {
  return contract.anchors.some(wantsTextCheck);
}

function expectedTextOf(anchor: LayoutAnchor): string | undefined {
  const raw = anchor.text;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(
      `text parity: anchor ${anchor.id}: 'text' is ${JSON.stringify(raw)} — must be the exact rendered string.`,
    );
  }
  return normalizeText(raw);
}

function isDynamic(anchor: LayoutAnchor): boolean {
  const raw = anchor.text_dynamic;
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') {
    throw new Error(
      `text parity: anchor ${anchor.id}: 'text_dynamic' is ${JSON.stringify(raw)} — must be true or false.`,
    );
  }
  return raw;
}

// --------------------------------------------------------------- pipeline

/**
 * Ink height for a SINGLE-line anchor, in % of screen width. Multi-line runs
 * are deliberately refused: their per-line boxes do not compose into one
 * meaningful height, and a number that lies is worse than no number.
 */
function inkPctOf(lines: OcrLine[], pngWidth: number): number | undefined {
  if (lines.length !== 1 || pngWidth <= 0) return undefined;
  return (lines[0].h / pngWidth) * 100;
}

function measure(
  anchor: LayoutAnchor,
  platform: Platform,
  capture: TextCapture,
): { measurement?: TextMeasurement; absent?: string; note?: string; occluded?: string } {
  const id = anchor.id;
  if (findBySpec(capture.tree, { id }).length === 0) return { absent: 'no id in tree' };

  const treeStrings = renderedTextFromTree(capture.tree, id);
  const measurement: TextMeasurement = { tree: normalizeText(treeStrings.join(' ')) };

  const ocrResult = capture.ocr?.get(id);
  if (ocrResult !== undefined && ocrResult.error === undefined) {
    const lines = ocrResult.lines;
    measurement.ocr = normalizeText(lines.map((l) => l.text).join(' '));
    measurement.inkPct = inkPctOf(lines, capture.pngWidth ?? 0);
  }

  // Occlusion guard. The tree reports an element's LAYOUT rect; the screenshot
  // shows whatever is drawn on top of it. Measured 2026-08-14: with the amount
  // field focused, the IME covered the CTA, so the tree still placed
  // `continue_button` at its layout position while OCR of that region read the
  // keypad — a confident, wrong string that the comparator would otherwise have
  // reported as copy drift.
  //
  // The test is deliberately narrow: flag only when the tree offers rendered
  // strings and NONE of them survive in the reading. A partial mismatch is
  // normal (OCR merges and reorders lines a tree keeps separate), so requiring
  // total disappearance is what keeps this from firing on healthy anchors.
  //
  // The message names the CANDIDATE causes and does not pick one. Occlusion is
  // the common case, but the identical signal is produced by text rendered at
  // unreadable contrast — which is a REAL defect of exactly the kind this loop
  // exists to catch, and must not be waved away as a capture problem. So the
  // row is withheld from the copy-drift findings (comparing it would dispatch a
  // phantom string diff) while still failing the run and demanding a look.
  if (measurement.ocr !== undefined && treeStrings.length > 0) {
    const seen = measurement.ocr;
    const substantial = treeStrings.map(normalizeText).filter((s) => s.length >= 2);
    if (substantial.length > 0 && !substantial.some((s) => survivesIn(s, seen))) {
      return {
        measurement,
        occluded:
          `the tree renders ${JSON.stringify(substantial.join(' '))} but the screenshot region reads ` +
          `${JSON.stringify(seen === '' ? '(nothing)' : seen)} — UNREAD, cause not determined. Either ` +
          'something is drawn over the layout rect (a keyboard, sheet or dialog — the usual case), or ' +
          'the text is rendered at a contrast the recognizer cannot resolve, which would be a real ' +
          'defect. LOOK AT THE SCREENSHOT before dismissing this row',
      };
    }
  }

  // The a11y observation, worded narrowly: text is on screen, and NOTHING
  // under this id carries a name for it. (An authored summary that merely
  // differs from the rendered copy — the iOS button case — is a design
  // choice, not a defect, and must not be reported as one.)
  const note =
    measurement.ocr !== undefined && measurement.ocr !== '' && !hasAccessibleName(capture.tree, id)
      ? `${id} [${platform}]: renders ${JSON.stringify(measurement.ocr)} but carries no label, value or text ` +
        `node — the copy is invisible to assistive technology (accessibility.md §2).`
      : undefined;

  return { measurement, note };
}

export function compareTextParity(
  contract: LayoutContract,
  captures: Partial<Record<Platform, TextCapture>>,
  opts: TextParityOptions = {},
): TextParityResult {
  const platforms = (['android', 'ios'] as const).filter((p) => captures[p] !== undefined);
  if (platforms.length === 0) throw new Error('text parity: no platform capture provided');

  const sizeTolerancePct = positiveTolerance(
    opts.sizeTolerancePct ?? contract.tolerance_size_pct ?? DEFAULT_SIZE_TOLERANCE_PCT,
    'text parity: tolerance_size_pct',
  );

  const rows: TextRow[] = [];
  const findings: TextFinding[] = [];
  const missing: { id: string; absent: Partial<Record<Platform, string>> }[] = [];
  const occluded: { id: string; covered: Partial<Record<Platform, string>> }[] = [];
  const notes: string[] = [];
  let checkedCount = 0;

  for (const anchor of contract.anchors) {
    if (!wantsTextCheck(anchor)) continue;
    checkedCount++;
    const id = anchor.id;
    const expected = expectedTextOf(anchor);
    const dynamic = isDynamic(anchor);

    const measured: Partial<Record<Platform, TextMeasurement>> = {};
    const absent: Partial<Record<Platform, string>> = {};
    const covered: Partial<Record<Platform, string>> = {};
    for (const p of platforms) {
      const got = measure(anchor, p, captures[p] as TextCapture);
      if (got.note !== undefined) notes.push(got.note);
      if (got.occluded !== undefined) covered[p] = got.occluded;
      if (got.measurement === undefined) absent[p] = got.absent as string;
      else measured[p] = got.measurement;
    }

    const anyAbsent = Object.keys(absent).length > 0;
    if (anyAbsent) missing.push({ id, absent });
    if (Object.keys(measured).length === 0) {
      rows.push({ id, source: 'tree', verdict: 'MISSING', absent, dynamic, contract: expected });
      continue;
    }

    // Rule 4: one source for the whole row. OCR only when EVERY present
    // platform has it, so the two sides answer the same question.
    const present = platforms.filter((p) => measured[p] !== undefined);
    const source: TextSource = present.every((p) => measured[p]?.ocr !== undefined) ? 'ocr' : 'tree';
    if (source === 'tree' && present.some((p) => measured[p]?.ocr !== undefined)) {
      notes.push(
        `${id}: OCR ran on only some platforms — compared from the tree instead, which reads ` +
          `authored accessibility labels rather than rendered copy on iOS. Treat this row as weaker evidence.`,
      );
    }
    const seen = (p: Platform): string | undefined => {
      const m = measured[p];
      if (m === undefined) return undefined;
      return source === 'ocr' ? m.ocr : m.tree;
    };

    // A platform that yielded NO string on the chosen source has not been read
    // — it must never be compared as the empty string. On the tree source this
    // is the normal iOS shape, not an anomaly: the header's own measurement is
    // that a SwiftUI button's visible label is absent from the tree entirely,
    // so `'' vs 'CONTINUE'` would dispatch a confident phantom drift on every
    // non-macOS host, every missing toolchain and every per-region OCR error —
    // precisely the fallback the run layer advertises as WEAKER evidence.
    for (const p of present) {
      // A reason already set by `measure` is the more specific one (it knows
      // the tree DID carry copy) — never overwrite it with this generic case.
      if (covered[p] !== undefined || seen(p) !== '') continue;
      covered[p] =
        source === 'tree'
          ? 'the accessibility tree exposes no rendered copy for this anchor (on iOS a button or card ' +
            'collapses into one authored a11y label) — the tree cannot answer what it renders; run with OCR'
          : 'the recognizer read nothing in this rect and the tree offers no copy either — nothing to compare';
    }

    // An UNREAD anchor is a CAPTURE problem, not a code problem — the same
    // stance MISSING gets. Comparing it would dispatch a phantom copy drift to
    // implementers, which is the one outcome this whole table exists to avoid.
    if (Object.keys(covered).length > 0) {
      occluded.push({ id, covered });
      rows.push({
        id,
        source,
        android: measured.android,
        ios: measured.ios,
        contract: expected,
        dynamic,
        verdict: 'OCCLUDED',
        absent: anyAbsent ? absent : undefined,
      });
      continue;
    }

    const before = findings.length;

    if (!dynamic) {
      const a = seen('android');
      const i = seen('ios');
      if (a !== undefined && i !== undefined && a !== i) {
        findings.push({
          anchor: id,
          field: 'text',
          comparison: 'android-vs-ios',
          detail: `android ${JSON.stringify(a)}, ios ${JSON.stringify(i)} (from ${source})`,
        });
      }
      if (expected !== undefined) {
        for (const p of present) {
          const got = seen(p) as string;
          if (got !== expected) {
            findings.push({
              anchor: id,
              field: 'text',
              comparison: p === 'android' ? 'android-vs-contract' : 'ios-vs-contract',
              detail: `${p} ${JSON.stringify(got)}, contract ${JSON.stringify(expected)} (from ${source})`,
            });
          }
        }
      }
    }

    // Rule 5: size only where both sides rendered the SAME single-line string.
    let sizeDelta: number | undefined;
    const aInk = measured.android?.inkPct;
    const iInk = measured.ios?.inkPct;
    const sameString = !dynamic && seen('android') !== undefined && seen('android') === seen('ios');
    if (aInk !== undefined && iInk !== undefined && sameString) {
      // Relative to the LARGER value — the same spread convention rect
      // parity's aspect row uses, so one number means one thing across tables.
      sizeDelta = (Math.abs(aInk - iInk) / Math.max(aInk, iInk)) * 100;
      if (sizeDelta > sizeTolerancePct) {
        findings.push({
          anchor: id,
          field: 'size',
          comparison: 'android-vs-ios',
          delta: sizeDelta,
          detail: `android ${aInk.toFixed(2)}% of width, ios ${iInk.toFixed(2)}% — ${sizeDelta.toFixed(2)}% apart`,
        });
      }
    }

    const comparable =
      (!dynamic && (expected !== undefined || present.length === 2)) || sizeDelta !== undefined;
    if (!comparable) {
      notes.push(
        `${id}: nothing to compare on this run` +
          (dynamic ? ' (text_dynamic: literal comparison is skipped by design).' : ' (no contract text and only one platform).'),
      );
    }

    rows.push({
      id,
      source,
      android: measured.android,
      ios: measured.ios,
      contract: expected,
      sizeDelta,
      dynamic,
      verdict: findings.length > before ? 'FAIL' : comparable ? 'OK' : '—',
      absent: anyAbsent ? absent : undefined,
    });
  }

  return {
    screen: contract.screen ?? '(unnamed)',
    sizeTolerancePct,
    platforms: [...platforms],
    anchorCount: contract.anchors.length,
    checkedCount,
    rows,
    findings,
    missing,
    occluded,
    notes,
    pass: findings.length === 0 && missing.length === 0 && occluded.length === 0,
  };
}

// -------------------------------------------------------------- rendering

/** One-line verdict — the number the caller quotes. */
export function textParityVerdict(r: TextParityResult): string {
  if (r.pass) {
    const n = r.rows.filter((row) => row.verdict !== 'MISSING').length;
    return `text parity: MATCHES (size tolerance ${r.sizeTolerancePct.toFixed(2)}%) on ${n} of ${r.anchorCount} anchor(s) — ${r.anchorCount - r.checkedCount} not opted in.`;
  }
  const bits: string[] = [];
  const text = r.findings.filter((f) => f.field === 'text').length;
  const size = r.findings.filter((f) => f.field === 'size').length;
  if (text > 0) bits.push(`${text} COPY DRIFT(S)`);
  if (size > 0) bits.push(`${size} TYPE SIZE DELTA(S) OVER ${r.sizeTolerancePct.toFixed(2)}%`);
  if (r.missing.length > 0) bits.push(`${r.missing.length} MISSING anchor(s)`);
  if (r.occluded.length > 0) bits.push(`${r.occluded.length} OCCLUDED anchor(s)`);
  return `text parity: ${bits.join(' + ')}`;
}

const clip = (s: string | undefined, width: number): string =>
  s === undefined ? '—' : s === '' ? '(none)' : s.length <= width ? s : `${s.slice(0, width - 1)}…`;

/**
 * anchor | source | android | ios | contract | Δsize, then notes, MISSING and
 * findings sections, and a verdict line — the same shape as the rect and color
 * tables so the loop learns one layout.
 */
export function formatTextParity(r: TextParityResult): string {
  const lines: string[] = [];
  lines.push(
    `screen: ${r.screen}   size tolerance: ${r.sizeTolerancePct.toFixed(2)}% relative ink height   ` +
      `anchors checked: ${r.checkedCount}/${r.anchorCount}`,
  );
  lines.push(
    '  source "ocr" = what the screen renders; "tree" = what accessibility exposes, which on iOS is an',
    '  authored summary, not the visible copy. Ink height is compared only where both strings match.',
  );
  lines.push('');

  const W = 24;
  const columns: Column[] = [
    { title: 'anchor', width: 32, align: 'left' },
    { title: 'src', width: 5, align: 'left' },
    ...r.platforms.map((p) => ({ title: p, width: W, align: 'left' as const })),
    { title: 'contract', width: W, align: 'left' },
    { title: 'Δsize', width: 7 },
  ];
  lines.push(...headerWithRule(columns, '  verdict'));
  for (const row of r.rows) {
    if (row.verdict === 'MISSING') {
      const where = Object.entries(row.absent ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, reason]) => `${p} (${reason})`)
        .join(' + ');
      lines.push(`${row.id.padEnd(32)} MISSING on ${where}`);
      continue;
    }
    const shown = (p: Platform): string => {
      const m = row[p];
      if (m === undefined) return '—';
      return clip(row.source === 'ocr' ? m.ocr : m.tree, W);
    };
    lines.push(
      tableRow(
        columns,
        [
          row.id,
          row.source,
          ...r.platforms.map(shown),
          row.dynamic ? '(dynamic)' : clip(row.contract, W),
          row.sizeDelta === undefined ? '—' : `${row.sizeDelta.toFixed(2)}%`,
        ],
        `  ${row.verdict}`,
      ),
    );
  }
  lines.push('');

  for (const note of r.notes) lines.push(`  note: ${note}`);
  if (r.notes.length > 0) lines.push('');

  if (r.missing.length > 0) {
    lines.push('MISSING ANCHORS — these are not text findings yet; resolve them first:');
    for (const m of r.missing) {
      for (const [p, reason] of Object.entries(m.absent).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${m.id}: ${p} — ${reason}`);
      }
    }
    lines.push('');
  }

  if (r.occluded.length > 0) {
    lines.push('UNREAD ANCHORS — the tree has copy the screenshot does not show; NOT compared as drift:');
    for (const o of r.occluded) {
      for (const [p, reason] of Object.entries(o.covered).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${o.id}: ${p} — ${reason}`);
      }
    }
    lines.push(
      '  Usually an overlay: a focused field raises the IME over the bottom of the screen and the',
      '  tree still reports the covered element at its layout rect — dismiss it and re-run.',
      '  But the SAME signal means text rendered at unreadable contrast, which is a finding, not',
      '  substrate. Open the returned screenshot and decide which one you are looking at before',
      '  re-running; a row cleared by a re-run was an overlay, a row that persists was not.',
      '',
    );
  }

  if (r.findings.length > 0) {
    lines.push(`${r.findings.length} TEXT FINDING(S) — each is a code-fix finding carrying its numbers:`);
    for (const f of r.findings) {
      lines.push(`  ${f.anchor} ${f.field}: ${f.comparison} — ${f.detail}`);
    }
    lines.push(
      '',
      'Copy drift is a SPEC question before it is a code question: check which side matches the',
      'Figma frame and the feature spec before dispatching a fix — the 2026-08-14 amount placeholder',
      "drift ('0.00' vs 'Enter amount') had Figma on iOS's side, and guessing would have fixed the",
      'wrong platform.',
      '',
    );
  }

  lines.push(textParityVerdict(r));
  return lines.join('\n');
}

// --------------------------------------------------------- the ocr assert

/** Expected rendered text/size for a single element — the `ocr` assert payload. */
export interface OcrExpectation {
  text?: string;
  match?: string;
  /** Ink height in % of screen width. */
  heightPct?: number;
  /** Relative tolerance for heightPct, in % (default DEFAULT_SIZE_TOLERANCE_PCT). */
  tolerancePct?: number;
}

/**
 * Single-element rendered-text check over one region's recognizer output.
 * Pure: the caller does the cropping and recognizing, this decides the verdict,
 * so the whole decision is testable without a Swift toolchain.
 *
 * Fails closed when nothing was recognized — an element whose text could not be
 * read is unverified, not verified-as-empty.
 */
export function evaluateOcrAssert(
  expectation: OcrExpectation,
  lines: OcrLine[],
  pngWidth: number,
): { pass: boolean; detail: string } {
  const seen = normalizeText(lines.map((l) => l.text).join(' '));
  if (lines.length === 0) {
    return {
      pass: false,
      detail:
        'the recognizer read no text in this element rect; failing closed. Causes, in order: the ' +
        'element is off-screen or occluded in this capture; the rect is the id-bearing sub-extent ' +
        'rather than the visual element; the text is an image or is genuinely absent.',
    };
  }
  const parts: string[] = [`read ${JSON.stringify(seen)}`];
  let pass = true;
  if (expectation.text !== undefined) {
    const want = normalizeText(expectation.text);
    const ok = seen === want;
    if (!ok) pass = false;
    parts.push(`vs expected ${JSON.stringify(want)} ${ok ? '=' : '≠'}`);
  }
  if (expectation.match !== undefined) {
    const ok = new RegExp(expectation.match).test(seen);
    if (!ok) pass = false;
    parts.push(`vs /${expectation.match}/ ${ok ? 'matches' : 'NO MATCH'}`);
  }
  if (expectation.heightPct !== undefined) {
    const tol = expectation.tolerancePct ?? DEFAULT_SIZE_TOLERANCE_PCT;
    const ink = inkPctOf(lines, pngWidth);
    if (ink === undefined) {
      pass = false;
      parts.push(
        `height unchecked: ${lines.length} lines recognized — ink height is single-line only ` +
          '(multi-line boxes do not compose into one height); failing closed',
      );
    } else {
      const delta = (Math.abs(ink - expectation.heightPct) / Math.max(ink, expectation.heightPct)) * 100;
      const ok = delta <= tol;
      if (!ok) pass = false;
      parts.push(
        `ink height ${ink.toFixed(2)}% of width vs expected ${expectation.heightPct}% → ` +
          `${delta.toFixed(2)}% ${ok ? '≤' : '>'} ${tol}%`,
      );
    }
  }
  return { pass, detail: parts.join('; ') };
}

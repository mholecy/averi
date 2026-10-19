import { PNG } from 'pngjs';
import type { DeviceAdapter, Rect, ScrollAxis, UiNode } from '../adapters/types.js';
import { axisOfEdge, PIXEL_OVERLAP_SLACK, type Edge } from '../ui-tree/geometry.js';
import type { FlushNeighbour } from '../ui-tree/standing.js';
import type { AroundStrip, Eyes, EyesAnswer, EyesQuestion, OrderPair, OrderQuestion } from '../ui-tree/eyes.js';
import type { OrderSeen, PairSeen } from '../ui-tree/seen-order.js';
import { errorMessage } from '../util/error-message.js';
import { measuredFrameFor, pngRegion, witnessScreen, type EdgeBounds, type MeasuredFrame, type RgbaImage } from './capture.js';
import { ciede2000, rgbToHex, srgbToLab, type Rgb } from './ciede2000.js';
import { DEFAULT_TOLERANCE_DE, sampleDominant } from './color-parity.js';

/**
 * THE EYES' production adapter (ui-tree/eyes.ts has the concept and the triggers): for either question one screenshot,
 * decoded and scaled against the question's tree as every pixel reader's (verify/capture.ts#measuredFrameFor), judged
 * by `judgeEyes` or `judgeOrder`. Never throws: a screenshot that fails, a png that does not decode, a scale the tree
 * refuses is `unjudged` (every pair `untold`), said why.
 */
export const eyesOn = (adapter: Pick<DeviceAdapter, 'screenshot' | 'viewport'>): Eyes => {
  /** The screenshot as `tree` scales it, or why there is none. */
  const look = async (tree: UiNode): Promise<{ png: RgbaImage; scale: number } | { why: string }> => {
    let shot: Buffer;
    try {
      shot = await adapter.screenshot();
    } catch (e) {
      return { why: `the screenshot failed: ${errorMessage(e).split('\n')[0]}` };
    }
    let png: RgbaImage;
    try {
      png = PNG.sync.read(shot);
    } catch (e) {
      return { why: `the screenshot did not decode: ${errorMessage(e).split('\n')[0]}` };
    }
    const { scale } = measuredFrameFor(tree, png, await witnessScreen(adapter));
    return scale.error !== undefined ? { why: `the screenshot could not be scaled to the tree: ${scale.error}` } : { png, scale: scale.scale };
  };
  return {
    async fully(question) {
      // A failure before any edge is judged is the first edge's to say.
      const first = question.flush[0];
      if (first === undefined) return { sees: 'own' };
      const seen = await look(question.tree);
      return 'why' in seen ? { sees: 'unjudged', edge: first.edge, neighbour: first.by, why: seen.why } : judgeEyes(seen.png, seen.scale, question);
    },
    async order(question) {
      const seen = await look(question.tree);
      return 'why' in seen ? untoldAll(question, seen.why) : judgeOrder(seen.png, seen.scale, question);
    },
  };
};

/**
 * The order question answered from a frame already captured (verify/capture.ts#MeasuredFrame) — the pixel assert's,
 * which captures one anyway (verify/pixel-poll.ts): no second screenshot. A frame whose scale the tree refused is every
 * pair `untold`, said why.
 */
export const orderOfFrame = (frame: MeasuredFrame, question: OrderQuestion): readonly OrderSeen[] =>
  frame.scale.error !== undefined ? untoldAll(question, `the screenshot could not be scaled to the tree: ${frame.scale.error}`) : judgeOrder(frame.png, frame.scale.scale, question);

/** Every pair of `question` untold, for `why`. */
export const untoldAll = (question: OrderQuestion, why: string): readonly OrderSeen[] => question.pairs.map(({ peer }) => ({ peer, seen: 'untold', why }));

/**
 * Two colours read as one surface: CIEDE2000 within this — about one just-noticeable difference. Measured on the
 * lab's k7 stop (Android, emulator-5554, `form-keyboard` after one stroke): every row of the bar's padding is exactly
 * `#F2F2F7` (ΔE 0.00 to the colour beside `Continue`), the field's rows `#FFFFFF`, ΔE 3.64 from it.
 */
export const EYES_SAME_DE = 1.0;

/**
 * The surface's colour and the target's own must lie further apart than this for a band to be told from the target:
 * twice `EYES_SAME_DE`, so no row can read as both. k7's pair, `#F2F2F7` against `#FFFFFF`, lies 3.64 apart — told
 * apart here, though under the colour assert's own tolerance (color-parity.ts#DEFAULT_TOLERANCE_DE, 8) and in one
 * 4-bit bucket of its sampler (`sampleDominant`): a colour ASSERT could not tell them, a row-by-row reading against
 * the two references can, because a screenshot of a drawn surface is pixel-exact (no noise on the measured rows).
 * Closer pairs are `unjudged`, and the reply says the tree's claim could not be checked.
 */
export const EYES_APART_DE = 2.0;

/** A line (a row along a top or bottom edge, a column along a side edge), or a strip, is one colour when this share of its pixels lies within EYES_SAME_DE of it — an outline's few pixels at a line's ends aside. Counted pixel by pixel, unbucketed (`oneColour`). */
const LINE_SHARE = 0.9;

/** A strip beside the neighbour or the target narrower than this (png px) is no plain surface to read: an antialiased edge. */
const FLANK_MIN_PX = 4;

/**
 * The judge, pure over a decoded png at `scale` px per tree unit — each flush edge of the question on its own
 * (`judgeEdge`), one png: the deepest band of a surface any edge shows, else the first edge it could not tell, else
 * `own`.
 */
export function judgeEyes(png: RgbaImage, scale: number, q: EyesQuestion): EyesAnswer {
  const answers = q.flush.map((f) => judgeEdge(png, scale, q.region, f));
  const surfaces = answers.filter((a): a is Extract<EyesAnswer, { sees: 'surface' }> => a.sees === 'surface');
  if (surfaces.length > 0) return surfaces.reduce((a, b) => (b.depth > a.depth ? b : a));
  return answers.find((a) => a.sees === 'unjudged') ?? { sees: 'own' };
}

/**
 * One flush edge:
 * 1. THE SURFACE's colour: the strips of the screen BESIDE the neighbour along the edge's axis, on the neighbour's own
 *    rows (columns) — where its surface draws if it draws past its node, and where no node of it lies (the bar's
 *    padding beside `Continue`, x 0–55 and 1025–1080). Each strip at least FLANK_MIN_PX wide and one colour
 *    (`oneColour`), all of them one colour; none — a neighbour as wide as the screen, which the trigger leaves unasked
 *    (ui-tree/eyes.ts#spansScreen) — is `unjudged`.
 * 2. THE BAND: the lines of the target's region from the edge inward, each across the region's whole extent, while a
 *    line is one colour with the surface's (`oneColour`). No deeper than the pixel slack (geometry.ts
 *    #PIXEL_OVERLAP_SLACK, an edge's antialiasing): `own`.
 * 3. THE TARGET's own colour: the dominant of the region PAST the band — what of it the band leaves, never its rows
 *    (a band two thirds of a label deep leaves the label's glyphs). None left, or one within EYES_APART_DE of the
 *    surface's: `unjudged`, too close to tell.
 * 4. ITS OWN MARGIN: Android dumps a control's touch target, bigger than what it draws, so a band of the colour the
 *    screen shows around the target may be the target's own margin over that background, no surface at all. The
 *    strips of the screen beside the target on the lines past the band (each FLANK_MIN_PX wide): none, or any one
 *    colour with the surface's, is `unjudged` — the band cannot be told from that margin.
 */
function judgeEdge(png: RgbaImage, scale: number, regionRect: Rect, { edge, by: neighbour }: FlushNeighbour): EyesAnswer {
  const unjudged = (why: string): EyesAnswer => ({ sees: 'unjudged', edge, neighbour, why });
  const region = pngRegion(regionRect, scale, png);
  const by = pngRegion(neighbour.rect, scale, png);
  if (region === undefined || by === undefined) return unjudged('the element or the node beside it lies off the screenshot');
  const axis = axisOfEdge(edge);
  const flanks = flanksBeside(by, axis, png);
  const colours = flanks.map((f) => sampleDominant(png, [f])?.rgb);
  if (flanks.length === 0 || colours.some((c, i) => c === undefined || !oneColour(png, flanks[i]!, c))) return unjudged('no plain surface beside that node to read its colour from');
  const surface = colours[0]!;
  if (colours.some((c) => distance(c!, surface) > EYES_SAME_DE)) return unjudged('the surface beside that node is not one colour');
  const lines = axis === 'vertical' ? region.y1 - region.y0 : region.x1 - region.x0;
  let band = 0;
  while (band < lines && oneColour(png, lineOf(region, edge, band), surface)) band++;
  const depth = Math.round(band / scale);
  if (depth <= PIXEL_OVERLAP_SLACK) return { sees: 'own' };
  const past = pastBand(region, edge, band);
  const own = past === undefined ? undefined : sampleDominant(png, [past])?.rgb;
  if (past === undefined || own === undefined) return unjudged(`it reads that surface's colour ${rgbToHex(surface)} to its far edge`);
  const apart = distance(own, surface);
  if (apart <= EYES_APART_DE) return unjudged(`its own colour ${rgbToHex(own)} and that surface's ${rgbToHex(surface)} are too close to tell apart (ΔE ${apart.toFixed(2)})`);
  const beside = flanksBeside(past, axis, png);
  if (beside.length === 0) return unjudged('nothing of the screen beside it to tell its own margin from that surface');
  if (beside.some((f) => oneColour(png, f, surface))) return unjudged(`the screen beside it shows that surface's colour ${rgbToHex(surface)} too: the band may be its own margin over that background`);
  return { sees: 'surface', edge, neighbour, depth, surface: rgbToHex(surface), own: rgbToHex(own) };
}

/** ΔE00 of two colours (the line test memoises it per pixel colour, `oneColour`). */
const distance = (a: Rgb, b: Rgb): number => ciede2000(srgbToLab(...a), srgbToLab(...b));

/**
 * `bounds` is one colour with `ref`: LINE_SHARE of its pixels within EYES_SAME_DE of it, each pixel judged as it is —
 * never through `sampleDominant`'s 4-bit buckets, which put #FFFFFF and #F2F2F7 in one (a line half of each would read
 * one colour, its mean between them).
 */
function oneColour(png: RgbaImage, bounds: EdgeBounds, ref: Rgb): boolean {
  return nearShare(png, bounds, ref, EYES_SAME_DE) >= LINE_SHARE;
}

/** The share of `bounds`' pixels within `within` (ΔE00) of `ref`, each pixel judged as it is (`oneColour`'s count); 0 for an empty one. */
function nearShare(png: RgbaImage, bounds: EdgeBounds, ref: Rgb, within: number): number {
  const { data, width } = png;
  const near = new Map<number, boolean>();
  let total = 0;
  let same = 0;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const o = (y * width + x) * 4;
      const key = (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
      let hit = near.get(key);
      if (hit === undefined) {
        hit = distance([data[o]!, data[o + 1]!, data[o + 2]!], ref) <= within;
        near.set(key, hit);
      }
      total++;
      if (hit) same++;
    }
  }
  return total === 0 ? 0 : same / total;
}

/**
 * The strips of the screen beside `r` across the edge's axis (geometry.ts#axisOfEdge) — for a top or bottom edge's
 * (`vertical`) left and right of it, on its rows; for a side edge's above and below it, on its columns — each kept only
 * when at least FLANK_MIN_PX wide, a plain surface to read rather than an antialiased edge.
 */
function flanksBeside(r: EdgeBounds, axis: ScrollAxis, png: { width: number; height: number }): EdgeBounds[] {
  const strips: EdgeBounds[] =
    axis === 'vertical'
      ? [
        { x0: 0, y0: r.y0, x1: r.x0, y1: r.y1 },
        { x0: r.x1, y0: r.y0, x1: png.width, y1: r.y1 },
      ]
    : [
        { x0: r.x0, y0: 0, x1: r.x1, y1: r.y0 },
        { x0: r.x0, y0: r.y1, x1: r.x1, y1: png.height },
      ];
  return strips.filter((f) => (axis === 'vertical' ? f.x1 - f.x0 : f.y1 - f.y0) >= FLANK_MIN_PX);
}

/** What of `r` lies past a band `band` lines deep from `edge`; undefined when the band takes it all. */
function pastBand(r: EdgeBounds, edge: Edge, band: number): EdgeBounds | undefined {
  const rest: EdgeBounds =
    edge === 'bottom' ? { ...r, y1: r.y1 - band } : edge === 'top' ? { ...r, y0: r.y0 + band } : edge === 'right' ? { ...r, x1: r.x1 - band } : { ...r, x0: r.x0 + band };
  return rest.x1 > rest.x0 && rest.y1 > rest.y0 ? rest : undefined;
}

/** The `i`-th one-pixel line of `r` from `edge` inward, across its whole extent. */
function lineOf(r: EdgeBounds, edge: Edge, i: number): EdgeBounds {
  switch (edge) {
    case 'bottom':
      return { ...r, y0: r.y1 - 1 - i, y1: r.y1 - i };
    case 'top':
      return { ...r, y0: r.y0 + i, y1: r.y0 + i + 1 };
    case 'right':
      return { ...r, x0: r.x1 - 1 - i, x1: r.x1 - i };
    case 'left':
      return { ...r, x0: r.x0 + i, x1: r.x0 + i + 1 };
  }
}

/** A band's or the overlap's dominant colour counts only when it holds at least this share of the region (`sampleDominant`): a region mostly one surface. */
const DOMINANT_SHARE = 0.5;

/**
 * A strip around a control (or of the screen beside the two) shows a side's colour when this share of its pixels lies
 * within EYES_APART_DE of it — low on purpose, the unsafe direction being a band that shows what lies behind it: a
 * quarter of the strip is enough to keep the order untold. The lab's blur-menu: 0.00 of every strip (W's teal, C's
 * blurred green, against the grey gap above W, the blurred backdrop below C and the screen beside the two).
 */
const AROUND_SHARE = 0.25;

/**
 * THE ORDER JUDGE, pure over a decoded png at `scale` px per tree unit — each pair of the question on its own
 * (ui-tree/eyes.ts#OrderPair), one png. Asymmetric on purpose: telling the PEER on top only confirms a refusal; telling
 * the TARGET on top unlocks a tap, so each rule below answers `untold` (the listing's untold order, the refusal kept)
 * wherever its evidence is missing — what one frame cannot tell apart at all is ADR 0024's residuals 2 and 7 (a
 * text-only peer over a surface ending within a pixel of its edges; a peer on top drawn in two tones split exactly at the target's
 * edge, its part over the overlap the target's own colour — each pixel for pixel the target on top):
 * 1. Each side's bands, landed in the png (`pngRegion`, one pixel in from each edge against antialiasing), each at least
 *    FLANK_MIN_PX on both sides; none on a side — untold.
 * 2. Each side one colour: every band's dominant (`sampleDominant`) at least DOMINANT_SHARE of it, all of a side within
 *    EYES_SAME_DE of each other — else untold: a side showing two surfaces (mp-native's chooser row, whose band above
 *    its overlap is the card's gap and whose side bands are its own dimmed row) is not read.
 * 3. THE OPACITY GUARD: what lies around each control — the strips just outside it beside each band, past the edge the
 *    band faces and sideways past its two side edges on the band's rows (`OrderPair.nodeAround`, `peerAround`), each
 *    read whole and as its thin slice against the control (`sliceAgainst`: the antialiased pixel skipped, then
 *    FLANK_MIN_PX), and the screen beside the two on the overlap's rows (`beside`). No screen beside, or nothing around
 *    a side, untold; a side's colour on AROUND_SHARE of any such strip or slice (within EYES_APART_DE), untold: that control may draw nothing there, its band showing what lies behind it — a text-only
 *    button over a coloured row lets the row show through the overlap, which would read as the row on top while a tap
 *    there hits the button; over an inset card, the card runs on past the button's edge — ahead or sideways — where
 *    the screen beside the two is another colour — two png pixels of run-on fill the slice to AROUND_SHARE. A surface
 *    that ends within one png pixel of the transparent control's edges (that pixel the antialiasing every slice skips)
 *    runs on nowhere it reads: one frame cannot tell it (ADR 0024's residual 2).
 * 4. The two sides farther apart than the colour assert's tolerance (color-parity.ts#DEFAULT_TOLERANCE_DE, 8) — else
 *    untold, the two look alike. The lab's menu: 17.69 (W's teal against C's blurred green).
 * 5. The overlap's dominant (of DOMINANT_SHARE) within EYES_APART_DE of exactly one side and farther than that
 *    tolerance from the other: that side is drawn on top. Else untold — a frame mid-fade reads a blend. The lab: 0.00
 *    to W's band, 17.69 to C's.
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */
export function judgeOrder(png: RgbaImage, scale: number, q: OrderQuestion): readonly OrderSeen[] {
  return q.pairs.map((pair) => ({ peer: pair.peer, ...judgePair(png, scale, pair) }));
}

function judgePair(png: RgbaImage, scale: number, pair: OrderPair): PairSeen {
  const untold = (why: string): PairSeen => ({ seen: 'untold', why });
  const land = (rects: readonly Rect[]): EdgeBounds[] =>
    rects.flatMap((r) => {
      const at = pngRegion(r, scale, png);
      // One pixel in from each edge, off the antialiasing between the two.
      const on = at === undefined ? undefined : { x0: at.x0 + 1, y0: at.y0 + 1, x1: at.x1 - 1, y1: at.y1 - 1 };
      return on === undefined || on.x1 - on.x0 < FLANK_MIN_PX || on.y1 - on.y0 < FLANK_MIN_PX ? [] : [on];
    });
  // Each strip around a control whole, and its slice against the control: the pixel there skipped (the antialiasing
  // between the two), then FLANK_MIN_PX — a surface running on a point or two past the edge fills that slice past
  // AROUND_SHARE, as it never fills the whole strip.
  const landAround = (strips: readonly AroundStrip[]): EdgeBounds[] =>
    strips.flatMap(({ rect, against }) => {
      const whole = land([rect]);
      const at = pngRegion(rect, scale, png);
      const slice = at === undefined ? undefined : sliceAgainst(at, against);
      return slice === undefined ? whole : [...whole, slice];
    });
  const sides = [
    { name: 'it', bands: land(pair.nodeBands), around: landAround(pair.nodeAround) },
    { name: 'the other', bands: land(pair.peerBands), around: landAround(pair.peerAround) },
  ] as const;
  const colours: Rgb[] = [];
  for (const { name, bands } of sides) {
    if (bands.length === 0) return untold(`no part of ${name} shows beside the overlap`);
    const dominants = bands.map((b) => sampleDominant(png, [b]));
    const first = dominants[0];
    if (first === undefined || dominants.some((d) => d === undefined || d.share < DOMINANT_SHARE || distance(d.rgb, first.rgb) > EYES_SAME_DE)) return untold(`${name} is not one colour beside the overlap`);
    colours.push(first.rgb);
  }
  const [own, other] = colours as [Rgb, Rgb];
  const beside = land(pair.beside);
  if (beside.length === 0) return untold('no screen beside the two to tell a drawn surface from');
  for (const [i, { name, around }] of sides.entries()) {
    if (around.length === 0) return untold(`nothing around ${name} past its edge to tell a drawn surface from`);
    const colour = colours[i]!;
    if ([...around, ...beside].some((strip) => nearShare(png, strip, colour, EYES_APART_DE) >= AROUND_SHARE)) {
      return untold(`${name} shows the colour around it ${rgbToHex(colour)} beside the overlap: it may draw nothing there`);
    }
  }
  const apart = distance(own, other);
  if (apart <= DEFAULT_TOLERANCE_DE) return untold(`the two look alike (ΔE ${apart.toFixed(2)})`);
  const [overlap] = land([pair.overlap]);
  const shows = overlap === undefined ? undefined : sampleDominant(png, [overlap]);
  if (shows === undefined || shows.share < DOMINANT_SHARE) return untold('the overlap is not one colour');
  const toOwn = distance(shows.rgb, own);
  const toOther = distance(shows.rgb, other);
  const hexes = { overlap: rgbToHex(shows.rgb), own: rgbToHex(own), other: rgbToHex(other) };
  // Both halves bite: the sides only just over DEFAULT_TOLERANCE_DE apart (rule 4), an overlap within EYES_APART_DE of
  // one can lie within that tolerance of the other too (8.55 apart, 1.95 and 6.60) — a blend, untold.
  if (toOwn <= EYES_APART_DE && toOther > DEFAULT_TOLERANCE_DE) return { seen: 'over', ...hexes };
  if (toOther <= EYES_APART_DE && toOwn > DEFAULT_TOLERANCE_DE) return { seen: 'under', ...hexes };
  return untold(`the overlap shows neither (ΔE ${toOwn.toFixed(2)} to it, ${toOther.toFixed(2)} to the other)`);
}

/**
 * The slice of a strip around a control against it (`against`: the strip's edge that lies on the control's): one pixel
 * in, off the antialiasing between the two, then FLANK_MIN_PX deep, across the strip less a pixel at each end;
 * undefined when the strip is too thin for it.
 */
function sliceAgainst(at: EdgeBounds, against: Edge): EdgeBounds | undefined {
  const deep = 1 + FLANK_MIN_PX;
  const across = against === 'top' || against === 'bottom' ? { x0: at.x0 + 1, x1: at.x1 - 1 } : { y0: at.y0 + 1, y1: at.y1 - 1 };
  const slice: EdgeBounds =
    against === 'bottom'
      ? { ...at, ...across, y0: at.y1 - deep, y1: at.y1 - 1 }
      : against === 'top'
        ? { ...at, ...across, y0: at.y0 + 1, y1: at.y0 + deep }
        : against === 'right'
          ? { ...at, ...across, x0: at.x1 - deep, x1: at.x1 - 1 }
          : { ...at, ...across, x0: at.x0 + 1, x1: at.x0 + deep };
  const fits = against === 'top' || against === 'bottom' ? at.y1 - at.y0 >= deep : at.x1 - at.x0 >= deep;
  return fits && slice.x1 - slice.x0 >= FLANK_MIN_PX && slice.y1 - slice.y0 >= FLANK_MIN_PX ? slice : undefined;
}

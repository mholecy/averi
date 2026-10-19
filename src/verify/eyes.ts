import { PNG } from 'pngjs';
import type { DeviceAdapter, Rect, ScrollAxis } from '../adapters/types.js';
import { axisOfEdge, PIXEL_OVERLAP_SLACK, type Edge } from '../ui-tree/geometry.js';
import type { FlushNeighbour } from '../ui-tree/standing.js';
import type { Eyes, EyesAnswer, EyesQuestion } from '../ui-tree/eyes.js';
import { errorMessage } from '../util/error-message.js';
import { measuredFrameFor, pngRegion, witnessScreen, type EdgeBounds, type RgbaImage } from './capture.js';
import { ciede2000, rgbToHex, srgbToLab, type Rgb } from './ciede2000.js';
import { sampleDominant } from './color-parity.js';

/**
 * THE EYES' production adapter (ui-tree/eyes.ts has the concept and the trigger): one screenshot, decoded and scaled
 * against the stop's tree as every pixel reader's (verify/capture.ts#measuredFrameFor), judged by `judgeEyes`. Never
 * throws: a screenshot that fails, a png that does not decode, a scale the tree refuses is `unjudged`, said why.
 */
export const eyesOn =
  (adapter: Pick<DeviceAdapter, 'screenshot' | 'viewport'>): Eyes =>
  async (question) => {
    // A failure before any edge is judged is the first edge's to say.
    const first = question.flush[0];
    if (first === undefined) return { sees: 'own' };
    const unjudged = (why: string): EyesAnswer => ({ sees: 'unjudged', edge: first.edge, neighbour: first.by, why });
    let shot: Buffer;
    try {
      shot = await adapter.screenshot();
    } catch (e) {
      return unjudged(`the screenshot failed: ${errorMessage(e).split('\n')[0]}`);
    }
    let png: RgbaImage;
    try {
      png = PNG.sync.read(shot);
    } catch (e) {
      return unjudged(`the screenshot did not decode: ${errorMessage(e).split('\n')[0]}`);
    }
    const { scale } = measuredFrameFor(question.tree, png, await witnessScreen(adapter));
    if (scale.error !== undefined) return unjudged(`the screenshot could not be scaled to the tree: ${scale.error}`);
    return judgeEyes(png, scale.scale, question);
  };

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
        hit = distance([data[o]!, data[o + 1]!, data[o + 2]!], ref) <= EYES_SAME_DE;
        near.set(key, hit);
      }
      total++;
      if (hit) same++;
    }
  }
  return total > 0 && same / total >= LINE_SHARE;
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

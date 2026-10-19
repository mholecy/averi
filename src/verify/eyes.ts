import { PNG } from 'pngjs';
import type { DeviceAdapter } from '../adapters/types.js';
import { PIXEL_OVERLAP_SLACK, type Edge } from '../ui-tree/geometry.js';
import type { Eyes, EyesAnswer, EyesQuestion } from '../ui-tree/eyes.js';
import { errorMessage } from '../util/error-message.js';
import { insetBy, measuredFrameFor, pngRegion, witnessScreen, type EdgeBounds, type RgbaImage } from './capture.js';
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
    let shot: Buffer;
    try {
      shot = await adapter.screenshot();
    } catch (e) {
      return { sees: 'unjudged', why: `the screenshot failed: ${errorMessage(e).split('\n')[0]}` };
    }
    let png: RgbaImage;
    try {
      png = PNG.sync.read(shot);
    } catch (e) {
      return { sees: 'unjudged', why: `the screenshot did not decode: ${errorMessage(e).split('\n')[0]}` };
    }
    const { scale } = measuredFrameFor(question.tree, png, await witnessScreen(adapter));
    if (scale.error !== undefined) return { sees: 'unjudged', why: `the screenshot could not be scaled to the tree: ${scale.error}` };
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

/** A line (a row along a top or bottom edge, a column along a side edge) is one colour when its dominant holds this share of it: an outline's few pixels at its ends aside. */
const LINE_SHARE = 0.9;

/** A strip beside the neighbour narrower than this (png px) is no plain surface to read: an antialiased edge. */
const FLANK_MIN_PX = 4;

/** The inset of the target's own sample (the colour sampler's, color-parity.ts EDGE_INSET): clear of its outline. */
const OWN_INSET = 0.12;

/**
 * The judge, pure over a decoded png at `scale` px per tree unit:
 * 1. THE SURFACE's colour: the strips of the screen BESIDE the neighbour along the edge's axis, on the neighbour's own
 *    rows (columns) — where its surface draws if it draws past its node, and where no node of it lies (the bar's
 *    padding beside `Continue`, x 0–55 and 1025–1080). Each strip at least FLANK_MIN_PX wide, one colour (LINE_SHARE),
 *    all of them one colour (EYES_SAME_DE); none — a neighbour as wide as the screen — is `unjudged`.
 * 2. THE TARGET's own colour: the dominant of the half of its region away from the edge, inset OWN_INSET — what the
 *    tree proved clear. Within EYES_APART_DE of the surface's: `unjudged`, too close to tell.
 * 3. The lines of the region from the edge inward, each across the region's whole extent: a line of one colour within
 *    EYES_SAME_DE of the surface's is the surface's; the first that is not ends the band.
 * A band no deeper than the pixel slack (geometry.ts#PIXEL_OVERLAP_SLACK, an edge's antialiasing) is `own`.
 */
export function judgeEyes(png: RgbaImage, scale: number, q: EyesQuestion): EyesAnswer {
  const region = pngRegion(q.region, scale, png);
  const by = pngRegion(q.neighbour.rect, scale, png);
  if (region === undefined || by === undefined) return { sees: 'unjudged', why: 'the element or the node beside it lies off the screenshot' };
  const across = q.edge === 'top' || q.edge === 'bottom';
  const flanks: EdgeBounds[] = (
    across
      ? [
          { x0: 0, y0: by.y0, x1: by.x0, y1: by.y1 },
          { x0: by.x1, y0: by.y0, x1: png.width, y1: by.y1 },
        ]
      : [
          { x0: by.x0, y0: 0, x1: by.x1, y1: by.y0 },
          { x0: by.x0, y0: by.y1, x1: by.x1, y1: png.height },
        ]
  ).filter((f) => (across ? f.x1 - f.x0 : f.y1 - f.y0) >= FLANK_MIN_PX);
  const flankColours = flanks.map((f) => sampleDominant(png, [f])).filter((c) => c !== undefined && c.share >= LINE_SHARE);
  if (flanks.length === 0 || flankColours.length !== flanks.length) return { sees: 'unjudged', why: 'no plain surface beside that node to read its colour from' };
  const surface = flankColours[0]!.rgb;
  if (flankColours.some((c) => distance(c!.rgb, surface) > EYES_SAME_DE)) return { sees: 'unjudged', why: 'the surface beside that node is not one colour' };
  const own = sampleDominant(png, [insetBy(awayHalf(region, q.edge), OWN_INSET, 'pixels')]);
  if (own === undefined) return { sees: 'unjudged', why: 'the element has no area on the screenshot' };
  const apart = distance(own.rgb, surface);
  if (apart <= EYES_APART_DE) {
    return { sees: 'unjudged', why: `its own colour ${rgbToHex(own.rgb)} and that surface's ${rgbToHex(surface)} are too close to tell apart (ΔE ${apart.toFixed(2)})` };
  }
  const lines = across ? region.y1 - region.y0 : region.x1 - region.x0;
  let band = 0;
  while (band < lines) {
    const line = sampleDominant(png, [lineOf(region, q.edge, band)]);
    if (line === undefined || line.share < LINE_SHARE || distance(line.rgb, surface) > EYES_SAME_DE) break;
    band++;
  }
  const depth = Math.round(band / scale);
  if (depth <= PIXEL_OVERLAP_SLACK) return { sees: 'own' };
  return { sees: 'surface', depth, surface: rgbToHex(surface), own: rgbToHex(own.rgb) };
}

const distance = (a: Rgb, b: Rgb): number => ciede2000(srgbToLab(...a), srgbToLab(...b));

/** The half of `r` away from `edge`. */
function awayHalf(r: EdgeBounds, edge: Edge): EdgeBounds {
  const midY = Math.floor((r.y0 + r.y1) / 2);
  const midX = Math.floor((r.x0 + r.x1) / 2);
  switch (edge) {
    case 'bottom':
      return { ...r, y1: Math.max(r.y0 + 1, midY) };
    case 'top':
      return { ...r, y0: Math.min(r.y1 - 1, midY) };
    case 'right':
      return { ...r, x1: Math.max(r.x0 + 1, midX) };
    case 'left':
      return { ...r, x0: Math.min(r.x1 - 1, midX) };
  }
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

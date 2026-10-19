import { PNG } from 'pngjs';
import type { Rect } from './schema.js';

/** A pixel is the target's own colour when no channel is further from it than this (8-bit). */
export const OWN_COLOUR_TOLERANCE = 6;

const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const rgbOf = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

/**
 * What a screenshot shows of `frame` (points; `scale` pixels per point): the fraction of its pixels within
 * OWN_COLOUR_TOLERANCE of `color`, and the colour most of its pixels have. The part of the frame off the image counts
 * as not drawn.
 */
export function measure(png: PNG, frame: Rect, scale: number, color: string): { drawn: number; seen: string } {
  const [r0, g0, b0] = rgbOf(color);
  const x0 = Math.round(frame.x * scale), y0 = Math.round(frame.y * scale);
  const x1 = Math.round((frame.x + frame.width) * scale), y1 = Math.round((frame.y + frame.height) * scale);
  const total = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  let own = 0;
  const counts = new Map<number, number>();
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (Math.abs(r - r0) <= OWN_COLOUR_TOLERANCE && Math.abs(g - g0) <= OWN_COLOUR_TOLERANCE && Math.abs(b - b0) <= OWN_COLOUR_TOLERANCE) own++;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0, seen = 0;
  for (const [k, n] of counts) if (n > best) (best = n), (seen = k);
  return { drawn: total === 0 ? 0 : own / total, seen: hexOf((seen >> 16) & 0xff, (seen >> 8) & 0xff, seen & 0xff) };
}

import { PNG } from 'pngjs';
import type { Rect } from '../../src/adapters/types.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';

/** An opaque colour, 0–255 a channel. */
export type Rgb = readonly [number, number, number];

/** A synthetic png of `size` at scale 1: `screen` everywhere, then each fill painted over it in order, opaque. */
export function paint(size: { readonly width: number; readonly height: number }, screen: Rgb, fills: readonly (readonly [Rect, Rgb])[]): PNG {
  const img = new PNG({ width: size.width, height: size.height });
  const put = (r: Rect, [red, g, b]: Rgb) => {
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const o = (y * size.width + x) * 4;
        img.data[o] = red;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
  };
  put({ x: 0, y: 0, width: size.width, height: size.height }, screen);
  for (const [r, c] of fills) put(r, c);
  return img;
}

/** The whole `screen` usable, as the device reports it — what a test of a phone with nothing cut from it hands a standing. */
export const usableOf = (screen: Rect): UsableScreen => ({ box: { ...screen }, boxes: [{ ...screen }], oriented: { ...screen }, from: 'device' });

/** The iPhone 17 (402x874 pt) as the device reports it, its status band to 62 pt: the usable screen the iOS standing tests judge on. */
export const IPHONE_17: UsableScreen = { ...usableOf({ x: 0, y: 0, width: 402, height: 874 }), statusBand: 62 };

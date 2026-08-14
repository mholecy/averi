/**
 * CIEDE2000 color difference — Sharma, Wu & Dalal (2005), "The CIEDE2000
 * Color-Difference Formula: Implementation Notes, Supplementary Test Data,
 * and Mathematical Observations". Port of the superrepo's
 * `scripts/color-parity.py` color math (the semantic source of truth, itself
 * verified against the Sharma reference pairs). Pure functions, no I/O.
 *
 * Why CIEDE2000 and not RGB distance: emulator vs simulator color pipelines
 * differ slightly and the app background is a gradient, so the metric must
 * match perceptual difference — the 2026-08-13 real bug (#CFCFD3 vs #FDFDFD)
 * measures dE00 10.19, and every tolerance in the color-parity loop is
 * calibrated against that number.
 */

export type Lab = readonly [l: number, a: number, b: number];
export type Rgb = readonly [r: number, g: number, b: number];

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export function hexToRgb(value: string): Rgb {
  const v = value.replace(/^#/, '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (c: number): string => c.toString(16).toUpperCase().padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** sRGB (0-255) -> linear -> XYZ (D65) -> CIELAB. */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number): number => {
    c /= 255.0;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t: number): number =>
    t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function ciede2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = b1 !== 0 || ap1 !== 0 ? ((deg(Math.atan2(b1, ap1)) % 360) + 360) % 360 : 0.0;
  const hp2 = b2 !== 0 || ap2 !== 0 ? ((deg(Math.atan2(b2, ap2)) % 360) + 360) % 360 : 0.0;
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp: number;
  if (Cp1 * Cp2 === 0) dhp = 0.0;
  else if (Math.abs(hp2 - hp1) <= 180) dhp = hp2 - hp1;
  else if (hp2 - hp1 > 180) dhp = hp2 - hp1 - 360;
  else dhp = hp2 - hp1 + 360;
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dhp) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  let hbp: number;
  if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hbp = (hp1 + hp2) / 2;
  else if (hp1 + hp2 < 360) hbp = (hp1 + hp2 + 360) / 2;
  else hbp = (hp1 + hp2 - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dtheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dtheta)) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** dE00 between two '#RRGGBB' strings. */
export function deltaEHex(hex1: string, hex2: string): number {
  return ciede2000(srgbToLab(...hexToRgb(hex1)), srgbToLab(...hexToRgb(hex2)));
}

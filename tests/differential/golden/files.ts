import { bars } from './bars.known.js';
import { base } from './base.known.js';
import { edges } from './edges.known.js';
import { falseCovers } from './false-covers.known.js';
import { forms } from './forms.known.js';
import type { Known, KnownFile } from './known.js';
import { presented } from './presented.known.js';
import { reactNative } from './react-native.known.js';
import { text } from './text.known.js';

// The static ratchet whole: every family's KNOWN file (tests/differential/golden/<family>.known.ts), in FAMILIES'
// order, and their rows and counts aggregated — read by golden.test.ts (the ratchet itself) and tests/truth/
// lab-notes.test.ts (the rows' notes against docs/bugs and calibration.json).

export const KNOWN_FILES: readonly KnownFile[] = [base, presented, forms, edges, bars, falseCovers, text, reactNative];
export const KNOWN: Readonly<Record<string, Known>> = Object.assign({}, ...KNOWN_FILES.map((f) => f.known));
export const COUNTS: Readonly<Record<string, number>> = Object.assign({}, ...KNOWN_FILES.map((f) => f.counts));

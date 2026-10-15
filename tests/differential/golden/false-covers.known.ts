import type { KnownFile } from './known.js';

// The false-covers family's ratchet (fixtures/apps/cells/false-covers.json): no cell yet — phase 3's B5 adds them, with their
// rows (scripts/differential/golden-spec/false-covers.ts) and their known mismatches here.

export const falseCovers: KnownFile = { family: 'false-covers', known: {}, counts: {} };

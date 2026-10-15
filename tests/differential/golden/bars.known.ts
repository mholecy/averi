import type { KnownFile } from './known.js';

// The bars family's ratchet (fixtures/apps/cells/bars.json): no cell yet — phase 3's B4 adds them, with their
// rows (scripts/differential/golden-spec/bars.ts) and their known mismatches here.

export const bars: KnownFile = { family: 'bars', known: {}, counts: {} };

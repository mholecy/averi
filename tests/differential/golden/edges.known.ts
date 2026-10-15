import type { KnownFile } from './known.js';

// The edges family's ratchet (fixtures/apps/cells/edges.json): no cell yet — phase 3's B2 adds them, with their
// rows (scripts/differential/golden-spec/edges.ts) and their known mismatches here.

export const edges: KnownFile = { family: 'edges', known: {}, counts: {} };

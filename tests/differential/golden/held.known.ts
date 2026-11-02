import type { KnownFile } from './known.js';

// The held family's ratchet (fixtures/apps/cells/held.json, backlog D30): screens that render late, for the live
// golden's `ensure` group (scripts/truth/live-ensure.ts) — no targets and no captured truth, so no row and no check.

export const held: KnownFile = {
  family: 'held',
  known: {},
  counts: {},
};

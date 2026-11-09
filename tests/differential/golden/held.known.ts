import { ANDROID, type KnownFile } from './known.js';

// The held family's ratchet (fixtures/apps/cells/held.json, backlog D30): screens that render late, for the live
// golden's `ensure` group (scripts/truth/live-ensure.ts) — no targets and no form, so no row: held-no and
// held-no-spinner captured on Android by T6 (read bare, as the capture finds them at launch) are asked nothing.

export const held: KnownFile = {
  family: 'held',
  known: {},
  counts: {
    [`${ANDROID}/held-no.xml`]: 0,
    [`${ANDROID}/held-no-spinner.xml`]: 0,
  },
};

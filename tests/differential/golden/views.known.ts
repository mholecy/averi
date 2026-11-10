import type { KnownFile } from './known.js';

// The views family's ratchet (fixtures/apps/cells/views.json, backlog D77): classic Android Views, views-banner (rn-
// banner's native twin) and views-drawn-over (a target drawn over a later-listed control). Not captured yet — the
// capture is on the owner's list — so no row and no count. Predicted (tests/ui-tree/draw-order-android-views-twin.test.ts):
// views-banner's T, U and C refused; views-drawn-over's A and A2 Tapped, B and B2 refused.

export const views: KnownFile = {
  family: 'views',
  known: {},
  counts: {},
};

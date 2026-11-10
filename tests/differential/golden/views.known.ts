import type { KnownFile } from './known.js';

// The views family's ratchet (fixtures/apps/cells/views.json, backlog D77): classic Android Views, views-banner
// (rn-banner's native twin) and views-drawn-over (a target drawn over a later-listed control). Not captured yet — the
// capture is on the owner's list — so no row and no count. Predicted
// (tests/ui-tree/draw-order-android-views-twin.test.ts): views-banner's T, U and C refused; views-drawn-over's B and B2
// refused; its A and A2 `Tapped` ONLY where the eyes see them over B and B2 (a screenshot that tells) — with no
// screenshot, or one that cannot tell, B and B2 are untold covers and A and A2 are refused
// (draw-order-android-reading-order.test.ts, the review's repro of D75 round 1). A run without screenshots reading A
// and A2 red is that prediction, not a regression.

export const views: KnownFile = {
  family: 'views',
  known: {},
  counts: {},
};

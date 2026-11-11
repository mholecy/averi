import { ANDROID, type KnownFile } from './known.js';

// The views family's ratchet (fixtures/apps/cells/views.json, backlog D77): classic Android Views, views-banner
// (rn-banner's native twin) and views-drawn-over (a target drawn over a later-listed control). Captured 2026-11-11 on
// emulator-5554 (averi_lab, API 33). Predicted (tests/ui-tree/draw-order-android-views-twin.test.ts): views-banner's T,
// U and C refused; views-drawn-over's B and B2 refused; its A and A2 `Tapped` ONLY where the eyes see them over B and
// B2 (a screenshot that tells).
// views-banner: as predicted (green, 6 of 6). views-drawn-over: green since D84 (10 of 10) — B and B2 refused as
// predicted; A and A2, refused at capture, are tapped since a nested run's later-listed sibling of any kind is an
// untold peer the eyes lift (ADR 0015's D84 amendment; tests/verify/eyes-views-drawn-over.test.ts).

const DRAWN_OVER = `${ANDROID}/views-drawn-over.xml`;

export const views: KnownFile = {
  family: 'views',
  known: {},
  counts: {
    [`${ANDROID}/views-banner.xml`]: 6,
    [DRAWN_OVER]: 10,
  },
};

import { ADB_STROKE, ANDROID, type KnownFile } from './known.js';

// The views family's ratchet (fixtures/apps/cells/views.json, backlog D77): classic Android Views, views-banner
// (rn-banner's native twin) and views-drawn-over (a target drawn over a later-listed control). Captured 2026-11-11 on
// emulator-5554 (averi_lab, API 33). Predicted (tests/ui-tree/draw-order-android-views-twin.test.ts): views-banner's T,
// U and C refused; views-drawn-over's B and B2 refused; its A and A2 `Tapped` ONLY where the eyes see them over B and
// B2 (a screenshot that tells).
// views-banner: as predicted (green, 6 of 6). views-drawn-over's B and B2: as predicted (refused, "drawn over it as a
// screenshot shows (the two are listed in reading order)"). Its A and A2: a FINDING, not the prediction — the captured
// frame tells (A's own #1E88E5 / A2's #00897B over the whole overlap, truth `drawn: 1`), yet each is refused as under
// B / B2 "drawn over it" (no screenshot clause): the eyes do not lift the later-listed control at the cell's geometry,
// the direction ADR 0015's D75 residual opened measured as a refusal, not a `Tapped`. Filed unclassified (no decision
// or bug note yet) — red until one is taken.

const DRAWN_OVER = `${ANDROID}/views-drawn-over.xml`;
const NOT_LIFTED = 'D77 finding (2026-11-11 capture): the screenshot shows the target over the later-listed control, which is not lifted — refused, predicted Tapped';

export const views: KnownFile = {
  family: 'views',
  known: Object.fromEntries(
    (['A', 'A2'] as const).flatMap((t) => [
      [`${DRAWN_OVER} ${t} tap`, { cls: 'not tapped', kind: 'refused' as const, calls: [], note: NOT_LIFTED }] as const,
      [`${DRAWN_OVER} ${t} colour`, { cls: 'failed', kind: 'FAIL' as const, calls: [], note: NOT_LIFTED }] as const,
      [
        `${DRAWN_OVER} ${t} scroll_until`,
        { cls: 'stopped', kind: 'refused' as const, calls: [ADB_STROKE, ADB_STROKE, 'adb shell input swipe 540 444 540 1110 667'], note: NOT_LIFTED },
      ] as const,
    ]),
  ),
  counts: {
    [`${ANDROID}/views-banner.xml`]: 6,
    [DRAWN_OVER]: 10,
  },
};

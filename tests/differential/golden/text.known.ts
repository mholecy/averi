import { ANDROID, IOS, type KnownFile } from './known.js';

// The text family's ratchet (fixtures/apps/cells/text.json, phase 4): text-sample, text-under-bar (both platforms),
// text-nav-cut (Android). Its `ocr` rows are judged against the real pixels where the host's recognizer reads
// (golden.ts#ocrAvailability) and skipped elsewhere — a known `ocr` row is checked only where it is asked.

export const text: KnownFile = {
  family: 'text',
  known: Object.fromEntries([
    // LAB FINDINGS OC1 and OC2 — fixed on bugs/r14-oc (verify/ocr-fold.ts#readingDifference, ADR 0025): the
    // recognizer's misreading of a letter of the copy (Ľ read L', ĺ read í; text-sample B and C, both platforms) and
    // a grouped number's separator read as nothing (iOS: text-sample H and I) pass the ocr assert, one way only. All
    // ten rows green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING B4-L1 — fixed on fix/r9-b4l1 (ui-tree/later-edges.ts#OverlaidEdge): the pinned-button shape of bars'
    // pinned-bar P. Compose lists P by its uncovered strip above the button; the button reaches past it at both ends — an
    // overlay — so the colour assert fails closed naming it, and the plain stop asked by P's identifier reads the
    // role-less strip as the sliver it is (cut by the button). Both rows green, struck off here, calibrated in
    // scripts/truth/calibration.json. Its tap and scroll_until asked by P's string are not found, as before.
  ]),
  counts: {
    [`${ANDROID}/text-sample.xml`]: 40,
    [`${ANDROID}/text-under-bar.xml`]: 13,
    [`${ANDROID}/text-nav-cut.xml`]: 4,
    [`${IOS}/text-sample.idb.json`]: 40,
    [`${IOS}/text-sample.wda.json`]: 40,
    [`${IOS}/text-under-bar.idb.json`]: 13,
    [`${IOS}/text-under-bar.wda.json`]: 13,
  },
};

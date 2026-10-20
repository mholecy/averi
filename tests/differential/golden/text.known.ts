import { ANDROID, IOS, type Classed, type KnownFile } from './known.js';

// The text family's ratchet (fixtures/apps/cells/text.json, phase 4): text-sample, text-under-bar (both platforms),
// text-nav-cut (Android). Its `ocr` rows are judged against the real pixels where the host's recognizer reads
// (golden.ts#ocrAvailability) and skipped elsewhere — a known `ocr` row is checked only where it is asked.

const OC1: Classed = 'bug:2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md';
const OC2: Classed = 'bug:2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-nothing.md';
/**
 * A known `ocr` FAIL pinned to what the recognizer read (golden-spec/text.ts#ocrPasses: `read "…", not the string`):
 * the reading turning empty (a recognizer that died fails closed: class `failed`) or into another wrong reading fails
 * the ratchet. Pinned per capture: iOS and Android read differently.
 */
const READ = (reading: string, note: string, as: Classed) => ({ cls: `read ${JSON.stringify(reading)}, not the string`, kind: 'FAIL', calls: [], note, as }) as const;

export const text: KnownFile = {
  family: 'text',
  known: Object.fromEntries([
    // LAB FINDING OC1: Ľubomír Šťastný read "L'ubomír …", dĺžeň read "dížeň" — no fold reaches them (both platforms).
    ...[`${IOS}/text-sample.idb.json`, `${IOS}/text-sample.wda.json`].flatMap((file) => [
      [`${file} B ocr`, READ("L'ubomír Stastný", "lab finding OC1: Ľ read as L'", OC1)],
      [`${file} C ocr`, READ('Makčeň, dižeň a vokáň', 'lab finding OC1: ĺ read as í', OC1)],
      // LAB FINDING OC2: on iOS the NBSP / narrow-NBSP thousands separator is read as nothing.
      [`${file} H ocr`, READ('1234,56 €', 'lab finding OC2: the NBSP thousands separator read as nothing', OC2)],
      [`${file} I ocr`, READ('-12345,00 EUR', 'lab finding OC2: the narrow-NBSP thousands separator read as nothing', OC2)],
    ]),
    [`${ANDROID}/text-sample.xml B ocr`, READ("L'ubomír Sťastný", "lab finding OC1: Ľ read as L'", OC1)],
    [`${ANDROID}/text-sample.xml C ocr`, READ('Mäkčeň, dížeň a vokáň', 'lab finding OC1: ĺ read as í', OC1)],
    // LAB FINDING B4-L1 — fixed on fix/r9-b4l1 (ui-tree/standing.ts#OverlaidEdge): the pinned-button shape of bars'
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

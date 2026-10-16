import { ANDROID, IOS, type Classed, type KnownFile } from './known.js';

// The text family's ratchet (fixtures/apps/cells/text.json, phase 4): text-sample, text-under-bar (both platforms),
// text-nav-cut (Android). Its `ocr` rows are judged against the real pixels where the host's recognizer reads
// (golden.ts#ocrAvailability) and skipped elsewhere — a known `ocr` row is checked only where it is asked.

const OC1: Classed = 'bug:2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md';
const OC2: Classed = 'bug:2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-nothing.md';
const LAB_FULLY = 'bug:2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md';
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
    // The pinned-button shape of bars' pinned-bar P (bars.known.ts, the same lab finding): Compose lists P by its
    // uncovered strip above the button, so the colour assert samples only that and passes, and scroll_until stops on it.
    [`${ANDROID}/text-under-bar.xml P colour`, { cls: 'passed on #FCE4EC', kind: 'PASS', calls: [], note: 'lab finding: the colour sampled on P\'s uncovered strip only (Compose\'s uncovered bounds)', as: LAB_FULLY }],
    [`${ANDROID}/text-under-bar.xml P scroll_until`, { cls: 'reached where it is under-chrome:pinned, after 0 swipe(s) that move nothing', kind: 'visible', calls: [], note: 'lab finding: the stop reads P whole by its uncovered strip (Compose\'s uncovered bounds)', as: LAB_FULLY }],
  ]),
  counts: {
    [`${ANDROID}/text-sample.xml`]: 40,
    [`${ANDROID}/text-under-bar.xml`]: 12,
    [`${ANDROID}/text-nav-cut.xml`]: 4,
    [`${IOS}/text-sample.idb.json`]: 40,
    [`${IOS}/text-sample.wda.json`]: 40,
    [`${IOS}/text-under-bar.idb.json`]: 12,
    [`${IOS}/text-under-bar.wda.json`]: 12,
  },
};

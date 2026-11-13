import { ANDROID, IOS, type KnownFile } from './known.js';

// The text family's ratchet (fixtures/apps/cells/text.json, phase 4): text-sample, text-under-bar (both platforms),
// text-nav-cut (Android). Its `ocr` rows are judged against the real pixels where the host's recognizer reads
// (golden.ts#ocrAvailability) and skipped elsewhere — a known `ocr` row is checked only where it is asked.

export const text: KnownFile = {
  family: 'text',
  known: Object.fromEntries([
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

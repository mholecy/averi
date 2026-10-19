import { ANDROID_RN, IOS_RN, type KnownFile } from './known.js';

// The react-native family's ratchet (fixtures/apps/cells/react-native.json, round 7): rn-field, captured from the
// React Native lab app (fixtures/apps/rn) on both platforms — calibration.json #18's field half. No known mismatch:
// N's and M's labels, refused as under their own field under WDA (an input in an unnamed wrapper of its rect, LR1) and
// on Android (a label overhanging its EditText by 3 px, LR2), are their own field's since ce19c234 + f3a7043f
// (src/ui-tree/draw-order.ts; docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md) — tap, scroll_until and
// ocr green under every source (the ocr rows judged outside the sandbox, where Vision runs).

export const reactNative: KnownFile = {
  family: 'react-native',
  known: {},
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
  },
};

import { ANDROID_RN, IOS_RN, keys, type KnownFile } from './known.js';

// The react-native family's ratchet (fixtures/apps/cells/react-native.json, round 7): rn-field, captured from the
// React Native lab app (fixtures/apps/rn) on both platforms — calibration.json #18's field half. idb lists the RN
// fields flat and is green; under WDA each input sits in an unnamed wrapper of its own rect (LR1), and on Android the
// labels overhang their EditText by 3 px (LR2): N's and M's label refused as under its own field. I, the field's icon
// button, is green everywhere.

const LR1 = 'bug:2026-10-19-lab-ios-wda-rn-text-input-wrapped-in-its-component-view-reads-as-a-cover-of-its-own-label.md';
const LR2 = 'bug:2026-10-19-lab-android-rn-label-overhanging-its-edittext-by-3-px-reads-as-covered-by-it.md';
const IDB_STOP = ['idb ui swipe 201 699 201 175 --duration 0.3', 'idb ui swipe 201 699 201 175 --duration 0.3', 'idb ui swipe 201 175 201 437 --duration 0.3'];
const ADB_STOP = ['adb shell input swipe 540 1776 540 444 1334', 'adb shell input swipe 540 1776 540 444 1334', 'adb shell input swipe 540 444 540 1110 667'];

/** A label refused as under its own field: the tap, the stop after three strokes (two down, one back), the ocr failed closed. */
const underOwnField = (file: string, as: typeof LR1 | typeof LR2, stop: readonly string[], note: string) => [
  ...keys(file, ['N', 'M'], ['tap'], { cls: 'not tapped', kind: 'refused', calls: [], note: `${note}: the tap refused naming the field`, as }),
  ...keys(file, ['N', 'M'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: stop, note: `${note}: "in the viewport but under textfield" after 3 swipes`, as }),
  ...keys(file, ['N', 'M'], ['ocr'], { cls: 'failed', kind: 'FAIL', calls: [], note: `${note}: the ocr assert fails closed naming the field`, as }),
];

export const reactNative: KnownFile = {
  family: 'react-native',
  known: Object.fromEntries([
    ...underOwnField(`${IOS_RN}/rn-field.wda.json`, LR1, IDB_STOP, 'WDA lists the RN input inside an unnamed wrapper of its rect: no sibling of its label'),
    ...underOwnField(`${ANDROID_RN}/rn-field.xml`, LR2, ADB_STOP, 'the label overhangs its EditText by 3 px, past the 2-px allowance'),
  ]),
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
  },
};

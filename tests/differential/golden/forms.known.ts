import { ANDROID, IDB_STROKE, IDB_STROKE_ABOVE_KEYBOARD, IDB_UNDER_KEYBOARD, IOS, keys, NO_CLOSE_IT_FIRST, NOT_IN_TREE, twice, type KnownFile } from './known.js';

// The forms family's ratchet (fixtures/apps/cells/forms.json, phase 1b).

// This KNOWN owns the ratchet for the lab finding's rows too (L2); scripts/truth/calibration.json owns only the link
// from its note to the rows. A fix that strikes those rows off here turns L2 OPEN-NOT-REPRODUCED, and calibrate.ts
// exits 1, until the note's entry becomes `calibrate` with that fix as its after commit.
const LAB_IOS = 'bug:2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md';
// Phase 2b's Android form cells. L1 (presented.known.ts owns its rows there): uiautomator lists only the presented
// window — here the picker's ModalBottomSheet — so the form beneath is not found and scroll_until strokes the sheet.
const LAB_ANDROID_PRESENTED = 'bug:2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md';
const LAB_ANDROID_BAR = 'bug:2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md';
/** The Android picker sheet's scroll_until stroke (the sheet fully expanded, 1080x2220). */
const ADB_SHEET_STROKE = 'adb shell input swipe 540 1768 540 608 1162';

export const forms: KnownFile = {
  family: 'forms',
  known: Object.fromEntries([
    // The form beneath the country picker sheet: the same, a form's fields and its submit.
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented sheet: the tap times out' }),
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented sheet: scroll_until swipes twice beneath it' }),
    // idb lists nothing under the keyboard (src/mcp/tools.ts, tap: "a covered node was absent from idb's tree and the
    // tap timed out waiting for it to appear"): the tap times out — no false Tapped, but no keyboard advice;
    // scroll_until swipes twice ABOVE the keyboard (pinned: a stroke moved under it fails here) and stops "never
    // appeared in the tree" — its touch-downs are right, but a replayed tree cannot show whether they would bring the
    // field out (vacuous).
    ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['tap'], { cls: 'refused without naming the keyboard', kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the tap times out` }),
    ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['scroll_until'], { cls: NOT_IN_TREE, kind: 'not found', calls: twice(IDB_STROKE_ABOVE_KEYBOARD), note: IDB_UNDER_KEYBOARD }),
    // …and the colour assert asked for the keyboard's colour over it (ControlTruth.seen, in the iOS truth since the
    // phase-3 round-3 recapture) finds no node: vacuous, as the tap.
    ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the assert finds no node` }),
    // …and so does its ocr half (phase 4, golden-spec/text.ts#ocrFailsClosed: asked only where the host's recognizer
    // reads — golden.ts#ocrAvailability).
    ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['ocr'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the ocr assert finds no node` }),
    // LAB FINDING, docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md — under
    // idb the submit pinned in the bottom safe-area inset, over the phone field's centre, is no cover: tap answers
    // Tapped and sends `idb ui tap 201 547`, which submits the form; scroll_until calls it fully visible after 0
    // swipes.
    ...keys(`${IOS}/form-keyboard.idb.json`, ['phone'], ['tap'], { cls: 'Tapped', kind: 'Tapped', calls: ['idb ui tap 201 547'], note: 'lab finding: idb reads the pinned submit bar as no cover — the tap submits the form', as: LAB_IOS }),
    ...keys(`${IOS}/form-keyboard.idb.json`, ['phone'], ['scroll_until'], { cls: 'reached with no swipe where a tap fires submit invalid', kind: 'visible', calls: [], note: 'lab finding: idb reads the pinned submit bar as no cover', as: LAB_IOS }),
    // LAB FINDING F2A1, docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md
    // — the phone field under the submit bar riding on the IME: Compose cuts its bounds at Continue, the bar's surface
    // has no node, so the plain stop reads a 970x42 strip with nothing over it.
    ...keys(`${ANDROID}/form-keyboard.xml`, ['phone'], ['scroll_until'], { cls: 'reached with no swipe where a tap fires submit invalid', kind: 'visible', calls: [], note: 'lab finding F2A1: the bar riding on the IME is not in the tree', as: LAB_ANDROID_BAR }),
    ...keys(`${ANDROID}/form-picker.xml`, ['name', 'country', 'submit'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'uiautomator lists only the presented sheet: the tap times out (L1)', as: LAB_ANDROID_PRESENTED }),
    ...keys(`${ANDROID}/form-picker.xml`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(ADB_SHEET_STROKE), note: 'uiautomator lists only the presented sheet: scroll_until strokes it twice (L1)', as: LAB_ANDROID_PRESENTED }),
  ]),
  counts: {
    [`${ANDROID}/form-basic.xml`]: 11,
    [`${ANDROID}/form-errors.xml`]: 12,
    [`${ANDROID}/form-keyboard.xml`]: 25,
    [`${ANDROID}/form-picker.xml`]: 9,
    [`${ANDROID}/form-prefilled.xml`]: 11,
    [`${ANDROID}/form-shared-id.xml`]: 5,
    [`${IOS}/form-basic.idb.json`]: 11,
    [`${IOS}/form-basic.wda.json`]: 11,
    [`${IOS}/form-errors.idb.json`]: 12,
    [`${IOS}/form-errors.wda.json`]: 12,
    [`${IOS}/form-keyboard.idb.json`]: 25,
    [`${IOS}/form-keyboard.wda.json`]: 25,
    [`${IOS}/form-picker.idb.json`]: 9,
    [`${IOS}/form-picker.wda.json`]: 9,
    [`${IOS}/form-prefilled.idb.json`]: 11,
    [`${IOS}/form-prefilled.wda.json`]: 11,
    [`${IOS}/form-shared-id.idb.json`]: 5,
    [`${IOS}/form-shared-id.wda.json`]: 5,
  },
};

import { ANDROID, IDB_STROKE, idbUnmarkedTap, IOS, keys, NOT_YET_IN_TREE, twice, type KnownFile } from './known.js';

// The forms family's ratchet (fixtures/apps/cells/forms.json, phase 1b).

// Phase 2b's Android form cells. uiautomator lists only the presented window — here the picker's ModalBottomSheet,
// fully expanded — so the form beneath is not found and scroll_until strokes the sheet: lab note L1, whose fix
// (d43df5d, round 6) marks the AlertDialog and the half-expanded sheet but not a sheet whose dump carries no scrim.
// Since the amendment "Android's window by the window manager's word" the window manager types the sheet a Dialog's
// window, asked on the miss: the three taps say the presented remedy; scroll_until still strokes the sheet's own list
// (decision 3: a target inside it, not yet composed, reads alike), the residual narrowed to that.
const EXPANDED_SHEET = 'residual:ADR 0018 residual 18 — a target beneath a fully expanded sheet is stroked for on the sheet\'s own list';
/** The Android picker sheet's scroll_until stroke (the sheet fully expanded, 1080x2220). */
const ADB_SHEET_STROKE = 'adb shell input swipe 540 1768 540 608 1162';

export const forms: KnownFile = {
  family: 'forms',
  known: Object.fromEntries([
    // The form beneath the country picker sheet: the same, a form's fields and its submit.
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['tap'], idbUnmarkedTap('idb lists only the presented sheet: the tap times out')),
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented sheet: scroll_until swipes twice beneath it', as: NOT_YET_IN_TREE }),
    ...keys(`${ANDROID}/form-picker.xml`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(ADB_SHEET_STROKE), note: 'uiautomator lists only the presented sheet, marked by the window manager\'s word: scroll_until strokes the sheet\'s own list twice (a target inside it, not yet composed, reads alike), then "never appeared in the tree" with the presented remedy', as: EXPANDED_SHEET }),
  ]),
  counts: {
    [`${ANDROID}/form-basic.xml`]: 16,
    [`${ANDROID}/form-errors.xml`]: 17,
    [`${ANDROID}/form-keyboard.xml`]: 35,
    [`${ANDROID}/form-keyboard-floating.xml`]: 32,
    [`${ANDROID}/form-picker.xml`]: 11,
    [`${ANDROID}/form-prefilled.xml`]: 16,
    [`${ANDROID}/form-shared-id.xml`]: 10,
    [`${ANDROID}/form-format.xml`]: 7,
    [`${ANDROID}/form-grouped.xml`]: 5,
    [`${ANDROID}/form-focus-prefix.xml`]: 5,
    [`${IOS}/form-basic.idb.json`]: 16,
    [`${IOS}/form-basic.wda.json`]: 16,
    [`${IOS}/form-errors.idb.json`]: 17,
    [`${IOS}/form-errors.wda.json`]: 17,
    [`${IOS}/form-keyboard.idb.json`]: 35,
    [`${IOS}/form-keyboard.wda.json`]: 35,
    [`${IOS}/form-picker.idb.json`]: 11,
    [`${IOS}/form-picker.wda.json`]: 11,
    [`${IOS}/form-prefilled.idb.json`]: 16,
    [`${IOS}/form-prefilled.wda.json`]: 16,
    [`${IOS}/form-shared-id.idb.json`]: 10,
    [`${IOS}/form-shared-id.wda.json`]: 10,
  },
};

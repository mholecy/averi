import { ANDROID, IDB_STROKE, IDB_STROKE_ABOVE_KEYBOARD, IDB_UNDER_KEYBOARD, IOS, keys, NO_CLOSE_IT_FIRST, NOT_IN_TREE, NOT_IN_TREE_HINTED, twice, type KnownFile } from './known.js';

// The forms family's ratchet (fixtures/apps/cells/forms.json, phase 1b).

// Phase 2b's Android form cells. uiautomator lists only the presented window — here the picker's ModalBottomSheet,
// fully expanded — so the form beneath is not found and scroll_until strokes the sheet: lab note L1, whose fix
// (d43df5d, round 6) marks the AlertDialog and the half-expanded sheet but not a sheet whose dump carries no scrim.
// L1 is calibrated on those (calibration.json); these rows are ADR 0018's residual 18, accepted by the owner 2026-10-18
// with the active-window hint every Android tap/fill wait and scroll_until not-found now carries — the taps' "to
// appear" reads "close it first" in it, so their judge finds them vacuous (`not in the tree`) where it found them
// refused without the remedy before.
const EXPANDED_SHEET = 'residual:ADR 0018 residual 18 — a fully expanded sheet is no presented window';
const LAB_ANDROID_FLOATING = 'bug:2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md';
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
    // LAB FINDING L2, docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md —
    // under idb the submit lifted onto the keyboard over the phone field's centre read as no cover (a key overhanging
    // the screen's bottom by a rounded point cut the keyboard's run short): fixed by round 8, the phone tap and
    // scroll_until rows refused under Continue, green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING F2A1, docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md
    // — the phone field under the submit bar riding on the IME (Compose cuts its bounds at Continue, the bar's surface
    // has no node): fixed by round 6 (6d8f8de, merged with arch/round-22), the strip refused as cut by the bar — the
    // phone scroll_until row green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING FU1 — round 4's form-keyboard-floating (Gboard floating, its panel 71,1092 937x792 above the 132-px
    // strip): the pinned submit between the panel and the strip is drawn and takes its tap, but scroll_until cuts the
    // whole screen at the panel's top (the floating fix's documented full-width cut) and refuses it after two swipes.
    ...keys(`${ANDROID}/form-keyboard-floating.xml`, ['submit'], ['scroll_until'], { cls: 'stopped', kind: 'refused', calls: twice('adb shell input swipe 540 874 540 218 657'), note: 'lab finding FU1: the panel cut as a full-width band', as: LAB_ANDROID_FLOATING }),
    ...keys(`${ANDROID}/form-picker.xml`, ['name', 'country', 'submit'], ['tap'], { cls: NOT_IN_TREE_HINTED, kind: 'not found', calls: [], note: 'uiautomator lists only the presented sheet, unmarked (no scrim): the tap times out "to appear" with the active-window hint — its conditional "close it first", not the presented remedy', as: EXPANDED_SHEET }),
    ...keys(`${ANDROID}/form-picker.xml`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(ADB_SHEET_STROKE), note: 'uiautomator lists only the presented sheet, unmarked (no scrim): scroll_until strokes it twice, then "never appeared in the tree" with the active-window hint', as: EXPANDED_SHEET }),
  ]),
  counts: {
    [`${ANDROID}/form-basic.xml`]: 16,
    [`${ANDROID}/form-errors.xml`]: 17,
    [`${ANDROID}/form-keyboard.xml`]: 35,
    [`${ANDROID}/form-keyboard-floating.xml`]: 32,
    [`${ANDROID}/form-picker.xml`]: 11,
    [`${ANDROID}/form-prefilled.xml`]: 16,
    [`${ANDROID}/form-shared-id.xml`]: 10,
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

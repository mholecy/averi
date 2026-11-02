import { ANDROID, IDB_STROKE, IOS, keys, NO_CLOSE_IT_FIRST, twice, type KnownFile } from './known.js';

// The forms family's ratchet (fixtures/apps/cells/forms.json, phase 1b).

// Phase 2b's Android form cells. uiautomator lists only the presented window — here the picker's ModalBottomSheet,
// fully expanded — so the form beneath is not found and scroll_until strokes the sheet: lab note L1, whose fix
// (d43df5d, round 6) marks the AlertDialog and the half-expanded sheet but not a sheet whose dump carries no scrim.
// L1 is calibrated on those (calibration.json); these rows were ADR 0018's residual 18, accepted by the owner
// 2026-10-18 with the active-window hint. Since the amendment "Android's window by the window manager's
// word" the window manager types the sheet a Dialog's window, asked on the miss: the three taps say the presented
// remedy, green, struck off; scroll_until still strokes the sheet's own list (decision 3: a target inside it, not yet
// composed, reads alike), the residual narrowed to that.
const EXPANDED_SHEET = 'residual:ADR 0018 residual 18 — a target beneath a fully expanded sheet is stroked for on the sheet\'s own list';
/** The Android picker sheet's scroll_until stroke (the sheet fully expanded, 1080x2220). */
const ADB_SHEET_STROKE = 'adb shell input swipe 540 1768 540 608 1162';

export const forms: KnownFile = {
  family: 'forms',
  known: Object.fromEntries([
    // The form beneath the country picker sheet: the same, a form's fields and its submit.
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['tap'], { cls: NO_CLOSE_IT_FIRST, kind: 'not found', calls: [], note: 'idb lists only the presented sheet: the tap times out' }),
    ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['scroll_until'], { cls: 'swiped 2× beneath the sheet', kind: 'not found', calls: twice(IDB_STROKE), note: 'idb lists only the presented sheet: scroll_until swipes twice beneath it' }),
    // idb lists nothing under the keyboard: the form-keyboard fields' scroll_until (two strokes ABOVE the keyboard,
    // then "never appeared in the tree"), colour and ocr rows were vacuous here until D32 slice 1: the replayed tree
    // lists no node of the field (golden-spec.ts#unlistedIn), so their "not found" is judged — green while it names
    // idb's reasons (and, scroll_until, the soft keyboard) — struck off. Their tap timed out with idb's reasons and no
    // keyboard advice until D32 slice 4 (K1): it now names the soft keyboard, read up by shape, and the way out
    // (src/interact/resolve.ts#notFound) — green, struck off.
    // LAB FINDING L2, docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md —
    // under idb the submit lifted onto the keyboard over the phone field's centre read as no cover (a key overhanging
    // the screen's bottom by a rounded point cut the keyboard's run short): fixed by round 8, the phone tap and
    // scroll_until rows refused under Continue, green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING F2A1, docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md
    // — the phone field under the submit bar riding on the IME (Compose cuts its bounds at Continue, the bar's surface
    // has no node): fixed by round 6 (6d8f8de, merged with arch/round-22), the strip refused as cut by the bar — the
    // phone scroll_until row green, struck off here, calibrated in scripts/truth/calibration.json.
    // LAB FINDING FU1, docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md
    // — the pinned submit between a floating Gboard's panel and its strip, refused under the full-width cut: fixed by
    // round 1023b (ADR 0027, the panel gap is the app's), the submit scroll_until row green, struck off here,
    // calibrated in scripts/truth/calibration.json.
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

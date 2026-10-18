import { ANDROID, IDB_STROKE_ABOVE_KEYBOARD, IDB_UNDER_KEYBOARD, IOS, keys, NOT_IN_TREE, twice, type KnownFile } from './known.js';

// The false-covers family's ratchet (fixtures/apps/cells/false-covers.json, phase 3 B5): own-parts (both platforms;
// round 6's icon-button target I — 10 rows each; on iOS, captured by round 6's iOS device check, both sources list the
// button alone, labelled Close, and tap it by its label: green), toolbar-dismiss, toolbar-dismiss-bar and
// toolbar-dismiss-short (iOS: form cells).

const UNDER_KEYBOARD = ['vs', 'ks', 'ss', 'note'];

export const falseCovers: KnownFile = {
  family: 'false-covers',
  known: Object.fromEntries(
    // Under idb the cells' keyboardDismiss is inert (flow/config.ts#inertKeyboardDismissNote), so the form's own
    // under-keyboard rows stand — and idb lists nothing under the keyboard, as on form-keyboard (forms.known.ts): the
    // tap times out, scroll_until swipes twice above the keyboard and stops "never appeared in the tree"; the colour
    // assert (the keyboard's colour over it, ControlTruth.seen, in the truth since the phase-3 round-3 recapture) finds
    // no node (vacuous).
    ['toolbar-dismiss', 'toolbar-dismiss-bar', 'toolbar-dismiss-short'].flatMap((cell) => [
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['tap'], { cls: 'refused without naming the keyboard', kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the tap times out` }),
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['scroll_until'], { cls: NOT_IN_TREE, kind: 'not found', calls: twice(IDB_STROKE_ABOVE_KEYBOARD), note: IDB_UNDER_KEYBOARD }),
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['colour'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the assert finds no node` }),
      // Its ocr half (phase 4), asked only where the host's recognizer reads (golden.ts#ocrAvailability): no node either.
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['ocr'], { cls: NOT_IN_TREE, kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the ocr assert finds no node` }),
    ]),
  ),
  counts: {
    [`${ANDROID}/own-parts.xml`]: 10,
    [`${IOS}/own-parts.idb.json`]: 10,
    [`${IOS}/own-parts.wda.json`]: 10,
    [`${IOS}/toolbar-dismiss.idb.json`]: 34,
    [`${IOS}/toolbar-dismiss.wda.json`]: 34,
    [`${IOS}/toolbar-dismiss-bar.idb.json`]: 34,
    [`${IOS}/toolbar-dismiss-bar.wda.json`]: 34,
    [`${IOS}/toolbar-dismiss-short.idb.json`]: 34,
    [`${IOS}/toolbar-dismiss-short.wda.json`]: 34,
  },
};

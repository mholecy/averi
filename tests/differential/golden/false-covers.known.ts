import { ANDROID, IDB_STROKE_ABOVE_KEYBOARD, IOS, keys, twice, type KnownFile } from './known.js';

// The false-covers family's ratchet (fixtures/apps/cells/false-covers.json, phase 3 B5): own-parts (both platforms),
// toolbar-dismiss and toolbar-dismiss-bar (iOS: form cells).

const UNDER_KEYBOARD = ['vs', 'ks', 'ss', 'note'];

export const falseCovers: KnownFile = {
  family: 'false-covers',
  known: Object.fromEntries(
    // Under idb the cells' keyboardDismiss is inert (flow/config.ts#inertKeyboardDismissNote), so the form's own
    // under-keyboard rows stand — and idb lists nothing under the keyboard, as on form-keyboard (forms.known.ts): the
    // tap times out, scroll_until swipes twice above the keyboard and stops "never appeared in the tree".
    ['toolbar-dismiss', 'toolbar-dismiss-bar'].flatMap((cell) => [
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['tap'], { cls: 'refused without naming the keyboard', kind: 'not found', calls: [], note: 'idb lists nothing under the keyboard: the tap times out' }),
      ...keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['scroll_until'], { cls: 'not in the tree', kind: 'not found', calls: twice(IDB_STROKE_ABOVE_KEYBOARD), note: 'idb lists nothing under the keyboard' }),
    ]),
  ),
  counts: {
    [`${ANDROID}/own-parts.xml`]: 4,
    [`${IOS}/own-parts.idb.json`]: 4,
    [`${IOS}/own-parts.wda.json`]: 4,
    [`${IOS}/toolbar-dismiss.idb.json`]: 16,
    [`${IOS}/toolbar-dismiss.wda.json`]: 16,
    [`${IOS}/toolbar-dismiss-bar.idb.json`]: 16,
    [`${IOS}/toolbar-dismiss-bar.wda.json`]: 16,
  },
};

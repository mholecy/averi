import { ANDROID, IDB_UNDER_KEYBOARD, IOS, keys, type KnownFile } from './known.js';

// The false-covers family's ratchet (fixtures/apps/cells/false-covers.json, phase 3 B5): own-parts (both platforms;
// round 6's icon-button target I — 10 rows each; on iOS, captured by round 6's iOS device check, both sources list the
// button alone, labelled Close, and tap it by its label: green), toolbar-dismiss, toolbar-dismiss-bar and
// toolbar-dismiss-short (iOS: form cells); tap-catcher-beneath and tap-catcher-stacked (round 16, iOS: a hidden
// screen-wide tap-catcher beneath the targets — ADR 0018 residual 9's false-positive probe; every row green).

const UNDER_KEYBOARD = ['vs', 'ks', 'ss', 'note'];

export const falseCovers: KnownFile = {
  family: 'false-covers',
  known: Object.fromEntries(
    // Under idb the cells' keyboardDismiss is inert (flow/config.ts#inertKeyboardDismissNote), so the form's own
    // under-keyboard rows stand — and idb lists nothing under the keyboard, as on form-keyboard (forms.known.ts): the
    // tap times out. scroll_until (two strokes above the keyboard, then "never appeared in the tree"), the colour
    // assert (the keyboard's colour over it, ControlTruth.seen) and its ocr half find no node: vacuous here until D32
    // slice 1, which judges that "not found" where the replayed tree lists no node of the field (golden-spec.ts
    // #unlistedIn) — green while it names idb's reasons (and, scroll_until, the soft keyboard) — struck off.
    ['toolbar-dismiss', 'toolbar-dismiss-bar', 'toolbar-dismiss-short'].flatMap((cell) =>
      keys(`${IOS}/${cell}.idb.json`, UNDER_KEYBOARD, ['tap'], { cls: 'refused without naming the keyboard', kind: 'not found', calls: [], note: `${IDB_UNDER_KEYBOARD}: the tap times out` }),
    ),
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
    [`${IOS}/tap-catcher-beneath.idb.json`]: 12,
    [`${IOS}/tap-catcher-beneath.wda.json`]: 12,
    [`${IOS}/tap-catcher-stacked.idb.json`]: 12,
    [`${IOS}/tap-catcher-stacked.wda.json`]: 12,
  },
};

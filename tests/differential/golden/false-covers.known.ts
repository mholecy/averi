import { ANDROID, IOS, type KnownFile } from './known.js';

// The false-covers family's ratchet (fixtures/apps/cells/false-covers.json, phase 3 B5): own-parts (both platforms;
// round 6's icon-button target I — 10 rows each; on iOS, captured by round 6's iOS device check, both sources list the
// button alone, labelled Close, and tap it by its label), toolbar-dismiss, toolbar-dismiss-bar and
// toolbar-dismiss-short (iOS: form cells); tap-catcher-beneath and tap-catcher-stacked (round 16, iOS: a hidden
// screen-wide tap-catcher beneath the targets — ADR 0018 residual 9's false-positive probe).
// tap-catcher-beneath-flat (backlog A43, iOS; captured 2026-11-13): A–D open — its prediction is ADR 0018's A43
// amendment; tests/truth/flat-catcher-listing.test.ts keys on these counts.

export const falseCovers: KnownFile = {
  family: 'false-covers',
  // Under idb the cells' keyboardDismiss is inert (flow/config.ts#inertKeyboardDismissNote), so the form's own
  // under-keyboard rows stand — and idb lists nothing under the keyboard, as on form-keyboard (forms.known.ts).
  known: {},
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
    [`${IOS}/tap-catcher-beneath-flat.idb.json`]: 12,
    [`${IOS}/tap-catcher-beneath-flat.wda.json`]: 12,
  },
};

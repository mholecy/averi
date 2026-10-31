import { ANDROID_RN, IOS_RN, type KnownFile } from './known.js';

// The react-native family's ratchet (fixtures/apps/cells/react-native.json, round 7): rn-field, captured from the
// React Native lab app (fixtures/apps/rn) on both platforms — calibration.json #18's field half. No known mismatch:
// N's and M's labels, refused as under their own field under WDA (an input in an unnamed wrapper of its rect, LR1) and
// on Android (a label overhanging its EditText by 3 px, LR2), are their own field's since ce19c234 + f3a7043f
// (src/ui-tree/draw-order.ts; docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md) — tap, scroll_until and
// ocr green under every source (the ocr rows judged outside the sandbox, where Vision runs).
// rn-banner (round 9, lab note LR3): each target under a later sibling drawn over its centre (`declared: covered`) —
// green under WDA (ADR 0015's amendment of 2026-10-25); under idb its residual: idb lists no bare View (U's and C's
// covers), and T's toast above the flat list's top-bar line is read as its bar — every tap Tapped, every colour assert
// passing on the cover.

const IDB_COVER_UNSEEN = 'residual:ADR 0015 residual 4 — idb lists no bare React Native View, and reads a cover above its top-bar line as the bar';
const BANNER_IDB = `${IOS_RN}/rn-banner.idb.json`;

export const reactNative: KnownFile = {
  family: 'react-native',
  known: Object.fromEntries([
    ...(['T', 'U', 'C'] as const).flatMap((t) => [
      [`${BANNER_IDB} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`idb ui tap 201 ${({ T: 142, U: 322, C: 502 } as const)[t]}`], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
      [`${BANNER_IDB} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
    ]),
  ]),
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${ANDROID_RN}/rn-format.xml`]: 8,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
    [BANNER_IDB]: 6,
    [`${IOS_RN}/rn-banner.wda.json`]: 6,
  },
};

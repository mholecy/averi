import { ANDROID_RN, IOS_RN, type KnownFile } from './known.js';

// The react-native family's ratchet (fixtures/apps/cells/react-native.json, round 7): rn-field, captured from the
// React Native lab app (fixtures/apps/rn) on both platforms — calibration.json #18's field half. No known mismatch:
// N's and M's labels, refused as under their own field under WDA (an input in an unnamed wrapper of its rect, LR1) and
// on Android (a label overhanging its EditText by 3 px, LR2), are their own field's since ce19c234 + f3a7043f
// (src/ui-tree/draw-order.ts; docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md) — tap, scroll_until and
// ocr green under every source (the ocr rows judged outside the sandbox, where Vision runs).
// rn-banner (round 9, lab note LR3): each target under a later sibling drawn over its centre (`declared: covered`) —
// every tap Tapped, every colour assert passing on the cover, under WDA and idb.

const LR3 = 'bug:2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md';
const BANNER = (source: 'idb' | 'wda') => `${IOS_RN}/rn-banner.${source}.json`;
const BANNER_IDB = BANNER('idb');

export const reactNative: KnownFile = {
  family: 'react-native',
  known: Object.fromEntries(
    (['idb', 'wda'] as const).flatMap((source) =>
      (['T', 'U', 'C'] as const).flatMap((t) => [
        [`${BANNER(source)} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`idb ui tap 201 ${({ T: 142, U: 322, C: 502 } as const)[t]}`], note: 'the cover listed before the target (T, U) or excused as a named leaf (U, C)', as: LR3 }] as const,
        [`${BANNER(source)} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: 'the colour of the cover drawn over it', as: LR3 }] as const,
      ]),
    ),
  ),
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
    [BANNER_IDB]: 6,
    [`${IOS_RN}/rn-banner.wda.json`]: 6,
  },
};

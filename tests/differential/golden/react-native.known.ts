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
// passing on the cover. Captured on Android by T6 (2026-11-09; the React Native app's run): a NEW LAB FINDING, not filed
// yet — uiautomator lists each cover (T's `Saved`, U's and C's bare `.cover` Views) BEFORE its target, though the JSX
// draws it over the target as its later sibling (the screenshot: 34 % of T and U, 19 % of C in their own colour, the
// rest the cover's #263238; the probe at each centre fired no tap) — so every tap is Tapped and every colour assert
// passes on the cover, C's too (its cover starting below its top, as on iOS where WDA judges it covered). The rows
// are listed here to keep the ratchet whole; no src change (T6 is the harness's).

const IDB_COVER_UNSEEN = 'residual:ADR 0015 residual 4 — idb lists no bare React Native View, and reads a cover above its top-bar line as the bar';
const BANNER_IDB = `${IOS_RN}/rn-banner.idb.json`;
const BANNER_ANDROID = `${ANDROID_RN}/rn-banner.xml`;

export const reactNative: KnownFile = {
  family: 'react-native',
  known: Object.fromEntries([
    ...(['T', 'U', 'C'] as const).flatMap((t) => [
      [`${BANNER_IDB} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`idb ui tap 201 ${({ T: 142, U: 322, C: 502 } as const)[t]}`], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
      [`${BANNER_IDB} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
    ]),
    ...(['T', 'U', 'C'] as const).flatMap((t) => [
      [`${BANNER_ANDROID} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`adb shell input tap 541 ${({ T: 391, U: 886, C: 1381 } as const)[t]}`], note: 'uiautomator lists the cover before its target: the target read as drawn over it (T6, unfiled)' }] as const,
      [`${BANNER_ANDROID} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: 'uiautomator lists the cover before its target: the cover sampled as the target (T6, unfiled)' }] as const,
    ]),
  ]),
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${ANDROID_RN}/rn-format.xml`]: 8,
    [`${ANDROID_RN}/rn-format-eager.xml`]: 8,
    [BANNER_ANDROID]: 6,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
    [BANNER_IDB]: 6,
    [`${IOS_RN}/rn-banner.wda.json`]: 6,
  },
};

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
// passing on the cover. Captured on Android by T6 (2026-11-09; the React Native app's run): lab note LR4
// (docs/bugs/2026-11-09-lab-android-uiautomator-lists-a-react-native-cover-before-its-target-so-it-is-tapped-and-measured.md,
// calibration.json LR4, backlog D75) — uiautomator lists each cover (T's `Saved`, U's and C's bare `.cover` Views)
// BEFORE its target, though the JSX draws it over the target as its later sibling: AOSP sorts a classic ViewGroup's
// children by location. Green since D75 (the parser marks such a run `readingOrder`; the eyes tell each cover over its
// target: every tap refused, every colour assert failing closed; ADR 0015's amendment "Android Views list children by
// location").
// rn-banner-role (backlog D77, sub-case b; captured 2026-11-11): rn-banner with each target and its cover in a slot View
// of role `toolbar`, dumped as `android.view.View` (slot left 72.5 px, dumped 73) — the run stays unmarked and LR4's lie
// survives, as predicted: every tap `Tapped` at the target's centre (on the cover), every colour assert passing on the
// cover. ADR 0015's React Native role residual (amendment "Android Views list children by location") — filed without
// `as:`: that residual is unnumbered, and lab-notes.test.ts accepts only a numbered ADR residual or a calibration status.

const IDB_COVER_UNSEEN = 'residual:ADR 0015 residual 4 — idb lists no bare React Native View, and reads a cover above its top-bar line as the bar';
const BANNER_IDB = `${IOS_RN}/rn-banner.idb.json`;
const BANNER_ANDROID = `${ANDROID_RN}/rn-banner.xml`;
const ROLE_UNMARKED = 'ADR 0015\'s React Native role residual (amendment "Android Views list children by location", unnumbered, so no `as:` yet): a `toolbar`-role slot dumps as android.view.View, the run stays unmarked';
const BANNER_ROLE = `${ANDROID_RN}/rn-banner-role.xml`;

export const reactNative: KnownFile = {
  family: 'react-native',
  known: Object.fromEntries([
    ...(['T', 'U', 'C'] as const).flatMap((t) => [
      [`${BANNER_IDB} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`idb ui tap 201 ${({ T: 142, U: 322, C: 502 } as const)[t]}`], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
      [`${BANNER_IDB} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: 'idb: the cover is not listed, or read as the top bar', as: IDB_COVER_UNSEEN }] as const,
    ]),
    ...(['T', 'U', 'C'] as const).flatMap((t) => [
      [`${BANNER_ROLE} ${t} tap`, { cls: 'Tapped', kind: 'Tapped' as const, calls: [`adb shell input tap 541 ${({ T: 391, U: 886, C: 1381 } as const)[t]}`], note: `${ROLE_UNMARKED} — the cover read beneath the target` }] as const,
      [`${BANNER_ROLE} ${t} colour`, { cls: 'passed on #263238', kind: 'PASS' as const, calls: [], note: `${ROLE_UNMARKED} — the cover measured as the target` }] as const,
    ]),
  ]),
  counts: {
    [`${ANDROID_RN}/rn-field.xml`]: 10,
    [`${ANDROID_RN}/rn-format.xml`]: 8,
    [`${ANDROID_RN}/rn-format-eager.xml`]: 8,
    [BANNER_ANDROID]: 6,
    [BANNER_ROLE]: 6,
    [`${IOS_RN}/rn-field.idb.json`]: 10,
    [`${IOS_RN}/rn-field.wda.json`]: 10,
    [BANNER_IDB]: 6,
    [`${IOS_RN}/rn-banner.wda.json`]: 6,
  },
};

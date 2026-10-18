import { ANDROID_RN, IOS_RN, type KnownFile } from './known.js';

// The react-native family's ratchet (fixtures/apps/cells/react-native.json, round 7): rn-field, captured from the
// React Native lab app (fixtures/apps/rn) on both platforms — calibration.json #18's field half.

export const reactNative: KnownFile = {
  family: 'react-native',
  known: {},
  counts: {},
};

void IOS_RN;
void ANDROID_RN;

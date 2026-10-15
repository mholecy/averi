import { ANDROID, IOS, type KnownFile } from './known.js';

// The base family's ratchet (fixtures/apps/cells/base.json): the open control — no known mismatch.

export const base: KnownFile = {
  family: 'base',
  known: {},
  counts: {
    [`${ANDROID}/open.xml`]: 12,
    [`${IOS}/open.idb.json`]: 12,
    [`${IOS}/open.wda.json`]: 12,
  },
};

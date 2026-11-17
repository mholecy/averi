import { IDB_TYPEABLE, idbTypingRefusal } from '../../src/adapters/ios-typing.js';
import type { IosTreeSource } from '../../src/adapters/ios-tree-source.js';

/** The typing of a fake iOS tree source that types nothing beyond idb, as IdbTreeSource's: idb's set, every wider text refused in idb's words. */
export const IDB_TYPING: Pick<IosTreeSource, 'typeable' | 'typeWide'> = {
  typeable: IDB_TYPEABLE,
  typeWide: (text) => Promise.reject(new Error(idbTypingRefusal(text))),
};

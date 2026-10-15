import type { ApplicationLabel, IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import type { UiNode } from '../../src/adapters/types.js';
import type { Recording } from './corpus.js';

/**
 * The recorded adapter at the iOS tree-source seam (src/adapters/
 * ios-tree-source.ts#IosTreeSource; idb and WDA are the live two): it reads
 * the tree a device check captured instead of a simulator's, and hands it
 * to IosAdapter like any source. It lives with the harness, not in src/: no
 * user can configure it (it is not an `IosTreeSourceKind` — it reports the
 * kind of the source it replays), and it must work against an OLD tree that
 * predates it, so it takes the parser of the code under test as an argument
 * instead of importing one.
 *
 * Which recordings come through here, and why only these:
 *  - a RAW WDA capture (`/source?format=json` bytes): read through the side's
 *    own `parseWdaSourceValue` — exactly what WdaTreeSource.read does with
 *    WdaServer.source()'s `res.json()`. WDA has no narrower seam to replay
 *    at: below WdaTreeSource is WdaServer's process lifecycle.
 *  - a NORMALIZED capture of either kind (a `ui_snapshot` tree): served as
 *    it is; the parser is not exercised — but a WDA tree's root is given the
 *    mark the WDA parser sets on every tree now (UiNode.unclippedFrames,
 *    which a `ui_snapshot` saved before it lacks), so the sweep judges it as
 *    the live source's tree; an OLD side ignores a field it does not know.
 * A RAW idb capture does not: idb's source has a narrower seam already — its
 * `exec` — so it is replayed by the side's own IdbTreeSource over the fake
 * device (fake-device.ts answers `ui describe-all`), empty-tree error and
 * all.
 *
 * Every read is a fresh graph (the seam's contract: the layers above write
 * into nodes — field-error pairing — so no source hands out a cached one).
 */
export class RecordedTreeSource implements IosTreeSource {
  readonly kind: 'wda' | 'idb';

  constructor(
    private readonly recording: Recording,
    private readonly parseWdaSourceValue: (value: unknown) => UiNode,
    /** Told of every read — the fake device's call log, so a recorded read counts like a device's. */
    private readonly onRead: (what: string) => void = () => {},
  ) {
    if (recording.platform !== 'ios' || recording.source === 'uiautomator') {
      throw new Error(`RecordedTreeSource replays iOS trees; ${recording.id} is ${recording.platform} ${recording.source}`);
    }
    if (recording.form === 'raw' && recording.source === 'idb') {
      throw new Error(`RecordedTreeSource: ${recording.id} is a raw idb payload — replay it through IdbTreeSource over the fake device`);
    }
    this.kind = recording.source;
  }

  async read(): Promise<UiNode> {
    this.onRead(`${this.kind} tree read (${this.recording.form})`);
    const value: unknown = JSON.parse(this.recording.payload);
    if (this.recording.form === 'raw') return this.parseWdaSourceValue(value);
    return this.kind === 'wda' ? { ...(value as UiNode), unclippedFrames: true } : (value as UiNode);
  }

  /** As WdaTreeSource answers (declined, no read); a normalized tree keeps no element types to answer from. */
  async applicationLabel(): Promise<ApplicationLabel> {
    return this.kind === 'wda' ? { kind: 'declined' } : { kind: 'unlabelled' };
  }

  async dispose(): Promise<void> {}
}

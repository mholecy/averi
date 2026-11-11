import type { AdapterFactory } from '../../src/mcp/registry.js';
import { liveIosLine, type LiveIosDeps, type Side } from '../differential/side.js';
import { hookSwipes, type SwipeHook } from './live-carousel.js';

/**
 * The live golden's adapter factory (scripts/truth/live.ts's registry): Android, the side's own defaultFactory with
 * its strokes routed through the carousel group's hook (live-carousel.ts#hookSwipes); iOS, the side's live iOS
 * adapter (side.ts `liveIos`: its registry.ts#iosAdapterFor since A23, else the older construction), handed the lab's
 * WebDriverAgent deps — never an adapter built here. A side with no live iOS adapter is refused at the first iOS call.
 */
export function liveFactory(side: Pick<Side, 'root' | 'defaultFactory' | 'liveIos'>, opts: { wda: LiveIosDeps; swipeHook: SwipeHook }): AdapterFactory {
  return (platform, deviceId, adapterOpts) => {
    if (platform === 'android') return hookSwipes(side.defaultFactory(platform, deviceId, adapterOpts), opts.swipeHook);
    if (side.liveIos === undefined) throw new Error(`side ${side.root}: ${liveIosLine(undefined)} — the live golden cannot build its iOS adapter`);
    return side.liveIos.adapter(deviceId, adapterOpts?.treeSource ?? 'idb', opts.wda);
  };
}

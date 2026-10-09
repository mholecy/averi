import type { DeviceAdapter, Platform } from '../adapters/types.js';
import { resolveLaunchActivity, type AveriConfig, type LaunchEntry } from './config.js';

/**
 * One launch: the flow's `launch:` step and the `launch_app` tool, written
 * once (2026-10-09).
 *
 * Until then each wrote it out — resolve the activity, call the adapter,
 * word the outcome — and the two had drifted: `launch_app { clearState:
 * true }` neither printed the `⚠ clearState` warning nor counted the wipe in
 * the session, so a wipe made directly was invisible to the "(N this
 * session)" every flow wipe printed after it. Now both call `launchApp`, and
 * a wipe is counted and worded here whichever way it was asked for. The
 * engine logs the result as trace lines; the tool renders it as its reply
 * (mcp/tool-text.ts#launchText). What each caller keeps is where its app id
 * comes from: the step's from averi.yaml's `app` section, the tool's from
 * its argument — so this takes it resolved.
 */

/**
 * What outlives one engine run: the state of the SESSION that runs it. Today
 * that is one number, how many wipes (`launch { clearState: true }` steps
 * and, since 2026-10-09, `launch_app { clearState: true }` calls) the
 * session has performed — the `⚠ clearState` line's "(3 this session)",
 * which is what makes a finite resource (a device registration) budgetable.
 * It lives here because the launch is its one writer (2026-10-09; it was in
 * flow/engine.ts).
 *
 * Owned by the caller and handed in (`EngineOptions.session`, and
 * `launchApp`'s argument), as the environment is (2026-10-04). Until
 * 2026-10-07 it was a module-level `let` with an exported reset for tests:
 * every engine in the PROCESS shared it, so a second server built in one
 * process (each test file, an embedder of createAveriServer) continued the
 * first one's count, and each engine test file had to remember to zero it.
 * The MCP server (mcp/tools.ts) now makes one per server — the server IS the
 * session — and passes it to every tool that runs the engine, and to
 * launch_app.
 */
export class EngineSession {
  #clearStateCount = 0;

  /** How many wipes this session has performed so far. */
  get clearStateCount(): number {
    return this.#clearStateCount;
  }

  /** Counts one wipe and returns the new total — the number the `⚠ clearState` line prints. */
  recordClearState(): number {
    return ++this.#clearStateCount;
  }
}

/** A launch as its caller asks for it: the app id resolved, the platform the adapter's. */
export type LaunchRequest = Omit<LaunchEntry, 'platform'> & { clearState?: boolean };

/**
 * What a launch did, worded — each field one line of the flow's trace and
 * of launch_app's reply, in this order (the first through `launchedLine`).
 */
export interface Launched {
  /**
   * `<appId>[/<Activity>]`: the activity by its last path segment (a
   * fully-qualified `pkg/pkg.MainActivity` reads as `pkg.MainActivity`), and
   * whichever one the launch actually used, so a fallback to averi.yaml's is
   * visible. The line it heads is `launchedLine`'s.
   */
  app: string;
  /**
   * The launch's caveat (LaunchOutcome.note — today iOS's foreground wait
   * giving up: the tree may still be the app this launch covered,
   * adapters/ios-foreground.ts). A `⚠` line, not a failure: the app was
   * launched, and what reads the wrong app's tree next is what it warns about.
   */
  note?: string;
  /** The `⚠ clearState` sentence, with the session's count — set exactly when the launch wiped. */
  wiped?: string;
}

/**
 * The cost of a wipe is invisible at the moment it is paid. The sentence
 * states the MECHANISM and leaves the price to the reader: what it costs is
 * app-specific, and averi drives any app. Precise about the mechanism too —
 * this deletes the app's data container (iOS) / runs `pm clear` (Android);
 * it does not clear the iOS keychain, whatever a re-registration afterwards
 * may suggest. The count spans tool calls on purpose: it is the SESSION's.
 */
const wipeSentence = (count: number): string =>
  'app state wiped (data container deleted) — anything the app persisted, ' +
  `a device registration included, is gone (${count} this session)`;

/**
 * The label of the wipe's `⚠` line — the flow's trace action and the prefix
 * of launch_app's reply line (`⚠ clearState: <wiped>`). One spelling, as the
 * sentence is.
 */
export const WIPE_LABEL = '⚠ clearState';

/**
 * Launch `request.appId` on `adapter`: the activity resolved against
 * averi.yaml (flow/config.ts#resolveLaunchActivity — `cfg` undefined when
 * there is none), the adapter's launch, and a wipe counted against
 * `session`. Throws what the adapter throws; a wipe is counted only once the
 * launch returned.
 *
 * Known gap (review 2026-10-09, not a regression — the flow step had it
 * before the merge): the adapters wipe BEFORE they launch (Android `pm
 * clear`, iOS `clearAppData`), so a wiping launch that then throws — an
 * activity that does not resolve — has paid the wipe and counts nothing.
 * Counting it needs the adapter to say the wipe happened (an error or
 * outcome carrying it); counting every thrown clearState launch would
 * overcount the ones refused before `pm clear` ran.
 */
export async function launchApp(
  adapter: DeviceAdapter,
  cfg: AveriConfig | undefined,
  session: EngineSession,
  { appId, activity: named, intent, clearState }: LaunchRequest,
): Promise<Launched> {
  const activity = resolveLaunchActivity(cfg, { platform: adapter.platform, appId, activity: named, intent });
  const { note } = await adapter.launch(appId, { clearState, activity, intent });
  return {
    app: appId + (activity === undefined ? '' : `/${activity.split('/').pop()}`),
    note,
    wiped: clearState ? wipeSentence(session.recordClearState()) : undefined,
  };
}

/**
 * `<app>[ on <platform>][ (state cleared)]` — the flow's `launch` trace line
 * (no platform: a flow runs on one) and the body of launch_app's first line
 * (mcp/tool-text.ts#launchText, which has always named the platform before
 * the wipe). One spelling, so the two cannot word a wipe differently.
 */
export const launchedLine = ({ app, wiped }: Launched, platform?: Platform): string =>
  app + (platform === undefined ? '' : ` on ${platform}`) + (wiped === undefined ? '' : ' (state cleared)');

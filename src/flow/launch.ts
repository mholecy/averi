import type { DeviceAdapter, LaunchIntent, Platform } from '../adapters/types.js';
import { appHolderText } from '../interact/app-holder-text.js';
import type { AveriConfig } from './config.js';

/**
 * One launch: the flow's `launch:` step and the `launch_app` tool, written
 * once — resolve the activity, call the adapter, word the outcome — so a wipe
 * is counted and worded here whichever way it was asked for: a wipe made
 * directly must show in the `⚠ clearState` warning and in the "(N this
 * session)" every later wipe prints. What each caller keeps is where its app
 * id comes from: the step's from averi.yaml's `app` section, the tool's from
 * its argument — so this takes it resolved.
 */

/**
 * What outlives one engine run: the state of the SESSION that runs it. Today
 * that is one number, how many wipes (`launch { clearState: true }` steps
 * and `launch_app { clearState: true }` calls) the session has performed —
 * the `⚠ clearState` line's "(3 this session)", which is what makes a finite
 * resource (a device registration) budgetable. It lives here, beside the
 * launch that wipes.
 *
 * Owned by the caller and handed in (`EngineOptions.session`, and
 * `launchApp`'s argument), as the environment is, not kept in the module:
 * module state would be shared by every engine in the PROCESS, so a second
 * server built in one process (each test file, an embedder of
 * createAveriServer) would continue the first one's count. The MCP server
 * makes one per server — the server IS the session.
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

/** What a launch call says about its entry point — a flow `launch:` step or a `launch_app` call. */
export interface LaunchEntry {
  platform: Platform;
  appId: string;
  activity?: string;
  intent?: LaunchIntent;
}

/**
 * WHEN a launch falls back to averi.yaml's `app.android.activity`: on
 * android, and only when the caller named NEITHER an activity NOR an intent.
 */
export function launchConsultsConfigActivity({ platform, activity, intent }: Omit<LaunchEntry, 'appId'>): boolean {
  return platform === 'android' && activity === undefined && intent === undefined;
}

/**
 * The activity a launch starts: the one the caller names, else — when the
 * caller names neither an activity nor an intent — averi.yaml's
 * `app.android.activity`, and only for the very package the config
 * describes. Not android, no config, another package, no activity
 * configured, or an intent given → `undefined`, and the adapter's own rule
 * applies: `monkey -c LAUNCHER` with nothing named (documented on the schema
 * field, flow/config.ts), the intent scoped to the package (`am start -p`) with an
 * intent.
 *
 * The engine's app id always IS the config's package, so the comparison is
 * vacuous there; it is kept in the one place rather than split into "with
 * check" and "without", because a second variant is how two copies of the
 * rule come to disagree.
 *
 * Decided (owner): an intent without an activity is delivered WITHIN THE
 * APP'S PACKAGE, and the config activity stays out of it — for the flow step
 * and for `launch_app` alike. Either other rule is wrong:
 *
 * - consulting the fallback beside an `intent` → `am start -n
 *   <package>/<config activity> -a ACTION`: the intent is forced onto the
 *   launcher activity, which defeats the one reason to write an intent —
 *   exercising a NON-launcher entry point;
 * - skipping it and sending `am start -a ACTION` with no package at all: an
 *   implicit intent the system may resolve to another app, or to a chooser.
 *
 * So the "when" is `launchConsultsConfigActivity` above, and the Android
 * adapter scopes an activity-less intent to the package, so Android's own
 * intent resolution picks the activity whose filter matches — and fails
 * loudly when none does (adapters/android.ts#launch).
 *
 * Rejected: keeping the flow rule and documenting it. A flow that WANTS the
 * intent on a particular activity says so with `activity:` on the step,
 * which is explicit and survives a change of `app.android.activity`; the
 * silent fallback made "which activity got this intent" depend on a config
 * key written for a different purpose (pinning the launcher against
 * LeakCanary). Rejected too: resolving the activity ourselves (`cmd package
 * query-activities`) and passing `-n` — a second resolver beside Android's.
 */
export function resolveLaunchActivity(cfg: AveriConfig | undefined, entry: LaunchEntry): string | undefined {
  if (!launchConsultsConfigActivity(entry)) return entry.activity;
  const android = cfg?.app.android;
  return android?.package === entry.appId ? android.activity : undefined;
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
   * What holds the app, worded (adapters/types.ts#AppHolder, in
   * interact/app-holder-text.ts#appHolderText's words): iOS's foreground wait
   * giving up, the tree perhaps still the app this launch covered; iOS's system
   * alert (D56); Android's chooser in front after a `-p` start (D55b). A `⚠`
   * line, not a failure: the app was launched, and what reads the wrong app's
   * tree next is what it warns about.
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
 * averi.yaml (resolveLaunchActivity above — `cfg` undefined when
 * there is none), the adapter's launch, and a wipe counted against
 * `session`. Throws what the adapter throws; a wipe is counted only once the
 * launch returned.
 *
 * Known gap: the adapters wipe BEFORE they launch (Android `pm clear`, iOS
 * `clearAppData`), so a wiping launch that then throws — an activity that
 * does not resolve — has paid the wipe and counts nothing. Counting it needs
 * the adapter to say the wipe happened (an error or outcome carrying it);
 * counting every thrown clearState launch would overcount the ones refused
 * before `pm clear` ran.
 */
export async function launchApp(
  adapter: DeviceAdapter,
  cfg: AveriConfig | undefined,
  session: EngineSession,
  { appId, activity: named, intent, clearState }: LaunchRequest,
): Promise<Launched> {
  const activity = resolveLaunchActivity(cfg, { platform: adapter.platform, appId, activity: named, intent });
  const answer = await adapter.launch(appId, { clearState, activity, intent });
  return {
    app: appId + (activity === undefined ? '' : `/${activity.split('/').pop()}`),
    note: appHolderText({ app: appId }, answer),
    wiped: clearState ? wipeSentence(session.recordClearState()) : undefined,
  };
}

/**
 * `<app>[ on <platform>][ (state cleared)]` — the flow's `launch` trace line
 * (no platform: a flow runs on one) and the body of launch_app's first line
 * (mcp/tool-text.ts#launchText, which names the platform before the wipe).
 * One spelling, so the two cannot word a wipe differently.
 */
export const launchedLine = ({ app, wiped }: Launched, platform?: Platform): string =>
  app + (platform === undefined ? '' : ` on ${platform}`) + (wiped === undefined ? '' : ' (state cleared)');

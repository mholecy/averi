import { IdbEmptyTreeError } from './ios-tree-source.js';
import { errorMessage } from '../util/error-message.js';
import { formatSeconds } from '../util/duration.js';
import { sleep } from '../util/sleep.js';

/**
 * After an iOS launch, wait until the tree is the launched app's
 * (2026-10-09, docs/bugs/2026-10-09-ios-launch-app-reads-previous-apps-tree.md).
 *
 * The device facts. `simctl launch` returns as soon as the app is asked to
 * come forward, not when it has: measured on iOS 27.0 (iPhone 17 simulator,
 * idb), `launch_app` of a RUNNING app that another app covered returned in
 * 0.8 s and the next two `idb ui describe-all` reads (about a second) were
 * still the previous app's whole tree — tab bar, search field, error text —
 * with Contacts' from the third read; once (05:26) a `ui_snapshot` 2 s after
 * the launch was still the old app's, Contacts' 2 s later. That tree is
 * neither empty (IdbEmptyTreeError) nor bare (ui-tree/bare-tree.ts), so
 * nothing downstream doubted it: an `absent:` assert passed 3 of 3 on the
 * wrong app, and a presence assert on the old app's own field passed too. A
 * COLD launch has the same window with SpringBoard in it (2026-10-08,
 * docs/bugs/2026-10-08-ios-launch-transition-tree-reads-as-rendered.md: the
 * status bar and the zooming icon for ~2 s), which the bare-tree rules
 * recognize by shape; this check recognizes it by name too.
 *
 * The one thing in idb's list that says whose tree it is: the `Application`
 * element heading it, labelled with the app's display name ("Skeleton
 * Internal", "Contacts"; SpringBoard's is a single space) —
 * IosTreeSource.applicationLabel. The launched app's names come from
 * `simctl appinfo` (appInfoNames). So a launch reads until the label is one
 * of them, for at most FOREGROUND_WAIT_MS, and then goes on — with a note
 * naming what it read when it never matched.
 *
 * Fail open, everywhere. The check only ever DELAYS a launch, never fails
 * it, and stops at once without a word when it cannot tell: no names for
 * the bundle (appinfo failed or listed none), a read with no Application
 * (or a source that does not ask — WDA, wda-tree-source.ts), an Application
 * with no label. A read error other than idb's empty tree ends it too, with a
 * note — the device was not read, so nothing was confirmed, and the readers
 * after the launch meet the same error in their own words. idb's empty tree
 * (IdbEmptyTreeError — no tree yet, measured 0.4 s after a launch) is a poll
 * miss: the window this exists for is right behind it.
 *
 * The note's honesty. A label that never matches is either the previous app
 * (or SpringBoard) still in idb's tree, or THIS app under a name its Info.plist
 * does not carry — a localized display name (InfoPlist.strings) on a device
 * in another language, unmeasured — and the check cannot tell which. The
 * note says both and names the one check that can (screenshot).
 *
 * What it costs: every iOS launch through `launch_app` or a flow's `launch:`
 * on the idb source pays at least ONE describe-all read (a few tenths of a
 * second each in the measurement — three reads within about a second), and
 * the first launch of a bundle per adapter one `simctl appinfo` (cached,
 * IosAdapter; under a 10 s budget, its duration unmeasured). A warm launch
 * that lands in the stale window waits it out — about a second, measured; a
 * cold launch waits out SpringBoard's tree — up to about 2 s, measured 2026-10-08 —
 * time the caller's next read would otherwise have spent judging the wrong
 * tree. One that never matches pays the whole bound: at most
 * FOREGROUND_WAIT_MS plus the read in flight when it ends (no read is
 * STARTED after the deadline; one already started is idb's, under its own
 * 15 s budget, ios-tree-source.ts).
 *
 * Not for `openDeepLink`: a link may legitimately bring ANOTHER app forward
 * (a universal link handed to Safari, a link the app routes elsewhere), and
 * the adapter knows no bundle to wait for. Not on Android: the previous app's
 * tree after a switch has not been measured there (uiautomator dumps the
 * focused window), so android.ts waits for nothing.
 */

/**
 * The bound. Three seconds: the measured app-switch window was the first
 * two reads (about a second) and, once, over 2 s; a cold launch's SpringBoard
 * tree lasted ~2 s after `launch_app` returned. The once-over-2 s case can
 * outlast it — the note is then the honest outcome, rather than a longer
 * wait that every never-matching launch (a localized name) would pay.
 */
export const FOREGROUND_WAIT_MS = 3_000;

/**
 * The pause between reads. Short: a describe-all already takes a few tenths
 * of a second, so this only keeps a fast-failing read (the empty tree) from
 * becoming a hot loop.
 */
export const FOREGROUND_POLL_MS = 200;

/**
 * The names an app's Application element may carry, from `xcrun simctl
 * appinfo <udid> <bundle>`: CFBundleDisplayName, then CFBundleName — the
 * home-screen name falls back to the latter when the former is absent, and
 * accepting both costs nothing. The output is an old-style (OpenStep) plist,
 * top-level keys one per line:
 *
 *     CFBundleDisplayName = "Skeleton Internal";
 *     CFBundleName = Skeleton;
 *
 * — quoted when the value has spaces or punctuation, bare otherwise; inside
 * quotes `\"`, `\\`, `\n`, `\t` and `\Uxxxx` (non-ASCII) escapes are decoded.
 * Parsed here rather than through `plutil` to keep the lookup one exec. An
 * output with neither key (an app not installed: appinfo prints no such
 * dictionary) gives `[]`.
 */
export function appInfoNames(stdout: string): string[] {
  const names: string[] = [];
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;"]*);\\s*$`, 'm').exec(stdout);
    if (m === null) continue;
    const name = unquote(m[1].trim()).trim();
    if (name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(U[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
  });
}

/** What the wait needs: the launched bundle, one read of the tree's Application label, and the bundle's names (cached by the caller). */
export interface ForegroundCheck {
  bundleId: string;
  /** IosTreeSource.applicationLabel — one device read per call. */
  label(): Promise<string | null | undefined>;
  /** appInfoNames for the bundle, or undefined when they could not be read. Called at most once per wait. */
  names(): Promise<readonly string[] | undefined>;
}

/**
 * Read until the Application label is one of the bundle's names (see the
 * module comment), and return the note to show when the wait ended without
 * confirming that — or undefined when it confirmed it or could not tell.
 */
export async function awaitForeground(check: ForegroundCheck): Promise<string | undefined> {
  const deadline = Date.now() + FOREGROUND_WAIT_MS;
  let names: readonly string[] | undefined;
  /** The last label that was not a match — what the note names. */
  let stale: string | undefined;
  for (;;) {
    let label: string | null | undefined;
    try {
      label = await check.label();
    } catch (e) {
      // A device that was not read: idb's empty tree is the launch's own
      // transient (read on); anything else is not this check's to diagnose.
      if (!(e instanceof IdbEmptyTreeError)) return unchecked(check.bundleId, e);
      if (Date.now() >= deadline) return stale !== undefined ? notInFront(check.bundleId, stale, names ?? []) : emptyThroughout(check.bundleId);
      await sleep(FOREGROUND_POLL_MS);
      continue;
    }
    // A read that cannot say whose tree it is: nothing to wait for.
    if (label === undefined || label === null || label === '') return undefined;
    names ??= await check.names();
    if (names === undefined || names.length === 0) return undefined;
    if (names.includes(label.trim())) return undefined;
    stale = label;
    if (Date.now() >= deadline) return notInFront(check.bundleId, stale, names);
    await sleep(FOREGROUND_POLL_MS);
  }
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');

/** SpringBoard's Application is labelled with a single space: named as what it is, not as `" "`. */
const whose = (label: string) =>
  label.trim() === '' ? "SpringBoard's (the home screen or the launch animation)" : `the app labelled "${label}"`;

/**
 * The localized-name reading applies only to an APP's label: SpringBoard's
 * `' '` is never the launched app under another name, so its note says
 * only to read again.
 */
function notInFront(bundleId: string, label: string, names: readonly string[]): string {
  const head =
    `${formatSeconds(FOREGROUND_WAIT_MS)} after launching ${bundleId}${names.length > 0 ? ` (${quoted(names)})` : ''}, ` +
    `the UI tree was still ${whose(label)} — iOS can hand idb the previous app's tree for a second or more after an app ` +
    'switch, so a read now may judge the wrong app (an absent check passes on it). Compare with screenshot. ';
  if (label.trim() === '') return head + 'Read again before trusting what the tree says';
  return (
    head +
    `If the screenshot shows ${bundleId}, its on-screen name differs from its Info.plist name (a localized display name) and ` +
    'this can be ignored; otherwise read again before trusting what the tree says'
  );
}

function emptyThroughout(bundleId: string): string {
  return (
    `idb's tree stayed empty for the ${formatSeconds(FOREGROUND_WAIT_MS)} averi waited after launching ${bundleId}, ` +
    'so which app is in front was not checked — compare with screenshot before trusting a read'
  );
}

function unchecked(bundleId: string, e: unknown): string {
  return (
    `could not check that ${bundleId} is in front (${errorMessage(e).split('\n')[0]}) — for a moment after a ` +
    "launch iOS can hand idb the previous app's tree; compare with screenshot before trusting a read"
  );
}

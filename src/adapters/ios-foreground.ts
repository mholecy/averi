import { IdbEmptyTreeError, type ApplicationLabel } from './ios-tree-source.js';
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
 * `simctl appinfo` (simctl-appinfo.ts). So a launch reads until the label is one
 * of them, for at most FOREGROUND_WAIT_MS, and then goes on — with a note
 * naming what it read when it never matched.
 *
 * Fail open: the check only ever DELAYS a launch, never fails it. But it
 * is never SILENT when it could not check (review 2026-10-09): a check
 * that quietly switched itself off — a drift in appinfo's unmeasured
 * format, a tree shape not yet seen — would leave this P0 open on every
 * launch with nothing to say so. So the wait stops at once WITH a note
 * when it cannot tell: the bundle's names could not be read (appinfo
 * failed, or listed neither name), or a read error other than
 * idb's empty tree (the device was not read; the readers after the launch
 * meet the same error in their own words). A read with no Application or
 * an unlabelled one (`unlabelled` — unmeasured shapes, and possibly idb's
 * full-frame launch transient) is a poll miss instead, remembered: if no
 * labelled read follows by the deadline, the note says it could not check.
 * Only a source that does not ask
 * (`declined` — WDA, wda-tree-source.ts, by decision) stays silent. idb's
 * empty tree (IdbEmptyTreeError — no tree yet, measured 0.4 s after a
 * launch) is a poll miss: the window this exists for is right behind it.
 *
 * The note's honesty. A label that never matches is either the previous app
 * (or SpringBoard) still in idb's tree, or THIS app under a name its Info.plist
 * does not carry — a localized display name (InfoPlist.strings) on a device
 * in another language, unmeasured. The screenshot does NOT tell them apart
 * (corrected 2026-10-09, docs/bugs/2026-10-09-ios-launch-give-up-note-says-
 * ignore-when-tree-is-stale.md): the pixels switch before idb's tree does,
 * so in both cases it shows the launched app — measured at 347e70d, the
 * session's first launch, after the bank app (in front since before
 * that server process started, never launched by it) had been in front for minutes: the screenshot
 * showed Contacts while idb still served "Skeleton Internal" ≥ 4.5 s after
 * the launch (a raw read just after the 4.2 s reply), Contacts' first ~15 s
 * (the window ended somewhere between), and the note's "if the screenshot
 * shows <bundle> … this can be ignored" licensed exactly the wrong-app
 * read this wait exists to prevent. What does tell them apart is the label
 * itself, and time; the note is chosen by the label, from what the adapter
 * already holds and with no device call:
 *  - SpringBoard's `' '` — never the launched app under another name: read
 *    again.
 *  - the name of ANOTHER app whose names the adapter holds (`ownerOf`;
 *    IosAdapter's appinfo cache — the bundles this adapter's launches looked
 *    names up for: idb source, this server process; the first match when
 *    two share a name, which can name the wrong one of them but never the
 *    launched app, whose own names matched earlier): the tree is that
 *    app's, whatever the screenshot shows — read again; no localized-name
 *    reading. A flow or session that launched the app it now leaves.
 *  - any other label — an app averi never launched (the MEASURED case:
 *    opened by hand, or before the server started) or a localized name:
 *    treat the tree as the previous app's until a read carries one of the
 *    bundle's names; only a read still under that label LOCALIZED_REREAD_MS
 *    or more after the launch, with the screenshot showing the launched app,
 *    makes it a localized name (the bound and its reason are the
 *    constant's; the measured window the note quotes is
 *    STALE_TREE_MEASURED_MS).
 * Considered and not done: one more read after the bound before writing the
 * note (one read ~3.3 s in would not have outlasted STALE_TREE_MEASURED_MS,
 * and a longer bound is paid by every localized-name launch); asking every
 * installed app's name on the give-up path (`simctl listapps`) — the one
 * lookup that would have named the measured case's app, but its output
 * format and cost are unmeasured, and a parser built blind is the drift
 * this module's "never silent" rule exists for; left to a device
 * measurement.
 *
 * What it costs: every iOS launch through `launch_app` or a flow's `launch:`
 * on the idb source pays at least ONE describe-all read (a few tenths of a
 * second each in the measurement — three reads within about a second), and
 * the first launch of a bundle per adapter one `simctl appinfo` (cached,
 * IosAdapter; under a 10 s budget, its duration unmeasured). A warm launch
 * that lands in the stale window waits it out — about a second, measured; a
 * cold launch waits out SpringBoard's tree — up to about 2 s, measured
 * 2026-10-08 — time the caller's next read would otherwise have spent
 * judging the wrong tree.
 *
 * The worst cases. One that never matches pays the whole bound: the
 * FOREGROUND_WAIT_MS window, which starts when the names have arrived (so a
 * slow first appinfo — up to its 10 s budget — is added to it, not taken
 * from it), plus the read in flight when it ends: no read is STARTED at or
 * after the deadline, but one already started is idb's, under its own 15 s
 * budget (ios-tree-source.ts) — so a launch on a hung idb now takes up to
 * 15 s before its "could not check" note. And nothing is cached about a
 * never-matching app: a localized display name costs the full window and a
 * note on EVERY launch — N windows for an ensure_state ladder with N launch
 * rungs.
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
 * The longest the previous app's tree was measured outlasting a launch — at
 * least this long (2026-10-09, at 347e70d: a raw read just after the 4.2 s
 * reply was still the bank app's). Quoted by the give-up note
 * (`notInFront`), never waited for.
 */
const STALE_TREE_MEASURED_MS = 4_500;

/**
 * How long after the launch a read must still carry the stale label before
 * the give-up note lets it be the app's localized name (`notInFront`). 20 s,
 * not "a few": the measured window outlasted STALE_TREE_MEASURED_MS and was
 * over by ~15 s — ONE switch measured, so a one-sample bound with margin,
 * for a later device check to revise — and a localized name (unmeasured,
 * rare) paying a long re-read once is cheaper than a stale tree trusted.
 * Advice in the note only: the wait itself never runs this long.
 */
const LOCALIZED_REREAD_MS = 20_000;

/** What the wait needs: the launched bundle, one read of the tree's Application label, and the bundle's names (cached by the caller). */
export interface ForegroundCheck {
  bundleId: string;
  /** IosTreeSource.applicationLabel — one device read per call. */
  label(): Promise<ApplicationLabel>;
  /**
   * The bundle's names (simctl-appinfo.ts's appInfoNames), never empty;
   * THROWS when they could not be read — the error's first line is what the
   * note quotes. Called at most once per wait.
   */
  names(): Promise<readonly string[]>;
  /**
   * The bundle id of an app whose names include `label`, among those the
   * caller already holds (IosAdapter: the bundles its launches looked names
   * up for — idb source, this process) — undefined when none does, the first
   * when several do. No device call: asked only for the note.
   */
  ownerOf(label: string): string | undefined;
}

/**
 * Read until the Application label is one of the bundle's names (see the
 * module comment), and return the note to show when the wait ended without
 * confirming that — or undefined when it confirmed it, or the source does
 * not ask.
 */
export async function awaitForeground(check: ForegroundCheck): Promise<string | undefined> {
  let deadline = Date.now() + FOREGROUND_WAIT_MS;
  let names: readonly string[] | undefined;
  /** The last label that was not a match — what the note names. */
  let stale: string | undefined;
  /** Whether a read came back with no Application label (see below). */
  let unlabelled = false;
  for (;;) {
    let read: ApplicationLabel | undefined;
    try {
      read = await check.label();
    } catch (e) {
      // A device that was not read: idb's empty tree is the launch's own
      // transient (read on, `read` left undefined); anything else is not this
      // check's to diagnose.
      if (!(e instanceof IdbEmptyTreeError)) return unchecked(check.bundleId, headline(e));
    }
    if (read !== undefined) {
      // The source does not ask (WDA): by decision, nothing to wait for and nothing to say.
      if (read.kind === 'declined') return undefined;
      if (read.kind === 'unlabelled') {
        // A poll miss, like the empty tree — not a stop (review round 2):
        // idb's other launch transient, a lone full-frame Application that
        // IdbEmptyTreeError deliberately leaves a tree, may come unlabelled
        // (unmeasured; the 2026-10-06 note allows either), and stopping on
        // it would cost a cold launch its wait. Remembered, so the deadline
        // says it could not check rather than nothing; free when a labelled
        // read follows.
        unlabelled = true;
      } else {
        if (names === undefined) {
          const asked = Date.now();
          try {
            names = await check.names();
          } catch (e) {
            return unchecked(check.bundleId, headline(e));
          }
          // The window starts when the names have arrived: a slow lookup is added to it, not taken from it.
          deadline += Date.now() - asked;
        }
        if (names.includes(read.label)) return undefined;
        stale = read.label;
      }
    }
    // Pause only if the read after it would START before the deadline.
    if (Date.now() + FOREGROUND_POLL_MS >= deadline) {
      // The most telling thing read wins: a real label, then an unlabelled tree, then nothing at all.
      if (stale !== undefined) return notInFront(check.bundleId, stale, names ?? [], check.ownerOf(stale));
      if (unlabelled) return unchecked(check.bundleId, `the tree's Application element had no label, or there was none, for the ${formatSeconds(FOREGROUND_WAIT_MS)} averi waited`);
      return emptyThroughout(check.bundleId);
    }
    await sleep(FOREGROUND_POLL_MS);
  }
}

/** What a "could not check" note quotes of an error: its first line — the cause, not a stack or a paragraph of advice. */
const headline = (e: unknown): string => errorMessage(e).split('\n')[0];

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');

/** SpringBoard's Application is labelled with a single space: named as what it is, not as `" "`. */
const whose = (label: string) =>
  label.trim() === '' ? "SpringBoard's (the home screen or the launch animation)" : `the app labelled "${label}"`;

/**
 * The note for a label that never matched, chosen by the label (see the
 * module comment): SpringBoard's — read again; another known app's name
 * (`owner`) — that app's tree, read again; else both readings, told apart
 * by a read LOCALIZED_REREAD_MS after the launch. The head is the same for all three.
 */
function notInFront(bundleId: string, label: string, names: readonly string[], owner: string | undefined): string {
  const head =
    `${formatSeconds(FOREGROUND_WAIT_MS)} after launching ${bundleId}${names.length > 0 ? ` (${quoted(names)})` : ''}, ` +
    `the UI tree was still ${whose(label)} — iOS can hand idb the previous app's tree for a second or more after an app ` +
    'switch, so a read now may judge the wrong app (an absent check passes on it). ';
  if (label.trim() === '') return head + 'Compare with screenshot. Read again before trusting what the tree says';
  if (owner !== undefined) {
    return (
      head +
      `"${label}" is the name of ${owner}, which averi launched earlier, not of ${bundleId}: the tree is still that app's, ` +
      `even if the screenshot already shows ${bundleId} (it switches before idb's tree does) — read again before trusting what the tree says`
    );
  }
  return (
    head +
    `Treat the tree as the previous app's until a read is labelled ${names.length > 0 ? quoted(names) : `with one of ${bundleId}'s names`}: after an app switch idb was measured ` +
    `serving the previous app's tree for ${formatSeconds(STALE_TREE_MEASURED_MS)} and more. ` +
    `Only if a read ${formatSeconds(LOCALIZED_REREAD_MS)} or more after the launch is still labelled "${label}" ` +
    `while the screenshot shows ${bundleId} is that label its on-screen name (a localized display name its Info.plist does ` +
    "not carry), and this note can be ignored. The screenshot alone cannot tell them apart: it shows the launched app " +
    "before idb's tree does"
  );
}

function emptyThroughout(bundleId: string): string {
  return (
    `idb's tree stayed empty for the ${formatSeconds(FOREGROUND_WAIT_MS)} averi waited after launching ${bundleId}, ` +
    'so which app is in front was not checked — compare with screenshot before trusting a read'
  );
}

function unchecked(bundleId: string, why: string): string {
  return (
    `could not check that ${bundleId} is in front (${why}) — for a moment after a ` +
    "launch iOS can hand idb the previous app's tree; compare with screenshot before trusting a read"
  );
}

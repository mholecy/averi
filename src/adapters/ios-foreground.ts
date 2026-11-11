import { IdbEmptyTreeError, type ApplicationLabel } from './ios-tree-source.js';
import type { IosTreeSourceKind } from './ios-node.js';
import { namesApp, titleAsksToOpen } from './ios-system-alert.js';
import { FOREGROUND_WAIT_MS, type AppHolder, type SystemAlert } from './types.js';
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
 * Only a source that does not ask (`declined` — WDA before its WebDriverAgent
 * is up, wda-tree-source.ts) stays silent. idb's
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
 * On the WDA source (D48, 2026-11-02; ADR 0032's D48 amendment). WDA has the
 * same lag: batch-2 D (main 39c1fcda) read Contacts' whole tree in 2 of 5
 * `ui_snapshot`s right after a `launch_app` that, declining by decision
 * (2026-10-09, unmeasured then), had waited for nothing. Its sessionless
 * `/source` reads the app AX lists as active, so the source answers that
 * app's bundle id (`bundle`, WDA's `/wda/activeAppInfo`) — exact, never
 * localized: a match is `bundleId ===` the launched one, with no names and no
 * appinfo; another bundle is polled like a stale label, and at the bound the
 * note names it (`stillReads`; SpringBoard as what it is) with no
 * localized-name branch. A WDA not yet up declines (the first read's start
 * outlasts the switch), so a project's first launch still waits for nothing.
 * Cost there: one `/wda/activeAppInfo` per ask (unmeasured, estimated tens of
 * ms; D48's device check) — an ask in flight at the bound is under WdaServer's
 * ACTIVE_APP_TIMEOUT_MS.
 *
 * After `openDeepLink` only for the project's own scheme (D49a, 2026-11-02;
 * ADR 0032's D49a amendment). A link may legitimately bring ANOTHER app
 * forward (a universal link handed to Safari, `tel:`, another app's scheme),
 * so a link in general has no bundle to wait for. But one whose scheme the
 * project's app declares (its Info.plist's CFBundleURLTypes, ios-url-schemes.ts)
 * is expected to bring that app forward, and when it is not in front iOS
 * first asks "Open in “AveriLab”?" over SpringBoard — batch-1 D's probe: the
 * reply said "Opened", and every launch after it stayed behind the alert.
 * Such a link waits here as a launch does (`link` set: the detail says
 * "opening <url> in <bundle>"), and how the wait ended goes up as a fact: the
 * link's reply LEADS with what the agent must do, in
 * interact/app-holder-text.ts#appHolderText's words (A10).
 *
 * The alert itself, named (D54, 2026-11-02; ADR 0032's D54 amendment), from
 * its shape as batch-5 D49A captured it (ios-system-alert.ts): a link's wait
 * that finds it ends with it (`alert`), and the reply names its title and its
 * buttons at their centres instead of the note — never a tap. On idb at no
 * cost: the label read that answered SpringBoard's `' '` carries the alert
 * shape of its own elements (`candidate`), whose title this wait gates with
 * the names it already asks after its first label (titleAsksToOpen), so the
 * wait ends at the read that lists it, not at the bound. On WDA its
 * activeAppInfo says only "SpringBoard", so ONE short `/source`
 * (ForegroundCheck.alert, WdaTreeSource.systemAlert: its own 2 s budget, no
 * start, no restart) is read, and only at the bound, only when the last
 * bundle named was SpringBoard: a matched link reads nothing more, and a
 * failed or alert-less read is the note of before (fail open).
 *
 * A launch finds the same alert the same way (D56, 2026-11-02; ADR 0032's D56
 * amendment): an unanswered "Open in “AveriLab”?" keeps every later launch
 * behind it (batch-2), and D48's "read again" cannot answer it. Its wait ends
 * on it as a link's does, and the launch's note names the alert and its
 * buttons' centres in place of D48's — the launch still never
 * fails. Never "it asks": the alert belongs to something earlier, and may name
 * another app; so a WDA launch, which has no names cached, asks no appinfo for
 * it. The alert goes up as a fact (AppHolder's `alert`, A10), on both verbs;
 * interact/app-holder-text.ts#appHolderText words it. Not on Android: the previous app's
 * tree after a switch has not been measured there (uiautomator dumps the
 * focused window), so android.ts waits for nothing.
 */

// The bound is FOREGROUND_WAIT_MS, in adapters/types.ts beside AppHolder (A16): the MCP tool descriptions quote it,
// and mcp/ reads no platform module outside its composition root.

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
  /** IosTreeSource.applicationLabel — one device call per call (none when `declined`). */
  label(): Promise<ApplicationLabel>;
  /** The source `label` asks — for the notes' wording only (idb's tree, WebDriverAgent's active app). */
  source: IosTreeSourceKind;
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
  /**
   * The deep link that should bring `bundleId` forward, when the wait follows `simctl openurl` rather than a launch
   * (D49a): the detail then says "opening <link> in <bundle>". Asked for that clause alone, and for the names an alert's
   * title is judged by (alertAtBound).
   */
  link?: string;
  /**
   * One short tree read for a system alert (D54: IosTreeSource.systemAlert, WDA's; IosAdapter wires it for every
   * wait, D56): asked at most once per wait, at the bound, when the last bundle named was SpringBoard's; a throw is no
   * alert.
   */
  alert?: () => Promise<SystemAlert | undefined>;
}

/**
 * Read until the Application label is one of the bundle's names (see the module comment), and return what holds the
 * app: nothing named when it confirmed that; iOS's system alert when it found one (D54, D56), `asksForApp` judged with
 * the names the wait held; else how the wait ended, with its detail (adapters/types.ts#AppHolder).
 * The same answer on both verbs: what a link's reply leads with (it may wait behind iOS's "Open in …?", D49a) and that a
 * launch stays silent when nothing was asked are interact/app-holder-text.ts#appHolderText's.
 */
export async function awaitForeground(check: ForegroundCheck): Promise<AppHolder> {
  const end = await poll(check);
  const app = check.bundleId;
  switch (end.kind) {
    case 'matched':
      return { holder: 'none' };
    case 'alert':
      return { holder: 'alert', alert: { ...end.alert, asksForApp: namesApp(end.alert.title, end.names) } };
    case 'declined':
      return { holder: 'unknown', wait: 'not-asked', app };
    case 'saw':
      return { holder: 'unknown', wait: 'saw', app, detail: end.note, ...(end.springBoardTree === true && { springBoardTree: true }) };
    case 'unchecked':
      return { holder: 'unknown', wait: 'unchecked', app, detail: end.note };
  }
}

/**
 * How a wait ended: the app confirmed; the source does not ask (WDA not up); a system alert found (D54; a launch's too,
 * D56) — the alert as the source listed it, with the app's names the wait held to judge its title by (`names`: none
 * when they could not be read, or for a WDA launch, which asks none); or a note — `saw` when it read another app (a
 * stale label or bundle; `springBoardTree` when idb's tree was SpringBoard's), `unchecked` when it could not tell (a
 * read or names error, an unlabelled or empty tree to the bound).
 */
type WaitEnd =
  | { kind: 'matched' }
  | { kind: 'declined' }
  | AlertEnd
  | { kind: 'saw'; note: string; springBoardTree?: boolean }
  | { kind: 'unchecked'; note: string };
type AlertEnd = { kind: 'alert'; alert: SystemAlert; names: readonly string[] };

/** What the notes say came before the wait: the launch, or the link (`ForegroundCheck.link`). */
const after = (check: ForegroundCheck): string =>
  check.link === undefined ? `launching ${check.bundleId}` : `opening ${check.link} in ${check.bundleId}`;

/** The wait itself: how it ended, and the detail's words (awaitForeground). */
async function poll(check: ForegroundCheck): Promise<WaitEnd> {
  let deadline = Date.now() + FOREGROUND_WAIT_MS;
  let names: readonly string[] | undefined;
  /** The last label that was not a match — what the note names. */
  let stale: string | undefined;
  /** The last bundle WDA named that was not the launched one — what its note names. */
  let staleBundle: string | undefined;
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
      if (!(e instanceof IdbEmptyTreeError)) return unchecked(check, headline(e));
    }
    if (read !== undefined) {
      // The source does not ask (WDA not up yet): nothing to wait for and nothing to say.
      if (read.kind === 'declined') return { kind: 'declined' };
      if (read.kind === 'bundle') {
        // WDA's exact answer (D48): the bundle id, never localized — no names, no appinfo. Exact by design, case
        // included: WDA reports the app's canonical CFBundleIdentifier, the id `simctl launch` was given.
        if (read.bundleId === check.bundleId) return { kind: 'matched' };
        staleBundle = read.bundleId;
      } else if (read.kind === 'unlabelled') {
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
            // D54: an alert whose title needs no names (the English "Open in “…”?") is named all the same.
            const alert = idbAlert(read, []);
            return alert === undefined ? unchecked(check, headline(e)) : { kind: 'alert', alert, names: [] };
          }
          // The window starts when the names have arrived: a slow lookup is added to it, not taken from it.
          deadline += Date.now() - asked;
        }
        if (names.includes(read.label)) return { kind: 'matched' };
        const alert = idbAlert(read, names);
        if (alert !== undefined) return { kind: 'alert', alert, names };
        stale = read.label;
      }
    }
    // Pause only if the read after it would START before the deadline.
    if (Date.now() + FOREGROUND_POLL_MS >= deadline) {
      // The most telling thing read wins: a system alert (D54), a real label (or bundle), then an unlabelled tree,
      // then nothing at all.
      const alert = staleBundle === SPRINGBOARD_BUNDLE ? await alertAtBound(check) : undefined;
      if (alert !== undefined) return alert;
      if (staleBundle !== undefined) return { kind: 'saw', note: stillReads(check, staleBundle) };
      if (stale !== undefined) return { kind: 'saw', note: notInFront(check, stale, names ?? []), springBoardTree: isSpringBoard(stale) };
      if (unlabelled) {
        return unchecked(check, `${WORDS[check.source].unlabelled} for the ${formatSeconds(FOREGROUND_WAIT_MS)} averi waited`);
      }
      return { kind: 'unchecked', note: emptyThroughout(check) };
    }
    await sleep(FOREGROUND_POLL_MS);
  }
}

/**
 * WDA's system alert at the bound (D54; a launch's too, D56): one `check.alert()`, and — for a link only — the names
 * it is judged against (appinfo's, which the link's scheme lookup has cached; unreadable names are no name). A launch
 * asks no names: its text never judges the title (AppHolder), and a WDA launch has none cached. Fails open: a read
 * that throws, or holds no alert, is undefined, and the wait's note is the one of before.
 */
async function alertAtBound(check: ForegroundCheck): Promise<AlertEnd | undefined> {
  if (check.alert === undefined) return undefined;
  const alert = await check.alert().catch(() => undefined);
  if (alert === undefined) return undefined;
  const names = check.link === undefined ? [] : await check.names().catch((): readonly string[] => []);
  return { kind: 'alert', alert, names };
}

/**
 * idb's system alert in a SpringBoard label read (D54; a launch's too, D56): the read's alert shape (`candidate`, no
 * other call), when its title asks to open a link judged with `names` (titleAsksToOpen; none when they could not be
 * read, so only the English form passes).
 */
function idbAlert(read: Extract<ApplicationLabel, { kind: 'label' }>, names: readonly string[]): SystemAlert | undefined {
  const { candidate } = read;
  return candidate !== undefined && titleAsksToOpen(candidate.title, names) ? candidate : undefined;
}

/** What a "could not check" note quotes of an error: its first line — the cause, not a stack or a paragraph of advice. */
const headline = (e: unknown): string => errorMessage(e).split('\n')[0];

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(' or ');

/** Whether an Application label is SpringBoard's, labelled with a single space. */
const isSpringBoard = (label: string): boolean => label.trim() === '';

/** The label read, SpringBoard's named as what it is, not as `" "`. */
const whose = (label: string) =>
  isSpringBoard(label) ? "SpringBoard's (the home screen or the launch animation)" : `the app labelled "${label}"`;

/**
 * The note for a label that never matched, chosen by the label (see the
 * module comment): SpringBoard's — read again; another known app's name
 * (`owner`) — that app's tree, read again; else both readings, told apart
 * by a read LOCALIZED_REREAD_MS after the launch. The head is the same for all three.
 */
function notInFront(check: ForegroundCheck, label: string, names: readonly string[]): string {
  const { bundleId } = check;
  const owner = check.ownerOf(label);
  const head =
    `${formatSeconds(FOREGROUND_WAIT_MS)} after ${after(check)}${names.length > 0 ? ` (${quoted(names)})` : ''}, ` +
    `the UI tree was still ${whose(label)} — iOS can hand idb the previous app's tree for a second or more after an app ` +
    'switch, so a read now may judge the wrong app (an absent check passes on it). ';
  if (isSpringBoard(label)) {
    // SpringBoard is never the app under another name. What a screenshot can still tell, which part of it is in front,
    // is said above the adapters (the answer's `springBoardTree`).
    return `${head}${READ_AGAIN[0].toUpperCase()}${READ_AGAIN.slice(1)}`;
  }
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

/**
 * The one advice of the notes that could not confirm the app (review 2026-11-02): read again — never "compare with
 * screenshot", which shows the launched app before either source's tree does (the 2026-10-09 correction above).
 */
const READ_AGAIN = 'read again before trusting a read (the screenshot switches before the tree)';

/** What the notes say per source: the lag it has after a switch, and what an `unlabelled` answer was. */
const WORDS: Record<IosTreeSourceKind, { lag: string; unlabelled: string }> = {
  idb: { lag: "iOS can hand idb the previous app's tree", unlabelled: "the tree's Application element had no label, or there was none," },
  wda: { lag: 'WebDriverAgent can still read the previous app', unlabelled: "WebDriverAgent's active app carried no bundle id" },
};

function emptyThroughout(check: ForegroundCheck): string {
  return (
    `idb's tree stayed empty for the ${formatSeconds(FOREGROUND_WAIT_MS)} averi waited after ${after(check)}, ` +
    `so which app is in front was not checked — ${READ_AGAIN}`
  );
}

function unchecked(check: ForegroundCheck, why: string): WaitEnd {
  const note = `could not check that ${check.bundleId} is in front (${why}) — for a moment after an app switch ${WORDS[check.source].lag}; ${READ_AGAIN}`;
  return { kind: 'unchecked', note };
}

/** WDA's bundle id for SpringBoard (D48's note names it as what it is, as `whose` does idb's `' '`). */
const SPRINGBOARD_BUNDLE = 'com.apple.springboard';

/**
 * The note for a WDA source that named another bundle to the bound (D48).
 * No localized-name branch: a bundle id is exact, so another one IS another
 * app — the tree `/source` reads now is that app's, whatever the screenshot
 * shows. No `ownerOf`: the bundle id already names it.
 */
function stillReads(check: ForegroundCheck, other: string): string {
  const app =
    other === SPRINGBOARD_BUNDLE ? 'SpringBoard (the home screen, the launch animation or a system alert)' : other;
  return (
    `${formatSeconds(FOREGROUND_WAIT_MS)} after ${after(check)}, WebDriverAgent still read ${app} as the active app — ` +
    "a ui_snapshot now reads that app's tree, on which an absent check passes. Read again; if it repeats, take a screenshot"
  );
}

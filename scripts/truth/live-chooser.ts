import { LAB_APP, windowInTransition, type FocusRead, type HomeRead } from './lab-device.js';
import type { Call, Case, CaseReads, DeviceLog } from './live-cases.js';
import type { LiveVerdict } from './live-visibility.js';
import { chooserSaid, isError, launchedAs, linkHeldSaid, warnedSaid } from './replies.js';
import type { LabState } from './schema.js';

/**
 * The chooser group (T7b, Android, lab only; docs/adr/0041 and its D55b, D55c and D73 amendments, docs/adr/0044's
 * T7b amendment): what the device batches proved once of launch_app and open_deep_link around Android's "Open with"
 * chooser, as live cases that re-prove it every run. The oracle is the device's own word on what is in front and what is
 * on the activity stack — `mFocusedApp` from `dumpsys window displays` and the `Hist` records of `dumpsys activity
 * activities` (AndroidLab.focus), read before the calls, between them and after them (CaseReads.focus) — never averi's
 * reply, and never src's parser of it (android-chooser.ts#chooserInFocus): a second reading of the same lines, so a
 * regression there shows as a MISMATCH here.
 */

/**
 * A case's focus reads (CaseReads.focus, RunRecord `focus`): before its calls (after the launch, or the launcher it was
 * sent to), between them, after them, and after the teardown's BACK when the chooser was left in front (run-case.ts);
 * and, a case started from the launcher (Case.fromLauncher), the HOME activity the device resolves (`home`; absent from
 * the records before T7b's review round 1).
 */
export interface FocusReads {
  home?: HomeRead;
  before: FocusRead;
  between: FocusRead[];
  after: FocusRead;
  teardown?: FocusRead;
}

/**
 * What one read says. `focusedFirst`: `mFocusedApp` at the read's first window read — what the device showed when averi
 * had replied, before any wait (`settle.firstWindow`, else the one window read). `focusedSettled`: `mFocusedApp` at the
 * last window read. `settle`: `settled` when that last read names a focused window; `ran-out` when it is still
 * mid-transition after the wait (`windowInTransition`); `not-waited` when it is and no wait was taken (T7b's first run,
 * before the wait). `records`: every activity record, top first, read after the last window read.
 */
export interface Front {
  focusedFirst: string;
  focusedSettled: string;
  settle: 'settled' | 'ran-out' | 'not-waited';
  records: string[];
}

/** An ActivityRecord's component: after its hash and user, ended by a space (API 36: the task follows) or `}` (API 33). */
const RECORD = String.raw`ActivityRecord\{[0-9a-f]+ u\d+ ([^\s}/]+\/[^\s}]+)[\s}]`;
const FOCUSED_APP = new RegExp(String.raw`mFocusedApp=[^\n]*?${RECORD}`);
const HIST = new RegExp(String.raw`\* Hist +#\d+: ${RECORD}`, 'g');

/**
 * The read's wait: its `settle`, or — a record of T7b's review round 1 — `waitedMs` and `firstWindow` at its top (the
 * first three settled runs kept `waitedMs` alone); none when it took no wait.
 */
function waitOf(read: Extract<FocusRead, { window: string }>): { waitedMs: number; firstWindow?: string } | undefined {
  if (read.settle !== undefined) return read.settle;
  const round1 = read as { waitedMs?: number; firstWindow?: string };
  return round1.waitedMs === undefined ? undefined : { waitedMs: round1.waitedMs, firstWindow: round1.firstWindow };
}

/** The read as a Front, or unread with why: a failed read or one with no focused activity proves nothing. */
export function frontOf(read: FocusRead): Front | { why: string } {
  if ('error' in read) return { why: `the focus read failed: ${read.error}` };
  const focusedSettled = FOCUSED_APP.exec(read.window)?.[1];
  if (focusedSettled === undefined) return { why: 'the focus read holds no mFocusedApp line' };
  const wait = waitOf(read);
  const focusedFirst = wait?.firstWindow === undefined ? focusedSettled : FOCUSED_APP.exec(wait.firstWindow)?.[1];
  if (focusedFirst === undefined) return { why: 'the first focus read holds no mFocusedApp line' };
  const records = [...read.activities.matchAll(HIST)].map((m) => m[1]);
  if (records.length === 0) return { why: 'the activities read lists no record' };
  const settle = !windowInTransition(read.window) ? 'settled' : wait === undefined ? 'not-waited' : 'ran-out';
  return { focusedFirst, focusedSettled, settle, records };
}

/** The chooser the read has focused once settled (run-case.ts's teardown), else none: an unread read, a record below. */
export function chooserInFront(read: FocusRead): string | undefined {
  const front = frontOf(read);
  return 'why' in front || !isChooser(front.focusedSettled) ? undefined : front.focusedSettled;
}

/** A component in full: `pkg/.Cls` as `pkg/pkg.Cls`, the two forms the device prints. */
const full = (component: string): string => component.replace(/^([^/]+)\/\./, '$1/$1.');

/** The HOME activity `cmd package resolve-activity --brief` names, its last line; else unread with why. */
export function homeOf(read: HomeRead): string | { why: string } {
  if ('error' in read) return { why: `the HOME activity read failed: ${read.error}` };
  const last = read.resolved.trim().split('\n').pop()!.trim();
  return /^[\w.]+\/[\w.$]+$/.test(last) ? last : { why: `the HOME activity read names no component: ${last}` };
}

/** The packages the platform's chooser runs in (AOSP: the framework's; later releases' IntentResolver module). */
const CHOOSER_PACKAGES: ReadonlySet<string> = new Set(['android', 'com.android.intentresolver']);

/** The platform's resolver or chooser activity: its package one of CHOOSER_PACKAGES, its class `….ResolverActivity` or `….ChooserActivity`. */
export function isChooser(component: string | undefined): boolean {
  if (component === undefined) return false;
  const [pkg, cls] = component.split('/');
  return CHOOSER_PACKAGES.has(pkg) && /\.(?:Resolver|Chooser)Activity$/.test(cls);
}

// --- the judges ---

/** The lab app (the native one: its manifest declares `.Twin` and the `shared` and `cell` hosts). */
const LAB = LAB_APP.native.package;
/** Its launcher activity, as the window manager names it. */
const LAB_MAIN = `${LAB}/.MainActivity`;
/** The lab's activities: the package's, whatever the class (`.MainActivity`, the alias `.Twin` delivered to it). */
const ofLab = (component: string): boolean => component.startsWith(`${LAB}/`);

const verdict = (outcome: LiveVerdict['outcome'], why: string): LiveVerdict => ({ outcome, why });
/** A reply as a why quotes it: its first line, in quotes. */
const said = (reply: string): string => `"${reply.split('\n')[0]}"`;
/** An error as a why quotes it: its first line, cut at 80 characters. */
const cut = (reply: string): string => {
  const line = reply.split('\n')[0];
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
};

/** A case's focus reads, each read as a Front: before, between and after the calls; and the HOME read, raw. */
interface Fronts {
  home?: HomeRead;
  before: Front;
  between: Front[];
  after: Front;
}

/** The reads as Fronts, or the case's SKIP: a read that proves nothing, named by when it was taken. */
function frontsOf(log: DeviceLog | undefined): Fronts | LiveVerdict {
  const reads = log?.focus;
  if (reads === undefined) return verdict('SKIP', 'no focus read recorded');
  const read = (when: string, r: FocusRead): Front | LiveVerdict => {
    const f = frontOf(r);
    return 'why' in f ? verdict('SKIP', `${when}: ${f.why}`) : f;
  };
  const before = read('before the calls', reads.before);
  if ('outcome' in before) return before;
  const between: Front[] = [];
  for (const [i, r] of reads.between.entries()) {
    const f = read(`after call ${i + 1}`, r);
    if ('outcome' in f) return f;
    between.push(f);
  }
  const after = read('after the calls', reads.after);
  return 'outcome' in after ? after : { ...(reads.home !== undefined && { home: reads.home }), before, between, after };
}

/** The read after the calls still mid-transition when the wait ran out, no chooser listed: what is left is unread. */
const RAN_OUT: LiveVerdict = verdict('SKIP', 'the read after the calls did not settle in the 5 s wait (mCurrentFocus=null), and lists no chooser: whether one is left is unread');
/** An old record's read after the calls, taken once, mid-transition: what is left is unread. */
const NOT_WAITED: LiveVerdict = verdict('SKIP', 'the read after the calls was not waited (an old record) and is mid-transition (mCurrentFocus=null): whether a chooser is left on the stack is unread');

/** The chooser records on the stack, top first. */
const choosers = (f: Front): string[] => f.records.filter(isChooser);
/** How many records of the lab the stack holds. */
const labRecords = (f: Front): number => f.records.filter(ofLab).length;

/** A judge over the fronts: the reads unread are its SKIP. */
type FrontJudge = (fronts: Fronts, replies: readonly string[], state: LabState) => LiveVerdict;
const onFronts =
  (judge: FrontJudge): Case['judge'] =>
  (state, replies, _source, _launched, _after, log) => {
    const fronts = frontsOf(log);
    return 'outcome' in fronts ? fronts : judge(fronts, replies, state);
  };

/**
 * A launch's headline that is not `Launched <want>`, or a ⚠ line under it: the MISMATCH, its why `averi says "<headline>"[
 * with a ⚠ line] — <seen>`; else none.
 */
function headlineMismatch(reply: string, want: string, seen: string): LiveVerdict | undefined {
  const warned = warnedSaid(reply);
  return launchedAs(reply) === want && !warned ? undefined : verdict('MISMATCH', `averi says ${said(reply)}${warned ? ' with a ⚠ line' : ''} — ${seen}`);
}

/**
 * lc1–lc3's error reply: a MISMATCH when the device shows the start took (`took`, what it shows), else LOUD (`seen`);
 * none for a reply that is no error.
 */
function errorReply(reply: string, took: string | undefined, seen: string): LiveVerdict | undefined {
  if (!isError(reply)) return undefined;
  return took !== undefined ? verdict('MISMATCH', `averi says ${said(reply)} — ${took}`) : verdict('LOUD', `averi says ${said(reply)}; ${seen}`);
}

/**
 * What is left on the stack is judged on a settled read only. A read whose wait ran out with a chooser record still
 * listed is a MISMATCH (5 s, well past the ~1.3 s measured); with none, or a read not waited (an old record), unread.
 */
function unsettledStack(after: Front, reply: string): LiveVerdict | undefined {
  if (after.settle === 'settled') return undefined;
  if (after.settle === 'not-waited') return NOT_WAITED;
  const left = choosers(after);
  return left.length === 0 ? RAN_OUT : verdict('MISMATCH', `averi says ${said(reply)} — a chooser is still on the stack after the 5 s wait (${left.join(', ')}), well past the ~1.3 s measured`);
}

/** The premise of a case that raises its own chooser: none on the stack before its calls. */
const noChooserBefore = (f: Front): LiveVerdict | undefined => {
  const up = choosers(f);
  return up.length === 0 ? undefined : verdict('SKIP', `a chooser was on the stack before the calls (${up.join(', ')})`);
};

/**
 * The premise of lc4' and lc4'': the launcher in front before the calls — the HOME activity the device resolves
 * (`home`), no record of the lab, no chooser. A record from before T7b's review round 1 has no HOME read: then the weaker
 * premise, at least no package of the platform's chooser in front (the lab in front leaves its record on the stack).
 */
function launcherPremise(f: Front, home: HomeRead | undefined): LiveVerdict | undefined {
  if (home === undefined) {
    if (CHOOSER_PACKAGES.has(f.focusedFirst.split('/')[0])) return verdict('SKIP', `not started from the launcher: ${f.focusedFirst} was in front before the calls (no HOME activity read: a package of the platform's chooser)`);
  } else {
    const resolved = homeOf(home);
    if (typeof resolved !== 'string') return verdict('SKIP', resolved.why);
    if (full(f.focusedFirst) !== full(resolved)) return verdict('SKIP', `not started from the launcher: ${f.focusedFirst} was in front before the calls, not the HOME activity ${resolved}`);
  }
  const held = f.records.filter((r) => ofLab(r) || isChooser(r));
  return held.length === 0 ? undefined : verdict('SKIP', `not started from the launcher: the stack holds ${held.join(', ')} before the calls`);
}

/**
 * lc1 (D55b): a `-p` start of an intent two of the lab's activities answer (`averilab://shared`) raises the chooser, and
 * averi's ⚠ line names it — the very component in front. A Launched with none named, or one named that is not in front,
 * is a MISMATCH; no chooser raised and none named proves nothing (a preferred activity would do that): SKIP.
 */
export const judgeChooserNamed: FrontJudge = ({ before, after }, [reply]) => {
  const front = after.focusedFirst;
  const up = isChooser(front);
  return noChooserBefore(before) ?? errorReply(reply, up ? `the start raised ${front}, in front` : undefined, `${front} is in front`) ?? chooserNamed(front, up, reply);
};

/** lc1 past its premise and an error: the headline the lab's, the chooser named the one in front. */
function chooserNamed(front: string, up: boolean, reply: string): LiveVerdict {
  const app = launchedAs(reply);
  if (app !== LAB) return verdict('MISMATCH', `averi's headline names ${app ?? 'no launch'}, not ${LAB}: ${said(reply)}`);
  const named = chooserSaid(reply);
  if (up && named === front) return verdict('ok', `Launched, the chooser named (${named}), and it is in front`);
  if (up && named === undefined) return verdict('MISMATCH', `averi says ${said(reply)} and names no chooser — ${front} is in front`);
  if (named !== undefined) return verdict('MISMATCH', `averi names the chooser (${named}) — ${front} is in front`);
  return verdict('SKIP', `no chooser raised and none named: ${front} is in front (a preferred activity? \`dumpsys package preferred\`)`);
}

/**
 * lc2: a `-p` start of a one-handler intent (`averilab://cell/<cell>`) opens the cell — a bare Launched, the lab in
 * front, the app showing the link's cell (its own state). A ⚠ line, another activity in front, or the old cell still
 * shown is a MISMATCH; a chooser for a one-handler link is the device's, not averi's: SKIP.
 */
export const judgeOneHandler =
  (cell: string): FrontJudge =>
  ({ after }, [reply], state) => {
    const front = after.focusedFirst;
    const chooserUp = isChooser(front) ? verdict('SKIP', `a chooser for a one-handler link: ${front} is in front`) : undefined;
    const opened = ofLab(front) && state.cell === cell;
    return (
      chooserUp ??
      errorReply(reply, opened ? `the app shows cell ${cell}, ${front} in front` : undefined, `the app shows cell ${state.cell}`) ??
      headlineMismatch(reply, LAB, `${front} is in front, the app shows cell ${state.cell}`) ??
      (!ofLab(front) ? verdict('MISMATCH', `averi says ${said(reply)} — ${front} is in front`)
      : state.cell !== cell ? verdict('MISMATCH', `averi says ${said(reply)} — the app shows cell ${state.cell}, not ${cell}`)
      : verdict('ok', `Launched, no note; ${front} in front, the app shows cell ${cell}`))
    );
  };

/**
 * lc3: the same two-handler intent with `activity: .Twin` — `am start -n`, which no chooser can stop: Launched
 * `dev.averi.lab/.Twin`, no ⚠ line, no chooser on the stack, the lab in front. What catches a `-p` start (the activity
 * dropped) is the chooser on the stack. The "one start at most" check (no more than one new lab record) CANNOT fail on
 * this lab: `.MainActivity` is singleTop, so the alias's start is delivered to the top instance (API 33: "Activity not
 * started, intent has been delivered to currently running top-most instance", records 1 → 1 every run); it stays as a
 * guard for a lab that changes, not as evidence. An error reply is judged before the settle.
 */
export const judgeNamedActivity: FrontJudge = ({ before, after }, [reply]) => {
  const front = after.focusedFirst;
  const up = choosers(after);
  return (
    noChooserBefore(before) ??
    errorReply(reply, ofLab(front) && up.length === 0 ? `${front} is in front, no chooser` : undefined, `${front} is in front`) ??
    unsettledStack(after, reply) ??
    (up.length > 0 ? verdict('MISMATCH', `averi says ${said(reply)} — a chooser is on the stack (${up.join(', ')}): .Twin was not started by name`) : undefined) ??
    headlineMismatch(reply, `${LAB}/.Twin`, `the launch named .Twin, ${front} is in front`) ??
    twinStarted(before, after, reply)
  );
};

/** lc3 past its other checks: the lab in front, one start at most. */
function twinStarted(before: Front, after: Front, reply: string): LiveVerdict {
  if (!ofLab(after.focusedFirst)) return verdict('MISMATCH', `averi says ${said(reply)} — ${after.focusedFirst} is in front`);
  const [was, is] = [labRecords(before), labRecords(after)];
  if (is > was + 1) return verdict('MISMATCH', `averi says ${said(reply)} — the lab has ${is} activity records, ${was} before the call: more than one start`);
  return verdict('ok', `Launched .Twin, no note, no chooser; ${after.focusedFirst} in front, the lab's records ${was} → ${is}`);
}

/**
 * The launch both lc4' and lc4'' end with: launch_app with no activity (monkey, D73's `--pct-syskeys 0 …`) — a bare
 * Launched, the lab's launcher activity focused when averi replied (the first read), no chooser left on the stack (the
 * settled read). A refusal is a MISMATCH, not LOUD: monkey starts the app on this AVD, from the launcher and over the
 * chooser (D73, measured 12 of 12), so a refusal is the bug D73 fixed coming back.
 */
function judgeMonkeyLaunch(after: Front, reply: string, state: LabState): LiveVerdict {
  const front = after.focusedFirst;
  if (isError(reply)) return verdict('MISMATCH', `averi refused the launch (${cut(reply)}) — monkey can start the app from the launcher on this AVD (D73); ${front} is in front`);
  const left = choosers(after);
  return (
    headlineMismatch(reply, LAB, `${front} is in front`) ??
    (front !== LAB_MAIN ? verdict('MISMATCH', `averi says ${said(reply)} — ${front} was mFocusedApp at the first read after it, not ${LAB_MAIN}`) : undefined) ??
    unsettledStack(after, reply) ??
    (left.length > 0 ? verdict('MISMATCH', `averi says ${said(reply)} — a chooser is still on the stack (${left.join(', ')})`) : undefined) ??
    verdict('ok', `Launched, no note; ${LAB_MAIN} in front, no chooser on the stack (the app's cell ${JSON.stringify(state.cell)})`)
  );
}

/** lc4' (D73's net, run on demand: backlog T20b/T20c): launch_app with no activity, from the launcher. */
export const judgeFromLauncher: FrontJudge = ({ home, before, after }, [reply], state) => launcherPremise(before, home) ?? judgeMonkeyLaunch(after, reply, state);

/**
 * lc4'' (D73's net over the chooser, run on demand): from the launcher, `open_deep_link averilab://shared/open` raises the
 * chooser (read between the calls: its premise), and its reply names it rather than "Opened" (D55); then launch_app with
 * no activity brings the lab forward and no ResolverActivity is left.
 */
export const judgeOverChooser: FrontJudge = ({ home, before, between: [link], after }, [linkReply, reply], state) => {
  const raised = link === undefined || !isChooser(link.focusedFirst) ? verdict('SKIP', `the link raised no chooser: ${link?.focusedFirst ?? 'nothing read'} was in front after it`) : undefined;
  const named = link !== undefined && (!linkHeldSaid(linkReply) || chooserSaid(linkReply) !== link.focusedFirst) ? verdict('MISMATCH', `the link: averi says ${said(linkReply)} — ${link.focusedFirst} was in front after it`) : undefined;
  return launcherPremise(before, home) ?? raised ?? named ?? judgeMonkeyLaunch(after, reply, state);
};

// --- the cases ---

/** A chooser case as live-cases.ts takes it (its Case, less the group). */
export interface ChooserCase {
  id: string;
  cell: string;
  says: string;
  platforms: readonly ['android'];
  reads: CaseReads;
  skipFails: true;
  fromLauncher?: true;
  calls: Call[];
  judge: Case['judge'];
}

/** The cell every case launches first: a plain form of the native lab app, which no case touches. */
const START_CELL = 'form-basic';
/** The cell lc2's link opens: another, so the app's state says the intent reached it. */
const LINKED_CELL = 'form-prefilled';
const VIEW = 'android.intent.action.VIEW';
/** Every chooser case reads the focus; a late read would only read the app again. A SKIP proves nothing. */
const CHOOSER_READS: CaseReads = { focus: true, late: false };
const base = { platforms: ['android'] as const, reads: CHOOSER_READS, skipFails: true as const };
const monkey: Call = { tool: 'launch_app', args: { appId: LAB } };

export const CHOOSER_CASES: readonly ChooserCase[] = [
  {
    id: 'lc1',
    cell: START_CELL,
    says: 'launch_app with intent VIEW averilab://shared/x and no activity (am start -p): the chooser raised, named under Launched (D55b)',
    ...base,
    calls: [{ tool: 'launch_app', args: { appId: LAB, intent: { action: VIEW, data: 'averilab://shared/x' } } }],
    judge: onFronts(judgeChooserNamed),
  },
  {
    id: 'lc2',
    cell: START_CELL,
    says: `launch_app with intent VIEW averilab://cell/${LINKED_CELL}, one handler: Launched, no note, the cell open`,
    ...base,
    calls: [{ tool: 'launch_app', args: { appId: LAB, intent: { action: VIEW, data: `averilab://cell/${LINKED_CELL}` } } }],
    judge: onFronts(judgeOneHandler(LINKED_CELL)),
  },
  {
    id: 'lc3',
    cell: START_CELL,
    says: 'launch_app with activity .Twin and the two-handler intent (am start -n): no chooser on the stack, no note, the lab in front',
    ...base,
    calls: [{ tool: 'launch_app', args: { appId: LAB, activity: '.Twin', intent: { action: VIEW, data: 'averilab://shared/x' } } }],
    judge: onFronts(judgeNamedActivity),
  },
  {
    id: "lc4'",
    cell: START_CELL,
    says: 'launch_app with no activity (monkey) from the launcher: Launched, the app mFocusedApp (D73)',
    ...base,
    fromLauncher: true,
    calls: [monkey],
    judge: onFronts(judgeFromLauncher),
  },
  {
    id: "lc4''",
    cell: START_CELL,
    says: "open_deep_link averilab://shared/open from the launcher (its chooser), then launch_app with no activity: Launched, the app mFocusedApp, no ResolverActivity left (D73)",
    ...base,
    fromLauncher: true,
    calls: [{ tool: 'open_deep_link', args: { url: 'averilab://shared/open' } }, monkey],
    judge: onFronts(judgeOverChooser),
  },
];

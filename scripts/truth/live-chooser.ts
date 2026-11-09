import { LAB_APP, type FocusRead, type HomeRead } from './lab-device.js';
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
 * What one read says. `focused`: `mFocusedApp` at the read's FIRST window read — what the device showed when averi had
 * replied, before any wait (FocusRead.firstWindow, else the one window read). `current`: `mFocusedApp` once settled.
 * `settled`: the last window read names a focused window (`mCurrentFocus` not null). `records`: every activity record,
 * top first, read once the window settled (or the wait ran out).
 */
export interface Front {
  focused: string;
  current: string;
  settled: boolean;
  records: string[];
}

/** An ActivityRecord's component: after its hash and user, ended by a space (API 36: the task follows) or `}` (API 33). */
const RECORD = String.raw`ActivityRecord\{[0-9a-f]+ u\d+ ([^\s}/]+\/[^\s}]+)[\s}]`;
const FOCUSED_APP = new RegExp(String.raw`mFocusedApp=[^\n]*?${RECORD}`);
const HIST = new RegExp(String.raw`\* Hist +#\d+: ${RECORD}`, 'g');

/** The read as a Front, or unread with why: a failed read or one with no focused activity proves nothing. */
export function frontOf(read: FocusRead): Front | { why: string } {
  if ('error' in read) return { why: `the focus read failed: ${read.error}` };
  const current = FOCUSED_APP.exec(read.window)?.[1];
  if (current === undefined) return { why: 'the focus read holds no mFocusedApp line' };
  const focused = read.firstWindow === undefined ? current : FOCUSED_APP.exec(read.firstWindow)?.[1];
  if (focused === undefined) return { why: 'the first focus read holds no mFocusedApp line' };
  const records = [...read.activities.matchAll(HIST)].map((m) => m[1]);
  if (records.length === 0) return { why: 'the activities read lists no record' };
  return { focused, current, settled: !/mCurrentFocus=null\b/.test(read.window), records };
}

/** The chooser the read has focused once settled (run-case.ts's teardown), else none: an unread read, a record below. */
export function chooserInFront(read: FocusRead): string | undefined {
  const front = frontOf(read);
  return 'why' in front || !isChooser(front.current) ? undefined : front.current;
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

/** The read after the calls still mid-transition when the wait ran out: what is left on the stack is unread. */
const NEVER_SETTLED: LiveVerdict = { outcome: 'SKIP', why: 'the read after the calls never settled (mCurrentFocus=null): whether a chooser is left on the stack is unread' };

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

/** The premise of a case that raises its own chooser: none on the stack before its calls. */
const noChooserBefore = (f: Front): LiveVerdict | undefined => {
  const up = choosers(f);
  return up.length === 0 ? undefined : verdict('SKIP', `a chooser was on the stack before the calls (${up.join(', ')})`);
};

/** The packages of the platform's own activities (the chooser's among them). */
const PLATFORM_PACKAGES = CHOOSER_PACKAGES;

/**
 * The premise of lc4' and lc4'': the launcher in front before the calls — the HOME activity the device resolves
 * (`home`), no record of the lab, no chooser. A record from before T7b's review round 1 has no HOME read: then at least
 * not the platform in front (the lab in front leaves its record on the stack).
 */
function fromTheLauncher(f: Front, home: HomeRead | undefined): LiveVerdict | undefined {
  if (home === undefined) {
    // The lab focused is caught below: its record is on the stack.
    if (PLATFORM_PACKAGES.has(f.focused.split('/')[0])) return verdict('SKIP', `not started from the launcher: ${f.focused} was in front before the calls (no HOME activity read: the platform's)`);
  } else {
    const resolved = homeOf(home);
    if (typeof resolved !== 'string') return verdict('SKIP', resolved.why);
    if (full(f.focused) !== full(resolved)) return verdict('SKIP', `not started from the launcher: ${f.focused} was in front before the calls, not the HOME activity ${resolved}`);
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
  const premise = noChooserBefore(before);
  if (premise !== undefined) return premise;
  const up = isChooser(after.focused);
  if (isError(reply)) return up ? verdict('MISMATCH', `averi says ${said(reply)} — the start raised ${after.focused}, in front`) : verdict('LOUD', `averi says ${said(reply)}; ${after.focused} is in front`);
  const app = launchedAs(reply);
  if (app !== LAB) return verdict('MISMATCH', `averi's headline names ${app ?? 'no launch'}, not ${LAB}: ${said(reply)}`);
  const named = chooserSaid(reply);
  if (up && named === after.focused) return verdict('ok', `Launched, the chooser named (${named}), and it is in front`);
  if (up && named === undefined) return verdict('MISMATCH', `averi says ${said(reply)} and names no chooser — ${after.focused} is in front`);
  if (named !== undefined) return verdict('MISMATCH', `averi names the chooser (${named}) — ${after.focused} is in front`);
  return verdict('SKIP', `no chooser raised and none named: ${after.focused} is in front (a preferred activity? \`dumpsys package preferred\`)`);
};

/**
 * lc2: a `-p` start of a one-handler intent (`averilab://cell/<cell>`) opens the cell — a bare Launched, the lab in
 * front, the app showing the link's cell (its own state). A ⚠ line, another activity in front, or the old cell still
 * shown is a MISMATCH; a chooser for a one-handler link is the device's, not averi's: SKIP.
 */
export const judgeOneHandler =
  (cell: string): FrontJudge =>
  ({ after }, [reply], state) => {
    if (isChooser(after.focused)) return verdict('SKIP', `a chooser for a one-handler link: ${after.focused} is in front`);
    const opened = ofLab(after.focused) && state.cell === cell;
    if (isError(reply)) return opened ? verdict('MISMATCH', `averi says ${said(reply)} — the app shows cell ${cell}, ${after.focused} in front`) : verdict('LOUD', `averi says ${said(reply)}; the app shows cell ${state.cell}`);
    if (launchedAs(reply) !== LAB || warnedSaid(reply)) return verdict('MISMATCH', `averi says ${said(reply)}${warnedSaid(reply) ? ' with a ⚠ line' : ''} — ${after.focused} is in front, the app shows cell ${state.cell}`);
    if (!ofLab(after.focused)) return verdict('MISMATCH', `averi says ${said(reply)} — ${after.focused} is in front`);
    if (state.cell !== cell) return verdict('MISMATCH', `averi says ${said(reply)} — the app shows cell ${state.cell}, not ${cell}`);
    return verdict('ok', `Launched, no note; ${after.focused} in front, the app shows cell ${cell}`);
  };

/**
 * lc3: the same two-handler intent with `activity: .Twin` — `am start -n`, which no chooser can stop: Launched
 * `dev.averi.lab/.Twin`, no ⚠ line, no chooser on the stack, the lab in front. What catches a `-p` start (the activity
 * dropped) is the chooser on the stack. The "one start at most" check (no more than one new lab record) CANNOT fail on
 * this lab: `.MainActivity` is singleTop, so the alias's start is delivered to the top instance (API 33: "Activity not
 * started, intent has been delivered to currently running top-most instance", records 1 → 1 every run); it stays as a
 * guard for a lab that changes, not as evidence.
 */
export const judgeNamedActivity: FrontJudge = ({ before, after }, [reply]) => {
  const premise = noChooserBefore(before);
  if (premise !== undefined) return premise;
  if (!after.settled) return NEVER_SETTLED;
  const up = choosers(after);
  if (isError(reply)) return ofLab(after.focused) && up.length === 0 ? verdict('MISMATCH', `averi says ${said(reply)} — ${after.focused} is in front, no chooser`) : verdict('LOUD', `averi says ${said(reply)}; ${after.focused} is in front`);
  if (up.length > 0) return verdict('MISMATCH', `averi says ${said(reply)} — a chooser is on the stack (${up.join(', ')}): .Twin was not started by name`);
  if (launchedAs(reply) !== `${LAB}/.Twin` || warnedSaid(reply)) return verdict('MISMATCH', `averi says ${said(reply)}${warnedSaid(reply) ? ' with a ⚠ line' : ''} — the launch named .Twin, ${after.focused} is in front`);
  if (!ofLab(after.focused)) return verdict('MISMATCH', `averi says ${said(reply)} — ${after.focused} is in front`);
  const [was, is] = [labRecords(before), labRecords(after)];
  if (is > was + 1) return verdict('MISMATCH', `averi says ${said(reply)} — the lab has ${is} activity records, ${was} before the call: more than one start`);
  return verdict('ok', `Launched .Twin, no note, no chooser; ${after.focused} in front, the lab's records ${was} → ${is}`);
};

/**
 * The launch both lc4' and lc4'' end with: launch_app with no activity (monkey, D73's `--pct-syskeys 0 …`) — a bare
 * Launched, the lab's launcher activity focused, no chooser left on the stack. A refusal is a MISMATCH, not LOUD:
 * monkey starts the app on this AVD, from the launcher and over the chooser (D73, measured 12 of 12), so a refusal is the
 * bug D73 fixed coming back.
 */
function judgeMonkeyLaunch(after: Front, reply: string, state: LabState): LiveVerdict {
  if (isError(reply)) return verdict('MISMATCH', `averi refused the launch (${cut(reply)}) — monkey can start the app from the launcher on this AVD (D73); ${after.focused} is in front`);
  if (launchedAs(reply) !== LAB || warnedSaid(reply)) return verdict('MISMATCH', `averi says ${said(reply)}${warnedSaid(reply) ? ' with a ⚠ line' : ''} — ${after.focused} is in front`);
  // What averi's "Launched" claims: the app focused when it replied — the first read, before any wait.
  if (after.focused !== LAB_MAIN) return verdict('MISMATCH', `averi says ${said(reply)} — ${after.focused} was mFocusedApp at the first read after it, not ${LAB_MAIN}`);
  // No chooser left: on the settled read only (a ResolverActivity record outlives the transition, about 1.3 s).
  if (!after.settled) return NEVER_SETTLED;
  const left = choosers(after);
  if (left.length > 0) return verdict('MISMATCH', `averi says ${said(reply)} — a chooser is still on the stack (${left.join(', ')})`);
  return verdict('ok', `Launched, no note; ${LAB_MAIN} in front, no chooser on the stack (the app's cell ${JSON.stringify(state.cell)})`);
}

/** lc4' (D73's net): launch_app with no activity, from the launcher. */
export const judgeFromLauncher: FrontJudge = ({ home, before, after }, [reply], state) => fromTheLauncher(before, home) ?? judgeMonkeyLaunch(after, reply, state);

/**
 * lc4'' (D73's net, over the chooser): from the launcher, `open_deep_link averilab://shared/open` raises the chooser
 * (read between the calls: its premise), and its reply names it rather than "Opened" (D55); then launch_app with no
 * activity brings the lab forward and no ResolverActivity is left.
 */
export const judgeOverChooser: FrontJudge = ({ home, before, between: [link], after }, [linkReply, reply], state) => {
  const premise = fromTheLauncher(before, home);
  if (premise !== undefined) return premise;
  if (link === undefined || !isChooser(link.focused)) return verdict('SKIP', `the link raised no chooser: ${link?.focused ?? 'nothing read'} was in front after it`);
  if (!linkHeldSaid(linkReply) || chooserSaid(linkReply) !== link.focused) return verdict('MISMATCH', `the link: averi says ${said(linkReply)} — ${link.focused} was in front after it`);
  return judgeMonkeyLaunch(after, reply, state);
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
    says: 'launch_app with activity .Twin and the two-handler intent (am start -n): no chooser, no note, one start',
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

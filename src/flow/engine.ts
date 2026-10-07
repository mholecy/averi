import type { IosTreeSourceKind } from '../adapters/ios-node.js';
import type { DeviceAdapter, Platform, UiNode } from '../adapters/types.js';
import { fillField } from '../interact/fill.js';
import { typeIntoFocused } from '../interact/type-text.js';
import { DEFAULT_SETTLE_TIMEOUT_MS, resolveNow, type Ambiguity } from '../interact/resolve.js';
import { describeScrollResult, scrollUntilVisible } from '../interact/scroll.js';
import { swipeScreen } from '../interact/swipe.js';
import { dismissKeyboard, KeyboardGuardError, type DismissResult, type KeyboardDismissal } from '../interact/keyboard.js';
import { tapElement } from '../interact/tap.js';
import { describeElementSpec as describeSpec, SELECTOR_FIELDS, selectorOnly, type ElementSpec } from '../ui-tree/element-spec.js';
import { pollTimeoutMessage, pollTree } from '../ui-tree/read-tree.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { absentFromViewport } from '../ui-tree/geometry.js';
import { isBareTree, treeShape } from '../ui-tree/bare-tree.js';
import { parseDuration } from '../util/duration.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { Verifier } from '../verify/assert.js';
import {
  resolveLaunchActivity,
  flowIsDestructive,
  flowItselfIsDestructive,
  keyboardDismissals,
  SetupError,
  type AveriConfig,
  type Condition,
  type ScrollUntilSpec,
  type Step,
  type TapSpec,
} from './config.js';
import { resolveCredentials, type Credentials, type EnvValues, type ResolvedValue } from './credentials.js';

export interface TraceEntry {
  action: string;
  detail?: string;
}

/**
 * The one rendering of a trace. It lives here, beside the TraceEntry it
 * renders, because a FAILING flow now carries its own trace in the error
 * message (FlowError) — so the formatter has to be reachable from the engine
 * itself, not from the run layer that imports the engine.
 */
export const formatTrace = (trace: TraceEntry[]): string =>
  trace.map((t) => (t.detail === undefined ? t.action : `${t.action}: ${t.detail}`)).join('\n');

/**
 * A flow failure that carries the steps that DID run.
 *
 * A successful run returns its trace; a failing one used to return nothing but
 * the final message ("Timed out after 20000ms waiting for state logged_in") —
 * which is exactly when the trace is worth most. It is the only way to see
 * which reach flows ran, how far each got, and, with `clearState` in the mix,
 * what the attempt already cost. The trace is appended to `message` (MCP
 * surfaces only the message) and kept structured on `trace` for callers that
 * want the entries.
 */
export class FlowError extends Error {
  constructor(
    message: string,
    readonly trace: TraceEntry[],
  ) {
    super(message);
    this.name = 'FlowError';
  }
}

/**
 * A detect probe that learned nothing about the screen: `unknown` — every
 * read failed, the probe never saw the device — or `bare` — every tree it
 * read was bare (ui-tree/bare-tree.ts: only wrappers and unlabeled
 * decoration, a launch's decor or splash), so a miss in it says nothing
 * about the state (2026-10-07). `shape` is the last bare tree's shape
 * (`treeShape`), for the line that says so. Exported because the refusal
 * below is built from two of them.
 */
export type UnreadProbe = { answer: 'unknown'; readError: Error } | { answer: 'bare'; shape: string };

/**
 * What the probe before a destructive rung and its second look learned
 * TOGETHER — the refusal's cause. Until the 2026-10-07 review the cause was
 * the second look alone, and both mixed orders were worded wrong: a bare
 * entry read followed by a second look whose every read failed said "never
 * read a UI tree" (the entry had read one), and a failed entry read followed
 * by a bare second look said "every read was bare" (the entry's had failed).
 * So: if the second look read a tree it was bare, and it is the latest one
 * (`bare` — "every UI TREE read was bare" stays true of a failed entry read,
 * which read no tree); if only the entry read one, the cause is that shape
 * AND the second look's failure (`bare-then-failed`); only when neither read
 * any tree is it `unknown`, worded as before.
 */
type UnreadCause = UnreadProbe | { answer: 'bare-then-failed'; shape: string; readError: Error };

const unreadCause = (before: UnreadProbe, secondLook: UnreadProbe): UnreadCause =>
  secondLook.answer === 'unknown' && before.answer === 'bare' ?
    { answer: 'bare-then-failed', shape: before.shape, readError: secondLook.readError }
  : secondLook;

const readFailed = (e: unknown): string => `last UI tree read failed: ${headline(e)}`;

/**
 * What an unread probe (or the refusal's cause) learned, as one clause:
 * `last UI tree read failed: …` or `every UI tree read was bare, the last
 * one 7 nodes (roles: …) of only wrappers and unlabeled decoration`. One
 * spelling for the probe's `⚠ detect` line, the no-reach SetupError and the
 * refusal, so they cannot drift apart; each sentence around it is its own.
 */
const describeUnreadCause = (cause: UnreadCause): string => {
  if (cause.answer === 'unknown') return readFailed(cause.readError);
  const bare = `every UI tree read was bare, the last one ${cause.shape} of only wrappers and unlabeled decoration`;
  return cause.answer === 'bare' ? bare : `${bare}, and every read after it failed (${readFailed(cause.readError)})`;
};

/**
 * The ladder declined to run a DESTRUCTIVE rung because the detect probe
 * right before it never read a UI tree (2026-10-06, docs/bugs/2026-10-06-ios-
 * idb-empty-tree-persists-on-pin-screen.md: idb returned a 0×0 Application
 * for minutes on a rendered screen, and every probe read that as "not in
 * state") — or, since 2026-10-07, read only BARE trees (docs/bugs/2026-10-06-
 * second-look-reads-android-decor-as-not-in-state.md: Android's decor-only
 * tree for ~9 s of a cold launch, WDA's 7-node splash). On such a device
 * "not in state" is not knowledge, and the rung's cost — a wiped app and
 * its device registration — is not undone by the tree coming back a minute
 * later. Not a SetupError: the descriptor is fine, the device was not read.
 * Terminal like one (`isTerminal`). The cause is what that probe and its
 * second look learned together (`UnreadCause`), so each kind is worded with
 * what was read and the kinds cannot be confused.
 */
export class UnreadTreeRefusal extends Error {
  /** Why, without the headline — the ladder's `⛔ reach` trace line is this, so the two cannot drift apart. */
  readonly reason: string;

  constructor(state: string, rung: string, before: UnreadProbe, secondLook: UnreadProbe) {
    const cause = unreadCause(before, secondLook);
    const lead = 'the rung is DESTRUCTIVE (it wipes app state, and any device registration with it), and the detect probe before it ';
    // The two kinds share every clause but the cause's and the retry's, in
    // a different order: the unread wording predates the bare one and is
    // pinned, so the parts are spelled once and each kind arranges them.
    const unknownState = `so whether the app is in "${state}" is unknown`;
    const retry = (once: string) => `Compare with screenshot; retry once ${once}`;
    const reason =
      cause.answer === 'unknown' ?
        lead +
        `never read a UI tree, a second look included, ${unknownState} — ${describeUnreadCause(cause)}. ${retry('the tree reads')}`
      : lead +
        `never read a RENDERED UI tree, a second look included — ${describeUnreadCause(cause)} — ${unknownState}. ` +
        `${retry('the screen has rendered')}, or run_flow "${rung}" runs it deliberately`;
    super(`Refused to run reach flow "${rung}" for state "${state}": ${reason}`);
    this.name = 'UnreadTreeRefusal';
    this.reason = reason;
  }
}

/**
 * An error the ladder must NOT escalate past, nor hand to salvage: re-running
 * flows cannot fix it, and the next rung may be the destructive one. A
 * SetupError is a broken descriptor; an UnreadTreeRefusal is a nested ladder
 * (a rung's `requires:`) that already refused — escalating the OUTER ladder
 * past it would run the wipe the inner one declined. Only the ladder's catch
 * asks: the final wait never enters a ladder, so it can see a SetupError
 * (an unknown state in a condition) but never a refusal.
 */
const isTerminal = (e: unknown): boolean => e instanceof SetupError || e instanceof UnreadTreeRefusal;

/**
 * What one detect probe learned. `unknown` is "every read failed — the probe
 * never saw the device"; `bare` is "every tree read was bare" (UnreadProbe).
 * Callers that only need a boolean fold both into "not detected" by
 * comparing against `'yes'` (salvage, the recovery pass); the ladder alone
 * tells them apart (ensureStateInner). `readError` is set exactly when it is
 * unknown, `shape` exactly when it is bare.
 */
type Detection = { answer: 'yes' | 'no' } | UnreadProbe;

/** The answers on which the ladder will not run a destructive rung: the probe learned nothing about the screen. */
const learnedNothing = (d: Detection): d is UnreadProbe => d.answer === 'unknown' || d.answer === 'bare';

/**
 * The payload of one step kind, read off the Step union itself so a handler's
 * parameter type can never drift from the schema it is fed by.
 */
type StepPayload<K extends string> = Extract<Step, Record<K, unknown>>[K];

/**
 * What a flow step does when a selector still matches several nodes after
 * the interaction module's tie-breakers (zero-area dropped, a sole
 * interactive match preferred): pick the first. A descriptor's selectors
 * are written against a known app by someone who can see its tree, and a
 * step that must not guess can say `role:` — whereas an agent exploring
 * through the MCP tools cannot, so those refuse (interact/resolve.ts,
 * Ambiguity). One constant so the policy is stated once and the three sites
 * cannot drift.
 */
const FLOW_AMBIGUITY: Ambiguity = 'first';

/**
 * What outlives one engine run: the state of the SESSION that runs it. Today
 * that is one number, how many `launch { clearState: true }` steps the
 * session's runs have performed — the `⚠ clearState` line's "(3 this
 * session)", which is what makes a finite resource (a device registration)
 * budgetable.
 *
 * Owned by the caller and handed in (`EngineOptions.session`), as the
 * environment is (2026-10-04). Until 2026-10-07 it was a module-level `let`
 * with an exported reset for tests: every engine in the PROCESS shared it, so
 * a second server built in one process (each test file, an embedder of
 * createAveriServer) continued the first one's count, and each engine test
 * file had to remember to zero it. The MCP server (mcp/tools.ts) now makes one
 * per server — the server IS the session — and passes it to every tool that
 * runs the engine.
 */
export class EngineSession {
  #clearStateCount = 0;

  /** How many wipes this session's runs have performed so far. */
  get clearStateCount(): number {
    return this.#clearStateCount;
  }

  /** Counts one wipe and returns the new total — the number the `⚠ clearState` line prints. */
  recordClearState(): number {
    return ++this.#clearStateCount;
  }
}

/**
 * What one engine run does: ensure a state, run a flow, or both — in that
 * order, the state first (a flow may depend on it). A type, not a runtime
 * check, says it names at least one: `{}` does not compile.
 */
export type RunRequest = { state: string; flow?: string } | { state?: undefined; flow: string };

/**
 * The request a caller holding two OPTIONAL names makes — `verify`'s state
 * and flow — or undefined when it names neither (nothing for the engine to
 * do). An empty string is "none", as `verify` always read it. The one place
 * the union is built from optional strings, so no caller spells the
 * narrowing by hand.
 */
export const runRequestOf = (state?: string, flow?: string): RunRequest | undefined => {
  const s = state || undefined;
  const f = flow || undefined;
  return s !== undefined ? { state: s, flow: f } : f !== undefined ? { flow: f } : undefined;
};

export interface EngineOptions {
  /**
   * Poll interval for waits — and ONLY that (2026-10-05). It is handed to the
   * Verifier the inline `assert:` steps use as its poll interval too; the
   * stability wait before a pixel reading is verify/capture.ts's own budget,
   * which this knob no longer touches (it used to be forwarded as the delay
   * between stability captures, so asserts inside flows waited 500 ms where
   * the MCP `assert` tool waited 300). Tests use a few ms.
   */
  pollMs?: number;
  tapTimeoutMs?: number;
  waitTimeoutMs?: number;
  ensureTimeoutMs?: number;
  optionalTimeoutMs?: number;
  /** Grace window for the detect re-check between two reach flows (see `detects`). */
  reachRecheckMs?: number;
  /**
   * Default timeout for inline `assert:` steps (each spec can override). Set,
   * it applies to EVERY assert kind, color/ocr included — a value under ~8 s
   * starves a screen that needs two rounds on an Android emulator; leave it
   * unset for the Verifier's per-kind defaults, 3 s for tree asserts and 12 s
   * for color/ocr (2026-10-06, verify/assert.ts `PIXEL_ASSERT_TIMEOUT_MS`).
   */
  assertTimeoutMs?: number;
  /** Pause between type_pin keystrokes (auto-advancing inputs drop bulk text). */
  pinKeyDelayMs?: number;
  /**
   * Credential environment from `environments:` (see `resolveCredentials`).
   * Omit to fall back to `AVERI_ENV` then `defaultEnvironment:`.
   */
  environment?: string;
  /**
   * The environment `${VAR}` values resolve from — the loader's
   * (flow/load.ts, `ProjectConfig.env`: the real environment over the
   * project's `.env.averi`). REQUIRED, not defaulted to `process.env`, since
   * 2026-10-04: the engine used to read `process.env` at step time, so it
   * silently depended on the right loader having written the file into it
   * first; now a caller that has not loaded the environment cannot build an
   * engine. Tests pass a plain object.
   */
  env: EnvValues;
  /**
   * The session this run counts toward (see `EngineSession`). REQUIRED, like
   * `env`: optional, a caller that forgot it silently reset the "N this
   * session" count on every call — the leak this type exists to close, just
   * moved (code review, 2026-10-07). The MCP layer passes the server's; a
   * test passes `new EngineSession()`.
   */
  session: EngineSession;
}

/**
 * What a run-layer request carries for the engine beyond the config and the
 * adapter: the credential environment and the session. One type, so
 * run/commands.ts and run/verify.ts declare (and document) them once — the
 * comments are EngineOptions' own.
 */
export type EngineContext = Pick<EngineOptions, 'environment' | 'session'>;

/**
 * First line only: a trace entry is a headline, and the rest of a FlowError's
 * message is the trace it already carries — repeating it inside itself reads
 * as a second failure.
 */
const headline = (e: unknown): string => errorMessage(e).split('\n')[0];

/**
 * Interprets averi.yaml flows against a DeviceAdapter. Every action polls for
 * its precondition (waits, not sleeps). Credential values are resolved lazily
 * from env and redacted from traces and errors — the caller never sees them.
 */
export class FlowEngine {
  /** The run's trace — the whole run's, the state's lines and the flow's alike. */
  private readonly trace: TraceEntry[] = [];
  /**
   * One recovery pass per run — per tool call — across the state, the flow
   * and nested `requires` (see `recoveryPass`): the state whose ladder spent
   * it, undefined while unspent. Named so a later ladder that finds it gone
   * can say on what.
   */
  private recoverySpentOn: string | undefined;
  /** The session this run counts its wipes toward (EngineOptions.session). */
  private readonly session: EngineSession;
  private secrets = new Set<string>();
  /** >0 while inside an `optional` block, whose failures are swallowed by design (see runStep). */
  private swallowDepth = 0;
  /** Errors that already produced a ✗ trace line — one per failure, however deep it propagates (see runStep). */
  private readonly loggedFailures = new WeakSet<object>();
  private readonly pollMs: number;
  private readonly tapTimeoutMs: number;
  private readonly waitTimeoutMs: number;
  private readonly ensureTimeoutMs: number;
  private readonly optionalTimeoutMs: number;
  private readonly reachRecheckMs: number;
  private readonly assertTimeoutMs: number | undefined;
  private readonly pinKeyDelayMs: number;
  private readonly credentials: Credentials;
  /**
   * `app.ios.keyboardDismiss` in interact/'s vocabulary (flow/config.ts#
   * keyboardDismissals), converted once here and handed to every tap and
   * fill — and to the post-fill dismissal — as `GuardOptions.dismissals`.
   * The engine never branches on the platform for it: interact/ reads the
   * list only where the adapter has no keyboard oracle, so on Android it is
   * carried and never read.
   */
  private readonly dismissals: readonly KeyboardDismissal[] | undefined;

  private constructor(
    private readonly cfg: AveriConfig,
    private readonly adapter: DeviceAdapter,
    opts: EngineOptions,
  ) {
    // Resolved once per engine so a run cannot type one environment's username
    // and another's password; resolved before any STEP, so a bad name never
    // fails mid-login. The refusal BEFORE any device is the run layer's
    // pre-flight (run/preflight.ts#refuseUnknownEnvironment, 2026-10-05) — the
    // engine is built after the adapter and cannot give that guarantee itself.
    this.credentials = resolveCredentials(cfg, opts.env, opts.environment);
    this.pollMs = opts.pollMs ?? 500;
    this.tapTimeoutMs = opts.tapTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? 10_000;
    this.ensureTimeoutMs = opts.ensureTimeoutMs ?? 20_000;
    this.optionalTimeoutMs = opts.optionalTimeoutMs ?? 1_500;
    this.reachRecheckMs = opts.reachRecheckMs ?? 2_000;
    this.assertTimeoutMs = opts.assertTimeoutMs;
    this.pinKeyDelayMs = opts.pinKeyDelayMs ?? 300;
    this.dismissals = keyboardDismissals(cfg);
    this.session = opts.session;
  }

  /**
   * The engine's one entry: ONE run — one trace, one environment line, one
   * guard (so a failure carries everything the run did), one recovery budget.
   * `state` is ensured first (detect → reach flows → confirm; idempotent),
   * then `flow` runs. Each call builds its own engine, and the constructor is
   * private: the per-run state below cannot outlive the run or be shared
   * with another, because nothing outside can hold an engine.
   *
   * 2026-10-07 (flow-engine review, candidate 1). There used to be two
   * instance entries, `ensureState` and `runFlow`, and an unwritten rule: one
   * instance, one entry. Each entry reset the trace and the recovery budget
   * and logged the environment, and `verify` called both in turn on one
   * instance — so a flow that failed after its state was ensured threw a
   * FlowError holding the flow's steps only (the `state … already active`
   * line, and after a ladder the `⚠ clearState` line, were gone from the
   * FAILED section), the environment line was printed twice, and "one
   * recovery pass per tool call" held twice. The rule is now the shape.
   */
  static run(cfg: AveriConfig, adapter: DeviceAdapter, opts: EngineOptions, request: RunRequest): Promise<TraceEntry[]> {
    // Async so a constructor throw (an unknown environment) is a rejection,
    // like every other failure of a run.
    return (async () => new FlowEngine(cfg, adapter, opts).runOnce(request))();
  }

  private async runOnce({ state, flow }: RunRequest): Promise<TraceEntry[]> {
    this.logEnvironment();
    await this.guard(async () => {
      if (state !== undefined) await this.ensureStateInner(state);
      if (flow !== undefined) await this.runFlowInner(flow);
    });
    return this.trace;
  }

  /**
   * First line of every run, when an environment is active. Values stay
   * redacted, but the NAMES are the whole point: a wrong login name is rejected
   * one screen after it is typed, so without this the caller sees a credentials
   * error and has no way to tell it was really the wrong backend.
   */
  private logEnvironment(): void {
    const { environment, overriddenNames } = this.credentials;
    if (environment === undefined) return;
    this.log(
      `environment ${environment}`,
      overriddenNames.length > 0 ? `overrides: ${overriddenNames.join(', ')}` : undefined,
    );
  }

  private async ensureStateInner(name: string): Promise<void> {
    const state = this.cfg.states[name];
    if (!state) throw new SetupError(`Unknown state "${name}" — known: ${Object.keys(this.cfg.states).join(', ')}`);
    // The probe immediately before the next rung: this entry check for rung
    // 0, then each rung's own re-check. Its answer gates a destructive rung.
    let probe = await this.detects(state.detect, 0);
    if (probe.answer === 'yes') {
      this.log(`state ${name}`, 'already active');
      return;
    }
    if (!state.reach || state.reach.length === 0) {
      throw new SetupError(
        learnedNothing(probe) ?
          `State "${name}" could not be checked (${describeUnreadCause(probe)}) and it has no reach flows`
        : `Not in state "${name}" and it has no reach flows`,
      );
    }
    // Re-detect after EVERY reach flow, not only after the last one. A reach
    // list reads as an escalation ladder — "dismiss the post-login prompt;
    // failing that, log in" — but running every rung unconditionally makes a
    // cheap prelude powerless to protect a destructive flow behind it: the
    // 2026-08-26 finding is a `launch { clearState: true }` login that burned
    // a device registration on a session that was already alive, because a
    // post-login interstitial defeated `detect` for one probe. Short-circuit
    // gives "try cheap, escalate only if it did not work" — and is a no-op for
    // the single-entry reach lists that are the overwhelming majority.
    for (const [i, flow] of state.reach.entries()) {
      const last = i === state.reach.length - 1;
      // A rung that THROWS must escalate too, not abort the ladder. "Try the
      // cheap one, fall back to login" has to hold for the way a cheap flow
      // actually fails — a `tap:` that times out because the interstitial was
      // not there — or the prelude only works on the runs that did not need
      // it. The failure is never swallowed: it goes in the trace, so a broken
      // prelude stays visible instead of being read as a slow login.
      let failed = false;
      // Pre-flight, not post-hoc. `launch { clearState: true }` already prints
      // '⚠ clearState: app state wiped', but that line arrives AFTER the
      // registration is gone. Measured 2026-08-27: an inactivity timeout
      // ("Logged out — due to your inactivity…") made the ladder escalate
      // CORRECTLY — the app really was logged out — straight into the wipe,
      // because nothing distinguishes "log in from scratch" from
      // "re-authenticate a device whose registration is still valid".
      //
      // The engine cannot tell those apart either; only the config can, by
      // declaring the recoverable screen as its own state with a PIN-login
      // reach. So this does not reorder the ladder (rung order is the config's
      // only expression of preference, and overriding it silently would be its
      // own bug) — it announces the cost while a human can still interrupt,
      // and names the missing cheap rung as the fix.
      //
      // The rung's OWN steps, not what its `requires` might pull in — the
      // recovery pass below asks a different question; see
      // `flowItselfIsDestructive` for why the two predicates must stay apart.
      if (flowItselfIsDestructive(this.cfg, flow)) {
        // ...unless the probe right before it never read a tree (2026-10-06,
        // docs/bugs/2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md)
        // or read only BARE ones (2026-10-07, docs/bugs/2026-10-06-second-
        // look-reads-android-decor-as-not-in-state.md). Then "not in state"
        // is not knowledge — the measured cases are idb returning a 0×0
        // Application for minutes on a RENDERED screen, where mp-native's
        // ladder would have wiped a registered app, and a cold launch's
        // decor or splash read as "not logged out" on an app whose login
        // screen was seconds away — so the rung is refused rather than
        // announced. Only the probe immediately before counts: a later probe
        // that READ a rendered tree and missed is real knowledge, and an
        // earlier readable one is stale. Cheap rungs still run on an unknown
        // or bare probe, at once (they are how a ladder gets a tree to read),
        // and only a ladder applies the rule: `run_flow` never refuses the
        // flow's OWN body (the caller's own decision), though a `requires:`
        // inside it runs a ladder that does; the recovery pass never runs a
        // destructive rung at all.
        //
        // One SECOND LOOK first: the entry probe is a single read (so the
        // warm path stays one read), and both of these are what a cold
        // launch looks like for a while — SKILL.md sends agents to
        // ensure_state right after launch_app. Measured 2026-10-06 on
        // finportal (Android 13 emulator, RN debug build): null root to
        // ~+3 s, the decor alone (android:id/content, action_bar_root)
        // +5.3…+13.8 s, `login_screen` at +18.3 s; through WDA the 7-node
        // splash is read at +0.3 s. Until 2026-10-07 the window was the
        // settle budget (`tapTimeoutMs`, 5 s) and only an unknown probe got
        // it: it ended on the decor, read that as "no", and wiped an app
        // that was already logged out — three runs of three; under WDA the
        // ENTRY probe read the splash as "no" and the wipe ran with no
        // second look at all. Now the window is `ensureTimeoutMs` (20 s by
        // default), the budget that already means "how long a state may take
        // to appear" — the final wait below uses it — and one loop with one
        // deadline rides out null root → decor → rendered as the one
        // transient it is. A second look that reads the state ends the call;
        // one whose window held a rendered tree outside the state runs the
        // rung, warning as usual (it polls to its deadline first, as every
        // detect window does — at most 20 s, only after a cold-launch probe,
        // in front of a rung that costs a wipe and a login); one that still
        // read nothing rendered is refused. It cannot outlast the measured
        // idb episode (minutes), so that is still refused; a transient longer
        // than the window is refused too, and retrying the call — or
        // run_flow of the rung — is the fix.
        if (learnedNothing(probe)) {
          // The refusal's cause is what BOTH probes read (UnreadCause): a
          // bare entry read is still worth naming when every read of the
          // second look failed.
          const before = probe;
          probe = await this.detects(state.detect, this.ensureTimeoutMs);
          if (probe.answer === 'yes') {
            this.log(`state ${name}`, i === 0 ? 'already active' : `reached after ${state.reach[i - 1]}`);
            return;
          }
          if (learnedNothing(probe)) {
            const refusal = new UnreadTreeRefusal(name, flow, before, probe);
            this.log(`⛔ reach ${flow}`, `refused: ${refusal.reason}`);
            throw refusal;
          }
        }
        this.log(
          `⚠ reach ${flow}`,
          'this rung is DESTRUCTIVE — it wipes app state, and any device registration with it. ' +
            'If the app is on a RECOVERABLE screen (an inactivity timeout, an expired session), a ' +
            'cheaper non-destructive rung declared BEFORE this one would restore it instead',
        );
      }
      try {
        await this.runFlowInner(flow);
      } catch (e) {
        // A setup mistake is not something the next rung can fix — and the
        // next rung is the destructive one. Measured: a prelude naming an
        // undeclared credential escalated into a `clearState: true` login,
        // wiping app state to re-run a step that could never have worked.
        // A nested ladder's refusal (this rung's `requires:`) is terminal for
        // the same reason: escalating past it runs the wipe it declined.
        if (isTerminal(e)) throw e;
        const why = headline(e);
        // A throwing LAST rung is not the end of the ladder's obligations, it
        // is only the end of what the ladder can escalate to. Hand it to
        // salvage, which owes the caller the same two chances the loop gives
        // every other rung, then rethrow the ORIGINAL error.
        if (last) {
          this.log(`⚠ reach ${flow}`, `failed — ${why}`);
          if (await this.salvageThrowingLastRung(name, state, flow)) return;
          throw e;
        }
        failed = true;
        this.log(`⚠ reach ${flow}`, `failed, escalating to ${state.reach[i + 1]} — ${why}`);
      }
      // Only a rung that completed and has something after it earns a grace
      // window: the last one falls through to waitFor below (a far more
      // generous one), and a rung that threw is not a screen still settling.
      // So this adds no latency to the single-entry case.
      const grace = last || failed ? 0 : this.reachRecheckMs;
      // Checked even after a failure: the flow may have reached the state
      // before dying on a later step, and escalating THERE is the exact
      // destructive escalation this loop exists to prevent.
      probe = await this.detects(state.detect, grace);
      if (probe.answer === 'yes') {
        this.log(`state ${name}`, `reached after ${flow}`);
        return;
      }
    }
    try {
      await this.waitFor({ state: name }, this.ensureTimeoutMs, `state ${name} after reach flows`);
    } catch (e) {
      // The mirror of the escalation above, and the other half of "idempotent
      // — call it freely". The ladder is one-shot and forward-only, so the
      // LAST rung's own aftermath can produce a screen that an EARLIER rung
      // exists to clear and nothing ever re-runs it. Measured 2026-08-26: a
      // `clearState` login finished, the biometrics interstitial arrived a
      // network round-trip later — after the login flow's short `optional:`
      // windows had closed — and this wait sat on it until it timed out.
      // An immediately repeated, identical ensure_state call then passed,
      // because it restarted the ladder from rung 1. The engine already
      // contained the cure; it just never applied it inside one call.
      //
      // recoveryPass logs the rung that got there, so there is no second
      // "reached" line here. A SetupError is exempt for the same reason the
      // ladder exempts it: re-running flows cannot fix a broken descriptor.
      if (e instanceof SetupError || !(await this.recoveryPass(name, state, 'timed out'))) throw e;
      return;
    }
    this.log(`state ${name}`, 'reached');
  }

  /**
   * The last rung threw, so the ladder has nothing left to escalate to — but
   * a throw is a verdict about the FLOW, not about the state, and the rethrow
   * used to jump over both checks every other rung gets.
   *
   * The detect first: a rung can reach the state and then die on a later step,
   * which is exactly why the ladder re-checks after a failed rung instead of
   * escalating blind. The last rung alone never got that check.
   *
   * Then the recovery pass, for the shape that motivated it in the first
   * place. Real configs spell a login flow's success criterion as the flow's
   * own trailing `wait: { state: ... }`, so a late interstitial makes the LAST
   * RUNG THROW rather than the ladder's final wait time out — and that wait
   * was the only place the pass armed. Measured on device against 0.5.0: the
   * original incident failed exactly as it had pre-fix, with no `↻ recovery`
   * line in the trace. The pass is safe here for the same reason it is safe on
   * a timeout: it re-runs only provably repeatable rungs, so by construction
   * it adds no wipes, whatever made the rung throw.
   *
   * Returns whether the state was reached; on false the caller rethrows the
   * ORIGINAL error, with the salvage visible in the trace either way.
   */
  private async salvageThrowingLastRung(
    name: string,
    state: AveriConfig['states'][string],
    flow: string,
  ): Promise<boolean> {
    // No grace, for the reason the ladder gives: a rung that threw is not a
    // screen still settling.
    if ((await this.attempt(`salvage ${flow}`, () => this.detects(state.detect, 0)))?.answer === 'yes') {
      this.log(`state ${name}`, `reached after ${flow}`);
      return true;
    }
    return this.recoveryPass(name, state, `${flow} failed`);
  }

  /**
   * Last resort before failing: re-run the reach rungs that are safe to repeat,
   * once, then re-check `detect`.
   *
   * Two bounds keep this from re-opening the destructive-escalation hole the
   * ladder exists to close. The LAST rung is never re-run — it is the
   * escalation anchor, the rung the ladder climbs TO, and re-running it is how
   * a recovery pass turns into a second wipe. And every candidate must be
   * provably non-destructive (`flowIsDestructive`), because "non-last" is a
   * convention about cheap preludes, not an invariant the schema enforces:
   * nothing stops a `clearState` login from sitting at index 0 of three.
   *
   * Returns whether the state was reached; on false the caller throws the
   * error that armed the pass — the final wait's timeout, or the last rung's
   * own throw — so a genuinely stuck run fails exactly as it did before, with
   * the attempted re-pass visible in the trace.
   */
  private async recoveryPass(
    name: string,
    state: AveriConfig['states'][string],
    why: string,
  ): Promise<boolean> {
    // Per run — per tool call — not per state: `requires` can nest a state
    // inside a reach flow, and a run can ensure a state and then run a flow
    // whose `requires` ladders again (verify with both, 2026-10-07). One
    // bounded retry for the whole call is the honest read of "at most once" —
    // neither nesting nor a second leg of the run may multiply it.
    // `reach` is non-empty here — ensureStateInner threw above if it was not.
    const rungs = (state.reach ?? []).slice(0, -1).filter((f) => !flowIsDestructive(this.cfg, f));
    if (rungs.length === 0) return false;
    if (this.recoverySpentOn !== undefined) {
      // Said, not silent (code review, 2026-10-07): a second ladder in the
      // run — a flow's `requires:` after verify's state — that WOULD have
      // had a pass otherwise fails without one, and the trace must say why,
      // or it reads as the recovery rule not applying to `requires`.
      this.log(
        `↻ no recovery ${name}`,
        `${why} — the run's one recovery pass was already spent on ${this.recoverySpentOn}`,
      );
      return false;
    }
    this.recoverySpentOn = name;
    this.log(
      `↻ recovery ${name}`,
      `${why} — re-running ${rungs.join(', ')} once (a late screen may need clearing)`,
    );
    for (const flow of rungs) {
      // Nothing in this loop escalates or throws: the ladder is already spent
      // and the only thing after it is the original timeout, which the caller
      // rethrows untouched. A rung that fails again — or an adapter that dies
      // during the re-check — is diagnostics, not a decision, and must not
      // become the error the user sees in place of the real one.
      await this.attempt(`recovery ${flow}`, () => this.runFlowInner(flow));
      // Separate attempt, so the detect still runs after a rung that threw:
      // it may have reached the state before dying on a later step, exactly as
      // in the ladder above.
      const reached = await this.attempt(`recovery ${flow}`, () =>
        this.detects(state.detect, this.reachRecheckMs),
      );
      if (reached?.answer === 'yes') {
        this.log(`state ${name}`, `reached after recovery ${flow}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Run one probe that must not change the verdict, turning any failure into a
   * trace line. Once the ladder is spent the error the caller sees is already
   * decided — the original timeout, or the last rung's own throw — and
   * neither a rung that fails again nor an adapter that dies mid-probe may
   * take its place.
   */
  private async attempt<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      this.log(`⚠ ${label}`, `failed — ${headline(e)}`);
      return undefined;
    }
  }

  /**
   * Is `detect` satisfied, within a window? `windowMs: 0` is a single
   * probe — the entry check, which must be cheap, and the check after the last
   * reach flow, which has the ensureStateInner wait right behind it. A rung with
   * another rung after it polls for a moment instead: a flow that just tapped
   * its way home may need one to land, and a false miss THERE is not merely
   * slow, it escalates to the next, possibly destructive, flow.
   *
   * An unreadable tree is not "in this state", and must not throw either:
   * right after a cold launch/reinstall (no window yet) is exactly when the
   * reach flows are needed. But it is not "not in this state" either: a
   * probe that never read a tree answers `unknown` (Detection), and one
   * that read only bare trees answers `bare` — the ladder alone tells either
   * from `no`, and refuses a destructive rung on them. The window is a
   * grace window (`reachRecheckMs`) after a rung, and since 2026-10-07 the
   * second look (`ensureTimeoutMs`) before a destructive one.
   */
  private async detects(cond: Condition, windowMs: number): Promise<Detection> {
    // Trees that held something rendered, and the last bare one's shape —
    // asked only of a tree that MISSED: a match is "yes" whatever else the
    // tree holds. (So an `absent: true` detect still answers "yes" on a bare
    // tree, since nothing in it matches; that predates the bare answer and is
    // not this probe's question.)
    let rendered = 0;
    let lastBareTree: UiNode | undefined;
    const outcome = await pollTree(
      this.adapter,
      async (tree) => {
        if (await this.matches(cond, tree)) return true;
        if (isBareTree(tree)) lastBareTree = tree;
        else rendered++;
        return undefined;
      },
      { timeoutMs: windowMs, pollMs: this.pollMs },
    );
    if (!outcome.timedOut) return { answer: 'yes' };
    // Trees were read and none was rendered: the probe's answer is `bare`
    // (below), and its line says so — a read error on a later round is not
    // the answer then, so it gets no line of its own.
    const allBareTree = rendered === 0 ? lastBareTree : undefined;
    // Until 2026-10-03 this probe swallowed the read error (`.catch(() =>
    // undefined)`), so an adb that had gone away looked exactly like "not in
    // this state" and the ladder escalated — possibly into a wipe — with no
    // line saying the device had never been asked. The answer is still not
    // "yes" (an unreadable tree is not "in state"), and the trace says why.
    // Right after a cold launch (no window yet) it is the normal case.
    if (outcome.readError !== undefined && allBareTree === undefined) {
      this.log('⚠ detect', `${describeCondition(cond)} treated as not detected — ${readFailed(outcome.readError)}`);
    }
    // The 2026-10-03 follow-up, done 2026-10-06 with its measured incident
    // (the idb 0×0 tree): a probe that read NO tree in any round is unknown,
    // not "no" — the ladder refuses a destructive rung on it. One good read
    // makes it "no" even if a later read failed: that tree was knowledge.
    // `treesRead === 0` means every round's read failed, so the last one's
    // error is set; the second test only narrows the type.
    if (outcome.treesRead === 0 && outcome.readError !== undefined) return { answer: 'unknown', readError: outcome.readError };
    // 2026-10-07 (docs/bugs/2026-10-06-second-look-reads-android-decor-as-
    // not-in-state.md): a tree is not knowledge either when it is BARE — the
    // decor Android shows for ~9 s of a cold launch, WDA's splash. "One good
    // read makes it 'no'" now means one RENDERED read: a probe whose every
    // tree was bare answers `bare`, and says so in the trace the way an
    // unreadable one does. `treesRead > 0` here, so `allBareTree` is set
    // exactly when nothing rendered was read.
    if (allBareTree !== undefined) {
      const probe: UnreadProbe = { answer: 'bare', shape: treeShape(allBareTree) };
      this.log('⚠ detect', `${describeCondition(cond)} treated as not detected — ${describeUnreadCause(probe)}`);
      return probe;
    }
    return { answer: 'no' };
  }

  private async runFlowInner(name: string): Promise<void> {
    const flow = this.cfg.flows[name];
    if (!flow) throw new SetupError(`Unknown flow "${name}" — known: ${Object.keys(this.cfg.flows).join(', ')}`);
    if (flow.requires) await this.ensureStateInner(flow.requires);
    this.log(`flow ${name}`, 'start');
    for (const step of flow.steps) await this.runStep(step);
    this.log(`flow ${name}`, 'done');
  }

  /** Run one step; if it fails, name it in the trace — unless an enclosing `optional` will swallow it. */
  private async runStep(step: Step): Promise<void> {
    try {
      await this.dispatchStep(step);
    } catch (e) {
      // Steps log only once they SUCCEED, so a failing flow's trace used to end
      // on the step BEFORE the culprit (measured 2026-09-17: the last line read
      // `fill: id:"login_username" = ***` while the PASSWORD fill was failing,
      // and the first hypothesis went after username resolution). Name it —
      // unless an enclosing `optional` is about to swallow it: a ✗ beside an
      // `optional: skipped` line would be two verdicts on one failure. Inside a
      // reach ladder the ✗ stays: `⚠ reach <flow>` says the rung failed, this
      // line says on WHICH step.
      // One ✗ per failure: the innermost step logs it; the enclosing `branch` /
      // platform-override / nested-flow steps that rethrow the SAME error add
      // only a vaguer label (review 2026-09-18).
      const seen = typeof e === 'object' && e !== null && this.loggedFailures.has(e);
      if (this.swallowDepth === 0 && !seen) {
        this.log(`✗ ${stepSummary(step, this.adapter.platform)}`, `failed — ${headline(e)}`);
        if (typeof e === 'object' && e !== null) this.loggedFailures.add(e);
      }
      throw e;
    }
  }

  /**
   * Dispatch one step to its handler.
   *
   * Deliberately a flat chain of one-line delegations rather than a
   * Record<kind, handler> table: the Step union is discriminated by WHICH key
   * is present, and `'x' in step` is exactly what narrows it. A keyed table
   * would need a cast per entry and would give every handler an untyped
   * payload — the vocabulary is the valuable part, so it stays type-checked.
   */
  private async dispatchStep(step: Step): Promise<void> {
    if ('android' in step || 'ios' in step) return this.runPlatformOverride(step);
    if ('launch' in step) return this.runLaunch(step.launch);
    if ('tap' in step) {
      const { spec, timeoutMs } = splitTapSpec(step.tap);
      return this.tapSpec(spec, timeoutMs ?? this.tapTimeoutMs);
    }
    if ('type' in step) return this.runType(step.type);
    if ('type_pin' in step) return this.runTypePin(step.type_pin);
    if ('swipe' in step) return this.runSwipe(step.swipe);
    if ('scroll_until' in step) return this.runScrollUntil(step.scroll_until);
    if ('fill' in step) return this.runFill(step.fill);
    if ('assert' in step) return this.runAssert(step.assert);
    if ('wait' in step) return this.runWait(step.wait);
    if ('branch' in step) return this.runBranch(step.branch);
    if ('optional' in step) return this.runOptional(step.optional);
    throw new Error(`Unhandled step: ${JSON.stringify(step)}`);
  }

  private async runPlatformOverride(step: Step): Promise<void> {
    const override = (step as { android?: Step; ios?: Step })[this.adapter.platform];
    if (override) await this.dispatchStep(override); // the ✗ line is the outer step's (it names the variant)
    else this.log('skip', `no ${this.adapter.platform} variant for platform-specific step`);
  }

  private async runLaunch(spec: StepPayload<'launch'>): Promise<void> {
    const app = this.cfg.app[this.adapter.platform];
    if (!app) throw new SetupError(`averi.yaml has no app.${this.adapter.platform} section`);
    const appId = 'package' in app ? app.package : app.bundleId;
    // Step-level activity wins over app.android.activity, which applies only
    // when the step names neither an activity nor an intent (2026-10-03: an
    // intent alone is delivered within the package, not forced onto the
    // config's launcher activity). On iOS neither applies unless the step
    // names one — the adapter then rejects it loudly. The rule, its "when"
    // included, is flow/config.ts's (shared with launch_app).
    const activity = resolveLaunchActivity(this.cfg, {
      platform: this.adapter.platform,
      appId,
      activity: spec.activity,
      intent: spec.intent,
    });
    await this.adapter.launch(appId, {
      clearState: spec.clearState,
      activity,
      intent: spec.intent,
    });
    this.log(
      'launch',
      appId +
        (activity === undefined ? '' : `/${activity.split('/').pop()}`) +
        (spec.clearState ? ' (state cleared)' : ''),
    );
    // The cost of a wipe is invisible at the moment it is paid, and nothing in
    // the trace said so. The line states the MECHANISM and leaves the price to
    // the reader: what it costs is app-specific, and averi drives any app. Be
    // precise about the mechanism too — this deletes the app's data container
    // (iOS) / runs `pm clear` (Android); it does not clear the iOS keychain,
    // whatever a re-registration afterwards may suggest. The running count
    // spans tool calls on purpose: it is the SESSION's (EngineSession, the
    // MCP server's, handed in), and "3rd this session" is what makes a finite
    // resource budgetable.
    if (spec.clearState) {
      const count = this.session.recordClearState();
      this.log(
        '⚠ clearState',
        'app state wiped (data container deleted) — anything the app persisted, ' +
          `a device registration included, is gone (${count} this session)`,
      );
    }
  }

  private async runType(spec: StepPayload<'type'>): Promise<void> {
    const { value, secret } = this.resolveValue(spec.value);
    await typeIntoFocused(this.adapter, value);
    this.log('type', secret ? '***' : value);
  }

  private async runTypePin(spec: StepPayload<'type_pin'>): Promise<void> {
    const { value: raw } = this.resolveValue(spec.value);
    // PIN/OTP inputs are numeric; formatting in the credential ("111-111-111")
    // is display convention, not keystrokes.
    const pin = raw.replace(/\D/g, '');
    const rounds = spec.twice ? 2 : 1;
    for (let round = 0; round < rounds; round++) {
      if (spec.keypad) {
        const { id_pattern, text_pattern } = spec.keypad;
        for (const digit of pin) {
          const key: ElementSpec = id_pattern
            ? { id: id_pattern.replace('{digit}', digit) }
            : { text: text_pattern!.replace('{digit}', digit) };
          await this.tapSpec(key, this.tapTimeoutMs, true);
        }
      } else {
        // One keystroke at a time: auto-advancing multi-box inputs (OTP
        // fields) move focus per digit and silently drop bulk-typed text.
        for (const digit of pin) {
          await this.adapter.typeText(digit);
          await sleep(this.pinKeyDelayMs);
        }
      }
    }
    this.log('type_pin', `${pin.length} digits${rounds === 2 ? ', twice' : ''}`);
  }

  private async runSwipe(spec: StepPayload<'swipe'>): Promise<void> {
    const times = spec.times ?? 1;
    await swipeScreen(this.adapter, { direction: spec.direction, meaning: 'finger', times }); // a swipe: names the FINGER's movement
    this.log('swipe', `${spec.direction}${times > 1 ? ` ×${times}` : ''}`);
  }

  private async runScrollUntil(spec: ScrollUntilSpec): Promise<void> {
    const { element, timeout, ...rest } = spec;
    // The YAML's `timeout: 2s` is this layer's vocabulary; interact takes ms.
    // The pause after each swipe is interact/scroll.ts's own (400 ms): it is
    // a gesture-settle wait, not this engine's poll interval. Until 2026-10-05
    // `pollMs` (500) was passed as `settleMs` — the same one-knob-two-meanings
    // habit that made the stability budget 500 ms inside flows (capture.ts).
    // That is a production timing change (500 → 400 ms between a swipe and
    // the next tree read in flows) nobody has measured on a device yet: the
    // next device run should look at `scroll_until` steps.
    const result = await scrollUntilVisible(this.adapter, element, {
      ...rest,
      timeoutMs: timeout === undefined ? undefined : parseDuration(timeout),
    });
    this.log(
      result.clipped.length > 0 ? '⚠ scroll_until' : 'scroll_until',
      `${describeSpec(element)} ${describeScrollResult(result)}`,
    );
  }

  private async runFill(fill: StepPayload<'fill'>): Promise<void> {
    const { value: rawValue, clear, dismissKeyboard: closeKeyboard, ...spec } = fill;
    const { value, secret } = this.resolveValue(rawValue);
    const { warning } = await this.tracingDismissal('⚠ fill', () =>
      fillField(this.adapter, spec, value, {
        ambiguous: FLOW_AMBIGUITY,
        clear,
        timeoutMs: this.tapTimeoutMs,
        pollMs: this.pollMs,
        dismissals: this.dismissals,
        // No focus-delay knob: the 350 ms is interact/fill.ts's; the engine
        // tests mock util/sleep instead of threading a test-only option here.
      }),
    );
    // The warnings are logged BEFORE the keyboard is dismissed: a dismissal
    // that throws (a `back` the device refuses, a dismissal tap that does
    // not hide the keyboard) must not take the masked-append warning down
    // with it. The keyboard line (tracingDismissal's) comes first: it
    // happened first, before the focus tap.
    if (warning !== undefined) this.log('⚠ fill', `${describeSpec(spec)}: ${warning}`);
    // What the dismissal did (stage B, 2026-10-07): on the in-tree model it
    // may tap a configured element — said on the fill line, since the step
    // did it — or leave the keyboard up with a reason, a `⚠ fill` line like
    // the masked-append one, so the next step's refusal is not a surprise.
    // On the oracle model both are absent and the line is as it was. A
    // dismissal that THROWS after tapping (AfterDismissalTap) gets its `⚠
    // fill` line before the `✗` through the guard's one catch
    // (tracingGuardFailure) — not tracingDismissal: the result has no
    // `keyboardHidden` to trace, only `hiddenBy` for the fill line.
    let closed: DismissResult = {};
    if (closeKeyboard) {
      closed = await this.tracingGuardFailure('⚠ fill', () =>
        dismissKeyboard(this.adapter, { dismissals: this.dismissals, ambiguous: FLOW_AMBIGUITY }),
      );
    }
    if (closed.warning !== undefined) this.log('⚠ fill', `${describeSpec(spec)}: ${closed.warning}`);
    this.log(
      'fill',
      `${describeSpec(spec)} = ${secret ? '***' : value}${clear ? ' (cleared)' : ''}` +
        (closed.hiddenBy === undefined ? '' : `; keyboard hidden by ${closed.hiddenBy}`),
    );
  }

  private async runAssert(specs: StepPayload<'assert'>): Promise<void> {
    const verifier = new Verifier(this.adapter, { pollMs: this.pollMs, timeoutMs: this.assertTimeoutMs });
    const results = await verifier.assertAll(specs);
    for (const r of results) this.log(r.pass ? 'assert PASS' : 'assert FAIL', r.description + (r.detail ? ` — ${r.detail}` : ''));
    const failed = results.filter((r) => !r.pass);
    if (failed.length > 0) {
      throw new Error(
        `${failed.length}/${results.length} flow asserts failed:\n` +
          failed.map((r) => `  FAIL ${r.description}${r.detail ? ` — ${r.detail}` : ''}`).join('\n'),
      );
    }
  }

  private async runWait(spec: StepPayload<'wait'>): Promise<void> {
    const timeoutMs = spec.timeout !== undefined ? parseDuration(spec.timeout) : this.waitTimeoutMs;
    const cond: Condition = spec.element ? { element: spec.element } : { state: spec.state };
    await this.waitFor(cond, timeoutMs, describeCondition(cond), this.waitHint(cond));
    this.log('wait', describeCondition(cond));
  }

  /**
   * The engine's half of `waitTimeoutHint`: platform and tree-source kind
   * both come from the ADAPTER, never from `app.ios.treeSource` — why is on
   * `DeviceAdapter.treeSourceKind` (adapters/types.ts). An adapter that does
   * not say (unknown kind) gets no hint. Only the `wait:` step asks;
   * ensureStateInner's state waits and branch polls describe conditions a single
   * id does not own.
   */
  private waitHint(cond: Condition): string | undefined {
    return waitTimeoutHint(cond, this.adapter.platform, this.adapter.treeSourceKind);
  }

  private async runBranch(arms: StepPayload<'branch'>): Promise<void> {
    const arm = await this.pollUntil(
      async (tree) => {
        for (const a of arms) {
          if (await this.matches(a.when, tree)) return a;
        }
        return undefined;
      },
      this.waitTimeoutMs,
      `any branch condition (${arms.map((a) => describeCondition(a.when)).join(' | ')})`,
    );
    this.log('branch', `matched ${describeCondition(arm.when)}`);
    for (const s of arm.do) await this.runStep(s);
  }

  /**
   * The optional budget bounds the PRESENCE CHECK only, never the tap. The
   * tap path (settledNode) needs the element's rect identical in two
   * consecutive tree reads, and on Android one uiautomator dump alone runs
   * 1-3s — feeding tapSpec the tight optional budget meant the deadline was
   * spent before a second read could happen, so optional taps NEVER landed on
   * a device with realistic dump latency and were silently logged as "not
   * present" (measured 2026-08-19/20, two independent apps, 100% repro). The
   * presence poll below is immune to that: pollUntil always completes at
   * least one tree read before checking its deadline, and one sighting is
   * enough — after that the step is committed and taps with the normal tap
   * timeout, exactly as a non-optional tap would.
   *
   * A tap's own `timeout:` widens the presence window (an interstitial gated
   * on a network round-trip can take far longer than the default to exist at
   * all — measured 2026-08-20 on a login-gated biometric offer, present-but-
   * late on 2 of 3 runs). The committed tap still uses the standard tap
   * budget: the element is already sighted by then, so appearance latency is
   * paid; only settling remains.
   */
  private async runOptional(steps: StepPayload<'optional'>): Promise<void> {
    this.swallowDepth++;
    try {
      await this.runOptionalSteps(steps);
    } finally {
      this.swallowDepth--;
    }
  }

  private async runOptionalSteps(steps: StepPayload<'optional'>): Promise<void> {
    for (const s of steps) {
      // Split OUTSIDE the try: a malformed `timeout:` is a config error, not
      // an absent element — it must fail the flow, never log as "skipped".
      const tap = 'tap' in s ? splitTapSpec(s.tap) : undefined;
      // Why a skipped tap was skipped. "not present" is true only until the
      // presence poll has passed; a tap that fails AFTER it (the element was
      // there — e.g. the keyboard over it would not close, and `back` was
      // pressed) says its own headline instead (review 2026-10-03: such a
      // skip read "(not present)"). The other step kinds have no presence
      // poll, so for them a KeyboardGuardError is the one failure known to
      // have found the element — a fill whose dismissal tap did not hide
      // the keyboard sent a tap, and "(not present)" would hide that
      // (stage B review).
      let present = false;
      try {
        if (tap) {
          // Presence = "something actionable is in the tree": the same policy
          // the committed tap will apply, one-shot (resolveNow), so a ghost
          // zero-area node cannot commit a tap that then cannot land.
          await this.pollUntil(
            async (tree) => (resolveNow(tree, tap.spec, { ambiguous: FLOW_AMBIGUITY }) === undefined ? undefined : true),
            tap.timeoutMs ?? this.optionalTimeoutMs,
            `optional element ${describeSpec(tap.spec)}`,
          );
          present = true;
          await this.tapSpec(tap.spec, this.tapTimeoutMs);
        } else {
          await this.runStep(s); // swallowDepth > 0: no ✗ line, the failure is logged as skipped below
        }
      } catch (e) {
        this.log('optional', `skipped ${tap ? describeSpec(tap.spec) : 'step'} (${present || e instanceof KeyboardGuardError ? headline(e) : 'not present'})`);
      }
    }
  }

  /**
   * Wait for the element to appear AND settle, then tap its center — the
   * interaction module's policy (interact/resolve.ts), shared with the MCP
   * tap tool. The resolution note is not traced: a flow's tap line names
   * the spec the author wrote, and which of several nodes carried it is the
   * tool's concern, not the trace reader's.
   *
   * One exception, 2026-10-03: when the soft keyboard covered the target and
   * had to be hidden first (interact/keyboard.ts), a `⚠ tap` line says so —
   * even for a quiet tap (a `type_pin` keypad digit: the first digit under a
   * keyboard gets the one `⚠ tap` and the one `back`; the keyboard is then
   * gone, so the following digits are plain taps — unless the screen raises
   * the keyboard again). That is not a detail of which node was chosen: the
   * flow pressed `back` and the screen re-laid-out, and an author debugging
   * the next step needs to see it. A tap that met no keyboard traces exactly
   * what it did before.
   */
  private async tapSpec(spec: ElementSpec, timeoutMs: number, quiet = false): Promise<void> {
    await this.tracingDismissal('⚠ tap', () =>
      tapElement(this.adapter, spec, { ambiguous: FLOW_AMBIGUITY, timeoutMs, pollMs: this.pollMs, dismissals: this.dismissals }),
    );
    if (!quiet) this.log('tap', describeSpec(spec));
  }

  /**
   * The ONE place the keyboard guard's work reaches the trace, for both
   * steps that go through it (2026-10-03). Either way the line precedes
   * whatever the step logs next:
   * - the step succeeded after the guard pressed `back`: the sentence the
   *   result carries ("…; hidden before tapping", or "…; back pressed; the
   *   keyboard's state afterwards could not be read") — or, on the in-tree
   *   model since stage B (2026-10-07), after it tapped a configured
   *   dismissal ("…; hidden by tapping id:"login_title" before tapping");
   * - the step FAILED after it: the attempt ("…; back pressed"), BEFORE the
   *   step's `✗` line — the key press happened whether or not the step
   *   survived it, and if no keyboard was really up it navigated. Without
   *   the line the trace showed a bare timeout. The same path carries the
   *   refusal when the two keyboard sources would not agree ("…; nothing
   *   sent") — any KeyboardGuardError, its `traceLine`.
   * A step that met no keyboard logs nothing here.
   */
  private async tracingDismissal<T extends { keyboardHidden?: string }>(
    action: '⚠ tap' | '⚠ fill',
    run: () => Promise<T>,
  ): Promise<T> {
    const result = await this.tracingGuardFailure(action, run);
    if (result.keyboardHidden !== undefined) this.log(action, result.keyboardHidden);
    return result;
  }

  /**
   * The failure half of `tracingDismissal`, on its own (2026-10-07, review
   * of the stage B branch): any KeyboardGuardError's `traceLine`, logged as
   * `action` BEFORE the error goes on to the step's `✗` line. The one catch
   * for the guard's two steps above and for the post-fill `dismissKeyboard`
   * (runFill), whose result has no `keyboardHidden` to trace — until then
   * runFill carried a second copy of the catch.
   */
  private async tracingGuardFailure<T>(action: '⚠ tap' | '⚠ fill', run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof KeyboardGuardError) this.log(action, e.traceLine);
      throw e;
    }
  }

  private async matches(cond: Condition, tree: UiNode): Promise<boolean> {
    if (cond.element) {
      const found = findBySpec(tree, cond.element);
      if (!cond.absent) return found.length > 0;
      // absent: gone from the tree OR nothing visibly on screen — the one
      // meaning absentFromViewport owns, shared with the absent assert. The
      // viewport is memoized by the adapter (adapters/types.ts): one device
      // read per adapter, however many conditions ask.
      return absentFromViewport(found, await this.adapter.viewport());
    }
    if (cond.state) {
      const state = this.cfg.states[cond.state];
      if (!state) throw new SetupError(`Unknown state "${cond.state}"`);
      return this.matches(state.detect, tree);
    }
    if (cond.any) {
      for (const c of cond.any) if (await this.matches(c, tree)) return true;
      return false;
    }
    if (cond.all) {
      for (const c of cond.all) if (!(await this.matches(c, tree))) return false;
      return true;
    }
    return false;
  }

  private async waitFor(cond: Condition, timeoutMs: number, what: string, hint?: string): Promise<void> {
    await this.pollUntil(
      async (tree) => ((await this.matches(cond, tree)) ? true : undefined),
      timeoutMs,
      what,
      hint,
    );
  }

  /**
   * Poll the UI tree until fn returns a value; throws on timeout. The loop is
   * `pollTree` (ui-tree/read-tree.ts: a failed READ is a miss, the last read
   * error is remembered, the predicate's own errors propagate at once); what
   * this adds is the flow's verdict on a timeout — an exception, worded as
   * the step the caller was waiting on, with the read error beneath it so a
   * genuinely broken device stays diagnosable. A caller's `hint` (a probable
   * cause it knows, see waitTimeoutHint) is handed over as is — whether it
   * shows beneath a failed read is pollTimeoutMessage's rule, not this one's.
   */
  private async pollUntil<T>(
    fn: (tree: UiNode) => Promise<T | undefined>,
    timeoutMs: number,
    what: string,
    hint?: string,
  ): Promise<T> {
    const outcome = await pollTree(this.adapter, fn, { timeoutMs, pollMs: this.pollMs });
    if (!outcome.timedOut) return outcome.value;
    throw new Error(pollTimeoutMessage(what, timeoutMs, outcome.readError, hint));
  }

  /**
   * `$name` → credentials[name] → `${ENV_VAR}` expansion (flow/credentials.ts
   * owns the rule and the wording). What is the engine's: a resolved secret is
   * registered for redaction before anything can log it.
   */
  private resolveValue(raw: string): ResolvedValue {
    const resolved = this.credentials.resolve(raw);
    if (resolved.secret) this.secrets.add(resolved.value);
    return resolved;
  }

  private log(action: string, detail?: string): void {
    this.trace.push({ action: this.redact(action), detail: detail === undefined ? undefined : this.redact(detail) });
  }

  private redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (secret.length > 0) out = out.split(secret).join('***');
    }
    return out;
  }

  /** All errors leave the engine redacted, and carrying the partial trace. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const message = this.redact(errorMessage(e));
      const trace = [...this.trace];
      // The environment line alone is not a step — do not dress it up as one.
      const steps = trace.filter((t) => !t.action.startsWith('environment '));
      throw new FlowError(
        steps.length === 0 ? message : (
          `${message}\n\nSteps that ran before the failure:\n${formatTrace(trace)}`
        ),
        trace,
      );
    }
  }
}

/**
 * `kind target` for the ✗ trace line — WHICH step failed, never its value
 * (a `type:` payload may be a credential; `fill:`/`type_pin:` values are not
 * printed either — the successful-step lines already redact them).
 */
export function stepSummary(step: Step, platform: 'android' | 'ios'): string {
  const s = step as Record<string, unknown>;
  if ('android' in s || 'ios' in s) {
    const variant = s[platform] as Step | undefined;
    return variant === undefined ? `${platform} variant (none declared)` : stepSummary(variant, platform);
  }
  const kind = Object.keys(s)[0] ?? 'step';
  const payload = s[kind];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return kind;
  const p = payload as Record<string, unknown>;
  // The selector half is rendered by the one owner of that vocabulary
  // (describeElementSpec) and selected by the one owner of the field list
  // (selectorOnly) — `value`, `clear`, `timeout` never reach the line, so a
  // `fill`'s credential cannot either. `type`/`type_pin` carry no selector and
  // print the bare kind.
  const specSource = kind === 'wait' || kind === 'scroll_until' ? p.element : kind === 'tap' || kind === 'fill' ? p : undefined;
  if (specSource !== null && typeof specSource === 'object') {
    const described = describeSpec(selectorOnly(specSource as Record<string, unknown>));
    if (described !== '') return `${kind} ${described}`;
  }
  if (kind === 'wait' && typeof p.state === 'string') return `wait state:${JSON.stringify(p.state)}`;
  if (kind === 'swipe' && typeof p.direction === 'string') return `swipe ${p.direction}`;
  return kind;
}

/**
 * What idb's flat tree can never show, said once, for the wait timeout to
 * quote: an identifier set on a CONTAINER. idb returns accessibility
 * elements only, so a SwiftUI `.accessibilityElement(children: .contain)`
 * with an identifier, or a React Native `testID` on a non-interactive host
 * view, is in no read at all — a wait on it is not late, it is hopeless
 * (measured 2026-10-05, docs/bugs/2026-10-06-wait-timeout-no-hint-for-ids-
 * idb-cannot-see.md: 30 s of timeout, indistinguishable from a slow screen).
 * Worded as a possible cause: the caller only knows the id was in no tree it
 * read. Lives here, not with the tree source: "wait on a button/row id" is
 * flow-step advice.
 */
export const idbContainerIdHint = (id: string): string =>
  `no tree read contained id:${JSON.stringify(id)}. iOS treeSource: idb never exposes an identifier set on a container — ` +
  'SwiftUI .accessibilityElement(children: .contain), React Native testID on a non-interactive view. ' +
  'If the screen is showing, set app.ios.treeSource: wda in averi.yaml, or wait on a button/row id idb does show';

/**
 * The probable cause a `wait:` timeout may name, or nothing. Fires only when
 * every part holds: the device is iOS, its tree source is idb, and the step
 * waited for an element to be present by its ID ALONE. Only then is the
 * timeout a statement about the id: findBySpec ANDs every selector field
 * (ui-tree/selectors.ts conditionsOf), so `{ id, text }` can time out with
 * the id in every read and the text the one that never matched — and the
 * id-only presence check (`matches`: found.length > 0) is what makes "no
 * tree read contained this id" a fact rather than a guess. Under idb that
 * is what an identifier on a container looks like (idbContainerIdHint).
 * Everything else stays silent: `absent` waits are about something that
 * stayed, text/label selectors are not what idb drops, and a state/any/all
 * condition is not one id's story. Pure — the engine supplies the adapter's
 * platform and kind (waitHint).
 */
export function waitTimeoutHint(
  cond: Condition,
  platform: Platform,
  treeSource: IosTreeSourceKind | undefined,
): string | undefined {
  if (platform !== 'ios' || treeSource !== 'idb') return undefined;
  if (cond.element === undefined || cond.absent) return undefined;
  const spec = cond.element;
  const fields = SELECTOR_FIELDS.filter((f) => spec[f] !== undefined);
  if (fields.length !== 1 || fields[0] !== 'id' || spec.id === undefined) return undefined;
  return idbContainerIdHint(spec.id);
}

function describeCondition(cond: Condition): string {
  if (cond.element) return `element ${describeSpec(cond.element)}`;
  if (cond.state) return `state ${cond.state}`;
  if (cond.any) return `any(${cond.any.map(describeCondition).join(', ')})`;
  if (cond.all) return `all(${cond.all.map(describeCondition).join(', ')})`;
  return '(empty)';
}

/**
 * A tap step's `timeout:` is step configuration, not selector vocabulary —
 * strip it before the spec reaches findBySpec/describeSpec (it would match
 * nothing and leak into traces). Returns the pure ElementSpec plus the parsed
 * override, if any.
 */
function splitTapSpec(tap: TapSpec): { spec: ElementSpec; timeoutMs: number | undefined } {
  const { timeout, ...spec } = tap;
  return { spec, timeoutMs: timeout !== undefined ? parseDuration(timeout) : undefined };
}

import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { describeElementSpec as describeSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { readTreeOrError } from '../ui-tree/read-tree.js';
import { findBySpec, intersectsViewport, preferInteractive, tapPoint } from '../ui-tree/selectors.js';
import { parseDuration } from '../util/duration.js';
import { sleep } from '../util/sleep.js';
import { Verifier } from '../verify/assert.js';
import {
  resolveCredentials,
  SetupError,
  type AveriConfig,
  type Condition,
  type ScrollUntilSpec,
  type Step,
  type TapSpec,
} from './config.js';

export { findBySpec } from '../ui-tree/selectors.js';

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
 * The payload of one step kind, read off the Step union itself so a handler's
 * parameter type can never drift from the schema it is fed by.
 */
type StepPayload<K extends string> = Extract<Step, Record<K, unknown>>[K];

/**
 * How many `launch { clearState: true }` steps this server process has run.
 * Module-scoped so it spans the tool calls of one session (each call builds a
 * fresh FlowEngine); `resetClearStateCount` exists for tests, which must not
 * inherit each other's count.
 */
let clearStateCount = 0;

export const resetClearStateCount = (): void => {
  clearStateCount = 0;
};

export interface EngineOptions {
  /** Poll interval for waits; tests use a few ms. */
  pollMs?: number;
  tapTimeoutMs?: number;
  waitTimeoutMs?: number;
  ensureTimeoutMs?: number;
  optionalTimeoutMs?: number;
  /** Grace window for the detect re-check between two reach flows (see `detects`). */
  reachRecheckMs?: number;
  /** Default timeout for inline `assert:` steps (each spec can override). */
  assertTimeoutMs?: number;
  /** Pause between type_pin keystrokes (auto-advancing inputs drop bulk text). */
  pinKeyDelayMs?: number;
  /**
   * Credential environment from `environments:` (see `resolveCredentials`).
   * Omit to fall back to `AVERI_ENV` then `defaultEnvironment:`.
   */
  environment?: string;
}

/**
 * Interprets averi.yaml flows against a DeviceAdapter. Every action polls for
 * its precondition (waits, not sleeps). Credential values are resolved lazily
 * from env and redacted from traces and errors — the caller never sees them.
 */
export class FlowEngine {
  private trace: TraceEntry[] = [];
  private secrets = new Set<string>();
  private readonly pollMs: number;
  private readonly tapTimeoutMs: number;
  private readonly waitTimeoutMs: number;
  private readonly ensureTimeoutMs: number;
  private readonly optionalTimeoutMs: number;
  private readonly reachRecheckMs: number;
  private readonly assertTimeoutMs: number | undefined;
  private readonly pinKeyDelayMs: number;
  private readonly credentials: Record<string, string>;
  private readonly environment: string | undefined;

  constructor(
    private readonly cfg: AveriConfig,
    private readonly adapter: DeviceAdapter,
    opts: EngineOptions = {},
  ) {
    // Resolved once per engine so a run cannot type one environment's username
    // and another's password, and so an unknown name fails before touching the
    // device rather than mid-login.
    const resolved = resolveCredentials(cfg, opts.environment);
    this.credentials = resolved.credentials;
    this.environment = resolved.environment;
    this.pollMs = opts.pollMs ?? 500;
    this.tapTimeoutMs = opts.tapTimeoutMs ?? 5_000;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? 10_000;
    this.ensureTimeoutMs = opts.ensureTimeoutMs ?? 20_000;
    this.optionalTimeoutMs = opts.optionalTimeoutMs ?? 1_500;
    this.reachRecheckMs = opts.reachRecheckMs ?? 2_000;
    this.assertTimeoutMs = opts.assertTimeoutMs;
    this.pinKeyDelayMs = opts.pinKeyDelayMs ?? 300;
  }

  /** Detect → run reach flows → confirm. Idempotent. */
  async ensureState(name: string): Promise<TraceEntry[]> {
    this.trace = [];
    this.logEnvironment();
    await this.guard(() => this.ensureStateInner(name));
    return this.trace;
  }

  async runFlow(name: string): Promise<TraceEntry[]> {
    this.trace = [];
    this.logEnvironment();
    await this.guard(() => this.runFlowInner(name));
    return this.trace;
  }

  /**
   * First line of every run, when an environment is active. Values stay
   * redacted, but the NAMES are the whole point: a wrong login name is rejected
   * one screen after it is typed, so without this the caller sees a credentials
   * error and has no way to tell it was really the wrong backend.
   */
  private logEnvironment(): void {
    if (this.environment === undefined) return;
    const overrides = Object.keys(this.cfg.environments?.[this.environment]?.credentials ?? {});
    this.log(`environment ${this.environment}`, overrides.length > 0 ? `overrides: ${overrides.join(', ')}` : undefined);
  }

  private async ensureStateInner(name: string): Promise<void> {
    const state = this.cfg.states[name];
    if (!state) throw new SetupError(`Unknown state "${name}" — known: ${Object.keys(this.cfg.states).join(', ')}`);
    if (await this.detects(state.detect, 0)) {
      this.log(`state ${name}`, 'already active');
      return;
    }
    if (!state.reach || state.reach.length === 0) {
      throw new SetupError(`Not in state "${name}" and it has no reach flows`);
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
      try {
        await this.runFlowInner(flow);
      } catch (e) {
        // A setup mistake is not something the next rung can fix — and the
        // next rung is the destructive one. Measured: a prelude naming an
        // undeclared credential escalated into a `clearState: true` login,
        // wiping app state to re-run a step that could never have worked.
        if (last || e instanceof SetupError) throw e;
        failed = true;
        const why = (e instanceof Error ? e.message : String(e)).split('\n')[0];
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
      if (await this.detects(state.detect, grace)) {
        this.log(`state ${name}`, `reached after ${flow}`);
        return;
      }
    }
    await this.waitFor({ state: name }, this.ensureTimeoutMs, `state ${name} after reach flows`);
    this.log(`state ${name}`, 'reached');
  }

  /**
   * Is `detect` satisfied, within a grace window? `graceMs: 0` is a single
   * probe — the entry check, which must be cheap, and the check after the last
   * reach flow, which has the ensureState wait right behind it. A rung with
   * another rung after it polls for a moment instead: a flow that just tapped
   * its way home may need one to land, and a false miss THERE is not merely
   * slow, it escalates to the next, possibly destructive, flow.
   *
   * An unreadable tree is not "in this state", and must not throw either:
   * right after a cold launch/reinstall (no window yet) is exactly when the
   * reach flows are needed.
   */
  private async detects(cond: Condition, graceMs: number): Promise<boolean> {
    const deadline = Date.now() + graceMs;
    for (;;) {
      const tree = await this.adapter.uiTree().catch(() => undefined);
      if (tree !== undefined && (await this.matches(cond, tree))) return true;
      if (Date.now() >= deadline) return false;
      await sleep(this.pollMs);
    }
  }

  private async runFlowInner(name: string): Promise<void> {
    const flow = this.cfg.flows[name];
    if (!flow) throw new SetupError(`Unknown flow "${name}" — known: ${Object.keys(this.cfg.flows).join(', ')}`);
    if (flow.requires) await this.ensureStateInner(flow.requires);
    this.log(`flow ${name}`, 'start');
    for (const step of flow.steps) await this.runStep(step);
    this.log(`flow ${name}`, 'done');
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
  private async runStep(step: Step): Promise<void> {
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
    if (override) await this.runStep(override);
    else this.log('skip', `no ${this.adapter.platform} variant for platform-specific step`);
  }

  private async runLaunch(spec: StepPayload<'launch'>): Promise<void> {
    const app = this.cfg.app[this.adapter.platform];
    if (!app) throw new SetupError(`averi.yaml has no app.${this.adapter.platform} section`);
    const appId = 'package' in app ? app.package : app.bundleId;
    // Step-level activity wins over app.android.activity; neither applies on
    // iOS unless the step names one — the adapter then rejects it loudly.
    const activity =
      spec.activity ??
      (this.adapter.platform === 'android' ? this.cfg.app.android?.activity : undefined);
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
    // whatever a re-registration afterwards may suggest. The running count is
    // process-wide on purpose: the MCP server process IS the session, and
    // "3rd this session" is what makes a finite resource budgetable.
    if (spec.clearState) {
      clearStateCount++;
      this.log(
        '⚠ clearState',
        'app state wiped (data container deleted) — anything the app persisted, ' +
          `a device registration included, is gone (${clearStateCount} this session)`,
      );
    }
  }

  private async runType(spec: StepPayload<'type'>): Promise<void> {
    const { value, secret } = this.resolveValue(spec.value);
    await this.adapter.typeText(value);
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
    const { from, to } = swipeVector(boundingBox(await this.adapter.uiTree()), spec.direction, 'finger');
    const times = spec.times ?? 1;
    for (let i = 0; i < times; i++) await this.adapter.swipe(from, to);
    this.log('swipe', `${spec.direction}${times > 1 ? ` ×${times}` : ''}`);
  }

  private async runScrollUntil(spec: ScrollUntilSpec): Promise<void> {
    const { element, ...rest } = spec;
    const swipes = await scrollUntilVisible(
      this.adapter,
      { find: (tree) => findBySpec(tree, element), describe: describeSpec(element) },
      rest,
      { settleMs: this.pollMs },
    );
    this.log(
      'scroll_until',
      `${describeSpec(element)} visible after ${swipes} swipe${swipes === 1 ? '' : 's'}`,
    );
  }

  private async runFill(fill: StepPayload<'fill'>): Promise<void> {
    const { value: rawValue, clear, dismissKeyboard, ...spec } = fill;
    const { value, secret } = this.resolveValue(rawValue);
    const node = await this.settledNode(spec, this.tapTimeoutMs);
    const refetch = async () => {
      const candidates = findBySpec(await this.adapter.uiTree(), spec).filter(
        (n) => n.rect.width > 0 && n.rect.height > 0,
      );
      return candidates.length > 1 ? (preferInteractive(candidates)?.node ?? candidates[0]) : candidates[0];
    };
    await fillField(this.adapter, node, value, { clear, refetch, pollMs: this.pollMs });
    if (dismissKeyboard) await this.adapter.pressKey(this.adapter.platform === 'android' ? 'back' : 'enter');
    this.log('fill', `${describeSpec(spec)} = ${secret ? '***' : value}${clear ? ' (cleared)' : ''}`);
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
    await this.waitFor(cond, timeoutMs, describeCondition(cond));
    this.log('wait', describeCondition(cond));
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
    for (const s of steps) {
      // Split OUTSIDE the try: a malformed `timeout:` is a config error, not
      // an absent element — it must fail the flow, never log as "skipped".
      const tap = 'tap' in s ? splitTapSpec(s.tap) : undefined;
      try {
        if (tap) {
          await this.pollUntil(
            async (tree) =>
              findBySpec(tree, tap.spec).some((n) => n.rect.width > 0 && n.rect.height > 0) ||
              undefined,
            tap.timeoutMs ?? this.optionalTimeoutMs,
            `optional element ${describeSpec(tap.spec)}`,
          );
          await this.tapSpec(tap.spec, this.tapTimeoutMs);
        } else {
          await this.runStep(s);
        }
      } catch {
        this.log('optional', `skipped ${tap ? describeSpec(tap.spec) : 'step'} (not present)`);
      }
    }
  }

  /**
   * Wait for the element to appear AND settle (identical rect in two
   * consecutive polls — screens animate on launch/transition and tapping
   * mid-animation lands on whatever moved into that spot), then tap its
   * center. Zero-area nodes are never tap targets.
   */
  private async tapSpec(spec: ElementSpec, timeoutMs: number, quiet = false): Promise<void> {
    const node = await this.settledNode(spec, timeoutMs);
    const point = tapPoint(node);
    await this.adapter.tap(point.x, point.y);
    if (!quiet) this.log('tap', describeSpec(spec));
  }

  /**
   * Poll until the spec resolves to a visible node whose rect is identical in
   * two consecutive polls (tapping mid-animation lands on whatever moved into
   * that spot). Among several candidates a sole interactive one wins — on iOS
   * a field's title/error labels share the field's identifier.
   */
  private async settledNode(spec: ElementSpec, timeoutMs: number): Promise<UiNode> {
    let lastRect: string | undefined;
    return this.pollUntil(
      async (tree) => {
        const candidates = findBySpec(tree, spec).filter(
          (n) => n.rect.width > 0 && n.rect.height > 0,
        );
        const candidate =
          candidates.length > 1
            ? (preferInteractive(candidates)?.node ?? candidates[0])
            : candidates[0];
        if (!candidate) {
          lastRect = undefined;
          return undefined;
        }
        const rect = JSON.stringify(candidate.rect);
        if (rect === lastRect) return candidate;
        lastRect = rect;
        return undefined;
      },
      timeoutMs,
      `element ${describeSpec(spec)} (visible and settled)`,
    );
  }

  private viewportPromise: Promise<{ width: number; height: number }> | undefined;

  private viewport(): Promise<{ width: number; height: number }> {
    this.viewportPromise ??= this.adapter.viewport();
    return this.viewportPromise;
  }

  private async matches(cond: Condition, tree: UiNode): Promise<boolean> {
    if (cond.element) {
      const found = findBySpec(tree, cond.element);
      if (!cond.absent) return found.length > 0;
      // absent: gone from the tree OR nothing visibly on screen (iOS keeps
      // off-viewport nodes in its tree; Android prunes them — one meaning).
      const viewport = await this.viewport();
      return !found.some((n) => intersectsViewport(n.rect, viewport));
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

  private async waitFor(cond: Condition, timeoutMs: number, what: string): Promise<void> {
    await this.pollUntil(
      async (tree) => ((await this.matches(cond, tree)) ? true : undefined),
      timeoutMs,
      what,
    );
  }

  /**
   * Poll the UI tree until fn returns a value; throws on timeout. A failed
   * tree READ is a poll miss, not a failure (readTreeOrError owns that rule);
   * the last read error rides along in the timeout message so a genuinely
   * broken device stays diagnosable. Errors from `fn` itself (unknown state
   * names etc.) still propagate immediately.
   */
  private async pollUntil<T>(
    fn: (tree: UiNode) => Promise<T | undefined>,
    timeoutMs: number,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastReadError: Error | undefined;
    for (;;) {
      const { tree, error } = await readTreeOrError(this.adapter);
      lastReadError = error;
      if (tree !== undefined) {
        const result = await fn(tree);
        if (result !== undefined) return result;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for ${what}` +
            (lastReadError === undefined ? '' : `\n  (last UI tree read failed: ${lastReadError.message})`),
        );
      }
      await sleep(this.pollMs);
    }
  }

  /**
   * `$name` → credentials[name] → `${ENV_VAR}` expansion. Credential values
   * are registered for redaction. Plain strings pass through.
   */
  private resolveValue(raw: string): { value: string; secret: boolean } {
    if (raw.startsWith('$') && !raw.startsWith('${')) {
      const key = raw.slice(1);
      const template = this.credentials[key];
      if (template === undefined) {
        const where =
          this.environment === undefined ?
            'declare it under credentials:'
          : `declare it under credentials: or environments.${this.environment}.credentials`;
        throw new SetupError(`Unknown credential "$${key}" — ${where}`);
      }
      const value = this.expandEnv(template, key);
      this.secrets.add(value);
      return { value, secret: true };
    }
    if (raw.includes('${')) {
      const value = this.expandEnv(raw);
      this.secrets.add(value);
      return { value, secret: true };
    }
    return { value: raw, secret: false };
  }

  private expandEnv(template: string, credential?: string): string {
    return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      const value = process.env[name];
      if (value === undefined) {
        const forWhom =
          credential ?
            ` (needed for credential "${credential}"` +
            `${this.environment === undefined ? '' : ` in environment "${this.environment}"`})`
          : '';
        throw new SetupError(
          `Environment variable ${name} is not set${forWhom} — set it in .env.averi beside averi.yaml, or export it, and retry`,
        );
      }
      return value;
    });
  }

  private log(action: string, detail?: string): void {
    this.trace.push({ action, detail: detail === undefined ? undefined : this.redact(detail) });
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
      const message = this.redact(e instanceof Error ? e.message : String(e));
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
 * Swipe until the element is present AND visibly inside the viewport
 * (ARCHITECTURE.md §4, C1). `direction` is where the content lies relative to
 * the current view (down = below the fold → finger swipes up). Returns the
 * number of swipes performed; throws with a diagnosis of the last tree.
 */
export async function scrollUntilVisible(
  adapter: DeviceAdapter,
  target: { find: (tree: UiNode) => UiNode[]; describe: string },
  spec: Omit<ScrollUntilSpec, 'element'>,
  opts: { settleMs?: number } = {},
): Promise<number> {
  const direction = spec.direction ?? 'down';
  const maxSwipes = spec.maxSwipes ?? 6;
  const timeoutMs = spec.timeout !== undefined ? parseDuration(spec.timeout) : 15_000;
  const settleMs = opts.settleMs ?? 400;
  const viewport = await adapter.viewport();
  // `direction` here names where the CONTENT lies — the finger moves the other
  // way (content below → finger up). See swipeVector.
  const { from, to } = swipeVector(
    { x: 0, y: 0, width: viewport.width, height: viewport.height },
    direction,
    'content',
  );

  const deadline = Date.now() + timeoutMs;
  let lastFound: UiNode[] = [];
  let lastReadError: Error | undefined;
  for (let swipes = 0; ; swipes++) {
    // A failed read is a miss, not a failure — see readTreeOrError.
    const { tree, error } = await readTreeOrError(adapter);
    lastReadError = error;
    lastFound = tree === undefined ? [] : target.find(tree);
    if (lastFound.some((n) => intersectsViewport(n.rect, viewport))) return swipes;
    if (swipes >= maxSwipes || Date.now() >= deadline) {
      const why =
        lastReadError !== undefined
          ? `last UI tree read failed: ${lastReadError.message}`
          : lastFound.length === 0
            ? 'element never appeared in the tree'
            : `element in tree but never intersected the ${viewport.width}x${viewport.height} viewport ` +
              `(last rect ${JSON.stringify(lastFound[0].rect)})`;
      const cause = swipes >= maxSwipes ? `after ${swipes} swipes (maxSwipes)` : `after ${timeoutMs}ms (timeout)`;
      throw new Error(`scroll_until ${target.describe} failed ${cause} — ${why}`);
    }
    await adapter.swipe(from, to);
    await sleep(settleMs);
  }
}

/**
 * Focus a field (center tap) and type into it. With clear, the current value
 * is deleted first via clearText — typing otherwise APPENDS, the measured
 * Android login trap. A right-edge tap is NOT how clear works: measured
 * 2026-08-05, taps in the field's trailing padding do not focus iOS fields.
 *
 * When `refetch` is given, every phase is VERIFIED against a fresh tree and
 * retried once — synthetic input is droppable end to end (Compose async
 * state, IME queues), so "the call returned" is not "the text landed":
 * - clear: the field must actually be empty; a second pass uses the length
 *   the field still reports.
 * - type with clear: the field must show exactly the value; the retry may
 *   safely wipe and retype (the content is ours).
 * - type without clear: the typed value must appear IN the field (contiguous
 *   insert at the cursor); no destructive retry — clear stays opt-in, so a
 *   mismatch throws instead of corrupting content the field came with.
 * Fields that never expose text (masked/password) verify as best-effort.
 * Errors carry LENGTHS only, never content — values may be credentials.
 */
export async function fillField(
  adapter: DeviceAdapter,
  node: UiNode,
  value: string,
  opts: {
    clear?: boolean;
    refetch?: () => Promise<UiNode | undefined>;
    pollMs?: number;
  } = {},
): Promise<void> {
  const { clear, refetch } = opts;
  const pollMs = opts.pollMs ?? 400;
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  await sleep(350); // focus + keyboard

  let current: UiNode | undefined = node;
  if (clear) {
    for (let attempt = 0; ; attempt++) {
      const existing = current?.value?.length ?? 0;
      if (existing === 0) break;
      await adapter.clearText(existing);
      if (!refetch) break;
      current = await refetch();
      const left = current?.value?.length ?? 0;
      if (left === 0) break;
      if (attempt >= 1) {
        throw new Error(`fill: field still shows ${left} characters after clearing twice`);
      }
    }
  }

  await adapter.typeText(value);
  if (!refetch || value === '') return;

  const landed = (observed: string) => (clear ? observed === value : observed.includes(value));
  let observed = await pollValue(refetch, landed, pollMs);
  if (observed === undefined || landed(observed)) return; // undefined: field withholds its text
  if (clear) {
    await adapter.clearText(observed.length);
    await adapter.typeText(value);
    observed = await pollValue(refetch, landed, pollMs);
    if (observed === undefined || landed(observed)) return;
  }
  throw new Error(
    `fill: typed ${value.length} characters but the field shows ${observed.length} (content withheld from this error)`,
  );
}

/** Poll the field until its exposed value satisfies `ok`; returns the last observation. */
async function pollValue(
  refetch: () => Promise<UiNode | undefined>,
  ok: (observed: string) => boolean,
  pollMs: number,
): Promise<string | undefined> {
  let observed: string | undefined;
  for (let i = 0; i < 5; i++) {
    observed = (await refetch())?.value ?? undefined;
    if (observed !== undefined && ok(observed)) return observed;
    if (observed === undefined && i >= 1) return undefined; // field exposes no text — stop waiting
    await sleep(pollMs);
  }
  return observed;
}


/**
 * The from/to points of a swipe across `box`, 30% of the box either side of
 * centre.
 *
 * `mean` is why this exists once instead of twice: the two callers use the
 * same four words for OPPOSITE gestures. A `swipe:` step names the FINGER's
 * movement (swipe up = finger travels up, revealing content below). A
 * `scroll_until:` names where the CONTENT lies (content below the fold is
 * reached by a finger travelling up). As two separate tables they read as
 * copies of each other, and the next person to correct one would have broken
 * the other.
 */
export function swipeVector(
  box: { x: number; y: number; width: number; height: number },
  direction: 'up' | 'down' | 'left' | 'right',
  mean: 'finger' | 'content',
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const dx = Math.round(box.width * 0.3);
  const dy = Math.round(box.height * 0.3);
  const finger = {
    up: { from: { x: cx, y: cy + dy }, to: { x: cx, y: cy - dy } },
    down: { from: { x: cx, y: cy - dy }, to: { x: cx, y: cy + dy } },
    left: { from: { x: cx + dx, y: cy }, to: { x: cx - dx, y: cy } },
    right: { from: { x: cx - dx, y: cy }, to: { x: cx + dx, y: cy } },
  } as const;
  const awayFrom = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
  return mean === 'finger' ? finger[direction] : finger[awayFrom[direction]];
}

/** Screen area to swipe over: the root rect, or the union of children (iOS synthetic root is 0×0). */
function boundingBox(root: UiNode): UiNode['rect'] {
  if (root.rect.width > 0 && root.rect.height > 0) return root.rect;
  let maxX = 0;
  let maxY = 0;
  for (const c of root.children) {
    maxX = Math.max(maxX, c.rect.x + c.rect.width);
    maxY = Math.max(maxY, c.rect.y + c.rect.height);
  }
  return { x: 0, y: 0, width: maxX, height: maxY };
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

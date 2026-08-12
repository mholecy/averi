import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { findBySpec, intersectsViewport, preferInteractive, tapPoint } from '../ui-tree/selectors.js';
import { Verifier } from '../verify/assert.js';
import {
  parseDuration,
  resolveCredentials,
  type AveriConfig,
  type Condition,
  type ElementSpec,
  type ScrollUntilSpec,
  type Step,
} from './config.js';

export { findBySpec } from '../ui-tree/selectors.js';

export interface TraceEntry {
  action: string;
  detail?: string;
}

export interface EngineOptions {
  /** Poll interval for waits; tests use a few ms. */
  pollMs?: number;
  tapTimeoutMs?: number;
  waitTimeoutMs?: number;
  ensureTimeoutMs?: number;
  optionalTimeoutMs?: number;
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
    if (!state) throw new Error(`Unknown state "${name}" — known: ${Object.keys(this.cfg.states).join(', ')}`);
    if (await this.matches(state.detect, await this.adapter.uiTree())) {
      this.log(`state ${name}`, 'already active');
      return;
    }
    if (!state.reach || state.reach.length === 0) {
      throw new Error(`Not in state "${name}" and it has no reach flows`);
    }
    for (const flow of state.reach) await this.runFlowInner(flow);
    await this.waitFor({ state: name }, this.ensureTimeoutMs, `state ${name} after reach flows`);
    this.log(`state ${name}`, 'reached');
  }

  private async runFlowInner(name: string): Promise<void> {
    const flow = this.cfg.flows[name];
    if (!flow) throw new Error(`Unknown flow "${name}" — known: ${Object.keys(this.cfg.flows).join(', ')}`);
    if (flow.requires) await this.ensureStateInner(flow.requires);
    this.log(`flow ${name}`, 'start');
    for (const step of flow.steps) await this.runStep(step);
    this.log(`flow ${name}`, 'done');
  }

  private async runStep(step: Step): Promise<void> {
    if ('android' in step || 'ios' in step) {
      const override = (step as { android?: Step; ios?: Step })[this.adapter.platform];
      if (override) await this.runStep(override);
      else this.log('skip', `no ${this.adapter.platform} variant for platform-specific step`);
      return;
    }
    if ('launch' in step) {
      const app = this.cfg.app[this.adapter.platform];
      if (!app) throw new Error(`averi.yaml has no app.${this.adapter.platform} section`);
      const appId = 'package' in app ? app.package : app.bundleId;
      // Step-level activity wins over app.android.activity; neither applies on
      // iOS unless the step names one — the adapter then rejects it loudly.
      const activity =
        step.launch.activity ??
        (this.adapter.platform === 'android' ? this.cfg.app.android?.activity : undefined);
      await this.adapter.launch(appId, {
        clearState: step.launch.clearState,
        activity,
        intent: step.launch.intent,
      });
      this.log(
        'launch',
        appId +
          (activity === undefined ? '' : `/${activity.split('/').pop()}`) +
          (step.launch.clearState ? ' (state cleared)' : ''),
      );
      return;
    }
    if ('tap' in step) {
      await this.tapSpec(step.tap, this.tapTimeoutMs);
      return;
    }
    if ('type' in step) {
      const { value, secret } = this.resolveValue(step.type.value);
      await this.adapter.typeText(value);
      this.log('type', secret ? '***' : value);
      return;
    }
    if ('type_pin' in step) {
      const { value: raw } = this.resolveValue(step.type_pin.value);
      // PIN/OTP inputs are numeric; formatting in the credential ("111-111-111")
      // is display convention, not keystrokes.
      const pin = raw.replace(/\D/g, '');
      const rounds = step.type_pin.twice ? 2 : 1;
      for (let round = 0; round < rounds; round++) {
        if (step.type_pin.keypad) {
          const { id_pattern, text_pattern } = step.type_pin.keypad;
          for (const digit of pin) {
            const spec: ElementSpec = id_pattern
              ? { id: id_pattern.replace('{digit}', digit) }
              : { text: text_pattern!.replace('{digit}', digit) };
            await this.tapSpec(spec, this.tapTimeoutMs, true);
          }
        } else {
          // One keystroke at a time: auto-advancing multi-box inputs (OTP
          // fields) move focus per digit and silently drop bulk-typed text.
          for (const digit of pin) {
            await this.adapter.typeText(digit);
            await new Promise((r) => setTimeout(r, this.pinKeyDelayMs));
          }
        }
      }
      this.log('type_pin', `${pin.length} digits${rounds === 2 ? ', twice' : ''}`);
      return;
    }
    if ('swipe' in step) {
      // Gesture direction (finger movement): swipe down at the top of a list
      // rubber-bands harmlessly; swipe up reveals content further down.
      const box = boundingBox(await this.adapter.uiTree());
      const cx = Math.round(box.x + box.width / 2);
      const cy = Math.round(box.y + box.height / 2);
      const dx = Math.round(box.width * 0.3);
      const dy = Math.round(box.height * 0.3);
      const vectors = {
        up: { from: { x: cx, y: cy + dy }, to: { x: cx, y: cy - dy } },
        down: { from: { x: cx, y: cy - dy }, to: { x: cx, y: cy + dy } },
        left: { from: { x: cx + dx, y: cy }, to: { x: cx - dx, y: cy } },
        right: { from: { x: cx - dx, y: cy }, to: { x: cx + dx, y: cy } },
      };
      const { from, to } = vectors[step.swipe.direction];
      const times = step.swipe.times ?? 1;
      for (let i = 0; i < times; i++) await this.adapter.swipe(from, to);
      this.log('swipe', `${step.swipe.direction}${times > 1 ? ` ×${times}` : ''}`);
      return;
    }
    if ('scroll_until' in step) {
      const { element, ...spec } = step.scroll_until;
      const swipes = await scrollUntilVisible(
        this.adapter,
        { find: (tree) => findBySpec(tree, element), describe: describeSpec(element) },
        spec,
        { settleMs: this.pollMs },
      );
      this.log(
        'scroll_until',
        `${describeSpec(step.scroll_until.element)} visible after ${swipes} swipe${swipes === 1 ? '' : 's'}`,
      );
      return;
    }
    if ('fill' in step) {
      const { value: rawValue, clear, dismissKeyboard, ...spec } = step.fill;
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
      return;
    }
    if ('assert' in step) {
      const verifier = new Verifier(this.adapter, { pollMs: this.pollMs, timeoutMs: this.assertTimeoutMs });
      const results = await verifier.assertAll(step.assert);
      for (const r of results) this.log(r.pass ? 'assert PASS' : 'assert FAIL', r.description + (r.detail ? ` — ${r.detail}` : ''));
      const failed = results.filter((r) => !r.pass);
      if (failed.length > 0) {
        throw new Error(
          `${failed.length}/${results.length} flow asserts failed:\n` +
            failed.map((r) => `  FAIL ${r.description}${r.detail ? ` — ${r.detail}` : ''}`).join('\n'),
        );
      }
      return;
    }
    if ('wait' in step) {
      const timeoutMs = step.wait.timeout !== undefined ? parseDuration(step.wait.timeout) : this.waitTimeoutMs;
      const cond: Condition = step.wait.element ? { element: step.wait.element } : { state: step.wait.state };
      await this.waitFor(cond, timeoutMs, describeCondition(cond));
      this.log('wait', describeCondition(cond));
      return;
    }
    if ('branch' in step) {
      const arm = await this.pollUntil(
        async (tree) => {
          for (const [i, a] of step.branch.entries()) {
            if (await this.matches(a.when, tree)) return { i, a };
          }
          return undefined;
        },
        this.waitTimeoutMs,
        `any branch condition (${step.branch.map((a) => describeCondition(a.when)).join(' | ')})`,
      );
      this.log('branch', `matched ${describeCondition(arm.a.when)}`);
      for (const s of arm.a.do) await this.runStep(s);
      return;
    }
    if ('optional' in step) {
      for (const s of step.optional) {
        try {
          if ('tap' in s) await this.tapSpec(s.tap, this.optionalTimeoutMs);
          else await this.runStep(s);
        } catch {
          this.log('optional', `skipped ${'tap' in s ? describeSpec(s.tap) : 'step'} (not present)`);
        }
      }
      return;
    }
    throw new Error(`Unhandled step: ${JSON.stringify(step)}`);
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
      if (!state) throw new Error(`Unknown state "${cond.state}"`);
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

  /** Poll the UI tree until fn returns a value; throws on timeout. */
  private async pollUntil<T>(
    fn: (tree: UiNode) => Promise<T | undefined>,
    timeoutMs: number,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await fn(await this.adapter.uiTree());
      if (result !== undefined) return result;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
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
        throw new Error(`Unknown credential "$${key}" — ${where}`);
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
        throw new Error(
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

  /** All errors leave the engine redacted. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw new Error(this.redact(e instanceof Error ? e.message : String(e)));
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

  const cx = Math.round(viewport.width / 2);
  const cy = Math.round(viewport.height / 2);
  const dx = Math.round(viewport.width * 0.3);
  const dy = Math.round(viewport.height * 0.3);
  // Finger moves opposite to where the content lies: content below → finger up.
  const vectors = {
    down: { from: { x: cx, y: cy + dy }, to: { x: cx, y: cy - dy } },
    up: { from: { x: cx, y: cy - dy }, to: { x: cx, y: cy + dy } },
    right: { from: { x: cx + dx, y: cy }, to: { x: cx - dx, y: cy } },
    left: { from: { x: cx - dx, y: cy }, to: { x: cx + dx, y: cy } },
  } as const;

  const deadline = Date.now() + timeoutMs;
  let lastFound: UiNode[] = [];
  for (let swipes = 0; ; swipes++) {
    lastFound = target.find(await adapter.uiTree());
    if (lastFound.some((n) => intersectsViewport(n.rect, viewport))) return swipes;
    if (swipes >= maxSwipes || Date.now() >= deadline) {
      const why =
        lastFound.length === 0
          ? 'element never appeared in the tree'
          : `element in tree but never intersected the ${viewport.width}x${viewport.height} viewport ` +
            `(last rect ${JSON.stringify(lastFound[0].rect)})`;
      const cause = swipes >= maxSwipes ? `after ${swipes} swipes (maxSwipes)` : `after ${timeoutMs}ms (timeout)`;
      throw new Error(`scroll_until ${target.describe} failed ${cause} — ${why}`);
    }
    const { from, to } = vectors[direction];
    await adapter.swipe(from, to);
    await new Promise((r) => setTimeout(r, settleMs));
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function describeSpec(spec: ElementSpec): string {
  return Object.entries(spec)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join(' ');
}

function describeCondition(cond: Condition): string {
  if (cond.element) return `element ${describeSpec(cond.element)}`;
  if (cond.state) return `state ${cond.state}`;
  if (cond.any) return `any(${cond.any.map(describeCondition).join(', ')})`;
  if (cond.all) return `all(${cond.all.map(describeCondition).join(', ')})`;
  return '(empty)';
}

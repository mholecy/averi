import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { parseDuration, type AveriConfig, type Condition, type ElementSpec, type Step } from './config.js';

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

  constructor(
    private readonly cfg: AveriConfig,
    private readonly adapter: DeviceAdapter,
    opts: EngineOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.tapTimeoutMs = opts.tapTimeoutMs ?? 5_000;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? 10_000;
    this.ensureTimeoutMs = opts.ensureTimeoutMs ?? 20_000;
    this.optionalTimeoutMs = opts.optionalTimeoutMs ?? 1_500;
  }

  /** Detect → run reach flows → confirm. Idempotent. */
  async ensureState(name: string): Promise<TraceEntry[]> {
    this.trace = [];
    await this.guard(() => this.ensureStateInner(name));
    return this.trace;
  }

  async runFlow(name: string): Promise<TraceEntry[]> {
    this.trace = [];
    await this.guard(() => this.runFlowInner(name));
    return this.trace;
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
      await this.adapter.launch(appId, { clearState: step.launch.clearState });
      this.log('launch', appId + (step.launch.clearState ? ' (state cleared)' : ''));
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
      const { value: pin } = this.resolveValue(step.type_pin.value);
      const rounds = step.type_pin.twice ? 2 : 1;
      for (let round = 0; round < rounds; round++) {
        if (step.type_pin.keypad) {
          for (const digit of pin) {
            await this.tapSpec(
              { id: step.type_pin.keypad.id_pattern.replace('{digit}', digit) },
              this.tapTimeoutMs,
              true,
            );
          }
        } else {
          await this.adapter.typeText(pin);
        }
      }
      this.log('type_pin', `${pin.length} digits${rounds === 2 ? ', twice' : ''}`);
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
    let lastRect: string | undefined;
    const node = await this.pollUntil(
      async (tree) => {
        const candidate = findBySpec(tree, spec).find(
          (n) => n.rect.width > 0 && n.rect.height > 0,
        );
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
    const point = tapPoint(node);
    await this.adapter.tap(point.x, point.y);
    if (!quiet) this.log('tap', describeSpec(spec));
  }

  private async matches(cond: Condition, tree: UiNode): Promise<boolean> {
    if (cond.element) return findBySpec(tree, cond.element).length > 0;
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
      const template = this.cfg.credentials?.[key];
      if (template === undefined) {
        throw new Error(`Unknown credential "$${key}" — declare it under credentials:`);
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
        const forWhom = credential ? ` (needed for credential "${credential}")` : '';
        throw new Error(`Environment variable ${name} is not set${forWhom} — export it and retry`);
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

/** Exact-match element lookup; `text` matches label or value (selector semantics). */
export function findBySpec(root: UiNode, spec: ElementSpec): UiNode[] {
  const found: UiNode[] = [];
  const walk = (n: UiNode) => {
    const ok =
      (spec.id === undefined || n.identifier === spec.id) &&
      (spec.role === undefined || n.role === spec.role) &&
      (spec.label === undefined || n.label === spec.label) &&
      (spec.text === undefined || n.label === spec.text || n.value === spec.text);
    if (ok) found.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return found;
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

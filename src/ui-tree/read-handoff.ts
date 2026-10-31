import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import type { FirstSample, HandedRead } from './read-tree.js';

/**
 * The hand-off of the last tree read to the next poll that may use it
 * (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-positive-verdict.md, performance backlog D3).
 *
 * On Android one `uiautomator dump` costs 2.2–2.5 s, and a flow reads the tree again where nothing has happened since
 * the last read: the ladder's re-detect after a rung that ended in a `wait:` (D0's cold ensure read `yes` at 8.5 s
 * and the re-detect read the same screen again at 10.7 s), an assert after an assert, the first sample of a tap
 * after a `wait:`. This object keeps that last read and gives it to the next poll as its FIRST round — never as
 * anything else. `pollTree` (read-tree.ts) owns what a handed round may decide: only a value ends the poll on it; a
 * miss, an undecided round, a PollMiss detail or a predicate's throw is discarded and the next round reads fresh,
 * without the deadline being checked. So a handed read is a positive verdict or a first sample whose fresh second
 * read must agree (resolveSettled), never a stability proof, never an absence.
 *
 * Deliberately NOT a transparent cache. A cache under `uiTree` would also answer the second read of a settle, and two
 * reads of one snapshot agree by construction: the settle proof would pass on an element still moving. Here the
 * consumer asks for the hand-off by name (`PollOptions.first`, `SettleOptions.first`), once, and every other read is
 * a device read.
 *
 * What makes a read eligible, all three:
 * - It was taken inside `producing` — the steps whose reads are a look at a screen nothing has touched since: a
 *   `wait:`, an assert, the ladder's detect. A read anywhere else (a tap's settle, a fill's read-back, a scroll's
 *   rounds, an `optional:` probe) is not kept, and it drops what was kept: the kept read is the LAST read or nothing.
 * - No action since it STARTED: `watch` wraps the adapter, and every method `ADAPTER_SURFACE` does not call a read
 *   bumps an epoch before and after it runs. A read that started before an action and ended after it carries the
 *   older epoch and is never handed on.
 * - At most `HANDOFF_MAX_AGE_MS` since it ENDED, when taken.
 * And it is handed on once: `take` empties the slot whatever it returns, so a second poll — the keyboard guard's
 * re-look inside the same tap, the next assert — reads fresh.
 *
 * Scope: one per engine run (flow/engine.ts) and one per Verifier — the `verify` tool's leg shares one between its
 * engine run and its asserts (run/verify.ts), the engine's in-flow asserts share the engine's. Never module-level,
 * never across tool calls: the agent acts between two calls, and nothing here would see it.
 */
export class ReadHandOff implements FirstSample {
  private epoch = 0;
  private depth = 0;
  private kept: (HandedRead & { epoch: number }) | undefined;
  /** The proxies this hand-off made, so `watch` of one of them returns it as is. */
  private readonly watched = new WeakSet<object>();

  /**
   * `adapter`, with every read reported to this hand-off and every action invalidating it. A Proxy, so an absent
   * optional member (`focusedWindow`, `keyboard`) stays absent and a fake's later reassignment of a method is seen.
   * Methods are bound to the adapter itself, so an adapter's private state is untouched by the wrapping. A method
   * the surface does not know (a test fake's helper) counts as an action: an unknown call costs a hand-off, never
   * a stale one.
   */
  watch<A extends DeviceAdapter>(adapter: A): A {
    if (this.watched.has(adapter)) return adapter;
    const proxy = new Proxy(adapter, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        const fn = value as (...args: unknown[]) => unknown;
        if (key === 'uiTree') return (...args: unknown[]) => this.read(() => fn.apply(target, args) as Promise<UiNode>);
        if (ADAPTER_SURFACE[key as keyof DeviceAdapter] === 'reads') return fn.bind(target);
        return async (...args: unknown[]) => {
          this.bump();
          try {
            return await fn.apply(target, args);
          } finally {
            this.bump();
          }
        };
      },
    });
    this.watched.add(proxy);
    return proxy;
  }

  /**
   * The pair a consumer holds — a hand-off and the adapter as it watches it — from the caller's hand-off when it
   * shares one, else a new one. The one spelling for the flow engine and the Verifier, so neither can keep the
   * hand-off and forget to watch the adapter it acts through.
   */
  static watching(adapter: DeviceAdapter, shared?: ReadHandOff): { handOff: ReadHandOff; adapter: DeviceAdapter } {
    const handOff = shared ?? new ReadHandOff();
    return { handOff, adapter: handOff.watch(adapter) };
  }

  /** Run `fn` with its successful reads kept for the next `take` (nesting is fine). */
  async producing<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    try {
      return await fn();
    } finally {
      this.depth--;
    }
  }

  /** The kept read, when it is still eligible — and the slot emptied either way: a read is handed on once. */
  take(): HandedRead | undefined {
    const kept = this.kept;
    this.kept = undefined;
    if (kept === undefined || kept.epoch !== this.epoch) return undefined;
    if (Date.now() - kept.endedAt > HANDOFF_MAX_AGE_MS) return undefined;
    return { tree: kept.tree, startedAt: kept.startedAt, endedAt: kept.endedAt };
  }

  private bump(): void {
    this.epoch++;
    this.kept = undefined;
  }

  private async read(fn: () => Promise<UiNode>): Promise<UiNode> {
    const epoch = this.epoch;
    const producing = this.depth > 0;
    const startedAt = Date.now();
    try {
      const tree = await fn();
      // The epoch is the one at the read's START: `take` refuses it if any action began or ended since.
      this.kept = producing ? { tree, startedAt, endedAt: Date.now(), epoch } : undefined;
      return tree;
    } catch (e) {
      this.kept = undefined;
      throw e;
    }
  }
}

/**
 * How long after a read ENDED it may still be handed on: 1 s. The bound is on staleness the hand-off adds over the
 * fresh read it replaces. Within one run the consumer follows its producer within milliseconds (a log line, a step
 * dispatch), so the bound only bites when something slow and silent ran between them; a second is under half an
 * Android dump, the read it saves. A `uiautomator dump` snapshots after its ~1 s idle wait inside a ~2.3 s call, so a
 * handed Android tree shows the screen ≤ ~2.3 s before it is taken; the fresh read would have shown it ~1 s after.
 */
export const HANDOFF_MAX_AGE_MS = 1_000;

/**
 * Every member of DeviceAdapter, classified — an EXHAUSTIVE record, so a member added to the interface fails to
 * compile here until someone says whether it reads or acts:
 * - `tree`: `uiTree`, the read that is kept.
 * - `reads`: asks the device without changing what it shows — a capture, the screen size, the window manager's word,
 *   the keyboard oracle, the process table, the log. The kept read stands across them.
 * - `acts`: may change what the device shows (or tears the adapter down). Each call invalidates the kept read.
 * - `fact`: a constant of the adapter, never called.
 */
export const ADAPTER_SURFACE: Record<keyof DeviceAdapter, 'tree' | 'reads' | 'acts' | 'fact'> = {
  platform: 'fact',
  install: 'acts',
  launch: 'acts',
  terminate: 'acts',
  openDeepLink: 'acts',
  screenshot: 'reads',
  uiTree: 'tree',
  viewport: 'reads',
  tap: 'acts',
  longPress: 'acts',
  swipe: 'acts',
  typeText: 'acts',
  clearText: 'acts',
  pressKey: 'acts',
  keyboard: 'reads',
  keyboardAdvice: 'fact',
  dragSpeed: 'fact',
  treeReadSettles: 'fact',
  typingDelivery: 'fact',
  focusedWindow: 'reads',
  logs: 'reads',
  isAppRunning: 'reads',
  dispose: 'acts',
};

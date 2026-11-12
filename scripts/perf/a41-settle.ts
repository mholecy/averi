import { PersistentReadError, type DeviceAdapter, type UiNode } from '../../src/adapters/types.js';
import { resolveSettled } from '../../src/interact/resolve.js';
import { SLEEP_OWNER } from '../differential/clock.js';
import { censoredAt, classesOf, movedId, wrongSettle, type CadencePass, type Trial } from './a41.js';

/**
 * A settle trace replayed through the production settle (A41b's cadence question, ADR 0040): resolveSettled →
 * settleCadence → pollTree → pauseAfterRead, all unmodified, once per (trial, id), at an explicit `pollMs` — the
 * caller's cadence wins over the adapter's fact (ADR 0040), so no product default is touched. The rule is
 * tests/interact/settle-trace.test.ts's (T5), here as a module so a device trace of another source (WebDriverAgent's,
 * scripts/perf/a41-probe.ts `--mode cadence`) is judged the same way; tests/perf/a41-settle.test.ts holds it to T5's
 * pins on the d35 fixture.
 *
 * Virtual time (ReplayClock): a read asked for at trace time T is the first recorded read starting at or after T; the
 * clock then advances by that read's own length, so pollTree's readMs is the device's. The clock is whole
 * milliseconds, as T5's faked Date is. The settle starts at the trial's first read. When the recorded window ends the
 * fake throws a PersistentReadError, which ends the settle at once: not settled in the window. A settle is wrong when
 * a later read in the window has the id at another rect (a.ts#wrongSettle).
 *
 * The clock is the caller's: a test fakes Date and mocks src/util/sleep.ts (T5's way); the device-free CLI
 * (scripts/perf/a41-report.ts) installs installReplayClock for its process.
 */

export interface ReplayClock {
  now(): number;
  set(ms: number): void;
}

class WindowEnded extends PersistentReadError {}

/** A trace id: a `lab.*` identifier, or `label:<text>` (a row the source lists without one). */
const parseId = (id: string): { kind: 'identifier' | 'label'; text: string } =>
  id.startsWith('label:') ? { kind: 'label', text: id.slice('label:'.length) } : { kind: 'identifier', text: id };

/** The class as a rect: equal JSON iff the device's rects were equal, and every rect has area. */
const leaf = (id: string, cls: number): UiNode => {
  const { kind, text } = parseId(id);
  const rect = { x: cls, y: 0, width: 1, height: 1 };
  return kind === 'label'
    ? { role: 'text', label: text, identifier: null, value: null, rect, children: [] }
    : { role: 'other', label: null, identifier: text, value: null, rect, children: [] };
};

const selectorOf = (id: string): string => {
  const { kind, text } = parseId(id);
  return kind === 'label' ? `text:"${text}"` : `id:${text}`;
};

type SettleAdapter = Pick<DeviceAdapter, 'uiTree' | 'focusedWindow' | 'keyboard' | 'keyboardAdvice' | 'settleCadenceMs'>;

/** The device's reads, served in virtual time. No settle cadence of its own: the replay's `pollMs` decides. */
function tracedAdapter(t: Trial, trees: readonly UiNode[], clock: ReplayClock): SettleAdapter {
  let shift = 0; // trace time − clock
  return {
    uiTree: async () => {
      const at = clock.now() + shift;
      const k = t.reads.findIndex(([start]) => start >= at);
      if (k === -1) throw new WindowEnded('the recorded window ended');
      const [start, end] = t.reads[k];
      shift += start - at;
      clock.set(clock.now() + (end - start));
      return trees[k];
    },
  };
}

/** Every (trial, id) settle of the trace at `pollMs`: the settles per motion and the wrong ones. */
export async function replaySettles(trials: readonly Trial[], o: { pollMs: number }, clock: ReplayClock): Promise<CadencePass> {
  const pass: CadencePass = { pollMs: o.pollMs, settles: Object.fromEntries(trials.map((t) => [t.motion, 0])), wrong: [], moving: 0, censored: 0 };
  for (const t of trials) {
    const classes = classesOf(t);
    const trees = classes.map(
      (c): UiNode => ({
        role: 'container',
        label: null,
        identifier: null,
        value: null,
        rect: { x: 0, y: 0, width: 402, height: 874 },
        children: Object.entries(c).map(([id, cls]) => leaf(id, cls)),
      }),
    );
    const readOf = new Map(trees.map((tree, k) => [tree, k]));
    for (const id of Object.keys(t.rects).sort()) {
      clock.set(t.reads[0][0]);
      try {
        const settled = await resolveSettled(tracedAdapter(t, trees, clock), selectorOf(id), { ambiguous: 'refuse', pollMs: o.pollMs });
        const k = readOf.get(settled.tree);
        if (k === undefined) throw new Error('the settle returned a tree the trace never served');
        pass.settles[t.motion]++;
        if (movedId(classes, id)) pass.moving++;
        if (censoredAt(t.reads, k)) pass.censored++;
        if (wrongSettle(classes, id, k)) pass.wrong.push(`${t.motion}#${t.trial} ${id} @${k}`);
      } catch (e) {
        if (!(e instanceof WindowEnded)) throw e;
      }
    }
  }
  return pass;
}

/**
 * Virtual time for a replay process (scripts/differential/clock.ts's technique): `Date.now` reads a whole-millisecond
 * clock that only `set` and the code's own sleeps move. A timer set from averi's one sleep owner (SLEEP_OWNER, read
 * off the stack) advances the clock by its length and fires on the next turn; every other timer stays real.
 * `uninstall` puts both back.
 */
export function installReplayClock(): ReplayClock & { uninstall(): void } {
  const realSetTimeout = globalThis.setTimeout;
  const realNow = Date.now;
  let clock = 0;
  const fake = function (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) {
    // Frame 0 is the message, 1 this function, 2 the caller.
    const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
    if (!SLEEP_OWNER.test(caller)) return realSetTimeout(fn, ms, ...args);
    clock = Math.trunc(clock + Math.max(0, ms ?? 0));
    return setImmediate(() => fn(...args));
  };
  globalThis.setTimeout = fake as unknown as typeof setTimeout;
  Date.now = () => clock;
  return {
    now: () => clock,
    set: (ms) => void (clock = Math.trunc(ms)),
    uninstall() {
      globalThis.setTimeout = realSetTimeout;
      Date.now = realNow;
    },
  };
}

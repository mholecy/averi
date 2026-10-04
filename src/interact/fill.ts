import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { isMaskedValue } from '../ui-tree/masked-value.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { describeTarget, resolveNow, resolveSettled, type SettleOptions, type Target } from './resolve.js';

/** Measured 2026-08-05: the keyboard needs about this long to come up after the focus tap. */
export const DEFAULT_FOCUS_DELAY_MS = 350;

/**
 * Cadence of the value poll (five rounds) when the caller has none. 400 ms is
 * what the MCP type_text tool has always used; it is NOT the settle poll's
 * DEFAULT_POLL_MS — the two were separate before 2026-10-03 and a review the
 * same day caught them quietly merged. The engine passes its own pollMs for
 * both, as it always did.
 */
export const DEFAULT_VALUE_POLL_MS = 400;

export interface FillOptions extends SettleOptions {
  /** Delete the field's current content before typing — typing otherwise APPENDS. */
  clear?: boolean;
}

export interface FillResult {
  /** How the field was chosen when several nodes matched (see resolveNow). */
  note?: string;
  /** The fill was legal but suspicious — a masked field already held text and `clear` is off. */
  warning?: string;
}

/**
 * Focus a field (center tap, after resolveSettled) and type into it. With
 * clear, the current value is deleted first via clearText — typing otherwise
 * APPENDS, the measured Android login trap. A right-edge tap is NOT how clear
 * works: measured 2026-08-05, taps in the field's trailing padding do not
 * focus iOS fields.
 *
 * Every phase is VERIFIED against a fresh tree and retried once — synthetic
 * input is droppable end to end (Compose async state, IME queues), so "the
 * call returned" is not "the text landed":
 * - clear: the field must actually be empty; a second pass uses the length
 *   the field still reports.
 * - type with clear: the field must show exactly the value; the retry may
 *   safely wipe and retype (the content is ours).
 * - type without clear: the typed value must appear IN the field (contiguous
 *   insert at the cursor); no destructive retry — clear stays opt-in, so a
 *   mismatch throws instead of corrupting content the field came with.
 * Fields that never expose text (masked/password) verify as best-effort;
 * fields that expose BULLETS verify by length (see `landed`).
 * Errors carry LENGTHS only, never content — values may be credentials.
 *
 * The re-read between phases is resolveNow on a fresh tree — the one-shot
 * mode of the same policy that chose the field, so a poller never waits for
 * a rect to settle. A tree that cannot be read mid-fill THROWS: the app has
 * a window by then (the focus tap landed), so an unreadable tree is a dead
 * device, not a screen settling. Before 2026-10-03 the engine's refetch
 * threw and the MCP tool's swallowed it; the stricter one is the honest one,
 * and the error names the fill and how to recover rather than quoting a bare
 * adapter message.
 *
 * Keyboard dismissal is deliberately NOT in here: `dismissKeyboard` is a
 * second call, so a warning this fill produced reaches the caller before the
 * key press can throw (review 2026-10-03: a masked-append warning was lost
 * when `pressKey` failed after the text had landed).
 *
 * Moved from flow/engine.ts (2026-10-03), where it took a pre-resolved node
 * and a caller-built refetch closure that re-stated the resolution filter.
 */
export async function fillField(
  adapter: DeviceAdapter,
  target: Target,
  value: string,
  opts: FillOptions,
): Promise<FillResult> {
  const { clear } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_VALUE_POLL_MS;
  const { node, note } = await resolveSettled(adapter, target, opts);
  const refetch = async (): Promise<UiNode | undefined> => {
    // Only the READ is wrapped: a refusal from resolveNow (a second match
    // appearing mid-fill — a suggestion row, a duplicated field) is a
    // selector finding with its own wording, not a device that went away.
    let tree: UiNode;
    try {
      tree = await adapter.uiTree();
    } catch (e) {
      throw new Error(
        `fill: could not re-read ${describeTarget(target)} after focusing it — ${errorMessage(e)}. ` +
          'The field was tapped and may hold partial text; check the device is still online (adb devices / ' +
          'xcrun simctl list), then retry with clear: true so the field is reset',
      );
    }
    return resolveNow(tree, target, opts)?.node;
  };
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  await sleep(DEFAULT_FOCUS_DELAY_MS); // focus + keyboard — a constant, not an option: tests mock util/sleep

  let current: UiNode | undefined = node;
  let preLen = node.value?.length ?? 0; // what the field holds when typing starts (see `landed`)
  let warning: string | undefined;
  if (!clear && (preLen === 0 || isMaskedValue(current?.value ?? ''))) {
    // The pre-tap read is stale for exactly the fields the length rule cares
    // about: Android autofill POPULATES a password field on focus, and a
    // re-entry screen CLEARS one on focus (review 2026-09-18 measured both as
    // false failures against a pre-tap `preLen`). Re-read after focus. Plain
    // fields with content skip this — `includes` never uses preLen.
    const focused = await refetch();
    if (focused !== undefined) {
      current = focused;
      preLen = focused.value?.length ?? 0;
    }
    if (preLen > 0 && isMaskedValue(current?.value ?? '')) {
      // The length rule cannot see content: a password typed onto an
      // autofilled one reads as a perfect append (finportal 2026-09-17:
      // backend `invalid_grant`). Say so where the trace is read.
      warning = `masked field already held ${preLen} characters and clear is not set — typing APPENDS; pass clear: true to replace`;
    }
  }
  if (clear) {
    for (let attempt = 0; ; attempt++) {
      const existing = current?.value?.length ?? 0;
      if (existing === 0) break;
      await adapter.clearText(existing);
      current = await refetch();
      const left = current?.value?.length ?? 0;
      if (left === 0) break;
      if (attempt >= 1) {
        throw new Error(`fill: field still shows ${left} characters after clearing twice`);
      }
    }
  }

  await adapter.typeText(value);
  const result: FillResult = { note, warning };
  if (value !== '') {
    // A masked (secure) field shows one bullet per character to uiautomator
    // and WDA alike, so its content can never EQUAL the value — measured
    // 2026-09-17 (finportal login): `typed 16 characters but the field shows
    // 16` on both platforms, for a fill that had landed. Its LENGTH still says
    // whether every keystroke arrived, which is the check that matters on a
    // loaded emulator (dropped characters there surfaced as a backend
    // `invalid_grant`), so a bullets-only read-back is compared by count,
    // never by content. The rule detects the SHORT direction only — dropped
    // keystrokes; without `clear` the field must show at least what it held
    // after focus plus what was typed. It cannot tell a correct append from
    // typing onto an autofilled password (both read `held + typed`); that
    // case is the `warning` above, not a failure.
    const landed = (observed: string) =>
      isMaskedValue(observed)
        ? clear
          ? observed.length === value.length
          : observed.length >= preLen + value.length
        : clear
          ? observed === value
          : observed.includes(value);
    let observed = await pollValue(refetch, landed, pollMs);
    // undefined: the field withholds its text — best effort, nothing to compare.
    if (observed !== undefined && !landed(observed)) {
      if (clear) {
        await adapter.clearText(observed.length);
        await adapter.typeText(value);
        observed = await pollValue(refetch, landed, pollMs);
      }
      if (observed !== undefined && !landed(observed)) {
        throw new Error(
          `fill: typed ${value.length} characters but the field shows ${observed.length} ` +
            (isMaskedValue(observed)
              ? `(masked field — compared by length${clear ? '' : `; it held ${preLen} after focus`})`
              : '(content withheld from this error)'),
        );
      }
    }
  }
  return result;
}

/**
 * Close the on-screen keyboard: Android has a back key, iOS does not and
 * takes enter. Called AFTER a fill has returned, never before (dismissing
 * first closes the keyboard the typing needs), and as its own call so the
 * fill's warning is already in the caller's hands if this throws.
 */
export async function dismissKeyboard(adapter: Pick<DeviceAdapter, 'platform' | 'pressKey'>): Promise<void> {
  await adapter.pressKey(adapter.platform === 'android' ? 'back' : 'enter');
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

import { everyNode, rectArea, sameRect, type DeviceAdapter, type Rect, type UiNode } from '../adapters/types.js';
import { rectText } from '../ui-tree/geometry.js';
import { isMaskedValue } from '../ui-tree/masked-value.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { resolveClearOfKeyboard, type GuardOptions } from './keyboard.js';
import { describeTarget, resolveNow, type Target } from './resolve.js';
import { assertTypeable } from './type-text.js';

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

/** The guard's options (the focus tap goes through resolveClearOfKeyboard, dismissals included) plus the fill's own. */
export interface FillOptions extends GuardOptions {
  /** Delete the field's current content before typing — typing otherwise APPENDS. */
  clear?: boolean;
}

/**
 * The normalised role of every text input (adapters/ios-node.ts: TextField,
 * SecureTextField, TextView; adapters/android.ts: EditText,
 * AutoCompleteTextView and the Compose input that dumps as a focusable,
 * long-clickable scroll view). The one role a fill expects to type into.
 */
export const INPUT_ROLE = 'textfield';

/**
 * An input on the screen near a matched node that is not one — what the
 * caller probably meant. Identifier and rect only: never the label or the
 * value (on Android an EditText's label falls back to its text, and a field
 * may hold a credential).
 */
export interface NearbyInput {
  identifier: string | null;
  rect: Rect;
  /** The input's rect shares area with the matched node's (a label laid over its field). */
  overlaps: boolean;
}

/**
 * What the fill DID, as facts — the MCP reply (mcp/tool-text.ts#fillText)
 * and the flow line (flow/engine.ts#runFill) render from these through the
 * wording below, and neither restates the request. Until 2026-10-08 both
 * printed the REQUESTED `clear` ("cleared first", "(cleared)") and an
 * unreadable read-back passed as landed: on iOS idb a floating-label `text`
 * node was "Filled … (22 characters, cleared first)" with nothing cleared
 * and nothing typed (docs/bugs/2026-10-08-ios-fill-unverified-reports-
 * filled-and-cleared.md).
 */
export interface FillResult {
  /** How the field was chosen when several nodes matched (see resolveNow). */
  note?: string;
  /** The soft keyboard covered the field and was hidden before the focus tap (keyboard.ts: `back`, or a configured dismissal tapped) — the sentence, also in `note`. */
  keyboardHidden?: string;
  /** The fill was legal but suspicious — a masked field already held text and `clear` is off. */
  warning?: string;
  /** The matched node's role (the one tapped, typed into and read back). */
  role: string;
  /**
   * With `clear` only: how many characters the field held when the clear
   * began — what clearText deleted, the field verified empty after. 0 when
   * there was nothing to delete OR nothing to measure (a node exposing no
   * value): no delete was sent. Absent when `clear` was not asked for.
   */
  cleared?: number;
  /**
   * How the typed text was checked:
   * - `landed`: a fresh tree showed it in the field (see `landed` in fillField).
   * - `no-value`: the node exposed no value on two reads in a row — the
   *   text may or may not be there; nothing was compared.
   * - `nothing-typed`: the value was empty — a focus (and clear) alone.
   */
  readBack: 'landed' | 'no-value' | 'nothing-typed';
  /**
   * Set when the matched node is not an input (role ≠ INPUT_ROLE) AND the
   * read-back did not show the text in it — a node whose value took the
   * text is an input whatever its role (an iOS search field reads `other`).
   * `input` is the nearest input on the screen; `none` when the screen has
   * no input; `unread` when the tree to look in could not be read (a hint,
   * not a verdict: the fill does not fail for it).
   */
  notInput?: { input: NearbyInput | 'none' | 'unread' };
}

/** `cleared N character(s) first`, only when a delete was actually sent. */
export function fillClearedText(r: Pick<FillResult, 'cleared'>): string | undefined {
  return r.cleared === undefined || r.cleared === 0 ? undefined : `cleared ${r.cleared} character${r.cleared === 1 ? '' : 's'} first`;
}

/**
 * `NOT verified: the matched node exposes no value (role <role>)` when the
 * read-back had nothing to compare, plus — when `clear` was asked for —
 * that no delete was sent (the node gave no length). undefined otherwise.
 */
export function fillUnverifiedText(r: Pick<FillResult, 'readBack' | 'role' | 'cleared'>): string | undefined {
  if (r.readBack !== 'no-value') return undefined;
  return (
    `NOT verified: the matched node exposes no value (role ${r.role})` +
    (r.cleared === 0 ? '; clear sent no delete — the node gave no length to delete' : '')
  );
}

/**
 * The sentences that go on lines of their own (`⚠` in the reply, `⚠ fill`
 * in a flow): the not-an-input finding, then the masked-append warning.
 */
export function fillCaveats(r: Pick<FillResult, 'role' | 'notInput' | 'warning'>): string[] {
  const out: string[] = [];
  if (r.notInput !== undefined) out.push(notInputText(r.role, r.notInput.input));
  if (r.warning !== undefined) out.push(r.warning);
  return out;
}

function notInputText(role: string, input: NearbyInput | 'none' | 'unread'): string {
  const head = `the matched node is role ${role}, not a ${INPUT_ROLE} — typing goes wherever the focus tap left the focus`;
  if (input === 'none') return `${head}; no ${INPUT_ROLE} is on the screen`;
  if (input === 'unread') return `${head}; the screen could not be read again to name the input`;
  const id = input.identifier === null ? '' : ` id:"${input.identifier}"`;
  return (
    `${head}; the ${input.overlaps ? 'input overlapping it' : 'nearest input'} is ${INPUT_ROLE}${id} at ${rectText(input.rect)} — ` +
    `select the input itself (role:${INPUT_ROLE} with its id:, or its current value: when inputs share an id)`
  );
}

/**
 * The input a non-input match most likely labels: the one overlapping it
 * most, else the one nearest it (gap between the rects). Zero-area nodes are
 * never candidates, as in resolveNow.
 */
function nearestInput(tree: UiNode, near: UiNode): NearbyInput | 'none' {
  let best: { node: UiNode; overlap: number; gap: number } | undefined;
  for (const n of everyNode(tree)) {
    if (n.role !== INPUT_ROLE || rectArea(n.rect) === 0) continue;
    const overlap = overlapArea(n.rect, near.rect);
    const gap = rectGap(n.rect, near.rect);
    if (best === undefined || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) best = { node: n, overlap, gap };
  }
  return best === undefined ? 'none' : { identifier: best.node.identifier, rect: { ...best.node.rect }, overlaps: best.overlap > 0 };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/**
 * The node chosen at focus, found again in a fresh tree by identity — same
 * role, identifier and rect, exactly one such node. The read-back's
 * fallback when the selector no longer matches: a `value:"…"` selector
 * stops matching the moment the clear or the typing changes the value, and
 * until 2026-10-08 that read as "nothing there" (a clear counted as done,
 * a read-back as unverifiable). A field that MOVED (the keyboard pushed the
 * form up) is not found this way and stays unverifiable, as before.
 */
function sameField(tree: UiNode, chosen: UiNode): UiNode | undefined {
  const twins = [...everyNode(tree)].filter(
    (n) => n.role === chosen.role && n.identifier === chosen.identifier && sameRect(n.rect, chosen.rect),
  );
  return twins.length === 1 ? twins[0] : undefined;
}

/**
 * Focus a field (center tap, after resolveClearOfKeyboard — the settled
 * resolution plus, since 2026-10-03, the rule that a field lying under the
 * keyboard the PREVIOUS field raised is not tapped through it) and type into it. With
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
 * A node that never exposes text is NOT verified, and the result says so
 * (`readBack: 'no-value'`) — until 2026-10-08 it passed as landed, and a
 * floating-label `text` node on iOS idb was reported filled with nothing
 * typed. Fields that expose BULLETS verify by length (see `landed`). A
 * matched node that is not an input (INPUT_ROLE) is warned about, with the
 * nearest input named — not refused (see `notInput` below).
 * An EMPTY value is the focus tap and the optional clear alone: nothing is
 * read back, no append warning is raised, and the adapter is still handed
 * the "" — a no-op by its contract (DeviceAdapter.typeText), so the step
 * reads "clear this field" with clear and "focus without typing" without.
 * Errors carry LENGTHS only, never content — values may be credentials.
 * A value holding a control character is refused before anything is sent
 * (interact/type-text.ts — the one statement of what text averi types).
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
 * Keyboard dismissal is deliberately NOT in here: `dismissKeyboard`
 * (keyboard.ts) is a second call, so a warning this fill produced reaches the
 * caller before the key press can throw (review 2026-10-03: a masked-append
 * warning was lost when `pressKey` failed after the text had landed).
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
  // Before the field is resolved: a refused value must cost no keyboard
  // dismissal, no focus tap and no clear (type-text.ts).
  assertTypeable(value);
  const { clear } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_VALUE_POLL_MS;
  const { node, note, keyboardHidden } = await resolveClearOfKeyboard(adapter, target, opts);
  let lastTree: UiNode | undefined; // the newest tree refetch read — the not-input finding looks for the input in it
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
    lastTree = tree;
    return resolveNow(tree, target, opts)?.node ?? sameField(tree, node);
  };
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  await sleep(DEFAULT_FOCUS_DELAY_MS); // focus + keyboard — a constant, not an option: tests mock util/sleep

  let current: UiNode | undefined = node;
  let preLen = node.value?.length ?? 0; // what the field holds when typing starts (see `landed`)
  let warning: string | undefined;
  if (value !== '' && !clear && (preLen === 0 || isMaskedValue(current?.value ?? ''))) {
    // The pre-tap read is stale for exactly the fields the length rule cares
    // about: Android autofill POPULATES a password field on focus, and a
    // re-entry screen CLEARS one on focus (review 2026-09-18 measured both as
    // false failures against a pre-tap `preLen`). Re-read after focus. Plain
    // fields with content skip this — `includes` never uses preLen. So does
    // an empty value (2026-10-07): it is a focus without typing, which has no
    // read-back to feed and nothing that could append, so the masked-append
    // warning below would name a typing that never happened.
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
  let cleared: number | undefined;
  if (clear) {
    if (value === '') {
      // A clear ALONE has no read-back behind it, so what the loop counts
      // must be what the field holds AFTER focus, not before the tap: a
      // field that autofills on focus (Android, measured 2026-09-18) would
      // otherwise read as empty from the pre-tap tree, be skipped, and keep
      // the autofilled text — the one fill shape whose whole point is an
      // empty field. A clear WITH a value needs no such read: its read-back
      // compares the field to the value and wipes a mismatch before the
      // retry. Same re-read as the `!clear` branch above (2026-10-07).
      const focused = await refetch();
      if (focused !== undefined) current = focused;
    }
    for (let attempt = 0; ; attempt++) {
      const existing = current?.value?.length ?? 0;
      cleared ??= existing; // the first pass's count: what the field held when the clear began
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
  let readBack: FillResult['readBack'] = 'nothing-typed';
  // Not an input, and nothing shows the text landed in it: name the input
  // the caller probably meant. Warned, NOT refused (2026-10-08): on iOS idb a
  // floating label is a separate `text` node over its field, and a tap on it
  // focuses the field when the two still overlap (measured: that fill did
  // land) — a refusal would break flows that work, and the label is the only
  // selector idb leaves for inputs that share an identifier. A read-back
  // that SHOWS the text proves the node took it, whatever its role.
  const notInput = async (): Promise<FillResult['notInput']> => {
    if (node.role === INPUT_ROLE) return undefined;
    let tree = lastTree;
    if (tree === undefined) {
      try {
        tree = await adapter.uiTree();
      } catch {
        return { input: 'unread' }; // a hint, not a verdict: the fill does not fail for it
      }
    }
    return { input: nearestInput(tree, node) };
  };
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
    // undefined: the node withholds its text — nothing to compare. Since
    // 2026-10-08 that is SAID (readBack 'no-value'), never passed as landed.
    if (observed !== undefined && !landed(observed)) {
      if (clear) {
        await adapter.clearText(observed.length);
        await adapter.typeText(value);
        observed = await pollValue(refetch, landed, pollMs);
      }
      if (observed !== undefined && !landed(observed)) {
        const wrong = await notInput();
        throw new Error(
          `fill: typed ${value.length} characters but the field shows ${observed.length} ` +
            (isMaskedValue(observed)
              ? `(masked field — compared by length${clear ? '' : `; it held ${preLen} after focus`})`
              : '(content withheld from this error)') +
            (wrong === undefined ? '' : `; ${notInputText(node.role, wrong.input)}`),
        );
      }
    }
    readBack = observed === undefined ? 'no-value' : 'landed';
  }
  return { note, keyboardHidden, warning, role: node.role, cleared, readBack, notInput: readBack === 'landed' ? undefined : await notInput() };
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

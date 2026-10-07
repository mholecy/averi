/**
 * Device Adapter — the only layer that knows platform commands.
 * One interface, two implementations (Android/adb, iOS/simctl+idb).
 * Everything above this layer is platform-agnostic. See ARCHITECTURE.md §3.
 */

import type { IosTreeSourceKind } from './ios-node.js';

export type Platform = 'android' | 'ios';

export interface Device {
  id: string; // adb serial / simctl UDID
  platform: Platform;
  name: string;
  osVersion: string;
  state: 'booted' | 'offline';
}

/**
 * Screen size in the platform's own tree units — see `DeviceAdapter.viewport`,
 * which is the one place that reads it. Named here rather than in verify/ so
 * the reading and every use of it share a definition.
 */
export interface DeviceScreen {
  width: number;
  height: number;
}

/** Integer points (iOS) or pixels (Android), as the platform reports them. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rect of a node that has none: a synthetic root, a dump without bounds,
 * an element without a frame. A factory, never a shared constant — nodes are
 * mutated downstream (field-error pairing, geometry) and two nodes must not
 * share one rect object.
 */
export const zeroRect = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * width × height, and 0 for anything degenerate — a zero rect (`zeroRect`),
 * a negative or NaN side. The one spelling of "has this rect an area": the
 * visible fraction and the bare-tree rule above this layer (ui-tree/
 * geometry.ts re-exports it), and the idb source's empty-tree check here
 * (ios-tree-source.ts). Moved from geometry.ts on 2026-10-06, so that check
 * did not need a second spelling.
 */
export function rectArea(rect: Rect): number {
  if (!(rect.width > 0 && rect.height > 0)) return 0;
  const a = rect.width * rect.height;
  return Number.isFinite(a) ? a : 0;
}

/**
 * The role of the ONE node per on-screen soft keyboard that a tree source
 * emits when its tree contains the keyboard (2026-10-07: the WDA source,
 * adapters/wda-source.ts#keyboardMarks). Its rect is the screen band the
 * keyboard covers — keys, AutoFill bar, accessory toolbar slot and dictation
 * row together — not the `Keyboard` element's own rect, which was measured
 * 17–44 pt short of the drawn area (docs/bugs/2026-10-05-ios-tap-lands-on-
 * soft-keyboard.md). Read by `ui-tree/soft-keyboard.ts#keyboardInTree`, the
 * in-tree half of the soft-keyboard reading the tap guard and the pixel
 * poll share with the Android oracle. Defined beside UiNode because the
 * adapter writes it and ui-tree reads it, and neither may spell the string.
 * Not in INTERACTIVE_ROLES (a selector never prefers it) and not structural
 * (ui-tree/bare-tree.ts: a screen with its keyboard up has rendered).
 * Absent from a tree means nothing — an idb tree never carries one and a
 * WDA tree without one has no keyboard on screen, and the tree cannot say
 * which source it came from.
 */
export const KEYBOARD_ROLE = 'keyboard';

/** Normalized accessibility tree node — identical shape on both platforms. */
export interface UiNode {
  role: string; // normalized: button, text, textfield, image, container, keyboard (KEYBOARD_ROLE), ...
  label: string | null; // visible text / content description
  identifier: string | null; // resource-id / accessibilityIdentifier
  value: string | null; // current value (text field contents, toggle state)
  /** Validation message associated with an input, when the platform exposes one. */
  error?: string;
  rect: Rect;
  children: UiNode[];
  /**
   * Set on the ROOT of a subtree that is the soft keyboard's own UI
   * (2026-10-07, review round 1): on iOS through WDA, the Window that holds
   * the `Keyboard` element — keys, AutoFill bar, dictation button — and the
   * input-host Window UIKit pairs with it, which holds the app's
   * `inputAccessoryView` toolbar (the "Done" above a number pad) and the
   * `inputView` placeholder (adapters/wda-source.ts#keyboardMarks). A node
   * under such a root is never COVERED by the keyboard: it is the keyboard,
   * and a tap on it — a digit, Done, the Passwords bar — is what the user
   * does (ui-tree/soft-keyboard.ts#partOfKeyboard walks the ancestry). On
   * the roots only, not on every descendant: `ui_snapshot` prints the tree
   * as JSON, and one mark per window says it where seventy would be noise.
   * Absent everywhere on Android and on an idb tree.
   */
  ofKeyboard?: true;
}

/**
 * Every node under `root`, pre-order, the root first. The one tree walk:
 * field-error pairing feeds WDA's nested tree to its flat rule with it, the
 * text hint flattens with it, ui_snapshot's note counts with it. It lives
 * beside UiNode rather than in a verify/ or adapters/ sibling because all
 * three layers need it and none owns it (review 2026-10-06).
 */
export function* everyNode(root: UiNode): Generator<UiNode> {
  yield root;
  for (const child of root.children) yield* everyNode(child);
}

/**
 * Selector strings resolved against the normalized tree, e.g.
 *   id:login_pin_field | text:"Continue" | role:button label~"Pay.*"
 */
export type Selector = string;

export type Key = 'back' | 'home' | 'enter';

/** See `KeyboardOracle.witness`: confirmed shown / denied / cannot tell. */
export type KeyboardWitness = 'shown' | 'hidden' | 'unknown';

/**
 * What a platform can say about its on-screen (soft) keyboard — see
 * `KeyboardOracle.state`. Three answers, not "a frame or undefined",
 * because the two callers need different things from the missing frame
 * (2026-10-03): the tap guard only asks "does it cover my point" (hidden and
 * unknown both mean "tap as before"), but `dismissKeyboard` must tell "no
 * keyboard — pressing back would NAVIGATE" from "could not tell — keep doing
 * what was always done". One `undefined` would have forced one of them to
 * guess.
 *
 * `frame` is the screen rect the keyboard covers, in the SAME units as uiTree
 * rects (Android: pixels), so a tap point can be tested against it directly.
 */
export type SoftKeyboard =
  | { state: 'shown'; frame: Rect }
  | { state: 'hidden' }
  /** The platform did not answer, or answered in a shape the adapter does not recognise. Callers behave as before the question existed. */
  | { state: 'unknown' };

/**
 * The soft-keyboard oracle: what a platform whose keyboard is a SEPARATE
 * WINDOW — absent from its accessibility tree, hidden by `back` — can tell
 * about it. An optional capability of the adapter (`DeviceAdapter.keyboard`,
 * 2026-10-04), not two methods every adapter must stub: exactly one platform
 * answers (Android), and an adapter without the oracle is one whose keyboard,
 * if any, is part of the tree — on iOS its keys are nodes, and the
 * covered-target problem has a different shape: since 2026-10-07 the tree
 * that resolved the target is read for a `KEYBOARD_ROLE` node (the WDA
 * source emits one per on-screen keyboard), a covered tap point is REFUSED,
 * and nothing is pressed — there is no non-submitting dismissal to try
 * (docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md, "Fix (stage A)").
 * Until 2026-10-04 both methods sat on `DeviceAdapter`, iOS returned a
 * constant from each without a device query, and the fake carried the
 * simulation of both for a feature one adapter has.
 *
 * Two kinds of keyboard, one fact with two halves — stated in full here,
 * beside the capability; interact/keyboard.ts#dismissKeyboard points here
 * and ARCHITECTURE §3 repeats the short form. Providing an oracle asserts
 * the WINDOW model: the keyboard it describes is a separate window that
 * `back` hides, and interact/keyboard.ts — the one owner of what to DO about
 * the answers — presses that `back` only through an adapter that has one,
 * witness-vetoed. Its absence asserts the IN-TREE model (iOS: the keys are
 * nodes): nothing to observe, no `back` to press, and the blind dismissal
 * after a fill is `enter`, pressed asking nothing. That cuts both ways: a
 * NEW adapter that ships without an oracle gets the same blind dismissal,
 * and that key may SUBMIT a form — a platform where that is wrong adds the
 * oracle rather than a platform branch in interact/. Not a dismiss-key
 * property on the adapter (judged 2026-10-05): the guard's `back` must stay
 * bound to the window model, or an oracle whose key were the in-tree one
 * would submit forms under a covering keyboard, and "back was pressed (it
 * may have navigated)" would be false.
 *
 * Both methods NEVER throw and never guess: a command that fails, times out or
 * prints something unrecognised is `unknown`, and callers behave as before the
 * question existed. Neither is memoized (unlike `viewport`): the answer
 * changes with every focus, and the registry keeps one adapter for a whole
 * session — a cached `hidden` would veto every later dismissal.
 */
export interface KeyboardOracle {
  /**
   * Is a soft keyboard on screen, and which rect does it cover? (2026-10-03.)
   *
   * Platform knowledge, hence behind the adapter: on Android the keyboard is a
   * separate window that is NOT in the uiautomator tree, so a node under it
   * resolves, settles and reports a rect like any other — and a tap at its
   * centre presses a keyboard key (measured 2026-10-03, finportal login: the
   * submit button at (249,1466) under an IME frame starting at y=1285; one
   * stray character went into the password field, nothing was submitted, the
   * tap was reported done). What to DO about it is interact/keyboard.ts's
   * policy; this method only answers.
   */
  state(): Promise<SoftKeyboard>;
  /**
   * An INDEPENDENT second opinion on "is a soft keyboard shown" — no frame,
   * a different source than `state()` (2026-10-04). It exists because the
   * first answer can be stale: measured that day on Android 13, right after
   * a tap that navigated away the window state still read "shown" with the
   * full frame for a few seconds, while the input method itself already said
   * it was not. interact/keyboard.ts asks this immediately before it presses
   * `back` for keyboard reasons, and only then — never on an ordinary tap.
   *
   * A method of its own rather than an option on `state()`: the caller needs
   * it at a different moment (after the frame has been tested against the
   * tap point), and one call that sometimes runs two commands would hide the
   * cost the policy is pinned to.
   */
  witness(): Promise<KeyboardWitness>;
}

/**
 * Android-only intent parameters for `am start` — how a flow exercises entry
 * points other than the launcher (share sheet, custom actions). String extras
 * only: they cover the share/deep-entry cases; typed extras can come later.
 */
export interface LaunchIntent {
  action?: string; // e.g. android.intent.action.SEND
  data?: string; // intent data URI
  mimeType?: string;
  categories?: string[];
  extras?: Record<string, string>; // --es key value
}

export interface LaunchOptions {
  clearState?: boolean;
  /**
   * Android-only: exact activity to start (`.MainActivity`, fully-qualified,
   * or full `pkg/Activity` component). Without it launch falls back to
   * `monkey -c LAUNCHER`, which picks ARBITRARILY among a package's launcher
   * activities — debug builds bundling LeakCanary have two, so monkey may
   * open LeakCanary instead of the app. iOS rejects it (single entry point).
   */
  activity?: string;
  /**
   * Android-only, see LaunchIntent. With `activity` it is sent to that
   * component; without, it is scoped to the app's package (`am start -p`)
   * and Android resolves the activity — a launch nothing in the package
   * handles throws. iOS rejects it — use openDeepLink.
   */
  intent?: LaunchIntent;
}

export interface DeviceAdapter {
  readonly platform: Platform;
  /**
   * Which backend `uiTree()` actually reads with, when the adapter has one
   * and the distinction exists — the bound iOS adapter reports its tree
   * source's kind (idb or wda); Android has one tree and says nothing, as
   * does an unbound probe. The adapter is the source of truth here, not
   * averi.yaml: a layer above that re-derived the kind from the config
   * (2026-10-06, the flow engine's wait hint) agreed with the registry only
   * as long as nobody paired a FlowEngine with an adapter built elsewhere.
   * Diagnostic only — nothing above dispatches on it. Required, not
   * optional, so an implementation or a wrapper that forgets it fails to
   * compile instead of silently losing the hint; `undefined` is the
   * declared answer for "none".
   */
  readonly treeSourceKind: IosTreeSourceKind | undefined;

  listDevices(): Promise<Device[]>;

  /** Reinstall triggers the app's login requirement — intentional. */
  install(appPath: string): Promise<void>;
  launch(bundleId: string, opts?: LaunchOptions): Promise<void>;
  terminate(bundleId: string): Promise<void>;
  openDeepLink(url: string): Promise<void>;

  screenshot(): Promise<Buffer>; // PNG bytes
  /**
   * `settle`: a one-shot caller (an MCP tool, not a poller) may ask for one
   * bounded retry when the device answers "no window yet" right after a launch.
   * Pollers leave it off — their interval already is the retry.
   */
  uiTree(opts?: { settle?: boolean }): Promise<UiNode>;

  /**
   * Visible screen size in the SAME units as uiTree rects (Android: pixels,
   * iOS: points) — the reference frame for viewport-visibility checks, and the
   * only measurement of the screen that does not come from the tree, which is
   * what the png scale is derived from (verify/scale.ts). Those units are
   * load-bearing: verify/ divides png pixels by this width, so a platform that
   * started reporting the other unit would move every crop.
   *
   * MEMOIZED per adapter, success and failure alike — the panel does not
   * change under a session — and that is part of the contract, not a detail:
   * the layers above read it freely (per captured frame, per absent check)
   * instead of caching it themselves. The Verifier and the FlowEngine each
   * carried a memo of their own until 2026-10-02; both were pass-through
   * over this one, and both are gone. An adapter that re-read the device on
   * every call would make every pixel assert poll pay a shell-out.
   */
  viewport(): Promise<DeviceScreen>;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<void>;
  typeText(text: string): Promise<void>;
  /**
   * Clear up to `count` characters on EACH side of the cursor in the focused
   * field (backspaces then forward-deletes). Position-independent: a tap may
   * leave the cursor anywhere in the text, and neither platform offers a
   * reliable move-to-end (measured 2026-08-05: iOS taps land the cursor at
   * the glyph, Android MOVE_END left one char behind on the amount field).
   */
  clearText(count: number): Promise<void>;
  pressKey(key: Key): Promise<void>;
  /**
   * The soft-keyboard oracle (see `KeyboardOracle`) — present on a platform
   * whose keyboard is a separate window that `back` hides (Android), absent
   * where it is part of the tree (iOS). Absent means: no device is queried,
   * the tap guard reads the keyboard from the tree that resolved the target
   * (`KEYBOARD_ROLE`; a covered point is refused, nothing is pressed — since
   * 2026-10-07, before that taps were unguarded), and the blind dismissal
   * key is `enter`.
   */
  readonly keyboard?: KeyboardOracle;
  /**
   * The in-tree model's one sentence (2026-10-07): why THIS adapter cannot
   * hide a soft keyboard that covers a target, and what was measured to work
   * instead. Set only by an adapter WITHOUT the oracle (iOS: `IosAdapter`),
   * quoted verbatim — in parentheses, after "this adapter cannot hide it" —
   * by the refusals in interact/keyboard.ts and verify/pixel-poll.ts, which
   * own the generic halves of their sentences and no platform fact. The
   * adapter owns it for the reason it owns the blind dismissal key: the
   * facts (which key submits, which endpoint fails) are the platform's, and
   * the layers above are platform-agnostic (ARCHITECTURE.md §2). Absent, the
   * refusal says only that the adapter cannot hide it.
   */
  readonly keyboardAdvice?: string;
  setClipboard(text: string): Promise<void>;

  /** logcat / os_log excerpt for crash detection. */
  logs(sinceMs: number): Promise<string[]>;

  /** Is the app process currently running? Used for appAlive crash detection. */
  isAppRunning(appId: string): Promise<boolean>;

  /**
   * Release device-bound resources the adapter lazily started (today: the
   * WdaServer behind the iOS wda tree source). Optional and idempotent. Two callers: the registry when it
   * evicts an adapter (a rebind must not leak a server driving the old
   * device), and the process shutdown, which AWAITS it — so a returned promise
   * must resolve when the resource is actually released, not when the release
   * was queued. It may reject; both callers swallow the rejection, since the
   * adapter is gone either way.
   */
  dispose?(): void | Promise<void>;
}

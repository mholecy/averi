import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AdapterRegistry } from './registry.js';
import { BARE_TREE_CONTENTS } from '../ui-tree/bare-tree.js';
import { findAll } from '../ui-tree/selectors.js';
import { ACTIVE_WINDOW_HINT } from '../ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../ui-tree/remedy-text.js';
import { fillField } from '../interact/fill.js';
import { fillReply } from '../interact/fill-text.js';
import { typeIntoFocused } from '../interact/type-text.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '../interact/resolve.js';
import type { TapOptions } from '../interact/tap.js';
import { DEFAULT_MAX_SWIPES, DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, HEDGE_WHATS, HEDGED_LEAD, scrollUntilVisible } from '../interact/scroll.js';
import { eyesOn } from '../verify/eyes.js';
import { SWIPE_REACH_FRACTION, swipeScreen } from '../interact/swipe.js';
import { tapElement } from '../interact/tap.js';
import { deepLinkText, launchText, snapshotNote, swipeText, tapText, typedText } from './tool-text.js';
import { EngineSession, launchApp } from '../flow/launch.js';
import { appBuildPath } from '../flow/load.js';
import { iosToolSettings, loadForCall, type ConfigPolicy, type IosToolSettings } from '../flow/tool-config.js';
import type { AveriConfig } from '../flow/config.js';
import type { Eyes } from '../ui-tree/eyes.js';
import { TOOL_CONFIG } from './config-policy.js';
import { ASSERT_TIMEOUT_MS, assertSpecSchema, PIXEL_ASSERT_TIMEOUT_MS } from '../verify/assert.js';
import { DEFAULT_ENSURE_TIMEOUT_MS } from '../flow/engine.js';
import { formatSeconds } from '../util/duration.js';
import { READY_TIMEOUT_MS } from '../adapters/wda.js';
import { captureFrame, unsettledNote } from '../verify/capture.js';
import { CONTRACT_TOL_FACTOR, DEFAULT_TOLERANCE_DE } from '../verify/color-parity.js';
import { DEFAULT_SIZE_TOLERANCE_PCT } from '../verify/text-parity.js';
import { baselineDirFor, runAsserts, runEnsureState, runNamedFlow } from '../run/commands.js';
import { formatLogExcerpt, LOG_GREP_FLAGS, LOG_MAX_LINES } from '../run/log-excerpt.js';
import { runVerification } from '../run/verify.js';
import { claimed } from '../run/claims.js';
import { normalizePlatforms } from './platforms.js';
import { regexSource } from '../util/regex.js';
import { FOREGROUND_WAIT_MS, type DeviceAdapter, type Platform, type UiNode } from '../adapters/types.js';
import { PIXEL_OVERLAP_SLACK } from '../ui-tree/geometry.js';

/**
 * The averi tool surface: every tool's schema, description and handler,
 * registered on a server this module BUILDS but never connects.
 *
 * Importing this file has no side effects — no registry, no transport, no
 * version read. Registrations in mcp/server.ts, which constructs the server
 * and ends in a top-level `await server.connect(stdio)`, would open a stdio
 * transport on import, so no handler could be exercised by a test. That
 * wall was hit three times — a mutant replacing ensure_state's settled frame with a bare
 * `adapter.screenshot()` survived the whole suite, "tap and type_text refuse
 * an ambiguous selector" was verified only by reading, and tool-text.ts,
 * lifecycle.ts and util/version.ts were each split out because server.ts
 * could not be imported. (That still holds for the last two, which
 * server.ts itself uses; tool-text.ts stays for the reason in its header.)
 *
 * The seam is construction vs connection. `createAveriServer` takes what the
 * handlers depend on and returns the server; mcp/server.ts (the bin) connects
 * it to stdio, tests/mcp/tools.test.ts connects it to the SDK's in-memory
 * transport and calls the tools through a real `Client` — the module's
 * interface as its only caller, an MCP client, sees it: names, schemas,
 * response content, `isError`.
 *
 * What is injected, and what is not: the registry (whose AdapterFactory seam
 * also carries its DeviceDiscovery) and the version
 * string. Config and contract files stay real files read from disk — a test
 * writes an averi.yaml into a temp dir and passes `configPath`, as a user
 * would. Rejected: a config-loader or file-system parameter. It would be a
 * second adapter at a seam that already has a cheap real one, and the
 * path-resolution rules (projectConfigPath, baselineDirFor) are exactly what
 * such a fake would skip.
 *
 * What a handler holds (the same list as ARCHITECTURE.md §2): its description and input schema, which includes
 * parsing the assert specs; resolving the platform to an adapter through the
 * registry, this layer's own state; the config it needs, read ONCE per
 * call by flow/tool-config.ts#loadForCall under the tool's entry in
 * mcp/config-policy.ts#TOOL_CONFIG (not one of four loaders chosen by hand
 * per handler, where `assert` ran two of them), and the
 * answers asked of that loaded config (which build to install, which iOS
 * tree source and dismissals — flow/); one call into an adapter method,
 * interact/, run/ or flow/launch.ts (launch_app's, which resolves the
 * activity itself), handed the loaded config rather than a
 * path to read again; and the response — text through tool-text.ts or the
 * callee (a fill's through interact/fill-text.ts, shared with the flow line), wrapped by `text`/`image` below. The sequences once written out
 * here (ensure_state, run_flow, assert, the contract file read) are below
 * this layer.
 *
 * That is several statements, not "ONE delegation". `install_app` chooses between the given path
 * and the config's; `assert` parses its specs, resolves the adapter and the
 * baseline dir, then calls runAsserts; `verify` is the widest — it loads the
 * config, parses the specs, then calls runVerification. Every handler that
 * reads averi.yaml starts with one call under its TOOL_CONFIG entry: `serve(p, TOOL_CONFIG.<tool>(…), cp)`, which
 * hands back the config, the device and its eyes together (A30) — or, where the device waits on the config (the
 * engine tools, which resolve it lazily through the run layer, and `install_app`, which names its build first),
 * `loadForCall(TOOL_CONFIG.<tool>(…), cp)` and `deviceFor` later. The read stays here, above run/, so the policy has
 * one caller shape and nothing below reads the file again.
 */

const platform = z.enum(['android', 'ios']).describe('Target platform');

const configPath = z
  .string()
  .optional()
  .describe("Path to averi.yaml (default ./averi.yaml in the server's working directory; paths inside it resolve against it)");

const environment = z
  .string()
  .optional()
  .describe("Credential environment from averi.yaml `environments:`, for a build that points at another backend. Default $AVERI_ENV, then `defaultEnvironment:`");

/**
 * What one tool call is served with, by this composition root's ONE call per handler (`serve`, A30): the config the
 * call read (flow/tool-config.ts#loadForCall under its TOOL_CONFIG entry), the iOS settings of that config, the
 * project's adapter for the platform's device (D41), and the eyes over that adapter (verify/eyes.ts#eyesOn, ADR 0024)
 * — handed together, so no handler assembles them. The engine tools resolve their adapter lazily, through the same
 * `deviceFor`, once the run layer has checked the environment, and the engine makes their eyes (flow/engine.ts).
 */
interface Served {
  cfg: AveriConfig | undefined;
  settings: IosToolSettings;
  adapter: DeviceAdapter;
  eyes: Eyes;
}

/**
 * How the tools act on an element (tap and type_text with a selector): an
 * ambiguous selector is REFUSED — an agent exploring through the tools has
 * not seen the tree it would be guessing in (interact/resolve.ts, Ambiguity;
 * a flow step picks the first, flow/engine.ts#FLOW_AMBIGUITY) — and the
 * call's dismissals go to the keyboard guard, and the served eyes' order
 * question (which of two controls listed in reading order is drawn on top,
 * ADR 0024) to the tap's judgement. Given once, not spelled out per handler;
 * a fill adds its `clear`.
 */
const acting = ({ settings, eyes }: Served): Pick<TapOptions, 'ambiguous' | 'dismissals' | 'eyes'> => ({
  ambiguous: 'refuse',
  dismissals: settings.dismissals,
  eyes,
});

const text = (value: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

/** A PNG as MCP image content — the one spelling of it for screenshot, ensure_state and verify. */
const image = (shot: Buffer) => ({
  type: 'image' as const,
  data: shot.toString('base64'),
  mimeType: 'image/png',
});

const launchIntentInput = z
  .object({
    action: z.string().optional().describe('e.g. android.intent.action.SEND'),
    data: z.string().optional().describe('Intent data URI'),
    mimeType: z.string().optional(),
    categories: z.array(z.string()).optional(),
    extras: z.record(z.string()).optional().describe('String extras (--es key value)'),
  })
  .strict();

/**
 * The operation defaults as the tool descriptions quote them — each derived
 * from the constant its module owns, so a default changed there cannot leave
 * a description stale (literals — "3 s" in three places, "12 s", "Default
 * 6", "~20 s" — went stale beside derived numbers). tests/mcp/tool-descriptions.test.ts pins each
 * description against its constant.
 */
const SETTLE_BUDGET = formatSeconds(DEFAULT_SETTLE_TIMEOUT_MS); // interact/resolve.ts
const ASSERT_BUDGET = formatSeconds(ASSERT_TIMEOUT_MS); // verify/assert.ts
const PIXEL_ASSERT_BUDGET = formatSeconds(PIXEL_ASSERT_TIMEOUT_MS); // verify/assert.ts
const ENSURE_BUDGET = formatSeconds(DEFAULT_ENSURE_TIMEOUT_MS); // flow/engine.ts
const FOREGROUND_BUDGET = formatSeconds(FOREGROUND_WAIT_MS); // adapters/types.ts (ios-foreground.ts's bound)
const SLACK = PIXEL_OVERLAP_SLACK; // ui-tree/geometry.ts
const SWIPE_REACH = `${Number((SWIPE_REACH_FRACTION * 100).toFixed(2))}%`; // interact/swipe.ts

const assertsInput = z
  .array(z.unknown())
  .describe(
    'Assert specs, e.g. [{"element":{"id":"form"}}, {"element":{"id":"error"},"absent":true}, {"element":{"id":"amount"},"text":"100.00"}, ' +
      '{"element":{"id":"title"},"match":"^Pay"}, {"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}} (Figma-frame units), ' +
      '{"element":{"id":"card"},"color":{"expected":"#FDFDFD","deltaE":8,"sample":"dominant"}} (sample: "dominant" | "patches"), {"element":{"id":"cta"},"ocr":{"text":"CONTINUE","heightPct":2.96}}, ' +
      '{"screenshot":{"baseline":"transfers","threshold":0.01}}]. Each element spec takes "timeout" (non-negative ms, or "10s").',
  );

const parseAsserts = (raw: unknown[]) => raw.map((a) => assertSpecSchema.parse(a));

/**
 * What `ui_snapshot` prints of a tree or of its matches: the nodes as JSON, but for `"secure": false`. A plain input
 * says `false` (types.ts#UiNode.secure) so that a fill may skip its post-focus re-read; to the agent, a mark that
 * every plain field of an Android form would repeat is noise, and absent and `false` ask the same of it. `true` is
 * printed, as `heading` is.
 */
function snapshotJson(value: UiNode | readonly Omit<UiNode, 'children'>[]): string {
  return JSON.stringify(value, (key, v: unknown) => (key === 'secure' && v === false ? undefined : v), 2);
}

function stripChildren(node: UiNode): Omit<UiNode, 'children'> {
  const { children: _children, ...rest } = node;
  return rest;
}

/**
 * The server's `instructions` (the initialize result): what every tool shares, said once rather than in each
 * description — the selector grammar (ui-tree/selectors.ts), the units, configPath's rules, the iOS tree source, what
 * a refusal is — and where the full behaviour lives: the averi skill's references, which no session loads unasked,
 * and, for a session without the skill, the same file at this release's tag ({@link toolsReferenceUrl}). Counted with
 * tools/list against one budget (tests/mcp/tool-surface-budget.test.ts).
 */
export const serverInstructions = (version: string): string => [
  'averi drives booted iOS Simulators and Android Emulators. A device tool takes platform ("android" or "ios") and acts on that platform\'s first booted device, or the one select_device pinned.',
  'Selectors (tap, type_text, scroll_until, ui_snapshot\'s filter, flows): space-separated conditions that must all match, over the fields id, text (label or value), role, label and value; ":" is exact and case-sensitive, "~" an unanchored JavaScript regex (no inline flags such as (?i)). ' +
    'Double-quote a value with spaces: text:"Sign in" (text:Sign in fails at "in"). Prefer stable id:s.',
  'Coordinates and rects are in tree units: pixels on Android, points on iOS.',
  'configPath: averi.yaml is read only when a call uses a value from it; an invalid file fails the call, naming it; a missing one fails only the tools that cannot work without it (ensure_state, run_flow, verify, install_app without a path).',
  'iOS tree source (app.ios.treeSource): auto — WebDriverAgent, or idb if it cannot start (a ⚠ line says so; no scroll views, container ids, keyboard or presented layers); wda/idb pin one.',
  'A refusal taps, types or swipes nothing on its target (a keyboard dismissal it tried is named in it) and names its cause and remedy (scroll_until it first, close the presented screen first, hide the keyboard): follow it rather than retrying unchanged. Under a screen presented over the target (an alert, a sheet, a modal, an Android dialog) no scroll helps: close it first. ' +
    'An empty or bare tree is not absence: compare with screenshot.',
  `Full behaviour of each tool: the averi skill's references/tools.md (without the skill: ${toolsReferenceUrl(version)}); error lines by symptom: references/troubleshooting.md.`,
].join('\n');

/** The repository package.json names (`repository.url`); tests/mcp/tool-surface-budget.test.ts holds the two to one. */
export const REPOSITORY_URL = 'https://github.com/mholecy/averi';

/**
 * The full tool reference as released with this version: its file at the release tag (`v<version>`). From a checkout
 * ahead of its version's tag (unreleased work, a version bumped before tagging) the URL 404s until that tag exists.
 */
export const toolsReferenceUrl = (version: string): string => `${REPOSITORY_URL}/blob/v${version}/skill/references/tools.md`;

export interface AveriServerDeps {
  /** Resolves a platform to a device-bound adapter. The caller owns its lifetime (shutdown). */
  registry: AdapterRegistry;
  /** Reported as `serverInfo.version` in the MCP handshake — the package's own (util/version.ts). */
  version: string;
}

/** Build the averi MCP server with all its tools registered. Does not connect it. */
export function createAveriServer({ registry, version }: AveriServerDeps): McpServer {
  const server = new McpServer({ name: 'averi', version }, { instructions: serverInstructions(version) });

  const registerTool: typeof server.registerTool = server.registerTool.bind(server);

  // The session's state that outlives one engine run — the clearState count
  // (flow/launch.ts#EngineSession). One per server: the server IS the
  // session. Every tool that runs the engine (ensure_state, run_flow, verify)
  // hands it down, and launch_app, which wipes through the same launch. Not
  // a module global in the engine, which every server in the process would
  // share.
  const session = new EngineSession();

  /**
   * The ONE way a handler reaches a device (D41, 2026-11-01): the registry's adapter for the platform's bound device
   * and the project's iOS tree source — the `iosToolSettings` of the config the call loaded (android gets none; no
   * config is the registry's default kind). One adapter per simulator and configured source, so every tool of a
   * project shares its idb helper, its launch memory and its screenshot source (ADR 0032, amendment D41). Until D41
   * eight handlers asked without the kind and, in a wda project, got a second, idb-kind adapter. The engine tools hand
   * it to the run layer as their lazy form; every other handler reaches it through `serve`. tests/mcp/tools.test.ts
   * calls every tool of the policy table in a wda project and pins that one wda adapter alone is bound (ADR 0032,
   * amendment A30).
   */
  const deviceFor = (p: Platform, cfg: AveriConfig | undefined): Promise<DeviceAdapter> =>
    registry.get(p, { treeSource: iosToolSettings(cfg, p).treeSource });

  /**
   * The handler's one call (A30): read the config under the tool's policy, then the device through `deviceFor` and
   * its eyes (`Served`). The settings are the same pure answer `deviceFor` asks of the config (iosToolSettings), read
   * here for the dismissals.
   */
  const serve = async (p: Platform, policy: ConfigPolicy, cp: string | undefined): Promise<Served> => {
    const { cfg } = await loadForCall(policy, cp);
    const adapter = await deviceFor(p, cfg);
    return { cfg, settings: iosToolSettings(cfg, p), adapter, eyes: eyesOn(adapter) };
  };

  registerTool(
    'list_devices',
    {
      description:
        'List available iOS simulators and Android emulators/devices with boot state. ' +
        '`active: true` marks the device the platform\'s tools currently target (pin one with select_device).',
      inputSchema: {},
    },
    async () => {
      const devices = await registry.listAll();
      return text(
        devices.map((d) => (registry.boundId(d.platform) === d.id ? { ...d, active: true } : d)),
      );
    },
  );

  registerTool(
    'select_device',
    {
      description:
        'Pin which booted device a platform\'s tools target for the rest of the server session (without a pin: the first booted device adb/simctl lists — ambiguous with several connected). ' +
        'A pinned device going offline is an error, never a silent fallback to another device.',
      inputSchema: {
        platform,
        device: z.string().describe('Device id from list_devices (adb serial / simulator UDID)'),
      },
    },
    async ({ platform: p, device }) => {
      const selected = await registry.select(p, device);
      return text(`${p} tools now target ${selected.id} (${selected.name}, OS ${selected.osVersion})`);
    },
  );

  registerTool(
    'install_app',
    {
      description:
        'Install an app build (.apk / .app bundle) on the platform\'s device. Omit path to install the one averi.yaml names (app.android.apk / app.ios.app, resolved relative to averi.yaml).',
      inputSchema: {
        platform,
        path: z.string().optional().describe('Path to .apk (android) or .app (ios)'),
        configPath,
      },
    },
    async ({ platform: p, path, configPath: cp }) => {
      // Without a path the entry is `required`, so the config is there to name the build — named before a device is
      // bound, so a config without one binds nothing: the device through `deviceFor` once the path is known.
      const { cfg } = await loadForCall(TOOL_CONFIG.install_app({ platform: p, path }), cp);
      const appPath = path ?? appBuildPath(cfg, p);
      await (await deviceFor(p, cfg)).install(appPath);
      return text(`Installed ${appPath} on ${p}`);
    },
  );

  registerTool(
    'launch_app',
    {
      description:
        'Launch an app by package name / bundle id. clearState wipes its data first (forces a fresh login); the reply then carries a ⚠ clearState line counting this session\'s wipes, flow launches included. ' +
        'Android: without activity (or app.android.activity in averi.yaml) the launcher activity is picked arbitrarily — LeakCanary instead of the app on debug builds that bundle it; ' +
        'intent reaches non-launcher entry points (share/SEND) within the app\'s package and fails if no activity there handles it. ' +
        `iOS: returns once the tree source names the launched app (idb: the tree's Application label; WebDriverAgent: its active app, once WDA is running), waiting at most ${FOREGROUND_BUDGET}; a ⚠ line means it never saw the app — read again before trusting a read (the screenshot switches before the tree). ` +
          `With WebDriverAgent (treeSource auto/wda, build cached) the first launch on a simulator brings WDA up first (seconds, ≤ ${formatSeconds(READY_TIMEOUT_MS)}); ` +
          'under wda, a WDA that cannot come up fails the launch with nothing wiped or launched.',
      inputSchema: {
        platform,
        appId: z.string().describe('Android package name or iOS bundle id'),
        clearState: z.boolean().optional(),
        activity: z
          .string()
          .optional()
          .describe('Android only: activity to start (".MainActivity" or fully-qualified). Default app.android.activity when no intent is given'),
        intent: launchIntentInput
          .optional()
          .describe('Android only: am start parameters for custom entry points; without activity, resolved within the package (am start -p)'),
        configPath,
      },
    },
    async ({ platform: p, appId, clearState, activity: named, intent, configPath: cp }) => {
      const entry = { platform: p, appId, activity: named, intent };
      const { cfg, adapter } = await serve(p, TOOL_CONFIG.launch_app(entry), cp);
      return text(launchText(p, await launchApp(adapter, cfg, session, { appId, activity: named, intent, clearState })));
    },
  );

  registerTool(
    'terminate_app',
    {
      description: 'Force-stop an app.',
      inputSchema: { platform, appId: z.string(), configPath },
    },
    async ({ platform: p, appId, configPath: cp }) => {
      const { adapter } = await serve(p, TOOL_CONFIG.terminate_app(p), cp);
      await adapter.terminate(appId);
      return text(`Terminated ${appId} on ${p}`);
    },
  );

  registerTool(
    'open_deep_link',
    {
      description:
        'Open a deep link / universal link URL on the device. ' +
        `iOS, a link to the scheme of averi.yaml's iOS app: waits up to ${FOREGROUND_BUDGET} for it; names iOS's alert + its buttons' x/y; ⚠ = not seen in front: screenshot, answer any alert.`,
      inputSchema: { platform, url: z.string(), configPath },
    },
    async ({ platform: p, url, configPath: cp }) => {
      const { cfg, adapter } = await serve(p, TOOL_CONFIG.open_deep_link(p), cp);
      // The project's iOS app (D49a): a link to its own scheme waits until it is in front (adapters/ios.ts). On
      // android the policy reads no config, so none is handed over (and android.ts ignores it).
      const answer = await adapter.openDeepLink(url, { appId: cfg?.app.ios?.bundleId });
      return text(deepLinkText(p, url, answer));
    },
  );

  registerTool(
    'screenshot',
    {
      description:
        'Take a screenshot (PNG). Waits for the screen to be stable (two identical consecutive captures) before returning — inspect the image to verify UI state.',
      inputSchema: { platform, configPath },
    },
    async ({ platform: p, configPath: cp }) => {
      const { adapter } = await serve(p, TOOL_CONFIG.screenshot(p), cp);
      const frame = await captureFrame(adapter);
      const unsettled = unsettledNote(frame);
      const shot = image(await frame.shot.png());
      return { content: unsettled === undefined ? [shot] : [...text(unsettled).content, shot] };
    },
  );

  registerTool(
    'ui_snapshot',
    {
      description:
        'Normalized accessibility tree as JSON — cheap text-based verification. filter (a selector) returns only the matching nodes, without their children. Rects are in tree units (px on Android, pt on iOS). ' +
        `A filter that matches nothing returns [] plus a second text block: the tree's size and roles, or a ⚠ that the tree is bare (${BARE_TREE_CONTENTS}) — still loading, or stuck on a rendered screen: compare with screenshot, and never read the element as absent from a bare tree. ` +
        `iOS idb's stuck tree (a 0×0 Application) fails the call instead. Does not wait, but for one re-read of an unreadable first read; to wait for an element, assert polls (${ASSERT_BUDGET} by default; set "timeout" in the spec). ` +
        'iOS: an id: that finds nothing on screen is often idb (pinned, or auto without WDA), which drops React Native static text and containers, SwiftUI .contain containers, some UIKit ids — set app.ios.treeSource: wda and retry, or ask by text:/label:. ' +
        'An EMPTY textfield\'s "value" is often its placeholder; a node whose "placeholder" equals its value is an empty field. ' +
        'Marks: "presentation" ("alert", "actionSheet", "popover", "screen", "backdrop"; on an Android root "dialog"/"screen") — a layer presented over the screen, covering everything beneath it: targets there are refused until it is closed; ' +
        '"hidden": true (iOS wda) — listed but not shown (a tab bar a pushed screen hides), no cover; role "keyboard" (iOS wda) — the band where a tap is refused, while "ofKeyboard": true nodes are the keyboard\'s own, tappable UI; ' +
        '"heading": true (iOS) — drawn over the nodes listed after it that it overlaps (a pinned section header); "secure": true — a masked input, its value bullets; "readingOrder": true — its children are listed by location, not in draw order; "clipsDescendants", "clippedOut", "cutBounds" (Android) — a rect cut by its scroll container or by something drawn after it; "scrollAxis". ' +
        'Root marks name the tree source\'s dialect: "unclippedFrames" (iOS wda: frames as laid out, past their scroll view\'s), "flatList" (iOS idb: no nesting), "activeWindowOnly" (Android: only the active window is listed), "boundsCutAtScreen" (Android: a rect on the screen\'s edge may run on past it), "presentationsJudged": true (iOS wda: presentation was judged, so a layer with no "presentation" mark was not seen presented). ' +
        'Each mark in full: references/tools.md#ui_snapshot.',
      inputSchema: {
        platform,
        filter: z.string().optional().describe('Selector to filter nodes (quote values with spaces)'),
        configPath,
      },
    },
    async ({ platform: p, filter, configPath: cp }) => {
      const { adapter } = await serve(p, TOOL_CONFIG.ui_snapshot(p), cp);
      const tree = await adapter.uiTree({ settle: true });
      // An empty filter string is no filter, as `filter ? … : tree` always read it.
      const selector = filter || undefined;
      const matched = selector === undefined ? undefined : findAll(tree, selector).map(stripChildren);
      // The JSON first and unchanged; the note (if any) is a second block, as
      // screenshot's unsettledNote is — a parser of the first block sees what
      // it always saw.
      const note = snapshotNote(tree, matched === undefined || selector === undefined ? undefined : { selector, matched });
      const body = text(snapshotJson(matched ?? tree));
      return note === undefined ? body : { content: [...body.content, ...text(note).content] };
    },
  );

  registerTool(
    'tap',
    {
      description:
        'Tap an element by selector (preferred: \'id:login_button\', \'text:"Continue"\', \'role:button label~"Pay.*"\') or at x/y coordinates (sent as given, unguarded). ' +
        `With a selector, waits up to ${SETTLE_BUDGET} for the element to appear and hold still — a selector matching nothing is a wait, then "Timed out … to appear" (or "… to hold still" if it keeps moving); zero-area nodes are ignored. ` +
        'When several match it taps the only interactive one and says so; several interactive matches are REFUSED with the list — narrow the selector. ' +
        'A refusal taps nothing and names its cause and remedy: a centre off the screen, under the status bar, outside its scroll view (iOS wda), or a target cut to a strip too thin to tap → "scroll_until it first" (the refusal says when no scroll moves it); ' +
        'a centre under another element of the app drawn over it (a pinned button bar, a floating tab bar) → tapped on an uncovered part when enough shows (the reply says where), else REFUSED naming the cover; ' +
        'two controls iOS lists in reading order → one screenshot tells which is on top, and a refusal advises no scroll (close the menu or popover; if the target is on top, tap it by coordinates). ' +
        `Under a screen presented over the target the refusal says '${presentedRemedy('touch')}' instead, whatever else is wrong. ` +
        `On Android the tree lists the active window only: a target beneath a dialog or sheet is not in it, and the wait ends "… is not in the tree, which lists only the window presented on top …", or, when the window manager does not confirm the app\'s screen alone, "… to appear" with "(${ACTIVE_WINDOW_HINT})". ` +
        'A selector target under the soft keyboard: Android hides it (back) first; iOS wda taps the first on-screen entry of averi.yaml app.ios.keyboardDismiss, then tries averi\'s own drag — never the return key (it submits) — and when nothing hides it REFUSES: hide it yourself (tap a neutral element such as a title), then tap again; iOS idb marks no keyboard and refuses a centre below the keyboard\'s top line likewise. The keyboard\'s own keys and toolbar are tappable. ' +
        'iOS idb lists no scroll view, so a target past its scroll view\'s clip may be tapped on what lies there — set app.ios.treeSource: wda to have scroll views judged. ' +
        'Every case in full: references/tools.md#tap.',
      inputSchema: {
        platform,
        selector: z.string().optional().describe('Element to tap, e.g. \'id:login_button\' or \'text:"Sign in"\' (quote values with spaces)'),
        x: z.number().optional().describe('In tree units: px on Android, pt on iOS'),
        y: z.number().optional().describe('In tree units: px on Android, pt on iOS'),
        configPath,
      },
    },
    async ({ platform: p, selector, x, y, configPath: cp }) => {
      const served = await serve(p, TOOL_CONFIG.tap(p), cp);
      if (selector !== undefined) {
        const tapped = await tapElement(served.adapter, selector, acting(served));
        return text(claimed([served.adapter], tapText(selector, tapped)));
      }
      if (x === undefined || y === undefined) {
        throw new Error('Provide either selector or both x and y');
      }
      await served.adapter.tap(x, y);
      return text(`Tapped (${x}, ${y})`);
    },
  );

  registerTool(
    'swipe',
    {
      description:
        'Swipe across the screen, by direction OR by coordinates — exactly one of the two. ' +
        `direction (up/down/left/right) names the FINGER's movement (up reveals content below): a stroke through the screen centre, ${SWIPE_REACH} of the screen either side; ` +
        'the reply says when the screen size had to be estimated, and with none it refuses, sending nothing. ' +
        'Coordinates (fromX, fromY, toX, toY — all four) are sent as given, in tree units (px on Android, pt on iOS). To bring an element into view use scroll_until instead.',
      inputSchema: {
        platform,
        direction: z.enum(['up', 'down', 'left', 'right']).optional()
          .describe('Finger movement over the screen centre — instead of the four coordinates'),
        fromX: z.number().optional(), fromY: z.number().optional(),
        toX: z.number().optional(), toY: z.number().optional(),
        durationMs: z.number().optional(),
        configPath,
      },
    },
    async ({ platform: p, direction, fromX, fromY, toX, toY, durationMs, configPath: cp }) => {
      // Exactly one of the two, checked before a device is bound: the SDK
      // takes a raw shape, which cannot say "one of", so the handler does.
      const given = [fromX, fromY, toX, toY].filter((c) => c !== undefined).length;
      if (direction !== undefined) {
        if (given > 0) throw new Error('Provide either direction or fromX/fromY/toX/toY, not both');
        // The tree it reads is the one tap and scroll_until read: the iOS
        // tree source averi.yaml names, when there is one.
        const { adapter } = await serve(p, TOOL_CONFIG.swipe(p), cp);
        return text(swipeText({ direction, ...(await swipeScreen(adapter, { direction, meaning: 'finger', durationMs })) }));
      }
      if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
        throw new Error(
          given === 0
            ? 'Provide either direction (up/down/left/right) or all four of fromX, fromY, toX, toY'
            : 'Coordinates need all four of fromX, fromY, toX, toY (or use direction instead)',
        );
      }
      // Read no tree, but stroke through the same adapter as a direction (D41).
      const { adapter } = await serve(p, TOOL_CONFIG.swipe(p), cp);
      const stroke = { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
      await adapter.swipe(stroke.from, stroke.to, durationMs);
      return text(swipeText(stroke));
    },
  );

  registerTool(
    'type_text',
    {
      description:
        'Type text. Without selector: into whatever is focused, nothing read back. ' +
        `With selector: the field is resolved and focused like a tap (up to ${SETTLE_BUDGET} to appear; several interactive matches REFUSED with the list; off screen, covered or under a keyboard averi cannot hide → refused like tap, nothing typed), ` +
        'typed — APPENDING to pre-filled content unless clear: true deletes it first — then read back. "Filled …" only when the field shows the text (a dropped clear-fill is retried once); otherwise "Typed … — NOT verified" (or "Cleared …"/"Focused … — NOT verified") with the reason; a match that is not a textfield gets a ⚠ naming the nearest input. ' +
        'A text the app transforms (auto-capitalisation, autocorrect, a mask) FAILS the read-back, saying whether only letter case differs — never the text. If the tree cannot be re-read after typing, the call FAILS. ' +
        'A placeholder the tree reports as the value is not content. The keyboard is NOT dismissed afterwards (a flow\'s fill: has dismissKeyboard). ' +
        'Types printable ASCII, and under WDA (`wda`, or `auto` once up) also Latin, Greek, Cyrillic and Han letters, punctuation and symbols; anything else is refused before anything is sent (ADR 0037). ' +
        'Every case in full: references/tools.md#type_text.',
      inputSchema: {
        platform,
        text: z.string(),
        selector: z.string().optional().describe('Field to focus first, e.g. \'id:amount_input\' (quote values with spaces)'),
        clear: z.boolean().optional().describe('Delete existing content before typing (needs selector)'),
        configPath,
      },
    },
    async ({ platform: p, text: value, selector, clear, configPath: cp }) => {
      const served = await serve(p, TOOL_CONFIG.type_text(p), cp);
      if (selector === undefined) {
        if (clear) throw new Error('clear requires a selector (the field whose content to measure)');
        await typeIntoFocused(served.adapter, value);
        return text(typedText(value.length));
      }
      const fill = await fillField(served.adapter, selector, value, { ...acting(served), clear });
      return text(claimed([served.adapter], fillReply(fill, selector)));
    },
  );

  const [WHOLE, UNCOVERED] = HEDGE_WHATS;
  registerTool(
    'scroll_until',
    {
      description:
        'Swipe until the element is in the viewport. direction = where the content lies (down = below the current view). ' +
        'A default stop has the element\'s CENTRE on screen, below the status bar, clear of anything of the app drawn over it (a pinned or floating bar) and not cut to a strip too thin to tap; the rest may still be clipped — the reply says which edges and what fraction show, or "fully visible". ' +
        `Pass fully: true when the next step MEASURES the element (a rect/color/ocr assert, a screenshot): none of it may then be clipped, covered, under the keyboard, or under a system bar past ${SLACK} units (pt on iOS, px on Android), and the call fails naming the shortfall; on Android an unchecked cut or keyboard succeeds hedged ("${HEDGED_LEAD} ${WHOLE}"/"${HEDGED_LEAD} ${UNCOVERED}"; screenshot or call again). ` +
        'It fails, naming the cause, when swiping no longer moves the element out (the cover, the status bar, the cut), when content is exhausted, or at maxSwipes / timeoutMs (checked once a round, so a call can run past it by one swipe and one more read). ' +
        `It never swipes on a screen presented over the target — a swipe there could dismiss it — and fails "… ${presentedStop()}". ` +
        'Where no tree shows such a layer (iOS idb), a swipe that CHANGES THE SCREEN stops the call. ' +
        'Two controls iOS lists in reading order are judged on one screenshot, as for tap; with the target not seen on top it stops before any swipe. ' +
        'A top bar the tree lists before the scroll view (iOS\'s navigation bar under wda) is not seen: check a stop near the top with a screenshot. ' +
        'With the soft keyboard up the viewport is the screen above it; nothing is pressed to hide it (press_key back first on Android to use the whole screen). ' +
        'Every case in full: references/tools.md#scroll_until.',
      inputSchema: {
        platform,
        selector: z.string().describe('Element to scroll into view, e.g. \'id:submit_button\' (quote values with spaces)'),
        direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Default down'),
        maxSwipes: z.number().int().min(1).optional().describe(`Default ${DEFAULT_MAX_SWIPES}`),
        fully: z
          .boolean()
          .optional()
          .describe('Require the element ENTIRELY inside the viewport and uncovered, not just its centre. Default false'),
        timeoutMs: z.number().nonnegative().finite().optional().describe(`Default ${DEFAULT_SCROLL_TIMEOUT_MS}`),
        within: z
          .union([z.string(), z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()])
          .optional()
          .describe('The scroll view to swipe until the element is first read: a selector of it or of an element inside it (its nearest scroll view), or its rect from ui_snapshot / a failure reply. Default: the screen\'s largest.'),
        configPath,
      },
    },
    async ({ platform: p, selector, direction, maxSwipes, fully, timeoutMs, within, configPath: cp }) => {
      const { adapter, eyes } = await serve(p, TOOL_CONFIG.scroll_until(p), cp);
      // The eyes a `fully visible` claim is confirmed with (ui-tree/eyes.ts), served here: interact/ may not import verify/.
      const result = await scrollUntilVisible(adapter, selector, { direction, maxSwipes, fully, timeoutMs, within, eyes });
      const reply = `Element ${selector} ${describeScrollResult(result)}`;
      return text(claimed([adapter], reply));
    },
  );

  registerTool(
    'press_key',
    {
      description: 'Press a hardware/system key. back is Android-only.',
      inputSchema: { platform, key: z.enum(['back', 'home', 'enter']), configPath },
    },
    async ({ platform: p, key, configPath: cp }) => {
      const { adapter } = await serve(p, TOOL_CONFIG.press_key(p), cp);
      await adapter.pressKey(key);
      return text(`Pressed ${key}`);
    },
  );

  registerTool(
    'ensure_state',
    {
      description:
        `Get the app into a named state from averi.yaml (e.g. "logged_in"): detects if already there, otherwise runs the reach flows (login etc.) and confirms. Idempotent — always prefer this over manual login taps. ` +
        `If the tree is unreadable or holds nothing rendered for the whole ~${ENSURE_BUDGET} second look, a destructive reach flow (clearState, or destructive: true) is refused rather than run blind: "Refused to run reach flow …" and a ⛔ trace line — nothing was wiped; compare with screenshot and retry once the screen has rendered, or run_flow the rung deliberately. ` +
        'Returns the step trace and a final settled screenshot.',
      inputSchema: {
        platform,
        state: z.string().describe('State name from averi.yaml'),
        configPath,
        environment,
      },
    },
    async ({ platform: p, state, configPath: cp, environment: envName }) => {
      const project = await loadForCall(TOOL_CONFIG.ensure_state(), cp);
      const { text: report, shot } = await runEnsureState(
        { state, project, environment: envName, session },
        (cfg) => deviceFor(p, cfg),
      );
      // No image when the final capture failed — the report's ⚠ screenshot: line says why.
      return { content: [...text(report).content, ...(shot === undefined ? [] : [image(shot)])] };
    },
  );

  registerTool(
    'run_flow',
    {
      description:
        'Run a named flow from averi.yaml (e.g. "goto_transfers"). Honors the flow\'s `requires:` state. Returns the step trace.',
      inputSchema: {
        platform,
        flow: z.string().describe('Flow name from averi.yaml'),
        configPath,
        environment,
      },
    },
    async ({ platform: p, flow, configPath: cp, environment: envName }) => {
      const project = await loadForCall(TOOL_CONFIG.run_flow(), cp);
      return text(
        await runNamedFlow({ flow, project, environment: envName, session }, (cfg) => deviceFor(p, cfg)),
      );
    },
  );

  registerTool(
    'assert',
    {
      description:
        'Run declarative checks against the current screen (forms: see asserts): element present (default) / absent / text exact / match regex; ' +
        'rect geometry vs Figma-frame values (deltas in % of screen width; y is measured but never fails); color fill vs an expected hex (CIEDE2000; hex only, token names resolve upstream); ' +
        'ocr — the text the element RENDERS, read off the screenshot, which the tree often lacks (iOS merges a button into an authored a11y summary): exact with whitespace runs folded and case kept, a reading differing only in what the recognizer cannot tell apart (typographic punctuation, diacritics) passes with a note; heightPct = ink height in % of screen width, single-line only; macOS-only, fails closed elsewhere; ' +
        'screenshot pixel-diff vs a stored baseline (created on first use under .averi/baselines/; on iOS the status band (top safe area) is left out of a baseline diff). Prefer element asserts (deterministic, cheap) over screenshots. ' +
        'A color/ocr assert never measures what covers its element: under the soft keyboard, the status bar or the Android navigation bar, another element of the app drawn over it, off the screen, or outside its scroll view (iOS wda), it fails closed naming what and where, and the poll goes on — scroll_until it with fully: true first, or assert something clear of it; ' +
        `under a screen presented over the element it says '${presentedRemedy('pixel')}'. Under iOS idb, which lists no scroll view, a color region reading as the screen beside it fails closed — measure under treeSource: wda. ` +
        'On Android an element not in the tree may lie beneath a dialog or sheet (only the active window is listed): the "not found within …" says so. ' +
        'A match (element or ocr) that is not a valid JavaScript regex is refused before any device is touched. With averi.yaml naming the app, an appAlive health line follows the results. ' +
        `Budgets: an assert without its own timeout waits up to ${ASSERT_BUDGET} (tree asserts) or ${PIXEL_ASSERT_BUDGET} (color/ocr); a pass returns at once, a failing color/ocr assert polls out its whole budget — pass timeout to shorten it — and one that can never be measured (a refused screenshot, no usable recognizer) fails after one read. ` +
        'Every case in full: references/tools.md#assert.',
      inputSchema: { platform, asserts: assertsInput, configPath },
    },
    async ({ platform: p, asserts, configPath: cp }) => {
      const specs = parseAsserts(asserts);
      // One read for both of its uses — the iOS tree source and the health
      // line — under the `optional` policy on both platforms: assert works
      // configless, but a broken averi.yaml fails it rather than silently
      // costing the health line (android) or the tree source (ios).
      const { cfg, adapter } = await serve(p, TOOL_CONFIG.assert(), cp);
      return text(await runAsserts({ adapter, specs, baselineDir: baselineDirFor(cp), cfg }));
    },
  );

  registerTool(
    'verify',
    {
      description:
        'THE verification tool: run the same sequence — optional ensure_state, optional flow, then asserts — on the requested platforms (default both android and ios) and return per-platform results plus screenshots. ' +
        'The legs run concurrently and are reported android-then-ios regardless of input order, one image per leg that returned a screenshot (a leg whose section says FAILED or `⚠ screenshot:` has none). ' +
        'Single-platform work passes platforms: ["android"] or ["ios"]; for cross-platform tasks, run the default (both) before declaring the task done. ' +
        'contract appends rect, color and text parity tables (see contract). A contract field a requested table cannot read, or an environment averi.yaml does not declare, REFUSES the call before any device is touched, listing each.',
      inputSchema: {
        platforms: z
          .array(platform)
          .nonempty()
          .optional()
          .describe('Platforms to verify (default: both); duplicates collapse'),
        state: z.string().optional().describe('State to ensure first (from averi.yaml)'),
        flow: z.string().optional().describe('Flow to run (from averi.yaml)'),
        asserts: assertsInput.optional(),
        contract: z
          .string()
          .optional()
          .describe(
            'Path to a layout-contract JSON ({screen, tolerance_pct, tolerance_aspect_pct, figma_frame_width, anchors:[{id,x?,y?,w?,h?,aspect?,bg?,bg_dark?,sample?,text?,text_dynamic?}]}, Figma-frame units). ' +
              'Appends "## rect parity": geometry per anchor in % of screen width, plus an android-vs-ios aspect row (set aspect: false on an anchor whose height the platforms derive differently, with the reason beside it; tolerance_aspect_pct defaults to tolerance_pct). ' +
              'Anchors with bg (hex) get "## color parity" sampled from the legs\' screenshots (android-vs-ios dE primary at tolerance_de, default ' + DEFAULT_TOLERANCE_DE + '; vs-contract at ' + CONTRACT_TOL_FACTOR + 'x; anchors without bg android-vs-ios only); always the LIGHT axis — bg_dark is not checked. ' +
              'Anchors with text (the exact rendered string) or text_dynamic: true (amounts, dates) get "## text parity": the copy read by OCR, compared android-vs-ios and vs the contract, plus ink height (tolerance_size_pct, default ' + DEFAULT_SIZE_TOLERANCE_PCT + '%); OCR is macOS-only, elsewhere the table falls back to the tree and says so. ' +
              'More: references/tools.md#verify.',
          ),
        configPath,
        environment,
      },
    },
    async ({ platforms: requested, state, flow, asserts, contract: contractPath, configPath: cp, environment: envName }) => {
      const project = await loadForCall(TOOL_CONFIG.verify(), cp);
      // Parsed before the contract is read: a malformed assert spec is the
      // caller's most likely mistake, and it stays the error they see when both
      // are wrong.
      const specs = parseAsserts(asserts ?? []);
      // The contract goes down as the PATH: run/verify.ts reads, parses and
      // validates it before it resolves any adapter, so a typo'd path or a bad
      // field value never costs a device run — and the pre-flight has one owner.
      const { sections, screenshots } = await runVerification(
        {
          platforms: normalizePlatforms(requested),
          cfg: project.cfg,
          env: project.env,
          specs,
          state,
          flow,
          contractPath,
          environment: envName,
          session,
          baselineDir: baselineDirFor(cp),
        },
        (p) => deviceFor(p, project.cfg),
      );
      return { content: [...text(sections.join('\n\n')).content, ...screenshots.map(image)] };
    },
  );

  registerTool(
    'get_logs',
    {
      description:
        'Device logs (logcat / os_log) since N seconds ago — scan for crashes and exceptions. Prefer grep (a case-insensitive JavaScript regex, e.g. "tpm|validation"): unfiltered pulls run to thousands of lines. ' +
        'Only the LAST maxLines matching lines come back; the header reports how many matched against how many are shown. An invalid grep is refused before any device is touched.',
      inputSchema: {
        platform,
        sinceSeconds: z.number().default(60).describe('How far back to read'),
        // Validated with the flags formatLogExcerpt compiles it with, so a bad
        // pattern is refused with the arguments — before the device is
        // resolved and its logs pulled — instead of throwing after the pull.
        grep: regexSource(LOG_GREP_FLAGS)
          .optional()
          .describe('Case-insensitive regex; only matching lines are returned'),
        maxLines: z
          .number()
          .int()
          .positive()
          .default(LOG_MAX_LINES)
          .describe(`Keep only the last N matching lines (default ${LOG_MAX_LINES}); a broad grep can match thousands — raise it deliberately`),
        configPath,
      },
    },
    async ({ platform: p, sinceSeconds, grep, maxLines, configPath: cp }) => {
      const { adapter } = await serve(p, TOOL_CONFIG.get_logs(p), cp);
      const all = await adapter.logs(Date.now() - sinceSeconds * 1000);
      return text(formatLogExcerpt(all, grep, maxLines));
    },
  );

  return server;
}

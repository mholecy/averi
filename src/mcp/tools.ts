import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AdapterOpts, AdapterRegistry } from './registry.js';
import { BARE_TREE_CONTENTS } from '../ui-tree/bare-tree.js';
import { findAll } from '../ui-tree/selectors.js';
import { presentedRemedy, presentedStop } from '../ui-tree/standing.js';
import type { MarkedLayer } from '../ui-tree/presentation.js';
import { fillField } from '../interact/fill.js';
import { fillReply } from '../interact/fill-text.js';
import { typeIntoFocused } from '../interact/type-text.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '../interact/resolve.js';
import type { GuardOptions } from '../interact/keyboard.js';
import { DEFAULT_MAX_SWIPES, DEFAULT_SCROLL_TIMEOUT_MS, describeScrollResult, scrollUntilVisible } from '../interact/scroll.js';
import { SWIPE_REACH_FRACTION, swipeScreen } from '../interact/swipe.js';
import { tapElement } from '../interact/tap.js';
import { launchText, snapshotNote, swipeText, tapText, typedText } from './tool-text.js';
import { EngineSession, launchApp } from '../flow/launch.js';
import { appBuildPath } from '../flow/load.js';
import { iosToolSettings, loadForCall, type IosToolSettings } from '../flow/tool-config.js';
import { TOOL_CONFIG } from './config-policy.js';
import { ASSERT_TIMEOUT_MS, assertSpecSchema, PIXEL_ASSERT_TIMEOUT_MS } from '../verify/assert.js';
import { DEFAULT_ENSURE_TIMEOUT_MS } from '../flow/engine.js';
import { formatSeconds } from '../util/duration.js';
import { captureFrame, unsettledNote } from '../verify/capture.js';
import { CONTRACT_TOL_FACTOR, DEFAULT_TOLERANCE_DE } from '../verify/color-parity.js';
import { OFF_THE_SCREEN, OUTSIDE_ITS_SCROLL_VIEW, TOO_THIN_IN_ITS_SCROLL_VIEW, TOO_THIN_ON_THE_SCREEN } from '../verify/pixel-poll.js';
import { DEFAULT_SIZE_TOLERANCE_PCT } from '../verify/text-parity.js';
import { baselineDirFor, runAsserts, runEnsureState, runNamedFlow } from '../run/commands.js';
import { formatLogExcerpt, LOG_GREP_FLAGS, LOG_MAX_LINES, runVerification } from '../run/verify.js';
import { normalizePlatforms } from './platforms.js';
import { regexSource } from '../util/regex.js';
import type { Platform, UiNode } from '../adapters/types.js';
import { FOREGROUND_WAIT_MS } from '../adapters/ios-foreground.js';
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
 * reads averi.yaml starts with the same line, `loadForCall(TOOL_CONFIG.<tool>(…), cp)`
 * — the read stays here, above run/, so the policy has one caller shape
 * and nothing below reads the file again.
 */

const platform = z.enum(['android', 'ios']).describe('Target platform');

const configPath = z
  .string()
  .optional()
  .describe(
    'Path to averi.yaml (default: ./averi.yaml in the server working directory). Paths INSIDE it — the build paths, .env.averi, .averi/baselines/ — resolve against the file, so a config in a subdirectory needs nothing else. ' +
      'Read only when this call uses a value from it; a call that reads it fails on an invalid file (naming it) rather than ignoring it, and a missing file fails only the tools that cannot work without one (ensure_state, run_flow, verify, install_app without a path).',
  );

const environment = z
  .string()
  .optional()
  .describe(
    'Credential environment from averi.yaml `environments:` (e.g. "starterkit") — pass when the build under test points at a different backend than usual. Defaults to $AVERI_ENV (settable in .env.averi), then `defaultEnvironment:`.',
  );

/**
 * registry.get opts from a call's iOS settings — plumbs app.ios.treeSource,
 * the tree-source kind, to the registry. The one spelling for every handler:
 * each passes `iosToolSettings(cfg, p)` of its loaded config (which gives
 * android nothing), and tap / type_text, which also hand the dismissals to
 * the guard, pass the settings they already hold.
 */
const treeOpts = (settings: IosToolSettings): AdapterOpts => ({ treeSource: settings.treeSource });

/**
 * How the tools act on an element (tap and type_text with a selector): an
 * ambiguous selector is REFUSED — an agent exploring through the tools has
 * not seen the tree it would be guessing in (interact/resolve.ts, Ambiguity;
 * a flow step picks the first, flow/engine.ts#FLOW_AMBIGUITY) — and the
 * call's dismissals go to the keyboard guard. Given once, as treeOpts is,
 * not spelled out per handler; a fill adds its
 * `clear`.
 */
const guardOpts = (settings: IosToolSettings): Pick<GuardOptions, 'ambiguous' | 'dismissals'> => ({ ambiguous: 'refuse', dismissals: settings.dismissals });

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
const FOREGROUND_BUDGET = formatSeconds(FOREGROUND_WAIT_MS); // adapters/ios-foreground.ts
const SLACK = PIXEL_OVERLAP_SLACK; // ui-tree/geometry.ts
const SWIPE_REACH = `${Number((SWIPE_REACH_FRACTION * 100).toFixed(2))}%`; // interact/swipe.ts
/** An alert as the presented remedy names one, its title elided — what the descriptions quote it with (ui-tree/standing.ts#presentedRemedy, #presentedStop). */
const AN_ALERT: MarkedLayer = { kind: 'alert', label: '…' };
/** Android's floating window as the presented remedy names it (adapters/android.ts#presentedWindow). */
const A_DIALOG: MarkedLayer = { kind: 'dialog' };

const assertsInput = z
  .array(z.unknown())
  .describe(
    'Assert specs, e.g. [{"element":{"id":"transfer_form"}}, {"element":{"id":"error_banner"},"absent":true}, ' +
      '{"element":{"id":"amount"},"text":"100.00"}, {"screenshot":{"baseline":"transfers","threshold":0.01}}, ' +
      '{"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}} (Figma-frame units; y measured but never fails), ' +
      '{"element":{"id":"card"},"color":{"expected":"#FDFDFD","deltaE":8,"sample":"dominant"}} (fill vs hex, CIEDE2000), ' +
      '{"element":{"id":"cta"},"ocr":{"text":"CONTINUE","heightPct":2.96}} (what the element RENDERS, read back from the screenshot — ' +
      'not the same question as "text", which reads the accessibility tree: on iOS a button\'s visible label is often absent from the tree ' +
      'entirely; heightPct pins rendered ink height in % of screen width, single-line elements only; macOS-only)]',
  );

const parseAsserts = (raw: unknown[]) => raw.map((a) => assertSpecSchema.parse(a));

function stripChildren(node: UiNode): Omit<UiNode, 'children'> {
  const { children: _children, ...rest } = node;
  return rest;
}

export interface AveriServerDeps {
  /** Resolves a platform to a device-bound adapter. The caller owns its lifetime (shutdown). */
  registry: AdapterRegistry;
  /** Reported as `serverInfo.version` in the MCP handshake — the package's own (util/version.ts). */
  version: string;
}

/** Build the averi MCP server with all its tools registered. Does not connect it. */
export function createAveriServer({ registry, version }: AveriServerDeps): McpServer {
  const server = new McpServer({ name: 'averi', version });

  const registerTool: typeof server.registerTool = server.registerTool.bind(server);

  // The session's state that outlives one engine run — the clearState count
  // (flow/launch.ts#EngineSession). One per server: the server IS the
  // session. Every tool that runs the engine (ensure_state, run_flow, verify)
  // hands it down, and launch_app, which wipes through the same launch. Not
  // a module global in the engine, which every server in the process would
  // share.
  const session = new EngineSession();

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
        'Pin which booted device subsequent tools target for a platform. Without a pin, tools use the ' +
        'first booted device adb/simctl lists — ambiguous when a phone, an emulator, and a watch are all ' +
        'connected. The pin lasts for the server session; a pinned device going offline is an error, ' +
        'never a silent fallback to another device.',
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
        'Install an app build (.apk / .app bundle) on the booted device. Omit path to use the build path from averi.yaml (app.android.apk / app.ios.app), which is resolved relative to averi.yaml itself — no need to pre-absolutize it when the config sits in a subdirectory.',
      inputSchema: {
        platform,
        path: z.string().optional().describe('Path to .apk (android) or .app (ios)'),
        configPath,
      },
    },
    async ({ platform: p, path, configPath: cp }) => {
      // An explicit path asks nothing of averi.yaml: the `??` is why install_app's
      // `required` entry applies only to a call without one.
      const appPath = path ?? appBuildPath((await loadForCall(TOOL_CONFIG.install_app(), cp)).cfg, p);
      await (await registry.get(p)).install(appPath);
      return text(`Installed ${appPath} on ${p}`);
    },
  );

  registerTool(
    'launch_app',
    {
      description:
        'Launch an app by package name / bundle id. clearState wipes app data first (forces fresh login); the reply then carries a ' +
        '⚠ clearState line counting the wipes this server session has made, flow launches included. ' +
        'Android: activity pins the entry point — without it (and without app.android.activity in ' +
        'averi.yaml) the launcher activity is picked arbitrarily, which opens LeakCanary instead of the ' +
        'app on debug builds that bundle it. intent exercises non-launcher entry points (share/SEND); an intent ' +
        "without an activity is delivered within the app's package (never to another app, and not to " +
        'app.android.activity), and fails if no activity there handles it. averi.yaml is read only for that fallback (android, neither activity nor intent named), and an invalid one then fails the call instead of launching without its activity. ' +
        "iOS (idb tree source): returns once the UI tree is the launched app's — for a second or two after an app switch idb still " +
        `lists the previous app's tree, on which an absent assert would pass — waiting at most ${FOREGROUND_BUDGET}; when it never ` +
        'saw the app, the reply carries a ⚠ line naming what the tree showed: compare with screenshot before trusting a read.',
      inputSchema: {
        platform,
        appId: z.string().describe('Android package name or iOS bundle id'),
        clearState: z.boolean().optional(),
        activity: z
          .string()
          .optional()
          .describe('Android only: activity to start (".MainActivity" or fully-qualified). Defaults to app.android.activity from averi.yaml when no intent is given either.'),
        intent: launchIntentInput
          .optional()
          .describe('Android only: am start parameters for custom entry points. Without activity, resolved within the package (am start -p).'),
        configPath,
      },
    },
    async ({ platform: p, appId, clearState, activity: named, intent, configPath: cp }) => {
      const entry = { platform: p, appId, activity: named, intent };
      const { cfg } = await loadForCall(TOOL_CONFIG.launch_app(entry), cp);
      return text(launchText(p, await launchApp(await registry.get(p), cfg, session, { appId, activity: named, intent, clearState })));
    },
  );

  registerTool(
    'terminate_app',
    {
      description: 'Force-stop an app.',
      inputSchema: { platform, appId: z.string() },
    },
    async ({ platform: p, appId }) => {
      await (await registry.get(p)).terminate(appId);
      return text(`Terminated ${appId} on ${p}`);
    },
  );

  registerTool(
    'open_deep_link',
    {
      description: 'Open a deep link / universal link URL on the device.',
      inputSchema: { platform, url: z.string() },
    },
    async ({ platform: p, url }) => {
      await (await registry.get(p)).openDeepLink(url);
      return text(`Opened ${url} on ${p}`);
    },
  );

  registerTool(
    'screenshot',
    {
      description:
        'Take a screenshot (PNG). Waits for the screen to be stable (two identical consecutive captures) before returning — inspect the image to verify UI state.',
      inputSchema: { platform },
    },
    async ({ platform: p }) => {
      const frame = await captureFrame(await registry.get(p));
      const unsettled = unsettledNote(frame);
      return { content: unsettled === undefined ? [image(frame.shot)] : [...text(unsettled).content, image(frame.shot)] };
    },
  );

  registerTool(
    'ui_snapshot',
    {
      description:
        'Normalized accessibility tree as JSON — cheap text-based verification. Optional selector filter (e.g. \'role:button\', \'id:login_button\', \'label~"Pay.*"\') returns only matching nodes. ' +
        'iOS: if `id:` finds nothing for a container — React Native static text/containers (identifier: null everywhere), a SwiftUI `.accessibilityElement(children: .contain)` identifier — that is the default idb tree source, which never exposes container identifiers — set `app.ios.treeSource: wda` in averi.yaml and retry, or use a button/row id. ' +
        `A filter that matches nothing returns [] plus a second text block: the unfiltered tree size and roles, or — when the tree holds ${BARE_TREE_CONTENTS} — a ⚠ that the accessibility tree is empty or unrendered: still loading, or stuck empty on a rendered screen. Compare with screenshot before reading the element as absent. On iOS idb the measured stuck tree (a 0×0 Application, for minutes on a rendered screen) fails the call instead, naming it; assert polls (${ASSERT_BUDGET} by default; set "timeout" in the spec). Does not itself wait, but for one re-read a second later of an unreadable first read (Android's "null root node", iOS idb's empty tree — a launch's first second or a stuck idb); an iOS error that says it was retried was still empty a second later. ` +
        'iOS wda with the software keyboard up: one node has role "keyboard" — its rect is the band the keyboard covers (keys, AutoFill bar, accessory toolbar slot), where a tap is refused — and the two Windows that ARE the keyboard\'s UI carry "ofKeyboard": true (their descendants — keys, Done, the Passwords bar — are tappable); an input-accessory toolbar (the Done above a number pad) has role "toolbar". ' +
        'iOS wda: a node carrying "hidden": true lies in a subtree whose ROOT — any element but a structural wrapper — WebDriverAgent reports neither visible nor accessible, and every node of which it reports not visible (a descendant may be accessible: a hidden tab button\'s icon), e.g. a tab bar a pushed screen hides, still listed at its old place — it is no cover of what lies under it (a screen presented over that element covers it all the same, through the layer WebDriverAgent shows presented — "presentation", below); ' +
        'and the content of a table cell not yet laid out (the cell wholly outside its scroll view), which WebDriverAgent lists at a parked frame inside that scroll view, is given at its cell\'s rect — so a tap on it is refused as off screen and scroll_until scrolls to it. ' +
        'iOS wda: a layer (a Window\'s direct child) WebDriverAgent shows presented carries "presentation": "alert" when it holds an alert (WebDriverAgent\'s `Alert`, which carries "presentationElement": true; likewise "actionSheet" and "popover"), or "presentation": "screen" when every node of the screen-sized layer beneath reads not visible while it shows (a sheet, a modal) — and the root carries "presentationsJudged": true whenever the payload has visibility flags. Such a layer covers the whole screen beneath it, whatever lies around it, and its own buttons and texts are reached. Under an alert, tap and scroll_until refuse a target there naming the alert (\'' + presentedRemedy('it', AN_ALERT) + '\'), color/ocr fail closed likewise (\'' + presentedRemedy('the element', AN_ALERT) + '\'), and an action sheet or a popover is named the same way; under a "screen" layer they name what of that layer lies at the point — the layer itself where nothing of it draws — and say \'' + presentedRemedy('it') + '\'. ' +
        'An EMPTY textfield\'s "value" is often its hint or placeholder text — every tree source reports it that way; where the source also names it (iOS wda, an Android dump with a hint attribute) the node carries "placeholder", and a value equal to it is an empty field. ' +
        'The ROOT says the tree source\'s dialect: "unclippedFrames": true under iOS wda — every frame as laid out, a scroll view\'s content past the scroll view\'s frame too, where nothing of it is drawn (tap, scroll_until and color/ocr judge only what the scroll view draws); "flatList": true under iOS idb — every element a sibling of one rectless root, no nesting; "activeWindowOnly": true under Android — uiautomator lists the active window only, and when that root also carries "presentation" ("dialog": a window floating off the screen\'s top and left edges, an AlertDialog; "screen": a window whose clickable scrim lies above its sheet, a bottom sheet) the screen beneath is not in the tree at all — tap, fill and scroll_until say \'' + presentedRemedy('it', A_DIALOG) + '\' for a target not found there. ' +
        'A scroll view whose type says the one axis it scrolls on carries "scrollAxis" ("vertical" or "horizontal"): on Android by its class (ScrollView, ListView vertical; HorizontalScrollView, ViewPager horizontal — a Compose lazy list or a RecyclerView carries none), under iOS wda a Table (vertical); scroll_until strokes along a scroll view of its own axis and keeps the stroke off a nested one of the other (under wda a scroll view\'s axis is also read from its content laid out past its frame, which ui_snapshot does not print). ' +
        'Android: a node that scrolls (scrollable="true" in uiautomator; a Compose scroller keeps role "container") carries "clipsDescendants": true — every rect under it is already cut to its rect, so a row whose edge sits exactly on that rect may be partly hidden there; ' +
        'a node carrying "clippedOut" ("top", "bottom", "left", "right") was dumped with inverted bounds — clipped out above, below, left or right of its scroll container, scrolled past it — and its rect is zero-size at that edge; ' +
        'a node carrying "cutBounds" was dumped cut short of its own children by something drawn after it over part of it (e.g. a sticky header): "cutBounds" is the rect as dumped, "rect" its children\'s extent, which averi judges — a tap on such a row whose part clear of the header is too small to tap is refused (scroll_until it first), where before it tapped the strip that showed. ' +
        'One dump cannot tell a sticky header from the NEXT row of the same list, so a row whose touch target overflows into the next row also carries "cutBounds" — a permanent limit, not a bug; a screen-sized wrapper with nothing of its own there (a snackbar host) never causes it.',
      inputSchema: {
        platform,
        filter: z.string().optional().describe('Selector to filter nodes'),
        configPath,
      },
    },
    async ({ platform: p, filter, configPath: cp }) => {
      const { cfg } = await loadForCall(TOOL_CONFIG.ui_snapshot(p), cp);
      const tree = await (await registry.get(p, treeOpts(iosToolSettings(cfg, p)))).uiTree({ settle: true });
      // An empty filter string is no filter, as `filter ? … : tree` always read it.
      const selector = filter || undefined;
      const matched = selector === undefined ? undefined : findAll(tree, selector).map(stripChildren);
      // The JSON first and unchanged; the note (if any) is a second block, as
      // screenshot's unsettledNote is — a parser of the first block sees what
      // it always saw.
      const note = snapshotNote(tree, matched === undefined || selector === undefined ? undefined : { selector, matched });
      const body = text(matched ?? tree);
      return note === undefined ? body : { content: [...body.content, ...text(note).content] };
    },
  );

  registerTool(
    'tap',
    {
      description:
        'Tap an element by selector (preferred: \'id:login_button\', \'text:"Continue"\', \'role:button label~"Pay.*"\') or by x/y coordinates. ' +
        'Selector values containing spaces must be double-quoted: text:"Sign in" (exact) or text~"Sign in" (regex) — an unquoted text:Sign in fails at "in". ' +
        `With a selector, waits up to ${SETTLE_BUDGET} for the element to appear and hold still (same policy as a flow tap: step) and fails with "Timed out … to appear" ` +
        'if it never shows (or "… to hold still (found, but never at the same position in two consecutive reads)" if it shows but keeps moving (also when one read took the whole budget and the one more read taken after it finds the element at a different position), "… (found once / on the last read, but no second read came …)" or "… (found once; the one read after the budget did not find it again)" if one read took the whole budget) — a selector matching nothing is a wait, not an immediate error. Ignores zero-area nodes (a timeout whose selector matched only 0×0 nodes says so — iOS reports a node scrolled above the top that way; on Android one dumped clipped out of its scroll container is named so, with the scroll_until direction that brings it back); ' +
        'a target whose centre lies OFF the screen (iOS keeps a scroll view\'s content below the fold in the tree, with its real rect) — or under the status bar (on iOS the top safe-area inset, 62 pt on a 402x874 iPhone, where a tap scrolls the app to its top; on Android the visible system status bar, 66 px on a 1080x2220 phone, under which an edge-to-edge app draws — a portrait screen only) — is REFUSED, nothing tapped — scroll_until it first (a plain scroll_until stops once its centre is on screen, below the status bar, and clear; fully: true when the next step measures it), unless a screen is presented over the target (below); a target PINNED under the status bar (in no scroll view: a layout that does not keep clear of it) is refused too, and no scroll moves it — the refusal says which, as far as the tree can tell (an idb tree cannot: it names both); ' +
        'a target whose centre lies under another element of the app drawn over it (a pinned button bar, a floating tab bar) is tapped on a part of it nothing is drawn over — never under the status bar — when one is large enough (about 6 % of the screen\'s shorter side each way), and the response says where and what covered the centre; with less showing it is REFUSED, naming the cover, nothing tapped — scroll_until it first, unless the cover is a screen presented over the target (below). ' +
        'On iOS with treeSource: wda a target whose centre lies on the screen but outside its scroll view (WebDriverAgent lists a scroll view\'s content at its laid-out rect past the scroll view\'s frame, which draws none of it there — a form\'s row below a pinned button bar) is REFUSED as off screen, naming the scroll view, nothing tapped — scroll_until it first — after the keyboard is hidden (a scroll view laid out above the keyboard grows back), unless a screen is presented over the target (below). ' +
        'A target its scroll container cuts to a strip thinner than that minimum (Android: its rect flush with the container\'s edge, its own content running on past it) is REFUSED likewise, nothing tapped — scroll_until it first (the refusal names the direction when the cut is not at the bottom), unless a screen is presented over the target (below). ' +
        'So is a control Android dumps as a strip thinner than that minimum flush against an element drawn after it that spans it (Compose leaves out of a node\'s bounds what a later node covers: a field under a submit bar riding on the soft keyboard) — the refusal names that element, where the strip lies and how much of it shows (above the keyboard, when it is up), and says: with the keyboard up and that element riding on it (ending just above the keyboard), dismiss the keyboard first (a bar riding on it goes down with it), or scroll_until it out from under that element; only if a screenshot shows the control whole and only that thin (the tree cannot tell), no scroll shows more: tap it by coordinates. ' +
        'A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over all of its rect, unless, among others, it is the screen\'s size (90 % of it or more), or it has no label and no value and holds the target together with the target\'s whole scroll view, or it has no label, value or identifier and holds only empty frames — since the tree cannot tell a host that swallows touches (a tab bar\'s) from a transparent one that only positions its child (an Android floating action button\'s full-width host, e.g. Clock\'s fab_container): a target beside or under such a FAB can be refused naming the container. ' +
        'When such a wrapper holds one child only, a control of at most a quarter of its area, the refusal says so in place of "scroll_until it first": \'the wrapper may only position its one child, <child>: tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first\'; a wrapper of several children (a tab bar\'s host) gets no such line. ' +
        'Under a screen presented over the target — iOS wda: a layer WebDriverAgent shows presented (see ui_snapshot\'s "presentation"; an alert, an action sheet or a popover is named as ui_snapshot says); elsewhere (Android): a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window — the refusal says so instead of "scroll_until it first" or the status bar\'s advice, whatever else keeps the target from a tap — its centre under that screen, off the screen or under the status bar (wholly too: the screen is judged presented over the target itself, wherever it lies), or a cut at its scroll container\'s edge: ' +
        `'${presentedRemedy('it')}'. Close that screen first. ` +
        'A full-screen host that only carries a bar or other content of its own (a host with children) is no such screen: only what it draws covers. ' +
        'On Android uiautomator lists the active window only: with a dialog or a bottom sheet up the tree holds that window alone (ui_snapshot\'s root carries "presentation": "dialog" or "screen"), so a target beneath it is not in the tree, and the wait for it (this tap\'s, and fill\'s) ends "Timed out after …: element … is not in the tree, which lists only the window presented on top … — ' + presentedRemedy('it', A_DIALOG) + '" instead of "… to appear". ' +
        'when several match taps the only interactive one and says so; if several interactive elements match it refuses and lists them — narrow the selector. ' +
        'On Android a selector target lying under the soft keyboard is not tapped through it: the keyboard is hidden (back) and the element found again first, and the response says so; coordinate taps are sent as given. ' +
        'On iOS with treeSource: wda a target COVERED by the on-screen keyboard (its band: keys, AutoFill bar, accessory toolbar slot) is hidden first by tapping the first entry of averi.yaml app.ios.keyboardDismiss that is on screen (a tap: on a neutral element such as the title, or accessory: true for the input-accessory toolbar\'s Done), the element found again, then tapped — the response says so; with none configured or none on screen the tap is REFUSED, nothing tapped or pressed, since no key hides the keyboard without submitting: hide it yourself (tap a neutral, non-interactive element such as a title), then tap again. ' +
        "The keyboard's own controls — a key, the toolbar's Done, the Passwords bar, dictation — are tappable as always. With treeSource: idb nothing in the tree is marked as the keyboard (on iOS 27 idb lists the keys as plain buttons), so nothing is hidden and app.ios.keyboardDismiss is inert; averi reads where the keyboard's background starts by its shape, and a target whose centre lies below that line is REFUSED, nothing tapped — hide the keyboard yourself (tap a neutral element such as the title), then tap again. Measured twice on iOS 27, a covered node was absent from idb\'s tree and the tap timed out waiting for it to appear. On iOS 27 idb lists the QuickType bar (\"Passwords\") as a plain button ABOVE that background, not inside it: a tap on the bar presses it, as asked, and an app node whose centre lies behind the bar is left out of the tree the same way.",
      inputSchema: {
        platform,
        selector: z.string().optional().describe('Element to tap, e.g. \'id:login_button\' or \'text:"Sign in"\' (quote values with spaces)'),
        x: z.number().optional(),
        y: z.number().optional(),
        configPath,
      },
    },
    async ({ platform: p, selector, x, y, configPath: cp }) => {
      const settings = iosToolSettings((await loadForCall(TOOL_CONFIG.tap(p), cp)).cfg, p);
      const adapter = await registry.get(p, treeOpts(settings));
      if (selector !== undefined) {
        const { note, moved } = await tapElement(adapter, selector, guardOpts(settings));
        return text(tapText(selector, note, moved));
      }
      if (x === undefined || y === undefined) {
        throw new Error('Provide either selector or both x and y');
      }
      await adapter.tap(x, y);
      return text(`Tapped (${x}, ${y})`);
    },
  );

  registerTool(
    'swipe',
    {
      description:
        'Swipe across the screen, by direction OR by coordinates — exactly one of the two. ' +
        'direction (up/down/left/right) names the FINGER\'s movement, as a flow\'s swipe: step does (up = the finger travels up, revealing content below): ' +
        `a stroke through the screen centre, ${SWIPE_REACH} of the screen either side, over the device's screen size (adb wm size / idb describe) turned the way the UI tree's window is; ` +
        'when that size cannot be read the UI tree\'s window stands in, and when the tree cannot be read the screen is taken as built — the reply says either; with neither size the swipe is refused and nothing is sent. ' +
        'A direction on iOS reads the tree source from averi.yaml (optional, like scroll_until); coordinates read no config. ' +
        'Coordinates (fromX, fromY, toX, toY — all four) are sent as given, in the platform\'s tree units (Android pixels, iOS points). ' +
        'To bring an element into view use scroll_until instead.',
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
        const { cfg } = await loadForCall(TOOL_CONFIG.swipe({ platform: p, direction }), cp);
        const adapter = await registry.get(p, treeOpts(iosToolSettings(cfg, p)));
        return text(swipeText({ direction, ...(await swipeScreen(adapter, { direction, meaning: 'finger', durationMs })) }));
      }
      if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
        throw new Error(
          given === 0
            ? 'Provide either direction (up/down/left/right) or all four of fromX, fromY, toX, toY'
            : 'Coordinates need all four of fromX, fromY, toX, toY (or use direction instead)',
        );
      }
      const stroke = { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
      await (await registry.get(p)).swipe(stroke.from, stroke.to, durationMs);
      return text(swipeText(stroke));
    },
  );

  registerTool(
    'type_text',
    {
      description:
        'Type text. With selector: focuses that field first (and with clear: true deletes its current content — typing otherwise APPENDS to pre-filled fields), ' +
        `then verifies the text landed and retries a dropped clear-fill once; a matched node that exposes no value (not a textfield: a textfield with none is empty, so typing it dropped fails as "shows 0"), or a field the read-back could not find again (the screen changed while typing, or the selector no longer matches it — after a clear too), is reported as "Typed … — NOT verified" with that reason (never "Filled") — a clear alone (empty text) as "Cleared … (N deletes sent) — NOT verified", or "Focused … — NOT verified" when nothing was deleted — "cleared" counts the characters actually deleted, and a match that is not a textfield (e.g. an iOS idb floating label) gets a ⚠ line naming the nearest input unless its value changed to show the text (then it took it) — clear sends it no delete (its length is not the field's). The field is resolved like a tap: up to ${SETTLE_BUDGET} to appear and hold still (a timeout if it never does), zero-area nodes ignored, ` +
        'the only interactive match preferred and reported; several interactive matches are refused with the list (never typed into the first); ' +
        'a field whose centre lies off the screen is refused, nothing tapped or typed — scroll_until it first. ' +
        'If the UI tree cannot be re-read after typing, the call FAILS rather than reporting a fill it could not re-read. Without selector: types into whatever is focused. ' +
        'An EMPTY field\'s hint or placeholder, which the tree reports as its value, is not content: clear stops once its deletes change nothing (never on a masked field), then types. ' +
        'A clear alone (empty text) on such a field reads, where the source names no placeholder (idb, Android API 33), "Cleared … — NOT verified: the field still shows N characters that the deletes did not change" (a hint, or a field ignoring deletes); ' +
        'where it names one (iOS wda, an Android dump with a hint attribute), a field showing exactly its placeholder reads "Focused … — NOT verified: the field shows exactly its placeholder\'s text" (empty, or holding that very text), as does typing a value equal to the placeholder. ' +
        'A text the app transforms (auto-capitalisation, autocorrect, a mask) FAILS the read-back; the error says whether only letter case differs, or how many characters of a same-length reading do — never the text. ' +
        'The focus tap is guarded like tap: a field under the soft keyboard is hidden-then-refocused on Android, and on iOS (treeSource: wda) hidden by the first on-screen entry of averi.yaml app.ios.keyboardDismiss then refocused, or refused with none (nothing typed); a field whose centre lies off screen, or under another element of the app drawn over it with too little of it showing, is refused like tap, and one tapped on its uncovered part says so in the note. The keyboard is NOT dismissed after typing here (a flow\'s fill: has dismissKeyboard for that).',
      inputSchema: {
        platform,
        text: z.string(),
        selector: z.string().optional().describe('Field to focus first, e.g. \'id:amount_input\''),
        clear: z.boolean().optional().describe('Delete existing content before typing (needs selector)'),
        configPath,
      },
    },
    async ({ platform: p, text: value, selector, clear, configPath: cp }) => {
      const settings = iosToolSettings((await loadForCall(TOOL_CONFIG.type_text(p), cp)).cfg, p);
      const adapter = await registry.get(p, treeOpts(settings));
      if (selector === undefined) {
        if (clear) throw new Error('clear requires a selector (the field whose content to measure)');
        await typeIntoFocused(adapter, value);
        return text(typedText(value.length));
      }
      const fill = await fillField(adapter, selector, value, { ...guardOpts(settings), clear });
      return text(fillReply(fill, selector));
    },
  );

  registerTool(
    'scroll_until',
    {
      description:
        'Swipe until the element is visible in the viewport — the portable way to reach content below the fold (no coordinates). direction = where the content lies (down = below the current view). ' +
        'By default "visible" means INTERSECTS the viewport, so the element may still be clipped at an edge; a clipped stop says which edges clip it and what fraction is on screen, a clean one says "fully visible". ' +
        'Another element of the app drawn over it (a pinned button bar, a floating tab bar listed after it in the tree) counts: by default the scroll goes on until its CENTRE is clear of such an element — the point a tap presses — and a stop with part of it still under one says so; with fully: true nothing may be drawn over any of it below the status bar (what lies only under the bar is hidden by it anyway). When swiping no longer moves it out from under one, it fails naming that element (on Android a floating action button\'s full-width host counts as one — see tap). Once a read finds the target in the viewport under a screen presented over it (as for tap: a layer WebDriverAgent shows presented, or elsewhere a modal\'s full-screen dimming view or a sheet\'s scroll view, laid after the target\'s screen in the same window), scroll_until confirms with one more read when the timeout allows, and fails without swiping further — "stopped before any swipe …" or "stopped after N swipes, without swiping further …", then "' +
        presentedStop() +
        '" — since a swipe there could dismiss a sheet or raise its discard prompt. The same holds, with the same confirming read, for a target in the tree that is NOT judged in the viewport (below the fold, under the soft keyboard, cut, or under a bar of its own screen) when the next swipe would touch down on such a screen: it fails without that swipe, saying why the target is not in the viewport and where the swipe would have landed — e.g. "element lies below the viewport, and the next swipe would touch down at (201,699) on container "dismiss popup" (0,0 402x874) — a screen is presented over it …" — since that swipe would land on the presented screen, not on the target\'s (a popover closed, a sheet moved to another detent); a read that fails meanwhile is retried, never answered with a swipe. When a bound (maxSwipes, the timeout, content exhausted) ends the scroll first, the failure adds "The next swipe would have touched down at (x,y) on … — a screen is presented over it …". A row of the presented sheet itself is still swiped for on the sheet, and a target not yet in the tree is still swiped for — except under a layer WebDriverAgent shows presented (iOS wda: an alert, an action sheet, a popover, or a "screen" layer such as a sheet), where no swipe is sent for any target unless it would touch down on a scroll view of that layer\'s own (a search inside the sheet\'s list): "stopped before any swipe — element is not in the tree, and the next swipe would touch down at (x,y) on … — ' + presentedStop(AN_ALERT) + ', so none was sent". The same on Android when the tree is a presented window (ui_snapshot\'s root carries "presentation": "dialog" or "screen"): uiautomator lists that window alone, so a target beneath it is never in the tree, and no swipe is sent for it — one would land on the dialog\'s dim and dismiss it, or drag the sheet — "… — ' + presentedStop(A_DIALOG) + ', so none was sent". The status bar (on iOS the top safe-area inset, 62 pt on a 402x874 iPhone; on Android the visible system status bar, 66 px on a 1080x2220 phone; a portrait screen only) counts as off the screen for the CENTRE: no stop — fully: true included — has the centre there (the point a tap presses), and a scroll that cannot move it out fails naming the status bar; for a default stop the rest of the element may lie under it, so full-bleed content at the top stops once its centre lies below the status bar (one whose centre, rounded as a tap sends it, lies in the bar — at y 0, shorter than twice the bar\'s height less a point (122 pt or less under 62 pt) — never stops, and fails naming the status bar). With fully: true none of the element may lie under the status bar, or the navigation bar the device reports (Android), past ' + SLACK + ' units (pt on iOS, px on Android) — the rule a color/ocr assert applies: the scroll goes on, and an element that stays under a bar (a last row under an edge-to-edge navigation bar) fails naming the bar. Content in no scroll view that no scroll can lift out of a bar — a full-bleed header laid from the screen\'s top edge at full width, a full-width surface laid to its bottom edge (a bottom sheet), an element the size of the screen — or screen-sized scroll content taller than the room between the bars, is exempt and stops as before, and a color/ocr assert on it still fails closed (assert something in it clear of the bar); an ocr assert may also refuse an element whose bottom rests exactly on the navigation bar\'s top inside a list that ends there (it may be cut). A top bar the tree does not list, or lists before the scroll view (an iOS navigation bar under WDA), is not seen. ' +
        'Nor does a default stop rest on an element its scroll container cuts to a strip thinner than a tap needs (Android: its rect flush with the container\'s edge, its own content running on past it) — a tap refuses that strip, so the scroll goes on, and fails naming the cut when swiping no longer moves it. ' +
        'Nor does any stop rest on a control Android dumps as such a strip flush against an element drawn after it that spans it (a field under a submit bar riding on the soft keyboard): the scroll goes on, and fails naming that element when swiping no longer moves it — with the keyboard up and that element riding on it, dismiss the keyboard first and scroll again; or, only if a screenshot shows the control whole and that thin, a coordinate tap reaches it. ' +
        'Pass fully: true when the next step MEASURES the element (a rect assert, a screenshot) — a clipped rect measures the clipped box, and fully: true fails loudly instead, naming the shortfall. ' +
        'When a sheet\'s grabber (iOS `Sheet Grabber`) reports another detent at the last read than at the first, the reply or the failure ends "; the sheet moved from its Half screen detent to Expanded" — the sheet moved during the call (a swipe on a half sheet\'s list at its top drags it up, but it is said too when no swipe was sent); the verdict is the same. ' +
        'A stop reached after a swipe is reported only once a further read finds the element where it was (a fling can carry it on; one still moving after 3 such reads is reported as still moving); one a fling carried past the viewport (on Android also one then dumped clipped out past its scroll container\'s edge — never on the first read, where the given direction stands), or one resting in it at the edge the swipes push it out through (clipped there, its centre under the status bar, with fully: true across the navigation bar\'s top (Android), or under something of the app drawn over that side — or over all of it but a strip on that side — in that half of the screen), is swiped back, each turn with half the reach — also when a list drops it from the tree right after a read had it short of the edge it left through — and an element in the tree, off screen with a non-zero rect, that 2 swipes no longer move fails then ("content exhausted, or the swipes were not taken" — or, when the swipes touched down on something drawn over the list, naming it first) — after 1 swipe where the tree itself lists the content of the scroll view swiped ending that way (iOS with treeSource: wda: "the tree lists the content of … ending at its top — content exhausted"), and when that tree places the element past the OTHER end of that same scroll view the swipes turn once toward it instead of failing, at full reach, the reply or failure saying so ("1 swipe up did not move … so averi turned down, as the tree places the element below it"; the given direction is always swiped first) — as does an element not in the tree after 2 identical swipes that change nothing on screen (not while a progress indicator shows); fully: true fails likewise on a clipped element 2 swipes no longer move; an element in the viewport that the swipes no longer move gets one swipe the other way first, when that way was not swiped yet, and fails only if that moves it neither. ' +
        'The timeout is checked once a round, after its tree read (and, on Android, its keyboard queries), so a call can run past it by one swipe, the settle after it and one more such round — the one that shows what that swipe did; the time a failure reports includes all of it. ' +
        'On Android each swipe is drawn over the target\'s scroll container (the screen\'s largest before the target is found), touching down above anything drawn over the container\'s lower half (a floating tab bar) when the content lies below, and slowly enough to drag, not fling, the list — about 1 s for a full-screen stroke, ≈ 0.45 screen heights a second — so one swipe moves the content about its own length and no row is skipped between reads; fewer swipes fit in the timeout than before. ' +
        'On Android a node\'s bounds are cut to its scroll container (and the display), so a fully: true stop whose top or bottom edge (left/right for a sideways scroll) lies exactly on its scroll container\'s is checked with one short probe swipe toward that edge (well under a pull-to-refresh), drawn inside a scroll container with room for it: if nothing moves the stop stands and the reply says it was checked; if the element moves it is judged again. The probe counts as a swipe (a list\'s first row at rest costs one); with none left the reply says the edge may be cut. With no scroll container around it that has room for the probe, or when every one from that edge outward scrolls only across it (a horizontal carousel for a top or bottom edge, no vertical list around it), no probe is sent and the reply says the edge may be cut and why. An element whose two edges along the scroll both lie on its scroll container\'s (it fills it exactly) is not probed — one probe cannot tell which side is cut — and the reply says it may be cut (usual for a card as tall as its carousel; check with a screenshot). ' +
        'With the soft keyboard up (Android; iOS with treeSource: wda, or idb\'s band read by its shape) the viewport is the screen ABOVE it: the part of an element under the keyboard does not count as visible, the swipes touch down clear of it (and never higher than without a keyboard), and a reply clipped at the top edge of the keyboard, or a failure, names it (a keyboard that covers the whole screen fails at once). Nothing is pressed to hide it — press_key back first (Android) to judge the whole screen. ' +
        'On Android, when the input method reports a keyboard the window state gives no area (one still coming up?), a failure or a fully: true reply says so: that keyboard was not judged; with a floating keyboard, everything below its panel\'s top edge, full width, counts as covered. With treeSource: idb nothing in the tree is marked as the keyboard; averi reads where its background starts by its shape and judges against that line as above: the swipes touch down above it, no stop has the element\'s centre below it, and with fully: true none of the element may lie below it.',
      inputSchema: {
        platform,
        selector: z.string().describe('Element to scroll into view, e.g. \'id:submit_button\''),
        direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Default down'),
        maxSwipes: z.number().int().min(1).optional().describe(`Default ${DEFAULT_MAX_SWIPES}`),
        fully: z
          .boolean()
          .optional()
          .describe('Require the element ENTIRELY inside the viewport, not just overlapping. Default false'),
        timeoutMs: z.number().optional().describe(`Default ${DEFAULT_SCROLL_TIMEOUT_MS}`),
        configPath,
      },
    },
    async ({ platform: p, selector, direction, maxSwipes, fully, timeoutMs, configPath: cp }) => {
      const { cfg } = await loadForCall(TOOL_CONFIG.scroll_until(p), cp);
      const adapter = await registry.get(p, treeOpts(iosToolSettings(cfg, p)));
      const result = await scrollUntilVisible(adapter, selector, { direction, maxSwipes, fully, timeoutMs });
      return text(`Element ${selector} ${describeScrollResult(result)}`);
    },
  );

  registerTool(
    'press_key',
    {
      description: 'Press a hardware/system key. back is Android-only.',
      inputSchema: { platform, key: z.enum(['back', 'home', 'enter']) },
    },
    async ({ platform: p, key }) => {
      await (await registry.get(p)).pressKey(key);
      return text(`Pressed ${key}`);
    },
  );

  registerTool(
    'ensure_state',
    {
      description:
        `Get the app into a named state from averi.yaml (e.g. "logged_in"): detects if already there, otherwise runs the reach flows (login etc.) and confirms. Idempotent — always prefer this over manual login taps. If the UI tree cannot be read (e.g. iOS idb stuck on a 0×0 tree) or holds nothing rendered (a cold launch's decor or splash) for the whole ~${ENSURE_BUDGET} second look, a destructive reach flow (clearState, or destructive: true) is refused rather than run blind: the call fails with "Refused to run reach flow …" and a ⛔ line in the trace — nothing was wiped; compare with screenshot and retry once the screen has rendered, or run_flow the rung deliberately. Returns the step trace and a final screenshot, settled the same way \`screenshot\` settles it.`,
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
        (cfg) => registry.get(p, treeOpts(iosToolSettings(cfg, p))),
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
        await runNamedFlow({ flow, project, environment: envName, session }, (cfg) => registry.get(p, treeOpts(iosToolSettings(cfg, p)))),
      );
    },
  );

  registerTool(
    'assert',
    {
      description:
        'Run declarative checks against the current screen: element exists (default) / absent / text exact / match regex, ' +
        'rect geometry vs Figma-frame values ({"element":{...},"rect":{"x":24,"w":345,"frameWidth":393}} — deltas in % of screen width; y is measured but never fails), ' +
        'fill color vs an expected hex ({"element":{...},"color":{"expected":"#FDFDFD","deltaE":8}} — CIEDE2000 over the element\'s sampled region; hex only, token names resolve upstream), ' +
        'rendered text read back off the screenshot ({"element":{...},"ocr":{"text":"CONTINUE","heightPct":2.96}} — what the user SEES, which the tree often does not carry: on iOS SwiftUI collapses a button into one node whose label is an authored a11y summary, so the visible string is absent; text is compared exactly — whitespace runs folded, case kept — except that a reading that differs only in what the recognizer cannot tell apart (typographic punctuation ’ “ – … vs its ASCII look-alike, letters with vs without diacritics — either way round) passes with a note naming the characters; a match pattern written with them matches such a reading with its own folded, and a pattern with no typographic or accented character of its own (none spelled as an escape either) is also run on the reading with those folded — match "Payee\'s" matches a reading Payee’s, the note saying the reading\'s ’ was folded (case is never folded, and a pattern that names a typographic character keeps it: (?<!’) still sees the reading\'s ’); heightPct is rendered ink height in % of screen width, the type-size check, single-line only; macOS-only, fails closed elsewhere), ' +
        'and screenshot pixel-diff vs. a stored baseline (auto-created on first use under .averi/baselines/). Prefer element asserts (deterministic, cheap) over screenshots. ' +
        'A color/ocr assert never samples what lies over its element: one under the soft keyboard (Android; iOS with treeSource: wda, or idb\'s band read by its shape), under the status bar (the top band the device reports — on iOS its top safe-area inset, 62 pt on a 402x874 iPhone; on Android the visible system status bar, 66 px on a 1080x2220 phone, which an app drawn edge-to-edge lays its top under), or under another element of the app drawn over any part of it (a pinned button bar and the area below it, a floating tab bar, a top bar over a scrolled row — judged over the whole rect, not only its centre; the element\'s own content listed beside it, a transparent clickable layer, and an overlap of ' + SLACK + ' units or less are not counted) fails closed naming what covers it and its rect, and the poll goes on, so one moved out before the deadline is measured; scroll_until it with fully: true first, or assert something in it that lies clear of that. Under a screen presented over the element (a layer WebDriverAgent shows presented, or a modal\'s full-screen dimming view or a sheet\'s scroll view, as for tap) no scroll helps, and the failure says so instead: \'' +
        presentedRemedy('the element') +
        '\' (whatever else lies over it — the status bar, a possible cut at the navigation bar — in place of its own advice, and wherever the element lies, nothing of it on the screen included; a keyboard the device reports is still named first, with its own). ' +
        'An element nothing of which (of what the assert reads) lies on the screen fails closed with \'' +
        OFF_THE_SCREEN +
        ' (element …, screen …)\', and one of which the screen\'s edge leaves a sliver no thicker than ' + SLACK + ' units (pt on iOS, px on Android) with \'' +
        TOO_THIN_ON_THE_SCREEN +
        ' (element …, on the screen …, screen …)\' — scroll it on-screen (scroll_until it first), or, under a presented screen, close that screen first; the poll goes on, so one scrolled on-screen before the deadline is measured. ' +
        'On iOS with treeSource: wda an element on the screen that its scroll view draws none of (listed past the scroll view\'s frame, as WebDriverAgent lists a scroll view\'s content) fails closed likewise with \'' +
        OUTSIDE_ITS_SCROLL_VIEW +
        ' <the scroll view> (element …, screen …)\', and one its scroll view\'s edge leaves a sliver no thicker than ' + SLACK + ' pt with \'' +
        TOO_THIN_IN_ITS_SCROLL_VIEW +
        ' <the scroll view> (element …, drawn …, screen …)\' — never measured on what shows there; only the part the scroll view draws is judged and sampled. On Android the navigation bar at the bottom (the visible bar the device reports, from y 2154 on a 1080x2220 phone; a portrait screen only) counts the same way, and an ocr assert on an element that may be cut at it — its bottom and its scroll container\'s both on the bar\'s top edge — fails closed too (scroll it up: scroll_until it with fully: true); a color assert on such an element is measured. Judged over what the assert reads: the whole rect for ocr; for color the part of the rect on the screen, inset 12% a side — the region its sampler reads — so an ocr assert on a whole screen fails on the status bar, a color assert on one does not. ' +
        'A `match` (element or ocr) that is not a valid JavaScript regex is refused with the arguments, naming the field, before any device is touched. ' +
        'With averi.yaml naming the app for the platform, an appAlive health line follows the results; without averi.yaml the asserts run alone, and an invalid one fails the call on either platform. ' +
        `Budgets: an assert without its own \`timeout\` waits up to ${ASSERT_BUDGET} (tree asserts) or ${PIXEL_ASSERT_BUDGET} (color/ocr — a round is a tree read plus a settled pair of captures, ~4.3 s on an Android emulator, and a screen with a clock or caret needs two); a passing assert returns at once, a color/ocr assert that keeps failing (a wrong colour or text, a frame that never settles, an element not found) polls out its whole budget — pass \`timeout\` to shorten it — while one that can never be measured fails closed after one read: a screenshot the device refuses, or an ocr assert on a host with no usable recognizer (no macOS Vision, no swiftc, or a recognizer that did not compile).`,
      inputSchema: { platform, asserts: assertsInput, configPath },
    },
    async ({ platform: p, asserts, configPath: cp }) => {
      const specs = parseAsserts(asserts);
      // One read for both of its uses — the iOS tree source and the health
      // line — under the `optional` policy on both platforms: assert works
      // configless, but a broken averi.yaml fails it rather than silently
      // costing the health line (android) or the tree source (ios).
      const { cfg } = await loadForCall(TOOL_CONFIG.assert(), cp);
      const adapter = await registry.get(p, treeOpts(iosToolSettings(cfg, p)));
      return text(await runAsserts({ adapter, specs, baselineDir: baselineDirFor(cp), cfg }));
    },
  );

  registerTool(
    'verify',
    {
      description:
        'THE verification tool: run the same sequence — optional ensure_state, optional flow, then asserts — on the requested platforms (default: both android and ios) and return per-platform results plus screenshots. The legs run concurrently; their sections and images are always reported in android-then-ios order regardless of input order (images in that order, one per leg that returned a screenshot; a leg whose section says FAILED or `⚠ screenshot:` has none). Single-platform work passes platforms: ["android"] or ["ios"]; for cross-platform tasks, run the default (both) before declaring the task done. ' +
        'contract points at a layout-contract JSON (screen anchors in Figma-frame units) → a per-anchor geometry table is appended (## rect parity), when anchors carry bg/bg_dark/sample fields the legs\' screenshots are sampled per anchor into a ## color parity table (CIEDE2000; ALWAYS the light axis — bg values — since averi cannot switch device themes; bg_dark anchors wait for the dark-mode round), and when anchors carry text/text_dynamic a ## text parity table compares the RENDERED copy and type size (OCR off the same screenshots; macOS-only, falls back to the tree with a note): numbers over impressions. A contract field a requested table cannot read (a bg that is neither hex nor token, an unknown sample mode, a non-string text, a non-boolean text_dynamic, a tolerance_de / tolerance_size_pct / tolerance_aspect_pct that is not a positive number) REFUSES the call before any device is touched, listing every such field — it no longer runs both legs to report FAILED in that table. An `environment` averi.yaml does not declare is refused the same way, before any device, naming the known ones.',
      inputSchema: {
        platforms: z
          .array(platform)
          .nonempty()
          .optional()
          .describe('Platforms to verify (default: both). Duplicates collapse; legs run concurrently and are reported android-then-ios.'),
        state: z.string().optional().describe('State to ensure first (from averi.yaml)'),
        flow: z.string().optional().describe('Flow to run (from averi.yaml)'),
        asserts: assertsInput.optional(),
        contract: z
          .string()
          .optional()
          .describe(
            'Path to a layout-contract JSON ({screen, tolerance_pct, tolerance_aspect_pct, figma_frame_width, anchors:[{id,x?,y?,w?,h?,aspect?,bg?,bg_dark?,sample?,text?,text_dynamic?}]}, Figma-frame units) — after the legs, geometry is compared per anchor in % of screen width and a "## rect parity" table is appended. Anchors with bg (hex; #RRGGBBAA alpha dropped) additionally get their fills sampled from the legs\' screenshots into a "## color parity" table (dE(a,i) primary at tolerance_de, default ' + DEFAULT_TOLERANCE_DE + '; vs-contract at ' + CONTRACT_TOL_FACTOR + 'x); anchors without bg are color-compared platform-to-platform only. A derived `aspect` row also compares each anchor\'s SHAPE android-vs-ios; omitting w/h does not disable it (omission means "not pinned", and the row\'s value is catching shape bugs on unpinned sides) — set `aspect: false` on an anchor whose height the two platforms genuinely derive by different mechanisms (e.g. Android\'s a11y touch-target floor inflating a node box to 48 where iOS reports 44), and put the reason beside it. `tolerance_aspect_pct` is its own threshold because a ratio spread is not a %-of-screen-width delta; it defaults to tolerance_pct. The color check always runs the LIGHT axis (bg): bg_dark is carried in the contract for the deferred dark-mode round, which needs a theme input AND a device actually captured in dark mode. ' +
              'Anchors with text (the exact rendered string) or text_dynamic (true for amounts/dates, whose locale formatting legitimately differs) get a "## text parity" table: the copy is read back off the legs\' screenshots with OCR — what the user SEES, since on iOS the tree carries authored a11y summaries rather than rendered copy — and compared android-vs-ios and vs the contract, plus rendered ink height as the type-size check (tolerance_size_pct, default ' + DEFAULT_SIZE_TOLERANCE_PCT + '%, compared only where both strings match). OCR is macOS-only; elsewhere the table falls back to tree evidence and says so.',
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
        // Only the ios leg has a treeSource (iosToolSettings gives android none).
        (p) => registry.get(p, treeOpts(iosToolSettings(project.cfg, p))),
      );
      return { content: [...text(sections.join('\n\n')).content, ...screenshots.map(image)] };
    },
  );

  registerTool(
    'get_logs',
    {
      description:
        'Device logs (logcat / os_log) since N seconds ago — scan for crashes and exceptions. grep filters to lines matching a case-insensitive regex (e.g. "tpm|validation") — prefer it, unfiltered pulls run to thousands of lines. Only the LAST maxLines matching lines come back (the tail is where the failure is); the header reports how many the grep matched against how many are shown, so raise it deliberately rather than by default. A grep that is not a valid JavaScript regex is refused with the arguments, before any device is touched.',
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
          .describe(`Keep only the last N matching lines (default ${LOG_MAX_LINES}). A grep alone is not a budget — a broad one matched 2,002 lines / 483k characters in one measured session.`),
      },
    },
    async ({ platform: p, sinceSeconds, grep, maxLines }) => {
      const all = await (await registry.get(p)).logs(Date.now() - sinceSeconds * 1000);
      return text(formatLogExcerpt(all, grep, maxLines));
    },
  );

  return server;
}

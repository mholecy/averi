#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdapterRegistry, type AdapterOpts } from './registry.js';
import { findAll, resolveOne } from '../ui-tree/selectors.js';
import { tapElement } from '../ui-tree/tap-element.js';
import {
  configDir,
  loadConfig,
  loadConfigIfPresent,
  loadEnvBeside,
  type AveriConfig,
} from '../flow/config.js';
import { fillField, FlowEngine, scrollUntilVisible } from '../flow/engine.js';
import {
  assertSpecSchema,
  captureStableScreenshot,
  DEFAULT_BASELINE_DIR,
  Verifier,
} from '../verify/assert.js';
import { CONTRACT_TOL_FACTOR, DEFAULT_TOLERANCE_DE } from '../verify/color-parity.js';
import { DEFAULT_SIZE_TOLERANCE_PCT } from '../verify/text-parity.js';
import { parseLayoutContract } from '../verify/layout-contract.js';
import {
  appHealth,
  assertSummary,
  formatAsserts,
  formatLogExcerpt,
  formatTrace,
  runVerification,
} from '../run/verify.js';
import { normalizePlatforms } from './platforms.js';
import type { Platform, UiNode } from '../adapters/types.js';

const registry = new AdapterRegistry();

const server = new McpServer({ name: 'averi', version: '0.0.1' });

const registerTool: typeof server.registerTool = server.registerTool.bind(server);

const platform = z.enum(['android', 'ios']).describe('Target platform');

const configPath = z
  .string()
  .optional()
  .describe(
    'Path to averi.yaml (default: ./averi.yaml in the server working directory). Paths INSIDE it — the build paths, .env.averi, .averi/baselines/ — resolve against the file, so a config in a subdirectory needs nothing else.',
  );

const environment = z
  .string()
  .optional()
  .describe(
    'Credential environment from averi.yaml `environments:` (e.g. "starterkit") — pass when the build under test points at a different backend than usual. Defaults to $AVERI_ENV (settable in .env.averi), then `defaultEnvironment:`.',
  );

/**
 * All project configuration lives with the project, not with averi: averi.yaml
 * is looked up against the server cwd (the project root when launched from
 * .mcp.json) unless the caller points elsewhere, and credential values
 * auto-load from a sibling .env.averi.
 */
const configPathOf = (configPath?: string) => resolve(configPath ?? 'averi.yaml');

/**
 * Baselines belong to the project, so they hang off averi.yaml like every other
 * project-relative path — `.averi/baselines/` beside the config, not beside
 * whatever directory the server happens to run in. Configless callers (assert
 * works without averi.yaml) keep the cwd-relative default.
 */
const baselineDirOf = (configPath?: string) =>
  resolve(configDir(configPathOf(configPath)), DEFAULT_BASELINE_DIR);

async function loadProjectConfig(configPath?: string): Promise<AveriConfig> {
  const path = configPathOf(configPath);
  const applied = await loadEnvBeside(path);
  if (applied.length > 0) console.error(`averi: loaded ${applied.join(', ')} from .env.averi`);
  return loadConfig(path);
}

/**
 * registry.get opts from a loaded config — plumbs app.ios.treeSource to the
 * adapter. Safe to pass for an android leg: the registry normalizes android
 * (and explicit idb) to the default variant, only ios+wda forks an adapter.
 */
const iosOpts = (cfg: AveriConfig | undefined): AdapterOpts => ({
  treeSource: cfg?.app.ios?.treeSource,
});

/**
 * treeSource for tree-reading tools that predate averi.yaml and must keep
 * working without one (ui_snapshot, tap, type_text, scroll_until, assert):
 * a missing config file means default idb, but a present-and-invalid one
 * still errors loudly — see loadConfigIfPresent. Android has no treeSource,
 * so its legs skip the config load entirely: an invalid averi.yaml must not
 * break android calls on these previously config-blind tools.
 */
async function loadIosOpts(p: Platform, configPath?: string): Promise<AdapterOpts | undefined> {
  if (p === 'android') return undefined;
  return iosOpts(await loadConfigIfPresent(configPathOf(configPath)));
}

const text = (value: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

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
    let appPath = path;
    if (appPath === undefined) {
      const cfg = await loadProjectConfig(cp);
      appPath = p === 'android' ? cfg.app.android?.apk : cfg.app.ios?.app;
      if (appPath === undefined) {
        throw new Error(`No path given and averi.yaml has no app.${p} build path`);
      }
    }
    await (await registry.get(p)).install(appPath);
    return text(`Installed ${appPath} on ${p}`);
  },
);

const launchIntentInput = z
  .object({
    action: z.string().optional().describe('e.g. android.intent.action.SEND'),
    data: z.string().optional().describe('Intent data URI'),
    mimeType: z.string().optional(),
    categories: z.array(z.string()).optional(),
    extras: z.record(z.string()).optional().describe('String extras (--es key value)'),
  })
  .strict();

registerTool(
  'launch_app',
  {
    description:
      'Launch an app by package name / bundle id. clearState wipes app data first (forces fresh login). ' +
      'Android: activity pins the entry point — without it (and without app.android.activity in ' +
      'averi.yaml) the launcher activity is picked arbitrarily, which opens LeakCanary instead of the ' +
      'app on debug builds that bundle it. intent exercises non-launcher entry points (share/SEND).',
    inputSchema: {
      platform,
      appId: z.string().describe('Android package name or iOS bundle id'),
      clearState: z.boolean().optional(),
      activity: z
        .string()
        .optional()
        .describe('Android only: activity to start (".MainActivity" or fully-qualified). Defaults to app.android.activity from averi.yaml.'),
      intent: launchIntentInput
        .optional()
        .describe('Android only: am start parameters for custom entry points'),
      configPath,
    },
  },
  async ({ platform: p, appId, clearState, activity, intent, configPath: cp }) => {
    if (p === 'android' && activity === undefined && intent === undefined) {
      // No explicit entry point — fall back to averi.yaml's, when the project
      // has one for this very package. No config, no match → monkey fallback.
      const android = await loadProjectConfig(cp).then((cfg) => cfg.app.android, () => undefined);
      if (android?.package === appId) activity = android.activity;
    }
    await (await registry.get(p)).launch(appId, { clearState, activity, intent });
    return text(
      `Launched ${appId}${activity === undefined ? '' : `/${activity.split('/').pop()}`} on ${p}${clearState ? ' (state cleared)' : ''}`,
    );
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

const STABILITY_ATTEMPTS = 5;
const STABILITY_DELAY_MS = 300;

registerTool(
  'screenshot',
  {
    description:
      'Take a screenshot (PNG). Waits for the screen to be stable (two identical consecutive captures) before returning — inspect the image to verify UI state.',
    inputSchema: { platform },
  },
  async ({ platform: p }) => {
    const adapter = await registry.get(p);
    const shot = await captureStableScreenshot(adapter, STABILITY_ATTEMPTS, STABILITY_DELAY_MS);
    return {
      content: [{ type: 'image' as const, data: shot.toString('base64'), mimeType: 'image/png' }],
    };
  },
);

registerTool(
  'ui_snapshot',
  {
    description:
      'Normalized accessibility tree as JSON — cheap text-based verification. Optional selector filter (e.g. \'role:button\', \'id:login_button\', \'label~"Pay.*"\') returns only matching nodes. ' +
      'React Native on iOS: if `id:` finds nothing for static text/containers (identifier: null everywhere), that is the default idb tree source — set `app.ios.treeSource: wda` in averi.yaml and retry.',
    inputSchema: {
      platform,
      filter: z.string().optional().describe('Selector to filter nodes'),
      configPath,
    },
  },
  async ({ platform: p, filter, configPath: cp }) => {
    const tree = await (await registry.get(p, await loadIosOpts(p, cp))).uiTree();
    return text(filter ? findAll(tree, filter).map(stripChildren) : tree);
  },
);

registerTool(
  'tap',
  {
    description:
      'Tap an element by selector (preferred: \'id:login_button\', \'text:"Continue"\', \'role:button label~"Pay.*"\') or by x/y coordinates.',
    inputSchema: {
      platform,
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      configPath,
    },
  },
  async ({ platform: p, selector, x, y, configPath: cp }) => {
    const adapter = await registry.get(p, await loadIosOpts(p, cp));
    if (selector !== undefined) {
      const note = await tapElement(adapter, selector);
      return text(`Tapped ${selector}${note ? ` (${note})` : ''}`);
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
    description: 'Swipe in a direction (up/down/left/right over the screen center is approximated by the given coordinates).',
    inputSchema: {
      platform,
      fromX: z.number(), fromY: z.number(),
      toX: z.number(), toY: z.number(),
      durationMs: z.number().optional(),
    },
  },
  async ({ platform: p, fromX, fromY, toX, toY, durationMs }) => {
    await (await registry.get(p)).swipe({ x: fromX, y: fromY }, { x: toX, y: toY }, durationMs);
    return text(`Swiped (${fromX},${fromY}) → (${toX},${toY})`);
  },
);

registerTool(
  'type_text',
  {
    description:
      'Type text. With selector: focuses that field first (and with clear: true deletes its current content — typing otherwise APPENDS to pre-filled fields). Without selector: types into whatever is focused.',
    inputSchema: {
      platform,
      text: z.string(),
      selector: z.string().optional().describe('Field to focus first, e.g. \'id:amount_input\''),
      clear: z.boolean().optional().describe('Delete existing content before typing (needs selector)'),
      configPath,
    },
  },
  async ({ platform: p, text: value, selector, clear, configPath: cp }) => {
    const adapter = await registry.get(p, await loadIosOpts(p, cp));
    if (selector === undefined) {
      if (clear) throw new Error('clear requires a selector (the field whose content to measure)');
      await adapter.typeText(value);
      return text(`Typed ${value.length} characters`);
    }
    const { node, note } = resolveOne(await adapter.uiTree(), selector);
    const refetch = async () => {
      try {
        return resolveOne(await adapter.uiTree(), selector).node;
      } catch {
        return undefined;
      }
    };
    await fillField(adapter, node, value, { clear, refetch });
    return text(
      `Filled ${selector} (${value.length} characters${clear ? ', cleared first' : ''})${note ? ` (${note})` : ''}`,
    );
  },
);

registerTool(
  'scroll_until',
  {
    description:
      'Swipe until the element is visible in the viewport — the portable way to reach content below the fold (no coordinates). direction = where the content lies (down = below the current view).',
    inputSchema: {
      platform,
      selector: z.string().describe('Element to scroll into view, e.g. \'id:submit_button\''),
      direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Default down'),
      maxSwipes: z.number().int().min(1).optional().describe('Default 6'),
      timeoutMs: z.number().optional().describe('Default 15000'),
      configPath,
    },
  },
  async ({ platform: p, selector, direction, maxSwipes, timeoutMs, configPath: cp }) => {
    const adapter = await registry.get(p, await loadIosOpts(p, cp));
    const swipes = await scrollUntilVisible(
      adapter,
      { find: (tree) => findAll(tree, selector), describe: selector },
      { direction, maxSwipes, timeout: timeoutMs },
    );
    return text(`Element ${selector} visible after ${swipes} swipe${swipes === 1 ? '' : 's'}`);
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

registerTool(
  'ensure_state',
  {
    description:
      'Get the app into a named state from averi.yaml (e.g. "logged_in"): detects if already there, otherwise runs the reach flows (login etc.) and confirms. Idempotent — always prefer this over manual login taps. Returns the step trace and a final screenshot.',
    inputSchema: {
      platform,
      state: z.string().describe('State name from averi.yaml'),
      configPath,
      environment,
    },
  },
  async ({ platform: p, state, configPath: cp, environment: env }) => {
    const cfg = await loadProjectConfig(cp);
    const adapter = await registry.get(p, iosOpts(cfg));
    const engine = new FlowEngine(cfg, adapter, { environment: env });
    const trace = await engine.ensureState(state);
    const health = await appHealth(adapter, cfg);
    const shot = await adapter.screenshot();
    return {
      content: [
        { type: 'text' as const, text: formatTrace(trace) + health },
        { type: 'image' as const, data: shot.toString('base64'), mimeType: 'image/png' },
      ],
    };
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
  async ({ platform: p, flow, configPath: cp, environment: env }) => {
    const cfg = await loadProjectConfig(cp);
    const adapter = await registry.get(p, iosOpts(cfg));
    const engine = new FlowEngine(cfg, adapter, { environment: env });
    const trace = await engine.runFlow(flow);
    return text(formatTrace(trace) + (await appHealth(adapter, cfg)));
  },
);

registerTool(
  'assert',
  {
    description:
      'Run declarative checks against the current screen: element exists (default) / absent / text exact / match regex, ' +
      'rect geometry vs Figma-frame values ({"element":{...},"rect":{"x":24,"w":345,"frameWidth":393}} — deltas in % of screen width; y is measured but never fails), ' +
      'fill color vs an expected hex ({"element":{...},"color":{"expected":"#FDFDFD","deltaE":8}} — CIEDE2000 over the element\'s sampled region; hex only, token names resolve upstream), ' +
      'rendered text read back off the screenshot ({"element":{...},"ocr":{"text":"CONTINUE","heightPct":2.96}} — what the user SEES, which the tree often does not carry: on iOS SwiftUI collapses a button into one node whose label is an authored a11y summary, so the visible string is absent; heightPct is rendered ink height in % of screen width, the type-size check, single-line only; macOS-only, fails closed elsewhere), ' +
      'and screenshot pixel-diff vs. a stored baseline (auto-created on first use under .averi/baselines/). Prefer element asserts (deterministic, cheap) over screenshots.',
    inputSchema: { platform, asserts: assertsInput, configPath },
  },
  async ({ platform: p, asserts, configPath: cp }) => {
    const specs = parseAsserts(asserts);
    // Lenient load: assert works configless, but a broken averi.yaml (or a
    // wda treeSource it declares) must not be silently ignored here.
    const adapter = await registry.get(p, await loadIosOpts(p, cp));
    const verifier = new Verifier(adapter, { baselineDir: baselineDirOf(cp) });
    const results = await verifier.assertAll(specs);
    let health = '';
    try {
      health = await appHealth(adapter, await loadProjectConfig(cp));
    } catch {
      // no averi.yaml → no app to health-check; asserts stand on their own
    }
    return text(`${assertSummary(results)}\n${formatAsserts(results)}${health}`);
  },
);

registerTool(
  'verify',
  {
    description:
      'THE verification tool: run the same sequence — optional ensure_state, optional flow, then asserts — on the requested platforms (default: both android and ios) and return per-platform results plus screenshots. Legs always run in android-then-ios order regardless of input order (first image android, second ios when both run). Single-platform work passes platforms: ["android"] or ["ios"]; for cross-platform tasks, run the default (both) before declaring the task done. ' +
      'contract points at a layout-contract JSON (screen anchors in Figma-frame units) → a per-anchor geometry table is appended (## rect parity), when anchors carry bg/bg_dark/sample fields the legs\' screenshots are sampled per anchor into a ## color parity table (CIEDE2000; ALWAYS the light axis — bg values — since averi cannot switch device themes; bg_dark anchors wait for the dark-mode round), and when anchors carry text/text_dynamic a ## text parity table compares the RENDERED copy and type size (OCR off the same screenshots; macOS-only, falls back to the tree with a note): numbers over impressions.',
    inputSchema: {
      platforms: z
        .array(platform)
        .nonempty()
        .optional()
        .describe('Platforms to verify (default: both). Duplicates collapse; legs always run android-then-ios.'),
      state: z.string().optional().describe('State to ensure first (from averi.yaml)'),
      flow: z.string().optional().describe('Flow to run (from averi.yaml)'),
      asserts: assertsInput.optional(),
      contract: z
        .string()
        .optional()
        .describe(
          'Path to a layout-contract JSON ({screen, tolerance_pct, figma_frame_width, anchors:[{id,x?,y?,w?,h?,bg?,bg_dark?,sample?,text?,text_dynamic?}]}, Figma-frame units) — after the legs, geometry is compared per anchor in % of screen width and a "## rect parity" table is appended. Anchors with bg (hex; #RRGGBBAA alpha dropped) additionally get their fills sampled from the legs\' screenshots into a "## color parity" table (dE(a,i) primary at tolerance_de, default ' + DEFAULT_TOLERANCE_DE + '; vs-contract at ' + CONTRACT_TOL_FACTOR + 'x); anchors without bg are color-compared platform-to-platform only. The color check always runs the LIGHT axis (bg): bg_dark is carried in the contract for the deferred dark-mode round, which needs a theme input AND a device actually captured in dark mode. ' +
            'Anchors with text (the exact rendered string) or text_dynamic (true for amounts/dates, whose locale formatting legitimately differs) get a "## text parity" table: the copy is read back off the legs\' screenshots with OCR — what the user SEES, since on iOS the tree carries authored a11y summaries rather than rendered copy — and compared android-vs-ios and vs the contract, plus rendered ink height as the type-size check (tolerance_size_pct, default ' + DEFAULT_SIZE_TOLERANCE_PCT + '%, compared only where both strings match). OCR is macOS-only; elsewhere the table falls back to tree evidence and says so.',
        ),
      configPath,
      environment,
    },
  },
  async ({ platforms: requested, state, flow, asserts, contract: contractPath, configPath: cp, environment: env }) => {
    const cfg = await loadProjectConfig(cp);
    // Parsed before the contract is read: a malformed assert spec is the
    // caller's most likely mistake, and it stays the error they see when both
    // are wrong.
    const specs = parseAsserts(asserts ?? []);
    // Load up front: a typo'd contract path must not cost a full device run.
    const contract =
      contractPath === undefined
        ? undefined
        : parseLayoutContract(await readFile(resolve(contractPath), 'utf8'), contractPath);
    const { sections, screenshots } = await runVerification(
      {
        platforms: normalizePlatforms(requested),
        cfg,
        specs,
        state,
        flow,
        contract,
        environment: env,
        baselineDir: baselineDirOf(cp),
      },
      // Only the ios leg has a treeSource; the registry normalizes it away
      // for android, so one opts expression serves both legs.
      (p) => registry.get(p, iosOpts(cfg)),
    );
    return {
      content: [
        { type: 'text' as const, text: sections.join('\n\n') },
        ...screenshots.map((shot) => ({
          type: 'image' as const,
          data: shot.toString('base64'),
          mimeType: 'image/png',
        })),
      ],
    };
  },
);

registerTool(
  'get_logs',
  {
    description:
      'Device logs (logcat / os_log) since N seconds ago — scan for crashes and exceptions. grep filters to lines matching a case-insensitive regex (e.g. "tpm|validation") — prefer it, unfiltered pulls run to thousands of lines. Only the LAST maxLines matching lines come back (the tail is where the failure is); the header reports how many the grep matched against how many are shown, so raise it deliberately rather than by default.',
    inputSchema: {
      platform,
      sinceSeconds: z.number().default(60).describe('How far back to read'),
      grep: z.string().optional().describe('Case-insensitive regex; only matching lines are returned'),
      maxLines: z
        .number()
        .int()
        .positive()
        .default(400)
        .describe('Keep only the last N matching lines (default 400). A grep alone is not a budget — a broad one matched 2,002 lines / 483k characters in one measured session.'),
    },
  },
  async ({ platform: p, sinceSeconds, grep, maxLines }) => {
    const all = await (await registry.get(p)).logs(Date.now() - sinceSeconds * 1000);
    return text(formatLogExcerpt(all, grep, maxLines));
  },
);

function stripChildren(node: UiNode): Omit<UiNode, 'children'> {
  const { children: _children, ...rest } = node;
  return rest;
}

const transport = new StdioServerTransport();
await server.connect(transport);

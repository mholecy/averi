#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { AdapterRegistry, type AdapterOpts } from './registry.js';
import { findAll, resolveOne } from '../ui-tree/selectors.js';
import { loadConfig, loadConfigIfPresent, loadEnvBeside, type AveriConfig } from '../flow/config.js';
import { fillField, FlowEngine, scrollUntilVisible, type TraceEntry } from '../flow/engine.js';
import { assertSpecSchema, scanForCrashes, Verifier, type AssertResult } from '../verify/assert.js';
import type { Platform, UiNode } from '../adapters/types.js';

const registry = new AdapterRegistry();

const server = new McpServer({ name: 'averi', version: '0.0.1' });

const registerTool: typeof server.registerTool = server.registerTool.bind(server);

const platform = z.enum(['android', 'ios']).describe('Target platform');

const configPath = z
  .string()
  .optional()
  .describe('Path to averi.yaml (default: ./averi.yaml in the server working directory)');

const environment = z
  .string()
  .optional()
  .describe(
    'Credential environment from averi.yaml `environments:` (e.g. "starterkit") — pass when the build under test points at a different backend than usual. Defaults to $AVERI_ENV (settable in .env.averi), then `defaultEnvironment:`.',
  );

/**
 * All project configuration lives with the project, not with averi: averi.yaml
 * resolves against the server cwd (the project root when launched from
 * .mcp.json) and credential values auto-load from a sibling .env.averi.
 */
async function loadProjectConfig(configPath?: string): Promise<AveriConfig> {
  const path = resolve(configPath ?? 'averi.yaml');
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
  return iosOpts(await loadConfigIfPresent(resolve(configPath ?? 'averi.yaml')));
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
      'Install an app build (.apk / .app bundle) on the booted device. Omit path to use the build path from averi.yaml (app.android.apk / app.ios.app).',
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
    let previous = await adapter.screenshot();
    for (let i = 0; i < STABILITY_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, STABILITY_DELAY_MS));
      const current = await adapter.screenshot();
      if (current.equals(previous)) break;
      previous = current;
    }
    return {
      content: [{ type: 'image' as const, data: previous.toString('base64'), mimeType: 'image/png' }],
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
      const note = await adapter.tapElement(selector);
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

const formatTrace = (trace: TraceEntry[]) =>
  trace.map((t) => (t.detail === undefined ? t.action : `${t.action}: ${t.detail}`)).join('\n');

/**
 * appAlive check (ARCHITECTURE.md §8): is the app-under-test still running?
 * When it died, include a crash excerpt from recent logs so flows fail fast
 * with the reason, not just a blank screen.
 */
async function appHealth(p: Platform, cfg: AveriConfig): Promise<string> {
  const app = cfg.app[p];
  if (!app) return '';
  const appId = 'package' in app ? app.package : app.bundleId;
  const adapter = await registry.get(p, iosOpts(cfg));
  if (await adapter.isAppRunning(appId)) return '\nappAlive: true';
  const lines = await adapter.logs(Date.now() - 60_000).catch(() => [] as string[]);
  const crashes = scanForCrashes(lines, p).slice(0, 24);
  return (
    `\nappAlive: false — ${appId} is not running!` +
    (crashes.length > 0 ? `\nCrash excerpt:\n${crashes.join('\n')}` : '\n(no crash signature in the last 60s of logs)')
  );
}

const formatAsserts = (results: AssertResult[]) =>
  results
    .map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.description}${r.detail ? ` — ${r.detail}` : ''}`)
    .join('\n');

const assertsInput = z
  .array(z.unknown())
  .describe(
    'Assert specs, e.g. [{"element":{"id":"transfer_form"}}, {"element":{"id":"error_banner"},"absent":true}, ' +
      '{"element":{"id":"amount"},"text":"100.00"}, {"screenshot":{"baseline":"transfers","threshold":0.01}}]',
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
    const health = await appHealth(p, cfg);
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
    const engine = new FlowEngine(cfg, await registry.get(p, iosOpts(cfg)), { environment: env });
    const trace = await engine.runFlow(flow);
    return text(formatTrace(trace) + (await appHealth(p, cfg)));
  },
);

registerTool(
  'assert',
  {
    description:
      'Run declarative checks against the current screen: element exists (default) / absent / text exact / match regex, and screenshot pixel-diff vs. a stored baseline (auto-created on first use under .averi/baselines/). Prefer element asserts (deterministic, cheap) over screenshots.',
    inputSchema: { platform, asserts: assertsInput, configPath },
  },
  async ({ platform: p, asserts, configPath: cp }) => {
    const specs = parseAsserts(asserts);
    // Lenient load: assert works configless, but a broken averi.yaml (or a
    // wda treeSource it declares) must not be silently ignored here.
    const verifier = new Verifier(await registry.get(p, await loadIosOpts(p, cp)), {
      baselineDir: resolve('.averi/baselines'),
    });
    const results = await verifier.assertAll(specs);
    let health = '';
    try {
      health = await appHealth(p, await loadProjectConfig(cp));
    } catch {
      // no averi.yaml → no app to health-check; asserts stand on their own
    }
    const failed = results.filter((r) => !r.pass).length;
    const summary = failed === 0 ? `All ${results.length} asserts passed` : `${failed}/${results.length} asserts FAILED`;
    return text(`${summary}\n${formatAsserts(results)}${health}`);
  },
);

registerTool(
  'verify_both',
  {
    description:
      'Cross-platform verification: run the same sequence on iOS AND Android — optional ensure_state, optional flow, then asserts — and return per-platform results plus paired screenshots (first image android, second ios). Use before declaring a cross-platform task done.',
    inputSchema: {
      state: z.string().optional().describe('State to ensure first (from averi.yaml)'),
      flow: z.string().optional().describe('Flow to run (from averi.yaml)'),
      asserts: assertsInput.optional(),
      configPath,
      environment,
    },
  },
  async ({ state, flow, asserts, configPath: cp, environment: env }) => {
    const cfg = await loadProjectConfig(cp);
    const specs = parseAsserts(asserts ?? []);
    const platforms: Platform[] = ['android', 'ios'];

    const runOne = async (p: Platform) => {
      // Only the ios leg has a treeSource; the registry normalizes it away
      // for android, so one opts expression serves both legs.
      const adapter = await registry.get(p, iosOpts(cfg));
      const engine = new FlowEngine(cfg, adapter, { environment: env });
      const trace: TraceEntry[] = [];
      if (state) trace.push(...(await engine.ensureState(state)));
      if (flow) trace.push(...(await engine.runFlow(flow)));
      const results = await new Verifier(adapter, { baselineDir: resolve('.averi/baselines') }).assertAll(specs);
      const shot = await adapter.screenshot();
      const health = await appHealth(p, cfg);
      return { trace, results, shot, health };
    };

    const runs = await Promise.allSettled(platforms.map(runOne));

    const sections: string[] = [];
    const images: { type: 'image'; data: string; mimeType: string }[] = [];
    platforms.forEach((p, i) => {
      const run = runs[i];
      if (run.status === 'rejected') {
        sections.push(`## ${p}\nFAILED: ${run.reason instanceof Error ? run.reason.message : String(run.reason)}`);
        return;
      }
      const { trace, results, shot, health } = run.value;
      const failed = results.filter((r) => !r.pass).length;
      const verdict = specs.length === 0 ? '' : failed === 0 ? `\nAll ${results.length} asserts passed` : `\n${failed}/${results.length} asserts FAILED`;
      sections.push(`## ${p}\n${formatTrace(trace)}${verdict}\n${formatAsserts(results)}${health}`);
      images.push({ type: 'image', data: shot.toString('base64'), mimeType: 'image/png' });
    });

    return { content: [{ type: 'text' as const, text: sections.join('\n\n') }, ...images] };
  },
);

registerTool(
  'get_logs',
  {
    description:
      'Device logs (logcat / os_log) since N seconds ago — scan for crashes and exceptions. grep filters to lines matching a case-insensitive regex (e.g. "tpm|validation") — prefer it, unfiltered pulls run to thousands of lines.',
    inputSchema: {
      platform,
      sinceSeconds: z.number().default(60).describe('How far back to read'),
      grep: z.string().optional().describe('Case-insensitive regex; only matching lines are returned'),
    },
  },
  async ({ platform: p, sinceSeconds, grep }) => {
    const all = await (await registry.get(p)).logs(Date.now() - sinceSeconds * 1000);
    const lines = grep === undefined ? all : all.filter((l) => new RegExp(grep, 'i').test(l));
    const MAX_LINES = 2000;
    const tail = lines.slice(-MAX_LINES);
    const header: string[] = [];
    if (grep !== undefined) header.push(`[grep /${grep}/i matched ${lines.length} of ${all.length} lines]`);
    if (lines.length > tail.length) header.push(`[truncated: showing last ${MAX_LINES} of ${lines.length} lines]`);
    return text([...header, ...tail].join('\n'));
  },
);

function stripChildren(node: UiNode): Omit<UiNode, 'children'> {
  const { children: _children, ...rest } = node;
  return rest;
}

const transport = new StdioServerTransport();
await server.connect(transport);

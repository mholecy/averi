#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AdapterRegistry } from './registry.js';
import { findAll } from '../ui-tree/selectors.js';
import type { UiNode } from '../adapters/types.js';

const registry = new AdapterRegistry();

const server = new McpServer({ name: 'averi', version: '0.0.1' });

const platform = z.enum(['android', 'ios']).describe('Target platform');

const text = (value: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

server.registerTool(
  'list_devices',
  {
    description: 'List available iOS simulators and Android emulators/devices with boot state.',
    inputSchema: {},
  },
  async () => text(await registry.listAll()),
);

server.registerTool(
  'install_app',
  {
    description: 'Install an app build (.apk / .app bundle) on the booted device.',
    inputSchema: { platform, path: z.string().describe('Path to .apk (android) or .app (ios)') },
  },
  async ({ platform: p, path }) => {
    await (await registry.get(p)).install(path);
    return text(`Installed ${path} on ${p}`);
  },
);

server.registerTool(
  'launch_app',
  {
    description: 'Launch an app by package name / bundle id. clearState wipes app data first (forces fresh login).',
    inputSchema: {
      platform,
      appId: z.string().describe('Android package name or iOS bundle id'),
      clearState: z.boolean().optional(),
    },
  },
  async ({ platform: p, appId, clearState }) => {
    await (await registry.get(p)).launch(appId, { clearState });
    return text(`Launched ${appId} on ${p}${clearState ? ' (state cleared)' : ''}`);
  },
);

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
  'ui_snapshot',
  {
    description:
      'Normalized accessibility tree as JSON — cheap text-based verification. Optional selector filter (e.g. \'role:button\', \'id:login_button\', \'label~"Pay.*"\') returns only matching nodes.',
    inputSchema: { platform, filter: z.string().optional().describe('Selector to filter nodes') },
  },
  async ({ platform: p, filter }) => {
    const tree = await (await registry.get(p)).uiTree();
    return text(filter ? findAll(tree, filter).map(stripChildren) : tree);
  },
);

server.registerTool(
  'tap',
  {
    description:
      'Tap an element by selector (preferred: \'id:login_button\', \'text:"Continue"\', \'role:button label~"Pay.*"\') or by x/y coordinates.',
    inputSchema: {
      platform,
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
  },
  async ({ platform: p, selector, x, y }) => {
    const adapter = await registry.get(p);
    if (selector !== undefined) {
      await adapter.tapElement(selector);
      return text(`Tapped ${selector}`);
    }
    if (x === undefined || y === undefined) {
      throw new Error('Provide either selector or both x and y');
    }
    await adapter.tap(x, y);
    return text(`Tapped (${x}, ${y})`);
  },
);

server.registerTool(
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

server.registerTool(
  'type_text',
  {
    description: 'Type text into the focused element (tap the field first).',
    inputSchema: { platform, text: z.string() },
  },
  async ({ platform: p, text: value }) => {
    await (await registry.get(p)).typeText(value);
    return text(`Typed ${value.length} characters`);
  },
);

server.registerTool(
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

server.registerTool(
  'get_logs',
  {
    description: 'Device logs (logcat / os_log) since N seconds ago — scan for crashes and exceptions.',
    inputSchema: {
      platform,
      sinceSeconds: z.number().default(60).describe('How far back to read'),
    },
  },
  async ({ platform: p, sinceSeconds }) => {
    const lines = await (await registry.get(p)).logs(Date.now() - sinceSeconds * 1000);
    const MAX_LINES = 2000;
    const tail = lines.slice(-MAX_LINES);
    const header = lines.length > tail.length
      ? [`[truncated: showing last ${MAX_LINES} of ${lines.length} lines]`]
      : [];
    return text([...header, ...tail].join('\n'));
  },
);

function stripChildren(node: UiNode): Omit<UiNode, 'children'> {
  const { children: _children, ...rest } = node;
  return rest;
}

const transport = new StdioServerTransport();
await server.connect(transport);

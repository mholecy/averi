import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Platform, Recording, Screen } from './corpus.js';
import { resetClock, wallNow } from './clock.js';
import { deviceCalls, resetDevice, type DeviceProfile } from './fake-device.js';
import { ANDROID_SERIAL, IOS_UDID, recordedAdapter, type Side } from './side.js';

/**
 * The differential itself: every recording replayed on two sides through the
 * tool interface, call by call, and what differs. Per recording:
 *
 *  1. per DEVICE VARIANT (what the fake device answers — the screen, the
 *     Android keyboard, an iOS dismissal list in averi.yaml), one MCP server
 *     per side, built by the side's own `createAveriServer` over a registry
 *     whose factory hands out the side's adapter over the recording
 *     (side.ts#recordedAdapter) — as tests/mcp/tools.test.ts builds one;
 *  2. `ui_snapshot` on both sides; its trees name the TARGETS — every node a
 *     selector can address on either side: a unique identifier (`id:`), else
 *     a unique text (`text:`, label or value), else the role with either
 *     (`role:… text:` / `role:… id:`); no value holding `"` — the grammar
 *     has no escape for it;
 *  3. the variant's calls (PLAN below) with the same arguments on each side,
 *     one at a time — the virtual clock and the fake device reset before
 *     each — and per call the reply (text blocks, image sizes, isError) and
 *     the device calls it made.
 *
 * A call's OUTCOME is the reply and the device calls; a DIFF is a call whose
 * outcomes differ. Nothing here knows what a tool does.
 */

export type ToolName = 'ui_snapshot' | 'tap' | 'scroll_until' | 'swipe' | 'type_text' | 'assert';

export interface Call {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface Outcome {
  reply: string;
  device: string[];
}

export interface CallResult {
  recording: string;
  variant: string;
  call: Call;
  old: Outcome;
  new: Outcome;
}

export interface RecordingResult {
  recording: string;
  /** Whether the side's parser read this tree (a raw capture) or it was served as normalized. */
  parser: 'exercised' | 'not exercised';
  variants: string[];
  calls: number;
  /** Calls and diffs per tool. */
  perTool: Record<string, { calls: number; diffs: number; ms: number }>;
  diffs: CallResult[];
  /** Every call, when the caller asked for them (`keepAll`). */
  all?: CallResult[];
}

export interface Options {
  /** At most this many targets per tree (default: every one). */
  cap?: number;
  /** Which tools to call (default: all of PLAN's). */
  tools?: ReadonlySet<ToolName>;
  /** Keep every call's result, not only the diffs. */
  keepAll?: boolean;
}

// --- device variants ---

interface Variant {
  name: string;
  profile: DeviceProfile;
  /** averi.yaml `app.ios.keyboardDismiss` for this variant (iOS, a tree with the keyboard in it). */
  dismiss?: unknown[];
  /** The tools this variant calls; the rest are the base variant's business. */
  tools: ReadonlySet<ToolName>;
}

const EVERY: ReadonlySet<ToolName> = new Set(['ui_snapshot', 'tap', 'scroll_until', 'swipe', 'type_text', 'assert']);
const SCREENLESS: ReadonlySet<ToolName> = new Set(['tap', 'assert']);
const GUARDED: ReadonlySet<ToolName> = new Set(['tap']);

/** The screens the device checks ran on, when a manifest names none: the iPhone 17 simulator, the Pixel_3a AVD. */
const DEFAULT_SCREEN: Record<Platform, Screen> = { ios: { width: 402, height: 874 }, android: { width: 1080, height: 2220 } };

function variantsOf(recording: Recording, snapshot: Snapshot): Variant[] {
  const screen = recording.screen ?? DEFAULT_SCREEN[recording.platform];
  const p = recording.platform;
  if (p === 'android') {
    // Half the screen's pixels: a 1080x2220 PNG takes ~100 ms to decode in pngjs and a pixel assert decodes several;
    // scale 0.5 is inside the pixel asserts' plausible range (verify/scale.ts) and the pixels themselves are never read
    // for a verdict here (the frame is one grey).
    const frame = { width: Math.round(screen.width / 2), height: Math.round(screen.height / 2) };
    return [
      { name: 'keyboard hidden', profile: { platform: p, screen, frame, keyboard: 'hidden' }, tools: EVERY },
      { name: 'keyboard shown', profile: { platform: p, screen, frame, keyboard: 'shown' }, tools: EVERY },
      { name: 'no screen', profile: { platform: p, screen: undefined, frame, keyboard: 'hidden' }, tools: SCREENLESS },
    ];
  }
  const out: Variant[] = [
    { name: 'screen', profile: { platform: p, screen, frame: screen }, tools: EVERY },
    { name: 'no screen', profile: { platform: p, screen: undefined, frame: screen }, tools: SCREENLESS },
  ];
  if (snapshot.keyboard) {
    out.push({ name: 'dismiss accessory', profile: { platform: p, screen, frame: screen }, dismiss: [{ accessory: true }], tools: GUARDED });
    if (snapshot.neutral !== undefined) {
      out.push({ name: `dismiss tap ${snapshot.neutral}`, profile: { platform: p, screen, frame: screen }, dismiss: [{ tap: { text: snapshot.neutral } }], tools: GUARDED });
    }
  }
  return out;
}

// --- targets, from the trees ui_snapshot printed ---

interface SnapNode {
  role?: string;
  label?: string | null;
  identifier?: string | null;
  value?: string | null;
  children?: SnapNode[];
}

interface Target {
  selector: string;
  element: Record<string, string>;
  role: string;
}

interface Snapshot {
  targets: Target[];
  /** A node with role `keyboard` on either side: the iOS keyboard is in the tree. */
  keyboard: boolean;
  /** The first `text` node with a unique label — a neutral element a dismissal can tap. */
  neutral?: string;
}

function* walk(n: SnapNode): Generator<SnapNode> {
  yield n;
  for (const c of n.children ?? []) yield* walk(c);
}

function tally(values: (string | null | undefined)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/**
 * The targets of one side's tree, in tree order: each node by the first selector that names it alone — its
 * identifier, else its text (label or value), else its role and text, else its role and identifier.
 */
function targetsOf(tree: SnapNode): { targets: Target[]; keyboard: boolean; neutral?: string } {
  const nodes = [...walk(tree)];
  const textsOf = (n: SnapNode) => (n.label === n.value ? [n.label] : [n.label, n.value]);
  const ids = tally(nodes.map((n) => n.identifier));
  const texts = tally(nodes.flatMap(textsOf));
  const roleTexts = tally(nodes.flatMap((n) => textsOf(n).map((t) => (t ? `${n.role} ${t}` : t))));
  const roleIds = tally(nodes.map((n) => (n.identifier ? `${n.role} ${n.identifier}` : null)));
  const quotable = (v: string | null | undefined): v is string => !!v && !v.includes('"');
  const targets: Target[] = [];
  let neutral: string | undefined;
  for (const n of nodes) {
    const role = n.role ?? '?';
    if (neutral === undefined && role === 'text' && quotable(n.label) && texts.get(n.label) === 1) neutral = n.label;
    if (quotable(n.identifier) && ids.get(n.identifier) === 1) {
      targets.push({ selector: `id:"${n.identifier}"`, element: { id: n.identifier }, role });
    } else if (quotable(n.label) && texts.get(n.label) === 1) {
      targets.push({ selector: `text:"${n.label}"`, element: { text: n.label }, role });
    } else if (quotable(n.label) && roleTexts.get(`${role} ${n.label}`) === 1) {
      targets.push({ selector: `role:${role} text:"${n.label}"`, element: { role, text: n.label }, role });
    } else if (quotable(n.identifier) && roleIds.get(`${role} ${n.identifier}`) === 1) {
      targets.push({ selector: `role:${role} id:"${n.identifier}"`, element: { role, id: n.identifier }, role });
    }
  }
  return { targets, keyboard: nodes.some((n) => n.role === 'keyboard'), ...(neutral !== undefined && { neutral }) };
}

/** Both sides' targets, NEW's order first, then any only OLD can address. */
function snapshotOf(oldReply: string, newReply: string): Snapshot {
  const parse = (reply: string): SnapNode | undefined => {
    try {
      const body = reply.split(BLOCK)[0];
      return JSON.parse(body.startsWith('ERROR ') ? '' : body) as SnapNode;
    } catch {
      return undefined;
    }
  };
  const sides = [parse(newReply), parse(oldReply)].filter((t): t is SnapNode => t !== undefined).map(targetsOf);
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const s of sides) for (const t of s.targets) if (!seen.has(t.selector)) seen.add(t.selector), targets.push(t);
  return { targets, keyboard: sides.some((s) => s.keyboard), ...(sides[0]?.neutral !== undefined && { neutral: sides[0].neutral }) };
}

// --- the calls ---

/**
 * Every assert's budget. The defaults (3 s for the tree, 12 s for the pixel
 * asserts) poll a tree that never changes until they run out — the same
 * verdict, more rounds: one second keeps the verdict and the reply's
 * wording (which names the budget) and costs a twelfth of the captures.
 */
const ASSERT_BUDGET_MS = 1_000;

/** Per target, what each tool is asked; a pixel assert never reads text (the fake recognizer reads none) — only whether it may look. */
function plan(platform: Platform, t: Target, tools: ReadonlySet<ToolName>): Call[] {
  const calls: Call[] = [];
  if (tools.has('tap')) calls.push({ tool: 'tap', args: { platform, selector: t.selector } });
  if (tools.has('scroll_until')) {
    for (const direction of ['down', 'up']) calls.push({ tool: 'scroll_until', args: { platform, selector: t.selector, direction } });
    calls.push({ tool: 'scroll_until', args: { platform, selector: t.selector, direction: 'down', fully: true } });
  }
  if (tools.has('assert')) {
    calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, timeout: ASSERT_BUDGET_MS }] } });
    calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, color: { expected: '#808080' }, timeout: ASSERT_BUDGET_MS }] } });
    calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, ocr: { text: 'differential' }, timeout: ASSERT_BUDGET_MS }] } });
  }
  if (tools.has('type_text') && t.role === 'textfield') calls.push({ tool: 'type_text', args: { platform, selector: t.selector, text: '1' } });
  return calls;
}

function treeCalls(platform: Platform, tools: ReadonlySet<ToolName>): Call[] {
  const calls: Call[] = [];
  if (tools.has('swipe')) for (const direction of ['up', 'down']) calls.push({ tool: 'swipe', args: { platform, direction } });
  return calls;
}

// --- one side's server ---

const BLOCK = '\n⏎\n';

interface Connection {
  call(call: Call, configPath: string): Promise<Outcome>;
  close(): Promise<void>;
}

/** A temporary path in a reply (a screenshot's file in an error) names the call, not the code: `<tmp>`. */
const TEMP = new RegExp(`${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s;:,)]*`, 'g');
const untemp = (s: string) => s.replace(TEMP, '<tmp>');

const pngSize = (b: Buffer) => (b.length >= 24 && b.readUInt32BE(12) === 0x49484452 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : `${b.length} bytes`);

async function connect(side: Side, recording: Recording, profile: DeviceProfile): Promise<Connection> {
  const adapter = recordedAdapter(side, recording, profile);
  const device = recording.platform === 'ios' ? IOS_UDID : ANDROID_SERIAL;
  const registry = new side.AdapterRegistry({
    factory: () => adapter,
    discovery: async (platform) =>
      platform === recording.platform ? [{ id: device, platform, name: 'differential', osVersion: '0', state: 'booted' }] : [],
  });
  const server = side.createAveriServer({ registry, version: 'differential' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'differential', version: '0' });
  await client.connect(clientSide);
  return {
    async call(call, configPath) {
      resetDevice();
      resetClock();
      let reply: string;
      try {
        const result = await client.callTool({ name: call.tool, arguments: { ...call.args, configPath } }, undefined, { timeout: 600_000 });
        const content = result.content as { type: string; text?: string; data?: string }[];
        const blocks = content.map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'image' ? `[image ${pngSize(Buffer.from(c.data ?? '', 'base64'))}]` : `[${c.type}]`));
        reply = untemp(`${result.isError === true ? 'ERROR ' : ''}${blocks.join(BLOCK)}`);
      } catch (e) {
        reply = `THROW ${(e as Error).message}`;
      }
      return { reply, device: deviceCalls() };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

// --- averi.yaml per variant ---

let configDir: string | undefined;
let configs = 0;

async function configFor(recording: Recording, dismiss: unknown[] | undefined): Promise<string> {
  configDir ??= join(tmpdir(), `averi-differential-${process.pid}`);
  await mkdir(configDir, { recursive: true });
  const kind = recording.source === 'uiautomator' ? undefined : recording.source;
  const ios = { bundleId: 'differential.app', ...(kind !== undefined && { treeSource: kind }), ...(dismiss !== undefined && { keyboardDismiss: dismiss }) };
  const path = join(configDir, `averi-${configs++}.yaml`);
  // JSON is YAML: the config needs no YAML writer.
  await writeFile(path, JSON.stringify({ app: { android: { package: 'differential.app' }, ios } }));
  return path;
}

// --- one recording ---

const same = (a: Outcome, b: Outcome) => a.reply === b.reply && a.device.length === b.device.length && a.device.every((c, i) => c === b.device[i]);

export async function compareRecording(recording: Recording, oldSide: Side, newSide: Side, opts: Options = {}): Promise<RecordingResult> {
  const tools = opts.tools ?? EVERY;
  const result: RecordingResult = {
    recording: recording.id,
    parser: recording.form === 'raw' ? 'exercised' : 'not exercised',
    variants: [],
    calls: 0,
    perTool: {},
    diffs: [],
    ...(opts.keepAll && { all: [] }),
  };
  const both = async (variant: string, c: Connection, d: Connection, call: Call, configPath: string) => {
    const t0 = wallNow();
    const o = await c.call(call, configPath);
    const n = await d.call(call, configPath);
    const r: CallResult = { recording: recording.id, variant, call, old: o, new: n };
    result.calls++;
    const t = (result.perTool[call.tool] ??= { calls: 0, diffs: 0, ms: 0 });
    t.calls++;
    t.ms += wallNow() - t0;
    if (!same(o, n)) {
      t.diffs++;
      result.diffs.push(r);
    }
    result.all?.push(r);
    return r;
  };

  // The base variant first: its snapshot names the targets and whether the keyboard is in the tree.
  const base = variantsOf(recording, { targets: [], keyboard: false })[0];
  const baseConfig = await configFor(recording, undefined);
  let o = await connect(oldSide, recording, base.profile);
  let n = await connect(newSide, recording, base.profile);
  const snap = await both(base.name, o, n, { tool: 'ui_snapshot', args: { platform: recording.platform } }, baseConfig);
  const snapshot = snapshotOf(snap.old.reply, snap.new.reply);
  const targets = snapshot.targets.slice(0, opts.cap ?? Infinity);

  for (const variant of variantsOf(recording, snapshot)) {
    const wanted = new Set([...variant.tools].filter((t) => tools.has(t)));
    if (wanted.size === 0) continue;
    result.variants.push(variant.name);
    if (variant.name !== base.name) {
      await o.close();
      await n.close();
      o = await connect(oldSide, recording, variant.profile);
      n = await connect(newSide, recording, variant.profile);
    }
    const config = variant.dismiss === undefined ? baseConfig : await configFor(recording, variant.dismiss);
    if (variant.name !== base.name && wanted.has('ui_snapshot')) await both(variant.name, o, n, { tool: 'ui_snapshot', args: { platform: recording.platform } }, config);
    for (const call of treeCalls(recording.platform, wanted)) await both(variant.name, o, n, call, config);
    for (const t of targets) for (const call of plan(recording.platform, t, wanted)) await both(variant.name, o, n, call, config);
  }
  await o.close();
  await n.close();
  return result;
}

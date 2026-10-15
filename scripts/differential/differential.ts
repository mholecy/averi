import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Platform, Recording, Screen } from './corpus.js';
import { resetClock, wallNow } from './clock.js';
import { deviceCalls, paintFrame, resetDevice, type DeviceProfile, type Paint } from './fake-device.js';
import { ANDROID_SERIAL, IOS_UDID, recordedAdapter, type Side } from './side.js';

/**
 * The differential itself: every recording replayed on two sides through the
 * tool interface, call by call, and what differs. Per recording:
 *
 *  1. per DEVICE VARIANT (what the fake device answers — the screen, the
 *     frame's scale, the Android keyboard and display, an iOS dismissal list
 *     in averi.yaml; VARIANTS below), one MCP server
 *     per side, built by the side's own `createAveriServer` over a registry
 *     whose factory hands out the side's adapter over the recording
 *     (side.ts#recordedAdapter) — as tests/mcp/tools.test.ts builds one;
 *  2. `ui_snapshot` on both sides; its trees name the TARGETS — every node a
 *     selector can address on either side: a unique identifier (`id:`), else
 *     a unique text (`text:`, label or value), else a unique `label:` or
 *     `value:`, else the role with text or id (`role:… text:` / `role:…
 *     id:`); no value holding `"` — the grammar has no escape for it. A
 *     text more than one node carries is asked once too (`tap text:`), for
 *     the tools' many-matches path;
 *  3. the variant's calls (PLAN below) with the same arguments on each side,
 *     one at a time — the virtual clock and the fake device reset before
 *     each, a colour assert's target painted its own colour in the frame —
 *     and per call the reply (text blocks, image sizes and content hashes,
 *     isError) and the device calls it made.
 *
 * A call's OUTCOME is the reply and the device calls; a DIFF is a call whose
 * outcomes differ. Nothing here knows what a tool does.
 */

export type ToolName = 'ui_snapshot' | 'tap' | 'scroll_until' | 'swipe' | 'type_text' | 'assert' | 'launch_app';

export interface Call {
  tool: ToolName;
  args: Record<string, unknown>;
  /** A rect of the frame painted for this call — the colour a colour assert must sample there. */
  paint?: Paint;
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
  /** Device commands the fake does not model, as each side sent them, and how often (fake-device.ts). */
  unmodelled: Record<string, number>;
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
  /** Which asserts `assert` makes (default all three). */
  asserts?: readonly AssertKind[];
  /** At most this many targets (a costly variant runs on the first few). */
  targets?: number;
}

type AssertKind = 'element' | 'color' | 'ocr';

const EVERY: ReadonlySet<ToolName> = new Set(['ui_snapshot', 'tap', 'scroll_until', 'swipe', 'type_text', 'assert', 'launch_app']);
const SCREENLESS: ReadonlySet<ToolName> = new Set(['tap', 'assert']);
const GUARDED: ReadonlySet<ToolName> = new Set(['tap']);
const KEYBOARD: ReadonlySet<ToolName> = new Set(['tap', 'scroll_until']);
const PIXELS: ReadonlySet<ToolName> = new Set(['tap', 'assert']);
/** How many targets the costly variants (real scale, another screen) run on — `spread`'s choice. */
const SUBSET = 3;

/** The screens the device checks ran on, when a manifest names none: the iPhone 17 simulator, the Pixel_3a AVD. */
const DEFAULT_SCREEN: Record<Platform, Screen> = { ios: { width: 402, height: 874 }, android: { width: 1080, height: 2220 } };
/** Another screen of each platform: the iPhone 17 Pro Max (points), a 1080x2400 phone. */
const OTHER_SCREEN: Record<Platform, Screen> = { ios: { width: 430, height: 932 }, android: { width: 1080, height: 2400 } };
/** A screenshot's pixels per tree unit on the real device: 3 on the iPhone (points), 1 on Android (pixels). */
const REAL_SCALE: Record<Platform, number> = { ios: 3, android: 1 };

const scaled = (s: Screen, k: number): Screen => ({ width: Math.round(s.width * k), height: Math.round(s.height * k) });

/**
 * The device variants of a recording. Every variant but the costly two answers screenshots at HALF the screen: a
 * frame's decode (pngjs) is most of a pixel assert's cost — a 1080x2220 frame takes ~100 ms — and scale 0.5 is inside
 * the pixel asserts' plausible range (verify/scale.ts). `real scale` (3x on iOS, 1x on Android) and `other screen` (a
 * device that differs from the tree) run on SUBSET targets spread over the screen (`spread`).
 */
function variantsOf(recording: Recording, snapshot: Snapshot): Variant[] {
  const screen = recording.screen ?? DEFAULT_SCREEN[recording.platform];
  const p = recording.platform;
  const frame = scaled(screen, 0.5);
  const app = recording.app;
  const costly: Variant[] = [
    { name: 'real scale', profile: { platform: p, screen, frame: scaled(screen, REAL_SCALE[p]), ...(app !== undefined && { app }) }, tools: PIXELS, asserts: ['color'], targets: SUBSET },
    { name: 'other screen', profile: { platform: p, screen: OTHER_SCREEN[p], frame: scaled(OTHER_SCREEN[p], 0.5), ...(app !== undefined && { app }) }, tools: PIXELS, asserts: ['color'], targets: SUBSET },
  ];
  if (p === 'android') {
    return [
      { name: 'keyboard hidden', profile: { platform: p, screen, frame, keyboard: 'hidden' }, tools: EVERY },
      { name: 'keyboard shown', profile: { platform: p, screen, frame, keyboard: 'shown' }, tools: EVERY },
      { name: 'keyboard floating', profile: { platform: p, screen, frame, keyboard: 'floating' }, tools: KEYBOARD },
      { name: 'API 36, keyboard shown', profile: { platform: p, screen, frame, keyboard: 'shown', displays: 'api36' }, tools: KEYBOARD },
      { name: 'no screen', profile: { platform: p, screen: undefined, frame, keyboard: 'hidden' }, tools: SCREENLESS },
      ...costly.map((v) => ({ ...v, profile: { ...v.profile, keyboard: 'hidden' as const } })),
    ];
  }
  const base = { platform: p, screen, frame, ...(app !== undefined && { app }) };
  const out: Variant[] = [
    { name: 'screen', profile: base, tools: EVERY },
    { name: 'no screen', profile: { ...base, screen: undefined }, tools: SCREENLESS },
    ...costly,
  ];
  if (snapshot.keyboard) {
    out.push({ name: 'dismiss accessory', profile: base, dismiss: [{ accessory: true }], tools: GUARDED });
    if (snapshot.neutral !== undefined) {
      out.push({ name: `dismiss tap ${snapshot.neutral}`, profile: base, dismiss: [{ tap: { text: snapshot.neutral } }], tools: GUARDED });
    }
  }
  return out;
}

// --- targets, from the trees ui_snapshot printed ---

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SnapNode {
  role?: string;
  label?: string | null;
  identifier?: string | null;
  value?: string | null;
  rect?: Rect;
  children?: SnapNode[];
}

interface Target {
  selector: string;
  /** The assert's element spec — none for a `value:` target: an element spec names no value (verify/element-assert.ts). */
  element?: Record<string, string>;
  role: string;
  /** The node's rect in the tree that named it (NEW's when both did) — where its colour is painted. */
  rect: Rect;
}

interface Snapshot {
  targets: Target[];
  /** Texts more than one node carries — each asked once, for the many-matches path. */
  shared: string[];
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
 * identifier, else its text (label or value), else its label, else its value, else its role and text, else its role
 * and identifier.
 */
function targetsOf(tree: SnapNode): { targets: Target[]; shared: string[]; keyboard: boolean; neutral?: string } {
  const nodes = [...walk(tree)];
  const textsOf = (n: SnapNode) => (n.label === n.value ? [n.label] : [n.label, n.value]);
  const ids = tally(nodes.map((n) => n.identifier));
  const texts = tally(nodes.flatMap(textsOf));
  const labels = tally(nodes.map((n) => n.label));
  const values = tally(nodes.map((n) => n.value));
  const roleTexts = tally(nodes.flatMap((n) => textsOf(n).map((t) => (t ? `${n.role} ${t}` : t))));
  const roleIds = tally(nodes.map((n) => (n.identifier ? `${n.role} ${n.identifier}` : null)));
  const quotable = (v: string | null | undefined): v is string => !!v && !v.includes('"');
  const targets: Target[] = [];
  let neutral: string | undefined;
  for (const n of nodes) {
    const role = n.role ?? '?';
    const rect = n.rect ?? { x: 0, y: 0, width: 0, height: 0 };
    const push = (selector: string, element?: Record<string, string>) => targets.push({ selector, ...(element !== undefined && { element }), role, rect });
    if (neutral === undefined && role === 'text' && quotable(n.label) && texts.get(n.label) === 1) neutral = n.label;
    if (quotable(n.identifier) && ids.get(n.identifier) === 1) push(`id:"${n.identifier}"`, { id: n.identifier });
    else if (quotable(n.label) && texts.get(n.label) === 1) push(`text:"${n.label}"`, { text: n.label });
    else if (quotable(n.label) && labels.get(n.label) === 1) push(`label:"${n.label}"`, { label: n.label });
    else if (quotable(n.value) && values.get(n.value) === 1) push(`value:"${n.value}"`);
    else if (quotable(n.label) && roleTexts.get(`${role} ${n.label}`) === 1) push(`role:${role} text:"${n.label}"`, { role, text: n.label });
    else if (quotable(n.identifier) && roleIds.get(`${role} ${n.identifier}`) === 1) push(`role:${role} id:"${n.identifier}"`, { role, id: n.identifier });
  }
  const shared = [...texts].filter(([t, k]) => k > 1 && !t.includes('"')).map(([t]) => t);
  return { targets, shared, keyboard: nodes.some((n) => n.role === 'keyboard'), ...(neutral !== undefined && { neutral }) };
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
  const shared = [...new Set(sides.flatMap((s) => s.shared))];
  return { targets, shared, keyboard: sides.some((s) => s.keyboard), ...(sides[0]?.neutral !== undefined && { neutral: sides[0].neutral }) };
}

// --- the calls ---

/**
 * Every assert's budget. The defaults (3 s for the tree, 12 s for the pixel
 * asserts) poll a tree that never changes until they run out — the same
 * verdict, more rounds: one second keeps the verdict and the reply's
 * wording (which names the budget) and costs a twelfth of the captures.
 */
const ASSERT_BUDGET_MS = 1_000;

/**
 * `n` targets for a costly variant, spread over the screen. Tree order puts the screen-sized wrappers first, and a
 * colour assert on one of those samples the whole frame, so a node covering 90 % of the screen or more is never
 * taken. Of the rest: the first whose centre lies in each vertical third of the screen, top to bottom; where a third
 * has none, the first, the last and the middle of those not yet taken fill in, in that order (a node off the screen
 * among them).
 */
export function spread<T extends { rect: { x: number; y: number; width: number; height: number } }>(targets: readonly T[], screen: Screen, n: number): T[] {
  const area = screen.width * screen.height;
  const small = targets.filter((t) => t.rect.width * t.rect.height < 0.9 * area);
  const chosen: T[] = [];
  for (let k = 0; k < n; k++) {
    const top = (screen.height * k) / n, bottom = (screen.height * (k + 1)) / n;
    const hit = small.find((t) => !chosen.includes(t) && t.rect.y + t.rect.height / 2 >= top && t.rect.y + t.rect.height / 2 < bottom);
    if (hit !== undefined) chosen.push(hit);
  }
  const rest = small.filter((t) => !chosen.includes(t));
  for (const i of [0, rest.length - 1, Math.floor((rest.length - 1) / 2)]) {
    if (chosen.length >= n || rest.length === 0) break;
    if (!chosen.includes(rest[i])) chosen.push(rest[i]);
  }
  return chosen;
}

/** A distinct colour per target index — never the frame's grey — as `#rrggbb` and its channels. */
function colourOf(i: number): { hex: string; rgb: readonly [number, number, number] } {
  const rgb = [(i * 67 + 31) % 256, (i * 131 + 199) % 256, (i * 29 + 7) % 256] as const;
  return { hex: `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase(), rgb };
}

/**
 * Per target, what each tool is asked. A colour assert's target has its rect painted its own colour in the frame
 * (at the frame's scale), and the assert expects that colour: one that samples another rect, or the right rect at the
 * wrong scale, fails. OCR reads no text from the fake recognizer — the ocr assert is compared on whether it may look.
 */
function plan(platform: Platform, t: Target, i: number, tools: ReadonlySet<ToolName>, asserts: readonly AssertKind[], scale: number): Call[] {
  const calls: Call[] = [];
  if (tools.has('tap')) calls.push({ tool: 'tap', args: { platform, selector: t.selector } });
  if (tools.has('scroll_until')) {
    for (const direction of ['down', 'up']) calls.push({ tool: 'scroll_until', args: { platform, selector: t.selector, direction } });
    calls.push({ tool: 'scroll_until', args: { platform, selector: t.selector, direction: 'down', fully: true } });
  }
  if (tools.has('assert') && t.element !== undefined) {
    if (asserts.includes('element')) calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, timeout: ASSERT_BUDGET_MS }] } });
    if (asserts.includes('color')) {
      const { hex, rgb } = colourOf(i);
      const rect = { x: t.rect.x * scale, y: t.rect.y * scale, width: t.rect.width * scale, height: t.rect.height * scale };
      calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, color: { expected: hex }, timeout: ASSERT_BUDGET_MS }] }, paint: { rect, rgb } });
    }
    if (asserts.includes('ocr')) calls.push({ tool: 'assert', args: { platform, asserts: [{ element: t.element, ocr: { text: 'differential' }, timeout: ASSERT_BUDGET_MS }] } });
  }
  if (tools.has('type_text') && t.role === 'textfield') calls.push({ tool: 'type_text', args: { platform, selector: t.selector, text: '1' } });
  return calls;
}

/** Per tree: the swipes, the many-matches taps, and on a raw iOS tree the launch (its foreground wait asks the source which app it reads). */
function treeCalls(recording: Recording, tools: ReadonlySet<ToolName>, shared: readonly string[]): Call[] {
  const platform = recording.platform;
  const calls: Call[] = [];
  if (tools.has('swipe')) for (const direction of ['up', 'down']) calls.push({ tool: 'swipe', args: { platform, direction } });
  if (tools.has('tap') && tools.has('ui_snapshot')) for (const text of shared) calls.push({ tool: 'tap', args: { platform, selector: `text:"${text}"` } });
  if (tools.has('launch_app') && platform === 'ios' && recording.form === 'raw') calls.push({ tool: 'launch_app', args: { platform, appId: 'differential.app' } });
  return calls;
}

// --- one side's server ---

export const BLOCK = '\n⏎\n';

export interface Connection {
  call(call: Call, configPath: string): Promise<Outcome>;
  close(): Promise<void>;
}

/** A temporary path in a reply (a screenshot's file in an error) names the call, not the code: `<tmp>`. */
const TEMP = new RegExp(`${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s;:,)]*`, 'g');
const untemp = (s: string) => s.replace(TEMP, '<tmp>');

/** An image block as its size and a hash of its bytes — two frames of one size are told apart. */
const imageOf = (b: Buffer) =>
  `${b.length >= 24 && b.readUInt32BE(12) === 0x49484452 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : `${b.length} bytes`} sha1:${createHash('sha1').update(b).digest('hex').slice(0, 12)}`;

export async function connect(side: Side, recording: Recording, profile: DeviceProfile): Promise<Connection> {
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
      if (call.paint !== undefined) paintFrame(call.paint);
      resetClock();
      let reply: string;
      try {
        const result = await client.callTool({ name: call.tool, arguments: { ...call.args, configPath } }, undefined, { timeout: 600_000 });
        const content = result.content as { type: string; text?: string; data?: string }[];
        const blocks = content.map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'image' ? `[image ${imageOf(Buffer.from(c.data ?? '', 'base64'))}]` : `[${c.type}]`));
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

export async function configFor(recording: Recording, dismiss: unknown[] | undefined): Promise<string> {
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
    unmodelled: {},
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
    for (const line of [...o.device, ...n.device]) {
      if (!line.startsWith('UNMODELLED ')) continue;
      const m = / ×(\d+)$/.exec(line);
      const key = m === null ? line : line.slice(0, m.index);
      result.unmodelled[key] = (result.unmodelled[key] ?? 0) + (m === null ? 1 : Number(m[1]));
    }
    if (!same(o, n)) {
      t.diffs++;
      result.diffs.push(r);
    }
    result.all?.push(r);
    return r;
  };

  // The base variant first: its snapshot names the targets and whether the keyboard is in the tree.
  const base = variantsOf(recording, { targets: [], shared: [], keyboard: false })[0];
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
    for (const call of treeCalls(recording, wanted, snapshot.shared)) await both(variant.name, o, n, call, config);
    const scale = variant.profile.frame.width / (variant.profile.screen ?? recording.screen ?? DEFAULT_SCREEN[recording.platform]).width;
    const screen = recording.screen ?? DEFAULT_SCREEN[recording.platform];
    const mine = variant.targets === undefined ? targets : spread(targets, screen, variant.targets);
    for (const [i, t] of mine.entries()) for (const call of plan(recording.platform, t, i, wanted, variant.asserts ?? ['element', 'color', 'ocr'], scale)) await both(variant.name, o, n, call, config);
  }
  await o.close();
  await n.close();
  return result;
}

/** A reply with its numbers and quoted selector values blurred — so one change seen on many trees groups as one. */
const blur = (s: string) => s.replace(/"[^"]*"/g, '"…"').replace(/-?\d+(\.\d+)?/g, '#');

/**
 * The diffs grouped by what changed, the largest group first: the tool, and either the two replies blurred or —
 * when the replies are equal — `device calls only` (the tool said the same and sent something else).
 */
export function groupDiffs(diffs: readonly CallResult[]): [string, { count: number; trees: Set<string>; example: CallResult }][] {
  const groups = new Map<string, { count: number; trees: Set<string>; example: CallResult }>();
  for (const d of diffs) {
    const what = d.old.reply === d.new.reply ? 'device calls only' : `OLD ${blur(d.old.reply).slice(0, 400)}\n   NEW ${blur(d.new.reply).slice(0, 400)}`;
    const key = `${d.call.tool} — ${what}`;
    const g = groups.get(key) ?? { count: 0, trees: new Set<string>(), example: d };
    g.count++;
    g.trees.add(d.recording);
    groups.set(key, g);
  }
  return [...groups].sort((a, b) => b[1].count - a[1].count);
}

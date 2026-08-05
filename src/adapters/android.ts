import { XMLParser } from 'fast-xml-parser';
import { exec as defaultExec, type ExecFn } from './exec.js';
import { resolveOne, tapPoint } from '../ui-tree/selectors.js';
import type { Device, DeviceAdapter, Key, Selector, UiNode } from './types.js';

const KEYCODES: Record<Key, string> = { back: '4', home: '3', enter: '66' };

/** android.widget.* class (last segment) → normalized role. */
const ROLE_MAP: Record<string, string> = {
  Button: 'button',
  ImageButton: 'button',
  TextView: 'text',
  EditText: 'textfield',
  AutoCompleteTextView: 'textfield',
  ImageView: 'image',
  CheckBox: 'checkbox',
  Switch: 'switch',
  ToggleButton: 'switch',
  RadioButton: 'radiobutton',
  SeekBar: 'slider',
  ProgressBar: 'progress',
  WebView: 'webview',
  RecyclerView: 'scrollable',
  ListView: 'scrollable',
  ScrollView: 'scrollable',
  HorizontalScrollView: 'scrollable',
  ViewPager: 'scrollable',
};

export class AndroidAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
  private readonly exec: ExecFn;
  private readonly serial: string | undefined;

  constructor(opts: { serial?: string; exec?: ExecFn } = {}) {
    this.serial = opts.serial;
    this.exec = opts.exec ?? defaultExec;
  }

  private adb(args: string[], timeoutMs?: number) {
    const target = this.serial ? ['-s', this.serial] : [];
    return this.exec('adb', [...target, ...args], timeoutMs ? { timeoutMs } : undefined);
  }

  async listDevices(): Promise<Device[]> {
    const { stdout } = await this.exec('adb', ['devices', '-l']);
    const devices: Device[] = [];
    for (const line of stdout.toString('utf8').split('\n').slice(1)) {
      const match = line.trim().match(/^(\S+)\s+(device|offline)\b/);
      if (!match) continue;
      const [, id, state] = match;
      const model = line.match(/model:(\S+)/)?.[1] ?? id;
      let osVersion = 'unknown';
      if (state === 'device') {
        const prop = await this.exec('adb', [
          '-s', id, 'shell', 'getprop', 'ro.build.version.release',
        ]);
        osVersion = prop.stdout.toString('utf8').trim() || 'unknown';
      }
      devices.push({
        id,
        platform: 'android',
        name: model,
        osVersion,
        state: state === 'device' ? 'booted' : 'offline',
      });
    }
    return devices;
  }

  async install(appPath: string): Promise<void> {
    await this.adb(['install', '-r', appPath], 120_000);
  }

  async launch(packageName: string, opts: { clearState?: boolean } = {}): Promise<void> {
    if (opts.clearState) await this.adb(['shell', 'pm', 'clear', packageName]);
    await this.adb(['shell', 'monkey', '-p', packageName, '-c',
      'android.intent.category.LAUNCHER', '1']);
  }

  async terminate(packageName: string): Promise<void> {
    await this.adb(['shell', 'am', 'force-stop', packageName]);
  }

  async openDeepLink(url: string): Promise<void> {
    await this.adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  async screenshot(): Promise<Buffer> {
    const { stdout } = await this.adb(['exec-out', 'screencap', '-p']);
    return stdout;
  }

  async uiTree(): Promise<UiNode> {
    // Dump to stdout; uiautomator appends a status line after the XML.
    const { stdout } = await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], 15_000);
    const raw = stdout.toString('utf8');
    const xmlEnd = raw.lastIndexOf('>');
    if (xmlEnd === -1) throw new Error(`uiautomator dump returned no XML: ${raw.slice(0, 200)}`);
    return parseUiautomatorXml(raw.slice(0, xmlEnd + 1));
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb(['shell', 'input', 'tap', String(x), String(y)]);
  }

  async tapElement(selector: Selector): Promise<string | undefined> {
    const { node, note } = resolveOne(await this.uiTree(), selector);
    const point = tapPoint(node);
    await this.tap(point.x, point.y);
    return note;
  }

  private viewportPromise: Promise<{ width: number; height: number }> | undefined;

  /** Screen size in device pixels — the units uiautomator bounds use. */
  viewport(): Promise<{ width: number; height: number }> {
    this.viewportPromise ??= (async () => {
      const { stdout } = await this.adb(['shell', 'wm', 'size']);
      const raw = stdout.toString('utf8');
      // "Physical size: 1080x2280", optionally overridden ("Override size: ...")
      const m = raw.match(/Override size:\s*(\d+)x(\d+)/) ?? raw.match(/Physical size:\s*(\d+)x(\d+)/);
      if (!m) throw new Error(`Cannot parse wm size output: ${raw.slice(0, 120)}`);
      return { width: Number(m[1]), height: Number(m[2]) };
    })();
    return this.viewportPromise;
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.adb(['shell', 'input', 'swipe',
      String(x), String(y), String(x), String(y), String(durationMs)]);
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 300,
  ): Promise<void> {
    await this.adb(['shell', 'input', 'swipe',
      String(from.x), String(from.y), String(to.x), String(to.y), String(durationMs)]);
  }

  async typeText(text: string): Promise<void> {
    // One `input text` call PER CHARACTER. Bulk injection races Compose's
    // async text state and silently drops most characters (measured
    // 2026-08-05 on the login username field: 3 of 11 landed; per-char
    // landed 11/11 — the adb round-trip itself is the pacing). Escape shell
    // metachars; `input text` wants spaces encoded as %s.
    for (const ch of text) {
      const escaped = ch.replace(/([\\"'`$&*()[\]{}|;<>?~#])/, '\\$1').replace(/ /, '%s');
      await this.adb(['shell', 'input', 'text', escaped]);
    }
  }

  async pressKey(key: Key): Promise<void> {
    await this.adb(['shell', 'input', 'keyevent', KEYCODES[key]]);
  }

  async clearText(count: number): Promise<void> {
    if (count <= 0) return;
    // One keyevent per adb call: batched multi-keycode calls drop events in
    // the IME queue (measured 2026-08-05 — `input keyevent 67 67 67 67` on
    // the amount field landed only 3 of 4). MOVE_END first, then backspaces;
    // a forward-delete pass cleans up in case the cursor did not move.
    await this.adb(['shell', 'input', 'keyevent', '123']); // KEYCODE_MOVE_END
    for (let i = 0; i < count; i++) await this.adb(['shell', 'input', 'keyevent', '67']); // DEL
    for (let i = 0; i < count; i++) await this.adb(['shell', 'input', 'keyevent', '112']); // FORWARD_DEL
  }

  async setClipboard(_text: string): Promise<void> {
    // No reliable pure-adb clipboard write across API levels; revisit with a helper app if needed.
    throw new Error('setClipboard is not supported on Android yet');
  }

  async isAppRunning(packageName: string): Promise<boolean> {
    // pidof exits non-zero when no process matches
    try {
      const { stdout } = await this.adb(['shell', 'pidof', packageName]);
      return stdout.toString('utf8').trim() !== '';
    } catch {
      return false;
    }
  }

  async logs(sinceMs: number): Promise<string[]> {
    const seconds = (sinceMs / 1000).toFixed(3);
    const { stdout } = await this.adb(['logcat', '-d', '-T', seconds]);
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }
}

interface RawNode {
  class?: string;
  'resource-id'?: string;
  text?: string;
  'content-desc'?: string;
  focusable?: string;
  'long-clickable'?: string;
  bounds?: string;
  node?: RawNode | RawNode[];
}

export function parseUiautomatorXml(xml: string): UiNode {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => name === 'node',
  }).parse(xml);
  const roots: RawNode[] = parsed.hierarchy?.node ?? [];
  if (roots.length === 0) throw new Error('uiautomator dump contained no nodes');
  const children = roots.map(normalizeNode);
  if (children.length === 1) return children[0];
  return {
    role: 'container', label: null, identifier: null, value: null,
    rect: { x: 0, y: 0, width: 0, height: 0 }, children,
  };
}

function normalizeNode(raw: RawNode): UiNode {
  const className = raw.class?.split('.').pop() ?? '';
  const text = emptyToNull(raw.text);
  const contentDesc = emptyToNull(raw['content-desc']);
  const rawChildren = raw.node === undefined ? [] : Array.isArray(raw.node) ? raw.node : [raw.node];
  // Compose text inputs don't always dump as EditText: a BasicTextField with
  // scroll semantics surfaces as (Horizontal)ScrollView carrying the content
  // in `text` (measured 2026-08-05, login username field — value came back
  // null and fill's clear silently no-oped). A focusable AND long-clickable
  // scroll view is a text input; real scroll containers are neither.
  const composeTextInput =
    (className === 'HorizontalScrollView' || className === 'ScrollView') &&
    raw.focusable === 'true' &&
    raw['long-clickable'] === 'true';
  const isTextInput = className.endsWith('EditText') || composeTextInput;
  return {
    role: isTextInput ? 'textfield' : (ROLE_MAP[className] ?? (rawChildren.length > 0 ? 'container' : 'other')),
    label: contentDesc ?? text,
    // resource-id is "com.example.app:id/login_button" — selectors use the short name
    identifier: emptyToNull(raw['resource-id']?.split('/').pop()),
    value: isTextInput ? text : null,
    rect: parseBounds(raw.bounds),
    children: rawChildren.map(normalizeNode),
  };
}

function parseBounds(bounds: string | undefined): UiNode['rect'] {
  const m = bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return { x: 0, y: 0, width: 0, height: 0 };
  const [, l, t, r, b] = m.map(Number);
  return { x: l, y: t, width: r - l, height: b - t };
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : String(value);
}

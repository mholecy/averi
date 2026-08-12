import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, type ExecFn } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';
import { resolveOne, tapPoint } from '../ui-tree/selectors.js';
import type { Device, DeviceAdapter, Key, LaunchOptions, Selector, UiNode } from './types.js';

/** idb AX element `type` → normalized role. */
const ROLE_MAP: Record<string, string> = {
  Button: 'button',
  StaticText: 'text',
  TextField: 'textfield',
  SecureTextField: 'textfield',
  TextView: 'textfield',
  Image: 'image',
  Switch: 'switch',
  Toggle: 'switch',
  CheckBox: 'checkbox',
  RadioButton: 'radiobutton',
  Slider: 'slider',
  ProgressIndicator: 'progress',
  WebView: 'webview',
  ScrollView: 'scrollable',
  Table: 'scrollable',
  CollectionView: 'scrollable',
  Cell: 'container',
  Window: 'container',
  Other: 'container',
};

/**
 * iOS adapter: `xcrun simctl` for lifecycle/screenshots, `idb` for input and
 * the accessibility tree. Everything idb-specific stays in the three `idb*`
 * methods so a WebDriverAgent swap stays cheap (ARCHITECTURE.md §10).
 */
export class IosAdapter implements DeviceAdapter {
  readonly platform = 'ios' as const;
  private readonly exec: ExecFn;
  private readonly udid: string | undefined;

  constructor(opts: { udid?: string; exec?: ExecFn } = {}) {
    this.udid = opts.udid;
    this.exec = opts.exec ?? defaultExec;
  }

  private target(): string {
    return this.udid ?? 'booted';
  }

  /** DEVELOPER_DIR probe shared with WdaServer — see xcode-env.ts. */
  private detectEnv(): Promise<Record<string, string> | undefined> {
    return detectXcodeEnv(this.exec);
  }

  private async simctl(args: string[], timeoutMs?: number) {
    const env = await this.detectEnv();
    return this.exec('xcrun', ['simctl', ...args], { env, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  // --- idb boundary (swap candidate: WebDriverAgent) ---

  /**
   * idb rejects simctl's `booted` alias — it wants a concrete UDID. Resolve
   * it once via `simctl list` when no explicit udid was given.
   */
  private bootedUdidPromise: Promise<string> | undefined;

  private resolveTarget(): Promise<string> {
    if (this.udid) return Promise.resolve(this.udid);
    this.bootedUdidPromise ??= (async () => {
      const devices = await this.listDevices();
      const booted = devices.find((d) => d.state === 'booted');
      if (!booted) throw new Error('No booted simulator — boot one with `xcrun simctl boot <name>`');
      return booted.id;
    })();
    return this.bootedUdidPromise;
  }

  private async idb(args: string[], timeoutMs?: number) {
    const env = await this.detectEnv();
    return this.exec('idb', [...args, '--udid', await this.resolveTarget()],
      { env, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  private idbUi(args: string[]) {
    return this.idb(['ui', ...args]);
  }

  async uiTree(): Promise<UiNode> {
    const { stdout } = await this.idb(['ui', 'describe-all', '--json'], 15_000);
    return parseIdbDescribeAll(stdout.toString('utf8'));
  }

  // --- simctl-backed lifecycle ---

  async listDevices(): Promise<Device[]> {
    const { stdout } = await this.simctl(['list', 'devices', '--json']);
    const parsed = JSON.parse(stdout.toString('utf8')) as {
      devices: Record<string, { udid: string; name: string; state: string; isAvailable: boolean }[]>;
    };
    const devices: Device[] = [];
    for (const [runtime, list] of Object.entries(parsed.devices)) {
      // "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "17.5"
      const osVersion = runtime.match(/iOS-([\d-]+)/)?.[1]?.replace(/-/g, '.') ?? 'unknown';
      for (const d of list) {
        if (!d.isAvailable) continue;
        devices.push({
          id: d.udid,
          platform: 'ios',
          name: d.name,
          osVersion,
          state: d.state === 'Booted' ? 'booted' : 'offline',
        });
      }
    }
    return devices;
  }

  async install(appPath: string): Promise<void> {
    await this.simctl(['install', this.target(), appPath], 120_000);
  }

  async launch(bundleId: string, opts: LaunchOptions = {}): Promise<void> {
    if (opts.activity !== undefined || opts.intent !== undefined) {
      throw new Error(
        'activity/intent launch is Android-only (iOS apps have a single entry point) — ' +
          'use open_deep_link, or wrap the step in an `android:` platform override',
      );
    }
    if (opts.clearState) await this.clearAppData(bundleId);
    await this.simctl(['launch', this.target(), bundleId]);
  }

  async terminate(bundleId: string): Promise<void> {
    // simctl terminate fails if the app is not running — that's fine.
    await this.simctl(['terminate', this.target(), bundleId]).catch(() => undefined);
  }

  async openDeepLink(url: string): Promise<void> {
    await this.simctl(['openurl', this.target(), url]);
  }

  async screenshot(): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'averi-'));
    const file = join(dir, 'screen.png');
    try {
      await this.simctl(['io', this.target(), 'screenshot', file]);
      return await readFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // --- input (idb) ---

  async tap(x: number, y: number): Promise<void> {
    await this.idbUi(['tap', String(x), String(y)]);
  }

  async tapElement(selector: Selector): Promise<string | undefined> {
    const { node, note } = resolveOne(await this.uiTree(), selector);
    const point = tapPoint(node);
    await this.tap(point.x, point.y);
    return note;
  }

  private viewportPromise: Promise<{ width: number; height: number }> | undefined;

  /** Screen size in POINTS — the units idb AX frames use. */
  viewport(): Promise<{ width: number; height: number }> {
    this.viewportPromise ??= (async () => {
      const { stdout } = await this.idb(['describe', '--json']);
      const parsed = JSON.parse(stdout.toString('utf8')) as {
        screen_dimensions?: { width_points?: number; height_points?: number };
      };
      const dims = parsed.screen_dimensions;
      if (!dims?.width_points || !dims.height_points) {
        throw new Error('idb describe returned no screen_dimensions.{width,height}_points');
      }
      return { width: dims.width_points, height: dims.height_points };
    })();
    return this.viewportPromise;
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.idbUi(['tap', String(x), String(y), '--duration', String(durationMs / 1000)]);
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 300,
  ): Promise<void> {
    await this.idbUi(['swipe',
      String(from.x), String(from.y), String(to.x), String(to.y),
      '--duration', String(durationMs / 1000)]);
  }

  async typeText(text: string): Promise<void> {
    await this.idbUi(['text', text]);
  }

  async clearText(count: number): Promise<void> {
    if (count <= 0) return;
    // HID 42 = Backspace, HID 76 = Forward Delete — both verified against the
    // simulator 2026-08-05. Together they clear regardless of cursor position.
    await this.idbUi(['key-sequence', ...Array(count).fill('42')]);
    await this.idbUi(['key-sequence', ...Array(count).fill('76')]);
  }

  async pressKey(key: Key): Promise<void> {
    if (key === 'back') throw new Error('pressKey("back") has no iOS equivalent — use a back button selector or swipe');
    if (key === 'home') await this.idbUi(['button', 'HOME']);
    else await this.idbUi(['key', '40']); // HID usage 40 = Return/Enter
  }

  async setClipboard(text: string): Promise<void> {
    const env = await this.detectEnv();
    await this.exec('xcrun', ['simctl', 'pbcopy', this.target()], { stdin: text, env });
  }

  async isAppRunning(bundleId: string): Promise<boolean> {
    const { stdout } = await this.simctl(['spawn', this.target(), 'launchctl', 'list']);
    return stdout.toString('utf8').includes(`UIKitApplication:${bundleId}`);
  }

  async logs(sinceMs: number): Promise<string[]> {
    const start = formatLogDate(new Date(sinceMs));
    const { stdout } = await this.simctl(
      ['spawn', this.target(), 'log', 'show', '--style', 'compact', '--start', start],
      60_000,
    );
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }

  /** Wipe the app's data container in place (simctl has no `pm clear` equivalent). */
  private async clearAppData(bundleId: string): Promise<void> {
    await this.terminate(bundleId);
    const { stdout } = await this.simctl(['get_app_container', this.target(), bundleId, 'data']);
    const container = stdout.toString('utf8').trim();
    if (!container.startsWith('/')) throw new Error(`Unexpected app container path: ${container}`);
    for (const entry of await readdir(container)) {
      await rm(join(container, entry), { recursive: true, force: true });
    }
  }
}

interface IdbElement {
  type?: string;
  AXLabel?: string | null;
  AXUniqueId?: string | null;
  AXValue?: string | null;
  frame?: { x: number; y: number; width: number; height: number };
}

/**
 * `idb ui describe-all --json` returns a FLAT array of elements, not a tree —
 * normalize under a synthetic root with all elements as direct children.
 */
export function parseIdbDescribeAll(json: string): UiNode {
  const elements = JSON.parse(json) as IdbElement[];
  if (!Array.isArray(elements)) throw new Error('idb describe-all did not return an array');
  const children: UiNode[] = elements.map((el) => ({
    role: ROLE_MAP[el.type ?? ''] ?? 'other',
    label: emptyToNull(el.AXLabel),
    identifier: emptyToNull(el.AXUniqueId),
    value: emptyToNull(el.AXValue),
    rect: el.frame
      ? {
          x: Math.round(el.frame.x),
          y: Math.round(el.frame.y),
          width: Math.round(el.frame.width),
          height: Math.round(el.frame.height),
        }
      : { x: 0, y: 0, width: 0, height: 0 },
    children: [],
  }));
  attachFieldErrors(children);
  return {
    role: 'container',
    label: null,
    identifier: null,
    value: null,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    children,
  };
}

/**
 * Pair validation messages with their inputs (measured convention, payment
 * spike 2026-08-05): a field's title AND its error label share the field's
 * accessibilityIdentifier. The title sits above the field, the error below —
 * so a same-identifier text BELOW the input is its validation message.
 */
function attachFieldErrors(nodes: UiNode[]): void {
  for (const field of nodes) {
    if (field.role !== 'textfield' || field.identifier === null) continue;
    const fieldBottom = field.rect.y + field.rect.height;
    const below = nodes.filter(
      (n) =>
        n !== field &&
        n.role === 'text' &&
        n.identifier === field.identifier &&
        n.label !== null &&
        n.rect.y >= fieldBottom,
    );
    if (below.length === 0) continue;
    below.sort((a, b) => a.rect.y - b.rect.y);
    field.error = below[0].label!;
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

/** `log show --start` expects "YYYY-MM-DD HH:MM:SS" in local time. */
function formatLogDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

import { XMLParser } from 'fast-xml-parser';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { sleep } from '../util/sleep.js';
import type { Device, DeviceAdapter, Key, LaunchOptions, UiNode } from './types.js';

const KEYCODES: Record<Key, string> = { back: '4', home: '3', enter: '66' };

/** uiautomator's "the app has no window yet" status — a transient, not a failure. */
const NULL_ROOT_RE = /null root node/i;
const NULL_ROOT_RETRY_MS = 1_000;
const DUMP_TIMEOUT_MS = 15_000;

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

  async launch(packageName: string, opts: LaunchOptions = {}): Promise<void> {
    if (opts.clearState) await this.adb(['shell', 'pm', 'clear', packageName]);
    if (opts.activity === undefined && opts.intent === undefined) {
      // monkey resolves the launcher activity for us, but picks ARBITRARILY
      // when the package declares several (LeakCanary adds one in debug
      // builds, so this may open LeakCanary) — set app.android.activity in
      // averi.yaml to pin the entry point.
      await this.adb(['shell', 'monkey', '-p', packageName, '-c',
        'android.intent.category.LAUNCHER', '1']);
      return;
    }
    const args = ['shell', 'am', 'start'];
    if (opts.activity !== undefined) {
      // ".MainActivity" and "com.foo.MainActivity" both resolve against the
      // package; a full "pkg/Activity" component passes through unchanged.
      const component = opts.activity.includes('/')
        ? opts.activity
        : `${packageName}/${opts.activity}`;
      args.push('-n', component);
    }
    const intent = opts.intent ?? {};
    if (intent.action !== undefined) args.push('-a', intent.action);
    if (intent.data !== undefined) args.push('-d', intent.data);
    if (intent.mimeType !== undefined) args.push('-t', intent.mimeType);
    for (const category of intent.categories ?? []) args.push('-c', category);
    for (const [key, value] of Object.entries(intent.extras ?? {})) args.push('--es', key, value);
    await this.adb(args);
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

  async uiTree(opts: { settle?: boolean } = {}): Promise<UiNode> {
    // Dump to stdout; uiautomator appends a status line after the XML.
    for (let attempt = 0; ; attempt++) {
      let raw: string;
      try {
        raw = (await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], DUMP_TIMEOUT_MS)).stdout.toString('utf8');
      } catch (e) {
        // adb itself failing is the OTHER offline shape (exit 255, "device
        // '<id>' not found" / "device offline"); a dump that never returns is
        // the loaded-host shape (measured 2026-09-17, finportal: 11.4 s at
        // load avg 28). Diagnose both like a dump that returned nothing, so the
        // caller never has to read a bare adb error (review 2026-09-18).
        if (e instanceof ExecError) {
          const last = e.stderr.trim().split('\n').pop() ?? '';
          throw new Error(await this.diagnoseDumpFailure(e.timedOut ? 'timeout' : 'exec-error', last, false), { cause: e });
        }
        throw e;
      }
      const xmlEnd = raw.lastIndexOf('>');
      if (xmlEnd !== -1) return parseUiautomatorXml(raw.slice(0, xmlEnd + 1));
      const status = raw.trim().slice(0, 200);
      // "null root node" is uiautomator saying the app has no window to dump YET
      // (cold launch, ~2-3 s; mid-animation). The one-shot MCP tools opt into a
      // single bounded retry with `settle`; pollers do NOT —
      // their own poll interval already is the retry, and a hidden extra
      // second per miss would only shrink the number of probes their deadline
      // affords (review 2026-09-18).
      if (opts.settle && NULL_ROOT_RE.test(status) && attempt === 0) {
        await sleep(NULL_ROOT_RETRY_MS);
        continue;
      }
      throw new Error(await this.diagnoseDumpFailure('no-xml', status, opts.settle === true));
    }
  }

  /**
   * Turn a dump that produced no XML into a diagnosis the caller can act on.
   *
   * The dump's own text names the automation tool, never the device:
   * measured 2026-09-17 (mp-native run 5), an emulator dying underneath
   * answered `Killed`, then an empty string, then `null root node` — and adb
   * itself still exited 0 each time, so the ExecError path never fired. Three
   * calls were spent on uiautomator hypotheses before `adb shell wm size`
   * said `device offline`. `adb get-state` is that one-line discriminator,
   * so run it HERE, after the failure, and lead with what it says. (Spends up
   * to 5 s of device time — hence "diagnose", not "explain".)
   */
  private async diagnoseDumpFailure(
    kind: 'no-xml' | 'timeout' | 'exec-error',
    status: string,
    retried: boolean,
  ): Promise<string> {
    const dump = kind === 'timeout'
      ? `uiautomator dump timed out after ${DUMP_TIMEOUT_MS / 1000} s`
      : kind === 'exec-error'
        ? `adb could not run uiautomator dump: ${status}`
        : `uiautomator dump returned no XML: ${status}`;
    const id = this.serial ?? 'the default adb device';
    let state: string;
    try {
      state = (await this.adb(['get-state'], 5_000)).stdout.toString('utf8').trim();
    } catch (e) {
      // `adb get-state` on an offline/missing device exits 1 with
      // "error: device offline" / "error: device '<id>' not found" on stderr.
      state = e instanceof ExecError
        ? (e.stderr.trim().replace(/^(Command failed:.*\n)?\s*(error|adb):\s*/s, '') || `exit ${e.exitCode}`)
        : String(e);
    }
    if (/more than one device/i.test(state)) {
      return `several Android devices are attached and none is selected — \`list_devices\` then ` +
        `\`select_device\` before reading a tree (adb: "${state}"). (${dump})`;
    }
    if (state !== 'device') {
      return `device ${id} is not reachable: adb get-state says "${state || 'unknown'}" — ` +
        `recover the device (wait for \`adb devices\` to read \`device\`; \`adb kill-server && adb start-server\` ` +
        `if it does not) before reading its tree. Not an averi or uiautomator fault. (${dump})`;
    }
    if (kind === 'exec-error') {
      return `${dump} — yet adb get-state says "device"; adb itself failed, not the app. Re-check \`adb devices\` and retry once.`;
    }
    if (kind === 'timeout') {
      return `device ${id} is reachable but SLOW: ${dump} while adb get-state says "device" — the host or ` +
        `emulator is under load (measured 2026-09-17: an 11.4 s dump at load avg 28). Not a dead app and not a ` +
        `code defect; ease the load (builds, other emulators) and retry.`;
    }
    if (NULL_ROOT_RE.test(status)) {
      return `device ${id} is still settling: uiautomator has no window to dump yet ` +
        `(cold launch or animation; ${retried ? `retried once after ${NULL_ROOT_RETRY_MS} ms` : 'read once'}). ` +
        `Wait for the screen (\`screenshot\` waits for stability) and retry. (${dump})`;
    }
    return `${dump} — adb get-state says "device", so the dump itself died on the guest ` +
      `(hung or memory-pressured emulator: "Killed" / empty output). Re-check \`adb devices\` and retry; ` +
      `if it repeats, the emulator, not the app, needs attention.`;
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb(['shell', 'input', 'tap', String(x), String(y)]);
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
    // One `input text` call PER CHARACTER, with explicit pacing. Bulk injection
    // races Compose's async text state and silently drops most characters
    // (measured 2026-08-05 on the login username field: 3 of 11 landed). The adb
    // round-trip alone is NOT enough pacing on a loaded emulator — re-measured
    // the same evening after hours of uptime: per-char with no delay landed 5 of
    // 8, per-char with 300ms landed 8/8. 250ms keeps a 12-char value at ~3s.
    for (const ch of text) {
      const escaped = ch.replace(/([\\"'`$&*()[\]{}|;<>?~#])/, '\\$1').replace(/ /, '%s');
      await this.adb(['shell', 'input', 'text', escaped]);
      await sleep(250);
    }
    // Force the IME to COMMIT the final composing character: GBoard holds the
    // last injected char in a composition span for seconds, and a BACK or a
    // focus-moving tap discards it — a fixed post-type sleep (tried 500ms) is
    // NOT enough. Moving the cursor left and back right commits the span
    // deterministically (measured 2026-08-05: verified-8/submitted-7 with the
    // sleep; 8/8 submitted with the cursor nudge even when BACK follows
    // immediately).
    await this.adb(['shell', 'input', 'keyevent', '21']); // DPAD_LEFT
    await this.adb(['shell', 'input', 'keyevent', '22']); // DPAD_RIGHT
    await sleep(150);
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
    // `|| true` makes the device shell exit 0 whether or not a process matched,
    // so an EMPTY stdout is the one "not running" signal and any ExecError is
    // the TRANSPORT failing — adb timing out under host load, the device
    // offline — i.e. a question that could not be asked, never a dead app
    // (measured 2026-09-17, finportal: a timed-out adb call here became
    // `appAlive: false` for an app alive on the expected screen). The exit code
    // cannot carry that distinction: exec.ts substitutes err.message when
    // stderr is empty, so ExecError.stderr is never blank (review 2026-09-18).
    if (!/^[A-Za-z0-9_.]+$/.test(packageName)) throw new Error(`invalid Android package name: ${packageName}`);
    const { stdout } = await this.adb(['shell', `pidof ${packageName} || true`]);
    return stdout.toString('utf8').trim() !== '';
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

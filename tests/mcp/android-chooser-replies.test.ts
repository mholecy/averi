import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { FlowEngine } from '../../src/flow/engine.js';
import { parseConfig } from '../../src/flow/config.js';
import { EngineSession, launchApp } from '../../src/flow/launch.js';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

beforeEach(() => {
  resetSleeps();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/**
 * A real AndroidAdapter over batch-11's D55b replies (averi_lab, API 33): every `am start` answers the `-p` start's real
 * stdout, the focus read averi's own read at its return — the chooser in front.
 */
async function chooserUp(): Promise<AndroidAdapter> {
  const start = await fixture('am-start-p-api33-b11-chooser.txt');
  const focus = await fixture('dumpsys-window-focus-api33-b11-after-launch-intent-start.txt');
  const exec: ExecFn = async (_cmd, args) => {
    const stdout = args.includes('am') ? start : args.some((a) => a.startsWith('dumpsys window')) ? focus : '';
    return { stdout: Buffer.from(stdout), stderr: '' };
  };
  return new AndroidAdapter({ drawnOverStrip, serial: 'e', exec });
}

const NOTE =
  'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
  "is in front, asking which of dev.averi.lab's activities takes the intent. Take a ui_snapshot, tap the app you " +
  'mean, then its "Just once" button if it shows one (never "Always": it changes the device\'s default for this ' +
  'intent); press_key back drops the launch. averi taps nothing itself. Naming the activity (`activity:` on the ' +
  'launch step / launch_app) starts it without the chooser.';

// The replies with Android's chooser in front, end to end — a real AndroidAdapter through flow/launch.ts and the reply
// text (tool-text.ts): launch_app's ⚠ line and the flow's `⚠ launch` line name the chooser (D55b; ADR 0041's D55b
// amendment, D56's shape on iOS), and open_deep_link's reply over the same chooser stays D55's, byte for byte.
describe("launch_app's, the flow's and open_deep_link's replies over Android's chooser (D55b)", () => {
  it("launch_app's reply: the Launched headline, then the chooser note as its one ⚠ line", async () => {
    const launched = await launchApp(await chooserUp(), undefined, new EngineSession(), {
      appId: 'dev.averi.lab',
      intent: { action: 'android.intent.action.VIEW', data: 'averilab://shared/x' },
    });
    expect(launchText('android', launched)).toBe(`Launched dev.averi.lab on android\n⚠ ${NOTE}`);
  });

  it("a flow's launch: the `⚠ launch` line carries the chooser note, and the flow goes on", async () => {
    const cfg = parseConfig(`
app:
  android: { package: dev.averi.lab }
flows:
  open:
    steps:
      - launch:
          intent: { action: android.intent.action.VIEW, data: "averilab://shared/x" }
`);
    const trace = await FlowEngine.run(cfg, await chooserUp(), { env: {}, session: new EngineSession() }, { flow: 'open' });
    const at = trace.findIndex((t) => t.action === 'launch');
    expect(trace.slice(at, at + 2)).toEqual([
      { action: 'launch', detail: 'dev.averi.lab' },
      { action: '⚠ launch', detail: NOTE },
    ]);
    expect(trace.at(-1)).toEqual({ action: 'flow open', detail: 'done' });
  });

  it("open_deep_link's reply over the chooser is D55's, unchanged (batch-11's raise, as averi replied it)", async () => {
    const adapter = await chooserUp();
    expect(deepLinkText('android', 'averilab://shared/open', await adapter.openDeepLink('averilab://shared/open'))).toBe(
      'Android has not opened averilab://shared/open yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        'is in front, asking which app opens it. Take a ui_snapshot, tap the app you mean, then its "Just once" button ' +
        'if it shows one (never "Always": it changes the device\'s default for such links); press_key back drops the ' +
        'link. averi taps nothing itself.',
    );
  });
});

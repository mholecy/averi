import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AndroidAdapter, FOCUSED_WINDOW_COMMAND, parseFocusedWindow } from '../../src/adapters/android.js';
import { ExecError, type ExecFn } from '../../src/adapters/exec.js';
import { WINDOW_MANAGER_WORD } from '../../scripts/truth/schema.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';

// THE WINDOW MANAGER'S WORD ON THE FOCUSED WINDOW (ADR 0018, "Android's window by the window manager's word"):
// `uiautomator dump` lists the active window only and its XML says nothing of the window itself, so a full-screen
// dialog dumps as an app's screen. The window manager types every window: an activity's is TYPE_BASE_APPLICATION, a
// Dialog's TYPE_APPLICATION (Compose's, AppCompat's, Material's, a bottom sheet's), a popup's a panel. The dumps are the
// lab captures' own, read by FOCUSED_WINDOW_COMMAND right after the tree (averi_lab, API 33, 1080x2220:
// tests/fixtures/truth/android-averi_lab-api33/<cell>.windows.txt).

const dumpOf = (cell: string): string => readFileSync(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.windows.txt`, import.meta.url), 'utf8');
const SCREEN = { width: 1080, height: 2220 };

describe('parseFocusedWindow: the focused window by its type, its frame and what else of the app shows', () => {
  it('the full-screen Compose dialog (dialog-fullscreen): a Dialog\'s window, laid between the bars — stacked, at the dump\'s root bounds', () => {
    expect(parseFocusedWindow(dumpOf('dialog-fullscreen'))).toEqual({ of: 'stacked', frame: { x: 0, y: 66, width: 1080, height: 2087 }, screen: SCREEN });
  });

  it('a Views dialog laid full screen (dialog-views-fullscreen): at 0,0 the screen\'s size, an activity\'s shape — stacked all the same', () => {
    expect(parseFocusedWindow(dumpOf('dialog-views-fullscreen'))).toEqual({ of: 'stacked', frame: { x: 0, y: 0, width: 1080, height: 2220 }, screen: SCREEN });
  });

  it('the sheets and the alert are Dialogs too: bottom-sheet-dialog, sheet-medium, form-picker\'s expanded picker, alert-dim', () => {
    expect(parseFocusedWindow(dumpOf('bottom-sheet-dialog'))).toEqual({ of: 'stacked', frame: { x: 0, y: 0, width: 1080, height: 2220 }, screen: SCREEN });
    expect(parseFocusedWindow(dumpOf('sheet-medium'))).toMatchObject({ of: 'stacked' });
    expect(parseFocusedWindow(dumpOf('form-picker'))).toEqual({ of: 'stacked', frame: { x: 0, y: 0, width: 1080, height: 2220 }, screen: SCREEN });
    expect(parseFocusedWindow(dumpOf('alert-dim'))).toEqual({ of: 'stacked', frame: { x: 155, y: 851, width: 770, height: 517 }, screen: SCREEN });
  });

  it('a plain screen (open): the activity\'s own window has focus and no other window of an app is visible — the screen alone', () => {
    expect(parseFocusedWindow(dumpOf('open'))).toEqual({ of: 'screenAlone', frame: { x: 0, y: 0, width: 1080, height: 2220 } });
  });

  it('…but not when another window of an app is visible beside it (a translucent activity over another, a non-focusable popup): unknown', () => {
    const dump = dumpOf('open');
    const launcher = dump.indexOf('com.google.android.apps.nexuslauncher/');
    expect(launcher).toBeGreaterThan(0);
    const shown = dump.slice(0, launcher) + dump.slice(launcher).replace('    isVisible=false', '    isVisible=true');
    expect(parseFocusedWindow(shown)).toEqual({ of: 'unknown' });
  });

  it('an activity\'s window is never stacked, whatever its frame', () => {
    const asBase = dumpOf('dialog-fullscreen').replace(/ty=APPLICATION /g, 'ty=BASE_APPLICATION ');
    expect(parseFocusedWindow(asBase)).toEqual({ of: 'unknown' });
  });

  it('a frame laid past the screen\'s edge is clipped to it, as the dump clips its root (`Requested w=1081` of a 1080 screen)', () => {
    const past = dumpOf('dialog-fullscreen').replace('frame=[0,66][1080,2153] last=', 'frame=[0,66][1081,2153] last=');
    expect(past).not.toBe(dumpOf('dialog-fullscreen'));
    expect(parseFocusedWindow(past)).toEqual({ of: 'stacked', frame: { x: 0, y: 66, width: 1080, height: 2087 }, screen: SCREEN });
  });

  it('a system window focused (the notification shade, `ty=2040`), or the app\'s starting window: unknown, never stacked', () => {
    const dump = dumpOf('dialog-fullscreen');
    const shade = /Window\{([0-9a-f]+) u0 NotificationShade\}/.exec(dump)?.[1];
    expect(shade).toBeDefined();
    expect(parseFocusedWindow(dump.replace(/mCurrentFocus=Window\{[0-9a-f]+ [^}]*\}/, `mCurrentFocus=Window{${shade} u0 NotificationShade}`))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(dump.replace('ty=APPLICATION fmt=TRANSPARENT', 'ty=APPLICATION_STARTING fmt=TRANSPARENT'))).toEqual({ of: 'unknown' });
  });

  it('a visible window whose type the dump does not print counts as an app\'s beside the activity\'s: unknown, the hint stays', () => {
    const dump = dumpOf('open');
    const at = dump.indexOf('Window{ab27f1c u0 NavigationBar0}:');
    const end = dump.indexOf('\n  Window #', at);
    expect(at).toBeGreaterThan(0);
    const untyped = dump.slice(0, at) + dump.slice(at, end).replace(/ty=NAVIGATION_BAR /g, '') + dump.slice(end);
    expect(parseFocusedWindow(untyped)).toEqual({ of: 'unknown' });
  });

  it('no focus, no such window, no display size, a cut dump or garbage: unknown', () => {
    const dump = dumpOf('dialog-fullscreen');
    expect(parseFocusedWindow(dump.replace(/mCurrentFocus=Window\{[^}]*\}/, 'mCurrentFocus=null'))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(dump.replace(/mCurrentFocus=Window\{[0-9a-f]+ /, 'mCurrentFocus=Window{0000000 '))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(dump.replace(/DisplayFrames w=\d+ h=\d+/, ''))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(dump.slice(0, dump.indexOf('WINDOW MANAGER WINDOWS')))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow('Can\'t find service: window')).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow('')).toEqual({ of: 'unknown' });
  });
});

describe('AndroidAdapter.focusedWindow: one adb call, failing open', () => {
  const adapterAnswering = (answer: ExecFn) => new AndroidAdapter({ serial: 'emulator-5554', exec: answer, drawnOverStrip });

  it('sends the one command line the capture records (lab-device\'s WINDOW_MANAGER_WORD) and reads its answer', async () => {
    expect(FOCUSED_WINDOW_COMMAND).toBe(WINDOW_MANAGER_WORD);
    const calls: string[][] = [];
    const adapter = adapterAnswering(async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { stdout: Buffer.from(dumpOf('dialog-fullscreen')), stderr: '' };
    });
    expect(await adapter.focusedWindow()).toMatchObject({ of: 'stacked' });
    expect(calls).toEqual([['adb', '-s', 'emulator-5554', 'shell', FOCUSED_WINDOW_COMMAND]]);
  });

  it('bounds the call at 2 s, so a hung adb delays a miss\'s reply by no more', async () => {
    const timeouts: (number | undefined)[] = [];
    await adapterAnswering(async (_cmd, _args, opts) => (timeouts.push(opts?.timeoutMs), { stdout: Buffer.from(dumpOf('open')), stderr: '' })).focusedWindow();
    expect(timeouts).toEqual([2_000]);
  });

  it('an adb exit, a timeout or garbage: unknown', async () => {
    expect(await adapterAnswering(async () => Promise.reject(new ExecError('adb', 1, 'error: device offline'))).focusedWindow()).toEqual({ of: 'unknown' });
    expect(await adapterAnswering(async () => Promise.reject(new ExecError('adb', null, '', true))).focusedWindow()).toEqual({ of: 'unknown' });
    expect(await adapterAnswering(async () => ({ stdout: Buffer.from('garbage'), stderr: '' })).focusedWindow()).toEqual({ of: 'unknown' });
  });
});

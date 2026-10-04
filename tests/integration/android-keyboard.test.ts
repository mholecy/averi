import { describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { tapElement } from '../../src/interact/tap.js';
import { INPUT_SHOWN_LINE } from '../helpers/android-dumps.js';

/**
 * The soft-keyboard guard driven END TO END through the real AndroidAdapter
 * over a scripted adb: the two scenarios that prove the words cross the layer
 * — interact/keyboard.ts's protocol (tests/interact/keyboard.test.ts, on the
 * fake) becomes this exact sequence of adb calls, with the adapter's own
 * parsers (tests/adapters/android.test.ts) reading real dump lines in between.
 * One file, two scenarios, deliberately: the adapter tests assert adb
 * behaviour and the interact tests assert the protocol; pinning the guard's
 * cadence from the adapter's file (where these sat until 2026-10-04) broke
 * the adapter tests whenever interact/ changed its mind.
 */

// The one sleep owner is recorded, not waited on — the guard's pauses are not this test's subject.
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));

const dump = 'adb -s emulator-5554 exec-out uiautomator dump /dev/tty';
const query = 'adb -s emulator-5554 shell dumpsys window displays';
const witness = 'adb -s emulator-5554 shell dumpsys input_method | grep -m1 -w mInputShown';

const hierarchy = (nodes: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" bounds="[0,0][1080,2220]">
    ${nodes}
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;

describe('the keyboard guard through AndroidAdapter and adb', () => {
  it('a tap on a node under the keyboard presses back (keyevent 4), re-reads the tree, and taps the node where it now is', async () => {
    const tree = (top: number) =>
      hierarchy(
        `<node index="0" text="Sign in" resource-id="com.example.app:id/login_submit" class="android.widget.Button" package="com.example.app" content-desc="" bounds="[99,${top}][399,${top + 132}]"/>`,
      );
    const shown = '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true insetsRoundedCornerFrame=false\n';
    const hidden = '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false\n';
    let keyboardUp = true;
    const calls: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      calls.push(full);
      const out = (text: string) => ({ stdout: Buffer.from(text), stderr: '' });
      if (full.endsWith('input keyevent 4')) keyboardUp = false;
      if (full.includes('uiautomator dump')) return out(tree(keyboardUp ? 1400 : 1700));
      if (full.includes('dumpsys window displays')) return out(keyboardUp ? shown : hidden);
      if (full.includes('dumpsys input_method')) return out(INPUT_SHOWN_LINE(keyboardUp));
      return out('');
    };
    const { note } = await tapElement(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }), 'id:login_submit', { ambiguous: 'refuse', pollMs: 1 });
    // The witness is asked ONCE, right before the key, and not again for the check after it.
    expect(calls).toEqual([dump, dump, query, witness, 'adb -s emulator-5554 shell input keyevent 4', dump, dump, query, 'adb -s emulator-5554 shell input tap 249 1766']);
    expect(note).toBe('the soft keyboard covered id:login_submit; hidden before tapping');
  });

  it('the STALE window state (measured 2026-10-04): window says shown, input method says not — no keyevent; the window state is asked again and, once it has cleared, the node is tapped', async () => {
    const tree = hierarchy(
      '<node index="0" text="Home" resource-id="com.example.app:id/home_tile" class="android.widget.Button" package="com.example.app" content-desc="" bounds="[99,1400][399,1532]"/>',
    );
    // The two real dumps' lines: stale right after the navigation, caught up a few seconds later.
    const stale = '    mIsImeShowing=true\n        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false\n';
    const caughtUp = '    mIsImeShowing=false\n        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false\n';
    const calls: string[] = [];
    let windowQueries = 0;
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      calls.push(full);
      const out = (text: string) => ({ stdout: Buffer.from(text), stderr: '' });
      if (full.includes('uiautomator dump')) return out(tree);
      if (full.includes('dumpsys window displays')) return out(++windowQueries <= 2 ? stale : caughtUp);
      if (full.includes('dumpsys input_method')) return out(INPUT_SHOWN_LINE(false));
      return out('');
    };
    const { note } = await tapElement(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }), 'id:home_tile', { ambiguous: 'refuse', pollMs: 1 });
    expect(calls).toEqual([dump, dump, query, witness, query, witness, query, dump, dump, 'adb -s emulator-5554 shell input tap 249 1466']);
    expect(note).toBe('the window state reported a soft keyboard over id:home_tile that the input method denied; waited 1000ms for it to clear');
  });
});

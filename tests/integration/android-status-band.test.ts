import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { OffScreenRefusal } from '../../src/interact/resolve.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { tapElement } from '../../src/interact/tap.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';

/**
 * Android's status band END TO END through the real AndroidAdapter over a
 * scripted adb (2026-10-12, docs/bugs/2026-10-10-android-tap-and-scroll-
 * until-treat-the-system-status-bar-as-app-screen.md): the adapter reads the
 * status bar out of `dumpsys window displays` (the real API 33 dump, its
 * `InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true`)
 * and the tap's on-screen rule and `scroll_until`'s stop — interact/'s,
 * unchanged, iOS's since 2026-10-09 — judge Google Contacts' collapsed app
 * bar against it. The rects are the device check's (run10-android,
 * #99/#145): the list `0,0 1080x1977` scrollable, the app bar `0,0
 * 1080x66`, its `All contacts` text cut to `149,0 213x6`.
 */

// The one sleep owner is recorded, not waited on — the settles are not this test's subject.
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));

const wmSize = 'adb -s emulator-5554 shell wm size';
const displays = 'adb -s emulator-5554 shell dumpsys window displays';

const bounds = (x: number, y: number, w: number, h: number) => `[${x},${y}][${x + w},${y + h}]`;
const contacts = (rows: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.google.android.contacts" content-desc="" bounds="${bounds(0, 0, 1080, 2220)}">
    <node index="0" text="" resource-id="com.google.android.contacts:id/contact_list" class="androidx.recyclerview.widget.RecyclerView" package="com.google.android.contacts" content-desc="" scrollable="true" bounds="${bounds(0, 0, 1080, 1977)}">
      <node index="0" text="" resource-id="com.google.android.contacts:id/app_bar_layout" class="android.widget.LinearLayout" package="com.google.android.contacts" content-desc="" bounds="${bounds(0, 0, 1080, 66)}">
        <node index="0" text="" resource-id="" class="android.widget.Button" package="com.google.android.contacts" content-desc="" bounds="${bounds(44, 0, 423, 44)}">
          <node index="0" text="All contacts" resource-id="" class="android.widget.TextView" package="com.google.android.contacts" content-desc="" bounds="${bounds(149, 0, 213, 6)}"/>
        </node>
      </node>
      ${rows}
    </node>
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;
const ROWS =
  `<node index="1" text="Alice" resource-id="" class="android.widget.TextView" package="com.google.android.contacts" content-desc="" bounds="${bounds(100, 300, 300, 60)}"/>` +
  // An icon button at the Contacts toolbar's height, centre y 154, below the band (round 7's Contacts icons).
  `<node index="2" text="" resource-id="" class="android.widget.ImageButton" package="com.google.android.contacts" content-desc="Search" bounds="${bounds(966, 110, 88, 88)}"/>` +
  // A back button where mp-native's sits, centre (77,154).
  `<node index="3" text="" resource-id="" class="android.widget.ImageButton" package="com.google.android.contacts" content-desc="Navigate up" bounds="${bounds(33, 110, 88, 88)}"/>`;

/** `xml` is the tree every dump returns, or a function of the content's offset, which each `input swipe` moves by its dy. */
const adapterOver = async (xml: string | ((offset: number) => string)) => {
  let offset = 0;
  const dump = await readFile(new URL('../fixtures/dumpsys-window-displays-api33-keyboard-hidden.txt', import.meta.url), 'utf8');
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    const out = (text: string) => ({ stdout: Buffer.from(text), stderr: '' });
    const swipe = full.match(/input swipe \d+ (\d+) \d+ (\d+) \d+$/);
    if (swipe) offset += Number(swipe[2]) - Number(swipe[1]);
    if (full.includes('uiautomator dump')) return out(typeof xml === 'string' ? xml : xml(offset));
    if (full === wmSize) return out('Physical size: 1080x2220\n');
    if (full === displays) return out(dump);
    if (full.includes('dumpsys input_method')) return out('  mInputShown=false\n');
    return out('');
  };
  return { adapter: new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }), calls };
};

const OPTS = { ambiguous: 'refuse' as const, pollMs: 1, timeoutMs: 50 };

describe('Android\'s status band through AndroidAdapter and adb', () => {
  it('tap text:"All contacts" at (256,3), under the status bar: REFUSED, nothing tapped (was `Tapped`, `input tap 256 3`)', async () => {
    const { adapter, calls } = await adapterOver(contacts(ROWS));
    const refusal = await tapElement(adapter, 'text:"All contacts"', OPTS).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(OffScreenRefusal);
    expect((refusal as Error).message).toBe(
      'text:"All contacts" is under the status bar at (256,3), in the top 66 of the screen (tree units), where a tap goes to the status bar ' +
        '(rect 149,0 213x6) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped',
    );
    expect(calls.some((c) => c.includes('input tap'))).toBe(false);
  });

  it('plain scroll_until text:"All contacts" is not "fully visible after 0 swipes" on the 6-px sliver: it swipes, and fails naming the status bar when nothing moves', async () => {
    const { adapter, calls } = await adapterOver(contacts(ROWS));
    const failure = await scrollUntilVisible(adapter, 'text:"All contacts"', { maxSwipes: 2, settleMs: 0, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/under the status bar at \(256,3\), in the top 66 of the screen \(tree units\),/);
    expect(calls.some((c) => c.includes('input swipe'))).toBe(true);
  });

  it('must not break: icon buttons below the band (centre y 154 — Contacts\' search, a back button at (77,154)) are tapped where they are', async () => {
    const { adapter, calls } = await adapterOver(contacts(ROWS));
    await tapElement(adapter, 'label:"Search"', OPTS);
    expect(calls.at(-1)).toBe('adb -s emulator-5554 shell input tap 1010 154');
    await tapElement(adapter, 'label:"Navigate up"', OPTS);
    expect(calls.at(-1)).toBe('adb -s emulator-5554 shell input tap 77 154');
  });

  /**
   * The list as a scroller moves it (round 6b's rules, re-checked on Android as the note asks): `All contacts` laid out
   * at `149,-49 213x55`, uiautomator cutting it to the list's top — `149,0 213x6` before any swipe — and each stroke
   * moving it by its dy. The device check measured `fully: true` stopping at `149,149 213x55` after one stroke.
   */
  const moving = (offset: number) => {
    const top = -49 + offset;
    const shown = Math.max(0, top);
    const label = `<node index="0" text="All contacts" resource-id="" class="android.widget.TextView" package="com.google.android.contacts" content-desc="" bounds="${bounds(149, shown, 213, Math.max(0, top + 55 - shown))}"/>`;
    return contacts(ROWS).replace(/<node index="0" text="All contacts"[^>]*\/>/, label);
  };
  const strokes = (calls: string[]) =>
    calls.flatMap((c) => {
      const m = c.match(/input swipe \d+ (\d+) \d+ (\d+) \d+$/);
      return m ? [Number(m[2]) - Number(m[1])] : [];
    });

  it('fully: true on the Contacts shape: one stroke drawing the content DOWN, and the stop wholly below the band', async () => {
    const { adapter, calls } = await adapterOver(moving);
    const r = await scrollUntilVisible(adapter, 'text:"All contacts"', { fully: true, maxSwipes: 4, settleMs: 0, timeoutMs: 5_000 });
    const d = strokes(calls);
    expect(d).toHaveLength(1);
    expect(d[0]).toBeGreaterThan(0);
    expect(r.swipes).toBe(1);
    const tree = moving(d[0]);
    expect(tree).toContain(`text="All contacts" resource-id="" class="android.widget.TextView" package="com.google.android.contacts" content-desc="" bounds="[149,${-49 + d[0]}]`);
    expect(-49 + d[0]).toBeGreaterThanOrEqual(66);
  });

  it('the far-edge turn, the band its reason: a plain scroll_until (direction down, strokes push content UP) turns its first stroke back, and stops once the centre is below the band', async () => {
    const { adapter, calls } = await adapterOver(moving);
    const r = await scrollUntilVisible(adapter, 'text:"All contacts"', { maxSwipes: 4, settleMs: 0, timeoutMs: 5_000 });
    const d = strokes(calls);
    expect(d.length).toBeGreaterThanOrEqual(1);
    expect(d[0]).toBeGreaterThan(0); // turned: content drawn down, not up past the top
    expect(r.swipes).toBe(d.length);
    const offset = d.reduce((a, b) => a + b, 0);
    expect(-49 + offset + 55 / 2).toBeGreaterThanOrEqual(66); // the centre the tap would press, below the band
  });

  it('a Compose list (no scrollable role, only uiautomator\'s scrollable="true") counts as a scroll view in the refusal\'s remedy', async () => {
    const compose = contacts(ROWS).replace('class="androidx.recyclerview.widget.RecyclerView"', 'class="android.view.View"');
    const { adapter } = await adapterOver(compose);
    await expect(tapElement(adapter, 'text:"All contacts"', OPTS)).rejects.toThrow(/it lies in a scroll view — scroll_until it first/);
  });
});

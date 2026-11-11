import { describe, expect, it } from 'vitest';
import type { Platform } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import { appHealth, formatLogExcerpt, LOG_MAX_LINES } from '../../src/run/app-health.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * App health (run/app-health.ts): the `appAlive:` line, the crash scan behind it, and get_logs' excerpt. The line's
 * callers are pinned with it in tests/run/commands.test.ts and tests/run/verify.test.ts; what is pinned here is the
 * line itself and its one failure policy — every device failure is worded into the line, and nothing else is caught.
 */

const CFG = parseConfig(
  ['app:', '  android: { package: com.example.app }', '  ios: { bundleId: com.example.app }'].join('\n'),
);

function fake(platform: Platform): FakeAdapter {
  const adapter = new FakeAdapter({ s: node({ identifier: 'root' }) }, 's');
  adapter.platform = platform;
  return adapter;
}

describe('appHealth', () => {
  it('reports a live app', async () => {
    expect(await appHealth(fake('android'), CFG)).toBe('\nappAlive: true');
  });

  // Measured 2026-09-17 (finportal, host load avg 28): a timed-out `adb shell pidof`
  // read as `appAlive: false` for an app that was alive on the expected screen.
  it('reports UNKNOWN, never dead, when the device cannot be asked', async () => {
    const loaded = fake('android');
    loaded.isAppRunning = async () => {
      throw new Error('Command timed out: adb -s emulator-5554 shell pidof com.example.app');
    };
    const health = await appHealth(loaded, CFG);
    expect(health).toContain('appAlive: unknown');
    expect(health).toContain('Command timed out');
    expect(health).toContain('NOT evidence that the app died');
    expect(health).not.toContain('appAlive: false');
  });

  it('reports a dead app with a crash excerpt from the logs', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logLines = ['FATAL EXCEPTION: main', 'at com.example.app.Main.onCreate(Main.kt:42)'];

    const health = await appHealth(dead, CFG);
    expect(health).toContain('appAlive: false — com.example.app is not running!');
    expect(health).toContain('Crash excerpt:');
    expect(health).toContain('Main.kt:42');
  });

  it('says so plainly when the app died without a crash signature', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logLines = ['nothing interesting here'];

    expect(await appHealth(dead, CFG)).toContain('(no crash signature in the last 60s of logs)');
  });

  it('is silent for a platform the config does not declare', async () => {
    const cfg = parseConfig('app:\n  android: { package: com.example.app }\n');
    expect(await appHealth(fake('ios'), cfg)).toBe('');
  });
});

describe('crash scanning is platform-specific', () => {
  it('an iOS leg matches iOS signatures, not Android ones', async () => {
    const dead = fake('ios');
    dead.appRunning = false;
    dead.logLines = ['Terminating app due to uncaught exception NSRangeException'];
    expect(await appHealth(dead, CFG)).toContain('Crash excerpt:');

    // An Android-only signature must NOT be picked up on an iOS leg.
    const other = fake('ios');
    other.appRunning = false;
    other.logLines = ['FATAL EXCEPTION: main'];
    expect(await appHealth(other, CFG)).toContain('(no crash signature in the last 60s of logs)');
  });
});

describe('the crash excerpt', () => {
  // Until A29 verify/assert.ts's scanForCrashes, tested there on its own; the scan has one reader, this line.
  it('keeps an Android fatal exception with its trailing stack context, and no line before it', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logLines = [
      '07-08 11:00:00.000  1234  1234 I ActivityManager: ok line',
      '07-08 11:00:01.000  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main',
      '07-08 11:00:01.001  5678  5678 E AndroidRuntime: java.lang.NullPointerException',
      '07-08 11:00:01.002  5678  5678 E AndroidRuntime:   at md.bank.app.MainActivity.onCreate',
    ];
    expect(await appHealth(dead, CFG)).toBe(
      '\nappAlive: false — com.example.app is not running!\nCrash excerpt:\n' + dead.logLines.slice(1).join('\n'),
    );
  });

  it('takes eight lines from a signature, and at most 24 in all', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logLines = Array.from({ length: 40 }, (_, i) => (i % 10 === 0 ? `FATAL EXCEPTION ${i}` : `context ${i}`));
    const excerpt = (await appHealth(dead, CFG)).split('Crash excerpt:\n')[1].split('\n');
    expect(excerpt).toHaveLength(24);
    expect(excerpt.slice(0, 9)).toEqual([...dead.logLines.slice(0, 8), 'FATAL EXCEPTION 10']);
  });

  it('a signature inside an earlier one\'s eight lines is not taken twice', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logLines = Array.from({ length: 16 }, (_, i) => (i === 0 || i === 7 ? `FATAL EXCEPTION ${i}` : `context ${i}`));
    const excerpt = (await appHealth(dead, CFG)).split('Crash excerpt:\n')[1].split('\n');
    expect(excerpt).toEqual(dead.logLines.slice(0, 8));
  });

  it('detects an iOS uncaught exception', async () => {
    const dead = fake('ios');
    dead.appRunning = false;
    dead.logLines = ['all quiet', 'Terminating app due to uncaught exception NSRangeException'];
    expect(await appHealth(dead, CFG)).toBe(
      '\nappAlive: false — com.example.app is not running!\nCrash excerpt:\n' +
        'Terminating app due to uncaught exception NSRangeException',
    );
  });
});

/**
 * The one failure policy (A29). appHealth's four callers — ensure_state, run_flow, assert and a verify leg — await
 * it bare, because it words every DEVICE failure into the line itself; what it does not catch is an adapter breaking
 * its contract, which fails each caller's call alike (their own tests pin that).
 */
describe('one failure policy: the device\'s failures are the line\'s, nothing else is caught', () => {
  it('a question the device cannot answer is `unknown`, on either platform, naming the platform\'s check', async () => {
    for (const [platform, check] of [
      ['android', 'check `adb devices` and host load'],
      ['ios', 'check `xcrun simctl list devices booted` and host load (reboot the simulator if it does not answer)'],
    ] as const) {
      const loaded = fake(platform);
      loaded.isAppRunning = async () => {
        throw new Error('Command timed out\nsecond line');
      };
      expect(await appHealth(loaded, CFG)).toBe(
        '\nappAlive: unknown — could not ask the device whether com.example.app runs (Command timed out); ' +
          `the device is unreachable or under load. NOT evidence that the app died — ${check}, then retry.`,
      );
    }
  });

  it('logs that cannot be read cost the excerpt, never the verdict', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logs = async () => {
      throw new Error('adb: device offline');
    };
    expect(await appHealth(dead, CFG)).toBe(
      '\nappAlive: false — com.example.app is not running!\n(no crash signature in the last 60s of logs)',
    );
  });

  it('a log read that answers with no array is a broken adapter: thrown, not worded', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logs = async () => null as unknown as string[];
    await expect(appHealth(dead, CFG)).rejects.toThrow(TypeError);
  });
});

describe('formatLogExcerpt', () => {
  const lines = (n: number, prefix = 'line'): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

  it('passes short unfiltered output through with no header', () => {
    expect(formatLogExcerpt(['a', 'b'], undefined)).toBe('a\nb');
  });

  // The counting is the point: a grep that matched nothing must SAY so, or it
  // reads exactly like a quiet device.
  it('reports what the grep matched, including nothing', () => {
    const out = formatLogExcerpt(['ERROR boom', 'info ok'], 'error');
    expect(out).toBe('[grep /error/i matched 1 of 2 lines]\nERROR boom');
    expect(formatLogExcerpt(['info ok'], 'crash')).toBe('[grep /crash/i matched 0 of 1 lines]');
  });

  // One limit, one owner: the get_logs tool's schema default is this same
  // constant (tests/mcp/tool-descriptions.test.ts); until 2026-10-08 the
  // function alone defaulted to 2000.
  it('keeps LOG_MAX_LINES lines when the caller names no budget', () => {
    const out = formatLogExcerpt(lines(LOG_MAX_LINES + 1), undefined).split('\n');
    expect(out[0]).toBe(`[truncated: showing last ${LOG_MAX_LINES} of ${LOG_MAX_LINES + 1} lines]`);
    expect(out).toHaveLength(LOG_MAX_LINES + 1);
  });

  it('keeps the TAIL when truncating and admits it', () => {
    const out = formatLogExcerpt(lines(5), undefined, 2).split('\n');
    expect(out[0]).toBe('[truncated: showing last 2 of 5 lines]');
    expect(out.slice(1)).toEqual(['line 3', 'line 4']);
  });

  it('counts against the filtered set, not the raw one', () => {
    const out = formatLogExcerpt([...lines(3, 'keep'), ...lines(50, 'drop')], 'keep', 2);
    expect(out).toContain('[grep /keep/i matched 3 of 53 lines]');
    expect(out).toContain('[truncated: showing last 2 of 3 lines]');
    expect(out).toContain('keep 2');
    expect(out).not.toContain('drop');
  });
});

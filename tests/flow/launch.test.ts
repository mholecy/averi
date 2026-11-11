import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import { EngineSession, launchApp, launchConsultsConfigActivity, launchedLine, resolveLaunchActivity } from '../../src/flow/launch.js';
import { el, FakeAdapter, screen } from '../helpers/fake.js';

/**
 * The one launch (flow/launch.ts), through its interface: what it hands the
 * adapter, how it words what it did, and when it counts a wipe. Its two
 * callers are pinned at theirs — the flow's trace lines in
 * tests/flow/engine.test.ts "launch step", launch_app's reply and the shared
 * session count in tests/mcp/tools.test.ts.
 */

const CFG = parseConfig('app:\n  android: { package: md.bank.app, activity: .MainActivity }\n');
const device = (platform: 'android' | 'ios' = 'android') => {
  const fake = new FakeAdapter({ home: screen(el({ role: 'container', identifier: 'home_root' })) }, 'home');
  fake.platform = platform;
  return fake;
};

describe('launchApp', () => {
  it('without a wipe its line is the app alone, with or without the platform', async () => {
    const launched = await launchApp(device(), CFG, new EngineSession(), { appId: 'md.bank.app', clearState: false });
    expect(launchedLine(launched)).toBe('md.bank.app/.MainActivity');
    expect(launchedLine(launched, 'android')).toBe('md.bank.app/.MainActivity on android');
  });

  it("resolves the activity against averi.yaml and names it by its last path segment", async () => {
    const fake = device();
    const plain = await launchApp(fake, CFG, new EngineSession(), { appId: 'md.bank.app' });
    expect(fake.launches).toEqual([{ appId: 'md.bank.app', clearState: undefined, activity: '.MainActivity', intent: undefined }]);
    expect(plain).toEqual({ app: 'md.bank.app/.MainActivity', note: undefined, wiped: undefined });
    const qualified = await launchApp(fake, CFG, new EngineSession(), { appId: 'md.bank.app', activity: 'md.bank.app/md.bank.ui.MainActivity' });
    expect(qualified.app).toBe('md.bank.app/md.bank.ui.MainActivity');
  });

  it('no config, or another platform: no activity, the bare app id', async () => {
    expect((await launchApp(device(), undefined, new EngineSession(), { appId: 'md.bank.app' })).app).toBe('md.bank.app');
    expect((await launchApp(device('ios'), CFG, new EngineSession(), { appId: 'md.bank.app' })).app).toBe('md.bank.app');
  });

  it("carries the adapter's note", async () => {
    const fake = device('ios');
    fake.launchDetail = 'the UI tree was still the app labelled "Contacts"';
    expect((await launchApp(fake, CFG, new EngineSession(), { appId: 'md.bank.app' })).note).toBe(fake.launchDetail);
  });

  it("a wipe says so in its line, counts against the session, and words the sentence with the session's count", async () => {
    const session = new EngineSession();
    const fake = device();
    const first = await launchApp(fake, CFG, session, { appId: 'md.bank.app', clearState: true });
    expect(launchedLine(first)).toBe('md.bank.app/.MainActivity (state cleared)');
    expect(launchedLine(first, 'android')).toBe('md.bank.app/.MainActivity on android (state cleared)');
    expect(first.wiped).toBe(
      'app state wiped (data container deleted) — anything the app persisted, a device registration included, is gone (1 this session)',
    );
    expect(fake.launches[0].clearState).toBe(true);
    expect((await launchApp(fake, CFG, session, { appId: 'md.bank.app', clearState: false })).wiped).toBeUndefined();
    expect((await launchApp(fake, CFG, session, { appId: 'md.bank.app', clearState: true })).wiped).toMatch(/\(2 this session\)$/);
    expect(session.clearStateCount).toBe(2);
  });

  it('a launch that throws counts nothing — the wipe is counted once the adapter returned', async () => {
    const session = new EngineSession();
    const fake = device();
    fake.launch = async () => {
      throw new Error('adb: device offline');
    };
    await expect(launchApp(fake, CFG, session, { appId: 'md.bank.app', clearState: true })).rejects.toThrow('device offline');
    expect(session.clearStateCount).toBe(0);
  });
});

describe('resolveLaunchActivity — the one launch-activity fallback (flow launch step and launch_app)', () => {
  const cfg = parseConfig(`
app:
  android: { package: md.bank.app, activity: .MainActivity }
  ios:     { bundleId: md.bank.app }
`);

  it("android, the config's own package → its activity", () => {
    expect(resolveLaunchActivity(cfg, { platform: 'android', appId: 'md.bank.app' })).toBe('.MainActivity');
  });

  it('another package → none: the config describes a different app', () => {
    expect(resolveLaunchActivity(cfg, { platform: 'android', appId: 'com.other.app' })).toBeUndefined();
  });

  it('ios → none, even when the bundle id equals the android package', () => {
    expect(resolveLaunchActivity(cfg, { platform: 'ios', appId: 'md.bank.app' })).toBeUndefined();
  });

  it('no config, no android section, or no activity configured → none', () => {
    expect(resolveLaunchActivity(undefined, { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
    expect(resolveLaunchActivity(parseConfig('app:\n  ios: { bundleId: md.bank.app }\n'), { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
    expect(resolveLaunchActivity(parseConfig('app:\n  android: { package: md.bank.app }\n'), { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
  });

  // 2026-10-03: WHEN the fallback applies is this rule's too, for both callers.
  const SEND = { action: 'android.intent.action.SEND' };
  const entry = { platform: 'android' as const, appId: 'md.bank.app' };

  it('a named activity is returned as given, with or without an intent, on either platform', () => {
    expect(resolveLaunchActivity(cfg, { ...entry, activity: '.ShareActivity' })).toBe('.ShareActivity');
    expect(resolveLaunchActivity(cfg, { ...entry, activity: '.ShareActivity', intent: SEND })).toBe('.ShareActivity');
    expect(resolveLaunchActivity(cfg, { ...entry, platform: 'ios', activity: '.X' })).toBe('.X');
  });

  it('an intent and no activity → none: the config activity is not forced onto the intent', () => {
    expect(resolveLaunchActivity(cfg, { ...entry, intent: SEND })).toBeUndefined();
  });

  it('launchConsultsConfigActivity: android with neither an activity nor an intent, and nothing else', () => {
    expect(launchConsultsConfigActivity({ platform: 'android' })).toBe(true);
    expect(launchConsultsConfigActivity({ platform: 'android', intent: SEND })).toBe(false);
    expect(launchConsultsConfigActivity({ platform: 'android', activity: '.X' })).toBe(false);
    expect(launchConsultsConfigActivity({ platform: 'ios' })).toBe(false);
  });
});

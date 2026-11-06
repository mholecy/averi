import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepLinkText, launchText } from '../../src/mcp/tool-text.js';
import { EngineSession, launchApp } from '../../src/flow/launch.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { IDB_ALERT, idbLab, lab, LAB, LAUNCH_ALERT_NOTE as ALERT_NOTE, SPRINGBOARD, WDA_ALERT } from '../helpers/ios-lab.js';

// The one sleep owner, recorded and not waited on; under a Date-only fake clock each recorded sleep moves the clock
// by its length, so the foreground wait's deadline plays out in virtual time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The replies with iOS's system alert up, end to end — a real IosAdapter (tests/helpers/ios-lab.ts) through the
// reply text (tool-text.ts): launch_app's ⚠ line names the alert (D56; ADR 0032's D56 amendment), and open_deep_link's
// reply is D54's headline and buttons with D57's advice (the shared wording, interact/app-holder-text.ts).
describe("launch_app's and open_deep_link's replies over iOS's system alert (D56)", () => {
  it("launch_app's reply: the Launched headline, then the alert note as its one ⚠ line", async () => {
    const launched = await launchApp(idbLab([IDB_ALERT]).adapter, undefined, new EngineSession(), { appId: LAB });
    expect(launchText('ios', launched)).toBe(`Launched dev.averi.lab on ios\n⚠ ${ALERT_NOTE}`);
  });

  // open_deep_link's replies with the alert up, end to end: D54's headline and buttons, then D57's advice — a tap by
  // the button's label, or at its x and y — the same on idb and WDA.
  it("open_deep_link's reply over the same alert: D54's headline and buttons, D57's advice — idb and WDA", async () => {
    const alertReply =
      'iOS has not opened averilab://d54 yet: it asks "Open in “AveriLab”?" — buttons "Cancel" at (127, 474), "Open" at ' +
      '(275, 474). Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y (averi taps ' +
      'nothing itself); every launch stays behind the alert until it is answered';
    expect(deepLinkText('ios', 'averilab://d54', await idbLab([IDB_ALERT]).adapter.openDeepLink('averilab://d54', { appId: LAB }))).toBe(alertReply);
    expect(deepLinkText('ios', 'averilab://d54', await lab([SPRINGBOARD], { tree: WDA_ALERT }).adapter.openDeepLink('averilab://d54', { appId: LAB }))).toBe(alertReply);
  });
});

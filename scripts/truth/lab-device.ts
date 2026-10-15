import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LabState } from './schema.js';

/**
 * The lab app on one simulator, driven with the raw tools only (simctl, idb) — what the truth capture (capture.ts) and
 * the live golden (live.ts) share: launching a cell in a fresh process, reading the app's state file, a raw tap. averi
 * is not used here, so the oracle does not depend on the code it judges.
 */

const run = promisify(execFile);
export const BUNDLE = 'dev.averi.lab';
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LabDevice {
  private stateFile: string | undefined;

  constructor(readonly udid: string) {}

  simctl(...args: string[]) {
    return run('xcrun', ['simctl', ...args], { maxBuffer: 64 << 20 });
  }

  idb(...args: string[]) {
    return run('idb', [...args, '--udid', this.udid], { maxBuffer: 64 << 20 });
  }

  /** What the app last wrote; undefined while there is no (readable) file. */
  async state(): Promise<LabState | undefined> {
    this.stateFile ??= join((await this.simctl('get_app_container', this.udid, BUNDLE, 'data')).stdout.trim(), 'Documents', 'lab-state.json');
    try {
      return JSON.parse(await readFile(this.stateFile, 'utf8')) as LabState;
    } catch {
      return undefined;
    }
  }

  /**
   * Launch the cell in a fresh process and wait until the app says it has settled (10 s at most). The last process's
   * state file is removed first: it names the same cell, ready, and would be read as this one's before the new process
   * has drawn anything.
   */
  async launch(cell: string): Promise<LabState> {
    await this.simctl('terminate', this.udid, BUNDLE).catch(() => undefined);
    // As averi's own launch does (src/adapters/ios.ts#enableAccessibilityAutomation): after a WebDriverAgent session
    // on the simulator, an app launched without these reads as an empty idb tree (docs/bugs/2026-10-07-one-wda-session-
    // makes-idb-stick-until-reboot.md) — the capture's WDA would leave every later launch stuck for idb.
    for (const key of ['AutomationEnabled', 'ApplicationAccessibilityEnabled']) {
      await this.simctl('spawn', this.udid, 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true');
    }
    // The soft keyboard back: once the simulator has seen HID typing (idb ui text) it sets these two (THIS simulator's
    // own com.apple.keyboard.preferences — no host or Simulator.app setting) and shows no soft keyboard for a focused
    // field, reboot or not; written back off, the next launch shows it again (measured 2026-10-15, iOS 27.0).
    for (const key of ['AutomaticMinimizationEnabled', 'HardwareKeyboardLastSeen']) {
      await this.simctl('spawn', this.udid, 'defaults', 'write', 'com.apple.keyboard.preferences', key, '-bool', 'false');
    }
    await this.state();
    await rm(this.stateFile!, { force: true });
    await this.simctl('launch', this.udid, BUNDLE, '-cell', cell);
    for (let waited = 0; waited < 10_000; waited += 200) {
      await pause(200);
      const s = await this.state();
      if (s?.cell === cell && s.ready) {
        await pause(300);
        return (await this.state())!;
      }
    }
    throw new Error(`cell ${cell}: the app did not report ready within 10 s`);
  }

  /** A raw tap at a point, in points — the probe. */
  async tap(x: number, y: number): Promise<void> {
    await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y)));
  }
}

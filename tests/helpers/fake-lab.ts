import type { Point } from '../../src/adapters/types.js';
import type { LabDevice, RawTree } from '../../scripts/truth/lab-device.js';
import type { LabApp, LabState } from '../../scripts/truth/schema.js';

/**
 * A lab device with no device (scripts/truth/lab-device.ts#LabDevice), for the live golden's cycle
 * (scripts/truth/run-case.ts): what it answers is scripted, and everything asked of it lands in `log`, a list a test's
 * other fakes can share, so one list holds the order of a whole case. `FakeLab` is the iOS shape; `FakeAndroidLab` adds
 * what run-case.ts asks only of the Android lab (the raw swipe, the guard before a panel read, the IME's touchable region). Capture's own fakes
 * (tests/truth/truth.test.ts, geometry.test.ts) script a screen and a tap's outcome; this one scripts a case's reads.
 */

export interface FakeLabScript {
  /** What `launch` answers. */
  launched: LabState;
  /** What each `state()` answers, in turn; past the end, the last one again (a case's reads run out, the app does not). */
  states?: readonly (LabState | undefined)[];
  /** The list everything lands in; the lab's own when unset. */
  log?: string[];
}

abstract class ScriptedLab implements LabDevice {
  abstract readonly platform: 'ios' | 'android';
  readonly app: LabApp = 'native';
  readonly log: string[];
  private readonly launched: LabState;
  private readonly states: readonly (LabState | undefined)[];
  private read = 0;

  constructor(script: FakeLabScript) {
    this.launched = script.launched;
    this.states = script.states ?? [];
    this.log = script.log ?? [];
  }

  async describe(): Promise<string> {
    return 'fake lab';
  }

  unsupported(): string | undefined {
    return undefined;
  }

  async launch(cell: string): Promise<LabState> {
    this.log.push(`launch ${cell}`);
    return this.launched;
  }

  async state(): Promise<LabState | undefined> {
    this.log.push('state');
    const answer = this.states[Math.min(this.read, this.states.length - 1)];
    this.read += 1;
    return answer;
  }

  async tap(x: number, y: number): Promise<void> {
    this.log.push(`tap ${x},${y}`);
  }

  async screenshot(): Promise<Buffer> {
    this.log.push('screenshot');
    return Buffer.from('fake png');
  }

  async trees(): Promise<RawTree[]> {
    return [];
  }

  async close(): Promise<void> {
    this.log.push('close');
  }
}

export class FakeLab extends ScriptedLab {
  readonly platform = 'ios' as const;
}

export interface FakeAndroidLabScript extends FakeLabScript {
  /** What each `imeTouchable()` answers, in turn (past the end, the last again); an Error is thrown. */
  touchable?: readonly (string | Error)[];
  /** Thrown by the raw swipe (a pre-drag that fails). */
  swipeFails?: Error;
  /** Thrown by the guard (a device the lab refuses). */
  guardFails?: Error;
}

export class FakeAndroidLab extends ScriptedLab {
  readonly platform = 'android' as const;
  private readonly touchable: readonly (string | Error)[];
  private readonly swipeFails: Error | undefined;
  private readonly guardFails: Error | undefined;
  private touchableRead = 0;

  constructor(script: FakeAndroidLabScript) {
    super(script);
    this.touchable = script.touchable ?? [''];
    this.swipeFails = script.swipeFails;
    this.guardFails = script.guardFails;
  }

  async guard(): Promise<void> {
    this.log.push('guard');
    if (this.guardFails !== undefined) throw this.guardFails;
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    this.log.push(`raw swipe ${from.x},${from.y} ${to.x},${to.y} ${durationMs}`);
    if (this.swipeFails !== undefined) throw this.swipeFails;
  }

  async imeTouchable(): Promise<string> {
    this.log.push('imeTouchable');
    const answer = this.touchable[Math.min(this.touchableRead, this.touchable.length - 1)];
    this.touchableRead += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

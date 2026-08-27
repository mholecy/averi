import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { DeviceAdapter, Platform, UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import {
  appHealth,
  assertSummary,
  formatLogExcerpt,
  runVerification,
} from '../../src/run/verify.js';
import type { LayoutContract } from '../../src/verify/layout-contract.js';
import type { OcrEngine } from '../../src/verify/ocr.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * These cover the `verify` orchestration, which until this refactor lived
 * inline in mcp/server.ts behind a module-scope stdio connect and so could not
 * be imported at all. The behaviours worth pinning are the CONTAINMENT ones: a
 * device run takes minutes, and no downstream failure may throw its traces,
 * assert results and screenshots away.
 */

const CFG = parseConfig(
  ['app:', '  android: { package: com.example.app }', '  ios: { bundleId: com.example.app }'].join('\n'),
);

const SCREEN: UiNode = node({
  role: 'container',
  rect: { x: 0, y: 0, width: 100, height: 200 },
  children: [node({ identifier: 'card', rect: { x: 10, y: 10, width: 40, height: 40 } })],
});

const whitePng = (): Buffer => {
  const image = new PNG({ width: 100, height: 200 });
  image.data.fill(255);
  return PNG.sync.write(image);
};

function fake(platform: Platform): FakeAdapter {
  const adapter = new FakeAdapter({ s: SCREEN }, 's');
  // `platform` is readonly for callers; the fake needs to stand in for both.
  (adapter as unknown as { platform: Platform }).platform = platform;
  adapter.nextScreenshot = whitePng();
  // viewport() is left to derive from SCREEN (100x200), which is also the png
  // size — i.e. scale 1. See the note on FakeAdapter.viewportSize.
  return adapter;
}

const request = (over: Partial<Parameters<typeof runVerification>[0]> = {}) => ({
  platforms: ['android', 'ios'] as Platform[],
  cfg: CFG,
  specs: [],
  baselineDir: '/tmp/averi-test-baselines',
  ...over,
});

const contract = (anchors: LayoutContract['anchors']): LayoutContract => ({ screen: 's', anchors });

describe('runVerification legs', () => {
  it('reports both platforms in canonical order with one screenshot each', async () => {
    const adapters = { android: fake('android'), ios: fake('ios') };
    const out = await runVerification(request(), async (p) => adapters[p]);

    expect(out.sections[0]).toContain('## android');
    expect(out.sections[1]).toContain('## ios');
    expect(out.screenshots).toHaveLength(2);
    expect(out.sections[0]).toContain('appAlive: true');
  });

  it('a leg that cannot start is reported as FAILED without sinking the other leg', async () => {
    const ios = fake('ios');
    const out = await runVerification(request(), async (p) => {
      if (p === 'android') throw new Error('No booted Android emulator/device found (adb devices)');
      return ios;
    });

    expect(out.sections[0]).toContain('## android');
    expect(out.sections[0]).toContain('FAILED: No booted Android emulator');
    expect(out.sections[1]).toContain('## ios');
    // Only the surviving leg contributes an image — the caller pairs images
    // with sections by order, so a placeholder would misalign them.
    expect(out.screenshots).toHaveLength(1);
  });

  it('surfaces a failing assert without throwing', async () => {
    const adapters = { android: fake('android'), ios: fake('ios') };
    const out = await runVerification(
      request({ platforms: ['android'], specs: [{ element: { id: 'nope' } }] }),
      async (p) => adapters[p],
    );

    expect(out.sections[0]).toContain('1/1 asserts FAILED');
    expect(out.sections[0]).toContain('FAIL  element id:"nope" exists');
  });
});

describe('parity containment', () => {
  it('CONTAINS a comparator error instead of discarding a minutes-long run', async () => {
    // A single-platform run whose contract can be normalized by nothing:
    // compareRectParity throws rather than return a vacuous "within tolerance".
    const out = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card' }]) }),
      async () => fake('android'),
    );

    const rect = out.sections.find((s) => s.startsWith('## rect parity'));
    expect(rect).toContain('FAILED:');
    expect(rect).toContain('figma_frame_width');
    // The whole point: the leg's own section and screenshot survived.
    expect(out.sections[0]).toContain('## android');
    expect(out.screenshots).toHaveLength(1);
  });

  it('SKIPS the table when no leg produced a UI tree, naming the reason per leg', async () => {
    const broken = fake('android');
    broken.uiTree = async () => {
      throw new Error('null root node');
    };
    const out = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async () => broken,
    );

    const rect = out.sections.find((s) => s.startsWith('## rect parity'));
    expect(rect).toContain('UI tree read failed');
    expect(rect).toContain('null root node');
    expect(rect).toContain('SKIPPED: no leg produced a UI tree.');
  });

  it('notes a leg that failed entirely and compares with the rest', async () => {
    const ios = fake('ios');
    const out = await runVerification(
      request({ contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async (p) => {
        if (p === 'android') throw new Error('adb gone');
        return ios;
      },
    );

    const rect = out.sections.find((s) => s.startsWith('## rect parity'));
    expect(rect).toContain('(android leg failed — compared without it)');
    expect(rect).not.toContain('SKIPPED');
  });
});

describe('color parity opt-in', () => {
  it('is appended only when an anchor declares a fill', async () => {
    const withBg = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }),
      async () => fake('android'),
    );
    expect(withBg.sections.some((s) => s.startsWith('## color parity'))).toBe(true);

    const withoutBg = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async () => fake('android'),
    );
    expect(withoutBg.sections.some((s) => s.startsWith('## color parity'))).toBe(false);
  });

  it('notes an undecodable screenshot rather than failing the run', async () => {
    const adapter = fake('android');
    adapter.nextScreenshot = Buffer.from('not a png');
    const out = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }),
      async () => adapter,
    );

    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).toContain('screenshot PNG decode failed');
    expect(color).toContain('SKIPPED: no leg produced both a UI tree and a decodable screenshot.');
  });
});

describe('the device screen behind the pixel tables', () => {
  /**
   * Both pixel dimensions scale by the device's own screen size now
   * (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md). A leg
   * that could not read one still produces its tables — from the tree, saying
   * so, because a table scaled off the tree is the reading both 2026-08-26
   * bugs were about and looks exactly like a good one.
   */
  const blindFake = (): FakeAdapter => {
    const adapter = fake('android');
    adapter.viewport = async () => {
      throw new Error('adb: device offline');
    };
    return adapter;
  };

  it('says so in the color table when the device screen could not be read', async () => {
    const out = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }),
      async () => blindFake(),
    );
    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).toContain('scaled from the UI tree — no usable device screen size');
  });

  it('says so in the text table too, and the run survives it', async () => {
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'CONTINUE' }]),
        ocrEngine: {
          recognize: async (_png, regions) =>
            regions.map((r) => ({ id: r.id, lines: [{ text: 'CONTINUE', confidence: 1, x: 0, y: 0, w: 10, h: 10 }] })),
        },
      }),
      async () => blindFake(),
    );
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toContain('scaled from the UI tree — no usable device screen size');
    expect(text).toContain('CONTINUE');
  });

  /**
   * Review 2026-08-27 caught the text table dropping this note while the color
   * table printed it — and a comment in text-parity.ts claiming the run layer
   * said it. A split-view leg scaled by the device while the tree read half
   * the width, and only one of two tables admitted it.
   */
  it('carries the device-vs-tree disagreement into the text table, not just the color one', async () => {
    const adapter = fake('android');
    adapter.viewportSize = { width: 200, height: 400 }; // twice the tree's 100x200, same aspect
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'CONTINUE' }]),
        ocrEngine: {
          recognize: async (_png, regions) =>
            regions.map((r) => ({ id: r.id, lines: [{ text: 'CONTINUE', confidence: 1, x: 0, y: 0, w: 10, h: 10 }] })),
        },
      }),
      async () => adapter,
    );
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toMatch(/android: scaled by the 200x400 DEVICE screen; the tree reads 100/);
  });

  it('a leg WITH a device screen says nothing — the note is for the degraded path only', async () => {
    const out = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }),
      async () => fake('android'),
    );
    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).not.toContain('unavailable');
    expect(color).toContain('scale 1.000');
  });
});

describe('text parity opt-in', () => {
  /** Stands in for the Swift recognizer; the real one needs a toolchain. */
  const engine = (byId: Record<string, string>, h = 10): OcrEngine => ({
    recognize: async (_png, regions) =>
      regions.map((r) => ({
        id: r.id,
        lines: byId[r.id] === undefined ? [] : [{ text: byId[r.id], confidence: 1, x: 0, y: 0, w: 10, h }],
      })),
  });

  it('is appended only when an anchor declares text or text_dynamic', async () => {
    const withText = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'Hello' }]),
        ocrEngine: engine({ card: 'Hello' }),
      }),
      async () => fake('android'),
    );
    expect(withText.sections.some((s) => s.startsWith('## text parity'))).toBe(true);

    const withoutText = await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async () => fake('android'),
    );
    expect(withoutText.sections.some((s) => s.startsWith('## text parity'))).toBe(false);
  });

  it('compares the RENDERED copy: OCR sees text the tree does not carry', async () => {
    // The measured iOS shape — a node with no label at all — still yields a
    // row, because the recognizer read the screen rather than the tree.
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'CONTINUE' }]),
        ocrEngine: engine({ card: 'PROCEED' }),
      }),
      async () => fake('android'),
    );
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toContain('PROCEED');
    expect(text).toContain('COPY DRIFT');
  });

  it('a recognizer failure degrades to tree evidence with a note, never sinking the run', async () => {
    const failing: OcrEngine = { recognize: async () => { throw new Error('swiftc not found'); } };
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'CONTINUE' }]),
        ocrEngine: failing,
      }),
      async () => fake('android'),
    );
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toContain('OCR failed — swiftc not found');
    // The table still stands, and the assert results survived.
    expect(text).toContain('text parity:');
    expect(out.screenshots).toHaveLength(1);
  });

  it('notes an undecodable screenshot instead of throwing out of the OCR pass', async () => {
    const adapter = fake('android');
    adapter.nextScreenshot = Buffer.from('not a png');
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', text: 'CONTINUE' }]),
        ocrEngine: engine({ card: 'CONTINUE' }),
      }),
      async () => adapter,
    );
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toContain('OCR failed');
    expect(text).toContain('text parity:');
  });
});

describe('appHealth', () => {
  it('reports a live app', async () => {
    expect(await appHealth(fake('android'), CFG)).toBe('\nappAlive: true');
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

/**
 * The mutation survivors from the step-6 review. Each of these killed no
 * mutant before it existed: the flow-engine half of the composition, the
 * default (no-specs) call, the platform-dependent crash scan, the tree-read
 * gating, and the baselineDir plumbing.
 */
describe('flow composition', () => {
  const FLOW_CFG = parseConfig(
    [
      'app:',
      '  android: { package: com.example.app }',
      'states:',
      '  ready:',
      '    detect: { element: { id: card } }',
      'flows:',
      '  open_card:',
      '    steps:',
      '      - tap: { id: card }',
    ].join('\n'),
  );

  it('ensures the state BEFORE running the flow, and traces both', async () => {
    const adapter = fake('android');
    const out = await runVerification(
      request({ platforms: ['android'], cfg: FLOW_CFG, state: 'ready', flow: 'open_card' }),
      async () => adapter,
    );

    const section = out.sections[0];
    expect(section).toContain('state ready: already active');
    expect(section).toContain('flow open_card: start');
    expect(section).toContain('flow open_card: done');
    // Order is the contract: a flow may depend on the state being reached.
    expect(section.indexOf('state ready')).toBeLessThan(section.indexOf('flow open_card'));
    expect(adapter.taps).toEqual(['card']);
  });

  it('reports a flow failure as a failed leg rather than throwing', async () => {
    const out = await runVerification(
      request({ platforms: ['android'], cfg: FLOW_CFG, flow: 'nonexistent' }),
      async () => fake('android'),
    );
    expect(out.sections[0]).toContain('FAILED: Unknown flow "nonexistent"');
  });
});

describe('assert verdict line', () => {
  it('is omitted entirely when no asserts were requested — the default verify call', async () => {
    const out = await runVerification(request({ platforms: ['android'], specs: [] }), async () =>
      fake('android'),
    );
    expect(out.sections[0]).not.toContain('asserts passed');
    expect(out.sections[0]).not.toContain('asserts FAILED');
  });

  it('states the total when every assert passed', async () => {
    const out = await runVerification(
      request({ platforms: ['android'], specs: [{ element: { id: 'card' } }] }),
      async () => fake('android'),
    );
    expect(out.sections[0]).toContain('All 1 asserts passed');
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

describe('tree read is gated and ordered', () => {
  function tracked(): { adapter: FakeAdapter; ops: string[] } {
    const adapter = fake('android');
    const ops: string[] = [];
    const tree = adapter.uiTree.bind(adapter);
    const shot = adapter.screenshot.bind(adapter);
    adapter.uiTree = async () => {
      ops.push('uiTree');
      return tree();
    };
    adapter.screenshot = async () => {
      ops.push('screenshot');
      return shot();
    };
    return { adapter, ops };
  }

  it('does not read the tree at all without a contract', async () => {
    const { adapter, ops } = tracked();
    await runVerification(request({ platforms: ['android'] }), async () => adapter);
    expect(ops).toEqual(['screenshot']);
  });

  it('reads the tree BEFORE the screenshot so both describe the screen the leg ended on', async () => {
    const { adapter, ops } = tracked();
    await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async () => adapter,
    );
    expect(ops.indexOf('uiTree')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('uiTree')).toBeLessThan(ops.indexOf('screenshot'));
  });
});

describe('baselineDir reaches the Verifier', () => {
  it('writes a first-run baseline under the requested directory', async () => {
    const { mkdtemp, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'averi-baseline-'));

    const out = await runVerification(
      request({
        platforms: ['android'],
        baselineDir: dir,
        specs: [{ screenshot: { baseline: 'dash' } }],
      }),
      async () => fake('android'),
    );

    expect(out.sections[0]).toContain('baseline created at');
    expect(await readdir(join(dir, 'android'))).toEqual(['dash.png']);
  });
});

describe('appHealth degrades rather than failing', () => {
  it('still reports the death when the log read itself throws', async () => {
    const dead = fake('android');
    dead.appRunning = false;
    dead.logs = async () => {
      throw new Error('adb: device offline');
    };
    // Losing the logs costs the crash excerpt, not the appAlive verdict.
    const health = await appHealth(dead, CFG);
    expect(health).toContain('appAlive: false');
    expect(health).toContain('(no crash signature in the last 60s of logs)');
  });
});

describe('color parity per-leg notes', () => {
  it('names the leg whose UI tree could not be read', async () => {
    const ok = fake('android');
    const broken = fake('ios');
    broken.uiTree = async () => {
      throw new Error('null root node');
    };
    const out = await runVerification(
      request({ contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }),
      async (p) => (p === 'android' ? ok : broken),
    );

    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).toContain('(ios: UI tree read failed');
    expect(color).toContain('null root node');
    // One leg still produced a capture, so the table is compared, not skipped.
    expect(color).not.toContain('SKIPPED');
  });
});

describe('assertSummary', () => {
  it('reads the same for the assert tool and a verify leg', () => {
    const pass = { description: 'a', pass: true };
    const fail = { description: 'b', pass: false };
    expect(assertSummary([pass, pass])).toBe('All 2 asserts passed');
    expect(assertSummary([pass, fail])).toBe('1/2 asserts FAILED');
    // Vacuously true, and the callers decide whether to print it at all.
    expect(assertSummary([])).toBe('All 0 asserts passed');
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

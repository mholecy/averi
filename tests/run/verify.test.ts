import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAdapter, Platform, UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import {
  appHealth,
  assertSummary,
  contractProblems,
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

// The one sleep owner (util/sleep.ts) is recorded, not waited on: a leg's
// settle wait and a failed tree read's retries are sequences of delays, and
// the sequence is what the production budget IS (review 2026-10-03, round
// 2). Yields a macrotask so deadline loops stay cooperative.
const { sleeps } = vi.hoisted(() => ({ sleeps: [] as number[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
    await new Promise((r) => setTimeout(r, 0));
  },
}));
beforeEach(() => {
  sleeps.length = 0;
});

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
  adapter.platform = platform;
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

  /**
   * Until 2026-10-02 the leg took a BARE screenshot after the asserts, so the
   * frame returned to the caller — and fed to the color and text tables — could
   * be a mid-animation one, the exact frame the color assert's own doc rules
   * out as a verdict. The leg now waits for the frame to settle the way the
   * `screenshot` tool does: two identical consecutive captures.
   */
  it('returns the SETTLED frame, not the first capture after the asserts', async () => {
    const adapter = fake('android');
    const settled = whitePng();
    const moving = [Buffer.from('frame mid-animation 1'), Buffer.from('frame mid-animation 2'), settled, settled];
    let i = 0;
    adapter.screenshot = async () => {
      const shot = moving[Math.min(i++, moving.length - 1)];
      adapter.screenshots.push(shot);
      return shot;
    };
    const out = await runVerification(request({ platforms: ['android'] }), async () => adapter);
    expect(out.screenshots[0].equals(settled)).toBe(true);
    // Two moving frames, then the settled one confirmed by a repeat — at the
    // production budget, 300 ms apart: the leg has no knob of its own.
    expect(adapter.screenshots).toHaveLength(4);
    expect(sleeps).toEqual([300, 300, 300]);
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

/**
 * 2026-10-03: the contract's field VALUES are checked before the legs. The
 * schema leaves them `unknown` so the comparators word the diagnosis; until
 * this, that diagnosis only surfaced as `FAILED:` in a table after both legs
 * had run. Pinned here: the refusal happens before ANY adapter is resolved or
 * touched, lists every problem by dimension, and asks only the dimensions
 * whose table the contract would produce.
 */
describe('the contract is validated before the legs', () => {
  /** An adapter seam that records being asked for anything at all. */
  const untouched = () => {
    const calls: string[] = [];
    const adapter = new Proxy(fake('android'), {
      get(target, prop, receiver) {
        calls.push(`adapter.${String(prop)}`);
        return Reflect.get(target, prop, receiver);
      },
    });
    const resolve = async (p: Platform) => {
      calls.push(`resolveAdapter(${p})`);
      return adapter;
    };
    return { calls, resolve };
  };

  it('a bad bg refuses before any adapter call, naming the problem, its dimension and the recovery', async () => {
    const { calls, resolve } = untouched();
    const bad = contract([{ id: 'card', x: 10, w: 40, bg: '#white' }]);
    await expect(runVerification(request({ contract: bad, state: 'home', flow: 'pay' }), resolve)).rejects.toThrow(
      'verify: the layout contract has 1 invalid field in the tables this run would produce — refused before the run:\n' +
        "- color parity: anchor card: 'bg' value '#white' is neither #RRGGBB(AA) nor a <hue>.<colorN> token name.\n" +
        'Fix the contract and re-run; nothing was run on a device.',
    );
    expect(calls).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('control for the above: the same contract with the bg fixed resolves both adapters and runs', async () => {
    const { calls, resolve } = untouched();
    const out = await runVerification(request({ contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF' }]) }), resolve);
    expect(calls).toContain('resolveAdapter(android)');
    expect(calls).toContain('resolveAdapter(ios)');
    expect(calls).toContain('adapter.screenshot');
    expect(out.sections.some((s) => s.startsWith('## color parity'))).toBe(true);
  });

  it('lists ALL problems across dimensions in one refusal — one edit, not one run per typo', async () => {
    const { calls, resolve } = untouched();
    const bad: LayoutContract = {
      screen: 's',
      tolerance_aspect_pct: '15',
      tolerance_size_pct: 0,
      anchors: [
        { id: 'card', bg: '#white', sample: 'fancy' },
        { id: 'title', text: 42 },
      ],
    };
    await expect(runVerification(request({ contract: bad }), resolve)).rejects.toThrow(
      'verify: the layout contract has 5 invalid fields in the tables this run would produce — refused before the run:\n' +
        '- rect parity: tolerance_aspect_pct must be a positive number, got "15"\n' +
        '- color parity: anchor card: unknown sample mode "fancy" — "dominant" or "patches".\n' +
        "- color parity: anchor card: 'bg' value '#white' is neither #RRGGBB(AA) nor a <hue>.<colorN> token name.\n" +
        '- text parity: tolerance_size_pct must be a positive number, got 0\n' +
        "- text parity: anchor title: 'text' is 42 — must be the exact rendered string.\n" +
        'Fix the contract and re-run; nothing was run on a device.',
    );
    expect(calls).toEqual([]);
  });

  it('names the contract file in the refusal when the caller said which one', async () => {
    const { calls, resolve } = untouched();
    const bad = contract([{ id: 'card', x: 10, w: 40, bg: '#white' }]);
    await expect(
      runVerification(request({ contract: bad, contractSource: 'contracts/home.layout.json' }), resolve),
    ).rejects.toThrow(
      'verify: the layout contract contracts/home.layout.json has 1 invalid field in the tables this run would produce — refused before the run:\n' +
        "- color parity: anchor card: 'bg' value '#white' is neither #RRGGBB(AA) nor a <hue>.<colorN> token name.\n" +
        'Fix the contract and re-run; nothing was run on a device.',
    );
    expect(calls).toEqual([]);
  });

  // The refusal prints the comparators' messages untouched, so "naming the
  // dimension per line" is an invariant of THEIR strings: every message a
  // validator can produce opens with its table's title. One bad value per
  // unknown-typed field, all three dimensions.
  it('every problem line opens with the title of the table it belongs to', () => {
    const everyField: LayoutContract = {
      screen: 's',
      tolerance_de: '6',
      tolerance_size_pct: '10',
      tolerance_aspect_pct: '15',
      anchors: [
        { id: 'a', bg: '#white', sample: 'fancy' },
        { id: 'b', bg: 7 },
        { id: 'c', text: 42, text_dynamic: 'yes' },
      ],
    };
    const problems = contractProblems(everyField);
    expect(problems.map((line) => line.split(': ')[0])).toEqual([
      'rect parity',
      'color parity',
      'color parity',
      'color parity',
      'color parity',
      'text parity',
      'text parity',
      'text parity',
    ]);
  });

  // The schema header's decision, honoured: a field is only a reason to refuse
  // if a table this contract PRODUCES would read it. No anchor opts into
  // colour or text here, so neither tolerance is ever parsed — by the run or
  // by the validation — and the run goes ahead exactly as it did before.
  it('a geometry-only contract is never refused for a colour or text field', async () => {
    const geometryOnly: LayoutContract = {
      screen: 's',
      tolerance_de: '6',
      tolerance_size_pct: '10',
      anchors: [{ id: 'card', x: 10, w: 40 }],
    };
    expect(contractProblems(geometryOnly)).toEqual([]);
    const adapters = { android: fake('android'), ios: fake('ios') };
    const out = await runVerification(request({ contract: geometryOnly }), async (p) => adapters[p]);
    expect(out.sections.map((s) => s.split('\n')[0])).toEqual(['## android', '## ios', '## rect parity']);
    expect(out.sections[2]).not.toContain('FAILED');
    expect(out.screenshots).toHaveLength(2);
  });

  it('…and a text-only opt-in is not refused for a colour field, nor a colour-only one for a text field', () => {
    const textOnly: LayoutContract = { screen: 's', tolerance_de: '6', anchors: [{ id: 'card', text: 'Hello' }] };
    expect(contractProblems(textOnly)).toEqual([]);
    const colorOnly: LayoutContract = { screen: 's', tolerance_size_pct: '10', anchors: [{ id: 'card', bg: '#FFFFFF' }] };
    expect(contractProblems(colorOnly)).toEqual([]);
    // Each IS refused for its own dimension's tolerance.
    expect(contractProblems({ ...textOnly, tolerance_size_pct: '10' })).toEqual([
      'text parity: tolerance_size_pct must be a positive number, got "10"',
    ]);
    expect(contractProblems({ ...colorOnly, tolerance_de: '6' })).toEqual([
      'color parity: tolerance_de must be a positive number, got "6"',
    ]);
  });

  // `verify` runs the light axis only; the comparator never parses bg_dark
  // there, so a malformed one must not refuse a run whose table is fine.
  it('a bad bg_dark does not refuse the run: the light axis never reads it', async () => {
    const c = contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF', bg_dark: '#white' }]);
    const out = await runVerification(request({ platforms: ['android'], contract: c }), async () => fake('android'));
    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).toBeDefined();
    expect(color).not.toContain('FAILED');
  });

  it('a valid full contract (geometry, fill, copy, all three tolerances) has no problems and gets all three tables', async () => {
    const full: LayoutContract = {
      screen: 's',
      figma_frame_width: 100,
      tolerance_de: 6,
      tolerance_size_pct: 12,
      tolerance_aspect_pct: 15,
      anchors: [{ id: 'card', x: 10, w: 40, bg: '#FFFFFF', sample: 'patches', text: 'Hello', text_dynamic: false }],
    };
    expect(contractProblems(full)).toEqual([]);
    const adapters = { android: fake('android'), ios: fake('ios') };
    const out = await runVerification(
      request({
        contract: full,
        ocrEngine: { recognize: async (_png, regions) => regions.map((r) => ({ id: r.id, lines: [] })) },
      }),
      async (p) => adapters[p],
    );
    expect(out.sections.map((s) => s.split('\n')[0])).toEqual([
      '## android',
      '## ios',
      '## rect parity',
      '## color parity',
      '## text parity',
    ]);
    for (const section of out.sections) expect(section).not.toContain('FAILED:');
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
    // The frame's own reason, in the OCR note's words; the table still stands.
    expect(text).toContain('(android: OCR failed — screenshot PNG decode failed: ');
    expect(text).toContain('that platform compared from the tree.)');
    expect(text).toContain('text parity:');
  });

  /**
   * The png scale is now derived inside the leg (verify/capture.ts) rather
   * than inside the parity tables' containment. A tree the geometry walk
   * cannot traverse used to be caught by paritySection; it must still cost
   * only the tables, never the leg's trace, asserts and screenshot.
   */
  it('a tree the scale walk cannot traverse fails the tables, not the leg', async () => {
    const adapter = fake('android');
    // A rect-less root — not itself the window, so windowRect scans its
    // children for one — with no `children` array to scan.
    adapter.uiTree = async () => ({ ...node({ rect: { x: 0, y: 0, width: 0, height: 0 } }), children: undefined as unknown as UiNode[] });
    const out = await runVerification(
      request({
        platforms: ['android'],
        contract: contract([{ id: 'card', x: 10, w: 40, bg: '#FFFFFF', text: 'CONTINUE' }]),
        ocrEngine: engine({ card: 'CONTINUE' }),
      }),
      async () => adapter,
    );
    // The leg survived with its screenshot.
    expect(out.sections[0]).toContain('## android');
    expect(out.sections[0]).toContain('appAlive: true');
    expect(out.screenshots).toHaveLength(1);
    // The color table fails closed on the frame's one reason; the text table
    // carries it as a note and stands on what is left.
    const color = out.sections.find((s) => s.startsWith('## color parity'));
    expect(color).toMatch(/FAILED: color parity: android: the png scale could not be derived from this tree/);
    const text = out.sections.find((s) => s.startsWith('## text parity'));
    expect(text).toContain('OCR failed — text parity: the png scale could not be derived from this tree');
  });
});

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
    // Two captures — the settled frame is the one a repeat confirmed — and no tree.
    expect(ops).toEqual(['screenshot', 'screenshot']);
  });

  /**
   * Until 2026-10-02 the leg read the tree and THEN took its screenshot. The
   * captured frame inverts that: the png first, until it settles, then the
   * tree. The settled png is the evidence the screen stopped moving, and
   * uiautomator reports LIVE bounds during an animation — a tree read before
   * the wait could carry mid-animation rects against a settled png, and every
   * crop in the pixel tables would be off by the animation's remaining travel.
   */
  it('reads the tree AFTER the png has settled, so the tree describes the frame the wait found still', async () => {
    const { adapter, ops } = tracked();
    await runVerification(
      request({ platforms: ['android'], contract: contract([{ id: 'card', x: 10, w: 40 }]) }),
      async () => adapter,
    );
    expect(ops.indexOf('uiTree')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('uiTree')).toBeGreaterThan(ops.lastIndexOf('screenshot'));
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

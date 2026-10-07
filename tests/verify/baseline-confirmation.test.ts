import { describe, expect, it, vi } from 'vitest';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { captureBaselineFrame, captureFrame } from '../../src/verify/capture.js';

/**
 * The criterion for `captureBaselineFrame`'s confirmation window
 * (2026-10-06, docs/bugs/2026-10-06-whole-screen-stability-aliases-a-
 * blinking-caret.md): a periodic blink must not be able to alias it, across
 * the periods, phases and device capture times a caret or a clock can
 * present. Measured on device that day: the old two-capture rule called a
 * caret screen settled on both the Android emulator (a capture ≈0.65 s, so
 * the pair ≈0.95 s apart) and the iOS simulator (≈0.8 s apart), and a
 * baseline was created from it.
 *
 * The REAL code runs against a fake device whose screenshot is one of two
 * frames, chosen by a square-wave blink evaluated at the moment the capture
 * starts, on a clock only this file advances: each sleep moves it by its
 * length and each capture by the capture time c. (Sampling at the end of a
 * capture instead shifts every sample by the same c — a phase shift, which
 * the phase sweep already covers.) capture.ts reads no wall clock on this
 * path — baseline creation has no deadline — so the clock is the test's own
 * number rather than a faked Date; fractional ms stay exact.
 *
 * The sleep mock here does NOT yield a macrotask, unlike
 * tests/helpers/sleep-recorder.ts: the grid is ~10 000 runs, and a
 * setTimeout(0) per sleep would cost the suite tens of seconds. Nothing on
 * this path reacts on a timer (fill.test.ts and the two keyboard-*.test.ts keep a
 * no-yield recorder for the same reason).
 */
/**
 * `jitter` scales every sleep and every capture by its own draw (1 = the
 * idealised model). The jittered sweep below sets it to a seeded generator,
 * so the run is still deterministic.
 */
const clock = vi.hoisted(() => ({ now: 0, jitter: (): number => 1 }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    clock.now += ms * clock.jitter();
  },
}));

/** Park–Miller minimal standard generator: a factor uniform in [1 − spread, 1 + spread), from a fixed seed. */
function seededJitter(spread: number, seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return 1 + spread * (2 * (state / 2147483647) - 1);
  };
}

const ON = Buffer.from('caret:on');
const OFF = Buffer.from('caret:off');

interface Blink {
  /** Period, ms. */
  periodMs: number;
  /** Share of the period the caret is drawn, 0–1. */
  duty: number;
  /** Where in its period the blink is when the capture starts, ms. */
  phaseMs: number;
  /** One screencap's wall time, ms. */
  captureMs: number;
}

/** A device showing a blinking caret on an otherwise still screen. */
function blinkingDevice(b: Blink): Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'> {
  clock.now = b.phaseMs;
  const on = (t: number): boolean => (((t % b.periodMs) + b.periodMs) % b.periodMs) / b.periodMs < b.duty;
  return {
    screenshot: async () => {
      const shot = on(clock.now) ? ON : OFF;
      clock.now += b.captureMs * clock.jitter();
      return shot;
    },
    uiTree: async () => {
      throw new Error('the png-only arm reads no tree');
    },
    viewport: async () => {
      throw new Error('the png-only arm reads no viewport');
    },
  };
}

// The grid the criterion is stated over.
const PERIODS_MS = Array.from({ length: 33 }, (_, i) => 400 + i * 50); // 0.4 s … 2.0 s in 0.05 s steps
const CAPTURE_MS = [150, 400, 650, 800];
const PHASES = 20;
/** The measured devices: c ≈ 0.65 s (Android emulator) and the fast end, at a caret's ≈1 s period. */
const isMeasuredBand = (periodMs: number, captureMs: number): boolean =>
  periodMs >= 900 && periodMs <= 1100 && (captureMs === 650 || captureMs === 150);

interface Rates {
  /** Share of the whole grid where creation was refused. */
  refused: number;
  /** Share of the measured band (period 0.9–1.1 s, c ∈ {0.65, 0.15}) where it was refused. */
  refusedInBand: number;
}

/** Sweeps the grid at one duty; `creates` is the rule under test (does it hand a baseline over?). */
async function sweep(duty: number, creates: (device: ReturnType<typeof blinkingDevice>) => Promise<boolean>): Promise<Rates> {
  let n = 0;
  let refused = 0;
  let inBand = 0;
  let refusedInBand = 0;
  for (const periodMs of PERIODS_MS) {
    for (const captureMs of CAPTURE_MS) {
      for (let k = 0; k < PHASES; k++) {
        const created = await creates(blinkingDevice({ periodMs, duty, phaseMs: (k / PHASES) * periodMs, captureMs }));
        n += 1;
        if (!created) refused += 1;
        if (isMeasuredBand(periodMs, captureMs)) {
          inBand += 1;
          if (!created) refusedInBand += 1;
        }
      }
    }
  }
  return { refused: refused / n, refusedInBand: refusedInBand / inBand };
}

/** What the screenshot assert creates from since 2026-10-06: a settled pair the window then confirmed. */
const confirmedRule = async (device: ReturnType<typeof blinkingDevice>): Promise<boolean> => {
  const frame = await captureBaselineFrame(device);
  return frame.stability === 'settled' && frame.confirmed === true;
};

/** What it created from until then: the settled pair alone. */
const pairRule = async (device: ReturnType<typeof blinkingDevice>): Promise<boolean> =>
  (await captureFrame(device)).stability === 'settled';

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

describe('captureBaselineFrame — a periodic blink cannot alias the confirmation window (2026-10-06)', () => {
  it('the old two-capture rule fails the criterion: it creates from most caret screens, the measured band included', async () => {
    const rates = await sweep(0.5, pairRule);
    // Measured 2026-10-06: 14.3% refused over the grid, 24.0% of the band.
    expect(pct(rates.refused)).toBe('14.3%');
    expect(pct(rates.refusedInBand)).toBe('24.0%');
    expect(rates.refused).toBeLessThan(0.99);
    expect(rates.refusedInBand).toBeLessThan(1);
  });

  it('the confirmation window refuses creation for ≥99% of the grid at 50% duty, and for every point of the measured band', async () => {
    const rates = await sweep(0.5, confirmedRule);
    expect(rates.refused).toBeGreaterThanOrEqual(0.99);
    expect(rates.refusedInBand).toBe(1);
    // Measured 2026-10-06 — pinned so a schedule change shows its effect here.
    expect(pct(rates.refused)).toBe('99.8%');
  });

  /**
   * Not the criterion — recorded. An asymmetric blink leaves one phase long
   * (1.4 s at a 2 s period and 70% duty) and one short (0.12 s at 0.4 s and
   * 30%); a window that catches those as well needs five or more captures
   * and still stops near 95% (the 2026-10-06 search), which is not cheap.
   * Pinned so a schedule change that worsens them is seen.
   */
  it('at 30% and 70% duty: refusal rates recorded, not the criterion', async () => {
    const thirty = await sweep(0.3, confirmedRule);
    const seventy = await sweep(0.7, confirmedRule);
    expect(pct(thirty.refused)).toBe('86.9%');
    expect(pct(seventy.refused)).toBe('86.9%');
  });

  /**
   * The idealised model above has a fixed capture time and exact sleeps; a
   * device has neither. With every sleep and every capture scaled by its own
   * draw in ±25% (seeded, so deterministic), the window still refuses ≥98%
   * of the grid and ≥98% of the band — under the 99% line the idealised grid
   * clears, which is why that line is a model's figure and the device check
   * (docs/plans/2026-10-05-device-verification-handoff.md §5) is the proof.
   * The bounds are what the model guarantees across seeds (16 seeds in the
   * 2026-10-06 review: 98.1–98.6% of the grid, 98.5–100% of the band); the
   * exact pin below is this seed's figure, the line a schedule change moves.
   * The review's own model (a different generator) measured 98.8% / 99.5%.
   */
  it('with ±25% jitter on every capture and every sleep: recorded, below the idealised figure', async () => {
    clock.jitter = seededJitter(0.25, 20261006);
    try {
      const rates = await sweep(0.5, confirmedRule);
      expect(rates.refused).toBeGreaterThanOrEqual(0.98);
      expect(rates.refusedInBand).toBeGreaterThanOrEqual(0.98);
      expect([pct(rates.refused), pct(rates.refusedInBand)]).toEqual(['98.1%', '99.5%']);
    } finally {
      clock.jitter = () => 1;
    }
  });

  it('a still screen is created, whatever the capture time — the window refuses change, not slowness', async () => {
    for (const captureMs of CAPTURE_MS) {
      // A "blink" that never leaves its on-phase within any run.
      const frame = await captureBaselineFrame(blinkingDevice({ periodMs: 1e9, duty: 1, phaseMs: 0, captureMs }));
      expect(frame).toMatchObject({ stability: 'settled', confirmed: true, captures: 6 });
    }
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSpecSchema, scanForCrashes, Verifier } from '../../src/verify/assert.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';

const FAST = { pollMs: 5, timeoutMs: 100 };

function dashboardFake() {
  resetLayout();
  return new FakeAdapter(
    {
      dashboard: screen(
        el({ identifier: 'dashboard_root' }),
        el({ role: 'text', label: 'Accounts' }),
        el({ role: 'text', identifier: 'balance', value: '1,250.00' }),
      ),
    },
    'dashboard',
  );
}

function png(width: number, height: number, paint: (png: PNG) => void = () => {}): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  paint(image);
  return PNG.sync.write(image);
}

describe('element asserts', () => {
  it('exists passes and absent fails for a present element', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'dashboard_root' } })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'dashboard_root' }, absent: true })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('still present'),
    });
  });

  it('absent passes and exists fails (with timeout detail) for a missing element', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'error_banner' }, absent: true })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'error_banner' } })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('not found within'),
    });
  });

  it('text and match check label/value; mismatch reports what was actually there', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'balance' }, text: '1,250.00' })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'balance' }, match: '\\d+,\\d{3}' })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'balance' }, text: '9,999.99' })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('"1,250.00"'),
    });
  });
});

describe('screenshot baseline asserts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the baseline on first run, passes on identical rerun', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    const first = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(first).toMatchObject({ pass: true, detail: expect.stringContaining('baseline created') });
    expect(await readFile(join(dir, 'android', 'dash.png'))).toBeDefined();

    const second = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(second).toMatchObject({ pass: true, detail: '0.00% of pixels differ' });
  });

  it('fails when the diff exceeds the threshold and reports the ratio', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    await verifier.assert({ screenshot: { baseline: 'dash' } });

    // paint the bottom half black → 50% diff
    fake.nextScreenshot = png(50, 50, (p) => p.data.fill(0, p.data.length / 2));
    const result = await verifier.assert({ screenshot: { baseline: 'dash', threshold: 0.1 } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/^5\d\.\d+% of pixels differ|^50\.00%/);
  });

  it('fails on size mismatch with both sizes in the detail', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    await verifier.assert({ screenshot: { baseline: 'dash' } });

    fake.nextScreenshot = png(40, 50);
    const result = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(result).toMatchObject({ pass: false, detail: 'size mismatch: baseline 50x50, current 40x50' });
  });
});

describe('assertSpecSchema', () => {
  it('rejects absent combined with text', () => {
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, absent: true, text: 'y' })).toThrow();
  });

  it('accepts the documented shapes', () => {
    expect(assertSpecSchema.parse({ element: { id: 'x' } })).toBeDefined();
    expect(assertSpecSchema.parse({ screenshot: { baseline: 'home', threshold: 0.02 } })).toBeDefined();
  });
});

describe('scanForCrashes', () => {
  it('extracts Android fatal exceptions with trailing stack context', () => {
    const lines = [
      '07-08 11:00:00.000  1234  1234 I ActivityManager: ok line',
      '07-08 11:00:01.000  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main',
      '07-08 11:00:01.001  5678  5678 E AndroidRuntime: java.lang.NullPointerException',
      '07-08 11:00:01.002  5678  5678 E AndroidRuntime:   at md.bank.app.MainActivity.onCreate',
    ];
    const excerpt = scanForCrashes(lines, 'android');
    expect(excerpt[0]).toContain('FATAL EXCEPTION');
    expect(excerpt).toHaveLength(3);
  });

  it('detects iOS uncaught exceptions and returns nothing for clean logs', () => {
    expect(scanForCrashes(['Terminating app due to uncaught exception NSRangeException'], 'ios')).toHaveLength(1);
    expect(scanForCrashes(['all quiet', 'nothing to see'], 'ios')).toHaveLength(0);
  });
});

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Verifier } from '../../src/verify/assert.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

// THE OCR ASSERT ON A FIELD UNDER A TEXT IN ITS TOUCH MARGIN (ui-tree/cover.ts#marginText, ADR 0026): after `back` on
// the lab's form-keyboard, phone's dumped touch target reaches 6 px under the next field's title. The tree alone fails it
// closed; the eyes, asked on the frame the assert captures anyway, read the overlap — clear, the field is read.
// docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A white 1080x2220 png, `ink` painted dark (x0, y0, x1, y1). */
const pngWith = (ink?: readonly [number, number, number, number]): Buffer => {
  const png = new PNG({ width: 1080, height: 2220 });
  png.data.fill(255);
  if (ink !== undefined) for (let y = ink[1]; y < ink[3]; y++) for (let x = ink[0]; x < ink[2]; x++) png.data.set([30, 30, 30, 255], (y * 1080 + x) * 4);
  return PNG.sync.write(png);
};
const PHONE_TEXT = '+421 900 123 456';
const reading = (text: string) => ({ id: 'element', lines: [{ text, confidence: 1, x: 0, y: 0, w: 400, h: 50 }] });
/** The ocr assert on phone, the screenshots `pngs` in turn (the last one from then on), the recognizer reading `texts` in turn likewise. */
const ocrOnPhone = async (pngs: readonly Buffer[], texts: readonly string[] = [PHONE_TEXT]) => {
  const fake = new FakeAdapter({ s: parseDump(readFileSync(new URL('../fixtures/android-lab-form-keyboard-after-back.xml', import.meta.url), 'utf8')) }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  let shots = 0;
  fake.screenshot = async () => {
    const png = pngs[Math.min(shots++, pngs.length - 1)]!;
    fake.screenshots.push(png);
    return png;
  };
  let reads = 0;
  const engine = { recognize: async (_png: Buffer, regions: { id: string }[]) => regions.map((r) => ({ ...reading(texts[Math.min(reads++, texts.length - 1)]!), id: r.id })) };
  const r = await new Verifier(fake, { pollMs: 300, ocr: { engine } }).assert({ element: { id: 'lab.form-keyboard.phone' }, ocr: { text: PHONE_TEXT }, timeout: '1s' });
  return { r, screenshots: fake.screenshots.length };
};

describe('the ocr assert on phone after back', () => {
  it('the overlap white as phone\'s rows beside the title: the field is read — on the settled pair the assert captures anyway', async () => {
    const { r, screenshots } = await ocrOnPhone([pngWith()]);
    expect(r.detail).not.toContain('Variable symbol');
    expect(r.pass).toBe(true);
    expect(screenshots).toBe(2);
  });

  it('ink in the band: the title is drawn over it — failed closed, naming it, as before the eyes', async () => {
    const { r } = await ocrOnPhone([pngWith([60, 1406, 300, 1412])]);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('text "Variable symbol" (55,1406 258x56) is drawn over the element');
  });

  it('a clear answer unlocks only the round it was judged on: the next round of the same tree looks at its own frame', async () => {
    // Round 1's settled pair clear, its reading wrong; from round 2 on the band inked — and read right.
    const clear = pngWith();
    const { r } = await ocrOnPhone([clear, clear, pngWith([60, 1406, 300, 1412])], ['+421 900', PHONE_TEXT]);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('text "Variable symbol" (55,1406 258x56) is drawn over the element');
  });
});

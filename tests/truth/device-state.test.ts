import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type DeviceLabel, type DeviceRead, type DeviceRound, deviceLine, deviceLabelAtStart, parseGfxinfo, readDevice, readInto, stateOf } from '../../scripts/truth/device-state.js';
import { AndroidLab, type Exec } from '../../scripts/truth/lab-device.js';

// The carousel group's device read (scripts/truth/device-state.ts, T16): the T11/T19 rule read back off the committed
// raw-strokes reads and the labels label-group.mjs wrote from them, the gfxinfo the final A/B kept, and the read itself
// through AndroidLab over a fake exec (no device).

const RECORDS = new URL('../../docs/truth/live-records/', import.meta.url);
const roundsIn = (file: string): DeviceRound[] =>
  readFileSync(new URL(file, RECORDS), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as DeviceRound);
/** A round whose four strokes carried these px. */
const round = (...carries: number[]): DeviceRound => ({ pre: 438, preMs: 1_050, strokes: carries.map((carry) => ({ carry, ms: 350 })), load: '0.10 0.20 0.30 1/1700 1' });

describe('stateOf: the T11/T19 rule', () => {
  it('T11 raw-1 (18 of 24 at 94 px or less) reads short, raw-4 recovered (none) fast', () => {
    expect(stateOf(roundsIn('t11-carousel-visible/raw/raw-1.jsonl'))).toEqual({ state: 'short', short: 18, strokes: 24 });
    expect(stateOf(roundsIn('t11-carousel-visible/raw/raw-4-recovered.jsonl'))).toEqual({ state: 'fast', short: 0, strokes: 24 });
  });

  it('short from one stroke in four, pooled over the rounds (final-ab.sh: "6 or more of 24"); a carry of 94 is short, 95 not', () => {
    const fast = [round(95, 95, 95, 95), round(95, 95, 95, 95), round(95, 95, 95, 95), round(95, 95, 95, 95), round(95, 95, 95, 95), round(95, 95, 95, 95)];
    expect(stateOf(fast)).toEqual({ state: 'fast', short: 0, strokes: 24 });
    const five = [round(94, 94, 94, 94), round(94, 95, 95, 95), ...fast.slice(2)];
    expect(stateOf(five)).toEqual({ state: 'fast', short: 5, strokes: 24 });
    const six = [round(94, 94, 94, 94), round(94, 94, 95, 95), ...fast.slice(2)];
    expect(stateOf(six)).toEqual({ state: 'short', short: 6, strokes: 24 });
  });
});

/** The gfxinfo lines final-ab.sh's read_device kept (grep of `dumpsys gfxinfo <package>`), the block of `package`. */
const gfxinfoBlock = (file: string, pkg: string): string => {
  const lines = readFileSync(new URL(file, RECORDS), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${pkg} frames`));
  const end = lines.findIndex((l, i) => i > start && /RecentQueue|^[a-z]+(\.[a-z]+)+ frames /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
};

describe("parseGfxinfo: the lab app's frames", () => {
  it("reads the recovery's and the final A/B's fresh gfxinfo lines", () => {
    expect(parseGfxinfo(gfxinfoBlock('t11-carousel-visible/frames-recovery.txt', 'dev.averi.lab'))).toEqual({ total: 88, janky: 2, p50: 18, p90: 22 });
    expect(parseGfxinfo(gfxinfoBlock('t11-carousel-visible/final-ab/frames-fresh.txt', 'dev.averi.lab'))).toEqual({ total: 87, janky: 2, p50: 17, p90: 19 });
  });

  it('reads nothing from a block missing a line (the Settings block kept no total and no 90th)', () => {
    const settings = gfxinfoBlock('t11-carousel-visible/frames-recovery.txt', 'com.android.settings');
    expect(settings).toContain('50th percentile: 17ms');
    expect(parseGfxinfo(settings)).toBeUndefined();
    expect(parseGfxinfo('')).toBeUndefined();
  });

  it('reads nothing when any one of the four lines is missing', () => {
    const lines = ['Total frames rendered: 40', 'Janky frames: 3 (7.50%)', '50th percentile: 21ms', '90th percentile: 35ms'];
    for (const i of lines.keys()) expect(parseGfxinfo(lines.filter((_, j) => j !== i).join('\n'))).toBeUndefined();
  });

  it('reads the frames, not the legacy jank count or the GPU percentiles', () => {
    const text = ['Total frames rendered: 40', 'Janky frames (legacy): 9 (22.50%)', 'Janky frames: 3 (7.50%)', '50th gpu percentile: 2ms', '90th gpu percentile: 4ms', '50th percentile: 21ms', '90th percentile: 35ms'].join('\n');
    expect(parseGfxinfo(text)).toEqual({ total: 40, janky: 3, p50: 21, p90: 35 });
  });
});

/** A read of these rounds, with frames of this p50 (none: unread). */
const readOf = (rounds: DeviceRound[], p50?: number, startCount = '11'): DeviceRead => ({
  t: '2026-11-10T12:00:00.000Z',
  rounds,
  ...(p50 !== undefined && { frames: { total: 90, janky: 2, p50, p90: p50 + 4 } }),
  startCount,
  hostLoad: '2.10 2.00 1.90',
});
const SHORT = [round(79, 87, 49, 72), round(140, 141, 139, 138), round(56, 70, 140, 141), round(140, 140, 140, 140)];
const FAST = [round(140, 141, 139, 138), round(140, 141, 139, 138), round(140, 141, 139, 138), round(140, 141, 139, 96)];

describe('deviceLine: the summary\'s label', () => {
  it('both reads agreeing: each state, its short strokes of all, and the frames\' p50 before and after', () => {
    expect(deviceLine({ before: readOf(SHORT, 18), after: readOf(SHORT.slice(0, 2), 22) })).toBe('Device: before short 6/16, after short 4/8 (frames p50 18 ms → 22 ms)');
    expect(deviceLine({ before: readOf(FAST, 17), after: readOf(FAST) })).toBe('Device: before fast 0/16, after fast 0/16 (frames p50 17 ms → unread)');
  });

  it('the reads disagreeing: said first, loud', () => {
    expect(deviceLine({ before: readOf(FAST), after: readOf(SHORT, 30) })).toBe('Device: DISAGREE — before fast 0/16, after short 6/16 (frames p50 unread → 30 ms)');
  });

  it('a framework restart between the reads (the start count changed) is said at the end', () => {
    expect(deviceLine({ before: readOf(FAST, 17, '11'), after: readOf(FAST, 17, '12') })).toBe('Device: before fast 0/16, after fast 0/16 (frames p50 17 ms → 17 ms), framework restarted (start count 11 → 12)');
  });

  it('a failed read, or one missing: unlabelled, with why', () => {
    expect(deviceLine({ error: 'before: the lab app reported no carousel offset' })).toBe('Device: unlabelled — before: the lab app reported no carousel offset');
    expect(deviceLine({ before: readOf(FAST, 17), error: 'after: adb: device offline' })).toBe('Device: unlabelled — after: adb: device offline');
    expect(deviceLine({ before: readOf(FAST, 17) })).toBe('Device: unlabelled — no read after the cases');
    expect(deviceLine({ after: readOf(FAST, 17) })).toBe('Device: unlabelled — no read before the cases');
  });
});

/** What `dumpsys gfxinfo dev.averi.lab` prints, cut to the lines read (frames-recovery.txt's). */
const GFX = 'Total frames rendered: 88\nJanky frames: 2 (2.27%)\n50th percentile: 18ms\n90th percentile: 22ms\n';

/**
 * The lab AVD as adb answers it, its carousel a model: a force-stop puts the carousel at `start` (null: the launch's
 * state reports no offset), the 440-px pre-drag carries 438, the nth raw stroke of a round carries `carries[round][n]`;
 * the state file reports the offset (`offsets` absent once `noOffsetFrom` strokes were drawn in a round, the file
 * unreadable once `noStateFrom` were). Every command is logged.
 */
function fakeAvd(carries: number[][], { noOffsetFrom = Infinity, noStateFrom = Infinity, gfx = GFX, start = 0 as number | null } = {}) {
  const calls: string[] = [];
  let round = -1;
  let stroke = 0;
  let offset: number | undefined = start ?? undefined;
  const exec: Exec = async (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
    const said = (stdout: string) => ({ stdout });
    if (line === 'adb -s emulator-5554 emu avd name') return said('averi_lab\r\nOK');
    if (line === 'adb -s emulator-5554 shell am force-stop dev.averi.lab') return (round++, (stroke = 0), (offset = start ?? undefined), said(''));
    if (line === 'adb -s emulator-5554 exec-out run-as dev.averi.lab cat files/lab-state.json') {
      if (stroke >= noStateFrom) throw new Error('run-as: package not debuggable');
      return said(JSON.stringify({ cell: 'carousel-recycler-free', ready: true, ...(stroke < noOffsetFrom && offset !== undefined && { offsets: { carousel: offset } }) }));
    }
    const swipe = /^adb -s emulator-5554 shell input swipe (\d+) 497 (\d+) 497 (\d+)$/.exec(line);
    if (swipe !== null) {
      offset = (offset ?? 0) + (Number(swipe[1]) - Number(swipe[2]) === 440 ? 438 : carries[round][stroke++]);
      return said('');
    }
    if (line === 'adb -s emulator-5554 shell dumpsys gfxinfo dev.averi.lab') return said(gfx);
    if (line === 'adb -s emulator-5554 shell cat /proc/loadavg') return said(`0.5${round} 0.40 0.30 1/1700 23391\n`);
    if (line === 'adb -s emulator-5554 shell getprop sys.system_server.start_count') return said('11\r\n');
    if (/^adb -s emulator-5554 shell (run-as dev\.averi\.lab rm -f files\/lab-state\.json|am start -W .*|dumpsys gfxinfo dev\.averi\.lab reset)$/.test(line)) return said('');
    throw new Error(`refused in the test: ${line}`);
  };
  return { exec, calls };
}

/** A clock that moves `step` ms each time it is read. */
const clock = (step: number) => {
  let t = Date.parse('2026-11-10T12:00:00.000Z') - step;
  return () => (t += step);
};
const waits: number[] = [];
const wait = async (ms: number) => void waits.push(ms);

describe('readDevice: raw strokes and the frames, through AndroidLab', () => {
  it('per round: a fresh launch of carousel-recycler-free, the 440-px pre-drag, four 142-px 300-ms strokes, each carry read off the state file', { timeout: 10_000 }, async () => {
    const avd = fakeAvd([
      [79, 87, 49, 72],
      [140, 141, 139, 138],
    ]);
    waits.length = 0;
    const read = await readDevice(new AndroidLab('emulator-5554', { exec: avd.exec }), { rounds: 2, wait, now: clock(5), hostLoad: () => '2.10 2.00 1.90' });
    expect(read).toEqual({
      t: '2026-11-10T12:00:00.000Z',
      rounds: [
        { pre: 438, preMs: 5, strokes: [79, 87, 49, 72].map((carry) => ({ carry, ms: 5 })), load: '0.50 0.40 0.30 1/1700 23391' },
        { pre: 438, preMs: 5, strokes: [140, 141, 139, 138].map((carry) => ({ carry, ms: 5 })), load: '0.51 0.40 0.30 1/1700 23391' },
      ],
      frames: { total: 88, janky: 2, p50: 18, p90: 22 },
      startCount: '11',
      hostLoad: '2.10 2.00 1.90',
    });
    const round = [
      'adb -s emulator-5554 shell am force-stop dev.averi.lab',
      'adb -s emulator-5554 shell run-as dev.averi.lab rm -f files/lab-state.json',
      'adb -s emulator-5554 shell am start -W -n dev.averi.lab/.MainActivity --es cell carousel-recycler-free',
      'adb -s emulator-5554 shell dumpsys gfxinfo dev.averi.lab reset',
      'adb -s emulator-5554 shell input swipe 872 497 432 497 1000',
      ...Array(4).fill('adb -s emulator-5554 shell input swipe 824 497 682 497 300'),
      'adb -s emulator-5554 shell cat /proc/loadavg',
    ];
    expect(avd.calls.filter((c) => !/emu avd name|lab-state\.json$/.test(c) || /rm -f/.test(c))).toEqual([
      'adb -s emulator-5554 shell getprop sys.system_server.start_count',
      ...round,
      ...round,
      'adb -s emulator-5554 shell dumpsys gfxinfo dev.averi.lab',
    ]);
    // raw-strokes.mjs's waits, after the launch's own settle on ready: the launch 1.5 s, the pre-drag 1.2 s, each stroke 1.5 s.
    expect(waits).toEqual([...[1_500, 1_200, 1_500, 1_500, 1_500, 1_500], ...[1_500, 1_200, 1_500, 1_500, 1_500, 1_500]]);
  });

  it('a state file with no carousel offset fails the read, saying which round; gfxinfo with no frames reads none', { timeout: 10_000 }, async () => {
    const lab = () => new AndroidLab('emulator-5554', { exec: fakeAvd([[140, 140, 140, 140]], { noOffsetFrom: 2 }).exec });
    await expect(readDevice(lab(), { rounds: 1, wait, now: clock(5), hostLoad: () => '' })).rejects.toThrow('round 1: the lab app reported no carousel offset');
    const noFrames = await readDevice(new AndroidLab('emulator-5554', { exec: fakeAvd([[140, 140, 140, 140]], { gfx: 'No process found for: dev.averi.lab' }).exec }), { rounds: 1, wait, now: clock(5), hostLoad: () => '' });
    expect(noFrames).not.toHaveProperty('frames');
    expect(noFrames.rounds).toHaveLength(1);
  });

  it('an unreadable state file fails the read the same way', { timeout: 10_000 }, async () => {
    const lab = new AndroidLab('emulator-5554', { exec: fakeAvd([[140, 140, 140, 140]], { noStateFrom: 3 }).exec });
    await expect(readDevice(lab, { rounds: 1, wait, now: clock(5), hostLoad: () => '' })).rejects.toThrow('round 1: the lab app reported no carousel offset');
  });

  it('the pre-drag carries from the launch\'s offset, from 0 where the launch reported none (raw-strokes.mjs: `?? 0`)', { timeout: 10_000 }, async () => {
    const preOf = async (start: number | null) =>
      (await readDevice(new AndroidLab('emulator-5554', { exec: fakeAvd([[140, 140, 140, 140]], { start }).exec }), { rounds: 1, wait, now: clock(5), hostLoad: () => '' })).rounds[0];
    expect(await preOf(12)).toMatchObject({ pre: 438, strokes: Array(4).fill({ carry: 140, ms: 5 }) });
    expect(await preOf(null)).toMatchObject({ pre: 438, strokes: Array(4).fill({ carry: 140, ms: 5 }) });
  });

  it('four rounds by default, and the host\'s loadavg read off the host', { timeout: 10_000 }, async () => {
    const avd = fakeAvd(Array(4).fill([140, 140, 140, 140]));
    const read = await readDevice(new AndroidLab('emulator-5554', { exec: avd.exec }), { wait });
    expect(read.rounds).toHaveLength(4);
    expect(read.hostLoad).toMatch(/^\d+\.\d\d \d+\.\d\d \d+\.\d\d$/);
    expect(Date.parse(read.t)).toBeGreaterThan(Date.parse('2026-11-10T00:00:00Z'));
  });
});

describe('readDevice refuses fewer than one round', () => {
  it('before any adb call', async () => {
    for (const rounds of [0, -1]) {
      const avd = fakeAvd([]);
      await expect(readDevice(new AndroidLab('emulator-5554', { exec: avd.exec }), { rounds, wait })).rejects.toThrow(`a device read needs one round or more, not ${rounds}`);
      expect(avd.calls).toEqual([]);
    }
  });
});

describe('deviceLabelAtStart: which runs read the device, from the cases selected', () => {
  const cases = (...groups: string[]) => groups.map((group) => ({ group }));
  it('an Android run with a carousel case selected starts an empty label; --device-read none an unlabelled one', () => {
    expect(deviceLabelAtStart('android', cases('visibility', 'carousel'), undefined)).toEqual({});
    expect(deviceLabelAtStart('android', cases('carousel'), 'none')).toEqual({ error: 'not read (--device-read none)' });
  });
  it('no carousel case selected (other groups, or --cases that leave none), or iOS: no label at all', () => {
    expect(deviceLabelAtStart('android', cases('visibility', 'forms'), undefined)).toBeUndefined();
    expect(deviceLabelAtStart('android', [], undefined)).toBeUndefined();
    expect(deviceLabelAtStart('ios', cases('carousel'), undefined)).toBeUndefined();
    expect(deviceLabelAtStart('android', cases('forms'), 'none')).toBeUndefined();
  });
  it('any other --device-read value is refused', () => {
    expect(() => deviceLabelAtStart('android', cases('carousel'), 'off')).toThrow('--device-read: none, or leave it out (the carousel group reads the device), not "off"');
  });
});

describe('readInto: a failed read labels the run unlabelled, never throws', () => {
  it('keeps each read, the first failure with its side, and reads nothing after one', async () => {
    const read = readOf(FAST, 17);
    const label: DeviceLabel = {};
    await readInto(label, 'before', async () => read);
    expect(label).toEqual({ before: read });
    await readInto(label, 'after', async () => {
      throw new Error('adb: device offline');
    });
    expect(label).toEqual({ before: read, error: 'after: adb: device offline' });
    const failed: DeviceLabel = {};
    await readInto(failed, 'before', () => Promise.reject('no state'));
    let asked = false;
    await readInto(failed, 'after', async () => ((asked = true), read));
    expect(failed).toEqual({ error: 'before: no state' });
    expect(asked).toBe(false);
  });
});

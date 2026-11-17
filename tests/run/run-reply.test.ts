import { describe, expect, it } from 'vitest';
import { legText } from '../../src/run/run-reply.js';
import type { Frame } from '../../src/verify/capture.js';

const pass = { description: 'a', pass: true };
const fail = { description: 'b', pass: false, detail: 'not found' };
const HEALTH = '\nappAlive: true';

/** Only what the note reads off a frame: whether it held still, and over how many captures. */
const frameOf = (stability: Frame['stability']): Frame => ({ stability, captures: 6 }) as Frame;
const MOVING_NOTE =
  '⚠ frame: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run — the last capture is returned as the best available';

describe('legText', () => {
  it('the assert tool: the verdict, one line per assert, the health line', () => {
    expect(legText({ asserts: [pass, fail], health: HEALTH })).toBe(
      '1/2 asserts FAILED\nPASS  a\nFAIL  b — not found\nappAlive: true',
    );
    expect(legText({ asserts: [pass, pass], health: HEALTH })).toBe('All 2 asserts passed\nPASS  a\nPASS  a\nappAlive: true');
  });

  it('the assert tool with no averi.yaml: no health line, and nothing after the last assert', () => {
    expect(legText({ asserts: [fail], health: '' })).toBe('1/1 asserts FAILED\nFAIL  b — not found');
  });

  it('a verdict over no asserts is vacuously passed, and keeps the line its missing assert lines leave', () => {
    expect(legText({ asserts: [], health: HEALTH })).toBe('All 0 asserts passed\n\nappAlive: true');
    expect(legText({ asserts: [], health: '' })).toBe('All 0 asserts passed\n');
  });

  it('an empty part takes no line: a verify leg that ran nothing and asserted nothing is its head and health line', () => {
    expect(legText({ head: '## ios', trace: '', health: HEALTH })).toBe('## ios\nappAlive: true');
    expect(legText({ head: '## ios', trace: '', asserts: [pass], health: HEALTH })).toBe(
      '## ios\nAll 1 asserts passed\nPASS  a\nappAlive: true',
    );
  });

  it('a health line with a crash excerpt is carried whole, below the rest', () => {
    expect(legText({ trace: 't', health: '\nappAlive: false\n  E/AndroidRuntime: FATAL' })).toBe(
      't\nappAlive: false\n  E/AndroidRuntime: FATAL',
    );
  });

  it('run_flow: the trace, then the health line', () => {
    expect(legText({ trace: 'flow f: start\ntap: x', health: HEALTH })).toBe('flow f: start\ntap: x\nappAlive: true');
  });

  it('no health line adds nothing', () => {
    expect(legText({ trace: 't', health: '' })).toBe('t');
  });

  it('every part in its place: head, trace, verdict, asserts, the frame note, the health line last', () => {
    expect(
      legText({
        head: '## android',
        trace: 'state home: already active',
        asserts: [pass],
        frame: { frame: frameOf('moving') },
        health: HEALTH,
      }),
    ).toBe(`## android\nstate home: already active\nAll 1 asserts passed\nPASS  a\n${MOVING_NOTE}\nappAlive: true`);
  });

  it('the frame note: one ⚠ line for a capture that failed or a frame that moved, nothing for a settled one', () => {
    expect(legText({ trace: 't', frame: { failed: 'adb returned 0 bytes' }, health: HEALTH })).toBe(
      't\n⚠ screenshot: adb returned 0 bytes — no image is returned\nappAlive: true',
    );
    expect(legText({ trace: 't', frame: { frame: frameOf('moving') }, health: HEALTH })).toBe(`t\n${MOVING_NOTE}\nappAlive: true`);
    expect(legText({ trace: 't', frame: { frame: frameOf('settled') }, health: HEALTH })).toBe('t\nappAlive: true');
    expect(legText({ trace: 't', frame: { frame: frameOf('unjudged') }, health: HEALTH })).toBe('t\nappAlive: true');
  });
});

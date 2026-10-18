import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judgeNoteFill, judgePhoneScroll } from '../../scripts/truth/live-forms.js';
import type { LabState } from '../../scripts/truth/schema.js';

// Lab note F2A1's live form cases (scripts/truth/live-forms.ts), over the committed record of round 6's Android device
// check (docs/truth/live-records/android-vis.json, src e98b87e): k3, a fill into note once back hid the IME — refused
// by design (the owner's decision of 2026-10-18, ADR 0013) — and k7, scroll_until phone under the bar riding on the IME.

type Rec = { results: { id: string; source: string; replies: string[]; launched: LabState; state: LabState }[] };
const record = JSON.parse(readFileSync(new URL('../../docs/truth/live-records/android-vis.json', import.meta.url), 'utf8')) as Rec;
const k = (id: string) => record.results.find((r) => r.id === id)!;

describe('k3: a fill into note, a strip under the bar — refused by design', () => {
  const { replies, launched, state } = k('k3');

  it('the record: refused naming the remedy, note showing nothing past the bar, every field untouched, no submit — ok', () => {
    expect(judgeNoteFill(state, replies, 'uiautomator', launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/^refused by design \(F2A1: note shows 0 px past the bar, under the 65 a tap needs\)/) });
  });

  it('a field changed: not ok', () => {
    const typed = { ...state, fields: { ...state.fields!, street: { ...state.fields!.street, value: 'Thanks' } } };
    expect(judgeNoteFill(typed, replies, 'uiautomator', launched).outcome).not.toBe('ok');
  });

  it('a submit: not ok', () => {
    expect(judgeNoteFill({ ...state, submits: [{ at: 1 }] } as LabState, replies, 'uiautomator', launched).outcome).not.toBe('ok');
  });

  it('note clear of the bar (no strip): a refusal is no refusal by design — not ok', () => {
    const clear = { ...state, frames: { ...state.frames, note: { ...state.frames.note!, y: 1700 } } };
    expect(judgeNoteFill(clear, replies, 'uiautomator', launched)).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/no strip\)$/) });
  });

  it('no remedy named: not ok', () => {
    expect(judgeNoteFill(state, ['ERROR id:"lab.form-keyboard.note" was not tapped'], 'uiautomator', launched).outcome).not.toBe('ok');
  });
});

describe('k7: scroll_until phone — the stop ok, "fully" overstating by what the bar\'s padding covers', () => {
  const { replies, launched, state } = k('k7');
  it('the record: ok, the 18 px under the bar said', () => {
    expect(judgePhoneScroll(state, replies, 'uiautomator', launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/18 px of it under the bar.*— "fully" overstates by 18 px \(ADR 0013 residual\)$/) });
  });
  it('a submit: MISMATCH', () => {
    expect(judgePhoneScroll({ ...state, submits: [{ at: 1 }] } as LabState, replies, 'uiautomator', launched).outcome).toBe('MISMATCH');
  });
});

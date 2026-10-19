import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judgeMissUnderSheet, judgeNoteFill, judgePhoneScroll, judgeUnderSheet } from '../../scripts/truth/live-forms.js';
import { ACTIVE_WINDOW_HINT } from '../../src/ui-tree/miss.js';
import type { LabState } from '../../scripts/truth/schema.js';

// Lab note F2A1's live form cases (scripts/truth/live-forms.ts), over the committed record of round 6's Android device
// check (docs/truth/live-records/android-vis.json, src e98b87e): k3, a fill into note once back hid the IME — refused
// by design (the owner's decision of 2026-10-18, ADR 0013) — and k7, scroll_until phone under the bar riding on the IME
// (with round 7's A6 record of it, android-k7-eyes-1.json).

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

describe('k7: scroll_until phone — a stop with phone partly under the bar\'s padding must say so', () => {
  // Round 7's A6 (the eyes on a "fully" claim): averi names the band the bar's node-less padding draws over phone's
  // bottom (docs/truth/live-records/android-k7-eyes-1.json, its src's); before it, "fully visible" overstated by the
  // 18 px the app's frames put under the bar — an accepted residual (ADR 0013) until the eyes, a MISMATCH since.
  const eyes = (JSON.parse(readFileSync(new URL('../../docs/truth/live-records/android-k7-eyes-1.json', import.meta.url), 'utf8')) as Rec).results.find((r) => r.id === 'k7')!;
  const { replies, launched, state } = k('k7');
  it('the eyes\' record: the band named, phone\'s centre clear — ok', () => {
    expect(judgePhoneScroll(eyes.state, eyes.replies, 'uiautomator', eyes.launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/18 px of it under the bar.*: Element id:"lab\.form-keyboard\.phone" visible after 1 swipe — PARTLY UNDER a surface the tree does not list: /) });
    expect(judgePhoneScroll(eyes.state, eyes.replies, 'uiautomator', eyes.launched).why).toContain('; 1 stroke(s) the app logged at (540,1034): ');
  });
  // Round 6's record.
  it('the record before the eyes: "fully visible" with 18 px under the bar — MISMATCH, the band unsaid', () => {
    expect(judgePhoneScroll(state, replies, 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^averi says Element id:"lab\.form-keyboard\.phone" fully visible after 1 swipe — 18 px of phone under the bar, unsaid \(no PARTLY UNDER a surface\); /) });
  });
  it('a plain "visible" with phone under the bar is no answer either; clear of the bar no band is asked', () => {
    expect(judgePhoneScroll(eyes.state, ['Element id:"lab.form-keyboard.phone" visible after 1 swipe'], 'uiautomator', eyes.launched).outcome).toBe('MISMATCH');
    const clear = { ...eyes.state, frames: { ...eyes.state.frames, phone: { ...eyes.state.frames.phone!, y: 1100 } } };
    expect(judgePhoneScroll(clear, replies, 'uiautomator', eyes.launched).outcome).toBe('ok');
  });
  it('a submit: MISMATCH', () => {
    expect(judgePhoneScroll({ ...eyes.state, submits: [{ at: 1 }] } as LabState, eyes.replies, 'uiautomator', eyes.launched).outcome).toBe('MISMATCH');
  });
});

describe('c2–c4: a tap beneath form-picker\'s expanded sheet — nothing fires, the reply says to close the sheet once where the tree source marks it (idb: not in its tree)', () => {
  // The launch c1 recorded: form-picker, the sheet open and fully expanded.
  const { launched } = k('c1');
  const judge = judgeUnderSheet('name');
  const hinted = `ERROR Timed out after 5000ms waiting for element id:"lab.form-picker.name" to appear\n  (${ACTIVE_WINDOW_HINT})`;
  const at = 1;

  it('uiautomator\'s wait with the active-window hint, nothing logged: ok', () => {
    expect(judge(launched, [hinted], 'uiautomator', launched)).toMatchObject({ outcome: 'ok', kind: 'not found', why: expect.stringMatching(/^not tapped, nothing fired; the active-window hint, once: /) });
  });
  it('a presented refusal (a sheet the source marks): ok', () => {
    const reply = 'ERROR id:"lab.form-picker.name" is under button "Albania" … — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped';
    expect(judge(launched, [reply], 'wda', launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/the presented remedy, once/) });
  });
  it('idb\'s wait, nothing logged: ok — idb lists the sheet alone and marks nothing, so not in the tree is all it can say', () => {
    const plain = 'ERROR Timed out after 5000ms waiting for element id:"lab.form-picker.name" to appear';
    expect(judge(launched, [plain], 'idb', launched)).toMatchObject({ outcome: 'ok', kind: 'not found', why: expect.stringMatching(/^not tapped, nothing fired; not in idb's tree \(it lists the presented sheet alone\)/) });
    // the same wait under a source that can say more is not enough
    expect(judge(launched, [plain], 'uiautomator', launched).outcome).toBe('LOUD');
    expect(judge(launched, [plain], 'wda', launched).outcome).toBe('LOUD');
  });
  it('no "close it first" where the source can say it, or it said twice: LOUD', () => {
    expect(judge(launched, ['ERROR id:"lab.form-picker.name" is covered by button "Albania"; nothing was tapped'], 'idb', launched).outcome).toBe('LOUD');
    expect(judge(launched, [`${hinted.replace('\n', ' — a dialog is presented over it — close it first\n')}`], 'uiautomator', launched)).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/said 2 times/) });
  });
  it('a row selected, the sheet dismissed, a field focused, or a Tapped: MISMATCH', () => {
    const logged = (e: { kind: 'select' | 'dismissed'; tag: string }) => ({ ...launched, events: [...launched.events, { ...e, at }] }) as LabState;
    expect(judge(logged({ kind: 'select', tag: 'AL' }), [hinted], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^refused, but the app logged select AL/) });
    expect(judge(logged({ kind: 'dismissed', tag: 'sheet' }), [hinted], 'uiautomator', launched).outcome).toBe('MISMATCH');
    expect(judge({ ...launched, focus: 'name' }, [hinted], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/focus name/) });
    expect(judge(launched, ['Tapped id:"lab.form-picker.name"'], 'uiautomator', launched).outcome).toBe('MISMATCH');
  });
});

describe('c5–c7: an assert and a flow\'s wait: on name beneath form-picker\'s expanded sheet — the call fails, nothing fires, the not-found says to close the sheet exactly once', () => {
  // The launch c1 recorded: form-picker, the sheet open and fully expanded. The replies as averi words them (round 7's
  // A3 scratch driver, docs/truth/live-records/android-hint-everywhere-e726c77-asserts.json).
  const { launched } = k('c1');
  const judge = judgeMissUnderSheet('name');
  const asserted = `1/1 asserts FAILED\nFAIL  element id:"lab.form-picker.name" exists — not found within 3 s (${ACTIVE_WINDOW_HINT})\nappAlive: true`;
  const coloured = `1/1 asserts FAILED\nFAIL  element id:"lab.form-picker.name" fill within dE00 8 of #FFFFFF — not found within 5 s (${ACTIVE_WINDOW_HINT})\nappAlive: true`;
  const waited = `ERROR Timed out after 3000ms waiting for element id:"lab.form-picker.name"\n  (${ACTIVE_WINDOW_HINT})\n\nSteps that ran before the failure:\nflow wait_name: start\n✗ wait id:"lab.form-picker.name": failed — Timed out after 3000ms waiting for element id:"lab.form-picker.name"`;

  it('each failed call with the active-window hint once, nothing logged: ok', () => {
    for (const reply of [asserted, coloured, waited]) expect(judge(launched, [reply], 'uiautomator', launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/^failed, nothing fired; the active-window hint, once: /) });
  });
  it('the presented remedy once, where the source marks the sheet: ok', () => {
    const reply = '1/1 asserts FAILED\nFAIL  element id:"lab.form-picker.name" exists — not found within 3 s (a sheet or modal is presented over it, and the tree lists only that window — close it first)';
    expect(judge(launched, [reply], 'uiautomator', launched)).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/the presented remedy, once/) });
  });
  it('a pass, or a flow done: MISMATCH — name lies beneath the sheet', () => {
    expect(judge(launched, ['All 1 asserts passed\nPASS  element id:"lab.form-picker.name" exists'], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/lies beneath the picker sheet/) });
    expect(judge(launched, ['flow wait_name: start\nwait: element id:"lab.form-picker.name"\nflow wait_name: done'], 'uiautomator', launched).outcome).toBe('MISMATCH');
  });
  it('the not-found without the hint, or with "close it first" twice: LOUD', () => {
    expect(judge(launched, [asserted.replace(` (${ACTIVE_WINDOW_HINT})`, '')], 'uiautomator', launched)).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/no "close it first"/) });
    expect(judge(launched, [`${waited}\n  (${ACTIVE_WINDOW_HINT})`], 'uiautomator', launched)).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/said 2 times/) });
  });
  it('a failure, but the app logged a row selected, the sheet dismissed or a field focused: MISMATCH', () => {
    const logged = (e: { kind: 'select' | 'dismissed'; tag: string }) => ({ ...launched, events: [...launched.events, { ...e, at: 1 }] }) as LabState;
    expect(judge(logged({ kind: 'select', tag: 'AL' }), [asserted], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^failed, but the app logged select AL/) });
    expect(judge(logged({ kind: 'dismissed', tag: 'sheet' }), [waited], 'uiautomator', launched).outcome).toBe('MISMATCH');
    expect(judge({ ...launched, focus: 'name' }, [coloured], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/focus name/) });
  });
});

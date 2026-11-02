import { describe, expect, it } from 'vitest';
import { holds, holdsShown, judgeFloatingGap, judgeMissUnderSheet, judgeNoteFill, judgePhoneScroll, judgeUnderSheet, refusedKept } from '../../scripts/truth/live-forms.js';
import { ACTIVE_WINDOW_HINT } from '../../src/ui-tree/miss.js';
import { readLiveRecord, recordedCase, withFieldValue } from '../helpers/live-records.js';
import { selectCases } from '../../scripts/truth/live-cases.js';
import { LIVE_KNOWN } from '../../scripts/truth/live-known.js';
import type { LabState } from '../../scripts/truth/schema.js';

// Lab note F2A1's live form cases (scripts/truth/live-forms.ts), over the committed record of round 6's Android device
// check (docs/truth/live-records/android-vis.json, src e98b87e): k3, a fill into note once back hid the IME — refused
// by design (the owner's decision of 2026-10-18, ADR 0013) — and k7, scroll_until phone under the bar riding on the IME
// (with round 7's A6 record of it, android-k7-eyes-1.json).

const record = readLiveRecord('android-vis.json');
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
  const eyes = readLiveRecord('android-k7-eyes-1.json').results.find((r) => r.id === 'k7')!;
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
  it('an assert that found name beneath the sheet and failed it on its colour: MISMATCH — averi resolved an element beneath the sheet', () => {
    const found = '1/1 asserts FAILED\nFAIL  element id:"lab.form-picker.name" fill within dE00 8 of #FFFFFF — measured #F2F2F7 (dE00 4.1) over its region';
    expect(judge(launched, [found], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^averi found name beneath the picker sheet and failed it/) });
  });
  it('an ERROR that is no wait for the target (a flow the config lacks): MISMATCH named a harness fault, never LOUD', () => {
    expect(judge(launched, ['ERROR Unknown flow "wait_name" — averi.yaml defines none'], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^a harness fault, not a verdict on name: /) });
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

describe('kf1–kf2: the submit between a floating panel and its strip — the panel evidenced by the case\'s own first reply', () => {
  // docs/truth/live-records/android-forms-r1023b-fu1-cr-1.json: Gboard floated by hand; each case begins with a colour
  // assert on ks whose refusal quotes the panel over it.
  const fu1 = readLiveRecord('android-forms-r1023b-fu1-cr-1.json');
  const kf = (id: string) => fu1.results.find((r) => r.id === id)!;
  const noPanel = 'FAIL  element id:"lab.form-keyboard-floating.ks" fill within dE00 8 of #FFFFFF — measured #FFFFFF';

  it('the record: the panel quoted, the submit visible with no stroke, tapped once — ok', () => {
    for (const id of ['kf1', 'kf2'] as const) {
      const { replies, launched, state } = kf(id);
      expect(judgeFloatingGap(id)(state, replies, 'uiautomator', launched).outcome).toBe('ok');
    }
  });

  it('no panel quoted (an IME collapsed to its strip reads the same to the app): SKIP, never ok', () => {
    for (const id of ['kf1', 'kf2'] as const) {
      const { replies, launched, state } = kf(id);
      expect(judgeFloatingGap(id)(state, [noPanel, ...replies.slice(1)], 'uiautomator', launched)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/^no measured panel quoted over ks/) });
    }
  });

  it('a submit the case never asked for is a MISMATCH before any evidence: kf1 with one, kf2 with two, panel quoted or not', () => {
    for (const [id, n] of [['kf1', 1], ['kf2', 2]] as const) {
      const { replies, launched, state } = kf(id);
      const submitted = { ...state, submits: Array.from({ length: n }, (_, i) => ({ at: i })) } as LabState;
      for (const first of [replies[0], noPanel]) {
        expect(judgeFloatingGap(id)(submitted, [first, ...replies.slice(1)], 'uiautomator', launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^the form was SUBMITTED/) });
      }
    }
  });
});

/**
 * D31: a fill verdict carries the rule it fails by and the kind of reply it rests on (LiveVerdict.cls, .kind), as a
 * visibility verdict does — what live-known.ts pins for b1d, b7, p5 and rf4. Over the D40 device run's records
 * (docs/truth/live-records/ios-forms-d40-1.json, ios-rn-forms-d40-1.json, android-forms-d40-1.json).
 */
describe('holds and holdsShown: the class and the kind of a fill verdict', () => {
  const ios = readLiveRecord('ios-forms-d40-1.json');
  const rn = readLiveRecord('ios-rn-forms-d40-1.json');
  const android = readLiveRecord('android-forms-d40-1.json');
  const at = recordedCase;

  it.each([
    ['iOS idb b1d: idb ui text refuses the non-ASCII name, the field as the launch left it — loud-untouched on refused', ios, 'idb', 'b1d', 'name', 'Jan Šťastný', 'loud-untouched', 'refused'],
    ['iOS WDA b7: the same through idb ui text — loud-untouched on refused', ios, 'wda', 'b7', 'name', 'O’Brien “Jr.” – Co…', 'loud-untouched', 'refused'],
    ['iOS WDA p5: the secure field cleared when typing resumed, averi says so — loud-changed on refused', ios, 'wda', 'p5', 'pin', '25801', 'loud-changed', 'refused'],
    ['Android b1d: input text typed a prefix, then exit 255 — loud-changed on refused', android, 'uiautomator', 'b1d', 'name', 'Jan Šťastný', 'loud-changed', 'refused'],
    ['RN idb rf4: a blind type: dropped the tail, the flow done — loud-changed on other', rn, 'idb', 'rf4', 'G', 'SK31 1200 0000', 'loud-changed', 'other'],
  ] as const)('%s', (_says, rec, source, id, tag, want, cls, kind) => {
    const { replies, launched, state } = at(rec, source, id);
    expect(holds(tag, want)(state, replies, source, launched)).toMatchObject({ outcome: 'LOUD', cls, kind });
  });

  it('a fill that claims done while the app holds another value: MISMATCH fill-claim, on the claim\'s kind', () => {
    const { launched, state } = at(ios, 'wda', 'p5');
    expect(holds('pin', '25801')(state, ['Filled id:"lab.form-prefilled.pin" (1 character)'], 'wda', launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim', kind: 'other' });
  });

  it('the app holds the value but averi failed: MISMATCH failed-holds, on the refusal', () => {
    const { replies, launched, state } = withFieldValue(at(ios, 'wda', 'p5'), 'pin', '25801');
    expect(holds('pin', '25801')(state, replies, 'wda', launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused' });
  });

  it('ok: no class, the kind of the reply', () => {
    const { replies, launched, state } = at(ios, 'wda', 'b1');
    const v = holds('name', 'Jan Novak')(state, replies, 'wda', launched);
    expect(v).toMatchObject({ outcome: 'ok', kind: 'other' });
    expect(v.cls).toBeUndefined();
  });

  it('holdsShown: the model holds it, the tree does not show it — MISMATCH failed-holds, on the assert\'s FAIL', () => {
    const { replies, launched, state } = at(ios, 'wda', 'f1');
    expect(holdsShown('iban', 'SK31 1200 0000')(state, replies, 'wda', launched)).toMatchObject({ outcome: 'ok' });
    const failed = '0/1 asserts FAILED\nFAIL  element id:"lab.form-format.iban" text "SK31 1200 0000" — read "SK3112000000"';
    expect(holdsShown('iban', 'SK31 1200 0000')(state, [replies[0], failed], 'wda', launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'FAIL' });
  });

  it('holdsShown: the fill not held — holds\' verdict over the fill alone: fill-claim on the fill\'s kind (other), not the assert\'s (PASS)', () => {
    const { replies, launched, state } = withFieldValue(at(ios, 'wda', 'f1'), 'iban', 'SK31 12');
    expect(holdsShown('iban', 'SK31 1200 0000')(state, replies, 'wda', launched)).toEqual(expect.objectContaining({ outcome: 'MISMATCH', cls: 'fill-claim', kind: 'other' }));
  });
});

/**
 * p7 (D43a, ADR 0037): a no-clear fill of `Š` into form-prefilled's name — refused before anything was sent, the
 * prefill kept. No device has run it yet: pinned over D40's p1 (the same cell and field, its launch the prefill), its
 * final state set to what each reply would leave.
 */
describe('refusedKept: p7, a character averi cannot type into a prefilled field', () => {
  const REFUSAL = "ERROR cannot type U+0160 'Š': on Android averi types only printable ASCII (U+0020–U+007E): `input text` crashes on another character after typing the ones before it. Refused before anything was sent — nothing tapped, cleared or typed.";
  const p1 = recordedCase(readLiveRecord('android-forms-d40-1.json'), 'uiautomator', 'p1');
  const prefill = p1.launched.fields!.name.value;
  const left = (value: string) => withFieldValue(p1, 'name', value).state;

  it('the prefill is the launch\'s, not empty (the case asks a prefilled field)', () => {
    expect(prefill).toBe('Jan Šťastný');
  });

  it('refused before anything was sent, the prefill kept: ok', () => {
    expect(refusedKept('name')(left(prefill), [REFUSAL], 'uiautomator', p1.launched)).toMatchObject({ outcome: 'ok', kind: 'refused' });
  });

  it('refused, but the field changed (a prefix typed, a clear): LOUD loud-changed', () => {
    expect(refusedKept('name')(left('Jan ŠťastnýJ'), [REFUSAL], 'uiautomator', p1.launched)).toMatchObject({ outcome: 'LOUD', cls: 'loud-changed', kind: 'refused' });
  });

  it('kept, but refused by the device, not before sending (idb\'s trace, exit 255): LOUD loud-untouched', () => {
    expect(refusedKept('name')(left(prefill), ['ERROR Command failed (exit 1): idb ui text Š'], 'idb', p1.launched)).toMatchObject({ outcome: 'LOUD', cls: 'loud-untouched', kind: 'refused' });
  });

  it('a claim of done: MISMATCH fill-claim', () => {
    expect(refusedKept('name')(left(prefill), ['Filled id:"lab.form-prefilled.name" (1 character)'], 'uiautomator', p1.launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
  });
});

/**
 * f11–f14 (D37): form-format's date field (it inserts `.` after the 2nd and 4th digit, digits only; placeholder
 * `__.__.____`) and phone field (no reformat; placeholder `+421`) — ADR 0034's dotted date and the D29 gaps (a
 * placeholder with no letter or digit, a `+421`-style prefix). No device has run them yet: judged here over D40's f1
 * record (iOS WDA), its final state set to what each fill would leave; their device outcome is batch-3's to read.
 */
describe('f11–f14 (D37): a dotted date and a `+421` phone in form-format', () => {
  const IDS = ['f11', 'f12', 'f13', 'f14'];
  const f1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'f1');
  const left = (tag: string, value: string) => withFieldValue(f1, tag, value).state;
  const DATE_FILLED = 'Filled id:"lab.form-format.date" (8 characters, the field shows them reformatted: 2 separators added)';
  const DATE_SHOWN = 'All 1 asserts passed\nPASS  element id:"lab.form-format.date" with text "31.12.2026" exists\nappAlive: true';
  const of = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'native', groups: ['forms'], only: IDS });

  it.each(['ios', 'android'] as const)('%s runs all four, after f10: one fill each of form-format, clear only on f12 and f14; f11 then asserts what the tree shows', async (platform) => {
    const cases = await of(platform);
    expect(cases.map((c) => c.id)).toEqual(IDS);
    expect(cases.every((c) => c.cell === 'form-format' && c.group === 'forms')).toBe(true);
    expect(cases.map((c) => c.calls[0])).toEqual([
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '31122026' } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '31.12.2026', clear: true } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.phone"', text: '421903123456' } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.phone"', text: '+421903123456', clear: true } },
    ]);
    expect(cases.map((c) => c.calls.length)).toEqual([2, 1, 1, 1]);
    expect(cases[0].calls[1]).toEqual({ tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-format.date' }, text: '31.12.2026', timeout: 2_000 }] } });
    const all = (await selectCases({ platform, app: 'native', groups: ['forms'] })).map((c) => c.id);
    expect(all.indexOf('f11')).toBe(all.indexOf('f10') + 1);
  });

  it('the date held as the field formats it, whatever was typed: ok; a fill claimed done over the digits alone: MISMATCH', async () => {
    const [f11, f12] = await of('ios');
    expect(f11.judge(left('date', '31.12.2026'), [DATE_FILLED, DATE_SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f12.judge(left('date', '31.12.2026'), [DATE_FILLED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f11.judge(left('date', '31122026'), [DATE_FILLED, DATE_SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f12.judge(left('date', '31.1'), [DATE_FILLED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    const notShown = '0/1 asserts FAILED\nFAIL  element id:"lab.form-format.date" text "31.12.2026" — read "31122026"';
    expect(f11.judge(left('date', '31.12.2026'), [DATE_FILLED, notShown], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
  });

  it('the phone held as typed, the placeholder no part of it: ok; the placeholder kept in front, claimed done: MISMATCH; refused: LOUD', async () => {
    const [, , f13, f14] = await of('android');
    const filled = 'Filled id:"lab.form-format.phone" (12 characters)';
    const refused = 'ERROR the field shows "+421421903123456", not the 12 characters typed';
    expect(f13.judge(left('phone', '421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f14.judge(left('phone', '+421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f13.judge(left('phone', '+421421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f14.judge(left('phone', '421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f13.judge(left('phone', '+421421903123456'), [refused], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD' });
  });

  it('no outcome guessed: none of them is in LIVE_KNOWN until a device run reads it', () => {
    expect(Object.keys(LIVE_KNOWN).filter((k) => IDS.includes(k.split(' ').at(-1)!))).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectCases } from '../../scripts/truth/live-cases.js';
import { holds, holdsShown, judgeFloatingGap, judgeMissUnderSheet, judgeNoteFill, judgePhoneScroll, judgeUnderSheet, refusedKept } from '../../scripts/truth/live-forms.js';
import { knownEntry } from '../../scripts/truth/live-known.js';
import type { LabState } from '../../scripts/truth/schema.js';
import { differenceOf, landingOf } from '../../src/interact/fill-landing.js';
import { ACTIVE_WINDOW_HINT } from '../../src/ui-tree/miss.js';
import { readLiveRecord, recordedCase, withFieldValue, type LiveRecord } from '../helpers/live-records.js';

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

describe('kf1–kf3 on a real DOCKED run: the precondition reads docked and every case SKIPs (T4)', () => {
  // tests/fixtures/live-android-forms-b10-kf-docked.json: batch-10's uiautomator whole-group run (averi_lab, API 33,
  // main 139256a2), its kf1–kf3 results as recorded (`launched.keyboard` the docked Gboard, frame 0,1398 1080x822).
  // Every batch so far has run docked: a weakened threshold or panel match would turn kf1/kf2 into a vacuous ok here.
  const docked = JSON.parse(readFileSync(new URL('../fixtures/live-android-forms-b10-kf-docked.json', import.meta.url), 'utf8')) as LiveRecord;
  const kf = (record: LiveRecord, id: string) => recordedCase(record, 'uiautomator', id);
  const fu1 = readLiveRecord('android-forms-r1023b-fu1-cr-1.json');
  const DOCKED = { outcome: 'SKIP', why: 'keyboard docked (the app hears an IME 822 px tall, not the floating strip)' };

  it('the record: each case launched under the docked IME, kf1\'s evidence reply quoting it', () => {
    for (const id of ['kf1', 'kf2', 'kf3'] as const) {
      expect(kf(docked, id).launched.keyboard).toEqual({ frame: { x: 0, y: 1398, width: 1080, height: 822 }, visible: true, field: 'postcode' });
    }
    expect(kf(docked, 'kf1').replies[0]).toContain('(element 55,1644 970x132, keyboard 0,1398 1080x822)');
  });

  it('kf1, kf2 and kf3: SKIP, "keyboard docked", before any reply is read', () => {
    for (const id of ['kf1', 'kf2', 'kf3'] as const) {
      const { replies, launched, state } = kf(docked, id);
      expect(judgeFloatingGap(id)(state, replies, 'uiautomator', launched)).toEqual(DOCKED);
    }
  });

  it('a docked evidence reply never counts as a quoted panel: 822 px matches no LAB_FLOATING_PANELS entry — SKIP on a floated launch too', () => {
    for (const id of ['kf1', 'kf2'] as const) {
      const floated = kf(fu1, id);
      expect(judgeFloatingGap(id)(floated.state, kf(docked, id).replies, 'uiautomator', floated.launched)).toMatchObject({
        outcome: 'SKIP',
        why: expect.stringMatching(/^no measured panel quoted over ks — the IME was not floating there: 1\/1 asserts FAILED/),
      });
    }
    const floated = kf(fu1, 'kf3');
    expect(judgeFloatingGap('kf3')(floated.state, kf(docked, 'kf3').replies, 'uiautomator', floated.launched)).toMatchObject({
      outcome: 'SKIP',
      why: expect.stringMatching(/^no measured panel named in the reply — the IME was not floating there: ERROR scroll_until/),
    });
  });

  it('kf3 on the floated record (r1023b fu1): ok — no stop, the panel named, postcode untouched', () => {
    const { replies, launched, state } = kf(fu1, 'kf3');
    expect(launched.keyboard?.frame).toEqual({ x: 0, y: 2088, width: 1080, height: 132 });
    expect(judgeFloatingGap('kf3')(state, replies, 'uiautomator', launched)).toMatchObject({
      outcome: 'ok',
      why: expect.stringMatching(/^no stop \(ks 1493–1592\), postcode untouched; 3 touch\(es\) the app logged at \(540,1060\) \(540,1060\) \(540,1060\): ERROR scroll_until/),
    });
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
 * D43 (ADR 0037's D43 amendment): under WDA averi types `Š` through `/wda/keys`, so p7 — the refusal with the prefill kept
 * — runs under idb and uiautomator only, and p7w under WDA holds the prefill with `Š` appended (no clear). b1d and b7
 * under WDA are held to `holds` with no KNOWN entry (live-known.ts): ok expected, a LOUD there is no longer known.
 */
describe('p7 and p7w (D43): refused under idb and uiautomator, typed under WDA', () => {
  const p1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'p1');
  const prefill = p1.launched.fields!.name.value;
  const left = (value: string) => withFieldValue(p1, 'name', value).state;
  const byId = async (platform: 'ios' | 'android', id: string) => (await selectCases({ platform, app: 'native', groups: ['forms'], only: [id] }))[0];

  it('p7 runs under idb and uiautomator only; p7w is iOS\'s, under WDA only, the same fill of `Š` with no clear', async () => {
    const [p7ios, p7android, p7w, p7wAndroid] = [await byId('ios', 'p7'), await byId('android', 'p7'), await byId('ios', 'p7w'), await byId('android', 'p7w')];
    expect(p7ios.sources).toEqual(['idb', 'uiautomator']);
    expect(p7android.sources).toEqual(['idb', 'uiautomator']);
    expect(p7w.sources).toEqual(['wda']);
    expect(p7wAndroid).toBeUndefined();
    expect(p7w.calls).toEqual(p7ios.calls);
    expect(p7w.calls).toEqual([{ tool: 'type_text', args: { selector: 'id:"lab.form-prefilled.name"', text: 'Š' } }]);
  });

  it('p7w: the prefill with Š appended and Filled: ok; the prefill alone, refused: LOUD; a claim over the prefill alone: MISMATCH', async () => {
    const p7w = await byId('ios', 'p7w');
    expect(prefill).toBe('Jan Šťastný');
    const filled = 'Filled id:"lab.form-prefilled.name" (1 character)';
    expect(p7w.judge(left(`${prefill}Š`), [filled], 'wda', p1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(p7w.judge(left(prefill), ["ERROR cannot type U+0160 'Š': … Refused before anything was sent — nothing tapped, cleared or typed."], 'wda', p1.launched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-untouched' });
    expect(p7w.judge(left(prefill), [filled], 'wda', p1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
  });

  it('b1d and b7 have no KNOWN entry under WDA any more; under idb and uiautomator they keep theirs', () => {
    for (const id of ['b1d', 'b7']) {
      expect(knownEntry('ios', 'wda', id)).toBeUndefined();
      expect(knownEntry('ios', 'idb', id)).toMatchObject({ cls: 'loud-untouched', kind: 'refused' });
      expect(knownEntry('android', 'uiautomator', id)).toMatchObject({ cls: 'loud-untouched', kind: 'refused' });
    }
  });
});

/**
 * f11–f14 (D37): form-format's `date` (schema.ts#FieldFormat, placeholder `__.__.____`) and `phone` (no format,
 * placeholder `+421`) — at D37, ADR 0034's dotted date (a false mismatch until D51) and its D29 gaps. Judged here over D40's f1 record (iOS WDA), its
 * final state set to what each fill would leave; batch-3's device records are rejudged in live-rejudge.test.ts.
 */
describe('f11–f14 (D37): a dotted date and a `+421` phone in form-format', () => {
  const IDS = ['f11', 'f12', 'f13', 'f14'];
  const f1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'f1');
  const left = (tag: string, value: string) => withFieldValue(f1, tag, value).state;
  const DATE_FILLED = 'Filled id:"lab.form-format.date" (8 characters, the field shows them reformatted: 2 separators added)';
  const DATE_SHOWN = 'All 1 asserts passed\nPASS  element id:"lab.form-format.date" with text "31.12.2026" exists\nappAlive: true';
  const casesOn = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'native', groups: ['forms'], only: IDS });
  /** What idb reads of a UIKit field (D29): no placeholder named, so an empty field's placeholder is its text before. */
  const idbReading = (value: string, before: string, clear = false) => ({ value, clear, before, placeholder: undefined, isInput: true, resolvedValue: before, held: 0 as const });

  it.each(['ios', 'android'] as const)('%s runs all four, after f10: one fill each of form-format, clear only on f12 and f14; f11 then asserts what the tree shows', async (platform) => {
    const cases = await casesOn(platform);
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
    const [f11, f12] = await casesOn('ios');
    expect(f11.judge(left('date', '31.12.2026'), [DATE_FILLED, DATE_SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f12.judge(left('date', '31.12.2026'), [DATE_FILLED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f11.judge(left('date', '31122026'), [DATE_FILLED, DATE_SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f12.judge(left('date', '31.1'), [DATE_FILLED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    const notShown = '0/1 asserts FAILED\nFAIL  element id:"lab.form-format.date" text "31.12.2026" — read "31122026"';
    expect(f11.judge(left('date', '31.12.2026'), [DATE_FILLED, notShown], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
  });

  it('f11 under idb (D51): its dotted reading after the unnamed mask lands reformatted, the judge ok; the src before the fix failed — MISMATCH failed-holds, not LOUD', async () => {
    // ADR 0034's D51 amendment: two `.` over a digits-only typing are a digit grouping, and the `__.__.____` template
    // idb reads as the text before is no earlier text.
    expect(landingOf('31.12.2026', idbReading('31122026', '__.__.____'))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
    const [f11] = await casesOn('ios');
    expect(f11.judge(left('date', '31.12.2026'), [DATE_FILLED, DATE_SHOWN], 'idb', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    // batch-3's records (*-forms-d37-1.json, the src before D51) replied so:
    const failed = 'ERROR typed 8 characters but the field shows "31.12.2026"';
    expect(f11.judge(left('date', '31.12.2026'), [failed], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused' });
  });

  it('f13 under idb (D29): the `+421` placeholder read as the text before, unnamed — the reading lands by the exact rule (the value inside it), and the judge reads the app', async () => {
    const [, , f13] = await casesOn('ios');
    const filled = 'Filled id:"lab.form-format.phone" (12 characters)';
    // The placeholder vanished at the first key: the reading is the value, which it holds — landed, the app agrees: ok.
    expect(landingOf('421903123456', idbReading('421903123456', '+421'))).toEqual({ kind: 'landed' });
    expect(f13.judge(left('phone', '421903123456'), [filled], 'idb', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    // The same rule lands a `+421` the field really kept in front (the reading cannot tell it from the placeholder);
    // the app's model can: a claim of done over it is a MISMATCH.
    expect(landingOf('+421421903123456', idbReading('421903123456', '+421'))).toEqual({ kind: 'landed' });
    expect(f13.judge(left('phone', '+421421903123456'), [filled], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
  });

  it('the phone held as typed, the placeholder no part of it: ok; the placeholder kept in front, claimed done: MISMATCH; refused: LOUD', async () => {
    const [, , f13, f14] = await casesOn('android');
    const filled = 'Filled id:"lab.form-format.phone" (12 characters)';
    const refused = 'ERROR the field shows "+421421903123456", not the 12 characters typed';
    expect(f13.judge(left('phone', '421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f14.judge(left('phone', '+421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(f13.judge(left('phone', '+421421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f14.judge(left('phone', '421903123456'), [filled], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(f13.judge(left('phone', '+421421903123456'), [refused], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD' });
  });

  // Batch-3's device run (block H, main 6b4a44df; ios-idb-forms-d37-1.json, ios-wda-forms-d37-1.json,
  // android-forms-d37-1.json): f11 failed-holds under every source — the app held `31.12.2026`, averi replied "ERROR
  // fill: typed 8 characters but the field shows 10" (ADR 0034 then failed a `.` group that is no thousands); f12–f14 ok
  // everywhere, f13 under idb included. f11 was known under each source until D51 fixed it and struck the three entries
  // off; none is known now.
  it('none of f11–f14 is known under any source: f11 fixed by D51 (its three entries struck off), f12–f14 ok', () => {
    const sources = { ios: ['idb', 'wda'], android: ['uiautomator'] } as const;
    const known = Object.entries(sources).flatMap(([platform, ss]) =>
      ss.flatMap((source) => IDS.flatMap((id) => {
        const e = knownEntry(platform, source, id);
        return e === undefined ? [] : [`${platform} ${source} ${id} ${e.cls} ${e.kind}${e.intermittent ? ' intermittent' : ''}`];
      })),
    );
    expect(known).toEqual([]);
  });
});

/**
 * f15 (D63): form-format's `date` keeps 8 digits, so `2026` typed without clear after a full `31.12.2026` changes
 * nothing, though the field's text holds it — the reading is unchanged since typing began, and averi must say the field
 * did not change (live-forms.ts#refusedUnchanged). Not yet run on a device; judged over D40's f1 record (iOS WDA), its
 * final state set to what the fills would leave.
 */
describe('f15 (D63): digits the full date field refuses, though its text holds them', () => {
  const f1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'f1');
  const left = (value: string) => withFieldValue(f1, 'date', value).state;
  const FIRST = 'Filled id:"lab.form-format.date" (8 characters, cleared 0 characters first, the field shows them reformatted: 2 separators added)';
  const UNCHANGED = 'ERROR fill: typed 4 characters but the field shows 10 — the field did not change: the typing did not reach it, or the field refused it';
  const casesOn = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'native', groups: ['forms'], only: ['f15'] });

  it.each(['ios', 'android'] as const)('%s runs it right after f14: a fill with clear, then a fill without', async (platform) => {
    const [f15] = await casesOn(platform);
    expect(f15.cell).toBe('form-format');
    expect(f15.calls).toEqual([
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '31122026', clear: true } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '2026' } },
    ]);
    const all = (await selectCases({ platform, app: 'native', groups: ['forms'] })).map((c) => c.id);
    expect(all.indexOf('f15')).toBe(all.indexOf('f14') + 1);
  });

  it('the reading is what landingOf refuses since D63: unchanged since typing began, its text holding the value', () => {
    const second = { value: '2026', clear: false, before: '31.12.2026', placeholder: undefined, isInput: true, resolvedValue: '31.12.2026', held: 0 as const };
    expect(landingOf('31.12.2026', second)).toBeUndefined();
    expect(differenceOf('31.12.2026', second)).toEqual({ kind: 'unchanged' });
  });

  it('refused as unchanged, the date kept: ok; Filled over it (the src before D63): MISMATCH fill-claim', async () => {
    const [f15] = await casesOn('ios');
    expect(f15.judge(left('31.12.2026'), [FIRST, UNCHANGED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok', kind: 'refused' });
    expect(f15.judge(left('31.12.2026'), [FIRST, 'Filled id:"lab.form-format.date" (4 characters)'], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
  });

  it('another error with the date kept: LOUD loud-untouched; the date changed: LOUD loud-changed; the first fill failed over it: MISMATCH failed-holds', async () => {
    const [f15] = await casesOn('android');
    expect(f15.judge(left('31.12.2026'), [FIRST, 'ERROR fill: typed 4 characters but the field shows 10'], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-untouched' });
    expect(f15.judge(left('20.26.2026'), [FIRST, UNCHANGED], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-changed' });
    expect(f15.judge(left('31.12.2026'), ['ERROR fill: typed 8 characters but the field shows 10', UNCHANGED], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused' });
  });
});

/**
 * f16 (D64): form-format's `date` keeps 8 digits, so `12` typed without clear after `31.12.202` keeps only the `1` — the
 * app holds `31.12.2021`, a reading that holds `12` only inside `31.12`, none of it past the earlier text. Before D64
 * averi passed it by containment; it must now fail (live-forms.ts#refusedCapped). Not yet run on a device; judged over
 * D40's f1 record (iOS WDA), its final state set to what the fills would leave.
 */
describe('f16 (D64): digits the date field at its cap keeps only the head of, though its text holds them', () => {
  const f1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'f1');
  const left = (value: string) => withFieldValue(f1, 'date', value).state;
  const FIRST = 'Filled id:"lab.form-format.date" (7 characters, cleared 0 characters first, the field shows them reformatted: 2 separators added)';
  const CAPPED = 'ERROR fill: typed 2 characters but the field shows 10 (content withheld from this error)';
  const casesOn = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'native', groups: ['forms'], only: ['f16'] });

  it.each(['ios', 'android'] as const)('%s runs it right after f15: a fill with clear, then a fill without', async (platform) => {
    const [f16] = await casesOn(platform);
    expect(f16.cell).toBe('form-format');
    expect(f16.calls).toEqual([
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '3112202', clear: true } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-format.date"', text: '12' } },
    ]);
    const all = (await selectCases({ platform, app: 'native', groups: ['forms'] })).map((c) => c.id);
    expect(all.indexOf('f16')).toBe(all.indexOf('f15') + 1);
  });

  it('the reading is what landingOf refuses since D64: it moved, but holds none of the typing past the earlier text', () => {
    const second = { value: '12', clear: false, before: '31.12.202', placeholder: undefined, isInput: true, resolvedValue: '31.12.202', held: 0 as const };
    expect(landingOf('31.12.2021', second)).toBeUndefined();
    expect(differenceOf('31.12.2021', second)).toEqual({ kind: 'length' });
  });

  it('refused, the date kept at its cap: ok; Filled over it (the src before D64): MISMATCH fill-claim', async () => {
    const [f16] = await casesOn('ios');
    expect(f16.judge(left('31.12.2021'), [FIRST, CAPPED], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok', kind: 'refused' });
    expect(f16.judge(left('31.12.2021'), [FIRST, 'Filled id:"lab.form-format.date" (2 characters)'], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
  });

  it('the date other than kept: LOUD loud-changed; the first fill failed over it: MISMATCH failed-holds; no error and no claim: LOUD loud-untouched', async () => {
    const [f16] = await casesOn('android');
    expect(f16.judge(left('12.31.1220'), [FIRST, CAPPED], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-changed' });
    expect(f16.judge(left('31.12.2021'), ['ERROR fill: typed 7 characters but the field shows 9', CAPPED], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused' });
    expect(f16.judge(left('31.12.2021'), [FIRST, 'Filled id:"lab.form-format.date" (2 characters) — NOT verified: the field shows exactly its placeholder\'s text'], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-untouched' });
  });
});

/**
 * g1–g5 and rfe1–rfe3 (L7): form-grouped's ibanEager (group4eager: a space as soon as a group of four is complete,
 * none at 24) and phoneGrouped (phone3: a leading `+`, the digits in threes, under a `+421` placeholder), and
 * rn-format-eager's E (group4eager on React Native) — D60's eager trailing mark and D37's `+421` grouping field. No device has run them
 * yet: judged over D40's records (form-format's f1 under WDA, rn-format's rf1 under idb), their final state set to what
 * each fill would leave; what each source answers is batch-9's to read.
 */
describe('g1–g5 and rfe1–rfe3 (L7): an eager-spaced IBAN and a grouped `+421` phone, native and React Native', () => {
  const G_IDS = ['g1', 'g2', 'g3', 'g4', 'g5'];
  const RFE_IDS = ['rfe1', 'rfe2', 'rfe3'];
  const f1 = recordedCase(readLiveRecord('ios-forms-d40-1.json'), 'wda', 'f1');
  const left = (tag: string, value: string) => withFieldValue(f1, tag, value).state;
  const rf1 = recordedCase(readLiveRecord('ios-rn-forms-d40-1.json'), 'idb', 'rf1');
  /** rf1's launch as rn-format-eager's would read: its fields E and P, both empty. */
  const rnLaunched: LabState = { ...rf1.launched, cell: 'rn-format-eager', fields: { E: { value: '', focused: false, error: null }, P: { value: '', focused: false, error: null } } };
  const rnLeft = (value: string): LabState => ({ ...rnLaunched, fields: { ...rnLaunched.fields, E: { value, focused: true, error: null } } });
  const native = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'native', groups: ['forms'], only: G_IDS });
  const rn = async (platform: 'ios' | 'android') => selectCases({ platform, app: 'react-native', groups: ['forms'], only: RFE_IDS });
  const SHOWN = 'All 1 asserts passed\nPASS  element id:"lab.form-grouped.ibanEager" with text "SK31 1200 0000 123" exists\nappAlive: true';

  it.each(['ios', 'android'] as const)('%s runs g1–g5 after f16, form-format\'s last, one fill each of form-grouped, clear on g1 and g4; g1 then asserts what the tree shows', async (platform) => {
    const cases = await native(platform);
    expect(cases.map((c) => c.id)).toEqual(G_IDS);
    expect(cases.every((c) => c.cell === 'form-grouped' && c.group === 'forms')).toBe(true);
    expect(cases.map((c) => c.calls[0])).toEqual([
      { tool: 'type_text', args: { selector: 'id:"lab.form-grouped.ibanEager"', text: 'SK3112000000123', clear: true } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-grouped.ibanEager"', text: 'SK3112000000' } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-grouped.phoneGrouped"', text: '421903123456' } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-grouped.phoneGrouped"', text: '+421903123456', clear: true } },
      { tool: 'type_text', args: { selector: 'id:"lab.form-grouped.phoneGrouped"', text: '+421 903 123 456' } },
    ]);
    expect(cases.map((c) => c.calls.length)).toEqual([2, 1, 1, 1, 1]);
    expect(cases[0].calls[1]).toEqual({ tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-grouped.ibanEager' }, text: 'SK31 1200 0000 123', timeout: 2_000 }] } });
    const all = (await selectCases({ platform, app: 'native', groups: ['forms'] })).map((c) => c.id);
    expect(all.indexOf('g1')).toBe(all.indexOf('f16') + 1);
    // Native cases only: rfe1–rfe3 are the React Native app's.
    expect(all.filter((id) => RFE_IDS.includes(id))).toEqual([]);
  });

  it.each(['ios', 'android'] as const)('%s runs rfe1–rfe3 on the React Native app after rf5: clear on rfe1 alone, into E\'s field', async (platform) => {
    const cases = await rn(platform);
    expect(cases.map((c) => c.id)).toEqual(RFE_IDS);
    expect(cases.every((c) => c.cell === 'rn-format-eager' && c.group === 'forms')).toBe(true);
    expect(cases.map((c) => c.calls)).toEqual([
      [{ tool: 'type_text', args: { selector: 'id:"lab.rn-format-eager.E.field"', text: 'SK3112000000198742637541', clear: true } }],
      [{ tool: 'type_text', args: { selector: 'id:"lab.rn-format-eager.E.field"', text: 'SK31120000' } }],
      [{ tool: 'type_text', args: { selector: 'id:"lab.rn-format-eager.E.field"', text: 'SK3112000000' } }],
    ]);
    const all = (await selectCases({ platform, app: 'react-native', groups: ['forms'] })).map((c) => c.id);
    expect(all.indexOf('rfe1')).toBe(all.indexOf('rf5') + 1);
    expect(all.filter((id) => G_IDS.includes(id))).toEqual([]);
  });

  it('g1/g2: the IBAN held as the eager field spaces it — ok; the eager space missing, or a claim over the text as typed — MISMATCH', async () => {
    const [g1, g2] = await native('ios');
    const filled = 'Filled id:"lab.form-grouped.ibanEager" (15 characters, the field shows them reformatted: 3 separators added)';
    expect(g1.judge(left('ibanEager', 'SK31 1200 0000 123'), [filled, SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(g1.judge(left('ibanEager', 'SK3112000000123'), [filled, SHOWN], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    const notShown = '0/1 asserts FAILED\nFAIL  element id:"lab.form-grouped.ibanEager" text "SK31 1200 0000 123" — read "SK3112000000123"';
    expect(g1.judge(left('ibanEager', 'SK31 1200 0000 123'), [filled, notShown], 'wda', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
    const twelve = 'Filled id:"lab.form-grouped.ibanEager" (12 characters, the field shows them reformatted: 3 separators added)';
    expect(g2.judge(left('ibanEager', 'SK31 1200 0000 '), [twelve], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(g2.judge(left('ibanEager', 'SK31 1200 0000'), [twelve], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(g2.judge(left('ibanEager', 'SK31 1200 0000 '), ['ERROR typed 12 characters but the field shows "SK31 1200 0000 "'], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
  });

  it('g3–g5: the phone held in threes, its `+` kept when typed — ok; the `+421` placeholder kept in front, or the digits ungrouped, claimed done — MISMATCH; refused — LOUD', async () => {
    const [, , g3, g4, g5] = await native('android');
    const filled = (n: number) => `Filled id:"lab.form-grouped.phoneGrouped" (${n} characters, the field shows them reformatted: 3 separators added)`;
    expect(g3.judge(left('phoneGrouped', '421 903 123 456'), [filled(12)], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(g4.judge(left('phoneGrouped', '+421 903 123 456'), [filled(13)], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(g5.judge(left('phoneGrouped', '+421 903 123 456'), ['Filled id:"lab.form-grouped.phoneGrouped" (16 characters)'], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'ok' });
    expect(g3.judge(left('phoneGrouped', '+421 421 903 123 456'), [filled(12)], 'idb', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    expect(g4.judge(left('phoneGrouped', '+421903123456'), [filled(13)], 'uiautomator', f1.launched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    const refused = 'ERROR the field shows "+421 421 903 123 456", not the 12 characters typed';
    expect(g3.judge(left('phoneGrouped', '+421 421 903 123 456'), [refused], 'idb', f1.launched, [])).toMatchObject({ outcome: 'LOUD' });
  });

  it('rfe1/rfe2 (D60): the drops D40 saw on iOS RN (4 under idb, 2 under wda) end on a group, in the eager mark — a dropped tail by the fill\'s rules; the full value lands', () => {
    const rule = (value: string, clear = false) => ({ value, clear, before: '', placeholder: undefined, isInput: true, resolvedValue: '', held: 0 as const });
    expect(landingOf('SK31 1200 0000 1987 4263 ', rule('SK3112000000198742637541', true))).toBeUndefined();
    expect(differenceOf('SK31 1200 0000 1987 4263 ', rule('SK3112000000198742637541', true))).toEqual({ kind: 'dropped-tail', landed: 20, dropped: 4, grouped: true });
    expect(landingOf('SK31 1200 0000 1987 4263 7541', rule('SK3112000000198742637541', true))).toMatchObject({ kind: 'landed' });
    expect(differenceOf('SK31 1200 ', rule('SK31120000'))).toEqual({ kind: 'dropped-tail', landed: 8, dropped: 2, grouped: true });
    expect(landingOf('SK31 1200 00', rule('SK31120000'))).toMatchObject({ kind: 'landed' });
    // rfe3 (and g2): the full 12 end on a group — the eager mark after them is D53's `separated`, refused by design.
    expect(differenceOf('SK31 1200 0000 ', rule('SK3112000000'))).toEqual({ kind: 'separated', added: 3 });
  });

  it('rfe1–rfe3: E held as the eager field spaces it — ok, a dropped tail typed again included (D60\'s live reply); a tail left dropped, claimed done — MISMATCH; rfe3 refused while the app holds it — MISMATCH failed-holds, as its `says` expects', async () => {
    const [rfe1, rfe2, rfe3] = await rn('ios');
    const retyped = 'Filled id:"lab.rn-format-eager.E.field" (24 characters, the last 4 characters typed again after the field dropped them, the field shows them reformatted: 5 separators added)';
    expect(rfe1.judge(rnLeft('SK31 1200 0000 1987 4263 7541'), [retyped], 'idb', rnLaunched, [])).toMatchObject({ outcome: 'ok' });
    expect(rfe1.judge(rnLeft('SK31 1200 0000 1987 4263 '), [retyped], 'idb', rnLaunched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'fill-claim' });
    const ten = 'Filled id:"lab.rn-format-eager.E.field" (10 characters, the last 2 characters typed again after the field dropped them, the field shows them reformatted: 2 separators added)';
    expect(rfe2.judge(rnLeft('SK31 1200 00'), [ten], 'wda', rnLaunched, [])).toMatchObject({ outcome: 'ok' });
    expect(rfe2.judge(rnLeft('SK31 1200 '), ['ERROR the field shows "SK31 1200 ", not the 10 characters typed'], 'wda', rnLaunched, [])).toMatchObject({ outcome: 'LOUD', cls: 'loud-changed' });
    expect(rfe3.says).toMatch(/expected MISMATCH failed-holds by design on iOS \(idb, wda; D53 `separated`/);
    const separated = 'ERROR typed 12 characters but the field shows 15 — every typed character is there, in order, with 3 separators added';
    expect(rfe3.judge(rnLeft('SK31 1200 0000 '), [separated], 'idb', rnLaunched, [])).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
  });

  it('g2 says its expected MISMATCH by design, as rfe3 does; no other g or rfe case does', async () => {
    const all = [...(await native('ios')), ...(await rn('ios'))];
    expect(all.filter((c) => /expected MISMATCH/.test(c.says)).map((c) => c.id)).toEqual(['g2', 'rfe3']);
    expect(all.find((c) => c.id === 'g2')!.says).toMatch(/by design on iOS \(idb, wda; D53 `separated`.*Android not yet read/);
  });

  it('no outcome guessed: none of g1–g5 or rfe1–rfe3 is known under any source until a device run reads it', () => {
    const sources = { ios: ['idb', 'wda'], android: ['uiautomator'] } as const;
    const known = Object.entries(sources).flatMap(([platform, ss]) => ss.flatMap((source) => [...G_IDS, ...RFE_IDS].filter((id) => knownEntry(platform, source, id) !== undefined)));
    expect(known).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, type Expectation, type FormExpectation } from '../../scripts/differential/golden-spec.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// Every judge of the golden spec (scripts/differential/golden-spec/*.ts, behind the façade golden-spec.ts), each on
// replies it must accept and replies it must reject — including the "not in the tree" replies: judged by their effect
// where the row's judge rejects them (its own reason), vacuous (`not in the tree:`) where it would accept them, and
// accepted only by a row whose truth allows the target to be absent. The ratchet (golden.test.ts) guards only the
// judges that mismatch today; this table pins the rest, so a judge gone vacuous (`() => undefined`) fails here.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
type Case = readonly [reply: string, device: readonly string[], verdict: 'ok' | RegExp];

const TIMED_OUT = 'ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear';
const NEVER = 'ERROR scroll_until id:"lab.x" failed after 2 swipes (…) — element never appeared in the tree';
const NOT_FOUND = '1/1 asserts FAILED\nFAIL  element id:"lab.x" … — not found within 1 s';
const PASS = 'All 1 asserts passed\nPASS  element id:"lab.x" …';
const FAIL = '1/1 asserts FAILED\nFAIL  element id:"lab.x" … — expected … got …';
const IDB_SWIPE = (y: number) => `idb ui swipe 201 ${y} 201 115 --duration 0.3`;
const NOT_IN_TREE = /^not in the tree: /;

function check(judge: Expectation['judge'], cases: readonly Case[]) {
  for (const [reply, device, verdict] of cases) {
    const why = judge({ reply, device: [...device] } satisfies Outcome);
    if (verdict === 'ok') expect(why, `${reply} | ${device.join(' | ')}`).toBeUndefined();
    else expect(why, `${reply} | ${device.join(' | ')}`).toMatch(verdict);
  }
}

const target = (over: Partial<TargetTruth>): TargetTruth => ({
  tag: 'A',
  id: 'lab.x',
  color: '#E53935',
  declared: 'open',
  frame: rect(51, 110, 300, 64),
  reached: true,
  probe: [{ kind: 'touch', tag: '201,142' }],
  drawn: 1,
  seen: '#E53935',
  ...over,
});

const pick = <E extends Expectation>(rows: readonly E[], verb: string, tag?: string): E => {
  const r = rows.find((x) => x.verb === verb && (tag === undefined || (x as Partial<FormExpectation>).target === tag));
  if (r === undefined) throw new Error(`no ${tag ?? ''} ${verb} row`);
  return r;
};

describe('a coloured target, open', () => {
  const rows = expectations('ios', target({}), undefined, 'wda');
  it.each<[string, readonly Case[]]>([
    ['tap', [['Tapped id:"lab.x"', ['idb ui tap 201 142'], 'ok'], ['ERROR id:"lab.x" is under …; nothing was tapped', [], /^not tapped/], [TIMED_OUT, [], /^not tapped: ERROR Timed out/]]],
    ['colour', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    [
      'scroll_until',
      [
        ['Element id:"lab.x" fully visible after 0 swipes', [], 'ok'],
        ['Element id:"lab.x" fully visible after 1 swipe', [IDB_SWIPE(459)], /^swiped 1×/],
        ['ERROR scroll_until … stopped before any swipe', [], /^stopped/],
        [NEVER, [IDB_SWIPE(459)], /^stopped: .*never appeared in the tree/],
      ],
    ],
  ])('%s', (verb, cases) => check(pick(rows, verb).judge, cases));
});

describe('a coloured target beneath a presented layer', () => {
  const rows = expectations('ios', target({ declared: 'presented-over', reached: false, drawn: 0, seen: '#B72E2A' }), undefined, 'wda');
  it.each<[string, readonly Case[]]>([
    [
      'tap',
      [
        ['ERROR … an alert is presented over it — close it first; nothing was tapped', [], 'ok'],
        ['ERROR … close it first', ['idb ui tap 201 142'], /^refused, but sent idb ui tap/],
        ['Tapped id:"lab.x"', [], /^Tapped/],
        ['ERROR id:"lab.x" is under container … scroll_until it first', [], /^refused without "close it first"/],
        [TIMED_OUT, [], /^refused without "close it first": ERROR Timed out/],
        [TIMED_OUT, ['idb ui tap 201 142'], /^refused, but sent idb ui tap/],
        [`${TIMED_OUT} — close it first; nothing was tapped`, [], NOT_IN_TREE],
      ],
    ],
    ['colour', [[FAIL.replace('expected … got …', 'container … is drawn over the element … close it first'), [], 'ok'], [PASS, [], /^passed on #B72E2A/], [NOT_FOUND, [], NOT_IN_TREE]]],
    [
      'scroll_until',
      [
        ['ERROR scroll_until … stopped before any swipe … close it first', [], 'ok'],
        ['ERROR scroll_until … stopped before any swipe', [], /^no "close it first"/],
        ['Element id:"lab.x" fully visible after 0 swipes', [], /^no "close it first"/],
        [NEVER, [IDB_SWIPE(459)], /^swiped 1× beneath a presented layer/],
        ['ERROR scroll_until id:"lab.x" never appeared in the tree — close it first', [], NOT_IN_TREE],
      ],
    ],
  ])('%s', (verb, cases) => check(pick(rows, verb).judge, cases));
});

const field = (tag: string, y: number, over: Partial<FieldTruth> = {}): FieldTruth => ({
  tag,
  id: `lab.f.${tag}`,
  kind: 'text',
  title: tag,
  titleId: `lab.f.${tag}.title`,
  frame: rect(20, y, 362, 34),
  value: '',
  focused: false,
  error: null,
  ...over,
});
const control = (tag: string, over: Partial<ControlTruth>): ControlTruth => ({
  tag,
  id: `lab.f.${tag}`,
  kind: 'field',
  frame: rect(20, 160, 362, 34),
  situation: 'open',
  reached: true,
  probe: [{ kind: 'touch', tag: '201.0,177.0' }],
  ...over,
});

// One form truth with a row of every kind: a paired and an unpaired field error, a screen-level error that pairs
// with none, titles, a plain and a secure value, and a control in every situation.
const form: CellTruth = {
  cell: 'form-basic',
  layer: 'none',
  device: 'test',
  screen: { width: 402, height: 874 },
  scale: 3,
  targets: [],
  form: {
    fields: [
      field('name', 160, { value: 'Ann', error: { id: 'lab.f.name', text: 'Required' }, errorFrame: rect(20, 200, 150, 16) }),
      field('iban', 256, { error: { id: 'IbanError', text: 'Bad IBAN' }, errorFrame: rect(20, 296, 150, 16) }),
      field('pin', 352, { kind: 'pin', value: '1234' }),
    ],
    controls: [
      control('name', {}),
      control('submit', { kind: 'button', frame: rect(20, 516, 362, 46) }),
      control('vs', { frame: rect(20, 604, 362, 34), situation: 'under-keyboard', reached: false }),
      control('country', { situation: 'presented-over', reached: false }),
      control('row.ST', { kind: 'row', frame: undefined, situation: 'not-rendered', reached: false, probe: [] }),
      control('row.AL', { kind: 'row', frame: rect(20, 900, 362, 44), situation: 'off-screen', reached: false, probe: [] }),
      control('phone', { frame: rect(20, 530, 362, 34), situation: 'covered', reached: false, probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'submit', tag: 'invalid' }] }),
    ],
    keyboard: { frame: rect(0, 573, 402, 301), field: 'name' },
    screenError: { id: 'lab.f.screen', text: 'Check the form', frame: rect(20, 700, 362, 20) },
    submits: [],
    sheet: rect(0, 300, 402, 574),
  },
};

describe('the form rows', () => {
  const rows = formExpectations('ios', form, 'wda');

  it('every kind of row is asked', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual([
      'name error',
      'name.title text',
      'name text',
      'iban error',
      'iban.title text',
      'pin.title text',
      'pin text',
      'screenError error',
      'name tap',
      'submit tap',
      'submit scroll_until',
      'vs tap',
      'vs scroll_until',
      'country tap',
      'country scroll_until',
      'row.ST tap',
      'row.ST scroll_until',
      'row.AL tap',
      'row.AL scroll_until',
      'phone tap',
      'phone scroll_until',
    ]);
  });

  it.each<[string, string, readonly Case[]]>([
    ['a paired field error passes', 'name error', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ['an error named neither way fails', 'iban error', [[FAIL, [], 'ok'], [PASS, [], /^passed/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['a screen-level error pairs with no field', 'screenError error', [[FAIL, [], 'ok'], [PASS, [], /^passed/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['a title reads as drawn', 'name.title text', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ["a value reads as the model's", 'name text', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ['a secure value never reads back', 'pin text', [[FAIL, [], 'ok'], [PASS, [], /^passed: the secure field/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['an open control is tapped', 'name tap', [['Tapped id:"lab.f.name"', ['idb ui tap 201 177'], 'ok'], ['ERROR … nothing was tapped', [], /^not tapped/], [TIMED_OUT, [], /^not tapped: ERROR Timed out/]]],
    [
      'the pinned submit is reached with no swipe',
      'submit scroll_until',
      [
        ['Element id:"lab.f.submit" fully visible after 0 swipes', [], 'ok'],
        ['Element … after 1 swipe', [IDB_SWIPE(459)], /^swiped 1×/],
        ['ERROR scroll_until … under the soft keyboard', [], /^stopped/],
        [NEVER, [], /^stopped: .*never appeared in the tree/],
      ],
    ],
    [
      'a field under the keyboard: tap refused naming it',
      'vs tap',
      [
        ['ERROR The soft keyboard covers id:"lab.f.vs" … nothing was tapped', [], 'ok'],
        ['ERROR The soft keyboard covers id:"lab.f.vs"', ['idb ui tap 201 621'], /^refused, but sent/],
        ['Tapped id:"lab.f.vs"', [], /^Tapped/],
        ['ERROR id:"lab.f.vs" is under container …', [], /^refused without naming the keyboard/],
        [TIMED_OUT, [], /^refused without naming the keyboard: ERROR Timed out/],
      ],
    ],
    [
      'a field under the keyboard: scroll_until swipes, touching down above the keyboard',
      'vs scroll_until',
      [
        ['Element id:"lab.f.vs" fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        ['ERROR scroll_until … failed after 1 swipe — the soft keyboard …', [IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.vs" fully visible after 0 swipes', [], /^reached with no swipe, under the keyboard/],
        ['Element id:"lab.f.vs" fully visible after 1 swipe', [IDB_SWIPE(700)], /^touched down under the keyboard at \(201,700\)/],
        [NEVER, [IDB_SWIPE(459)], NOT_IN_TREE],
        [NEVER, [IDB_SWIPE(700)], /^touched down under the keyboard at \(201,700\)/],
      ],
    ],
    [
      'a field under the picker sheet: tap refused, close it first',
      'country tap',
      [
        ['ERROR … a screen is presented over it — close it first; nothing was tapped', [], 'ok'],
        ['Tapped id:"lab.f.country"', [], /^Tapped/],
        ['ERROR … under button "Albania"', [], /^refused without "close it first"/],
        [TIMED_OUT, [], /^refused without "close it first": ERROR Timed out/],
      ],
    ],
    [
      'a field under the picker sheet: scroll_until stops, close it first',
      'country scroll_until',
      [
        ['ERROR scroll_until … stopped before any swipe … close it first', [], 'ok'],
        ['ERROR … close it first', [IDB_SWIPE(459)], /^swiped 1× beneath the sheet/],
        ['Element … fully visible after 0 swipes', [], /^no "close it first"/],
        [NEVER, [], /^no "close it first": .*never appeared in the tree/],
        [NEVER, [IDB_SWIPE(459), IDB_SWIPE(459)], /^swiped 2× beneath the sheet/],
        ['ERROR scroll_until id:"lab.x" never appeared in the tree — close it first', [], NOT_IN_TREE],
      ],
    ],
    [
      'a lazy row not laid out: no tap sent — absent from the tree is allowed',
      'row.ST tap',
      [[TIMED_OUT, [], 'ok'], ['ERROR … nothing was tapped', [], 'ok'], ['Tapped id:"lab.f.row.ST"', [], /^Tapped/], ['ERROR …', ['idb ui tap 201 800'], /^refused, but sent/]],
    ],
    [
      'a lazy row not laid out: scroll_until swipes for it on the sheet — absent from the tree is allowed',
      'row.ST scroll_until',
      [
        [NEVER, [IDB_SWIPE(459), IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.row.ST" fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        [NEVER, [], /^no swipe: /],
        ['Element … after 1 swipe', [IDB_SWIPE(200)], /^touched down off the sheet at \(201,200\)/],
      ],
    ],
    ['a row off the screen: no tap sent — absent from the tree is allowed', 'row.AL tap', [[TIMED_OUT, [], 'ok'], ['Tapped id:"lab.f.row.AL"', [], /^Tapped/]]],
    [
      'a row off the screen: scroll_until swipes for it on the sheet — absent from the tree is allowed',
      'row.AL scroll_until',
      [
        [NEVER, [IDB_SWIPE(459)], 'ok'],
        [NEVER, [], /^no swipe: /],
      ],
    ],
    [
      'a field under the pinned submit: no tap sent',
      'phone tap',
      [['ERROR … under button "Continue" … nothing was tapped', [], 'ok'], ['Tapped id:"lab.f.phone"', ['idb ui tap 201 547'], /^Tapped/], ['ERROR …', ['idb ui tap 201 547'], /^refused, but sent/], [TIMED_OUT, [], NOT_IN_TREE]],
    ],
    [
      'a field under the pinned submit: not reached with no swipe',
      'phone scroll_until',
      [
        ['ERROR scroll_until … failed after 3 swipes — under button "Continue"', [IDB_SWIPE(459)], 'ok'],
        ['Element … fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.phone" fully visible after 0 swipes', [], /^reached with no swipe where a tap fires submit invalid/],
        [NEVER, [IDB_SWIPE(459)], NOT_IN_TREE],
      ],
    ],
  ])('%s', (_name, key, cases) => {
    const [tag, verb] = key.split(' ');
    check(pick(rows, verb, tag).judge, cases);
  });
});

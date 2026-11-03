import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';

// D66: a node WDA reports `isEnabled` "0" is marked `disabled` (types.ts#UiNode.disabled,
// docs/adr/0042-a-node-its-source-marks-not-enabled-is-said-disabled.md). The two committed captures holding the only
// "0"s in the repo are real /source bytes (each `_comment` says where from); every other node in them says "1".
const capture = async (name: string): Promise<UiNode> => parseWdaSource(await readFile(new URL(`../fixtures/wda-capture-${name}.json`, import.meta.url), 'utf8'));
const disabledIn = (tree: UiNode) => [...everyNode(tree)].filter((n) => n.disabled !== undefined).map((n) => [n.role, n.identifier, n.label, n.rect]);

describe('WDA `isEnabled` "0" → `disabled: true`, on the real captures (D66)', () => {
  it('the SWIFT form pushed: only its pinned CONTINUE is disabled (traits `NotEnabled, Button`)', async () => {
    expect(disabledIn(await capture('swift-form-pushed'))).toEqual([
      ['button', 'swift_payment.form.continue_button', 'Continue to summary', { x: 24, y: 780, width: 354, height: 44 }],
    ]);
  });

  it('Contacts\' New Contact: only its Done button is disabled, nothing typed yet', async () => {
    expect(disabledIn(await capture('contacts-new-contact'))).toEqual([['button', null, 'Done', { x: 346, y: 82, width: 36, height: 36 }]]);
  });
});

describe('WDA `isEnabled`, synthetic: one reading, a string or a number, anything else unknown (fail open)', () => {
  const button = (isEnabled: unknown) =>
    parseWdaSourceValue({ type: 'Button', rawIdentifier: 'b', label: 'B', rect: { x: 0, y: 0, width: 10, height: 10 }, isEnabled, children: [] });

  it.each([['"0"', '0'], ['0', 0]])('%s marks it disabled', (_name, flag) => {
    expect(button(flag).disabled).toBe(true);
  });

  it.each([['"1"', '1'], ['1', 1], ['absent', undefined], ['null', null], ['""', ''], ['"false"', 'false']])('%s leaves it unmarked', (_name, flag) => {
    expect(button(flag)).not.toHaveProperty('disabled');
  });
});

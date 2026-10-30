import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * `UiNode.secure`: what each parser says of an input's masking, read off the lab's two payment forms as captured
 * (tests/fixtures/truth). Each form has four plain fields and a PIN; the PIN is the one secure field. The fill reads
 * it (interact/fill.ts, docs/adr/0028-a-fill-re-reads-after-focus-only-where-focus-can-change-the-count.md): `false`
 * lets it skip the post-focus re-read, so a `false` the source did not say is the costly mistake — every case below
 * that is not an input, or whose source printed nothing, must read undefined.
 */
const truth = async (dir: string, name: string) => readFile(new URL(`../fixtures/truth/${dir}/${name}`, import.meta.url), 'utf8');
const android = async (form: string) => parseDump(await truth('android-averi_lab-api33', `${form}.xml`));
const idb = async (form: string) => parseIdbDescribeAll(await truth('ios-iphone17-ios27', `${form}.idb.json`));
const wda = async (form: string) => parseWdaSource(await truth('ios-iphone17-ios27', `${form}.wda.json`));
const byId = (tree: UiNode, id: string) => [...everyNode(tree)].find((n) => n.identifier === id && n.role === 'textfield')!;

const SOURCES = [
  ['uiautomator', android],
  ['idb', idb],
  ['WDA', wda],
] as const;
const FORMS = ['form-basic', 'form-prefilled'] as const;
const CASES = SOURCES.flatMap(([source, parse]) => FORMS.map((form) => [source, form, parse] as const));

describe('the parsers say which input is secure (UiNode.secure)', () => {
  it.each(CASES)('%s, %s: the PIN is secure, the four plain fields are not', async (_source, form, parse) => {
    const t = await parse(form);
    expect(byId(t, `lab.${form}.pin`).secure).toBe(true);
    for (const plain of ['name', 'email', 'iban', 'amount']) expect(byId(t, `lab.${form}.${plain}`).secure).toBe(false);
  });

  it.each(CASES)('%s, %s: a node that is no input carries no answer — unknown, not plain', async (_source, form, parse) => {
    const t = await parse(form);
    const others = [...everyNode(t)].filter((n) => n.role !== 'textfield');
    expect(others.length).toBeGreaterThan(0);
    for (const n of others) expect(n).not.toHaveProperty('secure');
  });

  it('uiautomator: an input whose dump has no password attribute is unknown', () => {
    const t = parseDump(
      '<hierarchy rotation="0"><node class="android.widget.EditText" resource-id="app:id/f" text="" bounds="[0,0][100,50]" /></hierarchy>',
    );
    expect(byId(t, 'f')).not.toHaveProperty('secure');
  });

  it("idb: an input listed without traits (an idb that does not print them) is unknown — idb's type says TextField for the PIN too", () => {
    const t = parseIdbDescribeAll(JSON.stringify([{ type: 'TextField', AXUniqueId: 'f', frame: { x: 0, y: 0, width: 100, height: 30 } }]));
    expect(byId(t, 'f')).not.toHaveProperty('secure');
  });

  it('idb: the trait alone says secure, with no subrole', () => {
    const t = parseIdbDescribeAll(
      JSON.stringify([{ type: 'TextField', AXUniqueId: 'f', traits: ['TextEntry', 'SecureTextField'], subrole: null, frame: { x: 0, y: 0, width: 100, height: 30 } }]),
    );
    expect(byId(t, 'f').secure).toBe(true);
  });

  it('idb: the subrole alone says secure, with traits that do not', () => {
    const t = parseIdbDescribeAll(
      JSON.stringify([{ type: 'TextField', AXUniqueId: 'f', traits: ['TextEntry'], subrole: 'AXSecureTextField', frame: { x: 0, y: 0, width: 100, height: 30 } }]),
    );
    expect(byId(t, 'f').secure).toBe(true);
  });

  it('a multi-line input (TextView) is plain where its source says so: WDA by type, idb with traits printed', () => {
    const rect = { x: 0, y: 0, width: 100, height: 90 };
    const wdaTree = parseWdaSource(JSON.stringify({ value: { type: 'Window', rect, children: [{ type: 'TextView', rawIdentifier: 'f', rect }] } }));
    expect(byId(wdaTree, 'f').secure).toBe(false);
    const idbTree = parseIdbDescribeAll(JSON.stringify([{ type: 'TextView', AXUniqueId: 'f', traits: ['TextEntry'], frame: rect }]));
    expect(byId(idbTree, 'f').secure).toBe(false);
  });

  it('idb: a node of another type carrying the secure trait is no input — unknown', () => {
    const t = parseIdbDescribeAll(
      JSON.stringify([{ type: 'Other', AXUniqueId: 'f', traits: ['SecureTextField'], subrole: 'AXSecureTextField', frame: { x: 0, y: 0, width: 100, height: 30 } }]),
    );
    expect([...everyNode(t)].find((n) => n.identifier === 'f')).not.toHaveProperty('secure');
  });
});

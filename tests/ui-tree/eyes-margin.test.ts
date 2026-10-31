import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { marginText } from '../../src/ui-tree/cover.js';
import { pairQuestion } from '../../src/ui-tree/eyes.js';
import { isInteractive } from '../../src/ui-tree/selectors.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * A TEXT IN A CONTROL'S TOUCH MARGIN (ui-tree/cover.ts#marginText) and the eyes' question of it (ui-tree/eyes.ts
 * #pairQuestion's `clear`): Compose dumps a control's touch target, grown to 48 dp past what it draws, and lays the next
 * field's title in that margin — on the lab's form-keyboard after `back`, phone `55,1280 970x132` (drawn `55,1296
 * 970x99`) and `vs.title` `55,1406 258x56` over its dumped bottom 6 px. The tree only suspects; the eyes decide.
 * docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
 */
const fixtures = new URL('../fixtures/', import.meta.url);
const read = (path: string): UiNode => parseDump(readFileSync(new URL(path, fixtures), 'utf8'));
const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;
const BOX = { x: 0, y: 0, width: 1080, height: 2220 };
const SCREEN = { box: BOX, boxes: [BOX], statusBand: 66, oriented: BOX, from: 'device' as const };
const PHONE = 'lab.form-keyboard.phone';
const VS_TITLE = 'lab.form-keyboard.vs.title';
const afterBack = (): UiNode => read('android-lab-form-keyboard-after-back.xml');
const fullyQuestion = (tree: UiNode, id = PHONE) => {
  const target = byId(tree, id);
  return pairQuestion(tree, target, sceneOf(tree).standing(target, SCREEN, { of: 'fully' }));
};
/** `tree` with the node `id` patched — the real dump, one fact changed. */
const patched = (tree: UiNode, id: string, patch: Partial<UiNode>): UiNode => {
  const walk = (n: UiNode): UiNode => (n.identifier === id ? { ...n, ...patch } : { ...n, children: n.children.map(walk) });
  return walk(tree);
};

describe('pairQuestion — the clear question of a `fully` stop under texts in its touch margin', () => {
  it('phone after back: one pair, the title, its overlap the 6 px of phone it lies over, beside it phone\'s own rows right of it', () => {
    const t = afterBack();
    const q = fullyQuestion(t);
    expect(q?.asks).toBe('clear');
    expect(q?.pairs.map((p) => ({ peer: p.peer.identifier, overlap: p.overlap, ...('beside' in p && { beside: p.beside }) }))).toEqual([
      { peer: VS_TITLE, overlap: { x: 55, y: 1406, width: 258, height: 6 }, beside: [{ x: 313, y: 1406, width: 712, height: 6 }] },
    ]);
  });

  it('asks nothing of a text the tree does not suspect', () => {
    const t = afterBack();
    const cases: [string, UiNode][] = [
      ['the cover a button: it takes touches', patched(t, VS_TITLE, { role: 'button' })],
      ['the text holding phone\'s centre (540,1346)', patched(t, VS_TITLE, { rect: { x: 300, y: 1340, width: 400, height: 122 } })],
      ['the text as wide as phone: the cut family, not this one', patched(t, VS_TITLE, { rect: { x: 55, y: 1406, width: 970, height: 56 } })],
      ['a source that does not pad touch targets', { ...t, paddedTouchTargets: undefined }],
    ];
    for (const [name, tree] of cases) {
      expect(fullyQuestion(tree), name).toBeUndefined();
      const phone = byId(tree, PHONE);
      const covers = sceneOf(tree).order.exposure(phone, BOX).covers;
      expect(covers.map((c) => c.node.identifier), name).toEqual([VS_TITLE]);
      expect(covers.filter((c) => marginText(c, phone, tree)), name).toEqual([]);
    }
  });

  it('marginText: each rule of the suspicion, one fact of the real pair changed', () => {
    const t = afterBack();
    const phone = byId(t, PHONE);
    const cover = sceneOf(t).order.exposure(phone, BOX).covers.find((c) => c.node.identifier === VS_TITLE)!;
    const title = cover.node;
    const at = (rect: UiNode['rect']) => ({ ...cover, node: { ...title, rect } });
    // phone 55,1280 970x132 (bottom 1412, centre 540,1346); the title 55,1406 258x56.
    expect(marginText(cover, phone, t)).toBe(true);
    expect(marginText(at({ x: 55, y: 1250, width: 258, height: 56 }), phone, t), 'over the top edge instead').toBe(true);
    expect(marginText(at({ x: 55, y: 1406, width: 966, height: 56 }), phone, t), '4 px of phone beside it').toBe(true);
    const refused: [string, Parameters<typeof marginText>][] = [
      ['its order untold, not drawn', [{ ...cover, order: { kind: 'untold' } }, phone, t]],
      ['the surface of a presented screen', [{ ...cover, presented: true }, phone, t]],
      ['the target no control', [cover, { ...phone, role: 'text' }, t]],
      ['the cover no text', [{ ...cover, node: { ...title, role: 'image' } }, phone, t]],
      ['the text with a child', [{ ...cover, node: { ...title, children: [{ ...title, children: [] }] } }, phone, t]],
      ['across both horizontal edges', [at({ x: 55, y: 1270, width: 258, height: 150 }), phone, t]],
      ['inside phone, across neither edge', [at({ x: 55, y: 1290, width: 258, height: 40 }), phone, t]],
      ['past phone\'s left edge', [at({ x: 40, y: 1406, width: 258, height: 56 }), phone, t]],
      ['3 px of phone beside it', [at({ x: 55, y: 1406, width: 967, height: 56 }), phone, t]],
    ];
    for (const [name, args] of refused) expect(marginText(...args), name).toBe(false);
  });

  it('the IME up (k7\'s launch): phone is cut by the submit bar, not covered — nothing asked', () => {
    const t = read('android-lab-form-keyboard.xml');
    const phone = byId(t, PHONE);
    const standing = sceneOf(t).standing(phone, SCREEN, { of: 'fully' });
    expect(standing.kind).not.toBe('covered');
    expect(fullyQuestion(t)).toBeUndefined();
  });

  it('the tap asks nothing: its centre is clear, so phone is reachable', () => {
    const t = afterBack();
    const phone = byId(t, PHONE);
    const standing = sceneOf(t).standing(phone, SCREEN, { of: 'tap' });
    expect(standing.kind).toBe('reachable');
    expect(pairQuestion(t, phone, standing)).toBeUndefined();
  });
});

/**
 * Every (control, cover) pair the suspicion holds of, over every Android tree the tests carry — frozen, so a widened
 * predicate shows up here. Each one checked against the truth frames (state.json): the text lies in the margin, 6–11 px
 * clear of what the field draws.
 */
describe('marginText — over every Android capture', () => {
  const trees = [
    ...readdirSync(new URL('truth/', fixtures)).filter((d) => d.startsWith('android')).flatMap((d) => readdirSync(new URL(`truth/${d}/`, fixtures)).filter((f) => f.endsWith('.xml')).map((f) => `truth/${d}/${f}`)),
    ...readdirSync(fixtures).filter((f) => f.endsWith('.xml')),
  ].sort();

  it('holds of exactly the stacked Compose form cells\' next titles and error texts', () => {
    const found: string[] = [];
    for (const path of trees) {
      let tree: UiNode;
      try {
        tree = read(path);
      } catch {
        continue;
      }
      const order = sceneOf(tree).order;
      const box = { x: 0, y: 0, width: tree.rect.width || 1080, height: tree.rect.height || 2220 };
      for (const target of everyNode(tree)) {
        if (!isInteractive(target) || !(target.rect.width > 0 && target.rect.height > 0)) continue;
        for (const cover of order.exposure(target, box).covers) {
          if (marginText(cover, target, tree)) found.push(`${path.replace(/^truth\/android-averi_lab-api33\//, '')} ${target.identifier ?? target.label}@${target.rect.y} <- ${cover.node.identifier ?? cover.node.label}@${cover.node.rect.y}`);
        }
      }
    }
    expect(found).toEqual(MARGIN_TEXTS);
  });
});

/** `<capture> <control>@<its y> <- <text>@<its y>`: 78 pairs in 11 trees, the form cells' fields under their next title or error text. */
const MARGIN_TEXTS: readonly string[] = [
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.reference@370 <- lab.form-keyboard.message.title@496',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.message@552 <- lab.form-keyboard.street.title@678',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.street@734 <- lab.form-keyboard.city.title@860',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.city@916 <- lab.form-keyboard.postcode.title@1042',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.postcode@1098 <- lab.form-keyboard.phone.title@1224',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.phone@1280 <- lab.form-keyboard.vs.title@1406',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.vs@1462 <- lab.form-keyboard.ks.title@1588',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.ks@1644 <- lab.form-keyboard.ss.title@1770',
  'android-lab-form-keyboard-after-back.xml lab.form-keyboard.ss@1826 <- lab.form-keyboard.note.title@1952',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.reference@203 <- lab.form-keyboard.message.title@329',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.message@385 <- lab.form-keyboard.street.title@511',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.street@567 <- lab.form-keyboard.city.title@693',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.city@749 <- lab.form-keyboard.postcode.title@875',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.postcode@931 <- lab.form-keyboard.phone.title@1057',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.vs@1370 <- lab.form-keyboard.ks.title@1421',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.ks@1477 <- lab.form-keyboard.ss.title@1603',
  'android-lab-form-keyboard-k7-stop.xml lab.form-keyboard.ss@1659 <- lab.form-keyboard.note.title@1785',
  'android-lab-form-keyboard.xml lab.form-keyboard.reference@370 <- lab.form-keyboard.message.title@496',
  'android-lab-form-keyboard.xml lab.form-keyboard.message@552 <- lab.form-keyboard.street.title@678',
  'android-lab-form-keyboard.xml lab.form-keyboard.street@734 <- lab.form-keyboard.city.title@860',
  'android-lab-form-keyboard.xml lab.form-keyboard.city@916 <- lab.form-keyboard.postcode.title@1042',
  'android-lab-form-keyboard.xml lab.form-keyboard.postcode@1098 <- lab.form-keyboard.phone.title@1224',
  'android-lab-form-keyboard.xml lab.form-keyboard.phone@1370 <- lab.form-keyboard.vs.title@1406',
  'android-lab-form-keyboard.xml lab.form-keyboard.vs@1462 <- lab.form-keyboard.ks.title@1588',
  'android-lab-form-keyboard.xml lab.form-keyboard.ks@1644 <- lab.form-keyboard.ss.title@1770',
  'android-lab-form-keyboard.xml lab.form-keyboard.ss@1826 <- lab.form-keyboard.note.title@1952',
  'form-basic.xml lab.form-basic.name@370 <- lab.form-basic.email.title@496',
  'form-basic.xml lab.form-basic.email@552 <- lab.form-basic.iban.title@678',
  'form-basic.xml lab.form-basic.iban@734 <- lab.form-basic.amount.title@860',
  'form-basic.xml lab.form-basic.amount@916 <- lab.form-basic.pin.title@1042',
  'form-errors.xml lab.form-errors.name@370 <- lab.form-errors.name@491',
  'form-errors.xml lab.form-errors.email@624 <- lab.form-errors.email_error@745',
  'form-errors.xml lab.form-errors.amount@878 <- lab.form-errors.amount@999',
  'form-errors.xml lab.form-errors.pin@1132 <- lab.form-errors.pin-error@1253',
  'form-errors.xml lab.form-errors.iban@1386 <- IbanError@1507',
  'form-format.xml lab.form-format.iban@370 <- lab.form-format.amount.title@496',
  'form-format.xml lab.form-format.amount@552 <- lab.form-format.ibanShown.title@678',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.reference@370 <- lab.form-keyboard-floating.message.title@496',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.message@552 <- lab.form-keyboard-floating.street.title@678',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.street@734 <- lab.form-keyboard-floating.city.title@860',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.city@916 <- lab.form-keyboard-floating.postcode.title@1042',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.postcode@1098 <- lab.form-keyboard-floating.phone.title@1224',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.phone@1280 <- lab.form-keyboard-floating.vs.title@1406',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.vs@1462 <- lab.form-keyboard-floating.ks.title@1588',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.ks@1644 <- lab.form-keyboard-floating.ss.title@1770',
  'form-keyboard-floating.after-back.xml lab.form-keyboard-floating.ss@1826 <- lab.form-keyboard-floating.note.title@1952',
  'form-keyboard-floating.xml lab.form-keyboard-floating.reference@370 <- lab.form-keyboard-floating.message.title@496',
  'form-keyboard-floating.xml lab.form-keyboard-floating.message@552 <- lab.form-keyboard-floating.street.title@678',
  'form-keyboard-floating.xml lab.form-keyboard-floating.street@734 <- lab.form-keyboard-floating.city.title@860',
  'form-keyboard-floating.xml lab.form-keyboard-floating.city@916 <- lab.form-keyboard-floating.postcode.title@1042',
  'form-keyboard-floating.xml lab.form-keyboard-floating.postcode@1098 <- lab.form-keyboard-floating.phone.title@1224',
  'form-keyboard-floating.xml lab.form-keyboard-floating.phone@1280 <- lab.form-keyboard-floating.vs.title@1406',
  'form-keyboard-floating.xml lab.form-keyboard-floating.vs@1462 <- lab.form-keyboard-floating.ks.title@1588',
  'form-keyboard-floating.xml lab.form-keyboard-floating.ks@1644 <- lab.form-keyboard-floating.ss.title@1770',
  'form-keyboard.after-back.xml lab.form-keyboard.reference@370 <- lab.form-keyboard.message.title@496',
  'form-keyboard.after-back.xml lab.form-keyboard.message@552 <- lab.form-keyboard.street.title@678',
  'form-keyboard.after-back.xml lab.form-keyboard.street@734 <- lab.form-keyboard.city.title@860',
  'form-keyboard.after-back.xml lab.form-keyboard.city@916 <- lab.form-keyboard.postcode.title@1042',
  'form-keyboard.after-back.xml lab.form-keyboard.postcode@1098 <- lab.form-keyboard.phone.title@1224',
  'form-keyboard.after-back.xml lab.form-keyboard.phone@1280 <- lab.form-keyboard.vs.title@1406',
  'form-keyboard.after-back.xml lab.form-keyboard.vs@1462 <- lab.form-keyboard.ks.title@1588',
  'form-keyboard.after-back.xml lab.form-keyboard.ks@1644 <- lab.form-keyboard.ss.title@1770',
  'form-keyboard.after-back.xml lab.form-keyboard.ss@1826 <- lab.form-keyboard.note.title@1952',
  'form-keyboard.xml lab.form-keyboard.reference@370 <- lab.form-keyboard.message.title@496',
  'form-keyboard.xml lab.form-keyboard.message@552 <- lab.form-keyboard.street.title@678',
  'form-keyboard.xml lab.form-keyboard.street@734 <- lab.form-keyboard.city.title@860',
  'form-keyboard.xml lab.form-keyboard.city@916 <- lab.form-keyboard.postcode.title@1042',
  'form-keyboard.xml lab.form-keyboard.postcode@1098 <- lab.form-keyboard.phone.title@1224',
  'form-keyboard.xml lab.form-keyboard.phone@1370 <- lab.form-keyboard.vs.title@1406',
  'form-keyboard.xml lab.form-keyboard.vs@1462 <- lab.form-keyboard.ks.title@1588',
  'form-keyboard.xml lab.form-keyboard.ks@1644 <- lab.form-keyboard.ss.title@1770',
  'form-keyboard.xml lab.form-keyboard.ss@1826 <- lab.form-keyboard.note.title@1952',
  'form-prefilled.xml lab.form-prefilled.name@370 <- lab.form-prefilled.email.title@496',
  'form-prefilled.xml lab.form-prefilled.email@552 <- lab.form-prefilled.iban.title@678',
  'form-prefilled.xml lab.form-prefilled.iban@734 <- lab.form-prefilled.amount.title@860',
  'form-prefilled.xml lab.form-prefilled.amount@916 <- lab.form-prefilled.pin.title@1042',
  'form-shared-id.xml lab.form-shared-id.component@326 <- lab.form-shared-id.component@452',
  'form-shared-id.xml lab.form-shared-id.component@464 <- lab.form-shared-id.component@590',
  'form-shared-id.xml lab.form-shared-id.component@602 <- lab.form-shared-id.component@728',
  'form-shared-id.xml lab.form-shared-id.component@740 <- lab.form-shared-id.component@866',
];

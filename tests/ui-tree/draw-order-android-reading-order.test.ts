import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf } from '../../src/ui-tree/seen-order.js';
import { tagged } from '../helpers/covers.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * Guards of the location mark (adapters/android-accessibility-order.ts, lab note LR4): a form's own parts — the title
 * above its field, the error text whose top lies a few pixels inside the field's bottom — stay clear of each other
 * where the run is marked `readingOrder`, as where it is not. A sibling listed before a target that draws there covers
 * it only where a peer holds its centre (reading-order.ts#peersOf).
 */
const PHONE = { x: 0, y: 0, width: 1080, height: 2220 };
const byLabel = (t: UiNode, label: string): UiNode => [...everyNode(t)].find((n) => n.label === label)!;
const byClass = (t: UiNode, role: string): UiNode => [...everyNode(t)].find((n) => n.role === role)!;

/**
 * A classic-Views twin of the lab's form-errors name field (SYNTHETIC, its geometry the capture's: title `55,314`,
 * EditText `55,370 970x132`, error `55,491`, 11 px inside the field's bottom), in AOSP's location order (title,
 * field, error: one left edge, the higher top first) — so marked.
 */
const VIEWS_FORM = `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.LinearLayout" resource-id="app:id/form" bounds="[0,220][1080,2220]">
      <node class="android.widget.TextView" text="Recipient’s name" bounds="[55,314][508,370]"/>
      <node class="android.widget.EditText" text="" resource-id="app:id/name" bounds="[55,370][1025,502]"/>
      <node class="android.widget.TextView" text="Enter the recipient’s name" bounds="[55,491][495,557]"/>
    </node>
  </node>
</hierarchy>`;

describe('a classic-Views form in location order: its title and its error text stay clear of the field', () => {
  const t = parseDump(VIEWS_FORM);

  it('the run is marked', () => {
    expect([...everyNode(t)].find((n) => n.identifier === 'form')!.readingOrder).toBe(true);
  });

  it('the error text, its top 11 px inside the field listed before it (the field not over its centre): no cover', () => {
    expect(drawOrder(t).exposure(byLabel(t, 'Enter the recipient’s name'), PHONE).covers).toEqual([]);
  });

  it('the title above the field: no cover', () => {
    expect(drawOrder(t).exposure(byLabel(t, 'Recipient’s name'), PHONE).covers).toEqual([]);
  });

  it('the field: tapped at its centre, not moved', () => {
    expect(drawOrder(t).exposure(byClass(t, 'textfield'), PHONE).tapAt).toEqual({ point: { x: 540, y: 436 }, moved: false });
  });
});

describe('the lab\'s form-errors (Compose, unmarked): its titles and error texts stay clear', () => {
  it.each(['Recipient’s name & surname', 'Enter the recipient’s name', 'That’s not an e-mail – check the “@”', 'PIN must have 4 digits…'])('%s: no cover', async (label) => {
    const t = parseDump(await readFile(new URL('../fixtures/truth/android-averi_lab-api33/form-errors.xml', import.meta.url), 'utf8'));
    expect(drawOrder(t).exposure(byLabel(t, label), PHONE).covers).toEqual([]);
  });
});

describe('the lab\'s form-shared-id (Compose, in location order by chance, unmarked): each outlined field\'s label, listed after the field and drawn over its outline, stays clear', () => {
  it.each(['Value*', 'IBAN*', 'BIC*', 'Payee’s bank name*', 'Payee’s name'])('%s: no cover — read as drawn over its field, as Compose lists it', async (label) => {
    const t = parseDump(await readFile(new URL('../fixtures/truth/android-averi_lab-api33/form-shared-id.xml', import.meta.url), 'utf8'));
    expect(drawOrder(t).exposure(byLabel(t, label), PHONE).covers).toEqual([]);
  });
});

/**
 * The review's MAJOR 1 (D75 round 1): marking is not monotone-cautious. A control listed AFTER the target in a classic
 * run, over its centre, was a cover by the draw order (`drawn`: the tap refused); in a marked run it is a peer whose
 * order is untold — still a cover with no screenshot, but LIFTED when the eyes see the target on top (ADR 0024's
 * judgement, now on Android frames). Unmeasured live in that direction (ADR 0015's D75 residual; backlog D77).
 */
describe('a later-listed control over the target\'s centre in a classic run: drawn unmarked, untold marked, lifted by the eyes', () => {
  const OVERLAP = `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.Button" text="A" resource-id="app:id/a" bounds="[40,1000][540,1200]"/>
    <node class="android.widget.Button" text="B" resource-id="app:id/b" bounds="[200,1050][900,1150]"/>
  </node>
</hierarchy>`;
  const at = (t: UiNode) => [byLabel(t, 'A'), byLabel(t, 'B')] as const;

  it('before D75 (the run unmarked): B, listed later, is drawn over A — the tap refused', () => {
    const t = parseDump(OVERLAP);
    for (const n of everyNode(t)) delete n.readingOrder;
    const [a, b] = at(t);
    expect(tagged(drawOrder(t).exposure(a, PHONE).covers)).toEqual([{ node: b, order: 'drawn', presented: false }]);
  });

  it('marked (A left 40 before B left 200, one stripe), no screenshot: B is a cover whose order is untold — still refused', () => {
    const t = parseDump(OVERLAP);
    expect(t.readingOrder).toBe(true);
    const [a, b] = at(t);
    expect(tagged(drawOrder(t).exposure(a, PHONE).covers)).toEqual([{ node: b, order: 'untold', presented: false }]);
  });

  it('marked, the eyes seeing A over B: no cover — A is tapped at its centre', () => {
    const t = parseDump(OVERLAP);
    const [a, b] = at(t);
    const seen = seenOrderOf(a, [{ peer: b, seen: 'over', overlap: '#1E88E5', own: '#1E88E5', other: '#E53935' }]);
    const exposure = drawOrder(t, seen).exposure(a, PHONE);
    expect(exposure.covers).toEqual([]);
    expect(exposure.tapAt).toEqual({ point: { x: 290, y: 1100 }, moved: false });
  });
});

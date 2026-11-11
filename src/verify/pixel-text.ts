import type { Rect, UiNode } from '../adapters/types.js';
import { coverText, nodeText, rectText } from '../ui-tree/geometry.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { coverClause } from '../ui-tree/cover.js';
import { noScrollRemedyText, presentedOr, presentedRemedy } from '../ui-tree/remedy-text.js';
import { outsideItsScrollView, type PixelStanding, type Remedy } from '../ui-tree/standing.js';
import { systemBarName } from '../ui-tree/system-bar.js';

/**
 * THE PIXEL VERB'S WORDS (A26, VR1): every sentence the pixel assert (the color and ocr asserts' poll,
 * pixel-poll.ts) says of what lies over its element — the soft keyboard (`keyboardOver`), and each kind of a
 * standing not reachable with its remedy (`pixelMissText`) — rendered here, from facts the poll judged; pixel-poll.ts
 * judges and words nothing. The remedy's case and its precedence are ui-tree/standing.ts#Remedy's; the clauses every
 * verb quotes are ui-tree/remedy-text.ts's (a presented screen's, `presentedOr`; a no-scroll cover's). A leaf: it
 * imports no verify/ module, so a sentence is pinned without a capture.
 */

/**
 * The soft keyboard covers the element: the miss's reason,
 * quoting both rects — never a measurement, what would be sampled is the
 * keyboard. The remedy, when the adapter has a `back` (`dismissal:
 * 'back'`, the oracle's window model), names the fill option
 * (`dismissKeyboard`, flow/config.ts) and `back` — not "tap a field above",
 * which keeps the keyboard up. When it has none (`'none'`, the in-tree
 * model) it names the flow's two ways:
 * a `tap:` step the AUTHOR adds on an element that hides the keyboard
 * (such as the screen title — not "the one configured for the guard":
 * under idb no guard acts, and under WDA configuring it is not enough here
 * either: the guard taps it only before a covered tap, and before an
 * assert nothing does; where it is configured, if anywhere, is the
 * adapter's `advice`, which says so per tree source), or `dismissKeyboard: true` on a fill that
 * LEAVES it up. Not the fill option alone: it taps only on a band read
 * right after the fill, and HID typing usually parks the keyboard (no
 * band, a no-op, measured on device), while a
 * covered miss here means a tap or an autofocus raised it, with or
 * without a fill before. Flow facts, not platform ones; the sentence is
 * this module's, not the guard's (whose refusal can offer its own tap and
 * a re-layout, and names no fill option). It then adds `cannotHide`
 * (ui-tree/soft-keyboard.ts): the one phrase the guard uses too, then the
 * adapter's sentence on why and where that dismissal is configured
 * (`advice`, `DeviceAdapter.keyboardAdvice`) — no platform fact of this
 * module's. Both come as the reading's `KeyboardRemedy`
 * (ui-tree/soft-keyboard.ts). The sentence's head is `keyboardCovers`, its
 * advice `hideKeyboard`.
 */
export const keyboardOver = (rect: Rect, keyboard: Rect, remedy: KeyboardRemedy): string => `${keyboardCovers(rect, keyboard)} — ${hideKeyboard(remedy)}`;

/** The head of every miss under the soft keyboard, quoting both rects (`keyboardOver`; idb's band, `pixelMissText`). */
const keyboardCovers = (rect: Rect, keyboard: Rect): string => `the soft keyboard covers the element (element ${rectText(rect)}, keyboard ${rectText(keyboard)})`;

/** How to hide the keyboard over the element, by the adapter's dismissal (`keyboardOver`'s doc). */
const hideKeyboard = ({ dismissal, advice }: KeyboardRemedy): string =>
  dismissal === 'back'
    ? 'dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run'
    : 'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the screen title, ' +
      `before this assert, or \`dismissKeyboard: true\` on a fill that leaves it up); ${cannotHide(advice)}`;

/**
 * The miss for an element whose pixel standing is not `reachable`, worded per kind (ui-tree/standing.ts#PixelStanding,
 * judged by pixel-poll.ts#judgeOver) — `keyboard`, the reading's remedy to word idb's band with.
 *
 * The sentence names what lies over it: `the status bar …` or `the
 * navigation bar …` with the band's rect; the cover's role, label, rect
 * and — for a pinned bar — its reach (`covered.reach`, when not its
 * frame); or, at the navigation bar's top edge, that it may be cut there
 * (`cut`: the ocr crop would read only what shows — scroll it up). Or that
 * nothing of it lies on the screen, or nothing of it is drawn there — it lies
 * outside the scroll view named (`OUTSIDE_ITS_SCROLL_VIEW`) — or only a
 * sliver too thin to measure, at the screen's edge or the scroll view's.
 *
 * The remedy after " — " is the standing's (ui-tree/standing.ts#Remedy:
 * the case and its precedence are decided there, once for the tap,
 * `scroll_until`'s stop and this assert), worded here (`coverRemedy`).
 * `scroll_until … fully: true` (`scroll`); it adds "assert something in it
 * that lies clear of that" when a scroll may not cure it (`pinned`,
 * `stuck`): the element lies in no scroll view as far as the tree says
 * (`Clips.inScroller` false — or undefined: idb's flat list has no
 * ancestry, so EVERY idb miss carries the clause), it is laid from the
 * screen's top edge under the status bar, or the cover holds the element
 * whole. Not for an element reaching the screen's bottom under the
 * navigation bar (ADR 0011). Where no scroll moves it out (`fixed`) the
 * remedy leads with the child: under a system bar, content no scroll lifts
 * out of the band (in no scroll view, or screen-sized scroll content taller
 * than the room between the bars) — the screen ITSELF (screen-sized); a
 * full-bleed header — iOS's, or Android 15+'s edge-to-edge app bar
 * (`0,0 1080x220` under the 66-px band fails a colour assert closed, ADR
 * 0001) — with "assert something in it that lies clear of that (its
 * title, say)": the title, below the band, is judged on its own and
 * passes; a full-bleed footer (a bottom sheet) with "(its content above
 * the bar, say)". The same shapes in a scroll view get the scroll advice:
 * `scroll_until … fully: true` lifts them. Under a COVER, a screen-sized
 * element or a full-bleed header keeps that advice wherever it lies. For idb's
 * flat-list root (`covered.overRoot`: its Application node, screen-sized,
 * and never a full-bleed header in a flat list) it says the node named is
 * content drawn over the root's background.
 *
 * Beneath a screen PRESENTED over the element (a modal's dim, a sheet — ADR 0018), first of every case: no scroll
 * moves it out from under that screen, and the remedy is `presentedRemedy('the element')` in place of every other,
 * whatever lies over it — a cover, a system bar, the navigation bar's cut, idb's keyboard band — the sentence still
 * naming what is drawn over the element, and only the advice after " — " the presented screen's.
 * docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 * docs/adr/0011-no-stuck-clause-at-the-bottom-edge.md
 * docs/adr/0012-pixel-assert-residuals-d4-d6.md
 */
export function pixelMissText(standing: Exclude<PixelStanding, { readonly kind: 'reachable' }>, element: UiNode, keyboard: KeyboardRemedy): string {
  const at = `(element ${rectText(element.rect)}`;
  switch (standing.kind) {
    case 'offScreen': {
      if (outsideItsScrollView(standing)) {
        // On the screen, but outside what its scroll view draws: what lies there is not the element.
        const view = nodeText(standing.scroller);
        const where = standing.sliver === undefined ? `${OUTSIDE_ITS_SCROLL_VIEW} ${view} ${at}` : `${TOO_THIN_IN_ITS_SCROLL_VIEW} ${view} ${at}, drawn ${rectText(standing.sliver)}`;
        return `${where}, screen ${rectText(standing.box)}) — ${presentedOr(standing.remedy, 'the element', () => 'scroll it into view: scroll_until the element first and re-run')}`;
      }
      const where = standing.sliver === undefined ? `${OFF_THE_SCREEN} ${at}` : `${TOO_THIN_ON_THE_SCREEN} ${at}, on the screen ${rectText(standing.sliver)}`;
      return `${where}, screen ${rectText(standing.box)}) — ${presentedOr(standing.remedy, 'the element', () => 'scroll it on-screen: scroll_until the element first and re-run')}`;
    }
    case 'underKeyboard':
      // Its presented remedy is unreachable while idb's band is found only in a flat list, which holds no presented
      // screen (ui-tree/presentation.ts#presentedOver, the shape adapter's: the holder is the root); the type still lets this kind
      // carry it, and the agreement rows (tests/interact/remedy-agreement.test.ts) pin its rendering.
      return `${keyboardCovers(element.rect, standing.band)} — ${presentedOr(standing.remedy, 'the element', () => hideKeyboard(keyboard))}`;
    case 'systemBar': {
      const bar = systemBarName(standing.bar.edge);
      return `the ${bar} is drawn over the element ${at}, ${bar} ${rectText(standing.band)}) — ${coverRemedy(standing.remedy)}`;
    }
    case 'cut': {
      const cut = `the element may be cut at the navigation bar ${at}, navigation bar from y ${standing.bar.top}): it ends on the bar's top edge, as its scroll container ${rectText(standing.container)} does, so the crop may read only what shows of it`;
      return `${cut} — ${presentedOr(standing.remedy, 'the element', () => 'scroll it up: scroll_until the element with `fully: true` first and re-run')}`;
    }
    case 'covered': {
      // The cover as the tree orders it against the element: drawn over it, its order untold or seen by a screenshot, or
      // the node at its overlaid edge (ui-tree/cover.ts#coverClause, the one choice of its words, in the pixel grammar).
      return `${coverText(standing.cover.node, standing.cover.reach)} ${coverClause(standing.cover, { of: 'pixel', at: `${at})` })} — ${coverRemedy(standing.remedy)}`;
    }
    default: {
      // Exhaustive by type: a kind left unworded must not read as "nothing over it" (that would measure the cover).
      const unworded: never = standing;
      throw new Error(`pixel assert: a standing ${(unworded as { kind: string }).kind} with no sentence`);
    }
  }
}

/**
 * The head of the miss for an element NOTHING of which — of what the assert reads — lies on the screen judged
 * (ui-tree/standing.ts's pixel `offScreen`: below the fold, above the screen's top, past a side): no capture shows any
 * of it. Its remedy is the standing's: beneath a presented screen, close it first (ui-tree/remedy-text.ts#presentedRemedy, of "the element"); else
 * scroll it on-screen. The one sentence head the full tool reference (skill/references/tools.md, `assert`) and the
 * troubleshooting reference quote.
 */
export const OFF_THE_SCREEN = 'nothing of the element lies on the screen';

/**
 * The head of the same miss when the screen's edge leaves only a sliver of the element no thicker than the pixel
 * slack (ui-tree/standing.ts#thinSliver): the sliver is quoted, and its remedy is the off-screen one. The one sentence
 * head the full tool reference and the troubleshooting reference quote for it.
 */
export const TOO_THIN_ON_THE_SCREEN = 'only a sliver of the element lies on the screen, too thin to measure';

/**
 * The head of the miss for an element on the screen NOTHING of which is drawn there: it lies outside the scroll view
 * it is listed in, which draws none of it (ui-tree/standing.ts's pixel `offScreen` with its `scroller`, the drawn
 * frame — a WDA tree's): what the capture shows there is not the element. The words end as
 * ui-tree/geometry.ts#outsideScrollViewText's begin, the tap's and `scroll_until`'s. Measured: the at-rest SWIFT form's
 * `payee_street_input` `24,869 354x52`, 5 pt of it on the screen below its form's `0,0 402x780`, passed a colour assert
 * on the bare background. A sentence names the scroll view after these words; its remedy is the off-screen one. The
 * one sentence head the full tool reference and the troubleshooting reference quote.
 */
export const OUTSIDE_ITS_SCROLL_VIEW = 'nothing of the element is drawn: it lies outside its scroll view';

/**
 * The head of the same miss when the scroll view's edge leaves only a sliver of the element drawn, no thicker than the
 * pixel slack (ui-tree/standing.ts#thinSliver, at the scroll view's edge as at the screen's): the drawn sliver is
 * quoted. The one sentence head the full tool reference and the troubleshooting reference quote.
 */
export const TOO_THIN_IN_ITS_SCROLL_VIEW = 'only a sliver of the element is drawn, too thin to measure: the rest lies outside its scroll view';

/**
 * What to do about a pixel assert's element under chrome (`judgeOver`) — its standing's remedy
 * (ui-tree/standing.ts#Remedy, which decides the case and its precedence), in this verb's words: `scroll` — scroll it
 * clear; `pinned` and `stuck` — that, or, when a scroll may not cure it, assert something in it that lies clear (in
 * no scroll view, or where the tree cannot say, or laid from the screen's top edge, or held whole by the cover's
 * reach: one sentence for all, which never promises the scroll away); `fixed` — no scroll moves it, so the advice
 * LEADS with the child, then says why: the element is the screen itself (`screen`, screen-sized); laid from the
 * screen's top edge at full width (`header`, a full-bleed header, whose title, clear of the band, is what to assert);
 * a full-width surface laid to the screen's bottom edge (`footer`, a bottom sheet, whose content above the bar is what
 * to assert); idb's flat-list root (`root`), whose cover is the app's own content laid on its background; `bothPinned`
 * — neither the element nor its cover lies in a scroll view (D87): something of it clear of the cover;
 * `presented` — a screen is presented over the element, which no scroll moves it out from under: close that screen
 * first. `keyboard` is never worded here: a standing under a bar or a cover cannot carry it (`CoverRemedy`).
 * docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 */
const coverRemedy = (remedy: CoverRemedy): string => {
  const scroll = 'the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run';
  switch (remedy.of) {
    case 'presented':
      return `the capture would show it, not the element; ${presentedRemedy('the element', remedy.layer)}`;
    case 'fixed':
      return FIXED_REMEDY[remedy.what];
    case 'pinned':
    case 'stuck':
      return `${scroll} — or, if no scroll moves it out from under that, ${CLEAR_CHILD}`;
    case 'scroll':
      return scroll;
    case 'unordered':
    case 'seenOver':
    case 'bothPinned':
      // The order untold, the capture MAY show it; seen over, or no scroll moving either, it WOULD.
      return `the capture ${remedy.of === 'unordered' ? 'may' : 'would'} show it, not the element; ${noScrollRemedyText(remedy, 'pixel')}`;
  }
};

/** The remedies of an element under a system bar or a cover — what `coverRemedy` words: every case but `keyboard`. */
type CoverRemedy = Extract<PixelStanding, { readonly kind: 'systemBar' | 'covered' }>['remedy'];

/** The child to assert instead, when a scroll may not cure the element (`coverRemedy`). */
const CLEAR_CHILD = 'assert something in it that lies clear of that';

/** `coverRemedy`'s `fixed` sentences: the advice leads with the child, then says why no scroll moves it. */
const FIXED_REMEDY: Record<Extract<Remedy, { of: 'fixed' }>['what'], string> = {
  root: `that is content drawn over the root's background, which the capture would show, not the root; no scroll moves it — ${CLEAR_CHILD}`,
  screen: `the capture would show it, not the element — ${CLEAR_CHILD}; no scroll moves the screen itself out from under it`,
  header: `the capture would show it, not the element — ${CLEAR_CHILD} (its title, say); no scroll moves an element laid from the screen's top edge out from under it`,
  footer: `the capture would show it, not the element — ${CLEAR_CHILD} (its content above the bar, say); no scroll moves an element laid to the screen's bottom edge out from under it`,
};

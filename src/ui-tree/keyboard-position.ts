import type { UiNode } from '../adapters/types.js';
import type { DrawOrder } from './draw-order.js';
import type { KeyboardCover, KeyboardReading } from './keyboard-cover.js';

/**
 * WHERE the soft keyboard lies on one look — the POSITION half of the
 * keyboard (the state half, shown, hidden, covering a point, is the
 * reading's: keyboard-cover.ts#readKeyboard, which stays outside standing,
 * ADR 0010). A position is the line nothing may be aimed, stroked or
 * measured under, and the nodes that are the keyboard's own UI, under no
 * line. One `KeyboardPosition` per look — a tree read and the reading built
 * off it — built from that tree's draw order (idb's band, free) and that
 * look's reading (its line, asked lazily); every reader asks it, and none
 * composes the line itself:
 * - the tap (interact/resolve.ts: the on-screen rule with the tree's own
 *   line, the chrome aim with the reading's merged in, only when its
 *   centre is covered) and the dismissal picker (interact/keyboard-in-tree.ts
 *   #pickDismissal, the same merged line);
 * - `scroll_until`'s read (interact/scroll-read.ts#judgeRead: idb's band as
 *   a cover, the keyboard's own UI judged against the whole screen; and
 *   #strokeLine, the line its strokes stay above);
 * - the pixel poll (verify/pixel-poll.ts#overElement: idb's band as a
 *   keyboard line of the element's standing).
 * Here, in ui-tree/, for the reason the reading is: the pixel poll
 * (verify/) reads it too and may not import interact/.
 *
 * The sources, each read in ONE place, here: a reading's line
 * (`readingLine`: the cover a corroborated reading offers — the Android
 * window model's band or floating panel, WDA's marked band — `coverLine`)
 * and idb's band (`DrawOrder.keyboardBandTop` and `ofKeyboardBand`, whose
 * one reader this module is — draw order's own computation). A source that
 * one day gives a position the reading does not changes this module and its
 * table test, not the verbs.
 *
 * RESIDUAL — what the keyboard's own UI is exempt from differs per verb,
 * and is kept as it is (owner decision OD-3 of Spec D; unifying it changes
 * behaviour in cases no device has measured):
 * - the tap and the picker: a WDA key (`KeyboardReading.ofKeyboard`) is
 *   exempt from the reading's own questions (`over`/`frameOver` read
 *   `unknown`; the picker skips it as "the keyboard's own control"), NOT
 *   from the merged line — `line`'s `subject` exempts only a node of idb's
 *   band from idb's band line;
 * - `scroll_until`'s read: a node `owns` answers for — WDA's marks or
 *   idb's band — is judged against the whole screen, under no cover at all;
 * - the pixel poll: the reading's `overlapping(rect, subject)` exempts a WDA
 *   key, and `line`'s `subject` a node of idb's band.
 * So `owns`, the union, is asked by the scroll read alone.
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */

/**
 * A soft keyboard's top edge as a LINE nothing may be aimed or stroked
 * under. `witnessed`: a reading stands by it, so the tap's guard acts on a
 * point under it (interact/keyboard.ts) — the Android window model's cover
 * (the inset band, or a floating panel above it), the input method standing
 * by it, or the band WDA marks in the tree (`KEYBOARD_ROLE`), read off the
 * very tree being judged; false for idb's band, read by its shape
 * (draw-order.ts#DrawOrder.keyboardBandTop), a position and nothing more: no
 * reading says the keyboard is shown (`keyboardInTree` stays `unknown`, K5d),
 * and no guard acts on it — a centre under it is the judgement's to refuse
 * (ui-tree/standing.ts#Scene). No adapter is named: `witnessed` is the one
 * fact every judgement reads.
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */
export type KeyboardLine = { readonly y: number; readonly witnessed: boolean };

/** Where the soft keyboard lies on one look: the tree's own band (idb's, from draw order, free) and the look's reading. */
export interface KeyboardPosition {
  /**
   * THE merge — the one merge of every keyboard source into the line the
   * tap, `scroll_until` and the pixel assert judge and stroke against: a
   * reading's line (`reading`: `readingLine`'s, or the cover
   * `scroll_until`'s round applied) and idb's band line, the higher of the
   * two. Never both today — idb's reading is always `unknown`, and only
   * idb's flat list has a band — kept for a source that one day gives both.
   * `subject`, when given: a node of idb's band itself (a key, the band's
   * background) is under no band line — a tap on a key is the thing the
   * user does; a WDA key is under the reading's line all the same (the
   * module doc's residual).
   */
  line(subject?: UiNode, reading?: KeyboardLine): KeyboardLine | undefined;
  /**
   * The reading's line: its cover's (`coverLine`) once the reading is
   * `corroborated`, else none. Costs what `cover` and `corroborated` cost
   * (keyboard-cover.ts's module doc), asked of the reading on the first call
   * and never again for this position; none, asking nothing, for a position
   * built without a reading that can be asked (the scroll read's, whose
   * round asks the same two through its own protocol — interact/scroll-read.ts
   * #Cover — the stroke's and the pixel poll's).
   */
  readingLine(): Promise<KeyboardLine | undefined>;
  /**
   * Is `node` the keyboard's OWN UI, under no keyboard line: the reading's
   * (`KeyboardReading.ofKeyboard`, WDA's marks) or idb's band's
   * (draw-order.ts#DrawOrder.ofKeyboardBand: its background, the keys that
   * share a row, what is listed after the background). Asked by the scroll
   * read only (the module doc's residual).
   */
  owns(node: UiNode): boolean;
}

/**
 * The line a shown cover stands for, once its witness has stood by it: the
 * top of everything it covers (`KeyboardCover.top`, a floating panel above
 * the band included), witnessed — whichever model read it, so no remedy is
 * read. Synchronous and asks nothing: whether the witness stands
 * by the cover is the caller's question, put before this one —
 * `KeyboardPosition.readingLine` asks it of the reading, `scroll_until`'s
 * round through its protocol (interact/scroll-read.ts#coverOf).
 */
export function coverLine(cover: KeyboardCover): KeyboardLine {
  return { y: cover.top.y, witnessed: true };
}

/** The higher of two lines (the smaller y), either of which may be absent; a tie keeps `a`. */
const higher = (a: KeyboardLine | undefined, b: KeyboardLine | undefined): KeyboardLine | undefined => (a === undefined ? b : b === undefined || a.y <= b.y ? a : b);

/**
 * The keyboard's position on one look: `order`, the look's draw order (its
 * scene's), and `reading`, the look's reading — its `ofKeyboard` for `owns`,
 * its `cover` and `corroborated` for `readingLine`. Without a reading, or
 * with one that gives only `ofKeyboard`, the reading's line is none and
 * nothing is asked. Synchronous and asks nothing until a member is asked.
 */
export function keyboardPosition(
  order: Pick<DrawOrder, 'keyboardBandTop' | 'ofKeyboardBand'>,
  reading?: Pick<KeyboardReading, 'ofKeyboard'> & Partial<Pick<KeyboardReading, 'cover' | 'corroborated'>>,
): KeyboardPosition {
  let asked: Promise<KeyboardLine | undefined> | undefined;
  const ask = async (): Promise<KeyboardLine | undefined> => {
    if (reading?.cover === undefined || reading.corroborated === undefined) return undefined;
    const cover = await reading.cover();
    if (cover === undefined || !(await reading.corroborated())) return undefined;
    return coverLine(cover);
  };
  return {
    line(subject, line) {
      const top = order.keyboardBandTop;
      const band: KeyboardLine | undefined = top === undefined || (subject !== undefined && order.ofKeyboardBand(subject)) ? undefined : { y: top, witnessed: false };
      return higher(line, band);
    },
    readingLine: () => (asked ??= ask()),
    owns: (node) => (reading?.ofKeyboard(node) ?? false) || order.ofKeyboardBand(node),
  };
}

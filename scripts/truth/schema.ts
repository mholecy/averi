/**
 * The lab apps' contract with the harness (docs/plans/2026-10-15-ground-truth-lab-app.md): the cell catalog both apps
 * bundle (fixtures/apps/cells.json), the state file an app writes while a cell is on screen, and the truth file the
 * capture script writes beside each capture.
 *
 * The truth has three sources, each answering one question:
 *  - DECLARED (the catalog): what the cell builds — `open`, or `presented-over` (a layer is presented over the target);
 *  - REACHED (the tap probe): whether a raw tap at the target's centre fired its action;
 *  - DRAWN (the screenshot): the fraction of the target's frame painted its own colour.
 * The frames are the app's own layout, not the tree's: a tree whose rect disagrees is itself a finding.
 */

/** What a cell builds around a target. New kinds come with the cells that need them. */
export type Declared = 'open' | 'presented-over';

export interface CatalogTarget {
  tag: string;
  /** `#RRGGBB`: the target is a solid rectangle of it, nothing else drawn on it. */
  color: string;
  slot: number;
  /** `layer`: the target lies on the cell's layer (inside the sheet), not on the screen beneath it. */
  in?: 'layer';
  declared: Declared;
}

export interface CatalogCell {
  id: string;
  /** `none`, `sheet-medium`, `alert`; a form cell's own picker sheet, `sheet-large`. */
  layer: string;
  targets: CatalogTarget[];
  /** A form cell (phase 1b): fields, a submit, maybe a picker — no coloured targets. */
  form?: CatalogForm;
}

/** `amount` a decimal pad, `pin` a secure field on a number pad, `country` a button opening the form's picker sheet. */
export type FieldKind = 'text' | 'email' | 'iban' | 'amount' | 'pin' | 'country';

/** A message the app shows, and the accessibility identifier it carries — the convention averi pairs it by. */
export interface Message {
  text: string;
  id: string;
}

export interface CatalogField {
  tag: string;
  kind: FieldKind;
  /** The text above the field. Identified as `titleId`, else `lab.<cell>.<tag>.title`. */
  title: string;
  titleId?: string;
  placeholder?: string;
  /** What a dev flavour puts in the field before the user does. */
  prefill?: string;
  /** What the field shows when a submit finds it invalid; without it, `Required` identified `lab.<cell>.<tag>_error`. */
  error?: Message;
}

export interface CatalogForm {
  /** The navigation title — a neutral element a keyboard dismissal can tap. */
  title: string;
  fields: CatalogField[];
  /** `pinned`: laid in the bottom safe-area inset, so it rides above the keyboard. */
  submit: { tag: string; title: string; pinned?: boolean };
  /** A screen-level message under the submit, shown after a failed submit, near no field. */
  screenError?: Message;
  /** Submit once on appear: the screen as the user sees it after a dirty submit. */
  submitOnAppear?: boolean;
  /** The field focused on appear (the keyboard comes up for it). */
  focus?: string;
  picker?: {
    field: string;
    title: string;
    /** Presented on appear. */
    open?: boolean;
    rows: { code: string; name: string }[];
    /** The rows the capture probes (one on screen, one far down the list). */
    probe?: string[];
  };
}

export interface Catalog {
  version: number;
  cells: CatalogCell[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the lab app writes (fixtures/apps/ios/AveriLab/Lab.swift#LabState): points, screen coordinates. */
export interface LabState {
  cell: string;
  /** The cell's layer has been presented and its animation has had time to finish. */
  ready: boolean;
  screen: Rect;
  /** Pixels per point. */
  scale: number;
  frames: Record<string, Rect>;
  /**
   * `tap` a target's action fired; `dismissed` a layer went away; `button` a layer's own button; on a form cell
   * `focus` a field took the focus (`tag` empty: none has it), `submit` the submit fired (`tag` `valid`/`invalid`),
   * `select` a picker row was chosen (`tag` its code).
   */
  events: { kind: 'tap' | 'dismissed' | 'button' | 'focus' | 'submit' | 'select'; tag: string; at: number }[];
  /** A form cell's oracle — absent on the coloured-target cells (and in their phase-1 captures). */
  fields?: Record<string, FieldState>;
  /** The field holding the focus, or null. */
  focus?: string | null;
  /** The last `keyboardWillChangeFrame`, its end frame in screen coordinates; null before any. */
  keyboard?: KeyboardState | null;
  submits?: { at: number; valid: boolean; values: Record<string, string> }[];
}

/** One field as the app's model holds it — not as any tree reports it. */
export interface FieldState {
  value: string;
  focused: boolean;
  /** The message shown under the field now, or null. */
  error: Message | null;
}

export interface KeyboardState {
  /** The keyboard's end frame (UIKeyboardFrameEndUserInfoKey), points, screen coordinates. */
  frame: Rect;
  /** Its frame lies on the screen (a hide moves it below the bottom edge). */
  visible: boolean;
  /** The field focused when it changed — the one it serves. */
  field: string | null;
}

export interface TargetTruth {
  tag: string;
  /** The selector the target answers to in every tree source: its accessibility identifier. */
  id: string;
  color: string;
  declared: Declared;
  /** The app's frame, in points. */
  frame: Rect;
  /** A raw tap at the frame's centre fired the target's action. */
  reached: boolean;
  /** What else the probe tap did (a layer dismissed, …), as the app logged it. */
  probe: string[];
  /** The fraction of the frame's pixels painted the target's own colour (pixels.ts#OWN_COLOUR_TOLERANCE). */
  drawn: number;
  /** The colour most of the frame shows in the screenshot, `#RRGGBB` — what the user sees there. */
  seen: string;
}

export interface CellTruth {
  cell: string;
  layer: string;
  device: string;
  screen: { width: number; height: number };
  scale: number;
  targets: TargetTruth[];
  /** A form cell's truth (its `targets` empty). */
  form?: FormTruth;
}

/**
 * Where a form control is, measured from the app's frames (capture.ts#situationOf), not declared: `open` its centre
 * on the screen, clear of the keyboard and of the pinned bar; `under-keyboard` all of it below the keyboard's top;
 * `covered` its centre under the pinned submit bar, or straddling the keyboard's top (judged by no row); `presented-over`
 * under the picker sheet; `off-screen` its centre below the screen; `not-rendered` the app laid out no frame for it
 * (a lazy list's row far down).
 */
export type Situation = 'open' | 'under-keyboard' | 'covered' | 'presented-over' | 'off-screen' | 'not-rendered';

/** Something on a form a tap can be asked of: a field, the submit, a picker row. */
export interface ControlTruth {
  tag: string;
  id: string;
  kind: 'field' | 'button' | 'row';
  /** The app's frame, absent when it laid out none. */
  frame?: Rect;
  situation: Situation;
  /** A raw tap at the frame's centre focused the field / fired the button / chose the row. Never probed off the screen. */
  reached: boolean;
  /** What else the probe tap did, as the app logged it. */
  probe: string[];
}

/** A field as the app's model held it when the trees were read. */
export interface FieldTruth extends FieldState {
  tag: string;
  id: string;
  kind: FieldKind;
  title: string;
  titleId: string;
  frame: Rect;
  /** The shown error's frame (`error` non-null). */
  errorFrame?: Rect;
}

export interface FormTruth {
  fields: FieldTruth[];
  controls: ControlTruth[];
  /** The keyboard as the app last heard of it, when it is up. */
  keyboard: { frame: Rect; field: string | null } | null;
  /** The screen-level message, when shown, and its frame. */
  screenError: (Message & { frame: Rect }) | null;
  submits: { valid: boolean }[];
  /** The picker sheet's frame, when it is presented. */
  sheet?: Rect;
}

/** Whether the three sources tell one story: an `open` target is reached and drawn; a covered one neither. */
export function consistency(t: TargetTruth): string | undefined {
  if (t.declared === 'open' && !(t.reached && t.drawn >= DRAWN)) return `declared open, but reached ${t.reached}, drawn ${pct(t.drawn)}`;
  if (t.declared === 'presented-over' && t.reached) return 'declared presented-over, but the probe tap reached it';
  return undefined;
}

/** Whether a control's probe agrees with where its frame puts it: an open one is reached, a hidden one not. */
export function controlConsistency(c: ControlTruth): string | undefined {
  if (c.situation === 'covered') return undefined;
  if (c.situation === 'open' && !c.reached) return 'open, but the probe tap did not reach it';
  if (c.situation !== 'open' && c.reached) return `${c.situation}, but the probe tap reached it`;
  return undefined;
}

/** A target counts as drawn as itself from this fraction on (a frame's edge pixels may be antialiased). */
export const DRAWN = 0.95;
export const pct = (f: number) => `${Math.round(f * 100)}%`;

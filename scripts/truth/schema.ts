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
  /** `none`, `sheet-medium`, `alert`. */
  layer: string;
  targets: CatalogTarget[];
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
  /** `tap` a target's action fired; `dismissed` a layer went away; `button` a layer's own button. */
  events: { kind: 'tap' | 'dismissed' | 'button'; tag: string; at: number }[];
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
}

/** Whether the three sources tell one story: an `open` target is reached and drawn; a covered one neither. */
export function consistency(t: TargetTruth): string | undefined {
  if (t.declared === 'open' && !(t.reached && t.drawn >= DRAWN)) return `declared open, but reached ${t.reached}, drawn ${pct(t.drawn)}`;
  if (t.declared === 'presented-over' && t.reached) return 'declared presented-over, but the probe tap reached it';
  return undefined;
}

/** A target counts as drawn as itself from this fraction on (a frame's edge pixels may be antialiased). */
export const DRAWN = 0.95;
export const pct = (f: number) => `${Math.round(f * 100)}%`;

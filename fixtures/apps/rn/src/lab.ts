import { Dimensions, NativeModules, PixelRatio, Platform } from 'react-native';
import catalog from '../../cells.json';

// The React Native lab app's model (README.md): the cell catalog the native lab apps bundle (fixtures/apps/cells.json,
// read here at bundle time) and the state file the capture script and the live golden read
// (scripts/truth/schema.ts#LabState) — the same contract as fixtures/apps/ios/AveriLab/Lab.swift and
// fixtures/apps/android/…/Lab.kt, written through the native module LabStateFile (ios/AveriLabRN/LabStateFile.m,
// android/…/LabStateFile.kt). The native side owns the file and the touch log (`touch` events: every touch the app's
// windows receive, before anything handles it — the probe's positive control); this model owns everything else and
// hands the native side its whole state on every change, which merges the touches in.
//
// Units are the tree's: POINTS on iOS (`scale` the device's), screen PIXELS on Android (`scale` 1, `density` pixels
// per dp) — React Native lays out in points / dp, so an Android frame is converted here, its edges rounded to the
// pixel the view is drawn from.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A target of the catalog (scripts/truth/schema.ts#CatalogTarget), the fields this app reads. */
export interface Target {
  tag: string;
  color: string;
  slot: number;
  text?: string;
  label?: string;
}

export interface Cell {
  id: string;
  family?: string;
  layer: string;
  targets: Target[];
}

interface LabEvent {
  kind: string;
  tag: string;
  at: number;
}

interface FieldState {
  value: string;
  focused: boolean;
  error: null;
}

interface LabState {
  cell: string;
  ready: boolean;
  screen: Rect;
  scale: number;
  density?: number;
  frames: Record<string, Rect>;
  events: LabEvent[];
  fields?: Record<string, FieldState>;
  focus?: string | null;
  keyboard?: { frame: Rect; visible: boolean; field: string | null } | null;
}

const native = NativeModules.LabStateFile as { write(json: string): void } | undefined;
const android = Platform.OS === 'android';
/** Pixels per layout unit: Android's density (its state is in pixels); 1 on iOS (its state is in points). */
const unit = android ? PixelRatio.get() : 1;

/** A layout rect (points / dp, the screen's top-left the origin) in the state's units. */
export function toState(r: Rect): Rect {
  if (!android) return r;
  const left = Math.round(r.x * unit);
  const top = Math.round(r.y * unit);
  return { x: left, y: top, width: Math.round((r.x + r.width) * unit) - left, height: Math.round((r.y + r.height) * unit) - top };
}

export const CELLS: readonly Cell[] = (catalog as { cells: Cell[] }).cells;

const screenRect = (): Rect => {
  const s = Dimensions.get('screen');
  return toState({ x: 0, y: 0, width: s.width, height: s.height });
};

const now = () => Date.now() / 1000;

/** The lab's state for one process: one cell per launch, as the native apps. */
export class Lab {
  private state: LabState;

  constructor(cell: string, found: Cell | undefined, fields: readonly string[]) {
    this.state = {
      cell: found === undefined ? `unknown:${cell}` : found.id,
      ready: false,
      screen: screenRect(),
      scale: android ? 1 : PixelRatio.get(),
      ...(android && { density: PixelRatio.get() }),
      frames: {},
      events: [],
      ...(fields.length > 0 && {
        fields: Object.fromEntries(fields.map((f) => [f, { value: '', focused: false, error: null }])),
        focus: null,
        keyboard: null,
      }),
    };
    this.write();
  }

  /** A view's frame on the screen, in layout units (measureInWindow: the window is the screen, edge to edge). */
  frame(tag: string, r: Rect) {
    const f = toState(r);
    const was = this.state.frames[tag];
    if (was !== undefined && was.x === f.x && was.y === f.y && was.width === f.width && was.height === f.height) return;
    this.state.frames[tag] = f;
    this.write();
  }

  event(kind: string, tag: string) {
    this.state.events.push({ kind, tag, at: now() });
    this.write();
  }

  /** One field as the model holds it — the oracle a fill is judged by, not what any tree reports. */
  field(tag: string, value: string, focused: boolean) {
    const fields = this.state.fields;
    if (fields === undefined) return;
    const was = fields[tag];
    if (was !== undefined && was.value === value && was.focused === focused) return;
    fields[tag] = { value, focused, error: null };
    this.write();
  }

  /** The field holding the focus (null: none) — a `focus` event, `tag` empty for none. */
  focused(tag: string | null) {
    if (this.state.focus === tag) return;
    this.state.focus = tag;
    this.event('focus', tag ?? '');
  }

  /** The keyboard's end frame in layout units, screen coordinates (a hide: below the screen, or of no height). */
  keyboard(end: Rect) {
    const frame = toState(end);
    this.state.keyboard = { frame, visible: frame.height > 0 && frame.y < this.state.screen.height, field: this.state.focus ?? null };
    this.write();
  }

  settled() {
    this.state.ready = true;
    this.write();
  }

  private write() {
    native?.write(JSON.stringify(this.state));
  }
}

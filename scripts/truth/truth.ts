import { DRAWN, pct, type CatalogField, type CatalogForm, type ControlTruth, type LabState, type ProbeEvent, type Rect, type Situation, type TargetTruth } from './schema.js';

/**
 * The truth's arithmetic, free of any device (docs/plans/2026-10-15-ground-truth-lab-app.md): where a form control
 * lies from the app's frames, what a probe tap's events say (reached, delivered, another control fired), and whether a
 * capture's sources tell one story. The capture (capture-run.ts) and the golden mode (scripts/differential/golden.ts)
 * both read it; tests/truth/truth.test.ts pins it.
 */

/** The pinned submit's bar: the submit's frame and the bottom safe-area inset's padding above and below it (Form.swift). */
export const PINNED_BAR_PADDING = 10;

/** A probe's touch counts as the tap's when it lies this close to the tapped point (the tree's units). */
export const TOUCH_SLACK = 2;

/** Where a probe taps a frame: its centre, rounded as the raw tools take it (`idb ui tap`, `adb shell input tap`). */
export function probePoint(frame: Rect): { x: number; y: number } {
  return { x: Math.round(frame.x + frame.width / 2), y: Math.round(frame.y + frame.height / 2) };
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/**
 * Where a control's frame lies, from the app's frames alone. A control laid in the picker sheet is `own.inSheet`; the
 * pinned submit's bar (its frame and PINNED_BAR_PADDING, full width) covers what is laid under it; a control straddling
 * the keyboard's top, or with its centre under the bar, is `covered` — partly hidden.
 */
export function situationOf(frame: Rect | undefined, s: LabState, form: CatalogForm, own: { tag: string; inSheet: boolean }): Situation {
  if (frame === undefined) return 'not-rendered';
  const cy = frame.y + frame.height / 2;
  if (cy < 0 || cy >= s.screen.height) return 'off-screen';
  const sheet = s.frames.sheet;
  if (!own.inSheet && form.picker?.open === true && sheet !== undefined && cy >= sheet.y) return 'presented-over';
  const k = s.keyboard?.visible === true ? s.keyboard.frame : undefined;
  if (k !== undefined && frame.y >= k.y) return 'under-keyboard';
  if (k !== undefined && frame.y + frame.height > k.y) return 'covered';
  const submit = s.frames[form.submit.tag];
  if (form.submit.pinned === true && own.tag !== form.submit.tag && submit !== undefined && cy >= submit.y - PINNED_BAR_PADDING && cy <= submit.y + submit.height + PINNED_BAR_PADDING) {
    return 'covered';
  }
  return 'open';
}

/** The events a probe produced: what the app logged after the launch it was tapped on, without the time. */
export function probeEvents(state: LabState | undefined, since: number): ProbeEvent[] {
  return (state?.events ?? []).slice(since).map(({ kind, tag }) => ({ kind, tag }));
}

/** The touches among `events` at `point` (TOUCH_SLACK) — the app's own record that the probe tap reached it. */
export function touchesAt(events: readonly ProbeEvent[], point: { x: number; y: number }): ProbeEvent[] {
  return events.filter((e) => {
    if (e.kind !== 'touch') return false;
    const [x, y] = e.tag.split(',').map(Number);
    return Math.abs(x - point.x) <= TOUCH_SLACK && Math.abs(y - point.y) <= TOUCH_SLACK;
  });
}

/** A coloured target's probe: reached when its action fired; the probe is everything else the tap made the app log. */
export function readTargetProbe(events: readonly ProbeEvent[], tag: string): { reached: boolean; probe: ProbeEvent[] } {
  const hit = (e: ProbeEvent) => e.kind === 'tap' && e.tag === tag;
  return { reached: events.some(hit), probe: events.filter((e) => !hit(e)) };
}

/**
 * A form control's probe: a field is reached when it took the focus (a country field, a button: when its tap fired;
 * a field the cell focuses on appear: when the tap leaves the focus on it), the submit when a submit fired, a picker row
 * when it was chosen.
 */
export function readControlProbe(
  events: readonly ProbeEvent[],
  control: { tag: string; kind: ControlTruth['kind'] },
  field: CatalogField | undefined,
  focusAfter: string | null | undefined,
): { reached: boolean; probe: ProbeEvent[] } {
  const hit = (e: ProbeEvent) =>
    control.kind === 'row' ? e.kind === 'select' && control.tag.endsWith(`.${e.tag}`)
    : control.kind === 'button' ? e.kind === 'submit'
    : field?.kind === 'country' ? e.kind === 'tap' && e.tag === control.tag
    : e.kind === 'focus' && e.tag === control.tag;
  const focusStays = control.kind === 'field' && field?.kind !== 'country' && focusAfter === control.tag;
  return { reached: events.some(hit) || focusStays, probe: events.filter((e) => !hit(e)) };
}

/**
 * The controls a probe fired that are NOT the one tapped: a submit, a chosen row, a layer's button, another target's
 * tap. A focus change and a dismissal are not a control firing (the first follows any tap off a field, the second is
 * the presented-over class), and a touch is the positive control.
 */
export function otherControlsFired(probe: readonly ProbeEvent[], tag: string): ProbeEvent[] {
  return probe.filter((e) => e.kind === 'submit' || e.kind === 'select' || e.kind === 'button' || (e.kind === 'tap' && e.tag !== tag));
}

const NOT_DELIVERED = 'the probe tap left no touch in the app (the positive control): it was not delivered, so "not reached" says nothing';

/** Whether a target's sources tell one story: the tap was delivered; an `open` target is reached and drawn; a covered one is not reached. */
export function consistency(t: TargetTruth): string | undefined {
  if (touchesAt(t.probe, probePoint(t.frame)).length === 0) return NOT_DELIVERED;
  if (t.declared === 'open' && !(t.reached && t.drawn >= DRAWN)) return `declared open, but reached ${t.reached}, drawn ${pct(t.drawn)}`;
  if (t.declared === 'presented-over' && t.reached) return 'declared presented-over, but the probe tap reached it';
  return undefined;
}

/**
 * Whether a control's probe agrees with where its frame puts it: a probed tap was delivered (but where the keyboard
 * lies: its window is not the app's), an open control is reached, a hidden one not. A `covered` control is not held to
 * either: partly hidden, its centre may or may not be.
 */
export function controlConsistency(c: ControlTruth, keyboard: Rect | undefined): string | undefined {
  const probed = c.frame !== undefined && c.situation !== 'off-screen' && c.situation !== 'not-rendered';
  if (probed) {
    const at = probePoint(c.frame!);
    if (touchesAt(c.probe, at).length === 0 && !(keyboard !== undefined && inside(at, keyboard))) return NOT_DELIVERED;
  } else if (c.reached || c.probe.length > 0) {
    return `${c.situation}, never probed, but the truth holds a probe`;
  }
  if (c.situation === 'covered') return undefined;
  if (c.situation === 'open' && !c.reached) return 'open, but the probe tap did not reach it';
  if (c.situation !== 'open' && c.reached) return `${c.situation}, but the probe tap reached it`;
  return undefined;
}

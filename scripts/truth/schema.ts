import type { SourceKind } from '../differential/corpus.js';

/**
 * The lab apps' contract with the harness (docs/plans/2026-10-15-ground-truth-lab-app.md): the cell catalog both apps
 * bundle (fixtures/apps/cells.json), the state file an app writes while a cell is on screen, and the truth file the
 * capture script writes beside each capture.
 *
 * The truth of a coloured target has three sources, each answering one question:
 *  - DECLARED (the catalog): what the cell builds — `open`, or `presented-over` (a layer is presented over the target);
 *  - REACHED (the tap probe): whether a raw tap at the target's centre fired its action — and, its positive control,
 *    whether the tap reached the app at all (the app logs every touch its windows receive);
 *  - DRAWN (the screenshot): the fraction of the target's frame painted its own colour.
 * A form control (a field, the submit, a picker row) has no DECLARED source: the catalog says nothing about where it
 * lies. Its situation is MEASURED from the app's frames (truth.ts#situationOf) and checked against its probe.
 *
 * Units are the tree's: POINTS on iOS (the screenshot at `scale` 3 on the iPhone 17), screen PIXELS on Android (`scale`
 * 1, uiautomator's bounds). The frames are the app's own layout, not the tree's: a tree whose rect disagrees is itself
 * a finding.
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
  /**
   * A text target (calibration.json #8, a Compose button's own text; #18, a text field's own floating label): the
   * target is this text drawn on its coloured control (the button, the field's box), identified as lab.<cell>.<tag>,
   * the control's box lab.<cell>.<tag>.box (its frame reported as `<tag>.box`, the one `drawn` is measured over) — the
   * rows ask by the text (`text:"…"`), as a test names a label (golden-spec/false-covers.ts#ownPartsRows).
   */
  text?: string;
  /** The scroll view the target lies in: an id of LabState.scrollViews, whose clip the measured geometry cuts it by. */
  scrollView?: string;
}

/**
 * The cell families (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 3): one catalog file
 * (fixtures/apps/cells/<family>.json), one app file per platform, one golden-spec file and one KNOWN file each, so
 * cells of different families are written apart. `base` the open control; `presented` a layer presented over the
 * targets (sheet, alert, dim, blur); `forms` the form cells (phase 1b); `edges` targets at a scroll view's or the
 * screen's edge; `bars` system bands and app chrome (tab bars, a FAB); `false-covers` a target's own parts or a bar
 * that is no cover. In this order in the generated catalog (scripts/truth/catalog.ts).
 */
export const FAMILIES = ['base', 'presented', 'forms', 'edges', 'bars', 'false-covers'] as const;
export type Family = (typeof FAMILIES)[number];

export interface CatalogCell {
  id: string;
  /**
   * The family whose file holds it — set by the generator (scripts/truth/catalog.ts), never written in a family file.
   */
  family?: Family;
  /** `none`, `sheet-medium`, `alert`; a form cell's own picker sheet, `sheet-large`. */
  layer: string;
  targets: CatalogTarget[];
  /** A form cell (phase 1b): fields, a submit, maybe a picker — no coloured targets. */
  form?: CatalogForm;
  /**
   * The averi.yaml the golden mode replays the cell under (differential.ts#configFor): merged into its `app.ios` /
   * `app.android` — a config variant (calibration.json #7, #19: `ios.keyboardDismiss`). Copied into the truth file
   * (CellTruth.config), so a capture is replayed as it was captured.
   */
  config?: CellConfig;
}

/** averi.yaml settings per platform, merged over the golden mode's own (`bundleId`, `treeSource`, `package`). */
export interface CellConfig {
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
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
  /**
   * The field's own identifier, else `lab.<cell>.<tag>` — a design-system component's id shared by every field and its
   * title (calibration.json FE2: `TextFieldWithComponentStyle`).
   */
  fieldId?: string;
  placeholder?: string;
  /** What a dev flavour puts in the field before the user does. */
  prefill?: string;
  /**
   * What the field shows when a submit finds it invalid; without it, `Required` identified `lab.<cell>.<tag>_error`.
   */
  error?: Message;
}

export interface CatalogForm {
  /** The navigation title — a neutral element a keyboard dismissal can tap. */
  title: string;
  /**
   * The title drawn as the navigation bar's principal item with this identifier, its frame reported as `title`; a tap
   * on it ends the editing (the keyboard goes) — what a cell's `config.ios.keyboardDismiss` taps (calibration.json #7,
   * #19). Probed: FormTruth.title.
   */
  titleId?: string;
  /**
   * Each title floats inside its field's component, overlapping the field's top (mp-native's SWIFT form; FE2) — not
   * stacked above it.
   */
  floatingTitles?: boolean;
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
  note?: string;
  cells: CatalogCell[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The screen's system bands as insets, in the tree's units: the status band `top`, the navigation band `bottom`. */
export interface Insets {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * What the lab app writes (fixtures/apps/ios/AveriLab/Lab.swift#LabState, fixtures/apps/android/…/Lab.kt): screen
 * coordinates in the tree's units — points on iOS, pixels on Android.
 */
export interface LabState {
  cell: string;
  /** The cell's layer has been presented and its animation has had time to finish. */
  ready: boolean;
  screen: Rect;
  /** Screenshot pixels per unit: the device's scale on iOS (3), 1 on Android. */
  scale: number;
  frames: Record<string, Rect>;
  /**
   * `tap` a target's action fired; `dismissed` a layer went away; `button` a layer's own button; on a form cell
   * `focus` a field took the focus (`tag` empty: none has it), `submit` the submit fired (`tag` `valid`/`invalid`),
   * `select` a picker row was chosen (`tag` its code); `touch` a touch began in one of the app's windows (`tag` `x,y`,
   * screen coordinates in the state's units) — the probe's positive control.
   */
  events: (ProbeEvent & { at: number })[];
  /** A form cell's oracle — absent on the coloured-target cells (and in their phase-1 captures). */
  fields?: Record<string, FieldState>;
  /** The field holding the focus, or null. */
  focus?: string | null;
  /** The last `keyboardWillChangeFrame`, its end frame in screen coordinates; null before any. */
  keyboard?: KeyboardState | null;
  submits?: { at: number; valid: boolean; values: Record<string, string> }[];
  // Phase 3's geometry (truth.ts#geometryOf) — optional: an app that writes none (every phase-1/1b/2 capture) has no
  // measured geometry, and its targets are judged by `declared` alone, as before.
  /** The window's safe-area insets — the system bands: iOS's status bar and home indicator, Android's system bars. */
  safeArea?: Insets;
  /**
   * Each scroll view of the cell by id, its clip on the screen: what of its content can show
   * (CatalogTarget.scrollView).
   */
  scrollViews?: Record<string, Rect>;
  /**
   * The app's chrome by name, each frame on the screen: `tabBar`, `navBar`, `toolbar`, `fab`, a pinned bar — app UI
   * drawn over content.
   */
  chrome?: Record<string, Rect>;
}

/** One field as the app's model holds it — not as any tree reports it. */
export interface FieldState {
  value: string;
  focused: boolean;
  /** The message shown under the field now, or null. */
  error: Message | null;
}

export interface KeyboardState {
  /** The keyboard's end frame, screen coordinates in the tree's units (iOS: UIKeyboardFrameEndUserInfoKey, points). */
  frame: Rect;
  /** Its frame lies on the screen (a hide moves it below the bottom edge). */
  visible: boolean;
  /** The field focused when it changed — the one it serves. */
  field: string | null;
}

/**
 * `tab` a tab bar's item was chosen (`tag` its name) — app chrome firing, phase 3's bars. A chrome's own button (a
 * toolbar's, a FAB) logs `button`, `tag` `<chrome>.<name>` (the chrome's name in LabState.chrome).
 */
export type EventKind = 'tap' | 'dismissed' | 'button' | 'focus' | 'submit' | 'select' | 'touch' | 'tab';

/** One thing the app logged, as the truth keeps it. */
export interface ProbeEvent {
  kind: EventKind;
  tag: string;
}

export interface TargetTruth {
  tag: string;
  /** The selector the target answers to in every tree source: its accessibility identifier. */
  id: string;
  /**
   * A text target's text (CatalogTarget.text): its rows ask by it; `drawn` and `seen` are measured over its control's
   * box (`<tag>.box`), the text drawn on it.
   */
  text?: string;
  color: string;
  declared: Declared;
  /** The app's frame, in the tree's units (points on iOS, pixels on Android). */
  frame: Rect;
  /** A raw tap at the frame's centre fired the target's action. */
  reached: boolean;
  /** Everything else the probe tap made the app log (its touch, a layer dismissed, another target's tap, …). */
  probe: ProbeEvent[];
  /** The fraction of the frame's pixels painted the target's own colour (pixels.ts#OWN_COLOUR_TOLERANCE). */
  drawn: number;
  /** The colour most of the frame shows in the screenshot, `#RRGGBB` — what the user sees there. */
  seen: string;
  // Measured from the app's frames when the state reports the screen's bands, scroll views or chrome
  // (truth.ts#geometryOf); absent on every capture before phase 3, whose targets are judged by `declared` alone.
  /** Where the frame lies against the screen, its scroll view's clip, the system bands and the app's chrome. */
  geometry?: Geometry;
  /** The frame clipped by the screen and its scroll view's clip — what of it can be drawn; null when nothing. */
  visible?: Rect | null;
  /**
   * The largest part of `visible` clear of the system bands and the app's chrome — where a tap can land on it; null
   * when none.
   */
  piece?: Rect | null;
  /** The scroll view the target lies in (CatalogTarget.scrollView). */
  scrollView?: string;
  /**
   * Whether each raw tree the capture read lists a node identified as the target (truth.ts#listedIn): `{wda: true,
   * idb: true}`, `{uiautomator: false}` — uiautomator dumps no node not visible to the user. Recorded with a measured
   * geometry only (absent before B2's review too): a target without it is held to be listed.
   */
  listed?: Partial<Record<SourceKind, boolean>>;
  /**
   * A second probe, at the piece's centre (probePoint(piece)), when it is not the frame's: fired the target's action.
   * Absent when not probed — the piece's centre is the frame's, or there is no piece.
   */
  reachedAtPiece?: boolean;
  /**
   * Why the probe at the frame's centre was not tapped (truth.ts#unprobedReason): the point (probePoint) lies off the
   * screen — an off-screen target, or one cut by the screen's edge with its centre past it: a raw tap there would reach
   * no window of the app (and log no touch), so it would say nothing.
   * `reached` is false and `probe` empty.
   */
  unprobed?: string;
}

/**
 * Where a target's frame lies, measured (truth.ts#geometryOf), in averi's judging order (ADR 0005: off the screen, the
 * system bands, cut, covered): `off-screen` none of it on the screen (a frame of no area too, wherever it lies: nothing
 * of it can be drawn, and it is never probed); `outside-scroll-view` on the screen but none of it in its scroll view's
 * clip; `status-band` / `nav-band` its centre in the top / bottom system band; `sliver` cut by its scroll view's clip,
 * what shows across that edge under the tap minimum (ADR 0013; truth.ts#clipCuts); `partly-centre-in` / `centre-out`
 * cut, its centre inside / outside what shows; `under-chrome:<name>` whole, or cut with its centre showing, its centre
 * under the app's chrome of that name; `band-overlap:<status|nav>` / `chrome-overlap:<name>` whole, its centre clear,
 * but what shows of it overlapped past ADR 0002's slack by that band or chrome (truth.ts#regionOverlap); `whole`.
 */
export type Geometry =
  | 'whole'
  | 'partly-centre-in'
  | 'centre-out'
  | 'sliver'
  | 'outside-scroll-view'
  | 'off-screen'
  | 'status-band'
  | 'nav-band'
  | `under-chrome:${string}`
  | 'band-overlap:status'
  | 'band-overlap:nav'
  | `chrome-overlap:${string}`;

export interface CellTruth {
  cell: string;
  layer: string;
  device: string;
  screen: { width: number; height: number };
  scale: number;
  targets: TargetTruth[];
  /** A form cell's truth (its `targets` empty). */
  form?: FormTruth;
  /** As the state reported them (LabState): what the targets' geometry was measured against. Absent before phase 3. */
  safeArea?: Insets;
  scrollViews?: Record<string, Rect>;
  chrome?: Record<string, Rect>;
  /** The cell's averi.yaml variant (CatalogCell.config): golden replays it under this. */
  config?: CellConfig;
  /**
   * Android: the navigation mode the device was in (`settings get secure navigation_mode`), which decides who takes a
   * tap in the navigation band (truth.ts#navigationBandTakes). Absent on iOS and on captures before B4.
   */
  navigation?: NavigationMode;
  /**
   * Android, a cell captured with the IME up (LabState.keyboard visible): the file beside the truth holding what the
   * device answered to averi's own keyboard queries (ImeCapture) — the golden mode's fake device serves it in place of
   * its stock dumps (scripts/differential/fake-device.ts#DeviceProfile.ime). Absent elsewhere.
   */
  ime?: string;
}

/**
 * What an Android device answered to the three keyboard queries averi makes (src/adapters/android.ts: keyboardState's
 * `dumpsys window displays`, keyboardWitness's INPUT_SHOWN_COMMAND, keyboardTouchable's TOUCHABLE_COMMAND), raw, with
 * the IME up as captured (`shown`) and after one `input keyevent 4` hid it (`hidden`) — what a `back` the tools press
 * leaves.
 */
export interface ImeCapture {
  shown: ImeReadings;
  hidden: ImeReadings;
}

export interface ImeReadings {
  /** `dumpsys window displays`. */
  displays: string;
  /** `dumpsys input_method | grep -m1 -w mInputShown`. */
  inputShown: string;
  /** `dumpsys input_method | grep -m1 -w mInputShown; dumpsys window InputMethod | grep -F 'touchable region='; true`. */
  touchable: string;
}

/** Android's `navigation_mode`: 0 `three-button`, 1 `two-button`, 2 `gesture`. */
export type NavigationMode = 'three-button' | 'two-button' | 'gesture';

/**
 * Where a form control is, measured from the app's frames (truth.ts#situationOf), not declared: `open` its centre on
 * the screen, clear of the keyboard and of the pinned bar; `under-keyboard` all of it below the keyboard's top;
 * `covered` its centre under the pinned submit bar, or straddling the keyboard's top (judged when its probe fired
 * another control — golden-spec/forms.ts#controlRows); `presented-over` under the picker sheet; `off-screen` its centre
 * off the screen; `not-rendered` the app laid out no frame for it (a lazy list's row far down).
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
  /** A raw tap at the frame's centre focused the field / fired the button / chose the row. */
  reached: boolean;
  /**
   * Everything else the probe tap made the app log (its touch first); empty for a control never probed (off the screen,
   * not laid out).
   */
  probe: ProbeEvent[];
  /**
   * An `under-keyboard` control: the colour most of its frame shows in the screenshot — the keyboard's, what a colour
   * assert on it would measure (golden-spec/forms.ts#controlRows). Absent elsewhere, and on captures before phase 2b.
   */
  seen?: string;
  /**
   * Android, an `under-keyboard` control: a raw tap at its centre after one `back` hid the IME (LabDevice.hideKeyboard)
   * reached it — what averi's tap guard does there (hide, find again, tap). Absent elsewhere.
   */
  reachedAfterBack?: boolean;
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
  /** The title's frame (`<tag>.title`), when the app reported one. */
  titleFrame?: Rect;
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
  /**
   * The principal title (CatalogForm.titleId), its frame and its probe: `reached` when a raw tap at its centre ended
   * the editing (a `focus` event with no field) — the keyboard dismissal a cell's config taps works on the screen.
   */
  title?: { id: string; frame: Rect; reached: boolean; probe: ProbeEvent[] };
}

/** A target counts as drawn as itself from this fraction on (a frame's edge pixels may be antialiased). */
export const DRAWN = 0.95;
export const pct = (f: number) => `${Math.round(f * 100)}%`;

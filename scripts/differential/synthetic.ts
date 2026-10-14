/**
 * The synthetic trees the scratch harness built inline over the device
 * trees, kept so the corpus covers what it covered: raw payloads made by
 * hand (idb element lists, uiautomator XML) for shapes no device check
 * caught — an idb keyboard band under a field, covered slivers at a scroll
 * container's edge, a pinned bottom bar, a flush last row, a screen with no
 * size. Each is a RAW payload, so it goes through the parser like a capture.
 * Keyed by file name; `run` is the corpus run they are written into.
 */

type IdbEl = { type: string; AXLabel: string | null; AXUniqueId: string | null; frame: { x: number; y: number; width: number; height: number } };
const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number): IdbEl => ({ type, AXLabel, AXUniqueId: null, frame: { x, y, width, height } });
const qwerty = (y: number) => ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((k, i) => el('Button', k, 2 + 40 * i, y, 38, 46));

/**
 * idb: the number pad's value-date row moved through the pad's band, Contacts' QWERTY, and three shapes over a QWERTY
 * band: a tall row straddling the band's line with a key over it, a field and its label at one origin under it, and a
 * sign-in button under it below two fields.
 */
export function syntheticIdb(numberPad: IdbEl[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const y of [500, 545, 560, 565, 575, 581, 600, 640, 700, 760, 840]) {
    out[`numpad-value-date-at-${y}.json`] = JSON.stringify(
      numberPad.map((e) => ((e as { AXUniqueId?: string }).AXUniqueId === 'swift_payment.form.value_date_select' ? { ...e, frame: { ...e.frame, y } } : e)),
    );
  }
  out['contacts-qwerty.json'] = JSON.stringify([
    el('Application', 'Contacts', 0, 0, 402, 874), el('TextField', 'First name', 20, 200, 362, 44), el('Button', 'Row near', 20, 560, 362, 50),
    el('Button', 'add url', 20, 902, 362, 51), el('Button', 'Gap row', 20, 590, 362, 30),
    ...['Z', 'X', 'C', 'V'].map((k, i) => el('Button', k, 48 + 40 * i, 714, 36, 46)), el('Other', null, 0, 590, 402, 284), el('Button', 'Dictate', 325, 805, 68, 69),
  ]);
  out['band-row-straddles-the-line.json'] = JSON.stringify([el('Application', 'App', 0, 0, 402, 874), el('TextField', 'Name', 20, 200, 362, 44), el('Button', 'Row', 20, 520, 362, 160), el('Button', 'Spacer below', 20, 900, 362, 40), el('Button', 'K', 180, 594, 44, 40), ...qwerty(640), el('Other', null, 0, 590, 402, 284)]);
  out['band-field-and-label-under-the-line.json'] = JSON.stringify([el('Application', 'App', 0, 0, 402, 874), el('TextField', 'Field', 42, 700, 318, 20), el('StaticText', 'Label', 42, 700, 60, 20), ...qwerty(780), el('Other', null, 0, 590, 402, 284)]);
  out['band-sign-in-under-the-line.json'] = JSON.stringify([el('Application', 'App', 0, 0, 402, 874), el('TextField', 'User', 20, 200, 362, 44), el('TextField', 'Pass', 20, 260, 362, 44), el('Button', 'Sign in', 20, 700, 362, 50), ...qwerty(780), el('Other', null, 0, 590, 402, 284)]);
  return out;
}

/** uiautomator: the Settings flush title, a pinned bottom bar, and the covered slivers at a form's edges. */
export function syntheticUiautomator(): Record<string, string> {
  const out: Record<string, string> = {};
  // The Settings flush title: recycler 0,596 1080x1558 with clips, the title 198,2105 428x49 flush with 2154.
  out['settings-flush.xml'] = `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="list" bounds="[0,596][1080,2154]">
    <node class="android.widget.LinearLayout" clickable="true" resource-id="row" bounds="[0,2072][1080,2154]"><node class="android.widget.TextView" resource-id="title" text="Sound &amp; vibration" bounds="[198,2105][626,2154]" /></node>
  </node></node></hierarchy>`;
  // A non-edge-to-edge app: its window ends at the navigation bar, a pinned bottom bar in no scroller ending there too.
  out['pinned-bottom-bar.xml'] = `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2154]">
  <node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="list" bounds="[0,66][1080,2000]"><node class="android.widget.TextView" resource-id="row" text="Row" bounds="[0,1900][1080,2000]" /></node>
  <node class="android.widget.LinearLayout" resource-id="bottom_bar" bounds="[0,2000][1080,2154]"><node class="android.widget.TextView" resource-id="bar_title" text="Pay" bounds="[400,2100][680,2154]" /></node>
</node></hierarchy>`;
  // The same two with a zero-size root — a device that gave no screen size through the tree.
  out['settings-flush-zero-root.xml'] = out['settings-flush.xml'].replace('bounds="[0,0][1080,2220]"', 'bounds="[0,0][0,0]"');
  out['pinned-bottom-bar-zero-root.xml'] = out['pinned-bottom-bar.xml'].replace('bounds="[0,0][1080,2154]"', 'bounds="[0,0][0,0]"');
  // Covered slivers: the SWIFT toggle cut at the form's bottom (and a row cut at its top), a button over the centre, over an edge, both, none.
  const sliver = (depth: number, top: boolean, cover: string) => `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.widget.ScrollView" scrollable="true" resource-id="form" bounds="[0,242][1080,1978]">
    ${top ? `<node class="android.view.View" resource-id="toggle" bounds="[66,242][1014,${242 + depth}]"><node class="android.widget.TextView" text="Row" bounds="[66,${242 + depth - 120}][1014,${242 + depth - 8}]" /></node>`
          : `<node class="android.view.View" resource-id="toggle" bounds="[66,${1979 - depth}][1014,1979]"><node class="android.widget.TextView" text="Payment details" bounds="[66,${1991 - depth}][1014,1978]" /></node>`}
    <node class="android.view.View" resource-id="filler" bounds="[66,900][1014,1000]" />
  </node>
  <node class="android.widget.Button" text="CONTINUE" bounds="[66,1979][1014,2111]" />${cover}
</node></hierarchy>`;
  for (const depth of [30, 55, 64, 65, 80]) for (const top of [false, true]) {
    const y = top ? 242 : 1979 - depth;
    const covers: Record<string, string> = {
      none: '',
      centre: `<node class="android.widget.Button" text="Help" bounds="[400,${y - 24}][700,${y + depth}]" />`,
      edge: `<node class="android.widget.Button" text="Badge" bounds="[66,${y}][200,${y + depth}]" />`,
      both: `<node class="android.widget.Button" text="Help" bounds="[400,${y - 24}][700,${y + depth}]" /><node class="android.widget.Button" text="Badge" bounds="[66,${y}][200,${y + depth}]" />`,
    };
    for (const [k, c] of Object.entries(covers)) out[`sliver-${depth}-${top ? 'top' : 'bottom'}-${k}.xml`] = sliver(depth, top, c);
  }
  return out;
}

/** WDA: a copy of a raw capture whose root says the screen is 0x0 (the scratch harness's "no device screen" tree). */
export function zeroRootWda(raw: string): string {
  const doc = JSON.parse(raw) as { value: { rect?: unknown; frame?: string } };
  doc.value.rect = { x: 0, y: 0, width: 0, height: 0 };
  if (doc.value.frame !== undefined) doc.value.frame = '{{0, 0}, {0, 0}}';
  return JSON.stringify(doc);
}

/**
 * A raw WDA capture whose first element at `0,0 402x<height>` — a screen's header, its centre in the status band,
 * beneath a presented screen — carries `rawIdentifier: id`. Such headers carry no identifier on the captured screens,
 * so no selector reached them, and the tap under the status bar beneath a presented screen had no tool-level oracle.
 * An identifier changes nothing else the parser reads of an `Other` (wda-source.ts#hiddenRoots asks the type).
 */
export function withHeaderId(raw: string, height: number, id: string): string {
  type El = { rect?: { x: number; y: number; width: number; height: number }; rawIdentifier?: string | null; children?: El[] | null };
  const doc = JSON.parse(raw) as { value: El };
  const find = (el: El): El | undefined =>
    el.rect?.x === 0 && el.rect.y === 0 && el.rect.width === 402 && el.rect.height === height ? el : (el.children ?? []).map(find).find(Boolean);
  const header = find(doc.value);
  if (header === undefined) throw new Error(`withHeaderId: no 0,0 402x${height} element`);
  header.rawIdentifier = id;
  return JSON.stringify(doc);
}

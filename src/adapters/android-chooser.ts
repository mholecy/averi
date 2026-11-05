import type { StartRefused } from './android-start.js';
import { everyNode, labelOf, rectCentre, type ChooserApp, type ChooserButton, type ChooserSheet, type LinkChooser, type Point, type UiNode } from './types.js';

/**
 * Android's "Open with" chooser in front after a deep link (D55; docs/adr/0041-an-android-link-names-the-chooser-in-front.md),
 * judged from the focused component alone, with no device call here: Android's counterpart of ios-system-alert.ts.
 *
 * `am start -a VIEW -d <url>` with no package is an implicit intent. When two activities handle the url and none is
 * the preferred one, Android starts its resolver instead of either app, and `am start` reports an activity started
 * (android-start.ts): the start was right, but which activity it started was never asked. So openDeepLink reads the
 * focus once after the start (CHOOSER_FOCUS_COMMAND) and asks chooserInFocus. Since D55b launch_app does the same
 * after its `-p` start (an intent scoped to the package, which two of its activities may handle), and after monkey's
 * refusal (monkey starts nothing over the chooser): ADR 0041's D55b amendment.
 *
 * The device facts (batch-9 D55, 2026-11-03, averi_lab emulator, Android 13 / API 33, main e734fedf;
 * `averilab://shared/open`, which the lab's `.MainActivity` and its alias `.Twin` both handle): a raw `am start` and
 * averi's open_deep_link each left the chooser in front, `mCurrentFocus=Window{56b9ca0 u0
 * android/com.android.internal.app.ResolverActivity}` and `mFocusedApp=ActivityRecord{6909a9c u0
 * android/com.android.internal.app.ResolverActivity} t2590}`; `am start -W` named the same `Activity:`. Its window is
 * the platform's (package `android`), titled "Open with", with the buttons "Just once" and "Always"; one BACK
 * dismissed it.
 *
 * The other components are AOSP's, not measured: `com.android.internal.app.ChooserActivity` (frameworks/base,
 * core/java/com/android/internal/app/, beside ResolverActivity) is the chooser an ACTION_CHOOSER start shows, and
 * later releases move both into the IntentResolver module, package `com.android.intentresolver`
 * (packages/modules/IntentResolver). An OEM's own chooser component is not in this list: it reads as no chooser.
 *
 * Why it is safe to name: no app can own package `android` or `com.android.intentresolver`, so a positive match is
 * the platform's chooser in front, never an app's activity of the same name. Anything else, including no focus at
 * all, is undefined: openDeepLink then answers as before ("Opened"), never a warning without a match.
 */

/**
 * Each display's focus lines, in one shell line, under its header (`Display: mDisplayId=0 …`): `mCurrentFocus` (the
 * focused window, `Window{<hash> u0 <component>}`, or `null` in a transition) and `mFocusedApp` (the focused
 * activity: `ActivityRecord{<hash> u0 <component>} t<task>}` on API 33, `… u0 <component> t<task>}` on API 36; API 29
 * wraps it in its window token). `dumpsys window displays` prints one pair per display, on API 29 and later
 * (measured on 33; the API 36 fixture holds them too). When nothing prints, grep exits 1 and the call fails: no
 * chooser. Every word a constant.
 */
export const CHOOSER_FOCUS_COMMAND = "dumpsys window displays | grep -E 'Display: mDisplayId=|mCurrentFocus=|mFocusedApp='";

/** The packages the platform's chooser runs in: the framework's, and the IntentResolver module's (later APIs). */
const CHOOSER_PACKAGES: ReadonlySet<string> = new Set(['android', 'com.android.intentresolver']);

/**
 * The chooser's class: ResolverActivity or ChooserActivity, fully named or short (`.ResolverActivity`) — the window
 * manager prints a class with its package or its leading dot, so a dot always comes before the name.
 */
const CHOOSER_CLASS = /\.(?:Resolver|Chooser)Activity$/;

// The component capture is written twice below on purpose: Stryker mutates only regex literals (code review, D55).
/**
 * The focused window's component, ended by the record's `}`; a window named by a title (`Window{… u0
 * NotificationShade}`) has none.
 */
const FOCUS_WINDOW_RE = /mCurrentFocus=Window\{[0-9a-f]+ u\d+ ([^\s/}]+\/[^\s}]+)\}/;

/**
 * The focused activity's component: an ActivityRecord anywhere on the `mFocusedApp` line — the line itself on API 30
 * and later, inside `AppWindowToken{… token=Token{… ActivityRecord{…}}}` on API 29 (AOSP 10's dump, not captured).
 * Only a space or `}` ends the component: `}` on API 33 (`…ResolverActivity} t2641}`: batch-9's and batch-10's every
 * read), the space before the task on API 36 (`…NexusLauncherActivity t2}`). A line cut right after the component,
 * at a newline or the end, names nothing. Why API 33's brace was missed until D55r: ADR 0041's D55r amendment.
 */
const FOCUSED_APP_RE = /mFocusedApp=[^\n]*?ActivityRecord\{[0-9a-f]+ u\d+ ([^\s/}]+\/[^\s}]+)[ }]/;

/** What opens each display's block in the dump, its id after it: `Display: mDisplayId=0 (organized)`. */
const DISPLAY_HEADER = 'Display: mDisplayId=';

/** The id of the default display, where `am start` with no `--display` starts the link. */
const DEFAULT_DISPLAY = 0;

/**
 * The default display's block of the dump, from its header to the next one: display 0's, else the first display's
 * (no dump of averi's has lacked a display 0). A dump with no header (focus lines read alone) is one display's, whole.
 */
function defaultDisplayBlock(dump: string): string {
  const [whole = dump, ...displays] = dump.split(DISPLAY_HEADER);
  return displays.find((block) => Number.parseInt(block, 10) === DEFAULT_DISPLAY) ?? displays[0] ?? whole;
}

/** Whether `pkg/class` is the platform's chooser. */
const isChooser = (component: string): boolean => {
  const [pkg, cls] = component.split('/') as [string, string];
  return CHOOSER_PACKAGES.has(pkg) && CHOOSER_CLASS.test(cls);
};

/**
 * The chooser's component (`android/com.android.internal.app.ResolverActivity`, as the dump names it) when the focus
 * names it, else undefined. The focused ACTIVITY decides when its line names one; the focused window only when it
 * does not. `am start` returns without waiting for a window, and the focused activity is set as the start resumes it
 * while the focused window follows once it is drawn (AOSP's order; batch-10's read right after averi's reply found the
 * focused activity the started one in 40 of 40, the window still `null` in 11). So right after a start the activity
 * is the newer word: the chooser as the activity under the launcher's or a `null` window is the link's chooser not
 * drawn yet, and an app as the activity under the chooser's window is a chooser on its way out (an earlier one, the
 * link's app resumed over it), which is no chooser. Both lines are read from the default display's block only
 * (defaultDisplayBlock), so they are one display's pair: another display's chooser is not this link's.
 */
export function chooserInFocus(dump: string): string | undefined {
  const block = defaultDisplayBlock(dump);
  const component = FOCUSED_APP_RE.exec(block)?.[1] ?? FOCUS_WINDOW_RE.exec(block)?.[1];
  return component !== undefined && isChooser(component) ? component : undefined;
}

/**
 * What the reply advises once the chooser is named (mcp/tool-text.ts#deepLinkText): the agent picks the app, "Just
 * once" (never "Always", which writes a preferred activity: a device change every later run would inherit), or BACK
 * (measured: one BACK dismissed it, batch-9). averi taps nothing: which handler is meant is the test's business. The
 * labels are AOSP's English ones; what a launch does under the chooser is launch_app's own wording below (D55b).
 * "if it shows one": ResolverActivity asks for an app and then "Just once" or "Always" (batch-9); ChooserActivity, a
 * share sheet's chooser, opens the app tapped and has neither button (AOSP, not measured).
 */
export const CHOOSER_ADVICE = chooserAdvice('such links', 'the link');

/**
 * The advice, for what the chooser holds: `defaultFor` is what "Always" would change the default for (`such links`
 * after a link, `the intent it answers` after a launch), `drops` what one BACK drops (`the link`, `the chooser`). One
 * wording for open_deep_link (CHOOSER_ADVICE) and both launch paths (launchChooserNote, monkeyChooserRefusal): D55b.
 */
export function chooserAdvice(defaultFor: string, drops: string): string {
  return `Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one ${adviceEnd('"Always"', defaultFor, drops)}`;
}

/**
 * The advice beside a quoted sheet (D55c), chooserAdvice's counterpart with the same `defaultFor` and `drops`: tap the
 * app's row at its x and y — by coordinates, as two rows may share a label (the lab's both say "AveriLab"); one tap
 * only selects the row, and enables the buttons when the tree marks them disabled (batch-11, lab fact 13; in a tree
 * with a row selected neither is marked, and the clause is left out) — then "Just once" by its id, language-free
 * (`id:button_once`, never `id:button_always`, which writes a preferred activity); BACK drops it; averi taps nothing.
 */
export function sheetAdvice(sheet: ChooserSheet, defaultFor: string, drops: string): string {
  const enables = sheet.once.disabled || sheet.always.disabled ? ' and enables the buttons' : '';
  return (
    `Tap the app's row at its x and y (one tap only selects it${enables}), then tap id:button_once ` +
    adviceEnd('id:button_always', defaultFor, drops)
  );
}

/**
 * Both advices' ending: the button never to tap and why, what one BACK drops, and that averi taps nothing. A function
 * declaration: CHOOSER_ADVICE, above, is built from it as the module loads.
 */
function adviceEnd(never: string, defaultFor: string, drops: string): string {
  return `(never ${never}: it changes the device's default for ${defaultFor}); press_key back drops ${drops}. averi taps nothing itself.`;
}

/**
 * The advice after a launch. Neutral on whose intent the chooser answers: after a `-p` start it is most likely the
 * launch's own (two of the package's activities, none preferred; batch-11 10 of 10), but a chooser left up by another
 * app's link reads the same.
 */
const LAUNCH_ADVICE = chooserAdvice('the intent it answers', 'the chooser');

/**
 * launch_app's ⚠ note when the chooser is in front after its `-p` start (D55b; ADR 0041's D55b amendment). The
 * headline stays "Launched" — D56's shape on iOS (ADR 0032's D56 amendment), the start did happen. It says only what
 * the read saw: the chooser in front, the package not. Naming an activity (`nameTheActivity`: where the call names
 * it, the adapter's wording) starts it with `-n`, which a package's own chooser cannot stop. With the chooser's
 * `sheet` read (D55c) the note quotes it and advises the tap by coordinates (chooserSheetText) in place of
 * LAUNCH_ADVICE; without it, D55b's note byte for byte.
 */
export function launchChooserNote(packageName: string, chooser: LinkChooser, nameTheActivity: string): string {
  const advice = chooser.sheet === undefined ? LAUNCH_ADVICE : chooserSheetText(chooser.sheet, 'the intent it answers', 'the chooser');
  return (
    `Android has not brought ${packageName} forward yet: its chooser (${chooser.component}) is in front, and ` +
    `${packageName} is not. ${advice} Naming the activity (${nameTheActivity}) starts it without the chooser.`
  );
}

/**
 * monkey's refusal when the chooser is in front and monkey gave no reason of its own (D55b; refusalReasons empty, its
 * only `** ` line the emulator's SYS_KEYS warning): monkey starts nothing over the chooser (exit 251 3 of 3 in
 * batch-11, averi_lab API 33; batch-10's refusal was recorded as 252), so the message names the chooser as the cause
 * instead of the install, with monkey's actual exit code when it had one (the refusal's ExecError; none at exit 0, and
 * `null` on a signal). It quotes no line; the ExecError, the caller's cause, keeps the whole output.
 */
export function monkeyChooserRefusal(packageName: string, component: string, refused: StartRefused): string {
  const exitCode = refused.cause?.exitCode;
  return (
    `monkey started nothing in ${packageName}: Android's chooser (${component}) is in front, and monkey starts ` +
    `nothing over it${exitCode == null ? '' : ` (it exited ${exitCode})`}. ${LAUNCH_ADVICE} Then launch again.`
  );
}

/**
 * The chooser beside a refusal with a reason of its own (D55b: monkey's real `** ` line, e.g. `** No activities found
 * to run`): not claimed as the cause, only named as also in front, with the advice. The caller's message leads.
 */
export function chooserAlsoInFront(component: string): string {
  return `Android's chooser (${component}) is also in front. ${LAUNCH_ADVICE}`;
}

/**
 * The chooser's fresh layout in its tree (D55c; ADR 0041's D55c amendment), the counterpart of
 * ios-system-alert.ts#alertInWda: read by resource id alone (`UiNode.identifier` is the id's last segment, so
 * `android:id/text1` is `text1` — safe here, as the tree is read only after the focus read named the platform's
 * chooser), never by a label's words. The guard accepts only the measured shape (batch-10's and batch-11's E2,
 * tests/fixtures/uiautomator-lab-resolver*.xml): exactly one `resolver_list`; at least one row, each a direct child of
 * it holding exactly one labelled `text1` and at most one `text2`; exactly one labelled `button_once` and one labelled
 * `button_always`; and no `icon` and no `text1` outside the list. The last rule is `resolver_list_with_default`'s
 * (AOSP android13, core/res/res/layout/resolver_list_with_default.xml; captured live in batch-13,
 * tests/fixtures/uiautomator-lab-resolver-with-default-*.xml, D55d): it heads the sheet with the last-chosen app's
 * `icon` and `title` above the list, and quoting the list's rows alone there would hide the preselected app. On the
 * real layout the header `icon` alone rejects it (its header holds `title`, no `text1`). Anything else is undefined:
 * the reply is then D55's, by the component alone.
 */
export function chooserSheet(tree: UiNode): ChooserSheet | undefined {
  const nodes = [...everyNode(tree)];
  const lists = withId(nodes, 'resolver_list');
  if (lists.length !== 1) return undefined;
  const list = lists[0];
  const inList = new Set(everyNode(list));
  if (nodes.some((n) => !inList.has(n) && (n.identifier === 'icon' || n.identifier === 'text1'))) return undefined;
  const once = buttonOf(nodes, 'button_once');
  const always = buttonOf(nodes, 'button_always');
  if (once === undefined || always === undefined || list.children.length === 0) return undefined;
  const apps: ChooserApp[] = [];
  for (const row of list.children) {
    const inRow = [...everyNode(row)];
    const [text1, ...moreText1] = withId(inRow, 'text1');
    const text2 = withId(inRow, 'text2');
    const label = labelOf(text1);
    if (label === undefined || moreText1.length > 0 || text2.length > 1) return undefined;
    const detail = labelOf(text2[0]);
    apps.push({ label, ...(detail !== undefined && { detail }), centre: rectCentre(row.rect) });
  }
  const titles = withId(nodes, 'title');
  const title = titles.length === 1 ? labelOf(titles[0]) : undefined;
  return { ...(title !== undefined && { title }), apps, once, always };
}

/** The nodes among `nodes` with resource id `id` (its last segment). */
const withId = (nodes: readonly UiNode[], id: string): UiNode[] => nodes.filter((n) => n.identifier === id);

/** The one button with id `id` and a label, as the sheet quotes it; undefined when there is none, or more than one. */
function buttonOf(nodes: readonly UiNode[], id: string): ChooserButton | undefined {
  const buttons = withId(nodes, id);
  const label = labelOf(buttons[0]);
  if (buttons.length !== 1 || label === undefined) return undefined;
  return { label, centre: rectCentre(buttons[0].rect), disabled: buttons[0].disabled === true };
}

/**
 * The sheet as both replies quote it (D55c), one sentence after the reply's own (D55's or D55b's, unchanged): its
 * title when it has one, the apps with their rows' centres and the buttons with theirs, "(disabled)" on a button the
 * tree marks so — `Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at
 * (540, 1881) and the buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058) (disabled)`. Every label
 * verbatim; two rows may share one, which is why the advice taps by coordinates.
 */
export function chooserSheetSays(sheet: ChooserSheet): string {
  const title = sheet.title === undefined ? '' : ` "${sheet.title}"`;
  const apps = sheet.apps.map((a) => `"${a.label}"${a.detail === undefined ? '' : ` ("${a.detail}")`} at ${pointText(a.centre)}`);
  const button = (b: ChooserButton) => `"${b.label}" at ${pointText(b.centre)}${b.disabled ? ' (disabled)' : ''}`;
  return (
    `Its sheet${title} lists the ${apps.length === 1 ? 'app' : 'apps'} ${apps.join(', ')} and the buttons ` +
    `${button(sheet.once)}, ${button(sheet.always)}`
  );
}

/**
 * What replaces chooserAdvice once the sheet is read (D55c): the sheet (chooserSheetSays), then its advice
 * (sheetAdvice) with the same `defaultFor` and `drops` — mcp/tool-text.ts#chooserText's after a link,
 * launchChooserNote's after a launch.
 */
export function chooserSheetText(sheet: ChooserSheet, defaultFor: string, drops: string): string {
  return `${chooserSheetSays(sheet)}. ${sheetAdvice(sheet, defaultFor, drops)}`;
}

/** A point as the replies write it: `(x, y)`. */
const pointText = (p: Point): string => `(${p.x}, ${p.y})`;

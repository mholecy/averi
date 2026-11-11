import { defaultDisplayFocus } from './android-wm.js';
import { everyNode, labelOf, rectCentre, type ChooserApp, type ChooserButton, type ChooserSheet, type UiNode } from './types.js';

/**
 * Android's "Open with" chooser in front after a deep link (D55; docs/adr/0041-an-android-link-names-the-chooser-in-front.md),
 * judged from the focused component alone, with no device call here: Android's counterpart of ios-system-alert.ts.
 *
 * `am start -a VIEW -d <url>` with no package is an implicit intent. When two activities handle the url and none is
 * the preferred one, Android starts its resolver instead of either app, and `am start` reports an activity started
 * (android-start.ts): the start was right, but which activity it started was never asked. So openDeepLink reads the
 * focus once after the start (CHOOSER_FOCUS_COMMAND) and asks chooserInFocus. Since D55b launch_app does the same
 * after its `-p` start (an intent scoped to the package, which two of its activities may handle), and after monkey's
 * refusal, where the chooser is only also in front: ADR 0041's D55b and D73 amendments. monkey itself starts over the
 * chooser, which goes (D73, on API 33), so its success reads nothing.
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
 * The chooser goes up as a fact (adapters/types.ts#AppHolder's `chooser`), and interact/app-holder-text.ts#appHolderText
 * words it (A10). What stays worded here is monkey's refusal: a thrown error of the adapter's, not an answer.
 *
 * Why it is safe to name: no app can own package `android` or `com.android.intentresolver`, so a positive match is
 * the platform's chooser in front, never an app's activity of the same name. Anything else, including no focus at
 * all, is undefined: openDeepLink then answers as before ("Opened"), never a warning without a match.
 */

/** The packages the platform's chooser runs in: the framework's, and the IntentResolver module's (later APIs). */
const CHOOSER_PACKAGES: ReadonlySet<string> = new Set(['android', 'com.android.intentresolver']);

/**
 * The chooser's class: ResolverActivity or ChooserActivity, fully named or short (`.ResolverActivity`) — the window
 * manager prints a class with its package or its leading dot, so a dot always comes before the name.
 */
const CHOOSER_CLASS = /\.(?:Resolver|Chooser)Activity$/;

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
 * (android-wm.ts#defaultDisplayFocus), so they are one display's pair: another display's chooser is not this link's.
 */
export function chooserInFocus(dump: string): string | undefined {
  const { app, window } = defaultDisplayFocus(dump);
  const component = app ?? window;
  return component !== undefined && isChooser(component) ? component : undefined;
}

/**
 * The advice in monkey's refusal (D55b, chooserAlsoInFront), the one sentence about the chooser the adapter still words:
 * a refusal is a thrown error, whose message the adapter builds, and the adapter may not import upward (ARCHITECTURE.md
 * §2). Its bytes are a launch's advice in interact/app-holder-text.ts#appHolderText, written twice for that reason and
 * pinned whole on each side. Neutral on whose intent the chooser answers: a chooser left up by another app's link reads the same.
 */
const REFUSAL_ADVICE =
  'Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one (never "Always": it changes ' +
  "the device's default for the intent it answers); press_key back drops the chooser. averi taps nothing itself.";

/**
 * The chooser beside monkey's refusal (D55b, D73): every refusal has its `** ` line, and the chooser was not its cause
 * on API 33 (with the launch's `--pct-… 0` flags monkey starts over it; `** No activities found to run` exits 252 with
 * it up or not). It is still what is in front (measured there), so it is named as also in front, with the advice. The
 * caller's message leads.
 */
export function chooserAlsoInFront(component: string): string {
  return `Android's chooser (${component}) is also in front. ${REFUSAL_ADVICE}`;
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

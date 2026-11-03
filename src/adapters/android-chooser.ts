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
 * after a link, `this intent` after a launch), `drops` what one BACK drops (`the link`, `the launch`). One wording for
 * open_deep_link (CHOOSER_ADVICE) and launch_app's `-p` start (launchChooserNote): D55b.
 */
export function chooserAdvice(defaultFor: string, drops: string): string {
  return (
    'Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one (never "Always": it ' +
    `changes the device's default for ${defaultFor}); press_key back drops ${drops}. averi taps nothing itself.`
  );
}

/**
 * launch_app's ⚠ note when the chooser is in front after its `-p` start (D55b; ADR 0041's D55b amendment): an intent
 * scoped to the package that two of its activities handle, none preferred (batch-11: 10 of 10, averi_lab API 33). The
 * headline stays "Launched" — D56's shape on iOS (ADR 0032's D56 amendment), the start did happen. `-p` scopes the
 * intent to the package, so the chooser offers only that app's own activities, and naming one (`nameTheActivity`:
 * where the call names it, the adapter's wording) starts it with `-n`, no chooser.
 */
export function launchChooserNote(packageName: string, component: string, nameTheActivity: string): string {
  return (
    `Android has not brought ${packageName} forward yet: its chooser (${component}) is in front, asking which of ` +
    `${packageName}'s activities takes the intent. ${chooserAdvice('this intent', 'the launch')} Naming the activity ` +
    `(${nameTheActivity}) starts it without the chooser.`
  );
}

/**
 * monkey's refusal when the chooser is in front (D55b): monkey starts nothing over it — exit 251 on API 33, 3 of 3 in
 * batch-11 — and its only `** ` line is the emulator's `** SYS_KEYS …` warning, not a reason, so the message names the
 * chooser as the cause instead of the install, and quotes no line (the ExecError cause keeps monkey's output).
 */
export function monkeyChooserRefusal(packageName: string, component: string): string {
  return (
    `monkey started nothing in ${packageName}: Android's chooser (${component}) is in front, and monkey starts ` +
    'nothing over it (exit 251 on API 33). Answer it (ui_snapshot, the app, "Just once") or press_key back to drop ' +
    'it, then launch again. averi taps nothing itself.'
  );
}

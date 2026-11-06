import type { AppHolder, ChooserButton, ChooserSheet, LinkAlert, LinkChooser, Point } from '../adapters/types.js';

/**
 * Every word averi says about what holds or may hold the app after a launch or a deep link (A10; ADR 0041's and ADR 0032's A10
 * amendments): one interface, `appHolderText`, over the adapters' closed answer (adapters/types.ts#AppHolder). The
 * detectors decide the facts, per platform (adapters/ios-foreground.ts, adapters/ios-system-alert.ts,
 * adapters/android-chooser.ts); these sentences are the one place they are worded. The holder's kind decides the
 * wording, an alert's or a chooser's, and no platform is asked: "iOS has not" belongs to an alert and "Android has not"
 * to a chooser, because those are the facts each platform reports.
 *
 * Why in interact/ rather than mcp/tool-text.ts: a launch's text is a line of the flow's trace too, and the flow engine
 * may not import mcp/ (ARCHITECTURE.md §2), the precedent being interact/fill-text.ts and interact/scroll-text.ts: the
 * judge emits facts, the renderer owns every sentence. Where each text goes is its callers': a link's headline or ⚠
 * line (mcp/tool-text.ts#deepLinkText), a launch's ⚠ line (flow/launch.ts#launchApp).
 */

/** What is held: the link a deep link opens, or the app a launch brings forward. */
export type HeldSubject = { link: string } | { app: string };

/**
 * Whether the answer names a holder: a link's reply then says that instead of "Opened" (mcp/tool-text.ts#deepLinkText).
 * A table over every kind, so a new kind does not compile until it is decided here.
 */
const NAMES_A_HOLDER: Record<AppHolder['holder'], boolean> = { none: false, alert: true, chooser: true, unknown: false };
export const holdsIt = (answer: AppHolder): boolean => NAMES_A_HOLDER[answer.holder];

/**
 * The text of `answer` for `subject`: a named holder's sentences, what the wait did not confirm (unknownText), and none
 * when there is nothing to say. Exhaustive: a new kind does not compile until it is worded.
 */
export function appHolderText(subject: HeldSubject, answer: AppHolder): string | undefined {
  switch (answer.holder) {
    case 'none':
      return undefined;
    case 'unknown':
      return unknownText(subject, answer);
    case 'alert':
      return alertText(subject, answer.alert);
    case 'chooser':
      return chooserText(subject, answer.chooser);
    default: {
      const unworded: never = answer;
      return unworded;
    }
  }
}

/** What every link lead advises (D49a): the alert averi did not find (D54 names one it finds), and what it blocks. */
const ANSWER_IT = '— take a screenshot, and if it shows a system alert, answer it (every launch stays behind it until then). ';

/**
 * A link's lead when the wait read another app to the bound: the app was not seen coming forward, and the likely why —
 * iOS's "Open in …?" confirmation, raised for a custom scheme whose app is not in front (batch-1 D), or another app. Not
 * "the alert is up": nothing here looked for it.
 */
const linkSaw = (app: string): string =>
  `averi did not see ${app} come forward after the link: iOS may be asking to confirm it ("Open in “…”?") or ` +
  `another app may be in front ${ANSWER_IT}`;

/** A link's lead when the wait could not tell which app is in front (review of D49a: no over-claim). */
const linkUnchecked = (app: string): string =>
  `averi could not check that ${app} came forward after the link: if iOS asks to confirm it ("Open in “…”?"), the ` +
  `link waits behind the alert ${ANSWER_IT}`;

/** A link's text when WebDriverAgent is not up: nothing asked, so nothing waited — said, not silent. */
const linkNotAsked = (app: string): string =>
  `whether ${app} came forward after the link was not checked (WebDriverAgent is not running yet) — if iOS asks ` +
  '"Open in “…”?", answer it (a screenshot shows it)';

/** After idb's tree read SpringBoard's to the bound: what a screenshot can still tell, which part of it is in front. */
const SPRINGBOARD_TREE = '. A screenshot does tell one thing here: whether a system alert is in front (answer it) or the home screen still is';

/**
 * The wait did not confirm the app, and knows no holder (D48, D49a): the wait's `detail` (about its tree source), led for
 * a link by what may hold it — never a bare "Opened" for a link that may wait behind iOS's "Open in …?". A WDA not up
 * says so for a link and nothing for a launch, which has no confirmation to ask for.
 */
function unknownText(subject: HeldSubject, answer: Extract<AppHolder, { holder: 'unknown' }>): string | undefined {
  const forLink = 'link' in subject;
  switch (answer.wait) {
    case 'not-asked':
      return forLink ? linkNotAsked(answer.app) : undefined;
    case 'saw':
    case 'unchecked': {
      const lead = !forLink ? '' : answer.wait === 'saw' ? linkSaw(answer.app) : linkUnchecked(answer.app);
      return `${lead}${answer.detail}${answer.springBoardTree === true ? SPRINGBOARD_TREE : ''}`;
    }
    default: {
      const unworded: never = answer;
      return unworded;
    }
  }
}

/**
 * The advice after an alert's buttons (D57; ADR 0032's D57 amendment): a tap by the chosen button's label first —
 * proven on a device (batch-7 B: `tap text:"Cancel"` and `text:"Open"` in 8 cases — Cancel and Open × idb and WDA ×
 * over SpringBoard and over Contacts, one run each — one Button matched each time) and settled and judged as every
 * selector tap is — or a tap at its x and y, the fallback for a label the selector grammar cannot write or two buttons
 * sharing one (batch-5 D49A tapped by coordinates); that averi taps nothing; and what the alert holds back (batch-2:
 * every launch after it stayed behind it). `<label>` is literal: the button list before it quotes every label.
 */
const ALERT_ADVICE =
  'Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y (averi taps nothing itself); ' +
  'every launch stays behind the alert until it is answered';

/**
 * An alert's buttons as the replies quote them: `buttons "Cancel" at (127, 474), "Open" at (275, 474)` — every label
 * verbatim, in tree order, with its centre.
 */
const alertButtonsText = (alert: LinkAlert): string =>
  `${alert.buttons.length === 1 ? 'button' : 'buttons'} ${alert.buttons.map((b) => `"${b.label}" at ${pointText(b.centre)}`).join(', ')}`;

/**
 * The alert, for a link (D54) and for a launch (D56). The title and every label are quoted verbatim, localised as iOS
 * shows them; which button opens the link is the agent's to read. "it asks" only for a link whose alert names its app
 * (`asksForApp`); any other alert is "a system alert", in no words of averi's own about opening. A launch is never "it
 * asks": the alert belongs to something earlier (a link), and may name another app. A launch's text ends with D48's read
 * again, since what comes forward once it is answered is unmeasured. No "3 s after": idb ends at the read that lists
 * it, WDA at the bound.
 */
function alertText(subject: HeldSubject, alert: LinkAlert): string {
  const isUp = `a system alert is up, "${alert.title}"`;
  const says = (what: string) => `${what} — ${alertButtonsText(alert)}. ${ALERT_ADVICE}`;
  return 'link' in subject
    ? `iOS has not opened ${subject.link} yet: ${says(alert.asksForApp ? `it asks "${alert.title}"` : isUp)}`
    : `iOS has not brought ${subject.app} forward yet: ${says(isUp)} — then read again before trusting a read`;
}

/**
 * The chooser, for a link (D55) and for a launch (D55b), the headline after a link and the ⚠ note after a `-p` start.
 * It says only what the read saw: after a launch, the chooser in front and the package not, neutral on whose intent it
 * answers, as a chooser left up by another app's link reads the same. Naming an activity starts it with `-n`, which a
 * package's own chooser cannot stop. With the `sheet` read (D55c) the sheet and its advice replace the plain advice;
 * without it, D55's and D55b's text byte for byte.
 */
function chooserText(subject: HeldSubject, chooser: LinkChooser): string {
  if ('link' in subject) {
    return (
      `Android has not opened ${subject.link} yet: its chooser (${chooser.component}) is in front, asking which app ` +
      `opens it. ${chooserAdvice(chooser, 'such links', 'the link')}`
    );
  }
  return (
    `Android has not brought ${subject.app} forward yet: its chooser (${chooser.component}) is in front, and ` +
    `${subject.app} is not. ${chooserAdvice(chooser, 'the intent it answers', 'the chooser')} Naming the activity ` +
    '(`activity:` on the launch step / launch_app) starts it without the chooser.'
  );
}

/**
 * The advice once the chooser is named: `defaultFor` is what "Always" would change the default for (`such links` after a
 * link, `the intent it answers` after a launch), `drops` what one BACK drops (`the link`, `the chooser`; measured: one
 * BACK dismissed it, batch-9). Its sheet read, the sheet then the advice beside it; else the agent picks the app, then
 * "Just once" (never "Always", which writes a preferred activity: a device change every later run would inherit). averi
 * taps nothing: which handler is meant is the test's business. The labels are AOSP's English ones. "if it shows one":
 * ResolverActivity asks for an app and then "Just once" or "Always" (batch-9); ChooserActivity, a share sheet's chooser,
 * opens the app tapped and has neither button (AOSP, not measured).
 */
function chooserAdvice({ sheet }: LinkChooser, defaultFor: string, drops: string): string {
  return sheet === undefined
    ? `Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one ${adviceEnd('"Always"', defaultFor, drops)}`
    : `${sheetSays(sheet)}. ${sheetAdvice(sheet, defaultFor, drops)}`;
}

/**
 * The advice beside a quoted sheet (D55c): tap the app's row at its x and y — by coordinates, as two rows may share a
 * label (the lab's both say "AveriLab"); one tap only selects the row, and enables the buttons when the tree marks them
 * disabled (batch-11, lab fact 13; in a tree with a row selected neither is marked, and the clause is left out) — then
 * "Just once" by its id, language-free (`id:button_once`, never `id:button_always`, which writes a preferred activity).
 */
function sheetAdvice(sheet: ChooserSheet, defaultFor: string, drops: string): string {
  const enables = sheet.once.disabled || sheet.always.disabled ? ' and enables the buttons' : '';
  return (
    `Tap the app's row at its x and y (one tap only selects it${enables}), then tap id:button_once ` +
    adviceEnd('id:button_always', defaultFor, drops)
  );
}

/** Both advices' ending: the button never to tap and why, what one BACK drops, and that averi taps nothing. */
const adviceEnd = (never: string, defaultFor: string, drops: string): string =>
  `(never ${never}: it changes the device's default for ${defaultFor}); press_key back drops ${drops}. averi taps nothing itself.`;

/**
 * The sheet as both replies quote it (D55c), one sentence after the reply's own: its title when it has one, the apps
 * with their rows' centres and the buttons with theirs, "(disabled)" on a button the tree marks so — `Its sheet "Open
 * with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and the buttons "Just
 * once" at (723, 2058) (disabled), "Always" at (936, 2058) (disabled)`. Every label verbatim; two rows may share one,
 * which is why the advice taps by coordinates.
 */
function sheetSays(sheet: ChooserSheet): string {
  const title = sheet.title === undefined ? '' : ` "${sheet.title}"`;
  const apps = sheet.apps.map((a) => `"${a.label}"${a.detail === undefined ? '' : ` ("${a.detail}")`} at ${pointText(a.centre)}`);
  const button = (b: ChooserButton) => `"${b.label}" at ${pointText(b.centre)}${b.disabled ? ' (disabled)' : ''}`;
  return (
    `Its sheet${title} lists the ${apps.length === 1 ? 'app' : 'apps'} ${apps.join(', ')} and the buttons ` +
    `${button(sheet.once)}, ${button(sheet.always)}`
  );
}

/** A point as the replies write it: `(x, y)`. */
const pointText = (p: Point): string => `(${p.x}, ${p.y})`;

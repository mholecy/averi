# 37. A value the adapter cannot type is refused before any device call

Status: accepted 2026-11-01 (backlog row D43, its first half D43a, docs/plans/2026-10-30-performance-backlog.md; bug
notes docs/bugs/2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md and
docs/bugs/2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii.md, which stay open). Changes
behaviour: a non-ASCII value is refused before the tap. It used to fail on the device.
Amended 2026-11-02 (D43a device run: the refusal holds on iOS idb, iOS wda and Android — see the amendment below).
Amended 2026-11-03 (D43: a project with the WDA tree source types what idb cannot through WebDriverAgent's `/wda/keys`;
every refusal names the remedy true for its adapter — see the D43 amendment below).
Amended 2026-11-03 (batch-11: D43 proven live — the last paragraph of the D43 amendment).
Amended 2026-11-12 (A41a: `IosAdapter.typeable` is asked of the tree source per call — under `auto` WDA's set until a
fallback to idb, idb's after it, and a fill checks the value again after its first read; ADR 0046).
Amended 2026-11-13 (A40: the pasteboard route stays rejected for idb, with the reasons found and the bar a reopening
must meet — the pasteboard entry under Rejected; ADR 0046's A40 amendment).

## Context

- **iOS.** `IosAdapter.typeText` sends `idb ui text` under both tree sources, because WDA serves only the tree
  (adapters/wda.ts: "taps/typing/install stay on idb/simctl"). idb maps the whole string through `KEY_MAP` before it
  sends anything (fb-idb `idb/common/hid.py#text_to_events`). `KEY_MAP` holds exactly 96 characters: U+0020–U+007E and
  `\n`, counted from the installed fb-idb on 2026-11-01. Any other character fails the whole call with exit 1 and a raw
  Python trace (`No keycode found for Š`). The field is not typed into. A fill had already tapped it, and with `clear`
  had emptied it, before that failure. See the D43 amendment below.
- **Android.** `AndroidAdapter.typeText` sends one `input text <ch>` per character. For a character outside the
  virtual key map, `KeyCharacterMap.getEvents` returns null and `input` exits 255 on an NPE. Every character before it
  has already landed, so the field is left half-typed: `Jan ` from `Jan Šťastný`, `O` from `O’Brien`.
- The only check before the device was the control-character refusal (interact/type-text.ts#assertTypeable, code review
  of 2026-10-07). It refuses C0 and DEL on both platforms before the field is resolved. Nothing checked the rest.
- The live golden filed this as KNOWN since D31: b1d and b7 read `loud-untouched` on iOS and `loud-changed` on Android.
  A banking app's names and addresses (Š, ť, ’, NBSP in a pasted amount) reach these paths every day.

## Decision

**What an adapter's `typeText` can type is a per-adapter fact, declared on the adapter: `DeviceAdapter.typeable`
(adapters/typeable.ts#Typeable). `assertTypeable` refuses a value holding any other character, after the
control-character check and before any device call.**

- **The declaration** is data: `refuses`, a `u`-flagged RegExp that matches one character the adapter cannot type, and
  `says`, the clause the refusal quotes. One function reads it (`refusalOf(text, typeable)`): the refusal of the first
  character it cannot type, or undefined. The printable-ASCII class is defined once (`PRINTABLE_ASCII`), and iOS's set
  is derived from it with `\n` added. It is REQUIRED on the interface, so an adapter that does not say what it types
  does not compile, and the test fake declares it too (tests/helpers/fake.ts `FAKE_TYPEABLE`, printable ASCII, as both
  real adapters). It is data and not a method because the flow's read hand-off wraps the adapter in a Proxy that turns
  every method it does not class `reads` into an async action (ui-tree/read-handoff.ts#watch). A synchronous
  `untypeable(value)` method would return a Promise there, and every value would read as refused. Classing it `reads`
  would keep it synchronous, but would mislabel a pure check as a device read. `ADAPTER_SURFACE` classes `typeable` as a
  `fact`.
- **What each platform types:**
  - iOS, both tree sources: printable ASCII (U+0020–U+007E) and `\n`, which is idb's `KEY_MAP`. The `\n` is idb's fact,
    kept in the declaration. interact/ still refuses it first as a control character, so the Return key stays
    `pressKey('enter')`, as before. See the D43 amendment below.
  - Android: printable ASCII (U+0020–U+007E). This is conservative. An extended letter in the virtual key map (`é`) is
    unmeasured, so it is refused too.
- **Where:** `assertTypeable(value, adapter.typeable)`. Its two callers cover every path that ends in
  `adapter.typeText`:
  - `fillField` calls it before the field is resolved. That covers the type_text tool with a selector and the flow's
    `fill:` step. The fill's retype of a dropped tail (ADR 0023) is a suffix of the same value.
  - `typeIntoFocused` covers the type_text tool without a selector and the flow's `type:` step.
  - The flow's `type_pin:` types only the digits `[0-9]` it keeps (`\D` is stripped), which are ASCII by construction.
  - There is no tree read, keyboard dismissal, tap, clear or keystroke before the refusal. A fill's refusal stays a
    `FillValueFailure` marked `refused`, which `optional:` does not skip, like the control character's. A `type:`
    step's refusal is a plain error, as before.
- **Android's `typeText`** checks the same declaration again, defensively, before its first `input text`. A caller that
  bypasses interact/ cannot half-type. It already did this for a control character. iOS's `typeText` has no check of its
  own: idb fails all or nothing per call (it maps the whole string before it sends a key), so nothing is half-typed.
  (Only the split typing of an app seen dropping a tail, ADR 0023's D24 amendment, sends its first character in a call
  of its own; a direct caller there could leave that one, and interact/ refuses before it.)
- **The message** names the first refused character by code point, and shows it where it is visible: `U+0160 'Š'`. A
  space other than U+0020 is named as one, and a combining or invisible character gets its code point alone. The
  message never includes the value around the character, since a value may be a credential. It says what the adapter
  types and why, that nothing was sent, and that there is no other typing path yet:

  ```text
  cannot type U+0160 'Š': on iOS averi types only printable ASCII (U+0020–U+007E): `idb ui text` has no key for any
  other character and fails the whole call. Refused before anything was sent — nothing tapped, cleared or typed. averi
  has no other typing path yet (ADR 0037): use a value without it, or enter it by hand.
  ```

- **Cost:** an ASCII value pays one regex test per call. It makes no device call and takes no extra wait.

## Rejected

- **The pasteboard** (`simctl pbcopy` then paste, or Android's clipboard then paste). It overwrites the user's
  pasteboard, which may hold what they copied. It needs a Cmd+V chord or a long-press menu that averi does not drive.
  The simulator's pasteboard may sync to the host's.
  Looked at again for A40 (2026-11-13), for an iOS adapter on idb, without a device run. It is still rejected:
  - idb has no pasteboard command and no chord. `ui key-sequence` presses one key after another and never holds one,
    so Cmd+V would need a new HID verb in averi's idb helper and in its argv allowlist (`adapters/idb.ts`).
  - `simctl pbcopy` and the paste are two calls. Another simulator, or the host's pasteboard sync, can write the
    pasteboard between them, and the field then takes text averi did not choose. Restoring the user's pasteboard
    after it (`simctl pbpaste`) keeps its text only.
  - iOS 16 and later can show an "Allow Paste" alert when an app reads the pasteboard on its own. A paste through
    UIKit's `paste:` (the edit menu, or Cmd+V) is expected not to show it. This is Apple's stated behaviour, not
    measured here. An engine that reads the pasteboard itself, as Flutter's `Clipboard.getData` and some web views
    do, can show the alert, which then covers the fill.
  - The landing rule would judge a paste as it judges typing, since interact/fill-landing.ts judges the field's reading,
    not how the text got there. But a dropped tail (ADR 0023) is typed again through idb, which cannot type a non-ASCII
    tail, so the retype that makes a fill recover would not exist for a paste. A field that refuses or reformats a paste
    (a length limit, an input mask: ADR 0034) would be changed and still miss, where the refusal changes nothing.
  - When it would matter at all: ADR 0046's A40 amendment, "When it matters".

  **The bar for reopening it** is a device probe on the lab simulator, before any code. `simctl pbcopy` and a
  helper-sent Cmd+V must fill form-basic's b1d and b7 values exactly, 20 of 20, in each field kind: a UIKit field
  (form-basic), the React Native lab's rn-field and a SwiftUI `TextField`, plus a Flutter field if the lab gains one.
  The tree must show 0 "Allow Paste" alerts over all of them. The probe must run with the host's pasteboard sync on
  and off. The pasteboard must read back as it was before each fill. A field with a length limit or an input mask
  must be refused, or left exactly as it was.
- **The ADB keyboard IME** (a third-party APK that types broadcast text). It installs an app averi does not own and
  switches the IME away from the one averi's typing was measured against (Gboard: the commit nudge, `typingDelivery`,
  the floating-keyboard cases).
- **uiautomator `setText`** (`UiObject2.setText`). It needs an on-device instrumentation helper, and it REPLACES the
  field's text instead of appending to it, which breaks a no-clear fill's contract and the masked-append rule.
- **Typing what can be typed and skipping the rest.** The field would hold a value the agent did not ask for, and a
  read-back would fail after the field had already changed. The point of the refusal is that nothing changes.

## Later

- **WDA `/wda/keys`** is the candidate real path for projects on the WDA tree source. It types Unicode text through
  XCTest. It is bound to a WDA session, and adapters/wda.ts keeps all input on idb ("WDA input would drag in session
  management"). That project would then declare a wider `typeable` for those adapters. No caller changes. See the D43 amendment below.
- An Android path for non-ASCII is open: none of the options above is acceptable as it stands.
- The two bug notes stay open until one of these lands. See the D43 amendment below.

## Consequences

- b1d and b7 in the live golden: on Android they are now refused before the tap, the field as the launch left it. Their
  KNOWN entries in scripts/truth/live-known.ts pin `loud-untouched` on `refused`, as on iOS. Every committed Android
  forms record predates this change and reads them `loud-changed`, so tests/truth/live-rejudge.test.ts flags those
  records (`preD43a`) and asserts exactly those two lines NOT known (`PRE_D43A_LOUD`). A LOUD fails no run, so the exit
  stays 0. The post-D43a shape, the field untouched, is pinned to rejudge known with no NOT known. The next device
  run's record replaces D40's.
- A new live case, p7: a no-clear fill of `Š` into form-prefilled's name. It must be refused before anything is sent,
  with the prefill kept (`refusedKept` in scripts/truth/live-forms.ts). No device has run it yet.
- The test fake types printable ASCII by default. A test of what is typed, rather than what is refused, sets
  `PERMISSIVE`.
- Golden replay never types, so its rows do not move. See the D43 amendment below.

Pinned by tests/adapters/typeable.test.ts (each adapter's declaration, both iOS tree sources; Android's direct
`typeText`), tests/interact/type-text.test.ts (the message), tests/interact/fill.test.ts (no device call at all,
through a recording proxy), tests/mcp/tools.test.ts (type_text with and without a selector), tests/flow/engine.test.ts
(`type:` and `fill:`), and tests/truth/live-forms.test.ts (p7's judge). See the D43 amendment below.

## Amendment: device run (2026-11-02, backlog D43)

The forms cases b1d, b2, b3, b7, p1, p2 and p7 ran on the lab devices at main 0262c69d under iOS idb, iOS wda and
Android (docs/truth/live-records/ios-idb-forms-d43a-1.json, ios-wda-forms-d43a-1.json, android-forms-d43a-1.json). Each
record rejudges to 7 cases, 5 ok, 2 loud, 0 mismatches. b1d and b7 were refused before anything was sent, the field
untouched (`loud-untouched`, known); on Android that replaces D40's half-typed `loud-changed`. p7 was refused with the
prefill kept. The ASCII cases b2, b3, p1 and p2 are ok. tests/truth/live-rejudge.test.ts pins the three records. The
real typing path ("Later") stays open. See the D43 amendment below.

## Amendment: a WDA project types non-ASCII text through `/wda/keys` (2026-11-03, D43)

**Context.** "Later"'s first bullet. Batch-9 typed `Šťastný` and `O’Brien` (U+2019) exactly with a raw
`POST /session/:id/wda/keys`, while averi refused them on a WDA project with "averi has no other typing path yet" —
false there. WDA 16.1.7's handler joins `value[]` and calls `FBTypeText`: one synthesized event record, no element and no
focus check, so it types into the first responder as `idb ui text` does. The route is session-bound; the sessionless
`/source` does not see a session. Before any averi code, batch-10's gate (2026-11-03, main 139256a2, iOS 27.0 lab
simulator, iPhone 17, raw `/wda/keys`) passed:
- G1, delivered on return: 20/20 values of 6–40 characters, each focused by an idb tap, held the whole value on the
  sessionless `/source` read right after `/wda/keys` returned (that read 307 ms median), and on the lab's model at 1.5 s.
- G2, by category, exact on the model: Latin with diacritics 3/3, typographic punctuation 3/3, Cyrillic 2/2, Greek 2/2,
  Han 2/2, symbols (€ § © ® ™) 2/2. Info only: NBSP and U+202F 2/2, an emoji 1/1, a combining mark kept decomposed 1/1.
- G3, timing (median of 5, ASCII, by length 1/7/20/40): `/wda/keys` 324/330/642/967 ms against `idb ui text`
  196/191/212/225 ms — about 300 ms plus 16 ms a character against a flat ~200 ms; non-ASCII costs the same per length;
  the session POST 2 ms.
- G4, the session: made with `forceSimulatorSoftwareKeyboardPresence: false`, it changed no keyboard pref, none of the
  three simulator domains, and not the sessionless `/source` (S1 ≡ S2, no keyboard listed); `/wda/keys` typed with no
  software keyboard shown. After a runner restart (3.5 s) the old session's `/wda/keys` answered HTTP 404 "invalid
  session id" with nothing typed, and a new session (3 ms) typed.
- G5, React Native: AveriLabRN's `rn-field`, `Jan Šťastný Bratislava` (22 characters), 10/10 exact, no tail dropped.

**Decision.** Option A of the analysis, narrowed to what the gate measured:
- **Routing, per call** (adapters/ios-typing.ts#typingPathOf): idb for every text idb can type — unchanged byte for
  byte, the D24 split and the D25 timings included — and the tree source's typer for any other. Only WDA's source has
  one (`IosTreeSource.typeText`, optional, as `systemAlert`); IosAdapter binds it once, in its constructor, and both its
  `typeable` and its route come from that one choice. Over a source without a typer (idb's, the differential harness's
  recorded one) every text goes to idb, as before. Per call, not per fill: a fill's dropped tail is routed by the tail's
  own characters, and both paths type at the caret of the same first responder. G3 is why ASCII stays on idb: 1.7×
  faster at one character, 4.3× at 40.
- **No D24 split on the WDA path**: one call, whole (G5 dropped no tail). The fill's retype stays the net, and
  `typingDelivery: on-return` holds for it (G1).
- **`WdaServer.keys(text)`** (adapters/wda.ts): it starts WDA when it is not up, then sends
  `POST /session/:id/wda/keys {value: [...text]}` on one session per WDA start (`upGeneration`), made once with
  `forceSimulatorSoftwareKeyboardPresence: false` (G4) and forgotten by `stop()` and `shutdown()`. Budgets: the session
  10 s, the typing 2 s + 50 ms a character (about three times G3's).
  - A lost session is made again once and the text sent once more. Lost means HTTP 404 — any 404, not only one saying
    "invalid session id" — or "invalid session id" under any status. Decided as safe though only G4's 404 was
    measured: a 404 is WDA's routing refusing the request before any handler runs, so nothing is typed on one (an
    unknown route answers 404 too, and its retry fails the same way, nothing typed). Two typings at once that both meet
    a lost session make one new session between them: a typing forgets only the session it was sent on.
  - A request that did not complete (its budget ran out, or the connection went) is never sent again, because it may
    have typed part of the text: it fails saying so.
  - Any other error answer fails with its HTTP status and WDA's `value.error` alone, the port and the log — not WDA's
    message, which is NSError's description and may hold the value escaped (`\U0161`) or in part.

  `FetchFn` takes a POST's method, headers and body; its GET callers are unchanged. `WdaTreeSource.typeText` delegates
  to `keys` and gives the released error after `dispose()`, as `read()` does.
- **The set** (`IosAdapter.typeable`, decided by the source's typer, not its kind): over WDA's source `WDA_TYPEABLE` —
  idb's set, plus, of the Basic Multilingual Plane:
  - the letters (`\p{L}`) of the Latin, Greek, Cyrillic and Han scripts;
  - numbers, punctuation and symbols (`\p{N}`, `\p{P}`, `\p{S}`) of the Common script only: a number, mark or symbol
    of another script stays refused — U+3007 (〇, Han's number zero) among them;
  - of the spaces (`\p{Zs}`) only NBSP (U+00A0) and the narrow NBSP (U+202F), beside U+0020: every other space stays
    refused — U+2002 and U+3000 among them;
  - minus `\p{Extended_Pictographic}` except © ® ™ (measured);
  - minus the Halfwidth and Fullwidth Forms (U+FF00–U+FFEF), Latin and Common by script but unmeasured, and the
    Specials (U+FFF0–U+FFFF, U+FFFC and U+FFFD among them), unmeasured too.

  Everything else is refused: outside the BMP, combining marks, format characters, private use, unassigned, a Common
  letter (µ), every script not measured (Arabic, Hebrew, Devanagari, Thai, Hangul, kana, …). The script and space limits
  are decisions, not measurements: none of the characters they keep out was typed by the gate. The refusal says such a
  character is not measured through `/wda/keys`. BMP-only keeps every UTF-16 count and tail slice of a fill exact, so
  fill-type, fill-landing and fill-text are untouched.
- **The replies**: `Typeable.otherPath`, a plain sentence true for the adapter, replaces the hard-coded "averi has no
  other typing path yet (ADR 0037): use a value without it, or enter it by hand." `Typeable.widerPath`
  (`Pick<Typeable, 'refuses'>` and `blockedBy(char)`) is idb's: WDA's set, and the remedy said in its place for a value
  WDA would refuse too — not only its first character (`Šťastný 😀`, or © followed by U+FE0F):
  - idb, a value WDA's set takes whole (`otherPath`): "A project with `ios.treeSource: wda` types it through
    WebDriverAgent (ADR 0037); otherwise use a value without it, or enter it by hand."
  - idb, any other (`blockedBy`): "averi has no typing path on iOS for this value (WebDriverAgent's `/wda/keys` is not
    measured for U+1F600 '😀'; ADR 0037): use a value without it, or enter it by hand." It names the first character
    WDA refuses, in the refusal's own form — for `Šťastný 😀` the refusal leads with `U+0160 'Š'`, which WDA types, and
    this names `U+1F600 '😀'`, the one that blocks every iOS path. Never the value.
  - Android: "averi has no typing path for it on Android (no shell clipboard setter on API 33; ADR 0037): use a value
    without it, or enter it by hand."
  - WDA: "Use a value without it, or enter it by hand."

  The `says` clauses of idb and Android are unchanged, and so is every other reply. The type_text tool's description
  and the skill's references say what each path types, not "on both platforms".
- **A `/wda/keys` failure inside a fill** is an error of `adapter.typeText`, as an idb failure is: unmarked (fill.ts),
  so `optional:` skips it. Not wrapped as `did-not-land` here (residual 7).

**Corrections.**
- Context's iOS bullet and the Decision's "iOS, both tree sources": over WDA's tree source the adapter declares
  `WDA_TYPEABLE` and types through `/wda/keys` what idb cannot; idb's set (now in adapters/ios-typing.ts) holds for
  idb's source and for the differential harness's recorded one.
- "The message" ends with the adapter's `otherPath` (or idb's `blockedBy`), not with "averi has no other typing path
  yet".
- "Later", WDA `/wda/keys`: done for projects on the WDA tree source. The iOS bug note stays open for idb projects; for
  WDA projects it closes with the device run of b1d, b7 and p7w.
- Consequences, "Golden replay never types": the replay types `'1'` into every textfield it fills
  (scripts/differential/differential.ts). See Golden/Live below.
- The Pinned-by paragraph: D43's tests are listed at the end of this amendment.
- The D43a amendment's "The real typing path ("Later") stays open": done for the WDA tree source, as above.

**Consequences.**
- The cost falls only on a value idb refuses, which was refused before: about 300 ms + 16 ms a character for each
  typing through WDA, against idb's ~200 ms (G3) — `Šťastný` about 0.33 s, 20 characters about 0.64 s, 40 about 0.97 s
  — plus one session per WDA start (2–3 ms). A `type_text` without a selector as the first call after the server
  starts brings WDA up first (minutes on a first build), as a WDA project's first `ui_snapshot` does.
- Agents on WDA projects get `Filled …`, verified by the existing read-back, where they got a refusal; idb projects get
  a true remedy; Android says plainly that there is none.

**Mutation-checked**: adapters/ios-typing.ts (100 %, floor 98) and adapters/typeable.ts (89.74 %, floor 88: four
equivalent anchor survivors in `named()`) join the mutation run (ADR 0038's D43 amendment). Stryker does not reach the
two iOS sets, built with `new RegExp` (residual 9); 22 hand mutants, each killed: the router always idb, always wda or
flipped; the set by the source's kind, or always idb's; WDA's set without the BMP guard, with `\p{M}`, with `\p{Cf}`,
with the Specials; a new session on every typing; a retry after a timeout; no retry on a lost session; a lost session
forgotten though a typing beside it made the next; the keyboard capability dropped; the D24 split on the WDA path;
Android's and idb's remedies swapped; `dispose` unchecked; idb's wider remedy never or always said, judged by the first
character, or naming the first refused character instead of the one WDA refuses; WDA's message quoted. One equivalent
mutant, `value: [text]` for `[...text]` (WDA joins `value[]`), is noted and not pinned.

**Golden/Live.** The golden replay types `'1'`, ASCII, so it stays on idb, and the recorded source has no typer: golden
Changed 0 against main. Live (not yet run on a device): b1d and b7 under `ios wda` are struck off
scripts/truth/live-known.ts, ok expected; every WDA forms record committed before D43 reads them as a LOUD no entry
holds (tests/truth/live-rejudge.test.ts, `PRE_D43_WDA_LOUD`). p7 runs under idb and uiautomator only. A new p7w, the
same no-clear fill of `Š` into form-prefilled's name under WDA, must hold the prefill with `Š` appended (`holds`).
See the batch-11 paragraph below.

**Residuals, stated:**
1. Measured on iOS 27.0 only, on the iPhone 17 simulator with WDA 16.1.7: the native SwiftUI form-basic name field and
   the RN lab's `rn-field`. Other iOS versions, UIKit fields, multi-line and secure fields are unmeasured.
2. The classes are measured by 2–3 values each (adapters/ios-typing.ts lists them). Their other members are inferred
   from the class, not measured: Han's Extension A, Common numbers beyond the digits (½ ² ³), arrows, box drawing,
   mathematical and other symbols (∑ ✓ ★), and the punctuation not among the measured ’ “ ” ‘ – — …. An emoji (1/1) and a
   combining mark (1/1, kept decomposed; normalisation not judged) stay refused as too thin. What the set keeps out by
   decision (another script's numbers and marks, the other spaces, the Halfwidth and Fullwidth Forms, the Specials) is
   unmeasured too. A later row may widen the set with a corpus run.
3. The session: one per WDA start, the one averi holds (making it ends any other session on that WDA, whose port is
   averi's own). A `/wda/keys` past its budget is never retried, so a very slow runner may leave part of a text, said
   so in the error. An MCP call cancelled while it types does not stop it: the request runs on until it answers or
   `keysTimeoutMs` runs out, as an `idb ui text` runs on to its end. The retry on a plain 404 rests on WDA's routing,
   not on a measurement beyond G4's.
4. React Native: `rn-field` 10/10 with no tail dropped, so no D24 split on the WDA path; other RN versions and fields
   are unmeasured.
5. A WDA runner exit clears com.apple.Accessibility's `AccessibilityEnabled`, `ApplicationAccessibilityEnabled` and
   `AutomationEnabled` (G4's restore). These are the runner's own keys, set while it is live and cleared when it exits:
   existing WDA behaviour, not the session's — averi's session changes none of them.
6. The host's `ConnectHardwareKeyboard` was not read in G4, and `/wda/keys` with the hardware keyboard connected, or
   with nothing focused (the code suggests it answers OK and nothing lands; a fill then fails as unchanged), is
   unmeasured.
7. A `/wda/keys` failure during a fill is unmarked, so `optional:` skips it although the field was tapped and may hold
   part of the text — as for any `typeText` error (fill.ts, the known gap).
8. Android: no path on API 33; API 34+ `cmd clipboard` is unmeasured. Its bug note stays open.
9. Stryker's regex mutator does not reach a RegExp built with `new RegExp`, as both iOS sets are: their classes are
   pinned by the hand mutants and the per-character tests, not by the mutation score.

Pinned by tests/adapters/ios-typing.test.ts (the router, both sets per character and category, the remedies),
tests/adapters/typeable.test.ts (the set by the source's typer, not its kind), tests/adapters/ios.test.ts (the routing,
the D24 split on idb only), tests/adapters/wda.test.ts (`keys`: the session, its capabilities, reuse, a restart, the
retry on a lost session, two at once, none after a timeout, the budgets, WDA's error without its message),
tests/adapters/wda-tree-source.test.ts (the delegation, the released error), tests/interact/type-text.test.ts (each
adapter's remedy), tests/interact/fill.test.ts, tests/mcp/tools.test.ts and tests/flow/engine.test.ts (typed over
WDA's set, refused over idb's), tests/mcp/tool-descriptions.test.ts, and tests/truth/live-forms.test.ts and
live-rejudge.test.ts (b1d, b7, p7, p7w).

**Proven live** (batch-11, 2026-11-03, main a5fefd32, the lab simulator iOS 27.0 and averi_lab API 33; `live.ts --groups
forms` with the D43 cases, two runs on each of wda, idb and uiautomator): p7w, b1d and b7 ok 2/2 under `ios wda` —
`Filled …` (11, 19 and 1 character[s]), `/wda/keys` landing `Š`, the diacritics and the typographic text; p7 ok 2/2
under idb and under uiautomator — refused before anything was sent, the prefill kept, the reply naming U+0160 and the
adapter. The WDA window's settings were restored key by key — the runner exit flipped com.apple.Accessibility's three
keys again (residual 5) — and still equalled their backups at the end. Residual 8 (Android) stands.

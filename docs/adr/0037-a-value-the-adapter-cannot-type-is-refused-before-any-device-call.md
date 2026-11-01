# 37. A value the adapter cannot type is refused before any device call

Status: accepted 2026-11-01 (backlog row D43, its first half D43a, docs/plans/2026-10-30-performance-backlog.md; bug
notes docs/bugs/2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md and
docs/bugs/2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii.md, which stay open). Changes
behaviour: a non-ASCII value is refused before the tap. It used to fail on the device.

## Context

- **iOS.** `IosAdapter.typeText` sends `idb ui text` under both tree sources, because WDA serves only the tree
  (adapters/wda.ts: "taps/typing/install stay on idb/simctl"). idb maps the whole string through `KEY_MAP` before it
  sends anything (fb-idb `idb/common/hid.py#text_to_events`). `KEY_MAP` holds exactly 96 characters: U+0020–U+007E and
  `\n`, counted from the installed fb-idb on 2026-11-01. Any other character fails the whole call with exit 1 and a raw
  Python trace (`No keycode found for Š`). The field is not typed into. A fill had already tapped it, and with `clear`
  had emptied it, before that failure.
- **Android.** `AndroidAdapter.typeText` sends one `input text <ch>` per character. For a character outside the
  virtual key map, `KeyCharacterMap.getEvents` returns null and `input` exits 255 on an NPE. Every character before it
  has already landed, so the field is left half-typed: `Jan ` from `Jan Šťastný`, `O` from `O’Brien`.
- The only check before the device was the control-character refusal (interact/type-text.ts#assertTypeable, code review of
  2026-10-07). It refuses C0 and DEL on both platforms before the field is resolved. Nothing checked the rest.
- The live golden filed this as KNOWN since D31: b1d and b7 read `loud-untouched` on iOS and `loud-changed` on Android.
  A banking app's names and addresses (Š, ť, ’, NBSP in a pasted amount) reach these paths every day.

## Decision

**What an adapter's `typeText` can type is a per-adapter fact, declared on the adapter: `DeviceAdapter.typeable`
(adapters/typeable.ts#Typeable). `assertTypeable` refuses a value holding any other character, after the
control-character check and before any device call.**

- **The declaration** is data: `refuses`, a `u`-flagged RegExp that matches one character the adapter cannot type, and
  `says`, the clause the refusal quotes. One function reads it (`refusalOf(text, typeable)`): the refusal of the
  first character it cannot type, or undefined. The printable-ASCII class is defined once (`PRINTABLE_ASCII`), and
  iOS's set is derived from it with `\n` added. It is REQUIRED on the interface, so an adapter that does not say what it types does not
  compile, and the test fake declares it too (tests/helpers/fake.ts `FAKE_TYPEABLE`, printable ASCII, as both real
  adapters). It is data and not a method because the flow's read hand-off wraps the adapter in a Proxy that turns every
  method it does not class `reads` into an async action (ui-tree/read-handoff.ts#watch). A synchronous
  `untypeable(value)` method would return a Promise there, and every value would read as refused. Classing it `reads`
  would keep it synchronous, but would mislabel a pure check as a device read. `ADAPTER_SURFACE` classes `typeable` as
  a `fact`.
- **What each platform types:**
  - iOS, both tree sources: printable ASCII (U+0020–U+007E) and `\n`, which is idb's `KEY_MAP`. The `\n` is idb's fact,
    kept in the declaration. interact/ still refuses it first as a control character, so the Return key stays
    `pressKey('enter')`, as before.
  - Android: printable ASCII (U+0020–U+007E). This is conservative. An extended letter in the virtual key map (`é`) is
    unmeasured, so it is refused too.
- **Where:** `assertTypeable(value, adapter.typeable)`. Its two callers cover every path that ends in `adapter.typeText`:
  - `fillField` calls it before the field is resolved. That covers the type_text tool with a selector and the flow's
    `fill:` step. The fill's retype of a dropped tail (ADR 0023) is a suffix of the same value.
  - `typeIntoFocused` covers the type_text tool without a selector and the flow's `type:` step.
  - The flow's `type_pin:` types only the digits `[0-9]` it keeps (`\D` is stripped), which are ASCII by construction.
  - There is no tree read, keyboard dismissal, tap, clear or keystroke before the refusal. A fill's refusal stays a
    `FillValueFailure` marked `refused`, which `optional:` does not skip, like the control character's. A `type:`
    step's refusal is a plain error, as before.
- **Android's `typeText`** checks the same declaration again, defensively, before its first `input text`. A caller
  that bypasses interact/ cannot half-type. It already did this for a control character. iOS's `typeText` has no check
  of its own: idb fails all or nothing per call (it maps the whole string before it sends a key), so nothing is half-typed. (Only
  the split typing of an app seen dropping a tail, ADR 0023's D24 amendment, sends its first character in a call of
  its own; a direct caller there could leave that one, and interact/ refuses before it.)
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
  management"). That project would then declare a wider `typeable` for those adapters. No caller changes.
- An Android path for non-ASCII is open: none of the options above is acceptable as it stands.
- The two bug notes stay open until one of these lands.

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
- Golden replay never types, so its rows do not move.

Pinned by tests/adapters/typeable.test.ts (each adapter's declaration, both iOS tree sources; Android's direct
`typeText`), tests/interact/type-text.test.ts (the message), tests/interact/fill.test.ts (no device call at all,
through a recording proxy), tests/mcp/tools.test.ts (type_text with and without a selector), tests/flow/engine.test.ts
(`type:` and `fill:`), and tests/truth/live-forms.test.ts (p7's judge).

# 28. A fill re-reads after focus only where focus can change the count

Status: accepted 2026-10-31 (performance backlog item D8, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's decision on the owner's standing: fast AND stable — a fill that reports success on the wrong field or
misses a transformed value is unacceptable). Implemented in 5ea9bfd2…546c8804, merged 1083523e.

## Context

- The post-focus re-read (`interact/fill.ts`, the `refetchNode()` after the focus tap and its 350 ms delay) exists for
  MASKED fields (`5af92b0f`, docs/bugs/2026-09-18-handoff-run5-and-finportal-login-findings.md): Android autofill
  populates a password field on focus, and a re-entry screen clears one on focus. The masked read-back is compared by
  LENGTH, so the count it starts from must be the one after focus, not the pre-tap tree's.
- It ran on every fill of a value without `clear` into a field that read empty (or masked) before the tap — so on
  every plain empty field too, where no length rule is asked. One tree read: ≈ 2.3 s on Android.
- What the re-read also feeds, besides the masked count: `lastTree`, which becomes `screenBeforeTyping` (the screen
  sameField's twin fallback must stay on after typing); `shownBeforeTyping` (the dropped-tail prior, the "did not
  change" wording); and the other inputs `whereTyped` compares (`interact/fill-type.ts`).

## Decision

**Parsers report `UiNode.secure` (`adapters/types.ts`); absent is unknown.**
- uiautomator: the `password` attribute (`"true"`/`"false"` on every node of the API 33 dump), read on text inputs only.
- WDA: the type — `SecureTextField` true, `TextField`/`TextView` false.
- idb, on a `TextField`/`TextView` only: `traits` naming `SecureTextField` or `subrole` `AXSecureTextField` true (idb
  types a secure field `TextField`); one whose traits were printed and say neither false.
- Unknown: every other role, an iOS search field (`other`), a source or dump that does not print it.
- Pinned on the lab's form-basic and form-prefilled captures, all three sources: the PIN true, the four others false
  (tests/adapters/secure-field.test.ts).

**The re-read is skipped only for a value typed without `clear` into an EMPTY input said plain (`secure === false`),
named by a sole `id` selector (`ui-tree/selectors.ts#soleIdOf`), on an adapter whose typing may arrive late
(`DeviceAdapter.typingDelivery` not `on-return`: Android).** That is the one case where nothing it feeds can change
the verdict:
- no masked count is asked — a plain field's read-back is compared by content;
- an `id` keeps matching through typing, so the twin fallback (which the skip leaves off: `screenBeforeTyping` is
  `null`) is never needed; a label, hint or value selector may stop matching once the field's text changes, so those
  keep the re-read;
- the field read empty before the tap, and the empty prior is taken as is;
- the other inputs `whereTyped` compares are read off the resolution's tree, keyed by rect. A layout that moves on
  focus (keyboard avoidance) then reads every one of them gone, `unproven`. That proof gates only the dropped tail's
  retype (docs/adr/0023-fill-types-a-dropped-tail-again.md), which only an `on-return` adapter does: so **iOS keeps the
  re-read** (pinned: tests/interact/fill.test.ts "kept on-return: a layout that moves on focus…" — rects up 100 on
  focus, the first typing keeping 3 of 9: "landed, retyped [6]" with the re-read, "typed 9 characters but the field
  shows 3" without), and Android, which never retypes a tail, loses nothing.

Everything else is read as before: a masked pre-read, a secure field, an unknown one, any selector but a sole `id`,
`clear`, iOS. `screenBeforeTyping` is NOT seeded from the pre-tap tree: a field's own clear button appearing on focus
changes that screen's identity (docs/bugs/2026-10-09-ios-fill-screen-changed-from-fields-own-clear-button.md). The
pre-tap tree only WORDS a field lost after typing: compared with the screen it was resolved on, `screen-changed` (a
code box that navigates on its last digit) or `unmatched`; the twin fallback stays off.

**A field said plain that reads as bullets FAILS unless it shows exactly the typed length.** Where the re-read was
skipped, what the field held after focus was never read, so the length rule's `held + typed` would start from 0: five
autofilled bullets and two dropped keys of `password` (5 + 6 = 11 ≥ 8) would pass. Instead any other length is a
mismatch whose error says the field masks though its source said plain, and to retry with `clear: true`.

The 350 ms focus delay stays.

## Why it is safe (priority 1 first)

- The skip adds no way for a fill to pass that the re-read would have failed, except the residual (R1) below. A plain
  read-back is compared to the value from fresh reads of the field found by its id, as before (the pre-typing count
  is not part of that comparison). A masked read-back passes only at exactly the typed length — the one reading that
  needs no count. A dropped tail is never retyped on Android, so `whereTyped` decides nothing there.
- A wrong `false` (a source that says plain of a field that masks) turns the masked-append warning the re-read would
  have given into a failure — fail-safe, except (R1).

## Costs accepted

- (C1) A plain field that INSERTS text on focus (a `+421 ` prefix) and takes none of the typing is reported as a
  length mismatch, not as "the field did not change" (`shownBeforeTyping` was the empty pre-tap reading). Every key
  landing still passes (`includes`).
- (C2) An autofilled field said plain fails where the re-read would have passed it with the masked-append warning.

## Residual

- (R1) A source that WRONGLY says plain of a masking field (a Compose field with a custom `VisualTransformation`
  dumps `password="false"`), an autofill of N bullets on focus, and exactly N dropped keys: the field shows the typed
  length and the fill passes silently, where the re-read (held N, so `N + typed` expected) would have failed it. No
  read-back can tell it apart: bullets carry no content. Accepted: it needs a wrong source word, an autofill and a
  coincidental drop count at once. Pinned as such: tests/interact/fill.test.ts "accepted residual (R1)…".
- React Native's `secureTextEntry` on iOS: unmeasured on WDA and idb — no captured fixture holds an RN secure field —
  so whether either source names it secure is unknown. It concerns only the parsers' word, not the skip: iOS keeps the
  re-read whatever the word. On Android an RN secure `TextInput` dumps as an `EditText`; its `password` attribute is
  likewise unmeasured, and a `false` there would meet the bullets rule above.

## Measured

2026-10-31, the `averi_lab` AVD (Android 13, API 33), `scripts/perf/baseline.ts --platform android --scenarios
fill,fill-20 --repeat 5`, main (`429da60d`) against this branch (`f8eb77b5`), wall clock median [min–max]:

| scenario | main | branch | saved |
| --- | --- | --- | --- |
| `fill` (form-basic name, `Jan`) | 11735 ms [11609–12104], 4 dumps | 9322 ms [9009–9469], 3 dumps | 2413 ms (21 %) |
| `fill-20` (the same field, 20 characters) | 17363 ms [16221–17638], 4 dumps | 15153 ms [14241–15179], 3 dumps | 2210 ms (13 %) |

The saving is the one `uiautomator dump` (≈ 2.3–2.5 s); everything else (taps, typing, sleeps) is the same.

`scripts/truth/live.ts --serial emulator-5554` (the `forms` group, uiautomator), main against branch: 32 cases each,
27 ok, 2 LOUD, 0 mismatches, 3 skipped — every verdict and every reply line the same, the skip path's b1, b2, b5 and
the kept path's b6, p5, p6 included. b1d and b7 are LOUD on both (`adb shell input text` refuses `Š` and `’`: not this
change); kf1–kf3 skipped on both (the keyboard docked).

## Gain

One tree read saved per Android fill into an empty plain field named by id, ≈ 2.3 s per such fill. None on iOS.

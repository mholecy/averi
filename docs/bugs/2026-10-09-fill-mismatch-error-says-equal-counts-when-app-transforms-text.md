# BUG: a fill whose text the app transformed (auto-capitalised) fails with "typed 5 characters but the field shows 5" — equal counts, no hint of what differs, after a 36 s poll

**Measured 2026-10-09 05:33:54 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`), averi =
mobile-verify `fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio), scratch config `treeSource: wda`, stock Contacts
"New Contact" sheet, the `Notes` field (`textfield label:Notes`, empty, exposes no placeholder).

## Observed (measured)

```
type_text { platform: ios, selector: "role:textfield label:Notes", text: "hello", configPath: <scratch> }
→ [isError] fill: typed 5 characters but the field shows 5 (content withheld from this error)              (35.8 s)
ui_snapshot { filter: "label:Notes" } → textfield 'Notes' value 'Hello'
```

The text landed; UIKit's sentence auto-capitalisation turned `h` into `H`, so the substring read-back (`observed.includes(value)`,
no `clear`) never matched, the poll ran its whole budget, and the error compares two equal lengths.

## Why (read from the source)

`src/interact/fill.ts` ≈ 540–550: when the read-back does not land, the error prints `typed ${charactersText(value.length)} but
the field shows ${observed.length}` + `(content withheld from this error)` — lengths only, by design (values may be
credentials). A same-length mismatch therefore reads as no mismatch at all.

## Why it matters

Auto-capitalisation, auto-correction, smart punctuation and input masks are on by default for iOS text fields (and IME
auto-correct on Android); a lower-case value into a sentence-case field fails every time, and the message ("5 … but … 5")
tells the reader nothing — it looks like a bug in the comparison. It also costs the full poll (36 s here, on a WDA tree that
reads in ~4 s).

## Possible fix directions (owner's choice)

- When the lengths are equal (or the value differs only by case), say so without revealing content: `the field shows 5
  characters that differ from the typed text (same length; case differs at 1 position — auto-capitalisation?)`.
- Compare case-insensitively as a second tier and report `landed, transformed by the field` as a ⚠ rather than a failure,
  when not masked.
- Stop the poll early once the observed value has been stable for N reads.

## Repro

1. iOS, any UIKit text view with sentence auto-capitalisation (Contacts → + → Notes), `treeSource: wda`.
2. `type_text { selector: "role:textfield label:Notes", text: "hello" }` → `typed 5 characters but the field shows 5`.

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder:
`scratchpad/averi-repo/run5-ios`.

**Holds.** Contacts "New Contact", scratch `treeSource: wda`, `Notes` scrolled into view first (`textfield 'Notes' 36 584 330 23`,
empty, software keyboard parked):

```
11:35:53 type_text { platform: ios, selector: "role:textfield label:Notes", text: "hello", configPath: <scratch wda> }   (36.6 s)
→ [isError] fill: typed 5 characters but the field shows 5 — the typed text is there but for letter case, 1 character
  differing: the app transformed the input (auto-capitalisation?); content withheld from this error
```

idb shim: `11:36:02 ui tap 201 596`, `11:36:06 ui text hello`; then `textfield 'Notes' value 'Hello'`. No character or position
named; the 36 s poll is the documented cost. The other kinds (`as many characters as were typed, K differing`, `the field did
not change`) were not met.

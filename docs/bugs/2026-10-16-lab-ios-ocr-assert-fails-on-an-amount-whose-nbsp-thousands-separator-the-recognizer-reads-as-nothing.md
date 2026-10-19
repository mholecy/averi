# BUG: on iOS the `ocr` assert fails on an amount with an NBSP (or narrow NBSP) thousands separator — the recognizer reads `1 234,56 €` as `1234,56 €`

Lab note OC2. **Found 2026-10-16** by the golden mode's `ocr` rows on the real pixels (phase 4: scripts/differential/
golden.ts, golden-spec/text.ts; the host's macOS Vision recognizer, averi's own, reading the captured screenshot) over
the lab app's `text-sample` cell (fixtures/apps/cells/text.json; AveriLab/Text.swift), captured on the averi-lab
iPhone 17 simulator (iOS 27.0, WDA and idb). averi = mobile-verify `truth/r4-ocr` on `arch/round-20`'s `src/`
(`debc9b2`). Replayed only; the screenshot is the simulator's.

## Observed (measured)

The amounts a Slovak or Czech banking app shows, drawn 16 pt in SF, whole and uncovered, asked by their string:

```
assert { element: { text: "1 234,56 €" }, ocr: { text: "1 234,56 €" } }          (U+00A0 between 1 and 234, and before €)
→ FAIL … read "1234,56 €"; vs expected "1 234,56 €" ≠

assert { element: { text: "−12 345,00 EUR" }, ocr: { text: "−12 345,00 EUR" } }  (U+2212, U+202F between 12 and 345)
→ FAIL … read "-12345,00 EUR"; vs expected "−12 345,00 EUR" ≠
```

The minus sign is folded (`−` vs `-`); the thousands separator is read as no space at all: SF draws a narrow gap there
that Vision does not read as a word break. On Android (Roboto, the same strings) both PASS (`1 234,56 €` read with its
space). The tree's `text` assert passes on both platforms (whitespace normalised: src/verify/text-parity.ts#normalizeText).

Another recognition language does not change it (measured beside lab note OC1: `cs-CZ` reads `1234,56 €` too).

## Why it matters

Amounts are the copy a banking app's tests assert most. An `ocr` assert copied from the tree fails on every
four-digit-or-larger amount on iOS — a false FAIL that reads as a rendering defect.

## Expected

A space (any of the NBSP family) between two digits read as nothing is forgiven, as the fold forgives a typographic
apostrophe — and named in the reply (`differs only in a thousands separator read as nothing`). A space read as nothing
between letters, or digits read in another order, still fails.

## Reproduce

`node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only text-sample` outside the sandbox:
rows `H ocr` and `I ocr` on `text-sample.wda.json` and `text-sample.idb.json`. KNOWN in
tests/differential/golden/text.known.ts.

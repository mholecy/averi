# BUG: the `ocr` assert fails on correctly drawn Slovak `Ľ`/`ľ` and `ĺ` — the recognizer reads `Ľ` as `L'` and `ĺ` as `í`, which the OCR fold does not forgive

Lab note OC1. **Found 2026-10-16** by the golden mode's `ocr` rows on the real pixels (phase 4: scripts/differential/
golden.ts, golden-spec/text.ts; the host's macOS Vision recognizer, averi's own, reading the captured screenshot) over
the lab app's `text-sample` cell (fixtures/apps/cells/text.json; AveriLab/Text.swift, Text.kt), captured on the
averi-lab iPhone 17 simulator (iOS 27.0, WDA and idb) and the `averi_lab` AVD (API 33). averi = mobile-verify
`truth/r4-ocr` on `arch/round-20`'s `src/` (`debc9b2`). Replayed only; the screenshot is the device's.

## Observed (measured)

Each string drawn 16 pt / 16 sp, black on a pale box, whole and uncovered; asked by its string, as copied from the tree:

```
assert { element: { text: "Ľubomír Šťastný" }, ocr: { text: "Ľubomír Šťastný" } }
→ FAIL … read "L'ubomír Stastný"; vs expected "Ľubomír Šťastný" ≠          (iOS, WDA and idb)
→ FAIL … read "L'ubomír Sťastný"; vs expected "Ľubomír Šťastný" ≠          (Android)

assert { element: { text: "Mäkčeň, dĺžeň a vokáň" }, ocr: { text: "Mäkčeň, dĺžeň a vokáň" } }
→ FAIL … read "Makčeň, dižeň a vokáň"; vs expected "Mäkčeň, dĺžeň a vokáň" ≠   (iOS)
→ FAIL … read "Mäkčeň, dížeň a vokáň"; vs expected "Mäkčeň, dĺžeň a vokáň" ≠   (Android)
```

The tree's `text` assert on both strings passes; the screenshot shows the right glyphs. Every other string of the
sample passes `ocr` on Android — `Prihlásiť sa`, `Jiří Dvořák: věřitel, půjčka`, `Payee’s name`, the quotes, dashes and
ellipsis, the amounts, the IBAN — exactly or under the fold (src/verify/ocr-fold.ts: `Š` vs `S`, `ť` vs `t`, `’` vs `'`).

## Why

The fold (35321b4) takes a Latin combining mark off a letter, keeping its base letter, and folds typographic punctuation.
Two Slovak letters are read as something the fold cannot reach:

- `Ľ`/`ľ` carry a caron drawn as an apostrophe beside the letter (most fonts): the recognizer reads TWO characters,
  `L'` — the fold of `Ľ` is `L`, never `L'`.
- `ĺ` (l with acute) is read as `í` (i with acute): another base letter.

(`ä` read as `a` on iOS is folded — that part passes.) The assert reports a code-fix-style mismatch on text that is right.

## Expected

Either the fold also forgives `ľ`/`Ľ` read as `l'`/`L'` and `ĺ`/`Ĺ` read as `í`/`Í` (named in the reply as the other folds
are), or the reply says that the recognizer is known not to tell these Slovak letters apart. A wrong letter elsewhere
(`ĺ` read as `l` where `í` is meant) must still fail.

## Reproduce

`node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only text-sample` outside the sandbox
(Vision answers `nilError` inside it): rows `B ocr` and `C ocr` on all three captures. KNOWN in
tests/differential/golden/text.known.ts.

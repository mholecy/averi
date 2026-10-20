# 25. What the recognizer may read the app's copy as

Status: accepted 2026-10-20 (orchestrator's decision for round 14, lab notes OC1 and OC2, on the owner's standing:
truthful results, and no false FAIL that reads as a rendering defect on a banking app's copy). Implemented on
`bugs/r14-oc` (`3d668f1` prep, `9837ef6` OC1, `cb0b7ac` OC2). Records the fold of 35321b4 (lab note TX1), until now
recorded only in `src/verify/ocr-fold.ts`'s module doc and the TX1 note, as the base decision.

## Context

- The `ocr` assert compares an expectation (copied from the tree: the app's copy) to what the host's recognizer read
  on the screenshot. 35321b4 (docs/bugs/2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-
  as-straight.md) made that comparison "equal after a per-character fold": typographic punctuation read as its ASCII
  look-alike (`’` as `'`), a Latin combining mark dropped (`ť` as `t`). The fold is symmetric — it runs either way round
  — and per character.
- docs/bugs/2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md
  (OC1): macOS Vision reads `Ľubomír` as `L'ubomír` (iOS and Android: the caron of `Ľ ľ` is drawn as an apostrophe
  beside the letter) and `dĺžeň` as `dížeň` (Android) or `dižeň` (iOS: `ĺ` read as `í`, then `í`'s mark dropped). A
  per-character fold can only drop something OFF a character; it cannot say "read as other characters".
- docs/bugs/2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-
  nothing.md (OC2): on iOS Vision reads `1 234,56 €` (NBSP) as `1234,56 €` and `−12 345,00 EUR` (narrow NBSP) as
  `-12345,00 EUR` — SF's narrow gap is no word break to it. A fold never drops a space.
- The recognizer's languages are no lever (measured in OC1's note on macOS 27.0.1): `sk-SK` is not among Vision's
  languages, and `cs-CZ` or `["cs-CZ", "en-US"]` read exactly what `en-US` reads, OC2's amount included.
- Neither difference can be made symmetric safely: a canonical `L' → L` passes expected `L'Oréal` on a reading
  `LOréal`; a canonical `ĺ → i` fails `ĺ` read as `l` (passing today) and passes expected `í` on a drawn `ĺ`; a
  canonical "drop a space between digits" passes `12 34` (two numbers) on `1234`.

## Decision

`src/verify/ocr-fold.ts` stays the one owner of "what a text recognizer cannot tell apart" (ARCHITECTURE.md), and
gets the directional concept: **what the recognizer may read the app's copy as** — `readingDifference(copy, read)`,
returning `RecognizerDifference { pairs, reason }` (the differing spans, the copy's side first, and why they are
forgiven) or undefined. It replaces `differsOnlyByOcrFold` and `foldDifference` in all four callers: the ocr assert
(the expectation is the copy), the parity drift against the contract (the contract is the copy), android vs iOS
readings (neither is the copy: either may stand for it, pairs named android first), and the element assert's
not-found hint (the node is the copy, the expectation the reading; pairs printed expectation first).

The copy is split into units, one per composed code point, each offering the ways it may be read; the units are
matched left to right against the folded reading by a set of reachable positions (no backtracking, no pattern built
from the text); copy and reading are then walked side by side into minimal aligned spans, and each span that differs
is named. A unit's ways:

- **B (base, 35321b4, TX1): its own fold.** Symmetric, per character, as before — so with no other way the relation
  is exactly the old one (the prep commit changed no golden reply).
- **D1 — direction.** Every other way runs copy → reading ONLY. Expected `L'` or `L'Oréal` never matches a drawn `Ľ`,
  nor expected `L` a reading `L'`; expected `í` never matches `ĺ` or `l`; expected `1234` never matches `1 234`.
- **D4 — the letter table (`MISREADINGS`, OC1).** Exactly the letters whose diacritic is drawn as an apostrophe beside
  the letter, `Ľ ľ ď ť` (Unicode's "caron with vertical comma form": a typographic class, not a guess per language),
  each read as the letter and `'`; and `Ĺ ĺ`, read as `Í í`. Measured: `Ľ`, `ľ` (the same glyph), `ĺ`; `ď`, `ť` are the
  same glyph class (`ť` is read `ť` or `t` on the lab app — still passing by the fold). `Ď` and `Ť` take a normal caron
  above: not listed. No `I`/`1`/`l` confusion is listed — unmeasured. A misreading is folded in turn (`ĺ` → `í` → `i`),
  and named with its own reason: "a letter from the look-alike it is read as". So a drawn `ĺ` read `i` passes, as iOS
  reads `dĺžeň` (`dižeň`), and so does `Ĺ` read `I` — unmeasured for the capital, accepted as the same glyph class: an
  `i` where the copy has `ĺ` is never a FAIL.
- **D2 — a grouped number, not "a space between digits" (`GROUPED_NUMBER`, OC2).** A space may be read as nothing
  only inside a run of the copy that is wholly a grouped number: 1–3 digits, then one or more ` ddd` groups, no digit
  before it nor a digit and a space nor a digit and a decimal mark, no digit after it nor a space and a digit. So
  `1 234`, `12 345,00` and `1 234 567` pass read without any of their separators; `12 34`, `1 2345`, `1234 567`,
  `12 34 567`, `1 234 56`, `1,234 567` and `0.123 456` (a fraction's digits, then another number), an IBAN's groups of
  four, `ab 123` and `a b` stay strict. Leaving a thousands separator out changes no digit nor its
  place; a space between two numbers not in grouped shape stays. Named as the whole number (`12 345 vs 12345`), never as
  an invisible space, with the reason "a thousands separator between digit groups from no space". OC2's note asked
  for "a space between two digits"; this is narrower on purpose.
- **D3 — which space.** Decided on the copy as compared, whitespace collapsed (`normalizeText`): an ASCII space a test
  author typed counts like the app's NBSP, narrow NBSP or figure space (authors type ASCII; the `text` assert already
  collapses whitespace, and an `ocr` assert is copied from it). The shape (D2), not the code point, is the guard.
- **D5 — scope.** `text` expectations of the ocr assert, the parity drift and the hint. Not `match` patterns, and not
  the parity table's UNREAD guard (residuals R1, R2).

## Residuals

1. **R1 — `match` patterns.** A pattern naming `Ľ` keeps the mark-only fold (`ocrFoldPattern`): it fails on a reading
   `L'…`. Remedy: write `L'?` in the pattern, or assert `text`. No measured row.
2. **R2 — the UNREAD guard.** The parity table's guard (`text-parity.ts#looseForm`, containment on a lossy form) has
   the fold only — no misreadings, no dropped separators: a single-part row whose `Ľ` is read `L'` or whose `ĺ` is
   read `í`, and a single-part amount read without its thousands separator (`1 234,56 €` read `1234,56 €` — on iOS,
   every such amount anchor), read OCCLUDED before the drift check is reached (the `Ľ` row and the amount pinned in
   tests/verify/text-parity.test.ts). It fails safe — UNREAD, never a false pass — but the copy goes unchecked. A
   combined row with another part read whole reaches the drift check, which forgives it. Fix when a row is measured.
3. **R3 — two numbers side by side, each in grouped shape** — a phone number in groups of three (`+421 905 123
   456`), `iPhone 15 128 GB`, a model code `X5 100` — pass read run together (`15 128` as `15128`): the same digits
   in the same order, and Vision cannot see SF's narrow gap anyway. Accepted.

## Consequences

- Golden with OCR against `73549ce7`: exactly ten rows turn green (text-sample B and C on idb, WDA and Android; H and
  I on idb and WDA); nothing else changed. calibrate: OC1 and OC2 CALIBRATED.
- `ocr-fold.ts`'s exported surface shrinks: two functions out (`differsOnlyByOcrFold`, `foldDifference`), one in
  (`readingDifference`, with its type `RecognizerDifference`); `ocrFold`, `ocrFoldPattern`, `foldFree`, `readingFolds`,
  `foldReason` and `namePairs` are unchanged in use (`namePairs` of no pair names the composed-vs-decomposed case).
- A new measured misreading is one entry in `MISREADINGS`, with its note; a new forgivable shape is one more way of a
  unit, one way, named with its reason.

# 23. A fill types the tail a field dropped again — once more, or twice, and only a strict prefix's

Status: accepted 2026-10-19 (orchestrator's decision for round 7, task A9, on the owner's standing: averi's fill must
deliver the whole text reliably, the agent's hands needing no retries). Implemented on `arch/r23-fill-tail`.

## Context

- docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-text-in-a-react-native-single-line-field.md: on the
  `averi-lab iPhone 17` simulator, a fill into React Native 0.88's controlled single-line `TextInput` (the RN lab app's
  `rn-field`) kept only a prefix of its text in 6 of 12 fills over two live runs, under both tree sources (the typing is
  `idb ui text` under both), up to 6 of 9 characters lost; the multiline field lost nothing (4 of 4), Android nothing
  (6 of 6). The field itself held the prefix (the app's model agreed with the read-back). averi was honest — the
  read-back caught every loss and the reply was an error — but the fill failed where a user's typing would not, and the
  owner's bank app is React Native.
- Until then a fill sent text again only with `clear` (one wipe of what the field held and a retype of the whole
  value, 2026-08-05: Compose async state swallowing synthetic input); without `clear` a mismatch threw, because the
  field's earlier content is not ours to delete.

## Measured (2026-10-19, raw `idb ui text`, no averi)

Into `rn-field`'s N (focused once, cleared with 30 backspaces and 30 forward deletes between runs), 25 runs per row,
the field's value read from the app's model 1.5 s after the typing (round 7 task A9; its script and 175 readings are kept beside its live records on the truth branch):

| typing | lost | what the field kept | cost |
|---|---|---|---|
| `Jan Novak` in one burst | 22 of 25 | a prefix every time — 6 to 8 of 9 characters (once 3) | one idb call, ~220 ms |
| the same, then the missing tail in one call | 20 lost, 0 after the retype | whole, 20 of 20 | one more idb call |
| `SK31 1200 0000 0000 0001` (24) in one burst, then the tail | 25 lost, 0 after the retype | 14 to 19 of 24 kept, whole after one retype | one more idb call |
| chunks of 3, back to back | 14 of 25 | `Ja Novak` — a MIDDLE character gone (the end of a chunk), no prefix | 3 calls, ~650 ms |
| chunks of 3, 150 ms apart | 15 of 25 | `Ja Novak` again | ~1.1 s |
| one character per call | 0 of 25 | — | 9 calls, ~2 s (~220 ms a character) |

The loss is at the keystroke level: the controlled input drops the keys that arrive while its JS value round-trip is
behind, and what it drops is the END of a burst — longer bursts lose more (up to 10 of 24). A burst's tail typed again
lands whole (45 of 45). Chunking is worse than no remedy: the end of each chunk is dropped and the next chunk lands
after the gap, so the field holds text with a hole that no read-back can mend; only one character per call is whole,
at ~220 ms a character on every iOS fill.

## Decision

1. **A dropped tail is typed again.** When the read-back, after its full poll, finds the field holding a STRICT prefix
   of what it should hold — its text before the typing plus the value, or the value alone after a clear — and longer
   than its text before the typing (some of the typing landed), the missing tail is typed, and the field read back
   again. With or without `clear`, on every platform: the rule is the reading's, not the adapter's.
2. **Bounded, and never a duplicate.** At most twice (`fill-type.ts#MAX_TAIL_RETYPES`), the second only when the first
   moved the field; only when the reading held still over the poll's last two reads (a tail still arriving late is not
   sent twice); never on a reading with a bullet (a masked field's content cannot be compared, so no prefix can be
   seen — today's length rule and its honest error stay); never when nothing of the typing landed (the focus may not
   be in the field); never when the field's earlier text changed. A strict prefix proves which characters are missing,
   so a retype can only add them.
3. **Said, not hidden.** A fill that landed after a retype says so in the reply and the flow line
   (`Filled id:"x" (9 characters, the last 6 characters typed again after the field dropped them)`); a fill still short
   after the retypes is the mismatch error, which says what was typed again. Lengths only, never content.
4. **One owner.** Typing, the read-back poll, when text has landed and what is sent again are ONE module,
   interact/fill-type.ts (`typeAndConfirm(io, intent) → Typed`); fillField drives it and turns the outcome into its
   facts (`FillResult.retyped`) or its error. The clear's wipe-and-retype moved there unchanged, after the tail rule
   (a prefix is retyped, not wiped).

## Consequences

- An RN single-line field fills whole at the first call where it held a prefix half the time (live: 3 runs × both tree sources of the RN forms group: 18 single-line fills,
8 of them with a tail typed again — 1 to 3 characters — every one whole, 0 lost; the multiline field and `abc` whole
without one; records docs/truth/live-records/ios-rn-forms-a9-1…3.json on the truth branch).
- A fill that hits a field's maxLength (it keeps a prefix too) types the rest once more, sees the field unmoved and
  fails as before — one poll later, and its error says the tail was typed again.
- A field that drops the tail of a retype as well, twice, still fails loudly.
- Not done: chunked or paced typing on iOS (measured above: chunks drop a middle character, which nothing can then repair, and one
character per call costs ~220 ms a character on every fill where the retype costs one call and one poll on the fills
that need it).

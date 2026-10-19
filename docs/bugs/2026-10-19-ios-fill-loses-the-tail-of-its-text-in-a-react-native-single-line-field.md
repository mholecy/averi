# BUG: on iOS, a `type_text` fill into a React Native single-line field loses the tail of its text — 6 of 12 fills in two runs, up to 6 of 9 characters, under both tree sources; averi says so (`typed 9 characters but the field shows 3`), but the fill fails

> **Status (2026-10-19):** fixed at 6ff68e52 and 7909c611 (arch/r23-fill-tail; docs/adr/0023-fill-types-a-dropped-
> tail-again.md; src/interact/fill-type.ts#typeAndConfirm): a read-back holding a strict prefix of what the field
> should hold gets the dropped tail typed again — at most twice, on a reading that held still, never on bullets, only
> on an adapter whose typing has arrived when its call returns (iOS) and while no other input on the screen changed —
> and the reply says so (`Filled … (9 characters, the last 3 characters typed again after the field dropped them)`).
> Measured raw (`idb ui text`, no averi, 25 runs a row; docs/truth/live-records/a9-fill-tail-diag/): a burst keeps a
> prefix 22 of 25, its tail typed again lands whole 45 of 45; chunks of 3 drop a middle character (14 of 25) and one
> character per call costs ~220 ms a character, so neither was taken. Live, the RN forms group with that src as
> `--side`: 5 runs × idb and WDA, 29 single-line fills typed, every one whole, 14 with a tail typed again
> (docs/truth/live-records/ios-rn-forms-a9-1…5.json); the native forms group unchanged, 46 / 38 ok / 8 LOUD / 0
> mismatches (ios-forms-a9.json).

**Found 2026-10-19** by round 7's React Native lab app (fixtures/apps/rn, `rn-field`; RN 0.88.0, a controlled
`TextInput`) on the `averi-lab iPhone 17` simulator (iOS 27.0), averi = truth/r7-rn's src (truth/round-7's).
Records: docs/truth/live-records/ios-rn-field-055c666.json (run 1), ios-rn-field-97de1b9.json (run 2); summary
docs/truth/live-rn-2026-10-19.md.

## Observed (measured)

Typing is `idb ui text` under both tree sources (src/adapters/ios.ts#typeText); the source decides only the read-back.

| case | field | asked | run 1 idb | run 1 WDA | run 2 idb | run 2 WDA |
|---|---|---|---|---|---|---|
| rn1 | N (single-line) | `Jan Novak` | whole | whole | `Jan` (shows 3) | whole |
| rn3 | I (single-line, icon) | `SK31 1200` | `SK31 120` (8) | whole | whole | `SK31 1` (6) |
| rn5 | N | `Jan Novak` | `Jan Nova` (8) | whole | `Jan Nov` (7) | `Jan Nova` (8) |
| rn2 | M (multiline) | `Thanks for the lunch`, clear | whole | whole | whole | whole |

Each loss is a tail: what reached the field is a prefix of what was asked. averi's read-back and the app's own model
(read again 3 s later) agree, so the field itself held the short value — React Native's controlled single-line input
dropping the end of idb's burst (its `value` round-trip racing the keys), not an oracle missing keystrokes. The multiline
field lost nothing (4 of 4); on Android (one `input text` per character) every fill was whole (6 of 6); the SwiftUI lab
app lost none after round 7's T3 oracle fix (30 fills).

## Why it matters

The verifier is honest, but the agent's fill fails where a user's typing would not: on the bank app (React Native) a
form field is half the time not filled at the first try.

## Remedies to evaluate (owner's choice)

1. When the read-back finds the field a prefix of what was asked, type the missing tail (and read back again); still
   loud when the second read-back disagrees.
2. Type slower, or per chunk, with `idb ui text` (always, or into a React Native app's field: measure the cost on the
   native lab app's form cases).

## Repro

`node --import tsx scripts/truth/live.ts --udid <lab simulator> --app react-native --cases rn1,rn3,rn5` (several runs:
it is intermittent).

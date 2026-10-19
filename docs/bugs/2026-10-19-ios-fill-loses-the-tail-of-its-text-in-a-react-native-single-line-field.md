# BUG: on iOS, a `type_text` fill into a React Native single-line field loses the tail of its text — 6 of 12 fills in two runs, up to 6 of 9 characters, under both tree sources; averi says so (`typed 9 characters but the field shows 3`), but the fill fails

> **Status (2026-10-19):** open. Honest today: the fill's read-back catches every loss and the reply is an ERROR — a
> LOUD verdict in the live golden, never a false `Filled`. A reliability gap, not a lie: the bank app is React Native,
> and an agent's fill into an RN single-line field there fails half the time. No KNOWN row (LOUD is no mismatch).

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

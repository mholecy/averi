# 23. A fill types the tail a field dropped again — once more, or twice, and only a strict prefix's

Status: accepted 2026-10-19 (orchestrator's decision for round 7, task A9, on the owner's standing: averi's fill must
deliver the whole text reliably, the agent's hands needing no retries). Implemented on `arch/r23-fill-tail`.

Widened 2026-10-31 by D28 (docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md, its amendment): the
strict prefix this ADR retypes may be REFORMATTED — exact by typed characters, only the field's grouping added.

Widened 2026-11-01 by D29 (docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md, its D29 amendment),
in one case only: decision 2's "never when the field's earlier text changed" no longer holds when that text VANISHED —
its letters and digits no longer start the reading (an unnamed placeholder read as the empty field's value, or text the
field replaced on focus). Then the reading is also judged as a prefix of the value alone; earlier text that changed in
any other way still stops the retype.

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
the field's value read from the app's model 1.5 s after the typing (the script and its 175 readings:
docs/truth/live-records/a9-fill-tail-diag/diag.mjs and diag.jsonl, on the truth branch):

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

1. **A dropped tail is typed again — where the typing has arrived when the call returns.** When the read-back, after
   its full poll, finds the field holding a STRICT prefix of what it should hold — its text before the typing plus the
   value, or the value alone after a clear — and longer than its text before the typing (some of the typing landed),
   the missing tail is typed, and the field read back again; with or without `clear`. Only on an adapter whose typing
   has reached the field when `typeText` returns — a platform fact the adapter declares
   (`DeviceAdapter.typingDelivery`, `TypingDelivery`): `on-return` on iOS (`idb ui text` sends HID events; of the 45
   raw typings that kept a prefix, none read a character twice after its tail was typed again 1.5 s later, as a late
   arrival would have), `may-arrive-late` on Android (`input text` into the IME's queue; Compose's async state landed 3
   of 11 characters at first, 2026-08-05) — and absent means `may-arrive-late`. interact/ stays platform-agnostic;
   Android keeps the fill it had (round 7's review, MINOR-1).
2. **Bounded, and never a duplicate.** At most twice (`fill-type.ts#MAX_TAIL_RETYPES`), the second only when the first
   moved the field; only when the reading held still over the poll's last two reads (a tail still arriving late is not
   sent twice); never on a reading with a bullet (a masked field's content cannot be compared, so no prefix can be
   seen — today's length rule and its honest error stay); never when nothing of the typing landed (the focus may not
   be in the field); never when the field's earlier text changed. A strict prefix proves which characters are missing,
   so a retype can only add them — to the field, if the typing went there:
3. **Only while the typing provably stayed in the field.** Before typing, every OTHER input of the newest tree read
   (by role, identifier and rect) is noted with its value — when nothing was read after the focus tap, the tree that
   resolved the field, before the tap: a weaker baseline, since a change between the resolution and the typing (an
   autofill on focus, the app's own update) reads as a change while typing and so only ever stops a retype. On the
   read-back's tree each must be there with the same value (`fill-type.ts#whereTyped`). One that GAINED typed text —
   its old value a prefix of its new, the appended part inside what the field is missing of the typing — proves the
   focus left the field: an auto-advancing code box handing it to the next (review of this branch: `1234` into the
   first of two OTP boxes left `1`, `2` and `34` in the note below, and the tail `234` typed again made the note
   `34234`, the reply saying the field had dropped them; `2` and `34` both lie inside the missing `234`). Then nothing
   is sent again: no tail, and no clear's wipe-and-retype either (its deletes and its typing would go there too), and
   the mismatch error names that input (`… the typing left the field: textfield id:"otp2" (x,y wxh) changed while it
   typed (the focus moved), so nothing was typed again` — said only on that proof). Any other change proves nothing
   either way — a sibling the app recomputed, replaced or shortened (review round 2: an exchange form's `converted`
   amount, twice the `amount` typed, made a clear fill that had always recovered fail) — and neither does an input
   that is gone or moved, or no read before the typing: no tail, while the clear's wipe-and-retype is sent as before.
4. **Said, not hidden.** A fill that landed after a retype says so in the reply and the flow line
   (`Filled id:"x" (9 characters, the last 6 characters typed again after the field dropped them)`); a fill still short
   after the retypes is the mismatch error, which says what was sent again in the order sent. Lengths only, never
   content.
5. **One owner.** Typing, the read-back poll, when text has landed and what is sent again are ONE module,
   interact/fill-type.ts (`typeAndConfirm(io, intent) → Typed`); fillField drives it and turns the outcome into its
   facts (`FillResult.retyped`) or its error. The clear's wipe-and-retype moved there unchanged, after the tail rule
   (a prefix is retyped, not wiped).

## Consequences

- An RN single-line field fills whole at the first call where it held a prefix half the time (live, 3 runs × both
  tree sources of the RN forms group: 18 single-line fills, 8 of them with a tail typed again — 1 to 3 characters —
  every one whole, 0 lost; the multiline field and `abc` whole without one; records
  docs/truth/live-records/ios-rn-forms-a9-1…3.json; the native forms group unchanged, 46 cases / 38 ok / 8 LOUD / 0
  mismatches, ios-forms-a9.json; with decision 3 and the adapter's fact, 2 more runs ×
  both sources, ios-rn-forms-a9-4…5.json: 11 single-line fills typed, every one whole, 6 with a tail typed again; run
  4's first case under idb typed nothing — the freshly booted simulator's accessibility named no frontmost
  application, and the field never appeared).
- A field that drops the tail of a retype as well, twice, still fails loudly.
- A field that trims or refuses input (a trailing space, its maxLength) also keeps a strict prefix: it gets one retype
  that changes nothing, then the mismatch error — whose words say the tail was typed again "after the field dropped
  them", where the field refused them. Accepted: one more call and poll on a fill that fails anyway, and the error
  stays a failure.
- Residual: a sibling the app changes by APPENDING, by coincidence, a part of the missing text reads as the typing gone
  there — nothing is sent again and the fill fails loudly (the safe direction).
- Residual: an input the tree does not list — off the screen, or a screen with no input of its own before the typing
  — can take the focus unseen; the retype then goes there, and the read-back of the field alone cannot tell.
- Residual: an app that changes another input by itself while the fill types (a mirrored field, a formatter on a
  sibling) stops the retype — the fill fails loudly, as before this decision.
- Not done: chunked or paced typing on iOS (measured above: chunks drop a middle character, which nothing can then
  repair, and one character per call costs ~220 ms a character on every fill where the retype costs one call and one
  poll on the fills that need it).

## Amendment: the first key alone, after an app dropped a tail (2026-10-31, D24)

**Measured** (the owner, outside the sandbox; docs/plans/2026-10-30-performance-backlog.md, "D7 and D24 measured"): D0's
iOS fill-20 lost the last 5–7 characters into `rn-field` in every run, so each fill polled 5 × 400 ms and retyped its
tail (~2.6 s of 5.9 s). Raw `idb ui text`, 15 runs a mode, `Jan Novak Bratislava` (20 characters) into AveriLabRN's
`rn-field` on the lab simulator (iPhone 17, iOS 27.0), read back from the app's state file: one burst (averi until now)
whole 5/15; **the first character alone, 150 ms, then the rest in one burst 15/15 (614 ms)**; one call with 10 ms after
each key 15/15 (705 ms); chunks of 5 15/15 (784 ms); chunks of 1 15/15 (3.8 s). The chunks-of-3 hole measured above
(14–15 of 25) did not reproduce in this run.

**Decision.** "Not done: chunked or paced typing on iOS" (Consequences) stands for every app but one that has shown a
drop: after a fill has typed a dropped tail again (decision 1 — the field kept a strict prefix) and the typing then
LANDED whole, later typings into that SAME app send the first character alone, wait 150 ms (50 ms since the D25
amendment below), then the rest. Sticky per app for the adapter's life; an app never seen dropping a tail never pays.

- **Who learns, who acts.** The fill reports what it saw, nothing more: `fill-type.ts` calls `FieldIo.reportDroppedTail`
  once a fill, when the typing has landed through a tail typed again, which `fill.ts` hands to
  `DeviceAdapter.noteDroppedTail` (optional; no device call; `read-handoff.ts` classes it `reads` — it touches no
  screen). The remedy is a platform fact, measured on iOS only, so it is the adapter's: `IosAdapter` keys the memory by
  the app in front as it knows it (`ios.ts#FrontApp`: the bundle it last launched; before any launch, `unlaunched` — the
  app in front, whatever it is; after `terminate` of that bundle, `forgotten` — not known: nothing split, nothing
  learned until the next launch) and `typeText` splits for a key it holds (`ios.ts#FIRST_KEY_ALONE_MS`, the wait through
  `util/sleep.ts`). interact/ stays platform-agnostic, and since the split lives in `typeText`, every typing into that
  app gets it — a flow's `type:` step and `type_text` without a selector too, which read nothing back. Android has no
  `noteDroppedTail`: its typing (paced by D6) is unchanged.
- **A capped field is no drop** (D24 review). A field that keeps a strict prefix for good — its maxLength, an IBAN or
  phone mask trimming the typing — gets its one retype that moves nothing and the mismatch error (Consequences above);
  reported at the retype, one such fill would have marked a native app and made every later typing into it pay the split
  (~370 ms with the extra idb call; ~270 ms since D25, estimated: 100 ms less wait). Only the repair proves the drop, so
  only a typing that landed through a tail retype is reported; one whose retypes moved the field and still missed is not
  either.
- **The first character is a grapheme** (`Intl.Segmenter`): a surrogate pair or a combining mark is never cut between
  two idb calls. A text of one character is one call, with no wait.
- **The retype stays the safety net, unchanged.** Decision 1–3 are as they were. The first fill's own tail retypes are
  sent before the report, so they are typed exactly as before (a retyped tail landed whole 45 of 45); a later fill that
  still drops gets its tail typed again, the tail itself split like every typing into that app (+150 ms; +50 ms since
  D25).

**Residuals.**
- An RN fill that drops and is still short after both retypes is not reported, so its app is not marked; the next fill
  that lands through a retype marks it.
- The first fill into an RN app still pays the drop: the full poll (5 × 400 ms) and the retype — the memory is learned,
  not configured, and lives as long as the adapter (a server restart, or the other tree-source kind's adapter, learns
  again).
- The key is the last launched bundle: an app brought forward by a deep link, a tap or by hand is typed into under the
  launched app's key — the split paid where it is not needed, or not paid where it is (the retype still catches it).
- The split is measured on one field of one RN version (0.88's controlled single-line `TextInput`), one 20-character
  text, one simulator; other RN versions and fields, multi-line inputs (which dropped nothing in the 2026-10-19 runs),
  and loaded hosts are unmeasured. Only the device can say whether 150 ms is enough everywhere. (D25, below: any
  pause of ~50 ms after the first key landed the rest; lowered to 50 ms.)

## Amendment: the gap after the first key is 50 ms, not 150 — and no length is spared the split (2026-10-31, D25)

**Measured** (the owner, outside the sandbox, 2026-10-31; docs/plans/2026-10-30-performance-backlog.md, "### D25 diag"):
D24's split cost short texts that had never dropped (rn-fill `Jan` 2 155 → 2 341 ms: one idb call more and 150 ms), so
D25 asked from what length a burst drops, to split only above it. Typed through fb-idb's gRPC client in-process, one
client a call — as averi's helper does (a gen_main per request), never through the `idb ui text` CLI that D24 measured
with (a Python start-up on every call, ADR 0032) — prefixes of `Jan Novak Bratislava` into AveriLabRN's `rn-field` on
the lab simulator (iPhone 17, iOS 27.0), read back from the app's state file; 40 rounds, every combination once a round
in a shuffled order. Whole of 40:

| typing        | 1     | 2     | 3     | 4     | 5     | 6     | 8     | 12    | 20    |
|---------------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
| one burst     | 40/40 | 36/40 | 36/40 | 37/40 | 40/40 | 33/40 | 35/40 | 10/40 | 4/40  |
| split, 150 ms | —     | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 |

A burst lands in ~93 ms (median), the 150 ms split in ~335 ms — +240 ms at lengths 2–8 (+215–220 at 12 and 20, where the
burst's drops skew its median). A burst already drops at 2 characters (4 of 40 lost the second key), so the premise is
refuted: no length threshold is safe. At 8 and 20 characters the gap was varied (80 typings a mode): split with 0 ms
80/80 (185 / 238 ms), 50 ms 80/80 (235 / 292 ms), 100 ms 80/80, 150 ms 80/80; one call with a companion-side 50 ms HID
delay between the first key and the rest 80/80 (148 / 204 ms). Any pause after the first key of at least ~50 ms appears
to land the rest: 0, 50, 100 and 150 ms between two calls all landed 80/80, and so did one call with a 50 ms HID delay
and no second round trip. The second call's round trip (~90 ms) already gives such a pause, and 150 ms bought nothing
over it.

**Decision.** No length threshold: every typing of two or more characters into an app seen dropping a tail is split, as
D24 decided. The wait is lowered: `ios.ts#FIRST_KEY_ALONE_MS` 150 → 50 ms, −100 ms on each such typing. Not 0: a margin
is kept, and 50 ms is the pause measured to land on its own — hid:50, a bare 50 ms pause with no round trip, landed
80/80 — so a 50 ms sleep lands the rest even if the second call's round trip through averi's helper shrank to nothing.
Everything else in the D24 amendment stands — who learns, who acts, the capped field, the grapheme, the retype as the
safety net.

**Not done.** The one-call variant (the companion's HID delay between the first key and the rest, ~90 ms less again):
it needs a new helper verb carrying a delay; not worth one now.

**Residuals.**
- The 50 ms gap is measured through the script's in-process client, not through averi's helper itself; the device check
  of D25 (`ios-run.sh --app react-native`, rn-fill and rn-fill-20 on the helper) must confirm it lands whole first time.
- Everything D24's residuals name is still unmeasured — other RN versions and fields, multi-line inputs, loaded hosts;
  lengths 1–6, 8, 12 and 20 of one text are measured now.

## Amendment: the tail's definition and the retype condition, each defined once (2026-11-01, A2)

What a dropped tail is — a strict prefix of what the field should hold, exact or reformatted, with some of the typing
in it, no bullet — is `interact/fill-landing.ts#tailOf` (and `droppedTail`, until A9), the one module that judges a reading;
the verdict's `dropped-tail` asks the same function. The retype condition on the adapter (`typingDelivery`
`on-return`) is `interact/fill-type.ts#retypesTail`, asked by the typing and by fill.ts's post-focus re-read gate
(ADR 0028), which until then each wrote it out. No behaviour changed.

## Amendment: the tail is part of one answer about the reading (2026-11-05, A9)

`droppedTail` is gone and `tailOf` is private: fill-type.ts asks `interact/fill-landing.ts#readingOf` once after the
poll, and a miss carries its tail (`NotLanded.tail`: `missing`, what `whereTyped` compares with; `retypable`, what the old
function answered). The definition above and the gates of this ADR (the bounds, a steady reading, `whereTyped`,
`retypesTail`) are unchanged, and stay fill-type.ts's. No behaviour changed.

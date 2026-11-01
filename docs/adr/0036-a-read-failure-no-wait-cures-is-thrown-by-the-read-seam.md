# 36. A read failure no wait cures is thrown by the read seam, never returned as a miss

Status: accepted 2026-11-01 (backlog row A1, docs/plans/2026-10-30-performance-backlog.md, from the architecture review
of the perf programme). Implemented in merge 5cd0d8e4. Behaviour-preserving.
Amended 2026-11-01 (D39: fill's not-input hint read goes through the seam — see the amendment below).
Amended 2026-11-01 (D42: the keyboard guard's looks pass a terminal failure through — see the amendment below).

## Context

- D21 (2026-10-31) named the one tree read failure that no wait cures: `PersistentReadError` (adapters/types.ts), today
  idb's wedged accessibility service. Every other read failure is a miss that heals, and the loops wait past it.
- The one-shot read, then `readTreeOrError`, returned BOTH kinds as a value. So each reader decided again whether the
  value was terminal: six sites carried an `instanceof PersistentReadError` rethrow or unwrap (pollTree, the scroll
  loop, the settle wait's late read, fill's mid-fill re-read, the keyboard dismissal's confirming read, the frame
  capture's bounded retry), each with its own D21 comment. A seventh reader written the same way would swallow the
  failure as a miss, and nothing would notice.

## Decision

**The read seam (ui-tree/read-tree.ts) classifies a read failure once: a failure that heals is returned
(`readTreeOrMiss` → `TreeRead`, a tree or an error) or wrapped in the caller's error (`readTreeOrThrow(adapter, wrap)`); a
`PersistentReadError` is THROWN as it came, never returned, and never handed to `wrap`.**

- `TreeRead` is a discriminated union (`{ tree }` or `{ error }`), so a reader needs no fallback for "neither".
- The six readers lost their `instanceof`: the throw reaches them already. The frame capture's retry loops over
  `readTreeOrMiss`; its catch sees only the terminal failure and keeps its wording (`UI tree read failed: …`, the cause
  attached, one attempt).
- `PersistentReadError` stays in adapters/types.ts: it is the adapter contract (what `uiTree()` throws), not the
  seam's.

## Consequences

- A reader through the seam stops on a terminal failure without knowing it exists.
- The policy sites keep their `instanceof`: `Verifier`'s `persistentRead` (verify/assert.ts — `fail` turns it into a
  failing result) and the flow engine's `isTerminal` (flow/engine.ts). They decide what a terminal failure MEANS to
  their caller, which is not a read's question.
- One reader opts out on purpose: the swipe's orientation read (interact/swipe.ts#swipeScreen) catches it, and loses
  only its witness — the swipe is sent over the device box and its note quotes the failure (ARCHITECTURE.md).
- fill's not-input hint read (interact/fill.ts, `notInput`) still reads raw and swallows any failure, the terminal one
  included: it is a hint, read only when no re-read happened. Whether it should stop on a terminal failure is left open.
- The raw `uiTree()` calls outside src/adapters and the seam are pinned, with the reason each may read raw, by
  tests/ui-tree/raw-tree-reads.test.ts: a new one fails that test until it goes through the seam or is listed.

## Amendment: fill's not-input hint read stops on a terminal failure (2026-11-01, backlog D39)

`notInput` reads its own tree only when the fill made no re-read: `value: ''` on a node that is not an input, with or
without `clear`. Its bare `catch {}` turned a wedged simulator (`PersistentReadError`) into "success, nothing typed, the
screen could not be read again". The agent got no reboot message; the wedge surfaced one call later.

`notInput` now reads through `readTreeOrMiss`. A miss stays a hint (`input: 'unread'`); a terminal failure stops the
fill and passes through as it came. Its entry in tests/ui-tree/raw-tree-reads.test.ts's allowlist is gone, so the guard
covers it. Pinned by tests/interact/fill.test.ts ("notInput's read that throws a PersistentReadError", its `clear: true`
variant, and its companion for a miss).

## Amendment: the keyboard guard's looks pass a terminal failure through (2026-11-01, backlog D42)

The guard's looks after a first covered one go through `lookAgain` (interact/keyboard-model.ts): the in-tree model's
second look, and the confirming looks after `back` or a dismissal tap. Their tree reads go through the seam
(`resolveSettled` polls with `pollTree`), so a `PersistentReadError` reached `lookAgain`. But its catch wrapped every
failure in the model's `KeyboardGuardError` (`KeyboardWithoutDismissal`, `AfterKeyboardDismissal`, `AfterDismissalTap`).
The reboot text and the `cause` survived, the class did not: the flow engine's `isTerminal` missed it, so the ladder
escalated past a wedged simulator.

`lookAgain` now rethrows a `PersistentReadError` as it came, before the wrap; every other failure is wrapped as before.
It is the one place the guard wraps a look's failure, so no model can forget it, and the claim "readers stop on it
without knowing it exists" holds for the guard too. The cost: the step's trace has no `⚠ tap` / `⚠ fill` line saying
what the guard did before the wedge, as with the post-fill dismissal's confirming read. Pinned by
tests/interact/keyboard-window.test.ts and tests/interact/keyboard-in-tree.test.ts (each model's look: the same
instance, `toBe`), and by tests/flow/engine.test.ts ("a wedged read on the look after back stops the ladder").

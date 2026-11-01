# 36. A read failure no wait cures is thrown by the read seam, never returned as a miss

Status: accepted 2026-11-01 (backlog row A1, docs/plans/2026-10-30-performance-backlog.md, from the architecture review
of the perf programme). Implemented in merge 5cd0d8e4. Behaviour-preserving.

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

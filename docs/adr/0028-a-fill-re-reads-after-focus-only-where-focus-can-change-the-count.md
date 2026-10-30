# 28. A fill re-reads after focus only where focus can change the count

Status: accepted 2026-10-31 (performance backlog item D8, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's decision on the owner's standing: fast AND stable — a fill that reports success on the wrong field or
misses a transformed value is unacceptable). Implemented on `perf/d8-fill-reread`.

## Context

- The post-focus re-read (`interact/fill.ts`, the `refetchNode()` after the focus tap and its 350 ms delay) exists for
  MASKED fields (`5af92b0f`, docs/bugs/2026-09-18-handoff-run5-and-finportal-login-findings.md): Android autofill
  populates a password field on focus, and a re-entry screen clears one on focus. The masked read-back is compared by
  LENGTH, so the count it starts from must be the one after focus, not the pre-tap tree's.
- It ran on every fill of a value without `clear` into a field that read empty (or masked) before the tap — so on
  every plain empty field too, where no length rule is asked. One tree read: ≈ 2.3 s on Android.
- What the re-read also feeds, besides the masked count: `lastTree`, which becomes `screenBeforeTyping` (the screen
  sameField's twin fallback must stay on after typing); `shownBeforeTyping` (the dropped-tail prior, the "did not
  change" wording); and the other inputs `whereTyped` compares (`interact/fill-type.ts`).

## Decision

**Parsers report `UiNode.secure` (`adapters/types.ts`); absent is unknown.**
- uiautomator: the `password` attribute (`"true"`/`"false"` on every node of the API 33 dump), read on text inputs only.
- WDA: the type — `SecureTextField` true, `TextField`/`TextView` false.
- idb: `traits` naming `SecureTextField` or `subrole` `AXSecureTextField` true (idb types a secure field `TextField`);
  a `TextField`/`TextView` whose traits were printed and say neither false.
- Unknown: every other role, an iOS search field (`other`), a source or dump that does not print it.
- Pinned on the lab's form-basic and form-prefilled captures, all three sources: the PIN true, the four others false
  (tests/adapters/secure-field.test.ts).

**The re-read is skipped only for an EMPTY input said plain (`secure === false`), named by a sole `id` selector
(`ui-tree/selectors.ts#soleIdOf`).** That is the one case where nothing it feeds can change the verdict:
- no masked count is asked — a plain field's read-back is compared by content;
- an `id` keeps matching through typing, so the twin fallback (which the skip leaves off: `screenBeforeTyping` is
  `null`) is never needed; a label, hint or value selector may stop matching once the field's text changes, so those
  keep the re-read;
- the field read empty before the tap, and the empty prior is taken as is;
- `whereTyped` compares the other inputs against the resolution's tree.

Everything else is read as before: a masked pre-read, a secure field, an unknown one, any selector but a sole `id`.
`screenBeforeTyping` is NOT seeded from the pre-tap tree: a field's own clear button appearing on focus changes that
screen's identity (docs/bugs/2026-10-09-ios-fill-screen-changed-from-fields-own-clear-button.md).

**Safety net in the skip path.** A field said plain that masks after all, and was filled on focus, passes the length
rule with more bullets than were typed (its count started at 0). A masked read-back longer than the typed length is
reported as `maskedAppend { held: observed − typed }`, the warning the re-read would have given.

The 350 ms focus delay stays.

## Why it is safe (priority 1 first)

- No new path to a false success: the read-back still compares what the field shows to the value, from fresh reads
  of the field found by its id.
- A wrong `false` (a source that says plain of a field that masks) loses only the count's start, and the safety net
  names the excess as the masked append.

## Costs accepted

- (C1) A plain field that INSERTS text on focus (a `+421 ` prefix) is no longer seen doing so: when a tail of the
  typing is dropped, the fill fails loudly instead of having that tail typed again. When every key lands, it passes as
  before (`includes`).
- (C2) A field the skip leaves without a pre-typing read, lost after typing, reads `unmatched` rather than
  `screen-changed`.

## Gain

One tree read saved per fill into an empty plain field named by id — on Android ≈ 2.3 s per such fill.

# 42. A node its source marks not enabled is said disabled; a tap on it is sent and warned

Status: accepted 2026-11-03 (performance backlog row D66, docs/plans/2026-10-30-performance-backlog.md). One reply
changes on purpose: `tap` by selector on a node marked disabled gains a second, ⚠ line. `ui_snapshot` prints the new
mark with the tree's JSON. Every other reply is byte-identical, and so is `tap`'s on an unmarked node. `UiNode` gains
one optional field, `disabled?: true`. No tool description changes.

## Context

- Every tree source says whether an element is enabled, and no parser carried it. uiautomator prints
  `enabled="true"/"false"` on every node; WDA's `/source` prints `isEnabled` as `"1"`/`"0"` (a string, like
  `isVisible`, and a `NotEnabled` trait beside it); idb's `describe-all --json` prints `enabled` as a JSON boolean on
  every element of a full capture. `android.ts#normalizeNode`, `wda-source.ts#toUiNode` and
  `ios-tree-source.ts#idbTree` dropped it.
- So a tap on a disabled control replied a bare `Tapped` while nothing happened. Batch-10's chooser dump
  (`tests/fixtures/uiautomator-lab-resolver.xml`, API 33, the fresh layout) holds "Just once" and "Always"
  `clickable="true" enabled="false"` until a row is selected; T4 pinned the dropped mark as KNOWN-WRONG. D55c, which
  quotes the chooser's buttons from the tree, needs the mark.
- What the committed fixtures prove, per source:
  - uiautomator: 867 `true` and 2 `false` over the truth XMLs and the uiautomator/android fixtures; the two `false`
    are the chooser's buttons.
  - WDA: about 3,770 `"1"` and 2 `"0"`: `wda-capture-swift-form-pushed.json`'s pinned CONTINUE
    (`swift_payment.form.continue_button`, traits `NotEnabled, Button`) and `wda-capture-contacts-new-contact.json`'s
    Done (346,82 36x36, `NotEnabled`).
  - idb: every committed full capture says `true` (506 in `truth/ios-iphone17-ios27`); the trimmed fixtures lack the
    key. No committed idb payload holds `false`: the lab apps have no disabled control.

## Decision

**A node its source marks not enabled carries `disabled: true`; absent is enabled or unknown, never `false`. One
line per parser reads it:**

- uiautomator: `enabled === 'false'` (`android.ts#normalizeNode`).
- WDA: `isEnabled` `"0"` or `0`, through the file's one flag reading (`wda-source.ts#isZero`, as `isVisible` is read).
  The `NotEnabled` trait agrees in both captures and is not read: one field, one rule.
- idb: `enabled === false`, strictly (`ios-tree-source.ts#idbTree`).

Any other value — the attribute missing, true, `null`, a string where a boolean is printed — leaves the node
unmarked (fail open). The mark is per node, as dumped: no inheritance, no reinterpretation. It follows the repo's
mark convention (`hidden?: true`, `heading?: true`: "absent, never false"), so the JSON reads `"disabled": true`.

**`ui_snapshot` prints it with no code of its own.** `snapshotJson` is `JSON.stringify` of the tree; the mark lands
after `children` in key order. A filtered view keeps it (`stripChildren`).

**`tap` warns, never refuses.** When the node the tap went to (`ResolvedClear.node`, after any keyboard guard's
re-resolve) carries the mark, `tapElement` returns `disabled` and `tool-text.ts#tapText` adds one line, as swipe's and
launch's ⚠ lines are laid out:

```
Tapped id:button_once
⚠ The tree marks the target disabled, the tap may do nothing; read again before relying on it.
```

The tap is sent all the same. Reasons:

- The settle wait does not wait for enabled. A control enabled a moment after the read would turn a race into a
  failed tap in every flow.
- A wrong mark would block a working tap, and idb's `false` is unmeasured.
- averi's refusals are for taps that would land wrongly (covered, off screen, a sliver). A tap on a disabled control
  harms nothing; the dishonesty was the bare "Tapped", and the ⚠ line removes it.

Only `tap`'s MCP reply reads the mark. `fill`, `scroll_until`, the flow's `⚠ tap` trace, selectors, asserts, draw
order and the tap's judgement (`tap-judgement.ts`: a disabled bar still covers) are unchanged. There is no
`enabled:` selector field.

## Consequences

- The chooser's tree carries the mark on "Just once" and "Always" (T4's KNOWN-WRONG pin flipped). The recorded
  `android-ui-snapshot-lab-resolver.json` (batch-10 E4a) stays as taken; the test holds the parse equal to it plus the
  two marks. D55c can quote the buttons as the tree says them, and the ⚠ line covers an agent that taps "Just once"
  before a row.
- Golden: Changed 0 against the current base. The truth corpus holds no disabled node in any source, so no
  `ui_snapshot` or tap reply changes there. A differential run on the device corpus would show the mark and the ⚠
  line on trees like the SWIFT form pushed and Contacts' New Contact: expected, not a gate.
- The tool surface is unchanged (no description text added); `skill/references/tools.md` states the mark under
  `ui_snapshot` and the ⚠ line under `tap`.
- `types.ts` gains a field imported by scoped modules, so the mutation run is cold (ADR 0038). No scoped module is
  edited and no floor is added.

## Risks accepted

- idb's `false` is unmeasured: its field and type are measured on every element, its `false` value never was. The
  positive idb test is synthetic, a real capture with one element flipped. A raw idb list with a disabled control (the
  SWIFT form's CONTINUE, or a lab cell with a disabled button, which none has yet) is a capture cell to file (T6).
- WDA's `NotEnabled` trait is unread: a payload where `isEnabled` and the trait disagree is judged by `isEnabled`.
- uiautomator's `enabled` is View.isEnabled. An app that ignores taps without disabling the view, or that handles
  taps on a disabled one, is not seen.
- No wait for enabled: a control that becomes enabled just after the read is warned about and tapped, and the
  warning is then stale. The ⚠ line says to read again rather than to trust it.

# BUG (measured addendum): the iOS idb tree stayed EMPTY for 4+ minutes after a cold relaunch to the PIN screen, not just "right after launch"

**Measured 2026-10-06 17:02–17:07 CEST**, mp-native `com.finshape.dbosbanking` on `iPhone 17` (iOS 26.5), default idb
tree source, server built from `d69511e`. This extends `2026-10-06-ui-snapshot-empty-right-after-launch.md`, which
measured the problem only within seconds of `launch_app`.

## Measured

1. 17:02:10. `terminate_app` then `launch_app` (no `clearState`). averi's `screenshot` shows the registered PIN screen
   ("Log in / Enter your PIN to log in", keypad, "Forgot PIN?", "Password login").
2. `run_flow login_pin_ios_here` failed with
   `✗ wait text:"Enter your PIN to log in": failed — Timed out after 10000ms`. The text was on screen.
3. `ui_snapshot` (no filter) returned a root of `{x:0,y:0,width:0,height:0}` with one empty `other` child.
4. `idb ui describe-all --udid D34212DB-…` directly returned only
   `{"type":"Application","AXFrame":"{{0, 0}, {0, 0}}", …}`. It did the same every 10 s from 17:03:36 to 17:04:43, and
   again at 17:06:44.
5. A blank-area `idb ui tap 30 450` did not wake it. Switching to finportal and back did not wake it either. finportal's
   tree WAS readable through idb in between (`MyPort`, `English`, `Login` …), so the companion itself was working.

Before the relaunch, the same app's Account Detail tree was readable through idb (`nav.tab_transactions`,
`accounts.detail.available_balance`, `accounts.detail.action_pay`).

## Why it matters

- The existing note's workaround ("wait a moment, or use `screenshot`") does not cover this. The tree never arrived.
  Every flow step that keys on the PIN screen times out with the plain "Timed out … waiting for element" sentence.
- An empty tree reads as "absent" to every `detect`. On this project that is the registration guard's failure
  direction. The ladder did not fire here only because the flow used has no `requires:`.

## Suggestion

Same direction as the existing note, made stronger. A tree whose root has zero area and no labelled descendants is
"no tree", not "nothing matches":
- surface it as a read error, so polls retry it and timeouts say "the accessibility tree was empty (0×0 root)";
- refuse to evaluate a `requires:`/`detect` against such a tree.

## Addendum: context from the 2026-10-06 bug-fix session (branch `fix/bugs-2026-10-06`)

### Reproduced on a second app, and the tree recovered on its own

- **Measured 2026-10-06 16:13–16:16 UTC (18:13–18:16 CEST)** during the on-device check of the bug-fix branch.
  finportal (React Native "MyPort", normally `treeSource: wda`) ran under `treeSource: idb` from a scratch copy of its
  config, on the same iPhone 17 (iOS 26.5).
- After a cold relaunch the idb tree was the same 0×0 `Application` with one empty `other` child. It stayed that way
  from 16:13:54 to at least 16:15:28 UTC.
- In that window `screenshot` showed the rendered login form, and a WDA read at 16:15:43 returned all six login
  buttons. By 16:16:38 idb read normally again (about 2.5 min stuck).
- So the symptom is **not specific to mp-native, nor to SwiftUI**. WDA read the same screen correctly while idb was
  stuck, so the problem is idb's read and not the app.
- Measurement note: `docs/bugs/2026-10-06-bare-tree-misses-wda-rn-splash.md` on the bug-fix branch.

### What is already on the bug-fix branch (not yet on `main`)

- **`ui_snapshot` labels this tree** (commit `fix(mcp): a ui_snapshot that matches nothing says so…`,
  `src/ui-tree/bare-tree.ts` `isBareTree`).
  - A tree with no geometry at all (every rect zero-area) treats every structural node as a wrapper. So the 0×0
    `Application` counts as "bare" with or without an `AXLabel`.
  - A test pins both shapes through `parseIdbDescribeAll`.
  - The reply is `[]` plus `⚠ … the tree is bare: …`, which says the tree may be stuck on a rendered screen: compare
    with `screenshot`, do not read the element as absent.
  - Device-confirmed: every read of the stuck finportal tree got the ⚠.
- **What that does NOT cover.** It is a note on one MCP tool only.
  - Flow `wait:`/`detect`/`requires:` still evaluate the empty tree as "nothing matches".
  - The registration-guard risk described above is unchanged.
- **The wait-timeout hint names the wrong cause here** (commit `fix(flow): a wait: on an id iOS idb never surfaces…`).
  - A `wait:` on an id alone under idb that times out appends "no tree read contained id… idb never exposes an
    identifier set on a container… set `app.ios.treeSource: wda`".
  - On device, `wait id:login_screen` under idb got that hint both while the tree was stuck and after it recovered.
  - During a stuck tree the real cause is the empty read, not a container id.
  - The suggested read-error fix also solves this: `pollTimeoutMessage` (`src/ui-tree/read-tree.ts`) already drops
    the hint when the last read failed.

### Pointers for implementing the suggestion

- **The signature.** The stuck tree is the "no geometry at all" case: the largest rect area is 0, see `rectArea` in
  `src/ui-tree/geometry.ts`.
  - Use that narrow test, not `isBareTree` as a whole.
  - `isBareTree` is also true for a legitimate splash: WDA's 7-node splash, or Android's unlabeled decor during load.
    Those trees are loading and will change, and turning them into read errors would only rename the "still
    loading" case.
- **Where to raise it.** `IdbTreeSource.read` (`src/adapters/ios-tree-source.ts`) is where an all-zero-geometry
  result can be thrown as a read error.
  - `pollTree` retries read errors.
  - A timeout then says "last UI tree read failed: …".
  - `DeviceAdapter.treeSourceKind` (bug-fix branch) lets callers name idb in the message.
- **Not yet measured.**
  - Whether WDA can show the same symptom.
  - Whether anything other than waiting wakes idb: the original note's tap and app-switch did not.
  - How long it lasts. The 4+ min on mp-native and 2.5 min on finportal suggest a range, not a bound.

## Fix

**Shipped (branch `fix/bugs-2026-10-06`).**
- **The read.** `IdbTreeSource.read` (`src/adapters/ios-tree-source.ts`) throws `IdbEmptyTreeError` when the payload
  is `[]` or no element has a positive-area frame. The message names the cause, the screenshot check and
  `app.ios.treeSource: wda`.
  - The signature is the narrow one above. A lone full-frame `Application` (idb's launch transient) is still a tree,
    and `isBareTree` is not used.
  - The poll machinery then does the rest unchanged: `wait`/`detect`/`requires` retry it, timeouts say `last UI tree
    read failed: idb returned an empty accessibility tree …`, an `absent` wait or assert fails closed, the idb
    container-id wait hint is dropped, and the detect probe logs its `⚠ detect` line.
- **The ladder.** `pollTree` counts the rounds that read a tree (`treesRead`), and the detect probe answers
  `yes`/`no`/`unknown` (unknown: no read produced a tree).
  - At the top of the reach loop, a DESTRUCTIVE rung (`flowItselfIsDestructive`) whose immediately preceding probe
    was `unknown` is refused. The trace gets `⛔ reach <flow>` in place of the DESTRUCTIVE warning, and the call fails
    with `UnreadTreeRefusal`, which names the state, the rung and the last read error.
  - The refusal is terminal like a `SetupError`, so an outer ladder does not escalate past a nested `requires:`
    refusal.
  - Cheap rungs still run. `run_flow` never refuses the flow's own body, but a `requires:` inside it runs a ladder
    that applies the rule.
  - Pinned in `tests/flow/unread-tree-ladder.test.ts`, which runs the measured payload through the real
    `IdbTreeSource`.
  - Before refusing, an `unknown` probe gets one second look over the settle budget (`tapTimeoutMs`, 5 s by
    default, the wait a `tap:` uses for the same transient), so Android's null-root transient right after a cold launch (~2–3 s) does not refuse an ordinary run.
    A second look that reads the state ends the call; one that reads any tree runs the rung as before.
- **Accepted cost.** A transient that outlasts the second look is refused too. The fix is to retry the call.

**Deferred to the device protocol.** Each item needs a measured episode first.
- Prevention: pre-launch `ApplicationAccessibilityEnabled`.
- Cure: a bridge kickstart, or `AutomationEnabled`.
- Upgrading the fb-idb client, and `--api axbridge`.
- A first-read delay after launch.
- Widening the signature, for example to a lone framed `Application` lasting seconds inside an episode. Only if the
  raw JSON shows such a phase.

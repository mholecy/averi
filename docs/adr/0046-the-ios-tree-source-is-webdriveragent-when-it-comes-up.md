# 46. The iOS tree source is WebDriverAgent when it comes up

Status: accepted 2026-11-12 (performance backlog rows A41, decided by the owner, and A41a,
docs/plans/2026-10-30-performance-backlog.md). Golden unchanged: every recording pins its source. The next Gate C
checks the default block (see Acceptance).

## Context

- Under idb, on scroll-bounded and scroll-bounded-footer, averi says Tapped (S sliver, O outside the scroll view,
  footer O) while the app logged nothing. That is a false success claim. ADR 0010 accepted it as residual 5 because
  idb lists no scroll-view clip. idb also lists no presented layer under blur-menu-stacked/-grouped (A38). A38
  recorded what is left as KNOWN, with the same way out every time: `treeSource: wda`.
- The golden's unsafe residue is idb 42 against WDA 6.
- Closing the gap on idb alone would need a screenshot check per idb tap (rejected on cost in ADR 0010), or a hybrid
  that reads both trees and cross-checks them. The hybrid was rejected: it reconciles two trees, and the signals are
  incomplete either way.
- The reason idb was the default was cost: the server instructions said WDA was "~2x slower". On the lab that is no
  longer true for warm use. Warm WDA reads and taps are no slower than idb's (A41's D0 table). Gate C on 2026-11-12
  took 1 707 s on WDA against 1 869 s on idb.
- WDA's remaining costs are its cold start (3–23 s on the first read), fill +0.7 s, ensure cold +2.7 s, and the need
  for Xcode and the `appium-webdriveragent` optional dependency.

## Decision

**`app.ios.treeSource` takes `auto`, `idb` or `wda`, and `auto` is the default. Under `auto` the adapter's first tree
read asks WebDriverAgent to come up. If it does, every call is WDA's for the adapter's life. If it does not, every
read is idb's for the adapter's life, and every reply that claims what it read carries one `⚠` line saying so.**

- ONE source per adapter (ADR 0032): `auto` picks one and never reconciles two trees. A later WDA failure is WDA's
  error, as under `treeSource: wda`, never a switch to idb.
- "Can be brought up" is `WdaTreeSource.bringUp`, which is `WdaServer.ensureRunning` within its own bounds: the
  package is present, the first build succeeds, and /status answers within its readiness bound. It is decided once,
  lazily, at the first tree read, and kept. There is no probe at startup or at `launch_app`. Pre-warming is A41b.
- The fallback is said twice. averi's stderr gets one line with WDA's own error. Each claiming reply gets
  `⚠ read through idb: WebDriverAgent did not come up (treeSource auto; the reason is on averi's stderr) and idb lists
  no presented layer or scroll clip — a layer over the target or a clip cutting it was not judged`
  (`adapters/auto-tree-source.ts#IDB_FALLBACK_NOTE`, carried by `DeviceAdapter.claimNote`). The claiming replies are
  `tap` with a selector, `type_text` with a selector (a fill), `scroll_until`, `assert`, `run_flow`, `ensure_state`
  and `verify` (`mcp/tools.ts#noted`). A refusal claims nothing and gets no note. Nothing is refused for the fallback.
- Before the choice, what is asked without a tree read is idb's. The launch's application label comes from idb, as
  it did under the old default; WDA would answer `declined`, since it is not up. `kind` reads `idb` for the label's
  wording, and there is no settle cadence (the default 500). After the choice, `kind`, the settle cadence
  (ADR 0040), the system alert and the label are the chosen source's.
- Typing follows the choice (ADR 0037). `IosAdapter.typeable` is asked of the source per call. It is WDA_TYPEABLE
  until a fallback, and IDB_TYPEABLE after one, so a later value idb cannot type is refused before anything is sent.
  A text that needs WDA, typed before any read, makes the choice itself. If WDA does not come up, nothing is typed
  and the error says why.
- `treeSource: idb` and `treeSource: wda` behave as before, byte for byte. The registry caches per setting, so
  `auto`, `idb` and `wda` are three adapters.
- `app.ios.keyboardDismiss`'s load-time note (`flow/config.ts#inertKeyboardDismissNote`) is printed only for a
  project that pins `idb`. Under `auto` the list applies whenever WDA comes up.

## Residuals

1. Under a fallback, idb's blind spots stay: the false Tapped of ADR 0010 residual 5, and the presented layers A38
   left KNOWN. They are now said on the reply instead of hidden. A41c's hit test is the planned guard.
2. The first read of an `auto` adapter pays WDA's cold start (3–23 s, minutes for a first build). Before A41b nothing
   pre-warms it.
3. A fallback leaves `app.ios.keyboardDismiss` inert without a load-time note, because the config cannot know the
   choice. The claim note does not name the keyboard.
4. A fill whose value needs WDA, as a session's first action, is checked against WDA_TYPEABLE before the read that
   makes the choice. If WDA then does not come up, the field has been focused (and cleared, with `clear`) before the
   typing fails. This needs a value outside printable ASCII AND a WDA that cannot start.
5. Two adapters of one simulator, `auto` and `wda` (two projects, one server), each own a WdaServer on the same
   per-UDID port. That is the D41 situation of ADR 0032, unchanged.

## Acceptance

Golden Changed 0, because golden pins its source. Unit tests cover the choice, its caching, the fallback note and
typing. At the next Gate C (owner): the default block has ≤ 6 known unsafe, and its wall time is ≤ the idb block
+ 10 %.

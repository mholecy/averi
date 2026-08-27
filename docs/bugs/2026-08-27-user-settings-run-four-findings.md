# BUGS: four findings from the `user-settings` converge-feature run (averi 0.6.0)

**Measured 2026-08-27** in `/Users/mholecy/Finshape/skeleton` while building and verifying one
feature (`convergence/feature-specs/user-settings.md`) on both platforms.

**Build under test: 0.6.0 from source.** The consuming repo's `.mcp.json` runs
`npx tsx /Users/mholecy/dev/mobile-verify/src/mcp/server.ts`, so this is the live tree, not an
installed 0.5.0. Relevant because the four reports already in this directory are CLOSED against
0.6.0 — none of the findings below is a re-report of those.

**Devices:** Android `emulator-5554` (1080 px wide, 393 dp) · iOS `iPhone 17` (402 pt).

> **Convention note.** This directory is one-bug-per-file and each file accretes its own
> `Fixed` / `Verified` / `CLOSED` sections. This report is a single file because it was requested
> as one; **findings 1–3 are independent and should be split into their own files** if that
> tracking model is preferred. Finding 4 is partly a consuming-repo config problem and is written
> to say so explicitly.

| # | Finding | Severity | Verified |
|---|---|---|---|
| 1 | ~~`scroll_until` reports success for a clipped element~~ | — | ✅ **CLOSED — WITHDRAWN**, evidence misdiagnosed. Residue (**no occlusion check**) split out as owed item 7 |
| 2 | rect-parity's derived `aspect` row reintroduces contract-omitted dimensions as hard failures | **High** — 4 false deltas against correct code | ✅ **CLOSED** |
| 3 | text-parity flags every **combined** a11y label as `OCCLUDED`, suppressing the copy check | **High** — systematic, and it hides real drift | ✅ **CLOSED — fixed and verified on device**, through the MCP tool boundary |
| 4 | `ensure_state` has no cheap recovery for a recoverable *"session expired"* screen | **Medium** — costs a real device registration per occurrence | ✅ **CLOSED** |

---

## 1. ~~BUG: `scroll_until` returns "visible" for an element that is CLIPPED~~ — WITHDRAWN

> **Withdrawn 2026-08-27 the same day, on device.** The row was never outside the viewport
> (`bottom=2214` vs `viewport=2280`), so `scroll_until` was right. The app defect was a squeezed
> minimum, and what the screenshot showed was **occlusion by a floating overlay** — a real gap, but
> a different one. The section below is left as filed; the correction is in "FIX VERIFICATION".

### Observed

```
scroll_until(platform: android, selector: id:user_settings.overview.product_row_5, direction: down)
→ Element id:user_settings.overview.product_row_5 visible after 1 swipe
```

The row was **not** fully visible: it was cut off at the bottom of the viewport, behind the
floating bottom-nav bar, with the scroll already at its end. The immediately following assert:

```
FAIL element id:"user_settings.overview.product_row_5" rect within 2% of screen width
     — h 143.0 vs contract 60 → Δ-2.03% OVER
```

`143 px ÷ (1080/393) = 52.0` against the element's pinned minimum of **60**. The missing 8 was the
clipped part. After the app-side fix (bottom clearance for the floating bar) the same
`scroll_until` call plus the same assert reported `h 165.0` = **60.04** and passed.

### Source

`src/flow/engine.ts:838`, in `scrollUntilVisible`:

```ts
if (lastFound.some((n) => intersectsViewport(n.rect, viewport))) return swipes;
```

Any **intersection** — one pixel — satisfies the loop and the tool reports "visible".

### Why this is a bug

The word the tool prints is "visible", and the tool description says *"Swipe until the element is
visible in the viewport — the portable way to reach content below the fold"*. A caller reads that
as "this element is now on screen and measurable". It is the natural precondition for the very next
call, which is usually an assert or a screenshot.

Worse than the wording: **it actively masked the defect it was standing next to.** The whole point
of scrolling was to measure that row, and the scroll reported success on a row that could not be
measured correctly. I found the clipping only because an unrelated *height* assert failed, and my
first hypothesis was a layout bug in the app's row-height logic — the row was fine; the scroll
container had no clearance. A caller without a height pin in their contract would have measured a
clipped rect and never known.

### Fix shape

Cheapest first:

1. **Report what happened.** Keep the current stop condition but return/print the visible fraction:
   `visible after 1 swipe (clipped: 87% of height in viewport)`. Non-breaking, and enough for a
   caller to notice.
2. **Add a `fully: true` option** (default false, to preserve behaviour) that requires
   `containsRect(viewport, n.rect)` rather than `intersectsViewport`, and keeps swiping — then
   reports honestly when the content cannot scroll further:
   `not fully visible after N swipes: content exhausted, 8 px clipped at bottom`. That last message
   *is* the app bug this run had, stated directly.
3. Consider making `fully: true` the default for `scroll_until` when the caller's next step is a
   `rect` assert; at minimum, say in the tool description that "visible" means *intersects*.

### Acceptance

A row clipped by N px at the viewport edge, with the scroll at its end, must not be reported with a
bare "visible". Either the clipped amount is in the message, or the call reports failure to fully
reveal.

---

## 2. BUG: the derived `aspect` row reintroduces dimensions the contract deliberately omitted, and compares them in the wrong unit

### Observed

The contract omitted `h` on the section-header anchors **on purpose**, with the reason written into
the file: the two platforms report that height through different mechanisms (Android's a11y
touch-target floor inflates the node box to 48; iOS pads out and back in, so its box stays 40 while
the hit rect reaches 44). The documented semantics say an omitted field is *"compared
platform-to-platform only, never against the contract"* — which `h` honoured:

```
user_settings.overview.language_section x     24     66.0     24.0    +0.00   -0.14   +0.14
                                        w    345    948.0    354.0    -0.01   +0.27   -0.28
                                        h           132.0     44.0        —       —   +1.28
                                        aspect      7.182    8.045        —       —  10.73%  <-- ASPECT
```

`h` shows `—` against the contract, exactly as designed. But `aspect` then failed the run on the
same number:

```
6 DELTA(S) OVER 2.00% — each is a code-fix finding carrying its numbers:
  user_settings.overview.language_section aspect: android-vs-ios +10.73% (android 7.2, ios 8.0)
  user_settings.overview.contact_section aspect: android-vs-ios +10.73%
  user_settings.overview.product_visibility_section aspect: android-vs-ios +10.73%
  user_settings.overview.profile_row_0 aspect: android-vs-ios +3.85% (android 17.2, ios 17.9)
  user_settings.overview.profile_row_6 aspect: android-vs-ios +3.85%
  user_settings.overview.profile_row_0 -> language_section gap: android-vs-ios +4.66%
```

**All six were against correct code**, and the message told me to "Dispatch these to the
implementers verbatim". Five of the six are the `aspect` rows.

### Source

`src/verify/rect-parity.ts:248-268`, `compareAspect(anchor, a, i, ctx)` — it takes the two measured
rects and the context, and **never consults the contract**:

```ts
const aAspect = ratioOf(a);
const iAspect = ratioOf(i);
const spread = (Math.abs(aAspect - iAspect) / Math.max(aAspect, iAspect)) * 100;
const over = spread > ctx.tolerancePct;
```

Two separate problems compound here.

**(a) There is no way to opt out.** Omitting `h` from an anchor is the only expressive tool a
contract author has for "this dimension is not comparable on this element", and it does not reach
`aspect`. An author who has *correctly diagnosed* a per-platform measurement difference cannot
encode it.

**(b) The tolerance units do not match.** `spread` is a **relative percentage of a ratio**;
`ctx.tolerancePct` is documented throughout this file as **percent of screen width** — including in
the constant's own comment ("Max |delta| in % of screen width"). They are different quantities
sharing one threshold. The consequence is worst exactly where it bit here: on a high-aspect element
(the profile row is ~17:1) a legitimate device-width difference of 393 dp vs 402 pt — well under
0.5% of screen width, which the `w` row correctly reports as `-0.47` — becomes a **3.85%** aspect
spread and fails.

This file already contains the reasoning that should have excluded it. Its own header says absolute
`y` is never a finding source because *"two devices with different aspect ratios … drift ~2% apart
… from geometry alone"*. That is the same argument, and `aspect` on a high-ratio element is more
sensitive to it than `y` is, not less.

### Fix shape

1. **Honour the omission.** Skip the `aspect` row when either `w` or `h` is absent from the anchor —
   an author who omitted a side has said the shape is not comparable. (Smallest change; fixes 5 of
   the 6 deltas above.)
2. **Give `aspect` its own tolerance**, defaulting looser than the width tolerance
   (`tolerance_aspect_pct`, say 10–15%), because a ratio spread is not a width offset. Or normalize:
   compare `aspect` only after scaling both rects by their platform width, so device width divides
   out.
3. **Scale-guard high ratios.** For ratios above ~8:1 the spread is dominated by the short side and
   a 1 px measurement difference reads as several percent; either widen tolerance with the ratio or
   suppress the row and say why.
4. Optionally let an anchor carry `aspect: false` for an explicit opt-out, which also documents the
   decision in the contract where the next reader will see it.

### Acceptance

A contract that omits `h` on an element whose height the two trees derive differently must produce
**zero** deltas for that element. A 393-vs-402 device-width difference must not produce an
over-tolerance `aspect` delta on any anchor whose `w` delta is within tolerance.

---

## 3. BUG: every COMBINED accessibility label is flagged `OCCLUDED` — and OCCLUDED suppresses the copy check it protects

### Observed

```
user_settings.overview.profile_row_6  ocr  Phone +123 456 789 1  Phone +123 456 789 1  (dynamic)  —  OCCLUDED

UNREAD ANCHORS — the tree has copy the screenshot does not show; NOT compared as drift:
  user_settings.overview.profile_row_6: ios — the tree renders "Phone, +123 456 789 1" but the
  screenshot region reads "Phone +123 456 789 1" — UNREAD, cause not determined. Either something
  is drawn over the layout rect (a keyboard, sheet or dialog — the usual case), or the text is
  rendered at a contrast the recognizer cannot resolve, which would be a real defect.
```

Nothing was occluding anything, and the contrast was fine. The **only** difference is the comma —
which exists in the accessibility label and is not rendered anywhere on screen. Both platforms
produced it; it recurred on every combined row I asserted.

### Source — deterministic, no device needed

`src/verify/text-parity.ts:145`:

```ts
export const normalizeText = (raw: string): string => raw.replace(/[\s\xa0\u202f]+/g, ' ').trim();
```

Whitespace only — and note what that character class already covers: `\xa0` (no-break space) and
`\u202f` (narrow no-break space), i.e. the separators OCR produces when reading a formatted amount.
So exotic **whitespace** was thought about carefully; **punctuation** was not, and punctuation is
what a combined a11y label introduces. Then `survivesIn` (`:195-202`):

```ts
const want = treeString.toLowerCase();
const got = seen.toLowerCase();
if (got.includes(want)) return true;
const head = got.replace(/[….]+$/, '').trim();
return head.length >= 3 && want.startsWith(head);
```

For a combined row: `want = "phone, +123 456 789 1"`, `got = "phone +123 456 789 1"`.
`got.includes(want)` is false (the comma). The ellipsis fallback needs `want.startsWith(got)`, also
false. So `survivesIn` returns false, no tree string survives, and the anchor is classified
`OCCLUDED` at `:507`.

### Why this is a bug, and why it is the worst of the four

A **combined** accessibility label is not an edge case — it is the pattern the consuming repo's
`accessibility.md` §8 now *requires* for a multi-part row ("combined `{label}, {value}` — one node,
not two"), and it is what both platform implementations were changed to produce during this run. A
combined label is built by joining its parts with `", "`. That punctuation is, **by construction**,
never rendered. So the tree string can never survive in the OCR reading, and the anchor is *always*
UNREAD.

The guard's own comment says it is "deliberately narrow: flag only when the tree offers rendered
strings and NONE of them survive". The narrowness is real and well-judged — but the survival test
is too literal for the one label shape the accessibility contract mandates.

The sharp end is what `OCCLUDED` then does (`:495-510`): the row is **withheld from copy-drift
findings** and the run fails. So on every combined row, a genuine copy drift — the thing this table
exists to catch — is **masked by the false positive**. A silent suppression of a check is worse than
a noisy false alarm.

### Fix shape

1. **Compare on a punctuation-insensitive form inside `survivesIn` only.** Strip `,;:` (and collapse
   whitespace) from both sides before the containment test. Keep the *reported* strings verbatim so
   the message still shows the real difference. This is a two-line change and fixes the whole class.
2. **Better: try the tree's parts, not just the joined whole.** The tree already yields
   `renderedTextFromTree` as a `string[]`; for a combined label, split the joined value on `", "`
   and treat the anchor as read when the *parts* survive. That also handles OCR reordering, which
   the comment already notes as normal.
3. **Do not let a suspected capture problem suppress the copy comparison.** Consider reporting
   `UNREAD` as a warning alongside a best-effort copy comparison, rather than instead of it — or at
   minimum say in the message that the copy check was skipped for this anchor, so a caller knows
   what they lost.

### Acceptance

An anchor whose tree label is `"Phone, +123 456 789 1"` and whose rendered copy is
`"Phone +123 456 789 1"` must compare as **OK**, on both platforms, and must remain subject to
copy-drift comparison.

---

## 4. `ensure_state` burns a device registration recovering from a RECOVERABLE "session expired" screen

Partly a consuming-repo config problem — stated plainly below — but with an averi-side ask.

### Observed

Nine `clearState` logins over one session, each printing:

```
⚠ clearState: app state wiped (data container deleted) — anything the app persisted,
  a device registration included, is gone (N this session)
```

Most were legitimate: `install_app` wipes app state, so a login is genuinely required after each
install. But at least one was not. Reaching for the app after ~30 minutes on the other platform, the
Android screen was:

> **Logged out** — *Due to your inactivity you have been logged out for security reasons. You can
> now log in again.* **[ LOGIN ]**

The app has a **session inactivity timeout**, and it lands on a screen from which the session is
recoverable: **the device registration is still valid** and a PIN login restores it. Instead:

```
flow dismiss_post_login_prompts: start
⚠ reach dismiss_post_login_prompts: failed, escalating to login — Timed out ... id:"nav.tab_transactions"
flow login: start
launch: com.finshape.skeleton.dev (state cleared)     ← registration destroyed
... full re-registration ...
```

### Where the responsibility sits

Mostly with the consuming `averi.yaml`, and I will fix that end:

- `logged_in`'s `detect.any:` has four conditions; none matches the logged-out screen — **correctly**,
  the app *is* logged out.
- Its `reach:` is `[dismiss_post_login_prompts, login]`, and `login` opens with
  `launch: { clearState: true }`.
- The file **already contains three non-destructive PIN re-login flows** (`login_pin_here`,
  `login_pin_android_here`, `login_pin_ios_here`).
- `grep -i "logged out\|inactivity"` over `averi.yaml` returns **nothing** — the recoverable screen
  is not modelled at all.

So the cheap rung exists and simply is not wired. That is on the config, and it is a ~10-line fix
(a `session_expired` state detecting that screen, PIN-login reach, placed before `login`).

### The averi-side ask

The engine already invests heavily in *not* escalating into a `clearState` rung unnecessarily — the
recheck-between-rungs work recorded in `2026-08-26-ensure-state-no-recovery-pass.md` and
`2026-08-26-recovery-pass-skips-throwing-last-rung.md` exists for exactly that. Both of those
protect against escalating **too eagerly**. This case is different and not covered: the escalation
was *correct* (the app really was logged out) and still **maximally expensive**, because nothing
distinguishes "log in from scratch" from "re-authenticate an already-registered device".

Worth considering, cheapest first:

1. **Warn before running a destructive rung**, naming it: `reach rung 'login' will clearState —
   registration will be lost`. The post-hoc `⚠ clearState … (N this session)` is honest but arrives
   after the cost. A pre-flight line lets a human watching the run interrupt.
2. **Let a flow declare its cost** (`destructive: true`, or infer it from `clearState`), and prefer
   a non-destructive rung when several could reach the state. Today rung order is the only
   expression of preference, and it is unconditional.
3. **Surface the session-lifetime hazard in the skill/docs**: a long gap between two platform legs
   is normal in a cross-platform run, so an inactivity timeout mid-run is normal too, and the default
   config turns it into a registration burn.

### Acceptance

Recovering from an inactivity timeout on a device whose registration is still valid should cost a
PIN login, not a re-registration — and if the config offers no cheap rung, the run should say so
before spending the expensive one.

---

## Verifying these on a device — reproducible from this run

Everything below runs against the feature this report came from, so a maintainer can reproduce each
finding and then prove a fix without inventing a fixture. **Findings 2 and 3 reproduce on the
shipped app in a single call and need no app change at all** — they fired on correct code, which is
what makes them good regression tests.

### Setup (once)

```bash
cd /Users/mholecy/Finshape/skeleton
# submodules are on spike/user-settings: Android 77942756 · iOS a26d2d5 · ops 7426659
(cd mp-android-skeleton && git log --oneline -1)   # expect 77942756
(cd mp-ios-skeleton     && git log --oneline -1)   # expect a26d2d5

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer scripts/build-for-averi.sh both
```

Then `install_app` for each platform. Devices used here: Android `emulator-5554` (1080 px / 393 dp),
iOS `iPhone 17` (402 pt). A VPN connection is required — the screen's data is live.

> Reaching the screen costs a login per install (`install_app` wipes app state). On Android that is
> cheap; on iOS each one burns a device registration, so do the iOS leg last and once.

### Findings 2 + 3 — ONE call, no app change, on the shipped tree

```jsonc
verify({
  platforms: ["android", "ios"],
  flow: "goto_user_settings",              // lands BOTH legs on the same (collapsed) state
  contract: "convergence/contracts/layout/user-settings.overview.contract.json",
  asserts: [
    { element: { id: "user_settings.overview.title" }, text: "SETTINGS" },
    { element: { id: "user_settings.overview.profile_row_6" }, text: "Phone, +123 456 789 1" }
  ]
})
```

Use `flow:`, **not** `state:` — see the DX note under finding 4's siblings below; with `state:` a leg
already on the screen reports "already active" while the other reaches it from scratch, and the two
legs can end up in different screen states.

**Today (0.6.0) this reports, against code that is correct:**

- **Finding 2** — `5 aspect deltas over 2.00%`: `language_section`, `contact_section`,
  `product_visibility_section` at **+10.73%** (the 48-vs-44 a11y-floor difference, whose `h` the
  contract deliberately omits) and `profile_row_0`, `_6` at **+3.85%** (the 393-vs-402 device width
  on a ~17:1 element, whose `w` delta is a correct `-0.47`).
- **Finding 3** — `profile_row_6` → **`OCCLUDED`**, "the tree renders `"Phone, +123 456 789 1"` but
  the screenshot region reads `"Phone +123 456 789 1"`". The element asserts in the same call
  **pass**, which is the tell: the copy is right, the classifier is wrong.

**Acceptance after a fix — same call, unchanged:**

- Finding 2: `rect parity: WITHIN TOLERANCE` — **zero** deltas. The `h` and `aspect` rows may still
  print their measured values; they must not be findings.
- Finding 3: `profile_row_6` → **`OK`** (or `—` for a `text_dynamic` anchor), and it must appear in
  the copy-compared set rather than the withheld one.

Finding 3 additionally has a **pure unit-level** acceptance that needs no device:

```ts
survivesIn('Phone, +123 456 789 1', 'Phone +123 456 789 1')   // must be true
survivesIn('Full name, Arthur Dent', 'Full name Arthur Dent') // must be true
survivesIn('CONTINUE', '')                                    // must stay false (real UNREAD)
survivesIn('Enter amount', '0.00')                            // must stay false (real drift)
```

The last two matter as much as the first two: the guard's narrowness is deliberate and must survive
the fix.

### Finding 1 — needs a one-line app revert to reproduce

The app is fixed, so reproducing the masked defect means putting the clipping back. One line each:

```bash
# Android — presentation/user-settings/.../usersettings/UserSettingsScreen.kt:155
#   bottom = UserSettingsLayout.CONTENT_BLOCK_GAP + navClearance,   → drop "+ navClearance"
#   (leave the `val navClearance` at :138 alone; dropping only the usage keeps the diff to one line)
# iOS — .../Profile/UserSettingsOverview/UserSettingsMetrics.swift:147
#   static let tabBarClearance = CGFloat.size(.size6) + CGFloat.spacing(.space5)
#                                                     → CGFloat.spacing(.space10)
```

Rebuild, install, then:

```jsonc
run_flow({ platform: "android", flow: "goto_user_settings" })
run_flow({ platform: "android", flow: "expand_user_settings_widgets" })
scroll_until({ platform: "android", selector: "id:user_settings.overview.product_row_5", direction: "down" })
assert({ platform: "android", asserts: [
  { element: { id: "user_settings.overview.product_row_5" },
    rect: { x: 24, w: 345, h: 60, frameWidth: 393 } }
]})
```

**Today:** `scroll_until` → `visible after 1 swipe`, then the assert **fails** with `h 143.0 vs
contract 60 → Δ-2.03% OVER` (143 px ÷ 2.748 = 52.0; the missing 8 is clipped). The scroll reported
success on a row that could not be measured.

**Acceptance after a fix:** on the reverted (clipping) app, `scroll_until` must **not** report a bare
"visible" — either the message carries the clipped fraction, or with `fully: true` it reports failure
to fully reveal, naming that the content is exhausted. Then **restore the two lines** and re-run: on
the fixed app the same sequence must report fully visible and the assert must pass at `h 165.0` =
60.04. Both halves are needed — a fix that only makes the clipped case fail could equally be a fix
that makes every case fail.

### Finding 4 — needs an expired session

```jsonc
// 1. reach the screen and confirm a live session
run_flow({ platform: "android", flow: "goto_user_settings" })
// 2. leave the app idle until the backend's inactivity timeout fires (~30 min in this run);
//    confirm with a screenshot showing "Logged out — Due to your inactivity…" + [LOGIN]
screenshot({ platform: "android" })
// 3. ask for the state again
ensure_state({ platform: "android", state: "logged_in" })
```

**Today:** `⚠ reach dismiss_post_login_prompts: failed, escalating to login` →
`launch: … (state cleared)` → full re-registration, while the registration was still valid and a
PIN login would have restored the session.

**Acceptance** splits by which fix is taken. For the pre-flight warning (fix option 1), a line naming
the destructive rung must appear **before** `launch: … (state cleared)` — verifiable immediately, with
no wiring change. For the cheap-rung preference (option 2), after adding a `session_expired` state to
the consuming `averi.yaml` the same call must reach `logged_in` **without** any
`clearState: app state wiped` line, and `adb shell pm list packages` plus a PIN login must show the
registration intact.

### Verifying a fix LANDED — the trap this repo's own history records

Three of the four reports already in this directory record a fix that passed and did not hold:

- `2026-08-26-ensure-state-no-recovery-pass.md` — *"the fix does NOT cover the production shape"*,
  found only when it was re-run against the real login flow rather than a synthetic probe.
- `2026-08-26-png-scale-needs-out-of-tree-screen-size.md` — *"two ways the first cut reintroduced the
  bug"*, then *"the fixes themselves were the next bug"*, then *"the same class, twice more"*.
- `2026-08-26-recovery-pass-skips-throwing-last-rung.md` — three review rounds, one of which
  *"invalidated its own evidence"*.

So, concretely, for the findings above:

1. **Re-run the original call, not a reduced one.** For findings 2 and 3 that is the exact paired
   `verify` above, both platforms, both contracts — the shapes that produced the false deltas are
   device-width- and platform-tree-dependent and a single-platform run cannot show them (a
   single-platform run prints `skipped — no contract fields to compare` for the aspect row and hides
   the whole class).
2. **Keep the negative half.** Every fix here narrows a check, so each needs a case that must still
   fail: a genuinely occluded anchor for finding 3, a genuinely wrong shape for finding 2, a
   genuinely off-screen element for finding 1. A fix measured only by "the false positive stopped"
   cannot distinguish itself from disabling the check.
3. **Diff the numbers, not the verdict.** `rect parity: WITHIN TOLERANCE` is not evidence that the
   `h`/`aspect` rows still *measure* correctly; compare the printed values against those in this
   report (Android `h 132.0` / iOS `h 44.0`; aspect 7.182 / 8.045) and confirm they are unchanged
   while the finding is gone.
4. **Re-measure on device after the fix.** rect-parity's own advice applies to averi's fixes as much
   as to app fixes: *"A fix that should change a rect and doesn't is a mis-aimed fix."*

### Telling an averi bug from an app or config bug — the check that corrected me

I got this wrong once in this session and only measurement fixed it. I had concluded that Android's
`logged_in` detect was failing because Android prunes off-screen nodes, and was about to file that.
One `screenshot` falsified it: the app was on an inactivity **"Logged out"** screen, so the detect
was correct and the real finding was about *recovery cost*, not detection.

The sequence that distinguishes them, cheapest first:

1. **`screenshot` before theorising.** It is one call and it decides most of these.
2. **`ui_snapshot` with a `label~` filter, not just `id:`.** This is what separated finding 3 from a
   real copy bug, and it is what found the two-sibling-node defect in the consuming app: filtering by
   id showed `label: null`, filtering by label showed the same rect carrying the text with
   `identifier: null`. Two filters, two nodes, one rect — the id/label split is invisible from either
   filter alone.
3. **Compare the tree against the render deliberately.** `text` asserts read the tree; `ocr` asserts
   read pixels. When they disagree, decide which one the check was about *before* changing anything —
   an accessibility label and rendered copy are different artefacts and are allowed to differ.
4. **Check whether the consuming config even models the case.** For finding 4,
   `grep -i "logged out\|inactivity" averi.yaml` returning nothing was the answer: nothing was
   broken in averi's escalation, the state simply was not declared.

## FIX VERIFICATION — 2026-08-27, same day, on the same two devices

The fix landed locally (uncommitted at the time of writing: 7 `src/` files, 3 test files, `skill/SKILL.md`).
`npm test` → **556 passed / 23 files**; `npm run lint` → clean.

**The session's MCP server could not be used to verify.** It is spawned once per session as
`npx tsx src/mcp/server.ts`, and `tsx` does not hot-reload, so the running process still held the
pre-fix code. Detected rather than assumed: `scroll_until` returned the **old** message shape
(`visible after 0 swipes`; the fixed code says `fully visible after 0 swipes`). Everything below was
therefore verified by importing the **fixed source directly** and driving the live devices — which
covers the logic but *not* the MCP tool wiring. **A session restart is still needed to verify the
tool surface end to end.**

| Finding | Verdict |
|---|---|
| 1 | **fix is sound, but my evidence was wrong — see the retraction below.** Clean path verified; no measured false-negative remains to fix. |
| 2 | **VERIFIED — closeable.** |
| 3 | **PARTIALLY FIXED — one real shape still fails. Not closeable.** |
| 4 | **VERIFIED — closeable.** |

### Finding 2 — VERIFIED

`compareRectParity` run against the **real contract and real trees from both devices**, both legs on
the collapsed screen:

```
total findings: 3
  gap  profile_row_0 -> language_section                android-vs-ios Δ4.66
  gap  language_section -> contact_section              android-vs-ios Δ-20.35
  gap  product_visibility_section -> profile_row_6      android-vs-ios Δ17.65
aspect findings: 0   → PASS
```

**All five false `aspect` deltas are gone**, after adding `aspect: false` to the five affected anchors
with the reason beside each — which is the consuming-side half of this fix and worked as documented.

The three remaining `gap` findings are **not** this fix's business, and two of them are **my
contract's fault**: I placed `profile_row_6` *after* the section headers in the anchor list, so the
gap chain walks backwards up the screen and the magnitude tracks the profile card's height, which
differs by the email wrap. The third (`Δ4.66`) is that same email wrap, already classified as
accepted variance. Anchor order is a contract-authoring hazard worth a line in
`references/layout-contract.md`: **the gap chain follows contract order, so contract order should
follow visual order.**

**"Diff the numbers, not the verdict" — checked, and it holds.** The fix promised that an opted-out
anchor still *prints* both ratios so drift stays visible. Verified from the rendered table, against
the exact values recorded earlier in this report:

```
language_section   h       132.0    44.0    —    —   +1.28
                   aspect  7.182   8.045    —    —   opt-out    ← measured, printed, not compared
profile_row_0      aspect 17.200  17.889    —    —   opt-out
title              aspect  3.839   3.783    —    —   1.46%      ← NOT opted out, still COMPARED
```

`h 132.0 / 44.0` and `aspect 7.182 / 8.045` are unchanged from the pre-fix run — the numbers were not
lost, only the judgement stopped. And the negative half is intact: `title` carries no `aspect: false`
and its shape is still actively compared at 1.46%, so the opt-out is per-anchor rather than a blanket
disable. That was the failure mode worth checking — a fix that silently dropped the row would have
looked identical in the findings count.

**The design decision here was better than my proposal, and worth recording.** I proposed "skip the
aspect row when `w` or `h` is omitted". That was declined, correctly: omission means *"not pinned"*,
which cannot express *"the two platforms derive this side by different mechanisms"* — and only the
second justifies stopping the comparison. The measurement that settles it is in the fix's own comment:
a **real** shape bug measured **11.71%**, one point above my false positive's **10.73%**, so no
tolerance could ever have separated them. An explicit per-anchor opt-out was the only correct answer.

### Finding 4 — VERIFIED

Android was sitting on the exact recoverable screen the report describes (*"Logged out — Due to your
inactivity…"*), so this was verified against the production shape rather than a synthetic one. Driving
the **fixed** `FlowEngine.ensureState('logged_in')`:

```
{ action: '⚠ reach login',
  detail: 'this rung is DESTRUCTIVE — it wipes app state, and any device registration with it.
           If the app is on a RECOVERABLE screen (an inactivity timeout, an expired session), a
           cheaper non-destructive rung declared BEFORE this one would restore it instead' }
...
{ action: '⚠ clearState', detail: 'app state wiped (data container deleted) — ...' }

warning line index=4, wipe line index=6
→ pre-flight warning present: PASS
→ warning BEFORE the wipe:    PASS
```

Both halves of the stated acceptance hold: the warning exists, and it precedes the wipe. It also names
the *remedy* (declare a cheaper rung before this one), which is what makes it actionable rather than
merely alarming. The consuming-side `session_expired` state is still mine to wire.

### Finding 3 — PARTIALLY FIXED. **NOT CLOSED.**

> **Superseded 2026-08-27, same day.** The completion below closed the three remaining shapes in
> source, and "Finding 3 — VERIFIED ON DEVICE" closed the device half. This section is left as
> filed: it is the record of a half-fix that read as a whole one, which is the reason the device
> leg is now part of the acceptance rather than an afterthought.

**Status: the fix is correct as far as it goes and must be kept, but it closes one of the four real
shapes this run measured. Three still fail — and all three are product rows, i.e. the exact anchors
that were flagged `OCCLUDED` in the original paired run.**

#### What was tested, and how it failed

`survivesIn` re-run against the **verbatim tree/OCR pairs measured on device 2026-08-27**, not against
paraphrases:

```
UNREAD  product_row_0
          tree : "My Account, 5304826947468842, visible"
          ocr  : "My Account € 5304826947468842"
          parts-rule would say: read
UNREAD  product_row_4
          tree : "My Account, * 5433, visible"
          ocr  : "My Account *5433"
          parts-rule would say: read
UNREAD  product_row_5
          tree : "My Account CZK, * 5434, visible"
          ocr  : "My Account CZK *5434"
          parts-rule would say: read
read    profile_row_6            ← the one the fix DOES close
          tree : "Phone, +123 456 789 1"
          ocr  : "Phone +123 456 789 1"
```

**1 of 4 fixed. 3 of 4 still UNREAD**, and each of those three still fails the run and is still
withheld from copy-drift comparison — which is the harm this report identified in the first place: the
false positive *suppresses* the check it was protecting.

The negative half is intact and must stay so — `survivesIn("CONTINUE", "")` and
`survivesIn("Enter amount", "0.00")` are both still `false`.

#### Why punctuation stripping cannot reach these three

`looseForm` drops `,;:` and collapses whitespace. That is exactly right for the separator, and it is
why `profile_row_6` now passes. But the three product rows fail for **two further reasons that have
nothing to do with punctuation**:

1. **A part of the label is never rendered at all.** `", visible"` describes the state of a **toggle
   graphic**. There is no text on screen for OCR to read, ever — not at any contrast, not at any
   resolution. `accessibility.md` §8 *requires* that state be in the label (`"one node including the
   switch state"`), so this is the mandated shape, not an accident.
2. **OCR both drops and inserts characters inside the remaining parts.** It read `"*5433"` where the
   tree holds `"* 5433"` (dropped space), and on `product_row_0` it read `"My Account € 5304826947468842"`
   — **inserting a `€`** it recognised from the leading currency avatar, which is an image, not text.

So the joined tree string can never be a substring of the reading, however the separators are
normalised. Containment of the *whole* joined label is simply the wrong test for a combined label.

#### The completion, and why it is consistent with the guard's own intent

This is the shape fix option 2 in this report targeted — *"try the tree's parts, not just the joined
whole"*. Option 1 (punctuation) was taken alone; option 2 is still owed.

The guard's own comment already states the principle: *"A partial mismatch is normal (OCR merges and
reorders lines a tree keeps separate), so requiring total disappearance is what keeps this from firing
on healthy anchors."* A combined label is precisely a case where partial mismatch is normal — and the
current code demands total survival of the joined string, which contradicts that stated intent.

**Proposed rule:** split the joined label on `", "` and treat the anchor as **read** when **any** part
survives. Measured above: it makes all three product rows read, and it does **not** weaken the
negative half — `"CONTINUE"` has one part and no survivor, `"Enter amount"` likewise, so both stay
UNREAD.

#### Acceptance for closing finding 3

All six must hold together:

```ts
survivesIn('My Account, 5304826947468842, visible', 'My Account € 5304826947468842') === true
survivesIn('My Account, * 5433, visible',           'My Account *5433')              === true
survivesIn('My Account CZK, * 5434, visible',       'My Account CZK *5434')          === true
survivesIn('Phone, +123 456 789 1',                 'Phone +123 456 789 1')          === true   // regression
survivesIn('CONTINUE',     '')     === false   // negative half must survive
survivesIn('Enter amount', '0.00') === false   // negative half must survive
```

Plus, on device: the paired `verify` in "Verifying these on a device" must show
`user_settings.overview.product_row_0` / `_4` **compared** (`OK` or `—` for a `text_dynamic` anchor)
rather than listed under `UNREAD ANCHORS`.

### Finding 3 — COMPLETED (source), 2026-08-27

Fix option 2 landed in `src/verify/text-parity.ts`. `survivesIn` keeps the whole-string test first,
and when that fails **and the label is genuinely joined** (`', '` present, so `parts.length >= 2`) it
accepts the anchor as read if **any substantial part** survives. Two guards keep the narrowness the
guard's comment insists on:

- **A single-part string never reaches the parts rule.** `'CONTINUE'` and `'Enter amount'` have had
  their one chance at the whole-string test, so the negative half is untouched *by construction*,
  not merely by measurement.
- **A part under 3 characters cannot vouch for the row** (`MIN_PART_LENGTH`, the same floor the
  ellipsis fallback already used). `'Kč'` turns up in half the amounts on screen; a match that short
  is coincidence, not evidence the region was read.

All six acceptance cases hold, plus three further negatives now pinned: a combined label against an
empty reading, against unrelated copy, and the short-part case above. An integration test pins the
table-level outcome the acceptance actually asks for — a product row carrying `', visible'` is
**compared** rather than listed under `UNREAD ANCHORS`.

**Verified by mutation (re-measured 2026-08-27 against the final corpus).** With the split disabled,
**six** pins fail — the four original shapes plus the two later boundary/cost pins — and the 56
pre-existing text-parity tests pass unchanged, including every occlusion guard (the IME over the CTA,
the empty reading, the partial-mismatch card, the iOS button). An earlier draft said "four", which
was measured before the last two pins landed; that is the same defect as commit `aeb3215` in this
repo and is why the count is now dated. The six is also the stronger number: the two added pins
failing is what proves they exercise the rule rather than restating it.

**What that does and does not prove** — an earlier draft of this section overclaimed it, and an
independent reviewer was right to strike the claim. The indifference of the 56 shows the new
behaviour is pinned only by the new pins, i.e. the tests are well factored. It is NOT evidence that
the loosening is confined to the intended class, because the corpus contains no
partial-occlusion-of-a-combined-label case — which is precisely the surface the parts rule loosened.
That gap is now closed deliberately rather than left implicit: the cost is stated in the code and
pinned by a test (below), not argued away.

**The cost this rule accepts.** A part surviving answers only *was this region read at all*. It
cannot see a dialog covering a combined row's VALUE while the leading label part stays legible in the
anchor's region — pre-change that was OCCLUDED and failed the run; it is now reported as read. And
for a `text_dynamic` anchor — which **all four measured shapes are** — no string comparison follows,
so the honest trade for that class is *"false alarm that failed the run" → "no check, run passes"*,
not *"now compared as drift"*. Accepted, for three reasons that are each checkable: a wholly covered
region still has no survivor and still reports OCCLUDED (pinned); the identical blindness has always
existed for the two-node spelling of the same row, because the caller is itself a `.some()` over tree
strings; and the false positive it replaces suppressed the copy check on EVERY combined row.

`MIN_PART_LENGTH` is pinned from both sides — a 2-character part must not vouch, a 3-character part
must — so the floor cannot silently drift upward and over-narrow the guard. Verified by mutation at
2, 4 and 6; each fails.

Note what the rule does and does not claim. "A part survived" answers only this guard's question —
*was this region read at all* — and never *is the copy right*. What it buys is stated in full in the
cost paragraph above, which is the qualified version of that claim; it is deliberately not repeated
here unqualified.

### Finding 3 — VERIFIED ON DEVICE, 2026-08-27 — **CLOSED**

Run through the MCP **tool** boundary, which is what owed item 6 asked for: this session's server
started at `20:03:39`, after the last source edit at `19:11:27`, so it loaded the fixed tree. The
trace confirms it independently — `scroll_until` printed `fully visible`, the post-fix wording, which
is this repo's own staleness probe.

Devices and build as in the original run: Android `emulator-5554` (1080 px / 393 dp), iOS `iPhone 17`
(402 pt). Both apps rebuilt from `spike/user-settings` (`77942756` / `a26d2d5`) and reinstalled — APK
`20:05:24`, `.app` `20:06:34`. Both legs reached the screen with `flow:`, never `state:`, and
`expand_user_settings_widgets` ran exactly once per device.

#### Unit half, re-measured first

All six acceptance cases hold against the verbatim device strings, `npm test` **565 passing**
(556 baseline + 9), `npm run lint` clean.

#### Paired `verify` on the unchanged contract

| anchor | before | after |
|---|---|---|
| `product_row_0` | `OCCLUDED` | **compared** — ocr `My Account € 5304826947…`, verdict `—` |
| `product_row_4` android | `OCCLUDED` | **compared** — ocr `My Account` (a part survived) |
| `product_row_4` ios | `OCCLUDED` | `OCCLUDED` — ocr reads `(nothing)` |

The acceptance names `_0` **and** `_4`, so the surviving iOS row was chased rather than argued away.
It is **not** the false positive this finding is about: that row was not on screen. iOS
`scroll_until(fully: true)` took **1 swipe** to reveal it, and with the row actually rendered the same
tool call on the same contract returned:

```
user_settings.overview.product_row_4  ocr  My Account *5433  (dynamic)  —  —

text parity: MATCHES (size tolerance 10.00%) on 4 of 4 anchor(s) — 0 not opted in.
rect parity: WITHIN TOLERANCE (2.00%) on all 4 anchor(s).
```

`My Account *5433` is the verbatim OCR reading from the shape table above — compared, not withheld.
**Zero UNREAD anchors.** The guard now fires only where nothing was read, which is the negative half
working, not the bug.

#### What this run does NOT prove

- **The third shape has no anchor.** `My Account CZK, * 5434` is `product_row_5`, which this contract
  does not measure — only rows 0 and 4 carry `text_dynamic`. It is closed by the unit acceptance and
  travels the identical code path, and the iOS screenshot shows it rendered, but no device assertion
  covers it. Adding a `product_row_5` text anchor would close that gap honestly.
- The paired run's remaining deltas are substrate, diagnosed below, not evidence about this finding.

#### Two measurement facts this run established, neither of them finding 3

1. **An off-fold anchor poisons rect parity asymmetrically.** `product_row_4` sat under the floating
   tab bar. Android's tree returned `y=2198 h=82` — bottom exactly `2280`, the viewport edge —
   instead of the 60 the contract documents, while iOS returned its full `h=52` at `y=636..688`, past
   the 874 pt screen. That manufactured all three deltas the paired run reported as "code-fix
   findings" against correct code: `product_row_4 h -5.34%` and `aspect +41.11%`, and they vanish
   entirely once the row is scrolled on screen (`WITHIN TOLERANCE` above). **Confirm an anchor is
   fully on screen on BOTH legs before dispatching any delta from it.**
2. **`scroll_until(fully: true)` cannot detect that on Android.** It answered `fully visible after 0
   swipes` on the clipped row, because the clipped box it tests is trivially inside the viewport;
   iOS, which does not clip, correctly took 1 swipe. This is a **second measured instance of owed
   item 7** — averi has no notion of occlusion — reached by a different route than the first, and it
   says the residue is not confined to floating overlays: a platform that clips its own reported
   bounds defeats the check silently.

The third delta, `product_row_0 aspect +2.62%`, is not off-fold and is not an averi regression: `h`
is equal (52.04 vs 52) and `w` is 345 vs 354, i.e. the 393-vs-402 device width alone. The contract
sets neither `tolerance_aspect_pct` nor `aspect: false` on an anchor whose `h` it omits deliberately
and at length — a consuming-contract gap, filed against the contract, **not** a reopening of finding
2, whose own acceptance sentence it nonetheless matches.

#### Cost of the run

Two device registrations, one per platform: `dismiss_post_login_prompts` failed its reach and
escalated to the destructive `login` rung on both legs. Finding 4's pre-flight warning fired
correctly and named the wipe each time (`1 this session`, then `2 this session`) — it warns, it does
not avoid, which is fix option 1 behaving as shipped and the reason option 2 is still owed.

### Finding 1 — RETRACTION: my evidence was misdiagnosed

**The fix is a genuine improvement and its clean path is verified**, on both platforms:

```
android fully:false → "fully visible after 1 swipe"  clipped=[] visible=1.000
android fully:true  → "fully visible after 0 swipes"
ios     fully:false → "fully visible after 1 swipe"  clipped=[] visible=1.000
ios     fully:true  → "fully visible after 0 swipes"
```

**But the defect I filed it against was not a clipping defect at all, and `scroll_until` was right.**

I ran the revert this report documents, rebuilt, reinstalled, and measured every product row on the
**reverted** app:

```
viewport h=2280
  row_0..row_3 (accounts): h=143  (52.0 dp)
  row_4        (card):     h=165  (60.0 dp)   ← correct
  row_5        (card):     h=143  (52.0 dp)   ← the symptom
  row_5: y=2071  bottom=2214   vs viewport 2280
```

`bottom=2214 < 2280`: **the row was fully inside the viewport the whole time.** `clippedEdges`
correctly returns `[]`, and the pre-fix "visible" was correct too. Two things were actually true, and
neither is what I wrote:

1. **The app bug was a squeezed minimum, not a clip.** Row 5 is the *last* child of a scrolling
   `Column`; with no bottom room its `heightIn(min = 60)` was clamped by the remaining space to 52.
   Adding the clearance gave it room and it renders 60. So the rect assert caught a **real layout
   bug** by doing exactly its job — it was never masked by `scroll_until`.
2. **What I actually saw on the screenshot was OCCLUSION.** The floating bottom nav is an overlay; it
   does not reduce the viewport. The row sat *behind* it, fully "visible" by every geometric measure
   averi has.

So finding 1 as filed is **withdrawn**, and the residue is a different and better finding:

> **averi has no notion of occlusion by a floating overlay.** An element can be entirely inside the
> viewport, pass a `rect` assert, satisfy `scroll_until` (with `fully: true` as well), and be
> completely invisible to the user behind a tab bar, snackbar or sheet. Every geometric check averi
> owns says fine. The only signal in this run was a human looking at a screenshot.

That is worth its own report rather than a paragraph here, and it is not what the `fully`/`clipped`
work addresses. The `fully` option remains a sound addition — `intersects` genuinely is a surprising
default for a caller about to measure — it simply has **no measured false-negative** behind it now,
so its severity is DX, not correctness.

Two process notes, since they are the reason this retraction exists at all:

- **Using the real measured strings instead of my headline example** is what exposed finding 3's gap.
  Had I tested only `"Phone, …"`, I would have closed a half-fixed bug.
- **Running the documented revert** is what exposed my own misdiagnosis. The revert recipe worked;
  what it revealed was that my causal story was wrong. This directory's own history warns that fixes
  pass synthetic repros and fail production shapes — the same trap applies to *reports*.

### Still unverified

- ~~**The MCP tool surface** for all four fixes — the session's server is stale.~~ **DONE for finding
  3** (2026-08-27): a fresh server re-ran the paired `verify` through the tool boundary and the
  anchors compare. Findings 1, 2 and 4 were verified on device through the tool surface in the same
  round.
- **`aspect: false` parsing through the real `verify` tool** (verified via `parseLayoutContract` +
  `compareRectParity` directly).
- **Finding 4's cheap-rung preference** (fix option 2) — only the pre-flight warning (option 1) is
  implemented and verified.

## Not averi (recorded so it is not misattributed)

- **`scripts/hive-probe.mjs --query-file` rejects a document whose first line is a comment.** Its
  `READ_ONLY` guard requires the document to start with `{` or `query`. Consuming-repo script.
- **My own misuse, for the record:** I put an accessibility label into a contract `text` field
  (which is OCR-only, and documented as such); I mixed collapsed-state and expanded-state anchors in
  one contract file, which produced three false `MISSING` anchors; and I wrote a non-idempotent
  "expand the widgets" flow that collapses an already-expanded screen. Findings 1–3 above are
  separable from all three of those.

## Credit where due

Two things in 0.6.0 worked exactly as designed and are worth not regressing:

- **`MISSING` vs delta separation.** Reporting missing anchors as "not parity findings yet — resolve
  them first" stopped me twice from chasing phantom geometry, and the ordered candidate causes
  ("off-screen / iOS containers / never applied — *that* IS a finding") pointed at the real one each
  time.
- **The copy-drift advisory.** *"Copy drift is a SPEC question before it is a code question: check
  which side matches the Figma"* — the title-casing delta in this run had the Figma on the contract's
  side, and both platforms needed the fix. Without that line I would plausibly have "corrected" the
  contract to match the code.

---

## Fixed (2026-08-27, against 0.6.0 source) — DEVICE VERIFICATION NOW DONE, see "FIX VERIFICATION" above

> **Superseded header.** This section was written before any device leg had run and said so. The
> device acceptance it called "still owed" was executed the same day — findings **2 and 4 are
> VERIFIED and CLOSED**, finding **3 was PARTIALLY fixed and is now VERIFIED ON DEVICE and CLOSED**
> (2026-08-27, through the MCP tool boundary), and finding **1's original evidence was RETRACTED**
> by the device run. Details in the "FIX VERIFICATION" section
> above; the "Still owed" list at the end of this section is updated accordingly. The body below is
> left as written — it is an accurate record of the fix as designed.

All four verified against source first. Findings 2 and 3 reproduce deterministically and are now
pinned by unit tests; findings 1 and 4 reproduce against the fake adapter. **No leg of this has run
on a device yet** — the device acceptance in "Verifying these on a device" above is still owed, and
this section must not be read as closing anything. `npm test` 550 passing, `npm run lint` clean.

### 1 — `scroll_until` now reports what it actually achieved

`src/flow/engine.ts`, `scrollUntilVisible`. The stop condition is **unchanged** (still
`intersects`), so no existing flow changes behaviour; what changed is that the call can no longer
stay silent about a clipped stop.

- Returns a `ScrollUntilResult` (`swipes`, `visible` fraction, `clipped` edges, `exhausted`) instead
  of a bare swipe count. Both call sites — the flow step and the MCP tool — print
  `describeScrollResult`, so a clipped stop reads
  `visible after 1 swipe — CLIPPED at bottom, 87% of it is in the viewport. A rect assert or
  screenshot on this element will measure the CLIPPED box`, and the flow trace marks the row `⚠`.
  A clean stop reads `fully visible after N swipes`.
- New `fully: true` (MCP arg and `scroll_until:` flow step, default `false`) requires full
  containment and keeps swiping. When a swipe stops **moving** the element it reports the defect in
  the report's own words: `CLIPPED at bottom (50% of it visible) and the content is exhausted:
  swiping down no longer moves it. The element cannot be fully revealed — that is a layout defect
  (no clearance for an overlay?), not a scroll that needs more swipes.`
- Judges the **most revealed** candidate when several nodes carry the id — reporting the clipped one
  of a container/child pair would invent a defect.
- Fix option 3 (making `fully` the default) was **not** taken: it changes the stop condition for
  every existing flow. The tool description now says plainly that "visible" means *intersects*.

New helpers `visibleFractionInViewport` / `clippedEdges` in `src/ui-tree/selectors.ts`.
Tests in `tests/flow/engine.test.ts`, including the negative half — a genuinely off-screen element
still fails with `never intersected the 1000x2000 viewport`.

### 2 — `aspect` gets an explicit opt-out, NOT an omission rule

**The report's recommended fix (option 1, "skip `aspect` when `w` or `h` is absent") was rejected,
with measurement.** `tests/verify/rect-parity.test.ts:135` pins a **real** shape bug —
`a 1.81-vs-1.60 aspect ratio FAILS at 2% tolerance even without contract h` — on the anchor
`{ id: 'card', x: 24, w: 345 }`, i.e. `h` omitted. Option 1 makes that test pass silently. It does
not narrow the check; it deletes the check's reason for existing, which is exactly the failure mode
this report's own §"Keep the negative half" warns about.

Nor can a tolerance separate them. Measured spreads:

| case | spread | must |
|---|---|---|
| the 1.81-vs-1.60 shape bug | **11.71%** | FAIL |
| section headers (48dp a11y floor vs 44pt) | 10.73% | pass |
| profile rows (~17:1, `w` delta a correct −0.47) | 3.77% | pass |

Any single threshold must land inside a **0.98-point window**. That is not a default anyone can
ship. And the report's normalization suggestion — "compare `aspect` after scaling both rects by
their platform width" — is a **no-op**: `(w/W)/(h/W) = w/h`, so the spread stays 11.71%. Verified
numerically.

So the only thing that separates the cases is the one thing the contract could not express: *the
author diagnosed this side as incomparable*. Implemented as the report's option 4:

- **`aspect: false` per anchor** (`src/verify/layout-contract.ts`, honoured at
  `compareAspect`). The row still prints both measured ratios, marked `opt-out` in the a-vs-i
  column — this report's own "diff the numbers, not the verdict" needs the 7.182 / 8.045 to stay
  visible — but no spread is computed and no finding is possible. Only an explicit `false` opts
  out — `aspect: true` and omission both keep comparing.
- **`tolerance_aspect_pct`** as a contract-level threshold, because the units complaint in §2(b) is
  correct: a ratio spread and a %-of-screen-width delta are different quantities that shared one
  number. It **defaults to `tolerance_pct`**, so an untouched contract behaves exactly as before,
  and the test-facing `opts.tolerancePct` deliberately does not flow into it.

**This shifts work to the consuming contract**, which is the honest cost of the decision: the five
affected anchors need `aspect: false` with their reason beside them before the acceptance
("**zero** deltas") is met.

**The acceptance in §2 is NOT fully reachable from these fixes.** Six deltas were reported; five are
`aspect` rows and are addressed. The sixth —
`profile_row_0 -> language_section gap: android-vs-ios +4.66%` — is a **gap** delta, and the report
proposes no fix for it. It is untouched here and still needs a diagnosis: either it is a real
finding or the gap row has its own version of this problem.

### 3 — combined a11y labels are read, not flagged

`src/verify/text-parity.ts`. `survivesIn` now compares on a `looseForm` — case folded, `,;:`
dropped, whitespace collapsed — which is the report's fix option 1. Reported strings stay
**verbatim**, so a row's message still shows the real difference, and the leniency provably cannot
leak into drift comparison: `survivesIn` has exactly one caller, the UNREAD guard at `:390`.

All four pinned acceptance cases hold, and the negative half with them:

```
survivesIn('Phone, +123 456 789 1',  'Phone +123 456 789 1')   → true
survivesIn('Full name, Arthur Dent', 'Full name Arthur Dent')  → true
survivesIn('CONTINUE',               '')                       → false   (real UNREAD)
survivesIn('Enter amount',           '0.00')                   → false   (real drift)
survivesIn('Phone, +123 456 789 1',  'Email, a@b.example')     → false   (real substitution)
```

The existing case and truncation leniencies are pinned too, and all four pre-existing occlusion-guard
tests still pass — the IME-over-the-CTA case still reports `OCCLUDED`.

Fix option 3 (stop letting `OCCLUDED` suppress the copy comparison outright) was **not** taken: it
changes what the table reports for every genuinely occluded anchor, which is a wider blast radius
than this finding needs. The punctuation fix removes the whole reported class. If the suppression
itself is still judged wrong, that is its own report.

### 4 — a pre-flight warning before a destructive rung

`src/flow/engine.ts`, `ensureStateInner`. Reuses the **already-existing** `flowIsDestructive` from
`config.ts` (written for the recovery pass, which needed the same question answered). Before running
a rung that wipes, the ladder logs:

```
⚠ reach login: this rung is DESTRUCTIVE — it wipes app state, and any device registration with it.
  If the app is on a RECOVERABLE screen (an inactivity timeout, an expired session), a cheaper
  non-destructive rung declared BEFORE this one would restore it instead
```

Pinned to arrive **before** the `⚠ clearState: app state wiped` line, and to stay silent on rungs
that do not wipe (a warning on every rung trains the reader to skip it).

Fix option 2 (prefer a non-destructive rung when several could reach the state) was **not** taken.
Rung order is the config's only expression of preference, and silently overriding it would be its
own bug — the engine cannot tell "log in from scratch" from "re-authenticate an already-registered
device", and only the config can, by declaring the recoverable screen. Option 3 is done: the
session-lifetime hazard is now in `skill/SKILL.md`, including that a long gap between the two legs
of a cross-platform run makes an inactivity timeout the normal case rather than an edge case.

**The consuming-repo half is still owed** and is the part that actually saves the registration: a
`session_expired` state with a PIN-login `reach`, declared before `login`, in the skeleton's
`averi.yaml`.

### Independent review (3 rounds, Fable 5 sub-agent) — 2 further bugs found IN THE FIXES

Worth recording, because this directory's history is entirely about fixes that passed and did not
hold. Both defects below sat in code whose tests were green:

1. **The printed threshold was not the enforced one.** `aspectTolerancePct` never reached
   `RectParityResult`, so a contract setting `tolerance_aspect_pct: 15` had its findings judged at 15
   and headlined `OVER 2.00%` — breaking the rule this file's own header states, in a table whose
   findings are meant to be dispatched verbatim. Found by the reviewer writing a reproduction, not by
   reading. Fixed: `thresholdLabel` / `judgedFields` / `aspectThresholdLive` now name only the
   thresholds actually in force, and output stays byte-identical while the two agree.
2. **`ScrollUntilResult.exhausted` could never be `true`.** The only write sat on the `fully` path,
   which throws in the same iteration — so the returned field was constitutionally `false` and its
   message branch unreachable. Removed rather than faked; the comment where it stood records why
   detecting it on the default path would cost every caller a probe swipe.

A third round caught that the **test pinning the round-2 rounding fix was vacuous** — a 40 px fixture
tops out at 97.5% and the clamp only engages at 99.5%, so the test passed against unclamped code.
Verified by mutation both ways before and after. This is the same trap recorded in
`2026-08-26-png-scale-needs-out-of-tree-screen-size.md`: *the fixes themselves were the next bug*.

Deliberately deferred with the reviewer's agreement: modelling the aspect entry as a discriminated
union instead of three optional flags on `RectEntry`. Consistent with the file's existing style, no
behavioural gain, wider churn than a bug-fix change should carry.

### Still owed — UPDATED after the device run

1. ~~Every device acceptance in this report.~~ **DONE.** Paired `verify` ran on both platforms with
   the original contract; finding 2 shows **0 aspect findings**.
2. ~~Diff the numbers, not the verdict.~~ **DONE** — `h 132.0 / 44.0` and `aspect 7.182 / 8.045`
   still measured and printed, marked `opt-out`, with a non-opted-out anchor still compared.
3. ~~Finding 1's app-side revert, both halves.~~ **DONE — and it retracted the finding.** The reverted
   app showed the row at `bottom=2214` inside `viewport=2280`: never clipped. The app defect was a
   *squeezed minimum* (a last-child `heightIn(min=60)` clamped to 52 by the container's remaining
   space), and what the screenshot showed was **occlusion by the floating nav overlay**. See the
   retraction above.
4. **The `+4.66%` gap delta** — still unaddressed by any fix here, and correctly so: it is the profile
   card's email wrapping on 393 dp but not on 402 pt. Accepted variance, consuming-side.
5. ~~**NEW — finding 3's remaining shape.**~~ **DONE — CLOSED on device 2026-08-27.** The parts rule
   landed, all six acceptance cases hold, and the paired `verify` on a fresh server shows
   `product_row_0` / `_4` **compared** rather than under `UNREAD ANCHORS`. See "Finding 3 — VERIFIED
   ON DEVICE". One honest gap remains, filed against the CONTRACT rather than averi: the third shape
   (`product_row_5`) has no text anchor, so it is closed by unit acceptance only.
6. ~~**NEW — the MCP tool surface.**~~ **DONE 2026-08-27.** Re-run on a server started after the last
   source edit (`20:03:39` vs `19:11:27`), confirmed live by `scroll_until` printing the post-fix
   `fully visible` wording. Same numbers through the tool boundary as from the library.
7. **NEW — occlusion has no check at all.** An element fully inside the viewport, passing `rect` and
   `scroll_until` including `fully: true`, can be completely hidden behind a floating overlay. Worth
   its own report; not addressed by the `fully`/`clipped` work.

## CLOSED (2026-08-27) — **all four findings.**

| # | Status |
|---|---|
| 1 | **CLOSED — withdrawn.** Evidence misdiagnosed; the element was never outside the viewport and `scroll_until` was right. The `fully`/`clipped` work is kept as a sound DX improvement with its clean path verified on both platforms. Its residue — **averi has no notion of occlusion by a floating overlay** — is split out as owed item 7 and deserves its own report. |
| 2 | **CLOSED — fixed and verified on device.** 0 aspect findings against correct code; measured ratios still printed as `opt-out`; a non-opted-out anchor still actively compared. |
| 3 | **CLOSED — fixed and verified on device.** The parts rule landed; all four measured shapes read, all six acceptance cases hold, and the negative half is provably untouched. The device half ran through the MCP tool boundary on a fresh server: `product_row_0` and `_4` are **compared**, `text parity: MATCHES 4 of 4`, zero UNREAD anchors. Two carve-outs recorded rather than buried: the third shape (`product_row_5`) has no contract anchor and is closed by unit acceptance only, and the run produced a second instance of owed item 7 — Android's clipped bounds defeat `scroll_until(fully: true)`. |
| 4 | **CLOSED — fixed and verified on device**, against the production "Logged out — inactivity" screen. Warning present and emitted before the wipe. |

All four findings need nothing further in this report. Finding 3 was judged against the six
acceptance cases written out above rather than against intent, and its device half ran through a
restarted server as required.

What outlives this report is filed elsewhere, deliberately: **owed item 7** (occlusion has no check
— now with two independent instances, a floating overlay and Android's clipped bounds) deserves its
own file, **owed item 4** and the two contract gaps found here belong to the consuming repo's
contract, and **finding 4's fix option 2** (a cheap non-destructive rung) remains unimplemented.

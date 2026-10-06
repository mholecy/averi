# BUG (measured): the bare-tree ⚠ never fires during a React Native splash read through WDA — the splash image carries an identifier

**Measured 2026-10-06 18:10–18:16 CEST**, finportal `sk.finportal.myport` (Expo / React Native debug build, Metro
running), `iPhone 17` simulator iOS 26.5, server built from `ae6245f` (branch `fix/bugs-2026-10-06`), driver
`run-tools.mts` from the device-verification handoff. Found while device-checking the `ui_snapshot` note added by
`ae6245f` (`docs/bugs/2026-10-06-ui-snapshot-empty-right-after-launch.md`).

## Claim

`ui_snapshot` with a filter that matches nothing adds "⚠ … the tree is bare" when the tree holds only wrappers and
unlabeled decoration, e.g. right after `launch_app`. `src/ui-tree/bare-tree.ts` says "a lone splash image or spinner IS
a loading screen" and that the RN splash shapes of idb/WDA were "not device-confirmed".

## Measured

`terminate_app` → `launch_app` → `ui_snapshot { filter: "role:button" }` back to back, twice per tree source:

| source | t after launch | reply (second block, verbatim) |
|---|---|---|
| WDA | ~0.3 s | `0 matches for role:button in a tree of 7 nodes (roles: container ×6, image ×1)` |
| WDA | ~0.9–1.1 s | `0 matches for role:button in a tree of 13 nodes (roles: container ×11, image ×1, text ×1)` |
| WDA | ~1.3 s | `0 matches for role:button in a tree of 26 nodes (roles: container ×24, image ×1, text ×1)` |
| WDA | ~2.5 s | the 6 login buttons (array alone) |
| idb | 0.3 s → 94 s | `⚠ 0 matches for role:button, and the tree is bare: 2 nodes, …` (0×0 root + empty `other`; see below) |
| uiautomator (emulator-5554) | 0.2 s → ~9 s | `⚠ 0 matches for role:button, and the tree is bare: 6 nodes, …` then `… 11 nodes …`, then the array |

The 7-node WDA tree is the splash: the `Application` labelled `MyPort`, five unlabeled full-screen containers, and
`{ role: image, label: null, identifier: "SplashScreenLogo" }` (expo-splash-screen sets that identifier). The 13-node
tree adds Metro's dev banner `text "Downloading 100%…"` (debug builds only; the docblock already accepts this case).
So on WDA, during the whole splash, a `[]` comes with the plain size line and no ⚠, which reads as "loaded, element
absent". Android (decor `action_bar_root`/`content`, all unlabeled) and idb behaved as designed.

Side measurement, same run: under `treeSource: idb` (a scratch copy of finportal's config), finportal's tree after a
cold relaunch stayed the 0×0 `Application` + empty `other` from 16:13:54 to at least 16:15:28 UTC while `screenshot`
showed the rendered login form and a WDA read at 16:15:43 returned all six buttons; at 16:16:38 idb read normally
again. The stuck-idb tree of `2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md` is therefore not specific to
mp-native; the ⚠ fired on every read of it.

## Code says

`isBareTree`: `if (DECORATION_ROLES.has(n.role)) return Boolean(n.label) || Boolean(n.identifier);` — an image counts
as content when it has an identifier. The comment's example of something to select is a labelled "Bank logo"; the
splash logo is identified, unlabeled, and still a splash.

## Suggestion (owner's choice)

- Count decoration (`image`, `progress`) as content only when LABELLED, not when merely identified; or
- keep identifiers but treat a tree whose only non-wrapper node is a single decoration node as bare (the "lone splash
  image" the docblock describes), whatever that node carries.
- Either way pin `SplashScreenLogo`'s 7-node WDA shape as a fixture next to `wda-source-rn-myport.json`.

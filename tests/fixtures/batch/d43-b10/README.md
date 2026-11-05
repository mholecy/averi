# batch-10's D43 domain exports, as typed maps

The lab simulator's three settings domains as batch-10's D43 gate exported them (`defaults export`, binary plists),
each turned into the typed map scripts/truth/batch/ios-domains.ts reads: per top-level key its plist type `t`, its
canonical JSON `c` (sorted; bool, int and float kept apart, dates and data tagged), and for a scalar the text a typed
`defaults write` takes, `v`. Converted once by a script kept outside the repo; tests/truth/batch/ios-domains.test.ts
reads them.

`<domain>.<phase>.json`, for com.apple.Accessibility, com.apple.keyboard.preferences and com.apple.Preferences:

- `backup` — before the gate's first change (the state its restore puts back).
- `g4-before`, `g4-after` — around the one WebDriverAgent session (G4): equal to the backup in all three.
- `after` — right after the run, before anything was put back. com.apple.Accessibility's is the flip batch-10
  measured: AutomationEnabled and ApplicationAccessibilityEnabled were bool true and read int 0, AccessibilityEnabled
  bool true reads bool false. The other two domains equal their backups.
- `readback` — com.apple.Accessibility after the restore wrote those three keys back, typed: equal to its backup.
  The other two domains needed no restore, so had no read-back.

Sanitised: the home folder in com.apple.Preferences' two WebKit paths is `~`, the simulator's udid there is
`LAB-SIMULATOR-UDID`, and the index id inside its two `lastIndexed_…` values is `AN-INDEX-UUID`, the same in every
phase, so the maps compare as the exports did.

Beside this folder, the stderr of a `defaults` call on a key that is not there (the schemeapproval domain, read only):
`../schemeapproval-absent-b8-read.txt` (batch-8's first run, a read: exit 1, which batch-8 took for "unreadable" and
so made the run VOID) and `../schemeapproval-absent-b9-delete.txt` (batch-9, a delete: the same error and
"Defaults have not been changed.").

And two the reviewer of T2 S4 saw from the host's `defaults` (Darwin 27; no simulator stderr of them was captured —
batch-13 records the simulator's own): `../defaults-host-domain-not-found.txt`, a read of a domain that is not there
(exit 1; the domain named here is com.apple.Preferences, the tests put in the one they ask), and
`../defaults-host-export-missing-domain.plist`, what an export of such a domain writes (exit 0, an empty dictionary):
an empty export alone never proves a domain absent.

# raw-strokes.mjs: superseded, kept as evidence

`raw-strokes.mjs` is the script that read the device's raw-stroke state for T11, T12 and T19 (the `raw-*.jsonl` files
here and in `../final-ab`, `../../t12-first-probe`, `../../t19-short-state`). Since T16 the live golden reads the same
thing itself: `scripts/truth/device-state.ts` (the same cell, pre-drag and four 142-px, 300-ms strokes per round, through
`AndroidLab`), before and after every run on Android with a carousel case selected, into the record's `deviceLabel` and the summary's
`Device:` line (ADR 0044's T16 amendment). The script and its outputs are kept unchanged as the evidence of the runs they
labelled; a new run does not need it.

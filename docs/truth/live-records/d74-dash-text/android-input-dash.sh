#!/bin/zsh
# D74's Android read-back (to run when emulator-5554, the averi_lab AVD, is up; written, not run, by the D74 + A17
# change): `input text -` — the one word averi sends for a leading dash (android.ts#typeText, one `input text` per
# character, each quoted for the device's sh) — and then `-h` as averi sends it, `'-'` then `'h'`. It reads the field
# back from uiautomator. No setting is changed: the lab app is launched on its form-basic cell, typed into, and stopped.
# Writes android-input-dash.log.txt beside this script; no absolute path goes into it.
# usage: android-input-dash.sh
export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
S=emulator-5554; PKG=dev.averi.lab; CELL=form-basic; FIELD=lab.form-basic.name
O=${0:A:h}; L=$O/android-input-dash.log.txt
A() { adb -s $S shell "$@"; }
die() { echo "ABORT: $*" | tee -a $L; exit 3; }
log() { echo "$*" | tee -a $L; }
[[ $(A getprop sys.boot_completed | tr -d '\r') == 1 ]] || die "$S not booted"
: > $L; log "$(date '+%Y-%m-%d %H:%M:%S') $S $(A getprop ro.build.version.release | tr -d '\r')"
A am force-stop $PKG; A am start -W -n $PKG/.MainActivity --es cell $CELL > /dev/null || die "launch failed"
sleep 2
# The field's node in uiautomator's dump: its text (`text`) or the centre of its bounds (`centre`).
field() { adb -s $S exec-out uiautomator dump /dev/tty | node -e '
  const xml = require("fs").readFileSync(0, "utf8");
  const node = xml.match(new RegExp(`<node [^>]*resource-id="${process.argv[1].replace(/\./g, "\\.")}"[^>]*>`));
  if (node === null) { console.log("<no field>"); process.exit(0); }
  const attr = (a) => node[0].match(new RegExp(` ${a}="([^"]*)"`))[1];
  if (process.argv[2] === "text") console.log(JSON.stringify(attr("text")));
  else { const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g).map(Number); console.log(Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)); }' $FIELD $1; }
XY=($(field centre)); [[ ${#XY} == 2 ]] || die "no $FIELD in the dump"
# Empty the field: focus it, the cursor to the end (MOVE_END), 40 deletes.
clear_field() { A input tap $XY[1] $XY[2]; sleep 0.5; A input keyevent 123; for i in {1..40}; do A input keyevent 67; done; sleep 0.5; }

clear_field
out=$(A input text "'-'" 2>&1); rc=$?; sleep 1
log "input text '-' exit=$rc said=$(printf %q "$out") (want '') text=$(field text) (want \"-\")"

clear_field
out=$( { A input text "'-'"; A input text "'h'"; } 2>&1); rc=$?; sleep 1
log "input text '-' then 'h' (averi's -h) exit=$rc said=$(printf %q "$out") (want '') text=$(field text) (want \"-h\")"

A am force-stop $PKG

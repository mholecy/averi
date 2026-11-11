#!/bin/zsh
# D74's iOS check (the owner's; written by the D74 + A17 change, not run by it): a text that starts with a dash, typed
# with the new argv `idb ui text --udid U -- <text>`, reaches the field whole — on the idb CLI by hand, then through
# averi's IosAdapter#typeText with the idb helper on and with AVERI_IDB_HELPER=off. Control: the old argv `ui text -h
# --udid U` exits 0 printing argparse's usage and types nothing.
# Lab: the dev.averi.lab simulator (its udid below), the form-basic cell's name field (lab.form-basic.name).
# Writes one log per arm, <arm>.log.txt beside this script, and index.txt; no absolute path goes into either.
# usage: run.sh            (from anywhere; it runs from the repo root)
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
U=D8DACDE6-6352-437C-AA22-86FB06275C3F
APP=dev.averi.lab; CELL=form-basic; FIELD=lab.form-basic.name
O=${0:A:h}; I=$O/index.txt; W=${0:A:h}/../../../..; cd $W
TEXTS=(-h -abc -hunter2 --log=s3cret -- a-b)
die() { echo "ABORT: $*" | tee -a $I; exit 3; }
log() { echo "$*" | tee -a $O/$ARM.log.txt; }

# 1. The reset sequence: no companion and no WebDriverAgent left over, the simulator restarted, a fresh companion.
pkill -f idb_companion; pkill -f WebDriverAgentRunner; pkill -f 'xcodebuild.*WebDriverAgent'
xcrun simctl shutdown $U 2>/dev/null; xcrun simctl boot $U || die "boot failed"
xcrun simctl bootstatus $U -b > /dev/null || die "bootstatus failed"
sleep 3
idb_companion --udid $U --grpc-port 10971 > /dev/null 2>&1 &
COMPANION=$!
export IDB_COMPANION=localhost:10971
sleep 3
trap 'kill $COMPANION 2>/dev/null' EXIT
echo "commit $(git log -1 --format=%H); $(date '+%Y-%m-%d %H:%M:%S'); udid $U" > $I

# 2. The lab app on the cell, the field focused (lab-device.ts#launch's defaults first, as every lab launch writes them).
for key in AutomationEnabled ApplicationAccessibilityEnabled; do xcrun simctl spawn $U defaults write com.apple.Accessibility $key -bool true; done
for key in AutomaticMinimizationEnabled HardwareKeyboardLastSeen; do xcrun simctl spawn $U defaults write com.apple.keyboard.preferences $key -bool false; done
xcrun simctl terminate $U $APP 2>/dev/null; xcrun simctl launch $U $APP -cell $CELL > /dev/null || die "launch failed"
sleep 3
# The field's node in idb's tree: its AXValue (`value`) or the centre of its frame (`centre`).
field() { idb ui describe-all --json --udid $U | node -e '
  const n = JSON.parse(require("fs").readFileSync(0, "utf8")).find((o) => o.AXUniqueId === process.argv[1]);
  if (n === undefined) { console.log("<no field>"); process.exit(0); }
  if (process.argv[2] === "value") console.log(JSON.stringify(n.AXValue));
  else console.log(Math.round(n.frame.x + n.frame.width / 2), Math.round(n.frame.y + n.frame.height / 2));' $FIELD $1; }
XY=($(field centre)); [[ ${#XY} == 2 ]] || die "no $FIELD in the tree"
focus() { idb ui tap $XY[1] $XY[2] --udid $U; sleep 1; }
# Empty the field: 40 backspaces, then 40 forward deletes (ios.ts#clearText's keys), wherever the cursor stands.
BACK=(); FWD=(); for i in {1..40}; do BACK+=42; FWD+=76; done
clear_field() { focus; idb ui key-sequence $BACK --udid $U; idb ui key-sequence $FWD --udid $U; sleep 0.5; }
focus

# 3. The new argv by hand: exit 0, nothing on stdout, the field holds the text.
ARM=cli-new; : > $O/$ARM.log.txt
for t in $TEXTS; do
  clear_field
  out=$(idb ui text --udid $U -- "$t" 2>$O/stderr.tmp); rc=$?; sleep 1
  log "text=$(printf %q "$t") exit=$rc (want 0) stdout=$(printf %q "$out") (want '') stderr=$(printf %q "$(cat $O/stderr.tmp)") value=$(field value) (want $(printf %q "\"$t\""))"
done

# 4. Control, the old argv: exit 0, argparse's usage on stdout, the field unchanged (empty).
ARM=cli-old-control; : > $O/$ARM.log.txt
clear_field
out=$(idb ui text -h --udid $U 2>$O/stderr.tmp); rc=$?; sleep 1
log "text=-h (old argv) exit=$rc (want 0) stdout-first-line=$(printf %q "${out%%$'\n'*}") (want usage: idb ui text …) value=$(field value) (want \"\" or null)"

# 5. Through averi's typeText (type-via-averi.ts), the helper on, then off.
for ARM in averi-helper averi-helper-off; do
  : > $O/$ARM.log.txt; [[ $ARM == averi-helper ]] && VIA=helper || VIA=cli
  for t in $TEXTS; do
    clear_field
    if [[ $ARM == averi-helper-off ]]; then said=$(AVERI_IDB_HELPER=off node --import tsx $O/type-via-averi.ts $U "$t" 2>&1); rc=$?
    else said=$(node --import tsx $O/type-via-averi.ts $U "$t" 2>&1); rc=$?; fi
    sleep 1
    log "text=$(printf %q "$t") exit=$rc said=$(printf %q "$said") value=$(field value) (want $(printf %q "\"$t\""); said wants 'typed ok via $VIA')"
  done
done
rm -f $O/stderr.tmp
xcrun simctl terminate $U $APP 2>/dev/null
echo "done $(date '+%H:%M:%S')" >> $I

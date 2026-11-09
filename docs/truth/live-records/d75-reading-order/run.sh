#!/bin/zsh
# D75 live: one harness (the fix worktree), base src by --side; each arm base first, then fix.
S=<scratchpad>
W=<repo>
B=$S/base
O=$S/live; I=$O/index.txt
export PATH=/opt/homebrew/opt/node@22/bin:$PATH:$HOME/Library/Android/sdk/platform-tools
A() { adb -s emulator-5554 shell "$@"; }
START=$(A getprop sys.system_server.start_count | tr -d '\r')
stamp() { local c=$(A getprop sys.system_server.start_count | tr -d '\r'); [[ $c == $START ]] || { echo "ABORT start count $START -> $c at $1" >> $I; exit 3; }
  echo "$1 $(date +%H:%M:%S) start_count=$c uptime=$(A cat /proc/uptime | tr -d '\r' | cut -d' ' -f1) dev=[$(A cat /proc/loadavg | tr -d '\r')]" >> $I; }
live() { local nm=$1; shift; stamp "before $nm"; local t0=$(date +%s)
  (cd $W && node --import tsx scripts/truth/live.ts --serial emulator-5554 "$@" --record $O/$nm.json > $O/$nm.log 2>&1); local rc=$?
  stamp "after $nm rc=$rc secs=$(( $(date +%s) - t0 ))"; }
git -C $W log -1 --format='fix commit %H' >> $I; echo "base: git archive 7eb998dd at <scratchpad>/base" >> $I
for arm in "$@"; do
  case $arm in
    rn-base) live rn-base --side $B --app react-native --groups forms,visibility ;;
    rn-fix) live rn-fix --app react-native --groups forms,visibility ;;
    native-base) live native-base --side $B --groups visibility --cells bands,bands-three-button,bottom-sheet-dialog,dialog-views-fullscreen,sheet-medium,alert-dim,fab,pinned-bar,scroll-sticky,form-errors,own-parts,text-under-bar,tabbar-floating ;;
    native-fix) live native-fix --groups visibility --cells bands-three-button,bottom-sheet-dialog,dialog-views-fullscreen ;;
  esac
done

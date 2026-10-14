#!/bin/bash
# usage: fn.sh 1010_9904 [more...]  -> print decompiled function(s)
for a in "$@"; do
awk -v pat="/* FUN_${a} @" 'index($0,pat)==1{p=1;print;next} p && /^\/\* [A-Za-z_0-9]+ @ [0-9a-f]+:[0-9a-f]+ \*\//{p=0} p && !/^ *$/' "$(dirname "$0")/../../analysis/decompiled/out/TWTW.EXE_decompiled.c"
done

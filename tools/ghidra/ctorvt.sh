#!/bin/bash
# print vtable (last assignment in ctor) and its entries
D=$(dirname "$0")
for f in "$@"; do
  v=$($D/fn.sh $f | grep -A1 -E '^\s*\*param_1 = 0x[0-9a-f]+;' | grep -oE '0x[0-9a-f]+' | paste - - | tail -1 | awk '{printf "%04x:%04x", strtonum($2), strtonum($1)}')
  echo -n "$f -> "; python3 -I $D/vt.py "$v/${N:-10}"
done

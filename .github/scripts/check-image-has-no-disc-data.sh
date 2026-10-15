#!/usr/bin/env bash
# Fails if an image holds anything that could be disc data. The image is built from an allow-listed
# context and should hold only Alpine, node, the server's source and the built web app; this checks
# the result rather than trusting that.
#
#   .github/scripts/check-image-has-no-disc-data.sh IMAGE            # with docker
#   ENGINE=podman .github/scripts/check-image-has-no-disc-data.sh IMAGE
#
# It fails on:
#   - a file named like a disc file anywhere: .ANI, .DIB, .WAV, .ISO, TWTW.PNG, TWTW.EXE, any case;
#   - anything under /data, which must be an empty mount point;
#   - a data manifest (`manifest.json`, which lists the disc's files) anywhere under /app;
#   - a file over 1 MiB, other than the node binary and the C++ runtime libraries: the built web app
#     is a few hundred kilobytes, while many disc files are larger.
set -euo pipefail

image=${1:?usage: $0 IMAGE}
engine=${ENGINE:-docker}
max_bytes=$((1024 * 1024))

container=$("$engine" create "$image")
trap '"$engine" rm "$container" >/dev/null' EXIT

# `tar -tv` columns: mode, owner, size, date, time, name (names are relative, without a leading /).
listing=$("$engine" export "$container" | tar -tvf -)
files=$(printf '%s\n' "$listing" | awk '$1 ~ /^-/ { name = $6; for (i = 7; i <= NF; i++) name = name " " $i; print $3 "\t" name }')
echo "$(printf '%s\n' "$files" | wc -l) files in $image"

problems=0
report() { echo "::error::$*"; problems=$((problems + 1)); }

while IFS=$'\t' read -r size name; do
  lower=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
  case "$lower" in
    *.ani | *.dib | *.wav | *.iso | */twtw.png | twtw.png | */twtw.exe | twtw.exe)
      report "disc file name: /$name" ;;
  esac
  case "$name" in
    data/*) report "/data is not empty: /$name" ;;
    app/*manifest.json) report "a data manifest is in the image: /$name" ;;
  esac
  if [ "$size" -gt "$max_bytes" ]; then
    case "$name" in
      usr/local/bin/node | usr/lib/libstdc++.so.* | usr/lib/libgcc_s.so.* | usr/lib/libcrypto.so.*) ;;
      *) report "file over $max_bytes bytes: /$name ($size bytes)" ;;
    esac
  fi
done <<< "$files"

if [ "$problems" -gt 0 ]; then
  echo "$problems problem(s): the image may contain disc data" >&2
  exit 1
fi
echo "no disc data in $image"

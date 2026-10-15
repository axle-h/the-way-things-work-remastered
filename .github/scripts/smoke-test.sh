#!/usr/bin/env bash
# Smoke-tests a running server: `/healthz`, the web app and its route fallback, `robots.txt`, and the
# `X-Robots-Tag` header on every kind of response. Used by the container workflow, and locally:
#
#   .github/scripts/smoke-test.sh http://127.0.0.1:8080           # /data must be empty
#   .github/scripts/smoke-test.sh http://127.0.0.1:8080 --data    # /data must be an extracted disc
#
# With an empty /data, the data manifest must be a 404; with --data, it and a file it lists must be
# served, by their own name and in lower case. Prints no file names from the disc.
set -euo pipefail

base=${1:?usage: $0 BASE_URL [--data]}
base=${base%/}
with_data=false
case "${2:-}" in
  --data) with_data=true ;;
  "") ;;
  *) echo "usage: $0 BASE_URL [--data]" >&2; exit 2 ;;
esac

fail() { echo "::error::$*" >&2; exit 1; }

for i in $(seq 1 30); do
  if curl -fsS "$base/healthz" >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && fail "/healthz never came up"
  sleep 2
done
[ "$(curl -fsS "$base/healthz")" = ok ] || fail "/healthz did not answer ok"
echo "/healthz is ok"

# The web app's index.html.
index=$(curl -fsS "$base/")
case "$index" in
  *'<script'*) echo "/ serves the web app" ;;
  *) printf '%s\n' "$index" | head -20; fail "/ did not serve the web app's index.html" ;;
esac

# A path without an extension that is not a file falls back to the same index.html.
[ "$(curl -fsS "$base/some/route")" = "$index" ] || fail "/some/route did not fall back to index.html"
echo "/some/route falls back to index.html"

# The hashed bundle it references is there too.
asset=$(printf '%s' "$index" | grep -o '/assets/[^"]*\.js' | head -n1)
[ -n "$asset" ] || fail "index.html references no /assets/*.js"
curl -fsS -o /dev/null "$base$asset" || fail "$asset is not served"
echo "$asset is served"

# Search engines are kept out: robots.txt disallows everything.
robots=$(curl -fsS "$base/robots.txt")
[ "$robots" = $'User-agent: *\nDisallow: /' ] || { printf '%s\n' "$robots"; fail "robots.txt does not disallow everything"; }
echo "/robots.txt disallows everything"

# The data manifest that `pnpm data` writes at the root of the disc.
manifest_status=$(curl -sS -o /dev/null -w '%{http_code}' "$base/data/manifest.json")
if $with_data; then
  [ "$manifest_status" = 200 ] || fail "/data/manifest.json is $manifest_status, not 200"
  manifest=$(curl -fsS "$base/data/manifest.json")
  # The first file the manifest lists, and its size; the manifest is JSON written by our own tool.
  read -r path size < <(printf '%s' "$manifest" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).files.find(f=>f.size>0);console.log(f.path,f.size)})')
  [ -n "$path" ] || fail "the manifest lists no files"
  got=$(curl -fsS -o /dev/null -w '%{size_download}' "$base/data/$path") || fail "a file the manifest lists is not served"
  [ "$got" = "$size" ] || fail "a file the manifest lists is served with $got bytes, not $size"
  lower=$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')
  got=$(curl -fsS -o /dev/null -w '%{size_download}' "$base/data/$lower") || fail "a file is not served by its lower-case name"
  [ "$got" = "$size" ] || fail "a file is served by its lower-case name with $got bytes, not $size"
  echo "/data serves the manifest and the files it lists, ignoring case"
else
  [ "$manifest_status" = 404 ] || fail "/data/manifest.json is $manifest_status with an empty /data, not 404"
  echo "/data is empty: /data/manifest.json is a 404"
fi

# Every kind of response is marked noindex, errors included.
for path in / /healthz /robots.txt "$asset" /some/route /data/manifest.json /data/missing /missing.js; do
  header=$(curl -sS -o /dev/null -D - "$base$path" | tr -d '\r' | grep -i '^x-robots-tag:' || true)
  case "$header" in
    *noindex*) ;;
    *) fail "$path has no X-Robots-Tag: noindex" ;;
  esac
done
echo "every response carries X-Robots-Tag: noindex"
echo "smoke test passed"

#!/usr/bin/env bash
# Applies the whole deployment: the namespace, then `twtw/`, then the ingress with the public hostname
# substituted in. The hostname is never in git: it comes from `$TWTW_HOST`, or else the first line of
# the gitignored `host.local` beside this script that is not blank or a `#` comment.
#
#   TWTW_HOST=twtw.example.com ./apply.sh
#   ./apply.sh --dry-run          # server-side dry run of everything; changes nothing
#
# It prints no hostname: kubectl's output names objects, not hosts.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NS=twtw

dry=()
case "${1:-}" in
  --dry-run) dry=(--dry-run=server) ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

host=${TWTW_HOST:-}
if [[ -z "$host" && -f "$here/host.local" ]]; then
  host=$(grep -v '^[[:space:]]*\(#\|$\)' "$here/host.local" | head -n1 | tr -d '[:space:]' || true)
fi
if [[ -z "$host" ]]; then
  echo "No hostname: set TWTW_HOST, or put it in $here/host.local (gitignored)." >&2
  exit 1
fi
if ! [[ "$host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "The hostname from TWTW_HOST or host.local is not a valid lower-case hostname." >&2
  exit 1
fi

kubectl apply "${dry[@]}" -f "$here/namespace.yml"

# A server-side dry run of a namespaced object in a namespace that does not exist yet is refused.
if [[ ${#dry[@]} -gt 0 ]] && ! kubectl get namespace "$NS" >/dev/null 2>&1; then
  echo "namespace/$NS does not exist yet, so the rest cannot be dry-run; apply without --dry-run first." >&2
  exit 0
fi

kubectl apply "${dry[@]}" -f "$here/twtw/"
# Only the literal `${TWTW_HOST}` is replaced; `host` is validated above, so it is sed-safe.
sed "s/\${TWTW_HOST}/$host/g" "$here/ingress.template.yml" | kubectl apply "${dry[@]}" -f -

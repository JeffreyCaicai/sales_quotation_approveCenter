#!/bin/sh
set -eu

image=${1:-${APP_IMAGE:-}}

if [ "$(printf '%s' "$image" | wc -l)" -ne 0 ] \
  || ! printf '%s\n' "$image" | LC_ALL=C grep -Eq '^[^[:space:]@]+@sha256:[0-9a-f]{64}$'; then
  echo "APP_IMAGE must be an immutable repo@sha256:<64 lowercase hex> reference" >&2
  exit 1
fi

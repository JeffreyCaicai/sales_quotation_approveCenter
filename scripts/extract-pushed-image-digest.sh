#!/usr/bin/env bash
set -Eeuo pipefail

invalid() {
  echo "docker push must report exactly one canonical digest" >&2
  exit 2
}

push_log=${1:-}
repository=${2:-}
[[ -r $push_log && $repository == ghcr.io/jeffreycaicai/sales_quotation_approvecenter ]] || invalid

digests=()
while IFS= read -r digest; do
  digests+=("$digest")
done < <(grep -oE 'digest: sha256:[0-9a-f]{64}' "$push_log" | sed 's/^digest: //')

[[ ${#digests[@]} -eq 1 && ${digests[0]} =~ ^sha256:[0-9a-f]{64}$ ]] || invalid
printf '%s@%s\n' "$repository" "${digests[0]}"

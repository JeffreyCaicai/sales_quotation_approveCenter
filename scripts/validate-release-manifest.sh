#!/usr/bin/env bash
set -Eeuo pipefail

invalid() {
  echo "invalid release manifest" >&2
  exit 2
}

manifest=${1:-}
expected_sha=${2:-}
expected_run_id=${3:-}
[[ -r $manifest && $expected_sha =~ ^[0-9a-f]{40}$ && $expected_run_id =~ ^[1-9][0-9]*$ ]] || invalid

manifest_lines=()
while IFS= read -r line || [[ -n $line ]]; do
  manifest_lines+=("$line")
done < "$manifest"
[[ ${#manifest_lines[@]} -eq 3 ]] || invalid

read -r sha_key manifest_sha sha_extra <<< "${manifest_lines[0]}"
read -r image_key manifest_image image_extra <<< "${manifest_lines[1]}"
read -r run_key manifest_run_id run_extra <<< "${manifest_lines[2]}"

[[ $sha_key == RELEASE_SHA && -z ${sha_extra:-} && ${manifest_lines[0]} == "RELEASE_SHA $manifest_sha" ]] || invalid
[[ $image_key == APP_IMAGE && -z ${image_extra:-} && ${manifest_lines[1]} == "APP_IMAGE $manifest_image" ]] || invalid
[[ $run_key == GITHUB_RUN_ID && -z ${run_extra:-} && ${manifest_lines[2]} == "GITHUB_RUN_ID $manifest_run_id" ]] || invalid
[[ $manifest_sha =~ ^[0-9a-f]{40}$ && $manifest_sha == "$expected_sha" ]] || invalid
[[ $manifest_image =~ ^ghcr\.io/jeffreycaicai/sales_quotation_approvecenter@sha256:[0-9a-f]{64}$ ]] || invalid
[[ $manifest_run_id =~ ^[1-9][0-9]*$ && $manifest_run_id == "$expected_run_id" ]] || invalid

printf '%s\n%s\n' "$manifest_sha" "$manifest_image"

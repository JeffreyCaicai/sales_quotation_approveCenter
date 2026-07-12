#!/usr/bin/env bash

dotenv_get() {
  local key=$1 file=$2 line found=0
  DOTENV_VALUE=""
  [[ $key =~ ^[A-Z][A-Z0-9_]*$ && -r $file ]] || return 1
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line == "$key="* ]] || continue
    ((found == 0)) || { echo "duplicate dotenv key: $key" >&2; return 1; }
    DOTENV_VALUE=${line#*=}
    found=1
  done < "$file"
  ((found == 1)) || { echo "missing dotenv key: $key" >&2; return 1; }
}

acquire_operations_lock() {
  local root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
  OPERATIONS_LOCK_FILE=${OPERATIONS_LOCK_FILE:-$root/.operations.lock}
  if [[ ${OPERATIONS_LOCK_HELD:-} == 1 && -e /dev/fd/9 ]]; then
    if [[ -e /proc/$$/fd/9 ]]; then
      [[ $(readlink "/proc/$$/fd/9") == "$OPERATIONS_LOCK_FILE" ]] \
        || { echo "invalid inherited operations lock" >&2; return 1; }
    fi
    return 0
  fi
  mkdir -p "$(dirname "$OPERATIONS_LOCK_FILE")"
  exec 9>>"$OPERATIONS_LOCK_FILE"
  ${FLOCK_BIN:-flock} -w "${OPERATIONS_LOCK_TIMEOUT_SECONDS:-30}" 9 \
    || { echo "timed out waiting for operations lock" >&2; return 1; }
  export OPERATIONS_LOCK_HELD=1 OPERATIONS_LOCK_FILE
}

health_attempt_count() {
  HEALTH_ATTEMPTS=${OPERATIONS_HEALTH_ATTEMPTS:-30}
  [[ $HEALTH_ATTEMPTS =~ ^[0-9]+$ && $HEALTH_ATTEMPTS -ge 1 && $HEALTH_ATTEMPTS -le 60 ]] \
    || { echo "health attempts must be between 1 and 60" >&2; return 1; }
}

atomic_symlink_switch() {
  local current=$1 destination=$2 next_link=$1.next.$$
  [[ ! -e $current || -L $current ]] || { echo "current is not a symlink" >&2; return 1; }
  rm -f -- "$next_link"
  ln -s "$destination" "$next_link" || return 1
  if ! mv -T "$next_link" "$current" 2>/dev/null; then
    mv -fh "$next_link" "$current" || return 1
  fi
}

failure_atomic_release_switch() {
  local current=$1 target=$2 original=$3 activator=$4
  shift 4
  atomic_symlink_switch "$current" "$target" || return 1
  if "$activator" "$target" "$@"; then return 0; fi
  atomic_symlink_switch "$current" "$original" \
    || { echo "critical: could not restore original release symlink" >&2; return 1; }
  "$activator" "$original" "$@" || echo "critical: original release restoration failed" >&2
  return 1
}

cleanup_unverified_backup_artifacts() {
  local archive=$1 verified=$2 remote_started=$3 remote=$4 deleter=$5
  shift 5
  ((verified == 0)) || return 0
  rm -f -- "$archive" "$archive.sha256" "$archive.verified"
  if ((remote_started == 1)); then
    "$deleter" "$remote.tar.age" "$@" || true
    "$deleter" "$remote.tar.age.sha256" "$@" || true
  fi
}

record_release_lineage_and_prune() {
  local root=$1 sha=$2 releases lineage
  releases=$root/releases
  lineage=$root/release-lineage
  local -a history keep stale
  printf '%s\n' "$sha" >> "$lineage"
  while IFS= read -r candidate; do history+=("$candidate"); done < "$lineage"
  local i candidate seen value name
  for ((i=${#history[@]}-1; i>=0 && ${#keep[@]}<3; i--)); do
    candidate=${history[i]}
    [[ $candidate =~ ^[0-9a-f]{40}$ ]] || continue
    seen=0
    for value in "${keep[@]}"; do [[ $value == "$candidate" ]] && seen=1; done
    ((seen == 1)) || keep+=("$candidate")
  done
  ((${#keep[@]} >= 3)) || return 0
  while IFS= read -r -d '' candidate; do
    name=${candidate##*/}
    [[ $name =~ ^[0-9a-f]{40}$ ]] || continue
    seen=0
    for value in "${keep[@]}"; do [[ $candidate == "$releases/$value" ]] && seen=1; done
    ((seen == 1)) || stale+=("$candidate")
  done < <(find "$releases" -mindepth 1 -maxdepth 1 -type d -name '????????????????????????????????????????' -print0)
  for candidate in "${stale[@]}"; do rm -rf -- "$candidate"; done
}

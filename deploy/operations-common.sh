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

validate_env_file() {
  local file=$1 key line value
  shift
  [[ -r $file ]] || { echo "environment file is not readable" >&2; return 1; }
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z $line || $line == \#* ]] && continue
    [[ $line =~ ^[A-Z][A-Z0-9_]*= ]] || { echo "invalid dotenv assignment" >&2; return 1; }
    value=${line#*=}
    [[ -n $value && $value =~ ^[A-Za-z0-9._~:/@?\&=%+,\-]+$ ]] \
      || { echo "dotenv value violates the safe alphabet" >&2; return 1; }
  done < "$file"
  for key in "$@"; do
    dotenv_get "$key" "$file" || return 1
    [[ -n $DOTENV_VALUE ]] || { echo "required dotenv key is empty: $key" >&2; return 1; }
  done
}

read_backup_policy() {
  local file=$1
  validate_env_file "$file" BACKUP_POLICY || return 1
  dotenv_get BACKUP_POLICY "$file" || return 1
  case $DOTENV_VALUE in
    # Output consumed by callers that source this operations library.
    # shellcheck disable=SC2034
    optional|required) BACKUP_POLICY_VALUE=$DOTENV_VALUE ;;
    *) echo "BACKUP_POLICY must be optional or required" >&2; return 1 ;;
  esac
}

prepare_predeployment_recovery_point() {
  local policy=$1 root=$2 sha=$3 backup_script=$4 audit timestamp
  [[ $root = /* && $sha =~ ^[0-9a-f]{40}$ && -x $backup_script ]] \
    || { echo "invalid pre-deployment recovery-point request" >&2; return 1; }
  case $policy in
    required) "$backup_script" ;;
    optional)
      audit=$root/state/unprotected-deployments.log
      [[ -d $root/state && ! -L $audit ]] \
        || { echo "unprotected deployment audit path is unsafe" >&2; return 1; }
      if [[ ! -e $audit ]]; then (umask 077; : > "$audit") || return 1; fi
      [[ -f $audit && ! -L $audit ]] \
        || { echo "unprotected deployment audit file is unsafe" >&2; return 1; }
      timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ) || return 1
      printf 'WARNING: off-VPS backup is disabled for this internal demo deployment. Set BACKUP_POLICY=required before importing real business data.\n' >&2
      printf '%s\t%s\tBACKUP_POLICY=optional\n' "$timestamp" "$sha" >> "$audit"
      ;;
    *) echo "invalid backup policy" >&2; return 1 ;;
  esac
}

acquire_operations_lock() {
  local root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
  OPERATIONS_LOCK_FILE=${OPERATIONS_LOCK_FILE:-$root/state/operations.lock}
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

require_bootstrap_recovery_clear() {
  local marker=$1
  [[ ! -e $marker && ! -L $marker ]] || {
    echo "bootstrap failure requires operator recovery review with explicit --recover-bootstrap" >&2
    return 1
  }
}

authorize_bootstrap_recovery() {
  local marker=$1 recover=$2 line release_found=0 recovery_found=0
  [[ $recover == 0 || $recover == 1 ]] || { echo "invalid bootstrap recovery authorization" >&2; return 1; }
  if ((recover == 0)); then
    require_bootstrap_recovery_clear "$marker"
    return
  fi
  [[ -f $marker && ! -L $marker ]] \
    || { echo "--recover-bootstrap requires an active regular bootstrap failure marker" >&2; return 1; }
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^release_sha=[0-9a-f]{40}$ ]] && release_found=1
    [[ $line == recovery=operator-review-required ]] && recovery_found=1
  done < "$marker"
  ((release_found == 1 && recovery_found == 1)) \
    || { echo "bootstrap failure marker is invalid; inspect state before recovery" >&2; return 1; }
}

runtime_path_uid_mode() {
  local path=$1 metadata
  if metadata=$(stat -c '%u:%a' -- "$path" 2>/dev/null); then
    printf '%s\n' "$metadata"
  else
    stat -f '%u:%Lp' "$path"
  fi
}

validate_runtime_history_directory() {
  local marker=$1 history=$2 state real_state real_marker real_history expected uid_mode
  state=${marker%/*}
  [[ $state = /* && $history == "$state/history" && -d $state && ! -L $state \
    && -f $marker && ! -L $marker ]] \
    || { echo "invalid bootstrap recovery state path" >&2; return 1; }
  real_state=$(realpath -- "$state") || return 1
  real_marker=$(realpath -- "$marker") || return 1
  [[ ${real_marker%/*} == "$real_state" ]] \
    || { echo "bootstrap recovery marker escapes real state" >&2; return 1; }
  uid_mode=$(runtime_path_uid_mode "$state") || return 1
  [[ ${uid_mode%:*} == "$(id -u)" ]] \
    || { echo "bootstrap recovery state is not owned by the runtime user" >&2; return 1; }

  [[ ! -L $history ]] || { echo "bootstrap recovery history must not be a symlink" >&2; return 1; }
  if [[ -e $history ]]; then
    [[ -d $history ]] || { echo "bootstrap recovery history must be a directory" >&2; return 1; }
  else
    umask 077
    mkdir -m 0700 -- "$history"
  fi
  [[ -d $history && ! -L $history ]] \
    || { echo "bootstrap recovery history changed unexpectedly" >&2; return 1; }
  real_history=$(realpath -- "$history") || return 1
  expected=$real_state/history
  [[ $real_history == "$expected" ]] \
    || { echo "bootstrap recovery history escapes real state" >&2; return 1; }
  uid_mode=$(runtime_path_uid_mode "$history") || return 1
  [[ $uid_mode == "$(id -u):700" ]] \
    || { echo "bootstrap recovery history ownership or mode is invalid" >&2; return 1; }
}

archive_bootstrap_recovery() {
  local marker=$1 history=$2 sha=$3 archive
  [[ $sha =~ ^[0-9a-f]{40}$ && -f $marker && ! -L $marker ]] \
    || { echo "cannot archive invalid bootstrap recovery state" >&2; return 1; }
  validate_runtime_history_directory "$marker" "$history" || return 1
  archive=$history/bootstrap-failed.$(date -u +%Y%m%dT%H%M%S).$$.$sha
  chmod 0400 "$marker"
  validate_runtime_history_directory "$marker" "$history" || return 1
  mv -f -- "$marker" "$archive"
}

record_failed_bootstrap_activation() {
  local current=$1 release=$2 marker=$3 sha=$4 digest=$5 phase=$6 cleanup=$7
  shift 7
  local marker_tmp=$marker.tmp.$$ resolved="" canonical_release=""
  "$cleanup" stop web "$@" || echo "warning: failed to stop failed bootstrap web service" >&2
  "$cleanup" rm -f web "$@" || echo "warning: failed to remove failed bootstrap web service" >&2
  if [[ -L $current ]]; then
    resolved=$(realpath -- "$current" 2>/dev/null || true)
    canonical_release=$(realpath -- "$release" 2>/dev/null || true)
    if [[ -n $canonical_release && $resolved == "$canonical_release" ]]; then
      rm -f -- "$current"
    else
      echo "warning: current changed during bootstrap cleanup; leaving it untouched" >&2
    fi
  fi
  umask 077
  if ! {
    printf 'release_sha=%s\n' "$sha"
    printf 'image_digest=%s\n' "$digest"
    printf 'phase=%s\n' "$phase"
    printf 'failed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'recovery=operator-review-required\n'
  } > "$marker_tmp"; then
    echo "critical: could not write bootstrap recovery state after cleanup" >&2
    return 1
  fi
  if ! mv -f -- "$marker_tmp" "$marker"; then
    rm -f -- "$marker_tmp"
    echo "critical: could not replace bootstrap recovery state after cleanup" >&2
    return 1
  fi
}

prune_application_images() {
  local root=$1 repository=$2 docker_bin=${DOCKER_BIN:-docker}
  [[ $repository =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] \
    || { echo "invalid application image repository" >&2; return 1; }
  local releases=$root/releases file value listed_repository tag listed_digest digest ref
  local -a retained=() candidates=() candidate_digests=()
  while IFS= read -r -d '' file; do
    IFS= read -r value < "$file" || true
    [[ $value =~ ^${repository//./\\.}@sha256:[0-9a-f]{64}$ ]] && retained+=("${value#*@}")
  done < <(find "$releases" -mindepth 2 -maxdepth 2 -type f -name image.digest -print0)

  while IFS=$'\t' read -r listed_repository tag listed_digest; do
    [[ $listed_repository == "$repository" && $tag =~ ^[0-9a-f]{40}$ ]] || continue
    digest=$listed_digest
    if [[ ! $digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
      digest=""
      while IFS= read -r ref; do
        if [[ $ref =~ ^${repository//./\\.}@sha256:[0-9a-f]{64}$ ]]; then digest=${ref#*@}; break; fi
      done < <("$docker_bin" image inspect --format '{{join .RepoDigests "\n"}}' "$repository:$tag" 2>/dev/null)
    fi
    [[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || {
      echo "warning: cannot resolve digest for application image $repository:$tag; leaving it untouched" >&2
      continue
    }
    local keep=0 retained_digest
    for retained_digest in "${retained[@]}"; do [[ $digest == "$retained_digest" ]] && keep=1; done
    if ((keep == 0)); then candidates+=("$repository:$tag"); candidate_digests+=("$digest"); fi
  done < <("$docker_bin" image ls --format '{{.Repository}}\t{{.Tag}}\t{{.Digest}}')

  local i seen prior
  for ((i=0; i<${#candidates[@]}; i++)); do
    ref=${candidates[i]}
    "$docker_bin" image rm "$ref" >/dev/null 2>&1 \
      || echo "warning: could not remove unretained application image $ref (it may be in use)" >&2
    digest=${candidate_digests[i]}
    seen=0
    for prior in "${candidate_digests[@]:0:i}"; do [[ $prior == "$digest" ]] && seen=1; done
    if ((seen == 0)); then
      ref=$repository@$digest
      "$docker_bin" image rm "$ref" >/dev/null 2>&1 \
        || echo "warning: could not remove unretained application digest $ref (it may be in use)" >&2
    fi
  done
}

record_release_lineage_and_prune() {
  local root=$1 sha=$2 releases lineage
  releases=$root/releases
  lineage=$root/release-lineage
  local -a history=() keep=() stale=()
  local keep_count=0
  printf '%s\n' "$sha" >> "$lineage"
  while IFS= read -r candidate; do history+=("$candidate"); done < "$lineage"
  local i candidate seen value name
  for ((i=${#history[@]}-1; i>=0 && keep_count<3; i--)); do
    candidate=${history[i]}
    [[ $candidate =~ ^[0-9a-f]{40}$ ]] || continue
    seen=0
    for value in "${keep[@]-}"; do [[ $value == "$candidate" ]] && seen=1; done
    if ((seen == 0)); then keep+=("$candidate"); ((keep_count+=1)); fi
  done
  ((keep_count >= 3)) || return 0
  while IFS= read -r -d '' candidate; do
    name=${candidate##*/}
    [[ $name =~ ^[0-9a-f]{40}$ ]] || continue
    seen=0
    for value in "${keep[@]-}"; do [[ $candidate == "$releases/$value" ]] && seen=1; done
    ((seen == 1)) || stale+=("$candidate")
  done < <(find "$releases" -mindepth 1 -maxdepth 1 -type d -name '????????????????????????????????????????' -print0)
  for candidate in "${stale[@]-}"; do
    [[ -n $candidate ]] || continue
    rm -rf -- "$candidate"
  done
}

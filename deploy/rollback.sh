#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -ne 0 ]] || { echo "rollback.sh must not run as root" >&2; exit 1; }
if [[ ${USER:-$(id -un)} != deploy && ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  echo "rollback.sh must run as deploy" >&2; exit 1
fi
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/operations-common.sh
. "$script_dir/operations-common.sh"
deploy_uid=$(id -u)
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$deploy_uid}
export DOCKER_HOST=${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}
sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "release SHA must be 40 lowercase hexadecimal characters" >&2; exit 2; }
root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
release=$root/releases/$sha
current=$root/current
env_file=$root/shared/.env.production
if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  [[ -r $env_file && ! -L $env_file && $(stat -c '%U:%G:%a' -- "$env_file") == root:deploy:640 ]] \
    || { echo "production environment must be root:deploy:640 and not a symlink" >&2; exit 1; }
fi
validate_env_file "$env_file" APP_IMAGE SITE_ORIGIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET AUTH_SECRET
acquire_operations_lock
[[ -L $current ]] || { echo "current release symlink is required" >&2; exit 1; }
original=$(realpath "$current")
original_sha=$(basename "$original")
[[ $original_sha =~ ^[0-9a-f]{40}$ && -f $original/image.digest ]] || { echo "original release is invalid" >&2; exit 1; }
[[ -d $release && -f $release/image.digest && -x $release/deploy/production-up.sh ]] \
  || { echo "retained release is incomplete" >&2; exit 1; }
digest=$(<"$release/image.digest")
original_digest=$(<"$original/image.digest")
"$release/deploy/validate-app-image.sh" "$digest"
"$original/deploy/validate-app-image.sh" "$original_digest"
health_attempt_count

activate_release() {
  local selected=$1 selected_digest attempt
  selected_digest=$(<"$selected/image.digest")
  APP_IMAGE=$selected_digest "$selected/deploy/production-up.sh" "$env_file" || return 1
  for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
    curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null && return 0
    ((attempt < HEALTH_ATTEMPTS)) && sleep 2
  done
  return 1
}

if failure_atomic_release_switch "$current" "$release" "$original" activate_release; then
  record_release_lineage_and_prune "$root" "$sha"
  exit 0
fi
exit 1

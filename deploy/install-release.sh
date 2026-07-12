#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -ne 0 ]] || { echo "install-release.sh must not run as root" >&2; exit 1; }
if [[ ${USER:-$(id -un)} != deploy && ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  echo "install-release.sh must run as deploy" >&2; exit 1
fi
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/operations-common.sh
. "$script_dir/operations-common.sh"
deploy_uid=$(id -u)
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$deploy_uid}
export DOCKER_HOST=${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}
recover_bootstrap=0
if [[ ${1:-} == --recover-bootstrap ]]; then recover_bootstrap=1; shift; fi
sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "release SHA must be 40 lowercase hexadecimal characters" >&2; exit 2; }
expected_digest=${2:-}
repository=ghcr.io/jeffreycaicai/sales_quotation_approvecenter
[[ $expected_digest =~ ^ghcr\.io/jeffreycaicai/sales_quotation_approvecenter@sha256:[0-9a-f]{64}$ ]] \
  || { echo "canonical production image digest must be ${repository}@sha256:<64 lowercase hexadecimal characters>" >&2; exit 2; }
[[ $# -eq 2 ]] || { echo "usage: $0 [--recover-bootstrap] <40-character-sha> <canonical-image-digest>" >&2; exit 2; }

root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
[[ $root = /* && $root != */../* ]] || { echo "invalid sales quotation root" >&2; exit 2; }
releases=$root/releases
state=$root/state
current=$state/current
bootstrap_marker=$state/bootstrap-failed
env_file=$root/shared/.env.production
tagged_image=$repository:$sha
[[ -r $env_file ]] || { echo "production environment file is not readable" >&2; exit 1; }
if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  [[ ! -L $env_file && $(stat -c '%U:%G:%a' -- "$env_file") == root:deploy:640 ]] \
    || { echo "production environment must be root:deploy:640 and not a symlink" >&2; exit 1; }
fi
validate_env_file "$env_file" APP_IMAGE SITE_ORIGIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET AUTH_SECRET
acquire_operations_lock
mkdir -p "$releases"
authorize_bootstrap_recovery "$bootstrap_marker" "$recover_bootstrap"

previous_release=""
previous_sha=""
if [[ -L $current ]]; then
  previous_release=$(realpath "$current")
  previous_sha=$(basename "$previous_release")
  [[ $previous_sha =~ ^[0-9a-f]{40}$ && $(dirname "$previous_release") == "$(realpath "$releases")" ]] \
    || { echo "current release is invalid" >&2; exit 1; }
elif [[ -e $current ]]; then
  echo "current must be a release symlink" >&2
  exit 1
fi
if ((recover_bootstrap == 1)) && [[ -n $previous_release ]]; then
  echo "bootstrap recovery requires no current release" >&2
  exit 1
fi
if [[ -n $previous_release ]]; then
  "$previous_release/deploy/backup.sh"
elif docker volume inspect sales-quotation_postgres_data >/dev/null 2>&1 \
  || docker volume inspect sales-quotation_minio_data >/dev/null 2>&1; then
  if ((recover_bootstrap == 1)); then
    echo "authorized bootstrap recovery: preserving known partial stateful volumes" >&2
  else
    echo "stateful volumes exist without a current release; refusing an unbacked bootstrap" >&2
    exit 1
  fi
else
  echo "bootstrap: no current release or stateful volumes; no pre-deploy data exists to back up" >&2
fi

docker pull "$tagged_image" >/dev/null
digest=$(docker image inspect --format '{{join .RepoDigests "\n"}}' "$tagged_image" \
  | grep -E "^${repository//./\\.}@sha256:[0-9a-f]{64}$" | head -n 1)
[[ -n $digest ]] || { echo "pulled image has no matching immutable digest" >&2; exit 1; }
[[ $digest == "$expected_digest" ]] || { echo "pulled image digest does not match the canonical workflow digest" >&2; exit 1; }
"$script_dir/validate-app-image.sh" "$digest"

release=$releases/$sha
staging=$releases/.$sha.staging.$$
rm -rf -- "$staging"
mkdir -m 0750 "$staging"
container=""
trap 'if [[ -n $container ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi; rm -rf -- "$staging"' EXIT
if [[ -e $release || -L $release ]]; then
  [[ ! -L $release && -d $release && $(<"$release/image.digest") == "$digest" ]] \
    || { echo "existing release does not match pulled digest" >&2; exit 1; }
  rm -rf -- "$staging"
else
  container=$(docker create "$digest")
  docker cp "$container:/opt/release-bundle/." "$staging"
  docker rm -f "$container" >/dev/null
  container=""
  printf '%s\n' "$digest" > "$staging/image.digest"
  chmod -R u=rwX,g=rX,o= "$staging"
  mv -- "$staging" "$release"
fi

compose() {
  APP_IMAGE=$digest docker compose --project-directory "$release" --env-file "$env_file" \
    --file "$release/docker-compose.yml" "$@"
}
switched=0
bootstrap_state_touched=0
bootstrap_failure_phase=startup
rollback_on_error() {
  status=$?
  trap - ERR
  set +e
  if ((switched == 1)) && [[ -n $previous_sha ]]; then
    "$script_dir/rollback.sh" "$previous_sha" || true
  elif [[ -z $previous_sha ]] && ((bootstrap_state_touched == 1)); then
    record_failed_bootstrap_activation "$current" "$release" "$bootstrap_marker" \
      "$sha" "$digest" "$bootstrap_failure_phase" compose
  fi
  exit "$status"
}
trap rollback_on_error ERR
compose config --quiet
bootstrap_state_touched=1
compose up -d --wait postgres minio
docker run --rm --network sales-quotation_quotation_internal --env-file "$env_file" \
  "$digest" node /app/deploy/migrate-production.mjs

next_link=$current.next.$$
ln -s "$release" "$next_link"
mv -T "$next_link" "$current"
switched=1
APP_IMAGE=$digest "$release/deploy/production-up.sh" "$env_file"

bootstrap_failure_phase=health
dotenv_get SITE_ORIGIN "$env_file"
site_origin=$DOTENV_VALUE
health_attempt_count
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null \
    && curl --fail --silent --show-error "${site_origin:?SITE_ORIGIN is required}/api/health" >/dev/null; then
    break
  fi
  ((attempt < HEALTH_ATTEMPTS)) || false
  sleep 2
done
if ((recover_bootstrap == 1)); then
  archive_bootstrap_recovery "$bootstrap_marker" "$state/history" "$sha"
fi
switched=0
trap - ERR
record_release_lineage_and_prune "$root" "$sha"
prune_application_images "$root" "$repository"
trap - EXIT

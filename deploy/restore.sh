#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -ne 0 ]] || { echo "restore.sh must not run as root" >&2; exit 1; }
if [[ ${USER:-$(id -un)} != deploy && ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  echo "restore.sh must run as deploy" >&2; exit 1
fi
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/operations-common.sh
. "$script_dir/operations-common.sh"
deploy_uid=$(id -u)
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$deploy_uid}
export DOCKER_HOST=${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}
usage() {
  echo "usage: $0 --backup ABSOLUTE.age --target-db NAME --target-bucket NAME --confirm-restore-new-namespace" >&2
  exit 2
}
backup=""; target_db=""; target_bucket=""; confirmed=0
while (($#)); do
  case "$1" in
    --backup) (($# >= 2)) || usage; backup=$2; shift 2 ;;
    --target-db) (($# >= 2)) || usage; target_db=$2; shift 2 ;;
    --target-bucket) (($# >= 2)) || usage; target_bucket=$2; shift 2 ;;
    --confirm-restore-new-namespace) confirmed=1; shift ;;
    *) usage ;;
  esac
done
((confirmed == 1)) || usage
[[ $backup = /* && -f $backup && -f $backup.sha256 ]] || usage
[[ $target_db =~ ^restore_[a-z0-9_]{1,48}$ ]] || { echo "target database must begin restore_" >&2; exit 2; }
[[ $target_bucket =~ ^restore-[a-z0-9-]{1,48}$ ]] || { echo "target bucket must begin restore-" >&2; exit 2; }

root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
env_file=$root/shared/.env.production
current=$root/current
if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  [[ -r $env_file && ! -L $env_file && $(stat -c '%U:%G:%a' -- "$env_file") == root:deploy:640 ]] \
    || { echo "production environment must be root:deploy:640 and not a symlink" >&2; exit 1; }
fi
validate_env_file "$env_file" BACKUP_AGE_IDENTITY_FILE MINIO_ROOT_USER MINIO_ROOT_PASSWORD POSTGRES_USER
acquire_operations_lock
for key in BACKUP_AGE_IDENTITY_FILE MINIO_ROOT_USER MINIO_ROOT_PASSWORD POSTGRES_USER; do
  dotenv_get "$key" "$env_file"
  printf -v "$key" '%s' "$DOTENV_VALUE"
done
[[ ${MINIO_ROOT_USER:-} =~ ^[A-Za-z0-9._~-]+$ && ${MINIO_ROOT_PASSWORD:-} =~ ^[A-Za-z0-9._~-]+$ ]] \
  || { echo "MinIO restore credentials must be URL-safe for the non-argument MC_HOST transport" >&2; exit 1; }
(cd "$(dirname "$backup")" && sha256sum --check "$(basename "$backup").sha256")
umask 077
work=$(mktemp -d "$root/backups/.restore.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" "$backup" | tar -xf - -C "$work"
(cd "$work" && sha256sum --check archive-manifest.sha256)
(cd "$work/minio" && sha256sum --check ../minio-checksums.sha256)

compose() {
  docker compose --project-directory "$current" --env-file "$env_file" \
    --file "$current/docker-compose.yml" "$@"
}
db_created=0
bucket_owned=0
invocation_id=$(openssl rand -hex 16)
restore_complete=0
cleanup() {
  status=$?
  if ((restore_complete == 0)); then
    if ((bucket_owned == 1)); then
      compose exec -T -e CLEANUP_BUCKET="$target_bucket" -e OWNER_ID="$invocation_id" minio sh -eu -c '
        export MC_HOST_target="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
        marker="target/${CLEANUP_BUCKET}/restore-owner-${OWNER_ID}"
        [[ $(mc cat "$marker") == "$OWNER_ID" ]] && mc rb --force "target/${CLEANUP_BUCKET}" >/dev/null 2>&1
      ' || true
    fi
    if ((db_created == 1)); then
      compose exec -T -e CLEANUP_DB="$target_db" postgres sh -eu -c \
        'dropdb --if-exists --force --username="$POSTGRES_USER" "$CLEANUP_DB"' || true
    fi
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
if compose exec -T postgres sh -eu -c \
  'psql --no-psqlrc --tuples-only --no-align --username="$POSTGRES_USER" --dbname=postgres -c "SELECT datname FROM pg_database"' \
  | grep -Fxq -- "$target_db"; then
  echo "target database already exists" >&2; exit 1
fi
if compose exec -T -e TARGET_BUCKET="$target_bucket" minio sh -eu -c '
  export MC_HOST_target="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
  mc ls "target/${TARGET_BUCKET}" >/dev/null 2>&1
'; then
  echo "target bucket already exists" >&2; exit 1
fi
compose exec -T -e TARGET_DB="$target_db" postgres sh -eu -c \
  'createdb --username="$POSTGRES_USER" "$TARGET_DB"'
db_created=1
compose exec -T -e TARGET_DB="$target_db" postgres sh -eu -c \
  'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$TARGET_DB"' \
  < "$work/postgresql.dump"
compose exec -T postgres psql --no-psqlrc --tuples-only --no-align --field-separator=$'\t' \
  --username="$POSTGRES_USER" --dbname="$target_db" > "$work/restored-database-counts.tsv" <<'SQL'
SELECT table_name,
       (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
SQL
cmp -s "$work/database-counts.tsv" "$work/restored-database-counts.tsv" \
  || { echo "restored database row counts differ" >&2; exit 1; }

compose exec -T -e TARGET_BUCKET="$target_bucket" -e OWNER_ID="$invocation_id" minio sh -eu -c '
  export MC_HOST_target="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
  mc mb "target/${TARGET_BUCKET}" >/dev/null
  if ! printf "%s" "$OWNER_ID" | mc pipe "target/${TARGET_BUCKET}/restore-owner-${OWNER_ID}" >/dev/null; then
    mc rb --force "target/${TARGET_BUCKET}" >/dev/null 2>&1 || true
    exit 1
  fi
'
bucket_owned=1
tar -cf - -C "$work" minio minio-checksums.sha256 | compose exec -T -e TARGET_BUCKET="$target_bucket" minio sh -eu -c '
  command -v mc >/dev/null
  temporary=$(mktemp -d)
  trap "rm -rf -- $temporary" EXIT
  tar -xf - -C "$temporary"
  export MC_HOST_target="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
  mc mirror --overwrite "$temporary/minio/files" "target/${TARGET_BUCKET}" >/dev/null
  mkdir -p "$temporary/verify/files"
  mc mirror --overwrite "target/${TARGET_BUCKET}" "$temporary/verify/files" >/dev/null
  cd "$temporary/verify"
  sha256sum --check "$temporary/minio-checksums.sha256"
'
compose exec -T -e TARGET_BUCKET="$target_bucket" -e OWNER_ID="$invocation_id" minio sh -eu -c '
  export MC_HOST_target="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
  mc rm "target/${TARGET_BUCKET}/restore-owner-${OWNER_ID}" >/dev/null
'
restore_complete=1

echo "Restore verified in new database $target_db and new bucket $target_bucket."
echo "No live namespace changed; explicit promotion is a separate manual operation."

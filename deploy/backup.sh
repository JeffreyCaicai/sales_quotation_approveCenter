#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -ne 0 ]] || { echo "backup.sh must not run as root" >&2; exit 1; }
if [[ ${USER:-$(id -un)} != deploy && ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  echo "backup.sh must run as deploy" >&2; exit 1
fi
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/operations-common.sh
. "$script_dir/operations-common.sh"
deploy_uid=$(id -u)
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$deploy_uid}
export DOCKER_HOST=${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}
root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
acquire_operations_lock
env_file=$root/shared/.env.production
current=$root/current
backup_root=$root/backups
[[ -L $current && -r $env_file ]] || { echo "current release and environment are required" >&2; exit 1; }
if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  [[ ! -L $env_file && $(stat -c '%U:%G:%a' -- "$env_file") == root:deploy:640 ]] \
    || { echo "production environment must be root:deploy:640 and not a symlink" >&2; exit 1; }
fi

for key in BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY S3_BUCKET MINIO_ROOT_USER MINIO_ROOT_PASSWORD POSTGRES_USER POSTGRES_DB; do
  dotenv_get "$key" "$env_file"
  printf -v "$key" '%s' "$DOTENV_VALUE"
done
[[ ${MINIO_ROOT_USER:-} =~ ^[A-Za-z0-9._~-]+$ && ${MINIO_ROOT_PASSWORD:-} =~ ^[A-Za-z0-9._~-]+$ ]] \
  || { echo "MinIO backup credentials must be URL-safe for the non-argument MC_HOST transport" >&2; exit 1; }

umask 077
mkdir -p "$backup_root"
work=$(mktemp -d "$backup_root/.staging.XXXXXX")
timestamp=$(date -u +%Y%m%dT%H%M%S.%N)-$(openssl rand -hex 8)
base=sales-quotation-$timestamp
archive=$backup_root/$base.tar.age
web_restart_needed=0
backup_verified=0
remote_started=0
remote=""

compose() {
  docker compose --project-directory "$current" --env-file "$env_file" \
    --file "$current/docker-compose.yml" "$@"
}
cleanup_backup() {
  status=$?
  delete_remote_backup_object() { rclone deletefile "$1" >/dev/null 2>&1; }
  cleanup_unverified_backup_artifacts "$archive" "$backup_verified" "$remote_started" "$remote" delete_remote_backup_object
  rm -rf -- "$work"
  if ((web_restart_needed == 1)); then
    digest=$(<"$current/image.digest")
    APP_IMAGE=$digest "$current/deploy/production-up.sh" "$env_file" || status=1
  fi
  exit "$status"
}
trap cleanup_backup EXIT

# No worker is deployed. Stopping web removes the only application writer, so the
# PostgreSQL dump/counts and MinIO mirror share one quiescent maintenance window.
web_restart_needed=1
compose stop web
compose exec -T postgres pg_dump --format=custom --no-owner --no-acl \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  > "$work/postgresql.dump"
compose exec -T postgres psql --no-psqlrc --tuples-only --no-align --field-separator=$'\t' \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" > "$work/database-counts.tsv" <<'SQL'
SELECT table_name,
       (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
SQL

mkdir -p "$work/minio"
compose exec -T -e BACKUP_SOURCE_BUCKET="$S3_BUCKET" minio sh -eu -c '
  command -v mc >/dev/null
  temporary=$(mktemp -d)
  trap "rm -rf -- $temporary" EXIT
  export MC_HOST_source="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000"
  mc mirror --overwrite --remove "source/${BACKUP_SOURCE_BUCKET}" "$temporary/files" >/dev/null
  tar -cf - -C "$temporary" files
' | tar -xf - -C "$work/minio"
(cd "$work/minio" && find files -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$work/minio-checksums.sha256"
(cd "$work" && sha256sum postgresql.dump database-counts.tsv minio-checksums.sha256) > "$work/archive-manifest.sha256"
tar -cf - -C "$work" postgresql.dump database-counts.tsv minio minio-checksums.sha256 archive-manifest.sha256 \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$archive"
(cd "$backup_root" && sha256sum "$base.tar.age") > "$archive.sha256"

export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER=Other
export RCLONE_CONFIG_BACKUP_ENDPOINT=$BACKUP_S3_ENDPOINT
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY
remote="backup:${BACKUP_S3_BUCKET}/$base"
remote_started=1
rclone copyto "$archive" "$remote.tar.age"
rclone copyto "$archive.sha256" "$remote.tar.age.sha256"
rclone cat "$remote.tar.age.sha256" | cmp -s - "$archive.sha256"
local_digest=$(sha256sum "$archive" | cut -d' ' -f1)
remote_digest=$(rclone cat "$remote.tar.age" | sha256sum | cut -d' ' -f1)
[[ $remote_digest == "$local_digest" ]] || { echo "off-VPS backup checksum verification failed" >&2; exit 1; }
remote_size=$(rclone size --json "$remote.tar.age" | sed -n 's/.*"bytes":\([0-9][0-9]*\).*/\1/p')
[[ $remote_size == "$(stat -c %s "$archive")" ]] || { echo "off-VPS backup size verification failed" >&2; exit 1; }
touch "$archive.verified"
backup_verified=1

find "$backup_root" -maxdepth 1 -type f -name '*.tar.age.verified' -mtime +30 -print0 \
  | while IFS= read -r -d '' marker; do
      encrypted=${marker%.verified}
      rm -f -- "$marker" "$encrypted" "$encrypted.sha256"
    done

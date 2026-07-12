#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "rotate-runtime-secrets.sh must run as root" >&2; exit 1; }
umask 077

root=/opt/sales-quotation
env_file=$root/shared/.env.production
current=$root/current
[[ ! -L $env_file && -f $env_file && $(stat -c '%U:%G:%a' -- "$env_file") == root:deploy:640 ]] \
  || { echo "production environment must be root:deploy:640 and not a symlink" >&2; exit 1; }
[[ -L $current ]] || { echo "current release is not active" >&2; exit 1; }
release=$(realpath -- "$current")
[[ $release == "$root"/releases/* && -f $release/image.digest ]] \
  || { echo "current release is invalid" >&2; exit 1; }
image=$(<"$release/image.digest")
[[ $image =~ ^ghcr\.io/jeffreycaicai/sales_quotation_approvecenter@sha256:[0-9a-f]{64}$ ]] \
  || { echo "current release image digest is invalid" >&2; exit 1; }

dotenv_get() {
  local key=$1 line
  line=$(grep -m1 -E "^${key}=" "$env_file") \
    || { echo "missing production setting: $key" >&2; return 1; }
  printf '%s' "${line#*=}"
}

postgres_user=$(dotenv_get POSTGRES_USER)
postgres_db=$(dotenv_get POSTGRES_DB)
old_postgres_password=$(dotenv_get POSTGRES_PASSWORD)
s3_access_key=$(dotenv_get S3_ACCESS_KEY_ID)
s3_bucket=$(dotenv_get S3_BUCKET)
[[ $postgres_user =~ ^[a-z_][a-z0-9_]*$ && $postgres_db =~ ^[a-z_][a-z0-9_]*$ ]] \
  || { echo "PostgreSQL identifiers are unsafe" >&2; exit 1; }
[[ $s3_access_key =~ ^[A-Za-z0-9_-]{3,64}$ ]] \
  || { echo "S3 access key is unsafe" >&2; exit 1; }
[[ $s3_bucket =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] \
  || { echo "S3 bucket name is unsafe" >&2; exit 1; }
[[ $old_postgres_password =~ ^[0-9a-f]{64}$ ]] \
  || { echo "existing PostgreSQL password is outside the managed format" >&2; exit 1; }
for key in APP_IMAGE POSTGRES_PASSWORD DATABASE_URL S3_SECRET_ACCESS_KEY AUTH_SECRET; do
  count=$(grep -c -E "^${key}=" "$env_file" || true)
  [[ $count -eq 1 ]] || { echo "production setting must appear exactly once: $key" >&2; exit 1; }
done

new_postgres_password=$(openssl rand -hex 32)
new_auth_secret=$(openssl rand -hex 64)
new_s3_secret=$(openssl rand -hex 32)
new_database_url="postgresql://${postgres_user}:${new_postgres_password}@postgres:5432/${postgres_db}"
next_env=$(mktemp "$root/shared/.env.production.rotate.XXXXXX")
rotated_env="$root/shared/.env.production.next.$$"
chmod 0600 "$next_env"
replaced=0
while IFS= read -r line || [[ -n $line ]]; do
  case $line in
    APP_IMAGE=*) printf 'APP_IMAGE=%s\n' "$image"; ((replaced+=1)) ;;
    POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$new_postgres_password"; ((replaced+=1)) ;;
    DATABASE_URL=*) printf 'DATABASE_URL=%s\n' "$new_database_url"; ((replaced+=1)) ;;
    S3_SECRET_ACCESS_KEY=*) printf 'S3_SECRET_ACCESS_KEY=%s\n' "$new_s3_secret"; ((replaced+=1)) ;;
    AUTH_SECRET=*) printf 'AUTH_SECRET=%s\n' "$new_auth_secret"; ((replaced+=1)) ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$next_env"
[[ $replaced -eq 5 ]] || { echo "production environment has missing or duplicate rotation keys" >&2; exit 1; }

deploy_uid=$(id -u deploy)
run_as_deploy() {
  runuser -u deploy -- env \
    XDG_RUNTIME_DIR="/run/user/$deploy_uid" \
    DOCKER_HOST="unix:///run/user/$deploy_uid/docker.sock" \
    sh -c 'cd /home/deploy && exec "$@"' sh "$@"
}
docker_as_deploy() { run_as_deploy docker "$@"; }

web_stopped=0
db_changed=0
env_installed=0
cleanup() {
  local status=$?
  set +e
  trap - EXIT
  rm -f -- "$next_env" "$rotated_env"
  if ((status != 0 && db_changed == 1 && env_installed == 0)); then
    printf 'ALTER ROLE "%s" WITH PASSWORD '\''%s'\'';\n' "$postgres_user" "$old_postgres_password" \
      | docker_as_deploy exec -i sales-quotation-postgres-1 \
          psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$postgres_user" --dbname="$postgres_db" >/dev/null \
      || true
  fi
  if ((status != 0 && web_stopped == 1)); then
    run_as_deploy env APP_IMAGE="$image" "$release/deploy/production-up.sh" "$env_file" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

docker_as_deploy stop sales-quotation-web-1 >/dev/null
web_stopped=1
printf 'ALTER ROLE "%s" WITH PASSWORD '\''%s'\'';\n' "$postgres_user" "$new_postgres_password" \
  | docker_as_deploy exec -i sales-quotation-postgres-1 \
      psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$postgres_user" --dbname="$postgres_db" >/dev/null
db_changed=1
install -o root -g deploy -m 0640 "$next_env" "$rotated_env"
mv -T -- "$rotated_env" "$env_file"
env_installed=1

docker_as_deploy exec -i --env-file "$env_file" sales-quotation-minio-1 sh -s <<'MINIO_SETUP'
set -eu
export MC_CONFIG_DIR=/tmp/mc-quotation-rotate-$$
policy=/tmp/quotation-app-policy-$$.json
cleanup_mc(){ rm -rf -- "$MC_CONFIG_DIR" "$policy"; }
trap cleanup_mc EXIT
mc alias set quotation-local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "quotation-local/$S3_BUCKET" >/dev/null
mc version enable "quotation-local/$S3_BUCKET" >/dev/null
cat > "$policy" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:ListBucket", "s3:ListBucketVersions"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion",
        "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObjectTagging", "s3:PutObjectVersionTagging"
      ],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]
    }
  ]
}
POLICY
mc admin policy create quotation-local quotation-app "$policy" >/dev/null
mc admin user add quotation-local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc admin policy attach quotation-local quotation-app --user "$S3_ACCESS_KEY_ID" >/dev/null
mc alias set quotation-app http://127.0.0.1:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
probe="quotation-app/$S3_BUCKET/.deployment-probe/rotation-$$"
printf 'ok\n' | mc pipe "$probe" >/dev/null
payload=$(mc cat "$probe")
[ "$payload" = ok ]
mc tag set "$probe" state=committed >/dev/null
mc rm --recursive --force --versions "quotation-app/$S3_BUCKET/.deployment-probe/" >/dev/null
MINIO_SETUP

run_as_deploy env APP_IMAGE="$image" "$release/deploy/production-up.sh" "$env_file" >/dev/null
for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null; then
    web_stopped=0
    trap - EXIT
    rm -f -- "$next_env" "$rotated_env"
    unset new_postgres_password new_auth_secret new_s3_secret old_postgres_password
    echo "runtime secrets rotated; MinIO application policy initialized; web is healthy"
    exit 0
  fi
  ((attempt < 30)) || false
  sleep 2
done

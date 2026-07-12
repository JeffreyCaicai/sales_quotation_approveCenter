#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [production-env-file]" >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/operations-common.sh
. "$script_dir/operations-common.sh"
project_dir=$(cd -- "$script_dir/.." && pwd)
compose_file=$project_dir/docker-compose.yml
env_file=${1:-/opt/sales-quotation/shared/.env.production}
validate_env_file "$env_file" APP_IMAGE SITE_ORIGIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET AUTH_SECRET

compose() {
  docker compose \
    --project-directory "$project_dir" \
    --env-file "$env_file" \
    --file "$compose_file" \
    "$@"
}

image=$(compose config --images web)
"$script_dir/validate-app-image.sh" "$image"
compose config --quiet
compose up -d

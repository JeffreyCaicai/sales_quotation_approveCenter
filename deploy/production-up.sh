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

app_repository=ghcr.io/jeffreycaicai/sales_quotation_approvecenter
app_images=()
while IFS= read -r image; do app_images+=("$image"); done < <(
  compose config --images \
    | grep -E "^${app_repository//./\\.}@sha256:[0-9a-f]{64}$" \
    || true
)
((${#app_images[@]} == 1)) \
  || { echo "Compose must resolve exactly one immutable application image" >&2; exit 1; }
"$script_dir/validate-app-image.sh" "${app_images[0]}"
compose config --quiet
compose up -d

#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [production-env-file]" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
compose_file=$project_dir/docker-compose.yml
env_file=${1:-/opt/sales-quotation/shared/.env.production}

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

#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -ne 0 ]] || { echo "rollback.sh must not run as root" >&2; exit 1; }
if [[ ${USER:-$(id -un)} != deploy && ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
  echo "rollback.sh must run as deploy" >&2; exit 1
fi
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
[[ -d $release && -f $release/image.digest && -x $release/deploy/production-up.sh ]] \
  || { echo "retained release is incomplete" >&2; exit 1; }
digest=$(<"$release/image.digest")
"$release/deploy/validate-app-image.sh" "$digest"

next_link=$root/.current.next.$$
ln -s "$release" "$next_link"
mv -T "$next_link" "$current"
APP_IMAGE=$digest "$release/deploy/production-up.sh" "$env_file"
for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null; then exit 0; fi
  ((attempt < 30)) || { echo "rollback health check failed" >&2; exit 1; }
  sleep 2
done

#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} == 1 ]]; then
  root=${SALES_QUOTATION_ROOT:-/opt/sales-quotation}
else
  root=/opt/sales-quotation
fi
[[ $root = /* && $root != */../* ]] || { echo "invalid sales quotation root" >&2; exit 2; }

releases=$root/releases
current=$root/current
bootstrap_installer=$root/bootstrap/deploy/install-release.sh
installer=""
root_target=$(realpath -- "$root" 2>/dev/null || true)

if [[ -L $current && -d $releases ]]; then
  current_target=$(realpath -- "$current" 2>/dev/null || true)
  releases_target=$(realpath -- "$releases" 2>/dev/null || true)
  current_sha=${current_target##*/}
  candidate=$current_target/deploy/install-release.sh
  if [[ $current_sha =~ ^[0-9a-f]{40}$ \
    && ${current_target%/*} == "$releases_target" \
    && -f $candidate && ! -L $candidate && -x $candidate \
    && $(realpath -- "$candidate") == "$current_target/deploy/install-release.sh" ]]; then
    installer=$candidate
  fi
fi

if [[ -z $installer ]]; then
  [[ -n $root_target && ! -L $root/bootstrap && ! -L $root/bootstrap/deploy \
    && -f $bootstrap_installer && ! -L $bootstrap_installer && -x $bootstrap_installer \
    && $(realpath -- "$bootstrap_installer") == "$root_target/bootstrap/deploy/install-release.sh" ]] \
    || { echo "trusted bootstrap installer is unavailable" >&2; exit 1; }
  if [[ ${OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER:-} != 1 ]]; then
    [[ $(stat -c '%U:%G' -- "$root/bin/install-release" "$root/bootstrap" "$root/bootstrap/deploy" "$bootstrap_installer") \
      == $'root:root\nroot:root\nroot:root\nroot:root' ]] \
      || { echo "trusted bootstrap installation is not root-owned" >&2; exit 1; }
  fi
  installer=$bootstrap_installer
fi

exec "$installer" "$@"

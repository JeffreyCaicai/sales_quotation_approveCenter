#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: sudo $0 --authorized-key-file PATH [--confirm-fresh-session]" >&2
  exit 2
}

[[ ${EUID} -eq 0 ]] || { echo "provision-vps.sh must run as root" >&2; exit 1; }
key_file=""
confirm_fresh_session=0
while (($#)); do
  case "$1" in
    --authorized-key-file) (($# >= 2)) || usage; key_file=$2; shift 2 ;;
    --confirm-fresh-session) confirm_fresh_session=1; shift ;;
    *) usage ;;
  esac
done
[[ -n $key_file && -f $key_file ]] || usage
mapfile -t supplied_keys < "$key_file"
[[ ${#supplied_keys[@]} -eq 1 ]] || { echo "authorized key file must contain exactly one key" >&2; exit 1; }
grep -Eq '^ssh-(ed25519|rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]]+[A-Za-z0-9+/=]+' "$key_file" \
  || { echo "authorized key file does not contain a supported SSH public key" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=deploy/provision-lib.sh
. "$script_dir/provision-lib.sh"
if systemctl is-active --quiet docker.service || systemctl is-active --quiet docker.socket; then
  echo "A rootful Docker daemon is active; refusing to disrupt unknown workloads." >&2
  exit 1
fi
apt-get update
apt-get install -y ca-certificates curl age openssl postgresql-client rclone uidmap dbus-user-session slirp4netns ufw util-linux

# Follow Docker's supported Ubuntu apt-repository path; never execute a downloaded script.
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg \
  --output /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
architecture=$(dpkg --print-architecture)
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce-cli docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
# The Debian packages may start their rootful units. They were proven inactive above,
# so disable only the newly introduced daemon before configuring the rootless service.
systemctl disable --now docker.service docker.socket >/dev/null 2>&1 || true

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
fi
# Do not leave an existing or new deploy account shadow-locked.
repair_deploy_password deploy
ensure_subid_file /etc/subuid deploy
ensure_subid_file /etc/subgid deploy
getent group deploy >/dev/null
deploy_home=$(getent passwd deploy | cut -d: -f6)
install -d -m 0700 -o deploy -g deploy "$deploy_home/.ssh"
authorized_keys=$deploy_home/.ssh/authorized_keys
touch "$authorized_keys"
if ! grep -Fxq -- "${supplied_keys[0]}" "$authorized_keys"; then
  printf '%s\n' "${supplied_keys[0]}" >> "$authorized_keys"
fi
chown deploy:deploy "$authorized_keys"
chmod 0600 "$authorized_keys"

install -d -m 0750 -o deploy -g deploy /opt/sales-quotation/releases
install -d -m 0700 -o deploy -g deploy /opt/sales-quotation/backups
install -d -m 0750 -o root -g deploy /opt/sales-quotation/shared
install -d -m 0755 -o root -g root /opt/sales-quotation/bin
install -d -m 0755 -o root -g root /opt/sales-quotation/bootstrap /opt/sales-quotation/bootstrap/deploy
install -m 0555 -o root -g root "$script_dir/install-release-launcher.sh" /opt/sales-quotation/bin/install-release
for bootstrap_script in install-release.sh operations-common.sh validate-app-image.sh rollback.sh; do
  install -m 0555 -o root -g root "$script_dir/$bootstrap_script" "/opt/sales-quotation/bootstrap/deploy/$bootstrap_script"
done
if [[ ! -e /opt/sales-quotation/.operations.lock ]]; then
  install -m 0600 -o deploy -g deploy /dev/null /opt/sales-quotation/.operations.lock
fi
if [[ ! -e /opt/sales-quotation/release-lineage ]]; then
  install -m 0600 -o deploy -g deploy /dev/null /opt/sales-quotation/release-lineage
fi
if [[ -e /opt/sales-quotation/shared/.env.production ]]; then
  chown root:deploy /opt/sales-quotation/shared/.env.production
  chmod 0640 /opt/sales-quotation/shared/.env.production
fi

# Preserve the existing port-80 application before any separate vhost work.
nginx_backup="/var/backups/sales-quotation/nginx/$(date -u +%Y%m%dT%H%M%SZ)"
for kind in sites-available sites-enabled; do
  existing=/etc/nginx/$kind/worldcup-lottery
  if [[ -e $existing ]]; then
    install -d -m 0700 "$nginx_backup/$kind"
    cp -a -- "$existing" "$nginx_backup/$kind/worldcup-lottery"
  fi
done

ssh_drop_in=/etc/ssh/sshd_config.d/60-sales-quotation-hardening.conf
cat > "$ssh_drop_in" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers jeffrey-admin deploy

Match User deploy
    AuthenticationMethods publickey
EOF
chmod 0644 "$ssh_drop_in"
sshd -t

detect_sshd_ports
configure_ufw "${SSHD_PORTS[@]}" 80 443

loginctl enable-linger deploy
deploy_uid=$(id -u deploy)
runtime_dir="/run/user/$deploy_uid"
if [[ ! -S $runtime_dir/bus ]]; then
  echo "A real deploy login is required before rootless Docker setup; SSH as deploy, keep it open, then rerun." >&2
  exit 1
fi
if [[ ! -f $deploy_home/.config/systemd/user/docker.service ]]; then
  runuser -u deploy -- env HOME="$deploy_home" XDG_RUNTIME_DIR="$runtime_dir" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" dockerd-rootless-setuptool.sh install
fi
runuser -u deploy -- env HOME="$deploy_home" XDG_RUNTIME_DIR="$runtime_dir" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" systemctl --user enable --now docker.service
runuser -u deploy -- env HOME="$deploy_home" XDG_RUNTIME_DIR="$runtime_dir" \
  DOCKER_HOST="unix://$runtime_dir/docker.sock" docker info --format '{{json .SecurityOptions}}' | grep -q rootless

install -m 0644 "$script_dir/sales-quotation-backup.service" /etc/systemd/system/sales-quotation-backup.service
install -m 0644 "$script_dir/sales-quotation-backup.timer" /etc/systemd/system/sales-quotation-backup.timer
systemctl daemon-reload
systemctl enable --now sales-quotation-backup.timer

if ((confirm_fresh_session == 0)); then
  echo "SSH hardening is staged and syntax-valid but not reloaded." >&2
  echo "Open and keep a fresh key-authenticated deploy session, then rerun with --confirm-fresh-session." >&2
  exit 3
fi
systemctl reload ssh

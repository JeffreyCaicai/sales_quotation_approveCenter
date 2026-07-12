#!/usr/bin/env bash

provision_path_metadata() {
  local path=$1 metadata
  if metadata=$(stat -c '%U:%G:%a' -- "$path" 2>/dev/null); then
    printf '%s\n' "$metadata"
  else
    stat -f '%Su:%Sg:%Lp' "$path"
  fi
}

ensure_deploy_state_directory() {
  local parent=$1 state_owner=$2 state_group=$3 parent_owner=$4 parent_group=$5
  local state=$parent/state parent_metadata state_metadata parent_mode
  [[ $parent = /* && $state_owner =~ ^[A-Za-z_][A-Za-z0-9_-]*$ \
    && $state_group =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] \
    || { echo "invalid state directory parameters" >&2; return 1; }
  [[ -d $parent && ! -L $parent ]] || { echo "state parent must be a real directory" >&2; return 1; }
  parent_metadata=$(provision_path_metadata "$parent") || return 1
  [[ ${parent_metadata%:*} == "$parent_owner:$parent_group" ]] \
    || { echo "state parent ownership is invalid" >&2; return 1; }
  parent_mode=${parent_metadata##*:}
  [[ $parent_mode =~ ^[0-7]{3,4}$ && $((8#$parent_mode & 0022)) -eq 0 ]] \
    || { echo "state parent must not be group- or world-writable" >&2; return 1; }

  [[ ! -L $state ]] || { echo "state entry must not be a symlink" >&2; return 1; }
  if [[ -e $state ]]; then
    [[ -d $state ]] || { echo "state entry must be a directory" >&2; return 1; }
  else
    mkdir -m 0750 -- "$state"
  fi
  # The validated parent cannot be replaced by deploy, so these operations touch
  # only the state directory entry and never anything beneath it.
  [[ -d $state && ! -L $state ]] || { echo "state entry changed unexpectedly" >&2; return 1; }
  chown "$state_owner:$state_group" "$state"
  chmod 0750 "$state"
  state_metadata=$(provision_path_metadata "$state") || return 1
  [[ $state_metadata == "$state_owner:$state_group:750" ]] \
    || { echo "state directory ownership or mode is invalid" >&2; return 1; }
}

repair_deploy_password() {
  local user=$1 status random_password
  status=$(${PASSWD_BIN:-passwd} -S "$user")
  if [[ $(awk '{print $2}' <<<"$status") == L* ]]; then
    random_password=$(${OPENSSL_BIN:-openssl} rand -base64 48)
    printf '%s:%s\n' "$user" "$random_password" | ${CHPASSWD_BIN:-chpasswd}
    unset random_password
  fi
}

ensure_subid_file() {
  local file=$1 user=$2 temporary start
  if awk -F: -v user="$user" '
    $1==user { us=$2; ue=$2+$3-1; count++; valid=($3>=65536) }
    $1!=user { s[++n]=$2; e[n]=$2+$3-1 }
    END { if (count!=1 || !valid) exit 1; for(i=1;i<=n;i++) if(us<=e[i] && ue>=s[i]) exit 1 }
  ' "$file"; then return 0; fi
  start=$(awk -F: '$2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { end=$2+$3; if(end>max) max=end } END { if(max<100000) max=100000; print max }' "$file")
  temporary=$file.tmp.$$
  awk -F: -v user="$user" '$1!=user' "$file" > "$temporary"
  printf '%s:%s:65536\n' "$user" "$start" >> "$temporary"
  chmod --reference="$file" "$temporary" 2>/dev/null || chmod 0644 "$temporary"
  chown --reference="$file" "$temporary" 2>/dev/null || true
  mv -f "$temporary" "$file"
}

detect_sshd_ports() {
  local output port
  output=$(${SS_BIN:-ss} -H -ltnp)
  SSHD_PORTS=()
  while IFS= read -r port; do SSHD_PORTS+=("$port"); done \
    < <(awk '$0 ~ /sshd/ { local=$4; sub(/^.*:/, "", local); if(local ~ /^[0-9]+$/) print local }' <<<"$output" | sort -nu)
  ((${#SSHD_PORTS[@]} > 0)) || { echo "could not identify an active sshd listening port" >&2; return 1; }
}

configure_ufw() {
  local port ufw=${UFW_BIN:-ufw}
  "$ufw" default deny incoming
  "$ufw" default allow outgoing
  for port in "$@"; do [[ $port =~ ^[0-9]+$ ]] || return 1; "$ufw" allow "$port/tcp"; done
  "$ufw" --force enable
}

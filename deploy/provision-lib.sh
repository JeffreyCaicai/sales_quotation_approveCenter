#!/usr/bin/env bash

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

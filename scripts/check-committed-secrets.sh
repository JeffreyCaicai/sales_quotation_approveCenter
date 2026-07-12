#!/usr/bin/env bash
set -Eeuo pipefail

while IFS= read -r -d '' path; do
  case "/$path" in
    */.env|*/.env.*|*/id_rsa|*/id_ed25519|*.pem|*.p12|*.pfx)
      case "$path" in
        *.example) ;;
        *) echo "forbidden tracked secret filename: $path" >&2; exit 1 ;;
      esac
      ;;
  esac
done < <(git ls-files -z)

if git grep -nE -- '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{36,}|AKIA[0-9A-Z]{16}' -- . \
  ':(exclude)scripts/check-committed-secrets.sh' ':(exclude)tests/release-workflows.test.ts'; then
  echo "high-confidence secret material is committed" >&2
  exit 1
fi

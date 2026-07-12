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

private_key_pattern='-----BEGIN ([A-Z0-9 ]+ )?PRIVATE'
private_key_pattern+=' KEY-----'
github_token_pattern='g'
github_token_pattern+='h[pousr]_[A-Za-z0-9_]{36,}'
aws_access_key_pattern='A'
aws_access_key_pattern+='KIA[0-9A-Z]{16}'
pattern="$private_key_pattern|$github_token_pattern|$aws_access_key_pattern"

if git grep -nE -- "$pattern" -- .; then
  echo "high-confidence secret material is committed" >&2
  exit 1
fi

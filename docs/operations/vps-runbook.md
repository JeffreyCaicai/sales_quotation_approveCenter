# Sales Quotation VPS Operations Runbook

This runbook targets Ubuntu 22.04 and a rootless Docker daemon owned by `deploy`. The existing Nginx `worldcup-lottery` default site on port 80 is a protected workload: provisioning backs it up and never disables, replaces, or deletes it. Add the quotation hostname as a separate Nginx server block using `deploy/nginx/sales-quotation.conf.template`.

## Security model and first provisioning

Never send a root password in chat, a ticket, or a command line. Transfer a temporary SSH public-key file through an approved channel, then run provisioning from the repository checkout:

```sh
sudo ./deploy/provision-vps.sh --authorized-key-file /root/deploy-bootstrap.pub
```

The script creates `deploy` only when absent. For a new or existing shadow-locked account it assigns an unknown random system password without logging it; `passwd -l deploy` is prohibited because this host has demonstrated that a locked shadow account can cause OpenSSH to reject valid public keys. It also validates or repairs non-overlapping 65,536-ID `/etc/subuid` and `/etc/subgid` allocations before rootless setup. Password and keyboard-interactive authentication are disabled in SSH itself. The staged drop-in enforces `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers jeffrey-admin deploy`, and `AuthenticationMethods publickey` for `deploy`.

Keep the original privileged SSH session open throughout this sequence:

1. Open a second terminal and establish a fresh SSH session as `deploy` using its key. Do not use `sudo su` because that does not create the user systemd session rootless Docker needs.
2. In that fresh SSH session, verify `sudo -n true` fails. The deploy account must not have routine sudo.
3. Run `docker info` and confirm the security options include `rootless`; run `docker compose version` and a harmless Compose config check.
4. Keep that deploy session open. Rerun provisioning from the original session with both the key file and `--confirm-fresh-session`. The script runs `sshd -t` before it reloads SSH.
5. Open one more fresh key-authenticated session before closing the original session.

The Docker packages come from Docker's official Ubuntu apt repository and use `docker-ce-rootless-extras`; no downloaded script is piped to a shell. Provisioning refuses to disrupt an active rootful Docker daemon. Rootless Docker uses the deploy user's systemd service and lingering. Routine deployment, rollback, backup, and restore run as `deploy` with no sudo.

Provisioning reads the active `sshd` listening sockets and fails closed if it cannot identify at least one port. UFW then applies default-deny incoming/default-allow outgoing and idempotent allows for every detected SSH TCP port plus 80 and 443; it does not assume SSH is on port 22.

## Host files and secrets

The directory layout is:

```text
/opt/sales-quotation/
  current -> releases/<40-character-git-sha>
  releases/
  shared/.env.production
  backups/
```

`/opt/sales-quotation/shared` is `root:deploy` mode `0750`; `.env.production` is `root:deploy` mode `0640`. Do not place secret values in the repository, logs, shell history, command arguments, or release directories. The file must define the application variables plus these backup-only variables:

The dotenv contract is machine-safe `KEY=value`: one exact key per line, no `export` prefix, no empty values, and only `A-Z a-z 0-9 . _ ~ : / @ ? & = % + , -` in values. Whitespace, dollar signs, backticks, quotes, backslashes, and `#` are rejected before Docker or backup tools run. Operations scripts and the production startup wrapper use the same validator and never source or evaluate this file. Use hex or unpadded base64url secrets, for example `openssl rand -hex 32` or `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`.

```text
BACKUP_AGE_RECIPIENT=
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
```

The backup S3 credentials must be separate from the live MinIO credentials and limited to the off-VPS backup prefix. Store the age identity outside the VPS as part of the recovery kit; normal production configuration contains no `BACKUP_AGE_IDENTITY_FILE` assignment. For an approved restore only, copy the identity to a mode-`0600` safe path and add a nonempty line such as `BACKUP_AGE_IDENTITY_FILE=/safe/restore/identity.txt`. Remove that line and the identity file immediately after the restore. Restore fails closed while the key is absent.

## Nginx and TLS

Provisioning copies any existing `worldcup-lottery` site files into `/var/backups/sales-quotation/nginx/<UTC timestamp>/`. It never changes the default site. Follow `deploy/nginx/README.md` to render and enable a separately named quotation vhost, run `nginx -t`, request its certificate, and test both hostnames before reloading. PostgreSQL and MinIO remain private; only Nginx reaches web on `127.0.0.1:3000`.

## Install and rollback

The deploy workflow passes a 40-character lowercase Git SHA and the canonical
digest recorded after GHCR accepted that SHA-tagged image:

```sh
/opt/sales-quotation/current/deploy/install-release.sh "$GIT_SHA" \
  "ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:$DIGEST"
```

For the first release only, invoke the checked-out `deploy/install-release.sh` directly. It permits bootstrap only when both `current` and the two named stateful volumes are absent. If volumes exist without `current`, it fails closed because it cannot prove a complete pre-deploy backup; recover or explicitly disposition that state before continuing.

The installer performs an encrypted off-VPS backup before pulling. It resolves
the tag to a repository digest and refuses to continue unless that digest
exactly matches the workflow-recorded value. It extracts that image's release
bundle, starts only private PostgreSQL and MinIO, and runs
`/app/deploy/migrate-production.mjs` from the same immutable image before
changing web traffic. It atomically switches `current`, invokes the mandatory
`production-up.sh` wrapper, checks health on loopback and `SITE_ORIGIN`, and
automatically returns to the prior release on failure. Current plus two prior
releases are retained.

Install, rollback, backup, and restore share one host-wide operations lock. Nested backup/rollback calls inherit the held lock descriptor, so manual and systemd operations serialize without deadlock. Release retention follows the recorded switch lineage, not directory timestamps.

Manual rollback is explicit:

```sh
/opt/sales-quotation/current/deploy/rollback.sh <retained-git-sha>
```

The GitHub `Production Delivery` workflow exposes the same operation through
`workflow_dispatch`. Its input accepts only a full lowercase SHA; the host
script then requires that SHA to name a complete retained release. Arbitrary
commands, branches, tags, prefixes, and unretained SHAs are rejected.

SSH host verification uses only `VPS_HOST_KEY` from the protected environment.
The workflow writes `host key` for port 22 and `[host]:port key` for a
nondefault port into a dedicated temporary `known_hosts` file, then requires
`StrictHostKeyChecking=yes`; it never discovers a key during deployment.

Schema work must follow expand/migrate/contract across separate releases. A release may add compatible structures and migrate data; only a later release may remove the old contract after every retained rollback target no longer needs it. The scripts cannot make an irreversible contract migration safe and therefore do not claim database rollback.

## Backups and recovery drills

The systemd timer runs `backup.sh` daily as `deploy`. Backup is a maintenance window: the script acquires the operations lock and stops web to quiesce the only application writer only while capturing PostgreSQL and MinIO and writing fixed local checksum manifests. It restarts web immediately after that immutable local capture, before compression, age encryption, off-VPS upload, or remote verification. Its EXIT trap attempts the production startup wrapper exactly once before any potentially failing cleanup when capture exits early. This brief capture-only downtime is required so the dump, row-count manifest, and object mirror describe one consistent quiescent state. Each backup contains a PostgreSQL custom dump, exact table counts, a MinIO mirror, and SHA-256 manifests. It is encrypted with age before it becomes a retained file, uploaded with separately credentialed S3 access to off-VPS storage, and marked verified only after checksum metadata and byte size agree. Only verified local backup sets older than 30 days are removed; failed current-invocation local and off-VPS artifacts are cleaned without touching prior verified sets.

At least monthly, download a verified backup and its `.sha256` sidecar and restore into a new database and new bucket namespace:

```sh
./deploy/restore.sh \
  --backup /opt/sales-quotation/backups/sales-quotation-YYYYMMDDTHHMMSSZ.tar.age \
  --target-db restore_drill_yyyymmdd \
  --target-bucket restore-drill-yyyymmdd \
  --confirm-restore-new-namespace
```

Restore refuses existing namespaces, verifies the encrypted archive, database row counts, and MinIO file checksums, and never changes production. If verification fails, it removes only the newly created `restore_` database and `restore-` bucket for that invocation so a corrected retry is possible. Explicit promotion is a separate manual operation requiring an approved incident plan, a new pre-promotion backup, maintenance communication, and a reviewed namespace switch. Never promote a restore merely because the restore command completed.

Record the timer status, local verified marker, off-VPS object/version, restore counts, checksum result, and cleanup decision in the operations log without copying credentials or environment values.

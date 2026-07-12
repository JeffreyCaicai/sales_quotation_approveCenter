import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const scripts = [
  "deploy/provision-vps.sh",
  "deploy/install-release.sh",
  "deploy/backup.sh",
  "deploy/restore.sh",
  "deploy/rollback.sh",
];
const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const digestA = `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:${"a".repeat(64)}`;
const digestB = `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:${"b".repeat(64)}`;

describe("operations scripts static safety", () => {
  test.each(scripts)("%s enables strict error handling", (path) => {
    expect(read(path)).toMatch(/^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/m);
  });

  test.each(scripts.slice(1))("%s rejects root application execution", (path) => {
    expect(read(path)).toContain("EUID");
    expect(read(path)).toContain("must not run as root");
  });

  test("never accepts or embeds a password in command arguments", () => {
    const contents = scripts.map(read).join("\n");
    expect(contents).not.toMatch(/--password(?:=|\s)/);
    expect(contents).not.toMatch(/passwd\s+-l\s+deploy/);
    expect(contents).not.toMatch(/curl[^\n|]*\|\s*(?:sh|bash)/);
  });

  test.each(["deploy/install-release.sh", "deploy/backup.sh", "deploy/restore.sh", "deploy/rollback.sh"])(
    "%s enforces the root-owned shared environment contract",
    (path) => {
      expect(read(path)).toContain("root:deploy:640");
      expect(read(path)).toContain("stat -c");
    },
  );

  test("provisioning preserves Nginx and stages SSH hardening safely", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toContain("worldcup-lottery");
    expect(provision).toContain("/var/backups/sales-quotation/nginx");
    expect(provision).not.toMatch(/rm\s+[^\n]*(?:worldcup-lottery|sites-enabled\/default)/);
    expect(provision.toLowerCase()).not.toContain("caddy");
    expect(provision).toContain("PasswordAuthentication no");
    expect(provision).toContain("KbdInteractiveAuthentication no");
    expect(provision).toContain("PermitRootLogin no");
    expect(provision).toContain("AllowUsers jeffrey-admin deploy");
    expect(provision).toContain("AuthenticationMethods publickey");
    expect(provision).toContain("sshd -t");
    expect(provision).toContain("--confirm-fresh-session");
    expect(provision).toContain("chpasswd");
    expect(provision).not.toContain("passwd -l");
  });

  test("provisioning installs rootless Docker from the official apt repository", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toContain("download.docker.com/linux/ubuntu");
    expect(provision).toContain("docker-ce-rootless-extras");
    expect(provision).toContain("dockerd-rootless-setuptool.sh install");
    expect(provision).toContain("loginctl enable-linger deploy");
    expect(provision).not.toContain("usermod -aG docker");
  });

  test("provisioning creates the systemd-writable backup root for deploy", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toMatch(/install -d -m 0700 -o deploy -g deploy \/opt\/sales-quotation\/backups/);
    expect(read("deploy/sales-quotation-backup.service")).toContain("ReadWritePaths=/opt/sales-quotation/backups");
  });

  test("release install validates SHA, backs up before pull, enforces a digest, migrates, and atomically switches", () => {
    const install = read("deploy/install-release.sh");
    expect(install).toMatch(/\[0-9a-f\]\{40\}/);
    expect(install.indexOf("backup.sh")).toBeLessThan(install.indexOf("docker pull"));
    expect(install).toContain("validate-app-image.sh");
    expect(install).toContain("migrate-production.mjs");
    expect(install).toMatch(/compose[^\n]*up[^\n]*postgres[^\n]*minio/);
    expect(install).toContain("compose up -d --wait postgres minio");
    expect(install).toContain("production-up.sh");
    expect(install).toMatch(/ln\s+-s\s+"\$release"\s+"\$next_link"/);
    expect(install).toMatch(/mv\s+-T\s+"\$next_link"\s+"\$current"/);
    expect(install).toContain("rollback.sh");
    expect(install).toContain("127.0.0.1:3000/api/health");
    expect(install).toContain("SITE_ORIGIN");
    expect(install).toContain("docker volume inspect sales-quotation_postgres_data");
    expect(install).toContain("docker volume inspect sales-quotation_minio_data");
  });

  test("backup uses custom PostgreSQL dump, MinIO mirror/checksums, age, verified offsite copy and retention", () => {
    const backup = read("deploy/backup.sh");
    expect(backup).toContain("pg_dump");
    expect(backup).toMatch(/(?:--format=custom|-Fc)/);
    expect(backup).toContain("mc mirror");
    expect(backup).toContain("sha256sum");
    expect(backup).toContain("age --encrypt");
    expect(backup).toContain("BACKUP_S3_ENDPOINT");
    expect(backup).toContain("BACKUP_S3_ACCESS_KEY_ID");
    expect(backup).toContain("BACKUP_S3_SECRET_ACCESS_KEY");
    expect(backup).toContain(".verified");
    expect(backup).toContain("-mtime +30");
    expect(backup).toMatch(/rclone cat "\$remote\.tar\.age"\s*\|\s*sha256sum/);
  });

  test("restore requires a backup and confirmation, restores new namespaces, and separates promotion", () => {
    const restore = read("deploy/restore.sh");
    expect(restore).toContain("--backup");
    expect(restore).toContain("--confirm-restore-new-namespace");
    expect(restore).toContain("--target-db");
    expect(restore).toContain("--target-bucket");
    expect(restore).toContain("createdb");
    expect(restore).toContain("pg_restore");
    expect(restore).toContain("mc mirror");
    expect(restore).toContain("sha256sum --check");
    expect(restore).toContain('dropdb --if-exists --force --username="$POSTGRES_USER" "$CLEANUP_DB"');
    expect(restore).toContain('mc rb --force "target/${CLEANUP_BUCKET}"');
    expect(restore).toContain("promotion is a separate manual operation");
  });

  test("the immutable runtime image carries SQL migrations and a non-dev migration command", () => {
    const dockerfile = read("Dockerfile");
    const runner = read("deploy/migrate-production.mjs");
    expect(dockerfile).toContain("/app/drizzle ./drizzle");
    expect(dockerfile).toContain("COPY --from=builder --chown=10001:10001 /app/drizzle ./drizzle");
    expect(dockerfile).toContain("migrate-production.mjs");
    expect(dockerfile).toContain("/opt/release-bundle");
    expect(runner).toContain("drizzle-orm/node-postgres/migrator");
    expect(runner).not.toContain("tsx");
    expect(() => execFileSync(process.execPath, ["--check", "deploy/migrate-production.mjs"])).not.toThrow();
  });

  test("the release bundle remains available to Docker despite broad local ignores", () => {
    expect(read(".dockerignore")).toContain("!docker-compose.yml");
  });

  test("systemd runs backup as deploy and the timer is persistent", () => {
    expect(read("deploy/sales-quotation-backup.service")).toContain("User=deploy");
    expect(read("deploy/sales-quotation-backup.service")).toContain("/opt/sales-quotation/current/deploy/backup.sh");
    expect(read("deploy/sales-quotation-backup.timer")).toContain("Persistent=true");
    expect(read("deploy/sales-quotation-backup.timer")).toMatch(/OnCalendar=\*-\*-\*/);
  });

  test("the environment template documents backup-only names and safe shared readability", () => {
    const example = read("deploy/env.production.example");
    expect(example).toContain("root:deploy");
    expect(example).toContain("0640");
    expect(example).not.toContain("chmod 0600");
    for (const name of [
      "BACKUP_AGE_RECIPIENT", "BACKUP_AGE_IDENTITY_FILE", "BACKUP_S3_ENDPOINT",
      "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY",
    ]) expect(example).toMatch(new RegExp(`^${name}=`, "m"));
  });

  test("runbook covers fresh-session SSH safety, rootless operation, Nginx preservation, and migration policy", () => {
    const runbook = read("docs/operations/vps-runbook.md");
    for (const phrase of [
      "keep the original", "fresh SSH session", "sudo -n true", "docker compose",
      "worldcup-lottery", "root password", "expand/migrate/contract", "root:deploy", "0640",
      "new database", "new bucket", "explicit promotion", "off-VPS",
    ]) expect(runbook.toLowerCase()).toContain(phrase.toLowerCase());
  });
});

describe("operations scripts behavior", () => {
  test("release and rollback reject traversal and malformed SHAs before invoking Docker", () => {
    for (const path of ["deploy/install-release.sh", "deploy/rollback.sh"]) {
      for (const value of ["../etc/passwd", "A".repeat(40), "a".repeat(39), `${"a".repeat(40)}/x`]) {
        const result = spawnSync(resolve(path), [value], {
          encoding: "utf8",
          env: { ...process.env, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1" },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("40 lowercase hexadecimal");
      }
    }
  });

  test("restore fails closed unless every new-namespace confirmation is explicit", () => {
    const result = spawnSync(resolve("deploy/restore.sh"), ["--backup", "/tmp/example.age"], {
      encoding: "utf8",
      env: { ...process.env, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--confirm-restore-new-namespace");
  });

  test("a failed release health check invokes rollback and restores the prior atomic symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-operations-"));
    const bin = join(root, "bin");
    const releases = join(root, "releases");
    const shared = join(root, "shared");
    const oldRelease = join(releases, shaA);
    const bundle = join(root, "bundle");
    const log = join(root, "operations.log");
    mkdirSync(bin);
    mkdirSync(oldRelease, { recursive: true });
    mkdirSync(join(oldRelease, "deploy"));
    mkdirSync(shared);
    mkdirSync(join(bundle, "deploy"), { recursive: true });
    writeFileSync(join(shared, ".env.production"), "SITE_ORIGIN=https://quotation.example.test\n");
    writeFileSync(join(oldRelease, "image.digest"), `${digestA}\n`);
    writeFileSync(join(oldRelease, "deploy", "backup.sh"), "#!/bin/sh\nprintf 'backup\\n' >> \"$OPERATIONS_LOG\"\n");
    writeFileSync(join(oldRelease, "deploy", "production-up.sh"), "#!/bin/sh\nprintf 'old-up\\n' >> \"$OPERATIONS_LOG\"\n");
    writeFileSync(join(oldRelease, "deploy", "validate-app-image.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(bundle, "docker-compose.yml"), "services: {}\n");
    for (const name of ["production-up.sh", "backup.sh", "rollback.sh", "validate-app-image.sh"]) {
      writeFileSync(join(bundle, "deploy", name), `#!/bin/sh\nprintf '${name}\\n' >> \"$OPERATIONS_LOG\"\n`);
      chmodSync(join(bundle, "deploy", name), 0o755);
    }
    for (const name of ["backup.sh", "production-up.sh", "validate-app-image.sh"]) chmodSync(join(oldRelease, "deploy", name), 0o755);
    writeFileSync(join(bin, "docker"), `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$OPERATIONS_LOG"
case "$1 $2" in
  "image inspect") printf '%s\\n' "$NEW_DIGEST" ;;
  "cp fake-container:/opt/release-bundle/.") cp -R "$FAKE_BUNDLE"/. "$3" ;;
esac
if [ "$1" = create ]; then printf 'fake-container\\n'; fi
`);
    writeFileSync(join(bin, "curl"), "#!/bin/sh\nprintf 'health-failed\\n' >> \"$OPERATIONS_LOG\"\nexit 22\n");
    writeFileSync(join(bin, "mv"), `#!/bin/sh
if [ "$1" = -T ]; then shift; exec /bin/mv -fh "$@"; fi
exec /bin/mv "$@"
`);
    writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "docker"), 0o755);
    chmodSync(join(bin, "curl"), 0o755);
    chmodSync(join(bin, "mv"), 0o755);
    chmodSync(join(bin, "sleep"), 0o755);
    // This symlink setup is intentionally shell-free so the test itself cannot hide traversal.
    execFileSync("ln", ["-s", oldRelease, join(root, "current")]);

    try {
      const result = spawnSync(resolve("deploy/install-release.sh"), [shaB], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1",
          SALES_QUOTATION_ROOT: root,
          OPERATIONS_LOG: log,
          NEW_DIGEST: digestB,
          FAKE_BUNDLE: bundle,
        },
      });
      expect(result.status).not.toBe(0);
      expect(read(log)).toMatch(/^backup\n/);
      expect(read(log).indexOf("backup\n")).toBeLessThan(read(log).indexOf("docker pull"));
      expect(realpathSync(join(root, "current"))).toBe(realpathSync(oldRelease));
      expect(lstatSync(join(root, "current")).isSymbolicLink()).toBe(true);
      expect(read(log)).toContain("old-up");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

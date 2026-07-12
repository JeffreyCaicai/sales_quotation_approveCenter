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

  test("all state-changing operations share a reentrant host lock", () => {
    for (const path of scripts.slice(1)) {
      expect(read(path)).toContain("acquire_operations_lock");
      expect(read(path)).toContain("operations-common.sh");
    }
    expect(read("deploy/sales-quotation-backup.service")).toContain("operations.lock");
  });

  test("dotenv is parsed as data and never sourced or evaluated", () => {
    for (const path of ["deploy/install-release.sh", "deploy/backup.sh", "deploy/restore.sh"]) {
      expect(read(path)).toContain("dotenv_get");
      expect(read(path)).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+"?\$env_file/m);
      expect(read(path)).not.toContain("eval ");
    }
  });

  test("production-up and every operation validate the shared dotenv contract before mutation", () => {
    for (const path of ["deploy/production-up.sh", "deploy/install-release.sh", "deploy/backup.sh", "deploy/restore.sh", "deploy/rollback.sh"]) {
      expect(read(path)).toContain("validate_env_file");
    }
    const backup = read("deploy/backup.sh");
    expect(backup.indexOf("validate_env_file")).toBeLessThan(backup.indexOf("compose stop web"));
    for (const key of ["APP_IMAGE", "SITE_ORIGIN", "DATABASE_URL", "AUTH_SECRET"]) {
      expect(backup.slice(0, backup.indexOf("compose stop web"))).toContain(key);
    }
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
    expect(read("deploy/provision-lib.sh")).toContain("chpasswd");
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

  test("provisioning repairs locked accounts, subordinate IDs, and the detected SSH firewall port", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toContain("repair_deploy_password");
    expect(provision).toContain("ensure_subid_file /etc/subuid deploy");
    expect(provision).toContain("ensure_subid_file /etc/subgid deploy");
    expect(provision).toContain("detect_sshd_ports");
    expect(provision).toContain("configure_ufw");
    expect(provision).not.toContain("ufw allow OpenSSH");
  });

  test("provisioning creates the systemd-writable backup root for deploy", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toMatch(/install -d -m 0700 -o deploy -g deploy \/opt\/sales-quotation\/backups/);
    expect(read("deploy/sales-quotation-backup.service")).toContain("ReadWritePaths=/opt/sales-quotation/backups");
  });

  test("provisioning installs a root-owned stable launcher and reviewed bootstrap scripts", () => {
    const provision = read("deploy/provision-vps.sh");
    expect(provision).toContain("/opt/sales-quotation/bin/install-release");
    expect(provision).toContain("/opt/sales-quotation/bootstrap/deploy");
    expect(provision).toContain("install-release-launcher.sh");
    expect(provision).toMatch(/-o root -g root/);
    expect(provision).not.toMatch(/cp[^\n]*deploy\/\*/);
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
    expect(backup).toContain("compose stop web");
    expect(backup.indexOf("web_restart_needed=1")).toBeLessThan(backup.indexOf("compose stop web"));
    expect(backup).toContain("production-up.sh");
    expect(backup.lastIndexOf("restart_web_once")).toBeLessThan(backup.indexOf("age --encrypt"));
    expect(backup.lastIndexOf("restart_web_once")).toBeLessThan(backup.indexOf("rclone copyto"));
    expect(backup).toContain("set +e");
    expect(backup).toMatch(/date[^\n]*%N/);
    expect(backup).toContain("rclone deletefile");
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
    expect(restore).toContain("restore-owner-");
    expect(restore).toContain("bucket_owned=1");
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
    expect(read("deploy/sales-quotation-backup.service")).toContain("ReadWritePaths=/opt/sales-quotation/release-lineage");
  });

  test("the environment template documents backup-only names and safe shared readability", () => {
    const example = read("deploy/env.production.example");
    expect(example).toContain("root:deploy");
    expect(example).toContain("0640");
    expect(example).not.toContain("chmod 0600");
    for (const name of [
      "BACKUP_AGE_RECIPIENT", "BACKUP_S3_ENDPOINT",
      "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY",
    ]) expect(example).toMatch(new RegExp(`^${name}=`, "m"));
    expect(example).not.toMatch(/^BACKUP_AGE_IDENTITY_FILE=/m);
    expect(example).toMatch(/^# BACKUP_AGE_IDENTITY_FILE=\/safe\/restore\/identity\.txt$/m);
  });

  test("normal template validates without a recovery identity and restore requires an explicit temporary key", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-normal-env-")); const env = join(root, "env");
    const normal = read("deploy/env.production.example").split("\n").map((line) => {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=$/);
      return match ? `${match[1]}=SafeValue` : line;
    }).join("\n");
    writeFileSync(env, normal);
    const activeKeys = normal.split("\n").flatMap((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1] ?? []);
    try {
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; validate_env_file "$1" "${@:2}"', "bash", env, ...activeKeys]).status).toBe(0);
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; validate_env_file "$1" BACKUP_AGE_IDENTITY_FILE', "bash", env]).status).not.toBe(0);
      writeFileSync(env, `${normal}\nBACKUP_AGE_IDENTITY_FILE=/safe/restore/identity.txt\n`);
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; validate_env_file "$1" BACKUP_AGE_IDENTITY_FILE', "bash", env]).status).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("runbook covers fresh-session SSH safety, rootless operation, Nginx preservation, and migration policy", () => {
    const runbook = read("docs/operations/vps-runbook.md");
    for (const phrase of [
      "keep the original", "fresh SSH session", "sudo -n true", "docker compose",
      "worldcup-lottery", "root password", "expand/migrate/contract", "root:deploy", "0640",
      "new database", "new bucket", "explicit promotion", "off-VPS",
      "maintenance window", "quiesce", "operations lock",
    ]) expect(runbook.toLowerCase()).toContain(phrase.toLowerCase());
    expect(runbook).toContain("/opt/sales-quotation/bin/install-release");
    expect(runbook).toContain("bootstrap-failed");
    expect(runbook.toLowerCase()).toContain("operator");
  });
});

describe("operations scripts behavior", () => {
  test("dotenv reader preserves metacharacters without execution", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-dotenv-"));
    const env = join(root, "env");
    const marker = join(root, "executed");
    writeFileSync(env, `SITE_ORIGIN=https://example.test/$(touch ${marker}) ; literal\n`);
    try {
      const output = execFileSync("bash", ["-c", '. deploy/operations-common.sh; dotenv_get SITE_ORIGIN "$1"; printf "%s" "$DOTENV_VALUE"', "bash", env], { encoding: "utf8" });
      expect(output).toContain("$(touch");
      expect(() => readFileSync(marker)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("dotenv contract accepts representative safe values and rejects parser-sensitive values", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-env-contract-")); const env = join(root, "env");
    try {
      writeFileSync(env, [
        "DATABASE_URL=postgresql://user:hex_secret@postgres:5432/app?sslmode=require&x=1",
        `APP_IMAGE=ghcr.io/org/app@sha256:${"a".repeat(64)}`,
        "SITE_ORIGIN=https://quote.example.com",
        "AUTH_SECRET=Abc_123-xyz",
      ].join("\n") + "\n");
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; validate_env_file "$1" DATABASE_URL APP_IMAGE SITE_ORIGIN AUTH_SECRET', "bash", env]).status).toBe(0);
      const badValues = ["abc$def", "abc`id`", "two words", '"quoted"', "back\\slash", "hash#value", ""];
      const badResult = spawnSync("bash", ["-c", `. deploy/operations-common.sh; file=$1; shift
        for bad in "$@"; do printf 'AUTH_SECRET=%s\\n' "$bad" > "$file"; validate_env_file "$file" AUTH_SECRET >/dev/null 2>&1 && exit 9; done; true
      `, "bash", env, ...badValues], { encoding: "utf8" });
      expect(badResult.status).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("invalid production dotenv fails before Docker is invoked", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-env-before-docker-")); const bin = join(root, "bin"); const env = join(root, "env"); const log = join(root, "docker-log");
    mkdirSync(bin); writeFileSync(join(bin, "docker"), "#!/bin/sh\nprintf called >> \"$DOCKER_LOG\"\n"); chmodSync(join(bin, "docker"), 0o755);
    writeFileSync(env, [
      "APP_IMAGE=ghcr.io/org/app@sha256:" + "a".repeat(64), "SITE_ORIGIN=https://quote.example.com", "POSTGRES_DB=quotation",
      "POSTGRES_USER=postgres", "POSTGRES_PASSWORD=SafeSecret", "DATABASE_URL=postgresql://postgres:SafeSecret@postgres:5432/quotation",
      "MINIO_ROOT_USER=minio", "MINIO_ROOT_PASSWORD=MinioSecret", "S3_ENDPOINT=http://minio:9000", "S3_REGION=us-east-1",
      "S3_ACCESS_KEY_ID=AppKey", "S3_SECRET_ACCESS_KEY=AppSecret", "S3_BUCKET=imports", "AUTH_SECRET=abc$def",
    ].join("\n") + "\n");
    try {
      const result = spawnSync(resolve("deploy/production-up.sh"), [env], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log } });
      expect(result.status).not.toBe(0); expect(() => readFileSync(log)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("backup capture failure restarts exactly once before failing cleanup continues", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-backup-lifecycle-")); const bin = join(root, "bin"); const release = join(root, "releases", shaA); const log = join(root, "log");
    mkdirSync(bin); mkdirSync(join(release, "deploy"), { recursive: true }); mkdirSync(join(root, "shared")); mkdirSync(join(root, "backups"));
    const envLines = {
      APP_IMAGE: `ghcr.io/org/app@sha256:${"a".repeat(64)}`, SITE_ORIGIN: "https://quote.example.com", POSTGRES_PASSWORD: "PgSecret",
      DATABASE_URL: "postgresql://postgres:PgSecret@postgres:5432/quotation", S3_ENDPOINT: "http://minio:9000", S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "AppKey", S3_SECRET_ACCESS_KEY: "AppSecret", AUTH_SECRET: "AuthSecret",
      BACKUP_AGE_RECIPIENT: "age1safe", BACKUP_S3_ENDPOINT: "https://backup.example.com", BACKUP_S3_BUCKET: "backups",
      BACKUP_S3_ACCESS_KEY_ID: "BackupKey", BACKUP_S3_SECRET_ACCESS_KEY: "BackupSecret", S3_BUCKET: "imports",
      MINIO_ROOT_USER: "minio", MINIO_ROOT_PASSWORD: "MinioSecret", POSTGRES_USER: "postgres", POSTGRES_DB: "quotation",
    };
    writeFileSync(join(root, "shared", ".env.production"), Object.entries(envLines).map(([k,v]) => `${k}=${v}`).join("\n") + "\n");
    writeFileSync(join(release, "image.digest"), `ghcr.io/org/app@sha256:${"a".repeat(64)}\n`);
    writeFileSync(join(release, "deploy", "production-up.sh"), "#!/bin/sh\nprintf 'restart\\n' >> \"$OPS_LOG\"\n"); chmodSync(join(release, "deploy", "production-up.sh"), 0o755);
    writeFileSync(join(bin, "docker"), `#!/bin/sh
case " $* " in *" stop web "*) printf 'stop\\n' >> "$OPS_LOG"; exit 0;; *" pg_dump "*) printf 'capture-fail\\n' >> "$OPS_LOG"; exit 9;; esac
exit 0
`);
    writeFileSync(join(bin, "flock"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(bin, "rm"), "#!/bin/sh\nprintf 'cleanup-fail\\n' >> \"$OPS_LOG\"\nexit 7\n");
    for (const name of ["docker", "flock", "rm"]) chmodSync(join(bin, name), 0o755);
    execFileSync("ln", ["-s", release, join(root, "current")]);
    try {
      const result = spawnSync(resolve("deploy/backup.sh"), [], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1", SALES_QUOTATION_ROOT: root, FLOCK_BIN: join(bin, "flock"), OPS_LOG: log } });
      expect(result.status).not.toBe(0);
      expect(read(log).trim().split("\n")).toEqual(["stop", "capture-fail", "restart", "cleanup-fail", "cleanup-fail"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 10_000);

  test("stable launcher uses a valid current installer and rejects a current path escape", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-launcher-"));
    const release = join(root, "releases", shaA); const outside = join(root, "outside");
    mkdirSync(join(root, "bootstrap", "deploy"), { recursive: true });
    mkdirSync(join(release, "deploy"), { recursive: true }); mkdirSync(outside);
    writeFileSync(join(root, "bootstrap", "deploy", "install-release.sh"), "#!/bin/sh\nprintf 'bootstrap:%s:%s' \"$1\" \"$2\"\n");
    writeFileSync(join(release, "deploy", "install-release.sh"), "#!/bin/sh\nprintf 'current:%s:%s' \"$1\" \"$2\"\n");
    writeFileSync(join(outside, "install-release.sh"), "#!/bin/sh\nprintf escaped\n");
    for (const path of [join(root, "bootstrap", "deploy", "install-release.sh"), join(release, "deploy", "install-release.sh"), join(outside, "install-release.sh")]) chmodSync(path, 0o755);
    const env = { ...process.env, SALES_QUOTATION_ROOT: root, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1" };
    try {
      execFileSync("ln", ["-s", release, join(root, "current")]);
      expect(execFileSync(resolve("deploy/install-release-launcher.sh"), ["one", "two"], { encoding: "utf8", env })).toBe("current:one:two");
      rmSync(join(root, "current")); execFileSync("ln", ["-s", outside, join(root, "current")]);
      expect(execFileSync(resolve("deploy/install-release-launcher.sh"), ["one", "two"], { encoding: "utf8", env })).toBe("bootstrap:one:two");
      rmSync(join(root, "bootstrap", "deploy"), { recursive: true }); execFileSync("ln", ["-s", outside, join(root, "bootstrap", "deploy")]);
      const escapedBootstrap = spawnSync(resolve("deploy/install-release-launcher.sh"), ["one", "two"], { encoding: "utf8", env });
      expect(escapedBootstrap.status).not.toBe(0);
      expect(escapedBootstrap.stdout).not.toContain("escaped");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test.each(["startup", "health"])("failed first %s activation removes only its web and current link, then records recovery state", (phase) => {
    const root = mkdtempSync(join(tmpdir(), `quotation-bootstrap-${phase}-`)); const release = join(root, "releases", shaA);
    const marker = join(root, "bootstrap-failed"); const log = join(root, "log");
    mkdirSync(release, { recursive: true }); mkdirSync(join(root, "volumes")); writeFileSync(join(root, "volumes", "preserve"), "data");
    execFileSync("ln", ["-s", release, join(root, "current")]);
    try {
      execFileSync("bash", ["-c", `. deploy/operations-common.sh
        cleanup_web(){ local output=$1 log=\${!#}; [[ $1 == rm ]] && output='rm -f'; printf '%s web\\n' "$output" >> "$log"; }
        record_failed_bootstrap_activation "$1/current" "$2" "$3" "$4" "$5" "$6" cleanup_web "$7"
      `, "bash", root, release, marker, shaA, `ghcr.io/org/app@sha256:${"a".repeat(64)}`, phase, log]);
      expect(() => lstatSync(join(root, "current"))).toThrow();
      expect(read(join(root, "volumes", "preserve"))).toBe("data");
      expect(read(log).trim().split("\n")).toEqual(["stop web", "rm -f web"]);
      expect(read(marker)).toContain(`phase=${phase}`);
      expect(read(marker)).toContain(`release_sha=${shaA}`);
      expect(read(marker)).toContain(`image_digest=ghcr.io/org/app@sha256:${"a".repeat(64)}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bootstrap recovery marker fails closed until an operator clears it", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-bootstrap-marker-")); const marker = join(root, "bootstrap-failed");
    writeFileSync(marker, "recovery=operator-review-required\n");
    try {
      const result = spawnSync("bash", ["-c", '. deploy/operations-common.sh; require_bootstrap_recovery_clear "$1"', "bash", marker], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("operator recovery");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("shared flock serializes callers and permits an inherited nested call", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-lock-"));
    const log = join(root, "log");
    const fakeFlock = join(root, "flock");
    writeFileSync(fakeFlock, `#!/usr/bin/env python3
import fcntl, sys
fcntl.flock(9, fcntl.LOCK_EX)
`);
    chmodSync(fakeFlock, 0o755);
    try {
      execFileSync("bash", ["-c", `
        export SALES_QUOTATION_ROOT="$1" OPERATIONS_LOCK_TIMEOUT_SECONDS=2 FLOCK_BIN="$3"
        ( . deploy/operations-common.sh; acquire_operations_lock; printf 'a1\\n' >> "$2"; bash -c '. deploy/operations-common.sh; acquire_operations_lock; printf "nested\\n" >> "$1"' _ "$2"; sleep 0.15; printf 'a2\\n' >> "$2" ) &
        while ! grep -q '^a1$' "$2" 2>/dev/null; do sleep 0.01; done
        ( . deploy/operations-common.sh; acquire_operations_lock; printf 'b\\n' >> "$2" ) &
        wait
      `, "bash", root, log, fakeFlock], { encoding: "utf8" });
      expect(read(log).trim().split("\n")).toEqual(["a1", "nested", "a2", "b"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("provision helpers repair locked deploy, allocate non-overlapping subids, and apply detected ports", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-provision-"));
    const log = join(root, "log"); const subid = join(root, "subid");
    writeFileSync(subid, "other:100000:65536\ndeploy:100010:100\n");
    try {
      execFileSync("bash", ["-c", `. deploy/provision-lib.sh
        PROVISION_LOG="$1"
        passwd_fake(){ printf 'deploy L 1 0 99999 7 -1\\n'; }
        openssl_fake(){ printf 'unknown-random-value\\n'; }
        chpasswd_fake(){ IFS= read -r line; printf '%s\\n' "\${line%%:*}:set" >> "$PROVISION_LOG"; }
        ufw_fake(){ printf '%s\\n' "$*" >> "$PROVISION_LOG"; }
        ss_fake(){ printf '%s\\n' 'LISTEN 0 128 0.0.0.0:2222 0.0.0.0:* users:(("sshd",pid=1,fd=3))'; }
        PASSWD_BIN=passwd_fake OPENSSL_BIN=openssl_fake CHPASSWD_BIN=chpasswd_fake UFW_BIN=ufw_fake SS_BIN=ss_fake
        repair_deploy_password deploy; ensure_subid_file "$2" deploy; detect_sshd_ports; configure_ufw "\${SSHD_PORTS[@]}" 80 443
      `, "bash", log, subid]);
      expect(read(log)).toContain("deploy:set");
      expect(read(log)).toContain("allow 2222/tcp");
      const deploy = read(subid).trim().split("\n").find((line) => line.startsWith("deploy:"));
      expect(deploy).toBe("deploy:165536:65536");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("lineage retention keeps current and two actual predecessors after rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-lineage-"));
    const shas = ["1", "2", "3", "4"].map((value) => value.repeat(40));
    mkdirSync(join(root, "releases")); mkdirSync(join(root, "shared"));
    try {
      for (const sha of shas) {
        mkdirSync(join(root, "releases", sha));
        execFileSync("bash", ["-c", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"', "bash", root, sha]);
      }
      // Manual rollback records a new switch; sha2, sha4, sha3 are the distinct lineage tail.
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"', "bash", root, shas[1]]);
      const retained = shas.filter((sha) => { try { realpathSync(join(root, "releases", sha)); return true; } catch { return false; } });
      expect(retained).toEqual([shas[1], shas[2], shas[3]]);
      expect(read(join(root, "release-lineage"))).toContain(shas[1]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("image retention prunes only unretained exact application SHA tags and digests", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-image-retention-")); const bin = join(root, "bin"); const log = join(root, "log");
    const repo = "ghcr.io/jeffreycaicai/sales_quotation_approvecenter";
    const shas = ["1", "2", "3", "4"].map((value) => value.repeat(40));
    const digests = ["a", "b", "c", "d"].map((value) => `sha256:${value.repeat(64)}`);
    mkdirSync(bin); mkdirSync(join(root, "releases"));
    for (const index of [1, 2, 3]) { mkdirSync(join(root, "releases", shas[index])); writeFileSync(join(root, "releases", shas[index], "image.digest"), `${repo}@${digests[index]}\n`); }
    writeFileSync(join(bin, "docker"), `#!/bin/sh
if [ "$1 $2" = "image ls" ]; then
  printf '%s\\t%s\\t%s\\n' '${repo}' '${shas[0]}' '<none>'
  printf '%s\\t%s\\t%s\\n' '${repo}' '${shas[1]}' '${digests[1]}'
  printf '%s\\t%s\\t%s\\n' '${repo}' 'latest' '${digests[0]}'
  printf '%s\\t%s\\t%s\\n' 'postgres' '${shas[0]}' '${digests[0]}'
  exit 0
fi
if [ "$1 $2" = "image inspect" ]; then printf '%s@%s\\n' '${repo}' '${digests[0]}'; exit 0; fi
if [ "$1 $2" = "image rm" ]; then printf '%s\\n' "$3" >> "$OPS_LOG"; exit 0; fi
exit 9
`); chmodSync(join(bin, "docker"), 0o755);
    try {
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; DOCKER_BIN="$1" OPS_LOG="$2" prune_application_images "$3" "$4"', "bash", join(bin, "docker"), log, root, repo]);
      expect(read(log).trim().split("\n")).toEqual([`${repo}:${shas[0]}`, `${repo}@${digests[0]}`]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("failed backup cleanup removes only current invocation artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-backup-cleanup-"));
    const current = join(root, "current.tar.age"); const prior = join(root, "prior.tar.age"); const log = join(root, "remote-log");
    for (const path of [current, `${current}.sha256`, prior, `${prior}.verified`]) writeFileSync(path, "x");
    try {
      execFileSync("bash", ["-c", `. deploy/operations-common.sh
        delete_fake(){ printf '%s\\n' "$1" >> "$2"; }
        cleanup_unverified_backup_artifacts "$1" 0 1 remote/current delete_fake "$3"
      `, "bash", current, prior, log]);
      expect(() => readFileSync(current)).toThrow();
      expect(read(prior)).toBe("x");
      expect(read(log)).toContain("remote/current.tar.age");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

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

  test("failure-atomic release switch restores the original service when target activation fails", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-operations-"));
    const releases = join(root, "releases");
    const oldRelease = join(releases, shaA);
    const targetRelease = join(releases, shaB);
    const log = join(root, "operations.log");
    mkdirSync(oldRelease, { recursive: true }); mkdirSync(targetRelease, { recursive: true });
    execFileSync("ln", ["-s", oldRelease, join(root, "current")]);

    try {
      const result = spawnSync("bash", ["-c", `. deploy/operations-common.sh
        TARGET="$3"; activate(){ printf '%s\\n' "$1" >> "$2"; [[ "$1" != "$TARGET" ]]; }
        failure_atomic_release_switch "$1/current" "$3" "$2" activate "$4"
      `, "bash", root, oldRelease, targetRelease, log], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(realpathSync(join(root, "current"))).toBe(realpathSync(oldRelease));
      expect(lstatSync(join(root, "current")).isSymbolicLink()).toBe(true);
      expect(read(log).trim().split("\n")).toEqual([targetRelease, oldRelease]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("failure-atomic switch never activates when the symlink replacement fails", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-switch-failure-")); const log = join(root, "log");
    mkdirSync(join(root, "current")); mkdirSync(join(root, "target")); mkdirSync(join(root, "original"));
    try {
      const result = spawnSync("bash", ["-c", `. deploy/operations-common.sh; activate(){ printf x >> "$2"; }; failure_atomic_release_switch "$1/current" "$1/target" "$1/original" activate "$2"`, "bash", root, log], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(() => readFileSync(log)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("new lineage preserves legacy rollback targets until three recorded switches exist", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-lineage-migration-")); const shas = ["a", "b", "c", "d"].map((v) => v.repeat(40));
    mkdirSync(join(root, "releases")); mkdirSync(join(root, "shared")); for (const sha of shas) mkdirSync(join(root, "releases", sha));
    try {
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"', "bash", root, shas[3]]);
      for (const sha of shas) expect(() => realpathSync(join(root, "releases", sha))).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

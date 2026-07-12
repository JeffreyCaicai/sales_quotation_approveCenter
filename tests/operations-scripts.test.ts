import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const imageDigest = `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:${"c".repeat(64)}`;

const runInstallWithPolicy = (policyAssignments: string) => {
  const root = mkdtempSync(join(tmpdir(), "quotation-install-policy-"));
  const bin = join(root, "bin");
  const state = join(root, "state");
  const previousRelease = join(root, "releases", shaA);
  const envFile = join(root, "shared", ".env.production");
  const eventsFile = join(root, "events");
  const auditFile = join(state, "unprotected-deployments.log");
  const auditObservationFile = join(root, "audit-at-pull");
  mkdirSync(bin);
  mkdirSync(state);
  mkdirSync(join(previousRelease, "deploy"), { recursive: true });
  mkdirSync(join(root, "shared"));
  writeFileSync(envFile, [
    "APP_IMAGE=placeholder",
    "SITE_ORIGIN=https://example.test",
    "POSTGRES_DB=quotation",
    "POSTGRES_USER=quotation",
    "POSTGRES_PASSWORD=secret",
    "DATABASE_URL=postgres://quotation:secret@postgres:5432/quotation",
    "MINIO_ROOT_USER=minio",
    "MINIO_ROOT_PASSWORD=secret",
    "S3_ENDPOINT=http://minio:9000",
    "S3_REGION=us-east-1",
    "S3_ACCESS_KEY_ID=access",
    "S3_SECRET_ACCESS_KEY=secret",
    "S3_BUCKET=quotation",
    "AUTH_SECRET=secret",
    policyAssignments,
  ].join("\n"));
  writeFileSync(join(bin, "flock"), '#!/bin/sh\nprintf "lock\\n" >> "$EVENT_LOG"\n');
  writeFileSync(join(bin, "docker"), `#!/bin/sh
if [ -f "$AUDIT_FILE" ]; then
  printf "audit-present\\n" >> "$EVENT_LOG"
  cp "$AUDIT_FILE" "$AUDIT_OBSERVATION_FILE"
else
  printf "audit-absent\\n" >> "$EVENT_LOG"
fi
printf "pull\\n" >> "$EVENT_LOG"
exit 42
`);
  writeFileSync(join(previousRelease, "deploy", "backup.sh"), '#!/bin/sh\nprintf "backup\\n" >> "$EVENT_LOG"\n');
  chmodSync(join(bin, "flock"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(previousRelease, "deploy", "backup.sh"), 0o755);
  symlinkSync(previousRelease, join(state, "current"));

  const result = spawnSync("bash", ["deploy/install-release.sh", shaB, imageDigest], {
    encoding: "utf8",
    env: {
      ...process.env,
      AUDIT_FILE: auditFile,
      AUDIT_OBSERVATION_FILE: auditObservationFile,
      EVENT_LOG: eventsFile,
      OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1",
      SALES_QUOTATION_ROOT: root,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  return {
    audit: auditFile,
    auditAtPull: existsSync(auditObservationFile) ? read(auditObservationFile) : null,
    events: existsSync(eventsFile) ? read(eventsFile).trim().split("\n") : [],
    result,
    root,
  };
};

describe("operations scripts static safety", () => {
  test("backup policy accepts only an explicit optional or required value", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-backup-policy-"));
    const env = join(root, "env");
    try {
      for (const policy of ["optional", "required"]) {
        writeFileSync(env, `BACKUP_POLICY=${policy}\n`);
        const result = spawnSync("bash", ["-c",
          '. deploy/operations-common.sh; read_backup_policy "$1"; printf "%s" "$BACKUP_POLICY_VALUE"',
          "bash", env], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(policy);
      }
      for (const contents of ["", "BACKUP_POLICY=\n", "BACKUP_POLICY=demo\n", "BACKUP_POLICY=optional\nBACKUP_POLICY=required\n"]) {
        writeFileSync(env, contents);
        expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; read_backup_policy "$1"', "bash", env]).status).not.toBe(0);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("optional policy records the target without calling backup while required runs backup", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-policy-action-"));
    const backup = join(root, "backup.sh");
    const calls = join(root, "calls");
    mkdirSync(join(root, "state"));
    writeFileSync(backup, '#!/bin/sh\nprintf backup >> "$CALLS"\n');
    chmodSync(backup, 0o755);
    try {
      const optional = spawnSync("bash", ["-c",
        '. deploy/operations-common.sh; prepare_predeployment_recovery_point optional "$1" "$2" "$3"',
        "bash", root, shaB, backup], { encoding: "utf8", env: { ...process.env, CALLS: calls } });
      expect(optional.status).toBe(0);
      expect(optional.stderr).toContain("WARNING");
      expect(read(join(root, "state", "unprotected-deployments.log"))).toMatch(
        new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z\\t${shaB}\\tBACKUP_POLICY=optional\\n$`),
      );
      expect(() => readFileSync(calls)).toThrow();

      const required = spawnSync("bash", ["-c",
        '. deploy/operations-common.sh; prepare_predeployment_recovery_point required "$1" "$2" "$3"',
        "bash", root, shaB, backup], { encoding: "utf8", env: { ...process.env, CALLS: calls } });
      expect(required.status).toBe(0);
      expect(read(calls)).toBe("backup");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

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
    expect(read("deploy/sales-quotation-backup.service")).toContain("/opt/sales-quotation/state");
  });

  test("dotenv is parsed as data and never sourced or evaluated", () => {
    for (const path of ["deploy/install-release.sh", "deploy/backup.sh", "deploy/restore.sh"]) {
      expect(read(path)).toContain("dotenv_get");
      expect(read(path)).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+"?\$env_file/m);
      expect(read(path)).not.toContain("eval ");
    }
  });

  test("runtime rotation stays server-side, updates storage policy, and restarts only after atomic credential changes", () => {
    const rotation = read("deploy/rotate-runtime-secrets.sh");
    expect(rotation).toMatch(/^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/m);
    expect(rotation).toContain("must run as root");
    expect(rotation).toContain("openssl rand -hex");
    expect(rotation).toContain("install -o root -g deploy -m 0640");
    expect(rotation).toContain('mv -T -- "$rotated_env" "$env_file"');
    expect(rotation).toContain("ALTER ROLE");
    expect(rotation).toContain("mc admin user add");
    expect(rotation).toContain("mc admin policy create");
    expect(rotation).toContain("mc admin policy attach");
    expect(rotation).toContain("mc version enable");
    expect(rotation).toContain('payload=$(mc cat "$probe")');
    expect(rotation).not.toMatch(/mc cat[^\n]*\|[^\n]*grep/);
    expect(rotation.slice(rotation.indexOf("cleanup()"), rotation.indexOf("trap cleanup EXIT"))).toContain("set +e");
    expect(rotation.slice(rotation.indexOf("run_as_deploy()"), rotation.indexOf("docker_as_deploy()"))).toContain("cd /home/deploy");
    expect(rotation).toContain("127.0.0.1:3000/api/health");
    expect(rotation).not.toContain("set -x");
    expect(rotation).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+.*env_file/m);
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
    const dockerInstall = provision
      .split("\n")
      .find((line) => line.startsWith("apt-get install -y docker-"));
    expect(provision).toContain("download.docker.com/linux/ubuntu");
    expect(dockerInstall?.trim().split(/\s+/)).toContain("docker-ce");
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
    expect(provision).toContain("ensure_deploy_state_directory /opt/sales-quotation deploy deploy root root");
    expect(provision).not.toMatch(/(?:install|mkdir|chown|chmod)[^\n]*\/opt\/sales-quotation\/state\//);
    expect(read("deploy/sales-quotation-backup.service")).toContain("ReadWritePaths=/opt/sales-quotation/state");
    expect(provision).not.toContain("/opt/sales-quotation/.operations.lock");
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
    expect(install).toContain("--recover-bootstrap");
    expect(install).toContain("archive_bootstrap_recovery");
    expect(install.indexOf("archive_bootstrap_recovery")).toBeGreaterThan(install.lastIndexOf("/api/health"));
    expect(install.indexOf("archive_bootstrap_recovery")).toBeLessThan(install.lastIndexOf("trap - ERR"));
  });

  test.each([
    ["missing", ""],
    ["empty", "BACKUP_POLICY="],
    ["duplicate", "BACKUP_POLICY=optional\nBACKUP_POLICY=required"],
    ["invalid", "BACKUP_POLICY=demo"],
  ])("release installation rejects %s backup policy before lock or pull", (_case, policyAssignments) => {
    const harness = runInstallWithPolicy(policyAssignments);
    try {
      expect(harness.result.status).not.toBe(0);
      expect(harness.events).toEqual([]);
    } finally { rmSync(harness.root, { recursive: true, force: true }); }
  });

  test("required backup policy executes backup after lock and before image pull", () => {
    const harness = runInstallWithPolicy("BACKUP_POLICY=required");
    try {
      expect(harness.result.status).toBe(42);
      expect(harness.events).toEqual(["lock", "backup", "audit-absent", "pull"]);
      expect(harness.auditAtPull).toBeNull();
      expect(existsSync(harness.audit)).toBe(false);
    } finally { rmSync(harness.root, { recursive: true, force: true }); }
  });

  test("optional backup policy records an exact warning and audit before image pull", () => {
    const harness = runInstallWithPolicy("BACKUP_POLICY=optional");
    try {
      expect(harness.result.status).toBe(42);
      expect(harness.events).toEqual(["lock", "audit-present", "pull"]);
      expect(harness.result.stderr).toContain("WARNING: off-VPS backup is disabled");
      expect(harness.auditAtPull).toMatch(
        new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z\\t${shaB}\\tBACKUP_POLICY=optional\\n$`),
      );
    } finally { rmSync(harness.root, { recursive: true, force: true }); }
  });

  test("environment and runbooks make demo bypass explicit and production transition mandatory", () => {
    expect(read("deploy/env.production.example")).toMatch(/^BACKUP_POLICY=required$/m);
    const runbook = read("docs/operations/vps-runbook.md");
    const checklist = read("docs/operations/release-checklist.md");
    for (const text of [runbook, checklist]) {
      expect(text).toContain("BACKUP_POLICY=optional");
      expect(text).toContain("BACKUP_POLICY=required");
      expect(text).toContain("unprotected-deployments.log");
    }
  });

  test("release activation keeps the public pointer root-owned and switches only inside deploy state", () => {
    const provision = read("deploy/provision-vps.sh");
    const install = read("deploy/install-release.sh");
    const rollback = read("deploy/rollback.sh");

    expect(provision).toContain("/opt/sales-quotation/current");
    expect(provision).toContain("/opt/sales-quotation/state/current");
    expect(provision).toContain("chown -h root:root");
    expect(install).toContain("current=$state/current");
    expect(install).toContain('next_link=$current.next.$$');
    expect(install).not.toContain('next_link=$root/.current.next.$$');
    expect(rollback).toContain("current=$root/state/current");
    expect(read("deploy/backup.sh")).toContain("current=$root/current");
    expect(read("deploy/restore.sh")).toContain("current=$root/current");
  });

  test("rollback prunes exact application images only after recording successful lineage", () => {
    const rollback = read("deploy/rollback.sh");
    expect(rollback).toContain("ghcr.io/jeffreycaicai/sales_quotation_approvecenter");
    expect(rollback).toContain("prune_application_images");
    expect(rollback.indexOf("prune_application_images")).toBeGreaterThan(rollback.indexOf("record_release_lineage_and_prune"));
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
    expect(runbook).toContain("state/bootstrap-failed");
    expect(runbook).toContain("--recover-bootstrap");
    expect(runbook).not.toContain("remove the marker");
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
    writeFileSync(join(root, "bootstrap", "deploy", "install-release.sh"), "#!/bin/sh\nprintf 'bootstrap:%s' \"$*\"\n");
    writeFileSync(join(release, "deploy", "install-release.sh"), "#!/bin/sh\nprintf 'current:%s' \"$*\"\n");
    writeFileSync(join(outside, "install-release.sh"), "#!/bin/sh\nprintf escaped\n");
    for (const path of [join(root, "bootstrap", "deploy", "install-release.sh"), join(release, "deploy", "install-release.sh"), join(outside, "install-release.sh")]) chmodSync(path, 0o755);
    const env = { ...process.env, SALES_QUOTATION_ROOT: root, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1" };
    const digest = `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:${"a".repeat(64)}`;
    try {
      execFileSync("ln", ["-s", release, join(root, "current")]);
      expect(execFileSync(resolve("deploy/install-release-launcher.sh"), [shaB, digest], { encoding: "utf8", env })).toBe(`current:${shaB} ${digest}`);
      expect(spawnSync(resolve("deploy/install-release-launcher.sh"), ["--recover-bootstrap", shaB, digest], { encoding: "utf8", env }).status).not.toBe(0);
      mkdirSync(join(root, "state")); writeFileSync(join(root, "state", "bootstrap-failed"), `release_sha=${shaA}\nrecovery=operator-review-required\n`);
      expect(spawnSync(resolve("deploy/install-release-launcher.sh"), [shaB, digest], { encoding: "utf8", env }).status).not.toBe(0);
      expect(execFileSync(resolve("deploy/install-release-launcher.sh"), ["--recover-bootstrap", shaB, digest], { encoding: "utf8", env })).toBe(`current:--recover-bootstrap ${shaB} ${digest}`);
      expect(spawnSync(resolve("deploy/install-release-launcher.sh"), ["--recover-bootstrap", shaB], { encoding: "utf8", env }).status).not.toBe(0);
      expect(spawnSync(resolve("deploy/install-release-launcher.sh"), ["--unsafe", shaB, digest], { encoding: "utf8", env }).status).not.toBe(0);
      rmSync(join(root, "state", "bootstrap-failed"));
      rmSync(join(root, "current")); execFileSync("ln", ["-s", outside, join(root, "current")]);
      expect(execFileSync(resolve("deploy/install-release-launcher.sh"), [shaB, digest], { encoding: "utf8", env })).toBe(`bootstrap:${shaB} ${digest}`);
      rmSync(join(root, "bootstrap", "deploy"), { recursive: true }); execFileSync("ln", ["-s", outside, join(root, "bootstrap", "deploy")]);
      const escapedBootstrap = spawnSync(resolve("deploy/install-release-launcher.sh"), [shaB, digest], { encoding: "utf8", env });
      expect(escapedBootstrap.status).not.toBe(0);
      expect(escapedBootstrap.stdout).not.toContain("escaped");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test.each(["startup", "health"])("failed first %s activation removes only its web and current link, then records recovery state", (phase) => {
    const root = mkdtempSync(join(tmpdir(), `quotation-bootstrap-${phase}-`)); const release = join(root, "releases", shaA);
    const marker = join(root, "state", "bootstrap-failed"); const log = join(root, "log");
    mkdirSync(release, { recursive: true }); mkdirSync(join(root, "state")); mkdirSync(join(root, "volumes")); writeFileSync(join(root, "volumes", "preserve"), "data");
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
    const root = mkdtempSync(join(tmpdir(), "quotation-bootstrap-marker-")); const marker = join(root, "state", "bootstrap-failed");
    mkdirSync(join(root, "state"));
    writeFileSync(marker, "recovery=operator-review-required\n");
    try {
      const result = spawnSync("bash", ["-c", '. deploy/operations-common.sh; require_bootstrap_recovery_clear "$1"', "bash", marker], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("operator recovery");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("bootstrap recovery authorization requires the marker and archives it only after explicit completion", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-bootstrap-recovery-")); const state = join(root, "state");
    const marker = join(state, "bootstrap-failed"); const history = join(state, "history");
    mkdirSync(state);
    try {
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; authorize_bootstrap_recovery "$1" 1', "bash", marker], { encoding: "utf8" }).status).not.toBe(0);
      writeFileSync(marker, `release_sha=${shaA}\nrecovery=operator-review-required\n`);
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; authorize_bootstrap_recovery "$1" 0', "bash", marker], { encoding: "utf8" }).status).not.toBe(0);
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; authorize_bootstrap_recovery "$1" 1', "bash", marker], { encoding: "utf8" }).status).toBe(0);
      expect(read(marker)).toContain("operator-review-required");
      execFileSync("bash", ["-c", `. deploy/operations-common.sh
        cleanup_noop(){ :; }
        record_failed_bootstrap_activation "$1/current" "$1/releases/$4" "$2" "$4" "$5" health cleanup_noop
      `, "bash", root, marker, history, shaA, `ghcr.io/org/app@sha256:${"a".repeat(64)}`]);
      expect(read(marker)).toContain("phase=health");
      expect(spawnSync("bash", ["-c", '. deploy/operations-common.sh; authorize_bootstrap_recovery "$1" 1', "bash", marker], { encoding: "utf8" }).status).toBe(0);
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; archive_bootstrap_recovery "$1" "$2" "$3"', "bash", marker, history, shaB]);
      expect(() => readFileSync(marker)).toThrow();
      const archives = execFileSync("find", [history, "-type", "f"], { encoding: "utf8" }).trim().split("\n");
      expect(archives).toHaveLength(1);
      expect(read(archives[0])).toContain("operator-review-required");
      expect(lstatSync(archives[0]).mode & 0o777).toBe(0o400);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("runtime recovery archive rejects state and history symlinks without touching victims", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-runtime-state-link-")); const victimState = join(root, "victim-state");
    const stateLink = join(root, "state"); const marker = join(stateLink, "bootstrap-failed"); const history = join(stateLink, "history");
    mkdirSync(victimState); writeFileSync(join(victimState, "bootstrap-failed"), `release_sha=${shaA}\nrecovery=operator-review-required\n`); chmodSync(join(victimState, "bootstrap-failed"), 0o600);
    execFileSync("ln", ["-s", victimState, stateLink]); const markerBefore = lstatSync(join(victimState, "bootstrap-failed"));
    try {
      const stateResult = spawnSync("bash", ["-c", '. deploy/operations-common.sh; archive_bootstrap_recovery "$1" "$2" "$3"', "bash", marker, history, shaB], { encoding: "utf8" });
      expect(stateResult.status).not.toBe(0); expect(() => lstatSync(join(victimState, "history"))).toThrow();
      expect(lstatSync(join(victimState, "bootstrap-failed")).mode & 0o777).toBe(markerBefore.mode & 0o777);

      rmSync(stateLink); mkdirSync(stateLink); writeFileSync(marker, `release_sha=${shaA}\nrecovery=operator-review-required\n`);
      const victimHistory = join(root, "victim-history"); mkdirSync(victimHistory); chmodSync(victimHistory, 0o711); execFileSync("ln", ["-s", victimHistory, history]); const historyBefore = lstatSync(victimHistory);
      const historyResult = spawnSync("bash", ["-c", '. deploy/operations-common.sh; archive_bootstrap_recovery "$1" "$2" "$3"', "bash", marker, history, shaB], { encoding: "utf8" });
      expect(historyResult.status).not.toBe(0); expect(read(marker)).toContain("operator-review-required");
      expect(lstatSync(victimHistory).mode & 0o777).toBe(historyBefore.mode & 0o777);
      expect(execFileSync("find", [victimHistory, "-mindepth", "1"], { encoding: "utf8" })).toBe("");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("marker write errors never short-circuit failed web and current cleanup", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-bootstrap-marker-error-")); const release = join(root, "releases", shaA);
    const blocked = join(root, "blocked"); const log = join(root, "log");
    mkdirSync(release, { recursive: true }); mkdirSync(blocked); chmodSync(blocked, 0o555); execFileSync("ln", ["-s", release, join(root, "current")]);
    try {
      const result = spawnSync("bash", ["-c", `. deploy/operations-common.sh
        cleanup_web(){ local output=$1 log=\${!#}; [[ $1 == rm ]] && output='rm -f'; printf '%s web\\n' "$output" >> "$log"; }
        record_failed_bootstrap_activation "$1/current" "$2" "$1/blocked/bootstrap-failed" "$3" "$4" startup cleanup_web "$5"
      `, "bash", root, release, shaA, `ghcr.io/org/app@sha256:${"a".repeat(64)}`, log], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(read(log).trim().split("\n")).toEqual(["stop web", "rm -f web"]);
      expect(() => lstatSync(join(root, "current"))).toThrow();
    } finally { chmodSync(blocked, 0o755); rmSync(root, { recursive: true, force: true }); }
  });

  test("deploy-owned state remains writable when the installation root is not", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-state-ownership-")); const state = join(root, "state"); const fakeFlock = join(state, "flock");
    mkdirSync(state); writeFileSync(fakeFlock, "#!/bin/sh\nexit 0\n"); chmodSync(fakeFlock, 0o755); chmodSync(state, 0o750); chmodSync(root, 0o555);
    try {
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; SALES_QUOTATION_ROOT="$1" FLOCK_BIN="$2" acquire_operations_lock', "bash", root, fakeFlock]);
      expect(lstatSync(join(state, "operations.lock")).isFile()).toBe(true);
    } finally { chmodSync(root, 0o755); rmSync(root, { recursive: true, force: true }); }
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

  test("state provisioning is idempotent and never follows deploy-controlled history", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-provision-state-")); const state = join(root, "state");
    const victim = join(root, "victim"); const history = join(state, "history");
    const owner = execFileSync("id", ["-un"], { encoding: "utf8" }).trim(); const group = execFileSync("id", ["-gn"], { encoding: "utf8" }).trim();
    mkdirSync(victim); chmodSync(victim, 0o711); writeFileSync(join(victim, "sentinel"), "untouched"); const before = lstatSync(victim);
    try {
      execFileSync("bash", ["-c", '. deploy/provision-lib.sh; ensure_deploy_state_directory "$1" "$2" "$3" "$2" "$3"', "bash", root, owner, group]);
      execFileSync("ln", ["-s", victim, history]);
      execFileSync("bash", ["-c", '. deploy/provision-lib.sh; ensure_deploy_state_directory "$1" "$2" "$3" "$2" "$3"', "bash", root, owner, group]);
      const after = lstatSync(victim);
      expect(after.mode & 0o777).toBe(before.mode & 0o777); expect(after.uid).toBe(before.uid); expect(after.gid).toBe(before.gid);
      expect(read(join(victim, "sentinel"))).toBe("untouched"); expect(lstatSync(history).isSymbolicLink()).toBe(true);
      expect(lstatSync(state).mode & 0o777).toBe(0o750);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("state provisioning fails closed when the protected state entry is a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-provision-state-link-")); const victim = join(root, "victim");
    const owner = execFileSync("id", ["-un"], { encoding: "utf8" }).trim(); const group = execFileSync("id", ["-gn"], { encoding: "utf8" }).trim();
    mkdirSync(victim); chmodSync(victim, 0o711); execFileSync("ln", ["-s", victim, join(root, "state")]); const before = lstatSync(victim);
    try {
      const result = spawnSync("bash", ["-c", '. deploy/provision-lib.sh; ensure_deploy_state_directory "$1" "$2" "$3" "$2" "$3"', "bash", root, owner, group], { encoding: "utf8" });
      expect(result.status).not.toBe(0); expect(result.stderr).toContain("state");
      const after = lstatSync(victim); expect(after.mode & 0o777).toBe(before.mode & 0o777); expect(after.uid).toBe(before.uid); expect(after.gid).toBe(before.gid);
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

  test("lineage recording supports an empty retention set under nounset", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-lineage-nounset-"));
    const sha = "a".repeat(40);
    mkdirSync(join(root, "releases"));
    mkdirSync(join(root, "releases", sha));
    try {
      execFileSync("bash", ["-uc", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"', "bash", root, sha]);
      expect(read(join(root, "release-lineage"))).toBe(`${sha}\n`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rollback lineage prunes only unretained exact application SHA tags and digests", () => {
    const root = mkdtempSync(join(tmpdir(), "quotation-image-retention-")); const bin = join(root, "bin"); const log = join(root, "log");
    const repo = "ghcr.io/jeffreycaicai/sales_quotation_approvecenter";
    const shas = ["1", "2", "3", "4"].map((value) => value.repeat(40));
    const digests = ["a", "b", "c", "d"].map((value) => `sha256:${value.repeat(64)}`);
    mkdirSync(bin); mkdirSync(join(root, "releases"));
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
      for (const [index, sha] of shas.entries()) {
        mkdirSync(join(root, "releases", sha)); writeFileSync(join(root, "releases", sha, "image.digest"), `${repo}@${digests[index]}\n`);
        execFileSync("bash", ["-c", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"', "bash", root, sha]);
      }
      execFileSync("bash", ["-c", '. deploy/operations-common.sh; record_release_lineage_and_prune "$1" "$2"; DOCKER_BIN="$3" OPS_LOG="$4" prune_application_images "$1" "$5"', "bash", root, shas[1], join(bin, "docker"), log, repo]);
      expect(read(log).trim().split("\n")).toEqual([`${repo}:${shas[0]}`, `${repo}@${digests[0]}`]);
      for (const index of [1, 2, 3]) expect(() => readFileSync(join(root, "releases", shas[index], "image.digest"))).not.toThrow();
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

# Demo CI/CD Backup Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the internal demo to complete GitHub-to-VPS automatic deployment without off-VPS backups while keeping the bypass explicit, audited, reversible, and fail-closed outside the declared demo policy.

**Architecture:** Parse `BACKUP_POLICY` from the root-owned VPS dotenv file through the existing non-evaluating parser. A focused operations helper either runs the existing strict backup or writes an immutable-style warning record before deployment proceeds. The first optional-aware release is installed once with the CI-approved digest; a second push then proves the normal Production Delivery path is fully automatic.

**Tech Stack:** Bash 5, Vitest, GitHub Actions, rootless Docker Compose, GHCR, Nginx, PostgreSQL, MinIO, SSH.

## Global Constraints

- Accepted policy values are exactly `optional` and `required`.
- Missing, empty, duplicated, or invalid `BACKUP_POLICY` fails before Docker or release mutation.
- `optional` must emit a warning and append the UTC timestamp and target release SHA to `/opt/sales-quotation/state/unprotected-deployments.log` before image pull.
- `required` must preserve the existing verified off-VPS backup gate.
- Backup, restore, database, MinIO, quotation UI, TLS, Nginx routing, the hosted Sites demo, and the existing `worldcup-lottery` workload remain unchanged.
- Never log or commit environment values, credentials, private keys, or age identities.
- Never add, delete, stage, or modify the untracked `exports/` directory.

---

### Task 1: Add a Tested Backup Policy Boundary

**Files:**
- Modify: `tests/operations-scripts.test.ts`
- Modify: `deploy/operations-common.sh`

**Interfaces:**
- Produces: `read_backup_policy ENV_FILE`, setting `BACKUP_POLICY_VALUE` to `optional` or `required`.
- Produces: `prepare_predeployment_recovery_point POLICY ROOT RELEASE_SHA BACKUP_SCRIPT`.
- Consumes: existing `dotenv_get`, the caller-held operations lock, a regular backup executable, and a writable `ROOT/state` directory.

- [ ] **Step 1: Write failing behavior tests**

Add tests that execute the real shell helpers:

```ts
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
    expect(read(join(root, "state", "unprotected-deployments.log"))).toContain(shaB);
    expect(() => readFileSync(calls)).toThrow();

    const required = spawnSync("bash", ["-c",
      '. deploy/operations-common.sh; prepare_predeployment_recovery_point required "$1" "$2" "$3"',
      "bash", root, shaB, backup], { encoding: "utf8", env: { ...process.env, CALLS: calls } });
    expect(required.status).toBe(0);
    expect(read(calls)).toBe("backup");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/operations-scripts.test.ts
```

Expected: FAIL because `read_backup_policy` and `prepare_predeployment_recovery_point` do not exist.

- [ ] **Step 3: Implement the minimal helpers**

Add to `deploy/operations-common.sh`:

```bash
read_backup_policy() {
  local file=$1
  validate_env_file "$file" BACKUP_POLICY || return 1
  dotenv_get BACKUP_POLICY "$file" || return 1
  case $DOTENV_VALUE in
    optional|required) BACKUP_POLICY_VALUE=$DOTENV_VALUE ;;
    *) echo "BACKUP_POLICY must be optional or required" >&2; return 1 ;;
  esac
}

prepare_predeployment_recovery_point() {
  local policy=$1 root=$2 sha=$3 backup_script=$4 audit timestamp
  [[ $root = /* && $sha =~ ^[0-9a-f]{40}$ && -x $backup_script ]] \
    || { echo "invalid pre-deployment recovery-point request" >&2; return 1; }
  case $policy in
    required) "$backup_script" ;;
    optional)
      audit=$root/state/unprotected-deployments.log
      [[ -d $root/state && ! -L $audit ]] \
        || { echo "unprotected deployment audit path is unsafe" >&2; return 1; }
      if [[ ! -e $audit ]]; then (umask 077; : > "$audit") || return 1; fi
      [[ -f $audit && ! -L $audit ]] \
        || { echo "unprotected deployment audit file is unsafe" >&2; return 1; }
      timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ) || return 1
      printf 'WARNING: off-VPS backup is disabled for this internal demo deployment. Set BACKUP_POLICY=required before importing real business data.\n' >&2
      printf '%s\t%s\tBACKUP_POLICY=optional\n' "$timestamp" "$sha" >> "$audit"
      ;;
    *) echo "invalid backup policy" >&2; return 1 ;;
  esac
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/operations-scripts.test.ts
bash -n deploy/operations-common.sh
```

Expected: all operations tests pass and Bash syntax is valid.

- [ ] **Step 5: Commit the policy boundary**

```bash
git add deploy/operations-common.sh tests/operations-scripts.test.ts
git commit -m "feat: add audited demo backup policy"
```

---

### Task 2: Wire the Policy into Release Installation and Documentation

**Files:**
- Modify: `tests/operations-scripts.test.ts`
- Modify: `deploy/install-release.sh`
- Modify: `deploy/env.production.example`
- Modify: `docs/operations/vps-runbook.md`
- Modify: `docs/operations/release-checklist.md`

**Interfaces:**
- Consumes: `read_backup_policy` and `prepare_predeployment_recovery_point` from Task 1.
- Produces: an installer that validates policy before acquiring the operations lock and applies it before `docker pull`.

- [ ] **Step 1: Add failing installer and documentation assertions**

Extend `tests/operations-scripts.test.ts`:

```ts
test("release installation validates and applies backup policy before image pull", () => {
  const install = read("deploy/install-release.sh");
  expect(install).toContain('read_backup_policy "$env_file"');
  expect(install).toContain('prepare_predeployment_recovery_point "$BACKUP_POLICY_VALUE"');
  expect(install.indexOf('read_backup_policy "$env_file"')).toBeLessThan(install.indexOf("acquire_operations_lock"));
  expect(install.indexOf("acquire_operations_lock")).toBeLessThan(install.indexOf("prepare_predeployment_recovery_point"));
  expect(install.indexOf("prepare_predeployment_recovery_point")).toBeLessThan(install.indexOf('docker pull "$tagged_image"'));
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
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/operations-scripts.test.ts
```

Expected: FAIL because the installer, template, and runbooks do not contain the policy contract.

- [ ] **Step 3: Wire the installer**

In `deploy/install-release.sh`, immediately after the existing application dotenv validation and before `acquire_operations_lock`, add:

```bash
read_backup_policy "$env_file"
```

Replace the direct existing-release backup call with:

```bash
if [[ -n $previous_release ]]; then
  prepare_predeployment_recovery_point "$BACKUP_POLICY_VALUE" "$root" "$sha" \
    "$previous_release/deploy/backup.sh"
```

Keep the bootstrap/stateful-volume branches unchanged.

- [ ] **Step 4: Document the exact operating contract**

Add `BACKUP_POLICY=required` to `deploy/env.production.example`. Update the runbook and release checklist to state:

```text
Internal demo only: BACKUP_POLICY=optional permits audited deployments without an off-VPS backup. Every bypass is recorded in state/unprotected-deployments.log. Before importing real business data, configure and verify off-VPS backup, perform a restore drill, set BACKUP_POLICY=required, and re-enable the backup timer.
```

Document that a missing or invalid policy blocks deployment.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/operations-scripts.test.ts
bash -n deploy/install-release.sh deploy/operations-common.sh
git diff --check
```

Expected: all focused tests pass, shell syntax passes, and no whitespace errors exist.

- [ ] **Step 6: Commit installer wiring and documentation**

```bash
git add deploy/install-release.sh deploy/env.production.example docs/operations/vps-runbook.md docs/operations/release-checklist.md tests/operations-scripts.test.ts
git commit -m "feat: allow audited demo deployments without backup"
```

---

### Task 3: Run the Complete Local and GitHub Quality Gates

**Files:**
- No production file changes expected.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: one pushed commit set with a published CI-approved digest and release manifest.

- [ ] **Step 1: Run all local verification**

Run:

```bash
npm run test:unit
npm run test:logic
npm run test:localization
npm run lint
npm run build
git diff --check
git status --short
```

Expected: every command passes; only intentional tracked changes are committed; `exports/` remains untracked.

- [ ] **Step 2: Push `main`**

```bash
git push origin main
```

Expected: the design and implementation commits appear on GitHub.

- [ ] **Step 3: Wait for CI and record the immutable result**

Run:

```bash
HEAD_SHA=$(git rev-parse HEAD)
CI_RUN_ID=$(gh run list --repo JeffreyCaicai/sales_quotation_approveCenter --branch main --limit 10 \
  --json databaseId,headSha,name \
  --jq ".[] | select(.name == \"CI\" and .headSha == \"$HEAD_SHA\") | .databaseId" | head -n 1)
[[ $CI_RUN_ID =~ ^[0-9]+$ ]]
gh run watch "$CI_RUN_ID" --repo JeffreyCaicai/sales_quotation_approveCenter --exit-status
MANIFEST_DIR=$(mktemp -d)
gh run download "$CI_RUN_ID" --repo JeffreyCaicai/sales_quotation_approveCenter \
  --name "release-manifest-$HEAD_SHA-$CI_RUN_ID" --dir "$MANIFEST_DIR"
validated=$(scripts/validate-release-manifest.sh "$MANIFEST_DIR/release.manifest" "$HEAD_SHA" "$CI_RUN_ID")
FULL_RELEASE_SHA=$(printf '%s\n' "$validated" | sed -n 's/^release_sha=//p')
CANONICAL_GHCR_DIGEST=$(printf '%s\n' "$validated" | sed -n 's/^app_image=//p')
```

Expected: quality, integration, container, browser smoke, committed-secret scan, ShellCheck, and image publication all pass. `FULL_RELEASE_SHA` is a full lowercase SHA and `CANONICAL_GHCR_DIGEST` is the validated `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:` identity from the run-bound manifest.

- [ ] **Step 4: Confirm the expected one-time delivery block**

Inspect the triggered Production Delivery run.

Expected: the old active installer still fails at the existing backup gate. No release pointer changes and the public health endpoint remains HTTP 200.

---

### Task 4: Perform the Controlled First Optional-Aware Deployment

**Files:**
- VPS: `/opt/sales-quotation/shared/.env.production`
- Temporary VPS staging: `/home/deploy/sales-quotation-policy-bootstrap-$FULL_RELEASE_SHA/`
- No repository changes.

**Interfaces:**
- Consumes: CI-approved release SHA and canonical digest from Task 3.
- Produces: the first active release whose installer understands `BACKUP_POLICY`.

- [ ] **Step 1: Add the policy through a root-only, atomic environment update**

Run this exact script through the existing `jeffrey-admin` session. It prints no secret values, rejects duplicates, replaces an existing single policy line when present, and atomically installs the result:

```bash
set -Eeuo pipefail
env_file=/opt/sales-quotation/shared/.env.production
[[ -f $env_file && ! -L $env_file ]]
count=$(sudo grep -c '^BACKUP_POLICY=' "$env_file" || true)
((count <= 1)) || { echo "duplicate BACKUP_POLICY" >&2; exit 1; }
umask 077
temporary=$(mktemp)
trap 'rm -f -- "$temporary"' EXIT
sudo awk '!/^BACKUP_POLICY=/' "$env_file" > "$temporary"
printf 'BACKUP_POLICY=optional\n' >> "$temporary"
sudo install -o root -g deploy -m 0640 "$temporary" "$env_file.next"
sudo mv -T "$env_file.next" "$env_file"
trap - EXIT
rm -f -- "$temporary"
```

Verify only metadata plus the policy value:

```bash
sudo stat -c '%U:%G:%a' /opt/sales-quotation/shared/.env.production
sudo grep -x 'BACKUP_POLICY=optional' /opt/sales-quotation/shared/.env.production
```

Expected: `root:deploy:640` and exactly one `BACKUP_POLICY=optional` line. Do not print any other environment line.

- [ ] **Step 2: Upload the reviewed deploy scripts to a fresh deploy-owned staging directory**

Set `FULL_RELEASE_SHA` to the exact CI manifest SHA, create `/home/deploy/sales-quotation-policy-bootstrap-$FULL_RELEASE_SHA`, and use `scp` with the deploy key to copy the repository `deploy/` directory there. Verify SHA-256 checksums of at least `install-release.sh` and `operations-common.sh` against the local committed files.

Run from the local repository:

```bash
STAGING="/home/deploy/sales-quotation-policy-bootstrap-$FULL_RELEASE_SHA"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/sales-quotation-deploy \
  deploy@38.76.162.91 "test ! -e '$STAGING' && install -d -m 0700 '$STAGING'"
scp -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/sales-quotation-deploy -r \
  deploy deploy@38.76.162.91:"$STAGING/"
LOCAL_INSTALL_SHA=$(shasum -a 256 deploy/install-release.sh | awk '{print $1}')
LOCAL_COMMON_SHA=$(shasum -a 256 deploy/operations-common.sh | awk '{print $1}')
REMOTE_INSTALL_SHA=$(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/sales-quotation-deploy \
  deploy@38.76.162.91 "sha256sum '$STAGING/deploy/install-release.sh'" | awk '{print $1}')
REMOTE_COMMON_SHA=$(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/sales-quotation-deploy \
  deploy@38.76.162.91 "sha256sum '$STAGING/deploy/operations-common.sh'" | awk '{print $1}')
[[ $LOCAL_INSTALL_SHA == "$REMOTE_INSTALL_SHA" && $LOCAL_COMMON_SHA == "$REMOTE_COMMON_SHA" ]]
```

Expected: exact checksum matches; the existing release directory and stable launcher are unchanged.

- [ ] **Step 3: Run the staged installer once with the CI-approved identity**

Over the deploy SSH key, run:

```bash
"/home/deploy/sales-quotation-policy-bootstrap-$FULL_RELEASE_SHA/deploy/install-release.sh" \
  "$FULL_RELEASE_SHA" \
  "$CANONICAL_GHCR_DIGEST"
```

Expected: the installer emits the demo backup warning, appends the SHA to `state/unprotected-deployments.log`, pulls exactly the approved digest, migrates, switches atomically, and finishes with healthy loopback and public checks.

- [ ] **Step 4: Verify the controlled transition**

Verify without printing secrets:

```bash
readlink -f /opt/sales-quotation/current
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://quotation.38-76-162-91.sslip.io/api/health
tail -n 1 /opt/sales-quotation/state/unprotected-deployments.log
```

Expected: current ends in the Task 3 SHA, both health checks return `200`, and the audit line contains that SHA. Rootless container inspection confirms only web binds `127.0.0.1:3000`; PostgreSQL and MinIO have no host bindings. The original IP route still returns the World Cup application response.

---

### Task 5: Prove the Next Deployment Is Fully Automatic

**Files:**
- Create: `docs/operations/demo-cicd-validation.md`

**Interfaces:**
- Consumes: the active optional-aware release from Task 4.
- Produces: evidence that an ordinary trusted `main` push completes CI and Production Delivery without manual VPS commands.

- [ ] **Step 1: Write the validation record**

Create `docs/operations/demo-cicd-validation.md` containing the date, first-transition SHA, public URL, the fact that the timer remains disabled, and the promotion requirements. Do not include credentials, host keys, private IPs, or environment values.

- [ ] **Step 2: Commit and push the harmless documentation change**

```bash
git add docs/operations/demo-cicd-validation.md
git commit -m "docs: record demo cicd validation"
git push origin main
```

Expected: this is the only new change and it triggers normal CI and Production Delivery.

- [ ] **Step 3: Watch both workflows without running VPS mutation commands**

```bash
PROOF_SHA=$(git rev-parse HEAD)
CI_RUN_ID=$(gh run list --repo JeffreyCaicai/sales_quotation_approveCenter --branch main --limit 10 \
  --json databaseId,headSha,name \
  --jq ".[] | select(.name == \"CI\" and .headSha == \"$PROOF_SHA\") | .databaseId" | head -n 1)
[[ $CI_RUN_ID =~ ^[0-9]+$ ]]
gh run watch "$CI_RUN_ID" --repo JeffreyCaicai/sales_quotation_approveCenter --exit-status
for attempt in {1..30}; do
  DELIVERY_RUN_ID=$(gh run list --repo JeffreyCaicai/sales_quotation_approveCenter --branch main --limit 10 \
    --json databaseId,headSha,name \
    --jq ".[] | select(.name == \"Production Delivery\" and .headSha == \"$PROOF_SHA\") | .databaseId" | head -n 1)
  [[ $DELIVERY_RUN_ID =~ ^[0-9]+$ ]] && break
  ((attempt < 30)) || exit 1
  sleep 2
done
gh run watch "$DELIVERY_RUN_ID" --repo JeffreyCaicai/sales_quotation_approveCenter --exit-status
```

Expected: CI and Production Delivery both conclude `success`. The Production Delivery log contains the optional-backup warning and no secret values.

- [ ] **Step 4: Perform final read-only production verification**

Verify the new current SHA, public and loopback health, container isolation, environment file metadata, TLS, HTTP-to-HTTPS redirect, and the existing World Cup route.

Expected: the second SHA is active, health returns `200`, only web binds loopback port 3000, `.env.production` remains `root:deploy:640`, and the other application remains available. GitHub's successful CI and Production Delivery runs are the immutable non-secret evidence for this proof commit.

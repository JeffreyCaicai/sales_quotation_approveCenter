import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const { load: loadYaml } = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => unknown;
};

interface WorkflowJob {
  needs?: string[];
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  steps: Array<{ run?: string; uses?: string; if?: string; with?: Record<string, unknown> }>;
}

interface Workflow {
  on: {
    pull_request?: unknown;
    push?: { branches: string[] };
    workflow_run?: { workflows: string[]; types: string[]; branches: string[] };
    workflow_dispatch?: { inputs: { rollback_sha: { required: boolean } } };
  };
  permissions?: Record<string, string>;
  concurrency?: Record<string, string | boolean>;
  jobs: Record<string, WorkflowJob>;
}

const workflow = (path: string) => loadYaml(read(path)) as Workflow;
const actionReferences = (source: string) => [...source.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
const secretReferences = (source: string) => [...source.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]);

describe("continuous integration workflow", () => {
  test("runs on pull requests and main pushes with read-only repository access", () => {
    const ci = workflow(".github/workflows/ci.yml");
    expect(ci.on.pull_request).toBeDefined();
    expect(ci.on.push?.branches).toEqual(["main"]);
    expect(ci.permissions).toEqual({ contents: "read" });
  });

  test("uses Node 22, npm ci, and every exact local quality gate", () => {
    const source = read(".github/workflows/ci.yml");
    expect(source).toContain("node-version: 22");
    expect(source.match(/npm ci/g)?.length).toBeGreaterThanOrEqual(3);
    for (const command of [
      "npm run test:logic",
      "npm run test:localization",
      "npm run test:unit",
      "npm run lint",
      "npm run build",
      "npm run check:committed-secrets",
      "shellcheck --severity=warning deploy/*.sh scripts/*.sh",
    ]) expect(source).toContain(command);
  });

  test("gates native PostgreSQL tests on all migrations with Postgres and MinIO healthy", () => {
    const ci = workflow(".github/workflows/ci.yml");
    const integration = ci.jobs.integration;
    expect(integration.needs).toContain("quality");
    const commands = integration.steps.map((step: { run?: string }) => step.run ?? "").join("\n");
    expect(commands).toContain("docker compose -f docker-compose.test.yml up -d --wait postgres minio");
    expect(commands.indexOf("npm run db:migrate")).toBeLessThan(commands.indexOf("npm run test:integration"));
    expect(commands).toContain("npm run test:minio");
    expect(commands).toContain("npm run test:integration");
    expect(read("package.json")).toContain('"test:integration"');
    expect(read("package.json")).toContain('"test:minio"');
    expect(read("docker-compose.test.yml")).toContain("/minio/health/live");
    expect(read("docker-compose.test.yml")).toContain('"59000:9000"');
    expect(read("docker-compose.yml")).not.toContain("59000:9000");
  });

  test("builds the production Docker image and runs a focused production browser smoke", () => {
    const ci = workflow(".github/workflows/ci.yml");
    expect(ci.jobs.container.needs).toContain("quality");
    expect(ci.jobs.browser_smoke.needs).toContain("quality");
    const source = read(".github/workflows/ci.yml");
    expect(source).toMatch(/docker build[^\n]*Dockerfile/);
    expect(source).toContain("npm run test:e2e");
    expect(read("package.json")).toMatch(/"@playwright\/test":\s*"\d+\.\d+\.\d+"/);
    const smoke = read("tests/smoke.spec.ts");
    expect(smoke).toContain("/api/health");
    expect(smoke).toContain("Quotation Approval Center");
    expect(smoke).toContain("Choose a demo role");
  });

  test("builds once, uploads that image, and promotes the exact artifact only after every gate", () => {
    const ci = workflow(".github/workflows/ci.yml");
    const source = read(".github/workflows/ci.yml");
    expect(source.match(/docker build/g)).toHaveLength(1);
    expect(source).toContain("docker save");
    expect(source).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(source).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(ci.jobs.publish_image.needs).toEqual(["quality", "integration", "container", "browser_smoke"]);
    expect(ci.jobs.publish_image.if).toContain("github.event_name == 'push'");
    expect(ci.jobs.publish_image.if).toContain("github.ref == 'refs/heads/main'");
    expect(ci.jobs.publish_image.permissions).toEqual({ contents: "read", packages: "write" });
    const upload = ci.jobs.container.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toContain("github.event_name == 'push'");
    expect(upload?.if).toContain("github.ref == 'refs/heads/main'");
    const promotion = ci.jobs.publish_image.steps.map((step) => `${step.uses ?? ""}\n${step.run ?? ""}`).join("\n");
    expect(promotion).toContain("docker load");
    expect(promotion).toContain("docker push");
    expect(promotion).not.toContain("docker build");
    expect(promotion).toContain('docker push "$tagged_image" 2>&1 | tee "$push_log"');
    expect(promotion).toContain("extract-pushed-image-digest.sh");
    const afterPush = promotion.slice(promotion.indexOf('docker push "$tagged_image"'));
    expect(afterPush).not.toContain("docker pull");
    expect(afterPush).not.toContain("docker image inspect");
    expect(promotion).toContain("RELEASE_SHA %s\\nAPP_IMAGE %s\\nGITHUB_RUN_ID %s\\n");
    expect(source).toContain("release-manifest-${{ github.sha }}-${{ github.run_id }}");
  });

  test("pins every referenced action to an immutable full commit SHA", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/deploy-production.yml"]) {
      const references = actionReferences(read(path));
      for (const reference of references) expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });
});

describe("production delivery workflow", () => {
  test("deploys only after a successful trusted main push CI run", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.on.workflow_run).toEqual({ workflows: ["CI"], types: ["completed"], branches: ["main"] });
    const publishIf = delivery.jobs.resolve_image.if;
    expect(publishIf).toContain("workflow_run.conclusion == 'success'");
    expect(publishIf).toContain("workflow_run.event == 'push'");
    expect(publishIf).toContain("workflow_run.head_branch == 'main'");
    expect(delivery.jobs.deploy.needs).toEqual(["resolve_image"]);
  });

  test("serializes production changes without cancelling an active release", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.concurrency).toEqual({ group: "production", "cancel-in-progress": false });
    expect(delivery.jobs.deploy.environment).toBe("production");
    expect(delivery.jobs.rollback.environment).toBe("production");
  });

  test("grants package write only to publication and no GitHub token access to SSH jobs", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.permissions).toEqual({});
    expect(delivery.jobs.resolve_image.permissions).toEqual({ actions: "read", contents: "read", packages: "read" });
    expect(delivery.jobs.deploy.permissions).toEqual({});
    expect(delivery.jobs.rollback.permissions).toEqual({});
    expect([...new Set(secretReferences(read(".github/workflows/ci.yml")))]).toEqual(["GITHUB_TOKEN"]);
  });

  test("downloads the triggering run manifest and pulls its exact digest without consulting the SHA tag", () => {
    const delivery = read(".github/workflows/deploy-production.yml");
    expect(delivery).toContain("sales_quotation_approvecenter@sha256");
    expect(delivery).toContain("workflow_run.head_sha");
    expect(delivery).toContain("docker pull");
    expect(delivery).not.toContain("docker build");
    expect(delivery).not.toContain("docker push");
    expect(delivery).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(delivery).toContain("release-manifest-${{ github.event.workflow_run.head_sha }}-${{ github.event.workflow_run.id }}");
    expect(delivery).toContain("run-id: ${{ github.event.workflow_run.id }}");
    expect(delivery).toContain("github-token: ${{ secrets.GITHUB_TOKEN }}");
    expect(delivery).toContain('docker pull "$APP_IMAGE"');
    expect(delivery).not.toContain('IMAGE_REPOSITORY:$RELEASE_SHA');
    expect(delivery).not.toContain("tagged_image");
    expect(delivery).toContain("scripts/validate-release-manifest.sh");
    expect(delivery).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(delivery).toContain("persist-credentials: false");
    expect(delivery).not.toContain("mapfile -t manifest_lines");
    expect(delivery).not.toContain("invalid_manifest()");
    expect(delivery).not.toMatch(/(?:source|eval)\s+[^\n]*manifest/);
    expect(delivery).toContain("APP_IMAGE");
    expect(delivery).toMatch(/install-release\.sh[^\n]*"\$RELEASE_SHA"[^\n]*"\$APP_IMAGE"/);
  });

  test("exposes only the five VPS environment secrets and uses a dedicated strict known-hosts file", () => {
    const source = read(".github/workflows/deploy-production.yml");
    expect([...new Set(secretReferences(source))].sort()).toEqual([
      "GITHUB_TOKEN", "VPS_HOST", "VPS_HOST_KEY", "VPS_PORT", "VPS_SSH_PRIVATE_KEY", "VPS_USER",
    ]);
    expect(source).toContain("UserKnownHostsFile");
    expect(source).toContain("StrictHostKeyChecking=yes");
    expect(source).not.toContain("StrictHostKeyChecking=no");
    expect(source).not.toContain("ssh-keyscan");
    expect(source.match(/if \(\(VPS_PORT == 22\)\); then/g)).toHaveLength(2);
    expect(source.match(/printf '%s %s\\n' "\$VPS_HOST" "\$VPS_HOST_KEY"/g)).toHaveLength(2);
    expect(source.match(/printf '\[%s\]:%s %s\\n' "\$VPS_HOST" "\$VPS_PORT" "\$VPS_HOST_KEY"/g)).toHaveLength(2);
  });

  test("manual rollback validates a full SHA and delegates retained-release validation to rollback.sh", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.on.workflow_dispatch?.inputs.rollback_sha.required).toBe(true);
    const source = read(".github/workflows/deploy-production.yml");
    expect(source).toContain("^[0-9a-f]{40}$");
    expect(source).toMatch(/rollback\.sh[^\n]*"\$ROLLBACK_SHA"/);
    expect(source).not.toMatch(/eval|bash\s+-c|sh\s+-c/);
  });
});

describe("committed secret scan", () => {
  test("uses no whole-file exclusions and detects secret-like material in a tracked test file", () => {
    const scanner = resolve("scripts/check-committed-secrets.sh");
    expect(read(scanner)).not.toContain(":(exclude)");
    const root = mkdtempSync(resolve(tmpdir(), "quotation-secret-scan-"));
    mkdirSync(resolve(root, "tests"));
    const sentinel = ["gh", "p_", "A".repeat(36)].join("");
    writeFileSync(resolve(root, "tests", "sentinel.test.ts"), `export const accidental = "${sentinel}";\n`);
    try {
      expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
      expect(spawnSync("git", ["add", "."], { cwd: root }).status).toBe(0);
      const result = spawnSync(scanner, [], { cwd: root, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("tests/sentinel.test.ts");
      expect(result.stderr).toContain("high-confidence secret material is committed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("release installer digest interface", () => {
  test("rejects a missing or malformed canonical digest before Docker is invoked", () => {
    const installer = resolve("deploy/install-release.sh");
    for (const digest of [
      undefined,
      "ghcr.io/example/app:latest",
      `ghcr.io/example/app@sha256:${"a".repeat(63)}`,
      `ghcrXio/jeffreycaicai/sales_quotation_approvecenter@sha256:${"a".repeat(64)}`,
    ]) {
      const result = spawnSync(installer, digest === undefined ? ["a".repeat(40)] : ["a".repeat(40), digest], {
        encoding: "utf8",
        env: { ...process.env, OPERATIONS_ALLOW_NON_DEPLOY_TEST_USER: "1" },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("canonical production image digest");
    }
  });
});

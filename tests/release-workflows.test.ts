import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  steps: Array<{ run?: string }>;
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
    expect(commands).toContain("npm run test:integration");
    expect(read("package.json")).toContain('"test:integration"');
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

  test("pins every referenced action to an immutable full commit SHA", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/deploy-production.yml"]) {
      const references = actionReferences(read(path));
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });
});

describe("production delivery workflow", () => {
  test("deploys only after a successful trusted main push CI run", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.on.workflow_run).toEqual({ workflows: ["CI"], types: ["completed"], branches: ["main"] });
    const publishIf = delivery.jobs.publish.if;
    expect(publishIf).toContain("workflow_run.conclusion == 'success'");
    expect(publishIf).toContain("workflow_run.event == 'push'");
    expect(publishIf).toContain("workflow_run.head_branch == 'main'");
    expect(delivery.jobs.deploy.needs).toEqual(["publish"]);
  });

  test("serializes production changes without cancelling an active release", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.concurrency).toEqual({ group: "production", "cancel-in-progress": false });
    expect(delivery.jobs.deploy.environment).toBe("production");
    expect(delivery.jobs.rollback.environment).toBe("production");
  });

  test("grants package write only to publication and no GitHub token access to SSH jobs", () => {
    const delivery = workflow(".github/workflows/deploy-production.yml");
    expect(delivery.permissions).toEqual({ contents: "read" });
    expect(delivery.jobs.publish.permissions).toEqual({ contents: "read", packages: "write" });
    expect(delivery.jobs.deploy.permissions).toEqual({});
    expect(delivery.jobs.rollback.permissions).toEqual({});
    expect(secretReferences(read(".github/workflows/ci.yml"))).toEqual([]);
  });

  test("publishes the full-SHA tag, records its canonical digest, and passes both to install", () => {
    const delivery = read(".github/workflows/deploy-production.yml");
    expect(delivery).toContain("ghcr.io/jeffreycaicai/sales_quotation_approvecenter");
    expect(delivery).toContain("workflow_run.head_sha");
    expect(delivery).toContain("docker push");
    expect(delivery).toContain("RepoDigests");
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

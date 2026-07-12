import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const validator = resolve("scripts/validate-release-manifest.sh");
const sha = "a".repeat(40);
const digest = `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:${"b".repeat(64)}`;
const runId = "123456789";
const valid = `RELEASE_SHA ${sha}\nAPP_IMAGE ${digest}\nGITHUB_RUN_ID ${runId}\n`;

function validate(contents: string, expectedSha = sha, expectedRunId = runId) {
  const root = mkdtempSync(join(tmpdir(), "quotation-release-manifest-"));
  const manifest = join(root, "release.manifest");
  writeFileSync(manifest, contents);
  try {
    return spawnSync(validator, [manifest, expectedSha, expectedRunId], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("release manifest validation", () => {
  test("accepts the exact fixed-format SHA, digest, and triggering run ID", () => {
    const result = validate(valid);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${sha}\n${digest}\n`);
  });

  test.each([
    ["duplicate key", `RELEASE_SHA ${sha}\nRELEASE_SHA ${sha}\nGITHUB_RUN_ID ${runId}\n`, sha, runId],
    ["mismatched SHA", valid, "c".repeat(40), runId],
    ["mismatched run", valid, sha, "987654321"],
    ["sourceable assignment", `RELEASE_SHA=${sha}\nAPP_IMAGE=${digest}\nGITHUB_RUN_ID=${runId}\n`, sha, runId],
    ["extra line", `${valid}APP_IMAGE ${digest}\n`, sha, runId],
    ["uppercase SHA", valid.replace(sha, sha.toUpperCase()), sha, runId],
  ])("rejects %s", (_name, contents, expectedSha, expectedRunId) => {
    const result = validate(contents, expectedSha, expectedRunId);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid release manifest");
  });
});

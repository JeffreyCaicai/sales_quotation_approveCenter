import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const extractor = resolve("scripts/extract-pushed-image-digest.sh");
const repository = "ghcr.io/jeffreycaicai/sales_quotation_approvecenter";
const digest = `sha256:${"a".repeat(64)}`;

function extract(pushOutput: string) {
  const root = mkdtempSync(join(tmpdir(), "quotation-push-output-"));
  const log = join(root, "push.log");
  writeFileSync(log, pushOutput);
  try {
    return spawnSync(extractor, [log, repository], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Docker push digest extraction", () => {
  test("constructs the canonical image only from the single push digest result", () => {
    const result = extract(`layer: Pushed\nrelease: digest: ${digest} size: 1987\n`);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${repository}@${digest}\n`);
  });

  test.each([
    ["missing", "layer: Pushed\n"],
    ["malformed", `release: digest: sha256:${"a".repeat(63)} size: 1\n`],
    ["multiple", `one: digest: ${digest} size: 1\ntwo: digest: sha256:${"b".repeat(64)} size: 2\n`],
  ])("rejects %s digest output", (_name, output) => {
    const result = extract(output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exactly one canonical digest");
  });
});

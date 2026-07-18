import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { prepareStandaloneAssets } from "../scripts/start-playwright-server.mts";

describe("Playwright standalone server preparation", () => {
  it("copies public and Next static assets into the standalone bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "quotation-playwright-"));
    await mkdir(join(root, "public"), { recursive: true });
    await mkdir(join(root, ".next", "static", "chunks"), { recursive: true });
    await mkdir(join(root, ".next", "standalone", ".next"), { recursive: true });
    await writeFile(join(root, "public", "logo.txt"), "logo");
    await writeFile(join(root, ".next", "static", "chunks", "app.js"), "chunk");

    await prepareStandaloneAssets(root);

    await expect(
      readFile(join(root, ".next", "standalone", "public", "logo.txt"), "utf8"),
    ).resolves.toBe("logo");
    await expect(
      readFile(
        join(root, ".next", "standalone", ".next", "static", "chunks", "app.js"),
        "utf8",
      ),
    ).resolves.toBe("chunk");
  });
});

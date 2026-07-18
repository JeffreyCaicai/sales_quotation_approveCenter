import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  configurePlaywrightServerEnvironment,
  prepareStandaloneAssets,
} from "../scripts/start-playwright-server.mts";

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

  it("uses the Playwright URL as the sole listen address source", () => {
    const environment = {
      HOSTNAME: "ambient-host.invalid",
      PORT: "3999",
    };

    const address = configurePlaywrightServerEnvironment(
      "http://127.0.0.1:3105",
      environment,
    );

    expect(address).toEqual({ hostname: "127.0.0.1", port: "3105" });
    expect(environment.HOSTNAME).toBe("127.0.0.1");
    expect(environment.PORT).toBe("3105");
  });

  it("normalizes IPv6 hosts and defaults plain HTTP to port 80", () => {
    const environment: Record<string, string | undefined> = {};

    const address = configurePlaywrightServerEnvironment(
      "http://[::1]",
      environment,
    );

    expect(address).toEqual({ hostname: "::1", port: "80" });
    expect(environment.HOSTNAME).toBe("::1");
    expect(environment.PORT).toBe("80");
  });

  it("rejects HTTPS because the standalone test server is plain HTTP", () => {
    expect(() =>
      configurePlaywrightServerEnvironment("https://127.0.0.1", {}),
    ).toThrow(/http:/i);
  });
});

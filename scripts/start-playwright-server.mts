import { cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareStandaloneAssets(root: string): Promise<void> {
  const standaloneRoot = join(root, ".next", "standalone");

  await cp(join(root, "public"), join(standaloneRoot, "public"), {
    recursive: true,
    force: true,
  });
  await cp(
    join(root, ".next", "static"),
    join(standaloneRoot, ".next", "static"),
    { recursive: true, force: true },
  );
}

async function main(): Promise<void> {
  const root = process.cwd();
  const baseUrl = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  );

  await prepareStandaloneAssets(root);
  process.env.HOSTNAME ??= baseUrl.hostname;
  process.env.PORT ??= baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80");

  await import(
    pathToFileURL(join(root, ".next", "standalone", "server.js")).href
  );
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entrypoint === import.meta.url) {
  await main();
}

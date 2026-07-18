import { cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

type PlaywrightServerAddress = {
  hostname: string;
  port: string;
};

type MutableEnvironment = Record<string, string | undefined>;

export function configurePlaywrightServerEnvironment(
  rawBaseUrl: string,
  environment: MutableEnvironment = process.env,
): PlaywrightServerAddress {
  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.protocol !== "http:") {
    throw new Error("PLAYWRIGHT_BASE_URL must use http:");
  }

  const hostname = baseUrl.hostname.replace(/^\[|\]$/g, "");
  const port = baseUrl.port || "80";
  environment.HOSTNAME = hostname;
  environment.PORT = port;

  return { hostname, port };
}

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
  configurePlaywrightServerEnvironment(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  );

  await prepareStandaloneAssets(root);

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

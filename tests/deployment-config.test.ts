import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { MAX_IMPORT_FILE_BYTES, MAX_MULTIPART_OVERHEAD_BYTES } from "@/lib/imports/multipart";

const read = (path: string) => readFileSync(path, "utf8");
const { load: loadYaml } = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => unknown;
};

interface ComposeService {
  image?: string;
  environment?: Record<string, string>;
  env_file?: string[];
  ports?: string[];
  volumes?: string[];
  read_only?: boolean;
  user?: string;
  restart?: string;
  healthcheck?: unknown;
  depends_on?: Record<string, { condition?: string }>;
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
  volumes: Record<string, unknown>;
  networks: Record<string, { internal?: boolean }>;
}

const loadCompose = () => loadYaml(read("docker-compose.yml")) as ComposeConfig;

describe("production container packaging", () => {
  test("runs the standalone Next server as immutable uid and gid 10001", () => {
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static");
    expect(dockerfile).toContain("/app/server-assets");
    expect(dockerfile).toMatch(/(?:addgroup|groupadd).*10001/);
    expect(dockerfile).toMatch(/(?:adduser|useradd).*10001/);
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain('["node", "server.js"]');
  });

  test("pins tracing to the project so standalone server.js has a stable path", () => {
    const nextConfig = read("next.config.ts");

    expect(nextConfig).toContain("outputFileTracingRoot: projectRoot");
    expect(nextConfig).toContain("turbopack: { root: projectRoot }");
  });

  test("exposes only web on loopback and keeps stateful services private", () => {
    const compose = loadCompose();

    expect(compose.services.web.ports).toEqual(["127.0.0.1:3000:3000"]);
    expect(Object.entries(compose.services).filter(([, service]) => service.ports)).toHaveLength(1);
    expect(compose.networks.quotation_internal.internal).toBe(true);
    expect(Object.keys(compose.volumes)).toEqual(["postgres_data", "minio_data"]);
    expect(compose.services.postgres.volumes).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose.services.minio.volumes).toContain("minio_data:/data");
  });

  test("uses an externally supplied immutable image and hardened service policy", () => {
    const compose = loadCompose();

    expect(compose.services.web.image).toBe("${APP_IMAGE:?APP_IMAGE must be an immutable digest reference}");
    expect(compose.services.web.read_only).toBe(true);
    expect(compose.services.web.user).toBe("10001:10001");
    for (const service of Object.values(compose.services)) {
      expect(service.restart).toBe("unless-stopped");
      expect(service.healthcheck).toBeDefined();
    }
    expect(compose.services.web.depends_on).toEqual({
      postgres: { condition: "service_healthy" },
      minio: { condition: "service_healthy" },
    });
  });

  test("allows only application credentials into the web container", () => {
    const web = loadCompose().services.web;

    expect(Object.keys(web.environment ?? {})).toEqual([
      "DATABASE_URL", "AUTH_SECRET", "SITE_ORIGIN", "S3_ENDPOINT", "S3_REGION",
      "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
    ]);
    expect(web.env_file).toBeUndefined();
  });

  test("passes each stateful service only its required credentials", () => {
    const { postgres, minio } = loadCompose().services;

    expect(postgres.env_file).toBeUndefined();
    expect(postgres.environment).toEqual({
      POSTGRES_DB: "${POSTGRES_DB:?POSTGRES_DB is required}",
      POSTGRES_USER: "${POSTGRES_USER:?POSTGRES_USER is required}",
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}",
    });
    expect(minio.env_file).toBeUndefined();
    expect(minio.environment).toEqual({
      MINIO_ROOT_USER: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}",
      MINIO_ROOT_PASSWORD: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}",
    });
  });

  test("rejects mutable image tags and accepts a canonical sha256 digest", () => {
    const validator = "deploy/validate-app-image.sh";
    const digest = `ghcr.io/example/sales-quotation@sha256:${"a".repeat(64)}`;

    expect(execFileSync(validator, [digest], { encoding: "utf8" })).toBe("");
    for (const invalid of [
      "ghcr.io/example/sales-quotation:latest",
      `ghcr.io/example/sales-quotation@sha256:${"a".repeat(63)}`,
      `ghcr.io/example/sales-quotation@sha256:${"g".repeat(64)}`,
    ]) {
      const result = spawnSync(validator, [invalid], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("immutable repo@sha256:<64 lowercase hex> reference");
    }
  });

  test("gates production startup on immutable image and Compose validation", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "quotation-deploy-"));
    const fakeBin = join(temporaryDirectory, "bin");
    const dockerLog = join(temporaryDirectory, "docker.log");
    const envFile = join(temporaryDirectory, "production env");
    const startup = resolve("deploy/production-up.sh");
    mkdirSync(fakeBin);
    writeFileSync(envFile, "APP_IMAGE=provided-by-fake-compose\n");
    writeFileSync(join(fakeBin, "docker"), `#!/bin/sh
for argument do printf '<%s>' "$argument"; done >> "$DOCKER_LOG"
printf '\n' >> "$DOCKER_LOG"
case " $* " in
  *" config --images web "*) printf '%s\n' "$FAKE_IMAGE" ;;
esac
`);
    chmodSync(join(fakeBin, "docker"), 0o755);
    const run = (image: string) => spawnSync(startup, [envFile], {
      cwd: temporaryDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_LOG: dockerLog,
        FAKE_IMAGE: image,
      },
    });

    try {
      const mutable = run("ghcr.io/example/sales-quotation:latest");
      expect(mutable.status).not.toBe(0);
      expect(readFileSync(dockerLog, "utf8")).toContain("<config><--images><web>");
      expect(readFileSync(dockerLog, "utf8")).not.toContain("<up><-d>");

      writeFileSync(dockerLog, "");
      const digest = `ghcr.io/example/sales-quotation@sha256:${"a".repeat(64)}`;
      const immutable = run(digest);
      const calls = readFileSync(dockerLog, "utf8").trim().split("\n");
      expect(immutable.status).toBe(0);
      expect(calls).toHaveLength(3);
      expect(calls[0]).toContain("<config><--images><web>");
      expect(calls[1]).toContain("<config><--quiet>");
      expect(calls[2]).toContain("<up><-d>");
      for (const call of calls) {
        expect(call).toContain(`<--project-directory><${process.cwd()}>`);
        expect(call).toContain(`<--env-file><${envFile}>`);
        expect(call).toContain(`<--file><${resolve("docker-compose.yml")}>`);
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("documents mandatory startup wrapper and readable production env permissions", () => {
    const deploymentNotes = read("deploy/README.md");

    expect(deploymentNotes).toContain("/opt/sales-quotation/current/deploy/production-up.sh");
    expect(deploymentNotes).not.toContain("deploy/validate-app-image.sh");
    expect(deploymentNotes).not.toContain("docker compose --env-file");
    expect(deploymentNotes).toContain("root:deploy");
    expect(deploymentNotes).toContain("0640");
    expect(deploymentNotes).not.toContain("0600");
  });

  test("defers a worker service until the repository contains a real entrypoint", () => {
    const compose = read("docker-compose.yml");
    const deploymentNotes = read("deploy/README.md");

    expect(compose).not.toMatch(/^\s{2}worker:/m);
    expect(deploymentNotes).toContain("Worker deferred");
    expect(deploymentNotes).toContain("app/api/imports/[jobId]/process/route.ts");
  });

  test("ignores local data, secrets, exports, and build products", () => {
    const dockerignore = read(".dockerignore");

    for (const entry of [".git", ".env*", "node_modules", ".next", "exports", "*.log"]) {
      expect(dockerignore).toContain(entry);
    }
  });

  test("documents the exact application environment names without values", () => {
    const example = read("deploy/env.production.example");

    for (const name of [
      "DATABASE_URL", "AUTH_SECRET", "SITE_ORIGIN", "S3_ENDPOINT", "S3_REGION",
      "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
    ]) {
      expect(example).toMatch(new RegExp(`^${name}=`, "m"));
    }
    expect(example).not.toContain("SESSION_SECRET");
  });
});

describe("host nginx reverse proxy", () => {
  test("defines a separate templated vhost without replacing the default site", () => {
    const nginx = read("deploy/nginx/sales-quotation.conf.template");
    const nginxDocs = read("deploy/nginx/README.md");

    expect(nginx).toContain("server_name ${APP_DOMAIN};");
    expect(nginx).not.toContain("default_server");
    const nginxLimit = Number(nginx.match(/client_max_body_size (\d+)m;/)?.[1]) * 1024 * 1024;
    expect(nginxLimit).toBeGreaterThanOrEqual(MAX_IMPORT_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES);
    expect(nginxLimit).toBeLessThan(MAX_IMPORT_FILE_BYTES + 2 * 1024 * 1024);
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000;");
    expect(nginx).toContain("X-Content-Type-Options");
    expect(nginx).toContain("Referrer-Policy");
    expect(nginx).toContain("X-Frame-Options");
    expect(nginx).toContain('Strict-Transport-Security "max-age=31536000" always;');
    expect(nginxDocs).toContain("worldcup-lottery");
    expect(nginxDocs).toContain("certbot --nginx");
    expect(nginxDocs).toContain("nginx -t");
    expect(nginxDocs).toContain("effective only over HTTPS");
  });
});

describe("health endpoint", () => {
  test("returns only ok after a successful database probe", async () => {
    vi.resetModules();
    const execute = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/db", () => ({ getDb: () => ({ execute }) }));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(execute).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("fails closed without exposing database details", async () => {
    vi.resetModules();
    vi.doMock("@/db", () => ({
      getDb: () => ({ execute: vi.fn().mockRejectedValue(new Error("sensitive connection detail")) }),
    }));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "unhealthy" });
    expect(body).not.toContain("sensitive connection detail");
  });
});

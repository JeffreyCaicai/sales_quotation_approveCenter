import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

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
    const compose = read("docker-compose.yml");

    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
    expect(compose).toContain("quotation_internal:");
    expect(compose).toMatch(/postgres_data:[\s\S]*minio_data:/);
    expect(compose).toMatch(/postgres:[\s\S]*postgres_data:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/minio:[\s\S]*minio_data:\/data/);
  });

  test("uses an externally supplied immutable image and hardened service policy", () => {
    const compose = read("docker-compose.yml");

    expect(compose).toContain("${APP_IMAGE:?APP_IMAGE must be an immutable digest reference}");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("user: \"10001:10001\"");
    expect(compose.match(/restart: unless-stopped/g)).toHaveLength(3);
    expect(compose.match(/healthcheck:/g)).toHaveLength(3);
    expect(compose).toContain("condition: service_healthy");
    for (const line of compose.split("\n").filter((candidate) => /(?:PASSWORD|SECRET):/.test(candidate))) {
      expect(line).toMatch(/:\s*\$\{/);
    }
  });

  test("allows only application credentials into the web container", () => {
    const compose = read("docker-compose.yml");
    const web = compose.slice(compose.indexOf("  web:"), compose.indexOf("  postgres:"));

    expect(web).toContain("environment:");
    expect(web).toContain("AUTH_SECRET:");
    expect(web).toContain("S3_SECRET_ACCESS_KEY:");
    expect(web).not.toContain("env_file:");
    expect(web).not.toContain("MINIO_ROOT_PASSWORD");
    expect(web).not.toContain("POSTGRES_PASSWORD");
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
    expect(nginx).toContain("client_max_body_size 25m;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000;");
    expect(nginx).toContain("X-Content-Type-Options");
    expect(nginx).toContain("Referrer-Policy");
    expect(nginx).toContain("X-Frame-Options");
    expect(nginxDocs).toContain("worldcup-lottery");
    expect(nginxDocs).toContain("certbot --nginx");
    expect(nginxDocs).toContain("nginx -t");
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

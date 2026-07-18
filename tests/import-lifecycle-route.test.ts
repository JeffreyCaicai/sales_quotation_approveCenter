import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthError } from "@/lib/auth/session";
import { AdminReadError } from "@/lib/imports/admin-read-model";
import { ImportProcessingError } from "@/lib/imports/process-import";
import { PublicationError } from "@/lib/imports/publish";
import { RateCardPublicationError } from "@/lib/imports/publish-rate-card";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  processImport: vi.fn(),
  reprocessImport: vi.fn(),
  publishImport: vi.fn(),
  getImportJobDetail: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/imports/process-import", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/process-import")>()),
  processImport: mocks.processImport,
  reprocessImport: mocks.reprocessImport,
}));
vi.mock("@/lib/imports/publish", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/publish")>()),
  publishImport: mocks.publishImport,
}));
vi.mock("@/lib/imports/admin-read-model", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/admin-read-model")>()),
  getImportJobDetail: mocks.getImportJobDetail,
}));

import { POST as processRoute } from "@/app/api/imports/[jobId]/process/route";
import { POST as publishRoute } from "@/app/api/imports/[jobId]/publish/route";

function context(jobId = "job-1") {
  return { params: Promise.resolve({ jobId }) };
}

type RouteContext = ReturnType<typeof context>;

describe("import lifecycle route authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  test("requires an authenticated session before processing", async () => {
    mocks.requireSession.mockRejectedValue(new AuthError(401, "AUTH_REQUIRED"));
    const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context());
    expect(response.status).toBe(401);
    expect(mocks.processImport).not.toHaveBeenCalled();
  });

  test.each(["building", "package", "rate_card"] as const)(
    "dispatches authenticated %s processing to the state-checked processor",
    async (dataType) => {
      const actor = { id: "actor" };
      mocks.requireSession.mockResolvedValue(actor);
      const jobId = `job-${dataType}`;
      const state = dataType === "rate_card" ? "draft" : "ready_to_publish";
      mocks.processImport.mockResolvedValue({ jobId, state });
      const response = await processRoute(
        new Request(`https://test/api/imports/${jobId}/process`, { method: "POST" }),
        context(jobId),
      );
      expect(mocks.processImport).toHaveBeenCalledWith(jobId, actor);
      await expect(response.json()).resolves.toEqual({ jobId, state });
    },
  );

  test("maps a server-side processing permission denial to 403", async () => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.processImport.mockRejectedValue(new ImportProcessingError("PERMISSION_DENIED", 403));
    const response = await processRoute(new Request("https://test/api/imports/job-package/process", { method: "POST" }), context("job-package"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "PERMISSION_DENIED" });
  });

  test("returns not implemented for an authenticated unsupported processor", async () => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.processImport.mockRejectedValue(new ImportProcessingError("IMPORT_PROCESSOR_NOT_IMPLEMENTED", 501));
    const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context());
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: "IMPORT_PROCESSOR_NOT_IMPLEMENTED" });
  });

  test.each(["building", "package", "rate_card"] as const)(
    "dispatches authenticated %s publication to its server-authorized publisher",
    async (dataType) => {
      const actor = { id: "actor" };
      mocks.requireSession.mockResolvedValue(actor);
      const jobId = `job-${dataType}`;
      mocks.publishImport.mockResolvedValue({ jobId, state: "published", publishedChanges: 4 });
      const response = await publishRoute(
        new Request(`https://test/api/imports/${jobId}/publish`, { method: "POST" }),
        context(jobId),
      );
      expect(mocks.publishImport).toHaveBeenCalledWith(jobId, actor);
      await expect(response.json()).resolves.toMatchObject({ state: "published" });
    },
  );

  test.each([
    ["building", new PublicationError("PERMISSION_DENIED", 403)],
    ["package", new PublicationError("PERMISSION_DENIED", 403)],
    ["rate_card", new RateCardPublicationError("PERMISSION_DENIED", 403)],
  ] as const)("maps a server-side %s publish permission denial to 403", async (dataType, failure) => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.publishImport.mockRejectedValue(failure);
    const response = await publishRoute(new Request(`https://test/api/imports/job-${dataType}/publish`, { method: "POST" }), context(`job-${dataType}`));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "PERMISSION_DENIED" });
  });

  test.each([
    ["package", new PublicationError("IMPORT_CHANGE_STALE", 409)],
    ["rate_card", new RateCardPublicationError("IMPORT_CHANGE_STALE", 409)],
  ] as const)("marks a stale %s preview as requiring reprocessing", async (dataType, failure) => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.publishImport.mockRejectedValue(failure);
    const response = await publishRoute(new Request(`https://test/api/imports/job-${dataType}/publish`, { method: "POST" }), context(`job-${dataType}`));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "IMPORT_CHANGE_STALE",
      reprocessRequired: true,
    });
  });

  test.each([
    [new PublicationError("IMPORT_JOB_NOT_FOUND", 404), 404, "IMPORT_JOB_NOT_FOUND"],
    [new PublicationError("IMPORT_JOB_NOT_READY", 409), 409, "IMPORT_JOB_NOT_READY"],
    [new RateCardPublicationError("IMPORT_DUPLICATE_PUBLISHED", 409), 409, "IMPORT_DUPLICATE_PUBLISHED"],
    [new RateCardPublicationError("IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID", 409), 409, "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID"],
  ] as const)("preserves stable publication error mapping", async (failure, status, key) => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.publishImport.mockRejectedValue(failure);
    const response = await publishRoute(new Request("https://test/api/imports/job-1/publish", { method: "POST" }), context());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: key });
  });

  test.each([new Error("database password leaked"), { secret: "raw non-error" }])(
    "maps unknown processing failures to a generic 500",
    async (failure) => {
      mocks.requireSession.mockResolvedValue({ id: "actor" });
      mocks.processImport.mockRejectedValue(failure);
      const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "IMPORT_PROCESS_FAILED" });
    },
  );

  test("guardedly reprocesses a stale job and returns its refreshed authorized detail", async () => {
    const routeModule = await import("@/app/api/imports/[jobId]/reprocess/route").catch(() => null) as null | {
      POST(request: Request, context: RouteContext): Promise<Response>;
    };
    expect(routeModule?.POST).toBeTypeOf("function");
    if (!routeModule) return;
    const actor = { id: "actor" };
    const detail = { id: "job-rate_card", dataType: "rate_card", state: "draft" };
    mocks.requireSession.mockResolvedValue(actor);
    mocks.reprocessImport.mockResolvedValue({ jobId: "job-rate_card", state: "draft" });
    mocks.getImportJobDetail.mockResolvedValue(detail);

    const response = await routeModule.POST(
      new Request("https://test/api/imports/job-rate_card/reprocess", { method: "POST" }),
      context("job-rate_card"),
    );

    expect(mocks.reprocessImport).toHaveBeenCalledWith("job-rate_card", actor);
    expect(mocks.getImportJobDetail).toHaveBeenCalledTimes(2);
    expect(mocks.getImportJobDetail).toHaveBeenCalledWith(actor, "job-rate_card");
    await expect(response.json()).resolves.toEqual(detail);
  });

  test("checks detail access before a reprocess mutation", async () => {
    const routeModule = await import("@/app/api/imports/[jobId]/reprocess/route");
    const actor = { id: "actor" };
    mocks.requireSession.mockResolvedValue(actor);
    mocks.getImportJobDetail.mockRejectedValue(new AdminReadError(403, "PERMISSION_DENIED"));

    const response = await routeModule.POST(
      new Request("https://test/api/imports/job-rate_card/reprocess", { method: "POST" }),
      context("job-rate_card"),
    );

    expect(response.status).toBe(403);
    expect(mocks.reprocessImport).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "PERMISSION_DENIED" });
  });

  test("returns only safe processor incident fields from the processing route", async () => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.processImport.mockResolvedValue({
      jobId: "job-1",
      state: "processing_failed",
      failure: {
        code: "IMPORT_PROCESSING_TERMINAL",
        incidentId: "00000000-0000-4000-8000-000000000999",
        retryable: false,
      },
    });
    const response = await processRoute(
      new Request("https://test/api/imports/job-1/process", { method: "POST" }),
      context(),
    );
    expect(JSON.stringify(await response.json())).toBe(JSON.stringify({
      jobId: "job-1",
      state: "processing_failed",
      failure: {
        code: "IMPORT_PROCESSING_TERMINAL",
        incidentId: "00000000-0000-4000-8000-000000000999",
        retryable: false,
      },
    }));
  });
});

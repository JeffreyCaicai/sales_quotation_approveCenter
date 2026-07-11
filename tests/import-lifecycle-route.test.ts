import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthError } from "@/lib/auth/session";
import { ImportProcessingError } from "@/lib/imports/process-import";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  processImport: vi.fn(),
  publishImport: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/imports/process-import", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/process-import")>()),
  processImport: mocks.processImport,
}));
vi.mock("@/lib/imports/publish", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/publish")>()),
  publishImport: mocks.publishImport,
}));

import { POST as processRoute } from "@/app/api/imports/[jobId]/process/route";
import { POST as publishRoute } from "@/app/api/imports/[jobId]/publish/route";

const context = { params: Promise.resolve({ jobId: "job-1" }) };

describe("import lifecycle route authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  test("requires an authenticated session before processing", async () => {
    mocks.requireSession.mockRejectedValue(new AuthError(401, "AUTH_REQUIRED"));
    const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(mocks.processImport).not.toHaveBeenCalled();
  });

  test("passes the authenticated actor to state-checked processing", async () => {
    const actor = { id: "actor" };
    mocks.requireSession.mockResolvedValue(actor);
    mocks.processImport.mockResolvedValue({ jobId: "job-1", state: "draft" });
    const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context);
    expect(mocks.processImport).toHaveBeenCalledWith("job-1", actor);
    await expect(response.json()).resolves.toEqual({ jobId: "job-1", state: "draft" });
  });

  test("returns not implemented for an authenticated unsupported processor", async () => {
    mocks.requireSession.mockResolvedValue({ id: "actor" });
    mocks.processImport.mockRejectedValue(new ImportProcessingError("IMPORT_PROCESSOR_NOT_IMPLEMENTED", 501));
    const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: "IMPORT_PROCESSOR_NOT_IMPLEMENTED" });
  });

  test("publishes only through the authenticated explicit endpoint", async () => {
    const actor = { id: "actor" };
    mocks.requireSession.mockResolvedValue(actor);
    mocks.publishImport.mockResolvedValue({ jobId: "job-1", state: "published", publishedChanges: 4 });
    const response = await publishRoute(new Request("https://test/api/imports/job-1/publish", { method: "POST" }), context);
    expect(mocks.publishImport).toHaveBeenCalledWith("job-1", actor);
    await expect(response.json()).resolves.toMatchObject({ state: "published" });
  });

  test.each([new Error("database password leaked"), { secret: "raw non-error" }])(
    "maps unknown processing failures to a generic 500",
    async (failure) => {
      mocks.requireSession.mockResolvedValue({ id: "actor" });
      mocks.processImport.mockRejectedValue(failure);
      const response = await processRoute(new Request("https://test/api/imports/job-1/process", { method: "POST" }), context);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "IMPORT_PROCESS_FAILED" });
    },
  );
});

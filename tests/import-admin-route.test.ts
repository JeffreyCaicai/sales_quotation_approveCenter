import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthError } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getImportAdminSummary: vi.fn(),
  listImportJobs: vi.fn(),
  getImportJobDetail: vi.fn(),
  listRateCardVersions: vi.fn(),
  getImportFileDownload: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/imports/admin-read-model", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/imports/admin-read-model")>()),
  getImportAdminSummary: mocks.getImportAdminSummary,
  listImportJobs: mocks.listImportJobs,
  getImportJobDetail: mocks.getImportJobDetail,
  listRateCardVersions: mocks.listRateCardVersions,
  getImportFileDownload: mocks.getImportFileDownload,
}));

import { GET as summaryRoute } from "@/app/api/admin/imports/summary/route";
import { GET as jobsRoute } from "@/app/api/admin/imports/route";
import { GET as detailRoute } from "@/app/api/admin/imports/[jobId]/route";
import { GET as errorsRoute } from "@/app/api/admin/imports/[jobId]/errors.csv/route";
import { GET as fileRoute } from "@/app/api/admin/imports/[jobId]/files/[fileId]/route";
import { GET as rateCardsRoute } from "@/app/api/admin/rate-cards/route";
import { AdminReadError } from "@/lib/imports/admin-read-model";

const actor = { id: "actor-1", email: "admin@example.com", displayName: "Admin", status: "active", permissions: [] };
const JOB_ID = "00000000-0000-4000-8000-000000000101";
const FILE_ID = "00000000-0000-4000-8000-000000000201";
const MISSING_JOB_ID = "00000000-0000-4000-8000-000000000102";

function jobContext(jobId = JOB_ID) {
  return { params: Promise.resolve({ jobId }) };
}

function fileContext(jobId = JOB_ID, fileId = FILE_ID) {
  return { params: Promise.resolve({ jobId, fileId }) };
}

describe("protected import administration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(actor);
  });

  test.each([
    ["summary", () => summaryRoute(new Request("https://test/api/admin/imports/summary"))],
    ["jobs", () => jobsRoute(new Request("https://test/api/admin/imports"))],
    ["detail", () => detailRoute(new Request(`https://test/api/admin/imports/${JOB_ID}`), jobContext())],
    ["errors", () => errorsRoute(new Request(`https://test/api/admin/imports/${JOB_ID}/errors.csv`), jobContext())],
    ["file", () => fileRoute(new Request(`https://test/api/admin/imports/${JOB_ID}/files/${FILE_ID}`), fileContext())],
    ["rate cards", () => rateCardsRoute(new Request("https://test/api/admin/rate-cards"))],
  ])("%s calls requireSession first and maps unauthenticated requests to 401", async (_name, callRoute) => {
    mocks.requireSession.mockRejectedValue(new AuthError(401, "AUTH_REQUIRED"));

    const response = await callRoute();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "AUTH_REQUIRED" });
    expect(mocks.getImportAdminSummary).not.toHaveBeenCalled();
    expect(mocks.listImportJobs).not.toHaveBeenCalled();
    expect(mocks.getImportJobDetail).not.toHaveBeenCalled();
    expect(mocks.listRateCardVersions).not.toHaveBeenCalled();
    expect(mocks.getImportFileDownload).not.toHaveBeenCalled();
  });

  test("delegates summary to the independently authorized read model", async () => {
    const summary = { currentRateCard: null, buildings: { active: 1, inactive: 0 }, packages: { active: 2, inactive: 0 }, jobs: { validating: 0, ready: 0, failed: 0 }, recentPublications: [] };
    mocks.getImportAdminSummary.mockResolvedValue(summary);

    const response = await summaryRoute(new Request("https://test/api/admin/imports/summary"));

    expect(mocks.getImportAdminSummary).toHaveBeenCalledWith(actor);
    await expect(response.json()).resolves.toEqual(summary);
  });

  test("accepts only stable bounded import job filters", async () => {
    mocks.listImportJobs.mockResolvedValue([]);
    const response = await jobsRoute(new Request("https://test/api/admin/imports?dataType=building&state=validation_failed&limit=25&offset=10"));

    expect(mocks.listImportJobs).toHaveBeenCalledWith(actor, {
      dataType: "building",
      state: "validation_failed",
      limit: 25,
      offset: 10,
    });
    expect(response.status).toBe(200);

    for (const query of ["dataType=constructor", "state=unknown", "limit=0", "limit=101", "offset=-1", "offset=10001", "unknown=x"]) {
      vi.clearAllMocks();
      mocks.requireSession.mockResolvedValue(actor);
      const invalid = await jobsRoute(new Request(`https://test/api/admin/imports?${query}`));
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({ error: "IMPORT_FILTER_INVALID" });
      expect(mocks.requireSession).toHaveBeenCalledTimes(1);
      expect(mocks.listImportJobs).not.toHaveBeenCalled();
    }
  });

  test("maps current database permission denial to stable 403", async () => {
    mocks.getImportAdminSummary.mockRejectedValue(new AdminReadError(403, "PERMISSION_DENIED"));
    const response = await summaryRoute(new Request("https://test/api/admin/imports/summary"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "PERMISSION_DENIED" });
  });

  test("maps protected missing jobs to stable 404", async () => {
    mocks.getImportJobDetail.mockRejectedValue(new AdminReadError(404, "IMPORT_JOB_NOT_FOUND"));
    const response = await detailRoute(new Request(`https://test/api/admin/imports/${MISSING_JOB_ID}`), jobContext(MISSING_JOB_ID));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "IMPORT_JOB_NOT_FOUND" });
  });

  test("renders deterministic localized CSV headers and validates locale", async () => {
    mocks.getImportJobDetail.mockResolvedValue({
      errors: [{
        id: "e1", file: "building.csv", sheet: "Data", row: 2, column: "Name",
        errorKey: "import.error.value_invalid", parameters: {}, createdAt: "2026-07-18T08:00:00.000Z",
      }],
    });

    const response = await errorsRoute(
      new Request(`https://test/api/admin/imports/${JOB_ID}/errors.csv?locale=zh-CN`),
      jobContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="import-${JOB_ID}-errors.csv"`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("某个值无效。");

    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(actor);
    const invalid = await errorsRoute(
      new Request(`https://test/api/admin/imports/${JOB_ID}/errors.csv?locale=id`),
      jobContext(),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "IMPORT_LOCALE_INVALID" });
    expect(mocks.getImportJobDetail).not.toHaveBeenCalled();
  });

  test("redirects protected files with no-store only after model authorization", async () => {
    mocks.getImportFileDownload.mockResolvedValue("https://objects.test/signed");

    const response = await fileRoute(
      new Request(`https://test/api/admin/imports/${JOB_ID}/files/${FILE_ID}`),
      fileContext(),
    );

    expect(mocks.getImportFileDownload).toHaveBeenCalledWith(actor, JOB_ID, FILE_ID);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://objects.test/signed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test.each([
    ["detail job", () => detailRoute(new Request("https://test/api/admin/imports/not-a-uuid"), jobContext("not-a-uuid"))],
    ["CSV job", () => errorsRoute(new Request("https://test/api/admin/imports/not-a-uuid/errors.csv"), jobContext("not-a-uuid"))],
    ["file job", () => fileRoute(new Request(`https://test/api/admin/imports/not-a-uuid/files/${FILE_ID}`), fileContext("not-a-uuid", FILE_ID))],
    ["file id", () => fileRoute(new Request(`https://test/api/admin/imports/${JOB_ID}/files/not-a-uuid`), fileContext(JOB_ID, "not-a-uuid"))],
  ])("returns a stable 400 for malformed %s after requiring a session", async (_name, callRoute) => {
    const response = await callRoute();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "IMPORT_IDENTIFIER_INVALID" });
    expect(mocks.requireSession).toHaveBeenCalledTimes(1);
    expect(mocks.getImportJobDetail).not.toHaveBeenCalled();
    expect(mocks.getImportFileDownload).not.toHaveBeenCalled();
  });

  test("delegates Rate Card history and preserves Current-first model output", async () => {
    const versions = [{ id: "current", status: "current" }, { id: "history", status: "historical" }];
    mocks.listRateCardVersions.mockResolvedValue(versions);
    const response = await rateCardsRoute(new Request("https://test/api/admin/rate-cards"));

    expect(mocks.listRateCardVersions).toHaveBeenCalledWith(actor);
    await expect(response.json()).resolves.toEqual(versions);
  });

  test.each([new Error("database password leaked"), { secret: "raw failure" }])(
    "maps unknown failures to a generic 500 without details",
    async (failure) => {
      mocks.getImportAdminSummary.mockRejectedValue(failure);
      const response = await summaryRoute(new Request("https://test/api/admin/imports/summary"));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "IMPORT_ADMIN_READ_FAILED" });
    },
  );
});

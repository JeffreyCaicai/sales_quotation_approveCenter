import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  createImportJob: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/imports/create-job", () => ({
  createImportJob: mocks.createImportJob,
}));

import { POST } from "@/app/api/imports/route";

describe("imports route authorization boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  test("fails closed before authentication for an unknown data type", async () => {
    const form = new FormData();
    form.set("dataType", "unknown");
    const response = await POST(new Request("https://quotation.test/api/imports", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "IMPORT_DATA_TYPE_INVALID" });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.createImportJob).not.toHaveBeenCalled();
  });

  test("requires the exact permission and returns the uploaded job", async () => {
    const user = { id: "user", permissions: ["data.import.building"] };
    mocks.requirePermission.mockResolvedValue(user);
    mocks.createImportJob.mockResolvedValue({ jobId: "job", state: "uploaded" });
    const form = new FormData();
    form.set("dataType", "building");
    form.set("templateVersion", "v1");
    form.append("files", new File([new Uint8Array([1])], "building.csv", { type: "text/csv" }));
    const response = await POST(new Request("https://quotation.test/api/imports", { method: "POST", body: form }));
    expect(mocks.requirePermission).toHaveBeenCalledWith("data.import.building");
    expect(mocks.createImportJob).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: "building", templateVersion: "v1", files: [expect.any(File)] }),
      user,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ jobId: "job", state: "uploaded" });
  });
});

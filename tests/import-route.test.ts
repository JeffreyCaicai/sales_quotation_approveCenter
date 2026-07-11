import { beforeEach, describe, expect, test, vi } from "vitest";
import { AuthError } from "@/lib/auth/session";

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
    const response = await POST(new Request("https://quotation.test/api/imports?dataType=unknown", { method: "POST", body: form }));
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
    form.set("templateVersion", "v1");
    form.append("files", new File([new Uint8Array([1])], "building.csv", { type: "text/csv" }));
    const response = await POST(new Request("https://quotation.test/api/imports?dataType=building", { method: "POST", body: form }));
    expect(mocks.requirePermission).toHaveBeenCalledWith("data.import.building");
    expect(mocks.createImportJob).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: "building", templateVersion: "v1", files: [expect.objectContaining({ filename: "building.csv", mimeType: "text/csv", body: expect.any(Uint8Array) })] }),
      user,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ jobId: "job", state: "uploaded" });
  });

  test("does not consume multipart bytes before authentication succeeds", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode("secret upload bytes")); controller.close(); },
    });
    mocks.requirePermission.mockRejectedValue(new AuthError(401, "AUTH_REQUIRED"));
    const request = new Request(
      "https://quotation.test/api/imports?dataType=building",
      { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit & { duplex: string },
    );
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  test("cancels an unknown-length stream immediately after the aggregate limit", async () => {
    mocks.requirePermission.mockResolvedValue({ id: "user", permissions: ["data.import.building"] });
    const encoder = new TextEncoder();
    const prefix = encoder.encode("--x\r\nContent-Disposition: form-data; name=\"templateVersion\"\r\n\r\nv1\r\n--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"building.csv\"\r\nContent-Type: text/csv\r\n\r\n");
    const chunk = new Uint8Array(1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(pulls === 1 ? prefix : chunk);
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(new Request(
      "https://quotation.test/api/imports?dataType=building",
      { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit & { duplex: string },
    ));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(28);
    expect(mocks.createImportJob).not.toHaveBeenCalled();
  });
});

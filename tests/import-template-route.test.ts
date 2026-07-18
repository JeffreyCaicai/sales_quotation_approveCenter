import { beforeEach, describe, expect, test, vi } from "vitest";

import { AuthError } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  generateImportTemplate: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/imports/generate-template", () => ({
  generateImportTemplate: mocks.generateImportTemplate,
}));

import { GET } from "@/app/api/templates/[dataType]/route";

function context(dataType: string) {
  return { params: Promise.resolve({ dataType }) };
}

describe("formal template download route", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 without reading the template when authentication fails", async () => {
    mocks.requirePermission.mockRejectedValue(new AuthError(401, "AUTH_REQUIRED"));

    const response = await GET(
      new Request("https://quotation.test/api/templates/building"),
      context("building"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "AUTH_REQUIRED" });
    expect(mocks.requirePermission).toHaveBeenCalledWith("data.import.building");
    expect(mocks.generateImportTemplate).not.toHaveBeenCalled();
  });

  test("returns 403 without reading the template when the exact permission is missing", async () => {
    mocks.requirePermission.mockRejectedValue(
      new AuthError(403, "PERMISSION_DENIED"),
    );

    const response = await GET(
      new Request("https://quotation.test/api/templates/rate_card"),
      context("rate_card"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "PERMISSION_DENIED" });
    expect(mocks.requirePermission).toHaveBeenCalledWith("rate_card.upload");
    expect(mocks.generateImportTemplate).not.toHaveBeenCalled();
  });

  test.each(["customer_brand", "constructor", "../../secrets"])(
    "returns a safe 404 for the disabled or unknown %s template without authenticating",
    async (dataType) => {
      const response = await GET(
        new Request(`https://quotation.test/api/templates/${dataType}`),
        context(dataType),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "TEMPLATE_NOT_FOUND" });
      expect(mocks.requirePermission).not.toHaveBeenCalled();
      expect(mocks.generateImportTemplate).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["building", "data.import.building", "02_Buildings_Template.xlsx"],
    ["package", "data.import.package", "03_Sales_Packages_Template.xlsx"],
    ["rate_card", "rate_card.upload", "04_Rate_Card_Template.xlsx"],
  ] as const)("downloads the authenticated %s workbook", async (dataType, permission, filename) => {
    const bytes = Buffer.from("verified xlsx bytes");
    mocks.requirePermission.mockResolvedValue({ id: "user", permissions: [permission] });
    mocks.generateImportTemplate.mockResolvedValue(bytes);

    const response = await GET(
      new Request(`https://quotation.test/api/templates/${dataType}`),
      context(dataType),
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(permission);
    expect(mocks.generateImportTemplate).toHaveBeenCalledWith(dataType, "TMN-IMPORT-2");
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${filename}"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).not.toContain(dataType);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});

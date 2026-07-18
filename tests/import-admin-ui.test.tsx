import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

import { AdminLogin } from "@/components/admin/admin-login";
import { ImportHistory } from "@/components/admin/import-history";
import { ImportJobDetail } from "@/components/admin/import-job-detail";
import {
  ImportAdminApiError,
  bootstrapLogin,
  getImportJobDetail,
  getImportSummary,
  listImportHistory,
  publishImportJob,
  uploadImport,
  validateImportFiles,
} from "@/lib/client/import-admin-api";
import { jobUrl, readJobIdFromSearch } from "@/components/admin/import-admin-app";
import { translateAdmin } from "@/lib/admin-i18n";
import type { ImportJobDetail as ImportJobDetailContract, ImportJobListItem } from "@/lib/imports/admin-contracts";

const t = (key: Parameters<typeof translateAdmin>[1], params?: Record<string, string | number>) =>
  translateAdmin("en", key, params);

const user = { id: "user-1", email: "admin@example.com", displayName: "Administrator" };
const job: ImportJobDetailContract = {
  id: "00000000-0000-4000-8000-000000000101",
  dataType: "building",
  templateVersion: "TMN-IMPORT-2",
  state: "ready_to_publish",
  totalRows: 10,
  validRows: 10,
  invalidRows: 0,
  sourceType: "manual",
  failureSummary: null,
  uploadedBy: user,
  publishedBy: null,
  createdAt: "2026-07-18T01:00:00.000Z",
  updatedAt: "2026-07-18T01:01:00.000Z",
  publishedAt: null,
  errors: [],
  changes: [
    { id: "c1", entityType: "building", entityId: "BLD-1", changeType: "added", beforeValue: null, afterValue: {}, createdAt: "2026-07-18T01:01:00.000Z" },
    { id: "c2", entityType: "building", entityId: "BLD-2", changeType: "modified", beforeValue: {}, afterValue: {}, createdAt: "2026-07-18T01:01:00.000Z" },
  ],
  files: [{ id: "00000000-0000-4000-8000-000000000201", originalFilename: "Buildings.csv", mimeType: "text/csv", sizeBytes: 20, purpose: "original", createdAt: "2026-07-18T01:00:00.000Z" }],
  auditEvents: [],
};

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}

function buttonByText(root: ReactElement, label: string): ReactElement<{ onClick?: () => void }> {
  const button = elements(root).find((element) =>
    element.type === "button" && renderToStaticMarkup(element).includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button as ReactElement<{ onClick?: () => void }>;
}

describe("import administration workflow", () => {
  test("renders a labelled credential form and submits credentials without storage", () => {
    const onSubmit = vi.fn();
    const html = renderToStaticMarkup(<AdminLogin t={t} busy={false} error={null} onSubmit={onSubmit} />);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Sign in");

    const root = AdminLogin({ t, busy: false, error: null, onSubmit });
    const form = elements(root).find((element) => element.type === "form") as ReactElement<{ onSubmit: (event: unknown) => void }>;
    form.props.onSubmit({
      preventDefault: () => undefined,
      currentTarget: { elements: { namedItem: (name: string) => ({ value: name === "email" ? "admin@example.com" : "secret" }) } },
    });
    expect(onSubmit).toHaveBeenCalledWith("admin@example.com", "secret");
  });

  test("keeps Building and Sales Package uploads to exactly one xlsx or csv", () => {
    const xlsx = new File(["x"], "data.xlsx");
    const csv = new File(["x"], "data.csv");

    expect(validateImportFiles("building", [xlsx])).toBeNull();
    expect(validateImportFiles("package", [csv])).toBeNull();
    expect(validateImportFiles("building", [new File(["x"], "data.pdf")])).toBe("upload.invalidType");
    expect(validateImportFiles("package", [xlsx, csv])).toBe("upload.singleFile");
  });

  test("accepts one Rate Card xlsx or the exact four-file CSV batch", () => {
    const csvBatch = [
      "building-prices.csv",
      "metadata.csv",
      "package-buildings.csv",
      "package-prices.csv",
    ].map((name) => new File(["x"], name, { type: "text/csv" }));

    expect(validateImportFiles("rate_card", [new File(["x"], "rate-card.xlsx")])).toBeNull();
    expect(validateImportFiles("rate_card", csvBatch)).toBeNull();
    expect(validateImportFiles("rate_card", csvBatch.slice(0, 3))).toBe("upload.rateCardFileSet");
    expect(validateImportFiles("rate_card", [...csvBatch, new File(["x"], "extra.csv")])).toBe("upload.rateCardFileSet");
    expect(validateImportFiles("rate_card", [csvBatch[0], new File(["x"], "rate-card.xlsx")])).toBe("upload.rateCardFileSet");
    expect(validateImportFiles("rate_card", csvBatch.map((file, index) => index === 3 ? new File(["x"], "prices.csv") : file))).toBe("upload.rateCardFileSet");
  });

  test("creates one multipart request containing the complete selected batch", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: job.id, state: "uploaded" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));

    const csvBatch = [
      "building-prices.csv",
      "metadata.csv",
      "package-buildings.csv",
      "package-prices.csv",
    ].map((name) => new File(["a,b"], name, { type: "text/csv" }));

    await expect(uploadImport("rate_card", csvBatch, undefined, fetcher)).resolves.toEqual({
      jobId: job.id,
      state: "uploaded",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/imports?dataType=rate_card");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("templateVersion")).toBe("TMN-IMPORT-2");
    expect((init.body as FormData).getAll("files")).toHaveLength(4);
    expect((init.body as FormData).getAll("files").map((file) => (file as File).name)).toEqual(csvBatch.map((file) => file.name));
  });

  test("loads summary and history independently and maps stable non-2xx errors", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("summary")) return new Response(JSON.stringify({ currentRateCard: null, buildings: { active: 1, inactive: 0 }, packages: { active: 2, inactive: 0 }, jobs: { validating: 0, ready: 0, failed: 0 }, recentPublications: [] }));
      if (url.includes("limit=25")) return new Response(JSON.stringify([job]));
      return new Response(JSON.stringify({ error: "IMPORT_JOB_NOT_FOUND", details: "do not expose" }), { status: 404 });
    });

    await expect(Promise.all([
      getImportSummary(undefined, fetcher),
      listImportHistory({ limit: 25, offset: 0 }, undefined, fetcher),
    ])).resolves.toHaveLength(2);
    await expect(getImportJobDetail("missing", undefined, fetcher)).rejects.toEqual(
      new ImportAdminApiError(404, "IMPORT_JOB_NOT_FOUND"),
    );
  });

  test("preserves only an explicit reprocess-required conflict on client API errors", async () => {
    const staleFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "IMPORT_CHANGE_STALE",
      reprocessRequired: true,
    }), { status: 409 }));
    const notReadyFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "IMPORT_JOB_NOT_READY",
    }), { status: 409 }));

    await expect(publishImportJob(job.id, undefined, staleFetcher)).rejects.toMatchObject({
      key: "IMPORT_CHANGE_STALE",
      reprocessRequired: true,
    });
    await expect(publishImportJob(job.id, undefined, notReadyFetcher)).rejects.toMatchObject({
      key: "IMPORT_JOB_NOT_READY",
      reprocessRequired: false,
    });
  });

  test("keeps client history requests inside the protected route bounds", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));

    await listImportHistory({ limit: 900, offset: 50_000 }, undefined, fetcher);

    expect(fetcher.mock.calls[0][0]).toBe("/api/admin/imports?limit=100&offset=10000");
  });

  test("restores a safe selected job and updates only the job query parameter", () => {
    expect(readJobIdFromSearch(`?job=${job.id}`)).toBe(job.id);
    expect(readJobIdFromSearch("?job=javascript:alert(1)")).toBeNull();
    expect(jobUrl("https://tmn.test/admin/imports?mode=compact#history", job.id)).toBe(`/admin/imports?mode=compact&job=${job.id}#history`);
    expect(jobUrl(`https://tmn.test/admin/imports?job=${job.id}`, null)).toBe("/admin/imports");
  });

  test("requires explicit confirmation before publication and exposes stale reprocessing", () => {
    const onRequestPublish = vi.fn();
    const onPublish = vi.fn();
    const onReprocess = vi.fn();
    const closed = ImportJobDetail({
      locale: "en",
      t,
      job,
      stale: true,
      publishing: false,
      confirmationOpen: false,
      generatedIdentifiers: [],
      onRequestPublish,
      onCancelPublish: () => undefined,
      onPublish,
      onReprocess,
    });
    const html = renderToStaticMarkup(closed);
    expect(html).toContain("This preview is stale");
    expect(html).toContain("Reprocess");
    expect(html).not.toContain('open=""');

    buttonByText(closed, "Publish data").props.onClick?.();
    expect(onRequestPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
    buttonByText(closed, "Reprocess").props.onClick?.();
    expect(onReprocess).toHaveBeenCalledTimes(1);

    const open = ImportJobDetail({
      locale: "en",
      t,
      job,
      stale: false,
      publishing: false,
      confirmationOpen: true,
      generatedIdentifiers: [],
      onRequestPublish,
      onCancelPublish: () => undefined,
      onPublish,
      onReprocess,
    });
    const openHtml = renderToStaticMarkup(open);
    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).not.toContain('open=""');
    expect(openHtml).toContain("Publish Buildings data?");
    buttonByText(open, "Publish now").props.onClick?.();
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  test("restores reprocess-required controls from the durable job state after refresh", () => {
    const durableStaleJob: ImportJobDetailContract = {
      ...job,
      state: "reprocess_required",
      failureSummary: "IMPORT_REPROCESS_REQUIRED",
    };
    const html = renderToStaticMarkup(<ImportJobDetail
      locale="en"
      t={t}
      job={durableStaleJob}
      stale={false}
      publishing={false}
      confirmationOpen={false}
      generatedIdentifiers={[]}
      onRequestPublish={() => undefined}
      onCancelPublish={() => undefined}
      onPublish={() => undefined}
      onReprocess={() => undefined}
    />);

    expect(html).toContain("This preview is stale");
    expect(html).toContain("Reprocess");
    expect(html).not.toContain("Publish data");
  });

  test.each([
    ["IMPORT_PROCESSING_RETRYABLE:00000000-0000-4000-8000-000000000901", true],
    ["IMPORT_PROCESSING_TERMINAL:00000000-0000-4000-8000-000000000902", false],
  ] as const)("renders safe processing recovery for %s", (failureSummary, retryable) => {
    const onRetryProcessing = vi.fn();
    const failedJob: ImportJobDetailContract = {
      ...job,
      state: "processing_failed",
      failureSummary,
      changes: [],
    };
    const view = ImportJobDetail({
      locale: "en",
      t,
      job: failedJob,
      stale: false,
      publishing: false,
      processing: false,
      confirmationOpen: false,
      generatedIdentifiers: [],
      onRequestPublish: () => undefined,
      onCancelPublish: () => undefined,
      onPublish: () => undefined,
      onReprocess: () => undefined,
      onRetryProcessing,
    });
    const html = renderToStaticMarkup(view);

    expect(html).toContain(failureSummary.split(":")[1]);
    expect(html).not.toContain("SELECT");
    expect(html.includes("Retry processing")).toBe(retryable);
    if (retryable) {
      buttonByText(view, "Retry processing").props.onClick?.();
      expect(onRetryProcessing).toHaveBeenCalledTimes(1);
    }
  });

  test("classifies stale UI state only from explicit stale conflict metadata", async () => {
    const workspaceModule = await import("@/components/admin/import-workspace") as typeof import("@/components/admin/import-workspace") & {
      isStaleConflict?: (error: unknown) => boolean;
    };
    expect(workspaceModule.isStaleConflict).toBeTypeOf("function");
    if (!workspaceModule.isStaleConflict) return;
    expect(workspaceModule.isStaleConflict(new ImportAdminApiError(409, "IMPORT_CHANGE_STALE", true))).toBe(true);
    expect(workspaceModule.isStaleConflict(new ImportAdminApiError(409, "IMPORT_JOB_NOT_READY"))).toBe(false);
    expect(workspaceModule.isStaleConflict(new ImportAdminApiError(409, "IMPORT_DUPLICATE_PUBLISHED"))).toBe(false);
  });

  test("selects durable history jobs from a semantic table", () => {
    const onSelectJob = vi.fn();
    const item: ImportJobListItem = job;
    const history = ImportHistory({ locale: "en", t, jobs: [item], rateCardVersions: [], onSelectJob });
    const html = renderToStaticMarkup(history);
    expect(html).toContain("<table");
    expect(html).toContain(job.id);
    buttonByText(history, "Review job").props.onClick?.();
    expect(onSelectJob).toHaveBeenCalledWith(job.id, "building");
  });

  test("posts bootstrap credentials through the cookie-backed endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await expect(bootstrapLogin("admin@example.com", "secret", undefined, fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/bootstrap", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
    }));
  });
});

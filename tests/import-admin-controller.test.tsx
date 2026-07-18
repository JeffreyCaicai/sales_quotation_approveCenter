import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { translateAdmin } from "@/lib/admin-i18n";
import { ImportAdminApiError } from "@/lib/client/import-admin-api";
import type { ImportJobDetail } from "@/lib/imports/admin-contracts";

const mocks = vi.hoisted(() => ({
  getImportSummary: vi.fn(),
  listImportHistory: vi.fn(),
  listRateCardVersions: vi.fn(),
  getImportJobDetail: vi.fn(),
  bootstrapLogin: vi.fn(),
  uploadImport: vi.fn(),
  processImportJob: vi.fn(),
  reprocessImportJob: vi.fn(),
  publishImportJob: vi.fn(),
  dashboardProps: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/client/import-admin-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/client/import-admin-api")>()),
  getImportSummary: mocks.getImportSummary,
  listImportHistory: mocks.listImportHistory,
  listRateCardVersions: mocks.listRateCardVersions,
  getImportJobDetail: mocks.getImportJobDetail,
  bootstrapLogin: mocks.bootstrapLogin,
  uploadImport: mocks.uploadImport,
  processImportJob: mocks.processImportJob,
  reprocessImportJob: mocks.reprocessImportJob,
  publishImportJob: mocks.publishImportJob,
}));

vi.mock("@/components/admin/admin-locale-provider", async () => {
  const { createElement } = await import("react");
  return {
    AdminLocaleProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
    useAdminLocale: () => ({
      locale: "en" as const,
      setLocale: vi.fn(),
      t: (key: Parameters<typeof translateAdmin>[1], params?: Record<string, string | number>) =>
        translateAdmin("en", key, params),
    }),
  };
});

vi.mock("@/components/admin/import-admin-dashboard", async () => {
  const { createElement } = await import("react");
  return {
    ImportAdminDashboard: (props: Record<string, unknown>) => {
      mocks.dashboardProps = props;
      const summary = props.summary as { currentRateCard: null | { versionCode: string } };
      return createElement("main", null, `DASHBOARD:${summary.currentRateCard?.versionCode ?? "empty"}`);
    },
  };
});

vi.mock("@/components/admin/admin-login", async () => {
  const { createElement } = await import("react");
  return {
    AdminLogin: ({ error }: { error: string | null }) => createElement("main", null, `LOGIN:${error ?? "ready"}`),
  };
});

import { ImportAdminApp } from "@/components/admin/import-admin-app";
import { ImportWorkspace } from "@/components/admin/import-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderers: ReactTestRenderer[] = [];

beforeAll(() => {
  vi.stubGlobal("window", {
    location: { href: "http://localhost/admin/imports", search: "" },
    history: { pushState: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
});

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
});

const summary = {
  currentRateCard: { versionCode: "SECRET-RC", publishedAt: "2026-07-18T00:00:00.000Z" },
  buildings: { active: 10, inactive: 1 },
  packages: { active: 5, inactive: 0 },
  jobs: { validating: 0, ready: 1, failed: 0 },
  recentPublications: [],
};

const user = { id: "user-1", email: "admin@example.com", displayName: "Administrator" };
const job: ImportJobDetail = {
  id: "00000000-0000-4000-8000-000000000101",
  dataType: "building",
  templateVersion: "TMN-IMPORT-2",
  state: "ready_to_publish",
  totalRows: 1,
  validRows: 1,
  invalidRows: 0,
  sourceType: "manual",
  failureSummary: null,
  uploadedBy: user,
  publishedBy: null,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:01:00.000Z",
  publishedAt: null,
  errors: [],
  changes: [],
  files: [],
  auditEvents: [],
};

const t = (key: Parameters<typeof translateAdmin>[1], params?: Record<string, string | number>) =>
  translateAdmin("en", key, params);

function output(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

async function mountApp(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ImportAdminApp />);
    await Promise.resolve();
    await Promise.resolve();
  });
  renderers.push(renderer);
  return renderer;
}

describe("mounted import administration authentication controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboardProps = null;
    mocks.getImportSummary.mockResolvedValue(summary);
    mocks.listImportHistory.mockResolvedValue([]);
    mocks.listRateCardVersions.mockResolvedValue([]);
    mocks.getImportJobDetail.mockResolvedValue(job);
    mocks.bootstrapLogin.mockResolvedValue({ ok: true });
    mocks.uploadImport.mockResolvedValue({ jobId: job.id, state: "uploaded" });
    mocks.processImportJob.mockResolvedValue({ jobId: job.id, state: "ready_to_publish" });
    mocks.reprocessImportJob.mockResolvedValue(job);
    mocks.publishImportJob.mockResolvedValue({ jobId: job.id, state: "published", publishedChanges: 1 });
  });

  test("initial 401 renders login without protected summary data", async () => {
    mocks.getImportSummary.mockRejectedValue(new ImportAdminApiError(401, "AUTH_REQUIRED"));

    const renderer = await mountApp();

    expect(output(renderer)).toContain("LOGIN:ready");
    expect(output(renderer)).not.toContain(t("error.unauthorized"));
    expect(output(renderer)).not.toContain("SECRET-RC");
    expect(mocks.dashboardProps).toBeNull();
  });

  test("initial 403 renders the permission message instead of a session-expired message", async () => {
    mocks.getImportSummary.mockRejectedValue(new ImportAdminApiError(403, "PERMISSION_DENIED"));

    const renderer = await mountApp();

    expect(output(renderer)).toContain(t("error.permission"));
    expect(output(renderer)).not.toContain(t("error.unauthorized"));
    expect(output(renderer)).not.toContain("SECRET-RC");
  });

  test("post-load 401 aborts refresh, clears protected output, and returns to login", async () => {
    const renderer = await mountApp();
    expect(output(renderer)).toContain("DASHBOARD:SECRET-RC");
    const props = mocks.dashboardProps as {
      onRefresh(): Promise<void>;
      onUnauthorized(): void;
    };
    let refreshSignal: AbortSignal | undefined;
    mocks.getImportSummary.mockRejectedValueOnce(new ImportAdminApiError(401, "AUTH_REQUIRED"));
    mocks.listImportHistory.mockImplementationOnce((_filters, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      refreshSignal = signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    await act(async () => {
      await props.onRefresh();
    });

    expect(refreshSignal?.aborted).toBe(true);
    expect(output(renderer)).toContain(`LOGIN:${t("error.unauthorized")}`);
    expect(output(renderer)).not.toContain("DASHBOARD");
    expect(output(renderer)).not.toContain("SECRET-RC");
  });

  test("post-load 403 keeps the dashboard mounted with permission guidance", async () => {
    const renderer = await mountApp();
    const props = mocks.dashboardProps as { onRefresh(): Promise<void> };
    mocks.getImportSummary.mockRejectedValueOnce(new ImportAdminApiError(403, "PERMISSION_DENIED"));

    await act(async () => {
      await props.onRefresh();
    });

    expect(output(renderer)).toContain("DASHBOARD:SECRET-RC");
    expect(output(renderer)).toContain(t("error.permission"));
    expect(output(renderer)).not.toContain(t("error.unauthorized"));
  });
});

describe("mounted import workspace authentication and dialog behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImportJobDetail.mockResolvedValue(job);
    mocks.uploadImport.mockResolvedValue({ jobId: job.id, state: "uploaded" });
    mocks.processImportJob.mockResolvedValue({ jobId: job.id, state: "ready_to_publish" });
    mocks.reprocessImportJob.mockResolvedValue(job);
    mocks.publishImportJob.mockResolvedValue({ jobId: job.id, state: "published", publishedChanges: 1 });
  });

  async function mountWorkspace(
    onUnauthorized = vi.fn(),
    createNodeMock?: (element: ReactElement) => unknown,
    seededJob: ImportJobDetail | null = null,
  ) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ImportWorkspace
          locale="en"
          t={t}
          dataType="building"
          selectedJobId={job.id}
          initialJob={seededJob}
          onSelectJob={() => undefined}
          onResolveDataType={() => undefined}
          onRefresh={async () => undefined}
          onUnauthorized={onUnauthorized}
        />,
        createNodeMock ? { createNodeMock } : undefined,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    renderers.push(renderer);
    return renderer;
  }

  test("poll/detail 401 escalates to the root unauthorized callback", async () => {
    const onUnauthorized = vi.fn();
    mocks.getImportJobDetail.mockRejectedValue(new ImportAdminApiError(401, "AUTH_REQUIRED"));

    await mountWorkspace(onUnauthorized);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test("poll/detail 403 stays mounted with permission guidance", async () => {
    const onUnauthorized = vi.fn();
    mocks.getImportJobDetail.mockRejectedValue(new ImportAdminApiError(403, "PERMISSION_DENIED"));

    const renderer = await mountWorkspace(onUnauthorized);

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(output(renderer)).toContain(t("error.permission"));
    expect(output(renderer)).not.toContain(t("error.unauthorized"));
  });

  test.each([
    ["upload", () => mocks.uploadImport.mockRejectedValueOnce(new ImportAdminApiError(401, "AUTH_REQUIRED"))],
    ["process", () => mocks.processImportJob.mockRejectedValueOnce(new ImportAdminApiError(401, "AUTH_REQUIRED"))],
  ])("%s 401 escalates to the root unauthorized callback", async (_operation, rejectOperation) => {
    const onUnauthorized = vi.fn();
    rejectOperation();
    const renderer = await mountWorkspace(onUnauthorized);
    const input = renderer.root.findByType("input");
    const form = renderer.root.findByType("form");

    await act(async () => {
      input.props.onChange({ currentTarget: { files: [new File(["name"], "buildings.csv")], value: "" } });
    });
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test("publish 401 escalates to the root unauthorized callback", async () => {
    const onUnauthorized = vi.fn();
    mocks.publishImportJob.mockRejectedValueOnce(new ImportAdminApiError(401, "AUTH_REQUIRED"));
    const renderer = await mountWorkspace(onUnauthorized, undefined, job);
    const publishData = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.data"));

    await act(async () => publishData?.props.onClick());
    const publishNow = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.now"));
    await act(async () => publishNow?.props.onClick());

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test("opening publication explicitly focuses Cancel after showModal", async () => {
    const dialog = {
      open: false,
      showModal: vi.fn(() => { dialog.open = true; }),
      close: vi.fn(() => { dialog.open = false; }),
    };
    const cancel = { focus: vi.fn() };
    const renderer = await mountWorkspace(vi.fn(), (element) => {
      if (element.type === "dialog") return dialog;
      if (element.type === "button" && (element.props as { autoFocus?: boolean }).autoFocus) return cancel;
      return null;
    }, job);
    const publishButton = renderer.root.findAllByType("button").find((element) =>
      element.props.children === t("publish.data"));
    expect(publishButton).toBeDefined();

    await act(async () => publishButton?.props.onClick());

    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(cancel.focus).toHaveBeenCalledTimes(1);
  });

  test("uses the guarded reprocess endpoint and clears stale only after refreshed detail", async () => {
    mocks.publishImportJob.mockRejectedValueOnce(new ImportAdminApiError(409, "IMPORT_CHANGE_STALE", true));
    const refreshed = { ...job, updatedAt: "2026-07-18T00:02:00.000Z" };
    mocks.reprocessImportJob.mockResolvedValueOnce(refreshed);
    const renderer = await mountWorkspace(vi.fn(), undefined, job);
    const publishData = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.data"));
    await act(async () => publishData?.props.onClick());
    const publishNow = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.now"));
    await act(async () => publishNow?.props.onClick());
    expect(output(renderer)).toContain(t("error.stalePreview"));

    const reprocess = renderer.root.findAllByType("button").find((element) => element.props.children === t("process.reprocess"));
    await act(async () => reprocess?.props.onClick());

    expect(mocks.reprocessImportJob).toHaveBeenCalledWith(job.id, expect.any(AbortSignal));
    expect(output(renderer)).not.toContain(t("error.stalePreview"));
  });

  test("restores durable stale state on a fresh mount and reprocesses through the guarded endpoint", async () => {
    const durableStale: ImportJobDetail = {
      ...job,
      state: "reprocess_required",
      failureSummary: "IMPORT_REPROCESS_REQUIRED",
    };
    const refreshed = { ...job, updatedAt: "2026-07-18T00:03:00.000Z" };
    mocks.reprocessImportJob.mockResolvedValueOnce(refreshed);

    const renderer = await mountWorkspace(vi.fn(), undefined, durableStale);

    expect(output(renderer)).toContain(t("error.stalePreview"));
    expect(renderer.root.findAllByType("button").some((element) => element.props.children === t("publish.data"))).toBe(false);
    const reprocess = renderer.root.findAllByType("button").find((element) => element.props.children === t("process.reprocess"));
    await act(async () => reprocess?.props.onClick());

    expect(mocks.reprocessImportJob).toHaveBeenCalledWith(job.id, expect.any(AbortSignal));
    expect(output(renderer)).toContain(t("status.ready_to_publish"));
    expect(output(renderer)).not.toContain(t("error.stalePreview"));
  });

  test("does not offer stale reprocessing for a checksum or not-ready 409", async () => {
    mocks.publishImportJob.mockRejectedValueOnce(new ImportAdminApiError(409, "IMPORT_JOB_NOT_READY"));
    const renderer = await mountWorkspace(vi.fn(), undefined, job);
    const publishData = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.data"));
    await act(async () => publishData?.props.onClick());
    const publishNow = renderer.root.findAllByType("button").find((element) => element.props.children === t("publish.now"));
    await act(async () => publishNow?.props.onClick());

    expect(output(renderer)).toContain(t("error.publish"));
    expect(renderer.root.findAllByType("button").some((element) => element.props.children === t("process.reprocess"))).toBe(false);
  });

  test("offers an actual retry for a retryable processing failure", async () => {
    const failed: ImportJobDetail = {
      ...job,
      state: "processing_failed",
      failureSummary: "IMPORT_PROCESSING_RETRYABLE:00000000-0000-4000-8000-000000000901",
    };
    mocks.getImportJobDetail.mockResolvedValueOnce(job);
    const renderer = await mountWorkspace(vi.fn(), undefined, failed);
    const retry = renderer.root.findAllByType("button").find((element) => element.props.children === t("process.retry"));

    await act(async () => retry?.props.onClick());

    expect(mocks.processImportJob).toHaveBeenCalledWith(job.id, expect.any(AbortSignal));
    expect(output(renderer)).toContain(t("status.ready_to_publish"));
    expect(output(renderer)).not.toContain(t("process.retry"));
  });
});

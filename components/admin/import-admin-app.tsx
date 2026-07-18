"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ImportAdminSummary, ImportJobDetail, ImportJobListItem, RateCardVersionListItem } from "@/lib/imports/admin-contracts";
import {
  ImportAdminApiError,
  bootstrapLogin,
  getImportJobDetail,
  getImportSummary,
  listImportHistory,
  listRateCardVersions,
  type OperationalImportDataType,
} from "@/lib/client/import-admin-api";
import type { AdminTranslationKey } from "@/lib/admin-i18n";

import { AdminLocaleProvider, useAdminLocale } from "./admin-locale-provider";
import { AdminLogin } from "./admin-login";
import { ImportAdminDashboard, type AdminView } from "./import-admin-dashboard";
import styles from "./import-admin.module.css";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Phase = "loading" | "login" | "ready" | "error";

interface AdminData {
  summary: ImportAdminSummary;
  history: ImportJobListItem[];
  rateCardVersions: RateCardVersionListItem[];
  initialJob: ImportJobDetail | null;
}

const emptyData: AdminData = {
  summary: {
    currentRateCard: null,
    buildings: { active: 0, inactive: 0 },
    packages: { active: 0, inactive: 0 },
    jobs: { validating: 0, ready: 0, failed: 0 },
    recentPublications: [],
  },
  history: [],
  rateCardVersions: [],
  initialJob: null,
};

export function ImportAdminApp() {
  return (
    <AdminLocaleProvider>
      <ImportAdminController />
    </AdminLocaleProvider>
  );
}

function ImportAdminController() {
  const { locale, setLocale, t } = useAdminLocale();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<AdminData>(emptyData);
  const [selectedDataType, setSelectedDataType] = useState<OperationalImportDataType>("building");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [view, setView] = useState<AdminView>("imports");
  const [loginBusy, setLoginBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<AdminTranslationKey | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);

  const handleUnauthorized = useCallback((showExpired = true) => {
    loadController.current?.abort();
    loadController.current = null;
    refreshController.current?.abort();
    refreshController.current = null;
    setData(emptyData);
    setSelectedJobId(null);
    setLoginBusy(false);
    setErrorKey(showExpired ? "error.unauthorized" : null);
    setPhase("login");
  }, []);

  const loadAuthorized = useCallback(async (
    signal: AbortSignal,
    showExpiredOnUnauthorized = true,
  ) => {
    const jobId = readJobIdFromSearch(window.location.search);
    try {
      const [summary, history, rateCardVersions, initialJob] = await Promise.all([
        getImportSummary(signal),
        listImportHistory({ limit: 50, offset: 0 }, signal),
        listRateCardVersions(signal),
        jobId ? getImportJobDetail(jobId, signal) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      setData({ summary, history, rateCardVersions, initialJob });
      setSelectedJobId(jobId);
      if (initialJob && isOperationalDataType(initialJob.dataType)) setSelectedDataType(initialJob.dataType);
      setErrorKey(null);
      setPhase("ready");
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof ImportAdminApiError && failure.status === 401) {
        handleUnauthorized(showExpiredOnUnauthorized);
        return;
      }
      setData(emptyData);
      setSelectedJobId(null);
      setErrorKey(failure instanceof ImportAdminApiError && failure.status === 403
        ? "error.permission"
        : "error.load");
      setPhase("error");
    } finally {
      if (loadController.current?.signal === signal) loadController.current = null;
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    queueMicrotask(() => void loadAuthorized(controller.signal, false));
    return () => {
      controller.abort();
      if (loadController.current === controller) loadController.current = null;
    };
  }, [loadAuthorized]);

  useEffect(() => {
    const restore = () => {
      const jobId = readJobIdFromSearch(window.location.search);
      setData((current) => ({ ...current, initialJob: null }));
      setSelectedJobId(jobId);
      if (jobId) setView("imports");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const [summary, history, rateCardVersions] = await Promise.all([
        getImportSummary(controller.signal),
        listImportHistory({ limit: 50, offset: 0 }, controller.signal),
        listRateCardVersions(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setData((current) => ({ ...current, summary, history, rateCardVersions }));
      setErrorKey(null);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ImportAdminApiError && failure.status === 401) {
        handleUnauthorized();
        return;
      }
      setErrorKey(failure instanceof ImportAdminApiError && failure.status === 403
        ? "error.permission"
        : "error.load");
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, [handleUnauthorized]);

  useEffect(() => () => refreshController.current?.abort(), []);

  const login = async (email: string, password: string) => {
    if (loginBusy) return;
    setLoginBusy(true);
    setErrorKey(null);
    const controller = new AbortController();
    loadController.current?.abort();
    loadController.current = controller;
    try {
      await bootstrapLogin(email, password, controller.signal);
      await loadAuthorized(controller.signal);
    } catch {
      if (!controller.signal.aborted) setErrorKey("error.login");
    } finally {
      if (!controller.signal.aborted) setLoginBusy(false);
      if (loadController.current === controller) loadController.current = null;
    }
  };

  const selectJob = (jobId: string, dataType: OperationalImportDataType) => {
    setSelectedDataType(dataType);
    setSelectedJobId(jobId);
    setData((current) => ({ ...current, initialJob: current.initialJob?.id === jobId ? current.initialJob : null }));
    setView("imports");
    window.history.pushState({ jobId }, "", jobUrl(window.location.href, jobId));
  };

  const selectDataType = (dataType: OperationalImportDataType) => {
    setSelectedDataType(dataType);
    setSelectedJobId(null);
    setData((current) => ({ ...current, initialJob: null }));
    window.history.pushState({}, "", jobUrl(window.location.href, null));
  };

  if (phase === "loading") {
    return (
      <main className={`${styles.scope} admin-loading`} aria-live="polite">
        <div className="admin-loading__mark" aria-hidden="true" />
        <h1>{t("loading.title")}</h1>
        <p>{t("loading.description")}</p>
      </main>
    );
  }

  if (phase === "login") {
    return <div className={styles.scope}><AdminLogin t={t} busy={loginBusy} error={errorKey ? t(errorKey) : null} onSubmit={(email, password) => void login(email, password)} /></div>;
  }

  if (phase === "error") {
    return (
      <main className={`${styles.scope} admin-fatal-error`}>
        <h1>{t("page.title")}</h1>
        <p role="alert">{errorKey ? t(errorKey) : t("error.load")}</p>
        <button className="admin-button admin-button--primary" type="button" onClick={() => {
          setPhase("loading");
          const controller = new AbortController();
          loadController.current?.abort();
          loadController.current = controller;
          void loadAuthorized(controller.signal);
        }}>{t("action.retry")}</button>
      </main>
    );
  }

  return (
    <div className={styles.scope}>
      {errorKey ? <div className="admin-global-alert" role="alert">{t(errorKey)}</div> : null}
      <ImportAdminDashboard
        locale={locale}
        summary={data.summary}
        history={data.history}
        rateCardVersions={data.rateCardVersions}
        selectedDataType={selectedDataType}
        selectedJobId={selectedJobId}
        initialJob={data.initialJob}
        view={view}
        onSetLocale={setLocale}
        onSelectDataType={selectDataType}
        onSelectJob={selectJob}
        onResolveDataType={setSelectedDataType}
        onSelectView={setView}
        onRefresh={refresh}
        onUnauthorized={handleUnauthorized}
      />
    </div>
  );
}

export function readJobIdFromSearch(search: string): string | null {
  const values = new URLSearchParams(search).getAll("job");
  return values.length === 1 && uuidPattern.test(values[0]) ? values[0] : null;
}

export function jobUrl(href: string, jobId: string | null): string {
  const url = new URL(href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  return `${url.pathname}${url.search}${url.hash}`;
}

function isOperationalDataType(value: string): value is OperationalImportDataType {
  return value === "building" || value === "package" || value === "rate_card";
}

"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import type { AdminLocale, AdminTranslate, AdminTranslationKey } from "@/lib/admin-i18n";
import type { ImportJobDetail } from "@/lib/imports/admin-contracts";
import {
  ImportAdminApiError,
  getImportJobDetail,
  processImportJob,
  publishImportJob,
  templateDownloadUrl,
  uploadImport,
  validateImportFiles,
  type OperationalImportDataType,
} from "@/lib/client/import-admin-api";

import { datasetLabel } from "./import-history";
import { ImportJobDetail as ImportJobDetailView } from "./import-job-detail";

const transientStates = new Set(["uploading", "uploaded", "validating"]);

interface ImportWorkspaceProps {
  locale: AdminLocale;
  t: AdminTranslate;
  dataType: OperationalImportDataType;
  selectedJobId: string | null;
  initialJob: ImportJobDetail | null;
  onSelectJob(jobId: string, dataType: OperationalImportDataType): void;
  onResolveDataType(dataType: OperationalImportDataType): void;
  onRefresh(): Promise<void>;
}

type Activity = "idle" | "uploading" | "processing" | "publishing";

export function ImportWorkspace({
  locale,
  t,
  dataType,
  selectedJobId,
  initialJob,
  onSelectJob,
  onResolveDataType,
  onRefresh,
}: ImportWorkspaceProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<AdminTranslationKey | null>(null);
  const [job, setJob] = useState<ImportJobDetail | null>(initialJob?.id === selectedJobId ? initialJob : null);
  const [activity, setActivity] = useState<Activity>("idle");
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [generatedIdentifiers, setGeneratedIdentifiers] = useState<Array<{ rowNumber: number; identifier: string }>>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionSelection = useRef<{ dataType: OperationalImportDataType; jobId: string | null; controller: AbortController } | null>(null);
  const loadedJobId = useRef<string | null>(initialJob?.id ?? null);
  const tRef = useRef(t);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actionController.current?.abort();
    };
  }, []);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => {
    const pending = actionSelection.current;
    if (pending && (pending.dataType !== dataType || (pending.jobId !== null && pending.jobId !== selectedJobId))) {
      pending.controller.abort();
    }
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setConfirmationOpen(false);
        setFiles([]);
        setFileError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
    return () => { active = false; };
  }, [dataType, selectedJobId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmationOpen) {
      if (dialog.open) dialog.close();
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [confirmationOpen]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }

    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const seeded = initialJob?.id === selectedJobId ? initialJob : null;

    const load = async (known?: ImportJobDetail) => {
      await Promise.resolve();
      controller?.abort();
      controller = new AbortController();
      try {
        const detail = known ?? await getImportJobDetail(selectedJobId, controller.signal);
        if (!active) return;
        if (loadedJobId.current !== detail.id) {
          loadedJobId.current = detail.id;
          setStale(false);
          setGeneratedIdentifiers([]);
        }
        setJob(detail);
        if (detail.dataType === "building" || detail.dataType === "package" || detail.dataType === "rate_card") {
          onResolveDataType(detail.dataType);
        }
        setError(null);
        if (transientStates.has(detail.state)) {
          timer = window.setTimeout(() => void load(), 2_000);
        }
      } catch (failure) {
        if (!active || controller.signal.aborted) return;
        setError(apiMessage(failure, tRef.current, "error.load"));
      }
    };

    void load(seeded ?? undefined);
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [initialJob, onResolveDataType, selectedJobId]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files;
    const nextFiles = selected ? Array.from(selected) : [];
    const validationError = validateImportFiles(dataType, nextFiles);
    setFiles(validationError ? [] : nextFiles);
    setFileError(validationError);
    setError(null);
    if (validationError) event.currentTarget.value = "";
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (files.length === 0 || activity !== "idle") return;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const selection = { dataType, jobId: null as string | null, controller };
    actionSelection.current = selection;
    setActivity("uploading");
    setError(null);
    setStale(false);
    setGeneratedIdentifiers([]);
    try {
      const uploaded = await uploadImport(dataType, files, controller.signal);
      if (controller.signal.aborted) return;
      selection.jobId = uploaded.jobId;
      onSelectJob(uploaded.jobId, dataType);
      setNotice(t("upload.complete", { jobId: uploaded.jobId }));
      setActivity("processing");
      await processImportJob(uploaded.jobId, controller.signal);
      const [detail] = await Promise.all([
        getImportJobDetail(uploaded.jobId, controller.signal),
        onRefresh(),
      ]);
      if (controller.signal.aborted) return;
      setJob(detail);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ImportAdminApiError && failure.status === 409) setStale(true);
      setError(apiMessage(failure, t, "error.upload"));
    } finally {
      if (actionSelection.current === selection) actionSelection.current = null;
      if (mounted.current && actionController.current === controller) setActivity("idle");
    }
  };

  const reprocess = useCallback(async () => {
    if (!job || activity !== "idle") return;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const selection = { dataType: job.dataType as OperationalImportDataType, jobId: job.id, controller };
    actionSelection.current = selection;
    setActivity("processing");
    setError(null);
    try {
      await processImportJob(job.id, controller.signal);
      const [detail] = await Promise.all([
        getImportJobDetail(job.id, controller.signal),
        onRefresh(),
      ]);
      if (controller.signal.aborted) return;
      setJob(detail);
      setStale(false);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ImportAdminApiError && failure.status === 409) setStale(true);
      setError(apiMessage(failure, t, "error.processing"));
    } finally {
      if (actionSelection.current === selection) actionSelection.current = null;
      if (mounted.current && actionController.current === controller) setActivity("idle");
    }
  }, [activity, job, onRefresh, t]);

  const publish = useCallback(async () => {
    if (!job || activity !== "idle") return;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const selection = { dataType: job.dataType as OperationalImportDataType, jobId: job.id, controller };
    actionSelection.current = selection;
    setActivity("publishing");
    setError(null);
    try {
      const result = await publishImportJob(job.id, controller.signal);
      setConfirmationOpen(false);
      const [detail] = await Promise.all([
        getImportJobDetail(job.id, controller.signal),
        onRefresh(),
      ]);
      if (controller.signal.aborted) return;
      setJob(detail);
      setGeneratedIdentifiers(result.generatedIdentifiers ?? []);
      setNotice(t("publish.success"));
      setStale(false);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setConfirmationOpen(false);
      if (failure instanceof ImportAdminApiError && failure.status === 409) setStale(true);
      setError(apiMessage(failure, t, "error.publish"));
    } finally {
      if (actionSelection.current === selection) actionSelection.current = null;
      if (mounted.current && actionController.current === controller) setActivity("idle");
    }
  }, [activity, job, onRefresh, t]);

  const dataset = datasetLabel(dataType, t);
  const busy = activity !== "idle";
  const displayedJob = selectedJobId && job?.id === selectedJobId ? job : null;
  const selectedFileLabel = files.length === 1
    ? t("upload.selected", { filename: files[0].name })
    : files.length > 1
      ? t("upload.selectedFiles", { count: files.length, filenames: files.map((file) => file.name).join(", ") })
      : dataType === "rate_card" ? t("upload.rateCardDropPrompt") : t("upload.dropPrompt");

  return (
    <section className="admin-workspace" aria-labelledby="import-workspace-title">
      <header className="admin-workspace__heading">
        <h2 id="import-workspace-title">{t("workspace.title", { dataset })}</h2>
        <a className="admin-button admin-button--secondary" href={templateDownloadUrl(dataType)} download>
          <DownloadIcon />{t("workspace.downloadTemplate")}
        </a>
      </header>

      <ol className="admin-steps" aria-label={t("workspace.title", { dataset })}>
        {["workspace.uploadStep", "workspace.validateStep", "workspace.reviewStep", "workspace.publishStep"].map((key, index) => (
          <li key={key} className={stepClass(index, displayedJob)}><span>{index + 1}</span>{t(key as AdminTranslationKey)}</li>
        ))}
      </ol>

      <form className="admin-upload" onSubmit={upload}>
        <div className="admin-upload__prompt">
          <UploadIcon />
          <div>
            <strong>{selectedFileLabel}</strong>
            <span>{dataType === "rate_card" ? t("upload.rateCardAcceptedTypes") : t("upload.acceptedTypes")}</span>
          </div>
        </div>
        <label className="admin-file-picker">
          <span>{files.length > 0 ? t("upload.replace") : t("upload.choose")}</span>
          <input ref={fileInputRef} aria-label={t("upload.label")} type="file" accept=".xlsx,.csv" multiple={dataType === "rate_card"} onChange={selectFile} disabled={busy} />
        </label>
        <button className="admin-button admin-button--primary" type="submit" disabled={files.length === 0 || busy}>
          {activity === "uploading" ? t("upload.uploading") : activity === "processing" ? t("upload.processing") : t("upload.submit")}
        </button>
      </form>

      <div className="admin-status-region" aria-live="polite" aria-atomic="true">
        {fileError ? <p className="admin-alert admin-alert--error">{t(fileError)}</p> : null}
        {error ? <p className="admin-alert admin-alert--error">{error}</p> : null}
        {notice ? <p className="admin-alert admin-alert--success">{notice}</p> : null}
      </div>

      {selectedJobId && !displayedJob ? <p className="admin-empty">{t("workspace.loadingJob")}</p> : null}
      {!selectedJobId ? <p className="admin-empty">{t("workspace.emptyJob")}</p> : null}
      {displayedJob ? (
        <ImportJobDetailView
          locale={locale}
          t={t}
          job={displayedJob}
          stale={stale}
          publishing={activity === "publishing"}
          confirmationOpen={confirmationOpen}
          generatedIdentifiers={generatedIdentifiers}
          dialogRef={dialogRef}
          onRequestPublish={() => setConfirmationOpen(true)}
          onCancelPublish={() => setConfirmationOpen(false)}
          onPublish={() => void publish()}
          onReprocess={() => void reprocess()}
        />
      ) : null}
    </section>
  );
}

function stepClass(index: number, job: ImportJobDetail | null): string {
  if (!job) return index === 0 ? "admin-step admin-step--active" : "admin-step";
  if (transientStates.has(job.state)) return index <= 1 ? "admin-step admin-step--active" : "admin-step";
  if (job.state === "ready_to_publish" || job.state === "draft") return index <= 2 ? "admin-step admin-step--active" : "admin-step";
  if (job.state === "published" || job.state === "active" || job.state === "superseded") return "admin-step admin-step--active";
  return index <= 1 ? "admin-step admin-step--active" : "admin-step";
}

function apiMessage(failure: unknown, t: AdminTranslate, fallback: AdminTranslationKey): string {
  if (!(failure instanceof ImportAdminApiError)) return t(fallback);
  if (failure.status === 401) return t("error.unauthorized");
  if (failure.status === 403) return t("error.permission");
  if (failure.status === 404) return t("error.notFound");
  if (failure.status === 409) return failure.key === "IMPORT_JOB_PROCESSING"
    ? t("error.processing")
    : t("error.stalePreview");
  return t(fallback);
}

function DownloadIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10M6 8l4 4 4-4M3 15v3h14v-3" /></svg>;
}

function UploadIcon() {
  return <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M8 20H6a5 5 0 0 1-.5-10A8 8 0 0 1 21 9a5.5 5.5 0 0 1 1 11h-2M14 23V10M9.5 14.5 14 10l4.5 4.5" /></svg>;
}

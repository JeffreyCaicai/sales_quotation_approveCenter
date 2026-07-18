"use client";

import type { RefObject } from "react";

import type { AdminLocale, AdminTranslate } from "@/lib/admin-i18n";
import type { ImportJobDetail as ImportJobDetailContract } from "@/lib/imports/admin-contracts";
import { errorReportDownloadUrl, originalFileDownloadUrl } from "@/lib/client/import-admin-api";

import { datasetLabel, formatDate, Status } from "./import-history";

interface ImportJobDetailProps {
  locale: AdminLocale;
  t: AdminTranslate;
  job: ImportJobDetailContract;
  stale: boolean;
  publishing: boolean;
  confirmationOpen: boolean;
  generatedIdentifiers: Array<{ rowNumber: number; identifier: string }>;
  dialogRef?: RefObject<HTMLDialogElement | null>;
  onRequestPublish(): void;
  onCancelPublish(): void;
  onPublish(): void;
  onReprocess(): void;
}

export function ImportJobDetail({
  locale,
  t,
  job,
  stale,
  publishing,
  generatedIdentifiers,
  dialogRef,
  onRequestPublish,
  onCancelPublish,
  onPublish,
  onReprocess,
}: ImportJobDetailProps) {
  const counts = new Map<string, number>();
  for (const change of job.changes) counts.set(change.changeType, (counts.get(change.changeType) ?? 0) + 1);
  const originals = job.files.filter((file) => file.purpose === "original");
  const originalFilenames = originals.map((file) => file.originalFilename).join(", ");
  const ready = job.state === "ready_to_publish" || job.state === "draft";
  const dataset = datasetLabel(job.dataType, t);

  return (
    <section className="admin-job" aria-labelledby="current-job-title">
      {stale ? (
        <div className="admin-alert admin-alert--warning" role="alert">
          <span>{t("error.stalePreview")}</span>
          <button className="admin-button admin-button--secondary" type="button" onClick={onReprocess} disabled={publishing}>
            {t("process.reprocess")}
          </button>
        </div>
      ) : null}

      <div className="admin-job__body">
        <div className="admin-job__identity">
          <div className="admin-job__status-line">
            <span id="current-job-title">{t("job.current")}</span>
            <Status state={job.state} t={t} />
          </div>
          <strong>{originalFilenames || dataset}</strong>
          <code>{t("job.id")}: {job.id}</code>
          <span>{t("job.uploaded", { date: formatDate(job.createdAt, locale) })}</span>
          <span>{t("job.uploadedBy", { name: job.uploadedBy.displayName })}</span>
          <span>{t("job.rows", { valid: job.validRows, total: job.totalRows })}</span>
        </div>

        <section className="admin-change-summary" aria-labelledby="change-summary-title">
          <h3 id="change-summary-title">{t("changes.title")}</h3>
          {job.changes.length === 0 ? <p>{t("changes.none")}</p> : (
            <dl>
              {(["added", "modified", "deactivated", "removed", "unchanged"] as const).map((changeType) => (
                <div key={changeType}>
                  <dt>{t(`changes.${changeType}`)}</dt>
                  <dd>{counts.get(changeType) ?? 0}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      {job.dataType === "package" && ready ? <p className="admin-generated-note">{t("publish.generatedNotice")}</p> : null}
      {generatedIdentifiers.length > 0 ? (
        <div className="admin-alert admin-alert--success" role="status">
          {t("publish.generatedCodes", { count: generatedIdentifiers.length })}
          <ul>{generatedIdentifiers.map((item) => <li key={`${item.rowNumber}-${item.identifier}`}><code>{item.identifier}</code></li>)}</ul>
        </div>
      ) : null}

      {job.errors.length > 0 ? (
        <details className="admin-errors">
          <summary>{t("job.errorDetails")} · {t("job.errors", { count: job.errors.length })}</summary>
          <ol>
            {job.errors.slice(0, 20).map((error) => (
              <li key={error.id}>{t("job.errorRow", { file: error.file, row: error.row, column: error.column })}</li>
            ))}
          </ol>
        </details>
      ) : null}

      <footer className="admin-job__footer">
        <div className="admin-file-actions">
          {job.errors.length > 0 ? (
            <a href={errorReportDownloadUrl(job.id, locale)} download>
              {t("job.errorReport", { count: job.errors.length })}
            </a>
          ) : null}
          {originals.map((original) => (
            <a key={original.id} href={originalFileDownloadUrl(job.id, original.id)}>
              {originals.length === 1 ? t("job.originalFile") : t("job.originalFileNamed", { filename: original.originalFilename })}
            </a>
          ))}
        </div>
        {ready ? (
          <button
            className="admin-button admin-button--primary"
            type="button"
            onClick={onRequestPublish}
            disabled={publishing || stale}
          >
            {publishing ? t("publish.publishing") : t("publish.data")}
          </button>
        ) : null}
      </footer>

      <dialog
        ref={dialogRef}
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        aria-describedby="publish-dialog-description"
        onCancel={onCancelPublish}
        onClose={onCancelPublish}
      >
        <div className="admin-dialog__heading">
          <h2 id="publish-dialog-title">{t("publish.title", { dataset })}</h2>
          <button className="admin-icon-button" type="button" aria-label={t("publish.close")} onClick={onCancelPublish}>×</button>
        </div>
        <p id="publish-dialog-description">{t("publish.description")}</p>
        <dl>
          <div><dt>{t("job.file")}</dt><dd>{originalFilenames || "—"}</dd></div>
          <div><dt>{t("publish.validRecords", { count: job.validRows })}</dt><dd>{job.validRows}</dd></div>
        </dl>
        <div className="admin-dialog__actions">
          <button className="admin-button admin-button--secondary" type="button" autoFocus onClick={onCancelPublish} disabled={publishing}>
            {t("publish.cancel")}
          </button>
          <button className="admin-button admin-button--primary" type="button" onClick={onPublish} disabled={publishing}>
            {publishing ? t("publish.publishing") : t("publish.now")}
          </button>
        </div>
      </dialog>
    </section>
  );
}

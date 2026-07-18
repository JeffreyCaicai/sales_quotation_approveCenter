"use client";

import type { ImportDataType } from "@/db/enums";
import type { AdminLocale, AdminTranslate } from "@/lib/admin-i18n";
import type { ImportJobListItem, RateCardVersionListItem } from "@/lib/imports/admin-contracts";

import type { OperationalImportDataType } from "@/lib/client/import-admin-api";

interface ImportHistoryProps {
  locale: AdminLocale;
  t: AdminTranslate;
  jobs: ImportJobListItem[];
  rateCardVersions: RateCardVersionListItem[];
  onSelectJob(jobId: string, dataType: OperationalImportDataType): void;
  full?: boolean;
}

const activeTypes = new Set<ImportDataType>(["building", "package", "rate_card"]);

export function ImportHistory({ locale, t, jobs, rateCardVersions, onSelectJob, full = false }: ImportHistoryProps) {
  return (
    <section className="admin-history" aria-labelledby={full ? "full-history-title" : "recent-history-title"}>
      <header className="admin-section-heading">
        <div>
          <h2 id={full ? "full-history-title" : "recent-history-title"}>
            {full ? t("history.fullTitle") : t("history.title")}
          </h2>
          {full ? <p>{t("history.description")}</p> : null}
        </div>
      </header>
      {jobs.length === 0 ? (
        <p className="admin-empty">{t("history.empty")}</p>
      ) : (
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("history.dataset")}</th>
                <th scope="col">{t("history.jobId")}</th>
                <th scope="col">{t("history.status")}</th>
                <th scope="col">{t("history.uploadedBy")}</th>
                <th scope="col">{t("history.date")}</th>
                <th scope="col">{t("history.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><DatasetIcon dataType={job.dataType} />{datasetLabel(job.dataType, t)}</td>
                  <td><code>{job.id}</code></td>
                  <td><Status state={job.state} t={t} /></td>
                  <td>{job.uploadedBy.displayName}</td>
                  <td>{formatDate(job.createdAt, locale)}</td>
                  <td>
                    {activeTypes.has(job.dataType) ? (
                      <button
                        className="admin-link-button"
                        type="button"
                        onClick={() => onSelectJob(job.id, job.dataType as OperationalImportDataType)}
                      >
                        {t("history.review")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {full ? <RateCardVersions locale={locale} t={t} versions={rateCardVersions} /> : null}
    </section>
  );
}

function RateCardVersions({ locale, t, versions }: {
  locale: AdminLocale;
  t: AdminTranslate;
  versions: RateCardVersionListItem[];
}) {
  return (
    <section className="admin-version-history" aria-labelledby="rate-card-version-title">
      <h3 id="rate-card-version-title">{t("rateCard.versions")}</h3>
      {versions.length === 0 ? <p className="admin-empty">{t("rateCard.empty")}</p> : (
        <ul>
          {versions.map((version) => (
            <li key={version.id}>
              <strong>{version.versionCode}</strong>
              <span className={`admin-status admin-status--${version.status}`}>
                {version.status === "current" ? t("rateCard.current") : t("rateCard.historical")}
              </span>
              <span>{version.publishedAt ? formatDate(version.publishedAt, locale) : "—"}</span>
              <code>{version.importJobId}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Status({ state, t }: { state: ImportJobListItem["state"]; t: AdminTranslate }) {
  return <span className={`admin-status admin-status--${state}`}>{t(`status.${state}`)}</span>;
}

export function datasetLabel(dataType: ImportDataType, t: AdminTranslate): string {
  if (dataType === "customer_brand") return t("nav.customerBrand");
  return t(`dataset.${dataType}`);
}

export function formatDate(value: string, locale: AdminLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DatasetIcon({ dataType }: { dataType: ImportDataType }) {
  return (
    <svg className="admin-dataset-icon" viewBox="0 0 24 24" aria-hidden="true">
      {dataType === "building" ? (
        <><path d="M5 21V5h10v16M15 10h4v11M8 8h2M8 12h2M8 16h2M12 8h1M12 12h1M12 16h1M3 21h18" /></>
      ) : dataType === "package" ? (
        <><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10" /></>
      ) : (
        <><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6" /></>
      )}
    </svg>
  );
}

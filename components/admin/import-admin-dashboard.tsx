"use client";

import type { ImportAdminSummary, ImportJobDetail, ImportJobListItem, RateCardVersionListItem } from "@/lib/imports/admin-contracts";
import { translateAdmin, type AdminLocale, type AdminTranslate } from "@/lib/admin-i18n";
import type { OperationalImportDataType } from "@/lib/client/import-admin-api";

import { formatDate, ImportHistory } from "./import-history";
import { ImportWorkspace } from "./import-workspace";

export type AdminView = "overview" | "imports" | "history";

interface ImportAdminDashboardProps {
  locale: AdminLocale;
  summary: ImportAdminSummary;
  history: ImportJobListItem[];
  rateCardVersions: RateCardVersionListItem[];
  selectedDataType: OperationalImportDataType;
  selectedJobId: string | null;
  initialJob?: ImportJobDetail | null;
  view: AdminView;
  onSetLocale?(locale: AdminLocale): void;
  onSelectDataType(dataType: OperationalImportDataType): void;
  onSelectJob(jobId: string, dataType: OperationalImportDataType): void;
  onResolveDataType?(dataType: OperationalImportDataType): void;
  onSelectView(view: AdminView): void;
  onRefresh(): void | Promise<void>;
}

const datasets: Array<{ dataType: OperationalImportDataType; key: "nav.buildings" | "nav.packages" | "nav.rateCards" }> = [
  { dataType: "building", key: "nav.buildings" },
  { dataType: "package", key: "nav.packages" },
  { dataType: "rate_card", key: "nav.rateCards" },
];

export function ImportAdminDashboard({
  locale,
  summary,
  history,
  rateCardVersions,
  selectedDataType,
  selectedJobId,
  initialJob = null,
  view,
  onSetLocale = () => undefined,
  onSelectDataType,
  onSelectJob,
  onResolveDataType = () => undefined,
  onSelectView,
  onRefresh,
}: ImportAdminDashboardProps) {
  const t = (key: Parameters<typeof translateAdmin>[1], params?: Record<string, string | number>) =>
    translateAdmin(locale, key, params);

  return (
    <div className="admin-app">
      <header className="admin-header">
        <AdminProductMark t={t} />
        <nav className="admin-header__nav" aria-label={t("nav.primary")}>
          <button type="button" data-active={view === "overview"} onClick={() => onSelectView("overview")}>
            <GridIcon />{t("nav.overview")}
          </button>
          <button type="button" data-active={view === "imports"} onClick={() => onSelectView("imports")}>
            <DownloadIcon />{t("nav.imports")}
          </button>
          <button type="button" data-active={view === "history"} onClick={() => onSelectView("history")}>
            <HistoryIcon />{t("nav.history")}
          </button>
        </nav>
        <div className="admin-header__account">
          <div className="admin-locale-switcher" role="group" aria-label={t("locale.switcher")}>
            <button type="button" data-active={locale === "en"} aria-pressed={locale === "en"} onClick={() => onSetLocale("en")}>
              {t("locale.english")}
            </button>
            <span aria-hidden="true">/</span>
            <button type="button" data-active={locale === "zh-CN"} aria-pressed={locale === "zh-CN"} onClick={() => onSetLocale("zh-CN")}>
              {t("locale.chinese")}
            </button>
          </div>
          <span className="admin-account-icon" aria-hidden="true">A</span>
          <strong>{t("account.administrator")}</strong>
        </div>
      </header>

      <main className="admin-main">
        <header className="admin-page-heading">
          <h1>{t("page.title")}</h1>
          <p>{t("page.description")}</p>
        </header>

        <SummaryCards locale={locale} t={t} summary={summary} />

        {view === "overview" ? (
          <div className="admin-overview-grid">
            <OverviewStatus t={t} summary={summary} />
            <ImportHistory locale={locale} t={t} jobs={history.slice(0, 5)} rateCardVersions={rateCardVersions} onSelectJob={onSelectJob} />
          </div>
        ) : view === "history" ? (
          <ImportHistory locale={locale} t={t} jobs={history} rateCardVersions={rateCardVersions} onSelectJob={onSelectJob} full />
        ) : (
          <div className="admin-import-layout">
            <aside className="admin-dataset-rail" aria-label={t("nav.datasets")}>
              <h2>{t("nav.datasets")}</h2>
              <div className="admin-dataset-rail__items">
                {datasets.map((dataset) => (
                  <button
                    key={dataset.dataType}
                    type="button"
                    data-active={selectedDataType === dataset.dataType}
                    aria-current={selectedDataType === dataset.dataType ? "page" : undefined}
                    onClick={() => onSelectDataType(dataset.dataType)}
                  >
                    <DatasetIcon dataType={dataset.dataType} />
                    <span>{t(dataset.key)}</span>
                    <ChevronIcon />
                  </button>
                ))}
                <div className="admin-dataset-rail__disabled" aria-disabled="true">
                  <PeopleIcon />
                  <span><strong>{t("nav.customerBrand")}</strong><small>{t("nav.customerBrandWaiting")}</small></span>
                </div>
                <button className="admin-dataset-rail__history" type="button" onClick={() => onSelectView("history")}>
                  <HistoryIcon /><span>{t("nav.importHistory")}</span><ChevronIcon />
                </button>
              </div>
            </aside>

            <div className="admin-import-content">
              <ImportWorkspace
                locale={locale}
                t={t}
                dataType={selectedDataType}
                selectedJobId={selectedJobId}
                initialJob={initialJob}
                onSelectJob={onSelectJob}
                onResolveDataType={onResolveDataType}
                onRefresh={async () => { await onRefresh(); }}
              />
              <ImportHistory locale={locale} t={t} jobs={history.slice(0, 5)} rateCardVersions={rateCardVersions} onSelectJob={onSelectJob} />
              <button className="admin-history-link" type="button" onClick={() => onSelectView("history")}>
                {t("history.viewAll")}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function SummaryCards({ locale, t, summary }: {
  locale: AdminLocale;
  t: AdminTranslate;
  summary: ImportAdminSummary;
}) {
  const current = summary.currentRateCard;
  return (
    <section className="admin-summary" aria-label={t("nav.overview")}>
      <article>
        <span className="admin-summary__icon"><DocumentIcon /></span>
        <div>
          <h2>{t("summary.currentRateCard")}</h2>
          <strong>{current?.versionCode ?? t("summary.noRateCard")}</strong>
          <span className="admin-status admin-status--published">{current ? t("summary.published") : t("summary.noRateCard")}</span>
          <small>{current ? t("summary.lastPublished", { date: formatDate(current.publishedAt, locale) }) : "—"}</small>
        </div>
      </article>
      <article>
        <span className="admin-summary__icon"><BuildingIcon /></span>
        <div>
          <h2>{t("summary.activeBuildings")}</h2>
          <strong>{summary.buildings.active.toLocaleString(locale)}</strong>
          <small>{t("summary.inactive", { count: summary.buildings.inactive })}</small>
        </div>
      </article>
      <article>
        <span className="admin-summary__icon"><HistoryIcon /></span>
        <div>
          <h2>{t("summary.recentPublications")}</h2>
          <strong>{summary.recentPublications.length}</strong>
          <small>{summary.recentPublications.length > 0
            ? t("summary.lastPublished", { date: formatDate(summary.recentPublications[0].publishedAt ?? summary.recentPublications[0].updatedAt, locale) })
            : t("summary.noRecentPublications")}</small>
        </div>
      </article>
    </section>
  );
}

function OverviewStatus({ t, summary }: { t: AdminTranslate; summary: ImportAdminSummary }) {
  return (
    <section className="admin-overview-status" aria-labelledby="overview-status-title">
      <h2 id="overview-status-title">{t("nav.overview")}</h2>
      <dl>
        <div><dt>{t("summary.activePackages")}</dt><dd>{summary.packages.active}</dd><small>{t("summary.inactive", { count: summary.packages.inactive })}</small></div>
        <div><dt>{t("status.validating")}</dt><dd>{summary.jobs.validating}</dd><small>{t("summary.validating", { count: summary.jobs.validating })}</small></div>
        <div><dt>{t("status.ready_to_publish")}</dt><dd>{summary.jobs.ready}</dd><small>{t("summary.ready", { count: summary.jobs.ready })}</small></div>
        <div><dt>{t("status.validation_failed")}</dt><dd>{summary.jobs.failed}</dd><small>{t("summary.failed", { count: summary.jobs.failed })}</small></div>
      </dl>
    </section>
  );
}

function AdminProductMark({ t }: { t: AdminTranslate }) {
  return <div className="admin-product-mark" aria-label={t("product.name")}><span className="admin-product-mark__short">{t("product.shortName")}</span><span className="admin-product-mark__rule" aria-hidden="true" /><strong>{t("product.name")}</strong></div>;
}

function GridIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="5" /><rect x="12.5" y="2.5" width="5" height="5" /><rect x="2.5" y="12.5" width="5" height="5" /><rect x="12.5" y="12.5" width="5" height="5" /></svg>; }
function DownloadIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10M6 8l4 4 4-4M3 15v3h14v-3" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5v4h4M4.2 14A7 7 0 1 0 3.4 7M10 6v4l3 2" /></svg>; }
function DocumentIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3M8 9h4M8 12h4M8 15h3" /></svg>; }
function BuildingIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 18V4h9v14M13 8h3v10M7 7h2M7 10h2M7 13h2M3 18h14" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>; }
function PeopleIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="7" r="3" /><path d="M2.5 17c.4-3 2.2-4.5 5.5-4.5s5.1 1.5 5.5 4.5M14 5.5a3 3 0 0 1 0 5.5M15 12.5c1.8.5 2.8 2 3 4.5" /></svg>; }
function DatasetIcon({ dataType }: { dataType: OperationalImportDataType }) { return dataType === "building" ? <BuildingIcon /> : dataType === "package" ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 6 7-3.5L17 6l-7 3.5zM3 6v8l7 3.5 7-3.5V6M10 9.5v8" /></svg> : <DocumentIcon />; }

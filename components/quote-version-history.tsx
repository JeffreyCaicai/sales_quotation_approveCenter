import { useMemo } from "react";

import { BUILDINGS, CUSTOMERS, PACKAGES } from "@/lib/mock-data";
import type { ApprovalEvent, Quote, QuoteVersionSnapshot } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { Money } from "./ui";

interface QuoteVersionHistoryProps {
  quote: Quote;
}

export function QuoteVersionHistory({ quote }: QuoteVersionHistoryProps) {
  const { t, formatNumber } = useLocale();
  if (quote.versionSnapshots.length === 0) {
    return <p className="version-history__empty">{t("history.empty")}</p>;
  }

  return (
    <div className="version-history">
      <div className="version-history__heading">
        <div><h2>{t("history.versionHistory")}</h2><p>{t("history.immutableHelp")}</p></div>
        <span>{t("history.versionCount", { count: formatNumber(quote.versionSnapshots.length) })}</span>
      </div>
      <div className="version-history__list">
        {quote.versionSnapshots.map((snapshot) => {
          const events = quote.approvalHistory.filter((event) => event.version === snapshot.version);
          return (
            <article className="version-record" key={snapshot.version} aria-labelledby={`version-${snapshot.version}-heading`}>
              <SnapshotSummary snapshot={snapshot} />
              <section className="version-record__timeline" aria-labelledby={`version-${snapshot.version}-timeline`}>
                <h3 id={`version-${snapshot.version}-timeline`}>{t("history.approvalTimeline")}</h3>
                <ol className="approval-timeline">
                  {events.map((event) => <TimelineEvent event={event} key={event.id} />)}
                </ol>
              </section>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: QuoteVersionSnapshot }) {
  const { locale, t, formatNumber, formatMoney } = useLocale();
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [locale]);
  const customer = CUSTOMERS.find((item) => item.id === snapshot.customerId);
  const brand = customer?.brands.find((item) => item.id === snapshot.brandId);
  const resources = snapshot.placementMode === "package"
    ? PACKAGES.filter((item) => snapshot.placementIds.includes(item.id))
    : BUILDINGS.filter((item) => snapshot.placementIds.includes(item.id));

  return (
    <section className="version-record__snapshot" aria-labelledby={`version-${snapshot.version}-heading`}>
      <header>
        <div>
          <span>{t("history.commercialSnapshot")}</span>
          <h3 id={`version-${snapshot.version}-heading`}>{t("history.commercialSummary", { version: snapshot.version })}</h3>
        </div>
        <time dateTime={snapshot.submittedAt}>{dateTimeFormatter.format(new Date(snapshot.submittedAt))}</time>
      </header>
      <dl className="version-summary-grid">
        <div><dt>{t("history.clientBrand")}</dt><dd>{customer?.name ?? snapshot.customerId}<small>{brand?.name ?? snapshot.brandId}</small></dd></div>
        <div><dt>{t("history.resources")}</dt><dd>{t(snapshot.placementMode === "package" ? "history.packageMode" : "history.buildingMode")}<small>{resources.map((item) => item.name).join(locale === "zh-CN" ? "、" : ", ")}</small></dd></div>
        <div><dt>{t("history.parameters")}</dt><dd>{formatNumber(snapshot.weeks)} {t("wizard.weekUnit")} · {formatNumber(snapshot.spots)} {t("commercial.spot")}<small>{formatNumber(snapshot.bonus)} {t("commercial.bonus")}</small></dd></div>
        <div><dt>{t("history.audienceMetrics")}</dt><dd>{t("history.dailyTraffic", { value: formatNumber(snapshot.traffic) })}<small>{t("history.monthlyImpressions", { value: formatNumber(snapshot.impressions) })}</small></dd></div>
        <div><dt>{t("history.discount")}</dt><dd>{formatNumber(snapshot.discount)}%<small>{t("commercial.rateCard")} <Money amount={snapshot.pricing.basePrice} /></small></dd></div>
        <div><dt>{t("history.totalWithTax")}</dt><dd><Money amount={snapshot.pricing.total} /><small>{t("history.netPrice", { amount: formatMoney(snapshot.pricing.netPrice) })}</small></dd></div>
      </dl>
    </section>
  );
}

function TimelineEvent({ event }: { event: ApprovalEvent }) {
  const { locale, t } = useLocale();
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [locale]);
  const labels = { submitted: "approval.actionSubmitted", resubmitted: "approval.actionResubmitted", approved: "approval.actionApproved", returned: "approval.actionReturned" } as const;

  return (
    <li>
      <span className={`approval-timeline__marker approval-timeline__marker--${event.action}`} aria-hidden="true" />
      <div>
        <span><strong>{t(labels[event.action])}</strong><small>V{event.version}</small></span>
        <p>{event.actorName} · {t(roleLabel(event.role))}</p>
        {event.comment ? <blockquote>{event.comment}</blockquote> : null}
        <time dateTime={event.createdAt}>{dateTimeFormatter.format(new Date(event.createdAt))}</time>
      </div>
    </li>
  );
}

function roleLabel(role: ApprovalEvent["role"]) {
  if (role === "sales") return "approval.roleSales" as const;
  if (role === "manager") return "approval.roleManager" as const;
  return "approval.roleCeo" as const;
}

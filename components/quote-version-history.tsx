import { useMemo } from "react";

import { localizeApprovalEvent, localizeBuilding, localizeCustomer, localizePackage, localizeUser } from "@/lib/display-data";
import { BUILDINGS, CUSTOMERS, PACKAGES, USERS } from "@/lib/mock-data";
import type { ApprovalEvent, CommercialSelection, Quote, QuoteVersionSnapshot } from "@/lib/types";

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
  const { locale, t, formatNumber } = useLocale();
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [locale]);
  const sourceCustomer = CUSTOMERS.find((item) => item.id === snapshot.customerId);
  const customer = sourceCustomer ? localizeCustomer(sourceCustomer, locale) : undefined;
  const brand = customer?.brands.find((item) => item.id === snapshot.brandId);
  const approver = USERS.find((item) => item.id === snapshot.requiredApproverId);
  const displayApprover = approver ? localizeUser(approver, locale) : undefined;

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
        <SelectionSnapshot label={t("commercial.placement")} selection={snapshot.placement} />
        {snapshot.bonus ? <SelectionSnapshot label={t("commercial.bonus")} selection={snapshot.bonus} /> : <div><dt>{t("commercial.bonus")}</dt><dd>{t("commercial.noBonus")}</dd></div>}
        <div><dt>{t("commercial.totalGross")}</dt><dd><Money amount={snapshot.pricing.totalGross} /><small>{t("commercial.totalNett")} <Money amount={snapshot.pricing.totalNet} /></small></dd></div>
        <div><dt>{t("commercial.effectiveDiscount")}</dt><dd>{formatNumber(Math.round(snapshot.pricing.effectiveDiscountRate * 100) / 100)}%<small>{t("commercial.directApprover")}: {displayApprover?.name ?? snapshot.requiredApproverId} · {displayApprover?.title ?? "—"}</small></dd></div>
        <div><dt>{t("history.totalWithTax")}</dt><dd><Money amount={snapshot.pricing.totalIncludingTax} /></dd></div>
      </dl>
    </section>
  );
}

function SelectionSnapshot({ label, selection }: { label: string; selection: CommercialSelection }) {
  const { locale, t, formatNumber } = useLocale();
  const resources = selection.mode === "package" ? PACKAGES.filter((item) => selection.resourceIds.includes(item.id)).map((item) => localizePackage(item, locale)) : BUILDINGS.filter((item) => selection.resourceIds.includes(item.id)).map((item) => localizeBuilding(item, locale));
  return <div><dt>{label}</dt><dd>{t(selection.mode === "package" ? "history.packageMode" : "history.buildingMode")} · TVC {formatNumber(selection.tvcDurationSeconds)}s<small>{resources.map((item) => item.name).join(locale === "zh-CN" ? "、" : ", ")} · {formatNumber(selection.weeks)} {t("wizard.weekUnit")} · {formatNumber(selection.spots)} {t("commercial.spot")} · {formatNumber(selection.traffic)} / {formatNumber(selection.impressions)}</small></dd></div>;
}

function TimelineEvent({ event }: { event: ApprovalEvent }) {
  const { locale, t } = useLocale();
  const displayEvent = localizeApprovalEvent(event, locale);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [locale]);
  const labels = { submitted: "approval.actionSubmitted", resubmitted: "approval.actionResubmitted", approved: "approval.actionApproved", returned: "approval.actionReturned" } as const;

  return (
    <li>
      <span className={`approval-timeline__marker approval-timeline__marker--${displayEvent.action}`} aria-hidden="true" />
      <div>
        <span><strong>{t(labels[displayEvent.action])}</strong><small>V{displayEvent.version}</small></span>
        <p>{displayEvent.actorName} · {t(roleLabel(displayEvent.role))}</p>
        {displayEvent.comment ? <blockquote>{displayEvent.comment}</blockquote> : null}
        <time dateTime={displayEvent.createdAt}>{dateTimeFormatter.format(new Date(displayEvent.createdAt))}</time>
      </div>
    </li>
  );
}

function roleLabel(role: ApprovalEvent["role"]) {
  if (role === "sales") return "approval.roleSales" as const;
  if (role === "manager") return "approval.roleManager" as const;
  if (role === "business_control") return "approval.roleBusinessControl" as const;
  return "approval.roleCeo" as const;
}

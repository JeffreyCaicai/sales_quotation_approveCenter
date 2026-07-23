import { useMemo } from "react";

import { localizeApprovalEvent, localizeBuilding, localizeCustomer, localizePackage, localizeUser } from "@/lib/display-data";
import { BUILDINGS, CUSTOMERS, DEMO_TAX_RATE, PACKAGES, USERS } from "@/lib/mock-data";
import type { ApprovalEvent, Building, CommercialSelectionInput, Quote } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { Money } from "./ui";

interface QuotationScreenProps {
  quote: Quote;
  onBack: () => void;
  onPrint: () => void;
  onViewHistory: () => void;
}

export function QuotationScreen({ quote, onBack, onPrint, onViewHistory }: QuotationScreenProps) {
  const { locale, t, formatDate, formatNumber } = useLocale();
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }), [locale]);
  if (quote.status !== "approved") {
    return (
      <div className="quotation-screen quotation-screen--restricted">
        <button className="back-button" type="button" onClick={onBack}>← {t("quotation.back")}</button>
        <section className="quotation-access-message" role="alert">
          <span>{t("quotation.restrictedEyebrow")}</span>
          <h1>{t("quotation.restrictedTitle")}</h1>
          <p>{t("quotation.restrictedHelp")}</p>
        </section>
      </div>
    );
  }

  const sourceCustomer = CUSTOMERS.find((item) => item.id === quote.customerId);
  const customer = sourceCustomer ? localizeCustomer(sourceCustomer, locale) : undefined;
  const brand = customer?.brands.find((item) => item.id === quote.brandId);
  const sourceOwner = USERS.find((item) => item.id === quote.salesId);
  const owner = sourceOwner ? localizeUser(sourceOwner, locale) : undefined;
  const sourceCreator = USERS.find((item) => item.id === quote.createdById);
  const creator = sourceCreator ? localizeUser(sourceCreator, locale) : undefined;
  const placementResources = localizedResources(quote.placement, locale);
  const bonusResources = localizedResources(quote.bonus, locale);
  const appendixBuildings = getAppendixBuildings([quote.placement, quote.bonus]).map((item) => localizeBuilding(item, locale));
  const issueDate = quote.approvedAt ?? quote.updatedAt;
  const taxRate = DEMO_TAX_RATE * 100;

  return (
    <div className="quotation-screen">
      <div className="quotation-toolbar" aria-label={t("quotation.toolbar")}>
        <button className="back-button" type="button" onClick={onBack}>← {t("quotation.back")}</button>
        <button className="button" type="button" onClick={onViewHistory}>{t("quotation.viewHistory")}</button>
        <button className="button button--primary" type="button" onClick={onPrint}>{t("quotation.print")}</button>
      </div>

      <article className="quotation-document" aria-labelledby="quotation-title">
        <header className="quotation-document__header">
          <div className="quotation-brand">
            <span className="quotation-brand__mark" aria-hidden="true"><i /><i /><i /></span>
            <span><strong>{t("product.name")}</strong><small>{t("quotation.workspace")}</small></span>
          </div>
          <div className="quotation-title-block">
            <span>{t("quotation.formalDocument")}</span>
            <h1 id="quotation-title">{t("quotation.title")} <small>{t("quotation.subtitle")}</small></h1>
          </div>
        </header>

        <section className="quotation-reference" aria-label={t("quotation.reference")}>
          <dl>
            <div><dt>{t("quotation.quoteNumber")}</dt><dd>{quote.quoteNumber}</dd></div>
            <div><dt>{t("quotation.issueDate")}</dt><dd>{formatDate(issueDate)}</dd></div>
            <div><dt>{t("quotation.version")}</dt><dd>V{quote.version}</dd></div>
            <div><dt>{t("quotation.currency")}</dt><dd>{t("quotation.currencyIdr")}</dd></div>
          </dl>
        </section>

        <section className="quotation-section quotation-parties" aria-labelledby="quotation-client-heading">
          <header><span>01</span><h2 id="quotation-client-heading">{t("quotation.clientAndBrand")}</h2></header>
          <dl className="quotation-facts">
            <div><dt>{t("quotation.customer")}</dt><dd>{customer?.name ?? t("dashboard.unknownCustomer")}</dd></div>
            <div><dt>{t("quotation.brand")}</dt><dd>{brand?.name ?? t("approval.unknownBrand")}</dd></div>
            <div><dt>{t("quotation.salesOwner")}</dt><dd>{owner?.name ?? quote.salesId} · {owner?.title ?? t("approval.roleSales")}</dd></div>
            {creator && creator.id !== owner?.id ? <div><dt>{t("quotation.createdBy")}</dt><dd>{creator.name}</dd></div> : null}
            <div><dt>{t("quotation.campaignPeriod")}</dt><dd>{t("quotation.periodValue", { weeks: formatNumber(quote.placement?.weeks ?? 0) })}</dd></div>
          </dl>
        </section>

        <section className="quotation-section" aria-labelledby="quotation-resource-heading">
          <header><span>02</span><h2 id="quotation-resource-heading">{t("quotation.resourcesAndItems")}</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead>
                <tr><th>{t("quotation.item")}</th><th>{t("quotation.typeRegion")}</th><th>{t("quotation.period")}</th><th className="align-right">{t("quotation.campaignAmount")}</th></tr>
              </thead>
              <tbody>
                <CommercialRow label={t("commercial.placement")} selection={quote.placement} resources={placementResources} amount={quote.pricing.placementGross} />
                <CommercialRow label={t("commercial.bonus")} selection={quote.bonus} resources={bonusResources} amount={quote.pricing.bonusGross} bonus />
              </tbody>
            </table>
          </div>
          <div className="quotation-delivery-grid" aria-label={t("quotation.deliveryMetrics")}>
            <Metric label={`${t("commercial.placement")} · ${t("commercial.spot")}`} value={`${formatNumber(quote.placement?.spots ?? 0)} ${t("quotation.occurrenceUnit")}`} />
            <Metric label={`${t("commercial.bonus")} · ${t("commercial.spot")}`} value={`${formatNumber(quote.bonus?.spots ?? 0)} ${t("quotation.occurrenceUnit")}`} />
            <Metric label={t("quotation.dailyTraffic")} value={formatNumber((quote.placement?.traffic ?? 0) + (quote.bonus?.traffic ?? 0))} />
            <Metric label={t("quotation.monthlyImpressions")} value={formatNumber((quote.placement?.impressions ?? 0) + (quote.bonus?.impressions ?? 0))} />
          </div>
        </section>

        <section className="quotation-section quotation-pricing" aria-labelledby="quotation-pricing-heading">
          <header><span>03</span><h2 id="quotation-pricing-heading">{t("quotation.priceDetails")}</h2></header>
          <dl className="quotation-pricing__ledger">
            <PriceRow label={t("commercial.placementGross")} amount={quote.pricing.placementGross} />
            <PriceRow label={t("quotation.discountDeduction", { discount: formatNumber(quote.discount) })} amount={quote.pricing.placementDiscountAmount} deduction />
            <PriceRow label={t("commercial.placementNett")} amount={quote.pricing.placementNet} />
            <PriceRow label={t("commercial.bonusGross")} amount={quote.pricing.bonusGross} />
            <PriceRow label={`${t("commercial.bonusNett")} · ${t("commercial.free")}`} amount={quote.pricing.bonusNet} />
            <PriceRow label={t("commercial.totalGross")} amount={quote.pricing.totalGross} />
            <PriceRow label={t("commercial.totalNett")} amount={quote.pricing.totalNet} />
            <PriceRow label={t("quotation.simulatedTax", { tax: formatNumber(taxRate) })} amount={quote.pricing.tax} />
            <div className="quotation-total"><dt>{t("quotation.totalWithTax")}</dt><dd><Money amount={quote.pricing.totalIncludingTax} /></dd></div>
          </dl>
        </section>

        <section className="quotation-section quotation-terms" aria-labelledby="quotation-terms-heading">
          <header><span>04</span><h2 id="quotation-terms-heading">{t("quotation.terms")}</h2></header>
          <ol>
            <li>{t("quotation.termValidity")}</li>
            <li>{t("quotation.termRateCard")}</li>
            <li>{t("quotation.termCurrencyTax", { tax: formatNumber(taxRate) })}</li>
            <li>{t("quotation.termDemo")}</li>
          </ol>
        </section>

        <section className="quotation-section quotation-appendix" aria-labelledby="quotation-appendix-heading">
          <header><span>A</span><h2 id="quotation-appendix-heading">{t("quotation.appendix")}</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead><tr><th>{t("quotation.buildingColumn")}</th><th>{t("quotation.regionType")}</th><th className="align-right">{t("quotation.dailyTraffic")}</th><th className="align-right">{t("quotation.monthlyImpressions")}</th></tr></thead>
              <tbody>
                {appendixBuildings.map((building) => (
                  <tr key={building.id}>
                    <td><strong>{building.name}</strong></td>
                    <td>{building.location}<small>{building.category}</small></td>
                    <td className="align-right">{formatNumber(building.traffic)}</td>
                    <td className="align-right">{formatNumber(building.impressions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="quotation-section quotation-approval-record" aria-labelledby="quotation-approval-heading">
          <header><span>✓</span><h2 id="quotation-approval-heading">{t("quotation.approvalRecord")}</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead><tr><th>{t("quotation.approvalAction")}</th><th>{t("quotation.approver")}</th><th>{t("quotation.version")}</th><th>{t("quotation.timeComment")}</th></tr></thead>
              <tbody>
                {quote.approvalHistory.map((event) => {
                  const displayEvent = localizeApprovalEvent(event, locale);
                  return (
                    <tr key={displayEvent.id}>
                      <td><strong>{t(approvalActionLabel(displayEvent))}</strong></td>
                      <td>{displayEvent.actorName}<small>{t(approvalRoleLabel(displayEvent))}</small></td>
                      <td>V{displayEvent.version}</td>
                      <td>{dateTimeFormatter.format(new Date(displayEvent.createdAt))}{displayEvent.comment ? <small>{displayEvent.comment}</small> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="quotation-approval-stamp"><span aria-hidden="true">✓</span><strong>{t("quotation.approved")}</strong> {t("quotation.approvedNotice")}</p>
        </section>

        <footer className="quotation-document__footer">
          <span>{quote.quoteNumber} · V{quote.version}</span>
          <span>{t("quotation.demoFooter")}</span>
        </footer>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function PriceRow({ label, amount, deduction = false }: { label: string; amount: number; deduction?: boolean }) {
  return (
    <div className={deduction ? "quotation-pricing__deduction" : undefined}>
      <dt>{label}</dt>
      <dd>{deduction ? "− " : ""}<Money amount={amount} /></dd>
    </div>
  );
}

function getAppendixBuildings(selections: Array<CommercialSelectionInput | undefined>): Building[] {
  const buildingIds = new Set(selections.flatMap((selection) => {
    if (!selection) return [];
    if (selection.mode === "building") return selection.resourceIds ?? [];
    return PACKAGES.filter((item) => (selection.resourceIds ?? []).includes(item.id)).flatMap((item) => item.buildingIds);
  }));
  return BUILDINGS.filter((building) => buildingIds.has(building.id));
}

function approvalActionLabel(event: ApprovalEvent) {
  const labels = {
    submitted: "approval.actionSubmitted",
    resubmitted: "approval.actionResubmitted",
    approved: "approval.actionApproved",
    returned: "approval.actionReturned",
  } as const;
  return labels[event.action];
}

function approvalRoleLabel(event: ApprovalEvent) {
  if (event.role === "sales") return "approval.roleSales" as const;
  if (event.role === "manager") return "approval.roleManager" as const;
  if (event.role === "business_control") return "approval.roleBusinessControl" as const;
  return "approval.roleCeo" as const;
}

function localizedResources(selection: CommercialSelectionInput | undefined, locale: "en" | "zh-CN") {
  if (!selection) return [];
  const resourceIds = selection.resourceIds ?? [];
  return selection.mode === "package" ? PACKAGES.filter((item) => resourceIds.includes(item.id)).map((item) => localizePackage(item, locale)) : BUILDINGS.filter((item) => resourceIds.includes(item.id)).map((item) => localizeBuilding(item, locale));
}

function CommercialRow({ label, selection, resources, amount, bonus = false }: { label: string; selection?: CommercialSelectionInput; resources: ReturnType<typeof localizedResources>; amount: number; bonus?: boolean }) {
  const { t, formatNumber } = useLocale();
  if (!selection) return <tr><td><strong>{label}</strong><small>{t("commercial.noBonus")}</small></td><td>—</td><td>—</td><td className="align-right"><strong>{t("commercial.free")}</strong></td></tr>;
  return <tr><td><strong>{label}</strong><small>{resources.map((item) => item.name).join(", ")}</small></td><td>{t(selection.mode === "package" ? "quotation.package" : "quotation.building")}<small>TVC {formatNumber(selection.tvcDurationSeconds ?? 0)}s</small></td><td>{formatNumber(selection.weeks ?? 0)} {t("wizard.weekUnit")} · {formatNumber(selection.spots ?? 0)} {t("commercial.spot")}</td><td className="align-right"><Money amount={amount} />{bonus ? <small>{t("commercial.free")}</small> : null}</td></tr>;
}

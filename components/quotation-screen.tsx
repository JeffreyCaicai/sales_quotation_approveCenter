import { useMemo } from "react";

import { localizeApprovalEvent, localizeBuilding, localizeCustomer, localizePackage, localizeUser } from "@/lib/display-data";
import { BUILDINGS, CUSTOMERS, DEMO_TAX_RATE, PACKAGES, USERS } from "@/lib/mock-data";
import type { ApprovalEvent, Building, Quote } from "@/lib/types";

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
  const selectedPackages = quote.placementMode === "package"
    ? PACKAGES.filter((item) => quote.placementIds.includes(item.id)).map((item) => localizePackage(item, locale))
    : [];
  const selectedBuildings = quote.placementMode === "building"
    ? BUILDINGS.filter((item) => quote.placementIds.includes(item.id)).map((item) => localizeBuilding(item, locale))
    : [];
  const resources = quote.placementMode === "package" ? selectedPackages : selectedBuildings;
  const appendixBuildings = getAppendixBuildings(quote, selectedPackages).map((item) => localizeBuilding(item, locale));
  const traffic = resources.reduce((total, item) => total + item.traffic, 0);
  const impressions = resources.reduce((total, item) => total + item.impressions, 0);
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
            <div><dt>{t("quotation.campaignPeriod")}</dt><dd>{t("quotation.periodValue", { weeks: formatNumber(quote.weeks) })}</dd></div>
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
                {resources.map((resource) => (
                  <tr key={resource.id}>
                    <td><strong>{resource.name}</strong><small>{resource.category}</small></td>
                    <td>{t(quote.placementMode === "package" ? "quotation.package" : "quotation.building")}<small>{resource.location}</small></td>
                    <td>{formatNumber(quote.weeks)} {t("wizard.weekUnit")}</td>
                    <td className="align-right"><Money amount={Math.round(resource.priceIdr * (quote.weeks / 4))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="quotation-delivery-grid" aria-label={t("quotation.deliveryMetrics")}>
            <Metric label={t("commercial.spot")} value={`${formatNumber(quote.spots)} ${t("quotation.occurrenceUnit")}`} />
            <Metric label={t("commercial.bonus")} value={`${formatNumber(quote.bonus)} ${t("quotation.occurrenceUnit")}`} />
            <Metric label={t("quotation.dailyTraffic")} value={formatNumber(traffic)} />
            <Metric label={t("quotation.monthlyImpressions")} value={formatNumber(impressions)} />
          </div>
        </section>

        <section className="quotation-section quotation-pricing" aria-labelledby="quotation-pricing-heading">
          <header><span>03</span><h2 id="quotation-pricing-heading">{t("quotation.priceDetails")}</h2></header>
          <dl className="quotation-pricing__ledger">
            <PriceRow label={t("quotation.basePrice")} amount={quote.pricing.basePrice} />
            <PriceRow label={t("quotation.discountDeduction", { discount: formatNumber(quote.discount) })} amount={quote.pricing.discountAmount} deduction />
            <PriceRow label={t("quotation.netPrice")} amount={quote.pricing.netPrice} />
            <PriceRow label={t("quotation.simulatedTax", { tax: formatNumber(taxRate) })} amount={quote.pricing.tax} />
            <div className="quotation-total"><dt>{t("quotation.totalWithTax")}</dt><dd><Money amount={quote.pricing.total} /></dd></div>
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

function getAppendixBuildings(quote: Quote, selectedPackages: typeof PACKAGES): Building[] {
  if (quote.placementMode === "building") {
    return BUILDINGS.filter((building) => quote.placementIds.includes(building.id));
  }

  const buildingIds = new Set(selectedPackages.flatMap((item) => item.buildingIds));
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
  return "approval.roleCeo" as const;
}

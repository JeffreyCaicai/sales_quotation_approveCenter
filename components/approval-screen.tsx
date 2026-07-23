"use client";

import { useEffect, useRef, useState } from "react";
import { localizeBuilding, localizeCustomer, localizePackage, localizeUser } from "@/lib/display-data";
import { APPROVAL_DIRECTORY, BUILDINGS, CUSTOMERS, PACKAGES, USERS } from "@/lib/mock-data";
import { canApproveQuote, getDiscountBand } from "@/lib/quotation";
import type { TranslationKey } from "@/lib/i18n";
import type { CommercialSelectionInput, Quote, User } from "@/lib/types";
import { useLocale } from "./locale-provider";
import { QuoteVersionHistory } from "./quote-version-history";
import { Money, StatusBadge } from "./ui";

interface ApprovalScreenProps { quote: Quote; actor: User; onApprove: () => void; onReturn: (reason: string) => void; onBack: () => void; }
type Decision = "approve" | "return";

export function ApprovalScreen({ quote, actor, onApprove, onReturn, onBack }: ApprovalScreenProps) {
  const { locale, t, formatNumber } = useLocale();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<TranslationKey | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const sourceCustomer = CUSTOMERS.find((item) => item.id === quote.customerId);
  const customer = sourceCustomer ? localizeCustomer(sourceCustomer, locale) : undefined;
  const brand = customer?.brands.find((item) => item.id === quote.brandId);
  const ownerSource = USERS.find((item) => item.id === quote.salesId);
  const owner = ownerSource ? localizeUser(ownerSource, locale) : undefined;
  const creatorSource = USERS.find((item) => item.id === quote.createdById);
  const creator = creatorSource ? localizeUser(creatorSource, locale) : undefined;
  const approver = USERS.find((item) => item.id === quote.requiredApproverId);
  const displayApprover = approver ? localizeUser(approver, locale) : undefined;
  const band = getDiscountBand(quote.discount);
  const canDecide = canApproveQuote(quote, actor, APPROVAL_DIRECTORY);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!decision || !dialog) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); restoreFocusRef.current?.focus(); };
  }, [decision]);

  const closeDialog = () => { setDecision(null); setReason(""); setReasonError(null); };
  const confirmReturn = () => {
    const normalized = reason.trim();
    if (!normalized) { setReasonError("validation.returnReasonRequired"); return; }
    onReturn(normalized); closeDialog();
  };

  return <div className="approval-screen">
    <button className="back-button" type="button" onClick={onBack}>← {t("approval.back")}</button>
    <header className="approval-heading"><div><p className="eyebrow">{t("approval.eyebrow")}</p><h1>{t("approval.title")}</h1><p>{quote.quoteNumber} · V{quote.version}</p></div><div className="approval-heading__badges"><span className="version-badge">{t("approval.version", { version: quote.version })}</span><StatusBadge status={quote.status} /></div></header>
    <div className="approval-layout">
      <main className="approval-content">
        <section className="approval-card"><header className="approval-card__heading"><span>01</span><div><h2>{t("approval.clientAndBrand")}</h2><p>{t("approval.commercialSubject")}</p></div></header><dl className="approval-facts">
          <div><dt>{t("approval.customer")}</dt><dd>{customer?.name ?? t("dashboard.unknownCustomer")}</dd></div><div><dt>{t("approval.brand")}</dt><dd>{brand?.name ?? t("approval.unknownBrand")}</dd></div><div><dt>{t("approval.owner")}</dt><dd>{owner?.name ?? quote.salesId}</dd></div>{creator && creator.id !== owner?.id ? <div><dt>{t("approval.createdBy")}</dt><dd>{creator.name}</dd></div> : null}<div><dt>{t("commercial.directApprover")}</dt><dd>{displayApprover?.name ?? "—"}</dd></div>
        </dl></section>
        <SelectionCard index="02" title={t("commercial.placement")} selection={quote.placement} gross={quote.pricing.placementGross} />
        <SelectionCard index="03" title={t("commercial.bonus")} selection={quote.bonus} gross={quote.pricing.bonusGross} bonus />
        <section className="approval-card"><header className="approval-card__heading"><span>04</span><div><h2>{t("approval.versionAndHistory")}</h2><p>{t("approval.versionHelp")}</p></div></header><QuoteVersionHistory quote={quote} /></section>
      </main>
      <aside className="approval-sidebar">
        <section className={`approval-risk approval-risk--${band}`}><span>{t("wizard.customerDiscount")}</span><strong>{formatNumber(quote.discount)}%</strong><p>{t(riskMessageKey(band))}</p></section>
        <section className="approval-ledger"><header><span>{t("approval.pricingSummary")}</span><h2>{t("approval.calculationDetails")}</h2></header><dl>
          <LedgerRow label={t("commercial.placementGross")} amount={quote.pricing.placementGross} />
          <LedgerRow label={t("approval.discountDeduction", { discount: formatNumber(quote.discount) })} amount={-quote.pricing.placementDiscountAmount} discount />
          <LedgerRow label={t("commercial.placementNett")} amount={quote.pricing.placementNet} />
          <LedgerRow label={t("commercial.bonusGross")} amount={quote.pricing.bonusGross} />
          <LedgerRow label={`${t("commercial.bonusNett")} · ${t("commercial.free")}`} amount={quote.pricing.bonusNet} />
          <LedgerRow label={t("commercial.totalGross")} amount={quote.pricing.totalGross} />
          <LedgerRow label={t("commercial.totalNett")} amount={quote.pricing.totalNet} />
          <LedgerRow label={t("approval.simulatedTax", { tax: formatNumber(6) })} amount={quote.pricing.tax} />
          <LedgerRow label={t("approval.totalWithTax")} amount={quote.pricing.totalIncludingTax} total />
        </dl><p>{t("approval.demoNotice")}</p></section>
        {canDecide ? <div className="approval-actions"><button className="button button--primary" type="button" onClick={() => setDecision("approve")}>{t("approval.approve")}</button><button className="button button--danger" type="button" onClick={() => setDecision("return")}>{t("approval.return")}</button></div> : <p className="approval-readonly">{t("approval.readOnly")}</p>}
      </aside>
    </div>
    <dialog ref={dialogRef} className="modal decision-modal" onCancel={(event) => { event.preventDefault(); closeDialog(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className="modal__header"><h2>{t(decision === "return" ? "approval.returnTitle" : "approval.approveTitle")}</h2><button className="icon-button" type="button" onClick={closeDialog}>×</button></div>
      <div className="modal__body">{decision === "return" ? <label className="decision-reason"><span>{t("approval.returnReason")} <em>{t("approval.required")}</em></span><textarea autoFocus value={reason} rows={5} aria-invalid={Boolean(reasonError)} placeholder={t("approval.returnPlaceholder")} onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(null); }} />{reasonError ? <span className="field-error" role="alert">{t(reasonError)}</span> : <small>{t("approval.returnHelp")}</small>}</label> : <p>{t("approval.approvalRecordNotice", { outcome: t("approval.approveFinal") })}</p>}</div>
      <div className="modal__footer decision-modal__footer"><button className="button button--secondary" type="button" onClick={closeDialog}>{t("approval.cancel")}</button>{decision === "return" ? <button className="button button--danger" type="button" onClick={confirmReturn}>{t("approval.confirmReturn")}</button> : <button autoFocus className="button button--primary" type="button" onClick={() => { onApprove(); closeDialog(); }}>{t("approval.confirmApprove")}</button>}</div>
    </dialog>
  </div>;
}

function SelectionCard({ index, title, selection, gross, bonus = false }: { index: string; title: string; selection?: CommercialSelectionInput; gross: number; bonus?: boolean }) {
  const { locale, t, formatNumber } = useLocale();
  if (!selection) return <section className="approval-card"><header className="approval-card__heading"><span>{index}</span><div><h2>{title}</h2><p>{t("commercial.noBonus")}</p></div></header></section>;
  const resourceIds = selection.resourceIds ?? [];
  const resources = selection.mode === "package" ? PACKAGES.filter((item) => resourceIds.includes(item.id)).map((item) => localizePackage(item, locale)) : BUILDINGS.filter((item) => resourceIds.includes(item.id)).map((item) => localizeBuilding(item, locale));
  return <section className="approval-card"><header className="approval-card__heading"><span>{index}</span><div><h2>{title}</h2><p>{t(selection.mode === "package" ? "wizard.packageMode" : "wizard.buildingMode")}</p></div></header><dl className="approval-facts"><div><dt>TVC</dt><dd>{formatNumber(selection.tvcDurationSeconds ?? 0)}s</dd></div><div><dt>{t("history.parameters")}</dt><dd>{formatNumber(selection.weeks ?? 0)} {t("wizard.weekUnit")} · {formatNumber(selection.spots ?? 0)} {t("commercial.spot")}</dd></div><div><dt>{t("history.audienceMetrics")}</dt><dd>{formatNumber(selection.traffic ?? 0)} · {formatNumber(selection.impressions ?? 0)}</dd></div><div><dt>{bonus ? t("commercial.bonusGross") : t("commercial.placementGross")}</dt><dd><Money amount={gross} />{bonus ? <small>{t("commercial.free")}</small> : null}</dd></div></dl><ul className="approval-resource-list">{resources.map((resource) => <li key={resource.id}><span><strong>{resource.name}</strong><small>{resource.location} · {resource.category}</small></span><Money amount={resource.priceIdr} /></li>)}</ul></section>;
}

function LedgerRow({ label, amount, discount = false, total = false }: { label: string; amount: number; discount?: boolean; total?: boolean }) { return <div className={total ? "approval-ledger__total" : discount ? "approval-ledger__discount" : undefined}><dt>{label}</dt><dd>{amount < 0 ? "−" : ""}<Money amount={Math.abs(amount)} /></dd></div>; }
function riskMessageKey(band: ReturnType<typeof getDiscountBand>) { if (band === "executive") return "approval.riskExecutive" as const; if (band === "elevated") return "approval.riskElevated" as const; return "approval.riskStandard" as const; }

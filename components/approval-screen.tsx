"use client";

import { useEffect, useRef, useState } from "react";

import { localizeBuilding, localizeCustomer, localizePackage, localizeUser } from "@/lib/display-data";
import { BUILDINGS, CUSTOMERS, PACKAGES, USERS } from "@/lib/mock-data";
import { canApproveQuote, getDiscountBand } from "@/lib/quotation";
import type { TranslationKey } from "@/lib/i18n";
import type { Quote, User } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { QuoteVersionHistory } from "./quote-version-history";
import { Money, StatusBadge } from "./ui";

interface ApprovalScreenProps {
  quote: Quote;
  actor: User;
  onApprove: () => void;
  onReturn: (reason: string) => void;
  onBack: () => void;
}

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
  const sourceOwner = USERS.find((item) => item.id === quote.salesId);
  const owner = sourceOwner ? localizeUser(sourceOwner, locale) : undefined;
  const resources = quote.placementMode === "package"
    ? PACKAGES.filter((item) => quote.placementIds.includes(item.id)).map((item) => localizePackage(item, locale))
    : BUILDINGS.filter((item) => quote.placementIds.includes(item.id)).map((item) => localizeBuilding(item, locale));
  const band = getDiscountBand(quote.discount);
  const canDecide = canApproveQuote(quote, actor);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!decision || !dialog) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      restoreFocusRef.current?.focus();
    };
  }, [decision]);

  const closeDialog = () => {
    setDecision(null);
    setReason("");
    setReasonError(null);
  };

  const confirmReturn = () => {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setReasonError("validation.returnReasonRequired");
      return;
    }
    onReturn(normalizedReason);
    closeDialog();
  };

  return (
    <div className="approval-screen">
      <button className="back-button" type="button" onClick={onBack}>← {t("approval.back")}</button>
      <header className="approval-heading">
        <div>
          <p className="eyebrow">{t("approval.eyebrow")}</p>
          <h1>{t("approval.title")}</h1>
          <p>{quote.quoteNumber} · V{quote.version}</p>
        </div>
        <div className="approval-heading__badges">
          <span className="version-badge">{t("approval.version", { version: quote.version })}</span>
          <StatusBadge status={quote.status} />
        </div>
      </header>

      <div className="approval-layout">
        <main className="approval-content">
          <section className="approval-card" aria-labelledby="approval-client-heading">
            <header className="approval-card__heading">
              <span>01</span>
              <div><h2 id="approval-client-heading">{t("approval.clientAndBrand")}</h2><p>{t("approval.commercialSubject")}</p></div>
            </header>
            <dl className="approval-facts">
              <div><dt>{t("approval.customer")}</dt><dd>{customer?.name ?? t("dashboard.unknownCustomer")}</dd></div>
              <div><dt>{t("approval.brand")}</dt><dd>{brand?.name ?? t("approval.unknownBrand")}</dd></div>
              <div><dt>{t("approval.owner")}</dt><dd>{owner?.name ?? quote.salesId}</dd></div>
              <div><dt>{t("approval.parameters")}</dt><dd>{formatNumber(quote.weeks)} {t("wizard.weekUnit")} · {formatNumber(quote.spots)} {t("commercial.spot")} · {formatNumber(quote.bonus)} {t("commercial.bonus")}</dd></div>
            </dl>
          </section>

          <section className="approval-card" aria-labelledby="approval-placement-heading">
            <header className="approval-card__heading">
              <span>02</span>
              <div><h2 id="approval-placement-heading">{t("approval.resources")}</h2><p>{t(quote.placementMode === "package" ? "wizard.packageMode" : "wizard.buildingMode")}</p></div>
            </header>
            <ul className="approval-resource-list">
              {resources.map((resource) => (
                <li key={resource.id}>
                  <span><strong>{resource.name}</strong><small>{resource.location} · {resource.category}</small></span>
                  <Money amount={resource.priceIdr} />
                </li>
              ))}
            </ul>
          </section>

          <section className="approval-card" aria-labelledby="approval-timeline-heading">
            <header className="approval-card__heading">
              <span>03</span>
              <div><h2 id="approval-timeline-heading">{t("approval.versionAndHistory")}</h2><p>{t("approval.versionHelp")}</p></div>
            </header>
            <QuoteVersionHistory quote={quote} />
          </section>
        </main>

        <aside className="approval-sidebar">
          <section className={`approval-risk approval-risk--${band}`} aria-label={t("approval.discountRisk")}>
            <span>{t("approval.discountRisk")}</span>
            <strong>{formatNumber(quote.discount)}%</strong>
            <p>{t(riskMessageKey(band))}</p>
          </section>

          <section className="approval-ledger" aria-labelledby="approval-ledger-heading">
            <header><span>{t("approval.pricingSummary")}</span><h2 id="approval-ledger-heading">{t("approval.calculationDetails")}</h2></header>
            <dl>
              <LedgerRow label={t("approval.basePrice")} amount={quote.pricing.basePrice} />
              <LedgerRow label={t("approval.discountDeduction", { discount: formatNumber(quote.discount) })} amount={-quote.pricing.discountAmount} discount />
              <LedgerRow label={t("approval.netPrice")} amount={quote.pricing.netPrice} />
              <LedgerRow label={t("approval.simulatedTax", { tax: formatNumber(6) })} amount={quote.pricing.tax} />
              <LedgerRow label={t("approval.totalWithTax")} amount={quote.pricing.total} total />
            </dl>
            <p>{t("approval.demoNotice")}</p>
          </section>

          {canDecide ? (
            <div className="approval-actions" aria-label={t("approval.actions")}>
              <button className="button button--primary" type="button" onClick={() => setDecision("approve")}>{t("approval.approve")}</button>
              <button className="button button--danger" type="button" onClick={() => setDecision("return")}>{t("approval.return")}</button>
            </div>
          ) : (
            <p className="approval-readonly">{t("approval.readOnly")}</p>
          )}
        </aside>
      </div>

      <dialog
        ref={dialogRef}
        className="modal decision-modal"
        aria-labelledby="decision-modal-title"
        aria-describedby="decision-modal-description"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className="modal__header">
          <h2 id="decision-modal-title">{t(decision === "return" ? "approval.returnTitle" : "approval.approveTitle")}</h2>
          <button className="icon-button" type="button" onClick={closeDialog} aria-label={t("approval.close")}>×</button>
        </div>
        <div className="modal__body" id="decision-modal-description">
          {decision === "return" ? (
            <label className="decision-reason">
              <span>{t("approval.returnReason")} <em>{t("approval.required")}</em></span>
              <textarea
                autoFocus
                value={reason}
                rows={5}
                aria-invalid={Boolean(reasonError)}
                aria-describedby={reasonError ? "return-reason-error" : "return-reason-help"}
                placeholder={t("approval.returnPlaceholder")}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError(null);
                }}
              />
              <small id="return-reason-help">{t("approval.returnHelp")}</small>
              {reasonError ? <span className="field-error" id="return-reason-error" role="alert">{t(reasonError)}</span> : null}
            </label>
          ) : (
            <p>{t("approval.approvalRecordNotice", { outcome: t(quote.discount > 70 && actor.role === "manager" ? "approval.approveToCeo" : "approval.approveFinal") })}</p>
          )}
        </div>
        <div className="modal__footer decision-modal__footer">
          <button className="button button--secondary" type="button" onClick={closeDialog}>{t("approval.cancel")}</button>
          {decision === "return" ? (
            <button className="button button--danger" type="button" onClick={confirmReturn}>{t("approval.confirmReturn")}</button>
          ) : (
            <button autoFocus className="button button--primary" type="button" onClick={() => {
              onApprove();
              closeDialog();
            }}>{t("approval.confirmApprove")}</button>
          )}
        </div>
      </dialog>
    </div>
  );
}

function LedgerRow({ label, amount, discount = false, total = false }: {
  label: string;
  amount: number;
  discount?: boolean;
  total?: boolean;
}) {
  return (
    <div className={total ? "approval-ledger__total" : discount ? "approval-ledger__discount" : undefined}>
      <dt>{label}</dt>
      <dd>{amount < 0 ? "−" : ""}<Money amount={Math.abs(amount)} /></dd>
    </div>
  );
}

function riskMessageKey(band: ReturnType<typeof getDiscountBand>) {
  if (band === "executive") return "approval.riskExecutive" as const;
  if (band === "elevated") return "approval.riskElevated" as const;
  return "approval.riskStandard" as const;
}

import { localizeApprovalEvent } from "@/lib/display-data";
import type { ApprovalEvent, Quote } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { QuoteVersionHistory } from "./quote-version-history";
import { StatusBadge } from "./ui";

interface QuoteProgressScreenProps {
  quote: Quote;
  backLabel: string;
  onBack: () => void;
  onEdit: () => void;
}

export function QuoteProgressScreen({ quote, backLabel, onBack, onEdit }: QuoteProgressScreenProps) {
  const { locale, t } = useLocale();
  const sourceLatestReturn = getLatestReturn(quote.approvalHistory);
  const latestReturn = sourceLatestReturn ? localizeApprovalEvent(sourceLatestReturn, locale) : undefined;
  const isReturned = quote.status === "returned";
  const isApproved = quote.status === "approved";

  return (
    <div className="quote-progress-screen">
      <button className="back-button" type="button" onClick={onBack}>← {backLabel}</button>
      <header className="approval-heading">
        <div>
          <p className="eyebrow">{t("progress.eyebrow")}</p>
          <h1>{t("progress.title")}</h1>
          <p>{quote.quoteNumber} · {t("progress.currentVersion", { version: quote.version })}</p>
        </div>
        <div className="approval-heading__badges">
          <span className="version-badge">{t("progress.readOnly")}</span>
          <StatusBadge status={quote.status} />
        </div>
      </header>

      {isApproved ? (
        <section className="progress-callout" aria-label={t("progress.currentProgress")} role="status" aria-live="polite">
          <strong>{t("progress.approved")}</strong>
        </section>
      ) : latestReturn ? (
        <section className="latest-return" aria-labelledby="latest-return-heading">
          <div>
            <span>{t(isReturned ? "progress.salesActionNeeded" : "progress.priorReturn")}</span>
            <h2 id="latest-return-heading">{t("progress.latestReturnReason")}</h2>
          </div>
          <blockquote>{latestReturn.comment}</blockquote>
          <p>{latestReturn.actorName} · {t(latestReturn.role === "ceo" ? "approval.roleCeo" : "approval.roleManager")}</p>
        </section>
      ) : (
        <section className="progress-callout" aria-label={t("progress.currentProgress")}>
          <strong>{t(pendingProgressKey(quote.status))}</strong>
          <p>{t("progress.readOnlyHelp")}</p>
        </section>
      )}

      <QuoteVersionHistory quote={quote} />

      {isReturned ? (
        <div className="progress-actions">
          <p>{t("progress.editHelp")}</p>
          <button className="button button--primary" type="button" onClick={onEdit}>{t("progress.reviseResubmit")}</button>
        </div>
      ) : null}
    </div>
  );
}

function pendingProgressKey(status: Quote["status"]) {
  if (status === "pending_ceo") return "progress.waitingCeo" as const;
  return "progress.waitingManager" as const;
}

function getLatestReturn(history: ApprovalEvent[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event.action === "returned") return event;
  }
  return undefined;
}

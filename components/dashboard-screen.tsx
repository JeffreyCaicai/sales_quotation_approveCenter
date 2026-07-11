import { localizeCustomer, localizeUser } from "@/lib/display-data";
import { CUSTOMERS, USERS } from "@/lib/mock-data";
import type { TranslationKey } from "@/lib/i18n";
import { getDiscountBand } from "@/lib/quotation";
import { quotesForRole } from "@/lib/store";
import type { DiscountBand, Quote, Role, User } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { Money, StatusBadge } from "./ui";

interface DashboardScreenProps {
  user: User;
  quotes: Quote[];
  onAction: (label: string, quote?: Quote) => void;
}

export function DashboardScreen({ user, quotes, onAction }: DashboardScreenProps) {
  const visibleQuotes = quotesForRole(quotes, user.role, user.id);

  if (user.role === "sales") {
    return <SalesDashboard user={user} quotes={visibleQuotes} onAction={onAction} />;
  }

  if (user.role === "manager") {
    return <ManagerDashboard user={user} quotes={visibleQuotes} onAction={onAction} />;
  }

  return <CeoDashboard user={user} quotes={quotes} executiveQueue={visibleQuotes} onAction={onAction} />;
}

function SalesDashboard({ user, quotes, onAction }: DashboardScreenProps) {
  const { formatNumber, locale, t } = useLocale();
  const displayUser = localizeUser(user, locale);
  const counts = {
    draft: quotes.filter((quote) => quote.status === "draft").length,
    returned: quotes.filter((quote) => quote.status === "returned").length,
    pending: quotes.filter((quote) => quote.status === "pending_manager" || quote.status === "pending_ceo").length,
    approved: quotes.filter((quote) => quote.status === "approved").length,
    total: quotes.length,
  };

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow={t("dashboard.salesEyebrow")}
        title={t("dashboard.salesTitle", { name: displayUser.name })}
        description={t("dashboard.salesDescription")}
        action={<button className="button button--primary" type="button" onClick={() => onAction(t("dashboard.newQuote"))}>＋ {t("dashboard.newQuote")}</button>}
      />
      <section className="metric-grid metric-grid--five" aria-label={t("dashboard.quoteOverview")}>
        <MetricCard label={t("dashboard.metricDraft")} value={formatNumber(counts.draft)} tone="navy" note={t("dashboard.metricDraftNote")} />
        <MetricCard label={t("dashboard.metricReturned")} value={formatNumber(counts.returned)} tone="coral" note={t("dashboard.metricReturnedNote")} />
        <MetricCard label={t("dashboard.metricPending")} value={formatNumber(counts.pending)} tone="amber" note={t("dashboard.metricPendingNote")} />
        <MetricCard label={t("dashboard.metricApproved")} value={formatNumber(counts.approved)} tone="teal" note={t("dashboard.metricApprovedNote")} />
        <MetricCard label={t("dashboard.metricAll")} value={formatNumber(counts.total)} tone="navy" note={t("dashboard.metricAllNote")} />
      </section>
      <QuoteTable
        title={t("dashboard.myQuotes")}
        description={t("dashboard.myQuotesDescription")}
        role="sales"
        quotes={quotes}
        onAction={onAction}
      />
    </div>
  );
}

function ManagerDashboard({ user, quotes, onAction }: DashboardScreenProps) {
  const { formatNumber, locale, t } = useLocale();
  const displayUser = localizeUser(user, locale);
  const pending = quotes.filter((quote) => quote.status === "pending_manager");
  const elevated = quotes.filter((quote) => getDiscountBand(quote.discount) !== "standard").length;
  const teamMember = USERS.find((member) => user.teamMemberIds?.includes(member.id));
  const teamMemberName = teamMember ? localizeUser(teamMember, locale).name : "—";

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow={t("dashboard.managerEyebrow")}
        title={t("dashboard.managerTitle", { name: displayUser.name })}
        description={t("dashboard.managerDescription")}
      />
      <section className="metric-grid metric-grid--three" aria-label={t("dashboard.teamOverview")}>
        <MetricCard label={t("dashboard.metricPendingMine")} value={formatNumber(pending.length)} tone="amber" note={t("dashboard.metricPendingMineNote")} />
        <MetricCard label={t("dashboard.metricRisk")} value={formatNumber(elevated)} tone="coral" note={t("dashboard.metricRiskNote")} />
        <MetricCard label={t("dashboard.metricTeam")} value={formatNumber(quotes.length)} tone="navy" note={t("dashboard.metricTeamNote", { name: teamMemberName })} />
      </section>
      <QuoteTable
        title={t("dashboard.teamQueue")}
        description={t("dashboard.teamQueueDescription")}
        role="manager"
        quotes={quotes}
        onAction={onAction}
        showRisk
      />
    </div>
  );
}

function CeoDashboard({
  user,
  quotes,
  executiveQueue,
  onAction,
}: DashboardScreenProps & { executiveQueue: Quote[] }) {
  const { formatNumber, locale, t } = useLocale();
  const displayUser = localizeUser(user, locale);
  const approvedQuotes = quotes.filter((quote) => quote.status === "approved");
  const approvedValue = approvedQuotes.reduce((total, quote) => total + quote.pricing.total, 0);

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow={t("dashboard.ceoEyebrow")}
        title={t("dashboard.ceoTitle", { name: displayUser.name })}
        description={t("dashboard.ceoDescription")}
      />
      <section className="executive-summary" aria-label={t("dashboard.executiveSummary")}>
        <div>
          <span className="executive-summary__label">{t("dashboard.finalApprovals")}</span>
          <strong>{formatNumber(executiveQueue.length)}</strong>
          <small>{t("dashboard.highDiscountQuotes")}</small>
        </div>
        <div>
          <span className="executive-summary__label">{t("dashboard.approvedValue")}</span>
          <strong><Money amount={approvedValue} compact /></strong>
          <small>{formatNumber(approvedQuotes.length)} {t("dashboard.approvedQuotes")}</small>
        </div>
        <p>{t("dashboard.taxIncludedSummary")}</p>
      </section>
      <QuoteTable
        title={t("dashboard.ceoQueue")}
        description={t("dashboard.ceoQueueDescription")}
        role="ceo"
        quotes={executiveQueue}
        onAction={onAction}
        showRisk
      />
      {approvedQuotes.length > 0 ? (
        <QuoteTable
          title={t("dashboard.approvedQuoteTitle")}
          description={t("dashboard.approvedQuoteDescription")}
          role="ceo"
          quotes={approvedQuotes}
          onAction={onAction}
        />
      ) : null}
    </div>
  );
}

function DashboardHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="dashboard-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function MetricCard({ label, value, tone, note }: { label: string; value: string; tone: string; note: string }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function QuoteTable({
  title,
  description,
  role,
  quotes,
  onAction,
  showRisk = false,
}: {
  title: string;
  description: string;
  role: Role;
  quotes: Quote[];
  onAction: (label: string, quote?: Quote) => void;
  showRisk?: boolean;
}) {
  const { formatDate, formatNumber, locale, t } = useLocale();

  return (
    <section className="table-card">
      <header className="table-card__header">
        <div><h2>{title}</h2><p>{description}</p></div>
        <span>{t("dashboard.quoteCount", { count: formatNumber(quotes.length) })}</span>
      </header>
      {quotes.length === 0 ? (
        <div className="empty-state"><strong>{t("dashboard.emptyTitle")}</strong><span>{t("dashboard.emptyDescription")}</span></div>
      ) : (
        <div className="quote-list">
          <div className="quote-row quote-row--header" aria-hidden="true">
            <span>{t("dashboard.quoteCustomer")}</span><span>{t("dashboard.owner")}</span><span>{t("dashboard.discount")}</span><span>{t("dashboard.taxIncludedTotal")}</span><span>{t("dashboard.status")}</span><span>{t("dashboard.action")}</span>
          </div>
          {quotes.map((quote) => {
            const sourceCustomer = CUSTOMERS.find((item) => item.id === quote.customerId);
            const sourceOwner = USERS.find((item) => item.id === quote.salesId);
            const customer = sourceCustomer ? localizeCustomer(sourceCustomer, locale) : undefined;
            const owner = sourceOwner ? localizeUser(sourceOwner, locale) : undefined;
            const action = actionFor(role, quote);
            const actionLabel = t(action.labelKey);
            const band = getDiscountBand(quote.discount);
            return (
              <article className="quote-row" key={quote.id}>
                <div className="quote-row__primary">
                  <strong>{customer?.name ?? t("dashboard.unknownCustomer")}</strong>
                  <span>{t("dashboard.updatedAt", { number: quote.quoteNumber, date: formatDate(quote.updatedAt) })}</span>
                </div>
                <span data-label={t("dashboard.owner")}>{owner?.name ?? "—"}</span>
                <span data-label={t("dashboard.discount")}>
                  <strong>{formatNumber(quote.discount)}%</strong>
                  {showRisk ? <RiskBadge band={band} /> : null}
                </span>
                <span data-label={t("dashboard.taxIncludedTotal")}><Money amount={quote.pricing.total} /></span>
                <span data-label={t("dashboard.status")}><StatusBadge status={quote.status} /></span>
                <span className="quote-row__action">
                  <button className={`button ${action.primary ? "button--primary" : "button--secondary"}`} type="button" onClick={() => onAction(actionLabel, quote)}>
                    {actionLabel}
                  </button>
                </span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function actionFor(role: Role, quote: Quote): { labelKey: TranslationKey; primary: boolean } {
  if (quote.status === "approved") return { labelKey: "dashboard.viewQuotation", primary: false };

  if (role === "sales") {
    if (quote.status === "returned") return { labelKey: "dashboard.reviseResubmit", primary: true };
    if (quote.status === "draft") return { labelKey: "dashboard.continueEditing", primary: true };
    return { labelKey: "dashboard.viewProgress", primary: false };
  }

  if (role === "manager" && quote.status === "pending_manager") {
    return { labelKey: "dashboard.reviewQuote", primary: true };
  }

  if (role === "ceo" && quote.status === "pending_ceo") {
    return { labelKey: "dashboard.executiveApproval", primary: true };
  }

  return { labelKey: "dashboard.viewDetails", primary: false };
}

function RiskBadge({ band }: { band: DiscountBand }) {
  const { t } = useLocale();
  const labelKeys: Record<DiscountBand, TranslationKey> = {
    standard: "risk.standard",
    elevated: "risk.elevated",
    executive: "risk.executive",
  };
  const label = t(labelKeys[band]);

  return <span className={`risk-badge risk-badge--${band}`} aria-label={label}>{label}</span>;
}

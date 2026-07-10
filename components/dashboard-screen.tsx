import { CUSTOMERS, USERS } from "@/lib/mock-data";
import { getDiscountBand } from "@/lib/quotation";
import { quotesForRole } from "@/lib/store";
import type { DiscountBand, Quote, Role, User } from "@/lib/types";

import { Money, StatusBadge } from "./ui";

interface DashboardScreenProps {
  user: User;
  quotes: Quote[];
  onAction: (label: string, quote?: Quote) => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

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
  const counts = {
    draft: quotes.filter((quote) => quote.status === "draft").length,
    returned: quotes.filter((quote) => quote.status === "returned").length,
    pending: quotes.filter((quote) => quote.status === "pending_manager" || quote.status === "pending_ceo").length,
    approved: quotes.filter((quote) => quote.status === "approved").length,
  };

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow="销售工作台"
        title={`早上好，${user.name}`}
        description="今天的报价进度与待处理事项一目了然。"
        action={<button className="button button--primary" type="button" onClick={() => onAction("新建报价")}>＋ 新建报价</button>}
      />
      <section className="metric-grid" aria-label="报价概览">
        <MetricCard label="草稿" value={counts.draft} tone="navy" note="继续完善后提交" />
        <MetricCard label="已退回" value={counts.returned} tone="coral" note="需要优先处理" />
        <MetricCard label="审批中" value={counts.pending} tone="amber" note="等待管理层审批" />
        <MetricCard label="已批准" value={counts.approved} tone="teal" note="可生成正式报价" />
      </section>
      <QuoteTable
        title="我的报价"
        description="最近更新的客户报价"
        role="sales"
        quotes={quotes}
        onAction={onAction}
      />
    </div>
  );
}

function ManagerDashboard({ user, quotes, onAction }: DashboardScreenProps) {
  const pending = quotes.filter((quote) => quote.status === "pending_manager");
  const elevated = quotes.filter((quote) => getDiscountBand(quote.discount) !== "standard").length;

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow="团队审批"
        title={`${user.name}，团队队列已更新`}
        description="优先处理待审批项目，并关注高折扣报价的商业依据。"
      />
      <section className="metric-grid metric-grid--three" aria-label="团队概览">
        <MetricCard label="待我审批" value={pending.length} tone="amber" note="当前主管节点" />
        <MetricCard label="风险报价" value={elevated} tone="coral" note="折扣超过标准区间" />
        <MetricCard label="团队报价" value={quotes.length} tone="navy" note="陈晨 · 本月累计" />
      </section>
      <QuoteTable
        title="团队报价队列"
        description="按风险与更新时间快速定位待办"
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
  const approvedQuotes = quotes.filter((quote) => quote.status === "approved");
  const approvedValue = approvedQuotes.reduce((total, quote) => total + quote.pricing.total, 0);

  return (
    <div className="dashboard">
      <DashboardHeading
        eyebrow="管理层审批"
        title={`${user.name}，这里是最终审批事项`}
        description="仅呈现需要 CEO 决策的高折扣报价，减少无关信息干扰。"
      />
      <section className="executive-summary" aria-label="执行摘要">
        <div>
          <span className="executive-summary__label">待最终审批</span>
          <strong>{executiveQueue.length}</strong>
          <small>份高折扣报价</small>
        </div>
        <div>
          <span className="executive-summary__label">本期已批准价值</span>
          <strong><Money amount={approvedValue} compact /></strong>
          <small>{approvedQuotes.length} 份已批准报价</small>
        </div>
        <p>审批队列已按折扣风险聚焦，所有金额均含税。</p>
      </section>
      <QuoteTable
        title="CEO 审批队列"
        description="仅显示已通过销售主管审核的执行级报价"
        role="ceo"
        quotes={executiveQueue}
        onAction={onAction}
        showRisk
      />
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

function MetricCard({ label, value, tone, note }: { label: string; value: number; tone: string; note: string }) {
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
  return (
    <section className="table-card">
      <header className="table-card__header">
        <div><h2>{title}</h2><p>{description}</p></div>
        <span>{quotes.length} 份</span>
      </header>
      {quotes.length === 0 ? (
        <div className="empty-state"><strong>当前没有待处理报价</strong><span>新的报价进入该节点后会显示在这里。</span></div>
      ) : (
        <div className="quote-list">
          <div className="quote-row quote-row--header" aria-hidden="true">
            <span>报价 / 客户</span><span>负责人</span><span>折扣</span><span>含税总额</span><span>状态</span><span>操作</span>
          </div>
          {quotes.map((quote) => {
            const customer = CUSTOMERS.find((item) => item.id === quote.customerId);
            const owner = USERS.find((item) => item.id === quote.salesId);
            const action = actionFor(role, quote);
            const band = getDiscountBand(quote.discount);
            return (
              <article className="quote-row" key={quote.id}>
                <div className="quote-row__primary">
                  <strong>{customer?.name ?? "未知客户"}</strong>
                  <span>{quote.quoteNumber} · 更新于 {DATE_FORMATTER.format(new Date(quote.updatedAt))}</span>
                </div>
                <span data-label="负责人">{owner?.name ?? "—"}</span>
                <span data-label="折扣">
                  <strong>{quote.discount}%</strong>
                  {showRisk ? <RiskBadge band={band} /> : null}
                </span>
                <span data-label="含税总额"><Money amount={quote.pricing.total} /></span>
                <span data-label="状态"><StatusBadge status={quote.status} /></span>
                <span className="quote-row__action">
                  <button className={`button ${action.primary ? "button--primary" : "button--secondary"}`} type="button" onClick={() => onAction(action.label, quote)}>
                    {action.label}
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

function actionFor(role: Role, quote: Quote): { label: string; primary: boolean } {
  if (role === "sales") {
    if (quote.status === "returned") return { label: "修改并重新提交", primary: true };
    if (quote.status === "draft") return { label: "继续编辑", primary: true };
    if (quote.status === "approved") return { label: "查看报价", primary: false };
    return { label: "查看进度", primary: false };
  }

  if (role === "manager" && quote.status === "pending_manager") {
    return { label: "审核报价", primary: true };
  }

  if (role === "ceo" && quote.status === "pending_ceo") {
    return { label: "执行审批", primary: true };
  }

  return { label: "查看详情", primary: false };
}

function RiskBadge({ band }: { band: DiscountBand }) {
  const labels: Record<DiscountBand, string> = {
    standard: "标准",
    elevated: "关注",
    executive: "高风险",
  };
  return <span className={`risk-badge risk-badge--${band}`}>{labels[band]}</span>;
}

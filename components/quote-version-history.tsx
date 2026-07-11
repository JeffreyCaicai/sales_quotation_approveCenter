import { BUILDINGS, CUSTOMERS, PACKAGES } from "@/lib/mock-data";
import type { ApprovalEvent, Quote, QuoteVersionSnapshot } from "@/lib/types";

import { Money } from "./ui";

interface QuoteVersionHistoryProps {
  quote: Quote;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const METRIC_FORMATTER = new Intl.NumberFormat("zh-CN");

export function QuoteVersionHistory({ quote }: QuoteVersionHistoryProps) {
  if (quote.versionSnapshots.length === 0) {
    return <p className="version-history__empty">该草稿尚未提交，暂无锁定版本记录。</p>;
  }

  return (
    <div className="version-history">
      <div className="version-history__heading">
        <div><h2>版本记录</h2><p>每次提交锁定一份商业快照，后续修改不会覆盖旧版本。</p></div>
        <span>{quote.versionSnapshots.length} 个版本</span>
      </div>
      <div className="version-history__list">
        {quote.versionSnapshots.map((snapshot) => {
          const events = quote.approvalHistory.filter((event) => event.version === snapshot.version);
          return (
            <article className="version-record" key={snapshot.version} aria-labelledby={`version-${snapshot.version}-heading`}>
              <SnapshotSummary snapshot={snapshot} />
              <section className="version-record__timeline" aria-labelledby={`version-${snapshot.version}-timeline`}>
                <h3 id={`version-${snapshot.version}-timeline`}>审批时间线</h3>
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
  const customer = CUSTOMERS.find((item) => item.id === snapshot.customerId);
  const brand = customer?.brands.find((item) => item.id === snapshot.brandId);
  const resources = snapshot.placementMode === "package"
    ? PACKAGES.filter((item) => snapshot.placementIds.includes(item.id))
    : BUILDINGS.filter((item) => snapshot.placementIds.includes(item.id));

  return (
    <section className="version-record__snapshot" aria-labelledby={`version-${snapshot.version}-heading`}>
      <header>
        <div>
          <span>Commercial Snapshot</span>
          <h3 id={`version-${snapshot.version}-heading`}>V{snapshot.version} 商业摘要</h3>
        </div>
        <time dateTime={snapshot.submittedAt}>{DATE_TIME_FORMATTER.format(new Date(snapshot.submittedAt))}</time>
      </header>
      <dl className="version-summary-grid">
        <div><dt>客户 / 品牌</dt><dd>{customer?.name ?? snapshot.customerId}<small>{brand?.name ?? snapshot.brandId}</small></dd></div>
        <div><dt>投放资源</dt><dd>{snapshot.placementMode === "package" ? "销售包" : "定点挑楼"}<small>{resources.map((item) => item.name).join("、")}</small></dd></div>
        <div><dt>投放参数</dt><dd>{snapshot.weeks} 周 · {METRIC_FORMATTER.format(snapshot.spots)} Spot<small>{METRIC_FORMATTER.format(snapshot.bonus)} Bonus</small></dd></div>
        <div><dt>受众指标</dt><dd>{METRIC_FORMATTER.format(snapshot.traffic)} 日均流量<small>{METRIC_FORMATTER.format(snapshot.impressions)} 月曝光</small></dd></div>
        <div><dt>折扣</dt><dd>{snapshot.discount}%<small>Rate Card <Money amount={snapshot.pricing.basePrice} /></small></dd></div>
        <div><dt>含税总额</dt><dd><Money amount={snapshot.pricing.total} /><small>折后净价 <Money amount={snapshot.pricing.netPrice} /></small></dd></div>
      </dl>
    </section>
  );
}

function TimelineEvent({ event }: { event: ApprovalEvent }) {
  const labels = {
    submitted: "提交审批",
    resubmitted: "重新提交",
    approved: "批准报价",
    returned: "退回修改",
  } as const;

  return (
    <li>
      <span className={`approval-timeline__marker approval-timeline__marker--${event.action}`} aria-hidden="true" />
      <div>
        <span><strong>{labels[event.action]}</strong><small>V{event.version}</small></span>
        <p>{event.actorName} · {roleLabel(event.role)}</p>
        {event.comment ? <blockquote>{event.comment}</blockquote> : null}
        <time dateTime={event.createdAt}>{DATE_TIME_FORMATTER.format(new Date(event.createdAt))}</time>
      </div>
    </li>
  );
}

function roleLabel(role: ApprovalEvent["role"]) {
  if (role === "sales") return "销售";
  if (role === "manager") return "销售主管";
  return "CEO";
}

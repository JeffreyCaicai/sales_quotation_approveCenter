import { BUILDINGS, CUSTOMERS, DEMO_DATA_NOTICE, DEMO_TAX_RATE, PACKAGES, USERS } from "@/lib/mock-data";
import type { ApprovalEvent, Building, Quote } from "@/lib/types";

import { Money } from "./ui";

interface QuotationScreenProps {
  quote: Quote;
  onBack: () => void;
  onPrint: () => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const METRIC_FORMATTER = new Intl.NumberFormat("zh-CN");
const PERCENT_FORMATTER = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function QuotationScreen({ quote, onBack, onPrint }: QuotationScreenProps) {
  if (quote.status !== "approved") {
    return (
      <div className="quotation-screen quotation-screen--restricted">
        <button className="back-button" type="button" onClick={onBack}>← 返回工作台</button>
        <section className="quotation-access-message" role="alert">
          <span>报价尚未完成审批</span>
          <h1>正式报价暂不可用</h1>
          <p>只有状态为“已批准”的报价可以生成、查看或打印正式 Quotation。</p>
        </section>
      </div>
    );
  }

  const customer = CUSTOMERS.find((item) => item.id === quote.customerId);
  const brand = customer?.brands.find((item) => item.id === quote.brandId);
  const owner = USERS.find((item) => item.id === quote.salesId);
  const selectedPackages = quote.placementMode === "package"
    ? PACKAGES.filter((item) => quote.placementIds.includes(item.id))
    : [];
  const selectedBuildings = quote.placementMode === "building"
    ? BUILDINGS.filter((item) => quote.placementIds.includes(item.id))
    : [];
  const resources = quote.placementMode === "package" ? selectedPackages : selectedBuildings;
  const appendixBuildings = getAppendixBuildings(quote, selectedPackages);
  const traffic = resources.reduce((total, item) => total + item.traffic, 0);
  const impressions = resources.reduce((total, item) => total + item.impressions, 0);
  const issueDate = quote.approvedAt ?? quote.updatedAt;
  const taxRate = DEMO_TAX_RATE * 100;

  return (
    <div className="quotation-screen">
      <div className="quotation-toolbar" aria-label="正式报价操作">
        <button className="back-button" type="button" onClick={onBack}>← 返回工作台</button>
        <button className="button button--primary" type="button" onClick={onPrint}>打印 / 导出 PDF</button>
      </div>

      <article className="quotation-document" aria-labelledby="quotation-title">
        <header className="quotation-document__header">
          <div className="quotation-brand">
            <span className="quotation-brand__mark" aria-hidden="true"><i /><i /><i /></span>
            <span><strong>报价审批中心</strong><small>QUOTATION WORKSPACE</small></span>
          </div>
          <div className="quotation-title-block">
            <span>正式商业文件 · 模拟数据</span>
            <h1 id="quotation-title">QUOTATION <small>报价单</small></h1>
          </div>
        </header>

        <section className="quotation-reference" aria-label="报价信息">
          <dl>
            <div><dt>报价编号</dt><dd>{quote.quoteNumber}</dd></div>
            <div><dt>报价日期</dt><dd>{DATE_FORMATTER.format(new Date(issueDate))}</dd></div>
            <div><dt>报价版本</dt><dd>V{quote.version}</dd></div>
            <div><dt>币种</dt><dd>人民币 CNY</dd></div>
          </dl>
        </section>

        <section className="quotation-section quotation-parties" aria-labelledby="quotation-client-heading">
          <header><span>01</span><h2 id="quotation-client-heading">客户与品牌</h2></header>
          <dl className="quotation-facts">
            <div><dt>客户</dt><dd>{customer?.name ?? "未知客户"}</dd></div>
            <div><dt>品牌</dt><dd>{brand?.name ?? "未知品牌"}</dd></div>
            <div><dt>销售负责人</dt><dd>{owner?.name ?? quote.salesId} · {owner?.title ?? "销售"}</dd></div>
            <div><dt>投放周期</dt><dd>自排期确认日起连续 {quote.weeks} 周</dd></div>
          </dl>
        </section>

        <section className="quotation-section" aria-labelledby="quotation-resource-heading">
          <header><span>02</span><h2 id="quotation-resource-heading">投放资源与报价项目</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead>
                <tr><th>项目</th><th>类型 / 区域</th><th>周期</th><th className="align-right">投放金额</th></tr>
              </thead>
              <tbody>
                {resources.map((resource) => (
                  <tr key={resource.id}>
                    <td><strong>{resource.name}</strong><small>{resource.category}</small></td>
                    <td>{quote.placementMode === "package" ? "销售包" : "楼宇"}<small>{resource.location}</small></td>
                    <td>{quote.weeks} 周</td>
                    <td className="align-right"><Money amount={Math.round(resource.priceRmb * (quote.weeks / 4))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="quotation-delivery-grid" aria-label="投放与受众指标">
            <Metric label="Spot" value={`${METRIC_FORMATTER.format(quote.spots)} 次`} />
            <Metric label="Bonus" value={`${METRIC_FORMATTER.format(quote.bonus)} 次`} />
            <Metric label="日均流量" value={METRIC_FORMATTER.format(traffic)} />
            <Metric label="月曝光" value={METRIC_FORMATTER.format(impressions)} />
          </div>
        </section>

        <section className="quotation-section quotation-pricing" aria-labelledby="quotation-pricing-heading">
          <header><span>03</span><h2 id="quotation-pricing-heading">价格明细</h2></header>
          <dl className="quotation-pricing__ledger">
            <PriceRow label="Rate Card 基础价" amount={quote.pricing.basePrice} />
            <PriceRow label={`折扣减免（${quote.discount}%）`} amount={quote.pricing.discountAmount} deduction />
            <PriceRow label="折后净价" amount={quote.pricing.netPrice} />
            <PriceRow label={`模拟税费（${formatPercent(taxRate)}%）`} amount={quote.pricing.tax} />
            <div className="quotation-total"><dt>含税总额</dt><dd><Money amount={quote.pricing.total} /></dd></div>
          </dl>
        </section>

        <section className="quotation-section quotation-terms" aria-labelledby="quotation-terms-heading">
          <header><span>04</span><h2 id="quotation-terms-heading">报价条款</h2></header>
          <ol>
            <li>本报价自报价日期起 15 个自然日内有效，最终排期以双方书面确认为准。</li>
            <li>Rate Card 以 4 周为计价单位；Spot 与 Bonus 用于排期确认。</li>
            <li>所有金额均以人民币计价，并包含 {formatPercent(taxRate)}% 模拟税费。</li>
            <li>{DEMO_DATA_NOTICE}</li>
          </ol>
        </section>

        <section className="quotation-section quotation-appendix" aria-labelledby="quotation-appendix-heading">
          <header><span>A</span><h2 id="quotation-appendix-heading">楼宇明细附录</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead><tr><th>楼宇</th><th>区域 / 类型</th><th className="align-right">日均流量</th><th className="align-right">月曝光</th></tr></thead>
              <tbody>
                {appendixBuildings.map((building) => (
                  <tr key={building.id}>
                    <td><strong>{building.name}</strong></td>
                    <td>{building.location}<small>{building.category}</small></td>
                    <td className="align-right">{METRIC_FORMATTER.format(building.traffic)}</td>
                    <td className="align-right">{METRIC_FORMATTER.format(building.impressions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="quotation-section quotation-approval-record" aria-labelledby="quotation-approval-heading">
          <header><span>✓</span><h2 id="quotation-approval-heading">审批记录</h2></header>
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead><tr><th>审批动作</th><th>审批人</th><th>版本</th><th>时间 / 意见</th></tr></thead>
              <tbody>
                {quote.approvalHistory.map((event) => (
                  <tr key={event.id}>
                    <td><strong>{approvalActionLabel(event)}</strong></td>
                    <td>{event.actorName}<small>{approvalRoleLabel(event)}</small></td>
                    <td>V{event.version}</td>
                    <td>{DATE_TIME_FORMATTER.format(new Date(event.createdAt))}{event.comment ? <small>{event.comment}</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="quotation-approval-stamp"><span aria-hidden="true">✓</span><strong>APPROVED</strong> 本报价已完成所需审批流程</p>
        </section>

        <footer className="quotation-document__footer">
          <span>{quote.quoteNumber} · V{quote.version}</span>
          <span>报价审批中心 · 模拟数据</span>
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

function formatPercent(value: number) {
  return PERCENT_FORMATTER.format(value);
}

function approvalActionLabel(event: ApprovalEvent) {
  const labels = {
    submitted: "提交审批",
    resubmitted: "重新提交",
    approved: "批准报价",
    returned: "退回修改",
  } as const;
  return labels[event.action];
}

function approvalRoleLabel(event: ApprovalEvent) {
  if (event.role === "sales") return "销售";
  if (event.role === "manager") return "销售主管";
  return "CEO";
}

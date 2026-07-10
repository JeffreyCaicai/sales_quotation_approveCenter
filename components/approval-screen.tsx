"use client";

import { useEffect, useRef, useState } from "react";

import { BUILDINGS, CUSTOMERS, PACKAGES, USERS } from "@/lib/mock-data";
import { canApproveQuote, getDiscountBand } from "@/lib/quotation";
import type { ApprovalEvent, Quote, User } from "@/lib/types";

import { Money, StatusBadge } from "./ui";

interface ApprovalScreenProps {
  quote: Quote;
  actor: User;
  onApprove: () => void;
  onReturn: (reason: string) => void;
  onBack: () => void;
}

type Decision = "approve" | "return";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ApprovalScreen({ quote, actor, onApprove, onReturn, onBack }: ApprovalScreenProps) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const customer = CUSTOMERS.find((item) => item.id === quote.customerId);
  const brand = customer?.brands.find((item) => item.id === quote.brandId);
  const owner = USERS.find((item) => item.id === quote.salesId);
  const resources = quote.placementMode === "package"
    ? PACKAGES.filter((item) => quote.placementIds.includes(item.id))
    : BUILDINGS.filter((item) => quote.placementIds.includes(item.id));
  const band = getDiscountBand(quote.discount);
  const canDecide = canApproveQuote(quote, actor);
  const history = [...quote.approvalHistory].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );

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
    setReasonError("");
  };

  const confirmReturn = () => {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setReasonError("请填写退回原因");
      return;
    }
    onReturn(normalizedReason);
    closeDialog();
  };

  return (
    <div className="approval-screen">
      <button className="back-button" type="button" onClick={onBack}>← 返回工作台</button>
      <header className="approval-heading">
        <div>
          <p className="eyebrow">Approval Review</p>
          <h1>报价审批详情</h1>
          <p>{quote.quoteNumber} · V{quote.version}</p>
        </div>
        <div className="approval-heading__badges">
          <span className="version-badge">版本 V{quote.version}</span>
          <StatusBadge status={quote.status} />
        </div>
      </header>

      <div className="approval-layout">
        <main className="approval-content">
          <section className="approval-card" aria-labelledby="approval-client-heading">
            <header className="approval-card__heading">
              <span>01</span>
              <div><h2 id="approval-client-heading">客户与品牌</h2><p>本次商业报价主体</p></div>
            </header>
            <dl className="approval-facts">
              <div><dt>客户</dt><dd>{customer?.name ?? "未知客户"}</dd></div>
              <div><dt>品牌</dt><dd>{brand?.name ?? "未知品牌"}</dd></div>
              <div><dt>负责人</dt><dd>{owner?.name ?? quote.salesId}</dd></div>
              <div><dt>投放参数</dt><dd>{quote.weeks} 周 · {quote.spots} Spot · {quote.bonus} Bonus</dd></div>
            </dl>
          </section>

          <section className="approval-card" aria-labelledby="approval-placement-heading">
            <header className="approval-card__heading">
              <span>02</span>
              <div><h2 id="approval-placement-heading">投放资源</h2><p>{quote.placementMode === "package" ? "预设销售包" : "定点挑楼"}</p></div>
            </header>
            <ul className="approval-resource-list">
              {resources.map((resource) => (
                <li key={resource.id}>
                  <span><strong>{resource.name}</strong><small>{resource.location} · {resource.category}</small></span>
                  <Money amount={resource.priceRmb} />
                </li>
              ))}
            </ul>
          </section>

          <section className="approval-card" aria-labelledby="approval-timeline-heading">
            <header className="approval-card__heading">
              <span>03</span>
              <div><h2 id="approval-timeline-heading">审批时间线</h2><p>按发生时间记录，保留全部版本意见</p></div>
            </header>
            <ol className="approval-timeline">
              {history.map((event) => <TimelineEvent event={event} key={event.id} />)}
            </ol>
          </section>
        </main>

        <aside className="approval-sidebar">
          <section className={`approval-risk approval-risk--${band}`} aria-label="折扣风险">
            <span>折扣风险</span>
            <strong>{quote.discount}%</strong>
            <p>{riskMessage(band)}</p>
          </section>

          <section className="approval-ledger" aria-labelledby="approval-ledger-heading">
            <header><span>Pricing Summary</span><h2 id="approval-ledger-heading">计算明细</h2></header>
            <dl>
              <LedgerRow label="Rate Card 原价" amount={quote.pricing.basePrice} />
              <LedgerRow label={`折扣减免 (${quote.discount}%)`} amount={-quote.pricing.discountAmount} discount />
              <LedgerRow label="折后净价" amount={quote.pricing.netPrice} />
              <LedgerRow label="模拟税费 (6%)" amount={quote.pricing.tax} />
              <LedgerRow label="含税总额" amount={quote.pricing.total} total />
            </dl>
            <p>人民币金额与税率均为原型模拟数据。</p>
          </section>

          {canDecide ? (
            <div className="approval-actions" aria-label="审批操作">
              <button className="button button--primary" type="button" onClick={() => setDecision("approve")}>批准报价</button>
              <button className="button button--danger" type="button" onClick={() => setDecision("return")}>退回修改</button>
            </div>
          ) : (
            <p className="approval-readonly">当前报价不在你的审批节点，仅供查看。</p>
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
          <h2 id="decision-modal-title">{decision === "return" ? "退回报价修改" : "确认批准报价"}</h2>
          <button className="icon-button" type="button" onClick={closeDialog} aria-label="关闭弹窗">×</button>
        </div>
        <div className="modal__body" id="decision-modal-description">
          {decision === "return" ? (
            <label className="decision-reason">
              <span>退回原因 <em>必填</em></span>
              <textarea
                autoFocus
                value={reason}
                rows={5}
                aria-invalid={Boolean(reasonError)}
                aria-describedby={reasonError ? "return-reason-error" : "return-reason-help"}
                placeholder="说明需要销售修改或补充的内容"
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError("");
                }}
              />
              <small id="return-reason-help">该原因会写入审批时间线并同步给销售。</small>
              {reasonError ? <span className="field-error" id="return-reason-error" role="alert">{reasonError}</span> : null}
            </label>
          ) : (
            <p>批准后将{quote.discount > 70 && actor.role === "manager" ? "流转至 CEO 最终审批" : "完成本版本的最终审批"}。此操作会写入审批记录。</p>
          )}
        </div>
        <div className="modal__footer decision-modal__footer">
          <button className="button button--secondary" type="button" onClick={closeDialog}>取消</button>
          {decision === "return" ? (
            <button className="button button--danger" type="button" onClick={confirmReturn}>确认退回</button>
          ) : (
            <button autoFocus className="button button--primary" type="button" onClick={() => {
              onApprove();
              closeDialog();
            }}>确认批准</button>
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

function riskMessage(band: ReturnType<typeof getDiscountBand>) {
  if (band === "executive") return "高于 70%，主管批准后仍需 CEO 最终审批。";
  if (band === "elevated") return "高于标准区间，请重点核对商业依据；主管可最终批准。";
  return "处于标准折扣区间，主管可完成最终审批。";
}

function roleLabel(role: ApprovalEvent["role"]) {
  if (role === "sales") return "销售";
  if (role === "manager") return "销售主管";
  return "CEO";
}

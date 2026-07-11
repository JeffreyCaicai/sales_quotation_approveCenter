import type { ApprovalEvent, Quote } from "@/lib/types";

import { QuoteVersionHistory } from "./quote-version-history";
import { StatusBadge } from "./ui";

interface QuoteProgressScreenProps {
  quote: Quote;
  backLabel: string;
  onBack: () => void;
  onEdit: () => void;
}

export function QuoteProgressScreen({ quote, backLabel, onBack, onEdit }: QuoteProgressScreenProps) {
  const latestReturn = getLatestReturn(quote.approvalHistory);
  const isReturned = quote.status === "returned";

  return (
    <div className="quote-progress-screen">
      <button className="back-button" type="button" onClick={onBack}>← {backLabel}</button>
      <header className="approval-heading">
        <div>
          <p className="eyebrow">Quote Progress</p>
          <h1>报价进度与版本</h1>
          <p>{quote.quoteNumber} · 当前 V{quote.version}</p>
        </div>
        <div className="approval-heading__badges">
          <span className="version-badge">只读详情</span>
          <StatusBadge status={quote.status} />
        </div>
      </header>

      {latestReturn ? (
        <section className="latest-return" aria-labelledby="latest-return-heading">
          <div>
            <span>{isReturned ? "需要销售处理" : "上一轮退回意见"}</span>
            <h2 id="latest-return-heading">最新退回原因</h2>
          </div>
          <blockquote>{latestReturn.comment}</blockquote>
          <p>{latestReturn.actorName} · {latestReturn.role === "ceo" ? "CEO" : "销售主管"}</p>
        </section>
      ) : (
        <section className="progress-callout" aria-label="当前审批进度">
          <strong>{quote.status === "pending_ceo" ? "等待 CEO 最终审批" : "等待销售主管审批"}</strong>
          <p>报价当前处于只读审批流程。下方记录展示已锁定的商业条件与全部审批事件。</p>
        </section>
      )}

      <QuoteVersionHistory quote={quote} />

      {isReturned ? (
        <div className="progress-actions">
          <p>请先确认退回意见与原版本条件，再进入编辑流程。</p>
          <button className="button button--primary" type="button" onClick={onEdit}>修改并重新提交</button>
        </div>
      ) : null}
    </div>
  );
}

function getLatestReturn(history: ApprovalEvent[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event.action === "returned") return event;
  }
  return undefined;
}

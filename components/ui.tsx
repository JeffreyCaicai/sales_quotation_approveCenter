import type { ReactNode } from "react";

import type { QuoteStatus } from "@/lib/types";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "草稿",
  pending_manager: "待主管审批",
  pending_ceo: "待 CEO 审批",
  returned: "已退回",
  approved: "已批准",
};

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
});

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Money({ amount, compact = false }: { amount: number; compact?: boolean }) {
  if (compact && amount >= 10_000) {
    return <span className="money">¥{(amount / 10_000).toFixed(1)}万</span>;
  }

  return <span className="money">{moneyFormatter.format(amount)}</span>;
}

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, children, onClose }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">
          <button className="button button--primary" type="button" onClick={onClose}>
            知道了
          </button>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import type { TranslationKey } from "@/lib/i18n";
import type { QuoteStatus } from "@/lib/types";

import { useLocale } from "./locale-provider";

const STATUS_LABEL_KEYS: Record<QuoteStatus, TranslationKey> = {
  draft: "status.draft",
  pending_manager: "status.pendingManager",
  pending_business_control: "status.pendingBusinessControl",
  pending_ceo: "status.pendingCeo",
  returned: "status.returned",
  approved: "status.approved",
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const { t } = useLocale();
  const label = t(STATUS_LABEL_KEYS[status]);

  return (
    <span className={`status-badge status-badge--${status}`} aria-label={label}>
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Money({ amount, compact = false }: { amount: number; compact?: boolean }) {
  const { formatMoney, locale } = useLocale();
  const compactFormatter = useMemo(() => new Intl.NumberFormat(locale === "en" ? "en-ID" : locale, {
    style: "currency",
    currency: "IDR",
    currencyDisplay: "symbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }), [locale]);
  const fullAmount = formatMoney(amount);
  const visibleAmount = compact && amount >= 10_000 ? compactFormatter.format(amount) : fullAmount;

  return <span className="money" aria-label={fullAmount}>{visibleAmount}</span>;
}

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, children, onClose }: ModalProps) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__header">
        <h2 id="modal-title">{title}</h2>
        <button
          autoFocus
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label={t("modal.close")}
        >
          ×
        </button>
      </div>
      <div className="modal__body" id="modal-description">{children}</div>
      <div className="modal__footer">
        <button className="button button--primary" type="button" onClick={onClose}>
          {t("modal.acknowledge")}
        </button>
      </div>
    </dialog>
  );
}

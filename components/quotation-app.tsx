"use client";

import { useState } from "react";

import { BUILDINGS, CUSTOMERS, PACKAGES } from "@/lib/mock-data";
import {
  approveQuote,
  createDraftQuote,
  returnQuote,
  submitQuote,
  validateQuote,
  validateQuoteReferences,
} from "@/lib/quotation";
import { loadQuotes, resetQuotes, saveQuotes } from "@/lib/store";
import type { Quote, QuoteInput, User } from "@/lib/types";

import { AppShell } from "./app-shell";
import { ApprovalScreen } from "./approval-screen";
import { DashboardScreen } from "./dashboard-screen";
import { LoginScreen } from "./login-screen";
import { LocaleProvider, useLocale } from "./locale-provider";
import { QuoteWizard } from "./quote-wizard";
import { QuoteProgressScreen } from "./quote-progress-screen";
import { QuotationScreen } from "./quotation-screen";
import { Modal } from "./ui";

interface PlaceholderState {
  title: string;
  message: string;
}

interface WizardSession {
  initialQuote?: Quote;
}

export function QuotationApp() {
  return (
    <LocaleProvider>
      <QuotationWorkspace />
    </LocaleProvider>
  );
}

function QuotationWorkspace() {
  const { t } = useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>(() => loadQuotes());
  const [placeholder, setPlaceholder] = useState<PlaceholderState | null>(null);
  const [wizard, setWizard] = useState<WizardSession | null>(null);
  const [approvalQuoteId, setApprovalQuoteId] = useState<string | null>(null);
  const [progressQuoteId, setProgressQuoteId] = useState<string | null>(null);
  const [quotationQuoteId, setQuotationQuoteId] = useState<string | null>(null);

  if (!user) return <LoginScreen onLogin={setUser} />;

  const openPlaceholder = (label: string, quote?: Quote) => {
    setPlaceholder({
      title: label,
      message: quote
        ? t("placeholder.withQuote", { number: quote.quoteNumber, label })
        : t("placeholder.generic", { label }),
    });
  };

  const handleReset = () => {
    setQuotes(resetQuotes());
    setWizard(null);
    setApprovalQuoteId(null);
    setProgressQuoteId(null);
    setQuotationQuoteId(null);
    setPlaceholder({ title: t("placeholder.resetTitle"), message: t("placeholder.resetMessage") });
  };

  const persistQuote = (quote: Quote, previousQuote?: Quote) => {
    const next = previousQuote
      ? quotes.map((item) => item.id === previousQuote.id ? quote : item)
      : [quote, ...quotes];
    setQuotes(next);
    saveQuotes(next);
  };

  const handleDashboardAction = (label: string, quote?: Quote) => {
    if (user.role === "sales" && (!quote || quote.status === "draft")) {
      setWizard({ initialQuote: quote });
      return;
    }

    if (user.role === "sales" && quote && (quote.status === "returned" || quote.status === "pending_manager" || quote.status === "pending_ceo")) {
      setProgressQuoteId(quote.id);
      return;
    }

    if (quote && (
      (user.role === "manager" && quote.status === "pending_manager")
      || (user.role === "ceo" && quote.status === "pending_ceo")
    )) {
      setApprovalQuoteId(quote.id);
      return;
    }

    if (quote?.status === "approved") {
      setQuotationQuoteId(quote.id);
      return;
    }

    openPlaceholder(label, quote);
  };

  const handleSave = (input: QuoteInput) => {
    const draft = createDraftQuote(input, wizard?.initialQuote, user);
    persistQuote(draft, wizard?.initialQuote);
    setWizard(null);
    setPlaceholder({
      title: t("outcome.draftSavedTitle"),
      message: draft.status === "returned"
        ? t("outcome.returnedDraftSavedMessage", { number: draft.quoteNumber })
        : t("outcome.draftSavedMessage", { number: draft.quoteNumber }),
    });
  };

  const handleSubmit = (input: QuoteInput) => {
    assertPersistableQuote(input, user);
    const quote = submitQuote(input, wizard?.initialQuote, user);
    persistQuote(quote, wizard?.initialQuote);
    setWizard(null);
    setPlaceholder({
      title: t(wizard?.initialQuote?.status === "returned" ? "outcome.resubmittedTitle" : "outcome.submittedTitle"),
      message: t("outcome.submittedMessage", { number: quote.quoteNumber }),
    });
  };

  const approvalQuote = approvalQuoteId
    ? quotes.find((quote) => quote.id === approvalQuoteId)
    : undefined;
  const quotationQuote = quotationQuoteId
    ? quotes.find((quote) => quote.id === quotationQuoteId)
    : undefined;
  const progressQuote = progressQuoteId
    ? quotes.find((quote) => quote.id === progressQuoteId)
    : undefined;

  const handleApprove = () => {
    if (!approvalQuote) return;
    const nextQuote = approveQuote(approvalQuote, user);
    persistQuote(nextQuote, approvalQuote);
    setApprovalQuoteId(null);
    setPlaceholder({
      title: t(nextQuote.status === "pending_ceo" ? "outcome.sentToCeoTitle" : "outcome.approvedTitle"),
      message: nextQuote.status === "pending_ceo"
        ? t("outcome.sentToCeoMessage", { number: nextQuote.quoteNumber })
        : t("outcome.approvedMessage", { number: nextQuote.quoteNumber }),
    });
  };

  const handleReturn = (reason: string) => {
    if (!approvalQuote) return;
    const nextQuote = returnQuote(approvalQuote, user, reason);
    persistQuote(nextQuote, approvalQuote);
    setApprovalQuoteId(null);
    setPlaceholder({
      title: t("outcome.returnedTitle"),
      message: t("outcome.returnedMessage", { number: nextQuote.quoteNumber }),
    });
  };

  return (
    <AppShell
      user={user}
      onSwitchUser={(nextUser) => {
        setUser(nextUser);
        setWizard(null);
        setApprovalQuoteId(null);
        setProgressQuoteId(null);
        setQuotationQuoteId(null);
      }}
      onReset={handleReset}
      onLogout={() => {
        setUser(null);
        setWizard(null);
        setApprovalQuoteId(null);
        setProgressQuoteId(null);
        setQuotationQuoteId(null);
      }}
      onPlaceholder={openPlaceholder}
    >
      {quotationQuote ? (
        <QuotationScreen
          quote={quotationQuote}
          onBack={() => setQuotationQuoteId(null)}
          onPrint={() => window.print()}
          onViewHistory={() => {
            setProgressQuoteId(quotationQuote.id);
            setQuotationQuoteId(null);
          }}
        />
      ) : progressQuote && (progressQuote.status === "approved" || user.role === "sales") ? (
        <QuoteProgressScreen
          quote={progressQuote}
          backLabel={progressQuote.status === "approved" ? "返回正式报价" : "返回工作台"}
          onBack={() => {
            if (progressQuote.status === "approved") setQuotationQuoteId(progressQuote.id);
            setProgressQuoteId(null);
          }}
          onEdit={() => {
            setWizard({ initialQuote: progressQuote });
            setProgressQuoteId(null);
          }}
        />
      ) : approvalQuote && (user.role === "manager" || user.role === "ceo") ? (
        <ApprovalScreen
          quote={approvalQuote}
          actor={user}
          onApprove={handleApprove}
          onReturn={handleReturn}
          onBack={() => setApprovalQuoteId(null)}
        />
      ) : wizard && user.role === "sales" ? (
        <QuoteWizard
          initialQuote={wizard.initialQuote}
          salesUser={user}
          onCancel={() => setWizard(null)}
          onSave={handleSave}
          onSubmit={handleSubmit}
        />
      ) : (
        <DashboardScreen user={user} quotes={quotes} onAction={handleDashboardAction} />
      )}
      <Modal open={placeholder !== null} title={placeholder?.title ?? ""} onClose={() => setPlaceholder(null)}>
        <p>{placeholder?.message}</p>
      </Modal>
    </AppShell>
  );
}

function assertPersistableQuote(input: QuoteInput, actor: User) {
  const errors = {
    ...validateQuoteReferences(input, actor.id, {
      customers: CUSTOMERS,
      buildings: BUILDINGS,
      packages: PACKAGES,
    }),
    ...validateQuote(input),
    ...(!input.placementMode ? { placementMode: "请选择投放方式" } : {}),
  };

  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors).join("；"));
  }
}

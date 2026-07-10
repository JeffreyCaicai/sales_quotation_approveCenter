"use client";

import { useState } from "react";

import { BUILDINGS, CUSTOMERS, PACKAGES } from "@/lib/mock-data";
import { calculatePricing, submitQuote, validateQuote, validateQuoteReferences } from "@/lib/quotation";
import { loadQuotes, resetQuotes, saveQuotes } from "@/lib/store";
import type { Quote, QuoteInput, User } from "@/lib/types";

import { AppShell } from "./app-shell";
import { DashboardScreen } from "./dashboard-screen";
import { LoginScreen } from "./login-screen";
import { QuoteWizard } from "./quote-wizard";
import { Modal } from "./ui";

interface PlaceholderState {
  title: string;
  message: string;
}

interface WizardSession {
  initialQuote?: Quote;
}

export function QuotationApp() {
  const [user, setUser] = useState<User | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>(() => loadQuotes());
  const [placeholder, setPlaceholder] = useState<PlaceholderState | null>(null);
  const [wizard, setWizard] = useState<WizardSession | null>(null);

  if (!user) return <LoginScreen onLogin={setUser} />;

  const openPlaceholder = (label: string, quote?: Quote) => {
    setPlaceholder({
      title: label,
      message: quote
        ? `${quote.quoteNumber} 的“${label}”流程将在后续原型阶段开放。`
        : `“${label}”流程将在后续原型阶段开放。`,
    });
  };

  const handleReset = () => {
    setQuotes(resetQuotes());
    setWizard(null);
    setPlaceholder({ title: "演示数据已重置", message: "所有报价已恢复为初始演示状态。" });
  };

  const persistQuote = (quote: Quote, previousQuote?: Quote) => {
    const next = previousQuote
      ? quotes.map((item) => item.id === previousQuote.id ? quote : item)
      : [quote, ...quotes];
    setQuotes(next);
    saveQuotes(next);
  };

  const handleDashboardAction = (label: string, quote?: Quote) => {
    if (user.role === "sales" && (label === "新建报价" || (quote && (quote.status === "draft" || quote.status === "returned")))) {
      setWizard({ initialQuote: quote });
      return;
    }

    openPlaceholder(label, quote);
  };

  const handleSave = (input: QuoteInput) => {
    const draft = saveDraft(input, wizard?.initialQuote, user);
    persistQuote(draft, wizard?.initialQuote);
    setWizard(null);
    setPlaceholder({
      title: "草稿已保存",
      message: draft.status === "returned"
        ? `${draft.quoteNumber} 的修改已保存，可继续完善后重新提交。`
        : `${draft.quoteNumber} 已保存到“我的报价”。`,
    });
  };

  const handleSubmit = (input: QuoteInput) => {
    assertPersistableQuote(input, user);
    const quote = submitQuote(input, wizard?.initialQuote, user);
    persistQuote(quote, wizard?.initialQuote);
    setWizard(null);
    setPlaceholder({
      title: wizard?.initialQuote?.status === "returned" ? "报价已重新提交" : "报价已提交",
      message: `${quote.quoteNumber} 已进入销售主管审批。`,
    });
  };

  return (
    <AppShell
      user={user}
      onSwitchUser={(nextUser) => {
        setUser(nextUser);
        setWizard(null);
      }}
      onReset={handleReset}
      onLogout={() => {
        setUser(null);
        setWizard(null);
      }}
      onPlaceholder={openPlaceholder}
    >
      {wizard && user.role === "sales" ? (
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

function saveDraft(input: QuoteInput, previousQuote: Quote | undefined, actor: User): Quote {
  const persistableInput = input.placementMode || !previousQuote
    ? input
    : { ...input, placementMode: previousQuote.placementMode };
  assertPersistableQuote(persistableInput, actor);
  const now = new Date().toISOString();
  const identifier = now.replace(/\D/g, "");

  return {
    id: previousQuote?.id ?? `quote-draft-${identifier}`,
    quoteNumber: previousQuote?.quoteNumber ?? `DEMO-DRAFT-${identifier.slice(0, 8)}-${identifier.slice(8)}`,
    salesId: actor.id,
    customerId: persistableInput.customerId ?? "",
    brandId: persistableInput.brandId ?? "",
    placementMode: persistableInput.placementMode ?? "building",
    placementIds: [...(persistableInput.placementIds ?? [])],
    weeks: persistableInput.weeks ?? 0,
    spots: persistableInput.spots ?? 0,
    bonus: persistableInput.bonus ?? 0,
    discount: persistableInput.discount,
    pricing: calculatePricing(persistableInput),
    status: previousQuote?.status === "returned" ? "returned" : "draft",
    version: previousQuote?.version ?? 1,
    approvalHistory: [...(previousQuote?.approvalHistory ?? [])],
    createdAt: previousQuote?.createdAt ?? now,
    updatedAt: now,
    isDemoData: true,
  };
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

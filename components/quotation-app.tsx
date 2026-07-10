"use client";

import { useState } from "react";

import { loadQuotes, resetQuotes } from "@/lib/store";
import type { Quote, User } from "@/lib/types";

import { AppShell } from "./app-shell";
import { DashboardScreen } from "./dashboard-screen";
import { LoginScreen } from "./login-screen";
import { Modal } from "./ui";

interface PlaceholderState {
  title: string;
  message: string;
}

export function QuotationApp() {
  const [user, setUser] = useState<User | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>(() => loadQuotes());
  const [placeholder, setPlaceholder] = useState<PlaceholderState | null>(null);

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
    setPlaceholder({ title: "演示数据已重置", message: "所有报价已恢复为初始演示状态。" });
  };

  return (
    <AppShell
      user={user}
      onSwitchUser={setUser}
      onReset={handleReset}
      onLogout={() => setUser(null)}
      onPlaceholder={openPlaceholder}
    >
      <DashboardScreen user={user} quotes={quotes} onAction={openPlaceholder} />
      <Modal open={placeholder !== null} title={placeholder?.title ?? ""} onClose={() => setPlaceholder(null)}>
        <p>{placeholder?.message}</p>
      </Modal>
    </AppShell>
  );
}

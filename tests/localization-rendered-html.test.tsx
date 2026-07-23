import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";
import { ApprovalScreen } from "@/components/approval-screen";
import { DashboardScreen } from "@/components/dashboard-screen";
import { LoginScreen } from "@/components/login-screen";
import { LocaleProvider } from "@/components/locale-provider";
import { QuoteWizard } from "@/components/quote-wizard";
import { QuoteVersionHistory } from "@/components/quote-version-history";
import { QuotationScreen } from "@/components/quotation-screen";
import { StatusBadge } from "@/components/ui";
import { SEEDED_QUOTES, USERS } from "@/lib/mock-data";
import type { User } from "@/lib/types";

const businessControlUser: User = {
  id: "business-control-april",
  name: "April",
  role: "business_control",
  title: "Head of Business Control",
  isDemoData: true,
};

describe("shared localized role and status UI", () => {
  it("renders a unique localized identity for every demo login option", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <LoginScreen onLogin={() => undefined} />
      </LocaleProvider>,
    );

    expect(html).toContain("Chen Chen");
    expect(html).toContain("Ayu Purnama");
    expect(html).toContain("Freelancer Demo");
    expect(html).toContain("Amal");
    expect(html).toContain("Desti");
    expect(html).toContain("Aprilliani Shintia Dewi");
    expect(html).toContain("Thomas");
  });

  it("renders the Business Control role in the application shell", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <AppShell
          user={businessControlUser}
          onSwitchUser={() => undefined}
          onReset={() => undefined}
          onLogout={() => undefined}
          onPlaceholder={() => undefined}
        >
          <p>Queue</p>
        </AppShell>
      </LocaleProvider>,
    );

    expect(html).toContain("Head of Business Control");
    expect(html).toContain("Queue");
  });

  it("renders the awaiting Business Control status badge", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <StatusBadge status="pending_business_control" />
      </LocaleProvider>,
    );

    expect(html).toContain("Awaiting Head of Business Control");
    expect(html).toContain("status-badge--pending_business_control");
  });

  it("renders placement and optional bonus as separate wizard stages", () => {
    const salesUser: User = {
      id: "sales-chen",
      name: "Chen",
      role: "sales",
      title: "Sales",
      isDemoData: true,
    };
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <QuoteWizard
          salesUser={salesUser}
          onCancel={() => undefined}
          onSave={() => undefined}
          onSubmit={() => undefined}
        />
      </LocaleProvider>,
    );

    expect(html).toContain("Placement");
    expect(html).toContain("Bonus");
    expect(html).toContain("Step 1 of 6");
    expect(html).toContain("Placement Gross");
    expect(html).toContain("Bonus Gross");
    expect(html).toContain("Total incl. tax");
  });
});

describe("nested quotation downstream surfaces", () => {
  const renderLocalized = (node: React.ReactNode) => renderToStaticMarkup(
    <LocaleProvider>{node}</LocaleProvider>,
  );

  it("renders the Business Control direct queue with a decision action", () => {
    const actor = USERS.find((user) => user.role === "business_control")!;
    const quote = SEEDED_QUOTES.find((item) => item.status === "pending_business_control")!;
    const html = renderLocalized(
      <DashboardScreen user={actor} quotes={SEEDED_QUOTES} onAction={() => undefined} />,
    );

    expect(html).toContain("Head of Business Control");
    expect(html).toContain(quote.quoteNumber);
    expect(html).toContain("Review quotation");
    expect(html).not.toContain("DEMO-Q-202607-002");
    expect(html).not.toContain("DEMO-Q-202607-004");
  });

  it("counts all three direct approval statuses on the Sales dashboard", () => {
    const actor = USERS.find((user) => user.role === "sales")!;
    const html = renderLocalized(
      <DashboardScreen user={actor} quotes={SEEDED_QUOTES} onAction={() => undefined} />,
    );

    expect(html).toContain("In approval");
    expect(html).toContain(">3<");
    expect(html).toContain("Effective Discount");
  });

  it("renders independent Placement and Bonus details and a domain-consistent ledger for approval", () => {
    const actor = USERS.find((user) => user.role === "business_control")!;
    const quote = SEEDED_QUOTES.find((item) => item.status === "pending_business_control")!;
    const html = renderLocalized(
      <ApprovalScreen
        quote={quote}
        actor={actor}
        onApprove={() => undefined}
        onReturn={() => undefined}
        onBack={() => undefined}
      />,
    );

    expect(html).toContain("Placement");
    expect(html).toContain("Bonus");
    expect(html).toContain("TVC");
    expect(html).toContain("Placement Gross");
    expect(html).toContain("Bonus Gross");
    expect(html).toContain("Bonus Nett");
    expect(html).toContain("FREE");
    expect(html).toContain("Total Gross");
    expect(html).toContain("Total Nett");
    expect(html).toContain("Effective Discount");
    expect(html).toContain("Approve quotation");
  });

  it("shows immutable version snapshots with both commercial sections and their direct approver", () => {
    const quote = SEEDED_QUOTES.find((item) => item.status === "pending_business_control")!;
    const html = renderLocalized(<QuoteVersionHistory quote={quote} />);

    expect(html).toContain("V1 commercial summary");
    expect(html).toContain("Placement");
    expect(html).toContain("Bonus");
    expect(html).toContain("Total Gross");
    expect(html).toContain("Effective Discount");
    expect(html).toContain("Head of Business Control");
  });

  it("renders approved Quotation rows for Placement and no Bonus without stale flat fields", () => {
    const quote = SEEDED_QUOTES.find((item) => item.status === "approved")!;
    const html = renderLocalized(
      <QuotationScreen
        quote={quote}
        onBack={() => undefined}
        onPrint={() => undefined}
        onViewHistory={() => undefined}
      />,
    );

    expect(html).toContain("Placement");
    expect(html).toContain("No Bonus");
    expect(html).toContain("Placement Nett");
    expect(html).toContain("Bonus Nett");
    expect(html).toContain("FREE");
    expect(html).toContain("Total incl. tax");
  });
});

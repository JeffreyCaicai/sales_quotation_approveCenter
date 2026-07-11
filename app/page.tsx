import type { Metadata } from "next";

import { QuotationApp } from "@/components/quotation-app";

export const metadata: Metadata = {
  title: "Quotation Approval Center",
  description: "Quotation and discount approval workspace for Sales, Sales Managers, and the CEO.",
};

export default function Home() {
  return <QuotationApp />;
}

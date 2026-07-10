import type { Metadata } from "next";

import { QuotationApp } from "@/components/quotation-app";

export const metadata: Metadata = {
  title: "报价审批中心",
  description: "面向销售、销售主管与 CEO 的报价审批协作工作台。",
};

export default function Home() {
  return <QuotationApp />;
}

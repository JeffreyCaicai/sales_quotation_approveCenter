import type { Metadata } from "next";

import { ImportAdminApp } from "@/components/admin/import-admin-app";

export const metadata: Metadata = {
  title: "Data Import Administration",
  description: "Bilingual controlled master-data import administration.",
};

export default function ImportAdministrationPage() {
  return <ImportAdminApp />;
}

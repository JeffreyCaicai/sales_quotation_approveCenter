import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { TEMPLATE_VERSION_V2 } from "@/lib/imports/template-v2";

const templateFilename = {
  building: "02_Buildings_Template.xlsx",
  rate_card: "04_Rate_Card_Template.xlsx",
} as const;

export async function generateImportTemplate(
  dataType: "building" | "rate_card",
  templateVersion: typeof TEMPLATE_VERSION_V2,
): Promise<Buffer> {
  if (templateVersion !== TEMPLATE_VERSION_V2) {
    throw new Error(`Unsupported template version: ${templateVersion}`);
  }
  return readFile(
    join(
      process.cwd(),
      "server-assets",
      "templates",
      "v2",
      templateFilename[dataType],
    ),
  );
}

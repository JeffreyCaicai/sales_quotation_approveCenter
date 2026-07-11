import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateImportTemplate } from "@/lib/imports/generate-template";
import { TEMPLATE_VERSION_V2 } from "@/lib/imports/template-v2";

const outputDir = join(
  process.cwd(),
  "outputs",
  "stage2_formal_templates_2026-07-11",
);

await mkdir(outputDir, { recursive: true });

for (const [dataType, filename] of [
  ["building", "02_Buildings_Template.xlsx"],
  ["rate_card", "04_Rate_Card_Template.xlsx"],
] as const) {
  const buffer = await generateImportTemplate(dataType, TEMPLATE_VERSION_V2);
  await writeFile(join(outputDir, filename), buffer);
}

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const serverAssetRoot = path.join(repoRoot, "server-assets", "templates", "v2");
const constants = await import(
  pathToFileURL(path.join(repoRoot, "lib", "imports", "template-v2.ts")).href
);

const {
  BUILDING_HEADERS,
  RATE_CARD_BUILDING_PRICE_HEADERS,
  RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS,
  RATE_CARD_PACKAGE_PRICE_HEADERS,
  TEMPLATE_VERSION_V2,
} = constants;

function instructions(title) {
  return [
    [title],
    [],
    ["Workbook", title],
    ["Template Version", TEMPLATE_VERSION_V2],
    [],
    ["English — Read before completing the template"],
    [
      "IRIS IDs are permanent identifiers. ERP IDs may be blank until ERP mapping is available. Replace the example values, preserve every header exactly, and enter IDR prices as whole numbers.",
    ],
    [],
    ["Bahasa Indonesia — Baca sebelum mengisi template"],
    [
      "ID IRIS adalah pengenal permanen. ID ERP boleh dikosongkan sampai pemetaan ERP tersedia. Ganti nilai contoh, pertahankan semua nama kolom, dan masukkan harga IDR sebagai bilangan bulat.",
    ],
  ];
}

function appendSheet(workbook, name, values, widths = []) {
  const sheet = XLSX.utils.aoa_to_sheet(values);
  if (widths.length > 0) sheet["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function buildBuildingWorkbook() {
  const workbook = XLSX.utils.book_new();
  appendSheet(
    workbook,
    "Instructions",
    instructions("Buildings Import Template / Template Impor Gedung"),
    [28, 40],
  );
  appendSheet(workbook, "Data", [
    [...BUILDING_HEADERS],
    [
      "B003004",
      null,
      "Apartment 19th Avenue",
      "Apartment",
      "Grade A",
      "West Jakarta",
      "Jakarta",
      null,
      "Cengkareng",
      "Jl. Daan Mogot",
      "active",
      "building_team",
    ],
  ], [16, 16, 28, 17, 17, 19, 16, 16, 18, 28, 19, 18]);
  return workbook;
}

function buildRateCardWorkbook() {
  const workbook = XLSX.utils.book_new();
  appendSheet(
    workbook,
    "Instructions",
    instructions("Rate Card Import Template / Template Impor Rate Card"),
    [28, 40],
  );
  appendSheet(workbook, "Metadata", [
    ["Template Version", TEMPLATE_VERSION_V2],
    ["Currency", "IDR"],
  ], [24, 24]);
  appendSheet(workbook, "Building Prices", [
    [...RATE_CARD_BUILDING_PRICE_HEADERS],
    ["B003004", 1_000_000],
  ], [24, 24]);
  appendSheet(workbook, "Package Prices", [
    [...RATE_CARD_PACKAGE_PRICE_HEADERS],
    ["PKG-01", 1_500_000],
  ], [24, 24]);
  appendSheet(workbook, "Package Membership", [
    [...RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS],
    ["PKG-01", "B003004"],
  ], [24, 24]);
  return workbook;
}

async function exportWorkbook(workbook, filename) {
  await fs.mkdir(serverAssetRoot, { recursive: true });
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  await fs.writeFile(path.join(serverAssetRoot, filename), bytes);
}

await exportWorkbook(buildBuildingWorkbook(), "02_Buildings_Template.xlsx");
await exportWorkbook(buildRateCardWorkbook(), "04_Rate_Card_Template.xlsx");

console.log(`EXPORTED ${TEMPLATE_VERSION_V2} assets to ${serverAssetRoot}`);

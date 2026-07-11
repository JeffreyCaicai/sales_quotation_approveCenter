import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const renderRoot = path.resolve(process.argv[3] ?? path.join(repoRoot, "work", "template-renders"));
const serverAssetRoot = path.join(repoRoot, "server-assets", "templates", "v2");
const constants = await import(
  pathToFileURL(path.join(repoRoot, "lib", "imports", "template-v2.ts")).href
);

const { BUILDING_HEADERS, RATE_CARD_HEADERS, TEMPLATE_VERSION_V2 } = constants;

const colors = {
  navy: "#16324F",
  blue: "#1D4ED8",
  paleBlue: "#E8F0FE",
  paleGold: "#FFF4CC",
  paleGreen: "#E8F5E9",
  line: "#CBD5E1",
  white: "#FFFFFF",
  ink: "#172033",
  muted: "#475569",
};

function styleTitle(sheet, range) {
  sheet.getRange(range).format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 16 },
    verticalAlignment: "center",
  };
  sheet.getRange(range).format.rowHeight = 30;
}

function styleHeaders(sheet, range) {
  sheet.getRange(range).format = {
    fill: colors.blue,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: colors.navy },
  };
  sheet.getRange(range).format.rowHeight = 34;
}

function addInstructions(workbook, title, columnEnd) {
  const sheet = workbook.worksheets.add("Instructions");
  sheet.showGridLines = false;
  sheet.getRange(`A1:${columnEnd}1`).merge();
  sheet.getRange("A1").values = [[title]];
  styleTitle(sheet, `A1:${columnEnd}1`);

  sheet.getRange("A3:B4").values = [
    ["Workbook", title],
    ["Template Version", TEMPLATE_VERSION_V2],
  ];
  sheet.getRange("A3:A4").format = {
    fill: colors.paleBlue,
    font: { bold: true, color: colors.ink },
  };
  sheet.getRange("A3:B4").format.borders = {
    preset: "outside",
    style: "thin",
    color: colors.line,
  };

  sheet.getRange(`A6:${columnEnd}6`).merge();
  sheet.getRange("A6").values = [["English — Read before completing the template"]];
  sheet.getRange(`A6:${columnEnd}6`).format = {
    fill: colors.paleBlue,
    font: { bold: true, color: colors.navy },
  };
  sheet.getRange(`A7:${columnEnd}7`).merge();
  sheet.getRange("A7").values = [[
    "IRIS IDs are permanent identifiers. ERP IDs may be blank until ERP mapping is available. Replace the example values, preserve every header exactly, and enter IDR prices as whole numbers.",
  ]];
  sheet.getRange(`A7:${columnEnd}7`).format = {
    font: { color: colors.ink },
    wrapText: true,
    verticalAlignment: "top",
  };
  sheet.getRange(`A7:${columnEnd}7`).format.rowHeight = 48;

  sheet.getRange(`A9:${columnEnd}9`).merge();
  sheet.getRange("A9").values = [["Bahasa Indonesia — Baca sebelum mengisi template"]];
  sheet.getRange(`A9:${columnEnd}9`).format = {
    fill: colors.paleGreen,
    font: { bold: true, color: "#166534" },
  };
  sheet.getRange(`A10:${columnEnd}10`).merge();
  sheet.getRange("A10").values = [[
    "ID IRIS adalah pengenal permanen. ID ERP boleh dikosongkan sampai pemetaan ERP tersedia. Ganti nilai contoh, pertahankan semua nama kolom, dan masukkan harga IDR sebagai bilangan bulat.",
  ]];
  sheet.getRange(`A10:${columnEnd}10`).format = {
    font: { color: colors.ink },
    wrapText: true,
    verticalAlignment: "top",
  };
  sheet.getRange(`A10:${columnEnd}10`).format.rowHeight = 48;
  sheet.getRange(`A1:${columnEnd}10`).format.font.name = "Aptos";
  sheet.getRange("A1").format.columnWidth = 26;
  sheet.getRange("B1").format.columnWidth = 34;
  if (columnEnd !== "B") sheet.getRange(`C1:${columnEnd}1`).format.columnWidth = 12;
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

function buildBuildingWorkbook() {
  const workbook = Workbook.create();
  addInstructions(workbook, "Buildings Import Template / Template Impor Gedung", "L");
  const sheet = workbook.worksheets.add("Data");
  sheet.showGridLines = false;
  sheet.getRange("A1:L2").values = [
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
  ];
  styleHeaders(sheet, "A1:L1");
  sheet.getRange("A2:L2").format = {
    fill: colors.paleGold,
    font: { color: colors.muted, italic: true },
    verticalAlignment: "top",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: colors.line },
  };
  sheet.getRange("A1:L2").format.font.name = "Aptos";
  sheet.getRange("A2:B2").format.numberFormat = "@";
  const widths = [16, 16, 28, 17, 17, 19, 16, 16, 18, 28, 19, 18];
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 2, 1).format.columnWidth = width;
  });
  sheet.getRange("A2:L2").format.rowHeight = 42;
  sheet.freezePanes.freezeRows(1);
  return workbook;
}

function addRateDataSheet(workbook, name, headers, example) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const end = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${end}2`).values = [[...headers], example];
  styleHeaders(sheet, `A1:${end}1`);
  sheet.getRange(`A2:${end}2`).format = {
    fill: colors.paleGold,
    font: { color: colors.muted, italic: true },
    borders: { preset: "outside", style: "thin", color: colors.line },
  };
  sheet.getRange(`A1:${end}2`).format.font.name = "Aptos";
  sheet.getRange(`A1:${end}2`).format.columnWidth = 24;
  if (headers.includes("Price IDR")) {
    const priceColumn = headers.indexOf("Price IDR");
    sheet.getRangeByIndexes(1, priceColumn, 1, 1).format.numberFormat = '"IDR" #,##0';
    sheet.getRangeByIndexes(1, priceColumn, 1, 1).format.horizontalAlignment = "right";
  }
  sheet.freezePanes.freezeRows(1);
}

function buildRateCardWorkbook() {
  const workbook = Workbook.create();
  addInstructions(workbook, "Rate Card Import Template / Template Impor Rate Card", "E");
  const metadata = workbook.worksheets.add("Metadata");
  metadata.showGridLines = false;
  metadata.getRange("A1:B4").values = [
    ["Template Version", TEMPLATE_VERSION_V2],
    ["Version Code", "RC-2026-07"],
    ["Effective Date", new Date(Date.UTC(2026, 6, 15))],
    ["Currency", "IDR"],
  ];
  metadata.getRange("A1:A4").format = {
    fill: colors.paleBlue,
    font: { bold: true, color: colors.ink, name: "Aptos" },
  };
  metadata.getRange("B1:B4").format = { font: { color: colors.ink, name: "Aptos" } };
  metadata.getRange("A1:B4").format.borders = {
    preset: "outside",
    style: "thin",
    color: colors.line,
  };
  metadata.getRange("B3").format.numberFormat = "yyyy-mm-dd";
  metadata.getRange("A1:A4").format.columnWidth = 24;
  metadata.getRange("B1:B4").format.columnWidth = 24;

  addRateDataSheet(
    workbook,
    "Building Prices",
    RATE_CARD_HEADERS["Building Prices"],
    ["B003004", 1_000_000],
  );
  addRateDataSheet(
    workbook,
    "Package Prices",
    RATE_CARD_HEADERS["Package Prices"],
    ["PKG-01", 1_500_000],
  );
  addRateDataSheet(
    workbook,
    "Package Buildings",
    RATE_CARD_HEADERS["Package Buildings"],
    ["PKG-01", "B003004"],
  );
  return workbook;
}

async function verifyAndExport(workbook, filename, keyRanges) {
  const workbookRenderRoot = path.join(renderRoot, path.basename(filename, ".xlsx"));
  await fs.mkdir(workbookRenderRoot, { recursive: true });

  for (const [sheetName, range] of keyRanges) {
    const inspected = await workbook.inspect({
      kind: "table",
      range: `${sheetName}!${range}`,
      include: "values,formulas",
      tableMaxRows: 12,
      tableMaxCols: 14,
      maxChars: 6000,
    });
    console.log(`INSPECT ${filename} ${sheetName} ${range}`);
    console.log(inspected.ndjson);
    const preview = await workbook.render({
      sheetName,
      range,
      scale: 1.5,
      format: "png",
    });
    const safeName = sheetName.replaceAll(" ", "_");
    await fs.writeFile(
      path.join(workbookRenderRoot, `${safeName}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: `formula error scan for ${filename}`,
    maxChars: 2000,
  });
  console.log(`FORMULA_ERRORS ${filename}`);
  console.log(errors.ndjson);

  await fs.mkdir(serverAssetRoot, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  const exportedPath = path.join(serverAssetRoot, filename);
  await output.save(exportedPath);

  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(exportedPath));
  const exportedSheets = await reopened.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 2000,
  });
  console.log(`REOPENED ${filename}`);
  console.log(exportedSheets.ndjson);
  const reopenedErrors = await reopened.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: `post-export formula error scan for ${filename}`,
    maxChars: 2000,
  });
  console.log(`POST_EXPORT_FORMULA_ERRORS ${filename}`);
  console.log(reopenedErrors.ndjson);
  await fs.rm(`${exportedPath}.inspect.ndjson`, { force: true });
}

await verifyAndExport(buildBuildingWorkbook(), "02_Buildings_Template.xlsx", [
  ["Instructions", "A1:L10"],
  ["Data", "A1:L2"],
]);
await verifyAndExport(buildRateCardWorkbook(), "04_Rate_Card_Template.xlsx", [
  ["Instructions", "A1:E10"],
  ["Metadata", "A1:B4"],
  ["Building Prices", "A1:B2"],
  ["Package Prices", "A1:B2"],
  ["Package Buildings", "A1:B2"],
]);

console.log(`EXPORTED ${TEMPLATE_VERSION_V2} assets to ${serverAssetRoot}`);

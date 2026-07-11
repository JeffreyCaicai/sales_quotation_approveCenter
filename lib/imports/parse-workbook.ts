import * as XLSX from "xlsx";

import { ImportParseError, type SourceRow } from "@/lib/imports/template-v2";
import { inspectXlsxContainer } from "@/lib/imports/xlsx-container";

export interface ParsedSheet {
  name: string;
  rows: SourceRow[];
}

function hasFormula(workbook: XLSX.WorkBook): boolean {
  return workbook.SheetNames.some((name) =>
    Object.entries(workbook.Sheets[name]).some(([address, cell]) =>
      !address.startsWith("!") && Boolean(cell && typeof cell === "object" && "f" in cell && cell.f),
    ),
  );
}

export async function parseWorkbook(body: Uint8Array): Promise<Map<string, ParsedSheet>> {
  await inspectXlsxContainer(body);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(body, {
      type: "array",
      cellDates: false,
      cellFormula: true,
      cellNF: false,
      cellText: false,
    });
  } catch {
    throw new ImportParseError("import.error.file_invalid");
  }
  if (hasFormula(workbook)) throw new ImportParseError("file.formula_not_allowed");

  return new Map(workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const startRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: true,
    }).map((cells, index) => ({ rowNumber: startRow + index, cells }));
    return [name, { name, rows }];
  }));
}

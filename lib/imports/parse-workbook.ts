import * as XLSX from "xlsx";

import { ImportParseError } from "@/lib/imports/template-v2";
import { inspectXlsxContainer } from "@/lib/imports/xlsx-container";

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
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

  return new Map(workbook.SheetNames.map((name) => [name, {
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    }),
  }]));
}

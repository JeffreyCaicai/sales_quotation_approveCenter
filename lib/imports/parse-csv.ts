import { parse } from "csv-parse/sync";

import { ImportParseError, type SourceRow } from "@/lib/imports/template-v2";

const MAX_RECORDS_WITH_HEADER = 10_001;

interface ParsedCsvRecord {
  record: unknown[];
  raw: string;
  info: {
    empty_lines: number;
    lines: number;
  };
}

function lineBreakCount(value: string): number {
  return value.match(/\r\n|[\n\r]/gu)?.length ?? 0;
}

export function parseCsv(body: Uint8Array): SourceRow[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ImportParseError("import.error.file_invalid");
  }
  if (text.includes("\0")) throw new ImportParseError("import.error.file_invalid");

  try {
    const records = parse(text, {
      bom: true,
      columns: false,
      info: true,
      raw: true,
      relax_column_count: false,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
    }) as unknown as ParsedCsvRecord[];
    if (records.length > MAX_RECORDS_WITH_HEADER) {
      throw new ImportParseError("import.error.row_limit_exceeded");
    }
    let previousEmptyLines = 0;
    return records.map(({ record, raw, info }) => {
      const skippedEmptyLines = info.empty_lines - previousEmptyLines;
      const physicalLines = lineBreakCount(raw) + (/(?:\r\n|[\n\r])$/u.test(raw) ? 0 : 1);
      const recordLines = Math.max(1, physicalLines - skippedEmptyLines);
      previousEmptyLines = info.empty_lines;
      return { rowNumber: info.lines - recordLines + 1, cells: record };
    });
  } catch (error) {
    if (error instanceof ImportParseError) throw error;
    throw new ImportParseError("import.error.file_invalid");
  }
}

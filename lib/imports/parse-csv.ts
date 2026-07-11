import { parse } from "csv-parse/sync";

import { ImportParseError, type SourceRow } from "@/lib/imports/template-v2";

const MAX_RECORDS_WITH_HEADER = 10_001;

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
      relax_column_count: false,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
    }) as unknown as Array<{ record: unknown[]; info: { lines: number } }>;
    if (records.length > MAX_RECORDS_WITH_HEADER) {
      throw new ImportParseError("import.error.row_limit_exceeded");
    }
    return records.map(({ record, info }) => ({ rowNumber: info.lines, cells: record }));
  } catch (error) {
    if (error instanceof ImportParseError) throw error;
    throw new ImportParseError("import.error.file_invalid");
  }
}

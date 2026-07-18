import { canonicalJson } from "@/lib/imports/canonical-json";
import type { ImportErrorItem, JsonValue } from "@/lib/imports/admin-contracts";

export type ImportErrorReportLocale = "en" | "zh-CN";

type MessageRenderer = (parameters: JsonValue) => string;

const messages: Record<ImportErrorReportLocale, Record<string, MessageRenderer>> = {
  en: {
    "file.formula_not_allowed": () => "Spreadsheet formulas are not allowed.",
    "import.error.missing_column": (parameters) => `Required column "${parameter(parameters, "column")}" is missing.`,
    "import.error.missing_sheet": (parameters) => `Required sheet "${parameter(parameters, "sheet")}" is missing.`,
    "import.error.unknown_column": (parameters) => `Column "${parameter(parameters, "column")}" is not supported.`,
    "import.error.unknown_sheet": (parameters) => `Sheet "${parameter(parameters, "sheet")}" is not supported.`,
    "import.error.template_version": () => "The import template version is invalid.",
    "import.error.row_limit_exceeded": () => "The import row limit was exceeded.",
    "import.error.file_invalid": () => "The import file is invalid.",
    "import.error.file_set_invalid": () => "The import file set is invalid.",
    "import.error.value_invalid": () => "A value is invalid.",
  },
  "zh-CN": {
    "file.formula_not_allowed": () => "不允许使用电子表格公式。",
    "import.error.missing_column": (parameters) => `缺少必填列“${parameter(parameters, "column")}”。`,
    "import.error.missing_sheet": (parameters) => `缺少必填工作表“${parameter(parameters, "sheet")}”。`,
    "import.error.unknown_column": (parameters) => `不支持列“${parameter(parameters, "column")}”。`,
    "import.error.unknown_sheet": (parameters) => `不支持工作表“${parameter(parameters, "sheet")}”。`,
    "import.error.template_version": () => "导入模板版本无效。",
    "import.error.row_limit_exceeded": () => "已超过导入行数限制。",
    "import.error.file_invalid": () => "导入文件无效。",
    "import.error.file_set_invalid": () => "导入文件组合无效。",
    "import.error.value_invalid": () => "某个值无效。",
  },
};

const fallback: Record<ImportErrorReportLocale, string> = {
  en: "An import validation error occurred.",
  "zh-CN": "发生导入验证错误。",
};

export function renderImportErrorsCsv(
  errors: readonly ImportErrorItem[],
  locale: ImportErrorReportLocale,
): string {
  const header = ["File", "Sheet", "Row", "Column", "Error Key", "Message", "Parameters"];
  const rows = errors.map((error) => [
    error.file,
    error.sheet,
    String(error.row),
    error.column,
    error.errorKey,
    messages[locale][error.errorKey]?.(error.parameters) ?? fallback[locale],
    canonicalJson(error.parameters),
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function parameter(parameters: JsonValue, key: string): string {
  if (parameters === null || Array.isArray(parameters) || typeof parameters !== "object") return "";
  const value = parameters[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

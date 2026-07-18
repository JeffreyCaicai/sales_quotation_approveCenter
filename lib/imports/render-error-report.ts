import { canonicalJson } from "@/lib/imports/canonical-json";
import type { ImportErrorItem, JsonValue } from "@/lib/imports/admin-contracts";

export type ImportErrorReportLocale = "en" | "zh-CN";

type MessageRenderer = (parameters: JsonValue) => string;

const messages: Record<ImportErrorReportLocale, Record<string, MessageRenderer>> = {
  en: {
    "file.formula_not_allowed": () => "Spreadsheet formulas are not allowed.",
    "import.error.address_required": () => "Address is required.",
    "import.error.building_controlled_values_unavailable": () => "Building Type and Grade Resource reference values are unavailable; ask an administrator to configure them.",
    "import.error.building_inactive": (parameters) => `Building ${parameter(parameters, "irisBuildingId")} is inactive and cannot be used in the Rate Card.`,
    "import.error.building_name_required": () => "Building Name is required.",
    "import.error.building_not_found": (parameters) => `Building ${parameter(parameters, "irisBuildingId")} was not found; add it to Building Master first.`,
    "import.error.building_reactivation_requires_admin_workflow": (parameters) => `Building ${parameter(parameters, "irisBuildingId")} is inactive and must be reactivated through the administrator workflow.`,
    "import.error.building_type_invalid": () => "Choose a configured Building Type.",
    "import.error.erp_building_id_conflict": (parameters) => `ERP Building ID ${parameter(parameters, "erpBuildingId")} already belongs to IRIS Building ${parameter(parameters, "irisBuildingId")}.`,
    "import.error.erp_building_id_duplicate": (parameters) => `ERP Building ID ${parameter(parameters, "erpBuildingId")} appears more than once in this import.`,
    "import.error.grade_resource_invalid": () => "Choose a configured Grade Resource.",
    "import.error.iris_building_id_duplicate": (parameters) => `IRIS Building ID ${parameter(parameters, "irisBuildingId")} appears more than once in this import.`,
    "import.error.iris_building_id_required": () => "IRIS Building ID is required.",
    "import.error.missing_column": (parameters) => `Required column "${parameter(parameters, "column")}" is missing.`,
    "import.error.missing_sheet": (parameters) => `Required sheet "${parameter(parameters, "sheet")}" is missing.`,
    "import.error.operational_status_invalid": () => "Operational Status must be active or inactive.",
    "import.error.operational_status_required": () => "Operational Status is required.",
    "import.error.package_code_duplicate": (parameters) => `Package Code ${parameter(parameters, "packageCode")} appears more than once in this import.`,
    "import.error.package_inactive": (parameters) => `Package ${parameter(parameters, "packageCode")} is inactive and cannot be used in the Rate Card.`,
    "import.error.package_membership_missing_price": (parameters) => `Package ${parameter(parameters, "packageCode")} has building membership but no price.`,
    "import.error.package_name_duplicate": (parameters) => `Package Name ${parameter(parameters, "packageName")} is already in use.`,
    "import.error.package_name_immutable": (parameters) => `Package ${parameter(parameters, "packageCode")} cannot change its existing name.`,
    "import.error.package_name_required": () => "Package Name is required.",
    "import.error.package_not_found": (parameters) => `Package ${parameter(parameters, "packageCode")} was not found; add it to Sales Package Master first.`,
    "import.error.package_price_missing_membership": (parameters) => `Package ${parameter(parameters, "packageCode")} has a price but no building membership.`,
    "import.error.rate_card_building_duplicate": (parameters) => `Building ${parameter(parameters, "irisBuildingId")} has more than one Rate Card price.`,
    "import.error.rate_card_empty": () => "Add at least one Building price, Package price, or Package membership row.",
    "import.error.rate_card_membership_duplicate": (parameters) => `Package ${parameter(parameters, "packageCode")} and Building ${parameter(parameters, "irisBuildingId")} have duplicate membership rows.`,
    "import.error.rate_card_package_duplicate": (parameters) => `Package ${parameter(parameters, "packageCode")} has more than one Rate Card price.`,
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
    "import.error.address_required": () => "必须填写地址。",
    "import.error.building_controlled_values_unavailable": () => "建筑类型和资源等级参考值不可用；请联系管理员进行配置。",
    "import.error.building_inactive": (parameters) => `建筑 ${parameter(parameters, "irisBuildingId")} 已停用，不能用于价目表。`,
    "import.error.building_name_required": () => "必须填写建筑名称。",
    "import.error.building_not_found": (parameters) => `找不到建筑 ${parameter(parameters, "irisBuildingId")}；请先将其添加到建筑主数据。`,
    "import.error.building_reactivation_requires_admin_workflow": (parameters) => `建筑 ${parameter(parameters, "irisBuildingId")} 已停用，必须通过管理员流程重新启用。`,
    "import.error.building_type_invalid": () => "请选择已配置的建筑类型。",
    "import.error.erp_building_id_conflict": (parameters) => `ERP 建筑 ID ${parameter(parameters, "erpBuildingId")} 已属于 IRIS 建筑 ${parameter(parameters, "irisBuildingId")}。`,
    "import.error.erp_building_id_duplicate": (parameters) => `ERP 建筑 ID ${parameter(parameters, "erpBuildingId")} 在本次导入中重复。`,
    "import.error.grade_resource_invalid": () => "请选择已配置的资源等级。",
    "import.error.iris_building_id_duplicate": (parameters) => `IRIS 建筑 ID ${parameter(parameters, "irisBuildingId")} 在本次导入中重复。`,
    "import.error.iris_building_id_required": () => "必须填写 IRIS 建筑 ID。",
    "import.error.missing_column": (parameters) => `缺少必填列“${parameter(parameters, "column")}”。`,
    "import.error.missing_sheet": (parameters) => `缺少必填工作表“${parameter(parameters, "sheet")}”。`,
    "import.error.operational_status_invalid": () => "运营状态必须为启用或停用。",
    "import.error.operational_status_required": () => "必须填写运营状态。",
    "import.error.package_code_duplicate": (parameters) => `套餐代码 ${parameter(parameters, "packageCode")} 在本次导入中重复。`,
    "import.error.package_inactive": (parameters) => `套餐 ${parameter(parameters, "packageCode")} 已停用，不能用于价目表。`,
    "import.error.package_membership_missing_price": (parameters) => `套餐 ${parameter(parameters, "packageCode")} 已配置建筑成员，但没有价格。`,
    "import.error.package_name_duplicate": (parameters) => `套餐名称 ${parameter(parameters, "packageName")} 已被使用。`,
    "import.error.package_name_immutable": (parameters) => `不能更改套餐 ${parameter(parameters, "packageCode")} 的现有名称。`,
    "import.error.package_name_required": () => "必须填写套餐名称。",
    "import.error.package_not_found": (parameters) => `找不到套餐 ${parameter(parameters, "packageCode")}；请先将其添加到销售套餐主数据。`,
    "import.error.package_price_missing_membership": (parameters) => `套餐 ${parameter(parameters, "packageCode")} 已配置价格，但没有建筑成员。`,
    "import.error.rate_card_building_duplicate": (parameters) => `建筑 ${parameter(parameters, "irisBuildingId")} 存在多个价目表价格。`,
    "import.error.rate_card_empty": () => "请至少添加一行建筑价格、套餐价格或套餐成员数据。",
    "import.error.rate_card_membership_duplicate": (parameters) => `套餐 ${parameter(parameters, "packageCode")} 与建筑 ${parameter(parameters, "irisBuildingId")} 的成员关系重复。`,
    "import.error.rate_card_package_duplicate": (parameters) => `套餐 ${parameter(parameters, "packageCode")} 存在多个价目表价格。`,
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

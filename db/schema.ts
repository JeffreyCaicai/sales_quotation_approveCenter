import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  changeTypes,
  entityStatuses,
  filePurposes,
  importDataTypes,
  importStates,
  rateCardVersionStatuses,
} from "./enums";

export const importDataTypeEnum = pgEnum("import_data_type", importDataTypes);
export const importStateEnum = pgEnum("import_state", importStates);
export const rateCardVersionStatusEnum = pgEnum(
  "rate_card_version_status",
  rateCardVersionStatuses,
);
export const entityStatusEnum = pgEnum("entity_status", entityStatuses);
export const changeTypeEnum = pgEnum("change_type", changeTypes);
export const filePurposeEnum = pgEnum("file_purpose", filePurposes);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  status: entityStatusEnum("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPermissions = pgTable(
  "user_permissions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    permissionKey: text("permission_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("user_permissions_user_id_permission_key_unique").on(
      table.userId,
      table.permissionKey,
    ),
  ],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    dataType: importDataTypeEnum("data_type").notNull(),
    templateVersion: text("template_version").notNull(),
    checksum: text("checksum").notNull(),
    state: importStateEnum("state").notNull().default("uploaded"),
    uploadAttemptId: uuid("upload_attempt_id"),
    uploadLeaseExpiresAt: timestamp("upload_lease_expires_at", { withTimezone: true }),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    sourceType: text("source_type").notNull().default("manual"),
    normalizedPayload: jsonb("normalized_payload"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    publishedBy: uuid("published_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    failureSummary: text("failure_summary"),
  },
  (table) => [
    check(
      "import_jobs_source_type_check",
      sql`${table.sourceType} in ('manual', 'crm')`,
    ),
    check(
      "import_jobs_upload_lease_state_check",
      sql`(
        ${table.state} = 'uploading'
        and ${table.uploadAttemptId} is not null
        and ${table.uploadLeaseExpiresAt} is not null
      ) or (
        ${table.state} <> 'uploading'
        and ${table.uploadLeaseExpiresAt} is null
      )`,
    ),
    index("import_jobs_state_created_at_idx").on(table.state, table.createdAt),
    index("import_jobs_data_type_published_at_idx").on(
      table.dataType,
      table.publishedAt,
    ),
    uniqueIndex("import_jobs_upload_attempt_id_unique")
      .on(table.uploadAttemptId)
      .where(sql`${table.uploadAttemptId} is not null`),
  ],
);

export const customers = pgTable("customers", {
  id: id(),
  customerCode: text("customer_code").notNull().unique(),
  name: text("name").notNull(),
  status: entityStatusEnum("status").notNull().default("active"),
  sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
  sourceMetadata: jsonb("source_metadata"),
  externalId: text("external_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brands = pgTable("brands", {
  id: id(),
  brandCode: text("brand_code").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  name: text("name").notNull(),
  status: entityStatusEnum("status").notNull().default("active"),
  sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
  sourceMetadata: jsonb("source_metadata"),
  externalId: text("external_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const salesAssignments = pgTable("sales_assignments", {
  id: id(),
  assignmentCode: text("assignment_code").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id),
  salesPicUserId: uuid("sales_pic_user_id")
    .notNull()
    .references(() => users.id),
  salesType: text("sales_type").notNull(),
  buyingChannel: text("buying_channel").notNull(),
  clientStatus: text("client_status").notNull(),
  clientType: text("client_type").notNull(),
  registrationDate: date("registration_date"),
  expiryDate: date("expiry_date"),
  remarks: text("remarks"),
  status: entityStatusEnum("status").notNull().default("active"),
  sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
  sourceMetadata: jsonb("source_metadata"),
  externalId: text("external_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const buildings = pgTable(
  "buildings",
  {
    id: id(),
    irisBuildingId: text("iris_building_id").notNull().unique(),
    erpBuildingId: text("erp_building_id"),
    name: text("name").notNull(),
    buildingType: text("building_type"),
    gradeResource: text("grade_resource"),
    area: text("area"),
    city: text("city"),
    cbdArea: text("cbd_area"),
    subDistrict: text("sub_district"),
    address: text("address").notNull(),
    traffic: bigint("traffic", { mode: "number" }),
    impressions: bigint("impressions", { mode: "number" }),
    erpLinkStatus: text("erp_link_status").notNull().default("manual_only"),
    dataSource: text("data_source").notNull().default("building_team"),
    status: entityStatusEnum("status").notNull().default("active"),
    sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
    sourceAttributes: jsonb("source_attributes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("buildings_iris_building_id_not_blank_check", sql`regexp_replace(${table.irisBuildingId}, '\\s', '', 'g') <> ''`),
    check("buildings_name_not_blank_check", sql`regexp_replace(${table.name}, '\\s', '', 'g') <> ''`),
    check("buildings_address_not_blank_check", sql`regexp_replace(${table.address}, '\\s', '', 'g') <> ''`),
    uniqueIndex("buildings_erp_building_id_unique")
      .on(table.erpBuildingId)
      .where(sql`${table.erpBuildingId} is not null`),
    check(
      "buildings_erp_link_status_check",
      sql`(
        (${table.erpBuildingId} is null and ${table.erpLinkStatus} = 'manual_only') or
        (${table.erpBuildingId} is not null and ${table.erpLinkStatus} = 'erp_linked')
      )`,
    ),
    check(
      "buildings_data_source_check",
      sql`${table.dataSource} in ('building_team', 'erp')`,
    ),
  ],
);

export const buildingControlledValues = pgTable(
  "building_controlled_values",
  {
    id: id(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    status: entityStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("building_controlled_values_field_check", sql`${table.field} in ('building_type', 'grade_resource')`),
    check("building_controlled_values_value_not_blank_check", sql`btrim(${table.value}) <> ''`),
    check("building_controlled_values_value_trimmed_check", sql`${table.value} = regexp_replace(${table.value}, '^\\s+|\\s+$', '', 'g')`),
    unique("building_controlled_values_field_value_unique").on(table.field, table.value),
  ],
);

export const salesPackages = pgTable("sales_packages", {
  id: id(),
  packageCode: text("package_code").notNull().unique(),
  name: text("name").notNull(),
  status: entityStatusEnum("status").notNull().default("active"),
  sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateCardVersions = pgTable(
  "rate_card_versions",
  {
    id: id(),
    versionCode: text("version_code").notNull().unique(),
    currency: text("currency").notNull().default("IDR"),
    status: rateCardVersionStatusEnum("status")
      .notNull()
      .default("historical"),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    publishedBy: uuid("published_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "rate_card_versions_currency_idr_check",
      sql`${table.currency} = 'IDR'`,
    ),
  ],
);

export const rateCardBuildingPrices = pgTable(
  "rate_card_building_prices",
  {
    id: id(),
    rateCardVersionId: uuid("rate_card_version_id")
      .notNull()
      .references(() => rateCardVersions.id),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id),
    priceIdr: numeric("price_idr", { precision: 18, scale: 0 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("rate_card_building_prices_version_building_unique").on(
      table.rateCardVersionId,
      table.buildingId,
    ),
  ],
);

export const rateCardPackageConfigs = pgTable(
  "rate_card_package_configs",
  {
    id: id(),
    rateCardVersionId: uuid("rate_card_version_id")
      .notNull()
      .references(() => rateCardVersions.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => salesPackages.id),
    priceIdr: numeric("price_idr", { precision: 18, scale: 0 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("rate_card_package_configs_version_package_unique").on(
      table.rateCardVersionId,
      table.packageId,
    ),
  ],
);

export const rateCardPackageBuildings = pgTable(
  "rate_card_package_buildings",
  {
    id: id(),
    rateCardVersionId: uuid("rate_card_version_id")
      .notNull()
      .references(() => rateCardVersions.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => salesPackages.id),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique("rate_card_package_buildings_version_package_building_unique").on(
      table.rateCardVersionId,
      table.packageId,
      table.buildingId,
    ),
  ],
);

export const importFiles = pgTable("import_files", {
  id: id(),
  importJobId: uuid("import_job_id")
    .notNull()
    .references(() => importJobs.id),
  objectStorageKey: text("object_storage_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: text("checksum").notNull(),
  purpose: filePurposeEnum("purpose").notNull(),
  createdAt: createdAt(),
});

export const importErrors = pgTable(
  "import_errors",
  {
    id: id(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id),
    sheetName: text("sheet_name"),
    filename: text("filename"),
    rowNumber: integer("row_number").notNull(),
    columnName: text("column_name"),
    errorKey: text("error_key").notNull(),
    localizedParameters: jsonb("localized_parameters").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("import_errors_import_job_id_row_number_idx").on(
      table.importJobId,
      table.rowNumber,
    ),
  ],
);

export const importChanges = pgTable("import_changes", {
  id: id(),
  importJobId: uuid("import_job_id")
    .notNull()
    .references(() => importJobs.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  changeType: changeTypeEnum("change_type").notNull(),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    importJobId: uuid("import_job_id").references(() => importJobs.id),
    source: text("source").notNull(),
    reason: text("reason"),
    beforeMetadata: jsonb("before_metadata"),
    afterMetadata: jsonb("after_metadata"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_events_entity_type_entity_id_created_at_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

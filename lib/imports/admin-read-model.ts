import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import {
  auditEvents,
  buildings,
  importChanges,
  importErrors,
  importFiles,
  importJobs,
  rateCardVersions,
  salesPackages,
  userPermissions,
  users,
} from "@/db/schema";
import type { Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import {
  importJobFiltersAreBounded,
  isUuidIdentifier,
  type ImportAdminSummary,
  type ImportAdminUserItem,
  type ImportAuditItem,
  type ImportChangeItem,
  type ImportErrorItem,
  type ImportFileItem,
  type ImportJobDetail,
  type ImportJobFilters,
  type ImportJobListItem,
  type JsonValue,
  type RateCardVersionListItem,
} from "@/lib/imports/admin-contracts";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

export type AdminReadErrorKey =
  | "PERMISSION_DENIED"
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_FILE_NOT_FOUND"
  | "IMPORT_IDENTIFIER_INVALID"
  | "IMPORT_FILTER_INVALID";

export class AdminReadError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    public readonly key: AdminReadErrorKey,
  ) {
    super(key);
    this.name = "AdminReadError";
  }
}

const uploadedUsers = alias(users, "admin_import_uploaded_users");
const publishedUsers = alias(users, "admin_import_published_users");
const auditUsers = alias(users, "admin_import_audit_users");

const publishedJobStates = ["published", "active", "superseded", "rolled_back"] as const;
const validatingJobStates = new Set(["uploading", "uploaded", "validating"]);
const readyJobStates = new Set(["ready_to_publish", "draft"]);

export async function getImportAdminSummary(actor: SessionUser): Promise<ImportAdminSummary> {
  await assertCurrentPermissions(actor, ["data.audit.read"]);

  const db = getDb();
  const [currentRows, buildingCounts, packageCounts, jobCounts, recentRows] = await Promise.all([
    db.select({
      versionCode: rateCardVersions.versionCode,
      publishedAt: rateCardVersions.publishedAt,
    }).from(rateCardVersions)
      .where(and(
        eq(rateCardVersions.status, "current"),
        isNotNull(rateCardVersions.publishedAt),
      ))
      .orderBy(desc(rateCardVersions.publishedAt), asc(rateCardVersions.versionCode))
      .limit(1),
    db.select({ status: buildings.status, count: sql<number>`count(*)::int` })
      .from(buildings)
      .groupBy(buildings.status),
    db.select({ status: salesPackages.status, count: sql<number>`count(*)::int` })
      .from(salesPackages)
      .groupBy(salesPackages.status),
    db.select({ state: importJobs.state, count: sql<number>`count(*)::int` })
      .from(importJobs)
      .groupBy(importJobs.state),
    selectJobRows({
      conditions: [
        inArray(importJobs.state, publishedJobStates),
        isNotNull(importJobs.publishedAt),
      ],
      limit: 5,
      offset: 0,
      publishedOrder: true,
    }),
  ]);

  const current = currentRows[0];
  const jobCount = new Map(jobCounts.map((row) => [row.state, Number(row.count)]));
  return {
    currentRateCard: current?.publishedAt
      ? { versionCode: current.versionCode, publishedAt: iso(current.publishedAt) }
      : null,
    buildings: entityCount(buildingCounts),
    packages: entityCount(packageCounts),
    jobs: {
      validating: sumStates(jobCount, validatingJobStates),
      ready: sumStates(jobCount, readyJobStates),
      failed: jobCount.get("validation_failed") ?? 0,
    },
    recentPublications: recentRows.map(mapJobRow).sort(comparePublishedJobs).slice(0, 5),
  };
}

export async function listImportJobs(
  actor: SessionUser,
  filters: ImportJobFilters,
): Promise<ImportJobListItem[]> {
  await assertCurrentPermissions(actor, ["data.audit.read"]);
  if (!importJobFiltersAreBounded(filters)) {
    throw new AdminReadError(400, "IMPORT_FILTER_INVALID");
  }

  const conditions = [
    filters.dataType === undefined ? undefined : eq(importJobs.dataType, filters.dataType),
    filters.state === undefined ? undefined : eq(importJobs.state, filters.state),
  ].filter((value) => value !== undefined);
  const rows = await selectJobRows({
    conditions,
    limit: filters.limit,
    offset: filters.offset,
    publishedOrder: false,
  });
  return rows.map(mapJobRow).sort(compareCreatedJobs);
}

export async function getImportJobDetail(
  actor: SessionUser,
  jobId: string,
): Promise<ImportJobDetail> {
  await assertCurrentPermissions(actor, ["data.audit.read"]);
  assertUuidIdentifiers(jobId);
  const rows = await selectJobRows({
    conditions: [eq(importJobs.id, jobId)],
    limit: 1,
    offset: 0,
    publishedOrder: false,
  });
  const job = rows[0];
  if (!job) throw new AdminReadError(404, "IMPORT_JOB_NOT_FOUND");

  const db = getDb();
  const [errorRows, changeRows, fileRows, auditRows] = await Promise.all([
    db.select({
      id: importErrors.id,
      filename: importErrors.filename,
      sheetName: importErrors.sheetName,
      rowNumber: importErrors.rowNumber,
      columnName: importErrors.columnName,
      errorKey: importErrors.errorKey,
      localizedParameters: importErrors.localizedParameters,
      createdAt: importErrors.createdAt,
    }).from(importErrors)
      .where(eq(importErrors.importJobId, jobId))
      .orderBy(
        asc(importErrors.filename),
        asc(importErrors.sheetName),
        asc(importErrors.rowNumber),
        asc(importErrors.columnName),
        asc(importErrors.errorKey),
        asc(importErrors.id),
      ),
    db.select({
      id: importChanges.id,
      entityType: importChanges.entityType,
      entityId: importChanges.entityId,
      changeType: importChanges.changeType,
      beforeValue: importChanges.beforeValue,
      afterValue: importChanges.afterValue,
      createdAt: importChanges.createdAt,
    }).from(importChanges)
      .where(eq(importChanges.importJobId, jobId))
      .orderBy(asc(importChanges.createdAt), asc(importChanges.id)),
    db.select({
      id: importFiles.id,
      originalFilename: importFiles.originalFilename,
      mimeType: importFiles.mimeType,
      sizeBytes: importFiles.sizeBytes,
      purpose: importFiles.purpose,
      createdAt: importFiles.createdAt,
    }).from(importFiles)
      .where(eq(importFiles.importJobId, jobId))
      .orderBy(asc(importFiles.createdAt), asc(importFiles.id)),
    db.select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorEmail: auditUsers.email,
      actorDisplayName: auditUsers.displayName,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      source: auditEvents.source,
      reason: auditEvents.reason,
      beforeMetadata: auditEvents.beforeMetadata,
      afterMetadata: auditEvents.afterMetadata,
      createdAt: auditEvents.createdAt,
    }).from(auditEvents)
      .innerJoin(auditUsers, eq(auditEvents.actorUserId, auditUsers.id))
      .where(eq(auditEvents.importJobId, jobId))
      .orderBy(desc(auditEvents.createdAt), asc(auditEvents.id)),
  ]);

  const mappedFiles = fileRows.map(mapFileRow).sort(compareCreatedAscending);
  const originalFilename = mappedFiles.find((file) => file.purpose === "original")?.originalFilename ?? "";
  return {
    ...mapJobRow(job),
    errors: errorRows.map((row) => mapErrorRow(row, originalFilename)).sort(compareErrors),
    changes: changeRows.map(mapChangeRow).sort(compareCreatedAscending),
    files: mappedFiles,
    auditEvents: auditRows.map(mapAuditRow).sort(compareCreatedDescending),
  };
}

export async function listRateCardVersions(
  actor: SessionUser,
): Promise<RateCardVersionListItem[]> {
  await assertCurrentPermissions(actor, ["data.audit.read"]);
  const rows = await getDb().select({
    id: rateCardVersions.id,
    versionCode: rateCardVersions.versionCode,
    currency: rateCardVersions.currency,
    status: rateCardVersions.status,
    importJobId: rateCardVersions.importJobId,
    uploadedById: rateCardVersions.uploadedBy,
    uploadedByEmail: uploadedUsers.email,
    uploadedByDisplayName: uploadedUsers.displayName,
    publishedById: rateCardVersions.publishedBy,
    publishedByEmail: publishedUsers.email,
    publishedByDisplayName: publishedUsers.displayName,
    uploadedAt: rateCardVersions.uploadedAt,
    publishedAt: rateCardVersions.publishedAt,
  }).from(rateCardVersions)
    .innerJoin(uploadedUsers, eq(rateCardVersions.uploadedBy, uploadedUsers.id))
    .leftJoin(publishedUsers, eq(rateCardVersions.publishedBy, publishedUsers.id))
    .orderBy(
      asc(rateCardVersions.status),
      desc(rateCardVersions.publishedAt),
      asc(rateCardVersions.versionCode),
    );

  return rows.map((row): RateCardVersionListItem => ({
    id: row.id,
    versionCode: row.versionCode,
    currency: "IDR",
    status: row.status,
    importJobId: row.importJobId,
    uploadedBy: userItem(row.uploadedById, row.uploadedByEmail, row.uploadedByDisplayName),
    publishedBy: nullableUserItem(row.publishedById, row.publishedByEmail, row.publishedByDisplayName),
    uploadedAt: iso(row.uploadedAt),
    publishedAt: nullableIso(row.publishedAt),
  })).sort(compareRateCardVersions);
}

export async function getImportFileDownload(
  actor: SessionUser,
  jobId: string,
  fileId: string,
): Promise<string> {
  await assertCurrentPermissions(actor, ["data.audit.read", "data.file.download"]);
  assertUuidIdentifiers(jobId, fileId);
  const [file] = await getDb().select({ objectStorageKey: importFiles.objectStorageKey })
    .from(importFiles)
    .innerJoin(importJobs, eq(importFiles.importJobId, importJobs.id))
    .where(and(
      eq(importJobs.id, jobId),
      eq(importFiles.id, fileId),
      eq(importFiles.importJobId, jobId),
      eq(importFiles.purpose, "original"),
    ))
    .limit(1);
  if (!file) throw new AdminReadError(404, "IMPORT_FILE_NOT_FOUND");
  return S3ObjectStore.fromEnv().getSignedDownloadUrl(file.objectStorageKey, 300);
}

async function assertCurrentPermissions(
  actor: SessionUser,
  required: readonly Permission[],
): Promise<void> {
  const rows = await getDb().select({
    id: users.id,
    status: users.status,
    permissionKey: userPermissions.permissionKey,
  }).from(users)
    .leftJoin(userPermissions, eq(userPermissions.userId, users.id))
    .where(and(eq(users.id, actor.id), eq(users.status, "active")));
  const currentPermissions = new Set(rows.flatMap(({ status, permissionKey }) =>
    status !== "active" || permissionKey === null ? [] : [permissionKey]
  ));
  const isActiveActor = rows.some((row) => row.id === actor.id && row.status === "active");
  if (!isActiveActor || required.some((permission) => !currentPermissions.has(permission))) {
    throw new AdminReadError(403, "PERMISSION_DENIED");
  }
}

interface SelectJobOptions {
  conditions: NonNullable<ReturnType<typeof and>>[];
  limit: number;
  offset: number;
  publishedOrder: boolean;
}

function selectJobRows(options: SelectJobOptions) {
  return getDb().select({
    id: importJobs.id,
    dataType: importJobs.dataType,
    templateVersion: importJobs.templateVersion,
    state: importJobs.state,
    totalRows: importJobs.totalRows,
    validRows: importJobs.validRows,
    invalidRows: importJobs.invalidRows,
    sourceType: importJobs.sourceType,
    failureSummary: importJobs.failureSummary,
    uploadedById: importJobs.uploadedBy,
    uploadedByEmail: uploadedUsers.email,
    uploadedByDisplayName: uploadedUsers.displayName,
    publishedById: importJobs.publishedBy,
    publishedByEmail: publishedUsers.email,
    publishedByDisplayName: publishedUsers.displayName,
    createdAt: importJobs.createdAt,
    updatedAt: importJobs.updatedAt,
    publishedAt: importJobs.publishedAt,
  }).from(importJobs)
    .innerJoin(uploadedUsers, eq(importJobs.uploadedBy, uploadedUsers.id))
    .leftJoin(publishedUsers, eq(importJobs.publishedBy, publishedUsers.id))
    .where(and(...options.conditions))
    .orderBy(
      options.publishedOrder ? desc(importJobs.publishedAt) : desc(importJobs.createdAt),
      asc(importJobs.id),
    )
    .limit(options.limit)
    .offset(options.offset);
}

type JobRow = Awaited<ReturnType<typeof selectJobRows>>[number];

function mapJobRow(row: JobRow): ImportJobListItem {
  return {
    id: row.id,
    dataType: row.dataType,
    templateVersion: row.templateVersion,
    state: row.state,
    totalRows: row.totalRows,
    validRows: row.validRows,
    invalidRows: row.invalidRows,
    sourceType: row.sourceType as ImportJobListItem["sourceType"],
    failureSummary: row.failureSummary,
    uploadedBy: userItem(row.uploadedById, row.uploadedByEmail, row.uploadedByDisplayName),
    publishedBy: nullableUserItem(row.publishedById, row.publishedByEmail, row.publishedByDisplayName),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    publishedAt: nullableIso(row.publishedAt),
  };
}

function mapErrorRow(row: {
  id: string;
  filename: string | null;
  sheetName: string | null;
  rowNumber: number;
  columnName: string | null;
  errorKey: string;
  localizedParameters: unknown;
  createdAt: Date | string;
}, originalFilename: string): ImportErrorItem {
  return {
    id: row.id,
    file: row.filename?.trim() ? row.filename : originalFilename,
    sheet: row.sheetName ?? "",
    row: row.rowNumber,
    column: row.columnName ?? "",
    errorKey: row.errorKey,
    parameters: row.localizedParameters as JsonValue,
    createdAt: iso(row.createdAt),
  };
}

function mapChangeRow(row: {
  id: string;
  entityType: string;
  entityId: string | null;
  changeType: ImportChangeItem["changeType"];
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: Date | string;
}): ImportChangeItem {
  return {
    ...row,
    beforeValue: row.beforeValue as JsonValue,
    afterValue: row.afterValue as JsonValue,
    createdAt: iso(row.createdAt),
  };
}

function mapFileRow(row: {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  purpose: ImportFileItem["purpose"];
  createdAt: Date | string;
}): ImportFileItem {
  return { ...row, createdAt: iso(row.createdAt) };
}

function mapAuditRow(row: {
  id: string;
  actorUserId: string;
  actorEmail: string;
  actorDisplayName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  source: string;
  reason: string | null;
  beforeMetadata: unknown;
  afterMetadata: unknown;
  createdAt: Date | string;
}): ImportAuditItem {
  return {
    id: row.id,
    actor: userItem(row.actorUserId, row.actorEmail, row.actorDisplayName),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    source: row.source,
    reason: row.reason,
    beforeMetadata: row.beforeMetadata as JsonValue,
    afterMetadata: row.afterMetadata as JsonValue,
    createdAt: iso(row.createdAt),
  };
}

function userItem(id: string, email: string, displayName: string): ImportAdminUserItem {
  return { id, email, displayName };
}

function nullableUserItem(
  id: string | null,
  email: string | null,
  displayName: string | null,
): ImportAdminUserItem | null {
  return id === null || email === null || displayName === null
    ? null
    : userItem(id, email, displayName);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("Invalid database timestamp");
  return parsed.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function assertUuidIdentifiers(...values: string[]): void {
  if (values.some((value) => !isUuidIdentifier(value))) {
    throw new AdminReadError(400, "IMPORT_IDENTIFIER_INVALID");
  }
}

function entityCount(rows: readonly { status: "active" | "inactive"; count: number }[]) {
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  return { active: counts.get("active") ?? 0, inactive: counts.get("inactive") ?? 0 };
}

function sumStates(counts: ReadonlyMap<string, number>, states: ReadonlySet<string>): number {
  return [...states].reduce((total, state) => total + (counts.get(state) ?? 0), 0);
}

function compareCreatedJobs(left: ImportJobListItem, right: ImportJobListItem): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

function comparePublishedJobs(left: ImportJobListItem, right: ImportJobListItem): number {
  return (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || left.id.localeCompare(right.id);
}

function compareRateCardVersions(
  left: RateCardVersionListItem,
  right: RateCardVersionListItem,
): number {
  const status = (left.status === "current" ? 0 : 1) - (right.status === "current" ? 0 : 1);
  return status
    || (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "")
    || left.versionCode.localeCompare(right.versionCode);
}

function compareErrors(left: ImportErrorItem, right: ImportErrorItem): number {
  return left.file.localeCompare(right.file)
    || left.sheet.localeCompare(right.sheet)
    || left.row - right.row
    || left.column.localeCompare(right.column)
    || left.errorKey.localeCompare(right.errorKey)
    || left.id.localeCompare(right.id);
}

function compareCreatedAscending<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareCreatedDescending<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

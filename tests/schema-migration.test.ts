import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, test } from "vitest";

const expectedTables = [
  "audit_events",
  "brands",
  "building_controlled_values",
  "buildings",
  "customers",
  "import_changes",
  "import_errors",
  "import_files",
  "import_jobs",
  "rate_card_building_prices",
  "rate_card_package_buildings",
  "rate_card_package_configs",
  "rate_card_versions",
  "sales_assignments",
  "sales_packages",
  "user_permissions",
  "users",
];

const expectedForeignKeys = [
  "audit_events.actor_user_id",
  "audit_events.import_job_id",
  "brands.customer_id",
  "brands.source_import_job_id",
  "buildings.source_import_job_id",
  "customers.source_import_job_id",
  "import_changes.import_job_id",
  "import_errors.import_job_id",
  "import_files.import_job_id",
  "import_jobs.published_by",
  "import_jobs.uploaded_by",
  "rate_card_building_prices.building_id",
  "rate_card_building_prices.rate_card_version_id",
  "rate_card_package_buildings.building_id",
  "rate_card_package_buildings.package_id",
  "rate_card_package_buildings.rate_card_version_id",
  "rate_card_package_configs.package_id",
  "rate_card_package_configs.rate_card_version_id",
  "rate_card_versions.import_job_id",
  "rate_card_versions.published_by",
  "rate_card_versions.uploaded_by",
  "sales_assignments.brand_id",
  "sales_assignments.customer_id",
  "sales_assignments.sales_pic_user_id",
  "sales_assignments.source_import_job_id",
  "sales_packages.source_import_job_id",
  "user_permissions.user_id",
];

type Journal = {
  dialect: string;
  entries: Array<{ idx: number; tag: string }>;
};

async function applyMigrations(
  db: PGlite,
  throughIdx = Number.POSITIVE_INFINITY,
  fromIdx = 0,
) {
  const migrationsDir = resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(
    await readFile(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as Journal;

  for (const entry of [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .filter((entry) => entry.idx >= fromIdx && entry.idx <= throughIdx)) {
    const migration = await readFile(
      resolve(migrationsDir, `${entry.tag}.sql`),
      "utf8",
    );
    await db.exec("begin");
    try {
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await db.exec(statement);
      }
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
}

async function seedHistoricalRateCard(db: PGlite) {
  const users = await db.query<{ id: string }>(`
    insert into users (email, password_hash, display_name)
    values
      ('uploader@example.com', 'test-only-hash', 'Uploader'),
      ('other@example.com', 'test-only-hash', 'Other User')
    returning id
  `);
  const importJob = await db.query<{ id: string }>(`
    insert into import_jobs (data_type, template_version, checksum, uploaded_by)
    values ('rate_card', 'v1', 'rate-card-checksum', '${users.rows[0].id}')
    returning id
  `);
  const version = await db.query<{ id: string }>(`
    insert into rate_card_versions (
      version_code, status, import_job_id, uploaded_by
    ) values (
      'RC-001', 'historical',
      '${importJob.rows[0].id}', '${users.rows[0].id}'
    ) returning id
  `);

  return {
    userIds: users.rows.map((row) => row.id),
    importJobId: importJob.rows[0].id,
    versionId: version.rows[0].id,
  };
}

describe("generated PostgreSQL migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
  });

  test("declares PostgreSQL migration metadata", async () => {
    const journal = JSON.parse(
      await readFile(
        resolve(process.cwd(), "drizzle/meta/_journal.json"),
        "utf8",
      ),
    ) as Journal;
    expect(journal.dialect).toBe("postgresql");
  });

  test("preserves the building UUID while migrating legacy identity columns", async () => {
    db = new PGlite();
    await applyMigrations(db, 5);
    const seeded = await db.query<{ id: string }>(`
      insert into buildings (building_code, name, location, category)
      values ('B003004', 'Apartment 19th Avenue', 'Tangerang', 'Apartment')
      returning id
    `);

    await applyMigrations(db, Number.POSITIVE_INFINITY, 6);

    const migrated = await db.query<{
      id: string;
      iris_building_id: string;
      address: string;
      building_type: string;
      erp_link_status: string;
      data_source: string;
    }>(`
      select id, iris_building_id, address, building_type,
             erp_link_status, data_source
      from buildings
      where iris_building_id = 'B003004'
    `);
    expect(migrated.rows).toEqual([
      {
        id: seeded.rows[0].id,
        iris_building_id: "B003004",
        address: "Tangerang",
        building_type: "Apartment",
        erp_link_status: "manual_only",
        data_source: "building_team",
      },
    ]);
  });

  test("keeps IRIS identity immutable and normalizes blank ERP mappings", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const first = await db.query<{ id: string }>(`
      insert into buildings (
        iris_building_id, name, address, erp_link_status, data_source
      ) values ('B003004', 'Apartment 19th Avenue', 'Tangerang', 'manual_only', 'building_team')
      returning id
    `);

    await expect(db.query(`
      update buildings set iris_building_id = 'B999999'
      where id = '${first.rows[0].id}'
    `)).rejects.toThrow(/iris building id is immutable/i);

    await expect(db.query(`
      update buildings set id = '00000000-0000-4000-8000-000000000099'
      where id = '${first.rows[0].id}'
    `)).rejects.toThrow(/building uuid is immutable/i);

    for (const values of [
      ["   ", "Tower", "Jakarta"],
      ["B000099", "  ", "Jakarta"],
    ]) {
      await expect(db.query(`
        insert into buildings (iris_building_id, name, address)
        values ('${values[0]}', '${values[1]}', '${values[2]}')
      `)).rejects.toThrow(/buildings_.*_not_blank_check/i);
    }
    await expect(db.query(`
      insert into buildings (iris_building_id, name, address)
      values ('B000098', 'Tower', null)
    `)).resolves.toBeDefined();

    const blanks = await db.query<{
      erp_building_id: string | null;
      erp_link_status: string;
    }>(`
      insert into buildings (
        iris_building_id, erp_building_id, name, address, erp_link_status, data_source
      ) values ('B000004', '', 'Tower Blank A', 'Tangerang', 'erp_linked', 'building_team'),
               ('B000005', '   ', 'Tower Blank B', 'Tangerang', 'erp_linked', 'building_team'),
               ('B000012', E'\t\n', 'Tower Blank C', 'Tangerang', 'erp_linked', 'building_team')
      returning erp_building_id, erp_link_status
    `);
    expect(blanks.rows).toEqual([
      { erp_building_id: null, erp_link_status: "manual_only" },
      { erp_building_id: null, erp_link_status: "manual_only" },
      { erp_building_id: null, erp_link_status: "manual_only" },
    ]);

    await expect(db.query(`
      insert into buildings (
        iris_building_id, erp_building_id, name, address, erp_link_status, data_source
      ) values ('B000006', 'ERP-01', 'Tower A', 'Tangerang', 'erp_linked', 'building_team'),
               ('B000007', ' ERP-01 ', 'Tower B', 'Tangerang', 'erp_linked', 'building_team')
    `)).rejects.toThrow(/erp_building_id/i);
  });

  test("rejects building deletion so an IRIS ID can never be reused", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const inserted = await db.query<{ id: string }>(`
      insert into buildings (iris_building_id, name, address)
      values ('B000013', 'Permanent Tower', 'Jakarta')
      returning id
    `);

    await expect(db.query(`
      delete from buildings where id = '${inserted.rows[0].id}'
    `)).rejects.toThrow(/buildings cannot be deleted/i);
    await expect(db.query(`
      insert into buildings (iris_building_id, name, address)
      values ('B000013', 'Reused Tower', 'Jakarta')
    `)).rejects.toThrow(/iris_building_id/i);
  });

  test("requires unique IRIS IDs and link status consistent with ERP presence", async () => {
    db = new PGlite();
    await applyMigrations(db);

    await expect(db.query(`
      insert into buildings (iris_building_id, name, address)
      values ('B000008', 'Tower C', 'Jakarta'),
             ('B000008', 'Tower D', 'Jakarta')
    `)).rejects.toThrow(/iris_building_id/i);
    const derivedLinked = await db.query<{
      erp_building_id: string | null;
      erp_link_status: string;
    }>(`
      insert into buildings (iris_building_id, erp_building_id, name, address, erp_link_status)
      values ('B000009', ' ERP-09 ', 'Tower E', 'Jakarta', 'manual_only')
      returning erp_building_id, erp_link_status
    `);
    expect(derivedLinked.rows).toEqual([
      { erp_building_id: "ERP-09", erp_link_status: "erp_linked" },
    ]);
    const derivedManual = await db.query<{
      erp_building_id: string | null;
      erp_link_status: string;
    }>(`
      insert into buildings (iris_building_id, name, address, erp_link_status)
      values ('B000010', 'Tower F', 'Jakarta', 'erp_linked')
      returning erp_building_id, erp_link_status
    `);
    expect(derivedManual.rows).toEqual([
      { erp_building_id: null, erp_link_status: "manual_only" },
    ]);
    await expect(db.query(`
      insert into buildings (iris_building_id, name, address, data_source)
      values ('B000011', 'Tower G', 'Jakarta', 'spreadsheet')
    `)).rejects.toThrow(/buildings_data_source_check/i);
  });

  test("constrains import source_type to manual or crm with manual as default", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const uploader = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('source-uploader@example.com', 'test-only-hash', 'Uploader')
      returning id
    `);
    const inserted = await db.query<{ source_type: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('building', 'v1', '${"a".repeat(64)}', '${uploader.rows[0].id}')
      returning source_type
    `);
    expect(inserted.rows[0].source_type).toBe("manual");

    await expect(
      db.query(`
        insert into import_jobs (data_type, template_version, checksum, source_type, uploaded_by)
        values ('building', 'v1', '${"b".repeat(64)}', 'xlsx', '${uploader.rows[0].id}')
      `),
    ).rejects.toThrow(/import_jobs_source_type_check/i);
    await expect(
      db.query(`
        insert into import_jobs (data_type, template_version, checksum, source_type, uploaded_by)
        values ('building', 'v1', '${"c".repeat(64)}', 'crm', '${uploader.rows[0].id}')
      `),
    ).resolves.toBeDefined();
  });

  test("adds durable upload attempt reservations with an uploading state and unique lease identity", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const columns = await db.query<{ column_name: string; is_nullable: string }>(`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'import_jobs'
        and column_name in ('upload_attempt_id', 'upload_lease_expires_at')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "upload_attempt_id", is_nullable: "YES" },
      { column_name: "upload_lease_expires_at", is_nullable: "YES" },
    ]);
    const states = await db.query<{ enumlabel: string }>(`
      select enumlabel from pg_enum join pg_type on pg_type.oid = pg_enum.enumtypid
      where pg_type.typname = 'import_state'
    `);
    expect(states.rows.map((row) => row.enumlabel)).toEqual(expect.arrayContaining([
      "uploading",
      "processing_failed",
      "reprocess_required",
    ]));
    const indexes = await db.query<{ indexdef: string }>(`
      select indexdef from pg_indexes where indexname = 'import_jobs_upload_attempt_id_unique'
    `);
    expect(indexes.rows[0].indexdef).toMatch(/UNIQUE.*upload_attempt_id.*WHERE.*IS NOT NULL/i);
  });

  test("enforces the upload lease state invariant", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('lease-uploader@example.com', 'test-only-hash', 'Lease Uploader') returning id
    `);
    const userId = user.rows[0].id;
    await expect(db.query(`
      insert into import_jobs (data_type, template_version, checksum, state, uploaded_by)
      values ('building', 'v1', '${"d".repeat(64)}', 'uploading', '${userId}')
    `)).rejects.toThrow(/import_jobs_upload_lease_state_check/i);
    await expect(db.query(`
      insert into import_jobs (data_type, template_version, checksum, state, upload_lease_expires_at, uploaded_by)
      values ('building', 'v1', '${"e".repeat(64)}', 'uploaded', now() + interval '15 minutes', '${userId}')
    `)).rejects.toThrow(/import_jobs_upload_lease_state_check/i);
    await expect(db.query(`
      insert into import_jobs (data_type, template_version, checksum, state, upload_attempt_id, upload_lease_expires_at, uploaded_by)
      values ('building', 'v1', '${"f".repeat(64)}', 'uploading', '00000000-0000-4000-8000-000000000010', now() + interval '15 minutes', '${userId}')
    `)).resolves.toBeDefined();
  });

  test("locks both old and new parents before allowing child mutations", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const result = await db.query<{ definition: string }>(`
      select pg_get_functiondef(
        'protect_published_rate_card_child'::regproc
      ) as definition
    `);
    const definition = result.rows[0].definition.replace(/\s+/g, " ");

    expect(definition).toMatch(
      /WHERE id = OLD\.rate_card_version_id FOR NO KEY UPDATE;/i,
    );
    expect(definition).toMatch(
      /WHERE id = NEW\.rate_card_version_id FOR NO KEY UPDATE;/i,
    );
  });

  test("migrates Rate Card versions to one current version and historical records", async () => {
    db = new PGlite();
    await applyMigrations(db);

    const columns = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'rate_card_versions'
    `);
    expect(columns.rows.map((row) => row.column_name)).not.toContain("effective_at");
    expect(columns.rows.map((row) => row.column_name)).not.toContain("activated_at");

    const statuses = await db.query<{ enumlabel: string }>(`
      select enumlabel
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      where pg_type.typname = 'rate_card_version_status'
      order by enumsortorder
    `);
    expect(statuses.rows.map((row) => row.enumlabel)).toEqual([
      "current",
      "historical",
    ]);

    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-lifecycle@example.com', 'test-only-hash', 'Rate Card Lifecycle')
      returning id
    `);
    const jobs = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values
        ('rate_card', 'v1', '${"1".repeat(64)}', '${user.rows[0].id}'),
        ('rate_card', 'v1', '${"2".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    const userId = user.rows[0].id;
    const [jobId, secondJobId] = jobs.rows.map((row) => row.id);

    await db.exec(`
      insert into rate_card_versions
        (version_code, currency, status, import_job_id, uploaded_by, uploaded_at)
      values ('RC-ONE', 'IDR', 'current', '${jobId}', '${userId}', now())
    `);
    await expect(db.exec(`
      insert into rate_card_versions
        (version_code, currency, status, import_job_id, uploaded_by, uploaded_at)
      values ('RC-TWO', 'IDR', 'current', '${secondJobId}', '${userId}', now())
    `)).rejects.toThrow();
    await expect(db.exec(`
      insert into rate_card_versions
        (version_code, currency, status, import_job_id, uploaded_by, uploaded_at)
      values ('RC-INVALID', 'IDR', 'draft', '${secondJobId}', '${userId}', now())
    `)).rejects.toThrow();
  });

  test("allows unpublished Current assembly and freezes published Rate Card versions", async () => {
    db = new PGlite();
    await applyMigrations(db);

    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-assembly@example.com', 'test-only-hash', 'Rate Card Assembly')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"4".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    const building = await db.query<{ id: string }>(`
      insert into buildings (iris_building_id, name, address)
      values ('RC-ASSEMBLY-BUILDING', 'Assembly Building', 'Jakarta')
      returning id
    `);
    const secondBuilding = await db.query<{ id: string }>(`
      insert into buildings (iris_building_id, name, address)
      values ('RC-ASSEMBLY-BUILDING-SECOND', 'Assembly Building Two', 'Jakarta')
      returning id
    `);
    const salesPackage = await db.query<{ id: string }>(`
      insert into sales_packages (package_code, name)
      values ('RC-ASSEMBLY-PACKAGE', 'Assembly Package')
      returning id
    `);
    const secondSalesPackage = await db.query<{ id: string }>(`
      insert into sales_packages (package_code, name)
      values ('RC-ASSEMBLY-PACKAGE-SECOND', 'Assembly Package Two')
      returning id
    `);
    const version = await db.query<{ id: string }>(`
      insert into rate_card_versions (
        version_code, status, import_job_id, uploaded_by
      ) values (
        'RC-ASSEMBLY', 'current', '${job.rows[0].id}', '${user.rows[0].id}'
      ) returning id
    `);

    await expect(db.exec(`
      insert into rate_card_building_prices (
        rate_card_version_id, building_id, price_idr
      ) values ('${version.rows[0].id}', '${building.rows[0].id}', 1000000)
    `)).resolves.toBeDefined();
    await expect(db.exec(`
      insert into rate_card_package_configs (
        rate_card_version_id, package_id, price_idr
      ) values ('${version.rows[0].id}', '${salesPackage.rows[0].id}', 1500000)
    `)).resolves.toBeDefined();
    await expect(db.exec(`
      insert into rate_card_package_buildings (
        rate_card_version_id, package_id, building_id
      ) values (
        '${version.rows[0].id}', '${salesPackage.rows[0].id}', '${building.rows[0].id}'
      )
    `)).resolves.toBeDefined();

    await expect(db.exec(`
      update rate_card_versions set published_at = now()
      where id = '${version.rows[0].id}'
    `)).resolves.toBeDefined();

    await expect(db.exec(`
      update rate_card_versions set version_code = 'RC-ASSEMBLY-CHANGED'
      where id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published rate card version is immutable/i);
    await expect(db.exec(`
      delete from rate_card_versions where id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published rate card version is immutable/i);

    await expect(db.exec(`
      insert into rate_card_building_prices (
        rate_card_version_id, building_id, price_idr
      ) values ('${version.rows[0].id}', '${secondBuilding.rows[0].id}', 2000000)
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      update rate_card_building_prices set price_idr = 2000000
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      delete from rate_card_building_prices
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);

    await expect(db.exec(`
      insert into rate_card_package_configs (
        rate_card_version_id, package_id, price_idr
      ) values ('${version.rows[0].id}', '${secondSalesPackage.rows[0].id}', 2500000)
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      update rate_card_package_configs set price_idr = 2500000
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      delete from rate_card_package_configs
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);

    await expect(db.exec(`
      insert into rate_card_package_buildings (
        rate_card_version_id, package_id, building_id
      ) values (
        '${version.rows[0].id}', '${salesPackage.rows[0].id}', '${secondBuilding.rows[0].id}'
      )
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      update rate_card_package_buildings set created_at = now()
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      delete from rate_card_package_buildings
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);

    await expect(db.exec(`
      update rate_card_versions
      set status = 'historical', version_code = 'RC-ASSEMBLY-PIGGYBACK'
      where id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published rate card status transition must change only status/i);
    await expect(db.exec(`
      update rate_card_versions set status = 'historical'
      where id = '${version.rows[0].id}'
    `)).resolves.toBeDefined();

    await expect(db.exec(`
      update rate_card_versions set currency = 'IDR'
      where id = '${version.rows[0].id}'
    `)).rejects.toThrow(/historical rate card version is immutable/i);
    await expect(db.exec(`
      delete from rate_card_versions where id = '${version.rows[0].id}'
    `)).rejects.toThrow(/historical rate card version cannot be deleted/i);

    await expect(db.exec(`
      insert into rate_card_building_prices (
        rate_card_version_id, building_id, price_idr
      ) values ('${version.rows[0].id}', '${secondBuilding.rows[0].id}', 2000000)
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      insert into rate_card_package_configs (
        rate_card_version_id, package_id, price_idr
      ) values ('${version.rows[0].id}', '${secondSalesPackage.rows[0].id}', 2500000)
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      insert into rate_card_package_buildings (
        rate_card_version_id, package_id, building_id
      ) values (
        '${version.rows[0].id}', '${salesPackage.rows[0].id}', '${secondBuilding.rows[0].id}'
      )
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      update rate_card_building_prices set price_idr = 3000000
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
    await expect(db.exec(`
      delete from rate_card_package_configs
      where rate_card_version_id = '${version.rows[0].id}'
    `)).rejects.toThrow(/published or historical rate card child rows are immutable/i);
  });

  test("creates the Stage 2 tables, constraints, and indexes", async () => {
    db = new PGlite();
    await applyMigrations(db);

    const tables = await db.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expectedTables);

    const userColumns = await db.query<{
      column_name: string;
      is_nullable: string;
    }>(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `);
    expect(userColumns.rows).toEqual(
      expect.arrayContaining([
        { column_name: "email", is_nullable: "NO" },
        { column_name: "password_hash", is_nullable: "NO" },
        { column_name: "status", is_nullable: "NO" },
        { column_name: "created_at", is_nullable: "NO" },
        { column_name: "updated_at", is_nullable: "NO" },
      ]),
    );

    const uniqueConstraints = await db.query<{ constraint_name: string }>(`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = 'public' and constraint_type = 'UNIQUE'
    `);
    const uniqueNames = uniqueConstraints.rows.map((row) => row.constraint_name);
    expect(uniqueNames).toEqual(
      expect.arrayContaining([
        "users_email_unique",
        "customers_customer_code_unique",
        "brands_brand_code_unique",
        "sales_assignments_assignment_code_unique",
        "buildings_iris_building_id_unique",
        "sales_packages_package_code_unique",
        "rate_card_versions_version_code_unique",
        "user_permissions_user_id_permission_key_unique",
      ]),
    );

    const foreignKeys = await db.query<{
      table_name: string;
      column_name: string;
    }>(`
      select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_catalog = kcu.constraint_catalog
       and tc.constraint_schema = kcu.constraint_schema
       and tc.constraint_name = kcu.constraint_name
      where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
      order by tc.table_name, kcu.column_name
    `);
    expect(
      foreignKeys.rows.map((row) => `${row.table_name}.${row.column_name}`),
    ).toEqual(expectedForeignKeys);

    const indexes = await db.query<{ indexname: string }>(`
      select indexname from pg_indexes where schemaname = 'public'
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "import_jobs_state_created_at_idx",
        "import_jobs_data_type_published_at_idx",
        "import_errors_import_job_id_row_number_idx",
        "audit_events_entity_type_entity_id_created_at_idx",
      ]),
    );
  });

  test("rejects changes to a user's immutable email", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const inserted = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('original@example.com', 'test-only-hash', 'Test User')
      returning id
    `);

    await expect(
      db.query(`
        update users
        set email = 'changed@example.com'
        where id = '${inserted.rows[0].id}'
      `),
    ).rejects.toThrow(/users\.email is immutable/);
  });

  test("normalizes controlled-value codes and creates historical Rate Card records", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const controlled = await db.query<{ value: string }>(`
      insert into building_controlled_values (field, value)
      values ('building_type', E'  Office\t') returning value
    `);
    expect(controlled.rows[0].value).toBe("Office");
    await expect(db.query(`
      insert into building_controlled_values (field, value)
      values ('grade_resource', E' \t ')
    `)).rejects.toThrow(/building_controlled_values_value_not_blank_check/i);

    const seed = await seedHistoricalRateCard(db);
    const version = await db.query<{ status: string }>(`
      select status from rate_card_versions where id = '${seed.versionId}'
    `);
    expect(version.rows[0].status).toBe("historical");
  });

  test("normalizes existing controlled values before adding the trimmed constraint", async () => {
    db = new PGlite();
    await applyMigrations(db, 7);
    await db.query(`insert into building_controlled_values (field, value) values ('building_type', E'  Office\t')`);
    await applyMigrations(db, 8, 8);
    const values = await db.query<{ value: string }>(`select value from building_controlled_values`);
    expect(values.rows).toEqual([{ value: "Office" }]);
  });

  test("fails migration explicitly before normalized controlled-value collisions", async () => {
    db = new PGlite();
    await applyMigrations(db, 7);
    await db.query(`insert into building_controlled_values (field, value) values ('building_type', 'Office'), ('building_type', ' Office ')`);
    await expect(applyMigrations(db, 8, 8)).rejects.toThrow(/controlled value normalization collision/i);
  });

  test("rejects a Rate Card currency other than IDR", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const seed = await seedHistoricalRateCard(db);

    await expect(
      db.query(`
        insert into rate_card_versions (
          version_code, currency, import_job_id, uploaded_by
        ) values (
          'RC-USD', 'USD',
          '${seed.importJobId}', '${seed.userIds[0]}'
        )
      `),
    ).rejects.toThrow(/rate_card_versions_currency_idr_check/);
  });

  test("prefers the actual active Rate Card over newer published and superseded legacy statuses", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-migration@example.com', 'test-only-hash', 'Rate Card Migration')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"3".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values
        ('RC-ACTIVE', '2026-07-01T00:00:00Z', 'active', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-01T00:00:00Z'),
        ('RC-PUBLISHED', '2026-07-02T00:00:00Z', 'published', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-02T00:00:00Z'),
        ('RC-SUPERSEDED', '2026-07-03T00:00:00Z', 'superseded', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-03T00:00:00Z')
    `);
    await applyMigrations(db, 9, 9);

    const versions = await db.query<{ version_code: string; status: string }>(`
      select version_code, status
      from rate_card_versions
      order by version_code
    `);
    expect(versions.rows).toEqual([
      { version_code: "RC-ACTIVE", status: "current" },
      { version_code: "RC-PUBLISHED", status: "historical" },
      { version_code: "RC-SUPERSEDED", status: "historical" },
    ]);
  });

  test("fails reconciliation when an active legacy Rate Card coexists with a rolled-back row", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-rolled-back@example.com', 'test-only-hash', 'Rate Card Rolled Back')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"4".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values
        ('RC-ACTIVE', '2026-07-01T00:00:00Z', 'active', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-01T00:00:00Z'),
        ('RC-ROLLED-BACK', '2026-07-02T00:00:00Z', 'rolled_back', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-02T00:00:00Z')
    `);

    await expect(applyMigrations(db, 9, 9)).rejects.toThrow(
      /rolled.back legacy rate card.*reconciliation/i,
    );
    expect((await db.query<{ version_code: string; status: string }>(`
      select version_code, status::text from rate_card_versions order by version_code
    `)).rows).toEqual([
      { version_code: "RC-ACTIVE", status: "active" },
      { version_code: "RC-ROLLED-BACK", status: "rolled_back" },
    ]);
    expect((await db.query<{ status_type: string | null }>(`
      select to_regtype('public.rate_card_version_status')::text as status_type
    `)).rows).toEqual([{ status_type: null }]);
  });

  test("falls back only to the newest explicitly published Rate Card when no active version exists", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-fallback@example.com', 'test-only-hash', 'Rate Card Fallback')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"5".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values
        ('RC-PUBLISHED-OLD', '2026-07-01T00:00:00Z', 'published', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-01T00:00:00Z'),
        ('RC-PUBLISHED-NEW', '2026-07-02T00:00:00Z', 'published', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-02T00:00:00Z'),
        ('RC-SUPERSEDED-NEWER', '2026-07-03T00:00:00Z', 'superseded', '${job.rows[0].id}', '${user.rows[0].id}', '2026-07-03T00:00:00Z')
    `);

    await applyMigrations(db, 9, 9);

    const current = await db.query<{ version_code: string }>(`
      select version_code from rate_card_versions where status = 'current'
    `);
    expect(current.rows).toEqual([{ version_code: "RC-PUBLISHED-NEW" }]);
  });

  test("fails safely when legacy active Rate Card data is ambiguous", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-ambiguous@example.com', 'test-only-hash', 'Rate Card Ambiguous')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"6".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values
        ('RC-ACTIVE-A', now(), 'active', '${job.rows[0].id}', '${user.rows[0].id}', now()),
        ('RC-ACTIVE-B', now(), 'active', '${job.rows[0].id}', '${user.rows[0].id}', now())
    `);

    await expect(applyMigrations(db, 9, 9)).rejects.toThrow(/ambiguous legacy active rate card/i);
    const legacy = await db.query<{ status: string }>(`
      select status::text from rate_card_versions order by version_code
    `);
    expect(legacy.rows).toEqual([{ status: "active" }, { status: "active" }]);
  });

  test("fails safely instead of relabeling an unpublished draft as Historical", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-draft@example.com', 'test-only-hash', 'Rate Card Draft')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"7".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values ('RC-DRAFT', now(), 'draft', '${job.rows[0].id}', '${user.rows[0].id}', null)
    `);

    await expect(applyMigrations(db, 9, 9)).rejects.toThrow(/unpublished legacy rate card/i);
    const legacy = await db.query<{ status: string }>(`
      select status::text from rate_card_versions where version_code = 'RC-DRAFT'
    `);
    expect(legacy.rows).toEqual([{ status: "draft" }]);
  });

  test("fails safely when legacy versions exist but none is eligible to become Current", async () => {
    db = new PGlite();
    await applyMigrations(db, 8);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('rate-card-ineligible@example.com', 'test-only-hash', 'Rate Card Ineligible')
      returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v1', '${"9".repeat(64)}', '${user.rows[0].id}')
      returning id
    `);
    await db.exec(`
      insert into rate_card_versions (
        version_code, effective_at, status, import_job_id, uploaded_by, published_at
      ) values ('RC-SUPERSEDED-ONLY', now(), 'superseded', '${job.rows[0].id}', '${user.rows[0].id}', now())
    `);

    await expect(applyMigrations(db, 9, 9)).rejects.toThrow(/no eligible legacy current rate card/i);
    const legacy = await db.query<{ status: string }>(`
      select status::text from rate_card_versions order by version_code
    `);
    expect(legacy.rows).toEqual([{ status: "superseded" }]);
  });

  test("enforces immutable, nondeletable Package identities and normalized unique names", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const inserted = await db.query<{ id: string }>(`
      insert into sales_packages (package_code, name)
      values ('PKG-STABLE', 'Stable Package') returning id
    `);

    await expect(db.exec(`update sales_packages set package_code = 'PKG-RENAMED' where id = '${inserted.rows[0].id}'`))
      .rejects.toThrow(/package code is immutable/i);
    await expect(db.exec(`update sales_packages set name = 'Renamed Package' where id = '${inserted.rows[0].id}'`))
      .rejects.toThrow(/package name is immutable/i);
    await expect(db.exec(`update sales_packages set status = 'inactive' where id = '${inserted.rows[0].id}'`))
      .resolves.toBeDefined();
    expect((await db.query<{ package_code: string; name: string; status: string }>(`
      select package_code, name, status from sales_packages where id = '${inserted.rows[0].id}'
    `)).rows).toEqual([{
      package_code: "PKG-STABLE",
      name: "Stable Package",
      status: "inactive",
    }]);
    await expect(db.exec(`delete from sales_packages where id = '${inserted.rows[0].id}'`))
      .rejects.toThrow(/packages cannot be deleted/i);
    await expect(db.exec(`insert into sales_packages (package_code, name) values ('PKG-OTHER', 'STABLE PACKAGE')`))
      .rejects.toThrow(/sales_packages_normalized_name_unique/i);
    await expect(db.exec(`insert into sales_packages (package_code, name) values ('PKG-WHITESPACE', E'\tWhitespace Package\n')`))
      .rejects.toThrow(/sales_packages_name_trimmed_check/i);
    await expect(db.exec(`insert into sales_packages (package_code, name) values ('', 'Blank Code')`))
      .rejects.toThrow(/sales_packages_package_code_not_blank_check/i);
  });

  test("fails migration before normalizing colliding Package names", async () => {
    db = new PGlite();
    await applyMigrations(db, 9);
    await db.exec(`
      insert into sales_packages (package_code, name) values
        ('PKG-A', 'Metro Package'),
        ('PKG-B', E'\tMETRO PACKAGE\n')
    `);

    await expect(applyMigrations(db, 10, 10)).rejects.toThrow(/package name normalization collision/i);
  });

  test("allows nullable optional Building fields and rejects out-of-range Rate Card prices", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const user = await db.query<{ id: string }>(`
      insert into users (email, password_hash, display_name)
      values ('price-boundary@example.com', 'test-only-hash', 'Price Boundary') returning id
    `);
    const job = await db.query<{ id: string }>(`
      insert into import_jobs (data_type, template_version, checksum, uploaded_by)
      values ('rate_card', 'v2', '${"8".repeat(64)}', '${user.rows[0].id}') returning id
    `);
    const priceBuildings = await db.query<{ id: string }>(`
      insert into buildings (iris_building_id, name, address)
      values
        ('B-MINIMAL', 'Minimal Building', null),
        ('B-MAX', 'Maximum Building', null),
        ('B-NEGATIVE', 'Negative Building', null),
        ('B-OVERFLOW', 'Overflow Building', null)
      returning id
    `);
    const pricePackages = await db.query<{ id: string }>(`
      insert into sales_packages (package_code, name)
      values
        ('PKG-ZERO', 'Zero Price Package'),
        ('PKG-MAX', 'Maximum Price Package'),
        ('PKG-NEGATIVE', 'Negative Price Package'),
        ('PKG-OVERFLOW', 'Overflow Price Package')
      returning id
    `);
    const version = await db.query<{ id: string }>(`
      insert into rate_card_versions (version_code, status, import_job_id, uploaded_by)
      values ('RC-PRICE-BOUNDARY', 'current', '${job.rows[0].id}', '${user.rows[0].id}') returning id
    `);

    await expect(db.exec(`
      insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr) values
        ('${version.rows[0].id}', '${priceBuildings.rows[0].id}', 0),
        ('${version.rows[0].id}', '${priceBuildings.rows[1].id}', 999999999999999999)
    `)).resolves.toBeDefined();
    await expect(db.exec(`
      insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr) values
        ('${version.rows[0].id}', '${pricePackages.rows[0].id}', 0),
        ('${version.rows[0].id}', '${pricePackages.rows[1].id}', 999999999999999999)
    `)).resolves.toBeDefined();
    await expect(db.exec(`
      insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr)
      values ('${version.rows[0].id}', '${priceBuildings.rows[2].id}', -1)
    `)).rejects.toThrow(/rate_card_building_prices_price_nonnegative_check/i);
    await expect(db.exec(`
      insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr)
      values ('${version.rows[0].id}', '${priceBuildings.rows[3].id}', 1000000000000000000)
    `)).rejects.toThrow();
    await expect(db.exec(`
      insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr)
      values ('${version.rows[0].id}', '${pricePackages.rows[2].id}', -1)
    `)).rejects.toThrow(/rate_card_package_configs_price_nonnegative_check/i);
    await expect(db.exec(`
      insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr)
      values ('${version.rows[0].id}', '${pricePackages.rows[3].id}', 1000000000000000000)
    `)).rejects.toThrow();

    const columnTypes = await db.query<{
      table_name: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(`
      select table_name, numeric_precision, numeric_scale
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('rate_card_building_prices', 'rate_card_package_configs')
        and column_name = 'price_idr'
      order by table_name
    `);
    expect(columnTypes.rows).toEqual([
      { table_name: "rate_card_building_prices", numeric_precision: 18, numeric_scale: 0 },
      { table_name: "rate_card_package_configs", numeric_precision: 18, numeric_scale: 0 },
    ]);
  });
});

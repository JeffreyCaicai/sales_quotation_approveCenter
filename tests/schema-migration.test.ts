import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, test } from "vitest";

const expectedTables = [
  "audit_events",
  "brands",
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

type Journal = { entries: Array<{ idx: number; tag: string }> };

async function applyMigrations(db: PGlite) {
  const migrationsDir = resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(
    await readFile(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as Journal;

  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const migration = await readFile(
      resolve(migrationsDir, `${entry.tag}.sql`),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.exec(statement);
    }
  }
}

describe("generated PostgreSQL migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
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
        "buildings_building_code_unique",
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
});

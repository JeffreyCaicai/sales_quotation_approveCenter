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

type Journal = {
  dialect: string;
  entries: Array<{ idx: number; tag: string }>;
};

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

async function seedDraftRateCard(db: PGlite) {
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
  const buildings = await db.query<{ id: string }>(`
    insert into buildings (building_code, name, location)
    values ('BLD-001', 'Building One', 'Jakarta'),
           ('BLD-002', 'Building Two', 'Jakarta')
    returning id
  `);
  const packages = await db.query<{ id: string }>(`
    insert into sales_packages (package_code, name)
    values ('PKG-001', 'Package One'), ('PKG-002', 'Package Two')
    returning id
  `);
  const version = await db.query<{ id: string }>(`
    insert into rate_card_versions (
      version_code, effective_at, import_job_id, uploaded_by
    ) values (
      'RC-001', '2026-08-01T00:00:00+07:00',
      '${importJob.rows[0].id}', '${users.rows[0].id}'
    ) returning id
  `);

  await db.exec(`
    insert into rate_card_building_prices (
      rate_card_version_id, building_id, price_idr
    ) values ('${version.rows[0].id}', '${buildings.rows[0].id}', 1000000);
    insert into rate_card_package_configs (
      rate_card_version_id, package_id, price_idr
    ) values ('${version.rows[0].id}', '${packages.rows[0].id}', 1500000);
    insert into rate_card_package_buildings (
      rate_card_version_id, package_id, building_id
    ) values (
      '${version.rows[0].id}', '${packages.rows[0].id}', '${buildings.rows[0].id}'
    );
  `);

  return {
    userIds: users.rows.map((row) => row.id),
    importJobId: importJob.rows[0].id,
    buildingIds: buildings.rows.map((row) => row.id),
    packageIds: packages.rows.map((row) => row.id),
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
    expect(states.rows.map((row) => row.enumlabel)).toContain("uploading");
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

  test("rejects a Rate Card currency other than IDR", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const seed = await seedDraftRateCard(db);

    await expect(
      db.query(`
        insert into rate_card_versions (
          version_code, effective_at, currency, import_job_id, uploaded_by
        ) values (
          'RC-USD', '2026-08-01T00:00:00+07:00', 'USD',
          '${seed.importJobId}', '${seed.userIds[0]}'
        )
      `),
    ).rejects.toThrow(/rate_card_versions_currency_idr_check/);
  });

  test("freezes published Rate Card data and enforces lifecycle transitions", async () => {
    db = new PGlite();
    await applyMigrations(db);
    const seed = await seedDraftRateCard(db);

    await db.exec(`
      update rate_card_versions
      set status = 'published',
          published_by = '${seed.userIds[0]}',
          published_at = now()
      where id = '${seed.versionId}'
    `);

    await expect(
      db.exec(`
        update rate_card_versions
        set version_code = 'RC-CHANGED'
        where id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/published rate card version business fields are immutable/);
    await expect(
      db.exec(`
        update rate_card_versions
        set uploaded_by = '${seed.userIds[1]}'
        where id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/published rate card version business fields are immutable/);
    await expect(
      db.exec(`
        update rate_card_versions
        set published_by = '${seed.userIds[1]}'
        where id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/published rate card version business fields are immutable/);

    await expect(
      db.exec(`
        update rate_card_building_prices
        set price_idr = 2000000
        where rate_card_version_id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/published rate card child rows are immutable/);
    await expect(
      db.exec(`
        delete from rate_card_package_configs
        where rate_card_version_id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/published rate card child rows are immutable/);
    await expect(
      db.exec(`
        insert into rate_card_package_buildings (
          rate_card_version_id, package_id, building_id
        ) values (
          '${seed.versionId}', '${seed.packageIds[0]}', '${seed.buildingIds[1]}'
        )
      `),
    ).rejects.toThrow(/published rate card child rows are immutable/);

    const emptyVersion = await db.query<{ id: string }>(`
      insert into rate_card_versions (
        version_code, effective_at, import_job_id, uploaded_by
      ) values (
        'RC-EMPTY', '2026-09-01T00:00:00+07:00',
        '${seed.importJobId}', '${seed.userIds[0]}'
      ) returning id
    `);
    await db.exec(`
      update rate_card_versions
      set status = 'published', published_at = now()
      where id = '${emptyVersion.rows[0].id}'
    `);
    await expect(
      db.exec(`
        delete from rate_card_versions where id = '${emptyVersion.rows[0].id}'
      `),
    ).rejects.toThrow(/published rate card version cannot be deleted/);

    await expect(
      db.exec(`
        update rate_card_versions
        set status = 'superseded'
        where id = '${seed.versionId}'
      `),
    ).rejects.toThrow(/invalid rate card lifecycle transition/);

    await db.exec(`
      update rate_card_versions
      set status = 'active', activated_at = now()
      where id = '${seed.versionId}';
      update rate_card_versions
      set status = 'superseded'
      where id = '${seed.versionId}';
      update rate_card_versions
      set status = 'active', activated_at = now()
      where id = '${seed.versionId}';
      update rate_card_versions
      set status = 'rolled_back'
      where id = '${seed.versionId}';
    `);
    const finalState = await db.query<{ status: string }>(`
      select status from rate_card_versions where id = '${seed.versionId}'
    `);
    expect(finalState.rows[0].status).toBe("rolled_back");
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { Pool } from "pg";

import { permissions } from "../lib/auth/permissions";

const databaseUrl = process.env.DATABASE_URL;
const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const fixtureRoot = join(process.cwd(), "tests", "fixtures", "imports", "v2");

let pool: Pool;
let client: S3Client;

test.setTimeout(90_000);

test.beforeAll(async () => {
  const missing = Object.entries({
    DATABASE_URL: databaseUrl,
    S3_ENDPOINT: endpoint,
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
    BOOTSTRAP_ADMIN_EMAIL: adminEmail,
    BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
  }).flatMap(([key, value]) => value ? [] : [key]);
  if (missing.length > 0) {
    throw new Error(`admin import browser smoke requires explicit test environment values: ${missing.join(", ")}`);
  }

  pool = new Pool({ connectionString: databaseUrl!, max: 2 });
  client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409) throw error;
  }
  await emptyBucket();
  await pool.query(`
    truncate table audit_events, import_changes, import_errors, import_files,
      rate_card_package_buildings, rate_card_package_configs, rate_card_building_prices,
      rate_card_versions, import_jobs, building_controlled_values, user_permissions,
      sales_packages, buildings, users restart identity cascade
  `);
  await pool.query(`
    insert into building_controlled_values (field, value, status) values
      ('building_type', 'Apartment', 'active'),
      ('grade_resource', 'Grade A', 'active')
  `);
  const passwordHash = await hash(adminPassword!, 4);
  const user = (await pool.query<{ id: string }>(`
    insert into users (email, password_hash, display_name, status)
    values ($1, $2, 'Browser Smoke Admin', 'active') returning id
  `, [adminEmail!.trim().toLowerCase(), passwordHash])).rows[0];
  for (const permission of permissions) {
    await pool.query(
      "insert into user_permissions (user_id, permission_key) values ($1, $2)",
      [user.id, permission],
    );
  }
});

test.afterAll(async () => {
  await pool?.end();
  if (client && bucket) {
    await emptyBucket();
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  }
});

test("operates the authenticated bilingual import workflow through the real UI", async ({ page }) => {
  await page.goto("/admin/imports");
  await expect(page.getByRole("heading", { name: "Import administration sign in" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByLabel("Email address").fill(adminEmail!);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Data import administration" })).toBeVisible();
  const disabledDataset = page.locator('[aria-disabled="true"]').filter({
    hasText: "Customer / Brand / Sales PIC",
  });
  await expect(disabledDataset).toContainText("Waiting for final template.");

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("heading", { name: "数据导入管理" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "数据导入管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "简体中文" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[aria-disabled="true"]').filter({ hasText: "客户 / 品牌 / Sales PIC" }))
    .toContainText("等待最终模板。");

  const templateDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载模板" }).click();
  await expect((await templateDownload).suggestedFilename()).toBe("02_Buildings_Template.xlsx");

  const invalidBuilding = Buffer.from([
    "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source",
    ",,Invalid Building,Apartment,Grade A,Jakarta,Jakarta,,Setiabudi,Invalid Address,active,building_team",
  ].join("\n"));
  await page.getByLabel("源文件").setInputFiles({
    name: "buildings-invalid.csv",
    mimeType: "text/csv",
    buffer: invalidBuilding,
  });
  await page.getByRole("button", { name: "上传并处理" }).click();
  await expect(page.locator(".admin-job").getByText("验证失败", { exact: true })).toBeVisible();

  const errorDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /下载本地化错误报告/ }).click();
  const report = await errorDownload;
  const reportPath = await report.path();
  expect(reportPath).toBeTruthy();
  const reportBody = await readFile(reportPath!, "utf8");
  expect(reportBody).toContain("import.error.iris_building_id_required");
  expect(reportBody).toContain("必须填写 IRIS 建筑 ID。");

  await page.getByLabel("源文件").setInputFiles(join(fixtureRoot, "buildings-valid.csv"));
  await page.getByRole("button", { name: "上传并处理" }).click();
  await expect(page.locator(".admin-job").getByText("可发布", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "变更摘要" }).getByText("1", { exact: true })).toBeVisible();
  const jobId = new URL(page.url()).searchParams.get("job");
  expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);

  await page.getByRole("button", { name: "发布数据" }).click();
  const confirmation = page.getByRole("dialog", { name: "发布楼宇数据？" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("发布会立即以原子方式应用已验证批次");
  await confirmation.getByRole("button", { name: "立即发布" }).click();
  await expect(page.getByText("发布成功完成。")).toBeVisible();
  await expect(page.getByText("已发布", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "数据导入管理" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("job")).toBe(jobId);
  await page.getByRole("button", { name: "历史", exact: true }).click();
  const persistedRow = page.locator("tbody tr").filter({ hasText: jobId! });
  await expect(persistedRow).toContainText("楼宇");
  await expect(persistedRow).toContainText("已发布");
});

async function emptyBucket(): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket!,
      ContinuationToken: continuationToken,
    }));
    const objects = (page.Contents ?? []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket!, Delete: { Objects: objects } }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

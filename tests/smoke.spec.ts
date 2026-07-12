import { expect, test } from "@playwright/test";

test("production health, login, and dashboard smoke", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok" });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quotation Approval Center" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Choose a demo role" })).toBeVisible();

  await page.getByRole("button", { name: /Sales Representative/ }).click();
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /New quotation/ })).toBeVisible();
});

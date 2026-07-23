import { expect, test, type Locator, type Page } from "@playwright/test";

type BonusOption = {
  resourceName?: string;
  weeks?: number;
};

type QuoteScenario = {
  bonus?: BonusOption;
  discount: number;
};

const USERS = {
  sales: "sales-chen",
  manager: "manager-lin",
  businessControl: "business-control-april",
  ceo: "ceo-zhao",
} as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quotation Approval Center" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Choose a demo role" })).toBeVisible();
  await page.getByRole("button", { name: /Chen Chen.*Sales Representative/ }).click();
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
});

test("no Bonus routes directly to Head of Sales", async ({ page, request }) => {
  if (!process.env.PLAYWRIGHT_UI_ONLY) {
    const health = await request.get("/api/health");
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
  }

  const quoteNumber = await createAndSubmitQuote(page, { discount: 65 });
  await expect(quoteRow(page, quoteNumber)).toContainText("Awaiting Head of Sales");

  await switchRole(page, USERS.manager);
  const managerRow = quoteRow(page, quoteNumber);
  await expect(managerRow).toBeVisible();
  await expect(managerRow.getByRole("button", { name: "Review quotation" })).toBeVisible();
});

test("65% placement discount plus a small Bonus routes directly to Business Control", async ({ page }) => {
  const quoteNumber = await createAndSubmitQuote(page, {
    bonus: { resourceName: "Pacific Place Jakarta", weeks: 1 },
    discount: 65,
  });

  await expect(quoteRow(page, quoteNumber)).toContainText("Awaiting Head of Business Control");
  await switchRole(page, USERS.businessControl);
  const businessControlRow = quoteRow(page, quoteNumber);
  await expect(businessControlRow).toBeVisible();
  await expect(businessControlRow.getByRole("button", { name: "Review quotation" })).toBeVisible();
});

test("65% placement discount plus a larger Bonus routes directly to CEO", async ({ page }) => {
  const quoteNumber = await createAndSubmitQuote(page, {
    bonus: { resourceName: "Pacific Place Jakarta", weeks: 4 },
    discount: 65,
  });

  await expect(quoteRow(page, quoteNumber)).toContainText("Awaiting CEO");
  await switchRole(page, USERS.ceo);
  const ceoRow = quoteRow(page, quoteNumber);
  await expect(ceoRow).toBeVisible();
  await expect(ceoRow.getByRole("button", { name: "Approve quotation" })).toBeVisible();
});

test("returned quotation can add Bonus, resubmit as V2, and reroute", async ({ page }) => {
  const quoteNumber = await createAndSubmitQuote(page, { discount: 65 });

  await switchRole(page, USERS.manager);
  await quoteRow(page, quoteNumber).getByRole("button", { name: "Review quotation" }).click();
  await page.getByRole("button", { name: "Return for revision" }).click();
  const returnDialog = dialogByTitle(page, "Return quotation for revision");
  await returnDialog.getByRole("textbox").fill("Add a meaningful Bonus placement before resubmitting.");
  await returnDialog.getByRole("button", { name: "Confirm return" }).click();
  await acknowledgeOutcome(page, "Quotation returned");

  await switchRole(page, USERS.sales);
  const returnedRow = quoteRow(page, quoteNumber);
  await expect(returnedRow).toContainText("Returned");
  await returnedRow.getByRole("button", { name: "Revise and resubmit" }).click();
  await page.getByRole("button", { name: "Revise and resubmit" }).click();

  await advanceToBonus(page);
  await chooseBonus(page, { resourceName: "Pacific Place Jakarta", weeks: 4 });
  await nextStep(page);
  await setCommercialParameters(page, { bonusWeeks: 4 });
  await nextStep(page);
  await expect(page.getByRole("status")).toContainText("CEO · Direct approval");
  await nextStep(page);
  await page.getByRole("button", { name: "Resubmit for approval" }).click();
  await acknowledgeOutcome(page, "Quotation resubmitted");

  const resubmittedRow = quoteRow(page, quoteNumber);
  await expect(resubmittedRow).toContainText("Awaiting CEO");
  await resubmittedRow.getByRole("button", { name: "View progress" }).click();
  await expect(page.getByText("Current V2")).toBeVisible();
  await expect(page.getByText("Awaiting CEO", { exact: true })).toBeVisible();

  await switchRole(page, USERS.ceo);
  await expect(quoteRow(page, quoteNumber)).toBeVisible();
});

test("approved quotation shows Placement and Bonus with FREE Bonus Nett", async ({ page }) => {
  const quoteNumber = await createAndSubmitQuote(page, {
    bonus: { resourceName: "Pacific Place Jakarta", weeks: 1 },
    discount: 65,
  });

  await switchRole(page, USERS.businessControl);
  await quoteRow(page, quoteNumber).getByRole("button", { name: "Review quotation" }).click();
  await expect(page.getByRole("heading", { name: "Quotation approval details" })).toBeVisible();
  await expect(page.getByText("Bonus Gross", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Bonus Nett · FREE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve quotation" }).click();
  const approvalDialog = dialogByTitle(page, "Confirm quotation approval");
  await approvalDialog.getByRole("button", { name: "Confirm approval" }).click();
  await acknowledgeOutcome(page, "Quotation approved");

  await switchRole(page, USERS.sales);
  const approvedRow = quoteRow(page, quoteNumber);
  await expect(approvedRow).toContainText("Approved");
  await approvedRow.getByRole("button", { name: "View formal Quotation" }).click();

  const document = page.locator("article.quotation-document");
  await expect(document.getByRole("heading", { name: /QUOTATION/ })).toBeVisible();
  await expect(commercialDocumentRow(document, "Placement")).toContainText("Jakarta Signature");
  const bonusRow = commercialDocumentRow(document, "Bonus");
  await expect(bonusRow).toContainText("Pacific Place Jakarta");
  await expect(bonusRow).toContainText("FREE");
  await expect(document.getByText("Bonus Nett · FREE", { exact: true })).toBeVisible();
});

async function createAndSubmitQuote(page: Page, scenario: QuoteScenario): Promise<string> {
  await page.getByRole("button", { name: /New quotation/ }).click();
  await page.getByRole("button", { name: /Kopi Nusantara/ }).click();
  await page
    .getByRole("region", { name: "Select customer and brand" })
    .getByRole("combobox", { name: /^Brand/ })
    .selectOption("brand-kopi-kenangan");
  await nextStep(page);

  await page.getByRole("button", { name: /Predefined sales package/ }).click();
  await page.getByRole("button", { name: /Jakarta Signature/ }).click();
  await nextStep(page);

  if (scenario.bonus) {
    await chooseBonus(page, scenario.bonus);
  } else {
    await page.getByRole("button", { name: "No Bonus" }).click();
  }
  await nextStep(page);

  await setCommercialParameters(page, { bonusWeeks: scenario.bonus?.weeks });
  await nextStep(page);
  await page.getByLabel("Customer discount").fill(String(scenario.discount));
  await nextStep(page);
  await page.getByRole("button", { name: "Submit for direct approval" }).click();

  const dialog = dialogByTitle(page, "Quotation submitted");
  await expect(dialog).toBeVisible();
  const content = await dialog.textContent();
  const quoteNumber = content?.match(/DEMO-Q-[\w-]+/)?.[0];
  expect(quoteNumber, "submission outcome should expose the generated quotation number").toBeTruthy();
  await dialog.getByRole("button", { name: "Got it" }).click();
  return quoteNumber!;
}

async function advanceToBonus(page: Page) {
  await nextStep(page);
  await nextStep(page);
}

async function nextStep(page: Page) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

async function chooseBonus(page: Page, bonus: BonusOption) {
  await page.getByRole("button", { name: "Add Bonus" }).click();
  await page.getByRole("button", { name: /Choose buildings/ }).click();
  await page.getByRole("button", { name: new RegExp(bonus.resourceName ?? "Pacific Place Jakarta") }).click();
}

async function setCommercialParameters(page: Page, { bonusWeeks }: { bonusWeeks?: number }) {
  const placementCard = parameterCard(page, "Placement");
  await expect(placementCard.getByLabel("Campaign period")).toHaveValue("4");
  if (bonusWeeks !== undefined) {
    await parameterCard(page, "Bonus").getByLabel("Campaign period").fill(String(bonusWeeks));
  }
}

async function switchRole(page: Page, userId: string) {
  await page.getByRole("banner").getByRole("combobox").selectOption(userId);
}

async function acknowledgeOutcome(page: Page, title: string) {
  const dialog = dialogByTitle(page, title);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Got it" }).click();
}

function dialogByTitle(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

function quoteRow(page: Page, quoteNumber: string): Locator {
  return page.locator("article.quote-row").filter({ hasText: quoteNumber });
}

function parameterCard(page: Page, label: "Placement" | "Bonus"): Locator {
  return page.locator("section.parameter-card").filter({
    has: page.locator("header strong", { hasText: label }),
  });
}

function commercialDocumentRow(document: Locator, label: "Placement" | "Bonus"): Locator {
  return document.locator("tbody tr").filter({ hasText: label }).first();
}

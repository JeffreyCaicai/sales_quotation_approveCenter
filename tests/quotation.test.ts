import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, CUSTOMERS, PACKAGES, SEEDED_QUOTES, USERS } from "../lib/mock-data.ts";
import {
  approveQuote,
  calculatePricing,
  canApproveQuote,
  createDraftQuote,
  getDiscountBand,
  getNextApproval,
  returnQuote,
  submitQuote,
  validateQuote,
  validateQuoteReferences,
} from "../lib/quotation.ts";
import { loadQuotes, quotesForRole, resetQuotes, saveQuotes } from "../lib/store.ts";
import type { Quote, QuoteInput } from "../lib/types.ts";

test("discount bands keep 60 and 70 inside their stated bands", () => {
  assert.equal(getDiscountBand(60), "standard");
  assert.equal(getDiscountBand(60.01), "elevated");
  assert.equal(getDiscountBand(70), "elevated");
  assert.equal(getDiscountBand(70.01), "executive");
});

test("every quote reaches manager before an executive discount reaches CEO", () => {
  assert.equal(getNextApproval(50, false), "pending_manager");
  assert.equal(getNextApproval(75, false), "pending_manager");
  assert.equal(getNextApproval(75, true), "pending_ceo");
  assert.equal(getNextApproval(70, true), "approved");
});

test("pricing applies discount then simulated 6 percent tax", () => {
  assert.deepEqual(calculatePricing({ basePrice: 100000, discount: 25, taxRate: 0.06 }), {
    basePrice: 100000,
    discountAmount: 25000,
    netPrice: 75000,
    tax: 4500,
    total: 79500,
  });
});

test("pricing defaults to the simulated 6 percent tax rate", () => {
  assert.deepEqual(calculatePricing({ basePrice: 100000, discount: 25 }), {
    basePrice: 100000,
    discountAmount: 25000,
    netPrice: 75000,
    tax: 4500,
    total: 79500,
  });
});

test("invalid quote fields return field-level messages", () => {
  const errors = validateQuote({ customerId: "", brandId: "", placementIds: [], weeks: 0, spots: 0, discount: 101 });
  assert.equal(errors.customerId, "请选择客户");
  assert.equal(errors.placementIds, "请至少选择一栋楼宇或一个销售包");
  assert.equal(errors.discount, "折扣必须在 0%–100% 之间");
});

test("non-finite discount returns the discount range message", () => {
  const errors = validateQuote({ discount: Number.NaN });
  assert.equal(errors.discount, "折扣必须在 0%–100% 之间");
});

test("weeks and spots must be finite positive integers", () => {
  assert.equal(validateQuote({ ...validQuoteInput(), weeks: 1.5 }).weeks, "投放周期必须为正整数");
  assert.equal(validateQuote({ ...validQuoteInput(), weeks: Number.POSITIVE_INFINITY }).weeks, "投放周期必须为正整数");
  assert.equal(validateQuote({ ...validQuoteInput(), spots: -1 }).spots, "Spot 数量必须为正整数");
  assert.equal(validateQuote({ ...validQuoteInput(), spots: 3.2 }).spots, "Spot 数量必须为正整数");
});

test("bonus must be a finite nonnegative integer", () => {
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: Number.NaN }).bonus, "Bonus 必须为非负整数");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: -1 }).bonus, "Bonus 必须为非负整数");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: 1.5 }).bonus, "Bonus 必须为非负整数");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: 0 }).bonus, undefined);
});

test("explicit pricing inputs must stay finite before persistence", () => {
  assert.equal(
    validateQuote({ ...validQuoteInput(), basePrice: Number.POSITIVE_INFINITY }).basePrice,
    "报价基础价格必须为有限非负数",
  );
  assert.equal(
    validateQuote({ ...validQuoteInput(), taxRate: Number.NaN }).taxRate,
    "模拟税率必须为有限非负数",
  );
});

test("submitQuote rejects invalid numeric input before creating a persistable quote", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);

  assert.throws(
    () => submitQuote({ ...validQuoteInput(), bonus: Number.NaN }, undefined, salesUser),
    /Bonus 必须为非负整数/,
  );
});

test("an incomplete early-step draft remains safely serializable and persistable", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);
  const draft = createDraftQuote(
    {
      customerId: "",
      brandId: "",
      placementIds: [],
      weeks: 0,
      spots: 0,
      bonus: 0,
      discount: 50,
      basePrice: 0,
    },
    undefined,
    salesUser,
  );

  assert.equal(draft.status, "draft");
  assert.equal(draft.customerId, "");
  assert.equal(draft.brandId, "");
  assert.equal(draft.placementMode, undefined);
  assert.deepEqual(draft.placementIds, []);
  assert.equal(draft.weeks, 0);
  assert.equal(draft.spots, 0);
  assert.ok([
    draft.weeks,
    draft.spots,
    draft.bonus,
    draft.discount,
    ...Object.values(draft.pricing),
  ].every(Number.isFinite));

  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes([draft]);
    const [loadedDraft] = loadQuotes();
    assert.equal(loadedDraft.id, draft.id);
    assert.equal(loadedDraft.placementMode, undefined);
    assert.equal(loadedDraft.weeks, 0);
    assert.equal(loadedDraft.spots, 0);
    assert.deepEqual(loadedDraft.pricing, draft.pricing);
  });
});

test("draft creation normalizes non-finite numerics without changing mode selection", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);
  const draft = createDraftQuote(
    {
      placementMode: "package",
      weeks: Number.NaN,
      spots: Number.POSITIVE_INFINITY,
      bonus: -1.5,
      discount: Number.NaN,
      basePrice: Number.NaN,
      taxRate: Number.NaN,
    },
    undefined,
    salesUser,
  );

  assert.equal(draft.placementMode, "package");
  assert.equal(draft.weeks, 0);
  assert.equal(draft.spots, 0);
  assert.equal(draft.bonus, 0);
  assert.equal(draft.discount, 0);
  assert.deepEqual(draft.pricing, {
    basePrice: 0,
    discountAmount: 0,
    netPrice: 0,
    tax: 0,
    total: 0,
  });
});

test("draft creation clears stale base pricing when an invalid period normalizes to zero", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);
  const draft = createDraftQuote(
    {
      placementMode: "building",
      placementIds: ["building-pacific-place"],
      weeks: 1.5,
      spots: 0,
      bonus: 0,
      discount: 50,
      basePrice: 64_000,
    },
    undefined,
    salesUser,
  );

  assert.equal(draft.weeks, 0);
  assert.deepEqual(draft.pricing, {
    basePrice: 0,
    discountAmount: 0,
    netPrice: 0,
    tax: 0,
    total: 0,
  });
});

test("a valid priced draft retains the same total after storage round-trip", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);
  const draft = createDraftQuote(
    {
      customerId: "",
      brandId: "",
      placementMode: "building",
      placementIds: ["building-pacific-place"],
      weeks: 4,
      spots: 0,
      bonus: 0,
      discount: 50,
      basePrice: 128_000,
    },
    undefined,
    salesUser,
  );

  assert.deepEqual(draft.pricing, {
    basePrice: 128_000,
    discountAmount: 64_000,
    netPrice: 64_000,
    tax: 3_840,
    total: 67_840,
  });

  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes([draft]);
    const [reopened] = loadQuotes();
    assert.equal(reopened.pricing.basePrice, draft.pricing.basePrice);
    assert.equal(reopened.pricing.total, draft.pricing.total);
  });
});

test("reference validation rejects a customer outside the active salesperson portfolio", () => {
  const foreignCustomer = { ...CUSTOMERS[0], id: "customer-foreign", salesId: "sales-other" };
  const errors = validateQuoteReferences(
    { ...validQuoteInput(), customerId: foreignCustomer.id },
    "sales-chen",
    { customers: [...CUSTOMERS, foreignCustomer], buildings: BUILDINGS, packages: PACKAGES },
  );

  assert.equal(errors.customerId, "请选择当前销售负责的客户");
});

test("reference validation rejects a brand that does not belong to the selected customer", () => {
  const errors = validateQuoteReferences(
    { ...validQuoteInput(), brandId: "brand-traveloka" },
    "sales-chen",
    { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES },
  );

  assert.equal(errors.brandId, "请选择该客户旗下的品牌");
});

test("reference validation rejects resources outside the selected placement mode", () => {
  const references = { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES };
  const buildingInPackage = validateQuoteReferences(
    { ...validQuoteInput(), placementMode: "package", placementIds: [BUILDINGS[0].id], basePrice: BUILDINGS[0].priceRmb },
    "sales-chen",
    references,
  );
  const unknownBuilding = validateQuoteReferences(
    { ...validQuoteInput(), placementMode: "package", placementIds: ["resource-unknown"], basePrice: 0 },
    "sales-chen",
    references,
  );

  assert.equal(buildingInPackage.placementIds, "所选资源与投放方式不匹配");
  assert.equal(unknownBuilding.placementIds, "所选资源与投放方式不匹配");
});

test("reference validation rejects a base price that does not match selected resources", () => {
  const errors = validateQuoteReferences(
    { ...validQuoteInput(), basePrice: 0 },
    "sales-chen",
    { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES },
  );

  assert.equal(errors.basePrice, "报价基础价格与所选资源不一致");
});

test("submitting a valid new quote creates version 1 pending manager approval", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);

  const quote = submitQuote(
    {
      customerId: "customer-kopi",
      brandId: "brand-kopi-kenangan",
      placementMode: "building",
      placementIds: ["building-pacific-place"],
      weeks: 4,
      spots: 160,
      bonus: 16,
      discount: 50,
      basePrice: 128_000,
    },
    undefined,
    salesUser,
  );

  assert.equal(quote.version, 1);
  assert.equal(quote.status, "pending_manager");
  assert.equal(quote.salesId, salesUser.id);
  assert.match(quote.id, /^quote-demo-/);
  assert.match(quote.quoteNumber, /^DEMO-Q-/);
  assert.equal(quote.approvalHistory.length, 1);
  assert.deepEqual(quote.approvalHistory[0], {
    id: `${quote.id}-v1-submitted`,
    role: "sales",
    action: "submitted",
    actorId: salesUser.id,
    actorName: salesUser.name,
    createdAt: quote.createdAt,
    version: 1,
  });
});

test("resubmitting a returned executive-discount quote preserves history and returns to manager", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  const returnedQuote = SEEDED_QUOTES.find((quote) => quote.status === "returned");
  assert.ok(salesUser);
  assert.ok(returnedQuote);

  const resubmitted = submitQuote(
    {
      customerId: returnedQuote.customerId,
      brandId: returnedQuote.brandId,
      placementMode: returnedQuote.placementMode,
      placementIds: returnedQuote.placementIds,
      weeks: returnedQuote.weeks,
      spots: returnedQuote.spots,
      bonus: returnedQuote.bonus,
      discount: 75,
      basePrice: returnedQuote.pricing.basePrice,
    },
    returnedQuote,
    salesUser,
  );

  assert.equal(resubmitted.id, returnedQuote.id);
  assert.equal(resubmitted.quoteNumber, returnedQuote.quoteNumber);
  assert.equal(resubmitted.createdAt, returnedQuote.createdAt);
  assert.equal(resubmitted.version, returnedQuote.version + 1);
  assert.equal(resubmitted.status, "pending_manager");
  assert.deepEqual(
    resubmitted.approvalHistory.slice(0, -1),
    returnedQuote.approvalHistory,
  );
  assert.deepEqual(resubmitted.approvalHistory.at(-1), {
    id: `${returnedQuote.id}-v2-resubmitted`,
    role: "sales",
    action: "resubmitted",
    actorId: salesUser.id,
    actorName: salesUser.name,
    createdAt: resubmitted.updatedAt,
    version: 2,
  });
});

test("submitting a saved draft is its first submission and keeps version 1", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);
  const draft: Quote = {
    ...SEEDED_QUOTES[0],
    id: "quote-draft-demo",
    quoteNumber: "DEMO-DRAFT-001",
    status: "draft",
    version: 1,
    approvalHistory: [],
  };

  const submitted = submitQuote(
    {
      customerId: draft.customerId,
      brandId: draft.brandId,
      placementMode: draft.placementMode,
      placementIds: draft.placementIds,
      weeks: draft.weeks,
      spots: draft.spots,
      bonus: draft.bonus,
      discount: draft.discount,
      basePrice: draft.pricing.basePrice,
    },
    draft,
    salesUser,
  );

  assert.equal(submitted.id, draft.id);
  assert.equal(submitted.version, 1);
  assert.equal(submitted.approvalHistory.at(-1)?.action, "submitted");
});

test("manager approval finalizes a 50 percent quote", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(pendingQuote);

  const approved = approveQuote(pendingQuote, manager);

  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedAt, approved.updatedAt);
  assert.equal(approved.approvalHistory.at(-1)?.action, "approved");
  assert.equal(approved.approvalHistory.at(-1)?.actorId, manager.id);
});

test("manager approval routes a 75 percent quote to CEO", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(pendingQuote);

  const approved = approveQuote({ ...pendingQuote, discount: 75 }, manager);

  assert.equal(approved.status, "pending_ceo");
  assert.equal(approved.approvedAt, undefined);
  assert.equal(approved.approvalHistory.at(-1)?.role, "manager");
});

test("manager approval finalizes a quote at the exact 70 percent boundary", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(pendingQuote);

  const approved = approveQuote({ ...pendingQuote, discount: 70 }, manager);

  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedAt, approved.approvalHistory.at(-1)?.createdAt);
});

test("CEO approval finalizes a 75 percent quote", () => {
  const ceo = USERS.find((user) => user.role === "ceo");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(ceo);
  assert.ok(pendingQuote);

  const approved = approveQuote(pendingQuote, ceo);

  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedAt, approved.updatedAt);
  assert.equal(approved.approvalHistory.at(-1)?.role, "ceo");
});

test("returning a quote requires a nonblank reason", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(pendingQuote);

  assert.throws(() => returnQuote(pendingQuote, manager, "  \n "), /退回原因/);
});

test("returning a quote preserves its commercial details and exact trimmed reason", () => {
  const ceo = USERS.find((user) => user.role === "ceo");
  const pendingQuote = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(ceo);
  assert.ok(pendingQuote);

  const returned = returnQuote(pendingQuote, ceo, "  请确认客户预算  ");

  assert.equal(returned.status, "returned");
  assert.deepEqual(returned.pricing, pendingQuote.pricing);
  assert.equal(returned.placementMode, pendingQuote.placementMode);
  assert.deepEqual(returned.placementIds, pendingQuote.placementIds);
  assert.deepEqual(returned.approvalHistory.at(-1), {
    id: `${pendingQuote.id}-v${pendingQuote.version}-returned-${pendingQuote.approvalHistory.length + 1}`,
    role: "ceo",
    action: "returned",
    actorId: ceo.id,
    actorName: ceo.name,
    createdAt: returned.updatedAt,
    version: pendingQuote.version,
    comment: "请确认客户预算",
  });
});

test("approval transitions reject the wrong role and wrong status", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  const approved = SEEDED_QUOTES.find((quote) => quote.status === "approved");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceoPending);
  assert.ok(approved);

  assert.throws(() => approveQuote(ceoPending, manager), /状态/);
  assert.throws(() => approveQuote(approved, manager), /状态/);
  assert.throws(() => returnQuote(ceoPending, sales, "需要修改"), /无权/);
});

test("approval eligibility uses the same role, status, and discount guards as transitions", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  const managerPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceo);
  assert.ok(managerPending);
  assert.ok(ceoPending);

  assert.equal(canApproveQuote(managerPending, manager), true);
  assert.equal(canApproveQuote(managerPending, ceo), false);
  assert.equal(canApproveQuote(ceoPending, ceo), true);
  assert.equal(canApproveQuote({ ...ceoPending, discount: 70 }, ceo), false);
  assert.equal(canApproveQuote(ceoPending, sales), false);
});

test("approval and return transitions do not mutate their source quotes", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  const managerPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(manager);
  assert.ok(ceo);
  assert.ok(managerPending);
  assert.ok(ceoPending);
  const managerSnapshot = structuredClone(managerPending);
  const ceoSnapshot = structuredClone(ceoPending);

  approveQuote(managerPending, manager);
  returnQuote(ceoPending, ceo, "请修改");

  assert.deepEqual(managerPending, managerSnapshot);
  assert.deepEqual(ceoPending, ceoSnapshot);
});

test("sales only receives quotations assigned to that salesperson", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);

  const otherSalesQuote: Quote = {
    ...SEEDED_QUOTES[0],
    id: "quote-other-sales",
    quoteNumber: "DEMO-OTHER-SALES",
    salesId: "sales-someone-else",
  };
  const visible = quotesForRole([...SEEDED_QUOTES, otherSalesQuote], "sales", salesUser.id);

  assert.ok(visible.length > 0);
  assert.ok(visible.every((quote) => quote.salesId === salesUser.id));
  assert.ok(!visible.some((quote) => quote.id === otherSalesQuote.id));
});

test("manager receives team quotations and excludes outside-team owners", () => {
  const manager = USERS.find((user) => user.role === "manager");
  assert.ok(manager);
  const outsideTeamQuote: Quote = {
    ...SEEDED_QUOTES[0],
    id: "quote-outside-manager-team",
    quoteNumber: "DEMO-OUTSIDE-MANAGER-TEAM",
    salesId: "sales-outside-team",
  };

  assert.deepEqual(
    quotesForRole([...SEEDED_QUOTES, outsideTeamQuote], manager.role, manager.id).map(
      (quote) => quote.id,
    ),
    SEEDED_QUOTES.map((quote) => quote.id),
  );
});

test("unknown manager receives no team quotations", () => {
  assert.deepEqual(quotesForRole(SEEDED_QUOTES, "manager", "manager-unknown"), []);
});

test("CEO action queue contains only quotations pending CEO approval", () => {
  const ceo = USERS.find((user) => user.role === "ceo");
  assert.ok(ceo);

  const visible = quotesForRole(SEEDED_QUOTES, ceo.role, ceo.id);

  assert.ok(visible.length > 0);
  assert.ok(visible.every((quote) => quote.status === "pending_ceo"));
});

test("packages only reference existing Jakarta building fixtures", () => {
  const buildingIds = new Set(BUILDINGS.map((building) => building.id));

  assert.equal(BUILDINGS.length, 8);
  assert.equal(PACKAGES.length, 3);
  for (const salesPackage of PACKAGES) {
    assert.ok(salesPackage.buildingIds.length > 0);
    assert.ok(salesPackage.buildingIds.every((buildingId) => buildingIds.has(buildingId)));
  }
});

test("seed data links customers to brands and covers the approval workflow", () => {
  const relationships = CUSTOMERS.flatMap((customer) =>
    customer.brands.map((brand) => ({ customerId: customer.id, brandId: brand.id })),
  );

  assert.ok(relationships.length >= 4);
  assert.deepEqual(
    new Set(SEEDED_QUOTES.map((quote) => quote.status)),
    new Set(["returned", "pending_manager", "pending_ceo", "approved"]),
  );
  assert.ok(SEEDED_QUOTES.every((quote) => quote.approvalHistory.length > 0));
  assert.ok(
    SEEDED_QUOTES.every((quote) =>
      relationships.some(
        (relationship) =>
          relationship.customerId === quote.customerId && relationship.brandId === quote.brandId,
      ),
    ),
  );
});

test("server-side quote loading returns a fresh deep clone of the seeds", () => {
  const first = loadQuotes();
  const second = loadQuotes();

  assert.deepEqual(first, SEEDED_QUOTES);
  assert.notEqual(first, SEEDED_QUOTES);
  assert.notEqual(first[0], SEEDED_QUOTES[0]);
  assert.notEqual(first, second);
});

test("browser persistence round-trips valid quotes and falls back on invalid data", () => {
  const storage = new MemoryStorage();
  const approvedSeed = SEEDED_QUOTES.find((quote) => quote.status === "approved");
  assert.ok(approvedSeed);

  withBrowserStorage(storage, () => {
    const changed = [{ ...approvedSeed, bonus: approvedSeed.bonus + 1 }];
    saveQuotes(changed);
    const loaded = loadQuotes();
    assert.deepEqual(loaded, changed);
    assert.notEqual(loaded, changed);
    assert.notEqual(loaded[0], changed[0]);
    assert.notEqual(loaded[0].pricing, changed[0].pricing);
    assert.notEqual(loaded[0].approvalHistory, changed[0].approvalHistory);

    storage.setItem("quotation-prototype-v1", "not JSON");
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);

    storage.setItem("quotation-prototype-v1", JSON.stringify([{ id: "invalid-schema" }]));
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);

    assert.deepEqual(resetQuotes(), SEEDED_QUOTES);
    assert.equal(storage.getItem("quotation-prototype-v1"), null);
  });
});

test("browser persistence refuses invalid numeric quotes without overwriting valid data", () => {
  const storage = new MemoryStorage();

  withBrowserStorage(storage, () => {
    const valid = [structuredClone(SEEDED_QUOTES[0])];
    saveQuotes(valid);

    const invalidQuotes: Quote[] = [
      { ...valid[0], bonus: Number.NaN },
      { ...valid[0], weeks: 1.5 },
      { ...valid[0], spots: -1 },
      { ...valid[0], discount: 101 },
    ];
    for (const invalid of invalidQuotes) {
      saveQuotes([invalid]);
      assert.deepEqual(loadQuotes(), valid);
    }
  });
});

test("browser persistence rejects inconsistent approval states and malformed history metadata", () => {
  const storage = new MemoryStorage();
  const pendingCeo = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(pendingCeo);

  withBrowserStorage(storage, () => {
    const valid = [structuredClone(pendingCeo)];
    saveQuotes(valid);

    const invalidQuotes: Quote[] = [
      { ...pendingCeo, discount: 70 },
      { ...pendingCeo, updatedAt: "not-a-timestamp" },
      {
        ...pendingCeo,
        approvalHistory: pendingCeo.approvalHistory.map((event, index) =>
          index === 0 ? { ...event, createdAt: "not-a-timestamp" } : event,
        ),
      },
      {
        ...pendingCeo,
        approvalHistory: pendingCeo.approvalHistory.map((event, index) =>
          index === 0 ? { ...event, version: 0 } : event,
        ),
      },
      {
        ...pendingCeo,
        approvalHistory: pendingCeo.approvalHistory.map((event, index) =>
          index === 0 ? { ...event, version: pendingCeo.version + 1 } : event,
        ),
      },
    ];

    for (const invalid of invalidQuotes) {
      saveQuotes([invalid]);
      assert.deepEqual(loadQuotes(), valid);
    }
  });
});

test("browser persistence rejects forged or skipped current-version workflow paths", () => {
  const storage = new MemoryStorage();
  const managerPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(managerPending);
  assert.ok(ceoPending);
  const managerApproval = ceoPending.approvalHistory.at(-1);
  assert.ok(managerApproval);

  withBrowserStorage(storage, () => {
    const valid = [structuredClone(ceoPending)];
    saveQuotes(valid);

    const invalidQuotes: Quote[] = [
      { ...ceoPending, approvalHistory: [ceoPending.approvalHistory[0]] },
      {
        ...ceoPending,
        status: "approved",
        approvedAt: managerApproval.createdAt,
      },
      {
        ...managerPending,
        status: "approved",
        approvedAt: managerPending.approvalHistory[0].createdAt,
      },
      { ...ceoPending, status: "pending_manager" },
      { ...ceoPending, status: "returned" },
    ];

    for (const invalid of invalidQuotes) {
      saveQuotes([invalid]);
      assert.deepEqual(loadQuotes(), valid);
    }
  });
});

test("browser persistence requires approvedAt to match final approval only", () => {
  const storage = new MemoryStorage();
  const approved = SEEDED_QUOTES.find((quote) => quote.status === "approved");
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(approved);
  assert.ok(ceoPending);

  withBrowserStorage(storage, () => {
    const valid = [structuredClone(approved)];
    saveQuotes(valid);

    const invalidQuotes: Quote[] = [
      { ...approved, approvedAt: undefined },
      { ...approved, approvedAt: approved.createdAt },
      { ...ceoPending, approvedAt: ceoPending.approvalHistory.at(-1)?.createdAt },
    ];

    for (const invalid of invalidQuotes) {
      saveQuotes([invalid]);
      assert.deepEqual(loadQuotes(), valid);
    }
  });
});

test("browser persistence rejects approval events with forged actor identity", () => {
  const storage = new MemoryStorage();
  const ceoPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo");
  assert.ok(ceoPending);

  withBrowserStorage(storage, () => {
    const valid = [structuredClone(ceoPending)];
    saveQuotes(valid);
    const [submission, managerApproval] = ceoPending.approvalHistory;

    const invalidQuotes: Quote[] = [
      {
        ...ceoPending,
        approvalHistory: [
          { ...submission, actorId: "sales-forged" },
          managerApproval,
        ],
      },
      {
        ...ceoPending,
        approvalHistory: [
          { ...submission, role: "manager" } as Quote["approvalHistory"][number],
          managerApproval,
        ],
      },
      {
        ...ceoPending,
        approvalHistory: [
          submission,
          { ...managerApproval, actorName: "伪造姓名" },
        ],
      },
    ];

    for (const invalid of invalidQuotes) {
      saveQuotes([invalid]);
      assert.deepEqual(loadQuotes(), valid);
    }
  });
});

test("generated manager and CEO transitions survive persistence validation", () => {
  const storage = new MemoryStorage();
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  const managerPending = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(ceo);
  assert.ok(managerPending);
  const executiveQuote = { ...managerPending, discount: 75 };
  const pendingCeo = approveQuote(executiveQuote, manager);
  const approved = approveQuote(pendingCeo, ceo);

  withBrowserStorage(storage, () => {
    saveQuotes([approved]);
    assert.deepEqual(loadQuotes(), [approved]);
  });
});

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

function withBrowserStorage(storage: Storage, callback: () => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    callback();
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

function validQuoteInput(): QuoteInput {
  return {
    customerId: "customer-kopi",
    brandId: "brand-kopi-kenangan",
    placementMode: "building",
    placementIds: ["building-pacific-place"],
    weeks: 4,
    spots: 160,
    bonus: 0,
    discount: 50,
    basePrice: 128_000,
  };
}

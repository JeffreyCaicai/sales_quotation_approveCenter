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

test("invalid quote fields return stable field-level localization keys", () => {
  const errors = validateQuote({ customerId: "", brandId: "", placementIds: [], weeks: 0, spots: 0, discount: 101 });
  assert.equal(errors.customerId, "validation.customerRequired");
  assert.equal(errors.placementIds, "validation.placementRequired");
  assert.equal(errors.discount, "validation.discountRange");
});

test("non-finite discount returns the discount range message", () => {
  const errors = validateQuote({ discount: Number.NaN });
  assert.equal(errors.discount, "validation.discountRange");
});

test("weeks and spots must be finite positive integers", () => {
  assert.equal(validateQuote({ ...validQuoteInput(), weeks: 1.5 }).weeks, "validation.weeksPositiveInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), weeks: Number.POSITIVE_INFINITY }).weeks, "validation.weeksPositiveInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), spots: -1 }).spots, "validation.spotsPositiveInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), spots: 3.2 }).spots, "validation.spotsPositiveInteger");
});

test("bonus must be a finite nonnegative integer", () => {
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: Number.NaN }).bonus, "validation.bonusNonnegativeInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: -1 }).bonus, "validation.bonusNonnegativeInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: 1.5 }).bonus, "validation.bonusNonnegativeInteger");
  assert.equal(validateQuote({ ...validQuoteInput(), bonus: 0 }).bonus, undefined);
});

test("explicit pricing inputs must stay finite before persistence", () => {
  assert.equal(
    validateQuote({ ...validQuoteInput(), basePrice: Number.POSITIVE_INFINITY }).basePrice,
    "validation.basePriceFiniteNonnegative",
  );
  assert.equal(
    validateQuote({ ...validQuoteInput(), taxRate: Number.NaN }).taxRate,
    "validation.taxRateFiniteNonnegative",
  );
});

test("submitQuote rejects invalid numeric input before creating a persistable quote", () => {
  const salesUser = USERS.find((user) => user.role === "sales");
  assert.ok(salesUser);

  assert.throws(
    () => submitQuote({ ...validQuoteInput(), bonus: Number.NaN }, undefined, salesUser),
    /validation\.bonusNonnegativeInteger/,
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
      basePrice: BUILDINGS[0].priceIdr,
      traffic: 38_000,
      impressions: 720_000,
    },
    undefined,
    salesUser,
  );

  assert.deepEqual(draft.pricing, calculatePricing({ basePrice: BUILDINGS[0].priceIdr, discount: 50 }));

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

  assert.equal(errors.customerId, "validation.customerOwned");
});

test("reference validation rejects a brand that does not belong to the selected customer", () => {
  const errors = validateQuoteReferences(
    { ...validQuoteInput(), brandId: "brand-traveloka" },
    "sales-chen",
    { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES },
  );

  assert.equal(errors.brandId, "validation.brandBelongsToCustomer");
});

test("reference validation rejects resources outside the selected placement mode", () => {
  const references = { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES };
  const buildingInPackage = validateQuoteReferences(
    { ...validQuoteInput(), placementMode: "package", placementIds: [BUILDINGS[0].id], basePrice: BUILDINGS[0].priceIdr },
    "sales-chen",
    references,
  );
  const unknownBuilding = validateQuoteReferences(
    { ...validQuoteInput(), placementMode: "package", placementIds: ["resource-unknown"], basePrice: 0 },
    "sales-chen",
    references,
  );

  assert.equal(buildingInPackage.placementIds, "validation.resourceModeMismatch");
  assert.equal(unknownBuilding.placementIds, "validation.resourceModeMismatch");
});

test("reference validation rejects a base price that does not match selected resources", () => {
  const errors = validateQuoteReferences(
    { ...validQuoteInput(), basePrice: 0 },
    "sales-chen",
    { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES },
  );

  assert.equal(errors.basePrice, "validation.basePriceMismatch");
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
      basePrice: BUILDINGS[0].priceIdr,
      traffic: 38_000,
      impressions: 720_000,
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
  assert.deepEqual(quote.versionSnapshots, [
    {
      version: 1,
      customerId: "customer-kopi",
      brandId: "brand-kopi-kenangan",
      placementMode: "building",
      placementIds: ["building-pacific-place"],
      weeks: 4,
      spots: 160,
      bonus: 16,
      pricing: calculatePricing({ basePrice: BUILDINGS[0].priceIdr, discount: 50 }),
      traffic: 38_000,
      impressions: 720_000,
      discount: 50,
      submittedAt: quote.createdAt,
    },
  ]);
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

test("returned draft edits and resubmission keep V1 immutable while appending V2", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  assert.ok(sales);
  assert.ok(manager);

  const submitted = submitQuote(validQuoteInput(), undefined, sales);
  const returned = returnQuote(submitted, manager, "请增加 Bonus 并调整折扣");
  const lockedV1 = structuredClone(returned.versionSnapshots[0]);
  const editedInput = validQuoteInput({ bonus: 20, discount: 60 });
  const editedDraft = createDraftQuote(editedInput, returned, sales);

  assert.equal(editedDraft.status, "returned");
  assert.equal(editedDraft.bonus, 20);
  assert.equal(editedDraft.discount, 60);
  assert.deepEqual(editedDraft.versionSnapshots, [lockedV1]);
  assert.deepEqual(returned.versionSnapshots, [lockedV1]);

  const resubmitted = submitQuote(editedInput, editedDraft, sales);

  assert.equal(resubmitted.version, 2);
  assert.equal(resubmitted.versionSnapshots.length, 2);
  assert.deepEqual(resubmitted.versionSnapshots[0], lockedV1);
  assert.deepEqual(resubmitted.versionSnapshots[1], {
    ...lockedV1,
    version: 2,
    bonus: 20,
    discount: 60,
    pricing: calculatePricing(editedInput),
    submittedAt: resubmitted.updatedAt,
  });
  assert.deepEqual(returned.versionSnapshots, [lockedV1]);
});

test("approval and return transitions preserve commercial version snapshots", () => {
  const manager = USERS.find((user) => user.role === "manager");
  const pending = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager");
  assert.ok(manager);
  assert.ok(pending);
  const snapshots = structuredClone(pending.versionSnapshots);

  assert.deepEqual(approveQuote(pending, manager).versionSnapshots, snapshots);
  assert.deepEqual(returnQuote(pending, manager, "请调整方案").versionSnapshots, snapshots);
  assert.deepEqual(pending.versionSnapshots, snapshots);
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

  assert.throws(() => returnQuote(pendingQuote, manager, "  \n "), /validation\.returnReasonRequired/);
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

  assert.throws(() => approveQuote(ceoPending, manager), /quotation\.approval\.managerStageRequired/);
  assert.throws(() => approveQuote(approved, manager), /quotation\.approval\.managerStageRequired/);
  assert.throws(() => returnQuote(ceoPending, sales, "需要修改"), /quotation\.approval\.roleRequired/);
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
  assert.ok(SEEDED_QUOTES.every((quote) => quote.versionSnapshots.length === quote.version));
  assert.ok(SEEDED_QUOTES.every((quote) => quote.versionSnapshots.at(-1)?.version === quote.version));
  assert.ok(
    SEEDED_QUOTES.every((quote) =>
      relationships.some(
        (relationship) =>
          relationship.customerId === quote.customerId && relationship.brandId === quote.brandId,
      ),
    ),
  );
});

test("seeded snapshots retain catalog-backed commercial totals and version event keys", () => {
  for (const quote of SEEDED_QUOTES) {
    for (const snapshot of quote.versionSnapshots) {
      const customer = CUSTOMERS.find((item) => item.id === snapshot.customerId);
      const resources = snapshot.placementMode === "building"
        ? BUILDINGS.filter((item) => snapshot.placementIds.includes(item.id))
        : PACKAGES.filter((item) => snapshot.placementIds.includes(item.id));
      assert.ok(customer?.brands.some((brand) => brand.id === snapshot.brandId));
      assert.equal(resources.length, snapshot.placementIds.length);
      assert.equal(snapshot.traffic, resources.reduce((total, item) => total + item.traffic, 0));
      assert.equal(snapshot.impressions, resources.reduce((total, item) => total + item.impressions, 0));
      assert.deepEqual(snapshot.pricing, calculatePricing({
        basePrice: Math.round(resources.reduce((total, item) => total + item.priceIdr, 0) * (snapshot.weeks / 4)),
        discount: snapshot.discount,
      }));
      assert.ok(quote.approvalHistory.some((event) => event.version === snapshot.version));
    }
  }
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
  const returnedSeed = SEEDED_QUOTES.find((quote) => quote.status === "returned");
  assert.ok(returnedSeed);

  withBrowserStorage(storage, () => {
    const changed = [{ ...returnedSeed, bonus: returnedSeed.bonus + 1 }];
    saveQuotes(changed);
    const loaded = loadQuotes();
    assert.deepEqual(loaded, changed);
    assert.notEqual(loaded, changed);
    assert.notEqual(loaded[0], changed[0]);
    assert.notEqual(loaded[0].pricing, changed[0].pricing);
    assert.notEqual(loaded[0].approvalHistory, changed[0].approvalHistory);

    storage.setItem("quotation-prototype-v2", "not JSON");
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);

    storage.setItem("quotation-prototype-v2", JSON.stringify([{ id: "invalid-schema" }]));
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);

    assert.deepEqual(resetQuotes(), SEEDED_QUOTES);
    assert.equal(storage.getItem("quotation-prototype-v2"), null);
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

test("browser persistence rejects unknown commercial references and snapshot pricing mismatches", () => {
  const storage = new MemoryStorage();
  const approved = SEEDED_QUOTES.find((quote) => quote.status === "approved");
  assert.ok(approved);

  withBrowserStorage(storage, () => {
    saveQuotes([approved]);
    const locked = storage.getItem("quotation-prototype-v2");
    assert.ok(locked);

    const invalidQuotes: Quote[] = [
      { ...approved, customerId: "customer-unknown" },
      { ...approved, brandId: "brand-unknown" },
      { ...approved, placementIds: ["building-unknown"] },
      {
        ...approved,
        versionSnapshots: approved.versionSnapshots.map((snapshot) => ({
          ...snapshot,
          pricing: { ...snapshot.pricing, total: snapshot.pricing.total + 1 },
        })),
      },
    ];

    for (const invalid of invalidQuotes) {
      storage.setItem("quotation-prototype-v2", JSON.stringify([invalid]));
      assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
    }

    storage.setItem("quotation-prototype-v2", locked);
    assert.deepEqual(loadQuotes(), [approved]);
  });
});

test("browser persistence rejects resubmission histories that skip a prior-version return", () => {
  const storage = new MemoryStorage();
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  assert.ok(sales);
  assert.ok(manager);
  const submitted = submitQuote(validQuoteInput(), undefined, sales);
  const returned = returnQuote(submitted, manager, "请补充依据");
  const resubmitted = submitQuote(validQuoteInput({ discount: 60 }), returned, sales);
  const missingReturn = {
    ...resubmitted,
    approvalHistory: resubmitted.approvalHistory.filter((event) => event.action !== "returned"),
  };

  withBrowserStorage(storage, () => {
    saveQuotes([resubmitted]);
    assert.deepEqual(loadQuotes(), [resubmitted]);
    storage.setItem("quotation-prototype-v2", JSON.stringify([missingReturn]));
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
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
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceo);
  const pendingCeo = approveQuote(submitQuote(validQuoteInput({ discount: 75 }), undefined, sales), manager);
  const approved = approveQuote(pendingCeo, ceo);

  withBrowserStorage(storage, () => {
    saveQuotes([approved]);
    assert.deepEqual(loadQuotes(), [approved]);
  });
});

test("50 and 65 percent submissions finish with manager approval while 75 reaches CEO final approval", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceo);

  for (const discount of [50, 65]) {
    const submitted = submitQuote(validQuoteInput({ discount }), undefined, sales);
    const approved = approveQuote(submitted, manager);
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvalHistory.at(-1)?.role, "manager");
  }

  const executiveSubmitted = submitQuote(validQuoteInput({ discount: 75 }), undefined, sales);
  const managerApproved = approveQuote(executiveSubmitted, manager);
  assert.equal(managerApproved.status, "pending_ceo");
  const ceoApproved = approveQuote(managerApproved, ceo);
  assert.equal(ceoApproved.status, "approved");
  assert.deepEqual(
    ceoApproved.approvalHistory.map((event) => [event.role, event.action]),
    [["sales", "submitted"], ["manager", "approved"], ["ceo", "approved"]],
  );
});

test("manager return reason stays in history when sales edits and resubmits", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  assert.ok(sales);
  assert.ok(manager);

  const submitted = submitQuote(validQuoteInput({ discount: 65 }), undefined, sales);
  const returned = returnQuote(submitted, manager, "  请补充商业依据  ");
  const resubmitted = submitQuote(
    validQuoteInput({ discount: 60, bonus: submitted.bonus + 5 }),
    returned,
    sales,
  );

  assert.equal(resubmitted.status, "pending_manager");
  assert.equal(resubmitted.version, 2);
  assert.equal(resubmitted.bonus, submitted.bonus + 5);
  assert.equal(resubmitted.approvalHistory.at(-2)?.comment, "请补充商业依据");
  assert.equal(resubmitted.approvalHistory.at(-1)?.action, "resubmitted");
});

test("CEO return reason stays in history when sales edits and resubmits through manager again", () => {
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceo);

  const submitted = submitQuote(validQuoteInput({ discount: 75 }), undefined, sales);
  const pendingCeo = approveQuote(submitted, manager);
  const returned = returnQuote(pendingCeo, ceo, "请调整高折扣方案");
  const resubmitted = submitQuote(validQuoteInput({ discount: 70 }), returned, sales);

  assert.equal(resubmitted.status, "pending_manager");
  assert.equal(resubmitted.version, 2);
  assert.equal(resubmitted.approvalHistory.at(-2)?.comment, "请调整高折扣方案");
  assert.equal(resubmitted.approvalHistory.at(-1)?.action, "resubmitted");
  assert.equal(approveQuote(resubmitted, manager).status, "approved");
});

test("building and package quotes retain one shared state across role views and storage", () => {
  const storage = new MemoryStorage();
  const sales = USERS.find((user) => user.role === "sales");
  const manager = USERS.find((user) => user.role === "manager");
  const ceo = USERS.find((user) => user.role === "ceo");
  assert.ok(sales);
  assert.ok(manager);
  assert.ok(ceo);

  const buildingQuote = submitQuote(validQuoteInput({ discount: 50 }), undefined, sales);
  const salesPackage = PACKAGES[0];
  const packageInput: QuoteInput = {
    ...validQuoteInput({ discount: 75 }),
    placementMode: "package",
    placementIds: [salesPackage.id],
    basePrice: salesPackage.priceIdr,
    traffic: salesPackage.traffic,
    impressions: salesPackage.impressions,
  };
  assert.deepEqual(
    validateQuoteReferences(packageInput, sales.id, { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES }),
    {},
  );
  const packageQuote = approveQuote(submitQuote(packageInput, undefined, sales), manager);

  withBrowserStorage(storage, () => {
    saveQuotes([buildingQuote, packageQuote]);
    const sharedQuotes = loadQuotes();
    assert.deepEqual(sharedQuotes.map((quote) => quote.placementMode), ["building", "package"]);
    assert.deepEqual(
      quotesForRole(sharedQuotes, sales.role, sales.id).map((quote) => quote.id),
      sharedQuotes.map((quote) => quote.id),
    );
    assert.deepEqual(
      quotesForRole(sharedQuotes, manager.role, manager.id).map((quote) => quote.id),
      sharedQuotes.map((quote) => quote.id),
    );
    assert.deepEqual(quotesForRole(sharedQuotes, ceo.role, ceo.id).map((quote) => quote.id), [packageQuote.id]);
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

function validQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    customerId: "customer-kopi",
    brandId: "brand-kopi-kenangan",
    placementMode: "building",
    placementIds: ["building-pacific-place"],
    weeks: 4,
    spots: 160,
    bonus: 0,
    discount: 50,
    basePrice: BUILDINGS[0].priceIdr,
    traffic: 38_000,
    impressions: 720_000,
    ...overrides,
  };
}

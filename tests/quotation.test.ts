import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, CUSTOMERS, PACKAGES, SEEDED_QUOTES, USERS } from "../lib/mock-data.ts";
import {
  approveQuote,
  calculatePricing,
  canApproveQuote,
  createDraftQuote,
  getApprovalStatus,
  getDiscountBand,
  resolveApprovalRoute,
  returnQuote,
  submitQuote,
  validateQuote,
  validateQuoteReferences,
} from "../lib/quotation.ts";
import { loadQuotes, quotesForRole, resetQuotes, saveQuotes } from "../lib/store.ts";
import type {
  Building,
  CommercialSelection,
  CommercialSelectionInput,
  Customer,
  QuoteInput,
  SalesPackage,
  User,
} from "../lib/types.ts";

const references = { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES };
const sales = USERS.find((user) => user.role === "sales")!;
const manager = USERS.find((user) => user.role === "manager")!;
const businessControl = USERS.find((user) => user.role === "business_control")!;
const ceo = USERS.find((user) => user.role === "ceo")!;
const approvalDirectory = {
  manager: manager.id,
  business_control: businessControl.id,
  ceo: ceo.id,
};

function selection(overrides: Partial<CommercialSelectionInput> = {}): CommercialSelectionInput {
  return {
    mode: "building",
    resourceIds: ["building-pacific-place"],
    tvcDurationSeconds: 15,
    weeks: 4,
    spots: 160,
    grossPrice: 1_000_000_000,
    traffic: 38_000,
    impressions: 720_000,
    ...overrides,
  };
}

function quoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    customerId: "customer-kopi",
    brandId: "brand-kopi-kenangan",
    placement: selection(),
    discount: 65,
    ...overrides,
  };
}

function catalogSelection(
  mode: "building" | "package",
  ids: string[],
  weeks = 4,
  spots = 160,
): CommercialSelection {
  const catalog: Array<Building | SalesPackage> = mode === "building" ? BUILDINGS : PACKAGES;
  const resources = ids.map((id) => catalog.find((resource) => resource.id === id)!);
  return {
    mode,
    resourceIds: ids,
    tvcDurationSeconds: 15,
    weeks,
    spots,
    grossPrice: Math.round(resources.reduce((sum, resource) => sum + resource.priceIdr, 0) * (weeks / 4)),
    traffic: resources.reduce((sum, resource) => sum + resource.traffic, 0),
    impressions: resources.reduce((sum, resource) => sum + resource.impressions, 0),
  };
}

function catalogQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return quoteInput({ placement: catalogSelection("building", [BUILDINGS[0].id]), ...overrides });
}

test("discount and direct-approval boundaries are 65 and 75 percent", () => {
  assert.equal(getDiscountBand(65), "standard");
  assert.equal(getDiscountBand(65.000001), "elevated");
  assert.equal(getDiscountBand(75), "elevated");
  assert.equal(getDiscountBand(75.000001), "executive");
  assert.equal(getApprovalStatus(65), "pending_manager");
  assert.equal(getApprovalStatus(65.000001), "pending_business_control");
  assert.equal(getApprovalStatus(75), "pending_business_control");
  assert.equal(getApprovalStatus(75.000001), "pending_ceo");
});

test("Ayu's own low-discount quotation routes to April instead of self-approval", () => {
  assert.deepEqual(resolveApprovalRoute(50, manager.id, approvalDirectory), {
    status: "pending_business_control",
    approverRole: "business_control",
    requiredApproverId: businessControl.id,
  });
});

test("an authorized proxy submission preserves creator and commercial owner identities", () => {
  const freelancerId = "sales-freelancer-demo";
  const proxy: User = {
    id: "sales-amal",
    name: "Amal",
    role: "sales",
    title: "Sales Controller",
    salesGroup: "freelancer",
    canCreateOnBehalfOfSalesIds: [freelancerId],
    isDemoData: true,
  };
  const customer: Customer = {
    ...CUSTOMERS[0],
    id: "customer-freelancer-demo",
    salesId: freelancerId,
    brands: [{ ...CUSTOMERS[0].brands[0], id: "brand-freelancer-demo" }],
  };
  const proxyReferences = { ...references, customers: [...CUSTOMERS, customer] };
  const submitted = submitQuote({
    ...catalogQuoteInput(),
    customerId: customer.id,
    brandId: customer.brands[0].id,
    salesOwnerId: freelancerId,
  }, undefined, proxy, proxyReferences, approvalDirectory);

  assert.equal(submitted.salesId, freelancerId);
  assert.equal(submitted.createdById, proxy.id);
  assert.equal(submitted.approvalHistory[0].actorId, proxy.id);
});

test("a sales user cannot submit on behalf of an owner outside the explicit proxy allow-list", () => {
  assert.throws(() => submitQuote({
    ...catalogQuoteInput(),
    salesOwnerId: "sales-freelancer-demo",
  }, undefined, sales, references, approvalDirectory), /quotation\.submit\.ownerForbidden/);
});

test("approval routing rejects invalid effective discount rates", () => {
  for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 100.1]) {
    assert.throws(() => getApprovalStatus(rate), /validation\.effectiveDiscountRateRange/);
  }
});

test("pricing discounts placement, makes bonus free, and calculates IDR totals", () => {
  assert.deepEqual(calculatePricing(quoteInput({
    placement: selection({ grossPrice: 100_000 }),
    bonus: selection({ grossPrice: 20_000 }),
    discount: 25,
  })), {
    placementGross: 100_000,
    placementDiscountAmount: 25_000,
    placementNet: 75_000,
    bonusGross: 20_000,
    bonusNet: 0,
    totalGross: 120_000,
    totalNet: 75_000,
    effectiveDiscountAmount: 45_000,
    effectiveDiscountRate: 37.5,
    tax: 4_500,
    totalIncludingTax: 79_500,
  });
});

test("omitting bonus is valid and keeps bonus values at zero", () => {
  assert.deepEqual(validateQuote(quoteInput({ bonus: undefined })), {});
  assert.equal(calculatePricing(quoteInput()).bonusGross, 0);
  assert.equal(calculatePricing(quoteInput()).bonusNet, 0);
});

test("nested placement and enabled bonus validate independently", () => {
  const errors = validateQuote(quoteInput({
    placement: selection({ mode: undefined, resourceIds: [], weeks: 0, grossPrice: Number.NaN }),
    bonus: selection({ resourceIds: [], spots: 0, traffic: -1, impressions: 1.5 }),
  }));
  assert.equal(errors["placement.mode"], "validation.placementModeRequired");
  assert.equal(errors["placement.resourceIds"], "validation.placementRequired");
  assert.equal(errors["placement.weeks"], "validation.weeksPositiveInteger");
  assert.equal(errors["placement.grossPrice"], "validation.grossPriceFiniteNonnegative");
  assert.equal(errors["bonus.resourceIds"], "validation.placementRequired");
  assert.equal(errors["bonus.spots"], "validation.spotsPositiveInteger");
  assert.equal(errors["bonus.traffic"], "validation.trafficNonnegativeInteger");
  assert.equal(errors["bonus.impressions"], "validation.impressionsNonnegativeInteger");
});

test("pricing rejects unsafe integer IDR amounts", () => {
  assert.equal(
    validateQuote(quoteInput({ placement: selection({ grossPrice: Number.MAX_SAFE_INTEGER + 1 }) }))["placement.grossPrice"],
    "validation.grossPriceFiniteNonnegative",
  );
  assert.throws(() => calculatePricing(quoteInput({
    placement: selection({ grossPrice: Number.MAX_SAFE_INTEGER }),
    bonus: selection({ grossPrice: 1 }),
    discount: 0,
  })), /validation\.pricingUnsafeInteger/);
});

test("placement and bonus references validate independently with four-week scaling", () => {
  const input = catalogQuoteInput({
    placement: catalogSelection("building", [BUILDINGS[0].id, BUILDINGS[1].id], 2),
    bonus: catalogSelection("package", [PACKAGES[0].id], 6),
  });
  assert.deepEqual(validateQuoteReferences(input, sales.id, references), {});
});

test("each package selection contains exactly one package", () => {
  const errors = validateQuoteReferences(quoteInput({
    placement: selection({ mode: "package", resourceIds: [PACKAGES[0].id, PACKAGES[1].id] }),
    bonus: selection({ mode: "package", resourceIds: [BUILDINGS[0].id] }),
  }), sales.id, references);
  assert.equal(errors["placement.resourceIds"], "validation.resourceModeMismatch");
  assert.equal(errors["bonus.resourceIds"], "validation.resourceModeMismatch");
});

test("reference validation rejects ownership, brand, and forged gross prices", () => {
  assert.equal(validateQuoteReferences(catalogQuoteInput(), "unknown-sales", references).customerId, "validation.customerOwned");
  assert.equal(
    validateQuoteReferences(catalogQuoteInput({ brandId: "brand-traveloka" }), sales.id, references).brandId,
    "validation.brandBelongsToCustomer",
  );
  const errors = validateQuoteReferences(catalogQuoteInput({
    placement: { ...catalogSelection("building", [BUILDINGS[0].id]), grossPrice: 1 },
    bonus: { ...catalogSelection("building", [BUILDINGS[1].id]), grossPrice: 2 },
  }), sales.id, references);
  assert.equal(errors["placement.grossPrice"], "validation.basePriceMismatch");
  assert.equal(errors["bonus.grossPrice"], "validation.basePriceMismatch");
});

test("reference validation rejects forged catalog traffic and impressions", () => {
  const errors = validateQuoteReferences(catalogQuoteInput({
    placement: { ...catalogSelection("building", [BUILDINGS[0].id]), traffic: 1 },
    bonus: { ...catalogSelection("package", [PACKAGES[0].id]), impressions: 2 },
  }), sales.id, references);
  assert.equal(errors["placement.traffic"], "validation.trafficMismatch");
  assert.equal(errors["bonus.impressions"], "validation.impressionsMismatch");

  assert.throws(() => submitQuote(catalogQuoteInput({
    placement: { ...catalogSelection("building", [BUILDINGS[0].id]), impressions: 3 },
  }), undefined, sales, references, approvalDirectory), /validation\.impressionsMismatch/);
});

test("submission snapshots both sections and routes from effective discount", () => {
  const input = catalogQuoteInput({
    discount: 55,
    placement: catalogSelection("package", [PACKAGES[0].id]),
    bonus: catalogSelection("building", [BUILDINGS[1].id]),
  });
  const submitted = submitQuote(input, undefined, sales, references, approvalDirectory);
  assert.equal(submitted.status, "pending_business_control");
  assert.equal(submitted.requiredApproverId, businessControl.id);
  assert.equal(submitted.versionSnapshots[0].requiredApproverId, businessControl.id);
  assert.deepEqual(submitted.versionSnapshots[0].placement, input.placement);
  assert.deepEqual(submitted.versionSnapshots[0].bonus, input.bonus);
  assert.deepEqual(submitted.versionSnapshots[0].pricing, submitted.pricing);
  assert.notEqual(submitted.versionSnapshots[0].placement, submitted.placement);
});

test("submission rejects unknown or role-mismatched approval directory identities", () => {
  assert.throws(() => submitQuote(
    catalogQuoteInput({ discount: 50 }),
    undefined,
    sales,
    references,
    { ...approvalDirectory, manager: "manager-unknown" },
  ), /quotation\.approval\.stageRequired/);
  assert.throws(() => submitQuote(
    catalogQuoteInput({ discount: 50 }),
    undefined,
    sales,
    references,
    { ...approvalDirectory, manager: businessControl.id },
  ), /quotation\.approval\.stageRequired/);
  assert.throws(() => submitQuote(
    catalogQuoteInput({ discount: 65, bonus: catalogSelection("building", [BUILDINGS[1].id]) }),
    undefined,
    sales,
    references,
    { ...approvalDirectory, ceo: businessControl.id },
  ), /quotation\.approval\.stageRequired/);
});

test("all three approvers act only on their direct queue and approval is final", () => {
  const cases = [
    [catalogQuoteInput({ discount: 50 }), manager],
    [catalogQuoteInput({ discount: 43, bonus: catalogSelection("building", [BUILDINGS[1].id]) }), businessControl],
    [catalogQuoteInput({ discount: 65, bonus: catalogSelection("building", [BUILDINGS[1].id]) }), ceo],
  ] as const;
  for (const [input, approver] of cases) {
    const pending = submitQuote(input, undefined, sales, references, approvalDirectory);
    assert.equal(canApproveQuote(pending, approver), true);
    for (const other of [manager, businessControl, ceo]) {
      if (other.id !== approver.id) assert.equal(canApproveQuote(pending, other), false);
    }
    const approved = approveQuote(pending, approver);
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvedAt, approved.updatedAt);
    assert.equal(approved.approvalHistory.length, 2);
  }
});

test("a direct approver returns once with a required trimmed reason", () => {
  const pending = SEEDED_QUOTES.find((quote) => quote.status === "pending_business_control")!;
  assert.throws(() => returnQuote(pending, businessControl, "  "), /validation\.returnReasonRequired/);
  const returned = returnQuote(pending, businessControl, "  Please revise  ");
  assert.equal(returned.status, "returned");
  assert.equal(returned.approvalHistory.at(-1)?.comment, "Please revise");
  assert.equal(canApproveQuote(returned, businessControl), false);
});

test("wrong roles and wrong stages cannot approve or return", () => {
  const pending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo")!;
  assert.throws(() => approveQuote(pending, manager), /quotation\.approval\.stageRequired/);
  assert.throws(() => approveQuote(pending, sales), /quotation\.approval\.roleRequired/);
  assert.throws(() => returnQuote(pending, businessControl, "No"), /quotation\.approval\.stageRequired/);
});

test("approval and return do not mutate source commercial snapshots", () => {
  const pendingManager = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager")!;
  const pendingCeo = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo")!;
  const managerSource = structuredClone(pendingManager);
  const ceoSource = structuredClone(pendingCeo);
  approveQuote(pendingManager, manager);
  returnQuote(pendingCeo, ceo, "Revise");
  assert.deepEqual(pendingManager, managerSource);
  assert.deepEqual(pendingCeo, ceoSource);
});

test("resubmission keeps V1 immutable and reroutes V2", () => {
  const submitted = submitQuote(catalogQuoteInput({ discount: 50 }), undefined, sales, references, approvalDirectory);
  const returned = returnQuote(submitted, manager, "Add bonus");
  const lockedV1 = structuredClone(returned.versionSnapshots[0]);
  const resubmitted = submitQuote(catalogQuoteInput({
    discount: 65,
    placement: catalogSelection("building", [BUILDINGS[0].id]),
    bonus: catalogSelection("building", [BUILDINGS[1].id]),
  }), returned, sales, references, approvalDirectory);
  assert.equal(resubmitted.version, 2);
  assert.equal(resubmitted.status, "pending_ceo");
  assert.deepEqual(resubmitted.versionSnapshots[0], lockedV1);
  assert.deepEqual(returned.versionSnapshots[0], lockedV1);
  assert.equal(resubmitted.approvalHistory.at(-1)?.action, "resubmitted");
});

test("an incomplete draft normalizes unsafe fields and persists safely", () => {
  const draft = createDraftQuote({
    customerId: "",
    brandId: "",
    placement: { mode: "package", resourceIds: [], weeks: Number.NaN, spots: Number.POSITIVE_INFINITY, grossPrice: -1 },
    discount: Number.NaN,
  }, undefined, sales);
  assert.equal(draft.placement?.weeks, 0);
  assert.equal(draft.placement?.spots, 0);
  assert.equal(draft.placement?.grossPrice, 0);
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes([draft]);
    assert.deepEqual(persistedShape(loadQuotes()), persistedShape([draft]));
  });
});

test("a completely empty early-step draft persists safely", () => {
  const draft = createDraftQuote({ discount: 0 }, undefined, sales);
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes([draft]);
    assert.deepEqual(persistedShape(loadQuotes()), persistedShape([draft]));
  });
});

test("role visibility is server-shaped for sales, manager, Business Control, and CEO", () => {
  assert.ok(quotesForRole(SEEDED_QUOTES, "sales", sales.id).every((quote) => quote.salesId === sales.id));
  assert.ok(quotesForRole(SEEDED_QUOTES, "manager", manager.id).every((quote) => quote.salesId === sales.id));
  assert.deepEqual(
    quotesForRole(SEEDED_QUOTES, "business_control", businessControl.id).map((quote) => quote.status),
    ["pending_business_control"],
  );
  assert.deepEqual(quotesForRole(SEEDED_QUOTES, "ceo", ceo.id).map((quote) => quote.status), ["pending_ceo"]);
  assert.deepEqual(quotesForRole(SEEDED_QUOTES, "manager", "unknown"), []);
});

test("quotation creators retain access to their own or proxy-entered quotations", () => {
  const freelancer = USERS.find((user) => user.id === "sales-freelancer-demo")!;
  const proxy = USERS.find((user) => user.id === "sales-amal")!;
  const managerOwned = {
    ...SEEDED_QUOTES[0],
    id: "quote-manager-owned",
    salesId: manager.id,
    createdById: manager.id,
    status: "pending_business_control" as const,
    requiredApproverId: businessControl.id,
  };
  const proxyEntered = {
    ...SEEDED_QUOTES[0],
    id: "quote-proxy-entered",
    salesId: freelancer.id,
    createdById: proxy.id,
  };

  assert.deepEqual(
    quotesForRole([managerOwned], manager.role, manager.id).map((quote) => quote.id),
    [managerOwned.id],
  );
  assert.deepEqual(
    quotesForRole([proxyEntered], proxy.role, proxy.id).map((quote) => quote.id),
    [proxyEntered.id],
  );
  assert.deepEqual(
    quotesForRole([proxyEntered], freelancer.role, freelancer.id).map((quote) => quote.id),
    [proxyEntered.id],
  );
});

test("every approver queue is isolated by assigned identity and manager team", () => {
  const pendingManager = SEEDED_QUOTES.find((quote) => quote.status === "pending_manager")!;
  const pendingBusinessControl = SEEDED_QUOTES.find((quote) => quote.status === "pending_business_control")!;
  const pendingCeo = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo")!;

  assert.deepEqual(quotesForRole([
    { ...pendingManager, requiredApproverId: "manager-other" },
  ], "manager", manager.id), []);
  assert.deepEqual(quotesForRole([
    { ...pendingManager, salesId: "sales-outside-team" },
  ], "manager", manager.id), []);
  assert.deepEqual(quotesForRole([
    { ...pendingBusinessControl, requiredApproverId: "business-control-other" },
  ], "business_control", businessControl.id), []);
  assert.deepEqual(quotesForRole([
    { ...pendingCeo, requiredApproverId: "ceo-other" },
  ], "ceo", ceo.id), []);
});

test("seed data covers all direct workflow states with catalog-backed snapshots", () => {
  assert.deepEqual(new Set(SEEDED_QUOTES.map((quote) => quote.status)), new Set([
    "returned", "pending_manager", "pending_business_control", "pending_ceo", "approved",
  ]));
  for (const quote of SEEDED_QUOTES) {
    assert.deepEqual(validateQuoteReferences({
      customerId: quote.customerId,
      brandId: quote.brandId,
      placement: quote.versionSnapshots[0].placement,
      bonus: quote.versionSnapshots[0].bonus,
      discount: quote.discount,
    }, quote.salesId, references), {});
  }
});

test("v3 storage round-trips valid nested quotes and returns deep clones", () => {
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes(SEEDED_QUOTES);
    const loaded = loadQuotes();
    assert.deepEqual(persistedShape(loaded), persistedShape(SEEDED_QUOTES));
    assert.notEqual(loaded, SEEDED_QUOTES);
    assert.notEqual(loaded[0].versionSnapshots[0], SEEDED_QUOTES[0].versionSnapshots[0]);
  });
});

test("v3 loading ignores legacy v2 data", () => {
  const storage = new MemoryStorage();
  storage.setItem("quotation-prototype-v2", JSON.stringify([{ legacy: true }]));
  withBrowserStorage(storage, () => {
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
    assert.equal(storage.getItem("quotation-prototype-v3"), null);
  });
});

test("persistence rejects forged refs, pricing, route, actors, and flat legacy records", () => {
  const pending = SEEDED_QUOTES.find((quote) => quote.status === "pending_ceo")!;
  const forged: unknown[] = [
    { ...pending, placement: { ...pending.placement, resourceIds: ["building-unknown"] } },
    { ...pending, pricing: { ...pending.pricing, totalIncludingTax: pending.pricing.totalIncludingTax + 1 } },
    { ...pending, status: "pending_manager" },
    { ...pending, approvalHistory: pending.approvalHistory.map((event) => ({ ...event, actorId: "forged" })) },
    { ...pending, placement: undefined, placementMode: "building", placementIds: [BUILDINGS[0].id] },
  ];
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    for (const quote of forged) {
      storage.setItem("quotation-prototype-v3", JSON.stringify([quote]));
      assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
    }
  });
});

test("persistence rejects missing prior return and mismatched approvedAt", () => {
  const returned = returnQuote(submitQuote(catalogQuoteInput({ discount: 50 }), undefined, sales, references, approvalDirectory), manager, "Revise");
  const v2 = submitQuote(catalogQuoteInput({ discount: 50 }), returned, sales, references, approvalDirectory);
  const missingReturn = { ...v2, approvalHistory: v2.approvalHistory.filter((event) => event.action !== "returned") };
  const approved = approveQuote(v2, manager);
  const wrongApprovedAt = { ...approved, approvedAt: new Date(Date.parse(approved.approvedAt!) + 1_000).toISOString() };
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    for (const quote of [missingReturn, wrongApprovedAt]) {
      storage.setItem("quotation-prototype-v3", JSON.stringify([quote]));
      assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
    }
  });
});

test("generated direct approval and return workflows survive v3 validation", () => {
  const generated = [
    approveQuote(submitQuote(catalogQuoteInput({ discount: 50 }), undefined, sales, references, approvalDirectory), manager),
    returnQuote(submitQuote(catalogQuoteInput({
      discount: 43,
      placement: catalogSelection("building", [BUILDINGS[0].id]),
      bonus: catalogSelection("building", [BUILDINGS[1].id]),
    }), undefined, sales, references, approvalDirectory), businessControl, "Revise"),
    approveQuote(submitQuote(catalogQuoteInput({
      discount: 65,
      placement: catalogSelection("building", [BUILDINGS[0].id]),
      bonus: catalogSelection("building", [BUILDINGS[1].id]),
    }), undefined, sales, references, approvalDirectory), ceo),
  ];
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes(generated);
    assert.deepEqual(persistedShape(loadQuotes()), persistedShape(generated));
  });
});

test("submission cannot bypass ownership and catalog reference validation", () => {
  assert.throws(() => submitQuote(
    catalogQuoteInput({ customerId: "customer-unknown", brandId: "brand-forged" }),
    undefined,
    sales,
    references,
    approvalDirectory,
  ), /validation\.customerOwned/);
  assert.throws(() => submitQuote(
    catalogQuoteInput({
      placement: { ...catalogSelection("building", [BUILDINGS[0].id]), grossPrice: 1 },
    }),
    undefined,
    sales,
    references,
    approvalDirectory,
  ), /validation\.basePriceMismatch/);
});

test("only the configured approver identity may approve or return a pending quote", () => {
  const pending = submitQuote(catalogQuoteInput({ discount: 50 }), undefined, sales, references, approvalDirectory);
  const forgedManager = { ...manager, id: "manager-forged" };
  assert.equal(canApproveQuote(pending, forgedManager), false);
  assert.throws(() => approveQuote(pending, forgedManager), /quotation\.approval\.stageRequired/);
  assert.throws(() => returnQuote(pending, forgedManager, "forged"), /quotation\.approval\.stageRequired/);
});

test("an incomplete draft with an unknown customer fails closed in persistence", () => {
  const forgedDraft = createDraftQuote({ customerId: "customer-unknown", brandId: "", discount: 0 }, undefined, sales);
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    storage.setItem("quotation-prototype-v3", JSON.stringify([forgedDraft]));
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
  });
});

test("persistence rejects globally reordered approval history", () => {
  const returned = returnQuote(
    submitQuote(catalogQuoteInput({ discount: 50 }), undefined, sales, references, approvalDirectory),
    manager,
    "Revise",
  );
  const v2 = submitQuote(catalogQuoteInput({ discount: 50 }), returned, sales, references, approvalDirectory);
  const reordered = {
    ...v2,
    approvalHistory: [v2.approvalHistory[0], v2.approvalHistory[2], v2.approvalHistory[1]],
  };
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    storage.setItem("quotation-prototype-v3", JSON.stringify([reordered]));
    assert.deepEqual(loadQuotes(), SEEDED_QUOTES);
  });
});

test("reset removes only v3 state and returns fresh seeds", () => {
  const storage = new MemoryStorage();
  withBrowserStorage(storage, () => {
    saveQuotes([SEEDED_QUOTES[0]]);
    assert.deepEqual(resetQuotes(), SEEDED_QUOTES);
    assert.equal(storage.getItem("quotation-prototype-v3"), null);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function persistedShape<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withBrowserStorage<T>(storage: Storage, callback: () => T): T {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    return callback();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

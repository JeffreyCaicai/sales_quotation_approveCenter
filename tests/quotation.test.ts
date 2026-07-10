import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, CUSTOMERS, PACKAGES, SEEDED_QUOTES, USERS } from "../lib/mock-data.ts";
import { calculatePricing, getDiscountBand, getNextApproval, validateQuote } from "../lib/quotation.ts";
import { loadQuotes, quotesForRole, resetQuotes, saveQuotes } from "../lib/store.ts";
import type { Quote } from "../lib/types.ts";

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

  withBrowserStorage(storage, () => {
    const changed = [{ ...SEEDED_QUOTES[0], status: "approved" as const }];
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

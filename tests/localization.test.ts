import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatDate,
  formatMoney,
  formatNumber,
  loadLocale,
  saveLocale,
  translate,
  translations,
} from "../lib/i18n.ts";
import { resetQuotes } from "../lib/store.ts";
import * as quotationDomain from "../lib/quotation.ts";

test("English is the default when storage is unavailable or empty", () => {
  assert.equal(loadLocale(), "en");

  withStorage(new MemoryStorage(), () => {
    assert.equal(loadLocale(), "en");
  });
});

test("the preference restoration helper returns valid stored Chinese", () => {
  const storage = new MemoryStorage();
  storage.setItem("quotation-locale-v1", "zh-CN");

  withStorage(storage, () => assert.equal(loadLocale(), "zh-CN"));
});

test("the provider renders deterministic English before restoring storage after mount", () => {
  const providerSource = readFileSync(
    new URL("../components/locale-provider.tsx", import.meta.url),
    "utf8",
  );

  assert.match(providerSource, /useState<Locale>\("en"\)/);
  assert.doesNotMatch(providerSource, /useState<Locale>\(loadLocale\)/);
  assert.match(
    providerSource,
    /useEffect\(\(\) => \{\s*const storedLocale = loadLocale\(\);\s*setLocaleState\(\(currentLocale\) => currentLocale === storedLocale \? currentLocale : storedLocale\);\s*}, \[\]\);/,
  );
  assert.equal(providerSource.match(/\bsaveLocale\(/g)?.length, 1);
  assert.match(
    providerSource,
    /useCallback\(\(nextLocale: Locale\) => \{\s*setLocaleState\(nextLocale\);\s*saveLocale\(nextLocale\);/,
  );
});

test("invalid and inaccessible stored preferences fall back to English", () => {
  const invalid = new MemoryStorage();
  invalid.setItem("quotation-locale-v1", "fr");
  withStorage(invalid, () => assert.equal(loadLocale(), "en"));

  withWindow({
    get localStorage(): Storage {
      throw new Error("blocked");
    },
  }, () => assert.equal(loadLocale(), "en"));
});

test("English and Chinese dictionaries have identical string leaf keys", () => {
  const englishLeaves = dictionaryLeaves(translations.en);
  const chineseLeaves = dictionaryLeaves(translations["zh-CN"]);

  assert.deepEqual(Object.keys(chineseLeaves).sort(), Object.keys(englishLeaves).sort());
  assert.ok(Object.values(englishLeaves).every((value) => typeof value === "string"));
  assert.ok(Object.values(chineseLeaves).every((value) => typeof value === "string"));
});

test("translation interpolation is deterministic and preserves unknown variables", () => {
  assert.equal(
    translate("en", "test.greeting", { name: "Ari", count: 2 }),
    "Hello, Ari. You have 2 quotations.",
  );
  assert.equal(
    translate("en", "test.greeting", { name: "Ari" }),
    "Hello, Ari. You have {count} quotations.",
  );
});

test("money, numbers, and dates use the active locale", () => {
  const date = new Date("2026-07-10T12:00:00.000Z");

  assert.equal(formatMoney("en", 123456.78), new Intl.NumberFormat("en", {
    style: "currency",
    currency: "CNY",
  }).format(123456.78));
  assert.equal(formatMoney("zh-CN", 123456.78), new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(123456.78));
  assert.equal(formatNumber("en", 123456.78), new Intl.NumberFormat("en").format(123456.78));
  assert.equal(formatNumber("zh-CN", 123456.78), new Intl.NumberFormat("zh-CN").format(123456.78));
  assert.equal(formatDate("en", date), new Intl.DateTimeFormat("en").format(date));
  assert.equal(formatDate("zh-CN", date), new Intl.DateTimeFormat("zh-CN").format(date));
});

test("quotation workflow dictionaries cover validation, decisions, versions, and print", () => {
  const requiredKeys = [
    "validation.customerRequired",
    "validation.brandRequired",
    "validation.placementModeRequired",
    "validation.placementRequired",
    "validation.weeksPositiveInteger",
    "validation.spotsPositiveInteger",
    "validation.bonusNonnegativeInteger",
    "validation.discountRange",
    "validation.basePriceFiniteNonnegative",
    "validation.taxRateFiniteNonnegative",
    "validation.trafficNonnegativeInteger",
    "validation.impressionsNonnegativeInteger",
    "validation.customerOwned",
    "validation.brandBelongsToCustomer",
    "validation.resourceModeMismatch",
    "validation.basePriceMismatch",
    "validation.returnReasonRequired",
    "wizard.stepCustomer",
    "wizard.stepMode",
    "wizard.stepResources",
    "wizard.stepParameters",
    "wizard.stepDiscount",
    "wizard.stepReview",
    "wizard.livePricing",
    "wizard.approvalPath",
    "approval.approve",
    "approval.return",
    "approval.actionSubmitted",
    "approval.actionResubmitted",
    "approval.actionApproved",
    "approval.actionReturned",
    "progress.latestReturnReason",
    "progress.approved",
    "progress.backToWorkspace",
    "progress.backToQuotation",
    "history.versionHistory",
    "history.commercialSnapshot",
    "history.approvalTimeline",
    "quotation.title",
    "quotation.quoteNumber",
    "quotation.issueDate",
    "quotation.clientAndBrand",
    "quotation.priceDetails",
    "quotation.terms",
    "quotation.appendix",
    "quotation.approvalRecord",
    "quotation.print",
    "commercial.spot",
    "commercial.bonus",
    "commercial.rateCard",
  ] as const;
  const englishLeaves = dictionaryLeaves(translations.en);
  const chineseLeaves = dictionaryLeaves(translations["zh-CN"]);

  for (const key of requiredKeys) {
    assert.equal(typeof englishLeaves[key], "string", `English is missing ${key}`);
    assert.equal(typeof chineseLeaves[key], "string", `Chinese is missing ${key}`);
    assert.notEqual(englishLeaves[key], "", `English ${key} is empty`);
    assert.notEqual(chineseLeaves[key], "", `Chinese ${key} is empty`);
  }
});

test("every exported domain validation key exists in both dictionaries", () => {
  const validationKeys = (quotationDomain as unknown as Record<string, unknown>).VALIDATION_KEYS;
  assert.ok(Array.isArray(validationKeys), "quotation domain must export VALIDATION_KEYS");
  const englishLeaves = dictionaryLeaves(translations.en);
  const chineseLeaves = dictionaryLeaves(translations["zh-CN"]);

  for (const key of validationKeys) {
    assert.equal(typeof key, "string");
    assert.equal(typeof englishLeaves[key], "string", `English is missing ${key}`);
    assert.equal(typeof chineseLeaves[key], "string", `Chinese is missing ${key}`);
  }
});

test("quotation workflow components render copy through the locale context", () => {
  const componentNames = [
    "quote-wizard.tsx",
    "approval-screen.tsx",
    "quote-progress-screen.tsx",
    "quote-version-history.tsx",
    "quotation-screen.tsx",
  ];

  for (const componentName of componentNames) {
    const source = readFileSync(new URL(`../components/${componentName}`, import.meta.url), "utf8");
    assert.match(source, /useLocale\(\)/, `${componentName} must subscribe to locale changes`);
    assert.doesNotMatch(source, /[\u3400-\u9fff]/, `${componentName} contains untranslated UI copy`);
    assert.doesNotMatch(
      source,
      /(?:label=")?(?:Spot|Bonus|Rate Card)(?:"|\s*<|\s*\{|\s*$)|}\s*(?:Spot|Bonus)\b|>\s*Rate Card\b/m,
      `${componentName} contains a raw commercial label`,
    );
  }
});

test("English-first metadata contains no Chinese default copy", () => {
  const metadataSources = [
    "../app/layout.tsx",
    "../app/page.tsx",
  ];

  for (const sourcePath of metadataSources) {
    const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /[\u3400-\u9fff]/, `${sourcePath} contains Chinese default metadata`);
  }
});

test("domain and persistence guards contain no locale-bound error copy", () => {
  const quotationDomain = readFileSync(new URL("../lib/quotation.ts", import.meta.url), "utf8");
  const quotationApp = readFileSync(new URL("../components/quotation-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(quotationDomain, /[\u3400-\u9fff]|；/, "quotation domain contains locale-bound error copy");
  assert.doesNotMatch(quotationApp, /；/, "quotation app joins stable validation keys with locale-bound punctuation");
});

test("approved progress takes precedence over prior returns and pending fallbacks", () => {
  const source = readFileSync(new URL("../components/quote-progress-screen.tsx", import.meta.url), "utf8");

  assert.match(source, /const isApproved = quote\.status === "approved"/);
  assert.match(source, /\{isApproved \? \([\s\S]*?t\("progress\.approved"\)[\s\S]*?\) : latestReturn \? \(/);
  assert.doesNotMatch(source, /quote\.status === "pending_ceo" \? "progress\.waitingCeo" : "progress\.waitingManager"/);
});

test("return reason errors retain a key so an open dialog follows locale changes", () => {
  const source = readFileSync(new URL("../components/approval-screen.tsx", import.meta.url), "utf8");

  assert.match(source, /useState<TranslationKey \| null>\(null\)/);
  assert.match(source, /setReasonError\("validation\.returnReasonRequired"\)/);
  assert.match(source, /reasonError \? [\s\S]*?\{t\(reasonError\)\}[\s\S]*? : null/);
  assert.doesNotMatch(source, /setReasonError\(t\(/);
});

test("resetting quotation data does not remove the locale preference", () => {
  const storage = new MemoryStorage();

  withStorage(storage, () => {
    saveLocale("zh-CN");
    storage.setItem("quotation-prototype-v1", "stored quotation data");
    resetQuotes();

    assert.equal(loadLocale(), "zh-CN");
    assert.equal(storage.getItem("quotation-prototype-v1"), null);
  });
});

function dictionaryLeaves(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  assert.ok(value && typeof value === "object" && !Array.isArray(value));

  return Object.entries(value).reduce<Record<string, string>>((leaves, [key, child]) => ({
    ...leaves,
    ...dictionaryLeaves(child, prefix ? `${prefix}.${key}` : key),
  }), {});
}

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  key(index: number) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string) { this.#values.delete(key); }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}

function withStorage(storage: Storage, callback: () => void) {
  withWindow({ localStorage: storage }, callback);
}

function withWindow(value: { readonly localStorage: Storage }, callback: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  try {
    callback();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

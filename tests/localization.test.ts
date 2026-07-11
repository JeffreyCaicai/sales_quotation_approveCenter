import assert from "node:assert/strict";
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

test("English is the default when storage is unavailable or empty", () => {
  assert.equal(loadLocale(), "en");

  withStorage(new MemoryStorage(), () => {
    assert.equal(loadLocale(), "en");
  });
});

test("valid stored Chinese is restored", () => {
  const storage = new MemoryStorage();
  storage.setItem("quotation-locale-v1", "zh-CN");

  withStorage(storage, () => assert.equal(loadLocale(), "zh-CN"));
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

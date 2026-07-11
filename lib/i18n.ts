export type Locale = "en" | "zh-CN";

const LOCALE_STORAGE_KEY = "quotation-locale-v1";

interface Dictionary {
  language: {
    label: string;
    english: string;
    simplifiedChinese: string;
  };
  test: {
    greeting: string;
  };
}

export const translations: Record<Locale, Dictionary> = {
  en: {
    language: {
      label: "Language",
      english: "English",
      simplifiedChinese: "简体中文",
    },
    test: {
      greeting: "Hello, {name}. You have {count} quotations.",
    },
  },
  "zh-CN": {
    language: {
      label: "语言",
      english: "English",
      simplifiedChinese: "简体中文",
    },
    test: {
      greeting: "你好，{name}。你有 {count} 份报价。",
    },
  },
};

export type TranslationKey = {
  [Section in keyof Dictionary]: {
    [Key in keyof Dictionary[Section]]: `${Section & string}.${Key & string}`;
  }[keyof Dictionary[Section]];
}[keyof Dictionary];

export type TranslationVariables = Record<string, string | number>;

export function translate(
  locale: Locale,
  key: TranslationKey,
  variables: TranslationVariables = {},
): string {
  const [section, entry] = key.split(".") as [keyof Dictionary, string];
  const template = (translations[locale][section] as Record<string, string>)[entry];

  return template.replace(/\{([\w.-]+)\}/g, (placeholder, variable: string) => (
    Object.prototype.hasOwnProperty.call(variables, variable)
      ? String(variables[variable])
      : placeholder
  ));
}

export function formatMoney(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
  }).format(value);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(locale: Locale, value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale).format(date);
}

export function loadLocale(): Locale {
  const storage = getStorage();
  if (!storage) return "en";

  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

export function saveLocale(locale: Locale): void {
  try {
    getStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale persistence is best-effort when browser storage is unavailable.
  }
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

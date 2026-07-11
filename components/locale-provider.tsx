"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  formatDate as formatLocalizedDate,
  formatMoney as formatLocalizedMoney,
  formatNumber as formatLocalizedNumber,
  loadLocale,
  saveLocale,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationVariables,
} from "@/lib/i18n";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, variables?: TranslationVariables) => string;
  formatMoney: (value: number) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: Date | number | string) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    saveLocale(nextLocale);
  }, []);
  const t = useCallback(
    (key: TranslationKey, variables?: TranslationVariables) => translate(locale, key, variables),
    [locale],
  );
  const formatMoney = useCallback((value: number) => formatLocalizedMoney(locale, value), [locale]);
  const formatNumber = useCallback((value: number) => formatLocalizedNumber(locale, value), [locale]);
  const formatDate = useCallback(
    (value: Date | number | string) => formatLocalizedDate(locale, value),
    [locale],
  );
  const value = useMemo(() => ({
    locale,
    setLocale,
    t,
    formatMoney,
    formatNumber,
    formatDate,
  }), [locale, setLocale, t, formatMoney, formatNumber, formatDate]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}

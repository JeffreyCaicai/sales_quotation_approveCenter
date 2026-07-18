"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  readPersistedAdminLocale,
  translateAdmin,
  writePersistedAdminLocale,
  type AdminLocale,
  type AdminTranslate,
} from "@/lib/admin-i18n";

interface AdminLocaleValue {
  locale: AdminLocale;
  setLocale(locale: AdminLocale): void;
  t: AdminTranslate;
}

const AdminLocaleContext = createContext<AdminLocaleValue | null>(null);

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminLocale>("en");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setLocaleState(readPersistedAdminLocale(window.localStorage));
    });
    return () => { active = false; };
  }, []);

  const setLocale = useCallback((nextLocale: AdminLocale) => {
    setLocaleState(nextLocale);
    writePersistedAdminLocale(window.localStorage, nextLocale);
  }, []);

  const value = useMemo<AdminLocaleValue>(() => ({
    locale,
    setLocale,
    t: (key, params) => translateAdmin(locale, key, params),
  }), [locale, setLocale]);

  return <AdminLocaleContext.Provider value={value}>{children}</AdminLocaleContext.Provider>;
}

export function useAdminLocale(): AdminLocaleValue {
  const value = useContext(AdminLocaleContext);
  if (!value) throw new Error("useAdminLocale must be used inside AdminLocaleProvider");
  return value;
}

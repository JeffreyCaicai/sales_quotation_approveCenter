"use client";

import type { Locale } from "@/lib/i18n";

import { useLocale } from "./locale-provider";

const OPTIONS: ReadonlyArray<{ locale: Locale; translationKey: "language.english" | "language.simplifiedChinese" }> = [
  { locale: "en", translationKey: "language.english" },
  { locale: "zh-CN", translationKey: "language.simplifiedChinese" },
];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="language-switcher" role="group" aria-label={t("language.label")}>
      {OPTIONS.map((option) => {
        const selected = locale === option.locale;
        return (
          <button
            type="button"
            key={option.locale}
            lang={option.locale}
            aria-pressed={selected}
            data-selected={selected ? "true" : undefined}
            onClick={() => setLocale(option.locale)}
          >
            {t(option.translationKey)}
          </button>
        );
      })}
    </div>
  );
}

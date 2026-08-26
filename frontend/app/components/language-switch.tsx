"use client";

import { useLocale, type Locale } from "@/lib/locale";

export function LanguageSwitch() {
  const { locale, dictionary: t, setLocale } = useLocale();
  return (
    <label className="language-switch">
      <span className="sr-only">{t.language.switchLabel}</span>
      <select
        aria-label={t.language.switchLabel}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">{t.language.english}</option>
        <option value="zh-CN">{t.language.chinese}</option>
      </select>
    </label>
  );
}

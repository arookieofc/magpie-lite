import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./locales/en";
import { zh } from "./locales/zh";

export type Locale = "en" | "zh";
export type DictKey = keyof typeof en;
export type TFunc = (key: DictKey, vars?: Record<string, string | number | undefined>) => string;

const DICTS: Record<Locale, Record<DictKey, string>> = { en, zh };
const STORAGE_KEY = "magpie-locale";

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (langs.some((l) => l.toLowerCase().startsWith("zh"))) return "zh";
  } catch {
    /* navigator unavailable */
  }
  return "en";
}

function render(template: string, vars?: Record<string, string | number | undefined>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) => {
    const v = vars[name];
    return v === undefined ? m : String(v);
  });
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => DICTS.en[key] ?? key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* storage unavailable */
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const t = useCallback<TFunc>(
    (key, vars) => render(DICTS[locale][key] ?? DICTS.en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}

export function useT(): TFunc {
  return useContext(I18nContext).t;
}

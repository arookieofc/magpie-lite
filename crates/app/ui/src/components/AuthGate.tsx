import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Monitor, Moon, ShieldAlert, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useT, type Locale } from "../i18n";
import { MagpieMark, type ThemeChoice } from "./Sidebar";
import { Notice } from "./ui";

const THEME_ICONS: { id: ThemeChoice; icon: LucideIcon }[] = [
  { id: "system", icon: Monitor },
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
];

const THEME_LABEL_KEYS = {
  system: "topbar.themeSystem",
  light: "topbar.themeLight",
  dark: "topbar.themeDark",
} as const;

const LANGS: { id: Locale; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "zh", label: "中文" },
];

function AuthControls({
  theme,
  setTheme,
}: {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div className="auth-topbar">
      <div className="lang-switch" role="radiogroup" aria-label={t("topbar.lang")}>
        {LANGS.map((lang) => (
          <button
            key={lang.id}
            type="button"
            role="radio"
            aria-checked={locale === lang.id}
            onClick={() => setLocale(lang.id)}
          >
            {lang.label}
          </button>
        ))}
      </div>
      <div className="theme-switch" role="radiogroup" aria-label={t("topbar.theme")}>
        {THEME_ICONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={theme === option.id}
              aria-label={t(THEME_LABEL_KEYS[option.id])}
              onClick={() => setTheme(option.id)}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AccessDenied({
  theme,
  setTheme,
}: {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}) {
  const t = useT();
  return (
    <main className="auth-screen">
      <div className="auth-bg" aria-hidden="true" />
      <AuthControls theme={theme} setTheme={setTheme} />
      <section className="auth-card access-denied-card">
        <span className="access-denied-icon" aria-hidden="true">
          <ShieldAlert size={24} />
        </span>
        <h1>{t("auth.localOnlyTitle")}</h1>
        <p className="auth-copy">{t("auth.localOnlyBody")}</p>
      </section>
    </main>
  );
}

export default function AuthGate({
  onSubmit,
  authError,
  theme,
  setTheme,
}: {
  onSubmit: (token: string) => void;
  authError: boolean;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}) {
  const t = useT();
  const [show, setShow] = useState(false);

  return (
    <main className="auth-screen">
      <div className="auth-bg" aria-hidden="true" />
      <AuthControls theme={theme} setTheme={setTheme} />
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("token") ?? "").trim();
          if (value) onSubmit(value);
        }}
      >
        <div className="auth-brand">
          <span className="brand-mark">
            <MagpieMark size={18} />
          </span>
          <div className="auth-brand-text">
            <b>magpie</b>
            <small>lite gateway</small>
          </div>
        </div>

        <div>
          <p className="auth-eyebrow">{t("auth.eyebrow")}</p>
          <h1>{t("auth.title")}</h1>
        </div>
        <p className="auth-copy">{t("auth.copy")}</p>

        {authError ? (
          <Notice tone="bad" icon={<ShieldAlert size={16} />} live>
            {t("auth.invalid")}
          </Notice>
        ) : null}

        <div className="auth-field">
          <label htmlFor="gateway-token">{t("auth.tokenLabel")}</label>
          <div className="auth-input-wrap">
            <input
              id="gateway-token"
              name="token"
              className="input mono"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              required
              placeholder={t("auth.tokenPh")}
            />
            <button
              type="button"
              className="auth-eye"
              aria-label={show ? t("prov.hide") : t("prov.show")}
              onClick={() => setShow((v) => !v)}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <button type="submit" className="btn primary auth-submit">
          <LockKeyhole size={15} aria-hidden="true" />
          {t("auth.open")}
        </button>

        <p className="auth-foot">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>{t("auth.foot")}</span>
        </p>
      </form>
    </main>
  );
}

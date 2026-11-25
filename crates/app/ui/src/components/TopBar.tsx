import { Monitor, Moon, RefreshCw, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useT, type Locale } from "../i18n";
import type { ThemeChoice } from "./Sidebar";
import StatusPill, { type GatewayState } from "./StatusPill";

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

export default function TopBar({
  title,
  healthy,
  lastUpdate,
  refreshFailed,
  autoRefresh,
  setAutoRefresh,
  onRefresh,
  refreshing,
  busy,
  theme,
  setTheme,
}: {
  title: string;
  healthy: boolean | null;
  lastUpdate: string | null;
  refreshFailed: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (on: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
  busy: boolean;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const state: GatewayState =
    healthy === null
      ? "checking"
      : healthy
        ? "online"
        : "offline";
  const sync = refreshFailed
    ? t("topbar.refreshFailed")
    : lastUpdate
      ? t("topbar.synced", { time: lastUpdate })
      : t("topbar.loading");

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb" aria-label={title}>
        <span className="topbar-crumb-root">magpie</span>
        <span className="topbar-crumb-sep" aria-hidden="true">/</span>
        <span className="topbar-crumb-cur">{title}</span>
      </div>
      <div className="topbar-actions">
        <StatusPill state={state} sync={sync} />
        <label className="switch small" data-tip={t("topbar.auto")}>
          <input
            type="checkbox"
            role="switch"
            aria-label={t("topbar.auto")}
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">{t("topbar.autoShort")}</span>
        </label>
        <button
          type="button"
          className={`icon-btn${refreshing ? " spinning" : ""}`}
          aria-label={t("topbar.refresh")}
          data-tip={t("topbar.refresh")}
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
        <div className="lang-switch" role="radiogroup" aria-label={t("topbar.lang")}>
          {LANGS.map((lang) => (
            <button
              key={lang.id}
              type="button"
              role="radio"
              aria-checked={locale === lang.id}
              aria-label={lang.id === "en" ? "English" : "中文"}
              data-tip={lang.id === "en" ? "English" : "中文"}
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
                data-tip={t(THEME_LABEL_KEYS[option.id])}
                onClick={() => setTheme(option.id)}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

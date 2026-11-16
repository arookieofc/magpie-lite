import {
  Bot,
  LayoutDashboard,
  Monitor,
  Moon,
  RefreshCw,
  ScrollText,
  Server,
  Sun,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export type View = "overview" | "agents" | "providers" | "groups" | "requests";
export type ThemeChoice = "system" | "light" | "dark";

export interface NavItem {
  id: View;
  label: string;
  badge?: string;
  alert?: boolean;
}

const ICONS: Record<View, LucideIcon> = {
  overview: LayoutDashboard,
  requests: ScrollText,
  agents: Bot,
  providers: Server,
  groups: Waypoints,
};

const THEMES: { id: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { id: "system", label: "System theme", icon: Monitor },
  { id: "light", label: "Light theme", icon: Sun },
  { id: "dark", label: "Dark theme", icon: Moon },
];

interface Props {
  items: NavItem[];
  view: View;
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
}

export function MagpieMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 7h.01" />
      <path d="M3.4 18H12a8 8 0 0 0 8-8V7l-4.3-2.1a2 2 0 0 0-2.6.9L11 9.5a2 2 0 0 1-1.6 1L3 12" />
    </svg>
  );
}

export default function Topbar({
  items,
  view,
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
}: Props) {
  const health =
    healthy === null
      ? { label: "Checking", tone: "warn" }
      : healthy
        ? { label: "Online", tone: "good" }
        : { label: "Offline", tone: "bad" };
  const sync = refreshFailed
    ? "Refresh failed"
    : lastUpdate
      ? `Synced ${lastUpdate}`
      : "Loading…";

  return (
    <header className="top">
      <div className="brand">
        <span className="brand-mark">
          <MagpieMark />
        </span>
        <div className="brand-text">
          <strong>magpie</strong>
          <small>lite</small>
        </div>
      </div>

      <nav className="seg" aria-label="Console sections">
        {items.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="seg-btn"
              aria-current={item.id === view ? "page" : undefined}
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
              <span>{item.label}</span>
              {item.alert ? <span className="seg-dot" title="Needs attention" /> : null}
            </a>
          );
        })}
      </nav>

      <div className="top-actions">
        <div className="gw-status" role="status" aria-live="polite" title={sync}>
          <span className={`pulse ${health.tone}`} aria-hidden="true" />
          <span className="gw-label">{health.label}</span>
          <span className="gw-sync">{sync}</span>
        </div>
        <label className="switch small" title="Auto refresh every 5s">
          <input
            type="checkbox"
            role="switch"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
        <button
          type="button"
          className={`icon-btn${refreshing ? " spinning" : ""}`}
          aria-label="Refresh now"
          title="Refresh now"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
        <div className="theme-switch" role="radiogroup" aria-label="Color theme">
          {THEMES.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={theme === option.id}
                aria-label={option.label}
                title={option.label}
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

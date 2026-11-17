import {
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useT, type DictKey } from "../i18n";

export type View = "overview" | "providers" | "groups" | "requests";
export type ThemeChoice = "system" | "light" | "dark";

export interface NavItem {
  id: View;
  labelKey: DictKey;
  badge?: string;
  alert?: boolean;
}

const ICONS: Record<View, LucideIcon> = {
  overview: LayoutDashboard,
  requests: ScrollText,
  providers: Server,
  groups: Waypoints,
};

/* Astryx SideNav grouping: Monitor pages vs Configure pages. */
const SECTIONS: { headingKey: DictKey; ids: View[] }[] = [
  { headingKey: "nav.monitor", ids: ["overview", "requests"] },
  { headingKey: "nav.configure", ids: ["providers", "groups"] },
];

interface Props {
  items: NavItem[];
  view: View;
  lastUpdate: string | null;
  refreshFailed: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
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

/* Astryx SideNav five zones: header / topContent / children (scrollable) /
   footer / footerIcons. TopContent is reserved for a future quick action
   (e.g. "New provider") and intentionally left empty. */
export default function Sidebar({
  items,
  view,
  lastUpdate,
  refreshFailed,
  collapsed,
  onToggleCollapse,
}: Props) {
  const t = useT();
  const sync = refreshFailed
    ? t("side.refreshFailed")
    : lastUpdate
      ? t("side.synced", { time: lastUpdate })
      : t("side.loading");
  const byId = new Map(items.map((item) => [item.id, item]));
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside className={`side${collapsed ? " collapsed" : ""}`} aria-label={t("shell.navLabel")}>
      {/* header (sticky) */}
      <div className="side-header">
      <div className="brand">
        <span className="brand-mark">
          <MagpieMark />
        </span>
        <div className="brand-text">
          <strong>magpie</strong>
          <small>lite</small>
        </div>
      </div>
      </div>

      {/* children (scrollable) */}
      <nav className="side-nav">
        {SECTIONS.map((section) => (
          <div className="side-section" key={section.headingKey}>
            <p className="side-heading">{t(section.headingKey)}</p>
            {section.ids.map((id) => {
              const item = byId.get(id);
              if (!item) return null;
              const Icon = ICONS[item.id];
              const active = item.id === view;
              const label = t(item.labelKey);
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="side-link"
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  <span className="side-label">{label}</span>
                  {item.badge ? <span className="side-badge">{item.badge}</span> : null}
                  {item.alert ? <span className="side-dot" title="Needs attention" /> : null}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* footer (sticky bottom) */}
      <div className="side-foot">
        <div className="gw-status" role="status" aria-live="polite" title={sync}>
          <span className="pulse" aria-hidden="true" />
          <span className="gw-sync">{sync}</span>
        </div>
      </div>

      {/* footerIcons */}
      <div className="side-foot-icons">
        <button
          type="button"
          className="icon-btn side-collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t("side.expand") : t("side.collapse")}
          aria-expanded={!collapsed}
          title={collapsed ? t("side.expand") : t("side.collapse")}
        >
          <CollapseIcon size={15} />
        </button>
        </div>
    </aside>
  );
}

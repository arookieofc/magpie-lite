import { useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
  Waypoints,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { useT, type DictKey } from "../i18n";

export type View = "overview" | "gateway" | "providers" | "groups" | "requests" | "chat";
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
  chat: MessagesSquare,
  gateway: Network,
  providers: Server,
  groups: Waypoints,
};

/* Astryx SideNav grouping: Monitor pages vs Configure pages. */
const SECTIONS: { headingKey: DictKey; ids: View[] }[] = [
  { headingKey: "nav.monitor", ids: ["overview", "requests", "chat"] },
  { headingKey: "nav.configure", ids: ["gateway", "providers", "groups"] },
];

interface Props {
  items: NavItem[];
  view: View;
  lastUpdate: string | null;
  refreshFailed: boolean;
  gatewayPort?: number;
  healthy?: boolean | null;
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

/* The selection is one shape, not a per-row paint: a pill that springs to
   the open page's row, as upstream's .nav-top-hl does. Reduced-motion
   jumps straight there. */
const SPRING = { response: 0.42, damping: 0.84 };

function NavHighlight({ nav }: { nav: HTMLElement | null }) {
  const ref = useRef<HTMLElement>(null);
  const state = useRef({ y: 0, h: 0, vy: 0, vh: 0, at: 0, raf: 0, seen: false });

  useEffect(() => {
    const hl = ref.current;
    if (!hl || !nav) return;
    const row = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row) {
      hl.hidden = true;
      state.current.raf && cancelAnimationFrame(state.current.raf);
      state.current.raf = 0;
      return;
    }
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = state.current;
    const target = row;
    const put = () => {
      s.y = target.offsetTop;
      s.h = target.offsetHeight;
      s.vy = s.vh = 0;
      hl.style.transform = `translateY(${s.y}px)`;
      hl.style.height = `${s.h}px`;
    };
    if (calm || !s.seen) {
      hl.hidden = false;
      put();
      s.seen = true;
      return;
    }
    hl.hidden = false;
    if (!s.raf) {
      s.at = performance.now();
      s.raf = requestAnimationFrame(step);
    }
    function step(now: number) {
      if (!hl) { s.raf = 0; return; }
      const dt = Math.min(1 / 30, Math.max(0, (now - s.at) / 1000));
      s.at = now;
      const k = (2 * Math.PI / SPRING.response) ** 2;
      const c = (4 * Math.PI * SPRING.damping) / SPRING.response;
      const ty = target.offsetTop;
      const th = target.offsetHeight;
      for (let i = 0, d = dt / 4; i < 4; i++) {
        s.vy += (k * (ty - s.y) - c * s.vy) * d;
        s.y += s.vy * d;
        s.vh += (k * (th - s.h) - c * s.vh) * d;
        s.h += s.vh * d;
      }
      const still =
        Math.abs(ty - s.y) < 0.25 &&
        Math.abs(s.vy) < 4 &&
        Math.abs(th - s.h) < 0.25 &&
        Math.abs(s.vh) < 4;
      if (still) {
        put();
        s.raf = 0;
        return;
      }
      hl.style.transform = `translateY(${s.y}px)`;
      hl.style.height = `${s.h}px`;
      s.raf = requestAnimationFrame(step);
    }
    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  });

  useEffect(() => {
    if (!nav) return;
    const ro = new ResizeObserver(() => {
      const hl = ref.current;
      const row = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (hl && row && !hl.hidden) {
        hl.style.transform = `translateY(${row.offsetTop}px)`;
        hl.style.height = `${row.offsetHeight}px`;
      }
    });
    ro.observe(nav);
    return () => ro.disconnect();
  }, [nav]);

  return <i ref={ref} className="nav-top-hl" hidden aria-hidden="true" />;
}

/* Astryx SideNav five zones: header / topContent / children (scrollable) /
   footer / footerIcons. TopContent is reserved for a future quick action
   (e.g. "New provider") and intentionally left empty. */
export default function Sidebar({
  items,
  view,
  lastUpdate,
  refreshFailed,
  gatewayPort,
  healthy,
  collapsed,
  onToggleCollapse,
}: Props) {
  const t = useT();
  const navRef = useRef<HTMLElement>(null);
  const sync = refreshFailed
    ? t("side.refreshFailed")
    : lastUpdate
      ? t("side.synced", { time: lastUpdate })
      : t("side.loading");
  const byId = new Map(items.map((item) => [item.id, item]));
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  // navlamp: the row under the pointer glows, following it with a little
  // lag and fading as it moves on — upstream's pointer-lit sidebar.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const lit = new Map<HTMLElement, number>();
    let at: HTMLElement | null = null;
    let tx = 0, x = 0, raf = 0;
    const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function frame() {
      raf = 0;
      const still = calm();
      const row = at && at.isConnected ? at : null;
      if (row && !lit.has(row)) lit.set(row, 0);
      x = still ? tx : x + (tx - x) * 0.22;
      let busy = Math.abs(tx - x) > 0.3;
      for (const [s, v] of lit) {
        const to = s === row ? 1 : 0;
        const now = still ? to : v + (to - v) * (to > v ? 0.22 : 0.1);
        if (!to && (now < 0.01 || !s.isConnected)) {
          lit.delete(s);
          s.classList.remove("lit");
          s.style.removeProperty("--si");
          s.style.removeProperty("--lx");
          continue;
        }
        if (Math.abs(to - now) > 0.002) busy = true;
        lit.set(s, now);
        s.classList.add("lit");
        s.style.setProperty("--si", now.toFixed(3));
        s.style.setProperty("--lx", (x - s.getBoundingClientRect().left).toFixed(1) + "px");
      }
      if (busy) raf = requestAnimationFrame(frame);
    }
    const go = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onMove = (e: PointerEvent) => {
      const link = e.pointerType === "touch" ? null : (e.target as Element).closest?.(".side-link, .side-gw");
      const word = link?.querySelector<HTMLElement>(":scope > span");
      if (word && !at) x = e.clientX;
      tx = e.clientX;
      if (word !== at) at = word ?? null;
      if (at || lit.size) go();
    };
    const onLeave = () => { at = null; go(); };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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
      <nav className="side-nav" ref={navRef}>
        <NavHighlight nav={navRef.current} />
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
                  data-tip={collapsed ? label : undefined}
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  <span className="side-label">{label}</span>
                  {item.badge ? <span className="side-badge">{item.badge}</span> : null}
                  {item.alert ? <span className="side-dot" data-tip="Needs attention" /> : null}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* footer (sticky bottom) */}
      <div className="side-foot">
        <a
          className={`side-gw${healthy === false ? " off" : ""}`}
          href="#gateway"
          role="status"
          data-tip={sync}
        >
          <i aria-hidden="true" />
          <span>{t("nav.gateway")} 127.0.0.1:{gatewayPort ?? 3426}</span>
        </a>
      </div>

      {/* footerIcons */}
      <div className="side-foot-icons">
        <button
          type="button"
          className="icon-btn side-collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t("side.expand") : t("side.collapse")}
          aria-expanded={!collapsed}
          data-tip={collapsed ? t("side.expand") : t("side.collapse")}
        >
          <CollapseIcon size={15} />
        </button>
        </div>
    </aside>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import * as api from "./api";
import type {
  Config,
  ModelsResponse,
  RequestRecord,
  Stats,
  TraceResponse,
} from "./types";
import AppShell from "./components/AppShell";
import Sidebar, { type NavItem, type ThemeChoice, type View } from "./components/Sidebar";
import TopBar from "./components/TopBar";
import NoticeBanner from "./components/NoticeBanner";
import { useT } from "./i18n";
import StatsGauge from "./components/StatsGauge";
import Activity from "./components/Activity";
import Gateway from "./components/Gateway";
import ProviderTotals from "./components/ProviderTotals";
import Routing from "./components/Routing";
import RecentRequests from "./components/RecentRequests";
import ProviderConfig from "./components/ProviderConfig";
import Groups from "./components/Groups";
import Models from "./components/Models";
import UsageByModel from "./components/UsageByModel";
import { PageHeader } from "./components/ui";

const VIEWS: View[] = ["overview", "gateway", "providers", "groups", "requests"];
const THEME_KEY = "magpie-theme";
const COLLAPSE_KEY = "magpie-sidenav-collapsed";

function viewFromHash(): View {
  const id = window.location.hash.replace(/^#/, "");
  return (VIEWS as string[]).includes(id) ? (id as View) : "overview";
}

function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface GatewayData {
  stats: Stats | null;
  models: ModelsResponse | null;
  config: Config | null;
  lastUpdate: string | null;
}

export interface StatsRange {
  from: number | null;
  to: number | null;
}

export default function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [data, setData] = useState<GatewayData>({
    stats: null,
    models: null,
    config: null,
    lastUpdate: null,
  });
  const [message, setMessage] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statsRange, setStatsRange] = useState<StatsRange | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(viewFromHash);
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [offlineDismissed, setOfflineDismissed] = useState(false);

  const t = useT();
  const meta = {
    overview: { title: t("view.overviewTitle"), subtitle: t("view.overviewSub") },
    requests: { title: t("view.requestsTitle"), subtitle: t("view.requestsSub") },
    gateway: { title: t("view.gatewayTitle"), subtitle: t("view.gatewaySub") },
    providers: { title: t("view.providersTitle"), subtitle: t("view.providersSub") },
    groups: { title: t("view.groupsTitle"), subtitle: t("view.groupsSub") },
  }[view];

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "light" : "dark") : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      document.querySelector("#main")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const traceSeq = useRef(0);
  const traceRunId = useRef(0);

  const statsPath = useCallback(() => {
    if (!statsRange) return "/stats";
    const params = new URLSearchParams();
    if (statsRange.from !== null) params.set("from", String(statsRange.from));
    if (statsRange.to !== null) params.set("to", String(statsRange.to));
    const qs = params.toString();
    return qs ? `/stats?${qs}` : "/stats";
  }, [statsRange]);

  const update = useCallback(
    async (silent: boolean) => {
      if (!silent) setRefreshing(true);
      try {
        const [stats, models, config] = await Promise.all([
          api.get<Stats>(statsPath()),
          api.get<ModelsResponse>("/v1/models"),
          api.get<Config>("/config"),
        ]);
        setData({
          stats,
          models,
          config,
          lastUpdate: new Date().toLocaleTimeString([], { hour12: false }),
        });
        setRefreshFailed(false);
        if (!silent) setMessage("");
        return true;
      } catch (e) {
        setRefreshFailed(true);
        if (!silent) setMessage((e as Error).message || "Could not refresh gateway data.");
        return false;
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [statsPath],
  );

  // Poll the trace endpoint: wait=1 holds the call ~25s until a new
  // finished request lands, which drives the live Routing view.
  useEffect(() => {
    let stopped = false;
    const run = ++traceRunId.current;
    async function poll() {
      while (!stopped && run === traceRunId.current) {
        try {
          const res = await api.get<TraceResponse>(
            `/api/trace?after=${traceSeq.current}&wait=1`,
          );
          const restarted = res.seq < traceSeq.current;
          if (restarted) traceSeq.current = 0;
          traceSeq.current = res.seq;
          setTrace((prev) => {
            const merged = new Map<number, RequestRecord>();
            if (!restarted) {
              for (const route of prev?.routes ?? []) merged.set(route.seq ?? 0, route);
            }
            for (const route of res.routes) merged.set(route.seq ?? 0, route);
            const routes = [...merged.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
            return { ...res, routes: routes.slice(-40) };
          });
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    update(true);
  }, [update]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") update(true);
    }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, update]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        await api.get("/health");
        if (!cancelled) setHealthy(true);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    }
    check();
    const t = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setOfflineDismissed(false);
  }, [healthy]);

  const routeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const provider of data.config?.providers ?? []) {
      for (const id of provider.models ?? []) values.add(`${provider.id}/${id}`);
    }
    for (const group of data.config?.groups ?? []) {
      if (group.hidden) continue;
      values.add(group.auto && group.name ? `auto/${group.name}` : `group/${group.id}`);
    }
    return [...values];
  }, [data.config]);

  const nav: NavItem[] = useMemo(() => {
    const groups = (data.config?.groups ?? []).filter((g) => !g.hidden).length;
    const recent = data.stats?.recent_requests ?? [];
    const recentErrors = recent.filter((r) => r.status !== "ok").length;
    return [
      { id: "overview", labelKey: "nav.overview" },
      {
        id: "requests",
        labelKey: "nav.requests",
        badge: recent.length ? String(recent.length) : undefined,
        alert: recentErrors > 0,
      },
      { id: "gateway", labelKey: "nav.gateway" },
      {
        id: "providers",
        labelKey: "nav.providers",
        badge: data.config ? String(data.config.providers.length) : undefined,
      },
      { id: "groups", labelKey: "nav.groups", badge: data.config ? String(groups) : undefined },
    ];
  }, [data]);

  const refreshAll = () => update(false);

  return (
    <AppShell
      sideNav={
        <Sidebar
          items={nav}
          view={view}
          lastUpdate={data.lastUpdate}
          refreshFailed={refreshFailed}
          gatewayPort={data.config?.port}
          healthy={healthy}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      }
      topBar={
        <TopBar
          title={meta.title}
          subtitle={meta.subtitle}
          healthy={healthy}
          lastUpdate={data.lastUpdate}
          refreshFailed={refreshFailed}
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          onRefresh={refreshAll}
          refreshing={refreshing}
          busy={busy}
          theme={theme}
          setTheme={setTheme}
        />
      }
    >
        <div className="main-inner">
          {healthy === false && !offlineDismissed ? (
            <NoticeBanner
              tone="bad"
              title={t("banner.offlineTitle")}
              actionLabel={t("common.refresh")}
              onAction={refreshAll}
              onDismiss={() => setOfflineDismissed(true)}
            >
              {t("banner.offlineBody")}
            </NoticeBanner>
          ) : null}
          {message ? (
            <NoticeBanner
              tone="warn"
              title={t("topbar.refreshFailed")}
              actionLabel={t("common.refresh")}
              onAction={refreshAll}
              onDismiss={() => setMessage("")}
            >
              {message}
            </NoticeBanner>
          ) : null}

          <datalist id="agent-model-options">
            {routeOptions.map((route) => (
              <option key={route} value={route} />
            ))}
          </datalist>

          <section className="view" hidden={view !== "overview"} aria-label="Overview">
            <PageHeader
              title={t("page.overviewTitle")}
              subtitle={t("page.overviewSub")}
            />
            <StatsGauge stats={data.stats} />
            <div className="grid-main-side">
              <Activity stats={data.stats} />
              <ProviderTotals stats={data.stats} />
            </div>
            <Routing trace={trace} config={data.config} stats={data.stats} />
            <UsageByModel stats={data.stats} />
          </section>

          <section className="view" hidden={view !== "requests"} aria-label={t("page.requestsTitle")}>
            <PageHeader
              title={t("page.requestsTitle")}
              subtitle={t("page.requestsSub")}
            />
            <RecentRequests
              stats={data.stats}
              statsRange={statsRange}
              setStatsRange={setStatsRange}
              onApplied={refreshAll}
            />
            <p className="footnote">
              <ShieldCheck size={14} aria-hidden="true" />
              {t("page.secretNote")}
            </p>
          </section>

          <section className="view" hidden={view !== "providers"} aria-label={t("page.providersTitle")}>
            <ProviderConfig config={data.config} busy={busy} setBusy={setBusy} onChanged={refreshAll} />
            <Models models={data.models} />
          </section>

          <section className="view" hidden={view !== "gateway"} aria-label={t("page.gatewayTitle")}>
            <Gateway config={data.config} models={data.models} healthy={healthy} />
          </section>

          <section className="view" hidden={view !== "groups"} aria-label={t("page.groupsTitle")}>
            <Groups
              config={data.config}
              models={data.models}
              stats={data.stats}
              busy={busy}
              setBusy={setBusy}
              onChanged={refreshAll}
            />
          </section>
        </div>
    </AppShell>
  );
}

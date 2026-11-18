import { Fragment, useMemo, useState } from "react";
import { ArrowRight, ChevronRight, ScrollText, Search } from "lucide-react";
import type { RequestRecord, Stats } from "../types";
import { fmt, fmtCost, recordSpeed, timeOf } from "../util";
import type { StatsRange } from "../App";
import { Badge, Card, Empty, Segmented } from "./ui";
import { DatePicker } from "./DatePicker";
import { useT, type TFunc } from "../i18n";

type StatusFilter = "all" | "ok" | "errors";

function Details({ r }: { r: RequestRecord }) {
  const t = useT();
  const tries = r.tries ?? [];
  const facts: [string, string][] = [];
  facts.push([t("req.dProtocol"), r.client_protocol || "—"]);
  facts.push([t("req.dStream"), r.stream ? t("req.yes") : t("req.no")]);
  facts.push([t("req.dKeySlot"), r.key_slot === undefined ? "—" : t("req.dKeySlotV", { n: r.key_slot })]);
  if (r.classified?.intent) facts.push([t("req.dIntent"), r.classified.intent]);
  if (r.classified?.effort) facts.push([t("req.dEffort"), r.classified.effort]);
  if (r.classified?.fallback) facts.push([t("req.dFallback"), r.classified.fallback]);
  if (r.rule) facts.push([t("req.dRule"), r.rule.rule === undefined ? t("req.dNoRule", { use: r.rule.use ?? "" }) : t("req.dRuleV", { n: r.rule.rule + 1, use: r.rule.use ?? "" })]);
  if (r.replans && r.replans > 0) {
    facts.push([
      t("req.dReplans"),
      (r.replan_waited_ms ?? 0) > 0
        ? t("req.dReplansWait", { n: r.replans, ms: fmt(r.replan_waited_ms) })
        : t("req.dReplansV", { n: r.replans }),
    ]);
  }
  const usage = r.usage ?? {};
  if (usage.cache_read) facts.push([t("req.dCacheRead"), fmt(usage.cache_read)]);
  if (usage.cache_write) facts.push([t("req.dCacheWrite"), fmt(usage.cache_write)]);
  if (usage.reasoning) facts.push([t("req.dReasoning"), fmt(usage.reasoning)]);
  if (r.ttft_ms) facts.push([t("req.dTtft"), `${fmt(r.ttft_ms)}ms`]);
  if (r.cost != null) facts.push([t("req.dCost"), fmtCost(r.cost)]);
  const speed = recordSpeed(r);
  if (speed) facts.push([t("req.dSpeed"), t("usage.tps", { n: fmt(Math.round(speed)) })]);
  return (
    <div className="req-details">
      <div>
        <p className="detail-label">{t("req.dTries")}</p>
        {tries.length ? (
          <ol className="try-chain">
            {tries.map((tt, i) => (
              <li key={i} className={tt.status === "ok" ? "ok" : tt.status ? "bad" : "wait"}>
                {i > 0 ? <ArrowRight size={12} className="try-arrow" aria-hidden="true" /> : null}
                <span className="try">
                  <span className="dot" aria-hidden="true" />
                  <code>
                    {tt.provider}/{tt.model}
                    {tt.effort ? `@${tt.effort}` : ""}
                  </code>
                  <span className="try-meta">
                    {[
                      tt.status ?? t("req.tPending"),
                      tt.ms ? `${fmt(tt.ms)}ms` : "",
                      (tt.queued_ms ?? 0) > 0 ? t("req.tQueued", { n: tt.queued_ms }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">{t("req.dNothing")}</p>
        )}
        {r.error ? <p className="req-error">{r.error}</p> : null}
      </div>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface Props {
  stats: Stats | null;
  statsRange: StatsRange | null;
  setStatsRange: (r: StatsRange | null) => void;
  onApplied: () => void;
}

export default function RecentRequests({ stats, statsRange, setStatsRange, onApplied }: Props) {
  const t = useT();
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const requests = useMemo(() => stats?.recent_requests ?? [], [stats]);
  const latest = useMemo(() => requests.slice(-100).reverse(), [requests]);
  const errorCount = latest.filter((r) => r.status !== "ok").length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return latest.filter((r) => {
      if (status === "ok" && r.status !== "ok") return false;
      if (status === "errors" && r.status === "ok") return false;
      if (!q) return true;
      return [r.requested_model, r.client_protocol, r.provider, r.upstream_model, r.status]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [latest, status, query]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const f = from ? from.getTime() : null;
    const tt = to ? to.getTime() : null;
    if (f !== null && tt !== null && f > tt) {
      setRangeError(t("req.badOrder"));
      return;
    }
    setRangeError("");
    setStatsRange(f === null && tt === null ? null : { from: f, to: tt });
    onApplied();
  }

  function clear() {
    setFrom(null);
    setTo(null);
    setRangeError("");
    setStatsRange(null);
    onApplied();
  }

  function toggle(key: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <form className="toolbar" autoComplete="off" onSubmit={apply}>
        <div className="toolbar-range">
          <label className="inline-field" htmlFor="stats-from">
            <span>{t("req.from")}</span>
          </label>
          <DatePicker
            id="stats-from"
            value={from ?? (statsRange?.from != null ? new Date(statsRange.from) : null)}
            onChange={setFrom}
            withTime
          />
          <label className="inline-field" htmlFor="stats-to">
            <span>{t("req.to")}</span>
          </label>
          <DatePicker
            id="stats-to"
            value={to ?? (statsRange?.to != null ? new Date(statsRange.to) : null)}
            onChange={setTo}
            withTime
          />
          <button className="btn" type="submit">
            {t("req.apply")}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!statsRange && !from && !to}
            onClick={clear}
          >
            {t("req.clear")}
          </button>
          {statsRange ? <Badge tone="accent">{t("req.rangeApplied")}</Badge> : null}
        </div>
        <p className={`toolbar-hint${rangeError ? " error" : ""}`} role="status" aria-live="polite">
          {rangeError || t("req.hint")}
        </p>
      </form>

      <Card
        title={t("req.logTitle")}
        icon={<ScrollText size={16} />}
        description={
          requests.length
            ? statsRange
              ? t("req.logDescRange", { shown: fmt(latest.length), total: fmt(requests.length) })
              : t("req.logDesc", { shown: fmt(latest.length), total: fmt(requests.length) })
            : undefined
        }
        flush
        labelledBy="recent-title"
        actions={
          <div className="log-filters">
            <Segmented<StatusFilter>
              label={t("req.filterLabel")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: t("req.all") },
                { value: "ok", label: t("req.ok") },
                { value: "errors", label: `${t("req.errors")}${errorCount ? ` ${errorCount}` : ""}` },
              ]}
            />
            <label className="search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder={t("req.searchPh")}
                aria-label={t("req.searchAria")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        }
      >
        {requests.length === 0 ? (
          <Empty icon={<ScrollText size={18} />} title={t("req.emptyTitle")}>
            {statsRange ? t("req.emptyRange") : t("req.emptyDefault")}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={<Search size={18} />}
            title={t("req.noMatch")}
            action={
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setStatus("all");
                  setQuery("");
                }}
              >
                {t("req.clearFilters")}
              </button>
            }
          >
            {query.trim()
              ? t("req.noMatchQuery", {
                  q: query.trim(),
                  filter:
                    status === "errors" ? t("req.errors") : status === "ok" ? t("req.ok") : t("req.all"),
                })
              : t("req.noMatchFilter", {
                  filter:
                    status === "errors" ? t("req.errors") : status === "ok" ? t("req.ok") : t("req.all"),
                })}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table log">
              <thead>
                <tr>
                  <th scope="col" className="expander-col"><span className="sr-only">{t("req.thDetails")}</span></th>
                  <th scope="col">{t("req.thTime")}</th>
                  <th scope="col">{t("req.thAgent")}</th>
                  <th scope="col">{t("req.thRequested")}</th>
                  <th scope="col">{t("req.thServed")}</th>
                  <th scope="col">{t("req.thStatus")}</th>
                  <th scope="col" className="num">{t("req.thLatency")}</th>
                  <th scope="col" className="num">{t("req.thTokens")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const key = r.seq ?? -(i + 1);
                  const expanded = open.has(key);
                  const usage = r.usage ?? {};
                  const tries = (r.tries ?? []).length;
                  return (
                    <Fragment key={key}>
                      <tr className={`log-row${expanded ? " expanded" : ""}`} onClick={() => toggle(key)}>
                        <td className="expander-col">
                          <button
                            type="button"
                            className="icon-btn tiny"
                            aria-expanded={expanded}
                            aria-label={expanded ? t("req.hideDetails", { time: timeOf(r.started_unix_ms) }) : t("req.showDetails", { time: timeOf(r.started_unix_ms) })}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(key);
                            }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </td>
                        <td className="num text-muted">{timeOf(r.started_unix_ms)}</td>
                        <td>{r.client_protocol}</td>
                        <td><code className="route">{r.requested_model}</code></td>
                        <td>
                          {r.provider ? (
                            <span className="served">
                              <code>{r.provider}/{r.upstream_model}</code>
                              {tries > 1 ? <span className="pill-mini">{t("req.tries", { n: tries })}</span> : null}
                              {r.classified?.intent ? <span className="pill-mini">{r.classified.intent}</span> : null}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={r.status === "ok" ? "good" : "bad"} dot>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="num">{fmt(r.latency_ms)}<span className="unit">ms</span></td>
                        <td className="num">
                          {usage.input == null ? "—" : fmt(usage.input)}
                          <span className="text-muted"> / </span>
                          {usage.output == null ? "—" : fmt(usage.output)}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="log-detail">
                          <td colSpan={8}>
                            <Details r={r} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export type { TFunc };

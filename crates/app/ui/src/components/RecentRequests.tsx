import { Fragment, useMemo, useState } from "react";
import { ArrowRight, ChevronRight, ScrollText, Search } from "lucide-react";
import type { RequestRecord, Stats } from "../types";
import { fmt, timeOf } from "../util";
import type { StatsRange } from "../App";
import { Badge, Card, Empty, Segmented } from "./ui";

type StatusFilter = "all" | "ok" | "errors";

function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function Details({ r }: { r: RequestRecord }) {
  const tries = r.tries ?? [];
  const facts: [string, string][] = [];
  facts.push(["Protocol", r.client_protocol || "—"]);
  facts.push(["Stream", r.stream ? "yes" : "no"]);
  facts.push(["Key slot", r.key_slot === undefined ? "—" : `slot ${r.key_slot}`]);
  if (r.classified?.intent) facts.push(["Intent", r.classified.intent]);
  if (r.classified?.effort) facts.push(["Judged effort", r.classified.effort]);
  if (r.classified?.fallback) facts.push(["Classifier fallback", r.classified.fallback]);
  if (r.rule) facts.push(["Rule", `${r.rule.rule === undefined ? "" : `#${r.rule.rule + 1} `}→ ${r.rule.use ?? ""}`]);
  if (r.replans && r.replans > 0) {
    facts.push([
      "Replans",
      `×${r.replans}${(r.replan_waited_ms ?? 0) > 0 ? ` (waited ${fmt(r.replan_waited_ms)} ms)` : ""}`,
    ]);
  }
  const usage = r.usage ?? {};
  if (usage.cache_read) facts.push(["Cache read", fmt(usage.cache_read)]);
  if (usage.cache_write) facts.push(["Cache write", fmt(usage.cache_write)]);
  return (
    <div className="req-details">
      <div>
        <p className="detail-label">Tries</p>
        {tries.length ? (
          <ol className="try-chain">
            {tries.map((t, i) => (
              <li key={i} className={t.status === "ok" ? "ok" : t.status ? "bad" : "wait"}>
                {i > 0 ? <ArrowRight size={12} className="try-arrow" aria-hidden="true" /> : null}
                <span className="try">
                  <span className="dot" aria-hidden="true" />
                  <code>
                    {t.provider}/{t.model}
                    {t.effort ? `@${t.effort}` : ""}
                  </code>
                  <span className="try-meta">
                    {[
                      t.status ?? "pending",
                      t.ms ? `${fmt(t.ms)}ms` : "",
                      (t.queued_ms ?? 0) > 0 ? `queued ${t.queued_ms}ms` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">Nothing was tried.</p>
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
    const f = fromLocalInput(from);
    const t = fromLocalInput(to);
    if (from && f === null) {
      setRangeError("Enter a valid From date and time.");
      return;
    }
    if (to && t === null) {
      setRangeError("Enter a valid To date and time.");
      return;
    }
    if (f !== null && t !== null && f > t) {
      setRangeError("From must be earlier than or equal to To.");
      return;
    }
    setRangeError("");
    setStatsRange(f === null && t === null ? null : { from: f, to: t });
    onApplied();
  }

  function clear() {
    setFrom("");
    setTo("");
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
          <label className="inline-field">
            <span>From</span>
            <input
              id="stats-from"
              className="input"
              type="datetime-local"
              step={1}
              value={from || toLocalInput(statsRange?.from ?? null)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="inline-field">
            <span>To</span>
            <input
              id="stats-to"
              className="input"
              type="datetime-local"
              step={1}
              value={to || toLocalInput(statsRange?.to ?? null)}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button className="btn" type="submit">
            Apply range
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!statsRange && !from && !to}
            onClick={clear}
          >
            Clear
          </button>
          {statsRange ? <Badge tone="accent">Range applied</Badge> : null}
        </div>
        <p className={`toolbar-hint${rangeError ? " error" : ""}`} role="status" aria-live="polite">
          {rangeError ||
            "The range filters recent requests and usage only; process and provider totals stay unchanged."}
        </p>
      </form>

      <Card
        title="Request log"
        icon={<ScrollText size={16} />}
        description={
          requests.length
            ? `Latest ${latest.length} of ${fmt(requests.length)} records${statsRange ? " in the selected range" : ""}`
            : undefined
        }
        flush
        labelledBy="recent-title"
        actions={
          <div className="log-filters">
            <Segmented<StatusFilter>
              label="Filter by status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All" },
                { value: "ok", label: "OK" },
                { value: "errors", label: `Errors${errorCount ? ` ${errorCount}` : ""}` },
              ]}
            />
            <label className="search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder="Filter model, agent, provider"
                aria-label="Filter requests"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        }
      >
        {requests.length === 0 ? (
          <Empty icon={<ScrollText size={18} />} title="No requests yet">
            {statsRange
              ? "No requests match the selected history range yet."
              : "No requests are in the recent-history window yet."}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty icon={<Search size={18} />} title="Nothing matches these filters" />
        ) : (
          <div className="table-wrap">
            <table className="table log">
              <thead>
                <tr>
                  <th scope="col" className="expander-col"><span className="sr-only">Details</span></th>
                  <th scope="col">Time</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Served by</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Latency</th>
                  <th scope="col" className="num">Tokens in / out</th>
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
                            aria-label={`${expanded ? "Hide" : "Show"} details for the request at ${timeOf(r.started_unix_ms)}`}
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
                              {tries > 1 ? <span className="pill-mini">{tries} tries</span> : null}
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

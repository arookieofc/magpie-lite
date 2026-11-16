import { Clock, Server } from "lucide-react";
import type { Stats } from "../types";
import { compact, fmt, formatDuration, percent } from "../util";
import { Avatar, Card, Empty } from "./ui";

function laneSummary(lanes: { who: string; busy: number; waiting: number; limit: number }[], id: string) {
  const mine = (lanes || []).filter((l) => l.who === id || l.who.startsWith(id + "#"));
  if (mine.length === 0) return "Idle";
  return mine
    .map((l) => `${l.busy}/${l.limit} in flight${l.waiting ? `, ${l.waiting} waiting` : ""}`)
    .join("; ");
}

function rpmSummary(rpm: { who: string; used: number }[], id: string) {
  const used = (rpm || [])
    .filter((e) => e.who === id || e.who.startsWith(id + "#"))
    .reduce((t, e) => t + e.used, 0);
  return used === 0 ? null : `${used} this minute`;
}

export default function ProviderTotals({ stats }: { stats: Stats | null }) {
  const entries = Object.entries(stats?.providers ?? {}).sort((a, b) => b[1].requests - a[1].requests);
  return (
    <Card
      className="health"
      title="Provider health"
      icon={<Server size={16} />}
      description="Since this gateway started"
      labelledBy="provider-health-title"
    >
      {entries.length === 0 ? (
        <Empty icon={<Server size={18} />} title="No provider traffic">
          No provider has served a request in this process yet.
        </Empty>
      ) : (
        <ul className="health-list">
          {entries.map(([id, p]) => {
            const ok = Math.max(0, p.requests - p.errors);
            const rate = p.requests ? ok / p.requests : 1;
            const tone = rate >= 0.99 ? "good" : rate >= 0.9 ? "warn" : "bad";
            const cooldowns = stats?.key_cooldowns?.[id] ?? [];
            const now = Date.now();
            const rpm = rpmSummary(stats?.rpm ?? [], id);
            const keys = Object.entries(p.keys);
            return (
              <li key={id} className="health-item">
                <div className="health-head">
                  <Avatar name={id} size="sm" />
                  <b>{id}</b>
                  <span className={`health-rate ${tone}`}>{percent(ok, p.requests)}</span>
                </div>
                <div className="meter" aria-hidden="true">
                  <span className={tone} style={{ width: `${rate * 100}%` }} />
                </div>
                <div className="health-meta">
                  <span>{fmt(p.requests)} req</span>
                  <span className={p.errors ? "bad" : ""}>{fmt(p.errors)} err</span>
                  <span>{compact(p.input_tokens + p.output_tokens)} tok</span>
                  <span>{laneSummary(stats?.lanes ?? [], id)}</span>
                  {rpm ? <span>{rpm}</span> : null}
                </div>
                {keys.length > 1 ? (
                  <div className="key-slots">
                    {keys.map(([slot, v]) => (
                      <span
                        key={slot}
                        className={`key-slot${v.errors ? " has-errors" : ""}`}
                        title={`Key slot ${slot}: ${fmt(v.successes)} of ${fmt(v.attempts)} attempts ok, ${fmt(v.errors)} errors`}
                      >
                        #{slot} {fmt(v.successes)}/{fmt(v.attempts)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {cooldowns.map((c) => (
                  <p key={c.slot} className="health-warn">
                    <Clock size={12} aria-hidden="true" />
                    Key slot {c.slot} cooling down · {formatDuration(Math.max(0, c.until_unix_ms - now))}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

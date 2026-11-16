import { Clock, Server } from "lucide-react";
import type { Stats } from "../types";
import { compact, fmt, formatDuration, percent } from "../util";
import { Avatar, Card, Empty } from "./ui";
import { useT, type TFunc } from "../i18n";

function laneSummary(lanes: { who: string; busy: number; waiting: number; limit: number }[], id: string, t: TFunc) {
  const mine = (lanes || []).filter((l) => l.who === id || l.who.startsWith(id + "#"));
  if (mine.length === 0) return t("health.idle");
  return mine
    .map((l) => t("health.inFlight", { busy: l.busy, limit: l.limit }) + (l.waiting ? t("health.waiting", { n: l.waiting }) : ""))
    .join("; ");
}

function rpmSummary(rpm: { who: string; used: number }[], id: string, t: TFunc) {
  const used = (rpm || [])
    .filter((e) => e.who === id || e.who.startsWith(id + "#"))
    .reduce((tt, e) => tt + e.used, 0);
  return used === 0 ? null : t("health.rpm", { n: used });
}

export default function ProviderTotals({ stats }: { stats: Stats | null }) {
  const t = useT();
  const entries = Object.entries(stats?.providers ?? {}).sort((a, b) => b[1].requests - a[1].requests);
  return (
    <Card
      className="health"
      title={t("health.title")}
      icon={<Server size={16} />}
      description={t("health.desc")}
      labelledBy="provider-health-title"
    >
      {entries.length === 0 ? (
        <Empty icon={<Server size={18} />} title={t("health.emptyTitle")}>
          {t("health.emptyCopy")}
        </Empty>
      ) : (
        <ul className="health-list">
          {entries.map(([id, p]) => {
            const ok = Math.max(0, p.requests - p.errors);
            const rate = p.requests ? ok / p.requests : 1;
            const tone = rate >= 0.99 ? "good" : rate >= 0.9 ? "warn" : "bad";
            const cooldowns = stats?.key_cooldowns?.[id] ?? [];
            const now = Date.now();
            const rpm = rpmSummary(stats?.rpm ?? [], id, t);
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
                  <span>{t("health.req", { n: fmt(p.requests) })}</span>
                  <span className={p.errors ? "bad" : ""}>{t("health.err", { n: fmt(p.errors) })}</span>
                  <span>{t("health.tok", { n: compact(p.input_tokens + p.output_tokens) })}</span>
                  <span>{laneSummary(stats?.lanes ?? [], id, t)}</span>
                  {rpm ? <span>{rpm}</span> : null}
                </div>
                {keys.length > 1 ? (
                  <div className="key-slots">
                    {keys.map(([slot, v]) => (
                      <span
                        key={slot}
                        className={`key-slot${v.errors ? " has-errors" : ""}`}
                        title={t("health.keySlotTitle", { slot, ok: fmt(v.successes), total: fmt(v.attempts), errors: fmt(v.errors) })}
                      >
                        {t("health.keySlot", { slot, ok: fmt(v.successes), total: fmt(v.attempts) })}
                      </span>
                    ))}
                  </div>
                ) : null}
                {cooldowns.map((c) => (
                  <p key={c.slot} className="health-warn">
                    <Clock size={12} aria-hidden="true" />
                    {t("health.cooling", { slot: c.slot, dur: formatDuration(Math.max(0, c.until_unix_ms - now)) })}
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

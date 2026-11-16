import { useMemo } from "react";
import { ChartColumn } from "lucide-react";
import type { Stats } from "../types";
import { Card, Empty } from "./ui";
import { fmt } from "../util";
import { useT, type TFunc } from "../i18n";

const STEPS = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 6 * 3600e3, 24 * 3600e3];
const MIN_BARS = 24;
const MAX_BARS = 48;

function stepLabel(step: number, t: TFunc): string {
  if (step < 3600e3) return t("activity.stepMin", { n: step / 60e3 });
  if (step < 24 * 3600e3) return t("activity.stepHour", { n: step / 3600e3 });
  return t("activity.stepDay");
}

function clock(ms: number, step: number): string {
  const d = new Date(ms);
  if (step >= 24 * 3600e3) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export default function Activity({ stats }: { stats: Stats | null }) {
  const t = useT();
  const chart = useMemo(() => {
    const records = stats?.recent_requests ?? [];
    const times = records.map((r) => r.started_unix_ms).filter((t) => t > 0);
    if (!times.length) return null;
    let first = Infinity;
    let last = -Infinity;
    for (const t of times) {
      if (t < first) first = t;
      if (t > last) last = t;
    }
    const step = STEPS.find((s) => (last - first) / s < MAX_BARS) ?? STEPS[STEPS.length - 1];
    const end = Math.floor(last / step) * step;
    const needed = Math.floor((end - Math.floor(first / step) * step) / step) + 1;
    const count = Math.min(MAX_BARS, Math.max(MIN_BARS, needed));
    const start = end - (count - 1) * step;
    const bars = Array.from({ length: count }, (_, i) => ({ at: start + i * step, ok: 0, bad: 0 }));
    for (const r of records) {
      const index = Math.floor((r.started_unix_ms - start) / step);
      if (index < 0 || index >= count) continue;
      if (r.status === "ok") bars[index].ok += 1;
      else bars[index].bad += 1;
    }
    const peak = Math.max(1, ...bars.map((b) => b.ok + b.bad));
    const latencies = records
      .map((r) => r.latency_ms)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    return {
      bars,
      peak,
      step,
      total: records.length,
      errors: records.filter((r) => r.status !== "ok").length,
      p50: quantile(latencies, 0.5),
      p95: quantile(latencies, 0.95),
    };
  }, [stats]);

  return (
    <Card
      className="activity"
      title={t("activity.title")}
      icon={<ChartColumn size={16} />}
      description={chart ? t("activity.desc", { step: stepLabel(chart.step, t) }) : t("activity.descEmpty")}
      actions={
        chart ? (
          <div className="legend" aria-hidden="true">
            <span><i className="swatch ok" />{t("activity.answered")}</span>
            <span><i className="swatch bad" />{t("activity.failed")}</span>
          </div>
        ) : null
      }
      labelledBy="activity-title"
    >
      {chart ? (
        <>
          <div className="activity-stats">
            <div><b>{fmt(chart.total)}</b><span>{t("activity.requests")}</span></div>
            <div><b className={chart.errors ? "bad" : ""}>{fmt(chart.errors)}</b><span>{t("activity.failed")}</span></div>
            <div><b>{chart.p50 == null ? "—" : `${fmt(chart.p50)}`}<small>ms</small></b><span>{t("activity.p50")}</span></div>
            <div><b>{chart.p95 == null ? "—" : `${fmt(chart.p95)}`}<small>ms</small></b><span>{t("activity.p95")}</span></div>
          </div>
          <div className="chart" role="img" aria-label={t("activity.chartLabel", { total: fmt(chart.total), failed: fmt(chart.errors), n: chart.bars.length })}>
            <div className="chart-grid" aria-hidden="true">
              <span data-label={fmt(chart.peak)} />
              <span data-label={fmt(Math.round(chart.peak / 2))} />
              <span data-label="0" />
            </div>
            <div className="chart-bars">
              {chart.bars.map((bar) => {
                const total = bar.ok + bar.bad;
                return (
                  <div
                    key={bar.at}
                    className="chart-col"
                    title={t("activity.barTitle", { time: clock(bar.at, chart.step), total: fmt(total) }) + (bar.bad ? t("activity.barFailed", { bad: fmt(bar.bad) }) : "")}
                  >
                    <div className="chart-stack" style={{ height: `${(total / chart.peak) * 100}%` }}>
                      {bar.bad ? <span className="seg bad" style={{ flexGrow: bar.bad }} /> : null}
                      {bar.ok ? <span className="seg ok" style={{ flexGrow: bar.ok }} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="chart-axis" aria-hidden="true">
              <span>{clock(chart.bars[0].at, chart.step)}</span>
              <span>{clock(chart.bars[Math.floor(chart.bars.length / 2)].at, chart.step)}</span>
              <span>{clock(chart.bars[chart.bars.length - 1].at, chart.step)}</span>
            </div>
          </div>
        </>
      ) : (
        <Empty icon={<ChartColumn size={18} />} title={t("activity.emptyTitle")}>
          {t("activity.emptyCopy")}
        </Empty>
      )}
    </Card>
  );
}

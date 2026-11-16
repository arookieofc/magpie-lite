import type { ReactNode } from "react";
import type { Stats } from "../types";
import { compact, fmt, percent } from "../util";

function Kpi({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note: ReactNode;
  tone?: string;
}) {
  return (
    <div className="kpi">
      <p className="kpi-label">{label}</p>
      <p className={`kpi-value${tone ? ` ${tone}` : ""}`}>
        {value}
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </p>
      <p className="kpi-note">{note}</p>
    </div>
  );
}

export default function Metrics({ stats }: { stats: Stats | null }) {
  const totals = stats?.recent_usage?.totals;
  const input = totals?.input_tokens ?? 0;
  const output = totals?.output_tokens ?? 0;
  const cached = totals?.cache_read_tokens ?? 0;
  const total = stats?.total_requests ?? 0;
  const errors = stats?.errors ?? 0;
  const rate = total ? errors / total : 0;
  const latency = totals?.average_latency_ms;
  return (
    <section className="kpis" aria-label="Gateway totals">
      <Kpi label="Requests" value={stats ? fmt(total) : "—"} note="Since this gateway started" />
      <Kpi
        label="Error rate"
        value={stats ? percent(errors, total) : "—"}
        tone={rate > 0.05 ? "bad" : rate > 0 ? "warn" : undefined}
        note={`${fmt(errors)} final requests not ok`}
      />
      <Kpi
        label="Recent tokens"
        value={stats ? compact(input + output) : "—"}
        note={
          <>
            {compact(input)} in · {compact(output)} out
            {cached ? ` · ${compact(cached)} cached` : ""}
          </>
        }
      />
      <Kpi
        label="Avg latency"
        value={latency == null ? "—" : fmt(latency)}
        unit={latency == null ? undefined : "ms"}
        note={`Across ${fmt(totals?.requests ?? 0)} recent requests`}
      />
    </section>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Activity, Coins, Cpu, Gauge, Zap } from "lucide-react";
import type { RequestRecord, Stats } from "../types";
import { cacheHitRate, compact, decodeSpeed, fmt, fmtCost, hitPct, percent } from "../util";
import { useLocale, useT } from "../i18n";
import { Badge } from "./ui";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const DAYS = 14;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function Face({ n, pos }: { n: number; pos: number }) {
  let offset = (((n - pos) % 10) + 10) % 10;
  if (offset > 5) offset -= 10;
  return (
    <span className="roll-face" style={{ transform: `translateY(${offset * 100}%)` }}>
      {n}
    </span>
  );
}

function Wheel({ digit, snap }: { digit: number; snap: boolean }) {
  const [pos, setPos] = useState(digit);
  const target = useRef(digit);
  useEffect(() => {
    let step = digit - (((target.current % 10) + 10) % 10);
    if (step > 5) step -= 10;
    else if (step < -5) step += 10;
    target.current += step;
    if (step !== 0) setPos(target.current);
  }, [digit]);
  return (
    <span className="roll-wheel" data-snap={snap || undefined}>
      <span className="roll-spacer">0</span>
      {DIGITS.map((n) => (
        <Face key={n} n={n} pos={pos} />
      ))}
    </span>
  );
}

function Roll({ text, className, snap }: { text: string; className?: string; snap?: boolean }) {
  let place = 0;
  let other = 0;
  const glyphs = [...text]
    .reverse()
    .map((char) => {
      const isDigit = char >= "0" && char <= "9";
      return { char, isDigit, key: isDigit ? `d${place++}` : `s${other++}${char}` };
    })
    .reverse();
  return (
    <span className={className ? `roll ${className}` : "roll"}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="roll-visible">
        {glyphs.map((g) =>
          g.isDigit ? (
            <Wheel key={g.key} digit={Number(g.char)} snap={snap ?? false} />
          ) : (
            <span key={g.key} className="roll-static">
              {g.char === " " ? "\u00a0" : g.char}
            </span>
          ),
        )}
      </span>
    </span>
  );
}

interface DayBucket {
  start: number;
  tokens: number;
  requests: number;
}

function buildDays(requests: RequestRecord[], days: number): DayBucket[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const first = now.getTime() - (days - 1) * 86400000;
  const out: DayBucket[] = Array.from({ length: days }, (_, i) => ({
    start: first + i * 86400000,
    tokens: 0,
    requests: 0,
  }));
  for (const r of requests) {
    const t = r.started_unix_ms;
    if (!t) continue;
    const idx = Math.floor((t - first) / 86400000);
    if (idx < 0 || idx >= days) continue;
    const usage = r.usage ?? {};
    out[idx].tokens += (usage.input ?? 0) + (usage.output ?? 0);
    out[idx].requests += 1;
  }
  return out;
}

interface Category {
  id: string;
  used: number;
  other?: boolean;
}

export default function StatsGauge({ stats }: { stats: Stats | null }) {
  const t = useT();
  const { locale } = useLocale();
  const reduce = useReducedMotion();
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [hoverCat, setHoverCat] = useState<string | null>(null);

  const totals = stats?.recent_usage?.totals;
  const input = totals?.input_tokens ?? 0;
  const output = totals?.output_tokens ?? 0;
  const cached = totals?.cache_read_tokens ?? 0;
  const totalTokens = input + output;
  const totalRequests = stats?.total_requests ?? 0;
  const errors = stats?.errors ?? 0;
  const errRate = totalRequests ? errors / totalRequests : 0;
  const cost = totals?.cost;
  const unpriced = totals?.unpriced ?? 0;
  const hit = cacheHitRate(totals ?? {});
  const speed = decodeSpeed(totals ?? {});
  const activeProviders = Object.keys(stats?.providers ?? {}).length;

  const categories = useMemo<Category[]>(() => {
    const entries: Category[] = Object.entries(stats?.recent_usage?.by_provider ?? {}).map(([id, s]) => ({
      id,
      used: (s.input_tokens ?? 0) + (s.output_tokens ?? 0),
    }));
    entries.sort((a, b) => b.used - a.used);
    const top = entries.slice(0, 4);
    const restUsed = entries.slice(4).reduce((a, c) => a + c.used, 0);
    if (restUsed > 0) top.push({ id: "__other", used: restUsed, other: true });
    return top.filter((c) => c.used > 0);
  }, [stats]);

  const scale = Math.max(totalTokens, 1);
  let acc = 0;
  const segments = categories.map((c, i) => {
    const start = (acc / scale) * 100;
    acc += c.used;
    return { ...c, start, end: (acc / scale) * 100, color: COLORS[i % COLORS.length] };
  });

  const days = useMemo(() => buildDays(stats?.recent_requests ?? [], DAYS), [stats]);
  const lastDay = days.length - 1;
  const focusDay = hoverDay !== null && hoverDay <= lastDay ? hoverDay : lastDay;
  const dayAvg = totalTokens / DAYS;

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }),
    [locale],
  );
  const dayLabel = (i: number) => dateFmt.format(new Date(days[i].start));

  function onDaysKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") setHoverDay(Math.max(0, focusDay - 1));
    else if (e.key === "ArrowRight") setHoverDay(Math.min(lastDay, focusDay + 1));
    else if (e.key === "Home") setHoverDay(0);
    else if (e.key === "End" || e.key === "Escape") setHoverDay(null);
    else return;
    e.preventDefault();
  }

  const W = 340;
  const H = 54;
  const gap = 3;
  const barW = (W - gap * (DAYS - 1)) / DAYS;
  const peak = Math.max(dayAvg * 1.6, ...days.map((d) => d.tokens));
  const yFor = (v: number) => H - (v / peak) * (H - 4);

  return (
    <>
      <div className="kpi-grid" aria-label={t("metrics.totals")}>
        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{t("kpi.tokens")}</span>
            <span className="kpi-icon" aria-hidden="true"><Cpu size={14} /></span>
          </div>
          <div className="kpi-val">
            <Roll text={stats ? compact(totalTokens) : "—"} snap={reduce} />
          </div>
          <div className="kpi-sub">
            <span>{t("metrics.tokensInOut", { in: compact(input), out: compact(output) })}</span>
            {cached > 0 ? <Badge tone="accent">{compact(cached)}</Badge> : null}
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{t("kpi.requests")}</span>
            <span className="kpi-icon" aria-hidden="true"><Gauge size={14} /></span>
          </div>
          <div className="kpi-val">
            <Roll text={stats ? fmt(totalRequests) : "—"} snap={reduce} />
          </div>
          <div className="kpi-sub">
            <span>
              {totals?.average_latency_ms != null
                ? t("kpi.avgLatency", { ms: fmt(totals.average_latency_ms) })
                : t("metrics.sinceStarted")}
            </span>
            {stats ? (
              <Badge tone={errRate > 0.05 ? "bad" : errors > 0 ? "warn" : "good"}>
                {errors > 0 ? percent(errors, totalRequests) : t("kpi.healthy")}
              </Badge>
            ) : null}
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{t("kpi.spend")}</span>
            <span className="kpi-icon" aria-hidden="true"><Coins size={14} /></span>
          </div>
          <div className="kpi-val" title={t("metrics.costTitle", { n: fmt(unpriced) })}>
            {stats ? fmtCost(cost, unpriced) : "—"}
          </div>
          <div className="kpi-sub">
            <span title={t("metrics.hitTitle")}>{t("kpi.cacheHit", { p: hitPct(hit) })}</span>
            {unpriced > 0 ? <span className="text-muted">{t("usage.unpricedTitle", { n: fmt(unpriced) })}</span> : null}
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{t("kpi.throughput")}</span>
            <span className="kpi-icon" aria-hidden="true"><Zap size={14} /></span>
          </div>
          <div className="kpi-val" title={t("metrics.speedTitle", { n: fmt(totals?.decode_n ?? 0) })}>
            {speed > 0 ? t("metrics.tps", { n: fmt(Math.round(speed)) }) : "—"}
          </div>
          <div className="kpi-sub">
            <span>{t("kpi.providersActive", { n: activeProviders })}</span>
            <span className={errors ? "text-bad" : "text-good"}>
              {errors ? t("metrics.finalNotOk", { errors: fmt(errors) }) : t("gauge.noErrors")}
            </span>
          </div>
        </article>
      </div>

      <section className="gauge-panel" aria-label={t("gauge.title")}>
        <div className="gauge-col">
          <div className="gauge-col-head">
            <span className="gauge-col-title">{t("kpi.shareTitle")}</span>
            <span className="gauge-col-meta">{compact(totalTokens)} {t("gauge.unitTokens")}</span>
          </div>
          <div
            className="gauge-track"
            role="meter"
            aria-label={t("gauge.meterAria", { total: fmt(totalTokens), n: segments.length })}
            aria-valuemin={0}
            aria-valuemax={totalTokens}
            aria-valuenow={totalTokens}
          >
            {segments.map((s) => (
              <div
                key={s.id}
                className="gauge-seg"
                style={{
                  left: `${s.start.toFixed(3)}%`,
                  width: `${Math.max(s.end - s.start, 0).toFixed(3)}%`,
                  backgroundColor: s.color,
                  opacity: hoverCat && hoverCat !== s.id ? 0.28 : 1,
                }}
              />
            ))}
          </div>
          {segments.length ? (
            <ul className="gauge-legend" aria-label={t("gauge.legendAria")}>
              {segments.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="gauge-legend-row"
                    onBlur={() => setHoverCat(null)}
                    onFocus={() => setHoverCat(s.id)}
                    onPointerEnter={() => setHoverCat(s.id)}
                    onPointerLeave={() => setHoverCat(null)}
                  >
                    <span className="gauge-dot" style={{ backgroundColor: s.color }} />
                    <span className="gauge-cat">{s.other ? t("gauge.other") : s.id}</span>
                    <span className="gauge-cat-value">{compact(s.used)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gauge-empty">
              <Activity size={13} aria-hidden="true" />
              {t("gauge.empty")}
            </p>
          )}
        </div>

        <div className="gauge-col">
          <div className="gauge-col-head">
            <span className="gauge-col-title">{t("kpi.velocityTitle")}</span>
            <span className="gauge-col-meta">
              {dayLabel(focusDay)} · {t("gauge.dayValue", { tokens: compact(days[focusDay].tokens), n: days[focusDay].requests })}
            </span>
          </div>
          <div
            className="gauge-daily"
            role="group"
            tabIndex={0}
            aria-label={t("gauge.dailyAria")}
            onBlur={() => setHoverDay(null)}
            onKeyDown={onDaysKey}
          >
            <svg
              aria-hidden="true"
              className="gauge-bars"
              onPointerLeave={() => setHoverDay(null)}
              preserveAspectRatio="none"
              viewBox={`0 0 ${W} ${H}`}
            >
              {days.map((d, i) => {
                const x = i * (barW + gap);
                const active = i === focusDay;
                const over = d.tokens > dayAvg * 1.25 && d.tokens > 0;
                return (
                  <g key={d.start} onPointerEnter={() => setHoverDay(i)}>
                    <rect fill="transparent" height={H} width={barW + gap} x={x - gap / 2} y={0} />
                    <rect
                      className={`gauge-bar${active ? " active" : ""}${over ? " over" : ""}`}
                      height={Math.max(H - yFor(d.tokens), 2)}
                      rx={2}
                      width={barW}
                      x={x}
                      y={d.tokens > 0 ? yFor(d.tokens) : H - 2}
                    />
                  </g>
                );
              })}
              <line
                className="gauge-avg-line"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                x1={0}
                x2={W}
                y1={yFor(dayAvg)}
                y2={yFor(dayAvg)}
              />
            </svg>
            <div className="gauge-daily-foot">
              <span>{dayLabel(0)}</span>
              <span className="gauge-avg-label">
                <span className="gauge-avg-dash" aria-hidden="true" />
                {t("gauge.dailyAvg", { v: compact(dayAvg) })}
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

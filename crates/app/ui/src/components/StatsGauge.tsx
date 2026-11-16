import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Activity } from "lucide-react";
import type { RequestRecord, Stats } from "../types";
import { compact, fmt, percent } from "../util";
import { useLocale, useT } from "../i18n";

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
              {g.char === " " ? " " : g.char}
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
  const rate = totalRequests ? errors / totalRequests : 0;

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
  const H = 52;
  const gap = 2;
  const barW = (W - gap * (DAYS - 1)) / DAYS;
  const peak = Math.max(dayAvg * 1.6, ...days.map((d) => d.tokens));
  const yFor = (v: number) => H - (v / peak) * (H - 4);

  return (
    <section className="card gauge" aria-label={t("gauge.title")}>
      <div className="gauge-head">
        <div className="gauge-title">
          <span className="gauge-eyebrow">{t("gauge.title")}</span>
          <div className="gauge-hero">
            <Roll className="gauge-number" text={stats ? compact(totalTokens) : "—"} snap={reduce} />
            <span className="gauge-unit">{t("gauge.unitTokens")}</span>
          </div>
          <p className="gauge-sub">
            {t("metrics.tokensInOut", { in: compact(input), out: compact(output) })}
            {cached ? t("metrics.cached", { cached: compact(cached) }) : ""}
          </p>
        </div>
        <div className="gauge-side">
          <p className={`gauge-rate${rate > 0.05 ? " bad" : rate > 0 ? " warn" : ""}`}>
            <Roll text={stats ? percent(errors, totalRequests) : "—"} snap={reduce} />
          </p>
          <p className="gauge-sub">
            {stats
              ? t("gauge.reqLine", { n: fmt(totalRequests), ms: totals?.average_latency_ms == null ? "—" : fmt(totals.average_latency_ms) })
              : "—"}
          </p>
        </div>
      </div>

      <div className="gauge-meter-block">
        <div
          className="gauge-meter"
          role="meter"
          aria-label={t("gauge.meterAria", { total: fmt(totalTokens), n: segments.length })}
          aria-valuemin={0}
          aria-valuemax={totalTokens}
          aria-valuenow={Math.min(totalTokens, totalTokens)}
        >
          <div className="gauge-track">
            {segments.map((s) => (
              <div
                key={s.id}
                className="gauge-seg"
                style={{
                  left: `${s.start.toFixed(3)}%`,
                  width: `${Math.max(s.end - s.start, 0).toFixed(3)}%`,
                  backgroundColor: s.color,
                  opacity: hoverCat && hoverCat !== s.id ? 0.3 : 1,
                }}
              />
            ))}
          </div>
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

      <div
        className="gauge-daily"
        role="group"
        tabIndex={0}
        aria-label={t("gauge.dailyAria")}
        onBlur={() => setHoverDay(null)}
        onKeyDown={onDaysKey}
      >
        <div className="gauge-daily-head">
          <span>{dayLabel(focusDay)}</span>
          <span className="gauge-daily-value">
            {t("gauge.dayValue", { tokens: compact(days[focusDay].tokens), n: days[focusDay].requests })}
          </span>
        </div>
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
                  rx={1.5}
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

      <div className="gauge-foot">
        <p aria-live="polite" className="gauge-status">
          {t("gauge.perDay", { v: compact(dayAvg) })}
        </p>
        <p className={`gauge-status${errors ? " bad" : ""}`}>
          {errors ? t("metrics.finalNotOk", { errors: fmt(errors) }) : t("gauge.noErrors")}
        </p>
      </div>
    </section>
  );
}


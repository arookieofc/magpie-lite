import { useEffect, useMemo, useRef, useState } from "react";
import { Radio } from "lucide-react";
import type { Config, RequestRecord, Stats, TraceResponse, TryRecord } from "../types";
import { fmt, formatDuration, timeOf } from "../util";
import { MagpieMark } from "./Sidebar";
import { Badge, Card, Empty } from "./ui";
import { useT, type TFunc } from "../i18n";

function tryStep(t: TryRecord, isLast: boolean, tr: TFunc): { text: string; cls: string } {
  const who = `${t.provider}/${t.model}`;
  const key = t.key_slot ? tr("route.keySlot", { n: t.key_slot + 1 }) : "";
  const effort = t.effort ? tr("route.effortAt", { effort: t.effort }) : "";
  if (!t.status) return { text: `${who}${key}${effort} ${tr("route.asked")}`, cls: "wait" };
  if (t.status === "ok") {
    const parts: string[] = [];
    if (t.ms) parts.push(tr("route.answeredIn", { ms: t.ms }));
    if (t.first_ms) parts.push(tr("route.firstBytes", { ms: t.first_ms }));
    return { text: `${who}${key}${effort} ${parts.join(", ") || tr("route.answeredGeneric")}`, cls: "ok" };
  }
  const bits = [`${who}${key}${effort}`];
  bits.push(
    t.status === "network_error"
      ? tr("route.unreachable")
      : t.status === "refusal"
        ? tr("route.refused")
        : t.status === "queue_refused"
          ? tr("route.queueFull")
          : t.status === "rpm_refused"
            ? tr("route.rpmOut")
            : /^\d+$/.test(t.status)
              ? tr("route.answeredStatus", { status: t.status })
              : tr("route.failedAs", { status: t.status }),
  );
  if (t.queued_ms) bits.push(tr("route.waitedSlot", { ms: t.queued_ms }));
  if (t.rest_ms) bits.push(tr("route.rests", { dur: formatDuration(t.rest_ms) }));
  if (!isLast) bits.push(tr("route.nextAsked"));
  return { text: bits.join(" · "), cls: "bad" };
}

function requestCaption(r: RequestRecord, tr: TFunc): string {
  const tries = r.tries ?? [];
  const answered = tries.find((t) => t.status === "ok");
  if (answered) {
    const who = `${answered.provider}/${answered.model}`;
    if (answered.ms && tries.length > 1)
      return tr("route.answeredViaTries", { who, ms: answered.ms, n: tries.length });
    if (answered.ms) return tr("route.answeredVia", { who, ms: answered.ms });
    return who;
  }
  const last = tries[tries.length - 1];
  if (last) return tr("route.lastFailed", { who: `${last.provider}/${last.model}`, status: r.status || tr("route.incomplete") });
  return r.status || tr("route.incomplete");
}

interface Props {
  trace: TraceResponse | null;
  config: Config | null;
  stats: Stats | null;
}

export default function Routing({ trace }: Props) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const srcsRef = useRef<HTMLDivElement>(null);
  const acctsRef = useRef<HTMLOListElement>(null);
  const wiresRef = useRef<SVGSVGElement>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const routes = useMemo(
    () => [...(trace?.routes ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [trace],
  );
  const latest = routes[routes.length - 1];
  const active =
    (selectedSeq !== null ? routes.find((r) => r.seq === selectedSeq) : undefined) ?? latest;
  const pinned = selectedSeq !== null && active?.seq !== latest?.seq;

  useEffect(() => {
    if (!active) return;
    const stage = stageRef.current;
    if (!stage) return;
    const draw = () => {
      const svg = wiresRef.current;
      const hub = stage.querySelector(".rt-hub");
      if (!svg || !hub) return;
      const stageBox = stage.getBoundingClientRect();
      if (stageBox.width === 0) return;
      const hubBox = hub.getBoundingClientRect();
      const NS = "http://www.w3.org/2000/svg";
      svg.setAttribute("viewBox", `0 0 ${stageBox.width} ${stageBox.height}`);
      svg.replaceChildren();
      const wire = (x1: number, y1: number, x2: number, y2: number, live: boolean) => {
        const path = document.createElementNS(NS, "path");
        const sx = x1 - stageBox.left;
        const sy = y1 - stageBox.top;
        const tx = x2 - stageBox.left;
        const ty = y2 - stageBox.top;
        const bend = Math.max(28, (tx - sx) * 0.45);
        path.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy} ${tx - bend} ${ty} ${tx} ${ty}`);
        if (live) path.setAttribute("class", "live");
        svg.append(path);
      };
      const hubLeft = hubBox.left;
      const hubMidY = hubBox.top + hubBox.height / 2;
      srcsRef.current?.querySelectorAll(".rt-node").forEach((src) => {
        const b = src.getBoundingClientRect();
        wire(b.right, b.top + b.height / 2, hubLeft, hubMidY, true);
      });
      acctsRef.current?.querySelectorAll("li").forEach((acct) => {
        const ab = acct.getBoundingClientRect();
        wire(
          hubBox.right,
          hubMidY,
          ab.left,
          ab.top + ab.height / 2,
          acct.classList.contains("ok") || acct.classList.contains("wait"),
        );
      });
    };
    const id = requestAnimationFrame(draw);
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, [active, trace]);

  const tries = active?.tries ?? [];
  const srcAgents = new Map<string, RequestRecord>();
  for (const r of routes.slice(-6)) {
    const key = r.client_protocol || t("route.agentFallback");
    if (!srcAgents.has(key)) srcAgents.set(key, r);
  }
  const rerouted = routes.filter((r) => (r.tries ?? []).length > 1).length;
  const failed = routes.filter((r) => r.status !== "ok").length;

  return (
    <Card
      className="live"
      title={t("route.title")}
      icon={<Radio size={16} />}
      description={t("route.desc")}
      labelledBy="routing-live-title"
      actions={
        active ? (
          <div className="live-stats">
            <span><b>{fmt(routes.length)}</b> {t("route.requests")}</span>
            <span><b>{fmt(rerouted)}</b> {t("route.rerouted")}</span>
            <span><b className={failed ? "text-bad" : ""}>{fmt(failed)}</b> {t("route.errors")}</span>
            {pinned ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => setSelectedSeq(null)}
              >
                {t("route.latest")}
              </button>
            ) : (
              <Badge tone="good" dot>{t("route.live")}</Badge>
            )}
          </div>
        ) : (
          <Badge tone="neutral" dot>{t("route.waiting")}</Badge>
        )
      }
    >
      {active ? (
        <>
          <div className="rt-stage" ref={stageRef}>
            <svg className="rt-wires" ref={wiresRef} aria-hidden="true"></svg>
            <div className="rt-srcs" ref={srcsRef}>
              {[...srcAgents.values()].map((r) => (
                <div key={r.client_protocol} className="rt-node rt-src">
                  <b>{r.client_protocol || t("route.agentFallback")}</b>
                  <small data-tip={r.requested_model}>{r.requested_model}</small>
                </div>
              ))}
            </div>
            <div className="rt-node rt-hub">
              <span className="rt-hub-mark">
                <MagpieMark size={20} />
              </span>
              <b>magpie</b>
              <small>127.0.0.1</small>
            </div>
            <ol className="rt-accts" ref={acctsRef}>
              {tries.map((tt, i) => (
                <li key={i} className={tt.status === "ok" ? "ok" : tt.status ? "bad" : "wait"}>
                  <span className="dot"></span>
                  <b data-tip={`${tt.provider}/${tt.model}`}>
                    {tt.provider}/{tt.model}
                    {tt.key_slot ? t("route.keySlot", { n: tt.key_slot + 1 }) : ""}
                  </b>
                  <em>
                    {[
                      tt.ms ? `${tt.ms}ms` : "",
                      tt.rest_ms ? t("route.rests", { dur: formatDuration(tt.rest_ms) }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || (tt.status && tt.status !== "ok" ? tt.status : "")}
                  </em>
                </li>
              ))}
            </ol>
          </div>

          <div className="rt-cols">
            <div className="rt-trace">
              <div className="rt-head">
                <span className="rt-head-left">
                  {t("route.decision", { time: timeOf(active.started_unix_ms) })}
                  <span className={active.status === "ok" ? "text-good" : "text-bad"}>
                    {requestCaption(active, t)}
                  </span>
                </span>
              </div>
              <ol className="rt-steps">
                <li className="why">
                  {active.requested_model.startsWith("group/")
                    ? t("route.askedGroup", { agent: active.client_protocol, group: active.requested_model })
                    : t("route.askedModel", { agent: active.client_protocol, model: active.requested_model })}
                </li>
                {active.replans ? (
                  <li className="aside">
                    {t("route.replanned", { ms: active.replan_waited_ms, n: active.replans })}
                  </li>
                ) : null}
                {tries.map((tt, i) => {
                  const { text, cls } = tryStep(tt, i === tries.length - 1, t);
                  return (
                    <li key={i} className={cls}>
                      {text}
                    </li>
                  );
                })}
                {!tries.length && active.status ? (
                  <li className="bad">{t("route.nothingTried", { status: active.status })}</li>
                ) : null}
              </ol>
            </div>
            <div className="rt-stream">
              <div className="rt-head">
                <span>{t("route.stream")}</span>
                <span className="text-muted">{t("route.inspectHint")}</span>
              </div>
              <div className="rt-reqs">
                {routes
                  .slice(-40)
                  .reverse()
                  .map((r) => {
                    const n = (r.tries ?? []).length;
                    const isActive = r.seq === active.seq;
                    return (
                      <button
                        key={r.seq}
                        type="button"
                        className={`rt-req ${r.status === "ok" ? "ok" : "bad"}${isActive ? " active" : ""}`}
                        onClick={() => setSelectedSeq(r.seq === latest?.seq ? null : (r.seq ?? null))}
                      >
                        <span className="when">{timeOf(r.started_unix_ms)}</span>
                        <span className="what">
                          <b>{r.requested_model}</b>
                          <span>{r.client_protocol}</span>
                        </span>
                        <span className="out">
                          {n > 1 ? <span className="tries">{t("req.tries", { n })}</span> : null}
                          {r.latency_ms ? `${fmt(r.latency_ms)}ms` : ""}
                          <span className="state">{r.status || "…"}</span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <Empty icon={<Radio size={18} />} title={t("route.emptyTitle")}>
          {t("route.emptyCopy")}
        </Empty>
      )}
    </Card>
  );
}

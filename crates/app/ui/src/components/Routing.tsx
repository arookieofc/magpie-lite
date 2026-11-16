import { useEffect, useRef } from "react";
import { Radio } from "lucide-react";
import type { Config, RequestRecord, Stats, TraceResponse, TryRecord } from "../types";
import { fmt, formatDuration, timeOf } from "../util";
import { MagpieMark } from "./Topbar";
import { Badge, Card, Empty } from "./ui";

function tryStep(t: TryRecord, isLast: boolean): { text: string; cls: string } {
  const who = `${t.provider}/${t.model}`;
  const key = t.key_slot ? ` · key ${t.key_slot + 1}` : "";
  const effort = t.effort ? ` at ${t.effort}` : "";
  if (!t.status) return { text: `${who}${key}${effort} is being asked…`, cls: "wait" };
  if (t.status === "ok") {
    const parts: string[] = [];
    if (t.ms) parts.push(`answered in ${t.ms}ms`);
    if (t.first_ms) parts.push(`first bytes ${t.first_ms}ms`);
    return { text: `${who}${key}${effort} ${parts.join(", ") || "answered"}`, cls: "ok" };
  }
  const bits = [`${who}${key}${effort}`];
  bits.push(
    t.status === "network_error"
      ? "could not be reached"
      : t.status === "refusal"
        ? "refused"
        : t.status === "queue_refused"
          ? "had a full queue"
          : t.status === "rpm_refused"
            ? "was out of minute room"
            : /^\d+$/.test(t.status)
              ? `answered ${t.status}`
              : `failed as ${t.status}`,
  );
  if (t.queued_ms) bits.push(`waited ${t.queued_ms}ms for a slot`);
  if (t.rest_ms) bits.push(`rests ${formatDuration(t.rest_ms)}`);
  if (!isLast) bits.push("so the next was asked");
  return { text: bits.join(" · "), cls: "bad" };
}

function requestCaption(r: RequestRecord): string {
  const tries = r.tries ?? [];
  const answered = tries.find((t) => t.status === "ok");
  if (answered) {
    const parts = [`${answered.provider}/${answered.model}`];
    if (answered.ms) parts.push(`answered in ${answered.ms}ms`);
    if (tries.length > 1) parts.push(`after ${tries.length} tries`);
    return parts.join(" · ");
  }
  const last = tries[tries.length - 1];
  if (last) return `${last.provider}/${last.model} · ${r.status || "failed"}`;
  return r.status || "incomplete";
}

interface Props {
  trace: TraceResponse | null;
  config: Config | null;
  stats: Stats | null;
}

export default function Routing({ trace }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const srcsRef = useRef<HTMLDivElement>(null);
  const acctsRef = useRef<HTMLOListElement>(null);
  const wiresRef = useRef<SVGSVGElement>(null);

  const routes = [...(trace?.routes ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const latest = routes[routes.length - 1];

  // Draw the bezier wires once the cards lay out: left column (agent
  // sources) to the hub, hub to each tried account on the right. A
  // ResizeObserver redraws when the view is shown again or resized.
  useEffect(() => {
    if (!latest) return;
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
  }, [latest, trace]);

  const tries = latest?.tries ?? [];
  const srcAgents = new Map<string, RequestRecord>();
  for (const r of routes.slice(-6)) {
    const key = r.client_protocol || "agent";
    if (!srcAgents.has(key)) srcAgents.set(key, r);
  }
  const rerouted = routes.filter((r) => (r.tries ?? []).length > 1).length;
  const failed = routes.filter((r) => r.status !== "ok").length;

  return (
    <Card
      className="live"
      title="Live routing"
      icon={<Radio size={16} />}
      description="The gateway's own record of each request, as it decides."
      labelledBy="routing-live-title"
      actions={
        latest ? (
          <div className="live-stats">
            <span><b>{fmt(routes.length)}</b> requests</span>
            <span><b>{fmt(rerouted)}</b> rerouted</span>
            <span><b className={failed ? "text-bad" : ""}>{fmt(failed)}</b> errors</span>
            <Badge tone="good" dot>Live</Badge>
          </div>
        ) : (
          <Badge tone="neutral" dot>Waiting</Badge>
        )
      }
    >
      {latest ? (
        <>
          <div className="rt-stage" ref={stageRef}>
            <svg className="rt-wires" ref={wiresRef} aria-hidden="true"></svg>
            <div className="rt-srcs" ref={srcsRef}>
              {[...srcAgents.values()].map((r) => (
                <div key={r.client_protocol} className="rt-node rt-src">
                  <b>{r.client_protocol || "agent"}</b>
                  <small title={r.requested_model}>{r.requested_model}</small>
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
              {tries.map((t, i) => (
                <li key={i} className={t.status === "ok" ? "ok" : t.status ? "bad" : "wait"}>
                  <span className="dot"></span>
                  <b title={`${t.provider}/${t.model}`}>
                    {t.provider}/{t.model}
                    {t.key_slot ? ` · key ${t.key_slot + 1}` : ""}
                  </b>
                  <em>
                    {[t.ms ? `${t.ms}ms` : "", t.rest_ms ? `rests ${formatDuration(t.rest_ms)}` : ""]
                      .filter(Boolean)
                      .join(" · ") || (t.status && t.status !== "ok" ? t.status : "")}
                  </em>
                </li>
              ))}
            </ol>
          </div>

          <div className="rt-cols">
            <div className="rt-trace">
              <p className="rt-head">
                Decision · {timeOf(latest.started_unix_ms)}
                <span className={latest.status === "ok" ? "text-good" : "text-bad"}>
                  {requestCaption(latest)}
                </span>
              </p>
              <ol className="rt-steps">
                <li className="why">
                  {latest.requested_model.startsWith("group/")
                    ? `${latest.client_protocol} asked for the routing group ${latest.requested_model}`
                    : `${latest.client_protocol} asked for ${latest.requested_model}`}
                </li>
                {latest.replans ? (
                  <li className="aside">
                    Every member was busy: it waited {latest.replan_waited_ms}ms and asked them
                    again {latest.replans}×
                  </li>
                ) : null}
                {tries.map((t, i) => {
                  const { text, cls } = tryStep(t, i === tries.length - 1);
                  return (
                    <li key={i} className={cls}>
                      {text}
                    </li>
                  );
                })}
                {!tries.length && latest.status ? (
                  <li className="bad">Nothing was tried: {latest.status}</li>
                ) : null}
              </ol>
            </div>
            <div className="rt-stream">
              <p className="rt-head">Stream</p>
              <div className="rt-reqs">
                {routes
                  .slice(-40)
                  .reverse()
                  .map((r) => {
                    const n = (r.tries ?? []).length;
                    return (
                      <div key={r.seq} className={`rt-req ${r.status === "ok" ? "ok" : "bad"}`}>
                        <span className="when">{timeOf(r.started_unix_ms)}</span>
                        <span className="what">
                          <b>{r.requested_model}</b>
                          <span>{r.client_protocol}</span>
                        </span>
                        <span className="out">
                          {n > 1 ? <span className="tries">{n} tries</span> : null}
                          {r.latency_ms ? `${fmt(r.latency_ms)}ms` : ""}
                          <span className="state">{r.status || "…"}</span>
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <Empty icon={<Radio size={18} />} title="No request has been routed yet">
          When one arrives, its path plays out here.
        </Empty>
      )}
    </Card>
  );
}

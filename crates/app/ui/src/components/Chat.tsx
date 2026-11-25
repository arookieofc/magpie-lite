import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy, Eraser, MessagesSquare, SendHorizontal, User } from "lucide-react";
import { post } from "../api";
import type { Config, ModelsResponse } from "../types";
import Select from "./Select";
import { useT } from "../i18n";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface ChatReply {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

export default function Chat({
  models,
  config,
}: {
  models: ModelsResponse | null;
  config: Config | null;
}) {
  const t = useT();
  const options = useMemo(() => {
    const ids = new Set<string>();
    for (const m of models?.data ?? []) ids.add(m.id);
    for (const g of config?.groups ?? []) {
      if (g.hidden) continue;
      ids.add(g.auto && g.name ? `auto/${g.name}` : `group/${g.id}`);
    }
    return [...ids];
  }, [models, config]);
  const [model, setModel] = useState("");
  const picked = model || options[0] || "";
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending]);

  async function send(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || sending || !picked) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    if (!override) setDraft("");
    setSending(true);
    setError("");
    setMeta("");
    const started = performance.now();
    try {
      const reply = await post<ChatReply>("/v1/chat/completions", {
        model: picked,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      });
      const answer = textOf(reply.choices?.[0]?.message?.content) || "—";
      setMsgs([...next, { role: "assistant", content: answer }]);
      const ms = Math.round(performance.now() - started);
      const u = reply.usage;
      setMeta(
        t("chat.gotReply", {
          ms,
          tokens:
            u && (u.prompt_tokens || u.completion_tokens)
              ? `${u.prompt_tokens ?? 0}+${u.completion_tokens ?? 0}`
              : "—",
        }),
      );
    } catch (e) {
      setError((e as Error).message || t("chat.failed"));
    } finally {
      setSending(false);
    }
  }

  const starters = [t("chat.starter1"), t("chat.starter2"), t("chat.starter3")];

  return (
    <section className="chat-workspace" aria-label={t("chat.cardTitle")}>
      <div className="chat-head">
        <div className="chat-head-left">
          <span className="card-icon" aria-hidden="true">
            <MessagesSquare size={15} />
          </span>
          <Select
            mono
            value={picked}
            onChange={setModel}
            aria-label={t("chat.modelLabel")}
            disabled={sending}
            options={
              options.length === 0
                ? [{ value: picked, label: picked || "—" }]
                : options.map((id) => ({ value: id, label: id }))
            }
          />
        </div>
        <div className="chat-head-right">
          {meta && !error ? <span className="pill-mini mono">{meta}</span> : null}
          <button
            type="button"
            className="btn sm ghost"
            disabled={sending || msgs.length === 0}
            onClick={() => {
              setMsgs([]);
              setError("");
              setMeta("");
            }}
          >
            <Eraser size={14} aria-hidden="true" />
            {t("chat.clear")}
          </button>
        </div>
      </div>

      <div className="chat-list" ref={listRef} role="log" aria-live="polite" aria-label={t("chat.cardTitle")}>
        {msgs.length === 0 ? (
          <div className="chat-empty">
            <span className="empty-icon" aria-hidden="true">
              <Bot size={20} />
            </span>
            <p className="empty-title">{t("chat.emptyTitle")}</p>
            <p className="empty-copy">{t("chat.emptyBody")}</p>
            {picked ? (
              <div className="chat-starters">
                {starters.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="chat-starter"
                    disabled={sending}
                    onClick={() => send(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`chat-row ${m.role}`}>
              <span className="chat-avatar" aria-hidden="true">
                {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </span>
              <div className="chat-bubble-wrap">
                <div className="chat-bubble">{m.content}</div>
                {m.role === "assistant" ? (
                  <button
                    type="button"
                    className="chat-copy"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(m.content);
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx(null), 1400);
                      } catch {
                        /* clipboard unavailable */
                      }
                    }}
                  >
                    {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
                    {copiedIdx === i ? t("chat.copied") : t("chat.copy")}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="chat-row assistant">
            <span className="chat-avatar" aria-hidden="true">
              <Bot size={14} />
            </span>
            <div className="chat-bubble-wrap">
              <div className="chat-bubble thinking" aria-label={t("chat.thinking")}>
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="chat-foot">
        {error ? (
          <p className="req-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="chat-composer">
          <textarea
            className="input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("chat.inputPh")}
            aria-label={t("chat.inputPh")}
            disabled={sending || !picked}
          />
          <button
            type="button"
            className="btn primary"
            disabled={sending || !draft.trim() || !picked}
            onClick={() => send()}
          >
            <SendHorizontal size={15} aria-hidden="true" />
            {t("chat.send")}
          </button>
        </div>
        <div className="chat-composer-foot">
          <span>{t("chat.cardDesc")}</span>
          <span>{t("chat.hintEnter")}</span>
        </div>
      </div>
    </section>
  );
}

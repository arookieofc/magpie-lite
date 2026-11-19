import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Eraser, MessagesSquare, SendHorizontal, User } from "lucide-react";
import { post } from "../api";
import type { Config, ModelsResponse } from "../types";
import { Card, Empty } from "./ui";
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || !picked) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setDraft("");
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

  return (
    <Card
      title={t("chat.cardTitle")}
      icon={<MessagesSquare size={16} />}
      description={t("chat.cardDesc")}
      className="chat"
      actions={
        <>
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
        </>
      }
    >
      <div className="chat-list" ref={listRef} role="log" aria-live="polite" aria-label={t("chat.cardTitle")}>
        {msgs.length === 0 ? (
          <Empty
            icon={<Bot size={18} />}
            title={t("chat.emptyTitle")}
          >
            {t("chat.emptyBody")}
          </Empty>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`chat-row ${m.role}`}>
              <span className="chat-avatar" aria-hidden="true">
                {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </span>
              <div className="chat-bubble">{m.content}</div>
            </div>
          ))
        )}
        {sending ? (
          <div className="chat-row assistant">
            <span className="chat-avatar" aria-hidden="true">
              <Bot size={14} />
            </span>
            <div className="chat-bubble thinking" aria-label={t("chat.thinking")}>
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="chat-error" role="alert">
          {error}
        </p>
      ) : null}
      {meta && !error ? <p className="chat-meta">{meta}</p> : null}
      <div className="chat-composer">
        <input
          className="input"
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
          onClick={send}
        >
          <SendHorizontal size={15} aria-hidden="true" />
          {t("chat.send")}
        </button>
      </div>
    </Card>
  );
}

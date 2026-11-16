import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Eye,
  FileText,
  Info,
  RefreshCw,
  Terminal,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import * as api from "../api";
import type {
  Agent,
  AgentPreview,
  AgentsResponse,
  Config,
  ModelsResponse,
} from "../types";
import { fmt } from "../util";
import {
  Avatar,
  Badge,
  Card,
  Empty,
  Field,
  FormSection,
  Notice,
  PageHeader,
  Segmented,
  Sheet,
  type Tone,
} from "./ui";
import { useT } from "../i18n";

interface Props {
  agents: AgentsResponse | null;
  agentsError: string | null;
  models: ModelsResponse | null;
  config: Config | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}

export default function Agents({
  agents,
  agentsError,
  config,
  busy,
  setBusy,
  onChanged,
}: Props) {
  const t = useT();
  const list = useMemo(() => agents?.agents ?? [], [agents]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [action, setAction] = useState("connect");
  const [model, setModel] = useState("");
  const [preview, setPreview] = useState<AgentPreview | null>(null);
  const [message, setMessage] = useState("");

  const routes = useMemo(() => {
    const values = new Set<string>();
    for (const provider of config?.providers ?? []) {
      for (const id of provider.models ?? []) values.add(`${provider.id}/${id}`);
    }
    for (const group of config?.groups ?? []) {
      values.add(group.auto && group.name ? `auto/${group.name}` : `group/${group.id}`);
    }
    return [...values];
  }, [config]);

  const agent = editingId ? list.find((item) => item.id === editingId) ?? null : null;
  const fingerprint = JSON.stringify(agent ?? null);
  useEffect(() => {
    setPreview(null);
  }, [fingerprint]);

  useEffect(() => {
    if (editingId && !list.some((item) => item.id === editingId)) {
      setEditingId(null);
      setPreview(null);
    }
  }, [editingId, list]);

  const pending = Boolean(agent?.recovery_needed);
  const connect = action === "connect";

  function open(target: Agent) {
    if (busy) return;
    setEditingId(target.id);
    setAction("connect");
    setModel(target.model || routes[0] || "");
    setPreview(null);
    setMessage(
      target.recovery_needed
        ? t("agents.recoveryMsg")
        : target.drifted
          ? t("agents.driftMsg")
          : "",
    );
  }

  function close() {
    if (busy) return;
    setEditingId(null);
    setPreview(null);
    setMessage("");
  }

  function editBody() {
    return connect ? { action, model: model.trim() } : { action };
  }

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !agent) return;
    if (connect && !model.trim()) {
      setMessage(t("agents.chooseRoute"));
      return;
    }
    setBusy(true);
    setMessage(t("agents.preparing"));
    try {
      const result = await api.post<AgentPreview>(
        `/agents/${encodeURIComponent(agent.id)}/preview`,
        editBody(),
      );
      setPreview(result);
      setMessage(t("agents.previewReady"));
    } catch (err) {
      setPreview(null);
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    if (busy || !agent || !preview) return;
    setBusy(true);
    setMessage(t("agents.applying"));
    try {
      const result = await api.post<Agent>(`/agents/${encodeURIComponent(agent.id)}/apply`, {
        ...editBody(),
        revision: preview.revision,
      });
      setPreview(null);
      setMessage(
        connect
          ? t("agents.connectedTo", { model: result.model ?? model, notice: result.notice ?? "" }).trim()
          : t("agents.restored", { notice: result.notice ?? "" }).trim(),
      );
      onChanged();
    } catch (err) {
      setMessage(
        `${(err as Error).message}${t("agents.previewRetry")}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function runRecover() {
    if (busy || !agent) return;
    if (
      !window.confirm(
        t("agents.recoverConfirm", { name: agent.name }),
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(t("agents.recovering"));
    try {
      const result = await api.post<Agent>(`/agents/${encodeURIComponent(agent.id)}/recover`);
      setMessage(t("agents.recovered", { notice: result.notice ?? "" }).trim());
      onChanged();
    } catch (err) {
      setMessage(`${(err as Error).message}${t("agents.recoverRetry")}`);
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    connected: list.filter((a) => a.connected).length,
    detected: list.filter((a) => a.detected || a.detection?.config_file || a.detection?.cli).length,
    attention: list.filter((a) => a.drifted || a.recovery_needed).length,
  };

  function statusOf(status: Agent): { label: string; tone: Tone } {
    if (status.recovery_needed) return { label: t("agents.statusRecovery"), tone: "warn" };
    if (status.drifted) return { label: t("agents.statusDrift"), tone: "warn" };
    if (status.connected) return { label: t("agents.statusConnected"), tone: "good" };
    return { label: t("agents.statusOff"), tone: "neutral" };
  }

  const current = agent ? statusOf(agent) : null;

  return (
    <>
      <PageHeader
        title={t("page.agentsTitle")}
        subtitle={t("page.agentsSub")}
      >
        <button type="button" className="btn" disabled={busy} onClick={onChanged}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("agents.refresh")}
        </button>
      </PageHeader>

      <div className="summary-strip" aria-label={t("agents.summary")}>
        <span><b>{counts.connected}</b> {t("agents.connected")}</span>
        <span><b>{counts.detected}</b> {t("agents.detected")}</span>
        <span className={counts.attention ? "text-warn" : ""}>
          <b>{counts.attention}</b> {t("agents.attention")}
        </span>
        <span><b>{list.length}</b> {t("agents.supported")}</span>
      </div>

      {agentsError ? (
        <Notice tone="bad" icon={<CircleAlert size={16} />} live>
          {t("agents.unavailable", { error: agentsError })}
        </Notice>
      ) : null}
      {!agent && message ? (
        <Notice tone="accent" icon={<Info size={16} />} live>
          {message}
        </Notice>
      ) : null}

      <Card flush className="agents-card">
        {list.length === 0 ? (
          <Empty icon={<Bot size={18} />} title={t("agents.emptyTitle")} />
        ) : (
          <ul className="agent-rows" aria-label={t("agents.listAria")}>
            {list.map((status) => {
              const { label, tone } = statusOf(status);
              const detection = status.detection;
              const found = detection
                ? detection.config_file
                  ? t("agents.foundFile")
                  : detection.config_directory
                    ? t("agents.foundDir")
                    : t("agents.noConfig")
                : status.detected
                  ? t("agents.detectedLocal")
                  : t("agents.notDetected");
              const cli = detection
                ? detection.cli
                  ? detection.cli.on_path === true
                    ? { text: t("agents.cliPath"), tone: "good" }
                    : detection.cli.on_path === false
                      ? { text: t("agents.cliFoundNoPath"), tone: "warn" }
                      : { text: t("agents.cliUnknown"), tone: "warn" }
                  : { text: t("agents.cliMissing"), tone: "muted" }
                : null;
              return (
                <li
                  key={status.id}
                  className={`agent-row${status.id === editingId ? " selected" : ""}`}
                >
                  <Avatar name={status.name} />
                  <div className="agent-id">
                    <b>{status.name}</b>
                    <span>{found}</span>
                  </div>
                  <div className="agent-route">
                    {status.model ? (
                      <code className="route">{status.model}</code>
                    ) : (
                      <span className="text-muted">{t("agents.noModel")}</span>
                    )}
                  </div>
                  <div className="agent-cli">
                    {cli ? (
                      <>
                        <span className={`cli-state ${cli.tone}`}>
                          <Terminal size={12} aria-hidden="true" />
                          {cli.text}
                        </span>
                        {detection?.cli ? (
                          <span className="cli-path" title={detection.cli.path}>
                            {detection.cli.path}
                          </span>
                        ) : null}
                        {detection?.search_limited ? (
                          <span className="cli-state warn">
                            {t("agents.cliLimited")}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                  <Badge tone={tone} dot>
                    {label}
                  </Badge>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    aria-label={t("agents.manage", { name: status.name })}
                    aria-expanded={status.id === editingId}
                    onClick={() => open(status)}
                  >
                    {t("agents.manageBtn")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="footnote">
        <Info size={14} aria-hidden="true" />
        {t("agents.detectNote")}
      </p>

      <Sheet
        open={Boolean(agent)}
        onClose={close}
        busy={busy}
        onSubmit={runPreview}
        icon={agent ? <Avatar name={agent.name} size="lg" /> : null}
        title={agent ? t("agents.manageTitle", { name: agent.name }) : ""}
        description={
          current ? (
            <Badge tone={current.tone} dot>
              {current.label}
            </Badge>
          ) : null
        }
        footer={
          agent ? (
            <>
              <button type="button" className="btn ghost" disabled={busy} onClick={close}>
                {t("agents.cancel")}
              </button>
              <span className="spacer" />
              {pending ? (
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || !pending}
                  onClick={runRecover}
                >
                  <Undo2 size={14} aria-hidden="true" />
                  {t("agents.recover")}
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    className={preview ? "btn" : "btn primary"}
                    disabled={busy || pending}
                  >
                    <Eye size={14} aria-hidden="true" />
                    {preview ? t("agents.previewAgain") : t("agents.previewChanges")}
                  </button>
                  {preview ? (
                    <button type="button" className="btn primary" disabled={busy} onClick={runApply}>
                      <Check size={14} aria-hidden="true" />
                      {connect ? t("agents.confirmConn") : t("agents.confirmRestore")}
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null
        }
      >
        {agent ? (
          <>
            {agent.notice ? <p className="sheet-lead">{agent.notice}</p> : null}

            <FormSection title={t("agents.opTitle")}>
              <Segmented
                label={t("agents.opTitle")}
                value={action}
                disabled={busy || pending}
                onChange={(value) => {
                  setAction(value);
                  setPreview(null);
                }}
                options={[
                  { value: "connect", label: t("agents.opConnect") },
                  {
                    value: "disconnect",
                    label: t("agents.opDisconnect"),
                    disabled: !agent.connected,
                  },
                ]}
              />
              <Field
                label={t("agents.modelRoute")}
                htmlFor="agent-model"
                hidden={!connect || pending}
                help={t("agents.modelRouteHelp")}
              >
                <input
                  id="agent-model"
                  className="input mono"
                  list="agent-model-options"
                  autoComplete="off"
                  spellCheck={false}
                  required={connect && !pending}
                  placeholder={t("agents.modelRoutePh")}
                  value={model}
                  disabled={busy || !connect || pending}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setPreview(null);
                  }}
                />
              </Field>
            </FormSection>

            <FormSection title={t("agents.filesTitle")} description={t("agents.filesDesc")}>
              {(agent.files ?? []).length ? (
                <ul className="file-list" aria-label={t("agents.filesAria")}>
                  {(agent.files ?? []).map((path) => (
                    <li key={path}>
                      <FileText size={13} aria-hidden="true" />
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">{t("agents.filesEmpty")}</p>
              )}
            </FormSection>

            <Notice tone="warn" icon={<TriangleAlert size={16} />}>
              {t("agents.backupWarn")}
            </Notice>

            {preview ? (
              <section className="preview" aria-labelledby="agent-preview-title">
                <div className="preview-head">
                  <h3 id="agent-preview-title">
                    {connect ? t("agents.reviewConn") : t("agents.reviewRestore")}
                  </h3>
                  <p>
                    {connect ? (
                      <>
                        {agent.name} <ArrowRight size={12} aria-hidden="true" /> <code>{model}</code>
                      </>
                    ) : (
                      t("agents.restoreText", { name: agent.name })
                    )}
                  </p>
                </div>
                <ul className="preview-files">
                  {preview.files.map((file) => (
                    <li key={file.path}>
                      <code>{file.path}</code>
                      <span className="preview-op">
                        <Badge tone="accent">{file.operation}</Badge>
                        <span className="text-muted">
                          {t("agents.bytes", { a: fmt(file.before_bytes), b: fmt(file.after_bytes) })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="help">
                  {t("agents.previewHelp")}
                </p>
              </section>
            ) : null}

            {message ? (
              <Notice tone="accent" icon={<Info size={16} />} live>
                {message}
              </Notice>
            ) : (
              <span role="status" aria-live="polite" className="sr-only" />
            )}
          </>
        ) : null}
      </Sheet>
    </>
  );
}

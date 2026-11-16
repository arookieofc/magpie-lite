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
        ? "An operation was interrupted. Recovery rolls back a connect or completes a disconnect using its private journal."
        : target.drifted
          ? "A managed field, file format or overriding path changed. Preview will check whether this operation is safe; conflicting edits are never overwritten."
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
      setMessage("Choose a configured route, or enter a provider/model or group/id.");
      return;
    }
    setBusy(true);
    setMessage("Preparing a private preview; agent files are unchanged…");
    try {
      const result = await api.post<AgentPreview>(
        `/agents/${encodeURIComponent(agent.id)}/preview`,
        editBody(),
      );
      setPreview(result);
      setMessage("Preview ready. No agent files have been changed.");
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
    setMessage("Applying reviewed changes…");
    try {
      const result = await api.post<Agent>(`/agents/${encodeURIComponent(agent.id)}/apply`, {
        ...editBody(),
        revision: preview.revision,
      });
      setPreview(null);
      setMessage(
        connect
          ? `Connected to ${result.model ?? model}. ${result.notice ?? ""}`.trim()
          : `Managed settings restored; unrelated edits preserved. ${result.notice ?? ""}`.trim(),
      );
      onChanged();
    } catch (err) {
      setMessage(
        `${(err as Error).message} Preview again before retrying; refresh status if the operation was interrupted.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function runRecover() {
    if (busy || !agent) return;
    if (
      !window.confirm(
        `Recover the interrupted operation for ${agent.name}? This uses the private journal to roll back a connect or finish a disconnect. Conflicting edits will not be overwritten.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("Recovering interrupted operation…");
    try {
      const result = await api.post<Agent>(`/agents/${encodeURIComponent(agent.id)}/recover`);
      setMessage(`Recovery complete. ${result.notice ?? ""}`.trim());
      onChanged();
    } catch (err) {
      setMessage(`${(err as Error).message} Resolve the issue or refresh status before retrying.`);
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
    if (status.recovery_needed) return { label: "Recovery needed", tone: "warn" };
    if (status.drifted) return { label: "Configuration drift", tone: "warn" };
    if (status.connected) return { label: "Connected", tone: "good" };
    return { label: "Not connected", tone: "neutral" };
  }

  const current = agent ? statusOf(agent) : null;

  return (
    <>
      <PageHeader
        title="Coding agents"
        subtitle="Point each agent at a provider model or routing group. Every change is previewed first."
      >
        <button type="button" className="btn" disabled={busy} onClick={onChanged}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh agents
        </button>
      </PageHeader>

      <div className="summary-strip" aria-label="Agent summary">
        <span><b>{counts.connected}</b> connected</span>
        <span><b>{counts.detected}</b> detected locally</span>
        <span className={counts.attention ? "text-warn" : ""}>
          <b>{counts.attention}</b> need attention
        </span>
        <span><b>{list.length}</b> supported</span>
      </div>

      {agentsError ? (
        <Notice tone="bad" icon={<CircleAlert size={16} />} live>
          Agent status unavailable: {agentsError} Use Refresh agents to retry. Other console tools
          remain available.
        </Notice>
      ) : null}
      {!agent && message ? (
        <Notice tone="accent" icon={<Info size={16} />} live>
          {message}
        </Notice>
      ) : null}

      <Card flush className="agents-card">
        {list.length === 0 ? (
          <Empty icon={<Bot size={18} />} title="No agent status yet" />
        ) : (
          <ul className="agent-rows" aria-label="Supported coding agents">
            {list.map((status) => {
              const { label, tone } = statusOf(status);
              const detection = status.detection;
              const found = detection
                ? detection.config_file
                  ? "Configuration file found"
                  : detection.config_directory
                    ? "Configuration directory found"
                    : "No user configuration yet"
                : status.detected
                  ? "Detected locally"
                  : "Not detected · can create configuration";
              const cli = detection
                ? detection.cli
                  ? detection.cli.on_path === true
                    ? { text: "CLI on gateway's PATH", tone: "good" }
                    : detection.cli.on_path === false
                      ? { text: "CLI found · not on gateway's PATH", tone: "warn" }
                      : { text: "CLI found · PATH unknown (search limited)", tone: "warn" }
                  : { text: "CLI not found in searched directories", tone: "muted" }
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
                      <span className="text-muted">No managed model</span>
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
                            CLI search reached its entry limit; an installation may be omitted.
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
                    aria-label={`Manage ${status.name}`}
                    aria-expanded={status.id === editingId}
                    onClick={() => open(status)}
                  >
                    Manage
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="footnote">
        <Info size={14} aria-hidden="true" />
        Detection never runs an agent. CLI paths describe this gateway's environment, not a new
        terminal; they are not version or health checks.
      </p>

      <Sheet
        open={Boolean(agent)}
        onClose={close}
        busy={busy}
        onSubmit={runPreview}
        icon={agent ? <Avatar name={agent.name} size="lg" /> : null}
        title={agent ? `Manage ${agent.name}` : ""}
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
                Cancel
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
                  Recover interrupted operation
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    className={preview ? "btn" : "btn primary"}
                    disabled={busy || pending}
                  >
                    <Eye size={14} aria-hidden="true" />
                    {preview ? "Preview again" : "Preview changes"}
                  </button>
                  {preview ? (
                    <button type="button" className="btn primary" disabled={busy} onClick={runApply}>
                      <Check size={14} aria-hidden="true" />
                      {connect ? "Confirm connection" : "Confirm restoration"}
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

            <FormSection title="Operation">
              <Segmented
                label="Operation"
                value={action}
                disabled={busy || pending}
                onChange={(value) => {
                  setAction(value);
                  setPreview(null);
                }}
                options={[
                  { value: "connect", label: "Connect / change model" },
                  {
                    value: "disconnect",
                    label: "Disconnect / restore",
                    disabled: !agent.connected,
                  },
                ]}
              />
              <Field
                label="Model route"
                htmlFor="agent-model"
                hidden={!connect || pending}
                help="Choose a configured route, or enter a provider/model or group/id. Providers and groups must already exist."
              >
                <input
                  id="agent-model"
                  className="input mono"
                  list="agent-model-options"
                  autoComplete="off"
                  spellCheck={false}
                  required={connect && !pending}
                  placeholder="provider/model or group/id"
                  value={model}
                  disabled={busy || !connect || pending}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setPreview(null);
                  }}
                />
              </Field>
            </FormSection>

            <FormSection title="Managed files" description="User-level files this operation may touch.">
              {(agent.files ?? []).length ? (
                <ul className="file-list" aria-label="Managed configuration paths">
                  {(agent.files ?? []).map((path) => (
                    <li key={path}>
                      <FileText size={13} aria-hidden="true" />
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No managed files reported.</p>
              )}
            </FormSection>

            <Notice tone="warn" icon={<TriangleAlert size={16} />}>
              Backups contain plaintext credentials, not encrypted secrets. Restore refuses
              conflicting file edits. Project settings and environment variables can override these
              user-level files.
            </Notice>

            {preview ? (
              <section className="preview" aria-labelledby="agent-preview-title">
                <div className="preview-head">
                  <h3 id="agent-preview-title">
                    {connect ? "Review connection" : "Review restoration"}
                  </h3>
                  <p>
                    {connect ? (
                      <>
                        {agent.name} <ArrowRight size={12} aria-hidden="true" /> <code>{model}</code>
                      </>
                    ) : (
                      `Restore the original files for ${agent.name}.`
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
                          {fmt(file.before_bytes)} → {fmt(file.after_bytes)} bytes
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="help">
                  File contents and credentials are never shown. If a file or gateway setting
                  changes, this preview must be generated again.
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

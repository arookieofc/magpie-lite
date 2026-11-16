import { useState } from "react";
import {
  Check,
  CircleHelp,
  FlaskConical,
  Info,
  KeyRound,
  Pencil,
  Plus,
  ScanSearch,
  Server,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../api";
import type { Config, ProviderConfig as Provider } from "../types";
import { fmt, formatDuration } from "../util";
import { Avatar, Badge, Card, Empty, Field, FormSection, Notice, PageHeader, Segmented, Switch } from "./ui";

const PROTOCOLS: Record<string, string> = {
  chat: "OpenAI Chat",
  responses: "OpenAI Responses",
  anthropic: "Anthropic Messages",
  gemini: "Google Gemini",
};

const lines = (v: string) => v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const triState = (v?: boolean | null) => (v === true ? "true" : v === false ? "false" : "");
const boolOrNull = (v: string) => (v === "true" ? true : v === "false" ? false : null);

function routingSummary(p: Provider): string {
  const policy = p.routing || "rotate";
  const affinity = p.affinity || "auto";
  const limits = (p.key_limits ?? []).length ? ` · limits: ${p.key_limits!.join(", ")}` : "";
  const pin = p.pin_upstream ? " · pinned" : "";
  if (policy !== "weight") return `${policy} · affinity: ${affinity}${limits}${pin}`;
  const weights = (p.weights ?? []).length ? `weight: ${p.weights!.join(", ")}` : "weight";
  return `${weights} · affinity: ${affinity}${limits}${pin}`;
}

interface Draft {
  id: string;
  name: string;
  protocol: string;
  capChat: boolean;
  capResponses: boolean;
  capAnthropic: boolean;
  capGemini: boolean;
  capStreaming: string;
  capTools: string;
  capVision: string;
  baseUrl: string;
  models: string;
  contexts: string;
  outputs: string;
  freeModels: string;
  fallback: string;
  routing: string;
  affinity: string;
  weights: string;
  keyLimits: string;
  cooldown: string;
  maxConcurrency: string;
  maxRpm: string;
  queueLimit: string;
  queueWait: string;
  pinUpstream: boolean;
  makeDefault: boolean;
  keyMode: string;
  keys: string;
  testModel: string;
}

function blankDraft(isFirst: boolean): Draft {
  return {
    id: "", name: "", protocol: "chat",
    capChat: true, capResponses: false, capAnthropic: false, capGemini: false,
    capStreaming: "", capTools: "", capVision: "",
    baseUrl: "", models: "", contexts: "", outputs: "", freeModels: "", fallback: "",
    routing: "rotate", affinity: "auto", weights: "", keyLimits: "",
    cooldown: "", maxConcurrency: "", maxRpm: "", queueLimit: "", queueWait: "",
    pinUpstream: false, makeDefault: isFirst, keyMode: "replace", keys: "", testModel: "",
  };
}

function draftFrom(p: Provider, isDefault: boolean): Draft {
  const supported = p.capabilities?.supported_protocols ?? [p.protocol];
  return {
    id: p.id, name: p.name || "", protocol: p.protocol,
    capChat: supported.includes("chat"),
    capResponses: supported.includes("responses"),
    capAnthropic: supported.includes("anthropic"),
    capGemini: supported.includes("gemini"),
    capStreaming: triState(p.capabilities?.streaming),
    capTools: triState(p.capabilities?.tools),
    capVision: triState(p.capabilities?.vision),
    baseUrl: p.base_url,
    models: (p.models ?? []).join("\n"),
    contexts: Object.entries(p.contexts ?? {}).map(([m, w]) => `${m}=${w}`).join("\n"),
    outputs: Object.entries(p.outputs ?? {}).map(([m, l]) => `${m}=${l}`).join("\n"),
    freeModels: (p.free_models ?? []).join("\n"),
    fallback: (p.fallback ?? []).join("\n"),
    routing: p.routing || "rotate", affinity: p.affinity || "auto",
    weights: (p.weights ?? []).join("\n"),
    keyLimits: (p.key_limits ?? []).join("\n"),
    cooldown: p.key_cooldown_override_ms == null ? "" : String(p.key_cooldown_override_ms),
    maxConcurrency: p.max_concurrency == null ? "" : String(p.max_concurrency),
    maxRpm: p.max_rpm == null ? "" : String(p.max_rpm),
    queueLimit: p.queue_limit == null ? "" : String(p.queue_limit),
    queueWait: p.queue_wait_s == null ? "" : String(p.queue_wait_s),
    pinUpstream: p.pin_upstream ?? false,
    makeDefault: isDefault,
    keyMode: "keep", keys: "", testModel: "",
  };
}

function mapField(value: string, label: string): { map?: Record<string, number>; error?: string } {
  const map: Record<string, number> = {};
  for (const line of lines(value)) {
    const at = line.lastIndexOf("=");
    const model = at > 0 ? line.slice(0, at).trim() : "";
    const n = at > 0 ? Number(line.slice(at + 1).trim()) : NaN;
    if (!model || /\s/.test(model) || !Number.isSafeInteger(n) || n <= 0) {
      return { error: `${label} must be model=number, one per line, with a whole number above zero.` };
    }
    map[model] = n;
  }
  return { map };
}

function numField(value: string, label: string): { ok: boolean; value: number | null; error?: string } {
  if (value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, value: null, error: `${label} must be a non-negative whole number.` };
  }
  return { ok: true, value: n };
}

function listOfNums(value: string, label: string): { ok: boolean; values: number[]; error?: string } {
  const values = lines(value).map(Number);
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 1000)) {
    return { ok: false, values: [], error: `${label} must be whole numbers from 0 to 1000, one per line.` };
  }
  return { ok: true, values };
}

interface Props {
  config: Config | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}

export default function ProviderConfig({ config, busy, setBusy, onChanged }: Props) {
  const [editing, setEditing] = useState<string | null | false>(false); // false=closed, null=new, id=edit
  const [draft, setDraft] = useState<Draft>(blankDraft(false));
  const [message, setMessage] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const providers = config?.providers ?? [];

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  function openNew() {
    if (busy) return;
    setEditing(null);
    setDraft(blankDraft(providers.length === 0));
    setMessage("");
    setDiscovered([]);
  }

  function openEdit(p: Provider) {
    if (busy) return;
    setEditing(p.id);
    setDraft(draftFrom(p, config?.default_provider === p.id));
    setMessage("");
    setDiscovered([]);
  }

  function close() {
    setEditing(false);
    setMessage("");
  }

  function buildBody(): Record<string, unknown> | null {
    const cooldown = numField(draft.cooldown, "Cooldown");
    if (!cooldown.ok) return setMessage(cooldown.error!), null;
    const maxConcurrency = numField(draft.maxConcurrency, "Max concurrency");
    if (!maxConcurrency.ok) return setMessage(maxConcurrency.error!), null;
    const maxRpm = numField(draft.maxRpm, "Max requests per minute");
    if (!maxRpm.ok) return setMessage(maxRpm.error!), null;
    const queueLimit = numField(draft.queueLimit, "Queue bound");
    if (!queueLimit.ok) return setMessage(queueLimit.error!), null;
    const queueWait = numField(draft.queueWait, "Queue wait");
    if (!queueWait.ok) return setMessage(queueWait.error!), null;
    const contexts = mapField(draft.contexts, "Context windows");
    if (!contexts.map) return setMessage(contexts.error!), null;
    const outputs = mapField(draft.outputs, "Max outputs");
    if (!outputs.map) return setMessage(outputs.error!), null;
    const keyLimits = listOfNums(draft.keyLimits, "Per-key limits");
    if (!keyLimits.ok) return setMessage(keyLimits.error!), null;

    const supported = [
      draft.capChat && "chat",
      draft.capResponses && "responses",
      draft.capAnthropic && "anthropic",
      draft.capGemini && "gemini",
    ].filter(Boolean) as string[];
    if (!supported.includes(draft.protocol)) supported.push(draft.protocol);

    const body: Record<string, unknown> = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      protocol: draft.protocol,
      capabilities: {
        supported_protocols: supported,
        streaming: boolOrNull(draft.capStreaming),
        tools: boolOrNull(draft.capTools),
        vision: boolOrNull(draft.capVision),
      },
      base_url: draft.baseUrl.trim(),
      models: lines(draft.models),
      contexts: contexts.map,
      outputs: outputs.map,
      free_models: lines(draft.freeModels),
      fallback: lines(draft.fallback),
      key_cooldown_ms: cooldown.value,
      max_concurrency: maxConcurrency.value,
      max_rpm: maxRpm.value,
      queue_limit: queueLimit.value,
      queue_wait_s: queueWait.value,
      pin_upstream: draft.pinUpstream,
      make_default: draft.makeDefault,
      routing: draft.routing,
      affinity: draft.affinity,
      key_limits: keyLimits.values,
      weights: [],
    };
    if (draft.routing === "weight") {
      const weights = listOfNums(draft.weights, "Key weights");
      if (!weights.ok) return setMessage(weights.error!), null;
      body.weights = weights.values;
    }
    if (draft.keyMode === "replace") {
      const keys = lines(draft.keys);
      if (!keys.length) {
        setMessage("Enter a key or choose No upstream authentication.");
        return null;
      }
      body.api_keys = keys;
    } else if (draft.keyMode === "clear") {
      body.api_keys = [];
    }
    return body;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = buildBody();
    if (!body) return;
    const isNew = editing === null;
    setBusy(true);
    setMessage("Saving…");
    try {
      await api.request(
        isNew ? "/config/providers" : `/config/providers/${encodeURIComponent(editing as string)}`,
        isNew ? "POST" : "PUT",
        body,
      );
      close();
      setMessage("Provider saved. New requests use it immediately.");
      onChanged();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Provider) {
    if (busy) return;
    if (!window.confirm(`Delete provider ${p.id}? Remove its group and fallback references first. Agents using it will need another route.`)) return;
    setBusy(true);
    setMessage("Deleting…");
    try {
      await api.del(`/config/providers/${encodeURIComponent(p.id)}`);
      setMessage("Provider deleted and saved.");
      onChanged();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function tool(operation: "models" | "test") {
    if (busy) return;
    const body = buildBody();
    if (!body) return;
    const model = draft.testModel.trim() || (body.models as string[])[0];
    if (operation === "test" && !model) {
      setMessage("Choose a test model or discover models first.");
      return;
    }
    setBusy(true);
    setMessage(operation === "test" ? "Testing a small generation request…" : "Fetching provider models…");
    try {
      const result = await api.post<{ models?: string[]; model?: string; elapsed_ms?: number }>(
        `/config/provider-tools/${operation === "models" ? "models" : "test"}`,
        { provider: body, ...(model ? { model } : {}) },
      );
      if (operation === "models") {
        const found = result.models ?? [];
        setDraft((d) => ({ ...d, models: [...new Set([...lines(d.models), ...found])].join("\n") }));
        setDiscovered(found);
        setMessage(`${found.length} models discovered. Draft updated; click Save provider to persist.`);
      } else {
        setMessage(`Connection verified for ${result.model} (${result.elapsed_ms} ms). Configuration was not saved.`);
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showKeys = draft.keyMode === "replace";

  const triOptions = (
    <>
      <option value="">Unknown</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </>
  );

  // The inline editor: the same FormSection body the Sheet had, rendered
  // inside the provider's card (or a stand-alone card for a new provider).
  const editorForm = (
    <form className="editor" onSubmit={save} autoComplete="off">
      <div className="editor-head">
        <h3>{editing === null ? "New provider" : `Edit ${draft.name || draft.id}`}</h3>
        {editing !== null ? <span className="sub"><code>{draft.id}</code></span> : null}
      </div>
      <div className="editor-body">
        {message ? (
          <Notice tone="accent" icon={<Info size={16} />} live>
            {message}
          </Notice>
        ) : null}

        <FormSection title="Endpoint" description="How the gateway reaches this provider.">
          <div className="form-grid">
            <Field label="Provider ID" htmlFor="provider-id"
              help="Letters, digits, hyphens and underscores. Agents use provider/model. The ID group is reserved.">
              <input id="provider-id" className="input mono" required pattern="[A-Za-z0-9_-]+"
                placeholder="deepseek" readOnly={editing !== null}
                value={draft.id} onChange={(e) => set({ id: e.target.value })} />
            </Field>
            <Field label="Display name" htmlFor="provider-name" help="Optional.">
              <input id="provider-name" className="input" placeholder="DeepSeek"
                value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Protocol" htmlFor="provider-protocol">
              <select id="provider-protocol" className="input"
                value={draft.protocol} onChange={(e) => set({ protocol: e.target.value })}>
                <option value="chat">OpenAI Chat Completions</option>
                <option value="responses">OpenAI Responses</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </Field>
            <Field label="Base URL" htmlFor="provider-url"
              help="Chat and Responses: include /v1. Anthropic: host root. Gemini: include /v1beta.">
              <input id="provider-url" className="input mono" type="url" required
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
            </Field>
          </div>
          <fieldset className="choice-field">
            <legend>Supported protocols</legend>
            <div className="check-chips">
              <label><input type="checkbox" checked={draft.capChat} onChange={(e) => set({ capChat: e.target.checked })} /><span>Chat</span></label>
              <label><input type="checkbox" checked={draft.capResponses} onChange={(e) => set({ capResponses: e.target.checked })} /><span>Responses</span></label>
              <label><input type="checkbox" checked={draft.capAnthropic} onChange={(e) => set({ capAnthropic: e.target.checked })} /><span>Anthropic</span></label>
              <label><input type="checkbox" checked={draft.capGemini} onChange={(e) => set({ capGemini: e.target.checked })} /><span>Gemini</span></label>
            </div>
            <p className="help">Select every wire protocol this provider accepts. The configured protocol is included automatically.</p>
          </fieldset>
          <div className="form-grid three">
            <Field label="Streaming" htmlFor="provider-cap-streaming">
              <select id="provider-cap-streaming" className="input"
                value={draft.capStreaming} onChange={(e) => set({ capStreaming: e.target.value })}>
                {triOptions}
              </select>
            </Field>
            <Field label="Tools / function calling" htmlFor="provider-cap-tools">
              <select id="provider-cap-tools" className="input"
                value={draft.capTools} onChange={(e) => set({ capTools: e.target.value })}>
                {triOptions}
              </select>
            </Field>
            <Field label="Vision / multimodal" htmlFor="provider-cap-vision">
              <select id="provider-cap-vision" className="input"
                value={draft.capVision} onChange={(e) => set({ capVision: e.target.value })}>
                {triOptions}
              </select>
            </Field>
          </div>
          <Switch checked={draft.makeDefault} onChange={(v) => set({ makeDefault: v })}>
            Make default provider
          </Switch>
        </FormSection>

        <FormSection title="Models" description="Listed models appear in the agent catalog; explicit provider/model routes also work for unlisted models.">
          <Field label="Model IDs" htmlFor="provider-models" help="One upstream model ID per line.">
            <textarea id="provider-models" className="input mono" rows={4} placeholder={"deepseek-chat\ndeepseek-reasoner"}
              value={draft.models} onChange={(e) => set({ models: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Context windows" htmlFor="provider-contexts" help="Optional. One model=window in tokens per line.">
              <textarea id="provider-contexts" className="input mono" rows={3} placeholder={"deepseek-chat=131072\ndeepseek-reasoner=65536"}
                value={draft.contexts} onChange={(e) => set({ contexts: e.target.value })} />
            </Field>
            <Field label="Max outputs" htmlFor="provider-outputs" help="Optional. One model=limit in tokens per line.">
              <textarea id="provider-outputs" className="input mono" rows={3} placeholder={"claude-sonnet-4-5=32000\ngpt-5-mini=16384"}
                value={draft.outputs} onChange={(e) => set({ outputs: e.target.value })} />
            </Field>
            <Field label="Free models" htmlFor="provider-free-models" help="Optional. Served at no cost, for Free first routing.">
              <textarea id="provider-free-models" className="input mono" rows={3} placeholder={"deepseek-v4.1-flash\nglm-5.3"}
                value={draft.freeModels} onChange={(e) => set({ freeModels: e.target.value })} />
            </Field>
            <Field label="Fallback routes" htmlFor="provider-fallback" help="Optional. One route per line, tried in order.">
              <textarea id="provider-fallback" className="input mono" rows={3} placeholder={"backup/model\ngroup/daily"}
                value={draft.fallback} onChange={(e) => set({ fallback: e.target.value })} />
            </Field>
          </div>
          <Field label="Test model" htmlFor="provider-test-model"
            help="Discovery appends model IDs to this draft. Testing sends a small generation request (up to 64 output tokens) and may incur provider charges.">
            <input id="provider-test-model" className="input mono" list="provider-discovered-models"
              placeholder="First listed model"
              value={draft.testModel} onChange={(e) => set({ testModel: e.target.value })} />
            <datalist id="provider-discovered-models">
              {discovered.map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
        </FormSection>

        <FormSection title="Credentials" description="Saved keys are never displayed.">
          <Segmented
            label="API keys"
            value={draft.keyMode}
            onChange={(value) => set({ keyMode: value })}
            options={[
              { value: "keep", label: "Keep existing keys", disabled: editing === null },
              { value: "replace", label: "Replace key pool" },
              { value: "clear", label: "No upstream auth" },
            ]}
          />
          <p className="help">Choose Replace to rotate credentials, or No upstream auth for a local service.</p>
          {showKeys ? (
            <Field label="New key pool" htmlFor="provider-keys" help="One API key per line, in rotation order.">
              <textarea id="provider-keys" className="input mono secret" rows={3} autoComplete="off" spellCheck={false}
                value={draft.keys} onChange={(e) => set({ keys: e.target.value })} />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Key routing" description="How requests spread across the key pool.">
          <div className="form-grid">
            <Field label="Key routing" htmlFor="provider-routing">
              <select id="provider-routing" className="input"
                value={draft.routing} onChange={(e) => set({ routing: e.target.value })}>
                <option value="rotate">Rotate</option>
                <option value="order">Ordered</option>
                <option value="usage">Least used</option>
                <option value="free_first">Free first</option>
                <option value="weight">Weighted</option>
              </select>
            </Field>
            <Field label="Conversation affinity" htmlFor="provider-affinity">
              <select id="provider-affinity" className="input"
                value={draft.affinity} onChange={(e) => set({ affinity: e.target.value })}>
                <option value="auto">Auto</option>
                <option value="session">Whole session</option>
                <option value="turn">Within a turn</option>
                <option value="off">Off</option>
              </select>
            </Field>
            {draft.routing === "weight" ? (
              <Field label="Key weights" htmlFor="provider-weights"
                help="One weight per key slot, in pool order, 0-1000. Missing or 0 counts as 1.">
                <textarea id="provider-weights" className="input mono" rows={3} placeholder={"3\n1\n4"}
                  value={draft.weights} onChange={(e) => set({ weights: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Per-key concurrency limits" htmlFor="provider-limits"
              help="Optional. One per key slot, 0-1000 (0 for no limit). A missing entry takes Max concurrency.">
              <textarea id="provider-limits" className="input mono" rows={3} placeholder={"5\n2"}
                value={draft.keyLimits} onChange={(e) => set({ keyLimits: e.target.value })} />
            </Field>
          </div>
          <Switch checked={draft.pinUpstream} onChange={(v) => set({ pinUpstream: v })}>
            Pin DeepSeek and GLM models to their own API
          </Switch>
        </FormSection>

        <FormSection title="Limits and queueing" description="Leave blank for no limit.">
          <div className="form-grid">
            <Field label="Key cooldown (ms)" htmlFor="provider-cooldown"
              help="Blank inherits the gateway default. 0 disables cooldown.">
              <input id="provider-cooldown" className="input" type="number" min="0" step="1"
                placeholder="Gateway default"
                value={draft.cooldown} onChange={(e) => set({ cooldown: e.target.value })} />
            </Field>
            <Field label="Max concurrency per key" htmlFor="provider-max-concurrency">
              <input id="provider-max-concurrency" className="input" type="number" min="0" step="1"
                placeholder="No limit"
                value={draft.maxConcurrency} onChange={(e) => set({ maxConcurrency: e.target.value })} />
            </Field>
            <Field label="Max requests per minute per key" htmlFor="provider-max-rpm">
              <input id="provider-max-rpm" className="input" type="number" min="0" step="1"
                placeholder="No limit"
                value={draft.maxRpm} onChange={(e) => set({ maxRpm: e.target.value })} />
            </Field>
            <Field label="Queue bound per key" htmlFor="provider-queue-limit">
              <input id="provider-queue-limit" className="input" type="number" min="0" step="1"
                placeholder="No bound"
                value={draft.queueLimit} onChange={(e) => set({ queueLimit: e.target.value })} />
            </Field>
            <Field label="Queue wait (s)" htmlFor="provider-queue-wait">
              <input id="provider-queue-wait" className="input" type="number" min="0" step="1"
                placeholder="As long as it takes"
                value={draft.queueWait} onChange={(e) => set({ queueWait: e.target.value })} />
            </Field>
          </div>
        </FormSection>
      </div>
      <div className="editor-foot">
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => tool("models")} disabled={busy}>
          <ScanSearch size={14} aria-hidden="true" />
          Discover models
        </button>
        <button type="button" className="btn" onClick={() => tool("test")} disabled={busy}>
          <FlaskConical size={14} aria-hidden="true" />
          Test connection
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save provider"}
        </button>
      </div>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Upstream endpoints, keys, limits and the models each one serves."
      >
        <button type="button" className="btn primary" onClick={openNew} disabled={busy}>
          <Plus size={14} aria-hidden="true" />
          New provider
        </button>
      </PageHeader>

      {editing === false && message ? (
        <Notice tone="accent" icon={<Info size={16} />} live>
          {message}
        </Notice>
      ) : null}

      {editing === null ? <Card flush>{editorForm}</Card> : null}

      {providers.length === 0 ? (
        editing === false ? (
          <Card>
            <Empty icon={<Server size={18} />} title="No providers are configured">
              Add an upstream endpoint and its keys to start routing requests.
            </Empty>
          </Card>
        ) : null
      ) : (
        <div className="provider-grid">
          {providers.map((p) => {
            const isDefault = config?.default_provider === p.id;
            const caps = p.capabilities;
            const shown = (p.models ?? []).slice(0, 8);
            const more = (p.models ?? []).length - shown.length;
            const free = new Set(p.free_models ?? []);
            return (
              <article key={p.id} className={`provider-card${editing === p.id ? " editing" : ""}`}>
                {editing === p.id ? (
                  <>
                    <header className="provider-head editor-context">
                      <Avatar name={p.name || p.id} />
                      <div className="provider-title">
                        <h3>
                          {p.name || p.id}
                          {isDefault ? <Badge tone="accent">Default</Badge> : null}
                        </h3>
                        <p>
                          <code>{p.id}</code>
                          <span className="sep">·</span>
                          {PROTOCOLS[p.protocol] ?? p.protocol}
                        </p>
                      </div>
                    </header>
                    {editorForm}
                  </>
                ) : (
                  <>
                    <header className="provider-head">
                      <Avatar name={p.name || p.id} />
                      <div className="provider-title">
                        <h3>
                          {p.name || p.id}
                          {isDefault ? <Badge tone="accent">Default</Badge> : null}
                        </h3>
                        <p>
                          <code>{p.id}</code>
                          <span className="sep">·</span>
                          {PROTOCOLS[p.protocol] ?? p.protocol}
                        </p>
                      </div>
                    </header>
                    <div className="provider-mid">
                      <p className="provider-url" title={p.base_url}>{p.base_url}</p>
                      <ul className="chips">
                        {shown.map((m) => (
                          <li key={m} className="chip mono">
                            {m}
                            {free.has(m) ? <span className="chip-tag">free</span> : null}
                          </li>
                        ))}
                        {more > 0 ? <li className="chip more">+{more} more</li> : null}
                        {shown.length === 0 ? <li className="chip more">No listed models</li> : null}
                      </ul>
                      <footer className="caps">
                        {(caps?.supported_protocols ?? [p.protocol]).map((proto) => (
                          <span key={proto} className="cap proto">{proto}</span>
                        ))}
                        {(["streaming", "tools", "vision"] as const).map((name) => {
                          const v = caps?.[name];
                          const state = v === true ? "yes" : v === false ? "no" : "unknown";
                          const Icon = v === true ? Check : v === false ? X : CircleHelp;
                          return (
                            <span key={name} className={`cap ${state}`} title={`${name}: ${state}`}>
                              <Icon size={10} aria-hidden="true" />
                              {name}
                            </span>
                          );
                        })}
                      </footer>
                    </div>
                    <div className="provider-side">
                      <dl className="facts">
                        <div>
                          <dt><KeyRound size={11} aria-hidden="true" /> Keys</dt>
                          <dd>{p.credential_count === 0 ? "No auth" : `${fmt(p.key_count)}`}</dd>
                        </div>
                        <div>
                          <dt>Routing</dt>
                          <dd>{routingSummary(p)}</dd>
                        </div>
                        <div>
                          <dt>Cooldown</dt>
                          <dd>{formatDuration(p.key_cooldown_ms)}</dd>
                        </div>
                        <div>
                          <dt>Fallback</dt>
                          <dd>{(p.fallback ?? []).length ? (p.fallback ?? []).join(" → ") : "—"}</dd>
                        </div>
                      </dl>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" disabled={busy}
                          aria-label={`Edit provider ${p.id}`} title="Edit" onClick={() => openEdit(p)}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="icon-btn danger" disabled={busy}
                          aria-label={`Delete provider ${p.id}`} title="Delete" onClick={() => remove(p)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

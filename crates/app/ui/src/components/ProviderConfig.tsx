import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlaskConical,
  Info,
  Pencil,
  Plus,
  ScanSearch,
  Search,
  Server,
  Trash2,
  ChevronRight,
} from "lucide-react";
import * as api from "../api";
import type { Config, ProviderConfig as Provider, VendorPreset } from "../types";
import { Badge, Card, Empty, Field, FormSection, Notice, PageHeader, Segmented, Switch } from "./ui";
import VendorIcon, { hostOf, presetIconForHost } from "./vendorIcon";
import { useT, type TFunc } from "../i18n";
import AddProvider, { type PastedEndpoint } from "./AddProvider";
import CustomProvider from "./CustomProvider";
import { curlFill, originOfUrl, splitKeys, withOriginUrl } from "../util";

function policyLabel(v: string, t: TFunc): string {
  switch (v) {
    case "order": return t("prov.optOrder");
    case "usage": return t("prov.optUsage");
    case "free_first": return t("prov.optFreeFirst");
    case "weight": return t("prov.optWeight");
    case "rotate":
    default: return t("prov.optRotate");
  }
}

function affinityLabel(v: string, t: TFunc): string {
  switch (v) {
    case "session": return t("prov.optSession");
    case "turn": return t("prov.optTurn");
    case "off": return t("prov.optOff");
    case "auto":
    default: return t("prov.optAuto");
  }
}

const lines = (v: string) => v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const triState = (v?: boolean | null) => (v === true ? "true" : v === false ? "false" : "");
const boolOrNull = (v: string) => (v === "true" ? true : v === "false" ? false : null);

function routingSummary(p: Provider, t: TFunc): string {
  const policy = p.routing || "rotate";
  const affinity = p.affinity || "auto";
  const limits = (p.key_limits ?? []).length ? t("prov.sumLimits", { v: p.key_limits!.join(", ") }) : "";
  const pin = p.pin_upstream ? t("prov.sumPinned") : "";
  const aff = t("prov.sumAffinity", { v: affinityLabel(affinity, t) });
  if (policy !== "weight") return `${policyLabel(policy, t)}${aff}${limits}${pin}`;
  const weights = (p.weights ?? []).length ? t("prov.sumWeight", { v: p.weights!.join(", ") }) : t("prov.optWeight");
  return `${weights}${aff}${limits}${pin}`;
}

// Row-list helpers, mirroring upstream's providers view: one row per
// provider (logo, name + badges, host and model count, key pill, chevron),
// with the full editor expanding under the selected row.
function modelsLabel(p: Provider, t: TFunc): string {
  const n = (p.models ?? []).length;
  if (n === 1) return t("prov.oneModel");
  if (n > 1) return t("prov.nModels", { n });
  return t("prov.noModels");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function keyPill(p: Provider, t: TFunc): { text: string; tone: string; title: string } {
  if ((p.credential_count ?? 0) === 0) {
    return { text: t("prov.noAuth"), tone: "none", title: t("prov.noAuthTitle") };
  }
  const n = p.key_count || p.credential_count || 0;
  return { text: t("prov.nKeys", { n }), tone: "on", title: routingSummary(p, t) };
}

const sq = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

function providerText(p: Provider): string {
  return [
    p.id,
    p.name,
    p.protocol,
    p.base_url,
    hostOf(p.base_url),
    ...(p.models ?? []),
    ...(p.free_models ?? []),
    ...(p.fallback ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Models that answer the query words the row's own text doesn't, shown
// under the row like upstream's "Serves …" hits.
function modelHits(p: Provider, q: string): string[] {
  if (!q) return [];
  const text = providerText(p);
  const rest = q.split(/\s+/).filter(Boolean).filter((w) => !text.includes(w));
  if (!rest.length) return [];
  return (p.models ?? []).filter((m) => rest.every((w) => sq(m).includes(sq(w))));
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
  serverAddress: string;
  testModel: string;
  icon: string;
}

function blankDraft(isFirst: boolean): Draft {
  return {
    id: "", name: "", protocol: "chat",
    capChat: true, capResponses: false, capAnthropic: false, capGemini: false,
    capStreaming: "", capTools: "", capVision: "",
    baseUrl: "", models: "", contexts: "", outputs: "", freeModels: "", fallback: "",
    routing: "rotate", affinity: "auto", weights: "", keyLimits: "",
    cooldown: "", maxConcurrency: "", maxRpm: "", queueLimit: "", queueWait: "",
    pinUpstream: false, makeDefault: isFirst, keyMode: "replace", keys: "", testModel: "", icon: "",
    serverAddress: "",
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
    serverAddress: originOfUrl(p.base_url),
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
    keyMode: "keep", keys: "", testModel: "", icon: p.icon ?? "",
  };
}

function mapField(value: string, label: string, t: TFunc): { map?: Record<string, number>; error?: string } {
  const map: Record<string, number> = {};
  for (const line of lines(value)) {
    const at = line.lastIndexOf("=");
    const model = at > 0 ? line.slice(0, at).trim() : "";
    const n = at > 0 ? Number(line.slice(at + 1).trim()) : NaN;
    if (!model || /\s/.test(model) || !Number.isSafeInteger(n) || n <= 0) {
      return { error: t("prov.errMap", { label }) };
    }
    map[model] = n;
  }
  return { map };
}

function numField(value: string, label: string, t: TFunc): { ok: boolean; value: number | null; error?: string } {
  if (value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, value: null, error: t("prov.errNum", { label }) };
  }
  return { ok: true, value: n };
}

function listOfNums(value: string, label: string, t: TFunc): { ok: boolean; values: number[]; error?: string } {
  const values = lines(value).map(Number);
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 1000)) {
    return { ok: false, values: [], error: t("prov.errNums", { label }) };
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
  const t = useT();
  const [editing, setEditing] = useState<string | null | false>(false); // false=closed, null=new, id=edit
  const [draft, setDraft] = useState<Draft>(blankDraft(false));
  const [message, setMessage] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [showPoolKeys, setShowPoolKeys] = useState(false);
  // A fresh draft hides its keys again, like upstream's per-open eye.
  useEffect(() => { setShowPoolKeys(false); }, [editing]);
  const providers = config?.providers ?? [];

  // The Add sheet: vendor tiles prefill a new draft, like upstream's
  // `adding` page state. It opens on first use, when no provider exists.
  const [adding, setAdding] = useState(false);
  const [presets, setPresets] = useState<VendorPreset[] | null>(null);
  const [customMode, setCustomMode] = useState(false);
  // Which vendor tile spawned the new draft, so the editor head shows
  // its icon and name like upstream's `editing={preset}` state.
  const [preset, setPreset] = useState<VendorPreset | null>(null);
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
  const booted = useRef(false);
  useEffect(() => {
    if (!booted.current && config) {
      booted.current = true;
      if (config.providers.length === 0) setAdding(true);
    }
  }, [config]);
  useEffect(() => {
    let live = true;
    api.get<VendorPreset[]>("/config/presets").then(
      (list) => { if (live) setPresets(list); },
      () => { if (live) setPresets([]); },
    );
    return () => { live = false; };
  }, []);

  // Upstream-style find: rows saying every word, by id, name, host and
  // model; a word the row doesn't say matches the models it serves.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return providers;
    const words = q.split(/\s+/).filter(Boolean);
    return providers.filter((p) => {
      const text = providerText(p);
      const squashed = sq(text);
      if (words.every((w) => text.includes(w) || squashed.includes(sq(w)))) return true;
      return modelHits(p, q).length > 0;
    });
  }, [providers, q]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  function openCustom(prefill?: PastedEndpoint) {
    if (busy) return;
    setAdding(false);
    setEditing(null);
    setCustomMode(true);
    setPreset(null);
    setCustomUrls({});
    const draft = blankDraft(providers.length === 0);
    if (prefill?.baseUrl) draft.baseUrl = prefill.baseUrl;
    if (prefill?.keys) {
      draft.keyMode = "replace";
      draft.keys = prefill.keys;
    }
    setDraft(draft);
    setMessage("");
    setDiscovered([]);
  }

  function openPreset(pr: VendorPreset) {
    if (busy) return;
    const used = new Set(providers.map((p) => p.id));
    let id = pr.id, n = 2;
    while (used.has(id)) id = `${pr.id}-${n++}`;
    setAdding(false);
    setEditing(null);
    setCustomMode(false);
    setPreset(pr);
    setDraft({
      ...blankDraft(providers.length === 0),
      id,
      name: pr.name,
      protocol: pr.protocol,
      baseUrl: pr.chat || pr.responses || pr.anthropic || pr.gemini || "",
      serverAddress: originOfUrl(pr.chat || pr.responses || pr.anthropic || pr.gemini || ""),
      keyMode: "replace",
    });
    setMessage("");
    setDiscovered([]);
  }

  // A vendor's global and China endpoints are one tile in the Add sheet
  // but two presets: the editor switches between them, keeping the typed
  // keys, like upstream's `segs area` Region row.
  const pairEntries: VendorPreset[] | null =
    editing === null && preset?.pair
      ? (presets ?? [])
          .filter((p) => p.pair === preset.pair)
          .sort((a, b) => (a.id.endsWith("-cn") ? 1 : 0) - (b.id.endsWith("-cn") ? 1 : 0))
      : null;
  const pairShown = pairEntries && pairEntries.length === 2 ? pairEntries : null;

  // Azure OpenAI lives at the user's own resource: upstream labels its
  // URL "Endpoint" with the portal hint, and requires it on save.
  const azureId = editing === null ? preset?.id : typeof editing === "string" ? editing : undefined;
  const isAzure = !!azureId && (azureId === "azure" || azureId.startsWith("azure-"));

  function switchPair(next: VendorPreset) {
    if (busy || !next || next.id === preset?.id) return;
    const used = new Set(providers.map((p) => p.id));
    let id = next.id, n = 2;
    while (used.has(id)) id = `${next.id}-${n++}`;
    setPreset(next);
    setDraft((d) => ({
      ...d,
      id,
      name: next.name,
      protocol: next.protocol,
      baseUrl: next.chat || next.responses || next.anthropic || next.gemini || "",
      serverAddress: originOfUrl(next.chat || next.responses || next.anthropic || next.gemini || ""),
    }));
    setMessage("");
    setDiscovered([]);
  }

  function openEdit(p: Provider) {
    if (busy) return;
    setAdding(false);
    setEditing(p.id);
    setCustomMode(false);
    setPreset(null);
    setDraft(draftFrom(p, config?.default_provider === p.id));
    setMessage("");
    setDiscovered([]);
  }

  function close() {
    setEditing(false);
    setCustomMode(false);
    setPreset(null);
    setMessage("");
  }

  function buildBody(): Record<string, unknown> | null {
    const cooldown = numField(draft.cooldown, t("prov.lblCooldown"), t);
    if (!cooldown.ok) return setMessage(cooldown.error!), null;
    const maxConcurrency = numField(draft.maxConcurrency, t("prov.lblMaxConc"), t);
    if (!maxConcurrency.ok) return setMessage(maxConcurrency.error!), null;
    const maxRpm = numField(draft.maxRpm, t("prov.lblMaxRpm"), t);
    if (!maxRpm.ok) return setMessage(maxRpm.error!), null;
    const queueLimit = numField(draft.queueLimit, t("prov.lblQueueBound"), t);
    if (!queueLimit.ok) return setMessage(queueLimit.error!), null;
    const queueWait = numField(draft.queueWait, t("prov.lblQueueWait"), t);
    if (!queueWait.ok) return setMessage(queueWait.error!), null;
    const contexts = mapField(draft.contexts, t("prov.lblContexts"), t);
    if (!contexts.map) return setMessage(contexts.error!), null;
    const outputs = mapField(draft.outputs, t("prov.lblOutputs"), t);
    if (!outputs.map) return setMessage(outputs.error!), null;
    const keyLimits = listOfNums(draft.keyLimits, t("prov.lblKeyLimits"), t);
    if (!keyLimits.ok) return setMessage(keyLimits.error!), null;

    const supported = [
      draft.capChat && "chat",
      draft.capResponses && "responses",
      draft.capAnthropic && "anthropic",
      draft.capGemini && "gemini",
    ].filter(Boolean) as string[];
    if (!supported.includes(draft.protocol)) supported.push(draft.protocol);

    let id = draft.id.trim();
    if (!id && customMode && editing === null) {
      const used = new Set(providers.map((p) => p.id));
      id = slug(draft.name.trim()) || "relay";
      if (!used.has(id)) {
        // keep slug
      } else {
        let n = 2;
        while (used.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      if (!draft.name.trim()) {
        setMessage(t("prov.giveName"));
        return null;
      }
    }
    if (!id) {
      setMessage(t("prov.giveName"));
      return null;
    }
    if (isAzure && !draft.baseUrl.trim()) {
      setMessage(t("prov.endpointNeeded"));
      document.getElementById("provider-url")?.focus();
      return null;
    }

    const body: Record<string, unknown> = {
      id,
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
    // Stored icon: builtin file, https: URL, or data: URL. Empty clears
    // back to catalog-match-then-avatar. Omitted on update preserves it.
    if (customMode || draft.icon.trim()) body.icon = draft.icon.trim();
    else if (editing !== null) body.icon = draft.icon.trim();
    if (draft.routing === "weight") {
      const weights = listOfNums(draft.weights, t("prov.lblKeyWeights"), t);
      if (!weights.ok) return setMessage(weights.error!), null;
      body.weights = weights.values;
    }
    if (draft.keyMode === "replace") {
      // Keys pasted at once come one a line or separated by commas,
      // semicolons or spaces, like upstream reads them.
      const keys = splitKeys(draft.keys);
      if (!keys.length) {
        setMessage(t("prov.needKeys"));
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
    setMessage(t("prov.saving"));
    try {
      await api.request(
        isNew ? "/config/providers" : `/config/providers/${encodeURIComponent(editing as string)}`,
        isNew ? "POST" : "PUT",
        body,
      );
      close();
      setMessage(t("prov.saved"));
      onChanged();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Provider) {
    if (busy) return;
    if (!window.confirm(t("prov.delConfirm", { id: p.id }))) return;
    setBusy(true);
    setMessage(t("prov.deleting"));
    try {
      await api.del(`/config/providers/${encodeURIComponent(p.id)}`);
      setMessage(t("prov.deleted"));
      onChanged();
      // The row is gone: drop the editor but keep the notice, which the
      // list shows once the editor closes.
      setEditing(false);
      setCustomMode(false);
      setPreset(null);
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
      setMessage(t("prov.needTestModel"));
      return;
    }
    setBusy(true);
    setMessage(operation === "test" ? t("prov.testing") : t("prov.fetching"));
    try {
      const result = await api.post<{ models?: string[]; model?: string; elapsed_ms?: number }>(
        `/config/provider-tools/${operation === "models" ? "models" : "test"}`,
        { provider: body, ...(model ? { model } : {}) },
      );
      if (operation === "models") {
        const found = result.models ?? [];
        setDraft((d) => ({ ...d, models: [...new Set([...lines(d.models), ...found])].join("\n") }));
        setDiscovered(found);
        setMessage(t("prov.discovered", { n: found.length }));
      } else {
        setMessage(t("prov.verified", { model: result.model ?? "", ms: result.elapsed_ms ?? 0 }));
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Get-icon menu: the gateway validates the picture server-side and
  // hands back a small `data:` URL. A usable picture that fell through
  // clears back to the letter avatar with the reason, like upstream.
  async function fetchIcon(path: "favicon" | "url" | "", payload: Record<string, string>) {
    if (busy) return;
    if (path === "favicon" && !draft.baseUrl.trim()) {
      setMessage(t("prov.needBase"));
      return;
    }
    setBusy(true);
    setMessage(t("prov.iconLooking"));
    try {
      const target = path === "" ? "/config/icons" : `/config/icons/${path}`;
      const data = await api.post<{ icon?: string; failed?: string }>(target, payload);
      if (data.failed) {
        set({ icon: "" });
        setMessage(t("prov.iconFailed", { why: data.failed }));
      } else {
        set({ icon: data.icon ?? "" });
        setMessage("");
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
      <option value="">{t("common.unknown")}</option>
      <option value="true">{t("common.yes")}</option>
      <option value="false">{t("common.no")}</option>
    </>
  );

  const switchCustomProtocol = (v: string) => {
    setCustomUrls((m) => ({ ...m, [draft.protocol]: draft.baseUrl }));
    const next = customUrls[v] ?? "";
    const patch: Partial<Draft> = { protocol: v, baseUrl: next };
    if (v === "chat") patch.capChat = true;
    if (v === "responses") patch.capResponses = true;
    if (v === "anthropic") patch.capAnthropic = true;
    if (v === "gemini") patch.capGemini = true;
    set(patch);
  };

  // Advanced + limits stay available inside the custom dialog's
  // collapsed section, reusing the same draft fields as the full editor.
  const customAdvanced = (
    <>
      <FormSection title={t("prov.secModels")} description={t("prov.secModelsDesc")}>
        <Field label={t("prov.fContexts")} htmlFor="cst-contexts" help={t("prov.fContextsHelp")}>
          <textarea id="cst-contexts" className="input mono" rows={3} placeholder={"deepseek-chat=131072\ndeepseek-reasoner=65536"}
            value={draft.contexts} onChange={(e) => set({ contexts: e.target.value })} />
        </Field>
        <Field label={t("prov.fOutputs")} htmlFor="cst-outputs" help={t("prov.fOutputsHelp")}>
          <textarea id="cst-outputs" className="input mono" rows={3} placeholder={"claude-sonnet-4-5=32000\ngpt-5-mini=16384"}
            value={draft.outputs} onChange={(e) => set({ outputs: e.target.value })} />
        </Field>
        <Field label={t("prov.fFree")} htmlFor="cst-free" help={t("prov.fFreeHelp")}>
          <textarea id="cst-free" className="input mono" rows={3} placeholder={"deepseek-v4.1-flash\nglm-5.3"}
            value={draft.freeModels} onChange={(e) => set({ freeModels: e.target.value })} />
        </Field>
        <Field label={t("prov.fFallback")} htmlFor="cst-fallback" help={t("prov.fFallbackHelp")}>
          <textarea id="cst-fallback" className="input mono" rows={3} placeholder={"backup/model\ngroup/daily"}
            value={draft.fallback} onChange={(e) => set({ fallback: e.target.value })} />
        </Field>
      </FormSection>
      <FormSection title={t("prov.secKeyRouting")} description={t("prov.secKeyRoutingDesc")}>
        <div className="form-grid">
          <Field label={t("prov.fKeyRouting")} htmlFor="cst-routing">
            <select id="cst-routing" className="input"
              value={draft.routing} onChange={(e) => set({ routing: e.target.value })}>
              <option value="rotate">{t("prov.optRotate")}</option>
              <option value="order">{t("prov.optOrder")}</option>
              <option value="usage">{t("prov.optUsage")}</option>
              <option value="free_first">{t("prov.optFreeFirst")}</option>
              <option value="weight">{t("prov.optWeight")}</option>
            </select>
          </Field>
          <Field label={t("prov.fAffinity")} htmlFor="cst-affinity">
            <select id="cst-affinity" className="input"
              value={draft.affinity} onChange={(e) => set({ affinity: e.target.value })}>
              <option value="auto">{t("prov.optAuto")}</option>
              <option value="session">{t("prov.optSession")}</option>
              <option value="turn">{t("prov.optTurn")}</option>
              <option value="off">{t("prov.optOff")}</option>
            </select>
          </Field>
        </div>
        <Switch checked={draft.pinUpstream} onChange={(v) => set({ pinUpstream: v })}>
          {t("prov.pin")}
        </Switch>
      </FormSection>
      <FormSection title={t("prov.secLimits")} description={t("prov.secLimitsDesc")}>
        <div className="form-grid">
          <Field label={t("prov.fCooldown")} htmlFor="cst-cooldown" help={t("prov.fCooldownHelp")}>
            <input id="cst-cooldown" className="input" type="number" min="0" step="1"
              placeholder={t("prov.cooldownPh")}
              value={draft.cooldown} onChange={(e) => set({ cooldown: e.target.value })} />
          </Field>
          <Field label={t("prov.fMaxConc")} htmlFor="cst-max-conc">
            <input id="cst-max-conc" className="input" type="number" min="0" step="1"
              placeholder={t("prov.noLimit")}
              value={draft.maxConcurrency} onChange={(e) => set({ maxConcurrency: e.target.value })} />
          </Field>
          <Field label={t("prov.fMaxRpm")} htmlFor="cst-max-rpm">
            <input id="cst-max-rpm" className="input" type="number" min="0" step="1"
              placeholder={t("prov.noLimit")}
              value={draft.maxRpm} onChange={(e) => set({ maxRpm: e.target.value })} />
          </Field>
        </div>
        <Switch checked={draft.makeDefault} onChange={(v) => set({ makeDefault: v })}>
          {t("prov.makeDefault")}
        </Switch>
      </FormSection>
      <FormSection title={t("prov.secEndpoint")} description={t("prov.capsHelp")}>
        <fieldset className="choice-field">
          <legend>{t("prov.caps")}</legend>
          <div className="check-chips">
            <label><input type="checkbox" checked={draft.capChat} onChange={(e) => set({ capChat: e.target.checked })} /><span>Chat</span></label>
            <label><input type="checkbox" checked={draft.capResponses} onChange={(e) => set({ capResponses: e.target.checked })} /><span>Responses</span></label>
            <label><input type="checkbox" checked={draft.capAnthropic} onChange={(e) => set({ capAnthropic: e.target.checked })} /><span>Anthropic</span></label>
            <label><input type="checkbox" checked={draft.capGemini} onChange={(e) => set({ capGemini: e.target.checked })} /><span>Gemini</span></label>
          </div>
        </fieldset>
        <div className="form-grid three">
          <Field label={t("prov.capStreaming")} htmlFor="cst-streaming">
            <select id="cst-streaming" className="input"
              value={draft.capStreaming} onChange={(e) => set({ capStreaming: e.target.value })}>
              {triOptions}
            </select>
          </Field>
          <Field label={t("prov.capTools")} htmlFor="cst-tools">
            <select id="cst-tools" className="input"
              value={draft.capTools} onChange={(e) => set({ capTools: e.target.value })}>
              {triOptions}
            </select>
          </Field>
          <Field label={t("prov.capVision")} htmlFor="cst-vision">
            <select id="cst-vision" className="input"
              value={draft.capVision} onChange={(e) => set({ capVision: e.target.value })}>
              {triOptions}
            </select>
          </Field>
        </div>
      </FormSection>
    </>
  );

  const customForm = (
    <CustomProvider
      draft={{
        name: draft.name,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        keys: draft.keys,
        models: draft.models,
        testModel: draft.testModel,
        icon: draft.icon,
      }}
      set={(patch) => set(patch as Partial<Draft>)}
      busy={busy}
      message={message}
      presets={presets}
      onProtocol={switchCustomProtocol}
      onDetect={() => tool("models")}
      onTestEach={() => tool("test")}
      onFetchModels={() => tool("models")}
      onAutoIcon={() => fetchIcon("favicon", { url: draft.baseUrl, name: draft.name })}
      onIconUrl={(url) => fetchIcon("url", { url, base: draft.baseUrl, name: draft.name })}
      onIconFile={(data) => fetchIcon("", { data })}
      onCancel={close}
      onSave={save}
      advanced={customAdvanced}
    />
  );

  // The inline editor: the same FormSection body the Sheet had, rendered
  // inside the provider's card (or a stand-alone card for a new provider).
  // The row being edited, so the footer can offer upstream's Remove
  // for an existing provider and hide it for a new draft.
  const editingProvider = typeof editing === "string"
    ? (providers.find((p) => p.id === editing) ?? null)
    : null;
  // Live count for the key pool box, matching the custom dialog's hint:
  // keys come one a line or separated by commas.
  const poolKeyCount = splitKeys(draft.keys).length;
  // A local server's address moves each URL, keeping its path
  // (upstream provider.AtAddress). Shown first, only for local-kind
  // presets: a new draft from one, or a saved provider born from one.
  // A localhost base URL also qualifies, so older rows get the box.
  const presetBase = preset?.chat || preset?.responses || preset?.anthropic || preset?.gemini || "";
  const isLocalHost = (value: string): boolean => {
    const s = value.trim();
    if (!s) return false;
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
      const h = u.hostname.toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
    } catch {
      return false;
    }
  };
  const showServerAddress =
    editing === null
      ? preset?.kind === "local"
      : editingProvider
        ? (presets ?? []).some(
            (pr) => pr.kind === "local" &&
              (editingProvider.id === pr.id || editingProvider.id.startsWith(`${pr.id}-`)),
          ) || isLocalHost(draft.baseUrl)
        : false;
  const onServerAddress = (v: string) => {
    const patch: Partial<Draft> = { serverAddress: v };
    const next = withOriginUrl(draft.baseUrl || presetBase, v);
    if (next !== draft.baseUrl) patch.baseUrl = next;
    set(patch);
  };
  const onBaseUrl = (v: string) => {
    const patch: Partial<Draft> = { baseUrl: v };
    if (showServerAddress) {
      const o = originOfUrl(v);
      if (o && o !== draft.serverAddress) patch.serverAddress = o;
    }
    set(patch);
  };
  // A pasted curl command fills the form, like upstream: the request
  // URL becomes the base URL, an auth header the key.
  const onPasteCurl = (e: React.ClipboardEvent) => {
    const fill = curlFill(e.clipboardData?.getData("text") ?? "");
    if (!fill) return;
    e.preventDefault();
    const took: string[] = [];
    const patch: Partial<Draft> = {};
    if (fill.baseUrl) {
      patch.baseUrl = fill.baseUrl;
      const o = originOfUrl(fill.baseUrl);
      if (showServerAddress && o) patch.serverAddress = o;
      took.push(t("prov.fUrl"));
    }
    if (fill.key) {
      if (draft.keyMode !== "replace") patch.keyMode = "replace";
      patch.keys = fill.key;
      took.push(t("prov.keysLabel"));
    }
    set(patch);
    if (took.length) setMessage(t("prov.curlFilled", { what: took.join(" · ") }));
    if (!fill.key) document.getElementById("provider-keys")?.focus();
  };
  const editorForm = (
    <form className="editor" onSubmit={save} autoComplete="off">
      <div className="editor-head">
        {editing === null && preset ? (
          <>
            <VendorIcon name={preset.name} icon={preset.icon ?? null} size="sm" />
            <h3>{preset.name}</h3>
            {preset.note ? <span className="note">{preset.note}</span> : null}
          </>
        ) : (
          <h3>{editing === null ? t("prov.new") : t("prov.editTitle", { name: draft.name || draft.id })}</h3>
        )}
        {editing !== null ? <span className="sub"><code>{draft.id}</code></span> : null}
      </div>
      <div className="editor-body">
        {message ? (
          <Notice tone="accent" icon={<Info size={16} />} live>
            {message}
          </Notice>
        ) : null}

        {pairShown ? (
          <Field label={t("prov.region")}>
            <Segmented
              label={t("prov.region")}
              value={preset?.id ?? ""}
              onChange={(id) => {
                const next = pairShown.find((p) => p.id === id);
                if (next) switchPair(next);
              }}
              options={pairShown.map((p) => {
                const url = p.chat || p.responses || p.anthropic || p.gemini || "";
                const host = url ? hostOf(url) : p.id;
                const added = providers.some(
                  (pv) => pv.base_url && url && hostOf(pv.base_url) === host,
                );
                return {
                  value: p.id,
                  label: p.id.endsWith("-cn") ? t("add.china") : t("add.global"),
                  title: `${p.id.endsWith("-cn") ? t("add.china") : t("add.global")} ${host}${added ? ` · ${t("add.addedNote")}` : ""}`,
                };
              })}
            />
          </Field>
        ) : null}

        <FormSection title={t("prov.secEndpoint")} description={t("prov.secEndpointDesc")}>
          {showServerAddress ? (
            <Field label={t("prov.serverAddress")} htmlFor="provider-address" help={t("prov.serverAddressHelp")}>
              <input id="provider-address" className="input mono" inputMode="url" autoComplete="off" spellCheck={false}
                placeholder={originOfUrl(presetBase || draft.baseUrl)}
                value={draft.serverAddress} onChange={(e) => onServerAddress(e.target.value)} />
            </Field>
          ) : null}
          <div className="form-grid">
            <Field label={t("prov.fId")} htmlFor="provider-id"
              help={t("prov.fIdHelp")}>
              <input id="provider-id" className="input mono" required pattern="[A-Za-z0-9_-]+"
                placeholder="deepseek" readOnly={editing !== null}
                value={draft.id} onChange={(e) => set({ id: e.target.value })} />
            </Field>
            <Field label={t("prov.fName")} htmlFor="provider-name" help={t("prov.fNameHelp")}>
              <input id="provider-name" className="input" placeholder={t("prov.namePh")}
                value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t("prov.fProtocol")} htmlFor="provider-protocol">
              <select id="provider-protocol" className="input"
                value={draft.protocol} onChange={(e) => set({ protocol: e.target.value })}>
                <option value="chat">{t("prov.protoChat")}</option>
                <option value="responses">{t("prov.protoResponses")}</option>
                <option value="anthropic">{t("prov.protoAnthropic")}</option>
                <option value="gemini">{t("prov.protoGemini")}</option>
              </select>
            </Field>
            <Field label={isAzure ? t("prov.fEndpoint") : t("prov.fUrl")} htmlFor="provider-url"
              help={isAzure ? t("prov.azureEndpointHelp") : t("prov.fUrlHelp")}>
              <input id="provider-url" className="input mono" type="url" required={!isAzure}
                placeholder={isAzure && presetBase ? presetBase : "https://api.example.com/v1"}
                value={draft.baseUrl} onChange={(e) => onBaseUrl(e.target.value)} onPaste={onPasteCurl} />
            </Field>
          </div>
          <fieldset className="choice-field">
            <legend>{t("prov.caps")}</legend>
            <div className="check-chips">
              <label><input type="checkbox" checked={draft.capChat} onChange={(e) => set({ capChat: e.target.checked })} /><span>Chat</span></label>
              <label><input type="checkbox" checked={draft.capResponses} onChange={(e) => set({ capResponses: e.target.checked })} /><span>Responses</span></label>
              <label><input type="checkbox" checked={draft.capAnthropic} onChange={(e) => set({ capAnthropic: e.target.checked })} /><span>Anthropic</span></label>
              <label><input type="checkbox" checked={draft.capGemini} onChange={(e) => set({ capGemini: e.target.checked })} /><span>Gemini</span></label>
            </div>
            <p className="help">{t("prov.capsHelp")}</p>
          </fieldset>
          <div className="form-grid three">
            <Field label={t("prov.capStreaming")} htmlFor="provider-cap-streaming">
              <select id="provider-cap-streaming" className="input"
                value={draft.capStreaming} onChange={(e) => set({ capStreaming: e.target.value })}>
                {triOptions}
              </select>
            </Field>
            <Field label={t("prov.capTools")} htmlFor="provider-cap-tools">
              <select id="provider-cap-tools" className="input"
                value={draft.capTools} onChange={(e) => set({ capTools: e.target.value })}>
                {triOptions}
              </select>
            </Field>
            <Field label={t("prov.capVision")} htmlFor="provider-cap-vision">
              <select id="provider-cap-vision" className="input"
                value={draft.capVision} onChange={(e) => set({ capVision: e.target.value })}>
                {triOptions}
              </select>
            </Field>
          </div>
          <Switch checked={draft.makeDefault} onChange={(v) => set({ makeDefault: v })}>
            {t("prov.makeDefault")}
          </Switch>
        </FormSection>

        <FormSection title={t("prov.secModels")} description={t("prov.secModelsDesc")}>
          {isAzure ? <p className="help">{t("prov.azureModelsHint")}</p> : null}
          <Field label={t("prov.fModels")} htmlFor="provider-models" help={t("prov.fModelsHelp")}>
            <textarea id="provider-models" className="input mono" rows={4} placeholder={"deepseek-chat\ndeepseek-reasoner"}
              value={draft.models} onChange={(e) => set({ models: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label={t("prov.fContexts")} htmlFor="provider-contexts" help={t("prov.fContextsHelp")}>
              <textarea id="provider-contexts" className="input mono" rows={3} placeholder={"deepseek-chat=131072\ndeepseek-reasoner=65536"}
                value={draft.contexts} onChange={(e) => set({ contexts: e.target.value })} />
            </Field>
            <Field label={t("prov.fOutputs")} htmlFor="provider-outputs" help={t("prov.fOutputsHelp")}>
              <textarea id="provider-outputs" className="input mono" rows={3} placeholder={"claude-sonnet-4-5=32000\ngpt-5-mini=16384"}
                value={draft.outputs} onChange={(e) => set({ outputs: e.target.value })} />
            </Field>
            <Field label={t("prov.fFree")} htmlFor="provider-free-models" help={t("prov.fFreeHelp")}>
              <textarea id="provider-free-models" className="input mono" rows={3} placeholder={"deepseek-v4.1-flash\nglm-5.3"}
                value={draft.freeModels} onChange={(e) => set({ freeModels: e.target.value })} />
            </Field>
            <Field label={t("prov.fFallback")} htmlFor="provider-fallback" help={t("prov.fFallbackHelp")}>
              <textarea id="provider-fallback" className="input mono" rows={3} placeholder={"backup/model\ngroup/daily"}
                value={draft.fallback} onChange={(e) => set({ fallback: e.target.value })} />
            </Field>
          </div>
          <Field label={t("prov.fTestModel")} htmlFor="provider-test-model"
            help={t("prov.fTestModelHelp")}>
            <input id="provider-test-model" className="input mono" list="provider-discovered-models"
              placeholder={t("prov.testPh")}
              value={draft.testModel} onChange={(e) => set({ testModel: e.target.value })} />
            <datalist id="provider-discovered-models">
              {discovered.map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
        </FormSection>

        <FormSection title={t("prov.secCreds")} description={t("prov.secCredsDesc")}>
          <Segmented
            label={t("prov.keysLabel")}
            value={draft.keyMode}
            onChange={(value) => set({ keyMode: value })}
            options={[
              // No saved keys on a new provider, so upstream shows no keep
              // affordance either: only existing rows can keep theirs.
              ...(editing === null
                ? []
                : [{ value: "keep", label: t("prov.keepKeys"), disabled: false }]),
              { value: "replace", label: t("prov.replaceKeys") },
              { value: "clear", label: t("prov.noAuthOpt") },
            ]}
          />
          <p className="help">{t("prov.keysHelp")}</p>
          {showKeys ? (
            <Field label={t("prov.newKeys")} htmlFor="provider-keys" help={t("prov.newKeysHelp")}>
              <textarea id="provider-keys" className={`input mono${showPoolKeys ? "" : " secret"}`} rows={3} autoComplete="off" spellCheck={false}
                value={draft.keys} onChange={(e) => set({ keys: e.target.value })} onPaste={onPasteCurl} />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button type="button" className="link" onClick={() => setShowPoolKeys((v) => !v)}>
                  {showPoolKeys ? t("prov.hide") : t("prov.show")}
                </button>
                {poolKeyCount > 1 ? (
                  <span className="help" role="status" title={t("prov.keysCountTitle", { n: poolKeyCount })}>
                    {t("prov.nKeys", { n: poolKeyCount })}
                  </span>
                ) : null}
              </div>
            </Field>
          ) : null}
        </FormSection>

        <FormSection title={t("prov.secKeyRouting")} description={t("prov.secKeyRoutingDesc")}>
          <div className="form-grid">
            <Field label={t("prov.fKeyRouting")} htmlFor="provider-routing">
              <select id="provider-routing" className="input"
                value={draft.routing} onChange={(e) => set({ routing: e.target.value })}>
                <option value="rotate">{t("prov.optRotate")}</option>
                <option value="order">{t("prov.optOrder")}</option>
                <option value="usage">{t("prov.optUsage")}</option>
                <option value="free_first">{t("prov.optFreeFirst")}</option>
                <option value="weight">{t("prov.optWeight")}</option>
              </select>
            </Field>
            <Field label={t("prov.fAffinity")} htmlFor="provider-affinity">
              <select id="provider-affinity" className="input"
                value={draft.affinity} onChange={(e) => set({ affinity: e.target.value })}>
                <option value="auto">{t("prov.optAuto")}</option>
                <option value="session">{t("prov.optSession")}</option>
                <option value="turn">{t("prov.optTurn")}</option>
                <option value="off">{t("prov.optOff")}</option>
              </select>
            </Field>
            {draft.routing === "weight" ? (
              <Field label={t("prov.fWeights")} htmlFor="provider-weights"
                help={t("prov.fWeightsHelp")}>
                <textarea id="provider-weights" className="input mono" rows={3} placeholder={"3\n1\n4"}
                  value={draft.weights} onChange={(e) => set({ weights: e.target.value })} />
              </Field>
            ) : null}
            <Field label={t("prov.fKeyLimits")} htmlFor="provider-limits"
              help={t("prov.fKeyLimitsHelp")}>
              <textarea id="provider-limits" className="input mono" rows={3} placeholder={"5\n2"}
                value={draft.keyLimits} onChange={(e) => set({ keyLimits: e.target.value })} />
            </Field>
          </div>
          <Switch checked={draft.pinUpstream} onChange={(v) => set({ pinUpstream: v })}>
            {t("prov.pin")}
          </Switch>
        </FormSection>

        <FormSection title={t("prov.secLimits")} description={t("prov.secLimitsDesc")}>
          <div className="form-grid">
            <Field label={t("prov.fCooldown")} htmlFor="provider-cooldown"
              help={t("prov.fCooldownHelp")}>
              <input id="provider-cooldown" className="input" type="number" min="0" step="1"
                placeholder={t("prov.cooldownPh")}
                value={draft.cooldown} onChange={(e) => set({ cooldown: e.target.value })} />
            </Field>
            <Field label={t("prov.fMaxConc")} htmlFor="provider-max-concurrency">
              <input id="provider-max-concurrency" className="input" type="number" min="0" step="1"
                placeholder={t("prov.noLimit")}
                value={draft.maxConcurrency} onChange={(e) => set({ maxConcurrency: e.target.value })} />
            </Field>
            <Field label={t("prov.fMaxRpm")} htmlFor="provider-max-rpm">
              <input id="provider-max-rpm" className="input" type="number" min="0" step="1"
                placeholder={t("prov.noLimit")}
                value={draft.maxRpm} onChange={(e) => set({ maxRpm: e.target.value })} />
            </Field>
            <Field label={t("prov.fQueueLimit")} htmlFor="provider-queue-limit">
              <input id="provider-queue-limit" className="input" type="number" min="0" step="1"
                placeholder={t("prov.noBound")}
                value={draft.queueLimit} onChange={(e) => set({ queueLimit: e.target.value })} />
            </Field>
            <Field label={t("prov.fQueueWait")} htmlFor="provider-queue-wait">
              <input id="provider-queue-wait" className="input" type="number" min="0" step="1"
                placeholder={t("prov.waitPh")}
                value={draft.queueWait} onChange={(e) => set({ queueWait: e.target.value })} />
            </Field>
          </div>
        </FormSection>
      </div>
      <div className="editor-foot">
        {editingProvider ? (
          <button type="button" className="btn danger" onClick={() => remove(editingProvider)} disabled={busy}>
            {t("prov.remove")}
          </button>
        ) : null}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn" onClick={() => tool("models")} disabled={busy}>
          <ScanSearch size={14} aria-hidden="true" />
          {t("prov.discover")}
        </button>
        <button type="button" className="btn" onClick={() => tool("test")} disabled={busy}>
          <FlaskConical size={14} aria-hidden="true" />
          {t("prov.testConn")}
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t("prov.saving") : t("prov.saveProvider")}
        </button>
      </div>
    </form>
  );

  return (
    <>
      <PageHeader
        title={t("page.providersTitle")}
        subtitle={t("page.providersSub")}
      >
        <button type="button" className="btn primary" onClick={() => setAdding(true)} disabled={busy}>
          <Plus size={14} aria-hidden="true" />
          {t("prov.new")}
        </button>
      </PageHeader>

      {editing === false && message ? (
        <Notice tone="accent" icon={<Info size={16} />} live>
          {message}
        </Notice>
      ) : null}

      {adding ? (
        <AddProvider
          presets={presets}
          providers={providers}
          canClose={providers.length > 0}
          onPickPreset={openPreset}
          onPickCustom={openCustom}
          onOpen={openEdit}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editing === null && !adding && customMode ? customForm : null}
      {editing === null && !adding && !customMode ? <Card flush>{editorForm}</Card> : null}

      {!adding && config === null ? (
        <div className="pv-list" aria-busy="true" aria-label={t("side.loading")}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="pv-row pv-sk-row" aria-hidden="true">
              <span className="avatar skeleton pv-sk-icon" />
              <span className="pv-who pv-sk-who">
                <span className="skeleton pv-sk-name" />
                <span className="skeleton pv-sk-sub" />
              </span>
              <span className="skeleton pv-sk-key" />
            </div>
          ))}
        </div>
      ) : !adding && providers.length === 0 ? (
        editing === false ? (
          <Card>
            <Empty icon={<Server size={18} />} title={t("prov.emptyTitle")}>
              {t("prov.emptyCopy")}
            </Empty>
          </Card>
        ) : null
      ) : !adding ? (
        <>
          <div className="pv-toolbar">
            <label className="pv-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape" && query) setQuery(""); }}
                placeholder={t("prov.search")}
                aria-label={t("prov.search")}
              />
              {query ? (
                <button type="button" className="pv-clear" onClick={() => setQuery("")} aria-label={t("common.clear")}>
                  ×
                </button>
              ) : null}
            </label>
            <span className="pv-count" role="status">
              {filtered.length === 1 ? t("prov.countOne") : t("prov.count", { n: filtered.length })}
            </span>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <Empty icon={<Search size={18} />} title={t("prov.noMatch", { q: query.trim() })}>
                {t("prov.noMatchHint")}
              </Empty>
            </Card>
          ) : (
            <div className="pv-list">
              {filtered.map((p) => {
                const isDefault = config?.default_provider === p.id;
                const open = editing === p.id;
                const key = keyPill(p, t);
                const hits = modelHits(p, q);
                return (
                  <div key={p.id}>
                    <div className={`pv-row${open ? " selected" : ""}`}>
                      <button
                        type="button"
                        className="pv-main"
                        aria-expanded={open}
                        aria-label={t("prov.editAria", { id: p.id })}
                        onClick={() => (open ? close() : openEdit(p))}
                      >
                        <VendorIcon
                          name={p.name || p.id}
                          icon={p.icon || presetIconForHost(presets, hostOf(p.base_url))}
                        />
                        <span className="pv-who">
                          <span className="pv-name">
                            <span className="pv-nm">{p.name || p.id}</span>
                            {isDefault ? <Badge tone="accent">{t("prov.default")}</Badge> : null}
                            {(p.free_models ?? []).length > 0 ? (
                              <span className="badge">{t("prov.freeBadge", { n: (p.free_models ?? []).length })}</span>
                            ) : null}
                            {p.pin_upstream ? <span className="badge">{t("prov.pinned")}</span> : null}
                          </span>
                          <span className="pv-sub">
                            {hostOf(p.base_url)} · {modelsLabel(p, t)}
                          </span>
                          {hits.length > 0 ? (
                            <span className="pv-sub pv-hits">
                              {t("prov.serves", { models: hits.slice(0, 6).join(", ") })}
                            </span>
                          ) : null}
                        </span>
                        <span className={`pv-key ${key.tone}`} title={key.title}>
                          <span>{key.text}</span>
                        </span>
                        <span className="pv-chev" aria-hidden="true">
                          <ChevronRight size={15} />
                        </span>
                      </button>
                      <span className="pv-ops">
                        <button type="button" className="icon-btn" disabled={busy}
                          aria-label={t("prov.editAria", { id: p.id })} title={t("prov.editTitle_attr")} onClick={() => openEdit(p)}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="icon-btn danger" disabled={busy}
                          aria-label={t("prov.delAria", { id: p.id })} title={t("prov.delTitle_attr")} onClick={() => remove(p)}>
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                    {open ? <div className="pv-editor">{editorForm}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
        ) : null}
    </>
  );
}

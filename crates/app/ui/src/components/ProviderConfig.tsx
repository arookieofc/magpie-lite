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
} from "lucide-react";
import * as api from "../api";
import type { Config, ProviderConfig as Provider, VendorPreset } from "../types";
import { Badge, Card, Empty, Field, FormSection, Notice, PageHeader, Segmented, Sheet, Switch, Tabs } from "./ui";
import VendorIcon, { hostOf, presetIconForHost } from "./vendorIcon";
import { useT, type TFunc } from "../i18n";
import AddProvider, { type PastedEndpoint } from "./AddProvider";
import CustomProvider from "./CustomProvider";
import QuickAdd from "./QuickAdd";
import Select from "./Select";
import { Input, Textarea } from "./Input";
import { curlFill, originOfUrl, splitKeys, withOriginUrl } from "../util";
import { servesOf } from "../serves";

type ProviderTab = "general" | "models" | "routing";

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

function modelsLabel(p: Provider, t: TFunc): string {
  const n = (p.models ?? []).length;
  const base = n === 1 ? t("prov.oneModel") : n > 1 ? t("prov.nModels", { n }) : t("prov.noModels");
  const extra = (p.embeddings ?? []).length + (p.rerankers ?? []).length;
  return extra > 0 ? `${base} · ${t("prov.nRetrieval", { n: extra })}` : base;
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
  embeddings: string;
  rerankers: string;
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
    baseUrl: "", models: "", embeddings: "", rerankers: "", contexts: "", outputs: "", freeModels: "", fallback: "",
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
    embeddings: (p.embeddings ?? []).join("\n"),
    rerankers: (p.rerankers ?? []).join("\n"),
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
  presets?: VendorPreset[] | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}

export default function ProviderConfig({ config, presets: propPresets, busy, setBusy, onChanged }: Props) {
  const t = useT();
  const [editing, setEditing] = useState<string | null | false>(false);
  const [tab, setTab] = useState<ProviderTab>("general");
  const [draft, setDraft] = useState<Draft>(blankDraft(false));
  const [message, setMessage] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [showPoolKeys, setShowPoolKeys] = useState(false);

  useEffect(() => {
    setShowPoolKeys(false);
    setTab("general");
  }, [editing]);

  const providers = config?.providers ?? [];

  const [adding, setAdding] = useState(false);
  const [localPresets, setLocalPresets] = useState<VendorPreset[] | null>(null);
  const presets = propPresets !== undefined ? propPresets : localPresets;
  const [customMode, setCustomMode] = useState(false);
  const [preset, setPreset] = useState<VendorPreset | null>(null);
  const [quick, setQuick] = useState<VendorPreset | null>(null);
  const [quickMsg, setQuickMsg] = useState("");
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
  const booted = useRef(false);

  useEffect(() => {
    if (!booted.current && config) {
      booted.current = true;
      if (config.providers.length === 0) setAdding(true);
    }
  }, [config]);

  useEffect(() => {
    if (propPresets !== undefined) return;
    let live = true;
    api.get<VendorPreset[]>("/config/presets").then(
      (list) => { if (live) setLocalPresets(list); },
      () => { if (live) setLocalPresets([]); },
    );
    return () => { live = false; };
  }, [propPresets]);

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
    setQuick(null);
    setQuickMsg("");
    setCustomUrls({});
    const d = blankDraft(providers.length === 0);
    if (prefill?.baseUrl) d.baseUrl = prefill.baseUrl;
    if (prefill?.keys) {
      d.keyMode = "replace";
      d.keys = prefill.keys;
    }
    setDraft(d);
    setMessage("");
    setDiscovered([]);
  }

  function openPreset(pr: VendorPreset) {
    if (busy) return;
    if (pr.id === "azure" || pr.id.startsWith("azure-")) {
      const used = new Set(providers.map((p) => p.id));
      let id = pr.id, n = 2;
      while (used.has(id)) id = `${pr.id}-${n++}`;
      setAdding(false);
      setEditing(null);
      setCustomMode(false);
      setQuick(null);
      setQuickMsg("");
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
      return;
    }
    setAdding(false);
    setEditing(false);
    setCustomMode(false);
    setPreset(null);
    setQuick(pr);
    setQuickMsg("");
    setMessage("");
    setDiscovered([]);
  }

  const quickPair: VendorPreset[] | null =
    quick?.pair
      ? (presets ?? [])
          .filter((p) => p.pair === quick.pair)
          .sort((a, b) => (a.id.endsWith("-cn") ? 1 : 0) - (b.id.endsWith("-cn") ? 1 : 0))
      : null;
  const quickPairShown = quickPair && quickPair.length === 2 ? quickPair : null;

  function switchQuick(next: VendorPreset) {
    if (busy || !next || next.id === quick?.id) return;
    setQuick(next);
    setQuickMsg("");
  }

  async function quickSave(keysText: string) {
    if (busy || !quick) return;
    const keys = splitKeys(keysText);
    if (!keys.length && quick.kind !== "local") {
      setQuickMsg(t("quick.needKey", { name: quick.name }));
      return;
    }
    const baseUrl = quick.chat || quick.responses || quick.anthropic || quick.gemini || "";
    if (!baseUrl) {
      setQuickMsg(t("prov.needBase"));
      return;
    }
    const used = new Set(providers.map((p) => p.id));
    let id = quick.id, n = 2;
    while (used.has(id)) id = `${quick.id}-${n++}`;
    const body: Record<string, unknown> = {
      id,
      name: quick.name,
      protocol: quick.protocol,
      capabilities: {
        supported_protocols: [
          ...new Set(
            [
              quick.chat ? "chat" : null,
              quick.responses ? "responses" : null,
              quick.anthropic ? "anthropic" : null,
              quick.gemini ? "gemini" : null,
              quick.protocol,
            ].filter(Boolean),
          ),
        ],
        streaming: null,
        tools: null,
        vision: null,
      },
      base_url: baseUrl,
      models: [],
      contexts: {},
      outputs: {},
      free_models: [],
      fallback: [],
      key_cooldown_ms: null,
      max_concurrency: null,
      max_rpm: null,
      queue_limit: null,
      queue_wait_s: null,
      pin_upstream: false,
      make_default: providers.length === 0,
      routing: "rotate",
      affinity: "auto",
      key_limits: [],
      weights: [],
      api_keys: keys,
    };
    setBusy(true);
    setQuickMsg(t("prov.saving"));
    try {
      await api.request("/config/providers", "POST", body);
      setQuick(null);
      setQuickMsg("");
      setMessage(t("prov.saved"));
      onChanged();
    } catch (err) {
      setQuickMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pairEntries: VendorPreset[] | null =
    editing === null && preset?.pair
      ? (presets ?? [])
          .filter((p) => p.pair === preset.pair)
          .sort((a, b) => (a.id.endsWith("-cn") ? 1 : 0) - (b.id.endsWith("-cn") ? 1 : 0))
      : null;
  const pairShown = pairEntries && pairEntries.length === 2 ? pairEntries : null;

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
    setQuick(null);
    setQuickMsg("");
    setDraft(draftFrom(p, config?.default_provider === p.id));
    setMessage("");
    setDiscovered([]);
  }

  function close() {
    setEditing(false);
    setCustomMode(false);
    setPreset(null);
    setQuick(null);
    setQuickMsg("");
    setMessage("");
  }

  function buildBody(): Record<string, unknown> | null {
    const cooldown = numField(draft.cooldown, t("prov.lblCooldown"), t);
    if (!cooldown.ok) { setTab("routing"); return setMessage(cooldown.error!), null; }
    const maxConcurrency = numField(draft.maxConcurrency, t("prov.lblMaxConc"), t);
    if (!maxConcurrency.ok) { setTab("routing"); return setMessage(maxConcurrency.error!), null; }
    const maxRpm = numField(draft.maxRpm, t("prov.lblMaxRpm"), t);
    if (!maxRpm.ok) { setTab("routing"); return setMessage(maxRpm.error!), null; }
    const queueLimit = numField(draft.queueLimit, t("prov.lblQueueBound"), t);
    if (!queueLimit.ok) { setTab("routing"); return setMessage(queueLimit.error!), null; }
    const queueWait = numField(draft.queueWait, t("prov.lblQueueWait"), t);
    if (!queueWait.ok) { setTab("routing"); return setMessage(queueWait.error!), null; }
    const contexts = mapField(draft.contexts, t("prov.lblContexts"), t);
    if (!contexts.map) { setTab("models"); return setMessage(contexts.error!), null; }
    const outputs = mapField(draft.outputs, t("prov.lblOutputs"), t);
    if (!outputs.map) { setTab("models"); return setMessage(outputs.error!), null; }
    const keyLimits = listOfNums(draft.keyLimits, t("prov.lblKeyLimits"), t);
    if (!keyLimits.ok) { setTab("routing"); return setMessage(keyLimits.error!), null; }

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
      if (used.has(id)) {
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
      setTab("general");
      setMessage(t("prov.giveName"));
      return null;
    }
    if (!draft.baseUrl.trim()) {
      setTab("general");
      setMessage(isAzure ? t("prov.endpointNeeded") : t("prov.needBase"));
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
      embeddings: lines(draft.embeddings),
      rerankers: lines(draft.rerankers),
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
    if (customMode || draft.icon.trim()) body.icon = draft.icon.trim();
    else if (editing !== null) body.icon = draft.icon.trim();
    if (draft.routing === "weight") {
      const weights = listOfNums(draft.weights, t("prov.lblKeyWeights"), t);
      if (!weights.ok) { setTab("routing"); return setMessage(weights.error!), null; }
      body.weights = weights.values;
    }
    if (draft.keyMode === "replace") {
      const keys = splitKeys(draft.keys);
      if (!keys.length) {
        setTab("general");
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
      setTab("models");
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
        setDraft((d) => {
          const patch: Partial<Draft> = {};
          for (const id of found) {
            const bucket = servesOf(id) === "embedding" ? "embeddings"
              : servesOf(id) === "rerank" ? "rerankers" : "models";
            const current = lines(d[bucket]);
            if (!current.includes(id)) patch[bucket] = [...current, id].join("\n");
          }
          for (const bucket of ["models", "embeddings", "rerankers"] as const) {
            if (patch[bucket] === undefined) patch[bucket] = lines(d[bucket]).join("\n");
          }
          return { ...d, ...patch };
        });
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

  const triOptions = [
    { value: "", label: t("common.unknown") },
    { value: "true", label: t("common.yes") },
    { value: "false", label: t("common.no") },
  ];

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

  const customAdvanced = (
    <>
      <FormSection title={t("prov.secModels")} description={t("prov.secModelsDesc")}>
        <Field label={t("prov.fContexts")} htmlFor="cst-contexts" help={t("prov.fContextsHelp")}>
          <Textarea mono id="cst-contexts" rows={3} placeholder={"deepseek-chat=131072\ndeepseek-reasoner=65536"}
            value={draft.contexts} onChange={(e) => set({ contexts: e.target.value })} />
        </Field>
        <Field label={t("prov.fOutputs")} htmlFor="cst-outputs" help={t("prov.fOutputsHelp")}>
          <Textarea mono id="cst-outputs" rows={3} placeholder={"claude-sonnet-4-5=32000\ngpt-5-mini=16384"}
            value={draft.outputs} onChange={(e) => set({ outputs: e.target.value })} />
        </Field>
        <Field label={t("prov.fFree")} htmlFor="cst-free" help={t("prov.fFreeHelp")}>
          <Textarea mono id="cst-free" rows={3} placeholder={"deepseek-v4.1-flash\nglm-5.3"}
            value={draft.freeModels} onChange={(e) => set({ freeModels: e.target.value })} />
        </Field>
        <Field label={t("prov.fFallback")} htmlFor="cst-fallback" help={t("prov.fFallbackHelp")}>
          <Textarea mono id="cst-fallback" rows={3} placeholder={"backup/model\ngroup/daily"}
            value={draft.fallback} onChange={(e) => set({ fallback: e.target.value })} />
        </Field>
      </FormSection>
      <FormSection title={t("prov.secKeyRouting")} description={t("prov.secKeyRoutingDesc")}>
        <div className="form-grid">
          <Field label={t("prov.fKeyRouting")} htmlFor="cst-routing">
            <Select id="cst-routing"
              value={draft.routing} onChange={(value) => set({ routing: value })}
              options={[
                { value: "rotate", label: t("prov.optRotate") },
                { value: "order", label: t("prov.optOrder") },
                { value: "usage", label: t("prov.optUsage") },
                { value: "free_first", label: t("prov.optFreeFirst") },
                { value: "weight", label: t("prov.optWeight") },
              ]}
            />
          </Field>
          <Field label={t("prov.fAffinity")} htmlFor="cst-affinity">
            <Select id="cst-affinity"
              value={draft.affinity} onChange={(value) => set({ affinity: value })}
              options={[
                { value: "auto", label: t("prov.optAuto") },
                { value: "session", label: t("prov.optSession") },
                { value: "turn", label: t("prov.optTurn") },
                { value: "off", label: t("prov.optOff") },
              ]}
            />
          </Field>
        </div>
        <Switch checked={draft.pinUpstream} onChange={(v) => set({ pinUpstream: v })}>
          {t("prov.pin")}
        </Switch>
      </FormSection>
      <FormSection title={t("prov.secLimits")} description={t("prov.secLimitsDesc")}>
        <div className="form-grid">
          <Field label={t("prov.fCooldown")} htmlFor="cst-cooldown" help={t("prov.fCooldownHelp")}>
            <Input id="cst-cooldown" type="number" min="0" step="1"
              placeholder={t("prov.cooldownPh")}
              value={draft.cooldown} onChange={(e) => set({ cooldown: e.target.value })} />
          </Field>
          <Field label={t("prov.fMaxConc")} htmlFor="cst-max-conc">
            <Input id="cst-max-conc" type="number" min="0" step="1"
              placeholder={t("prov.noLimit")}
              value={draft.maxConcurrency} onChange={(e) => set({ maxConcurrency: e.target.value })} />
          </Field>
          <Field label={t("prov.fMaxRpm")} htmlFor="cst-max-rpm">
            <Input id="cst-max-rpm" type="number" min="0" step="1"
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
            <Select id="cst-streaming"
              value={draft.capStreaming} onChange={(value) => set({ capStreaming: value })}
              options={triOptions}
            />
          </Field>
          <Field label={t("prov.capTools")} htmlFor="cst-tools">
            <Select id="cst-tools"
              value={draft.capTools} onChange={(value) => set({ capTools: value })}
              options={triOptions}
            />
          </Field>
          <Field label={t("prov.capVision")} htmlFor="cst-vision">
            <Select id="cst-vision"
              value={draft.capVision} onChange={(value) => set({ capVision: value })}
              options={triOptions}
            />
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
        altUrls: customUrls,
        keys: draft.keys,
        models: draft.models,
        embeddings: draft.embeddings,
        rerankers: draft.rerankers,
        testModel: draft.testModel,
        icon: draft.icon,
      }}
      set={(patch) => {
        if (patch.altUrls) {
          setCustomUrls(patch.altUrls as Record<string, string>);
          delete patch.altUrls;
        }
        set(patch as Partial<Draft>);
      }}
      busy={busy}
      message={message}
      presets={presets}
      discovered={discovered}
      onProtocol={switchCustomProtocol}
      onDetect={() => tool("models")}
      onTestEach={() => tool("test")}
      onFetchModels={() => tool("models")}
      onAutoIcon={() => fetchIcon("favicon", { url: draft.baseUrl, name: draft.name })}
      onIconUrl={(url) => fetchIcon("url", { url, base: draft.baseUrl, name: draft.name })}
      onIconFile={(data) => fetchIcon("", { data })}
      onCancel={close}
      onSave={save}
      onNote={setMessage}
      advanced={customAdvanced}
    />
  );

  const editingProvider = typeof editing === "string"
    ? (providers.find((p) => p.id === editing) ?? null)
    : null;

  const editPreset = (() => {
    if (typeof editing !== "string" || !editingProvider) return null;
    const list = presets ?? [];
    const byId = list.find(
      (pr) => editingProvider.id === pr.id || editingProvider.id.startsWith(`${pr.id}-`),
    );
    if (byId) return byId;
    const host = editingProvider.base_url ? hostOf(editingProvider.base_url) : "";
    if (!host) return null;
    return list.find((pr) => {
      const u = pr.chat || pr.responses || pr.anthropic || pr.gemini || "";
      return !!u && hostOf(u) === host;
    }) ?? null;
  })();

  const poolKeyCount = splitKeys(draft.keys).length;

  const keysUrl = editing === null
    ? (preset?.keys_url ?? null)
    : (() => {
        if (!editingProvider) return null;
        const list = presets ?? [];
        const byId = list.find(
          (pr) => editingProvider.id === pr.id || editingProvider.id.startsWith(`${pr.id}-`),
        );
        if (byId?.keys_url) return byId.keys_url;
        const host = editingProvider.base_url ? hostOf(editingProvider.base_url) : "";
        if (host) {
          const byHost = list.find((pr) => {
            const u = pr.chat || pr.responses || pr.anthropic || pr.gemini || "";
            return !!u && !!pr.keys_url && hostOf(u) === host;
          });
          if (byHost?.keys_url) return byHost.keys_url;
        }
        return null;
      })();

  const siteUrl = editing === null
    ? (preset?.website ?? null)
    : (() => {
        if (!editingProvider) return null;
        const list = presets ?? [];
        const byId = list.find(
          (pr) => editingProvider.id === pr.id || editingProvider.id.startsWith(`${pr.id}-`),
        );
        if (byId?.website) return byId.website;
        const host = editingProvider.base_url ? hostOf(editingProvider.base_url) : "";
        if (host) {
          const byHost = list.find((pr) => {
            const u = pr.chat || pr.responses || pr.anthropic || pr.gemini || "";
            return !!u && !!pr.website && hostOf(u) === host;
          });
          if (byHost?.website) return byHost.website;
        }
        const origin = originOfUrl(editingProvider.base_url);
        if (origin) {
          const hostPort = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] || "";
          if (/[.:]/.test(hostPort)) return origin;
        }
        return null;
      })();

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

  const onPasteCurl = (e: React.ClipboardEvent): boolean => {
    const fill = curlFill(e.clipboardData?.getData("text") ?? "");
    if (!fill) return false;
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
    if (fill.model && !draft.testModel) {
      patch.testModel = fill.model;
      took.push(t("prov.fTestModel"));
    }
    set(patch);
    if (took.length) setMessage(t("prov.curlFilled", { what: took.join(" · ") }));
    if (!fill.key) document.getElementById("provider-keys")?.focus();
    return true;
  };

  const sheetOpen = editing !== false && !customMode && !adding;
  const sheetTitle = editing === null && preset
    ? preset.name
    : editing === null
      ? t("prov.new")
      : t("prov.editTitle", { name: draft.name || draft.id });
  const sheetDesc = (editing === null ? preset?.note : editPreset?.note)
    ? t(((editing === null ? preset?.note : editPreset?.note)!) as Parameters<TFunc>[0])
    : editing !== null
      ? draft.id
      : undefined;
  const sheetIcon = editing === null && preset ? (
    <VendorIcon name={preset.name} icon={preset.icon ?? null} size="sm" />
  ) : editingProvider ? (
    <VendorIcon
      name={editingProvider.name || editingProvider.id}
      icon={editingProvider.icon || presetIconForHost(presets, hostOf(editingProvider.base_url)) || null}
      size="sm"
    />
  ) : (
    <Server size={18} />
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

      {!sheetOpen && !customMode && message ? (
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

      {quick ? (
        <QuickAdd
          preset={quick}
          pair={quickPairShown}
          busy={busy}
          onPickRegion={switchQuick}
          onClose={() => {
            if (busy) return;
            setQuick(null);
            setQuickMsg("");
          }}
          onSave={quickSave}
          message={quickMsg}
        />
      ) : null}

      {editing === null && !adding && customMode ? customForm : null}

      <Sheet
        open={sheetOpen}
        wide
        onClose={close}
        busy={busy}
        title={sheetTitle}
        description={sheetDesc}
        icon={sheetIcon}
        onSubmit={save}
        footer={
          <>
            {editingProvider ? (
              <button type="button" className="btn danger" onClick={() => remove(editingProvider)} disabled={busy}>
                {t("prov.remove")}
              </button>
            ) : null}
            {siteUrl ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  api.openExternal(siteUrl).catch((err) => setMessage((err as Error).message));
                }}
              >
                {siteUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].toLowerCase()} ↗
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
          </>
        }
      >
        {message ? (
          <Notice tone="accent" icon={<Info size={16} />} live>
            {message}
          </Notice>
        ) : null}

        <Tabs<ProviderTab>
          label={sheetTitle}
          value={tab}
          onChange={setTab}
          options={[
            { value: "general", label: t("prov.tabGeneral") },
            { value: "models", label: t("prov.tabModels") },
            { value: "routing", label: t("prov.tabRouting") },
          ]}
        />

        <div hidden={tab !== "general"} className="form-section-body">
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
                <Input mono id="provider-address" inputMode="url" autoComplete="off" spellCheck={false}
                  placeholder={originOfUrl(presetBase || draft.baseUrl)}
                  value={draft.serverAddress} onChange={(e) => onServerAddress(e.target.value)} />
              </Field>
            ) : null}
            <div className="form-grid">
              <Field label={t("prov.fId")} htmlFor="provider-id" help={t("prov.fIdHelp")}>
                <Input mono id="provider-id" pattern="[A-Za-z0-9_-]+"
                  placeholder="deepseek" readOnly={editing !== null}
                  value={draft.id} onChange={(e) => set({ id: e.target.value })} />
              </Field>
              <Field label={t("prov.fName")} htmlFor="provider-name" help={t("prov.fNameHelp")}>
                <Input id="provider-name" placeholder={t("prov.namePh")}
                  value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label={t("prov.fProtocol")} htmlFor="provider-protocol">
                <Select id="provider-protocol"
                  value={draft.protocol} onChange={(value) => set({ protocol: value })}
                  options={[
                    { value: "chat", label: t("prov.protoChat") },
                    { value: "responses", label: t("prov.protoResponses") },
                    { value: "anthropic", label: t("prov.protoAnthropic") },
                    { value: "gemini", label: t("prov.protoGemini") },
                  ]}
                />
              </Field>
              <Field label={isAzure ? t("prov.fEndpoint") : t("prov.fUrl")} htmlFor="provider-url"
                help={isAzure ? t("prov.azureEndpointHelp") : t("prov.fUrlHelp")}>
                <Input mono id="provider-url" type="url"
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
                <Select id="provider-cap-streaming"
                  value={draft.capStreaming} onChange={(value) => set({ capStreaming: value })}
                  options={triOptions}
                />
              </Field>
              <Field label={t("prov.capTools")} htmlFor="provider-cap-tools">
                <Select id="provider-cap-tools"
                  value={draft.capTools} onChange={(value) => set({ capTools: value })}
                  options={triOptions}
                />
              </Field>
              <Field label={t("prov.capVision")} htmlFor="provider-cap-vision">
                <Select id="provider-cap-vision"
                  value={draft.capVision} onChange={(value) => set({ capVision: value })}
                  options={triOptions}
                />
              </Field>
            </div>
            <Switch checked={draft.makeDefault} onChange={(v) => set({ makeDefault: v })}>
              {t("prov.makeDefault")}
            </Switch>
          </FormSection>

          <FormSection title={t("prov.secCreds")} description={t("prov.secCredsDesc")}>
            <Segmented
              label={t("prov.keysLabel")}
              value={draft.keyMode}
              onChange={(value) => set({ keyMode: value })}
              options={[
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
                <Textarea id="provider-keys" mono secret={!showPoolKeys} rows={3} autoComplete="off" spellCheck={false}
                  value={draft.keys} onChange={(e) => set({ keys: e.target.value })} onPaste={onPasteCurl}
                  placeholder={t("prov.keyPh")} />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button type="button" className="link" onClick={() => setShowPoolKeys((v) => !v)}>
                    {showPoolKeys ? t("prov.hide") : t("prov.show")}
                  </button>
                  {poolKeyCount > 1 ? (
                    <span className="help" role="status" data-tip={t("prov.keysCountTitle", { n: poolKeyCount })}>
                      {t("prov.nKeys", { n: poolKeyCount })}
                    </span>
                  ) : null}
                  {keysUrl ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        api.openExternal(keysUrl).catch((err) => setMessage((err as Error).message));
                      }}
                    >
                      {t("prov.getKey")}
                    </button>
                  ) : null}
                </div>
              </Field>
            ) : null}
          </FormSection>
        </div>

        <div hidden={tab !== "models"} className="form-section-body">
          <FormSection title={t("prov.secModels")} description={t("prov.secModelsDesc")}>
            {isAzure ? <p className="help">{t("prov.azureModelsHint")}</p> : null}
            <Field label={t("prov.fModels")} htmlFor="provider-models" help={t("prov.fModelsHelp")}>
              <Textarea mono id="provider-models" rows={5} placeholder={"deepseek-chat\ndeepseek-reasoner"}
                value={draft.models} onChange={(e) => set({ models: e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field label={t("prov.fEmbeddings")} htmlFor="provider-embeddings" help={t("prov.fEmbeddingsHelp")}>
                <Textarea mono id="provider-embeddings" rows={2} placeholder={"text-embedding-3-small\nbge-m3"}
                  value={draft.embeddings} onChange={(e) => set({ embeddings: e.target.value })} />
              </Field>
              <Field label={t("prov.fRerankers")} htmlFor="provider-rerankers" help={t("prov.fRerankersHelp")}>
                <Textarea mono id="provider-rerankers" rows={2} placeholder={"bge-reranker-v2-m3\nrerank-3-lite"}
                  value={draft.rerankers} onChange={(e) => set({ rerankers: e.target.value })} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label={t("prov.fContexts")} htmlFor="provider-contexts" help={t("prov.fContextsHelp")}>
                <Textarea mono id="provider-contexts" rows={3} placeholder={"deepseek-chat=131072\ndeepseek-reasoner=65536"}
                  value={draft.contexts} onChange={(e) => set({ contexts: e.target.value })} />
              </Field>
              <Field label={t("prov.fOutputs")} htmlFor="provider-outputs" help={t("prov.fOutputsHelp")}>
                <Textarea mono id="provider-outputs" rows={3} placeholder={"claude-sonnet-4-5=32000\ngpt-5-mini=16384"}
                  value={draft.outputs} onChange={(e) => set({ outputs: e.target.value })} />
              </Field>
              <Field label={t("prov.fFree")} htmlFor="provider-free-models" help={t("prov.fFreeHelp")}>
                <Textarea mono id="provider-free-models" rows={3} placeholder={"deepseek-v4.1-flash\nglm-5.3"}
                  value={draft.freeModels} onChange={(e) => set({ freeModels: e.target.value })} />
              </Field>
              <Field label={t("prov.fFallback")} htmlFor="provider-fallback" help={t("prov.fFallbackHelp")}>
                <Textarea mono id="provider-fallback" rows={3} placeholder={"backup/model\ngroup/daily"}
                  value={draft.fallback} onChange={(e) => set({ fallback: e.target.value })} />
              </Field>
            </div>
            <Field label={t("prov.fTestModel")} htmlFor="provider-test-model" help={t("prov.fTestModelHelp")}>
              <Input mono id="provider-test-model" list="provider-discovered-models"
                placeholder={t("prov.testPh")}
                value={draft.testModel} onChange={(e) => set({ testModel: e.target.value })} />
              <datalist id="provider-discovered-models">
                {discovered.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Field>
          </FormSection>
        </div>

        <div hidden={tab !== "routing"} className="form-section-body">
          <FormSection title={t("prov.secKeyRouting")} description={t("prov.secKeyRoutingDesc")}>
            <div className="form-grid">
              <Field label={t("prov.fKeyRouting")} htmlFor="provider-routing">
                <Select id="provider-routing"
                  value={draft.routing} onChange={(value) => set({ routing: value })}
                  options={[
                    { value: "rotate", label: t("prov.optRotate") },
                    { value: "order", label: t("prov.optOrder") },
                    { value: "usage", label: t("prov.optUsage") },
                    { value: "free_first", label: t("prov.optFreeFirst") },
                    { value: "weight", label: t("prov.optWeight") },
                  ]}
                />
              </Field>
              <Field label={t("prov.fAffinity")} htmlFor="provider-affinity">
                <Select id="provider-affinity"
                  value={draft.affinity} onChange={(value) => set({ affinity: value })}
                  options={[
                    { value: "auto", label: t("prov.optAuto") },
                    { value: "session", label: t("prov.optSession") },
                    { value: "turn", label: t("prov.optTurn") },
                    { value: "off", label: t("prov.optOff") },
                  ]}
                />
              </Field>
              {draft.routing === "weight" ? (
                <Field label={t("prov.fWeights")} htmlFor="provider-weights" help={t("prov.fWeightsHelp")}>
                  <Textarea mono id="provider-weights" rows={3} placeholder={"3\n1\n4"}
                    value={draft.weights} onChange={(e) => set({ weights: e.target.value })} />
                </Field>
              ) : null}
              <Field label={t("prov.fKeyLimits")} htmlFor="provider-limits" help={t("prov.fKeyLimitsHelp")}>
                <Textarea mono id="provider-limits" rows={3} placeholder={"5\n2"}
                  value={draft.keyLimits} onChange={(e) => set({ keyLimits: e.target.value })} />
              </Field>
            </div>
            <Switch checked={draft.pinUpstream} onChange={(v) => set({ pinUpstream: v })}>
              {t("prov.pin")}
            </Switch>
          </FormSection>

          <FormSection title={t("prov.secLimits")} description={t("prov.secLimitsDesc")}>
            <div className="form-grid">
              <Field label={t("prov.fCooldown")} htmlFor="provider-cooldown" help={t("prov.fCooldownHelp")}>
                <Input id="provider-cooldown" type="number" min="0" step="1"
                  placeholder={t("prov.cooldownPh")}
                  value={draft.cooldown} onChange={(e) => set({ cooldown: e.target.value })} />
              </Field>
              <Field label={t("prov.fMaxConc")} htmlFor="provider-max-concurrency">
                <Input id="provider-max-concurrency" type="number" min="0" step="1"
                  placeholder={t("prov.noLimit")}
                  value={draft.maxConcurrency} onChange={(e) => set({ maxConcurrency: e.target.value })} />
              </Field>
              <Field label={t("prov.fMaxRpm")} htmlFor="provider-max-rpm">
                <Input id="provider-max-rpm" type="number" min="0" step="1"
                  placeholder={t("prov.noLimit")}
                  value={draft.maxRpm} onChange={(e) => set({ maxRpm: e.target.value })} />
              </Field>
              <Field label={t("prov.fQueueLimit")} htmlFor="provider-queue-limit">
                <Input id="provider-queue-limit" type="number" min="0" step="1"
                  placeholder={t("prov.noBound")}
                  value={draft.queueLimit} onChange={(e) => set({ queueLimit: e.target.value })} />
              </Field>
              <Field label={t("prov.fQueueWait")} htmlFor="provider-queue-wait">
                <Input id="provider-queue-wait" type="number" min="0" step="1"
                  placeholder={t("prov.waitPh")}
                  value={draft.queueWait} onChange={(e) => set({ queueWait: e.target.value })} />
              </Field>
            </div>
          </FormSection>
        </div>
      </Sheet>

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
        !sheetOpen && !customMode ? (
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
                  <div key={p.id} className={`pv-row${open ? " selected" : ""}`}>
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
                          <span className="pill-mini mono">{p.protocol}</span>
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
                      <span className={`pv-key ${key.tone}`} data-tip={key.title}>
                        <span>{key.text}</span>
                      </span>
                    </button>
                    <span className="pv-ops">
                      <button type="button" className="icon-btn" disabled={busy}
                        aria-label={t("prov.editAria", { id: p.id })} data-tip={t("prov.editTitle_attr")} onClick={() => openEdit(p)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="icon-btn danger" disabled={busy}
                        aria-label={t("prov.delAria", { id: p.id })} data-tip={t("prov.delTitle_attr")} onClick={() => remove(p)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
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

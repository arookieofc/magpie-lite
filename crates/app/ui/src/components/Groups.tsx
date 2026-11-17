import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Info,
  ListFilter,
  Pencil,
  Plus,
  ScanSearch,
  SlidersHorizontal,
  Trash2,
  Waypoints,
} from "lucide-react";
import * as api from "../api";
import type { Config, GroupConfig, ModelsResponse, ProviderConfig, RoutingRule, Stats } from "../types";
import { Badge, Card, Empty, Field, FormSection, Notice, PageHeader, Switch } from "./ui";
import Select from "./Select";
import { useT, type TFunc } from "../i18n";

const RULE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const RULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const RULE_CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const LEVELS = ["low", "medium", "high", "xhigh", "max"];

function policyLabel(v: string, t: TFunc): string {
  switch (v) {
    case "order": return t("groups.policyOrder");
    case "rotate": return t("groups.policyRotate");
    case "usage": return t("groups.policyUsage");
    case "free_first": return t("groups.policyFreeFirst");
    case "weight": return t("groups.policyWeight");
    case "manual": return t("groups.policyManual");
    default: return v;
  }
}

function policyHelp(v: string, t: TFunc): string {
  switch (v) {
    case "order": return t("groups.policyHelpOrder");
    case "rotate": return t("groups.policyHelpRotate");
    case "usage": return t("groups.policyHelpUsage");
    case "free_first": return t("groups.policyHelpFreeFirst");
    case "weight": return t("groups.policyHelpWeight");
    case "manual": return t("groups.policyHelpManual");
    default: return "";
  }
}

interface Props {
  config: Config | null;
  models: ModelsResponse | null;
  stats: Stats | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}

interface Draft {
  id: string;
  name: string;
  members: MemberRow[];
  routing: string;
  pick: string;
  affinity: string;
  firstToken: string;
  patience: string;
  classifier: string;
  effort: string;
  levels: string;
  rules: RoutingRule[];
}

interface RuleDraft {
  use: string;
  tokens: string;
  effort: string;
  useEffort: string;
  agents: string;
  intent: string;
  from: string;
  to: string;
  days: string;
  folders: string;
  exceptFolders: string;
  images: boolean;
  compact: boolean;
  pause: boolean;
}

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

interface MemberRow {
  provider: string;
  model: string;
  level: string;
  weight: string;
}

const blankMember = (): MemberRow => ({ provider: "", model: "", level: "", weight: "" });

function splitMemberRoute(
  route: string,
  providers: ProviderConfig[],
): MemberRow {
  const trimmed = route.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { provider: "", model: trimmed, level: "", weight: "" };
  const provider = trimmed.slice(0, slash);
  let rest = trimmed.slice(slash + 1);
  let level = "";
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    const tail = rest.slice(colon + 1).toLowerCase();
    if (LEVELS.includes(tail)) {
      const known = providers
        .find((p) => p.id === provider)
        ?.models?.includes(rest);
      if (!known) {
        level = tail;
        rest = rest.slice(0, colon);
      }
    }
  }
  return { provider, model: rest, level, weight: "" };
}

function serializeMember(member: MemberRow): string {
  const provider = member.provider.trim();
  const model = member.model.trim();
  if (!provider || !model) return "";
  const base = `${provider}/${model}`;
  return member.level ? `${base}:${member.level}` : base;
}

function splitClassifier(value: string): { provider: string; model: string } {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { provider: "", model: trimmed };
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

const emptyDraft = (): Draft => ({
  id: "",
  name: "",
  members: [blankMember()],
  routing: "order",
  pick: "",
  affinity: "auto",
  firstToken: "0",
  patience: "",
  classifier: "",
  effort: "",
  levels: "",
  rules: [],
});

const draftFrom = (group: GroupConfig, providers: ProviderConfig[] = []): Draft => {
  const routes = group.routes ?? [];
  const weights = group.weights ?? [];
  const members = routes.map((route, i) => {
    const parsed = splitMemberRoute(route, providers);
    const weight = weights[i];
    return {
      ...parsed,
      weight: weight == null ? "" : String(weight),
    };
  });
  return {
    id: group.id,
    name: group.name || "",
    members: members.length ? members : [blankMember()],
    routing: group.routing || "order",
    pick: group.pick || "",
    affinity: group.affinity || "auto",
    firstToken: String(group.first_token_timeout_ms ?? 0),
    patience: group.patience_s == null ? "" : String(group.patience_s),
    classifier: group.classifier || "",
    effort: group.effort || "",
    levels: (group.levels ?? []).join(", "),
    rules: JSON.parse(JSON.stringify(group.rules ?? [])) as RoutingRule[],
  };
};

const emptyRule = (): RuleDraft => ({
  use: "",
  tokens: "",
  effort: "",
  useEffort: "",
  agents: "",
  intent: "",
  from: "",
  to: "",
  days: "",
  folders: "",
  exceptFolders: "",
  images: false,
  compact: false,
  pause: false,
});

function orderRuleDays(days: string[]): string[] {
  return [...new Set(days)].sort((a, b) => RULE_DAYS.indexOf(a) - RULE_DAYS.indexOf(b));
}

function describeRule(rule: RoutingRule, index: number, t: TFunc): string {
  const member = rule.useEffort ? `${rule.use} at ${rule.useEffort}` : rule.use;
  const conds: string[] = [];
  if ((rule.tokens ?? 0) > 0) conds.push(t("groups.condTokens", { n: rule.tokens ?? 0 }));
  if (rule.images) conds.push(t("groups.condImages"));
  if (rule.effort === "on") conds.push(t("groups.condReasoning"));
  else if (rule.effort) conds.push(t("groups.condEffort", { v: rule.effort }));
  if (rule.agents?.length) conds.push(t("groups.condAgent", { v: rule.agents.join("|") }));
  if (rule.intent) conds.push(t("groups.condIntent", { v: JSON.stringify(rule.intent) }));
  if (rule.compact) conds.push(t("groups.condCompact"));
  if (rule.time) {
    let span = `${rule.time.from}–${rule.time.to}`;
    if (rule.time.from === rule.time.to) span = t("groups.allDay");
    if (rule.time.days?.length) span += ` ${rule.time.days.join(",")}`;
    conds.push(t("groups.condTime", { v: span }));
  }
  if (rule.folders?.length) conds.push(t("groups.condFolder", { v: rule.folders.join("|") }));
  if (rule.exceptFolders?.length) conds.push(t("groups.condNotFolder", { v: rule.exceptFolders.join("|") }));
  const what = conds.length ? t("groups.ruleWhen", { conds: conds.join(", ") }) : "";
  const kind = rule.pause ? t("groups.rulePauses") : t("groups.ruleSends");
  return t("groups.ruleN", { n: index + 1, kind, member: member ?? "", conds: what });
}

function padClock(value: string): string {
  const [hours, minutes] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}

function buildRule(draft: RuleDraft, t: TFunc): { rule?: RoutingRule; error?: string } {
  const use = draft.use.trim();
  if (!use) return { error: t("groups.errNoUse") };
  const rawTokens = draft.tokens.trim();
  const tokens = rawTokens === "" ? 0 : Number(rawTokens);
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    return { error: t("groups.errTokens") };
  }
  const agents = draft.agents
    .split(",")
    .map((agent) => agent.trim().toLowerCase())
    .filter(Boolean);
  const intent = draft.intent.split(/\s+/).filter(Boolean).join(" ");
  if (intent.length > 200) return { error: t("groups.errIntentLong") };
  const from = draft.from.trim();
  const to = draft.to.trim();
  const days = draft.days
    .split(",")
    .map((day) => day.trim().toLowerCase())
    .filter(Boolean);
  const badDay = days.find((day) => !RULE_DAYS.includes(day));
  if (badDay) return { error: t("groups.errBadDay", { day: badDay }) };
  if ((from || to || days.length) && (!RULE_CLOCK.test(from) || !RULE_CLOCK.test(to))) {
    return { error: t("groups.errClock") };
  }
  if ((from || to) && from === to && days.length === 0) {
    return { error: t("groups.errEqualHours") };
  }
  const folders = lines(draft.folders);
  const exceptFolders = lines(draft.exceptFolders);
  const effort = draft.effort;
  const useEffort = draft.useEffort;
  const hasCondition =
    tokens > 0 ||
    draft.images ||
    Boolean(effort) ||
    agents.length > 0 ||
    Boolean(intent) ||
    draft.compact ||
    Boolean(from) ||
    folders.length > 0 ||
    exceptFolders.length > 0;
  if (!hasCondition) {
    return {
      error: t("groups.errNoCond"),
    };
  }
  if (draft.pause && (tokens > 0 || draft.images || effort || useEffort || intent || draft.compact)) {
    return { error: t("groups.errPause") };
  }
  const rule: RoutingRule = { use };
  if (tokens > 0) rule.tokens = tokens;
  if (draft.images) rule.images = true;
  if (effort) rule.effort = effort;
  if (useEffort) rule.useEffort = useEffort;
  if (agents.length) rule.agents = [...new Set(agents)];
  if (intent) rule.intent = intent;
  if (draft.compact) rule.compact = true;
  if (from) rule.time = { from: padClock(from), to: padClock(to), ...(days.length ? { days: orderRuleDays(days) } : {}) };
  if (folders.length) rule.folders = folders;
  if (exceptFolders.length) rule.exceptFolders = exceptFolders;
  if (draft.pause) rule.pause = true;
  return { rule };
}

export default function Groups({ config, stats, busy, setBusy, onChanged }: Props) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [ruleEditing, setRuleEditing] = useState<{ index: number | null; draft: RuleDraft } | null>(null);
  const [ruleError, setRuleError] = useState("");
  const [vision, setVision] = useState("");
  const [visionMessage, setVisionMessage] = useState("");

  const revision = config?.revision ?? -1;
  useEffect(() => {
    setVision(config?.vision ?? "");
  }, [revision]);

  const groups = useMemo(() => config?.groups ?? [], [config]);
  const providers = config?.providers ?? [];
  const foundOff = config?.no_auto_groups === true;

  const visionWarning = useMemo(() => {
    const current = vision.trim();
    if (!current || current === "off") return "";
    const slash = current.indexOf("/");
    if (slash <= 0 || slash === current.length - 1) {
      return t("groups.visionBadFormat", { v: current });
    }
    const provider = providers.find((item) => item.id === current.slice(0, slash));
    if (!provider) return t("groups.visionMissing", { v: current });
    if (provider.capabilities && provider.capabilities.vision === false) {
      return t("groups.visionTextOnly", { v: current });
    }
    return "";
  }, [vision, providers, t]);

  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage(method === "DELETE" ? t("groups.deleting") : t("common.saving"));
    try {
      await api.request(path, method, body);
      setMessage(success);
      return true;
    } catch (err) {
      setMessage((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleFound() {
    if (busy) return;
    const ok = await mutate(
      "/config/found-groups",
      "PUT",
      { on: foundOff },
      foundOff
        ? t("groups.foundOn")
        : t("groups.foundOff"),
    );
    if (ok) onChanged();
  }

  async function saveVision() {
    if (busy) return;
    const value = vision.trim() === "" ? null : vision.trim();
    setBusy(true);
    setVisionMessage(t("groups.visionSaving"));
    try {
      await api.put("/config/vision", { vision: value });
      setVisionMessage(
        value === null || value === "off" ? t("groups.visionOff") : t("groups.visionSet", { v: value }),
      );
      onChanged();
    } catch (err) {
      setVisionMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openEditor(group?: GroupConfig) {
    if (busy) return;
    setEditing({ id: group?.id ?? null, draft: group ? draftFrom(group, providers) : emptyDraft() });
    setRuleEditing(null);
    setRuleError("");
    setMessage("");
  }

  function closeEditor() {
    if (busy) return;
    setEditing(null);
    setRuleEditing(null);
    setMessage("");
  }

  function patchDraft(patch: Partial<Draft>) {
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  }

  function patchMember(index: number, patch: Partial<MemberRow>) {
    setEditing((prev) => {
      if (!prev) return prev;
      const members = prev.draft.members.map((m, i) => (i === index ? { ...m, ...patch } : m));
      return { ...prev, draft: { ...prev.draft, members } };
    });
  }

  function addMember() {
    setEditing((prev) => {
      if (!prev) return prev;
      const last = prev.draft.members[prev.draft.members.length - 1];
      const next = last && !last.provider && providers.length
        ? { ...blankMember(), provider: providers[0].id }
        : blankMember();
      // Keep the chosen model when adding another supplier for it: copy
      // the last row's model so the same model on a new provider is one click.
      if (last?.model && !next.model) next.model = last.model;
      return { ...prev, draft: { ...prev.draft, members: [...prev.draft.members, next] } };
    });
  }

  function removeMember(index: number) {
    setEditing((prev) => {
      if (!prev) return prev;
      if (prev.draft.members.length <= 1) {
        return { ...prev, draft: { ...prev.draft, members: [blankMember()] } };
      }
      return { ...prev, draft: { ...prev.draft, members: prev.draft.members.filter((_, i) => i !== index) } };
    });
  }

  function moveMember(index: number, delta: -1 | 1) {
    setEditing((prev) => {
      if (!prev) return prev;
      const next = [...prev.draft.members];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, draft: { ...prev.draft, members: next } };
    });
  }

  async function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !editing) return;
    const draft = editing.draft;
    const routes = draft.members.map(serializeMember).filter(Boolean);
    if (!routes.length) {
      setMessage(t("groups.errNoRoutes"));
      return;
    }
    const incomplete = draft.members.some((m) => {
      const hasAny = m.provider.trim() || m.model.trim();
      return hasAny && !serializeMember(m);
    });
    if (incomplete) {
      setMessage(t("groups.errIncomplete"));
      return;
    }
    const stale = draft.rules.find((rule) => !rule.use || !routes.includes(rule.use));
    if (stale) {
      setMessage(
        t("groups.errStale", { use: stale.use || t("groups.missingRoute") }),
      );
      const index = draft.rules.indexOf(stale);
      setRuleEditing({
        index,
        draft: {
          use: stale.use || "",
          tokens: stale.tokens ? String(stale.tokens) : "",
          effort: stale.effort || "",
          useEffort: stale.useEffort || "",
          agents: (stale.agents ?? []).join(", "),
          intent: stale.intent || "",
          from: stale.time?.from || "",
          to: stale.time?.to || "",
          days: (stale.time?.days ?? []).join(", "),
          folders: (stale.folders ?? []).join("\n"),
          exceptFolders: (stale.exceptFolders ?? []).join("\n"),
          images: Boolean(stale.images),
          compact: Boolean(stale.compact),
          pause: Boolean(stale.pause),
        },
      });
      return;
    }
    const classifier = draft.classifier.trim();
    if (draft.rules.some((rule) => rule.intent) && !classifier) {
      setMessage(
        t("groups.errNeedClassifier"),
      );
      return;
    }
    const levels = draft.levels
      .split(/[\s,]+/)
      .map((level) => level.trim().toLowerCase())
      .filter(Boolean);
    const unknown = levels.find((level) => !LEVELS.includes(level));
    if (unknown) {
      setMessage(
        t("groups.errBadLevel", { v: unknown }),
      );
      return;
    }
    const firstToken = draft.firstToken.trim() === "" ? 0 : Number(draft.firstToken);
    if (!Number.isSafeInteger(firstToken) || firstToken < 0) {
      setMessage(t("groups.errFirstToken"));
      return;
    }
    const patience = draft.patience.trim() === "" ? null : Number(draft.patience);
    if (patience !== null && !Number.isSafeInteger(patience)) {
      setMessage(t("groups.errPatience"));
      return;
    }
    const body: Record<string, unknown> = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      routes,
      routing: draft.routing,
      weights: routes.map(() => 1),
      affinity: draft.affinity,
      first_token_timeout_ms: firstToken,
      patience_s: patience,
      rules: draft.rules,
      classifier,
      effort: draft.effort,
      levels: [...new Set(levels)],
      pick: draft.pick.trim(),
    };
    if (draft.routing === "weight") {
      const weights = draft.members.map((m) => (m.weight.trim() === "" ? 1 : Number(m.weight)));
      if (weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0 || weight > 1000)) {
        setMessage(t("groups.errWeights"));
        return;
      }
      body.weights = weights;
    }
    const path = editing.id === null ? "/config/groups" : `/config/groups/${encodeURIComponent(editing.id)}`;
    const ok = await mutate(
      path,
      editing.id === null ? "POST" : "PUT",
      body,
      t("groups.saved"),
    );
    if (ok) {
      setEditing(null);
      setRuleEditing(null);
      onChanged();
    }
  }

  async function pickRoute(group: GroupConfig, member: string) {
    const current = group.pick || group.routes[0];
    if (busy || member === current) return;
    setBusy(true);
    setMessage(t("groups.picking", { m: member }));
    try {
      await api.put(`/config/groups/${encodeURIComponent(group.id)}`, { ...group, pick: member });
      setMessage(t("groups.picked", { id: group.id, m: member }));
      onChanged();
    } catch (err) {
      setMessage(t("groups.pickFailed", { error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(group: GroupConfig) {
    if (busy) return;
    const what = group.auto
      ? t("groups.delHide", { id: group.id })
      : t("groups.delDelete", { id: group.id });
    if (!window.confirm(what)) return;
    const ok = await mutate(
      `/config/groups/${encodeURIComponent(group.id)}`,
      "DELETE",
      null,
      group.auto ? t("groups.hiddenMsg") : t("groups.deletedMsg"),
    );
    if (ok) onChanged();
  }

  async function bringBack(group: GroupConfig) {
    const rest: GroupConfig = { ...group };
    delete rest.auto;
    delete rest.hidden;
    const ok = await mutate(
      "/config/groups",
      "POST",
      rest,
      t("groups.backMsg", { id: group.id }),
    );
    if (ok) onChanged();
  }

  function openRule(index: number | null) {
    if (busy) return;
    const rule = index === null ? undefined : editing?.draft.rules[index];
    setRuleEditing({
      index,
      draft: rule
        ? {
            use: rule.use || "",
            tokens: rule.tokens ? String(rule.tokens) : "",
            effort: rule.effort || "",
            useEffort: rule.useEffort || "",
            agents: (rule.agents ?? []).join(", "),
            intent: rule.intent || "",
            from: rule.time?.from || "",
            to: rule.time?.to || "",
            days: (rule.time?.days ?? []).join(", "),
            folders: (rule.folders ?? []).join("\n"),
            exceptFolders: (rule.exceptFolders ?? []).join("\n"),
            images: Boolean(rule.images),
            compact: Boolean(rule.compact),
            pause: Boolean(rule.pause),
          }
        : emptyRule(),
    });
    setRuleError("");
  }

  function saveRule() {
    if (busy || !editing || !ruleEditing) return;
    const result = buildRule(ruleEditing.draft, t);
    if (!result.rule) {
      setRuleError(result.error || t("groups.errFallback"));
      return;
    }
    const rules = [...editing.draft.rules];
    if (ruleEditing.index === null) rules.push(result.rule);
    else rules[ruleEditing.index] = result.rule;
    patchDraft({ rules });
    setRuleEditing(null);
    setRuleError("");
  }

  function deleteRule(index: number) {
    if (busy || !editing) return;
    const rules = editing.draft.rules.filter((_, i) => i !== index);
    patchDraft({ rules });
    if (ruleEditing && ruleEditing.index !== null) setRuleEditing(null);
  }

  const ruleUses = useMemo(() => {
    if (!editing) return [];
    const routes = editing.draft.members.map(serializeMember).filter(Boolean);
    const extra = editing.draft.rules
      .map((rule) => rule.use)
      .filter((use) => use && !routes.includes(use));
    return [...routes, ...extra];
  }, [editing]);

  const draft = editing?.draft;

  const classifierParts = useMemo(
    () => splitClassifier(draft?.classifier ?? ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft?.classifier, editing?.id],
  );
  const memberRoutes = useMemo(
    () => (draft ? draft.members.map(serializeMember) : []),
    [draft],
  );
  const allModelOptions = useMemo(() => {
    const seen = new Map<string, { provider: string; model: string }>();
    for (const p of providers) {
      for (const m of p.models ?? []) {
        const key = `${p.id}/${m}`;
        if (!seen.has(key)) seen.set(key, { provider: p.id, model: m });
      }
    }
    return [...seen.values()];
  }, [providers]);

  const patchRule = (patch: Partial<RuleDraft>) =>
    setRuleEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  const rule = ruleEditing?.draft;
  const visible = groups.filter((group) => !group.hidden);
  const hiddenGroups = groups.filter((group) => group.hidden);
  const visionNote = visionWarning || visionMessage;


  const editorForm = draft && editing ? (
    <form className="editor" onSubmit={saveGroup} autoComplete="off">
      <div className="editor-head">
        <h3>{editing.id === null ? t("groups.newTitle") : t("groups.editTitle")}</h3>
        {editing.id ? <span className="sub"><code>group/{editing.id}</code></span> : null}
      </div>
      <div className="editor-body">
        {message ? (
          <Notice tone="accent" icon={<Info size={16} />} live>
            {message}
          </Notice>
        ) : null}

            <FormSection title={t("groups.secIdentity")}>
              <div className="form-grid">
                <Field label={t("groups.fId")} htmlFor="group-id"
                  help={t("groups.fIdHelp")}>
                  <input id="group-id" className="input mono" required pattern="[A-Za-z0-9_-]+"
                    placeholder="daily-coding" readOnly={editing.id !== null}
                    value={draft.id} onChange={(e) => patchDraft({ id: e.target.value })} />
                </Field>
                <Field label={t("groups.fName")} htmlFor="group-name" help={t("groups.fNameHelp")}>
                  <input id="group-name" className="input" placeholder="Daily coding"
                    value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection title={t("groups.secMembers")} description={t("groups.secMembersDesc")}>
              <div className="member-list" role="list" aria-label={t("groups.fRoutes")}>
                {draft.members.map((member, index) => {
                  const options = providers.find((p) => p.id === member.provider)?.models ?? [];
                  const listId = `group-member-model-${editing.id ?? "new"}-${index}`;
                  return (
                    <div className="member-row-edit" role="listitem" key={index}>
                      <span className="step">{index + 1}</span>
                      <label className="member-field">
                        <span>{t("groups.memberProvider")}</span>
                        <Select
                          mono
                          value={member.provider}
                          aria-label={t("groups.memberProvider")}
                          onChange={(value) => patchMember(index, { provider: value })}
                          options={[
                            { value: "", label: "" },
                            ...providers.map((p) => ({
                              value: p.id,
                              label: p.name ? `${p.id} · ${p.name}` : p.id,
                            })),
                            ...(member.provider && !providers.some((p) => p.id === member.provider)
                              ? [{ value: member.provider, label: member.provider }]
                              : []),
                          ]}
                        />
                      </label>
                      <label className="member-field grow">
                        <span>{t("groups.memberModel")}</span>
                        <input
                          className="input mono"
                          list={listId}
                          placeholder="deepseek-chat"
                          spellCheck={false}
                          value={member.model}
                          aria-label={t("groups.memberModel")}
                          onChange={(e) => patchMember(index, { model: e.target.value })}
                        />
                        <datalist id={listId}>
                          {options.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </label>
                      <label className="member-field small">
                        <span>{t("groups.memberLevel")}</span>
                        <Select
                          value={member.level}
                          aria-label={t("groups.memberLevel")}
                          onChange={(value) => patchMember(index, { level: value })}
                          options={[
                            { value: "", label: t("groups.memberLevelAny") },
                            ...LEVELS.map((level) => ({ value: level, label: level })),
                          ]}
                        />
                      </label>
                      {draft.routing === "weight" ? (
                        <label className="member-field tiny">
                          <span>{t("groups.memberWeight")}</span>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            max="1000"
                            step="1"
                            placeholder="1"
                            value={member.weight}
                            aria-label={t("groups.memberWeight")}
                            onChange={(e) => patchMember(index, { weight: e.target.value })}
                          />
                        </label>
                      ) : null}
                      <span className="member-id mono" data-tip={serializeMember(member) || "provider/model"}>
                        {serializeMember(member) || <span className="text-muted">provider/model</span>}
                      </span>
                      <span className="member-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          disabled={index === 0}
                          data-tip={t("groups.memberUp")}
                          aria-label={t("groups.memberUp")}
                          onClick={() => moveMember(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          disabled={index === draft.members.length - 1}
                          data-tip={t("groups.memberDown")}
                          aria-label={t("groups.memberDown")}
                          onClick={() => moveMember(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          data-tip={t("groups.memberRemove")}
                          aria-label={t("groups.memberRemove")}
                          onClick={() => removeMember(index)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="member-foot">
                <button type="button" className="btn dashed sm" onClick={addMember}>
                  <Plus size={14} aria-hidden="true" />
                  {t("groups.memberAdd")}
                </button>
                <span className="help">{t("groups.fRoutesHelp")}</span>
              </div>
            </FormSection>

            <FormSection title={t("groups.secPolicy")}>
              <div className="form-grid">
                <Field label={t("groups.fPolicy")} htmlFor="group-routing" help={policyHelp(draft.routing, t)}>
                  <Select id="group-routing"
                    value={draft.routing} onChange={(value) => patchDraft({ routing: value })}
                    options={[
                      { value: "order", label: t("groups.policyOrder") },
                      { value: "rotate", label: t("groups.policyRotate") },
                      { value: "usage", label: t("groups.policyUsage") },
                      { value: "free_first", label: t("groups.policyFreeFirst") },
                      { value: "weight", label: t("groups.policyWeight") },
                      { value: "manual", label: t("groups.policyManual") },
                    ]}
                  />
                </Field>
                <Field label={t("groups.fAffinity")} htmlFor="group-affinity"
                  help={t("groups.affinityHelp")}>
                  <Select id="group-affinity"
                    value={draft.affinity} onChange={(value) => patchDraft({ affinity: value })}
                    options={[
                      { value: "auto", label: t("prov.optAuto") },
                      { value: "session", label: t("prov.optSession") },
                      { value: "turn", label: t("prov.optTurn") },
                      { value: "off", label: t("prov.optOff") },
                    ]}
                  />
                </Field>
                <Field label={t("groups.fPick")} htmlFor="group-pick" hidden={draft.routing !== "manual"}
                  help={t("groups.fPickHelp")}>
                  <Select id="group-pick" mono
                    value={memberRoutes.includes(draft.pick.trim()) ? draft.pick.trim() : ""}
                    onChange={(value) => patchDraft({ pick: value })}
                    options={[
                      { value: "", label: t("groups.pickFirst") },
                      ...memberRoutes.filter(Boolean).map((route) => ({ value: route, label: route })),
                    ]}
                  />
                </Field>
                {draft.routing === "weight" ? (
                  <p className="help span-all">{t("groups.fWeightsHelp")}</p>
                ) : null}
              </div>
            </FormSection>

            <FormSection title={t("groups.secTiming")}>
              <div className="form-grid">
                <Field label={t("groups.fFirstToken")} htmlFor="group-first-token"
                  help={t("groups.fFirstTokenHelp")}>
                  <input id="group-first-token" className="input" type="number" min="0"
                    max="9007199254740991" step="1" required
                    value={draft.firstToken} onChange={(e) => patchDraft({ firstToken: e.target.value })} />
                </Field>
                <Field label={t("groups.fPatience")} htmlFor="group-patience"
                  help={t("groups.fPatienceHelp")}>
                  <input id="group-patience" className="input" type="number" min="-9007199254740991"
                    max="9007199254740991" step="1" placeholder={t("groups.patiencePh")}
                    value={draft.patience} onChange={(e) => patchDraft({ patience: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection title={t("groups.secReasoning")}>
              <div className="form-grid three">
                <Field label={t("groups.fClassifier")} htmlFor="group-classifier"
                  help={t("groups.fClassifierHelp")}>
                  <div className="classifier-pick">
                    <Select
                      mono
                      aria-label={t("groups.memberProvider")}
                      value={classifierParts.provider}
                      onChange={(value) => {
                        const next = value ? `${value}/${classifierParts.model}`.replace(/\/$/, "") : classifierParts.model;
                        patchDraft({ classifier: value && classifierParts.model ? `${value}/${classifierParts.model}` : next });
                      }}
                      options={[
                        { value: "", label: "" },
                        ...providers.map((p) => ({ value: p.id, label: p.id })),
                        ...(classifierParts.provider && !providers.some((p) => p.id === classifierParts.provider)
                          ? [{ value: classifierParts.provider, label: classifierParts.provider }]
                          : []),
                      ]}
                    />
                    <input
                      id="group-classifier"
                      className="input mono"
                      list="group-classifier-models"
                      placeholder="deepseek-chat"
                      spellCheck={false}
                      aria-label={t("groups.memberModel")}
                      value={classifierParts.model}
                      onChange={(e) => {
                        const model = e.target.value;
                        patchDraft({ classifier: classifierParts.provider && model ? `${classifierParts.provider}/${model}` : model });
                      }}
                    />
                    <datalist id="group-classifier-models">
                      {allModelOptions
                        .filter((o) => !classifierParts.provider || o.provider === classifierParts.provider)
                        .map((o) => (
                          <option key={`${o.provider}/${o.model}`} value={o.model}>
                            {`${o.provider}/${o.model}`}
                          </option>
                        ))}
                    </datalist>
                  </div>
                  <p className="mono-preview">{draft.classifier.trim() || <span className="text-muted">provider/model</span>}</p>
                </Field>
                <Field label={t("groups.fEffort")} htmlFor="group-effort"
                  help={t("groups.fEffortHelp")}>
                  <Select id="group-effort"
                    value={draft.effort} onChange={(value) => patchDraft({ effort: value })}
                    options={[
                      { value: "", label: t("groups.effortChoice") },
                      { value: "auto", label: t("groups.effortAuto") },
                    ]}
                  />
                </Field>
                <Field label={t("groups.fLevels")} htmlFor="group-levels"
                  help={t("groups.fLevelsHelp")}>
                  <input id="group-levels" className="input mono" placeholder="low, high" spellCheck={false}
                    value={draft.levels} onChange={(e) => patchDraft({ levels: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title={t("groups.secRules")}
              description={t("groups.secRulesDesc")}
            >
              {draft.rules.length ? (
                <ol className="rule-list" aria-label={t("groups.ruleAria")}>
                  {draft.rules.map((item, index) => (
                    <li key={index} className={ruleEditing?.index === index ? "editing" : ""}>
                      <span className="step">{index + 1}</span>
                      <span className="rule-text">{describeRule(item, index, t)}</span>
                      <button type="button" className="icon-btn" aria-label={t("groups.editRuleAria", { n: index + 1 })}
                        data-tip={t("groups.editRule")} onClick={() => openRule(index)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="icon-btn danger" aria-label={t("groups.delRuleAria", { n: index + 1 })}
                        data-tip={t("groups.delRule")} onClick={() => deleteRule(index)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted">{t("groups.noRules")}</p>
              )}

              {rule && ruleEditing ? (
                <div className="rule-form">
                  <p className="rule-form-title">
                    {ruleEditing.index === null ? t("groups.newRule") : t("groups.ruleTitle", { n: ruleEditing.index + 1 })}
                  </p>
                  <Field label={t("groups.fSendTo")} htmlFor="rule-use"
                    help={t("groups.fSendToHelp")}>
                    <Select id="rule-use" mono value={rule.use}
                      onChange={(value) => patchRule({ use: value })}
                      options={[
                        { value: "", label: "" },
                        ...ruleUses.filter((route): route is string => Boolean(route)).map((route) => ({ value: route, label: route })),
                      ]}
                    />
                  </Field>
                  <p className="rule-form-sub">{t("groups.whenMatch")}</p>
                  <div className="form-grid four">
                    <Field label={t("groups.fTokens")} htmlFor="rule-tokens">
                      <input id="rule-tokens" className="input" type="number" min="0" step="1" placeholder="0"
                        value={rule.tokens} onChange={(e) => patchRule({ tokens: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fReasoning")} htmlFor="rule-effort">
                      <Select id="rule-effort" value={rule.effort}
                        onChange={(value) => patchRule({ effort: value })}
                        options={[
                          { value: "", label: t("groups.effortAny") },
                          { value: "on", label: t("groups.effortAnyReasoning") },
                          ...RULE_EFFORTS.map((effort) => ({
                            value: effort,
                            label: t("groups.effortOrMore", { v: effort }),
                          })),
                        ]}
                      />
                    </Field>
                    <Field label={t("groups.fAgents")} htmlFor="rule-agents">
                      <input id="rule-agents" className="input" placeholder="claude, codex" spellCheck={false}
                        value={rule.agents} onChange={(e) => patchRule({ agents: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fIntent")} htmlFor="rule-intent">
                      <input id="rule-intent" className="input" placeholder="research" spellCheck={false}
                        value={rule.intent} onChange={(e) => patchRule({ intent: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fBetween")} htmlFor="rule-time-from">
                      <input id="rule-time-from" className="input mono" placeholder="22:00" spellCheck={false}
                        value={rule.from} onChange={(e) => patchRule({ from: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fAnd")} htmlFor="rule-time-to">
                      <input id="rule-time-to" className="input mono" placeholder="08:00" spellCheck={false}
                        value={rule.to} onChange={(e) => patchRule({ to: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fDays")} htmlFor="rule-days">
                      <input id="rule-days" className="input" placeholder="mon, tue" spellCheck={false}
                        value={rule.days} onChange={(e) => patchRule({ days: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fAskEffort")} htmlFor="rule-use-effort">
                      <Select id="rule-use-effort" value={rule.useEffort}
                        onChange={(value) => patchRule({ useEffort: value })}
                        options={[
                          { value: "", label: t("groups.effortUnchanged") },
                          ...RULE_EFFORTS.map((effort) => ({ value: effort, label: effort })),
                        ]}
                      />
                    </Field>
                  </div>
                  <div className="form-grid">
                    <Field label={t("groups.fFolderIn")} htmlFor="rule-folders"
                      help={t("groups.fFolderInHelp")}>
                      <textarea id="rule-folders" className="input mono" rows={2} placeholder="/home/user/project"
                        spellCheck={false} value={rule.folders} onChange={(e) => patchRule({ folders: e.target.value })} />
                    </Field>
                    <Field label={t("groups.fFolderOut")} htmlFor="rule-except-folders">
                      <textarea id="rule-except-folders" className="input mono" rows={2} placeholder="/home/user/scratch"
                        value={rule.exceptFolders} onChange={(e) => patchRule({ exceptFolders: e.target.value })} />
                    </Field>
                  </div>
                  <div className="check-chips">
                    <label><input type="checkbox" checked={rule.images} onChange={(e) => patchRule({ images: e.target.checked })} /><span>{t("groups.chipImage")}</span></label>
                    <label><input type="checkbox" checked={rule.compact} onChange={(e) => patchRule({ compact: e.target.checked })} /><span>{t("groups.chipCompact")}</span></label>
                    <label><input type="checkbox" checked={rule.pause} onChange={(e) => patchRule({ pause: e.target.checked })} /><span>{t("groups.chipPause")}</span></label>
                  </div>
                  <p className={`rule-error${ruleError ? " shown" : ""}`} role="status" aria-live="polite">
                    {ruleError}
                  </p>
                  <div className="rule-form-actions">
                    <button type="button" className="btn ghost sm" onClick={() => { setRuleEditing(null); setRuleError(""); }}>
                      {t("common.cancel")}
                    </button>
                    <button type="button" className="btn sm" onClick={saveRule}>
                      <Check size={14} aria-hidden="true" />
                      {t("groups.saveRule")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn dashed" onClick={() => openRule(null)}>
                  <Plus size={14} aria-hidden="true" />
                  {t("groups.addRule")}
                </button>
              )}
              <p className="help">
                {t("groups.ruleFoot")}
              </p>
            </FormSection>
      </div>
      <div className="editor-foot">
        <button type="button" className="btn ghost" disabled={busy} onClick={closeEditor}>
          {t("common.cancel")}
        </button>
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t("common.saving") : t("groups.saveGroup")}
        </button>
      </div>
    </form>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("page.groupsTitle")}
        subtitle={t("page.groupsSub")}
      >
        <button type="button" className="btn primary" disabled={busy} onClick={() => openEditor()}>
          <Plus size={14} aria-hidden="true" />
          {t("groups.new")}
        </button>
      </PageHeader>

      <Card
        title={t("groups.settings")}
        icon={<SlidersHorizontal size={16} />}
        labelledBy="group-settings-title"
      >
        <div className="settings">
          <div className="setting">
            <div className="setting-text">
              <label htmlFor="vision-model">
                <ImageIcon size={14} aria-hidden="true" /> {t("groups.vision")}
              </label>
              <p>
                {t("groups.visionDesc")}
              </p>
            </div>
            <div className="setting-control">
              <div className="input-group">
                <input
                  id="vision-model"
                  className="input mono"
                  list="agent-model-options"
                  placeholder={t("groups.visionPh")}
                  spellCheck={false}
                  value={vision}
                  disabled={busy}
                  onChange={(e) => setVision(e.target.value)}
                />
                <button type="button" className="btn" disabled={busy} onClick={saveVision}>
                  {t("groups.visionSave")}
                </button>
              </div>
              <p
                className={`setting-note${visionWarning ? " text-warn" : ""}`}
                role="status"
                aria-live="polite"
              >
                {visionNote}
              </p>
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <span className="field-label">
                <ScanSearch size={14} aria-hidden="true" /> {t("groups.found")}
              </span>
              <p>
                {t("groups.foundDesc")}
              </p>
            </div>
            <div className="setting-control end">
              <Switch checked={!foundOff} disabled={busy || config === null} onChange={() => toggleFound()}>
                {foundOff ? t("common.off") : t("common.on")}
              </Switch>
            </div>
          </div>
        </div>
      </Card>

      {!editing && message ? (
        <Notice tone="accent" icon={<Info size={16} />} live>
          {message}
        </Notice>
      ) : null}

      {editing?.id === null ? <Card flush>{editorForm}</Card> : null}

      {visible.length === 0 ? (
        editing ? null : (
          <Card>
            <Empty icon={<Waypoints size={18} />} title={t("groups.emptyTitle")}>
              {t("groups.emptyCopy")}
            </Empty>
          </Card>
        )
      ) : (
        <div className="group-grid">
          {visible.map((group) => {
            const id = group.auto && group.name ? `auto/${group.name}` : `group/${group.id}`;
            const routes = group.routes ?? [];
            const manual = group.routing === "manual";
            const current = group.pick || routes[0];
            const failure = group.classifier
              ? stats?.classifier_status?.find((status) => status.model === group.classifier)
              : undefined;
            const meta: string[] = [t("groups.metaAffinity", { v: group.affinity || "auto" })];
            if (group.patience_s != null) {
              meta.push(group.patience_s < 0 ? t("groups.metaPatienceOff") : t("groups.metaPatience", { n: group.patience_s }));
            }
            if (group.first_token_timeout_ms) meta.push(t("groups.metaFirst", { n: group.first_token_timeout_ms }));
            if (group.classifier) meta.push(t("groups.metaClassifier", { v: group.classifier }));
            if (group.effort === "auto") meta.push(t("groups.metaJudge"));
            if ((group.levels ?? []).length) meta.push(t("groups.metaLevels", { v: (group.levels ?? []).join(", ") }));
            const rules = group.rules ?? [];
            return (
              <article key={group.id} className={`group-card${editing?.id === group.id ? " editing" : ""}`}>
                {editing?.id === group.id ? (
                  <>
                    <header className="group-head editor-context">
                      <div className="group-title">
                        <h3><code>{id}</code></h3>
                        <p>{group.name || group.id}</p>
                      </div>
                      <div className="group-badges">
                        <Badge tone="accent">{policyLabel(group.routing || "order", t)}</Badge>
                        {group.auto ? <Badge>{t("groups.found_badge")}</Badge> : null}
                      </div>
                    </header>
                    {editorForm}
                  </>
                ) : (
                  <>
                    <header className="group-head">
                      <div className="group-title">
                        <h3><code>{id}</code></h3>
                        <p>{group.name || group.id}</p>
                      </div>
                      <div className="group-badges">
                        <Badge tone="accent">{policyLabel(group.routing || "order", t)}</Badge>
                        {group.auto ? <Badge>{t("groups.found_badge")}</Badge> : null}
                      </div>
                    </header>

                    <div className="provider-mid">
                      {routes.length ? (
                        <ol className={`pipeline${manual ? " manual" : ""}`}>
                          {routes.map((member, i) => {
                            const weight = group.routing === "weight" ? (group.weights ?? [])[i] : undefined;
                            const free = group.routing === "free_first" && (group.free ?? [])[i];
                            const isPicked = manual && member === current;
                            const body = (
                              <>
                                <span className="step">{isPicked ? <Check size={10} /> : i + 1}</span>
                                <code className="member">{member}</code>
                                {weight !== undefined ? <span className="pill-mini">{t("groups.weight", { w: weight })}</span> : null}
                                {free ? <span className="pill-mini good">{t("groups.free")}</span> : null}
                                {isPicked ? <span className="pill-mini accent">{t("groups.serving")}</span> : null}
                              </>
                            );
                            return (
                              <li key={member} className={isPicked ? "picked" : manual ? "idle" : ""}>
                                {manual ? (
                                  <button
                                    type="button"
                                    className="member-pick"
                                    disabled={busy || isPicked}
                                    data-tip={isPicked ? t("groups.pickedTitle") : t("groups.pickTitle", { m: member })}
                                    aria-label={t("groups.pickMember", { m: member, id: group.id })}
                                    onClick={() => pickRoute(group, member)}
                                  >
                                    {body}
                                  </button>
                                ) : (
                                  <div className="member-row">{body}</div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="text-muted">{t("groups.noRoutesCard")}</p>
                      )}
                      <p className="group-meta">{meta.join(" · ")}</p>
                      {rules.length ? (
                        <ul className="rule-lines" aria-label={t("groups.rulesFor", { id })}>
                          {rules.map((item, index) => (
                            <li key={index} className={item.pause ? "pause" : ""}>
                              <ListFilter size={11} aria-hidden="true" />
                              {describeRule(item, index, t)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {failure ? (
                        <p className="group-failure" data-tip={t("groups.lastFail", { t: String(failure.at_unix_ms ?? "") })}>
                          <CircleAlert size={12} aria-hidden="true" />
                          {t("groups.classifierFail", { model: group.classifier ?? "", error: (failure.error ?? "").slice(0, 100) })}
                        </p>
                      ) : null}
                    </div>

                    <div className="provider-side">
                      <div className="row-actions">
                        <button type="button" className="icon-btn" disabled={busy}
                          aria-label={t("groups.editAria", { id: group.id })} data-tip={t("common.edit")} onClick={() => openEditor(group)}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="icon-btn danger" disabled={busy}
                          aria-label={t("groups.delAria", { id: group.id })} data-tip={group.auto ? t("groups.hideTitle") : t("common.delete")}
                          onClick={() => deleteGroup(group)}>
                          {group.auto ? <EyeOff size={14} /> : <Trash2 size={14} />}
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

      {hiddenGroups.length ? (
        <Card
          title={t("groups.hiddenTitle")}
          icon={<EyeOff size={16} />}
          description={t("groups.hiddenDesc")}
          flush
          labelledBy="hidden-groups-title"
        >
          <ul className="hidden-list">
            {hiddenGroups.map((group) => {
              const id = group.auto && group.name ? `auto/${group.name}` : `group/${group.id}`;
              return (
                <li key={group.id}>
                  <div>
                    <code>{id}</code>
                    <span className="text-muted">{(group.routes ?? []).join(" → ") || t("groups.noRoutes")}</span>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    aria-label={t("groups.bringBackAria", { id: group.id })}
                    onClick={() => bringBack(group)}
                  >
                    <Eye size={14} aria-hidden="true" />
                    {t("groups.bringBack")}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

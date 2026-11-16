import { useEffect, useMemo, useState } from "react";
import {
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
import type { Config, GroupConfig, ModelsResponse, RoutingRule, Stats } from "../types";
import { Badge, Card, Empty, Field, FormSection, Notice, PageHeader, Switch } from "./ui";

const RULE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const RULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const RULE_CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const LEVELS = ["low", "medium", "high", "xhigh", "max"];

const POLICIES: Record<string, string> = {
  order: "Ordered",
  rotate: "Rotate",
  usage: "Least used",
  free_first: "Free first",
  weight: "Weighted",
  manual: "Manual",
};

const POLICY_HELP: Record<string, string> = {
  order: "Always starts at the first route; the rest are fallbacks in listed order.",
  rotate: "Advances the starting route per request.",
  usage: "Prefers routes with fewer attempts in this gateway process.",
  free_first:
    "Spends the routes whose model you declared free on its provider, then the rest, each in listed order.",
  weight: "Spreads requests by each route's weight.",
  manual:
    "Sends every request to the picked member; the others, and the rules, wait until another member is picked.",
};

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
  routes: string;
  routing: string;
  pick: string;
  weights: string;
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

const emptyDraft = (): Draft => ({
  id: "",
  name: "",
  routes: "",
  routing: "order",
  pick: "",
  weights: "",
  affinity: "auto",
  firstToken: "0",
  patience: "",
  classifier: "",
  effort: "",
  levels: "",
  rules: [],
});

const draftFrom = (group: GroupConfig): Draft => ({
  id: group.id,
  name: group.name || "",
  routes: (group.routes ?? []).join("\n"),
  routing: group.routing || "order",
  pick: group.pick || "",
  weights: (group.weights ?? []).join("\n"),
  affinity: group.affinity || "auto",
  firstToken: String(group.first_token_timeout_ms ?? 0),
  patience: group.patience_s == null ? "" : String(group.patience_s),
  classifier: group.classifier || "",
  effort: group.effort || "",
  levels: (group.levels ?? []).join(", "),
  rules: JSON.parse(JSON.stringify(group.rules ?? [])) as RoutingRule[],
});

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

function describeRule(rule: RoutingRule, index: number): string {
  const member = rule.useEffort ? `${rule.use} at ${rule.useEffort}` : rule.use;
  const conds: string[] = [];
  if ((rule.tokens ?? 0) > 0) conds.push(`tokens ≥ ${rule.tokens}`);
  if (rule.images) conds.push("images");
  if (rule.effort === "on") conds.push("reasoning");
  else if (rule.effort) conds.push(`effort ≥ ${rule.effort}`);
  if (rule.agents?.length) conds.push(`agent ${rule.agents.join("|")}`);
  if (rule.intent) conds.push(`intent ${JSON.stringify(rule.intent)}`);
  if (rule.compact) conds.push("compacting");
  if (rule.time) {
    let span = `${rule.time.from}–${rule.time.to}`;
    if (rule.time.from === rule.time.to) span = "all day";
    if (rule.time.days?.length) span += ` ${rule.time.days.join(",")}`;
    conds.push(`time ${span}`);
  }
  if (rule.folders?.length) conds.push(`folder ${rule.folders.join("|")}`);
  if (rule.exceptFolders?.length) conds.push(`not folder ${rule.exceptFolders.join("|")}`);
  const what = conds.length ? ` when ${conds.join(", ")}` : "";
  const kind = rule.pause ? "pauses" : "sends first to";
  return `Rule ${index + 1} ${kind} ${member}${what}`;
}

function padClock(value: string): string {
  const [hours, minutes] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}

function buildRule(draft: RuleDraft): { rule?: RoutingRule; error?: string } {
  const use = draft.use.trim();
  if (!use) return { error: "Pick the member this rule sends first to." };
  const rawTokens = draft.tokens.trim();
  const tokens = rawTokens === "" ? 0 : Number(rawTokens);
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    return { error: "Tokens is a whole number of 0 or more; blank means no minimum." };
  }
  const agents = draft.agents
    .split(",")
    .map((agent) => agent.trim().toLowerCase())
    .filter(Boolean);
  const intent = draft.intent.split(/\s+/).filter(Boolean).join(" ");
  if (intent.length > 200) return { error: "An intent is at most 200 characters." };
  const from = draft.from.trim();
  const to = draft.to.trim();
  const days = draft.days
    .split(",")
    .map((day) => day.trim().toLowerCase())
    .filter(Boolean);
  const badDay = days.find((day) => !RULE_DAYS.includes(day));
  if (badDay) return { error: `Days are mon … sun — not "${badDay}".` };
  if ((from || to || days.length) && (!RULE_CLOCK.test(from) || !RULE_CLOCK.test(to))) {
    return { error: "Hours are HH:MM each (09:00)." };
  }
  if ((from || to) && from === to && days.length === 0) {
    return { error: "Equal hours cover the whole day, every day: give days or other hours." };
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
      error: "Give the rule a condition (tokens, images, effort, agents, intent, compacting, time or folders).",
    };
  }
  if (draft.pause && (tokens > 0 || draft.images || effort || useEffort || intent || draft.compact)) {
    return { error: "A pause holds by hours, days, agents or folders only." };
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
      return `Image recognition ${current} is not provider/model.`;
    }
    const provider = providers.find((item) => item.id === current.slice(0, slash));
    if (!provider) return `Image recognition ${current} is missing.`;
    if (provider.capabilities && provider.capabilities.vision === false) {
      return `Image recognition ${current} takes text only.`;
    }
    return "";
  }, [vision, providers]);

  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage(method === "DELETE" ? "Deleting…" : "Saving…");
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
        ? "Found groups are on again."
        : "Found groups are off; only the groups you made or changed are listed.",
    );
    if (ok) onChanged();
  }

  async function saveVision() {
    if (busy) return;
    const value = vision.trim() === "" ? null : vision.trim();
    setBusy(true);
    setVisionMessage("Saving…");
    try {
      await api.put("/config/vision", { vision: value });
      setVisionMessage(
        value === null || value === "off" ? "Image recognition is off." : `Image recognition is ${value}.`,
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
    setEditing({ id: group?.id ?? null, draft: group ? draftFrom(group) : emptyDraft() });
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

  async function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !editing) return;
    const draft = editing.draft;
    const routes = lines(draft.routes);
    if (!routes.length) {
      setMessage("Enter at least one provider/model route.");
      return;
    }
    const stale = draft.rules.find((rule) => !rule.use || !routes.includes(rule.use));
    if (stale) {
      setMessage(
        `Rule for ${stale.use || "(missing route)"} is not in the group anymore: edit the rules or the routes.`,
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
        "A rule with an intent needs the group's classifier: the model that tells which intent a message is.",
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
        `Offered levels are low, medium, high, xhigh and max — not "${unknown}". Blank offers everything.`,
      );
      return;
    }
    const firstToken = draft.firstToken.trim() === "" ? 0 : Number(draft.firstToken);
    if (!Number.isSafeInteger(firstToken) || firstToken < 0) {
      setMessage("Enter a non-negative whole-number timeout in milliseconds (0 disables).");
      return;
    }
    const patience = draft.patience.trim() === "" ? null : Number(draft.patience);
    if (patience !== null && !Number.isSafeInteger(patience)) {
      setMessage("Patience is whole seconds: blank takes the 60s default, a negative disables re-asking.");
      return;
    }
    const body: Record<string, unknown> = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      routes,
      routing: draft.routing,
      weights: [],
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
      const weights = lines(draft.weights).map(Number);
      if (weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0 || weight > 1000)) {
        setMessage("Route weights must be whole numbers from 0 to 1000, one per line.");
        return;
      }
      if (weights.length > routes.length) {
        setMessage("Enter at most one weight per route.");
        return;
      }
      body.weights = weights;
    }
    const path = editing.id === null ? "/config/groups" : `/config/groups/${encodeURIComponent(editing.id)}`;
    const ok = await mutate(
      path,
      editing.id === null ? "POST" : "PUT",
      body,
      "Group saved. New requests use these routes immediately.",
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
    setMessage(`Picking ${member}…`);
    try {
      await api.put(`/config/groups/${encodeURIComponent(group.id)}`, { ...group, pick: member });
      setMessage(`group/${group.id} now sends every request to ${member}.`);
      onChanged();
    } catch (err) {
      setMessage(`Pick failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(group: GroupConfig) {
    if (busy) return;
    const what = group.auto
      ? `Hide found group/${group.id}? It leaves routing and the catalog until brought back.`
      : `Delete group/${group.id}? Agents using it will need another model.`;
    if (!window.confirm(what)) return;
    const ok = await mutate(
      `/config/groups/${encodeURIComponent(group.id)}`,
      "DELETE",
      null,
      group.auto ? "Group hidden; bring it back from its card." : "Group deleted and saved.",
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
      `group/${group.id} is back in routing and the catalog.`,
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
    const result = buildRule(ruleEditing.draft);
    if (!result.rule) {
      setRuleError(result.error || "Check the rule.");
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
    const routes = lines(editing.draft.routes);
    const extra = editing.draft.rules
      .map((rule) => rule.use)
      .filter((use) => use && !routes.includes(use));
    return [...routes, ...extra];
  }, [editing]);

  const draft = editing?.draft;

  const patchRule = (patch: Partial<RuleDraft>) =>
    setRuleEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  const rule = ruleEditing?.draft;
  const visible = groups.filter((group) => !group.hidden);
  const hiddenGroups = groups.filter((group) => group.hidden);
  const visionNote = visionWarning || visionMessage;


  const editorForm = draft && editing ? (
    <form className="editor" onSubmit={saveGroup} autoComplete="off">
      <div className="editor-head">
        <h3>{editing.id === null ? "New routing group" : "Edit routing group"}</h3>
        {editing.id ? <span className="sub"><code>group/{editing.id}</code></span> : null}
      </div>
      <div className="editor-body">
        {message ? (
          <Notice tone="accent" icon={<Info size={16} />} live>
            {message}
          </Notice>
        ) : null}

            <FormSection title="Identity">
              <div className="form-grid">
                <Field label="Group ID" htmlFor="group-id"
                  help="Letters, digits, hyphens and underscores. Agents use group/<id>.">
                  <input id="group-id" className="input mono" required pattern="[A-Za-z0-9_-]+"
                    placeholder="daily-coding" readOnly={editing.id !== null}
                    value={draft.id} onChange={(e) => patchDraft({ id: e.target.value })} />
                </Field>
                <Field label="Display name" htmlFor="group-name" help="Optional.">
                  <input id="group-name" className="input" placeholder="Daily coding"
                    value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Members" description="Routes in fallback order.">
              <Field label="Routes" htmlFor="group-routes"
                help="One provider/model per line. The policy chooses the starting route; the rest are fallback candidates. A :level suffix fixes an effort on a member: kimi/moonshot-v1-128k:high asks for high.">
                <textarea id="group-routes" className="input mono" rows={4} required
                  placeholder={"deepseek/deepseek-chat\nkimi/moonshot-v1-128k"}
                  value={draft.routes} onChange={(e) => patchDraft({ routes: e.target.value })} />
              </Field>
            </FormSection>

            <FormSection title="Policy">
              <div className="form-grid">
                <Field label="Route policy" htmlFor="group-routing" help={POLICY_HELP[draft.routing]}>
                  <select id="group-routing" className="input"
                    value={draft.routing} onChange={(e) => patchDraft({ routing: e.target.value })}>
                    <option value="order">Ordered</option>
                    <option value="rotate">Rotate</option>
                    <option value="usage">Least used</option>
                    <option value="free_first">Free first</option>
                    <option value="weight">Weighted</option>
                    <option value="manual">Manual</option>
                  </select>
                </Field>
                <Field label="Conversation affinity" htmlFor="group-affinity"
                  help="Keep a conversation on the route that answered it so the vendor's prompt cache keeps hitting. Auto follows the policy: rotate spreads load, everything else sticks by conversation.">
                  <select id="group-affinity" className="input"
                    value={draft.affinity} onChange={(e) => patchDraft({ affinity: e.target.value })}>
                    <option value="auto">Auto</option>
                    <option value="session">Whole session</option>
                    <option value="turn">Within a turn</option>
                    <option value="off">Off</option>
                  </select>
                </Field>
                <Field label="Manual pick" htmlFor="group-pick" hidden={draft.routing !== "manual"}
                  help="One of the routes above, sent every request while the policy is manual. Blank keeps the first route; changing it later is one click on the group card.">
                  <input id="group-pick" className="input mono" list="agent-model-options"
                    placeholder="deepseek/deepseek-chat" spellCheck={false}
                    value={draft.pick} onChange={(e) => patchDraft({ pick: e.target.value })} />
                </Field>
                <Field label="Route weights" htmlFor="group-weights" hidden={draft.routing !== "weight"}
                  help="One weight per route, in route order, 0 to 1000. A missing weight counts as 1; 0 makes the route fallback-only.">
                  <textarea id="group-weights" className="input mono" rows={3} placeholder={"3\n1\n4"}
                    value={draft.weights} onChange={(e) => patchDraft({ weights: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Timing">
              <div className="form-grid">
                <Field label="First-content timeout (ms)" htmlFor="group-first-token"
                  help="0 disables. Streaming only: a slow non-final route switches to the next candidate before any reply is released. The final route still obeys gateway-wide limits.">
                  <input id="group-first-token" className="input" type="number" min="0"
                    max="9007199254740991" step="1" required
                    value={draft.firstToken} onChange={(e) => patchDraft({ firstToken: e.target.value })} />
                </Field>
                <Field label="Busy patience (s)" htmlFor="group-patience"
                  help="Blank takes 60: while every member is busy, the request waits for a slot and asks again. A negative disables re-asking; above 240 takes 240. A direct provider still fails fast.">
                  <input id="group-patience" className="input" type="number" min="-9007199254740991"
                    max="9007199254740991" step="1" placeholder="60"
                    value={draft.patience} onChange={(e) => patchDraft({ patience: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Reasoning">
              <div className="form-grid three">
                <Field label="Classifier model" htmlFor="group-classifier"
                  help="Asked which rule intent a turn's message is. Needed when a rule has an intent.">
                  <input id="group-classifier" className="input mono" list="agent-model-options"
                    placeholder="deepseek/deepseek-chat" spellCheck={false}
                    value={draft.classifier} onChange={(e) => patchDraft({ classifier: e.target.value })} />
                </Field>
                <Field label="Turn reasoning" htmlFor="group-effort"
                  help="Judge each turn has the classifier judge how hard the turn is; it needs the classifier model.">
                  <select id="group-effort" className="input"
                    value={draft.effort} onChange={(e) => patchDraft({ effort: e.target.value })}>
                    <option value="">Agent's choice</option>
                    <option value="auto">Judge each turn</option>
                  </select>
                </Field>
                <Field label="Offered levels" htmlFor="group-levels"
                  help="Blank offers everything. e.g. low, high: each ask is sent at the nearest offered, a tie going up; off stays off.">
                  <input id="group-levels" className="input mono" placeholder="low, high" spellCheck={false}
                    value={draft.levels} onChange={(e) => patchDraft({ levels: e.target.value })} />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Routing rules"
              description="A rule sends matching requests to its member first; a pause leaves its member out while its hours, days, agents or folders hold."
            >
              {draft.rules.length ? (
                <ol className="rule-list" aria-label="Routing rules">
                  {draft.rules.map((item, index) => (
                    <li key={index} className={ruleEditing?.index === index ? "editing" : ""}>
                      <span className="step">{index + 1}</span>
                      <span className="rule-text">{describeRule(item, index)}</span>
                      <button type="button" className="icon-btn" aria-label={`Edit rule ${index + 1}`}
                        title="Edit rule" onClick={() => openRule(index)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="icon-btn danger" aria-label={`Delete rule ${index + 1}`}
                        title="Delete rule" onClick={() => deleteRule(index)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted">No rules: every request follows the policy above.</p>
              )}

              {rule && ruleEditing ? (
                <div className="rule-form">
                  <p className="rule-form-title">
                    {ruleEditing.index === null ? "New rule" : `Rule ${ruleEditing.index + 1}`}
                  </p>
                  <Field label="Send first to" htmlFor="rule-use"
                    help="One of the routes above, sent first for the requests this rule matches.">
                    <select id="rule-use" className="input mono" value={rule.use}
                      onChange={(e) => patchRule({ use: e.target.value })}>
                      <option value=""></option>
                      {ruleUses.map((route) => (
                        <option key={route} value={route}>{route}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="rule-form-sub">When the request matches</p>
                  <div className="form-grid four">
                    <Field label="At least tokens" htmlFor="rule-tokens">
                      <input id="rule-tokens" className="input" type="number" min="0" step="1" placeholder="0"
                        value={rule.tokens} onChange={(e) => patchRule({ tokens: e.target.value })} />
                    </Field>
                    <Field label="Reasoning asked" htmlFor="rule-effort">
                      <select id="rule-effort" className="input" value={rule.effort}
                        onChange={(e) => patchRule({ effort: e.target.value })}>
                        <option value="">Any</option>
                        <option value="on">Any reasoning</option>
                        {RULE_EFFORTS.map((effort) => (
                          <option key={effort} value={effort}>{effort} or more</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="From agents" htmlFor="rule-agents">
                      <input id="rule-agents" className="input" placeholder="claude, codex" spellCheck={false}
                        value={rule.agents} onChange={(e) => patchRule({ agents: e.target.value })} />
                    </Field>
                    <Field label="Intent is" htmlFor="rule-intent">
                      <input id="rule-intent" className="input" placeholder="research" spellCheck={false}
                        value={rule.intent} onChange={(e) => patchRule({ intent: e.target.value })} />
                    </Field>
                    <Field label="Between (HH:MM)" htmlFor="rule-time-from">
                      <input id="rule-time-from" className="input mono" placeholder="22:00" spellCheck={false}
                        value={rule.from} onChange={(e) => patchRule({ from: e.target.value })} />
                    </Field>
                    <Field label="And (HH:MM)" htmlFor="rule-time-to">
                      <input id="rule-time-to" className="input mono" placeholder="08:00" spellCheck={false}
                        value={rule.to} onChange={(e) => patchRule({ to: e.target.value })} />
                    </Field>
                    <Field label="On days" htmlFor="rule-days">
                      <input id="rule-days" className="input" placeholder="mon, tue" spellCheck={false}
                        value={rule.days} onChange={(e) => patchRule({ days: e.target.value })} />
                    </Field>
                    <Field label="Ask it for" htmlFor="rule-use-effort">
                      <select id="rule-use-effort" className="input" value={rule.useEffort}
                        onChange={(e) => patchRule({ useEffort: e.target.value })}>
                        <option value="">Unchanged</option>
                        {RULE_EFFORTS.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="form-grid">
                    <Field label="Working folder in" htmlFor="rule-folders"
                      help="One folder per line; a request inside one matches. Blank for anywhere.">
                      <textarea id="rule-folders" className="input mono" rows={2} placeholder="/home/user/project"
                        spellCheck={false} value={rule.folders} onChange={(e) => patchRule({ folders: e.target.value })} />
                    </Field>
                    <Field label="Working folder outside" htmlFor="rule-except-folders">
                      <textarea id="rule-except-folders" className="input mono" rows={2} placeholder="/home/user/scratch"
                        value={rule.exceptFolders} onChange={(e) => patchRule({ exceptFolders: e.target.value })} />
                    </Field>
                  </div>
                  <div className="check-chips">
                    <label><input type="checkbox" checked={rule.images} onChange={(e) => patchRule({ images: e.target.checked })} /><span>Carries an image</span></label>
                    <label><input type="checkbox" checked={rule.compact} onChange={(e) => patchRule({ compact: e.target.checked })} /><span>Compacting</span></label>
                    <label><input type="checkbox" checked={rule.pause} onChange={(e) => patchRule({ pause: e.target.checked })} /><span>Pause this member instead</span></label>
                  </div>
                  <p className={`rule-error${ruleError ? " shown" : ""}`} role="status" aria-live="polite">
                    {ruleError}
                  </p>
                  <div className="rule-form-actions">
                    <button type="button" className="btn ghost sm" onClick={() => { setRuleEditing(null); setRuleError(""); }}>
                      Cancel
                    </button>
                    <button type="button" className="btn sm" onClick={saveRule}>
                      <Check size={14} aria-hidden="true" />
                      Save rule
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn dashed" onClick={() => openRule(null)}>
                  <Plus size={14} aria-hidden="true" />
                  Add rule
                </button>
              )}
              <p className="help">
                An intent rule needs the classifier model above. A pause only holds on hours, days,
                agents or folders.
              </p>
            </FormSection>
      </div>
      <div className="editor-foot">
        <button type="button" className="btn ghost" disabled={busy} onClick={closeEditor}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save group"}
        </button>
      </div>
    </form>
  ) : null;

  return (
    <>
      <PageHeader
        title="Routing groups"
        subtitle="Combine models into one route with a policy, fallbacks and rules."
      >
        <button type="button" className="btn primary" disabled={busy} onClick={() => openEditor()}>
          <Plus size={14} aria-hidden="true" />
          New group
        </button>
      </PageHeader>

      <Card
        title="Gateway-wide settings"
        icon={<SlidersHorizontal size={16} />}
        labelledBy="group-settings-title"
      >
        <div className="settings">
          <div className="setting">
            <div className="setting-text">
              <label htmlFor="vision-model">
                <ImageIcon size={14} aria-hidden="true" /> Image recognition
              </label>
              <p>
                A provider/model describing the images a text-only model is asked about, in their
                place; off or blank keeps refusing a current user image and omitting the rest. A
                missing model is named in the refusal.
              </p>
            </div>
            <div className="setting-control">
              <div className="input-group">
                <input
                  id="vision-model"
                  className="input mono"
                  list="agent-model-options"
                  placeholder="seeing/model or off"
                  spellCheck={false}
                  value={vision}
                  disabled={busy}
                  onChange={(e) => setVision(e.target.value)}
                />
                <button type="button" className="btn" disabled={busy} onClick={saveVision}>
                  Save
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
                <ScanSearch size={14} aria-hidden="true" /> Found groups
              </span>
              <p>
                Groups the gateway assembles from your providers on its own. When off, only the
                groups you made or changed are listed.
              </p>
            </div>
            <div className="setting-control end">
              <Switch checked={!foundOff} disabled={busy || config === null} onChange={() => toggleFound()}>
                {foundOff ? "Off" : "On"}
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
            <Empty icon={<Waypoints size={18} />} title="No routing groups are configured">
              A group lets an agent ask for one name and get the best available member.
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
            const meta: string[] = [`affinity ${group.affinity || "auto"}`];
            if (group.patience_s != null) {
              meta.push(`patience ${group.patience_s < 0 ? "off" : `${group.patience_s}s`}`);
            }
            if (group.first_token_timeout_ms) meta.push(`first content ${group.first_token_timeout_ms}ms`);
            if (group.classifier) meta.push(`classifier ${group.classifier}`);
            if (group.effort === "auto") meta.push("judges each turn");
            if ((group.levels ?? []).length) meta.push(`levels ${(group.levels ?? []).join(", ")}`);
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
                        <Badge tone="accent">{POLICIES[group.routing || "order"] ?? group.routing}</Badge>
                        {group.auto ? <Badge>Found</Badge> : null}
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
                        <Badge tone="accent">{POLICIES[group.routing || "order"] ?? group.routing}</Badge>
                        {group.auto ? <Badge>Found</Badge> : null}
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
                                {weight !== undefined ? <span className="pill-mini">w {weight}</span> : null}
                                {free ? <span className="pill-mini good">free</span> : null}
                                {isPicked ? <span className="pill-mini accent">serving</span> : null}
                              </>
                            );
                            return (
                              <li key={member} className={isPicked ? "picked" : manual ? "idle" : ""}>
                                {manual ? (
                                  <button
                                    type="button"
                                    className="member-pick"
                                    disabled={busy || isPicked}
                                    title={isPicked ? "This member serves every request" : `Send every request to ${member}`}
                                    aria-label={`Pick ${member} for group ${group.id}`}
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
                        <p className="text-muted">No routes</p>
                      )}
                      <p className="group-meta">{meta.join(" · ")}</p>
                      {rules.length ? (
                        <ul className="rule-lines" aria-label={`Rules for ${id}`}>
                          {rules.map((item, index) => (
                            <li key={index} className={item.pause ? "pause" : ""}>
                              <ListFilter size={11} aria-hidden="true" />
                              {describeRule(item, index)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {failure ? (
                        <p className="group-failure" title={`Last failed ask: ${failure.at_unix_ms ?? ""}`}>
                          <CircleAlert size={12} aria-hidden="true" />
                          {group.classifier} can't say: {(failure.error ?? "").slice(0, 100)}
                        </p>
                      ) : null}
                    </div>

                    <div className="provider-side">
                      <div className="row-actions">
                        <button type="button" className="icon-btn" disabled={busy}
                          aria-label={`Edit group ${group.id}`} title="Edit" onClick={() => openEditor(group)}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="icon-btn danger" disabled={busy}
                          aria-label={`Delete group ${group.id}`} title={group.auto ? "Hide" : "Delete"}
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
          title="Hidden found groups"
          icon={<EyeOff size={16} />}
          description="Not routed and not listed to agents until brought back."
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
                    <span className="text-muted">{(group.routes ?? []).join(" → ") || "No routes"}</span>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    aria-label={`Bring back group ${group.id}`}
                    onClick={() => bringBack(group)}
                  >
                    <Eye size={14} aria-hidden="true" />
                    Bring back
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

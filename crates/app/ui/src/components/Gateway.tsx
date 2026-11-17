import { useMemo, useState } from "react";
import { Check, Copy, Server, TerminalSquare } from "lucide-react";
import type { Config, ModelsResponse } from "../types";
import { Badge, Card, Empty, Segmented } from "./ui";
import Select from "./Select";
import { useT, type DictKey } from "../i18n";

type ApiKind = "openai" | "responses" | "anthropic" | "gemini" | "ollama" | "embeddings" | "rerank";
type Snippet = "powershell" | "curl" | "python" | "node";

interface ApiSpec {
  label: string;
  path: string;
  blurb: DictKey;
  envBase: string;
  envKey: string;
}

const APIS: Record<ApiKind, ApiSpec> = {
  openai: {
    label: "OpenAI",
    path: "/v1",
    blurb: "gw.apiOpenai",
    envBase: "OPENAI_BASE_URL",
    envKey: "OPENAI_API_KEY",
  },
  responses: {
    label: "Responses",
    path: "/v1",
    blurb: "gw.apiResponses",
    envBase: "OPENAI_BASE_URL",
    envKey: "OPENAI_API_KEY",
  },
  anthropic: {
    label: "Anthropic",
    path: "",
    blurb: "gw.apiAnthropic",
    envBase: "ANTHROPIC_BASE_URL",
    envKey: "ANTHROPIC_API_KEY",
  },
  gemini: {
    label: "Gemini",
    path: "/v1beta",
    blurb: "gw.apiGemini",
    envBase: "GOOGLE_GEMINI_BASE_URL",
    envKey: "GEMINI_API_KEY",
  },
  ollama: {
    label: "Ollama",
    path: "",
    blurb: "gw.apiOllama",
    envBase: "OLLAMA_HOST",
    envKey: "",
  },
  embeddings: {
    label: "Embeddings",
    path: "/v1",
    blurb: "gw.apiEmbeddings",
    envBase: "OPENAI_BASE_URL",
    envKey: "OPENAI_API_KEY",
  },
  rerank: {
    label: "Rerank",
    path: "/v1",
    blurb: "gw.apiRerank",
    envBase: "",
    envKey: "OPENAI_API_KEY",
  },
};

function snippet(
  kind: Snippet,
  api: ApiKind,
  base: string,
  model: string,
  token: string,
): string {
  const url = `${base}${APIS[api].path}`;
  switch (kind) {
    case "powershell":
      if (api === "anthropic") {
        return `$env:ANTHROPIC_BASE_URL = "${url}"
$env:ANTHROPIC_API_KEY = "${token}"
claude  # or your Anthropic-compatible CLI`;
      }
      if (api === "gemini") {
        return `$env:GEMINI_API_KEY = "${token}"
$env:GOOGLE_GEMINI_BASE_URL = "${url}"
gemini`;
      }
      if (api === "ollama") {
        return `$env:OLLAMA_HOST = "${url}"
ollama run ${model}`;
      }
      if (api === "embeddings" || api === "rerank") {
        return `$env:OPENAI_BASE_URL = "${url}"
$env:OPENAI_API_KEY = "${token}"
# ${api === "embeddings" ? "POST /v1/embeddings" : "POST /v1/rerank"} — see curl/Python/Node tabs`;
      }
      return `$env:OPENAI_BASE_URL = "${url}"
$env:OPENAI_API_KEY = "${token}"`;
    case "curl":
      if (api === "anthropic") {
        return `curl ${url}/v1/messages \\
  -H "x-api-key: ${token}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}'`;
      }
      if (api === "gemini") {
        return `curl "${url}/models/${model}:generateContent" \\
  -H "x-goog-api-key: ${token}" \\
  -H "content-type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'`;
      }
      if (api === "ollama") {
        return `curl ${url}/api/generate -d '{"model":"${model}","prompt":"hi"}'`;
      }
      if (api === "responses") {
        return `curl ${url}/responses \\
  -H "Authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","input":"hi"}'`;
      }
      if (api === "embeddings") {
        return `curl ${url}/embeddings \\
  -H "Authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","input":"hi"}'`;
      }
      if (api === "rerank") {
        return `curl ${url}/rerank \\
  -H "Authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","query":"hi","documents":["doc one","doc two"]}'`;
      }
      return `curl ${url}/chat/completions \\
  -H "Authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"hi"}]}'`;
    case "python":
      if (api === "anthropic") {
        return `import anthropic
client = anthropic.Anthropic(
    base_url="${url}",
    api_key="${token}",
)
client.messages.create(model="${model}", max_tokens=256,
    messages=[{"role": "user", "content": "hi"}])`;
      }
      if (api === "ollama") {
        return `import ollama
client = ollama.Client(host="${url}")
client.generate(model="${model}", prompt="hi")`;
      }
      if (api === "gemini") {
        return `from google import genai
client = genai.Client(
    api_key="${token}",
    http_options={"base_url": "${url}"},
)
client.models.generate_content(model="${model}", contents="hi")`;
      }
      if (api === "embeddings") {
        return `from openai import OpenAI
client = OpenAI(base_url="${url}", api_key="${token}")
client.embeddings.create(model="${model}", input="hi")`;
      }
      if (api === "rerank") {
        return `import requests
requests.post("${url}/rerank",
    headers={"Authorization": "Bearer ${token}"},
    json={"model": "${model}", "query": "hi",
          "documents": ["doc one", "doc two"]})`;
      }
      return `from openai import OpenAI
client = OpenAI(base_url="${url}", api_key="${token}")
client.${api === "responses" ? "responses.create" : "chat.completions.create"}(
    model="${model}",
    ${api === "responses" ? 'input="hi"' : 'messages=[{"role": "user", "content": "hi"}]'},
)`;
    case "node":
      if (api === "anthropic") {
        return `import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ baseURL: "${url}", apiKey: "${token}" });
await client.messages.create({
  model: "${model}", max_tokens: 256,
  messages: [{ role: "user", content: "hi" }],
});`;
      }
      if (api === "ollama") {
        return `import ollama from "ollama";
const client = new ollama.Ollama({ host: "${url}" });
await client.generate({ model: "${model}", prompt: "hi" });`;
      }
      if (api === "gemini") {
        return `import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({
  apiKey: "${token}",
  httpOptions: { baseUrl: "${url}" },
});
await ai.models.generateContent({ model: "${model}", contents: "hi" });`;
      }
      if (api === "embeddings") {
        return `import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${url}", apiKey: "${token}" });
await client.embeddings.create({ model: "${model}", input: "hi" });`;
      }
      if (api === "rerank") {
        return `await fetch("${url}/rerank", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "${model}", query: "hi",
    documents: ["doc one", "doc two"],
  }),
});`;
      }
      return `import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${url}", apiKey: "${token}" });
await client.${api === "responses" ? "responses.create" : "chat.completions.create"}({
  model: "${model}",
  ${api === "responses" ? 'input: "hi"' : 'messages: [{ role: "user", content: "hi" }]'},
});`;
  }
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn tiny"
      data-tip={ok ? t("gw.copied") : label}
      aria-label={ok ? t("gw.copied") : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export default function Gateway({
  config,
  models,
  healthy,
}: {
  config: Config | null;
  models: ModelsResponse | null;
  healthy: boolean | null;
}) {
  const t = useT();
  const [api, setApi] = useState<ApiKind>("openai");
  const [lang, setLang] = useState<Snippet>("powershell");
  const modelIds = useMemo(() => (models?.data ?? []).map((m) => m.id), [models]);
  const [model, setModel] = useState("");

  // The model list fits the API picked: chat APIs take /v1/models ids,
  // embeddings and rerank take the providers' retrieval lists, each
  // spelled provider/model as the route names it.
  const apiModels = useMemo(() => {
    if (api === "embeddings") {
      return (config?.providers ?? []).flatMap((p) =>
        (p.embeddings ?? []).map((m) => `${p.id}/${m}`),
      );
    }
    if (api === "rerank") {
      return (config?.providers ?? []).flatMap((p) =>
        (p.rerankers ?? []).map((m) => `${p.id}/${m}`),
      );
    }
    return modelIds;
  }, [api, config, modelIds]);
  const picked = model || apiModels[0] || "provider/model";

  const port = config?.port ?? 3426;
  const base = `http://127.0.0.1:${port}`;
  const spec = APIS[api];
  const url = `${base}${spec.path}`;
  const modelCount = modelIds.length;
  const providerCount = config?.providers.length ?? 0;

  if (!config) {
    return (
      <Card title={t("gw.title")} icon={<Server size={16} />}>
        <Empty icon={<Server size={18} />} title={t("gw.emptyTitle")}>
          {t("gw.emptyBody")}
        </Empty>
      </Card>
    );
  }

  return (
    <div className="gw">
      <Card flush className="gw-hero">
        <div className="gw-hero-row">
          <div className="gw-hero-mark" aria-hidden="true">
            <Server size={20} />
          </div>
          <div className="gw-hero-who">
            <div className="gw-hero-name">
              {t("gw.title")}{" "}
              <Badge tone={healthy === false ? "bad" : "good"} dot>
                {healthy === false ? t("topbar.offline") : t("topbar.online")}
              </Badge>
            </div>
            <p className="gw-hero-sub">
              {t("gw.heroSub", { models: modelCount, providers: providerCount })}
            </p>
          </div>
        </div>
        <div className="gw-lan">
          <div className="gw-lan-head">
            <span>{t("gw.lanTitle")}</span>
            <Segmented<string>
              label={t("gw.lanLabel")}
              value="local"
              onChange={() => {}}
              options={[
                { value: "local", label: t("gw.lanLocal") },
                { value: "lan", label: t("gw.lanLan"), disabled: true, title: t("gw.lanOff") },
              ]}
            />
          </div>
          <div className="gw-addr">
            <span className="gw-addr-who">{t("gw.lanLocal")}</span>
            <code className="gw-addr-url">{base}</code>
            <CopyBtn text={base} label={t("gw.copy")} />
          </div>
          <p className="gw-lan-note">{t("gw.lanNote")}</p>
        </div>
      </Card>

      <Card
        title={t("gw.accessTitle")}
        icon={<TerminalSquare size={16} />}
        description={t("gw.accessDesc")}
      >
        <div className="gw-access">
          <div className="gw-api-row">
            <span className="gw-label">API</span>
            <Segmented<ApiKind>
              label={t("gw.apiLabel")}
              value={api}
              onChange={(v) => {
                setApi(v);
                setModel("");
              }}
              options={(Object.keys(APIS) as ApiKind[]).map((k) => ({
                value: k,
                label: APIS[k].label,
              }))}
            />
          </div>
          <p className="gw-blurb">{t(spec.blurb)}</p>

          <div className="gw-field">
            <span className="gw-label">Base URL</span>
            <div className="gw-value">
              <code>{url}</code>
              <CopyBtn text={url} label={t("gw.copy")} />
            </div>
            {spec.envBase ? (
              <p className="gw-hint">
                {t("gw.fillEnv", { env: spec.envBase })}
              </p>
            ) : null}
          </div>

          {spec.envKey ? (
            <div className="gw-field">
              <span className="gw-label">{t("gw.keyLabel")}</span>
              <div className="gw-value">
                <code>magpie</code>
                <CopyBtn text="magpie" label={t("gw.copy")} />
              </div>
              <p className="gw-hint">
                {t("gw.keyHint", { env: spec.envKey })}
              </p>
            </div>
          ) : null}

          <div className="gw-field">
            <span className="gw-label">{t("gw.modelLabel")}</span>
            <div className="gw-value">
              <Select
                mono
                value={picked}
                onChange={setModel}
                aria-label={t("gw.modelLabel")}
                key={api}
                options={
                  apiModels.length === 0
                    ? [{ value: picked, label: picked }]
                    : apiModels.map((id) => ({ value: id, label: id }))
                }
              />
            </div>
            <p className="gw-hint">
              {api === "embeddings" || api === "rerank"
                ? t(apiModels.length ? "gw.modelHintRetrieval" : "gw.modelHintRetrievalEmpty")
                : t("gw.modelHint")}
            </p>
          </div>

          <div className="gw-field">
            <span className="gw-label">{t("gw.exampleLabel")}</span>
            <Segmented<Snippet>
              label={t("gw.exampleLabel")}
              value={lang}
              onChange={setLang}
              options={[
                { value: "powershell", label: "PowerShell" },
                { value: "curl", label: "curl" },
                { value: "python", label: "Python" },
                { value: "node", label: "Node" },
              ]}
            />
            <pre className="gw-code">
              <code>{snippet(lang, api, base, picked, "magpie")}</code>
              <CopyBtn text={snippet(lang, api, base, picked, "magpie")} label={t("gw.copy")} />
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}

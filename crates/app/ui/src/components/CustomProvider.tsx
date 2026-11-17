import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Box } from "lucide-react";
import { Field, Notice } from "./ui";
import VendorIcon from "./vendorIcon";
import { useT } from "../i18n";
import type { VendorPreset } from "../types";
import { curlFill, splitKeys } from "../util";

export interface CustomDraft {
  name: string;
  protocol: string;
  baseUrl: string;
  altUrls: Record<string, string>;
  keys: string;
  models: string;
  testModel: string;
  icon: string;
}

interface Props {
  draft: CustomDraft;
  set: (patch: Partial<CustomDraft & { protocol: string }>) => void;
  busy: boolean;
  message: string;
  presets: VendorPreset[] | null;
  onProtocol: (v: string) => void;
  onDetect: () => void;
  onTestEach: () => void;
  onFetchModels: () => void;
  onAutoIcon: () => void;
  onIconUrl: (url: string) => void;
  onIconFile: (data: string) => void;
  onCancel: () => void;
  onSave: (e: FormEvent) => void;
  onNote: (message: string) => void;
  advanced: ReactNode;
}

const PROTOS = [
  { v: "chat", key: "prov.protoPillChat" },
  { v: "responses", key: "prov.protoPillResponses" },
  { v: "anthropic", key: "prov.protoPillAnthropic" },
  { v: "gemini", key: "prov.protoPillGemini" },
] as const;

function urlHint(v: string): string {
  if (v === "anthropic") return "https://…";
  if (v === "gemini") return "https://…/v1beta";
  return "https://…/v1";
}

const ENDPOINT_ORDER: { v: string; label: string }[] = [
  { v: "chat", label: "prov.protoPillChat" },
  { v: "responses", label: "prov.protoPillResponses" },
  { v: "anthropic", label: "prov.protoPillAnthropic" },
  { v: "gemini", label: "prov.protoPillGemini" },
];

export default function CustomProvider({
  draft,
  set,
  busy,
  message,
  presets,
  onProtocol,
  onDetect,
  onTestEach,
  onFetchModels,
  onAutoIcon,
  onIconUrl,
  onIconFile,
  onCancel,
  onSave,
  onNote,
  advanced,
}: Props) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const [iconQuery, setIconQuery] = useState("");
  const [iconMenuOpen, setIconMenuOpen] = useState(false);
  const [iconUrlMode, setIconUrlMode] = useState(false);
  const [iconUrl, setIconUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Many keys pasted at once: the count, like upstream's key-count hint.
  const keyCount = splitKeys(draft.keys).length;

  // A pasted curl command fills the form, like upstream: the request
  // URL becomes the base URL, an auth header the key, -d's model the
  // probe model.
  const onPasteCurl = (e: React.ClipboardEvent): boolean => {
    const fill = curlFill(e.clipboardData?.getData("text") ?? "");
    if (!fill) return false;
    e.preventDefault();
    const took: string[] = [];
    const patch: Partial<CustomDraft> = {};
    if (fill.baseUrl) {
      patch.baseUrl = fill.baseUrl;
      took.push(t("prov.fUrl"));
    }
    if (fill.key) {
      patch.keys = fill.key;
      took.push(t("prov.keysLabel"));
    }
    if (fill.model && !draft.testModel) {
      patch.testModel = fill.model;
      took.push(t("prov.fTestModel"));
    }
    set(patch);
    if (took.length) onNote(t("prov.curlFilled", { what: took.join(" · ") }));
    if (!fill.key) document.getElementById("cst-key")?.focus();
    return true;
  };

  const icons = useMemo(() => {
    const names = new Set<string>();
    for (const p of presets ?? []) if (p.icon) names.add(p.icon);
    return [...names].sort((a, b) => a.replace(/-color$/, "").localeCompare(b.replace(/-color$/, "")));
  }, [presets]);
  const q = iconQuery.trim().toLowerCase();
  const shownIcons = !q ? icons : icons.filter((n) => n.replace(/-color$/, "").toLowerCase().includes(q));

  const modelsComma = useMemo(() => draft.models.split(/\r?\n/).filter(Boolean).join(", "), [draft.models]);

  const useIconUrl = () => {
    const v = iconUrl.trim();
    if (!v) return;
    onIconUrl(v);
    setIconUrlMode(false);
    setIconMenuOpen(false);
  };

  return (
    <form className="card cst" onSubmit={onSave} autoComplete="off">
      <div className="cst-head">
        <span className="cst-head-icon" aria-hidden="true">
          {draft.icon ? (
            <VendorIcon name={draft.name || "C"} icon={draft.icon} />
          ) : (
            <Box size={16} aria-hidden="true" />
          )}
        </span>
        <h2>{t("prov.customNew")}</h2>
      </div>

      <div className="cst-grid">
        <label className="cst-label" htmlFor="cst-name">
          {t("prov.cstName")}
        </label>
        <input
          id="cst-name"
          className="input"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={t("prov.namePh")}
        />

        <span className="cst-label" id="cst-base-lbl">
          Base URL
        </span>
        <div className="cst-base" role="group" aria-labelledby="cst-base-lbl">
          <div className="cst-segs" role="tablist" aria-label="Base URL">
            {PROTOS.map((p) => (
              <button
                key={p.v}
                type="button"
                role="tab"
                aria-selected={draft.protocol === p.v}
                className={`cst-seg${draft.protocol === p.v ? " on" : ""}`}
                onClick={() => onProtocol(p.v)}
              >
                {t(p.key)}
              </button>
            ))}
            <button
              type="button"
              className="cst-seg"
              disabled
              title={t("prov.protoSystemSoon")}
            >
              {t("prov.protoPillSystem")}
            </button>
          </div>
          <input
            className="input mono"
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            onPaste={onPasteCurl}
            placeholder={urlHint(draft.protocol)}
            inputMode="url"
            aria-label="Base URL"
          />
          <div className="cst-detect-row">
            <button type="button" className="btn sm" disabled={busy} onClick={onDetect}>
              {t("prov.detect")}
            </button>
            <input
              className="input"
              value={draft.testModel}
              onChange={(e) => set({ testModel: e.target.value })}
              placeholder={t("prov.probePh")}
              aria-label={t("prov.probePh")}
            />
            <button type="button" className="btn sm" disabled={busy} onClick={onTestEach}>
              {t("prov.detectEach")}
            </button>
          </div>
        </div>

        <label className="cst-label" htmlFor="cst-key">
          {t("prov.keysLabel")}
        </label>
        <div className="cst-keyrow">
          <input
            id="cst-key"
            className="input mono"
            type={showKey ? "text" : "password"}
            value={draft.keys}
            onChange={(e) => set({ keys: e.target.value })}
            onPaste={(e) => {
              if (onPasteCurl(e)) return;
              const keys = splitKeys(e.clipboardData?.getData("text") ?? "");
              if (keys.length < 2) return;
              e.preventDefault();
              // An input keeps no line breaks: keep the keys comma separated.
              set({ keys: keys.join(", ") });
            }}
            placeholder={t("prov.keyPh")}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="link" onClick={() => setShowKey((v) => !v)}>
            {showKey ? t("prov.hide") : t("prov.show")}
          </button>
          {keyCount > 1 ? (
            <span className="help" role="status" title={t("prov.keysCountTitle", { n: keyCount })}>
              {t("prov.nKeys", { n: keyCount })}
            </span>
          ) : null}
        </div>

        <span className="cst-label">{t("prov.icon")}</span>
        <div className="cst-iconrow">
          <span className="cst-icon-now" aria-hidden="true">
            {draft.icon ? (
              <VendorIcon name={draft.name || "C"} icon={draft.icon} size="sm" />
            ) : (
              <Box size={16} aria-hidden="true" />
            )}
          </span>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/svg+xml,.ico,.svg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => {
                const url = String(r.result || "");
                // The gateway validates the bytes and hands back a small
                // `data:` URL; send the base64 half of the file URL.
                const b64 = url.includes(",") ? (url.split(",").pop() ?? "") : url;
                if (b64.trim()) onIconFile(b64.trim());
              };
              r.readAsDataURL(f);
              e.target.value = "";
            }}
          />
          <button type="button" className="link" onClick={() => fileRef.current?.click()}>
            {t("prov.pickFile")}
          </button>
          <span className="cst-iconmenu">
            <button
              type="button"
              className="link"
              aria-haspopup="menu"
              aria-expanded={iconMenuOpen}
              onClick={() => {
                setIconMenuOpen((v) => !v);
                setIconUrlMode(false);
              }}
            >
              {t("prov.getIcon")} ⌄
            </button>
            {iconMenuOpen ? (
              <span className="cst-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="cst-menuitem"
                  onClick={() => {
                    setIconMenuOpen(false);
                    setIconUrlMode(false);
                    onAutoIcon();
                  }}
                >
                  <span className="cst-menu-name">{t("prov.iconAuto")}</span>
                  <span className="cst-menu-note">{t("prov.iconAutoNote")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="cst-menuitem"
                  onClick={() => {
                    const cur = draft.icon.trim();
                    const direct =
                      cur.startsWith("http://") ||
                      cur.startsWith("https://") ||
                      cur.startsWith("data:") ||
                      cur.startsWith("blob:");
                    setIconUrl(direct ? cur : "");
                    setIconUrlMode(true);
                  }}
                >
                  <span className="cst-menu-name">{t("prov.iconUrl")}</span>
                  <span className="cst-menu-note">{t("prov.iconUrlNote")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="cst-menuitem"
                  onClick={() => {
                    set({ icon: "" });
                    setIconUrl("");
                    setIconMenuOpen(false);
                    setIconUrlMode(false);
                  }}
                >
                  <span className="cst-menu-name">{t("prov.iconLetter")}</span>
                  <span className="cst-menu-note">{t("prov.iconLetterNote")}</span>
                </button>
              </span>
            ) : null}
          </span>
          <button type="button" className="link" onClick={() => setBuiltinOpen((v) => !v)}>
            {t("prov.builtin")}
          </button>
        </div>
        {iconUrlMode ? (
          <>
            <span className="cst-blank" />
            <div className="cst-iconurlrow">
              <input
                className="input mono sm"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    useIconUrl();
                  } else if (e.key === "Escape") {
                    setIconUrlMode(false);
                  }
                }}
                placeholder={t("prov.iconUrlPh")}
                inputMode="url"
                aria-label={t("prov.iconUrl")}
              />
              <button type="button" className="btn sm" disabled={!iconUrl.trim()} onClick={useIconUrl}>
                {t("prov.iconUse")}
              </button>
            </div>
          </>
        ) : null}
        {builtinOpen ? (
          <span className="cst-blank" />
          ) : null}
        {builtinOpen ? (
          <div className="cst-icongrid-wrap">
            <input
              className="input sm"
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
              placeholder={t("prov.search")}
              aria-label={t("prov.builtin")}
            />
            <div className="cst-icongrid" role="listbox" aria-label={t("prov.builtin")}>
              {shownIcons.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="option"
                  aria-selected={draft.icon === n}
                  title={n.replace(/-color$/, "")}
                  className={`cst-iconopt${draft.icon === n ? " on" : ""}`}
                  onClick={() => {
                    set({ icon: n });
                  }}
                >
                  <VendorIcon name={n} icon={n} size="sm" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label className="cst-label" htmlFor="cst-models">
          {t("prov.secModels")}
        </label>
        <div className="cst-modelsrow">
          <input
            id="cst-models"
            className="input mono"
            value={modelsComma}
            onChange={(e) =>
              set({
                models: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .join("\n"),
              })
            }
            placeholder={t("prov.modelsPh")}
            spellCheck={false}
          />
          <button type="button" className="btn sm" disabled={busy} onClick={onFetchModels}>
            {t("prov.fetchModels")}
          </button>
        </div>

        <span className="cst-label" />
        <div className="cst-folds">
          <details className="cst-fold">
            <summary>{t("prov.advanced")}</summary>
            <div className="cst-fold-body">{advanced}</div>
          </details>
          <details className="cst-fold">
            <summary>{t("prov.moreEndpoints")}</summary>
            <div className="cst-fold-body">
              {ENDPOINT_ORDER.filter((ep) => ep.v !== draft.protocol).map((ep) => (
                <Field key={ep.v} label={t(ep.label as Parameters<typeof t>[0])} htmlFor={`cst-ep-${ep.v}`}>
                  <input
                    id={`cst-ep-${ep.v}`}
                    className="input mono"
                    value={draft.altUrls?.[ep.v] ?? ""}
                    onChange={(e) =>
                      set({
                        altUrls: { ...(draft.altUrls ?? {}), [ep.v]: e.target.value },
                      })
                    }
                    placeholder={urlHint(ep.v)}
                    inputMode="url"
                  />
                </Field>
              ))}
              <p className="help">{t("prov.moreEndpointsHelp")}</p>
            </div>
          </details>
        </div>
      </div>

      {message ? (
        <div className="cst-msg">
          <Notice tone="accent" live>
            {message}
          </Notice>
        </div>
      ) : null}

      <div className="cst-foot">
        <span className="grow" />
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t("prov.saving") : t("prov.add")}
        </button>
      </div>
    </form>
  );
}

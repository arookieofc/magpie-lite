import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Notice, Segmented } from "./ui";
import VendorIcon from "./vendorIcon";
import { useT, type TFunc } from "../i18n";
import type { VendorPreset } from "../types";
import { splitKeys } from "../util";
import * as api from "../api";

interface Props {
  preset: VendorPreset;
  pair: VendorPreset[] | null;
  busy: boolean;
  onPickRegion: (next: VendorPreset) => void;
  onClose: () => void;
  onSave: (keys: string) => void;
  message: string;
}

function endpointsOf(pr: VendorPreset): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (pr.chat) out.push({ label: "OpenAI", url: pr.chat });
  if (pr.responses) out.push({ label: "Responses", url: pr.responses });
  if (pr.anthropic) out.push({ label: "Anthropic", url: pr.anthropic });
  if (pr.gemini) out.push({ label: "Gemini", url: pr.gemini });
  return out;
}

export default function QuickAdd({ preset, pair, busy, onPickRegion, onClose, onSave, message }: Props) {
  const t = useT();
  const [keys, setKeys] = useState("");
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const keyCount = splitKeys(keys).length;

  useEffect(() => {
    setKeys("");
    setShow(false);
  }, [preset.id]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const siteHost = (() => {
    if (preset.website) {
      try {
        return new URL(preset.website).host.toLowerCase();
      } catch {
        return preset.website.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].toLowerCase();
      }
    }
    return "";
  })();
  const endpoints = endpointsOf(preset);

  const body = (
    <div className="quick-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className="quick"
        role="dialog"
        aria-modal="true"
        aria-label={preset.name}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(keys);
        }}
      >
        <div className="quick-head">
          <VendorIcon name={preset.name} icon={preset.icon ?? null} size="sm" />
          <h2>{preset.name}</h2>
          {siteHost ? (
            <>
              <span className="quick-spacer" />
              <button
                type="button"
                className="link site"
                onClick={() => {
                  api.openExternal(preset.website!).catch(() => {});
                }}
              >
                {siteHost} ↗
              </button>
            </>
          ) : null}
        </div>
        <div className="quick-body">
          {message ? <Notice tone="accent" live>{message}</Notice> : null}
          {preset.note ? <p className="help">{t(preset.note as Parameters<TFunc>[0])}</p> : null}
          {pair ? (
            <div className="quick-row">
              <span className="quick-label">{t("prov.region")}</span>
              <Segmented
                label={t("prov.region")}
                value={preset.id}
                onChange={(id) => {
                  const next = pair.find((p) => p.id === id);
                  if (next) onPickRegion(next);
                }}
                options={pair.map((p) => ({
                  value: p.id,
                  label: p.id.endsWith("-cn") ? t("add.china") : t("add.global"),
                  title: p.id.endsWith("-cn") ? t("add.china") : t("add.global"),
                }))}
              />
            </div>
          ) : null}
          <div className="quick-row">
            <label className="quick-label" htmlFor="quick-key">{t("prov.keysLabel")}</label>
            <div className="quick-keybox">
              <input
                id="quick-key"
                ref={inputRef}
                className="input mono"
                type={show ? "text" : "password"}
                value={keys}
                onChange={(e) => setKeys(e.target.value)}
                placeholder={t("prov.keyPh")}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="link" onClick={() => setShow((v) => !v)}>
                {show ? t("prov.hide") : t("prov.show")}
              </button>
              {preset.keys_url ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    api.openExternal(preset.keys_url!).catch(() => {});
                  }}
                >
                  {t("prov.getKey")}
                </button>
              ) : null}
            </div>
          </div>
          {keyCount > 1 ? (
            <div className="quick-row">
              <span />
              <p className="help" role="status">
                {t("prov.nKeys", { n: keyCount })}
              </p>
            </div>
          ) : null}
          {endpoints.length ? (
            <div className="quick-row quick-eps">
              <span className="quick-label">{t("quick.endpoints")}</span>
              <ul className="quick-eplist">
                {endpoints.map((ep) => (
                  <li key={`${ep.label}:${ep.url}`}>
                    <span className="quick-proto">{ep.label}</span>
                    <span className="mono quick-url" data-tip={ep.url}>{ep.url}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="quick-row">
            <span />
            <p className="help">{t("quick.privacy")}</p>
          </div>
          <details className="quick-fold">
            <summary>{t("prov.advanced")}</summary>
            <div className="quick-fold-body">
              <p className="help">{t("quick.advancedHint")}</p>
            </div>
          </details>
        </div>
        <div className="quick-foot">
          <span className="quick-spacer" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t("prov.saving") : t("prov.add")}
          </button>
        </div>
      </form>
    </div>
  );
  return createPortal(body, document.body);
}

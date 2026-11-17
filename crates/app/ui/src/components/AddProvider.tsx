import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Import, Plus, Search } from "lucide-react";
import { Card, Empty, Field } from "./ui";
import VendorIcon, { hostOf } from "./vendorIcon";
import { useT, type TFunc } from "../i18n";
import type { ProviderConfig, VendorPreset } from "../types";

export interface PastedEndpoint {
  baseUrl?: string;
  keys?: string;
}

// Pasted setup, mirroring upstream's pasteread: a URL and a key out of a
// curl command, env lines or a bare "url + key" paste, prefilled into a
// custom draft for review instead of pasted into the search.
export function parsePasted(text: string): PastedEndpoint {
  const out: PastedEndpoint = {};
  const raw = text.match(/https?:\/\/[^\s"'`\\\]]+/i)?.[0]?.replace(/[),;.!]+$/, "");
  if (raw) {
    try {
      void new URL(raw);
      out.baseUrl = raw;
    } catch {
      /* not a URL, keep looking for a key only */
    }
  }
  const key =
    text.match(/[Bb]earer\s+([A-Za-z0-9_.\-~]{8,})/)?.[1] ??
    text.match(/["']?(?:api[_-]?key|api[_-]?token|auth[_-]?token|token)["']?\s*[:=]\s*["']?([A-Za-z0-9_.\-~]{8,})["']?/i)?.[1] ??
    text.match(/\b(sk-[A-Za-z0-9_.\-]{8,})\b/)?.[1];
  if (key) {
    out.keys = key;
  } else if (out.baseUrl) {
    // A bare token next to the URL, e.g. pasted "url key" lines.
    const bare = (text.match(/\b[A-Za-z0-9_.\-~]{20,}\b/g) ?? []).find(
      (tok) => !out.baseUrl!.includes(tok) && !/^(https?|bearer)$/i.test(tok),
    );
    if (bare) out.keys = bare;
  }
  return out;
}

function presetUrls(pr: VendorPreset): string[] {
  return [pr.chat, pr.responses, pr.anthropic, pr.gemini].filter((u): u is string => !!u);
}

interface TileGroup {
  key: string;
  entries: VendorPreset[];
}

interface Props {
  presets: VendorPreset[] | null;
  providers: ProviderConfig[];
  canClose: boolean;
  onPickPreset: (pr: VendorPreset) => void;
  onPickCustom: (prefill?: PastedEndpoint) => void;
  onOpen: (p: ProviderConfig) => void;
  onClose: () => void;
}

export default function AddProvider({
  presets,
  providers,
  canClose,
  onPickPreset,
  onPickCustom,
  onOpen,
  onClose,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [showImport, setShowImport] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchHint = t("add.search");

  // The search box is as wide as its hint, like upstream's add sheet:
  // measure the hint and size the box by it so it never cuts off.
  useLayoutEffect(() => {
    const input = searchRef.current;
    const box = input?.parentElement;
    if (!input || !box) return;
    const size = () => {
      const cs = getComputedStyle(input);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = ctx.measureText(searchHint).width;
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const icon = input.previousElementSibling?.getBoundingClientRect().width ?? 0;
      const gap = parseFloat(getComputedStyle(box).columnGap || "0");
      // Canvas under-measures CJK fallback glyphs, so keep generous
      // room; the box still tracks the hint width like upstream's.
      const chrome = pad + icon + gap + 48;
      box.style.width = `${Math.ceil(text + chrome)}px`;
    };
    size();
    // Web fonts load after first measure and widen CJK glyphs; re-size
    // once they arrive so the hint still fits.
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) size();
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [searchHint]);

  const addedHosts = useMemo(
    () => new Set(providers.map((p) => hostOf(p.base_url))),
    [providers],
  );
  const isAdded = (pr: VendorPreset) => presetUrls(pr).some((u) => addedHosts.has(hostOf(u)));
  const findExisting = (entries: VendorPreset[]) =>
    providers.find((p) => entries.some((pr) => presetUrls(pr).some((u) => hostOf(u) === hostOf(p.base_url))));

  const groups = useMemo<TileGroup[]>(() => {
    const order = new Map<string, VendorPreset[]>();
    for (const pr of presets ?? []) {
      const key = pr.pair ?? `:${pr.id}`;
      order.set(key, [...(order.get(key) ?? []), pr]);
    }
    return [...order.values()].map((entries) => ({ key: entries.map((e) => e.id).join("+"), entries }));
  }, [presets]);

  const q = query.trim().toLowerCase();
  const groupText = (g: TileGroup) =>
    g.entries
      .flatMap((pr) => [pr.name, pr.short, pr.id, pr.kind, pr.note, pr.note ? t(pr.note as Parameters<TFunc>[0]) : null, ...presetUrls(pr).map(hostOf)])
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const visible = !q
    ? groups
    : groups.filter((g) => q.split(/\s+/).every((w) => groupText(g).includes(w)));

  const sections: { kind: VendorPreset["kind"]; title: string; hint: string }[] = [
    { kind: "partner", title: t("add.partners"), hint: t("add.partnersHint") },
    { kind: "vendor", title: t("add.vendors"), hint: t("add.vendorsHint") },
    { kind: "relay", title: t("add.relays"), hint: t("add.relaysHint") },
    { kind: "local", title: t("add.local"), hint: t("add.localHint") },
  ];

  const pasted = useMemo(() => parsePasted(paste), [paste]);

  const openTile = (g: TileGroup) => {
    const have = findExisting(g.entries);
    if (have) {
      onOpen(have);
      return;
    }
    onPickPreset(g.entries.find((pr) => !isAdded(pr)) ?? g.entries[0]);
  };

  const tileTitle = (g: TileGroup) => {
    const lines = g.entries.map((pr) => {
      const where = g.entries.length > 1 ? `${pr.id.endsWith("-cn") ? t("add.china") : t("add.global")} ` : "";
      // A preset's own note says more than its host (Azure's
      // YOUR-RESOURCE pattern), like upstream's tile tooltip.
      const host = pr.note ? t(pr.note as Parameters<TFunc>[0]) : presetUrls(pr).map(hostOf).join(", ");
      return `${where}${host}${isAdded(pr) ? ` · ${t("add.addedNote")}` : ""}`;
    });
    const head = g.entries[0].short ? `${g.entries[0].short} · ${g.entries[0].name}` : g.entries[0].name;
    return [head, ...lines].join("\n") + (findExisting(g.entries) ? `\n${t("add.addedNote")}` : "");
  };

  return (
    <Card>
      <div className="add-head">
        <span className="add-title">{providers.length ? t("add.title") : t("add.first")}</span>
        <span className="grow" />
        <label className="pv-search add-search">
          <Search size={14} aria-hidden="true" />
          <input
              ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData?.getData("text") ?? "";
              const found = parsePasted(text);
              if (found.baseUrl) {
                e.preventDefault();
                onPickCustom(found);
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery("");
              else if (canClose) onClose();
            }}
              placeholder={searchHint}
              aria-label={searchHint}
          />
        </label>
        <button
          type="button"
          className="btn ghost sm"
          title={t("add.customTitle")}
          onClick={() => onPickCustom()}
        >
          <Plus size={14} aria-hidden="true" />
          {t("add.custom")}
        </button>
        <button
          type="button"
          className={`btn ghost sm${showImport ? " on" : ""}`}
          title={t("add.importTitle")}
          onClick={() => setShowImport((v) => !v)}
        >
          <Import size={14} aria-hidden="true" />
          {t("add.import")}
        </button>
        {canClose ? (
          <button type="button" className="btn ghost sm" onClick={onClose}>
            {t("add.close")}
          </button>
        ) : null}
      </div>

      {showImport ? (
        <div className="add-import">
          <Field label={t("add.impLabel")} htmlFor="add-import-text" help={t("add.impDesc")}>
            <textarea
              id="add-import-text"
              className="input mono"
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t("add.impPh")}
              spellCheck={false}
            />
          </Field>
          {paste.trim() ? (
            <p className="help" role="status">
              {pasted.baseUrl
                ? pasted.keys
                  ? t("add.impFound")
                  : t("add.impOnlyUrl")
                : t("add.impNotFound")}
            </p>
          ) : null}
          <div className="add-import-foot">
            <button type="button" className="btn ghost sm" onClick={() => setShowImport(false)}>
              {t("common.cancel")}
            </button>
            <span className="grow" />
            <button
              type="button"
              className="btn primary sm"
              disabled={!pasted.baseUrl}
              onClick={() => onPickCustom(pasted)}
            >
              {t("add.impUse")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="tiles">
        {sections.map(({ kind, title, hint }) => {
          const rows = visible.filter((g) => g.entries[0].kind === kind);
          if (!rows.length) return null;
          return (
            <div key={kind}>
              <div className="kind">
                <b>{title}</b>
                <span>{hint}</span>
              </div>
              <div className="grid">
                {rows.map((g) => {
                  const added = !!findExisting(g.entries);
                  const label = g.entries[0].short || g.entries[0].name;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      className={`tile${added ? " added" : ""}`}
                      title={tileTitle(g)}
                      onClick={() => openTile(g)}
                    >
                      <VendorIcon
                        name={label}
                        icon={g.entries.map((e) => e.icon).find(Boolean) ?? null}
                        size="sm"
                      />
                      <span className="nm">
                        <span className="n">{label}</span>
                        {added ? <span className="have" aria-hidden="true" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!visible.length ? (
          <div className="none">
            <Empty
              icon={<Search size={18} />}
              title={t("add.none", { q: query.trim() })}
            >
              <button type="button" className="link" onClick={() => onPickCustom({ baseUrl: undefined })}>
                {t("add.asCustom")}
              </button>
              {t("add.or")}
              <button type="button" className="link" onClick={() => setShowImport(true)}>
                {t("add.importIt")}
              </button>
            </Empty>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

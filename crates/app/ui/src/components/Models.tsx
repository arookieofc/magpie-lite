import { useMemo, useState } from "react";
import { Check, Copy, Layers, Search } from "lucide-react";
import type { ModelsResponse } from "../types";
import { Card, Empty } from "./ui";
import { useT } from "../i18n";

export default function Models({ models }: { models: ModelsResponse | null }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const list = useMemo(() => models?.data ?? [], [models]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byOwner = new Map<string, string[]>();
    for (const m of list) {
      if (q && !m.id.toLowerCase().includes(q) && !(m.owned_by || "").toLowerCase().includes(q)) {
        continue;
      }
      const owner = m.owned_by || "other";
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), m.id]);
    }
    return [...byOwner.entries()];
  }, [list, query]);

  async function copyModel(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Card
      title={t("models.title")}
      icon={<Layers size={16} />}
      description={t("models.desc", { n: list.length })}
      labelledBy="models-title"
      actions={
        list.length > 8 ? (
          <label className="search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder={t("models.searchPh")}
              aria-label={t("models.searchPh")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        ) : null
      }
    >
      {list.length === 0 ? (
        <Empty icon={<Layers size={18} />} title={t("models.emptyTitle")} />
      ) : (
        <div className="catalog">
          {groups.map(([owner, ids]) => (
            <div key={owner} className="catalog-group">
              <p className="catalog-owner">
                {owner}
                <span>{ids.length}</span>
              </p>
              <ul className="chips">
                {ids.map((id) => {
                  const copied = copiedId === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={`chip-btn${copied ? " copied" : ""}`}
                        onClick={() => copyModel(id)}
                        data-tip={copied ? t("models.copied") : t("gw.copy")}
                      >
                        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                        <span>{id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

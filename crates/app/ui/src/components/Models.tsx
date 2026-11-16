import { Layers } from "lucide-react";
import type { ModelsResponse } from "../types";
import { Card, Empty } from "./ui";
import { useT } from "../i18n";

export default function Models({ models }: { models: ModelsResponse | null }) {
  const t = useT();
  const list = models?.data ?? [];
  const byOwner = new Map<string, string[]>();
  for (const m of list) {
    const owner = m.owned_by || "other";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), m.id]);
  }
  return (
    <Card
      title={t("models.title")}
      icon={<Layers size={16} />}
      description={t("models.desc", { n: list.length })}
      labelledBy="models-title"
    >
      {list.length === 0 ? (
        <Empty icon={<Layers size={18} />} title={t("models.emptyTitle")} />
      ) : (
        <div className="catalog">
          {[...byOwner.entries()].map(([owner, ids]) => (
            <div key={owner} className="catalog-group">
              <p className="catalog-owner">
                {owner}
                <span>{ids.length}</span>
              </p>
              <ul className="chips">
                {ids.map((id) => (
                  <li key={id} className="chip mono">
                    {id}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

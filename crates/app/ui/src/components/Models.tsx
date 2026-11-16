import { Layers } from "lucide-react";
import type { ModelsResponse } from "../types";
import { Card, Empty } from "./ui";

export default function Models({ models }: { models: ModelsResponse | null }) {
  const list = models?.data ?? [];
  const byOwner = new Map<string, string[]>();
  for (const m of list) {
    const owner = m.owned_by || "other";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), m.id]);
  }
  return (
    <Card
      title="Model catalog"
      icon={<Layers size={16} />}
      description={`${list.length} routes agents can choose from /v1/models`}
      labelledBy="models-title"
    >
      {list.length === 0 ? (
        <Empty icon={<Layers size={18} />} title="No models are configured" />
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

import { Boxes } from "lucide-react";
import type { Stats } from "../types";
import { compact, fmt } from "../util";
import { Card, Empty } from "./ui";
import { useT } from "../i18n";

export default function UsageByModel({ stats }: { stats: Stats | null }) {
  const t = useT();
  const rows = Object.entries(stats?.recent_usage?.by_model ?? {}).sort(
    (a, b) => b[1].input_tokens + b[1].output_tokens - (a[1].input_tokens + a[1].output_tokens),
  );
  const peak = Math.max(1, ...rows.map(([, u]) => u.input_tokens + u.output_tokens));
  return (
    <Card
      title={t("usage.title")}
      icon={<Boxes size={16} />}
      description={t("usage.desc")}
      flush
      labelledBy="usage-title"
    >
      {rows.length === 0 ? (
        <Empty icon={<Boxes size={18} />} title={t("usage.emptyTitle")}>
          {t("usage.emptyCopy")}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("usage.model")}</th>
                <th scope="col" className="share-col">{t("usage.share")}</th>
                <th scope="col" className="num">{t("usage.requests")}</th>
                <th scope="col" className="num">{t("usage.errors")}</th>
                <th scope="col" className="num">{t("usage.input")}</th>
                <th scope="col" className="num">{t("usage.output")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([model, u]) => {
                const tokens = u.input_tokens + u.output_tokens;
                return (
                  <tr key={model}>
                    <td><code className="route">{model}</code></td>
                    <td className="share-col">
                      <div className="share">
                        <span className="share-bar"><span style={{ width: `${(tokens / peak) * 100}%` }} /></span>
                        <span className="share-value">{compact(tokens)}</span>
                      </div>
                    </td>
                    <td className="num">{fmt(u.requests)}</td>
                    <td className={`num${u.errors ? " text-bad" : " text-muted"}`}>{fmt(u.errors)}</td>
                    <td className="num">{fmt(u.input_tokens)}</td>
                    <td className="num">{fmt(u.output_tokens)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

import { Boxes } from "lucide-react";
import type { Stats } from "../types";
import { compact, fmt } from "../util";
import { Card, Empty } from "./ui";

export default function UsageByModel({ stats }: { stats: Stats | null }) {
  const rows = Object.entries(stats?.recent_usage?.by_model ?? {}).sort(
    (a, b) => b[1].input_tokens + b[1].output_tokens - (a[1].input_tokens + a[1].output_tokens),
  );
  const peak = Math.max(1, ...rows.map(([, u]) => u.input_tokens + u.output_tokens));
  return (
    <Card
      title="Usage by model"
      icon={<Boxes size={16} />}
      description="Recent-history window"
      flush
      labelledBy="usage-title"
    >
      {rows.length === 0 ? (
        <Empty icon={<Boxes size={18} />} title="No model usage yet">
          No model usage is in the recent-history window yet.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className="share-col">Token share</th>
                <th scope="col" className="num">Requests</th>
                <th scope="col" className="num">Errors</th>
                <th scope="col" className="num">Input</th>
                <th scope="col" className="num">Output</th>
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

import { pct } from "@/lib/colors";
import type { NodeResponse } from "@/lib/types";

type Props = { data: NodeResponse; order: number[]; colors: string[] };

export default function ActionSummary({ data, order, colors }: Props) {
  const { actions } = data.node;
  return (
    <div>
      <div className="tiles">
        {order.map((i) => (
          <div key={i} className="tile" style={{ background: colors[i], flexGrow: Math.max(data.summary[i].freq, 0.12) }}>
            <div className="tile-label">{actions[i].label}</div>
            <div className="tile-foot">
              <b>{pct(data.summary[i].freq)}%</b>
              <small>{data.summary[i].combos.toFixed(2)} combos</small>
            </div>
          </div>
        ))}
      </div>
      <div className="bar">
        {order.map((i) => (
          <span key={i} style={{ background: colors[i], width: `${data.summary[i].freq * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

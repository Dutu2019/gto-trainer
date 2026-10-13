import { pct, stackedGradient } from "@/lib/colors";
import type { ActionInfo, HandRow } from "@/lib/types";
import { Card } from "./Cards";

type Props = { rows: HandRow[]; actions: ActionInfo[]; order: number[]; colors: string[] };

// The individual combos of the selected grid cell, each tinted by its own strategy.
export default function HandTiles({ rows, actions, order, colors }: Props) {
  if (!rows.length) return <p className="hint">No combos of this hand in the range.</p>;
  return (
    <div className="hands">
      {rows.map((h) => (
        <div key={h.hand} className="hand" style={{ background: stackedGradient(h.freqs, order, colors) }}>
          <div className="hand-cards">
            <Card card={h.hand.slice(0, 2)} />
            <Card card={h.hand.slice(2)} />
          </div>
          {order.map((i) => (
            <div key={i} className="hand-line">
              <span>{actions[i].label}</span>
              <span>{pct(h.freqs[i], 0)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

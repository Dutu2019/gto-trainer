import type { TrailEntry } from "@/lib/types";
import { Card } from "./Cards";

// The hand as a bar of cards: preflop decisions, the dealt flop/turn/river,
// then the postflop decisions. Click any decision to jump there; a decision
// that closes a street asks for the next card instead (that card starts a new
// tree). Dealt cards are inert entries shown between the streets.
export default function TrailBar({
  entries,
  onGo,
  onDeal,
}: {
  entries: TrailEntry[];
  onGo: (path: string) => void;
  onDeal?: (path: string) => void;
}) {
  const last = entries.length - 1;
  return (
    <div className="trail">
      {entries.map((entry, k) => {
        if (!("actions" in entry)) {
          return (
            <div key={entry.path} className="step card-step">
              <div className="step-head">
                <span>{entry.label}</span>
              </div>
              <div className="cards">
                {entry.cards.map((c) => (
                  <Card key={c} card={c} />
                ))}
              </div>
            </div>
          );
        }
        const current = k === last;
        return (
          <div key={entry.path || "root"} className={`step ${current ? "current" : ""}`}>
            <div className="step-head">
              <span>{entry.position}</span>
              {entry.player && <small>{entry.player}</small>}
            </div>
            {entry.actions.map((a) => {
              const terminal = a.childPath === null;
              const deal = !!a.endsStreet && !!a.childPath && !!onDeal;
              return (
                <button
                  key={a.label}
                  className={`act ${a.chosen ? "chosen" : ""} ${deal ? "act-deal" : ""}`}
                  disabled={terminal}
                  title={
                    terminal
                      ? "Terminal: hand ends here"
                      : deal
                        ? "Closes the street — deal the next card"
                        : undefined
                  }
                  onClick={() => {
                    if (a.childPath === null) return;
                    if (deal) onDeal?.(a.childPath);
                    else onGo(a.childPath);
                  }}
                >
                  {a.label}
                  {deal && <span className="deal-mark"> +card</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

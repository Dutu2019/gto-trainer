import type { TrailStep } from "@/lib/types";

// Decision tree as a bar of cards (root -> current node). Click any non-terminal action to jump there.
export default function TrailBar({ trail, onGo }: { trail: TrailStep[]; onGo: (path: string) => void }) {
  return (
    <div className="trail">
      {trail.map((step, k) => {
        const current = k === trail.length - 1;
        return (
          <div key={step.path || "root"} className={`step ${current ? "current" : ""}`}>
            <div className="step-head">
              <span>{step.position}</span>
              <small>{step.player}</small>
            </div>
            {step.actions.map((a) => {
              const terminal = a.childPath === null;
              return (
                <button
                  key={a.label}
                  className={`act ${a.chosen ? "chosen" : ""}`}
                  disabled={terminal}
                  title={terminal ? "Terminal: hand ends here" : undefined}
                  onClick={() => a.childPath !== null && onGo(a.childPath)}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

import { formatBetSizes, STREET_LABELS } from "@/lib/format";
import type { BettingOptions } from "@/lib/types";

/** Shows the solver's bet/raise options for each position on this street. */
export function BettingOptionsPanel({
  options,
  actingPosition,
  street,
}: {
  options: BettingOptions;
  actingPosition: string;
  street: string;
}) {
  const entries = Object.entries(options);
  if (!entries.length) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Betting options
        </span>
        <span className="text-xs text-zinc-500">
          {STREET_LABELS[street] ?? street} sizings
        </span>
      </div>
      <div className="space-y-2">
        {entries.map(([position, sizes]) => {
          const acting = position === actingPosition;
          return (
            <div
              key={position}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                acting
                  ? "border-sky-400/60 bg-sky-500/10"
                  : "border-zinc-800 bg-zinc-900/40"
              }`}
            >
              <span
                className={`font-semibold ${
                  acting ? "text-sky-200" : "text-zinc-300"
                }`}
              >
                {position}
                {acting ? " (acting)" : ""}
              </span>
              <span className="text-zinc-400">{formatBetSizes(sizes)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

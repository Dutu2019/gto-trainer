import { formatPct } from "@/lib/format";

export function Progress({
  current,
  total,
  history,
}: {
  current: number;
  total: number;
  history: { score: number }[];
}) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  const answered = history.length;
  const avg =
    answered > 0
      ? history.reduce((sum, h) => sum + h.score, 0) / answered
      : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>
          Question {Math.min(current + 1, total)} / {total}
        </span>
        <span>
          {answered > 0
            ? `${answered} answered \u00b7 avg ${formatPct(avg ?? 0)}`
            : "Mixed-strategy scoring"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-sky-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

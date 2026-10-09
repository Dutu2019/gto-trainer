import { formatAction, formatPct } from "@/lib/format";

export function FrequencyBar({
  action,
  freq,
  best,
  chosen,
}: {
  action: string;
  freq: number;
  best: boolean;
  chosen: boolean;
}) {
  const pct = Math.round(freq * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span
          className={
            best
              ? "font-semibold text-emerald-300"
              : chosen
                ? "font-semibold text-sky-300"
                : "text-zinc-300"
          }
        >
          {formatAction(action)}
          {best ? " \u2605" : ""}
        </span>
        <span className="tabular-nums text-zinc-400">{formatPct(freq)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${
            best ? "bg-emerald-400" : chosen ? "bg-sky-400" : "bg-zinc-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

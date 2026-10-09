"use client";

import { formatAction } from "@/lib/format";

export function ActionBar({
  actions,
  onChoose,
  disabled,
  chosenIndex,
}: {
  actions: string[];
  onChoose: (index: number) => void;
  disabled?: boolean;
  chosenIndex?: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {actions.map((action, index) => {
        const isChosen = chosenIndex === index;
        return (
          <button
            key={action}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(index)}
            className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isChosen
                ? "border-sky-400 bg-sky-500/20 text-sky-200"
                : "border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-700"
            }`}
          >
            {formatAction(action)}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { FrequencyBar } from "./FrequencyBar";
import { formatPct } from "@/lib/format";
import type { GradeResult } from "@/lib/grading";
import type { Answer } from "@/lib/types";

export function ResultPanel({
  answer,
  chosenIndex,
  grade,
}: {
  answer: Answer;
  chosenIndex: number;
  grade: GradeResult;
}) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-200">
          GTO strategy for this hand
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            grade.isBest
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {grade.isBest ? "Best action" : "Mixed spot"} &middot; score{" "}
          {formatPct(grade.score)}
        </span>
      </div>
      <div className="space-y-3">
        {answer.actions.map((action, i) => (
          <FrequencyBar
            key={action}
            action={action}
            freq={answer.freqs[i]}
            best={i === grade.bestIndex}
            chosen={i === chosenIndex}
          />
        ))}
      </div>
    </div>
  );
}

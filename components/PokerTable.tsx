import { Board } from "./Board";
import { Card, CardBack } from "./Card";
import { formatChips } from "@/lib/format";
import type { Actor } from "@/lib/types";

function ChipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="8.5" ry="3.3" fill="currentColor" opacity="0.95" />
      <ellipse cx="12" cy="11" rx="8.5" ry="3.3" fill="currentColor" opacity="0.75" />
      <ellipse cx="12" cy="15.5" rx="8.5" ry="3.3" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function StatBadge({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-black/45 px-4 py-2 shadow-lg ring-1 ring-white/15 backdrop-blur-sm">
      <ChipIcon
        className={`${emphasis ? "h-7 w-7 text-amber-300" : "h-5 w-5 text-amber-300/80"}`}
      />
      <div className="flex flex-col leading-none">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200/80">
          {label}
        </span>
        <span
          className={`mt-1 font-bold tabular-nums text-white ${
            emphasis ? "text-3xl" : "text-xl"
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

export function Seat({
  name,
  position,
  actor,
  cards,
  stack,
  faceDown,
  highlight,
}: {
  name: string;
  position: string;
  actor: Actor;
  cards?: string[];
  stack: number;
  faceDown?: boolean;
  highlight?: boolean;
}) {
  const actorClass =
    actor === "OOP"
      ? "bg-fuchsia-500/25 text-fuchsia-200 ring-fuchsia-400/30"
      : "bg-cyan-500/25 text-cyan-200 ring-cyan-400/30";

  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl px-4 py-2.5 transition-shadow ${
        highlight ? "bg-black/25 shadow-lg ring-2 ring-amber-300/70" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${actorClass}`}
        >
          {position}
        </span>
        <span className="text-sm font-semibold text-white">{name}</span>
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          {actor === "OOP" ? "Out of position" : "In position"}
        </span>
      </div>

      <div className="flex gap-1.5">
        {faceDown ? (
          <>
            <CardBack size="md" />
            <CardBack size="md" />
          </>
        ) : (
          (cards ?? []).map((code) => <Card key={code} code={code} size="md" />)
        )}
      </div>

      <div className="rounded-full bg-black/40 px-3 py-0.5 text-xs text-white/80 ring-1 ring-white/10">
        Stack {formatChips(stack)}
      </div>
    </div>
  );
}

export function PokerTable({
  board,
  pot,
  effectiveStack,
}: {
  board: string[];
  pot: number;
  effectiveStack: number;
}) {

  return (
    <div className="relative overflow-hidden rounded-full bg-linear-to-b from-emerald-700 via-emerald-900 to-emerald-950 p-5 shadow-2xl ring-1 ring-black/40 sm:p-8">
      <div className="pointer-events-none absolute inset-3 rounded-4xl ring-1 ring-white/10" />
      <div className="relative flex flex-col items-center gap-5">

        <div className="flex flex-col items-center gap-4 py-1">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <StatBadge label="Pot" value={formatChips(pot)} emphasis />
            <StatBadge label="Eff. stack" value={formatChips(effectiveStack)} />
          </div>
          <Board cards={board} />
        </div>

      </div>
    </div>
  );
}

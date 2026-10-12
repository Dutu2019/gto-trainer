import type { PositionBetSizes } from "./types";

export function formatChips(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "BET 5.000000" -> "Bet 5", "CHECK" -> "Check", "RAISE 94.000000" -> "Raise 94". */
export function formatAction(label: string): string {
  const [verb, amount] = label.split(" ");
  const capitalized = verb.charAt(0) + verb.slice(1).toLowerCase();
  if (!amount) return capitalized;
  return `${capitalized} ${formatChips(Number(amount))}`;
}

export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "Bet 33%, 75% · Raise 60% · All-in" for one position's options. */
export function formatBetSizes(sizes: PositionBetSizes): string {
  const parts: string[] = [];
  if (sizes.bet?.length) {
    parts.push(`Bet ${sizes.bet.map((pct) => `${pct}%`).join(", ")}`);
  }
  if (sizes.raise?.length) {
    parts.push(`Raise ${sizes.raise.map((pct) => `${pct}%`).join(", ")}`);
  }
  if (sizes.allin) parts.push("All-in");
  return parts.join(" \u00b7 ");
}

export const STREET_LABELS: Record<string, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

export const MATCHUP_LABELS: Record<string, string> = {
  SB_BB: "SB vs BB",
  BTN_BB: "BTN vs BB",
};

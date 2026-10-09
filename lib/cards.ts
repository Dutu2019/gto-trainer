const RANK_LABELS: Record<string, string> = {
  A: "A",
  K: "K",
  Q: "Q",
  J: "J",
  T: "10",
  "9": "9",
  "8": "8",
  "7": "7",
  "6": "6",
  "5": "5",
  "4": "4",
  "3": "3",
  "2": "2",
};

const SUIT_SYMBOLS: Record<string, string> = {
  s: "\u2660", // spade
  h: "\u2665", // heart
  d: "\u2666", // diamond
  c: "\u2663", // club
};

export type CardColor = "red" | "black";

export function cardRank(code: string): string {
  return RANK_LABELS[code[0]] ?? code[0];
}

export function cardSuitSymbol(code: string): string {
  return SUIT_SYMBOLS[code[1]] ?? "";
}

export function cardColor(code: string): CardColor {
  return code[1] === "h" || code[1] === "d" ? "red" : "black";
}

export function parseHand(hand: string): string[] {
  return [hand.slice(0, 2), hand.slice(2, 4)];
}

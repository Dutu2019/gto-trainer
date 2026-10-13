export const RANKS = "AKQJT98765432";

/** 'Ts8s' -> 'T8s', 'TsTc' -> 'TT', 'Ts8d' -> 'T8o' */
export function handClass(hand: string): string {
  const [r1, s1, r2, s2] = [hand[0], hand[1], hand[2], hand[3]];
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = RANKS.indexOf(r1) < RANKS.indexOf(r2) ? [r1, r2] : [r2, r1];
  return hi + lo + (s1 === s2 ? "s" : "o");
}

/** Position of a hand class in the 13x13 grid: pairs on the diagonal, suited top-right, offsuit bottom-left. */
export function gridPos(cls: string): [number, number] {
  const a = RANKS.indexOf(cls[0]);
  const b = RANKS.indexOf(cls[1]);
  if (cls.length === 2) return [a, a];
  return cls[2] === "s" ? [a, b] : [b, a];
}

export function gridLabel(row: number, col: number): string {
  if (row === col) return RANKS[row] + RANKS[row];
  return row < col ? RANKS[row] + RANKS[col] + "s" : RANKS[col] + RANKS[row] + "o";
}

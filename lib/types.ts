export type Actor = "OOP" | "IP";
export type Street = "flop" | "turn" | "river";

/** Solver bet/raise options for one position on one street (pot percentages). */
export interface PositionBetSizes {
  bet: number[];
  raise: number[];
  allin: boolean;
}

/** Betting options keyed by position label, e.g. `{ SB: {...}, BB: {...} }`. */
export type BettingOptions = Record<string, PositionBetSizes>;

export interface SessionFilters {
  count: number;
  matchups?: string[];
  streets?: Street[];
  actors?: Actor[];
}

export interface Question {
  nodeId: number;
  spotId: string;
  matchup: string;
  street: Street;
  board: string[];
  actor: Actor;
  /** Acting player's position, e.g. "SB". */
  position: string;
  /** The other player's position, e.g. "BB". */
  opponentPosition: string;
  pot: number;
  effectiveStack: number;
  /** Bet/raise sizes configured for each position on the current street. */
  bettingOptions: BettingOptions;
  /** Preflop action sequence that produced this spot ("hand history"). */
  preflop: string;
  actions: string[];
  hand: string;
  holeCards: string[];
}

export interface Answer {
  nodeId: number;
  hand: string;
  actions: string[];
  freqs: number[];
  bestIndex: number;
  /** GTO frequency of the action the user picked (mixed-strategy score). */
  score: number | null;
}

export interface AnsweredQuestion {
  question: Question;
  answer: Answer;
  chosenIndex: number;
}

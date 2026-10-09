export type Actor = "OOP" | "IP";
export type Street = "flop" | "turn" | "river";

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

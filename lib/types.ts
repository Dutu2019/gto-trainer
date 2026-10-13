export type Kind = "CHECK" | "BET" | "CALL" | "RAISE" | "FOLD";

export type SpotInfo = {
  spotId: number;
  sourceFile: string;
  street: string;
  board: string; // 'QsJh4d8c3s'
  posOop: string;
  posIp: string;
  potBb: number | null;
  effStackBb: number | null;
};

export type ActionInfo = {
  idx: number; // row index in the strategy blob
  raw: string; // 'BET 5.000000'
  kind: Kind;
  amount: number | null;
  label: string; // 'Bet 5'
  childPath: string | null; // null = terminal (fold / call / check-back)
};

export type TrailStep = {
  path: string;
  player: "OOP" | "IP";
  position: string;
  actions: { label: string; kind: Kind; amount: number | null; childPath: string | null; chosen: boolean }[];
};

export type GridCell = {
  label: string; // 'AKs'
  combos: number; // combos of this class present in the range
  freqs: number[]; // mean frequency per action over those combos (action idx order)
};

export type HandRow = { hand: string; cls: string; freqs: number[] };

export type NodeResponse = {
  spot: SpotInfo;
  node: { nodeId: number; path: string; player: "OOP" | "IP"; position: string; actions: ActionInfo[] };
  trail: TrailStep[]; // root .. current node
  nHands: number;
  summary: { freq: number; combos: number }[]; // per action idx
  grid: GridCell[][]; // 13 x 13, AA top-left
  hands: HandRow[];
};

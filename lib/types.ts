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
  /** First three board cards — the flop a spot belongs to. */
  flop?: string;
  /** Preflop chart line that produced this spot's ranges, when it resolves. */
  lineId?: string | null;
  lineLabel?: string | null;
  /** Continuation lineage: the spot this tree was dealt from. */
  parentSpotId?: number | null;
  /** Decision node in the parent where the street closed. */
  parentPath?: string | null;
  /** Card that starts this spot's street ('9d'). */
  dealtCard?: string | null;
};

/** One step back up a continuation chain. */
export type ChainSegment = {
  spotId: number;
  street: string;
  board: string;
  lineId: string | null;
  /** Trail from that spot's root to the node where the next card was dealt. */
  trail: TrailStep[];
  /** Card dealt at the end of this segment to reach the next spot. */
  dealtCard: string | null;
};

/** One preflop line + flop, with every solved street under it. */
export type SpotGroup = {
  key: string;
  lineId: string | null;
  label: string;
  flop: string;
  spots: SpotInfo[];
};

export type ActionInfo = {
  idx: number; // row index in the strategy blob
  raw: string; // 'BET 5.000000'
  kind: Kind;
  amount: number | null;
  label: string; // 'Bet 5'
  childPath: string | null; // null = terminal (fold / call / check-back)
  /** True when the child is a chance node: the round closes and a card is dealt. */
  endsStreet?: boolean;
};

export type TrailStep = {
  path: string;
  player: string; // 'OOP' / 'IP' postflop, '' for the preflop chart (seat is enough)
  position: string;
  actions: {
    label: string;
    kind: Kind;
    amount: number | null;
    childPath: string | null;
    endsStreet?: boolean;
    chosen: boolean;
  }[];
};

/** A dealt card (or the flop) shown between two decision steps in the trail. */
export type TrailCards = {
  /** Synthetic key; starts with 'cards|' so it is never a node path. */
  path: string;
  cards: string[];
  label: string;
};

/** One entry of the viewer trail: a decision step, or a card that was dealt. */
export type TrailEntry = TrailStep | TrailCards;

/** One branch of the preflop chart. */
export type PreflopOption = {
  /** Chart token: '2.5bb', 'Call', 'Fold', 'AllIn'. */
  action: string;
  label: string;
  kind: Kind;
  amount: number | null;
  /** Path of the decision node this action leads to. */
  path: string;
};

/** A preflop line that ends here (betting closed). */
export type PreflopLeaf = {
  lineId: string;
  label: string;
  potBb: number;
  effStackBb: number;
  oop: string | null;
  ip: string | null;
  /** Heads-up and no all-in: a flop can be dealt and solved. */
  solvable: boolean;
  /** Why this line cannot reach a solvable flop. */
  reason: string | null;
};

export type PreflopNode = {
  /** Seat+action path from the root, e.g. 'UTG/2.5bb/MP/Fold/CO/2.5bb'. */
  path: string;
  /** Seat to act, null when preflop is over. */
  seat: string | null;
  options: PreflopOption[];
  /** Decision trail from UTG to this node (same shape as the postflop trail). */
  trail: TrailStep[];
  leaf: PreflopLeaf | null;
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

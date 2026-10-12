// Spot definitions and ranges for the offline TexasSolver pipeline.
// Player mapping in solver output: player 1 = OOP, player 0 = IP.

export const solverConfig = {
  threadNum: 8,
  accuracy: 0.5,
  maxIteration: 120,
  printInterval: 10,
  useIsomorphism: 1,
  allinThreshold: 0.67,
  // Dump only the starting betting street. Turn spots still solve the river
  // internally, but we don't store the river runout explosion in the MVP.
  dumpRounds: 1,
};

// Heads-up single-raised-pot ranges at ~100bb.
export const ranges = {
  SB_BB: {
    oop:
      "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A5s,A4s,A3s,A2s," +
      "KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,AKo,AQo,AJo,KQo,KJo,QJo",
    ip:
      "TT,99,88,77,66,55,44,33,22,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s," +
      "KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,86s,76s,75s,65s,64s,54s," +
      "AJo,ATo,A9o,KQo,KJo,KTo,QJo,QTo,JTo",
  },
  BTN_BB: {
    oop:
      "TT,99,88,77,66,55,44,33,22,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s," +
      "KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,86s,76s,75s,65s,64s,54s," +
      "AQo,AJo,ATo,KQo,KJo,QJo,JTo",
    ip:
      "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s," +
      "KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,98s,87s,76s,65s,54s,AKo,AQo,AJo,ATo,KQo,KJo,QJo",
  },
};

export const matchups = {
  SB_BB: { oop: "SB", ip: "BB" },
  BTN_BB: { oop: "BB", ip: "BTN" },
};

// Preflop "hand history" that leads to each matchup's postflop spot. Each spot
// may override this with its own `preflop` string (e.g. a 3-bet pot).
export const preflopLines = {
  SB_BB: "SB raises to 2.5bb, BB calls",
  BTN_BB: "BTN raises to 2.5bb, BB calls",
};

// Default betting options per street for each position. Values are pot
// percentages; `allin` adds an all-in size. Each extra size grows the solve
// tree and increases solve time/memory, so keep these lean. Individual spots
// can override any street/position via `betSizes` (merged over these defaults).
export const defaultBetSizes = {
  turn: {
    oop: { bet: [33, 75], raise: [60], allin: true },
    ip: { bet: [33, 75], raise: [60], allin: true },
  },
  river: {
    oop: { bet: [33, 75], raise: [60], allin: true },
    ip: { bet: [33, 75], raise: [60], allin: true },
  },
};

export const spots = [
  {
    id: "sb_bb_river_As7h2c9d3s",
    matchup: "SB_BB",
    street: "river",
    board: "As,7h,2c,9d,3s",
    pot: 6,
    effectiveStack: 94,
    preflop: "SB raises to 2.5bb, BB calls",
  },
  {
    id: "sb_bb_river_KhTd6c2s9h",
    matchup: "SB_BB",
    street: "river",
    board: "Kh,Td,6c,2s,9h",
    pot: 6,
    effectiveStack: 94,
    preflop: "SB raises to 2.5bb, BB calls",
  },
  {
    id: "btn_bb_river_QsJh4d8c3s",
    matchup: "BTN_BB",
    street: "river",
    board: "Qs,Jh,4d,8c,3s",
    pot: 6,
    effectiveStack: 94,
    preflop: "BTN raises to 2.5bb, BB calls",
  },
  {
    id: "btn_bb_turn_Qh8s3d2c",
    matchup: "BTN_BB",
    street: "turn",
    board: "Qh,8s,3d,2c",
    pot: 6,
    effectiveStack: 94,
    preflop: "BTN raises to 2.5bb, BB calls",
  },
  {
    id: "sb_bb_turn_9d9h5s2c",
    matchup: "SB_BB",
    street: "turn",
    board: "9d,9h,5s,2c",
    pot: 6,
    effectiveStack: 94,
    preflop: "SB raises to 2.5bb, BB calls",
  },
];

// Streets whose bet sizes must be configured for a spot (the solver needs the
// full downstream tree even if we only dump the first street).
export function streetsFor(street) {
  return street === "river" ? ["river"] : ["turn", "river"];
}

// Merge the defaults with a spot's `betSizes` override for one street/position.
export function positionBetSizes(spot, street, who) {
  const base =
    defaultBetSizes[street]?.[who] ?? { bet: [], raise: [], allin: true };
  const override = spot.betSizes?.[street]?.[who] ?? {};
  return { ...base, ...override };
}

// Fully resolved betting options for every street a spot solves, keyed by
// street then position. Stored in SQLite and shown in the trainer UI.
export function resolvedBetSizes(spot) {
  const out = {};
  for (const street of streetsFor(spot.street)) {
    out[street] = {
      oop: positionBetSizes(spot, street, "oop"),
      ip: positionBetSizes(spot, street, "ip"),
    };
  }
  return out;
}

// Preflop action sequence for a spot: an explicit `preflop` wins over the
// matchup default.
export function preflopFor(spot) {
  return spot.preflop ?? preflopLines[spot.matchup] ?? "";
}
